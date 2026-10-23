import test from 'node:test';
import assert from 'node:assert/strict';
const previous=globalThis.document;globalThis.document={documentElement:{dataset:{runtime:'local'}}};
const {grindActivity,grindsView,GrindActivitySelection}=await import('../public/grinds.js');
if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
const receipt=(id,species='Moose',timestamp=1789732800)=>({id,species,timestamp,score:230.4});
const target=Array.from({length:20},(_,i)=>receipt('target-'+i,'Moose',1789732800-i));
const other=Array.from({length:20},(_,i)=>receipt('other-'+i,'Red Deer',1789733800-i));
const grind=(summary={})=>({id:'one',name:'Moose circuit',targetSpecies:'Moose',startedAt:'2026-09-18T12:00:00Z',endedAt:null,harvestSummary:{total:650,targetTotal:325,bySpecies:[{species:'Moose',count:325},{species:'Red Deer',count:325}],activity:{all:other,target,other},...summary}});
const view=(session,options={})=>grindsView({sessions:[session],harvests:[receipt('global','Not this grind')]},options);

test('each recent filter has independent receipts and full counts even when targets predate the all-animal cap',()=>{
 const session=grind(),before=structuredClone(session);
 assert.equal(grindActivity(session).total,650);
 assert.equal(grindActivity(session).rows.length,4);
 assert.deepEqual(grindActivity(session,{activityFilter:'target'}).rows.map(h=>h.id),target.slice(0,4).map(h=>h.id));
 assert.equal(grindActivity(session,{activityFilter:'target'}).total,325);
 assert.deepEqual(grindActivity(session,{activityFilter:'other'}).rows.map(h=>h.id),other.slice(0,4).map(h=>h.id));
 assert.deepEqual(session,before,'rendering must not mutate receipt order or source');
 const html=view(session,{activityFilter:'target'});
 assert.match(html,/4 of 20 recent/);assert.match(html,/Target <span>325<\/span>/);assert.doesNotMatch(html,/data-grind-harvest-id="other-|Not this grind/);
 assert.match(html,/data-filter="target" data-focus-key="target" aria-pressed="true"/);
});

test('expansion stays bounded and distinguishes the recent window from the full grind',()=>{
 const html=view(grind(),{activityLimit:500});
 assert.equal((html.match(/data-grind-harvest-id=/g)||[]).length,20);
 assert.match(html,/20 of 20 recent/);assert.match(html,/Latest 20 shown. Counts include all 650./);
 assert.doesNotMatch(html,/grind-activity-more/);
 const short=view(grind(),{activityLimit:8});assert.match(short,/Show 4 more/);assert.match(short,/data-focus-key="more"/);
});

test('legacy target-only results cannot masquerade as an all-animal or other-animal history',()=>{
 const session=grind({activity:undefined,recent:target.slice(0,6)});
 assert.equal(grindActivity(session).rows,null);assert.equal(grindActivity(session,{activityFilter:'other'}).rows,null);
 assert.equal(grindActivity(session,{activityFilter:'target'}).rows.length,4);
 assert.match(view(session),/Saved results are unavailable/);assert.doesNotMatch(view(session),/No animals harvested/);
});

test('zero matching harvests remain distinct from missing, contradictory or malformed history',()=>{
 const empty=grind({targetTotal:0,activity:{all:other,target:[],other}});
 assert.deepEqual(grindActivity(empty,{activityFilter:'target'}).rows,[]);
 assert.match(view(empty,{activityFilter:'target'}),/No target animals harvested during this grind yet/);
 for(const activity of [null,{}, {all:[]}, {all:[receipt('wrong','Moose',NaN)]}, {all:[receipt('repeat'),receipt('repeat')]}, {all:[{...receipt('score'),score:'230'}]}]){
  const session=grind({activity});assert.equal(grindActivity(session).rows,null);assert.match(view(session),/Saved results are unavailable/);
 }
 assert.equal(grindActivity(grind({activity:{target:[receipt('wrong','Red Deer')]}}),{activityFilter:'target'}).rows,null);
 assert.equal(grindActivity(grind({total:1,activity:{all:target}})).rows,null);
});

test('untargeted grinds only offer all-animal activity and never call every harvest other',()=>{
 const session={...grind(),targetSpecies:null};
 const html=view(session,{activityFilter:'other'});
 assert.equal(grindActivity(session,{activityFilter:'other'}).filter,'all');
 assert.match(html,/All animals <span>650/);assert.doesNotMatch(html,/data-filter="target"|data-filter="other"|grind-result-kind other/);
});

test('unidentified receipts are visible but never labeled as a confirmed other species',()=>{
 for(const species of ['Species hash 99887766','Species 12345','Unresolved species',null]){
 const row=receipt('unknown',species);
 const session=grind({total:1,targetTotal:0,bySpecies:undefined,activity:{all:[row],target:[],other:[row]}});
 const html=view(session,{activityFilter:'other'});
 assert.match(html,/Other includes unidentified animals/);assert.match(html,/grind-result-kind unidentified">Unidentified/);
 assert.doesNotMatch(html,/grind-result-kind other|Species hash 99887766/);
 }
});

test('filter and expansion survive save refreshes and navigation but reset when the target changes',()=>{
 const choices=new GrindActivitySelection(),first=grind(),second={...grind(),id:'two'};
 choices.change(first,'other');choices.more(first);choices.more(first);
 assert.deepEqual(choices.get({...first,version:18,pausedAt:'2026-09-18T13:00:00Z'}),{activityFilter:'other',activityLimit:12});
 assert.deepEqual(choices.get(second),{});
 choices.change(second,'target');assert.equal(choices.get(first).activityFilter,'other');
 assert.deepEqual(choices.get({...first,targetSpecies:'Red Deer'}),{});
 choices.change(first,'target');assert.deepEqual(choices.get(first),{activityFilter:'target',activityLimit:4});
 for(let i=0;i<30;i++)choices.more(first);assert.equal(choices.get(first).activityLimit,20);
});

test('new activity labels escape identities, use stable focus keys, and retain Great One species styling',()=>{
 const session=grind({total:1,targetTotal:1,bySpecies:[{species:'Moose',count:1}],activity:{all:[{...receipt('x" onclick="evil'),species:'<script>evil</script>'}],target,other}});
 const html=view(session);
 assert.doesNotMatch(html,/<script>|id="x" onclick=/);assert.match(html,/&lt;script&gt;evil&lt;\/script&gt;/);
 assert.match(html,/data-grind-harvest-id="x&quot; onclick=&quot;evil"/);
 const known=view(grind(),{activityFilter:'target'});assert.match(known,/grind-result[^]*great-one-name[^>]*>Moose/);
 assert.match(known,/data-filter="target" data-focus-key="target"/);
 const refreshed=view(grind({total:651,targetTotal:326}),{activityFilter:'target'});assert.match(refreshed,/data-filter="target" data-focus-key="target"/);
});
