/** Upgrade recovery on actual SQLite/Observer; synthetic binary saves, never player files. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../lib/store.mjs';
import {Observer,normalizeFile} from '../lib/observer.mjs';
import {decodeSave} from '../lib/decoder.mjs';
import {recordHerds,readHerdLedger,HERD_LEDGER_SCHEMA} from '../lib/herd-ledger.mjs';
import {deriveHerdReference} from '../lib/herd-trophies.mjs';
import {projectHerdView} from '../lib/herd-view.mjs';
import {fixture,defs,pop} from './fixtures.mjs';
import {discoveryReference,readyDiscoveryReader} from './zone-discovery-fixture.mjs';
const name='animal_population_19',saved='2026-09-17T16:16:00.000Z';
const hash=b=>createHash('sha256').update(b).digest('hex');
const reference=deriveHerdReference({whitetail_deer:{gender:{male:{score_high:300},female:{score_high:0}},trophy:{diamond:{score_low:200}}}});
function populationBytes({area=true,members=[1,2]}={}){
 const types={...defs,group:area?defs.group:{NeedZonePathGuids:'u32[]',Animals:'animal[]'}};
 return fixture(types,'rootPopulation',pop(members));
}
async function setup(t,{legacy=true,area=true,raw=false}={}){
 const root=mkdtempSync(path.join(tmpdir(),'gz-herd-upgrade-')),save=path.join(root,'saves'),db=path.join(root,'journal.sqlite');mkdirSync(save);
 let store=new Store(db),observer;const open=()=>{observer=new Observer(store,save,discoveryReference,{interval:60000,zoneReferenceReader:readyDiscoveryReader(),herdReference:reference});};open();
 const bytes=populationBytes({area}),payload=normalizeFile(name,decodeSave(bytes));if(legacy)delete payload.herdProjectionVersion;
 const original={sha:hash(bytes),mtime:saved,checked:saved,status:'ok',error:null,payload};
 store.saveSource(observer.profile,name,original);store.set('settings:'+observer.profile,{spoilers:true});
 store.set('preserved-pairing-fixture',{device:'synthetic-test-only'});
 if(raw){writeFileSync(path.join(save,name),bytes);utimesSync(path.join(save,name),new Date(saved),new Date(saved));}
 const close=async()=>{observer.stop();while(observer.busy)await new Promise(r=>setTimeout(r,5));store.close();};
 t.after(async()=>{await close();rmSync(root,{recursive:true,force:true});});
 return {root,save,original,get observer(){return observer;},get store(){return store;},
  read:()=>projectHerdView(observer.herdView({reserve:19})),
  restart:async()=>{await close();store=new Store(db);open();await observer.scan(true);}};
}
test('upgrade reconstructs herd index from last-good stored population even when the game file is absent',async t=>{
 const f=await setup(t);await f.observer.scan(true);const view=f.read();
 assert.equal(view.status,'stale');assert.equal(view.summary.animals,2);assert.equal(view.summary.herds,1);assert.equal(view.summary.diamonds,2);
 assert.equal(f.store.source(f.observer.profile,name).mtime,saved);assert.equal(f.store.source(f.observer.profile,name).sha,f.original.sha);
 assert.equal(f.store.harvests(f.observer.profile).length,0);assert.equal(f.store.get('preserved-pairing-fixture').device,'synthetic-test-only');
});
test('legacy records without an optional spawn area keep their animals and saved zone paths',async t=>{
 const f=await setup(t,{area:false});await f.observer.scan(true);const view=f.read();
 assert.equal(view.status,'stale');assert.equal(view.summary.animals,2);assert.equal(view.herds[0].zones.length,3);
 const ledger=readHerdLedger(f.store,f.observer.profile,19);assert.equal(ledger.records[0].area,null);assert.equal(ledger.records[0].anchor,null);
});
test('new binary population without a spawn-area field is not rejected as an unreadable save',async t=>{
 const f=await setup(t,{area:false,raw:true});await f.observer.scan(true);const view=f.read();
 assert.equal(view.status,'available');assert.equal(view.summary.animals,2);assert.equal(f.store.sources(f.observer.profile).find(r=>r.name===name).status,'ok');
 assert.deepEqual(readFileSync(path.join(f.save,name)),populationBytes({area:false}));
});
test('recovered identities survive independent SQLite reopen and repeated scans',async t=>{
 const f=await setup(t);await f.observer.scan(true);const before=f.read();assert.equal(before.herds.length,1);
 const ledger=readHerdLedger(f.store,f.observer.profile,19);await f.restart();await f.observer.scan(false);
 assert.deepEqual(f.read().herds.map(r=>r.id),before.herds.map(r=>r.id));assert.deepEqual(readHerdLedger(f.store,f.observer.profile,19),ledger);
});
test('missing origin is not a structural identity match when all members change',async t=>{
 const f=await setup(t,{area:false});f.store.transaction(()=>recordHerds(f.store,f.observer.profile,19,f.original));
 const first=readHerdLedger(f.store,f.observer.profile,19),bytes=populationBytes({area:false,members:[8,9]});
 f.store.transaction(()=>recordHerds(f.store,f.observer.profile,19,{...f.original,sha:hash(bytes),mtime:'2026-09-18T16:16:00Z',payload:normalizeFile(name,decodeSave(bytes))}));
 const after=readHerdLedger(f.store,f.observer.profile,19);assert.notEqual(after.records.find(r=>r.active).id,first.records[0].id);
 assert.equal(after.records.find(r=>r.id===first.records[0].id).active,false);
});
test('a failed index write preserves source, journal and sequence and retries on a later scan',async t=>{
 const f=await setup(t),original=f.store.source(f.observer.profile,name),set=f.store.set;
 f.store.set=function(key,value){if(key==='herd-sequence:'+f.observer.profile)throw Error('Synthetic storage error');return set.call(this,key,value);};
 try{await f.observer.scan(true);}finally{f.store.set=set;}
 assert.equal(readHerdLedger(f.store,f.observer.profile,19),null);assert.deepEqual(f.store.source(f.observer.profile,name).payload,original.payload);
 assert.equal(f.store.get('herd-sequence:'+f.observer.profile,null),null);await f.observer.scan(true);
 assert.equal(f.read().summary.animals,2);assert.equal(f.read().herds[0].label,'H-000001');
});
test('spoiler consent is still required after automatic identity recovery',async t=>{
 const f=await setup(t);f.observer.command({op:'settings',spoilers:false});await f.observer.scan(true);const off=f.read();
 assert.equal(off.status,'spoilers_off');assert.equal(off.summary,null);assert.deepEqual(off.herds,[]);
 f.observer.command({op:'settings',spoilers:true,confirmSpoilers:true});assert.equal(f.read().summary.animals,2);
});
test('unsupported persisted identity schema is not overwritten to make an empty panel disappear',async t=>{
 const f=await setup(t),existing={schema:'future.schema',sourceSha:f.original.sha,savedAt:saved,records:[]};
 f.store.set('herd-ledger:'+f.observer.profile+':19',existing);await f.observer.scan(true);
 assert.deepEqual(readHerdLedger(f.store,f.observer.profile,19),existing);
});
test('metadata-only failed reads remain unavailable, never fabricated as zero population',async t=>{
 const f=await setup(t);f.store.db.prepare('DELETE FROM sources WHERE profile=? AND name=?').run(f.observer.profile,name);f.observer.cache.clear();
 f.store.sourceStatus(f.observer.profile,name,'error','Synthetic failure with a private filesystem path');writeFileSync(path.join(f.save,name),'broken');await f.observer.scan(true);const view=f.read();
 assert.equal(view.status,'unavailable');assert.equal(view.summary,null);assert.deepEqual(view.herds,[]);assert.equal(readHerdLedger(f.store,f.observer.profile,19),null);
 assert.doesNotMatch(JSON.stringify(view),/private filesystem path/);
});
test('a source-only snapshot mismatch is reconciled without requiring changed game bytes',async t=>{
 const f=await setup(t,{legacy:false,raw:true});f.store.transaction(()=>recordHerds(f.store,f.observer.profile,19,f.original));
 const ledger=readHerdLedger(f.store,f.observer.profile,19),stale={...ledger,sourceSha:'a'.repeat(64)};f.store.set('herd-ledger:'+f.observer.profile+':19',stale);
 await f.observer.scan(false);assert.equal(f.read().status,'available');assert.equal(f.read().summary.animals,2);assert.equal(f.read().herds[0].id,ledger.records[0].id);
});
