/** Real binary-save/Observer/SQLite regressions. References are synthetic, not player data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,unlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Store} from '../lib/store.mjs';
import {Observer} from '../lib/observer.mjs';
import {projectPhoneState,projectPhoneExport} from '../lib/phone-bridge.mjs';
import {writeSaveDataFixture,saveHashes,workflowDefs} from './save-data-workflow-fixture.mjs';
import {fixture} from './fixtures.mjs';
import {discoveryReference,readyDiscoveryReader} from './zone-discovery-fixture.mjs';
const worker=fileURLToPath(new URL('./save-data-restart-worker.mjs',import.meta.url));
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','HOME','USERPROFILE','SYSTEMROOT','TMP','TEMP','TMPDIR','LANG','LC_ALL'].includes(key)));
function setup(t){
  const root=mkdtempSync(path.join(tmpdir(),'grindzone-source-state-')),save=path.join(root,'save');mkdirSync(save);writeSaveDataFixture(save);
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const read=()=>JSON.parse(execFileSync(process.execPath,[worker,save,path.join(root,'history.sqlite')],{encoding:'utf8',env:cleanEnv,timeout:30000,stdio:['ignore','pipe','pipe']}));
  return {root,save,read};
}
const row=(data,key)=>data.coverage.find(r=>r.key===key);
const broken=Buffer.from('deliberately invalid synthetic save');
for(const [file,key,section] of [
 ['worlditemsdata_adf','equipment','equipment'],
 ['thp_player_profile_adf','profile','profile'],
 ['animal_population_19','population','herds']
])test('failed first read stays unavailable after independent restart: '+file,t=>{
  const {save,read}=setup(t);writeFileSync(path.join(save,file),broken);const expected=saveHashes(save);
  const first=read(),reopened=read();
  assert.equal(first.sourceStates.find(r=>r.name===file).status,'error');
  assert.equal(reopened.sourceStates.find(r=>r.name===file).status,'error');
  assert.equal(row(reopened.saveData,key).status,'unavailable','An error-only DB row is not decoded data');
  assert.equal(reopened.saveData[section].status,'unavailable','No last-good payload exists to label stale');
  if(key==='equipment')for(const field of ['total','attention','unknown'])assert.equal(reopened.saveData.equipment[field],null,'Missing equipment is not a zero count');
  if(key==='profile'){assert.equal(reopened.saveData.profile.level,null);assert.equal(reopened.history,null);}
  if(key==='population')assert.equal(reopened.saveData.herds.totalSpecies,null);
  assert.deepEqual(saveHashes(save),expected);
});
test('a valid empty equipment save stays zero across restart, unlike a never-readable save',t=>{
  const {save,read}=setup(t);writeFileSync(path.join(save,'worlditemsdata_adf'),fixture(workflowDefs,'worldItems',{WorldItems:[]}));
  const first=read(),reopened=read();
  for(const r of [first,reopened]){assert.equal(r.saveData.equipment.status,'available');assert.equal(r.saveData.equipment.total,0);assert.equal(row(r.saveData,'equipment').status,'decoded');}
});
test('equipment recovers from an error-only row without requiring history deletion',t=>{
  const {save,read}=setup(t),file=path.join(save,'worlditemsdata_adf'),good=readFileSync(file);
  writeFileSync(file,broken);read();read();writeFileSync(file,good);const expected=saveHashes(save);
  const recovered=read(),reopened=read();
  for(const r of [recovered,reopened]){assert.equal(r.saveData.equipment.status,'available');assert.equal(r.saveData.equipment.total,2);assert.equal(r.saveData.equipment.attention,1);}
  assert.deepEqual(reopened.history,recovered.history);assert.deepEqual(saveHashes(save),expected);
});
test('failure after a valid equipment snapshot preserves the real total as stale',t=>{
  const {save,read}=setup(t),file=path.join(save,'worlditemsdata_adf');read();writeFileSync(file,broken);
  const stale=read();assert.equal(stale.saveData.equipment.status,'stale');assert.equal(stale.saveData.equipment.total,2);
  unlinkSync(file);const missing=read();assert.equal(missing.saveData.equipment.status,'stale');assert.equal(missing.saveData.equipment.total,2);
});
async function withObserver(t,fn){
  const {root,save}=setup(t),store=new Store(path.join(root,'in-process.sqlite'));
  const observer=new Observer(store,save,discoveryReference,{interval:60000,zoneReferenceReader:readyDiscoveryReader()});
  try{await observer.start();await fn({save,store,observer});}
  finally{observer.stop();while(observer.busy)await new Promise(r=>setTimeout(r,10));store.close();}
}
test('an unchanged fast rescan exposes the latest check time without changing saved time',async t=>withObserver(t,async({save,store,observer})=>{
  const before=observer.state(19).career.saveData.profile,expected=saveHashes(save);
  await new Promise(r=>setTimeout(r,10));await observer.scan(false);
  const state=observer.state(19),after=projectPhoneState(state).career.saveData.profile;
  const metadata=store.sources(observer.profile).find(r=>r.name==='thp_player_profile_adf');
  assert.notEqual(metadata.checked,before.checkedAt);
  assert.equal(after.checkedAt,metadata.checked,'Phone data must use the latest actual check, not the initial cached check');
  assert.equal(after.savedAt,before.savedAt);assert.equal(after.cash,before.cash);assert.deepEqual(saveHashes(save),expected);
}));
test('a failed refresh reports the latest attempt time while preserving last-good saved time and values',async t=>withObserver(t,async({save,store,observer})=>{
  const before=observer.state(19).career.saveData.profile;writeFileSync(path.join(save,'thp_player_profile_adf'),broken);await observer.scan(true);
  const data=projectPhoneExport(observer.state(19)).saveData,meta=store.sources(observer.profile).find(r=>r.name==='thp_player_profile_adf');
  assert.equal(data.profile.status,'stale');assert.equal(data.profile.checkedAt,meta.checked);
  assert.equal(data.profile.savedAt,before.savedAt);assert.equal(data.profile.cash,before.cash);
  assert.doesNotMatch(JSON.stringify(data),new RegExp(save.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
}));
test('phone exports retain correct unavailable states and remove opted-out herd summaries',async t=>withObserver(t,async({observer})=>{
  observer.command({op:'settings',spoilers:true,confirmSpoilers:true});assert.equal(projectPhoneState(observer.state(19)).career.saveData.herds.species.length,1);
  observer.command({op:'settings',spoilers:false});const exported=projectPhoneExport(observer.state(19));
  assert.equal(exported.saveData.herds.status,'spoilers_off');assert.deepEqual(exported.saveData.herds.species,[]);assert.equal(row(exported.saveData,'population').status,'spoilers_off');
  assert.equal(exported.saveData.equipment.total,2);
}));
