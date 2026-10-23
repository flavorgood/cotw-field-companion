/** Full-checkout acceptance: actual HTTP server, launcher and SQLite, using no player save. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createApp} from '../server.mjs';
import {runtimeIdentity,runtimeScope} from '../lib/runtime-identity.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
test('real bootstrap and repeated launcher reuse match code and journal without changing SQLite',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gz-runtime-http-')),dataDir=path.join(directory,'private-journal');
  const app=await createApp({dataDir,port:0,phoneRelayUrl:null,interval:60000});
  t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  const response=await fetch(app.url+'/api/bootstrap'),bootstrap=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(bootstrap.runtime,{...runtimeIdentity(root),scope:runtimeScope(dataDir,null)});
  assert(!JSON.stringify(bootstrap.runtime).includes(directory));assert(!JSON.stringify(bootstrap.runtime).includes(root));
  const rejected=await fetch(app.url+'/api/bootstrap',{headers:{Origin:'https://unrelated.invalid'}});assert.equal(rejected.status,403);
  const snapshot=async()=>Object.fromEntries(await Promise.all((await readdir(dataDir)).filter(v=>/^journal\.sqlite(?:-wal|-shm)?$/.test(v)).map(async name=>[name,(await readFile(path.join(dataDir,name))).toString('hex')])));
  const before=await snapshot();assert(Object.keys(before).includes('journal.sqlite'));
  // Windows os.homedir() reads USERPROFILE; isolate launcher discovery as well as its journal.
  const env={PATH:process.env.PATH||'',HOME:directory,USERPROFILE:directory,LOCALAPPDATA:directory,COMPANION_DATA_DIR:dataDir,COTW_SAVE_DIR:'',COMPANION_PORT:String(app.server.address().port),...(process.env.SYSTEMROOT?{SYSTEMROOT:process.env.SYSTEMROOT}:{})};
  for(let i=0;i<2;i++){
    const result=await run(process.execPath,[path.join(root,'launcher.mjs')],{env,timeout:10000});
    assert.match(result.stdout,/GrindZone build [a-f0-9]{12} is already running/);assert.equal(result.stderr,'');
  }
  assert.deepEqual(await snapshot(),before,'Repeated startup must not change the live journal');
});
test('startup rejects a changed package before creating or opening a journal',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gz-runtime-mismatch-')),dataDir=path.join(directory,'must-not-exist');
  t.after(()=>rm(directory,{recursive:true,force:true}));const previous=process.env.GRINDZONE_EXPECTED_FINGERPRINT;
  try{
    process.env.GRINDZONE_EXPECTED_FINGERPRINT='0'.repeat(64);
    await assert.rejects(createApp({dataDir,port:0,phoneRelayUrl:null}),/package changed during startup/);
    assert(!existsSync(dataDir));
  }finally{if(previous===undefined)delete process.env.GRINDZONE_EXPECTED_FINGERPRINT;else process.env.GRINDZONE_EXPECTED_FINGERPRINT=previous;}
});
