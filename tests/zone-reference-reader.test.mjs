import test from 'node:test';
import assert from 'node:assert/strict';
import {ZoneReferenceReader,fetchZoneReference} from '../lib/zone-reference.mjs';
import {activityLedger,assignNewHarvests} from '../lib/zone-ledger.mjs';
const raw=()=>({center:[8192,8192],scale:[32,32],areas:{deer:{layers:{'2':{a:{key:101,Tiles:[32896],SpawnCenterPoints:[]}}}}},population_info:{'11':{start_times:[0,8,16],need_types:{'0.0':1,'8.0':2,'16.0':3}}}});
const store=()=>{const data=new Map();return {get:(k,f)=>data.get(k)??f,set:(k,v)=>data.set(k,v),data,journal:()=>[]};};
const response=()=>new Response(JSON.stringify(raw()),{headers:{'Content-Type':'application/json'}});
test('reader is inert before consent and only GETs the fixed reserve catalogue',async()=>{
 const calls=[],s=store(),r=new ZoneReferenceReader(s,{fetchImpl:async(...args)=>{calls.push(args);return response();}});
 assert.equal(await r.ensure(19),null);assert.equal(await r.ensure('../save',{enabled:true}),null);assert.equal(calls.length,0);
 const c=await r.ensure(19,{enabled:true});assert.equal(c.reserve,19);assert.equal(calls.length,1);
 assert.equal(calls[0][0],'https://mathartbang.com/deca/hp/data/r19/reserve.json');assert.equal(calls[0][1].method,'GET');assert.equal(calls[0][1].redirect,'error');assert.equal(calls[0][1].body,undefined);assert.equal(calls[0][1].credentials,'omit');r.close();
});
test('concurrent reads share one request and the validated cache survives reader restart',async()=>{
 let count=0;const s=store(),f=async()=>{count++;return response();},r=new ZoneReferenceReader(s,{fetchImpl:f});
 const [a,b]=await Promise.all([r.ensure(19,{enabled:true}),r.ensure(19,{enabled:true})]);assert.equal(a,b);assert.equal(count,1);r.close();
 const next=new ZoneReferenceReader(s,{fetchImpl:async()=>{throw Error('Should use cache');}});assert.equal((await next.ensure(19,{enabled:true})).sha256,a.sha256);next.close();
});
test('a late public response cannot repopulate the cache after disabling spoilers',async()=>{
 let finish;const s=store(),r=new ZoneReferenceReader(s,{fetchImpl:()=>new Promise(resolve=>finish=resolve)}),pending=r.ensure(19,{enabled:true});
 r.suspend();finish(response());assert.equal(await pending,null);assert.equal(s.data.size,0);assert.equal(r.catalog(19),null);r.close();
});
test('a response after close never writes into a closed journal',async()=>{
 let finish,writes=0;const r=new ZoneReferenceReader({get:()=>null,set:()=>writes++},{fetchImpl:()=>new Promise(resolve=>finish=resolve)});
 const p=r.ensure(19,{enabled:true});r.close();finish(response());await p;assert.equal(writes,0);
});
test('failed public reference leaves game tracking separate and applies retry backoff',async()=>{
 let now=0,requests=0;const r=new ZoneReferenceReader(store(),{now:()=>now,fetchImpl:async()=>{requests++;throw Error('network');}});
 assert.equal(await r.ensure(19,{enabled:true}),null);assert.equal(r.status(19),'unavailable');await r.ensure(19,{enabled:true});assert.equal(requests,1);now=60001;await r.ensure(19,{enabled:true});assert.equal(requests,2);r.close();
});
test('expired and tampered public caches are not used for hidden locations',async()=>{
 let now=Date.now(),count=0;const s=store(),f=async()=>{count++;return response();};
 const a=new ZoneReferenceReader(s,{now:()=>now,fetchImpl:f});await a.ensure(19,{enabled:true});a.close();
 now+=8*86400000;const b=new ZoneReferenceReader(s,{now:()=>now,fetchImpl:f});await b.ensure(19,{enabled:true});assert.equal(count,2);b.close();
 s.data.get('zone-reference:19').digest='0'.repeat(64);const c=new ZoneReferenceReader(s,{now:()=>now,fetchImpl:f});await c.ensure(19,{enabled:true});assert.equal(count,3);c.close();
});
test('invalid public JSON, unsupported shape and large advertised bodies fail closed',async()=>{
 for(const f of [async()=>new Response('<html>not JSON</html>'),async()=>new Response('{}'),async()=>new Response('{}',{headers:{'content-length':String(50*1024*1024)}}),async()=>new Response('{}',{status:404})]){
  await assert.rejects(()=>fetchZoneReference(19,{fetchImpl:f}));
 }
});
test('no more than two catalogues download concurrently',async()=>{
 const pending=[];const r=new ZoneReferenceReader(store(),{fetchImpl:()=>new Promise(resolve=>pending.push(resolve))});
 const a=r.ensure(19,{enabled:true}),b=r.ensure(20,{enabled:true});assert.equal(await r.ensure(21,{enabled:true}),null);assert.equal(pending.length,2);assert.equal(r.status(21),'queued');pending.forEach(f=>f(response()));await Promise.all([a,b]);r.close();
});
test('repaired ledger loads and returns actual species/grind/zone aggregates',()=>{
 const s=store(),out=activityLedger(s,'synthetic',{harvests:[{id:'one',species:'Moose',timestamp:1789910000}],encounters:[],sessionWindows:[],now:1789910010000});
 assert.equal(out.harvests,1);assert.equal(out.bySpecies[0].species,'Moose');assert.equal(out.unassignedHarvests,1);
});
test('new-receipt attribution retains deduplication after the syntax repair',()=>{
 const data=store(),rows=[];data.set('zone-tracking:p',{active:true,zoneId:'z',reserve:19,version:1,startedAt:'2026-09-20T00:00:00Z'});data.journal=()=>rows;data.put=(_p,_k,row)=>rows.push(row);
 const h={id:'synthetic-receipt',origin:'observed',timestamp:Date.parse('2026-09-20T00:01:00Z')/1000};const args={currentReserve:19,sourceStatus:'ok',observedAt:'2026-09-20T00:02:00Z'};
 assert.equal(assignNewHarvests(data,'p',[h],args),1);assert.equal(assignNewHarvests(data,'p',[h],args),0);
});
