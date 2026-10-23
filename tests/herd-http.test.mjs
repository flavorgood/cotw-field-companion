/** Actual local API/asset boundary; synthetic saves, no owner files. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {writeSaveDataFixture,saveHashes} from './save-data-workflow-fixture.mjs';
async function setup(t){
 const root=mkdtempSync(path.join(tmpdir(),'grindzone-herd-http-')),save=path.join(root,'save');mkdirSync(save);const hashes=writeSaveDataFixture(save);let app;
 t.after(async()=>{await app?.close();rmSync(root,{recursive:true,force:true});});
 app=await createApp({dataDir:path.join(root,'journal'),saveDir:save,port:0,interval:60000,phoneRelayUrl:null,phoneEnrollmentToken:null,feedbackUrl:null,feedbackOwnerToken:null,githubFeedbackUrl:null});
 return {app,save,hashes};
}
test('herd API serves read-only IDs/zone links and gates population by spoiler consent',async t=>{
 const {app,save,hashes}=await setup(t);let response=await fetch(app.url+'/api/herds?reserve=19');assert.equal(response.status,200);assert.equal((await response.json()).status,'spoilers_off');
 app.observer.command({op:'settings',spoilers:true,confirmSpoilers:true});
 response=await fetch(app.url+'/api/herds?reserve=19');assert.equal(response.status,200);const value=await response.json();
 assert.equal(value.summary.herds,1);assert.match(value.herds[0].label,/^H-\d{6}$/);assert.equal(value.herds[0].zones.length,3);
 assert.doesNotMatch(JSON.stringify(value),/nativeId|"members"|"epoch"/);
 for(const [file,type]of [['herd-view.js','javascript'],['herd-view.css','css']]){const r=await fetch(app.url+'/'+file);assert.equal(r.status,200);assert(r.headers.get('content-type').includes(type));}
 for(const file of ['lib/herd-ledger.mjs','tests/herd-http.test.mjs','lib/herd-reference.json'])assert.equal((await fetch(app.url+'/'+file)).status,404);
 assert.deepEqual(saveHashes(save),hashes);
});
test('herd API cannot select another profile/path or accept mutations',async t=>{
 const {app}=await setup(t);
 for(const query of ['profile=other','path=../private','reserve=19&reserve=1','limit=100000','trophy=kill'])assert.equal((await fetch(app.url+'/api/herds?'+query)).status,400,query);
 assert.equal((await fetch(app.url+'/api/herds',{method:'POST'})).status,404);
 assert.equal((await fetch(app.url+'/api/herds',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
});
