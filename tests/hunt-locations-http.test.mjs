/** Actual PC HTTP handler and binary save reader; disposable fixtures, never owner files. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {writeSaveDataFixture,saveHashes} from './save-data-workflow-fixture.mjs';
async function setup(t){const root=mkdtempSync(path.join(tmpdir(),'grindzone-location-http-')),save=path.join(root,'save');mkdirSync(save);const hashes=writeSaveDataFixture(save);let app;
 t.after(async()=>{await app?.close();rmSync(root,{recursive:true,force:true});});app=await createApp({dataDir:path.join(root,'journal'),saveDir:save,port:0,interval:60000,phoneRelayUrl:null,phoneEnrollmentToken:null,feedbackUrl:null,feedbackOwnerToken:null,githubFeedbackUrl:null});return {app,save,hashes};}
test('the PC serves location history and its assets without broadening filesystem access',async t=>{
 const {app,save,hashes}=await setup(t);
 const old=app.observer.command({op:'encounter.create',reserve:19,species:'Old',x:11100,z:8000});
 const empty=await (await fetch(app.url+'/api/locations?kind=shot')).json();assert.equal(empty.summary.total,0);assert.equal(empty.query.session,'active');
 await new Promise(resolve=>setTimeout(resolve,5));
 app.observer.command({op:'session.start',reserve:19,name:'Current grind'});
 const note=app.observer.command({op:'encounter.create',reserve:19,species:'Whitetail Deer',x:12300,z:8000});
 const response=await fetch(app.url+'/api/locations?kind=shot'),page=await response.json();assert.equal(response.status,200);assert.equal(page.events[0].encounterId,note.id);assert.equal(page.events[0].location.x,12300);assert.equal(page.events.some(event=>event.encounterId===old.id),false);
 for(const asset of ['hunt-locations.js','hunt-locations.css'])assert.equal((await fetch(app.url+'/'+asset)).status,200);
 for(const file of ['lib/hunt-locations.mjs','tests/hunt-locations-http.test.mjs'])assert.equal((await fetch(app.url+'/'+file)).status,404);
 assert.deepEqual(saveHashes(save),hashes);
});
test('location HTTP reads reject cross-origin, duplicate filters and caller-supplied profile identities',async t=>{
 const {app}=await setup(t);assert.equal((await fetch(app.url+'/api/locations',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
 for(const query of ['profile=other','path=../private','reserve=1&reserve=19','__proto__=x','limit=99999'])assert.equal((await fetch(app.url+'/api/locations?'+query)).status,400,query);
 assert.equal((await fetch(app.url+'/api/locations',{method:'POST'})).status,404);
});
