/** Complete reader/SQLite/HTTP integration using synthetic binary saves, not owner-device acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,unlinkSync,writeFileSync,utimesSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createApp} from '../server.mjs';
import {writeSaveDataFixture,writeProfile,saveHashes,SAVE_TIME} from './save-data-workflow-fixture.mjs';
const worker=fileURLToPath(new URL('./save-data-restart-worker.mjs',import.meta.url));
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','HOME','USERPROFILE','SYSTEMROOT','TMP','TEMP','TMPDIR','LANG','LC_ALL'].includes(key)));
function setup(t,{deferCleanup=false}={}){
  const root=mkdtempSync(path.join(tmpdir(),'grindzone-save-data-integration-')),save=path.join(root,'save');mkdirSync(save);
  const hashes=writeSaveDataFixture(save);if(!deferCleanup)t.after(()=>rmSync(root,{recursive:true,force:true}));
  const read=()=>JSON.parse(execFileSync(process.execPath,[worker,save,path.join(root,'history.sqlite')],{encoding:'utf8',env:cleanEnv,timeout:30000,stdio:['ignore','pipe','pipe']}));
  return {root,save,hashes,read};
}
test('actual binary decoder, observer and phone projection expose the saved-game data without changing saves',t=>{
  const {save,hashes,read}=setup(t),result=read(),data=result.saveData;
  assert.equal(data.profile.level,42);assert.equal(data.profile.cash,18750);assert.equal(data.profile.status,'available');
  assert.equal(data.player.unharvested,2);assert.equal(data.player.harvestStreak,9);
  assert.equal(data.equipment.total,2);assert.equal(data.equipment.attention,1);assert.equal(data.equipment.byReserve.length,2);
  assert.equal(data.herds.species.length,1);assert.equal(data.herds.species[0].animals,2);
  assert.equal(data.herds.species[0].males,1);assert.equal(data.herds.species[0].females,1);
  assert.match(data.coverage.find(row=>row.key==='health').detail,/1 records/);
  assert.equal(result.history.events.length,0);assert.deepEqual(saveHashes(save),hashes);
});
test('progression survives independent process restarts and unchanged rereads do not duplicate changes',t=>{
  const {save,read}=setup(t);read();writeProfile(save,{cash:18950,savedAt:'2026-09-20T10:01:00.000Z'});
  const expected=saveHashes(save),changed=read();assert.equal(changed.history.events.length,1);
  assert.deepEqual(changed.history.events[0].changes,[{key:'cash',before:18750,after:18950,delta:200}]);
  const reopened=read();assert.deepEqual(reopened.history,changed.history);assert.equal(reopened.saveData.profile.cash,18950);
  assert.deepEqual(saveHashes(save),expected);
});
test('unreadable and missing profile saves retain history as stale rather than resetting it',t=>{
  const {save,read}=setup(t),initial=read(),file=path.join(save,'thp_player_profile_adf');
  writeFileSync(file,Buffer.from('not a supported save'));let current=read();
  assert.equal(current.saveData.profile.status,'stale');assert.equal(current.saveData.profile.cash,18750);assert.deepEqual(current.history,initial.history);
  unlinkSync(file);current=read();assert.equal(current.saveData.profile.status,'stale');assert.deepEqual(current.history,initial.history);
  writeProfile(save,{cash:19000,savedAt:'2026-09-20T10:02:00.000Z'});current=read();
  assert.equal(current.saveData.profile.status,'available');assert.equal(current.history.events.length,1);assert.equal(current.history.events[0].changes[0].delta,250);
});
test('same binary content with an older file time records one restart-safe rollback boundary',t=>{
  const {save,read}=setup(t);read();const file=path.join(save,'thp_player_profile_adf'),bytes=readFileSync(file);
  utimesSync(file,new Date('2026-09-19T10:00:00Z'),new Date('2026-09-19T10:00:00Z'));
  const rolled=read();assert.equal(rolled.history.events.length,1);assert.equal(rolled.history.events[0].kind,'save_moved_backwards');
  assert.equal(rolled.history.events[0].previousSavedAt,SAVE_TIME);assert.deepEqual(rolled.history.events[0].changes,[]);
  assert.deepEqual(read().history,rolled.history);assert.deepEqual(readFileSync(file),bytes);
});
test('the real PC HTTP server serves the complete dashboard module graph and optional stylesheet',async t=>{
  const {root,save,hashes}=setup(t,{deferCleanup:true});let app;
  t.after(async()=>{await app?.close();rmSync(root,{recursive:true,force:true});});
  app=await createApp({dataDir:path.join(root,'app-journal'),saveDir:save,port:0,interval:60000,phoneRelayUrl:null,phoneEnrollmentToken:null,feedbackUrl:null,feedbackOwnerToken:null,githubFeedbackUrl:null});
  // Walking actual imports catches a missing module even when model/HTML-string unit tests pass.
  const queue=['/app.js'],seen=new Set();
  while(queue.length){
    const pathname=queue.shift();if(seen.has(pathname))continue;seen.add(pathname);
    const response=await fetch(app.url+pathname);assert.equal(response.status,200,'Missing PC module: '+pathname);
    assert.match(response.headers.get('content-type'),/javascript/);const source=await response.text();
    for(const match of source.matchAll(/\b(?:from\s*|import\s*\(\s*)['"](\.\.?\/[^'"?#]+\.js)['"]/g))queue.push(new URL(match[1],app.url+pathname).pathname);
  }
  assert(seen.has('/save-data.js'),'The actual dashboard must import the save-data renderer');
  assert(seen.has('/capture-source.js'),'The actual dashboard must import its capture source');
  for(const pathname of ['/save-data.css','/capture-source.css']){
    const css=await fetch(app.url+pathname);assert.equal(css.status,200,'Missing PC stylesheet: '+pathname);assert.match(css.headers.get('content-type'),/text\/css/);
  }
  const state=await (await fetch(app.url+'/api/state?reserve=19')).json();assert.equal(state.career.saveData.profile.level,42);
  assert.equal((await fetch(app.url+'/lib/save-data.mjs')).status,404,'No private library source should become an HTTP asset');
  assert.equal((await fetch(app.url+'/tests/save-data-workflow-fixture.mjs')).status,404);
  assert.deepEqual(saveHashes(save),hashes);
});
