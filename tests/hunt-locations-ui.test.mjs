/** Pure presentation assertions; not rendered-browser or physical-device evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {locationRows,huntLocationsView} from '../public/hunt-locations.js';
const event=(patch={})=>({id:'h',kind:'harvest',recordSource:'saved_harvest',species:'Whitetail Deer',time:'2026-09-20T12:00:00Z',score:220,reserve:19,reserveName:'Test reserve',location:{basis:'reported_point',x:100,z:200,zoneId:null,zoneName:null,zoneStatus:null},...patch});
test('the location workspace is absent from public reference-only states',()=>{
 assert.equal(huntLocationsView({}), '');assert.equal(huntLocationsView({app:{name:'Public reference'}}),'');
});
test('private grind scope is attached without guessing a current reserve',()=>{
 const html=huntLocationsView({app:{name:'GrindZone',startedAt:'source'},settings:{terrain:false},sessions:[{id:'grind-19',endedAt:null,pausedAt:null}]},{sessionId:'grind-19'});
 assert.match(html,/data-session="grind-19"/);assert.match(html,/data-terrain="false"/);assert.doesNotMatch(html,/data-reserve/);
});
test('the shared Harvests location view uses current grinds, and finished details do not load locations',()=>{
 const state={app:{name:'GrindZone'},sessions:[{id:'paused',endedAt:null,pausedAt:'2026-09-20T12:00:00Z'},{id:'finished',endedAt:'2026-09-20T12:00:00Z',pausedAt:null}]};
 assert.match(huntLocationsView(state),/data-session="active"/);
 assert.match(huntLocationsView(state,{sessionId:'paused'}),/data-session="paused"/);
 for(const sessionId of ['finished','missing']){
  const html=huntLocationsView(state,{sessionId});assert.doesNotMatch(html,/<gz-hunt-locations/);assert.match(html,/journal is preserved/);
 }
});
test('cached parent views explicitly make live location history unavailable',()=>{
 const html=huntLocationsView({app:{name:'GrindZone'},phone:{mode:'cached_snapshot'}});assert.match(html,/data-offline="true"/);
});
test('only explicit terrain consent enables imagery',()=>{
 for(const settings of [{},{terrain:false},{terrain:'true'}])assert.match(huntLocationsView({app:{name:'GrindZone'},settings}),/data-terrain="false"/);
 assert.match(huntLocationsView({app:{name:'GrindZone'},settings:{terrain:true}}),/data-terrain="true"/);
});
test('source and session attributes are escaped, not executable markup',()=>{
 const html=huntLocationsView({app:{name:'GrindZone',startedAt:'" onload="x'},sessions:[{id:'"><script>x</script>',endedAt:null,pausedAt:null}]},{sessionId:'"><script>x</script>'});
 assert.doesNotMatch(html,/<script>|onload="x/);assert.match(html,/&lt;script&gt;/);
});
test('event cards distinguish saved receipts from unlinked harvest reports',()=>{
 assert.match(locationRows([event()]),/Saved harvest/);assert.match(locationRows([event({recordSource:'player_report'})]),/Harvest reported/);
 assert.match(locationRows([event({kind:'shot',recordSource:'player_report'})]),/Shot reported/);
 assert.match(locationRows([event({kind:'death',recordSource:'player_report'})]),/Death reported/);
});
test('unavailable, hidden, and conflicted location states cannot render stray coordinates',()=>{
 for(const basis of ['unavailable','spoiler_hidden','conflicting_association']){
  const html=locationRows([event({location:{basis,x:100,z:200}})]);assert.match(html,/disabled/);assert.match(html,/No mapped point/);assert.doesNotMatch(html,/X 100|Show on map/);
 }
});
test('zero reported coordinates remain visible but invalid reserve or coordinates do not map',()=>{
 assert.match(locationRows([event({location:{basis:'reported_point',x:0,z:0}})]),/X 0 \/ Z 0/);
 for(const patch of [{reserve:-1},{reserve:1000},{location:{basis:'reported_point',x:Infinity,z:0}},{location:{basis:'reported_point',x:100001,z:0}}])assert.match(locationRows([event(patch)]),/No mapped point/);
});
test('selected-zone and removed-zone wording does not imply exact automatic telemetry',()=>{
 const html=locationRows([event({location:{basis:'player_selected_zone',x:100,z:200,zoneName:'North lake',zoneStatus:'removed'}})]);
 assert.match(html,/Player-selected zone · not exact GPS/);assert.match(html,/Zone removed/);assert.match(html,/North lake/);
});
test('all save-derived card text and attribute identities are escaped',()=>{
 const html=locationRows([event({id:'" onclick="x',species:'<img src=x onerror=x>',reserveName:'<script>x</script>',location:{basis:'reported_point',x:100,z:200,zoneName:'<svg onload=x>'}})]);
 assert.doesNotMatch(html,/<img|<script|<svg|data-location-event="" onclick=/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);
});

test('public runtime suppresses private location readers even for a GrindZone-shaped sample',()=>{
 const before=globalThis.document;
 try{globalThis.document={documentElement:{dataset:{runtime:'public'}}};assert.equal(huntLocationsView({app:{name:'GrindZone'},zoneLedgerVersion:1}), '');}
 finally{if(before===undefined)delete globalThis.document;else globalThis.document=before;}
});
