import test from 'node:test';
import assert from 'node:assert/strict';
const previous=globalThis.document;globalThis.document={documentElement:{dataset:{runtime:'local'}}};
const {grindTotal,grindAnimals,selectedGrind,grindsView}=await import('../public/grinds.js');
if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
test('target counts use retained summaries and preserve unknown versus zero',()=>{
 assert.equal(grindTotal({targetSpecies:'Moose'}),null);
 assert.equal(grindTotal({targetSpecies:'Moose',harvestSummary:{total:702,targetTotal:650}}),650);
 assert.equal(grindTotal({targetSpecies:'Moose',harvestSummary:{total:0,bySpecies:[]}}),0);
 assert.equal(grindTotal({targetSpecies:'Moose',harvestSummary:{total:702,bySpecies:[]}}),null);
});
test('current and selected finished grinds remain distinct and goal completion does not imply finished',()=>{
 const old={id:'old',name:'Old',endedAt:'2026-09-01'},active={id:'current',name:'Current',targetSpecies:'Moose',goal:10,endedAt:null,harvestSummary:{total:25,targetTotal:12}};
 const state={sessions:[old,active],reserves:[],harvests:[{species:'Must not leak to this grind'}]};
 assert.equal(selectedGrind(state).id,'current');assert.equal(selectedGrind(state,'old').id,'old');
 const html=grindsView(state);assert.match(html,/Pause grind/);assert.match(html,/Goal reached/);assert.doesNotMatch(html,/Must not leak/);
 active.name='<img onerror=x>';assert.doesNotMatch(grindsView(state),/<img/);
 active.endedAt='2026-09-18';const finished=grindsView(state,{selectedId:active.id});assert.match(finished,/Goal reached<\/span>/);assert.doesNotMatch(finished,/finish when you choose|Pause grind/);
});

const session=(overrides={})=>({id:'selected-grind',name:'Lake circuit',reserve:19,startedAt:'2026-09-18T12:00:00Z',endedAt:null,targetSpecies:'Moose',goal:400,...overrides});
const view=grind=>grindsView({sessions:[grind],reserves:[{id:19,name:'Askiy Ridge'}],harvests:[{species:'GLOBAL ANIMAL MUST NOT LEAK',score:9999}]});

test('retained species counts distinguish the target from other animals independently of recent results',()=>{
 const bySpecies=[{species:'American Mink',count:125},{species:'Red Deer',count:200},{species:'Moose',count:325}],original=structuredClone(bySpecies);
 const grind=session({harvestSummary:{total:650,targetTotal:325,bySpecies,recent:Array.from({length:6},(_,i)=>({species:'Moose',score:i,timestamp:1789732800+i}))}});
 assert.deepEqual(grindAnimals(grind),{total:650,targetSpecies:'Moose',targetTotal:325,otherTotal:325,bySpecies:[{species:'Moose',count:325,target:true},{species:'Red Deer',count:200,target:false},{species:'American Mink',count:125,target:false}]});
 assert.deepEqual(bySpecies,original,'render preparation must not reorder the saved summary');
 const html=view(grind);
 assert.match(html,/325 target harvests/);assert.match(html,/325 other-animal harvests/);
 assert.match(html,/325 \/ 400/);assert.match(html,/<progress[^>]*value="325"[^>]*max="400"/);
 assert.doesNotMatch(html,/Goal reached|GLOBAL ANIMAL MUST NOT LEAK/);
 assert.match(html,/Moose[\s\S]*Target animal[\s\S]*Red Deer[\s\S]*Other animal[\s\S]*200/);
 assert.match(html,/American Mink[\s\S]*125/);
});

test('a target with no harvests is explicitly zero while other species retain their counts',()=>{
 const grind=session({harvestSummary:{total:28,bySpecies:[{species:'Red Deer',count:27},{species:'American Mink',count:1}],recent:[]}});
 assert.equal(grindTotal(grind),0);assert.equal(grindAnimals(grind).otherTotal,28);
 assert.deepEqual(grindAnimals(grind).bySpecies[0],{species:'Moose',count:0,target:true});
 const html=view(grind);assert.match(html,/0 target harvests/);assert.match(html,/28 other-animal harvests/);
 assert.match(html,/0 \/ 400/);assert.doesNotMatch(html,/Goal reached/);
 assert.equal(grindTotal(session({harvestSummary:{total:2,bySpecies:[{species:'moose',count:2}]}})),0,'target matching follows the backend exact species identity');
});

test('legacy grinds without a target use all animals and retain a per-species breakdown',()=>{
 const grind=session({targetSpecies:null,harvestSummary:{total:9,targetTotal:3,bySpecies:[{species:'Moose',count:3},{species:'American Mink',count:6}],recent:[]}});
 assert.equal(grindTotal(grind),9);
 assert.deepEqual(grindAnimals(grind),{total:9,targetSpecies:null,targetTotal:null,otherTotal:null,bySpecies:[{species:'American Mink',count:6,target:false},{species:'Moose',count:3,target:false}]});
 const html=view(grind);assert.match(html,/Choose target animal/);assert.match(html,/No target selected/);assert.match(html,/9 all-animal harvests/);assert.match(html,/9 \/ 400/);
 assert.doesNotMatch(html,/other-animal harvests|<small>Target animal<\/small>/);
});

