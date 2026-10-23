import test from 'node:test';
import assert from 'node:assert/strict';
import {projectZoneData,projectZoneDiscovery} from '../lib/zone-phone.mjs';
import {zoneRouteStatus,zoneDiscoveryNotice,zoneHuntButton,renderRouteCards} from '../public/route-stops.js';
const discovery={reserve:19,status:'available',hiddenZones:7,unresolvedSlots:0,disabledSlots:1,ambiguousZones:0,omittedZones:0,referenceFetchedAt:'2026-09-20T23:00:00Z',referenceSha256:'private-internal-not-for-phone',raw:{secret:true}};
const state=()=>({zoneLedgerVersion:1,selectedReserve:19,settings:{spoilers:true},observer:{connected:true,sources:[{name:'found_need_zones_adf',status:'ok'}]},zoneActivity:{discovery,harvests:0,unlinkedDeathReports:0,recordedEvents:0,unassignedHarvests:0,byZone:[],bySpecies:[],byGrind:[]},zones:[],route:[],zoneHistory:[]});
test('phone discovery metadata is bounded, selected-reserve scoped and excludes raw sources',()=>{
 const value=projectZoneData(state()).zoneActivity.discovery;
 assert.equal(value.hiddenZones,7);assert.equal(value.locationAccuracy,'reference_area');assert.equal(value.raw,undefined);assert.equal(value.referenceSha256,undefined);
 assert.deepEqual(projectZoneDiscovery(discovery,true,20),{status:'reference_unavailable',reserve:20});
 assert.equal(projectZoneDiscovery({...discovery,hiddenZones:Infinity},true,19).hiddenZones,undefined);
});
test('a species-gated phone view preserves selection and route-scope statuses',()=>{
 const s=state();s.zoneActivity.discovery={status:'selection_required',reserve:19,hiddenZones:0};
 s.zoneHistory=[{id:'reference:19:2:0',reserve:19,status:'scope_limited',reason:'unconfirmed',snapshot:{name:'SECRET OTHER ANIMAL',x:12345,z:54321}}];
 const projected=projectZoneData(s);
 assert.equal(projected.zoneActivity.discovery.status,'selection_required');
 assert.equal(projected.zoneHistory[0].status,'scope_limited');
 assert.equal(projected.zoneHistory[0].snapshot,null);
 assert.doesNotMatch(JSON.stringify(projected),/SECRET OTHER ANIMAL|12345|54321/);
});
test('spoilers off withholds hidden counts before reading the hidden metadata',()=>{
 const trap=new Proxy({},{get(){throw Error('Hidden metadata touched');}});
 assert.deepEqual(projectZoneDiscovery(trap,false,19),{status:'disabled',reserve:19});
 const s=state();s.settings.spoilers=false;assert.deepEqual(projectZoneData(s).zoneActivity.discovery,{status:'disabled',reserve:19});assert.equal(zoneDiscoveryNotice(s),'');
});
test('unavailable and obsolete references are not presented as zero zones',()=>{
 for(const status of ['loading','reference_unavailable','reference_mismatch','source_unavailable']){
  const s=state();s.zoneActivity.discovery={...discovery,status};const text=zoneDiscoveryNotice(s);assert.doesNotMatch(text,/7 undiscovered|0 undiscovered/);assert.match(text,new RegExp('data-zone-discovery-status="'+status+'"'));
 }
});
test('hidden-only route history never leaks a snapshot to the phone or claims deletion',()=>{
 for(const status of ['spoiler_hidden','reference_unavailable']){
  const s=state();s.route=['saved:19:999:0'];s.zoneHistory=[{id:s.route[0],reserve:19,status,snapshot:{name:'SECRET LOCATION',x:12345,z:54321}}];
  const p=projectZoneData(s);assert.equal(p.zoneHistory[0].snapshot,null);
  const rendered=renderRouteCards(s);assert.doesNotMatch(rendered,/SECRET LOCATION|12345|54321|data-action="zone-loss"|Removed from save/);assert.match(rendered,/Undiscovered/);
 }
});
test('hidden point and hunting action explicitly say reference area, not discovered location',()=>{
 const s=state(),zone={id:'saved:19:101:1',source:'population_path_reference'};
 assert.match(zoneRouteStatus(zone,null,true).label,/Undiscovered/);assert.match(zoneHuntButton(s,zone),/not an exact animal location/);assert.match(zoneHuntButton(s,zone),/data-action="zone-track"/);
});
test('ordinary zone loss keeps the prior pressure and source-readiness distinctions',()=>{
 assert.equal(zoneRouteStatus(null,{status:'removed',reason:'pressure_present'},true).label,'Removed · pressure detected');
 assert.equal(zoneRouteStatus(null,{status:'removed',reason:'pressure_present'},false).state,'stale');
 assert.equal(zoneRouteStatus({source:'save'},null,true).label,'Active zone');
});
