/** Signed setup repair and actual CLI dispatch. No player journal or installed owner app is used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {buildPortable} from '../tools/build-portable.mjs';
import {signPackage} from '../tools/build-managed-download.mjs';
import {install} from '../updates/install.mjs';
import {loadState} from '../updates/engine.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url)),rev=n=>n.toString(16).padStart(40,'0');
function fixture(t){
 const root=fs.mkdtempSync(path.join(tmpdir(),'gz-setup-repair-')),home=path.join(root,'installed'),dataDir=path.join(root,'journal');fs.mkdirSync(dataDir);fs.writeFileSync(path.join(dataDir,'journal.sqlite'),'Synthetic retained journal and pairing');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const key=generateKeyPairSync('ed25519'),trust={keys:{fixture:key.publicKey.export({format:'pem',type:'spki'})},updateUrl:'https://fixture.invalid/latest.json'},context={dataDir,saveDir:null,port:47831};
 const seed=n=>{const directory=path.join(root,'seed-'+n);buildPortable(sourceRoot,directory);fs.mkdirSync(path.join(directory,'runtime'));fs.writeFileSync(path.join(directory,'runtime/node.exe'),'MZ synthetic: never executed');fs.writeFileSync(path.join(directory,'runtime/LICENSE'),'Synthetic fixture');fs.writeFileSync(path.join(directory,'updates/trust.json'),JSON.stringify(trust));fs.appendFileSync(path.join(directory,'public/app.js'),'\n// Fixture '+n+'\n');signPackage({directory,revision:rev(n),sequence:n,trust,privateKey:key.privateKey.export({format:'pem',type:'pkcs8'}),publishedAt:new Date().toISOString()});return directory;};
 const retained=()=>assert.equal(fs.readFileSync(path.join(dataDir,'journal.sqlite'),'utf8'),'Synthetic retained journal and pairing');return {root,home,trust,context,seed,retained};
}
test('rerunning the same signed setup repairs damaged bootstrap files and keeps a backup',t=>{
 const f=fixture(t),source=f.seed(1);install({...f,source});fs.writeFileSync(path.join(f.home,'kernel/boot.mjs'),'damaged old bootstrap');fs.writeFileSync(path.join(f.home,'START.cmd'),'bad launcher');fs.rmSync(path.join(f.home,'runtime/node.exe'));fs.rmSync(path.join(f.home,'kernel/entry.mjs'));
 const result=install({...f,source});assert.equal(result.installed,false);assert(result.repaired.includes('kernel/boot.mjs'));assert(result.repaired.includes('kernel/entry.mjs'));assert(result.repaired.includes('runtime/node.exe'));assert(fs.readFileSync(path.join(f.home,'kernel/boot.mjs')).equals(fs.readFileSync(path.join(source,'updates/boot.mjs'))));assert(fs.readdirSync(path.join(f.home,'bootstrap-backups')).length>=1);assert.equal(loadState(f.home).current,rev(1));f.retained();
});
test('newer signed setup repairs bootstrap and stages a release rather than silently reopening old code',t=>{
 const f=fixture(t),a=f.seed(1),b=f.seed(2);install({...f,source:a});const result=install({...f,source:b});assert.equal(result.updateStaged,true);const s=loadState(f.home);assert.equal(s.current,rev(1));assert.equal(s.staged,rev(2));assert.equal(s.highWater,2);assert.equal(s.pending,null);f.retained();
});
test('older setup cannot downgrade a repaired installation or its verified update',t=>{
 const f=fixture(t),a=f.seed(1),b=f.seed(2);install({...f,source:b});const before=fs.readFileSync(path.join(f.home,'kernel/boot.mjs'));assert.throws(()=>install({...f,source:a}),/older/);assert(fs.readFileSync(path.join(f.home,'kernel/boot.mjs')).equals(before));assert.equal(loadState(f.home).current,rev(2));f.retained();
});
test('unsigned or modified setup code is rejected before repairing bootstrap',t=>{
 const f=fixture(t),source=f.seed(1);install({...f,source});fs.writeFileSync(path.join(source,'updates/boot.mjs'),'tampered');const before=fs.readFileSync(path.join(f.home,'kernel/boot.mjs'));assert.throws(()=>install({...f,source}),/integrity/);assert(fs.readFileSync(path.join(f.home,'kernel/boot.mjs')).equals(before));f.retained();
});
test('installed and setup batch files preserve visible failures and standard Windows line endings',t=>{
 const f=fixture(t),source=f.seed(1);install({...f,source});for(const name of [path.join(sourceRoot,'INSTALL.cmd'),path.join(f.home,'START.cmd')]){const s=fs.readFileSync(name,'utf8');assert(!/(?<!\r)\n/.test(s));assert.match(s,/echo .*starting|echo Starting/i);assert.match(s,/pause/);assert.match(s,/exit \/b 1/);}const code=fs.readFileSync(path.join(sourceRoot,'updates/install.mjs'),'utf8');assert.doesNotMatch(code,/detached\s*:\s*true|stdio\s*:\s*['"]ignore/);f.retained();
});
test('actual installer CLI through a directory alias never reports silent success',t=>{
 const f=fixture(t),alias=path.join(f.root,'source-alias');fs.symlinkSync(sourceRoot,alias,'junction');const run=spawnSync(process.execPath,[path.join(alias,'updates/install.mjs')],{env:{PATH:process.env.PATH||'',HOME:f.root,USERPROFILE:f.root,LOCALAPPDATA:f.root,...(process.env.SYSTEMROOT?{SYSTEMROOT:process.env.SYSTEMROOT}:{})},encoding:'utf8',timeout:15000});assert.notEqual(run.status,0);assert.match(run.stdout,/GrindZone setup:/);assert.match(run.stderr,/GrindZone setup failed:/);f.retained();
});
test('actual server CLI through an alias starts the app instead of skipping its entry point',{timeout:20000},async t=>{
 const root=fs.mkdtempSync(path.join(tmpdir(),'gz-server-entry-')),alias=path.join(root,'source-alias'),data=path.join(root,'journal');fs.symlinkSync(sourceRoot,alias,'junction');
 const child=spawn(process.execPath,[path.join(alias,'server.mjs')],{env:{PATH:process.env.PATH||'',HOME:root,LOCALAPPDATA:root,COMPANION_DATA_DIR:data,COTW_SAVE_DIR:'',COMPANION_PORT:'0',COMPANION_PHONE_RELAY_URL:'',...(process.env.SYSTEMROOT?{SYSTEMROOT:process.env.SYSTEMROOT}:{})},stdio:['ignore','pipe','pipe']});
 let text='',errors='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stderr.on('data',s=>{errors+=s;});const ended=new Promise(resolve=>child.once('close',resolve));
 t.after(async()=>{if(child.exitCode===null)child.kill('SIGTERM');await ended;fs.rmSync(root,{recursive:true,force:true});});
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CLI did not start: '+errors)),10000);child.stdout.on('data',s=>{text+=s;const m=text.match(/listening at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.once('error',e=>{clearTimeout(timer);reject(e);});ended.then(code=>{clearTimeout(timer);reject(Error('CLI exited '+code+': '+errors));});});
 const response=await fetch(url+'/api/bootstrap');assert.equal(response.status,200);assert.match((await response.json()).runtime.fingerprint,/^[a-f0-9]{64}$/);child.kill('SIGTERM');await ended;
});
