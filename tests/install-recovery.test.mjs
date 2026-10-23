/** Windows setup recovery with signed disposable releases and a real SQLite journal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildPortable} from '../tools/build-portable.mjs';
import {signPackage} from '../tools/build-managed-download.mjs';
import {install,runInstaller} from '../updates/install.mjs';
import {boot} from '../updates/boot.mjs';
import {acquireLock,digest,loadState,readRelease,verifyDirectory} from '../updates/engine.mjs';
import {supervise} from '../updates/supervisor.mjs';
import {Store} from '../lib/store.mjs';

const source=fileURLToPath(new URL('../',import.meta.url)),revision=n=>n.toString(16).padStart(40,'0');
const offline=async()=>{throw Error('Synthetic offline update feed');};
async function freePort(){const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;}

test('signed setup recovers from the Windows read-only fsync defect and retains journal, pairing and rollback safety',{skip:process.platform!=='win32',timeout:120000},async t=>{
 const root=fs.mkdtempSync(path.join(tmpdir(),'gz-setup-recovery-')),home=path.join(root,'installed'),dataDir=path.join(root,'journal'),saveDir=path.join(root,'save');
 fs.mkdirSync(dataDir);fs.mkdirSync(saveDir);fs.writeFileSync(path.join(saveDir,'sentinel'),'Synthetic save sentinel');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const context={dataDir,saveDir,port:await freePort()},key=generateKeyPairSync('ed25519');
 const trust={keys:{fixture:key.publicKey.export({format:'pem',type:'spki'})},updateUrl:'https://fixture.invalid/latest.json'};
 const privateKey=key.privateKey.export({format:'pem',type:'pkcs8'});
 const make=(n,{oldFsync=false,crash=false}={})=>{
  const directory=path.join(root,'signed-'+n);buildPortable(source,directory);fs.mkdirSync(path.join(directory,'runtime'));
  fs.copyFileSync(process.execPath,path.join(directory,'runtime/node.exe'));
  fs.writeFileSync(path.join(directory,'runtime/LICENSE'),'Synthetic runtime fixture');
  fs.writeFileSync(path.join(directory,'updates/trust.json'),JSON.stringify(trust));
  fs.appendFileSync(path.join(directory,'public/app.js'),'\n// Signed synthetic release '+n+'\n');
  if(oldFsync){
   const file=path.join(directory,'updates/engine.mjs'),before=fs.readFileSync(file,'utf8');
   const after=before.replace("fs.openSync(path.join(dir,n),'r+')","fs.openSync(path.join(dir,n),'r')");
   assert.notEqual(after,before);fs.writeFileSync(file,after);
  }
  if(crash){
   const file=path.join(directory,'server.mjs'),before=fs.readFileSync(file,'utf8');
   const after=before.replace('managedGate?.ready(app,runtime,()=>phone.start());',"store.set('failed_candidate_mutation',true);process.exit(23);managedGate?.ready(app,runtime,()=>phone.start());");
   assert.notEqual(after,before);fs.writeFileSync(file,after);
  }
  signPackage({directory,revision:revision(n),sequence:n,trust,privateKey,publishedAt:new Date().toISOString()});
  return directory;
 };
 const old=make(1,{oldFsync:true}),fixed=make(2),bad=make(3,{crash:true});
 const store=new Store(path.join(dataDir,'journal.sqlite'));
 store.put('synthetic-player','sessions',{id:'grind-1',name:'Retained grind',version:1});
 store.set('phone:connection:synthetic-player',{enabled:true,deviceToken:'synthetic-private-pairing'});
 store.close();
 const retained=()=>{const db=new Store(path.join(dataDir,'journal.sqlite'));try{
  assert.equal(db.journal('synthetic-player','sessions')[0].name,'Retained grind');
  assert.equal(db.get('phone:connection:synthetic-player').deviceToken,'synthetic-private-pairing');
  assert.equal(db.get('failed_candidate_mutation',false),false);
 }finally{db.close();}assert.equal(fs.readFileSync(path.join(saveDir,'sentinel'),'utf8'),'Synthetic save sentinel');};
 install({source:old,home,context,trust});
 const oldRelease=readRelease(home,revision(1),trust),oldManifest=digest(fs.readFileSync(path.join(oldRelease.dir,'SIGNED-RELEASE.json')));
 const oldEngine=await import(pathToFileURL(path.join(oldRelease.dir,'updates/engine.mjs')).href);
 assert.throws(()=>oldEngine.snapshotJournal(home,dataDir),error=>error.code==='EPERM');
 assert.deepEqual(fs.readdirSync(path.join(home,'backups')),[]);
 const started=await runInstaller({source:fixed,home,open:true,context,desktop:false,launchBrowser:false,fetcher:offline,onStarted:async runtime=>{
  assert.equal(loadState(home).current,revision(2));
  const response=await fetch('http://127.0.0.1:'+context.port+'/api/bootstrap');assert.equal(response.status,200);
  await runtime.stop();
 }});
 assert.equal(started.updateStaged,true);assert.equal(started.startup.code,0);
 let state=loadState(home);assert.equal(state.current,revision(2));assert.equal(state.previous,revision(1));assert.equal(state.staged,null);assert.equal(state.pending,null);
 assert.equal(digest(fs.readFileSync(path.join(oldRelease.dir,'SIGNED-RELEASE.json'))),oldManifest);verifyDirectory(oldRelease.dir,oldRelease.manifest);
 const backupDirs=fs.readdirSync(path.join(home,'backups'));assert.equal(backupDirs.length,1);
 const backup=JSON.parse(fs.readFileSync(path.join(home,'backups',backupDirs[0],'backup.json'),'utf8'));
 assert.equal(backup.schema,'grindzone.cold-backup.v1');assert(backup.files.some(file=>file.name==='journal.sqlite'));
 for(const file of backup.files)assert.equal(digest(fs.readFileSync(path.join(home,'backups',backupDirs[0],file.name))),file.sha256);
 retained();
 const normal=await boot(home,{launchBrowser:false,fetcher:offline,onStarted:async runtime=>{
  assert.equal(loadState(home).current,revision(2));await runtime.stop();
 }});
 assert.equal(normal.code,0);retained();
 install({source:bad,home,context,trust});
 const unlock=acquireLock(home);
 try{await assert.rejects(supervise({home,trust,context,launchBrowser:false,fetcher:offline,expectedStaged:{revision:revision(3),sequence:3}}),/Close it and rerun this signed setup/);}finally{unlock();}
 await assert.rejects(runInstaller({source:bad,home,open:true,context,desktop:false,launchBrowser:false,fetcher:offline,onStarted:async runtime=>{
  const current=loadState(home);assert.equal(current.current,revision(2));assert(current.rejected.includes(revision(3)));await runtime.stop();
 }}),/verified update did not activate/);
 state=loadState(home);assert.equal(state.current,revision(2));assert(state.rejected.includes(revision(3)));assert.equal(state.pending,null);retained();
});
