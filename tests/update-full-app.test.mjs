/** Full-checkout acceptance with the actual decoder/server/SQLite. All player records are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import {buildPortable} from '../tools/build-portable.mjs';
import {signPackage} from '../tools/build-managed-download.mjs';
import {install} from '../updates/install.mjs';
import {supervise,spawnApp} from '../updates/supervisor.mjs';
import {Store} from '../lib/store.mjs';
import {loadState,checkAndStage} from '../updates/engine.mjs';
const source=fileURLToPath(new URL('../',import.meta.url)),rev=n=>n.toString(16).padStart(40,'0');
test('managed install, staged upgrade and failed-startup rollback preserve real SQLite records and private pairing',async t=>{
 const root=fs.mkdtempSync(path.join(tmpdir(),'gz-full-managed-')),home=path.join(root,'installed'),dataDir=path.join(root,'journal'),saveDir=path.join(root,'synthetic-save');fs.mkdirSync(dataDir);fs.mkdirSync(saveDir);fs.writeFileSync(path.join(saveDir,'sentinel'),'Synthetic game-save sentinel');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const context={dataDir,saveDir,port};
 const key=generateKeyPairSync('ed25519'),trust={keys:{fixture:key.publicKey.export({format:'pem',type:'spki'})},updateUrl:'https://fixture.invalid/latest.json'};
 const make=(n,crash=false)=>{const directory=path.join(root,'seed-'+n);buildPortable(source,directory);fs.mkdirSync(path.join(directory,'runtime'));
  if(process.platform==='win32')fs.copyFileSync(process.execPath,path.join(directory,'runtime/node.exe'));else fs.writeFileSync(path.join(directory,'runtime/node.exe'),'MZ fixture: Linux uses the test process runtime');
  fs.writeFileSync(path.join(directory,'runtime/LICENSE'),'Synthetic runtime fixture');fs.writeFileSync(path.join(directory,'updates/trust.json'),JSON.stringify(trust));
  fs.appendFileSync(path.join(directory,'public/app.js'),'\n// Signed synthetic release '+n+'\n');
  if(crash){const p=path.join(directory,'server.mjs');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('managedGate?.ready(app,runtime,()=>phone.start());',"store.set('failed_candidate_mutation',true);process.exit(23);managedGate?.ready(app,runtime,()=>phone.start());"));}
  return {...signPackage({directory,revision:rev(n),sequence:n,trust,privateKey:key.privateKey.export({format:'pem',type:'pkcs8'}),publishedAt:new Date().toISOString()}),directory};};
 const a=make(1),b=make(2),bad=make(3,true);let available=b;
 const store=new Store(path.join(dataDir,'journal.sqlite'));store.put('synthetic-player','sessions',{id:'grind-1',name:'Retain my hunt',version:1});store.put('synthetic-player','encounters',{id:'shot-1',notes:'Retain this report'});store.set('phone:connection:synthetic-player',{enabled:true,deviceToken:'private-synthetic-pairing'});store.close();
 const assertRetained=()=>{const db=new Store(path.join(dataDir,'journal.sqlite'));try{assert.equal(db.journal('synthetic-player','sessions')[0].name,'Retain my hunt');assert.equal(db.journal('synthetic-player','encounters')[0].notes,'Retain this report');assert.equal(db.get('phone:connection:synthetic-player').deviceToken,'private-synthetic-pairing');assert.equal(db.get('failed_candidate_mutation',false),false);}finally{db.close();}assert.equal(fs.readFileSync(path.join(saveDir,'sentinel'),'utf8'),'Synthetic game-save sentinel');};
 install({source:a.directory,home,context,trust});assertRetained();
 const fetcher=async url=>new Response(url.endsWith('latest.json')?JSON.stringify(available.envelope):available.bundle);
 let probationChecks=0;
 const spawnRuntime=options=>{const run=spawnApp({...options,executable:process.platform==='win32'?options.executable:process.execPath}),original=run.ready;run.ready=original.then(async()=>{const url='http://127.0.0.1:'+port,b=await fetch(url+'/api/bootstrap').then(r=>r.json());assert.equal((await fetch(url+'/api/state')).status,503);assert.equal((await fetch(url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':b.token},body:'{}'})).status,503);probationChecks++;});return run;};
 const common={home,trust,context,fetcher,spawnRuntime,launchBrowser:false,log:()=>{}};
 const local='http://127.0.0.1:'+port;
 await supervise({...common,onStarted:async runtime=>{const boot=await fetch(local+'/api/bootstrap').then(r=>r.json());assert.equal((await fetch(local+'/api/updates/check',{method:'POST'})).status,403);const status=await fetch(local+'/api/updates/check',{method:'POST',headers:{'X-Companion-Token':boot.token}}).then(r=>r.json());assert.equal(status.current,rev(1));assert.equal(status.staged,rev(2));assert.equal((await fetch(local+'/api/updates/status',{headers:{Origin:'https://unrelated.invalid'}})).status,403);assert.match(await fetch(local+'/').then(r=>r.text()),/updates-ui\.js/);await runtime.stop();}});assertRetained();
 await supervise({...common,onStarted:async runtime=>{assert.equal(loadState(home).current,rev(2));assert.equal(loadState(home).pending,null);assert.equal((await fetch(local+'/api/updates/status').then(r=>r.json())).managed,true);await runtime.stop();}});assertRetained();
 available=bad;await checkAndStage(home,trust,{fetcher});await supervise({...common,onStarted:async runtime=>{assert.equal(loadState(home).current,rev(2));assert(loadState(home).rejected.includes(rev(3)));await runtime.stop();}});assertRetained();assert.equal(probationChecks,3);
});
