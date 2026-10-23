/** Reader consistency across a running scan and rollback; disposable binary saves and real SQLite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {Observer} from '../lib/observer.mjs';
import {projectPhoneState} from '../lib/phone-bridge.mjs';
import {discoveryReference,readyDiscoveryReader} from './zone-discovery-fixture.mjs';
import {writeSaveDataFixture,writeProfile,saveHashes,SAVE_TIME} from './save-data-workflow-fixture.mjs';
const profileFile='thp_player_profile_adf';
const until=async check=>{for(let i=0;i<400;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Expected in-progress profile snapshot did not arrive');};
async function setup(t){
 const root=mkdtempSync(path.join(tmpdir(),'grindzone-profile-atomic-')),save=path.join(root,'save');mkdirSync(save);writeSaveDataFixture(save);
 const store=new Store(path.join(root,'journal.sqlite')),observer=new Observer(store,save,discoveryReference,{interval:60000,zoneReferenceReader:readyDiscoveryReader()});
 t.after(async()=>{observer.stop();while(observer.busy)await new Promise(resolve=>setTimeout(resolve,5));store.close();rmSync(root,{recursive:true,force:true});});
 // Direct scans avoid adding a watcher to the deliberately controlled timing cases.
 await observer.scan(true);return {save,store,observer,key:'save-data-progress:'+observer.profile};
}
test('phone profile and progression are consistent while later save files are still being read',async t=>{
 const {save,store,observer,key}=await setup(t);
 writeProfile(save,{cash:18950,savedAt:'2026-09-20T10:01:00.000Z'});const expected=saveHashes(save);
 const pending=observer.scan(true);
 try{
  await until(()=>observer.source(profileFile)?.payload?.cash===18950);
  assert.equal(observer.busy,true,'The assertion must exercise the mid-scan window, not only the settled result');
  const phone=projectPhoneState(observer.state(19)),history=store.get(key);
  assert.equal(phone.career.saveData.profile.cash,18950);
  assert.equal(phone.career.saveData.progression.events.length,1,'A newly visible profile must have its corresponding progression committed');
  assert.equal(history.values.cash,18950);
  assert.deepEqual(history.events[0].changes,[{key:'cash',before:18750,after:18950,delta:200}]);
 }finally{await pending;}
 assert.deepEqual(saveHashes(save),expected);
});
test('a failed progression write rolls back the profile snapshot and recovers exactly once',async t=>{
 const {save,store,observer,key}=await setup(t),baseline=store.get(key),previous=store.source(observer.profile,profileFile);
 writeProfile(save,{cash:18950,savedAt:'2026-09-20T10:01:00.000Z'});const expected=saveHashes(save),set=store.set;
 store.set=function(name,value){if(name===key)throw Error('Synthetic progression-storage failure');return set.call(this,name,value);};
 try{await observer.scan(true);}finally{store.set=set;}
 const retained=store.source(observer.profile,profileFile);
 assert.equal(retained.payload.cash,18750,'The new profile cannot commit without its history');
 assert.equal(retained.sha,previous.sha);assert.equal(retained.status,'error');
 assert.deepEqual(store.get(key),baseline);
 await observer.scan(true);
 const restored=projectPhoneState(observer.state(19)).career.saveData;
 assert.equal(restored.profile.cash,18950);assert.equal(restored.profile.status,'available');
 assert.equal(restored.progression.events.length,1);assert.equal(restored.progression.events[0].changes[0].delta,200);
 await observer.scan(true);assert.equal(store.get(key).events.length,1);assert.deepEqual(saveHashes(save),expected);
});
test('same-content timestamp rollback cannot commit without its matching history boundary',async t=>{
 const {save,store,observer,key}=await setup(t),baseline=store.get(key),set=store.set;
 const file=path.join(save,profileFile);utimesSync(file,new Date('2026-09-19T10:00:00Z'),new Date('2026-09-19T10:00:00Z'));const expected=saveHashes(save);
 store.set=function(name,value){if(name===key)throw Error('Synthetic timestamp-history failure');return set.call(this,name,value);};
 try{await observer.scan(true);}finally{store.set=set;}
 assert.equal(store.source(observer.profile,profileFile).mtime,SAVE_TIME,'A source-only timestamp update must roll back too');
 assert.deepEqual(store.get(key),baseline);
 await observer.scan(true);const history=store.get(key);
 assert.equal(history.events.length,1);assert.equal(history.events[0].kind,'save_moved_backwards');
 assert.deepEqual(history.events[0].changes,[]);await observer.scan(true);assert.deepEqual(store.get(key),history);
 assert.deepEqual(saveHashes(save),expected);
});
test('unchanged previously decoded profiles establish a missing baseline without inventing changes',async t=>{
 const {store,observer,key}=await setup(t);
 store.db.prepare('DELETE FROM meta WHERE k=?').run(key);
 assert.equal(store.get(key),null);await observer.scan(false);
 const history=store.get(key);assert.equal(history.values.cash,18750);assert.deepEqual(history.events,[]);
 assert.equal(history.savedAt,SAVE_TIME);await observer.scan(false);assert.deepEqual(store.get(key),history);
});
test('a later unrelated save failure does not discard committed profile progression',async t=>{
 const {save,store,observer,key}=await setup(t);
 writeProfile(save,{cash:18950,savedAt:'2026-09-20T10:01:00.000Z'});
 writeFileSync(path.join(save,'worlditemsdata_adf'),Buffer.from('deliberately corrupt equipment fixture'));const expected=saveHashes(save);
 await observer.scan(true);const data=projectPhoneState(observer.state(19)).career.saveData;
 assert.equal(data.profile.cash,18950);assert.equal(data.profile.status,'available');assert.equal(data.equipment.status,'stale');
 assert.equal(data.progression.events.length,1);assert.equal(store.get(key).values.cash,18950);assert.deepEqual(saveHashes(save),expected);
});
