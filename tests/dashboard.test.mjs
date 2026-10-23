import test from 'node:test';
import assert from 'node:assert/strict';
const beforeDocument=globalThis.document;
globalThis.document={documentElement:{dataset:{runtime:'local'}}};
const {dashboardData,dashboardView}=await import('../public/dashboard.js');
if(beforeDocument===undefined)delete globalThis.document;else globalThis.document=beforeDocument;

const state=()=>({sessions:[],harvests:[],route:[],zones:[],reserves:[{id:19,name:'Askiy Ridge'},{id:2,name:'Layton Lake'}],career:{counters:[],summary:{}}});
test('dashboard uses durable grind total rather than its truncated recent harvest window',()=>{
 const s=state();s.sessions=[{id:'active',name:'Grind',startedAt:'2026-09-01',endedAt:null,harvestSummary:{total:650}}];s.harvests=[{id:'last',species:'Moose',timestamp:1000,score:100}];
 const d=dashboardData(s,19);assert.equal(d.grindCount,650);assert.equal(d.recent.length,1);
});
test('dashboard prefers the current grind and otherwise the most recently finished one',()=>{
 const s=state();const old={id:'old',endedAt:'2026-09-01'},latest={id:'latest',endedAt:'2026-09-03'},active={id:'active',startedAt:'2026-09-02',endedAt:null};s.sessions=[old,latest,active];
 assert.equal(dashboardData(s,19).grind.id,'active');s.sessions.pop();assert.equal(dashboardData(s,19).grind.id,'latest');
});
test('missing grind summary stays unknown while a real zero stays zero',()=>{
 const s=state();s.sessions=[{endedAt:null}];assert.equal(dashboardData(s,19).grindCount,null);s.sessions[0].harvestSummary={total:0};assert.equal(dashboardData(s,19).grindCount,0);
});
test('activity is newest first without mutating the save state and rejects invalid dates',()=>{
 const s=state();s.harvests=[{id:'early',timestamp:1000},{id:'invalid',timestamp:1e30},{id:'later',timestamp:2000},{id:'missing',timestamp:null}];
 assert.deepEqual(dashboardData(s,19).recent.map(h=>h.id),['later','early']);assert.equal(s.harvests[0].id,'early');
});
test('dashboard preserves an unavailable first route stop and keeps its reserve distinct from the grind',()=>{
 const s=state();s.sessions=[{reserve:2,name:'Layton',endedAt:null,harvestSummary:{total:21}}];s.route=['missing','known'];s.zones=[{id:'known',species:'Moose'}];
 const d=dashboardData(s,19);assert.equal(d.reserveName,'Askiy Ridge');assert.equal(d.grindCount,21);assert.equal(d.route[0].zone,null);assert.equal(d.route[1].number,2);assert.equal(d.missingStops,1);
 const html=dashboardView(s,{reserve:19});assert.match(html,/All animals · all maps/);assert.match(html,/Askiy Ridge/);assert.doesNotMatch(html,/Next stop/);
});
test('dashboard escapes saved names and never invents medal values for unknown counters',()=>{
 const s=state();s.sessions=[{name:'<img src=x onerror=alert(1)>',endedAt:null}];const html=dashboardView(s,{reserve:19});
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/aria-label="Not available"/);
});
test('unknown species codes have a readable label without inventing an animal identity',()=>{
 const s=state();s.harvests=[{species:'Species hash 3927060704',timestamp:1000,score:343.14}];
 const html=dashboardView(s,{reserve:19});assert.match(html,/Unidentified animal/);assert.doesNotMatch(html,/3927060704/);assert.match(html,/343\.14/);
});
