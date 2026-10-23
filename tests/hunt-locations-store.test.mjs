import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../lib/store.mjs';
import {Observer} from '../lib/observer.mjs';
import {projectLocationPage} from '../lib/hunt-locations.mjs';
import {zoneCommand,trackingState,assignNewHarvests,bindEncounterZone} from '../lib/zone-ledger.mjs';
import {projectZoneTracking} from '../lib/zone-phone.mjs';
import {writeSaveDataFixture,saveHashes} from './save-data-workflow-fixture.mjs';
import {discoveryReference,readyDiscoveryReader} from './zone-discovery-fixture.mjs';
async function setup(t){
 const root=mkdtempSync(path.join(tmpdir(),'grindzone-locations-store-')),save=path.join(root,'save'),journal=path.join(root,'journal.sqlite');mkdirSync(save);const hashes=writeSaveDataFixture(save);
 const store=new Store(journal),observer=new Observer(store,save,discoveryReference,{interval:60000,zoneReferenceReader:readyDiscoveryReader()});await observer.scan(true);
 t.after(()=>{observer.stop();store.close();rmSync(root,{recursive:true,force:true});});return {root,save,journal,hashes,store,observer,profile:observer.profile};
}
test('attribution captures the selected zone without expanding phone tracking fields',async t=>{
 const {store,observer,profile,save,hashes}=await setup(t),zone=observer.describeZones(observer.reserveZones(19))[0],now=new Date().toISOString();
 zoneCommand(store,profile,{op:'zone.track',reserve:19,zoneId:zone.id,expectedVersion:0},{zones:[zone],sourceStatus:'ok',now});
 const track=trackingState(store,profile);assert.equal(track.snapshot,undefined);assert.equal(projectZoneTracking(track).snapshot,undefined);
 const stored=store.get('zone-tracking-location:'+profile);assert.equal(stored.snapshot.x,zone.x);
 const receipt={id:'h',timestamp:Date.parse(now)/1000,origin:'observed'};
 assert.equal(assignNewHarvests(store,profile,[receipt],{currentReserve:19,sourceStatus:'ok',observedAt:now,tracking:track}),1);
 assert.equal(store.journal(profile,'harvestZones')[0].snapshot.x,zone.x);
 assert.deepEqual(saveHashes(save),hashes);
});
test('tracking version mismatch cannot attach a stale location snapshot',async t=>{
 const {store,observer,profile}=await setup(t),zone=observer.describeZones(observer.reserveZones(19))[0],now=new Date().toISOString();
 zoneCommand(store,profile,{op:'zone.track',reserve:19,zoneId:zone.id,expectedVersion:0},{zones:[zone],sourceStatus:'ok',now});
 store.set('zone-tracking-location:'+profile,{version:999,zoneId:zone.id,reserve:19,snapshot:{...zone,capturedAt:now}});
 assignNewHarvests(store,profile,[{id:'h',timestamp:Date.parse(now)/1000,origin:'observed'}],{currentReserve:19,sourceStatus:'ok',observedAt:now});
 assert.equal(store.journal(profile,'harvestZones')[0].snapshot,null);
});
test('encounter attribution stores a snapshot, and deliberate journal exports retain its provenance',async t=>{
 const {store,observer,profile}=await setup(t),zone=observer.describeZones(observer.reserveZones(19))[0],now=new Date().toISOString();
 zoneCommand(store,profile,{op:'zone.track',reserve:19,zoneId:zone.id,expectedVersion:0},{zones:[zone],sourceStatus:'ok',now});
 bindEncounterZone(store,profile,{id:'encounter',reserve:19,evidence:[{type:'shot',observedAt:now}]});
 const exported=store.exportJournal(profile);assert.equal(exported.encounterZones[0].snapshot.x,zone.x);assert(exported.zoneHistory.length>0);
 assert.equal(exported['zone-tracking-location'],undefined);assert.doesNotMatch(JSON.stringify(exported),/deviceToken|activationKey/);
});
test('the actual reader scopes old durable harvests to a running grind beyond its regular state window',async t=>{
 const {store,observer,profile}=await setup(t),zone=observer.describeZones(observer.reserveZones(19))[0];
 store.put(profile,'sessions',{id:'old-running',startedAt:'2023-11-01T00:00:00.000Z',endedAt:null,pausedAt:null});
 const rows=Array.from({length:700},(_,i)=>({id:'receipt'+i,timestamp:1700000000+i,speciesHash:zone.localizationHash,score:200,origin:'observed'}));store.importHarvests(profile,null,rows);
 const all=store.harvests(profile),old=all.find(h=>h.recordId==='receipt0');store.put(profile,'harvestZones',{id:'old-location',harvestId:old.id,zoneId:zone.id,reserve:19,basis:'player_selected_zone',snapshot:{...zone,capturedAt:new Date().toISOString()}});
 const page=observer.locationHistory({reserve:19});assert.equal(page.summary.savedHarvests,1);assert.equal(page.events[0].harvestId,old.id);assert.equal(page.events[0].location.x,zone.x);assert.equal(observer.state(19).harvests.length,500);
});
test('projection removes nested private fields while keeping readable event evidence',async t=>{
 const {store,observer,profile}=await setup(t);
 store.put(profile,'sessions',{id:'running',startedAt:'2023-11-01T00:00:00.000Z',endedAt:null,pausedAt:null});
 const encounter=store.command(profile,{op:'encounter.create',reserve:19,species:'Whitetail Deer',x:12000,z:8000});
 const page=observer.locationHistory();page.secret='PRIVATE';page.events[0].account='PRIVATE';page.events[0].location.path='PRIVATE';page.facets.extra='PRIVATE';
 const out=projectLocationPage(page);assert.doesNotMatch(JSON.stringify(out),/PRIVATE|account|path/);assert.equal(out.events[0].encounterId,encounter.id);assert.equal(out.events[0].location.basis,'reported_point');
});
test('independent source profiles never see each other’s records',async t=>{
 const {store,observer,profile}=await setup(t);store.command('different-profile',{op:'encounter.create',reserve:19,species:'PRIVATE-OTHER-PLAYER',x:1,z:2});
 const result=observer.locationHistory();assert.equal(result.summary.total,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE-OTHER-PLAYER/);assert.notEqual(profile,'different-profile');
});
