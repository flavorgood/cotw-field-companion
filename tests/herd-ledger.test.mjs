import test from 'node:test';
import assert from 'node:assert/strict';
import {recordHerds,readHerdLedger} from '../lib/herd-ledger.mjs';
const memory=()=>{const data=new Map();return {get:(k,f=null)=>data.has(k)?structuredClone(data.get(k)):f,set:(k,v)=>data.set(k,structuredClone(v))};};
const animal=(id,extra={})=>({sex:1,weight:70,score:200,seed:id,nativeId:String(id),flags:0,scripted:false,...extra});
const group=(ids,area=1,paths=[101,102,103])=>({area,paths,animals:ids.map(id=>animal(id))});
const source=(groups,{seed='reserve-A',sha='A',time='2026-09-21T12:00:00Z',revision=1,species='100'}={})=>({sha,mtime:time,payload:{seed,populations:[{hash:species,revision,groups}]}});
const active=s=>readHerdLedger(s,'p',19).records.filter(r=>r.active);
test('every group, including solitary and empty groups, gets a distinct durable ID',()=>{
 const s=memory();recordHerds(s,'p',19,source([group([1,2]),group([3],2),group([],3)]));const rows=active(s);
 assert.equal(new Set(rows.map(r=>r.id)).size,3);assert.equal(new Set(rows.map(r=>r.label)).size,3);assert(rows.every(r=>/^H-\d{6}$/.test(r.label)));
});
test('group order and member order do not change herd IDs',()=>{
 const s=memory();recordHerds(s,'p',19,source([group([1,2]),group([3,4],2)]));const before=active(s);
 recordHerds(s,'p',19,source([group([4,3],2),group([2,1])],{sha:'B'}));const now=active(s);
 assert.equal(now[0].id,before[1].id);assert.equal(now[1].id,before[0].id);
});
test('unambiguous surviving members preserve the herd through population changes',()=>{
 const s=memory();recordHerds(s,'p',19,source([group([1,2,3])]));const id=active(s)[0].id;
 recordHerds(s,'p',19,source([group([2,3,4])],{sha:'B'}));assert.equal(active(s)[0].id,id);assert.equal(active(s)[0].continuity,'shared_members');
});
test('changing zone assignments preserves member-linked herd identity and old paths',()=>{
 const s=memory();recordHerds(s,'p',19,source([group([1,2])]));const id=active(s)[0].id;
 recordHerds(s,'p',19,source([group([1,2],4,[105,102,106])],{sha:'B'}));const row=active(s)[0];
 assert.equal(row.id,id);assert.deepEqual(row.paths,[105,102,106]);assert.deepEqual(row.routeHistory[0].paths,[101,102,103]);
});
test('full member replacement at a unique assignment preserves a labeled tracked group',()=>{
 const s=memory();recordHerds(s,'p',19,source([group([1,2])]));const id=active(s)[0].id;
 recordHerds(s,'p',19,source([group([3,4])],{sha:'B'}));assert.equal(active(s)[0].id,id);assert.equal(active(s)[0].continuity,'unique_saved_assignment');
});
test('different groups sharing zones remain distinct and reverse links may name both',()=>{
 const s=memory();recordHerds(s,'p',19,source([group([1]),group([2])]));const ids=active(s).map(r=>r.id);
 recordHerds(s,'p',19,source([group([2]),group([1])],{sha:'B'}));assert.deepEqual(active(s).map(r=>r.id),ids.reverse());
});
test('ambiguous identical groups are not silently associated with an arbitrary prior herd',()=>{
 const s=memory();recordHerds(s,'p',19,source([group([1]),group([1])]));const before=active(s).map(r=>r.id);
 recordHerds(s,'p',19,source([group([1]),group([1])],{sha:'B'}));assert(active(s).every(r=>!before.includes(r.id)&&r.continuity==='new_ambiguous'));
});
for(const options of [{seed:'reset'}, {revision:2}, {time:'2026-09-20T12:00:00Z'}])test('reset or rollback starts fresh IDs without erasing old records: '+JSON.stringify(options),()=>{
 const s=memory();recordHerds(s,'p',19,source([group([1])]));const id=active(s)[0].id;
 recordHerds(s,'p',19,source([group([1])],{sha:'B',...options}));assert.notEqual(active(s)[0].id,id);assert(readHerdLedger(s,'p',19).records.some(r=>r.id===id&&!r.active));
});
test('unchanged reads are idempotent and do not change the label counter',()=>{
 const s=memory(),data=source([group([1])]);recordHerds(s,'p',19,data);const previous=readHerdLedger(s,'p',19);
 assert.equal(recordHerds(s,'p',19,data),false);assert.deepEqual(readHerdLedger(s,'p',19),previous);assert.equal(s.get('herd-sequence:p'),1);
});
test('IDs and labels are scoped safely across reserves and player profiles',()=>{
 const s=memory(),data=source([group([1])]);recordHerds(s,'p',19,data);recordHerds(s,'p',20,data);recordHerds(s,'q',19,data);
 const a=active(s)[0],b=readHerdLedger(s,'p',20).records[0],c=readHerdLedger(s,'q',19).records[0];assert.notEqual(a.id,b.id);assert.notEqual(a.label,b.label);assert.notEqual(a.id,c.id);
});
test('ten thousand distinct groups reconcile without quadratic pair scans',()=>{
 const s=memory(),groups=Array.from({length:10000},(_,i)=>group([i+1],i));recordHerds(s,'p',19,source(groups));const before=active(s).map(r=>r.id);
 recordHerds(s,'p',19,source(groups.slice().reverse(),{sha:'B'}));assert.deepEqual(active(s).map(r=>r.id),before.reverse());
});
test('unsupported population snapshots leave the prior ledger untouched',()=>{
 const s=memory();recordHerds(s,'p',19,source([group([1])]));const prior=readHerdLedger(s,'p',19);
 assert.throws(()=>recordHerds(s,'p',19,source([{area:1,paths:[NaN],animals:[]}],{sha:'B'})));assert.deepEqual(readHerdLedger(s,'p',19),prior);
});
