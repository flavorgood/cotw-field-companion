import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeZoneReference,undiscoveredZoneView} from '../lib/zone-discovery.mjs';
const provenance={reserve:19,sha256:'a'.repeat(64),fetchedAt:'2026-09-20T22:00:00Z'};
const area=(key,tiles=[32896])=>({key,Tiles:tiles,SpawnCenterPoints:[]});
const raw=()=>({center:[9000,9000],scale:[32,32],areas:{test_deer:{population_name:'Test deer',layers:{spawn:{a:area(1)},feed:{b:area(2)},drink:{c:area(3)},rest:{d:area(4)}}}},population_info:{3845994887:{start_times:[0,8,12],need_types:{'0.0':1,'8.0':2,'12.0':3}}}});
const reference={populations:{3845994887:{name:'Whitetail Deer',key:'whitetail'}}};
const population=()=>({populations:[{hash:'3845994887',groups:[{area:1,paths:[2,3,4],animals:[{sex:1},{sex:2}]}]}]});
const catalog=()=>normalizeZoneReference(raw(),provenance);
const view=(extra={})=>undiscoveredZoneView({spoilers:true,reserve:19,population:population(),discoveredZones:[],catalog:catalog(),reference,...extra});
test('spoilers off returns no hidden coordinates or counts and does not inspect them',()=>{
 const hidden=new Proxy({},{get(){throw Error('Hidden data touched');}});
 assert.deepEqual(undiscoveredZoneView({population:hidden,catalog:hidden}),{status:'disabled',zones:[]});
});
test('all three schedule types are resolved from population path IDs, not discoveries',()=>{
 const result=view();assert.equal(result.status,'available');assert.deepEqual(result.zones.map(z=>z.need),['feeding','drinking','resting']);
 assert.ok(result.zones.every(z=>z.discovery==='undiscovered'&&z.source==='population_path_reference'&&z.locationAccuracy==='reference_area'));
 assert.equal(result.zones[1].start,8);assert.equal(result.zones[1].end,12);assert.equal(result.zones[2].end,0);
});
test('a chosen species projects only its assigned population groups',()=>{
 const input=raw(),pop=population();
 input.areas.test_duck={population_name:'Test duck',layers:{spawn:{a:area(101)},feed:{b:area(102)},drink:{c:area(103)},rest:{d:area(104)}}};
 input.population_info[45103783]={start_times:[0,8,12],need_types:{'0.0':1,'8.0':2,'12.0':3}};
 pop.populations.push({hash:'45103783',groups:[{area:101,paths:[102,103,104],animals:[{sex:1}]}]});
 const scope={population:pop,catalog:normalizeZoneReference(input,provenance),reference:{populations:{...reference.populations,45103783:{name:'Mallard',key:'mallard'}}}};
 const all=view(scope),deer=view({...scope,species:'Whitetail Deer'}),duck=view({...scope,species:'Mallard'});
 assert.equal(all.zones.length,6);assert.equal(deer.zones.length,3);assert.equal(duck.zones.length,3);
 assert.ok(deer.zones.every(z=>z.species==='Whitetail Deer'));
 assert.ok(duck.zones.every(z=>z.species==='Mallard'));
});
test('a discovered zone is not duplicated while undiscovered activities remain',()=>{
 const result=view({discoveredZones:[{id:'saved:19:3:1',reserve:19,source:'save'}]});assert.equal(result.zones.length,2);assert.ok(!result.zones.some(z=>z.id==='saved:19:3:1'));
});
test('same IDs on another reserve do not hide this reserve zones',()=>{
 assert.equal(view({discoveredZones:[{id:'saved:19:3:1',reserve:1,source:'save'}]}).zones.length,3);
});
test('wrong-reserve reference is rejected rather than plotting another map',()=>{
 assert.deepEqual(view({catalog:{...catalog(),reserve:1}}),{status:'reference_unavailable',zones:[]});
});
test('missing reference data is not reported as no need zones',()=>{
 assert.deepEqual(view({catalog:null}),{status:'reference_unavailable',zones:[]});
});
test('unreadable population or discovery snapshots do not become fresh undiscovered positions',()=>{
 for(const sourceStatus of ['error','missing','unavailable'])assert.equal(view({sourceStatus}).status,'source_unavailable');
 assert.equal(view({discoveryStatus:'error'}).zones.length,0);assert.equal(view({population:null}).status,'population_unavailable');
});
test('disabled game slots never create fake drink zones',()=>{
 const pop=population();pop.populations[0].groups[0].paths[1]=4294967295;const result=view({population:pop});
 assert.equal(result.disabledSlots,1);assert.deepEqual(result.zones.map(z=>z.need),['feeding','resting']);
});
test('unknown geometry remains unresolved without borrowing a nearby discovery',()=>{
 const pop=population();pop.populations[0].groups[0].paths[1]=900;const result=view({population:pop,discoveredZones:[{id:'other',reserve:19,source:'save',x:1,z:2}]});
 assert.equal(result.status,'partial');assert.equal(result.unresolvedSlots,1);assert.equal(result.zones.length,2);assert.ok(!result.zones.some(z=>z.x===1));
});
test('unsupported schedule length does not infer needs from array indexes',()=>{
 const pop=population();pop.populations[0].groups[0].paths.push(5);const result=view({population:pop});assert.equal(result.zones.length,0);assert.equal(result.unresolvedSlots,4);
});
test('absent schedule type stays unknown instead of assuming every animal drinks',()=>{
 const input=raw();delete input.population_info[3845994887].need_types['8.0'];const result=view({catalog:normalizeZoneReference(input,provenance)});
 assert.equal(result.unresolvedSlots,1);assert.equal(result.zones.length,2);
});
test('groups sharing an assigned zone aggregate without duplicate markers',()=>{
 const pop=population();pop.populations[0].groups.push({area:1,paths:[2,3,4],animals:[{sex:1}]});const result=view({population:pop});
 assert.equal(result.zones.length,3);assert.ok(result.zones.every(z=>z.groups===2&&z.males===2&&z.females===1));
});
test('references not assigned to the population are not presented as occupied zones',()=>{
 const input=raw();input.areas.test_deer.layers.feed.extra=area(100);assert.equal(view({catalog:normalizeZoneReference(input,provenance)}).zones.length,3);
});
test('empty animal groups do not create occupied-zone markers',()=>{
 const pop=population();pop.populations[0].groups[0].animals=[];assert.equal(view({population:pop}).zones.length,0);
});
test('known warren-based population is not treated as ordinary path geometry',()=>{
 const pop=population();pop.populations[0].usesWarrens=true;assert.equal(view({population:pop}).zones.length,0);
});
test('invalid animal sex is not silently omitted from herd totals',()=>{
 const pop=population();pop.populations[0].groups[0].animals.push({sex:4});assert.equal(view({population:pop}).zones.length,0);
});
test('signed reference and path IDs join by their uint32 identity',()=>{
 const input=raw();input.areas.test_deer.layers.feed.b.key=-2147483647;
 const pop=population();pop.populations[0].groups[0].paths[0]=2147483649;
 assert.ok(view({catalog:normalizeZoneReference(input,provenance),population:pop}).zones.some(z=>z.zoneId===2147483649));
});
test('conflicting geometry is quarantined instead of picking an arbitrary record',()=>{
 const input=raw();input.areas.test_deer.layers.feed.duplicate=area(2,[12]);const normalized=normalizeZoneReference(input,provenance);
 assert.equal(normalized.conflictingAreaCount,1);assert.equal(normalized.areas['2'],undefined);assert.equal(view({catalog:normalized}).unresolvedSlots,1);
});
test('tile membership—not an off-area average—defines the display point',()=>{
 const input=raw();input.areas.test_deer.layers.feed.b.Tiles=[32890,32900];const a=normalizeZoneReference(input,provenance).areas['2'];
 const candidates=[32890,32900].map(t=>[(t%256-128+.5)*32+9000,(Math.floor(t/256)-128+.5)*32+9000]);
 assert.ok(candidates.some(([x,z])=>a.x===x&&a.z===z));
});
test('invalid reference tiles and missing provenance fail before producing locations',()=>{
 const input=raw();input.areas.test_deer.layers.feed.b.Tiles=[65536];assert.throws(()=>normalizeZoneReference(input,provenance));
 assert.throws(()=>normalizeZoneReference(raw(),{reserve:19}));
});
test('projection does not mutate discoveries, references or population records',()=>{
 const input={spoilers:true,reserve:19,catalog:catalog(),population:population(),reference,discoveredZones:[]};const before=JSON.stringify(input);undiscoveredZoneView(input);assert.equal(JSON.stringify(input),before);
});