test('missing saved summary never becomes zero or borrows global harvests',()=>{
 const grind=session(),animals=grindAnimals(grind),html=view(grind);
 assert.deepEqual(animals,{total:null,targetSpecies:'Moose',targetTotal:null,otherTotal:null,bySpecies:null});
 assert.match(html,/target harvests unavailable/);assert.match(html,/other-animal harvests unavailable/);
 assert.match(html,/animal breakdown is unavailable/);assert.doesNotMatch(html,/GLOBAL ANIMAL MUST NOT LEAK|0 target harvests|0 other-animal harvests|<progress/);
 const legacy=view(session({targetSpecies:null}));assert.match(legacy,/all-animal harvests unavailable/);assert.doesNotMatch(legacy,/0 all-animal harvests/);
});

test('known totals survive an unavailable breakdown without inventing species rows',()=>{
 const grind=session({harvestSummary:{total:702,targetTotal:650,recent:[]}}),animals=grindAnimals(grind);
 assert.equal(animals.targetTotal,650);assert.equal(animals.otherTotal,52);assert.equal(animals.bySpecies,null);
 const html=view(grind);assert.match(html,/52 other-animal harvests/);assert.match(html,/animal breakdown is unavailable/);assert.doesNotMatch(html,/<li class="grind-animal-row/);
});

test('malformed counts and species summaries remain unavailable',()=>{
 for(const total of [null,undefined,-1,NaN,Infinity,'12',1.5]){
  const grind=session({harvestSummary:{total,targetTotal:0,bySpecies:[]}});
  assert.equal(grindTotal(grind),null);assert.equal(grindAnimals(grind).otherTotal,null);assert.equal(grindAnimals(grind).bySpecies,null);
 }
 for(const targetTotal of [-1,Infinity,'0',3.5,20])assert.equal(grindTotal(session({harvestSummary:{total:10,targetTotal}})),null);
 for(const bySpecies of [[{species:'Moose',count:null}],[{species:'Moose',count:-1}],[{species:'Moose',count:'3'}],[{species:'',count:3}],[{species:'Moose',count:1},{species:'Moose',count:2}]]){
  const animals=grindAnimals(session({harvestSummary:{total:3,bySpecies}}));
  assert.equal(animals.targetTotal,null);assert.equal(animals.otherTotal,null);assert.equal(animals.bySpecies,null);
 }
});

test('incomplete or contradictory species rows cannot imply zero targets or disagree with the hero',()=>{
 const incomplete=session({harvestSummary:{total:30,bySpecies:[{species:'Red Deer',count:2}]}});
 assert.equal(grindTotal(incomplete),null);assert.equal(grindAnimals(incomplete).otherTotal,null);assert.equal(grindAnimals(incomplete).bySpecies,null);
 const contradiction=session({harvestSummary:{total:30,targetTotal:20,bySpecies:[{species:'Moose',count:10},{species:'Red Deer',count:20}]}}),animals=grindAnimals(contradiction);
 assert.equal(animals.targetTotal,20);assert.equal(animals.otherTotal,10);assert.equal(animals.bySpecies,null);
 assert.match(view(contradiction),/animal breakdown is unavailable/);
});

test('animal details are collapsed initially and Great One species keep their accessible gold styling',()=>{
 const html=view(session({harvestSummary:{total:3,targetTotal:1,bySpecies:[{species:'Red Deer',count:2},{species:'Moose',count:1}]}}));
 const details=html.match(/<details class="grind-animal-breakdown"[^>]*>/)?.[0];
 assert.ok(details);assert.doesNotMatch(details,/\sopen(?:[\s=>])/);assert.match(details,/data-disclosure-key="grind-animals:selected-grind"/);
 const breakdown=html.slice(html.indexOf(details),html.indexOf('</details>',html.indexOf(details)));
 assert.match(breakdown,/great-one-name[^>]*>Moose/);assert.match(breakdown,/great-one-name[^>]*>Red Deer/);
 assert.match(breakdown,/species-accessible-cue/);assert.match(breakdown,/Target animal/);assert.match(breakdown,/Other animal/);
});

test('animal names and session identity cannot inject markup into the breakdown or setup button',()=>{
 const target='<img src=x onerror=alert(1)>',other='<script>alert(2)</script>',grind=session({id:'grind" data-evil="yes',name:'<svg onload=alert(3)>',targetSpecies:target,harvestSummary:{total:3,targetTotal:1,bySpecies:[{species:other,count:2},{species:target,count:1}]}});
 const html=view(grind);assert.doesNotMatch(html,/<img|<script|<svg onload|data-evil="yes/);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(html,/&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
 const setup=html.match(/<button[^>]*data-action="grind-setup"[^>]*>/g);
 assert.equal(setup?.length,1);assert.match(setup[0],/data-id="grind&quot; data-evil=&quot;yes"/);
});

test('setup uses the selected session while pause, resume, finish and history remain available',()=>{
 const current=session({id:'current'}),finished=session({id:'finished',name:'Older grind',endedAt:'2026-09-18T13:00:00Z'});
 const selected=grindsView({sessions:[current,finished]},{selectedId:'finished'});
 assert.match(selected,/data-action="grind-setup" data-id="finished"/);assert.match(selected,/data-action="grind-open" data-id="current"/);
 assert.match(selected,/Continue this grind/);assert.match(selected,/data-action="grind-open" data-id="current"/);assert.doesNotMatch(selected,/data-action="session-end"/);
 const active=view(current);assert.match(active,/data-action="session-pause"/);assert.match(active,/data-action="session-end"/);assert.match(active,/data-action="grind-route"/);
 assert.match(view({...current,pausedAt:'2026-09-18T12:30:00Z'}),/data-action="session-resume"/);
 assert.match(view(finished),/Continue this grind/);
});


test('phone grind flow keeps map route and tracking controls one tap away',()=>{
 const active=view(session());
 const dock=active.match(/<nav class="grind-phone-dock"[\s\S]*?<\/nav>/)?.[0];
 assert.ok(dock);assert.match(dock,/data-action="grind-hunt"/);assert.match(dock,/data-action="grind-route"/);assert.match(dock,/data-action="session-pause"/);
 assert.doesNotMatch(dock,/session-end|session-edit|grind-setup/);
 const paused=view(session({pausedAt:'2026-09-18T12:30:00Z'})).match(/<nav class="grind-phone-dock"[\s\S]*?<\/nav>/)?.[0];
 assert.match(paused,/data-action="session-resume"/);assert.match(paused,/>Resume<\/button>/);
 const finished=view(session({endedAt:'2026-09-18T13:00:00Z'})).match(/<nav class="grind-phone-dock"[\s\S]*?<\/nav>/)?.[0];
 assert.match(finished,/data-action="session-resume"/);assert.match(finished,/>Continue<\/button>/);
 const chosen=session({id:'chosen',endedAt:'2026-09-18T13:00:00Z'}),other=session({id:'other',targetSpecies:'Red Deer'});
 const continueDock=grindsView({sessions:[chosen,other],reserves:[{id:19,name:'Askiy Ridge'}]},{selectedId:'chosen'}).match(/<nav class="grind-phone-dock"[\s\S]*?<\/nav>/)?.[0];
 assert.match(continueDock,/data-action="session-resume"/);assert.doesNotMatch(continueDock,/Other grind active/);
});
test('multiple current grinds have visible switch controls and keep start and pause independent',()=>{
 const one=session({id:'one',name:'Moose',startedAt:'2026-09-18T12:00:00Z'}),two=session({id:'two',name:'Red Deer',startedAt:'2026-09-19T12:00:00Z',pausedAt:'2026-09-19T12:30:00Z'});
 const html=grindsView({sessions:[one,two],reserves:[{id:19,name:'Askiy Ridge'}]},{selectedId:'one'});
 assert.match(html,/Current grinds · 2/);assert.match(html,/data-action="grind-open" data-id="two"/);assert.match(html,/data-action="session-start"/);
 assert.match(html,/data-action="session-pause" data-id="one"/);assert.doesNotMatch(html,/Another grind is active/);
 const paused=grindsView({sessions:[one,two]},{selectedId:'two'});assert.match(paused,/data-action="session-resume" data-id="two"/);
});


test('phone grind bar replaces global navigation only when it provides a way home',async()=>{
 const {readFileSync}=await import('node:fs');
 const html=view(session()),dock=html.match(/<nav class="grind-phone-dock"[\s\S]*?<\/nav>/)?.[0];
 assert.match(dock,/data-action="view-home"/);
 assert.equal((dock.match(/<button /g)||[]).length,4);
 const css=readFileSync(new URL('../public/hunting-workspace.css',import.meta.url),'utf8');
 assert.match(css,/\.hunting-app\[data-view=grinds\]:has\(\.grind-phone-dock\) > \.mobile-nav\{display:none\}/);
 assert.match(css,/\.grind-phone-dock\{position:fixed;z-index:100;display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const nav=index.slice(index.indexOf('<nav class="mobile-nav"'));
 const primary=nav.slice(0,nav.indexOf('<details'));
 assert.match(primary,/data-view="grinds"/);
 assert.match(nav,/<button data-view="career">Stats<\/button>/);
 assert.doesNotMatch(grindsView({sessions:[]}),/class="grind-phone-dock"/);
});
