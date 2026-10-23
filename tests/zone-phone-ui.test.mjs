import test from 'node:test';
import assert from 'node:assert/strict';
import {projectZoneData,validateZonePhoneCommand,projectZoneCommandResult} from '../lib/zone-phone.mjs';
import {renderRouteCards,zoneRouteStatus,zoneActivityPanel,zoneTrackingBar,zoneHuntButton,routePlan} from '../public/route-stops.js';
const zone={id:'saved:19:789:2',reserve:19,name:'North lake',species:'Whitetail Deer',source:'save',need:'drinking',start:8,end:12,x:12800,z:7832,males:2,females:1};
const totals={harvests:2,unlinkedDeathReports:1,recordedEvents:3};
const base=()=>({zoneLedgerVersion:1,selectedReserve:19,route:[zone.id],zones:[zone],zoneHistory:[],zoneTracking:{active:false,version:0},zoneActivity:{...totals,unassignedHarvests:0,byZone:[{zoneId:zone.id,...totals,bySpecies:[{species:'Whitetail Deer',...totals}]}],bySpecies:[{species:'Whitetail Deer',...totals}],byGrind:[{sessionId:'g',available:true,...totals,bySpecies:[]}]},sessions:[{id:'g',name:'Evening grind'}],observer:{connected:true,sources:[{name:'found_need_zones_adf',status:'ok'}]}});
test('compact route retains previous location and counts without implying a removed zone is huntable',()=>{
 const state=base();state.zones=[];state.zoneHistory=[{id:zone.id,reserve:19,status:'removed',reason:'pressure_present',snapshot:zone,lastSeenAt:'2026-09-20T12:00:00Z',notes:'Keep tent nearby'}];
 const html=renderRouteCards(state);assert.match(html,/North lake/);assert.match(html,/Removed · pressure detected/);assert.match(html,/does not prove overpressure/);assert.match(html,/X 12800 · Z 7832/);assert.match(html,/08:00–12:00/);assert.match(html,/2<\/b> harvests/);assert.match(html,/Keep tent nearby/);assert.doesNotMatch(html,/Saved stop not found|data-action="zone-track"/);assert.match(html,/data-action="zone-loss"/);
 assert.equal(routePlan(state.route,state.zones).missingCount,1);assert.equal(routePlan(state.route,state.zones).legs.length,0);
});
test('unavailable source is never presented as a newly deleted or overpressured zone',()=>{
 assert.equal(zoneRouteStatus(null,{status:'removed',reason:'pressure_present'},false).state,'stale');
 const state=base();state.observer.sources[0].status='error';assert.match(renderRouteCards(state),/Waiting for readable save/);assert.match(zoneHuntButton(state,zone),/disabled/);
 state.zones=[];assert.doesNotMatch(renderRouteCards(state),/data-action="zone-loss"|overpressure reported/);
});
test('cause is player-reported, inferred overlap or explicitly unconfirmed; they are never conflated',()=>{
 assert.match(zoneRouteStatus(null,{status:'removed',reason:'overpressure_reported'},true).detail,/not an automatic diagnosis/);
 assert.match(zoneRouteStatus(null,{status:'removed',reason:'unconfirmed'},true).label,/cause unconfirmed/);
 assert.equal(zoneRouteStatus(null,null,true).state,'unrecorded');
});
test('view escapes names, notes and species without changing the ordinary actions',()=>{
 const state=base();state.zones=[{...zone,name:'<img onerror="evil">',annotation:{name:'<img onerror="evil">'}}];
 const html=renderRouteCards(state);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/data-action="zone-track"/);assert.match(html,/data-action="zone-view"/);
});
test('phone projection strips raw source/account material and rejects foreign reserve history',()=>{
 const state=base();state.zoneHistory=[{id:zone.id,reserve:19,status:'removed',reason:'unconfirmed',snapshot:{...zone,localizationHash:'SECRET_HASH',sourceFolder:'PRIVATE_PATH'},deviceToken:'PRIVATE_TOKEN'},{id:'other',reserve:7,snapshot:zone}];
 state.zoneTracking.deviceToken='PRIVATE_TOKEN';state.zoneActivity.byZone[0].raw={save:'RAW'};
 const projected=projectZoneData(state);assert.equal(projected.zoneHistory.length,1);assert.doesNotMatch(JSON.stringify(projected),/SECRET_HASH|PRIVATE_PATH|PRIVATE_TOKEN|RAW/);
 assert.equal(projected.zoneActivity.harvests,2);assert.equal(projected.zoneActivity.byGrind[0].unlinkedDeathReports,1);
 assert.deepEqual(projectZoneData({}),{});
});
test('malformed counts do not turn into false zeros and phone arrays are bounded',()=>{
 const state=base();state.zoneActivity.byZone[0].harvests=-1;
 const projected={...state,...projectZoneData(state)};assert.equal(projected.zoneActivity.byZone[0].harvests,null);assert.match(renderRouteCards(projected),/—<\/b> harvests/);
 state.zoneActivity.byZone=Array(5001).fill({});assert.throws(()=>projectZoneData(state),/item limit/);
});
test('tracking and cause commands require safe fields, reserve, request identity and version',()=>{
 const body={op:'zone.track',zoneId:zone.id,reserve:19,expectedVersion:0,requestId:'request_123'};
 assert.equal(validateZonePhoneCommand(body),true);assert.equal(validateZonePhoneCommand({...body,zoneId:null}),true);
 for(const change of [{expectedVersion:-1},{expectedVersion:Number.MAX_SAFE_INTEGER},{reserve:'19'},{owner:'someone_else'},{zoneId:''},{requestId:'tiny'}])assert.throws(()=>validateZonePhoneCommand({...body,...change}));
 assert.equal(validateZonePhoneCommand({op:'zone.loss',zoneId:zone.id,reserve:19,reason:'overpressure',requestId:'request_123'}),true);
 assert.throws(()=>validateZonePhoneCommand({op:'zone.loss',zoneId:zone.id,reserve:19,reason:'confirmed_auto',requestId:'request_123'}));
 assert.deepEqual(projectZoneCommandResult('zone.loss',{zoneId:zone.id,reason:'unconfirmed',rawSave:'secret'}),{zoneId:zone.id,reason:'unconfirmed'});
});
test('location state, species and grind counters remain distinct from exact kill totals',()=>{
 const state=base();const html=zoneActivityPanel(state);assert.match(html,/Evening grind/);assert.match(html,/Whitetail Deer/);assert.match(html,/2 harvests · 1 unlinked death reports/);assert.match(html,/not a saved harvest/);assert.match(html,/not assigned retroactively/);
 state.zoneTracking={active:false,stopReason:'zone_removed'};assert.match(zoneTrackingBar(state),/disappeared; location tracking stopped/);
 state.zoneLedgerVersion=undefined;assert.match(zoneTrackingBar(state),/current PC version/);assert.equal(zoneActivityPanel(state),'');
});
