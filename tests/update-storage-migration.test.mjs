import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as E from '../updates/engine.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const oldContract='dc432ed6c7310c3c4838c3cc1bc75ca39a94360415a7a5a7c1b7923262ea78e1';
const newContract='36fa80548ed26eda06101b2db3c271a00547d1d14f5b94e18108ad4a86209e33';
// Keep the installed Store preimage in the source tree: release builds use shallow clones.
const oldStore=Buffer.from(fs.readFileSync(new URL('./fixtures/ea4214c-store.b64',import.meta.url),'utf8').trim(),'base64');
const newStore=Buffer.from(fs.readFileSync(path.join(root,'lib/store.mjs'),'utf8').replace(/\r\n/g,'\n'));
assert.equal(E.digest(oldStore),oldContract,'audited installed Store bytes changed');
assert.equal(E.digest(newStore),newContract,'migration target Store bytes changed');
const keys=generateKeyPairSync('ed25519');
const trust={keys:{test:keys.publicKey.export({format:'pem',type:'spki'})},updateUrl:'https://updates.example.test/latest.json'};
const revision=n=>n.toString(16).padStart(40,'0');
const declaration={fromContract:oldContract,toContract:newContract};

function release(n,{store=n===1?oldStore:newStore,storageContract=E.digest(store),storageMigration=n===2?declaration:undefined}={}){
 const entries=new Map([
  ['package.json',Buffer.from('{"version":"0.4.1"}')],
  ['server.mjs',Buffer.from('// synthetic '+n)],
  ['launcher.mjs',Buffer.from('// synthetic launcher')],
  ['runtime/node.exe',Buffer.from('MZ synthetic executable; never run')],
  ['lib/store.mjs',store],
 ]);
 const bundle=E.encodeBundle(entries);
 const manifest={schema:'grindzone.update-manifest.v1',product:'GrindZone',channel:'stable',platform:'win32-x64',protocol:1,
  sequence:n,revision:revision(n),runtimeFingerprint:'a'.repeat(64),storageContract,journalEpoch:1,
  publishedAt:'2026-09-23T00:00:00Z',expiresAt:'2027-09-23T00:00:00Z',
  bundle:{name:`payload-${E.digest(bundle)}.gz`,bytes:bundle.length,sha256:E.digest(bundle)},
  files:[...entries].map(([file,bytes])=>({path:file,bytes:bytes.length,sha256:E.digest(bytes)}))};
 if(storageMigration)manifest.storageMigration=storageMigration;
 const payload=Buffer.from(E.canonical(manifest));
 const envelope={schema:'grindzone.signed-release.v1',keyId:'test',payload:payload.toString('base64'),signature:sign(null,payload,keys.privateKey).toString('base64')};
 return {entries,bundle,manifest,envelope};
}
function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'gz-storage-migration-'));
 const home=path.join(base,'install'),data=path.join(base,'data');
 fs.mkdirSync(home);fs.mkdirSync(data);
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const old=release(1),next=release(2);
 E.stageEntries(home,old.envelope,trust,old.entries);
 E.saveState(home,{...E.loadState(home),current:old.manifest.revision,highWater:old.manifest.sequence});
 return {base,home,data,old,next};
}
function fetcher(r){return async url=>new Response(url.endsWith('/latest.json')?JSON.stringify(r.envelope):r.bundle,{status:200});}

test('only the signed, directed, exact Store transition is accepted',()=>{
 const old=release(1).manifest,next=release(2).manifest;
 assert.equal(E.canActivateStorageContract(old,next),true);
 assert.equal(E.canActivateStorageContract(next,old),false);
 assert.equal(E.canActivateStorageContract(old,{...next,storageMigration:undefined}),false);
 assert.equal(E.canActivateStorageContract(old,{...next,storageMigration:{fromContract:'f'.repeat(64),toContract:newContract}}),false);
 assert.equal(E.canActivateStorageContract(old,{...next,storageContract:'f'.repeat(64)}),false);
 assert.equal(E.canActivateStorageContract(old,{...next,sequence:old.sequence}),false);
 assert.equal(E.canActivateStorageContract({...old,files:[]},next),false);
 assert.equal(E.canActivateStorageContract(old,{...next,files:[]}),false);
 assert.equal(E.canActivateStorageContract({...old,journalEpoch:2},next),false);
 assert.equal(E.canActivateStorageContract(next,next),true);
 assert.throws(()=>E.validateManifest({...next,storageMigration:{fromContract:oldContract,toContract:'f'.repeat(64)}}),/storage migration/);
});

test('signed migration stages and restores exact cold journal bytes before commitment',async t=>{
 const {home,data,old,next}=fixture(t);
 const original={
  'journal.sqlite':Buffer.from('synthetic journal with harvest and pairing'),
  'journal.sqlite-wal':Buffer.from('synthetic uncheckpointed activity'),
  'journal.sqlite-shm':Buffer.from('synthetic shared state'),
 };
 for(const [name,bytes] of Object.entries(original))fs.writeFileSync(path.join(data,name),bytes);
 fs.writeFileSync(path.join(data,'other-user-file.json'),'retained');
 assert.equal((await E.checkAndStage(home,trust,{fetcher:fetcher(next)})).status,'staged');
 assert.equal(E.loadState(home).current,old.manifest.revision);
 const pending=E.beginActivation(home,data,trust);
 assert.equal(pending.phase,'prepared');
 for(const [name,bytes] of Object.entries(original))assert.deepEqual(fs.readFileSync(path.join(home,'backups',pending.backup,name)),bytes);
 fs.writeFileSync(path.join(data,'journal.sqlite'),'candidate wrote before startup completed');
 fs.rmSync(path.join(data,'journal.sqlite-wal'));
 assert.equal(E.recoverActivation(home,data),true);
 for(const [name,bytes] of Object.entries(original))assert.deepEqual(fs.readFileSync(path.join(data,name)),bytes);
 assert.equal(fs.readFileSync(path.join(data,'other-user-file.json'),'utf8'),'retained');
 const state=E.loadState(home);
 assert.equal(state.current,old.manifest.revision);
 assert.equal(state.staged,null);
 assert.deepEqual(state.rejected,[next.manifest.revision]);
 assert.equal((await E.checkAndStage(home,trust,{fetcher:fetcher(next)})).status,'unavailable');
});

test('after migration commitment journal writes remain and old-code fallback fails closed',async t=>{
 const {home,data,old,next}=fixture(t);
 fs.writeFileSync(path.join(data,'journal.sqlite'),'before update');
 assert.equal((await E.checkAndStage(home,trust,{fetcher:fetcher(next)})).status,'staged');
 const pending=E.beginActivation(home,data,trust);
 assert.equal(pending.phase,'prepared');
 E.commitActivation(home);
 fs.writeFileSync(path.join(data,'journal.sqlite'),'new player report');
 assert.equal(E.recoverActivation(home,data),false);
 assert.throws(()=>E.fallbackCode(home,trust),/not journal-compatible/);
 assert.equal(E.loadState(home).current,next.manifest.revision);
 assert.equal(E.loadState(home).previous,old.manifest.revision);
 assert.equal(fs.readFileSync(path.join(data,'journal.sqlite'),'utf8'),'new player report');
});

test('signed release without the migration declaration cannot stage',async t=>{
 const {home,old}=fixture(t);
 const next=release(2,{storageMigration:null});
 assert.equal((await E.checkAndStage(home,trust,{fetcher:fetcher(next)})).status,'unavailable');
 assert.equal(E.loadState(home).staged,null);
 assert.equal(E.loadState(home).current,old.manifest.revision);
});
