/** A signed setup upgrades the old Store contract without touching an owner journal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildPortable} from '../tools/build-portable.mjs';
import {signPackage} from '../tools/build-managed-download.mjs';
import {install,runInstaller} from '../updates/install.mjs';
import {digest,fallbackCode,loadState,readRelease} from '../updates/engine.mjs';
import {Store} from '../lib/store.mjs';

const source=fileURLToPath(new URL('../',import.meta.url));
const oldContract='dc432ed6c7310c3c4838c3cc1bc75ca39a94360415a7a5a7c1b7923262ea78e1';
const newContract='36fa80548ed26eda06101b2db3c271a00547d1d14f5b94e18108ad4a86209e33';
const revision=n=>n.toString(16).padStart(40,'0');
const offline=async()=>{throw Error('Synthetic offline update feed');};
async function freePort(){const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port;}

test('verified setup activates the directed Store upgrade and keeps synthetic journal and pairing',{
 skip:process.platform!=='win32',timeout:120000
},async t=>{
 const root=fs.mkdtempSync(path.join(tmpdir(),'gz-directed-setup-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=path.join(root,'installed'),dataDir=path.join(root,'journal'),saveDir=path.join(root,'save');
 fs.mkdirSync(dataDir);fs.mkdirSync(saveDir);fs.writeFileSync(path.join(saveDir,'sentinel'),'synthetic game save');
 const context={dataDir,saveDir,port:await freePort()},pair=generateKeyPairSync('ed25519');
 const trust={keys:{fixture:pair.publicKey.export({format:'pem',type:'spki'})},updateUrl:'https://fixture.invalid/latest.json'};
 const privateKey=pair.privateKey.export({format:'pem',type:'pkcs8'});
 const oldStore=Buffer.from(fs.readFileSync(new URL('./fixtures/ea4214c-store.b64',import.meta.url),'utf8').trim(),'base64');
 const newStore=Buffer.from(fs.readFileSync(path.join(source,'lib/store.mjs'),'utf8').replace(/\r\n/g,'\n'));
 assert.equal(digest(oldStore),oldContract);assert.equal(digest(newStore),newContract);
 const signed=(n,store)=>{
  const directory=path.join(root,'signed-'+n);buildPortable(source,directory);
  fs.mkdirSync(path.join(directory,'runtime'));
  fs.copyFileSync(process.execPath,path.join(directory,'runtime/node.exe'));
  fs.writeFileSync(path.join(directory,'runtime/LICENSE'),'Synthetic runtime fixture');
  fs.writeFileSync(path.join(directory,'updates/trust.json'),JSON.stringify(trust));
  fs.writeFileSync(path.join(directory,'lib/store.mjs'),store);
  const {manifest}=signPackage({directory,revision:revision(n),sequence:n,trust,privateKey,publishedAt:new Date().toISOString()});
  return {directory,manifest};
 };
 const old=signed(1,oldStore),next=signed(2,newStore);
 assert.equal(old.manifest.storageContract,oldContract);
 assert.equal(next.manifest.storageContract,newContract);
 assert.deepEqual(next.manifest.storageMigration,{fromContract:oldContract,toContract:newContract});
 const db=new Store(path.join(dataDir,'journal.sqlite'));
 db.put('synthetic-player','sessions',{id:'retained-grind',name:'Retained grind',version:1});
 db.set('phone:connection:synthetic-player',{enabled:true,deviceToken:'synthetic-private-pairing'});
 db.close();
 install({source:old.directory,home,context,trust});
 const started=await runInstaller({source:next.directory,home,open:true,context,desktop:false,launchDesktop:false,launchBrowser:false,fetcher:offline,onStarted:async runtime=>{
  assert.equal(loadState(home).current,revision(2));
  const response=await fetch('http://127.0.0.1:'+context.port+'/api/bootstrap');assert.equal(response.status,200);
  await runtime.stop();
 }});
 assert.equal(started.updateStaged,true);assert.equal(started.startup.code,0);
 const state=loadState(home);assert.equal(state.current,revision(2));assert.equal(state.previous,revision(1));assert.equal(state.pending,null);
 assert.equal(readRelease(home,state.current,trust).manifest.storageContract,newContract);
 const preserved=new Store(path.join(dataDir,'journal.sqlite'));
 try{assert.equal(preserved.journal('synthetic-player','sessions')[0].name,'Retained grind');assert.equal(preserved.get('phone:connection:synthetic-player').deviceToken,'synthetic-private-pairing');}
 finally{preserved.close();}
 assert.equal(fs.readFileSync(path.join(saveDir,'sentinel'),'utf8'),'synthetic game save');
 assert.throws(()=>fallbackCode(home,trust),/not journal-compatible/);
 assert.equal(loadState(home).current,revision(2));
});
