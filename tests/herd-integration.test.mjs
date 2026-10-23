/** Real binary decoder + Observer + SQLite, disposable fixtures (not owner-save compatibility). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {Observer} from '../lib/observer.mjs';
import {projectHerdView,herdQuery,herdSearchParams} from '../lib/herd-view.mjs';
import {deriveHerdReference} from '../lib/herd-trophies.mjs';
import {fixture,defs,animal} from './fixtures.mjs';
import {writeDiscoveryFixture,discoveryReference,readyDiscoveryReader,discoveredSave} from './zone-discovery-fixture.mjs';
const herdDefs={...defs,animal:{...defs.animal,Id:'u32',IsGreatOne:'u8'}};
const herdReference=deriveHerdReference({whitetail_deer:{gender:{male:{score_high:300},female:{score_high:0}},trophy:{diamond:{score_low:200}}}});
const group=(ids,paths=[101,102,103])=>({SpawnAreadId:100,NeedZonePathGuids:paths,Animals:ids.map((id,i)=>({...animal(id,i===1?2:1),Id:id,IsGreatOne:id===1?1:0,Score:250}))});
function writePopulation(save,groups=[group([1,2]),group([3,4])],seed=123,time='2026-09-21T12:00:00Z'){
 const bytes=fixture(herdDefs,'rootPopulation',{ReserveSeed:seed,Populations:[{NameHashId:3845994887,Revision:1,Groups:groups}]});
 const file=path.join(save,'animal_population_19');writeFileSync(file,bytes);utimesSync(file,new Date(time),new Date(time));return bytes;
}
async function setup(t){
 const root=mkdtempSync(path.join(tmpdir(),'grindzone-herds-test-')),save=path.join(root,'save');mkdirSync(save);writeDiscoveryFixture(save);writePopulation(save);
 let store,observer;
 const open=async()=>{store=new Store(path.join(root,'journal.sqlite'));observer=new Observer(store,save,discoveryReference,{interval:60000,zoneReferenceReader:readyDiscoveryReader(),herdReference});await observer.scan(true);return observer;};
 const close=async()=>{observer.stop();while(observer.busy)await new Promise(r=>setTimeout(r,5));store.close();};
 await open();t.after(async()=>{await close();rmSync(root,{recursive:true,force:true});});
 return {root,save,get observer(){return observer;},get store(){return store;},restart:async()=>{await close();await open();},enable:()=>observer.command({op:'settings',spoilers:true,confirmSpoilers:true})};
}
test('the actual reader retains native animal identity and explicit Great One evidence',async t=>{
 const f=await setup(t),a=f.observer.source('animal_population_19').payload.populations[0].groups[0].animals[0];assert.equal(a.nativeId,'1');assert.equal(a.greatOne,true);assert.equal(a.greatOneEvidence,'explicit_IsGreatOne');
});
test('IDs, male/female counts and all three assigned activity types reach the phone projection',async t=>{
 const f=await setup(t);f.enable();const view=projectHerdView(f.observer.herdView({reserve:19}));assert.equal(view.summary.herds,2);assert.equal(view.summary.animals,4);assert.equal(view.summary.greatOnes,1);assert.equal(view.summary.diamonds,1);
 assert.equal(new Set(view.herds.map(r=>r.id)).size,2);
 assert.deepEqual(new Set(view.herds[0].zones.map(z=>z.need)),new Set(['feeding','drinking','resting']));
 assert.equal(view.facets.zones.find(z=>z.need==='drinking').herds.length,2);
 assert.doesNotMatch(JSON.stringify(view),/nativeId|members|speciesHash|population_seed|"epoch"/);
});
test('same herd IDs survive a real SQLite close/reopen and changed binary record order',async t=>{
 const f=await setup(t);f.enable();const before=f.observer.herdView({}).herds.map(r=>r.id);await f.restart();assert.deepEqual(f.observer.herdView({}).herds.map(r=>r.id),before);
 writePopulation(f.save,[group([3,4]),group([2,1])],123,'2026-09-21T12:01:00Z');await f.observer.scan(true);assert.deepEqual(f.observer.herdView({}).herds.map(r=>r.id),before);
});
test('failed population reads retain stale IDs and do not create deaths or remove herds',async t=>{
 const f=await setup(t);f.enable();const old=f.observer.herdView({});writeFileSync(path.join(f.save,'animal_population_19'),'broken');await f.observer.scan(true);
 const next=f.observer.herdView({});assert.equal(next.status,'stale');assert.deepEqual(next.herds.map(r=>r.id),old.herds.map(r=>r.id));assert.deepEqual(next.summary,old.summary);
});
test('failed ledger persistence rolls back its population snapshot; retry does not duplicate herds',async t=>{
 const f=await setup(t);f.enable();const prior=f.observer.herdView({}),set=f.store.set,previous=f.store.source(f.observer.profile,'animal_population_19');
 writePopulation(f.save,[group([1,2,5]),group([3,4])],123,'2026-09-21T12:01:00Z');
 f.store.set=function(k,v){if(k.startsWith('herd-ledger:'))throw Error('fixture disk failure');return set.call(this,k,v);};
 try{await f.observer.scan(true);}finally{f.store.set=set;}
 assert.equal(f.store.source(f.observer.profile,'animal_population_19').sha,previous.sha);assert.equal(f.observer.herdView({}).summary.animals,4);
 await f.observer.scan(true);const after=f.observer.herdView({});assert.equal(after.summary.animals,5);assert.equal(after.summary.herds,2);assert.deepEqual(after.herds.map(r=>r.id),prior.herds.map(r=>r.id));
});
test('spoilers-off removes IDs, membership, coordinates, trophy counts and reverse-zone facets',async t=>{
 const f=await setup(t);f.enable();const before=f.observer.herdView({}),id=before.herds[0].id;f.observer.command({op:'settings',spoilers:false});
 const off=projectHerdView(f.observer.herdView({}));assert.equal(off.status,'spoilers_off');assert.equal(off.summary,null);assert.deepEqual(off.herds,[]);assert.deepEqual(off.facets,{species:[],zones:[]});assert(!JSON.stringify(off).includes(id));
 f.enable();assert.equal(f.observer.herdView({}).herds[0].id,id);
});
test('species, zone and trophy filters use full counts before pagination',async t=>{
 const f=await setup(t);f.enable();const full=f.observer.herdView({}),zone=full.facets.zones[0].id;
 const page=f.observer.herdView({zone,limit:1});assert.equal(page.summary.herds,2);assert.equal(page.herds.length,1);assert.equal(page.nextOffset,1);
 assert.equal(f.observer.herdView({trophy:'great_one'}).summary.herds,1);assert.equal(f.observer.herdView({trophy:'diamond'}).summary.herds,1);
 assert.equal(f.observer.herdView({offset:1,limit:1,revision:page.revision}).herds.length,1);
 assert.throws(()=>f.observer.herdView({offset:1,limit:1,revision:'0'.repeat(64)}),{status:409});
});
test('unmapped references do not turn potential trophy counts into false zeroes',async t=>{
 const f=await setup(t);f.enable();f.observer.herdReference=null;const view=f.observer.herdView({});assert.equal(view.summary.diamonds,null);assert.equal(view.summary.unclassifiedHerds,2);assert.equal(view.summary.greatOnes,1);
});
test('read-only herd inspection leaves synthetic game save bytes unchanged',async t=>{
 const f=await setup(t);f.enable();const file=path.join(f.save,'animal_population_19'),bytes=readFileSync(file);projectHerdView(f.observer.herdView({}));assert.deepEqual(readFileSync(file),bytes);
});
test('removed drinking zones keep a labeled last-known link for the same herd',async t=>{
 const f=await setup(t);f.enable();const old=f.observer.herdView({});writeFileSync(path.join(f.save,'found_need_zones_adf'),discoveredSave([]));await f.observer.scan(true);
 const view=f.observer.herdView({});assert.equal(view.herds[0].id,old.herds[0].id);assert.equal(view.herds[0].zones.find(z=>z.need==='drinking').status,'removed');
});
for(const query of [{profile:'other'},{path:'../save'},{reserve:[]},{limit:0},{trophy:'kill'},{offset:-1}])test('unsafe or malformed read filters are rejected: '+JSON.stringify(query),()=>assert.throws(()=>herdQuery(query)));
test('duplicate URL filters are rejected rather than choosing the last value',()=>assert.throws(()=>herdSearchParams(new URLSearchParams('reserve=19&reserve=1'))));

test('a projected herd page cannot claim another requested reserve',async t=>{
 const f=await setup(t);f.enable();const value=f.observer.herdView({reserve:19});value.query.reserve=1;assert.throws(()=>projectHerdView(value),{status:503});
});
