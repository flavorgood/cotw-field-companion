import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLocationHistory,locationQuery,locationSearchParams,LOCATION_SCHEMA} from '../lib/hunt-locations.mjs';
const instant='2026-09-20T12:00:00.000Z',stamp=Date.parse(instant)/1000;
const h=(id='h1',timestamp=stamp)=>({id,timestamp,speciesHash:'111',score:240,origin:'observed',seed:'PRIVATE-SEED'});
const v=(id,type,x=null,z=null,observedAt=instant)=>({id,type,x,z,observedAt,createdAt:observedAt,source:'player_report',notes:'PRIVATE-NOTES'});
const e=(evidence,id='e1',reserve=19)=>({id,reserve,species:'Whitetail Deer',evidence,accountId:'PRIVATE-ACCOUNT'});
const zone={id:'zone1',reserve:19,x:8000,z:8100,species:'Whitetail Deer',speciesKey:'whitetail',localizationHash:'111',name:'North lake',source:'save'};
const assignment={harvestId:'h1',zoneId:'zone1',reserve:19,basis:'player_selected_zone'};
const fixture=()=>({harvests:[h()],encounters:[],harvestZones:[],encounterZones:[],zones:[zone],zoneHistory:[],annotations:[],reserves:[{id:19,name:'Askiy Ridge'},{id:1,name:'Other reserve'}],sessions:[{id:'tracking',startedAt:'2026-09-19T00:00:00.000Z',endedAt:null,pausedAt:null,periods:[{startedAt:'2026-09-19T00:00:00.000Z',endedAt:null}]}],sourceStatus:'ok'});
const build=(f,q)=>buildLocationHistory(f,q);
test('unlocated saved harvest stays unlocated: a selected reserve is not a kill coordinate',()=>{
 const d=build(fixture());assert.equal(d.schema,LOCATION_SCHEMA);assert.equal(d.events[0].reserve,null);assert.equal(d.events[0].location.x,null);assert.equal(d.summary.savedHarvests,1);assert.equal(d.summary.unknownLocations,1);
});
test('selected-zone attribution is labeled separately from reported exact points',()=>{
 const f=fixture();f.harvestZones=[assignment];const d=build(f);assert.equal(d.events[0].location.basis,'player_selected_zone');assert.equal(d.events[0].location.x,8000);assert.equal(d.events[0].reserve,19);assert.equal(d.summary.reportedPoints,0);
});
test('deleted zone retains its stored name and coordinates without requiring a current discovery',()=>{
 const f=fixture();f.harvestZones=[assignment];f.zones=[];f.zoneHistory=[{zoneId:'zone1',state:'removed',snapshot:zone}];f.annotations=[{zoneId:'zone1',name:'Renamed old lake'}];const d=build(f);assert.equal(d.events[0].location.zoneStatus,'removed');assert.equal(d.events[0].location.zoneName,'Renamed old lake');assert.equal(d.events[0].location.x,8000);
});
test('shot, death and pickup keep their different reported coordinates',()=>{
 const f=fixture();f.encounters=[e([v('s','shot',1,2),v('d','dead_observed',10,20),{...v('p','harvest_linked',30,40),harvestId:'h1',source:'save_receipt_player_association'}])];
 const d=build(f);for(const [kind,x] of [['shot',1],['death',10],['harvest',30]])assert.equal(d.events.find(r=>r.kind===kind).location.x,x);
 assert.equal(d.summary.total,3);assert.equal(d.summary.savedHarvests,1);assert.equal(d.summary.deathsReported,1);
});
test('pickup without coordinates never borrows the initial shot point',()=>{
 const f=fixture();f.encounters=[e([v('s','shot',1,2),{...v('p','harvest_linked'),harvestId:'h1',source:'save_receipt_player_association'}])];const d=build(f);assert.equal(d.events.find(r=>r.kind==='harvest').location.basis,'unavailable');
});
test('zero coordinates are valid and are not treated as missing',()=>{
 const f=fixture();f.encounters=[e([v('s','shot',0,0)])];assert.equal(build(f).events.find(r=>r.kind==='shot').location.x,0);
});
test('partial or nonfinite coordinates do not create map markers',()=>{
 for(const [x,z] of [[null,1],[NaN,1],[1,Infinity],[100001,0],['1',2]]){const f=fixture();f.encounters=[e([v('s','shot',x,z)])];assert.equal(build(f).events.find(r=>r.kind==='shot').location.x,null);}
});
test('a player harvest report linked to an existing save receipt is not counted twice',()=>{
 const f=fixture();f.encounters=[e([v('r','harvest_player',1,2),{...v('p','harvest_linked',1,2),harvestId:'h1'}])];assert.equal(build(f).summary.savedHarvests,1);assert.equal(build(f).summary.harvestsReported,0);
});
test('an unlinked player harvest is explicitly a report, not an automatic saved receipt',()=>{
 const f=fixture();f.encounters=[e([v('r','harvest_player',1,2)])];const d=build(f);assert.equal(d.summary.savedHarvests,1);assert.equal(d.summary.harvestsReported,1);
});
test('health records, disappearance, hits and alive observations cannot fabricate death events',()=>{
 const f=fixture();f.health=[{CurrentHealth:0}];f.encounters=[e([v('a','alive_observed'),v('b','hit'),v('c','unknown')])];assert.equal(build(f).summary.deathsReported,0);
});
test('conflicting receipt links withhold location instead of picking the last encounter',()=>{
 const f=fixture();f.encounters=[e([{...v('a','harvest_linked',1,2),harvestId:'h1'}]),e([{...v('b','harvest_linked',10,20),harvestId:'h1'}],'e2',1)];const d=build(f);assert.equal(d.events[0].location.basis,'conflicting_association');assert.equal(d.events[0].reserve,null);
});
test('cross-reserve association conflicts withhold location',()=>{
 const f=fixture();f.harvestZones=[assignment];f.encounters=[e([{...v('a','harvest_linked',1,2),harvestId:'h1'}],'e1',1)];const d=build(f);assert.equal(d.events[0].location.x,null);assert.equal(d.events[0].reserve,null);
});
test('duplicate identical receipts are counted once and conflicting identities are withheld',()=>{
 const f=fixture();f.harvests.push({...h()});assert.equal(build(f).summary.total,1);f.harvests.push({...h(),score:1});assert.equal(build(f).summary.total,0);assert.equal(build(f).invalid.harvests,1);
});
test('duplicate identical assignments do not turn one receipt into two events',()=>{
 const f=fixture();f.harvestZones=[assignment,{...assignment,assignedAt:instant}];assert.equal(build(f).summary.total,1);assert.equal(build(f).summary.selectedZones,1);
});
test('conflicting assignments cannot move a harvest to a different reserve',()=>{
 const f=fixture();f.harvestZones=[assignment,{...assignment,reserve:1,zoneId:'zone2'}];assert.equal(build(f).events[0].location.basis,'conflicting_association');
});
test('spoilers-off removes undiscovered coordinates, names and zone filters',()=>{
 const f=fixture();f.harvestZones=[assignment];f.zones=[{...zone,source:'population_path_reference',name:'SECRET-HIDDEN',species:'SECRET-SPECIES'}];const d=build(f);assert.equal(d.events[0].location.basis,'spoiler_hidden');assert.equal(d.facets.zones.length,0);assert.doesNotMatch(JSON.stringify(d),/SECRET|8000|8100/);
});
test('remembered undiscovered selection stays explicitly hidden after its geometry is withheld',()=>{
 const f=fixture();f.harvestZones=[assignment];f.zones=[];f.hiddenZoneIds=['zone1'];assert.equal(build(f).events[0].location.basis,'spoiler_hidden');
});
test('spoiler consent permits assigned reference areas but never upgrades them to exact locations',()=>{
 const f=fixture();f.harvestZones=[assignment];f.spoilers=true;f.zones=[{...zone,source:'population_path_reference'}];assert.equal(build(f).events[0].location.basis,'player_selected_zone');
});
test('discovered former hidden selection remains visible without population spoilers',()=>{
 const f=fixture();f.harvestZones=[assignment];f.hiddenZoneIds=['zone1'];assert.equal(build(f).events[0].location.basis,'player_selected_zone');
});
test('grind filters use tracking windows and exclude pause time',()=>{
 const f=fixture();f.harvests=[h('before',stamp-10),h('during',stamp+10),h('paused',stamp+70),h('resumed',stamp+130)];
 f.sessions=[{id:'g',startedAt:instant,endedAt:null,pausedAt:null,periods:[{startedAt:instant,endedAt:'2026-09-20T12:01:00.000Z'},{startedAt:'2026-09-20T12:02:00.000Z',endedAt:null}]}];f.now=Date.parse('2026-09-20T12:03:00.000Z');
 const d=build(f,{session:'g'});assert.deepEqual(new Set(d.events.map(r=>r.harvestId)),new Set(['during','resumed']));assert.equal(d.summary.total,2);
});
test('default location scope is the deduplicated union of current grinds, with no all-history fallback',()=>{
 const f=fixture();f.harvests=[h('before',stamp-10),h('one',stamp+10),h('overlap',stamp+30),h('two',stamp+70),h('paused',stamp+110),h('after',stamp+150)];
 f.sessions=[{id:'one',startedAt:instant,endedAt:null,pausedAt:null,periods:[{startedAt:instant,endedAt:null}]},{id:'two',startedAt:new Date((stamp+20)*1000).toISOString(),endedAt:null,pausedAt:null,periods:[{startedAt:new Date((stamp+20)*1000).toISOString(),endedAt:'2026-09-20T12:01:40.000Z'},{startedAt:'2026-09-20T12:02:20.000Z',endedAt:null}]}];
 f.now=Date.parse('2026-09-20T12:02:00.000Z');
 const both=build(f);assert.equal(both.query.session,'active');assert.deepEqual(new Set(both.events.map(r=>r.harvestId)),new Set(['one','overlap','two','paused']));assert.equal(both.summary.total,4,'overlap appears only once in the combined view');
 assert.deepEqual(new Set(build(f,{session:'two'}).events.map(r=>r.harvestId)),new Set(['overlap','two']));
 f.sessions[0].pausedAt='2026-09-20T12:00:50.000Z';f.sessions[0].periods[0].endedAt=f.sessions[0].pausedAt;
 assert.deepEqual(new Set(build(f).events.map(r=>r.harvestId)),new Set(['one','overlap','two']),'pausing preserves earlier locations but adds none during the pause');
 assert.deepEqual(new Set(build(f,{session:'one'}).events.map(r=>r.harvestId)),new Set(['one','overlap']));
 f.sessions[1].endedAt='2026-09-20T12:03:00.000Z';f.sessions[1].periods[1].endedAt=f.sessions[1].endedAt;
 assert.deepEqual(new Set(build(f).events.map(r=>r.harvestId)),new Set(['one','overlap']));
 f.sessions[0].endedAt='2026-09-20T12:03:00.000Z';f.sessions[0].pausedAt=null;
 assert.equal(build(f).summary.total,0);assert.equal(build(f).journalEventTotal,0);
 assert.throws(()=>build(f,{session:'one'}),error=>error.status===409);
 assert.throws(()=>build(f,{session:'two'}),error=>error.status===409);
});
test('missing or invalid grind history cannot silently fall back to all events',()=>{
 assert.throws(()=>build(fixture(),{session:'not-found'}),e=>e.status===404);
 const f=fixture();f.sessions=[{id:'bad',startedAt:'no-date'}];assert.throws(()=>build(f,{session:'bad'}),e=>e.status===409);
});
test('reserve, zone, species, event type and precision filters combine without rewriting totals',()=>{
 const f=fixture();f.harvestZones=[assignment];f.encounters=[e([v('s','shot',1,2),v('d','dead_observed',3,4)])];f.encounterZones=[{encounterId:'e1',zoneId:'zone1',reserve:19}];
 const d=build(f,{reserve:19,zone:'zone1',species:'Whitetail Deer',kind:'death',precision:'point'});assert.equal(d.summary.total,1);assert.equal(d.events[0].kind,'death');
});
test('pagination filters the entire retained history before taking a page',()=>{
 const f=fixture();f.harvests=Array.from({length:1200},(_,i)=>h('h'+i,stamp+i));f.harvestZones=f.harvests.map((x,i)=>({...assignment,harvestId:x.id,reserve:i===0?19:1,zoneId:i===0?'zone1':'zone2'}));
 const d=build(f,{reserve:19});assert.equal(d.summary.total,1);assert.equal(d.events[0].harvestId,'h0');
 const p=build(f,{limit:100});assert.equal(p.summary.total,1200);assert.equal(p.events.length,100);assert.equal(p.nextOffset,100);
 const p2=build(f,{limit:100,offset:p.nextOffset,revision:p.revision});assert.equal(p2.events.length,100);assert.equal(p2.events.some(r=>p.events.some(a=>a.id===r.id)),false);
});
test('changed history rejects the old page cursor instead of skipping or duplicating rows',()=>{
 const f=fixture();f.harvests=[h('a'),h('b')];const page=build(f,{limit:1});f.harvests.push(h('c',stamp+1));assert.throws(()=>build(f,{offset:1,limit:1,revision:page.revision}),e=>e.status===409);
});
test('retained records remain visible and explicitly stale when the save is missing',()=>{
 const f=fixture();f.sourceStatus='missing';assert.equal(build(f).sourceStatus,'retained');assert.equal(build(f).summary.savedHarvests,1);
});
test('no account, filesystem path, raw source, seeds or notes leak into the projection',()=>{
 const f=fixture();f.encounters=[e([v('s','shot',1,2)])];f.harvests[0].path='PRIVATE-PATH';const text=JSON.stringify(build(f));assert.doesNotMatch(text,/PRIVATE|seed|accountId|notes/);
});
test('building and paging history never mutates the input',()=>{
 const f=fixture();f.harvestZones=[assignment];const original=structuredClone(f);build(f);assert.deepEqual(f,original);
});
test('query rejects identities, arbitrary paths, malformed and duplicated filters',()=>{
 for(const q of [{profile:'other'},{path:'../save'},{limit:101},{limit:0},{offset:-1},{reserve:'1e2'},{reserve:null,kind:'kill'},{precision:'exact'},{species:[]},{session:{}},{revision:'x'}])assert.throws(()=>locationQuery(q));
 for(const q of ['reserve=1&reserve=19','__proto__=x','constructor=x'])assert.throws(()=>locationSearchParams(new URLSearchParams(q)));
});
test('new attributed receipts retain their captured zone coordinates after geometry changes',()=>{
 const f=fixture();f.harvestZones=[{...assignment,snapshot:{...zone,capturedAt:instant}}];f.zones=[{...zone,x:9999,z:9999}];const d=build(f);assert.equal(d.events[0].location.x,8000);assert.equal(d.events[0].location.capturedAt,instant);
});
test('captured undiscovered snapshots cannot bypass later spoiler revocation',()=>{
 const f=fixture();f.zones=[];f.harvestZones=[{...assignment,snapshot:{...zone,source:'population_path_reference',name:'SECRET-HIDDEN',capturedAt:instant}}];const d=build(f);assert.equal(d.events[0].location.basis,'spoiler_hidden');assert.doesNotMatch(JSON.stringify(d),/SECRET-HIDDEN|8000|8100/);
});

test('future-dated observations cannot enter the current grind before their time',()=>{
 const f=fixture();f.now=Date.parse(instant)+15000;f.harvests=[h('current',stamp+10),h('future',stamp+20)];
 f.sessions=[{id:'g',startedAt:instant,endedAt:null,pausedAt:null,periods:[{startedAt:instant,endedAt:null}]}];
 assert.deepEqual(build(f,{session:'g'}).events.map(r=>r.harvestId),['current']);
});
test('readable harvests do not label an unreadable zone source as current',()=>{
 const f=fixture();f.harvestZones=[assignment];f.zoneSourceStatus='missing';
 const d=build(f);assert.equal(d.sourceStatus,'current');assert.equal(d.events[0].location.zoneStatus,'retained');
});
