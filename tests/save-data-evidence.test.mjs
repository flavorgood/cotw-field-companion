/** Regression checks for truthful source coverage, rollback boundaries and spoiler revocation.
 * Synthetic normalized sources; these do not establish real-save or device acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSaveData,recordProfileProgress,projectSaveData,observerSaveData,SAVE_DATA_SCHEMA} from '../lib/save-data.mjs';
import {fixture,source,savedAt} from './save-data-fixture.mjs';
const coverage=(data,key)=>data.coverage.find(row=>row.key===key);
const memory=()=>{const data=new Map();return {get:(key,fallback=null)=>data.has(key)?structuredClone(data.get(key)):fallback,set:(key,value)=>data.set(key,structuredClone(value))};};
function healthFixture(recordCount,status='ok'){
 const value=fixture();value.healthSource=source({recordCount,identityValidated:false,private:'PRIVATE-HEALTH'});
 value.statusByName.health_component_manager_adf={status};return value;
}

test('missing health source never claims that health records were detected',()=>{
 const row=coverage(buildSaveData(fixture()),'health');
 assert.equal(row.status,'unavailable');assert.match(row.detail,/No readable health snapshot/);
 assert.doesNotMatch(row.detail,/records are detected|0 records|no wounded animals/i);
});
for(const value of [undefined,null,-1,1.5,'2',NaN,Infinity])test('unvalidated health count is unavailable: '+String(value),()=>{
 const row=coverage(buildSaveData(healthFixture(value)),'health');
 assert.equal(row.status,'unavailable');assert.match(row.detail,/No readable health snapshot/);
});
test('an empty health snapshot is not proof that no animals are wounded',()=>{
 const row=coverage(buildSaveData(healthFixture(0)),'health');
 assert.equal(row.status,'partial');assert.match(row.detail,/0 records/);
 assert.match(row.detail,/does not establish whether an animal is alive or wounded/);
});
test('a decoded health count does not establish individual animal identity',()=>{
 const value=healthFixture(3);value.healthSource.payload.identityValidated=true;
 const row=coverage(buildSaveData(value),'health');assert.equal(row.status,'partial');
 assert.match(row.detail,/3 records/);assert.match(row.detail,/identity remains unresolved/);
 assert.doesNotMatch(JSON.stringify(row),/PRIVATE|identityValidated|animal is dead/);
});
test('a failed health refresh labels the retained health snapshot stale',()=>{
 const row=coverage(buildSaveData(healthFixture(3,'error')),'health');
 assert.match(row.detail,/Last retained health snapshot \(stale\): 3 records/);
});
test('observer adapter reads the existing canonical health source',()=>{
 const value=healthFixture(2),requested=[];
 const byName={thp_player_profile_adf:value.profileSource,playerinformation_adf:value.playerSource,animal_population_19:value.populationSource,worlditemsdata_adf:value.equipmentSource,health_component_manager_adf:value.healthSource};
 const observer={profile:'fixture',reference:value.reference,source(name){requested.push(name);return byName[name]??null;},equipmentPlaces(){return value.equipment;},store:{sources(){return Object.entries(value.statusByName).map(([name,row])=>({name,...row}));},get(){return null;}}};
 const data=observerSaveData(observer,value.state);
 assert(requested.includes('health_component_manager_adf'));assert.match(coverage(data,'health').detail,/2 records/);
 assert.doesNotMatch(JSON.stringify(data),/PRIVATE-HEALTH/);
});
test('harvest coverage does not advertise unverified individual medal decoding',()=>{
 const row=coverage(buildSaveData(fixture()),'harvest');
 assert.doesNotMatch(row.detail,/Saved score, time and medal/);
 assert.match(row.detail,/individual medals.*verification/i);
});
test('identical profile bytes with an older saved time retain a rollback boundary exactly once',()=>{
 const store=memory(),value=fixture().profileSource;recordProfileProgress(store,'p',value,'ok',savedAt);
 const older={...value,mtime:'2026-09-20T10:00:00.000Z'};
 assert.equal(recordProfileProgress(store,'p',older,'ok',savedAt),true);
 const history=store.get('save-data-progress:p');assert.equal(history.events.length,1);
 assert.equal(history.events[0].kind,'save_moved_backwards');assert.deepEqual(history.events[0].changes,[]);
 assert.equal(recordProfileProgress(store,'p',older,'ok',savedAt),false);
 assert.equal(store.get('save-data-progress:p').events.length,1);
});
test('same-content forward timestamp refreshes the baseline without inventing earned progress',()=>{
 const store=memory(),value=fixture().profileSource;recordProfileProgress(store,'p',value,'ok',savedAt);
 const later={...value,mtime:'2026-09-21T11:00:00.000Z'};
 assert.equal(recordProfileProgress(store,'p',later,'ok',later.mtime),true);
 assert.equal(store.get('save-data-progress:p').savedAt,later.mtime);assert.deepEqual(store.get('save-data-progress:p').events,[]);
 recordProfileProgress(store,'p',value,'ok',later.mtime);
 assert.equal(store.get('save-data-progress:p').events[0].previousSavedAt,later.mtime);
});
test('a same-content rollback on an unreadable source cannot alter prior history',()=>{
 const store=memory(),value=fixture().profileSource;recordProfileProgress(store,'p',value,'ok',savedAt);
 const before=store.get('save-data-progress:p');
 assert.equal(recordProfileProgress(store,'p',{...value,mtime:'2026-09-20T10:00:00Z'},'error',savedAt),false);
 assert.deepEqual(store.get('save-data-progress:p'),before);
});
test('spoilers-off projection also redacts retained population coverage',()=>{
 const data=buildSaveData(fixture());Object.assign(coverage(data,'population'),{label:'PRIVATE-SPECIES',detail:'PRIVATE-POPULATION-DETAIL',status:'decoded'});
 const result=projectSaveData(data,{spoilers:false,reserve:19});
 assert.equal(coverage(result,'population').status,'spoilers_off');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|Whitetail Deer/);
 assert.equal(coverage(data,'population').status,'decoded');
});
test('a different reserve cannot inherit population coverage from an old phone view',()=>{
 const data=buildSaveData(fixture());coverage(data,'population').detail='PRIVATE-OTHER-RESERVE';
 const result=projectSaveData(data,{spoilers:true,reserve:1});
 assert.equal(coverage(result,'population').status,'unavailable');assert.doesNotMatch(JSON.stringify(result),/PRIVATE-OTHER-RESERVE|Whitetail Deer/);
});
test('existing optional byte-limit state survives a second projection',()=>{
 assert.deepEqual(projectSaveData({schema:SAVE_DATA_SCHEMA,status:'byte_limit'}),{schema:SAVE_DATA_SCHEMA,status:'byte_limit'});
});
test('valid herd totals, equipment review and profile fields remain intact',()=>{
 const data=buildSaveData(fixture()),result=projectSaveData(data,{spoilers:true,reserve:19});
 assert.equal(result.herds.species[0].animals,3);assert.equal(result.equipment.total,2);assert.equal(result.equipment.attention,1);
 assert.equal(result.profile.level,42);assert.equal(result.profile.cash,18750);
});

globalThis.document={documentElement:{dataset:{}}};
const {saveDataView}=await import('../public/save-data.js');
function viewFixture(){const value=fixture();value.state.career={saveData:buildSaveData(value)};return value;}
test('renderer independently hides old population coverage after spoiler revocation',()=>{
 const value=viewFixture();coverage(value.state.career.saveData,'population').detail='PRIVATE-RETAINED-POPULATION';
 value.state.settings.spoilers=false;const html=saveDataView(value.state);
 assert.doesNotMatch(html,/PRIVATE-RETAINED-POPULATION|Whitetail Deer/);assert.match(html,/Population details are hidden/);
});
test('renderer independently withholds old coverage when switching reserve',()=>{
 const value=viewFixture();coverage(value.state.career.saveData,'population').detail='PRIVATE-OTHER-RESERVE';
 value.state.selectedReserve=1;const html=saveDataView(value.state);
 assert.doesNotMatch(html,/PRIVATE-OTHER-RESERVE|Whitetail Deer/);assert.match(html,/No matching population summary/);
});
test('history read failure is not presented as a fresh baseline',()=>{
 const value=viewFixture();value.state.career.saveData.progression={status:'unavailable',events:[]};
 const html=saveDataView(value.state);assert.match(html,/Progression history is temporarily unavailable/);
 assert.doesNotMatch(html,/The first readable profile establishes a baseline/);
});
test('empty available history is distinct from a missing first baseline',()=>{
 const value=viewFixture();value.state.career.saveData.progression={status:'available',events:[]};
 assert.match(saveDataView(value.state),/No progression changes recorded since the current baseline/);
 value.state.career.saveData.progression.status='awaiting_baseline';
 assert.match(saveDataView(value.state),/The first readable profile establishes a baseline/);
});
test('bait review total labels items rather than claiming a count of bait sites',()=>{
 const value=viewFixture();assert.match(saveDataView(value.state),/Deployed items needing bait review/);
 assert.doesNotMatch(saveDataView(value.state),/Empty or destroyed bait sites need review/);
});
