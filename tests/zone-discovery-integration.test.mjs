import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,unlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {Observer} from '../lib/observer.mjs';
import {projectPhoneState} from '../lib/phone-bridge.mjs';
import {writeDiscoveryFixture,discoveredSave,discoveryReference,readyDiscoveryReader} from './zone-discovery-fixture.mjs';
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Observer did not settle');};
async function setup(t){
 const root=mkdtempSync(path.join(tmpdir(),'grindzone-discovery-integration-')),save=path.join(root,'save');mkdirSync(save);const files=writeDiscoveryFixture(save);
 const store=new Store(path.join(root,'journal.sqlite')),reader=readyDiscoveryReader();const observer=new Observer(store,save,discoveryReference,{interval:60000,zoneReferenceReader:reader});
 t.after(async()=>{observer.stop();await until(()=>!observer.busy);store.db.close();rmSync(root,{recursive:true,force:true});});await observer.start();
 assert.equal(observer.zoneSourceStatus(),'ok');return {root,save,files,store,reader,observer,enable:()=>observer.command({op:'settings',spoilers:true,confirmSpoilers:true}),disable:()=>observer.command({op:'settings',spoilers:false})};
}
test('the actual save reader has no hidden zones or catalogue access before spoiler consent',async t=>{
 const {observer,reader,files,save}=await setup(t);const s=observer.state(19);assert.equal(s.zones.length,1);assert.equal(reader.calls,0);assert.equal(s.zoneActivity.discovery.status,'disabled');
 for(const [name,bytes]of Object.entries(files))assert.deepEqual(readFileSync(path.join(save,name)),bytes);
});
test('spoilers reveal assigned feeding and resting areas alongside the discovered drinking zone on the phone',async t=>{
 const {observer,enable}=await setup(t);enable();const s=observer.state(19),p=projectPhoneState(s);
 assert.deepEqual(new Set(p.zones.map(z=>z.need)),new Set(['feeding','drinking','resting']));assert.equal(p.zones.length,3);
 assert.equal(p.zones.filter(z=>z.source==='population_path_reference').length,2);assert.equal(p.zoneActivity.discovery.hiddenZones,2);assert.equal(p.profile,undefined);
 assert.equal(observer.state(20).zones.length,0);
});
test('discovering a revealed area replaces its hidden entry without duplicating or fabricating discoveries',async t=>{
 const {observer,enable,save}=await setup(t);enable();assert.equal(observer.state(19).zoneActivity.discovery.hiddenZones,2);
 writeFileSync(path.join(save,'found_need_zones_adf'),discoveredSave([101,102]));await observer.scan(true);
 const s=observer.state(19);assert.equal(s.zones.length,3);assert.equal(new Set(s.zones.map(z=>z.id)).size,3);assert.equal(s.zones.find(z=>z.zoneId===101).source,'save');assert.equal(s.zoneActivity.discovery.hiddenZones,1);
});
test('turning spoilers off hides selected area coordinates and stops hidden-location attribution without deleting the route',async t=>{
 const {observer,enable,disable}=await setup(t);enable();const z=observer.state(19).zones.find(z=>z.source==='population_path_reference');
 observer.command({op:'route.toggle',reserve:19,zoneId:z.id});observer.command({op:'zone.track',reserve:19,zoneId:z.id,expectedVersion:0});
 disable();const p=projectPhoneState(observer.state(19));assert.equal(p.zones.some(v=>v.source==='population_path_reference'),false);assert.ok(p.route.includes(z.id));
 assert.equal(p.zoneHistory.find(v=>v.id===z.id).status,'spoiler_hidden');assert.equal(p.zoneHistory.find(v=>v.id===z.id).snapshot,null);assert.equal(p.zoneTracking.active,false);assert.equal(p.zoneTracking.name,null);assert.equal(p.zoneActivity.discovery.status,'disabled');
 enable();assert.ok(observer.state(19).zones.some(v=>v.id===z.id));
});
test('a failed discovery file read withholds hidden zones, retains known data and does not claim a removal',async t=>{
 const {observer,enable,save}=await setup(t);enable();observer.state(19);unlinkSync(path.join(save,'found_need_zones_adf'));await observer.scan(true);
 const s=observer.state(19);assert.equal(s.zoneActivity.discovery.status,'source_unavailable');assert.equal(s.zones.length,1);assert.equal(s.zones[0].source,'save');assert.equal(s.zoneHistory.some(z=>z.status==='removed'),false);
});
test('a confirmed removed discovery is not resurrected by its still-present population path',async t=>{
 const {observer,enable,save}=await setup(t);enable();observer.state(19);writeFileSync(path.join(save,'found_need_zones_adf'),discoveredSave([]));await observer.scan(true);
 const s=observer.state(19);assert.equal(s.zones.some(z=>z.id==='saved:19:102:1'),false);assert.equal(s.zoneHistory.find(z=>z.id==='saved:19:102:1').status,'removed');
});
test('incompatible catalogue schedules are withheld without breaking the discovered-zone reader',async t=>{
 const {observer,enable,reader}=await setup(t);reader.current.schedules['3845994887'][1].start=9;enable();const s=observer.state(19);
 assert.equal(s.zoneActivity.discovery.status,'reference_mismatch');assert.equal(s.zones.length,1);assert.equal(s.observer.error,null);
});
test('loading and unavailable references stay explicit without invented zero-zone totals',async t=>{
 const {observer,enable,reader}=await setup(t);reader.current=null;reader.currentStatus='loading';enable();assert.equal(observer.state(19).zoneActivity.discovery.status,'loading');
 reader.currentStatus='unavailable';assert.equal(observer.state(19).zoneActivity.discovery.status,'reference_unavailable');
});
