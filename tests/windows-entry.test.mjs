import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {isMain} from '../updates/entry.mjs';
const entry = pathToFileURL(fileURLToPath(new URL('../updates/entry.mjs', import.meta.url))).href;
test('authoritative ESM entry detection wins over mismatched path spelling', () => {
  assert.equal(isMain({main:true, url:'file:///C:/Users/Player/setup.mjs'}, 'c:\\users\\player\\SETUP.mjs'), true);
  assert.equal(isMain({main:false, url:import.meta.url}, fileURLToPath(import.meta.url)), false);
});
test('older runtime canonicalizes filesystem aliases before comparing', () => {
  const calls=[]; const result=isMain({url:import.meta.url}, '/tmp/linked.mjs', {resolve:x=>x, realpath:x=>{calls.push(x);return '/real/actual.mjs';}, platform:'linux'});
  assert.equal(result,true); assert.deepEqual(calls,['/tmp/linked.mjs',fileURLToPath(import.meta.url)]);
});
test('Windows fallback ignores drive and filename case after resolving paths', () => {
  let n=0; assert.equal(isMain({url:'file:///C:/Users/Player/setup.mjs'}, 'c:\\users\\player\\SETUP.mjs', {resolve:x=>x, realpath:()=>n++?'C:\\Users\\Player\\setup.mjs':'c:\\users\\player\\SETUP.mjs', platform:'win32'}), true);
});
test('POSIX fallback does not collapse distinct case-sensitive paths', () => {
  let n=0; assert.equal(isMain({url:import.meta.url}, '/tmp/run.mjs', {resolve:x=>x, realpath:()=>n++?'/tmp/Run.mjs':'/tmp/run.mjs', platform:'linux'}), false);
});
test('imports, missing arguments, and inaccessible entries do not run a CLI', () => {
  assert.equal(isMain({},undefined),false);
  assert.equal(isMain({url:import.meta.url},'',{}),false);
  assert.equal(isMain({url:import.meta.url},'/absent',{realpath:()=>{throw Error('absent');}}),false);
});
test('actual child process through an alias invokes the repaired entry; old guard exits silently', t => {
  const root=mkdtempSync(path.join(tmpdir(),'gz-entry-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const target=path.join(root,'real'),alias=path.join(root,'aliased');
  mkdirSync(target);symlinkSync(target,alias,'junction');
  const old="import path from 'node:path';import {fileURLToPath} from 'node:url';if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log('ENTRY-RAN');";
  const repaired=`import {isMain} from ${JSON.stringify(entry)};if(isMain(import.meta))console.log('ENTRY-RAN');`;
  writeFileSync(path.join(target,'old.mjs'),old);writeFileSync(path.join(target,'repaired.mjs'),repaired);
  const before=spawnSync(process.execPath,[path.join(alias,'old.mjs')],{encoding:'utf8'});
  const after=spawnSync(process.execPath,[path.join(alias,'repaired.mjs')],{encoding:'utf8'});
  assert.equal(before.status,0);assert.equal(before.stdout,'');assert.equal(before.stderr,'');
  assert.equal(after.status,0,after.stderr);assert.match(after.stdout,/ENTRY-RAN/);
  const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(path.join(target,'repaired.mjs')).href)})`],{encoding:'utf8'});
  assert.equal(imported.status,0);assert.equal(imported.stdout,'');
});
