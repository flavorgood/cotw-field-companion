import test from 'node:test';
import assert from 'node:assert/strict';
import {PhoneSnapshotCache,cacheAuthority,snapshotState,storedView,CACHE_SCHEMA,CACHE_RETENTION_MS,CACHE_HUNT_REFRESH_MS} from '../public/phone-cache.js';
const NOW=Date.parse('2026-09-20T12:00:00Z'),A='a'.repeat(43),B='b'.repeat(43);
const state=(reserve=19,spoilers=false)=>({selectedReserve:reserve,settings:{spoilers,terrain:false},phone:{mode:'live_relay'},app:{name:'GrindZone'},reserves:[{id:reserve,name:'Synthetic reserve'}],zones:[{id:'saved:'+reserve+':1:0',reserve}],sessions:[{id:'synthetic-grind',name:'Synthetic grind'}],harvests:[{id:'receipt',timestamp:1}],observer:{connected:true,lastCycle:'2026-09-20T11:59:00Z',sources:[{name:'hunting_log_adf',mtime:'2026-09-20T11:58:00Z',checked:'2026-09-20T11:59:00Z',status:'ok'}]},huntingPressure:{status:'available',stale:false},zoneTracking:{active:true,zoneId:'one'},profile:'PRIVATE_PROFILE',token:'PRIVATE_TOKEN',unknown:'PRIVATE_FUTURE_FIELD'});
class MemoryStore{
 constructor(){this.root=null;this.fail=false;}
 async read(){if(this.fail)throw Error('Storage blocked');return structuredClone(this.root);}
 async edit(fn){if(this.fail)throw Error('Storage blocked');const {root,result}=fn(structuredClone(this.root));if(root!==undefined)this.root=structuredClone(root);return result;}
}
function fixture(){
 const store=new MemoryStore();let scope=A,now=NOW,status=200,view=state(),scopedView=null,errorScope=null;
 const calls=[];
 const fetchImpl=async url=>{calls.push(url);const boot=url.endsWith('/api/bootstrap'),scoped=new URL(url,'https://grindzone.invalid').searchParams.has('huntSpecies');return new Response(JSON.stringify(boot?{selectedReserve:19,token:'csrf-not-stored',phone:{remote:true}}:status===200?scoped&&scopedView?scopedView:view:{error:'PC unavailable'}),{status:boot?200:status,headers:{'content-type':'application/json','x-grindzone-cache-scope':errorScope||scope,'x-grindzone-cache-expires':String(NOW+30*86400000)}});};
 const cache=new PhoneSnapshotCache({store,fetchImpl,now:()=>now});
 return {store,cache,calls,setScope:s=>scope=s,setErrorScope:s=>errorScope=s,setTime:t=>now=t,setStatus:s=>status=s,setView:v=>view=v,setScopedView:v=>scopedView=v,async keep(){const v=await cache.get('/api/state?reserve=19');await cache.enable(v);return v;}};
}
test('authority requires a verified remote bootstrap, opaque scope and unexpired time',()=>{
 const boot={phone:{remote:true,cache:{scope:A,expiresAt:NOW+1}}};assert.deepEqual(cacheAuthority(boot,NOW),{scope:A,expiresAt:NOW+1});
 for(const value of [null,{}, {phone:{remote:false,cache:boot.phone.cache}}, {phone:{remote:true,cache:{scope:'profile-id',expiresAt:NOW+1}}}, {phone:{remote:true,cache:{scope:A,expiresAt:NOW}}}])assert.equal(cacheAuthority(value,NOW),null);
});
test('snapshot excludes credentials, private profile and observer folder while preserving source times',()=>{
 const v=state();v.observer.sourceFolder='PRIVATE_SAVE_FOLDER';const s=snapshotState(v,19),text=JSON.stringify(s);assert.doesNotMatch(text,/PRIVATE_|csrf/);assert.equal(s.observer.sources[0].mtime,v.observer.sources[0].mtime);assert.equal(s.harvests[0].id,'receipt');
});
test('non-phone, mismatched reserve and oversized views are rejected',()=>{
 assert.throws(()=>snapshotState({...state(),phone:{mode:'cached_snapshot'}},19));assert.throws(()=>snapshotState(state(1),19));assert.throws(()=>snapshotState({...state(),harvests:['x'.repeat(3*1024*1024)]},19));assert.throws(()=>snapshotState({...state(),huntSpeciesOptions:['Mallard']},19),/complete live/);
});
test('normal live reads persist only a revocation guard before opt-in',async()=>{const f=fixture();await f.cache.get('/api/state?reserve=19');assert.deepEqual(Object.keys(f.store.root).sort(),['enabled','epoch','expiresAt','records','schema','scope','spoilerMode']);assert.equal(f.store.root.enabled,false);assert.deepEqual(f.store.root.records,[]);assert.equal(f.cache.enabled,false);assert.equal(f.cache.readOnly,false);});
test('consent stores the actual most recent authenticated state, never an arbitrary supplied state',async()=>{
 const f=fixture();await f.cache.get('/api/state?reserve=19');await assert.rejects(f.cache.enable(state()));assert.equal(f.store.root.enabled,false);assert.deepEqual(f.store.root.records,[]);await f.keep();assert.equal(f.store.root.enabled,true);assert.equal(f.store.root.records.length,1);
});
test('an offline PC returns the same saved grind with unmistakable read-only and stale-pressure state',async()=>{
 const f=fixture();await f.keep();f.setStatus(503);const cached=await f.cache.get('/api/state?reserve=19');assert.equal(f.cache.readOnly,true);assert.equal(cached.sessions[0].id,'synthetic-grind');assert.equal(cached.phone.mode,'cached_snapshot');assert.equal(cached.observer.connected,false);assert.equal(cached.zoneTracking.active,false);assert.equal(cached.huntingPressure.stale,true);assert.match(f.cache.notice(),/read only/);
});
test('cached progress survives a fresh client object with the same verified session',async()=>{
 const f=fixture();await f.keep();f.setStatus(503);const fresh=new PhoneSnapshotCache({store:f.store,fetchImpl:f.cache.fetch,now:()=>NOW});assert.equal((await fresh.get('/api/state?reserve=19')).phone.mode,'cached_snapshot');
});
test('cached progress cannot be read using another paired source or browser session',async()=>{
 const f=fixture();await f.keep();f.setScope(B);f.setStatus(503);await assert.rejects(f.cache.get('/api/state?reserve=19'));assert.equal(f.store.root,null);
});
test('a session change between bootstrap and state never returns another source’s cache',async()=>{
 const f=fixture();await f.keep();const original=f.cache.fetch;f.cache.fetch=async url=>{if(url.endsWith('/api/bootstrap'))return original(url);return new Response('{"error":"offline"}',{status:503,headers:{'x-grindzone-cache-scope':B}});};await assert.rejects(f.cache.get('/api/state?reserve=19'),/source changed/);assert.equal(f.store.root.enabled,false);
});
test('a live state without its matching session header is rejected',async()=>{
 const f=fixture();const original=f.cache.fetch;f.cache.fetch=async url=>url.endsWith('/api/bootstrap')?original(url):new Response(JSON.stringify(state()),{status:200});await assert.rejects(f.cache.get('/api/state?reserve=19'),/source changed/);
});
test('authorization errors clear local copies and are never replaced with cached data',async()=>{
 for(const status of [401,403]){const f=fixture();await f.keep();f.setStatus(status);await assert.rejects(f.cache.get('/api/state?reserve=19'));assert.equal(f.store.root.enabled,false);assert.deepEqual(f.store.root.records,[]);}
});
test('service failures and rate limits are not hidden behind a saved snapshot',async()=>{
 for(const status of [400,409,429,500]){const f=fixture();await f.keep();f.setStatus(status);await assert.rejects(f.cache.get('/api/state?reserve=19'));assert.equal(f.cache.readOnly,false);}
});
test('network failure during authorization does not open persisted private data',async()=>{const f=fixture();await f.keep();f.cache.fetch=async()=>{throw Error('network unavailable');};await assert.rejects(f.cache.get('/api/state?reserve=19'));});
test('expiry is checked on every read, not extended by offline requests',async()=>{const f=fixture();await f.keep();f.setStatus(503);const expires=f.store.root.records[0].expiresAt;f.setTime(NOW+1000);await f.cache.get('/api/state?reserve=19');assert.equal(f.store.root.records[0].expiresAt,expires);f.setTime(expires);await assert.rejects(f.cache.get('/api/state?reserve=19'));});
test('the wrong reserve never silently receives the prior reserve snapshot',async()=>{const f=fixture();await f.keep();f.setStatus(503);await assert.rejects(f.cache.get('/api/state?reserve=1'),e=>e.cacheDenied===true);});
test('reconnecting returns live data and removes the read-only flag without replaying an action',async()=>{
 const f=fixture();await f.keep();f.setStatus(503);await f.cache.get('/api/state?reserve=19');f.setView({...state(),harvests:[{id:'new'}]});f.setStatus(200);const v=await f.cache.get('/api/state?reserve=19');assert.equal(f.cache.readOnly,false);assert.equal(v.harvests[0].id,'new');assert.ok(f.calls.every(p=>p.includes('/api/state')||p.includes('/api/bootstrap')));
});
test('deleting copies disables future capture without modifying the source object',async()=>{const f=fixture();const source=await f.keep();const before=JSON.stringify(source);await f.cache.forget();await f.cache.get('/api/state?reserve=19');assert.equal(f.store.root.enabled,false);assert.deepEqual(f.store.root.records,[]);assert.equal(JSON.stringify(source),before);});
test('a pending save cannot recreate copies after deletion in another tab',async()=>{
 const f=fixture();await f.keep();const permit={scope:A,epoch:f.store.root.epoch},authority=f.cache.authority;const other=new PhoneSnapshotCache({store:f.store,now:()=>NOW});await other.forget();assert.equal(await f.cache.save(state(),19,authority,permit,NOW),false);assert.deepEqual(f.store.root.records,[]);
});
test('an old capture cannot overwrite a later capture',async()=>{
 const f=fixture();await f.keep();const permit={scope:A,epoch:f.store.root.epoch};f.setTime(NOW+2000);await f.cache.save({...state(),harvests:[{id:'later'}]},19,f.cache.authority,permit,NOW+1000);assert.equal(await f.cache.save(state(),19,f.cache.authority,permit,NOW),false);assert.equal(f.store.root.records[0].state.harvests[0].id,'later');
});
test('cache is bounded to three recently viewed reserves',async()=>{
 const f=fixture();await f.keep();for(let id=1;id<=4;id++){f.setTime(NOW+id);f.setView(state(id));await f.cache.get('/api/state?reserve='+id);}assert.deepEqual(f.store.root.records.map(r=>r.reserve),[4,3,2]);
});
test('turning spoilers off evicts hidden copies for every previously viewed reserve',async()=>{
 const f=fixture();f.setView(state(19,true));await f.keep();f.setView(state(1,true));await f.cache.get('/api/state?reserve=1');assert.equal(f.store.root.records.length,2);f.setView(state(19,false));await f.cache.get('/api/state?reserve=19');assert.equal(f.store.root.records.length,1);assert.equal(f.store.root.records[0].state.settings.spoilers,false);
});
test('storage denial leaves live gameplay available and does not claim caching succeeded',async()=>{
 const f=fixture();f.store.fail=true;const live=await f.cache.get('/api/state?reserve=19');assert.equal(live.selectedReserve,19);assert.equal(f.cache.enabled,false);await assert.rejects(f.cache.enable(live));
});
test('malformed, mismatched and future stored records fail closed',()=>{
 const authority={scope:A,expiresAt:NOW+30*86400000},r={schema:CACHE_SCHEMA,scope:A,reserve:19,capturedAt:NOW,expiresAt:NOW+CACHE_RETENTION_MS,state:snapshotState(state(),19)};assert.ok(storedView(r,authority,19,NOW));
 for(const bad of [{...r,scope:B},{...r,expiresAt:undefined},{...r,capturedAt:undefined},{...r,capturedAt:NOW+400000},{...r,expiresAt:NOW+CACHE_RETENTION_MS+1},{...r,state:{selectedReserve:1}}])assert.equal(storedView(bad,authority,19,NOW),null);
});
test('cache settings clearly describe device scope and separate deletion from PC history',async()=>{const f=fixture();await f.keep();assert.match(f.cache.settings(),/not an account backup/);assert.match(f.cache.settings(),/does not erase/);assert.match(f.cache.settings(),/Delete saved copies/);});
test('scoped Hunt polls leave the complete offline reserve copy intact',async()=>{
 const f=fixture(),full={...state(),zones:[{id:'saved',reserve:19},{id:'reference-mallard',reserve:19},{id:'reference-deer',reserve:19}]};
 f.setView(full);await f.keep();f.setScopedView({...state(),zones:[full.zones[0],full.zones[1]],huntSpeciesOptions:['Mallard','Deer']});
 const live=await f.cache.get('/api/state?reserve=19&huntSpecies=Mallard');
 assert.equal(live.zones.length,2);assert.equal(f.store.root.records[0].state.zones.length,3);assert.equal(f.cache.latest,null);
 f.setStatus(503);const offline=await f.cache.get('/api/state?reserve=19&huntSpecies=Mallard');
 assert.equal(offline.phone.mode,'cached_snapshot');assert.equal(offline.zones.length,3);assert.equal(offline.sessions[0].id,'synthetic-grind');
});
test('an older PC full response to a scoped URL still cannot overwrite the offline copy',async()=>{
 const f=fixture();f.setView({...state(),zones:[{id:'complete-one',reserve:19},{id:'complete-two',reserve:19}]});await f.keep();
 f.setView({...state(),zones:[{id:'different-live-response',reserve:19}]});
 const live=await f.cache.get('/api/state?reserve=19&huntSpecies=Mallard');
 assert.equal(live.zones[0].id,'different-live-response');
 assert.deepEqual(f.store.root.records[0].state.zones.map(z=>z.id),['complete-one','complete-two']);
});
test('an opted-in Hunt session refreshes its full offline copy at most once per interval',async()=>{
 const f=fixture();await f.keep();f.setTime(NOW+CACHE_HUNT_REFRESH_MS+1);
 f.setView({...state(),harvests:[{id:'recent-full'}],zones:[{id:'saved',reserve:19},{id:'other-species',reserve:19}]});
 f.setScopedView({...state(),harvests:[{id:'recent-scoped'}],zones:[{id:'saved',reserve:19}],huntSpeciesOptions:['Mallard']});
 const url='/api/state?reserve=19&huntSpecies=Mallard',live=await f.cache.get(url);await f.cache.fullRefresh;
 assert.equal(live.harvests[0].id,'recent-scoped');assert.equal(f.store.root.records[0].state.harvests[0].id,'recent-full');assert.equal(f.store.root.records[0].state.zones.length,2);
 const fullCalls=f.calls.filter(p=>p==='/api/state?reserve=19').length;
 await f.cache.get(url);assert.equal(f.calls.filter(p=>p==='/api/state?reserve=19').length,fullCalls);
});
test('spoilers disabled during Hunt purge rich copies across reserves and keep safe live access',async()=>{
 const f=fixture();f.setView(state(19,true));await f.keep();f.setView(state(1,true));await f.cache.get('/api/state?reserve=1');
 f.setTime(NOW+1000);f.setView(state(19,false));f.setScopedView({...state(19,false),huntSpeciesOptions:['Mallard'],zones:[]});
 const live=await f.cache.get('/api/state?reserve=19&huntSpecies=all');await f.cache.fullRefresh;
 assert.equal(live.phone.mode,'live_relay');assert.ok(f.store.root.records.every(r=>r.state.settings.spoilers===false));assert.ok(!f.store.root.records.some(r=>r.reserve===1));
});
test('an older rich full-state response cannot restore spoilers after a scoped Hunt revocation',async()=>{
 const f=fixture();f.setView(state(19,true));await f.keep();
 const permit={scope:A,epoch:f.store.root.epoch},authority=f.cache.authority;
 f.setTime(NOW+1000);f.setView(state(19,false));f.setScopedView({...state(19,false),huntSpeciesOptions:['Mallard'],zones:[]});
 await f.cache.get('/api/state?reserve=19&huntSpecies=all');await f.cache.fullRefresh;
 assert.equal(await f.cache.save(state(19,true),19,authority,permit,NOW),false);
 assert.ok(f.store.root.records.every(r=>r.state.settings.spoilers===false));
});
test('another tab cannot commit an in-flight rich response after spoiler revocation',async()=>{
 const f=fixture();f.setView(state(19,true));await f.keep();
 const other=new PhoneSnapshotCache({store:f.store,fetchImpl:f.cache.fetch,now:()=>NOW});await other.authenticate();
 const oldPermit={scope:A,epoch:f.store.root.epoch},oldAuthority=other.authority;
 f.setTime(NOW+1000);f.setView(state(19,false));f.setScopedView({...state(19,false),huntSpeciesOptions:['Mallard'],zones:[]});
 await f.cache.get('/api/state?reserve=19&huntSpecies=all');await f.cache.fullRefresh;
 assert.notEqual(f.store.root.epoch,oldPermit.epoch);
 assert.equal(await other.save(state(19,true),19,oldAuthority,oldPermit,NOW),false);
 assert.ok(f.store.root.records.every(r=>r.state.settings.spoilers===false));
});
test('a stale Settings tab cannot replace a spoiler-revoked cache root',async()=>{
 const f=fixture();f.setView(state(19,true));
 const stale=new PhoneSnapshotCache({store:f.store,fetchImpl:f.cache.fetch,now:()=>NOW});
 const staleView=await stale.get('/api/state?reserve=19');
 await f.keep();
 f.setTime(NOW+1000);f.setView(state(19,false));f.setScopedView({...state(19,false),huntSpeciesOptions:['Mallard'],zones:[]});
 await f.cache.get('/api/state?reserve=19&huntSpecies=all');await f.cache.fullRefresh;
 const epoch=f.store.root.epoch;
 await assert.rejects(stale.enable(staleView),/changed in another tab/);
 assert.equal(f.store.root.epoch,epoch);
 assert.ok(f.store.root.records.every(r=>r.state.settings.spoilers===false));
});
test('failed consent save cannot erase a cache changed by another tab',async()=>{
 const f=fixture();f.setView(state(19,true));const live=await f.cache.get('/api/state?reserve=19');
 const edit=f.store.edit.bind(f.store);let calls=0;
 f.store.edit=async change=>{
  if(++calls===2)await edit(root=>({root:{...root,epoch:'newer-tab-epoch',spoilerMode:false,records:[]},result:null}));
  return edit(change);
 };
 await assert.rejects(f.cache.enable(live),/changed in another tab/);
 assert.equal(f.store.root.epoch,'newer-tab-epoch');
 assert.equal(f.store.root.enabled,true);
 assert.equal(f.store.root.spoilerMode,false);
});
test('a second tab revoking spoilers blocks rich consent while the cache is disabled',async()=>{
 const f=fixture();f.setView(state(19,true));
 const stale=new PhoneSnapshotCache({store:f.store,fetchImpl:f.cache.fetch,now:()=>NOW});
 const rich=await stale.get('/api/state?reserve=19');assert.equal(f.store.root,null);
 f.setTime(NOW+1000);f.setView(state(19,false));f.setScopedView({...state(19,false),huntSpeciesOptions:['Mallard'],zones:[]});
 await f.cache.get('/api/state?reserve=19&huntSpecies=all');
 assert.equal(f.store.root.enabled,false);assert.equal(f.store.root.spoilerMode,false);assert.deepEqual(f.store.root.records,[]);
 assert.deepEqual(Object.keys(f.store.root).sort(),['enabled','epoch','expiresAt','records','schema','scope','spoilerMode']);
 await assert.rejects(stale.enable(rich),/changed in another tab/);
 assert.equal(f.store.root.enabled,false);assert.deepEqual(f.store.root.records,[]);
});
test('a delayed rich response cannot undo a disabled-cache revocation',async()=>{
 const f=fixture();f.setView(state(19,true));
 let arrived,release;const seen=new Promise(resolve=>arrived=resolve),hold=new Promise(resolve=>release=resolve);
 const stale=new PhoneSnapshotCache({store:f.store,fetchImpl:async url=>{
  const response=await f.cache.fetch(url);
  if(url.includes('/api/state')){arrived();await hold;}
  return response;
 },now:()=>NOW});
 const pending=stale.get('/api/state?reserve=19');await seen;
 f.setTime(NOW+1000);f.setView(state(19,false));f.setScopedView({...state(19,false),huntSpeciesOptions:['Mallard'],zones:[]});
 await f.cache.get('/api/state?reserve=19&huntSpecies=all');release();
 const old=await pending;assert.equal(old.settings.spoilers,true);
 assert.equal(stale.latest,null);assert.equal(f.store.root.spoilerMode,false);
 await assert.rejects(stale.enable(old),/Reconnect and refresh/);
});
test('failed spoiler revocation denies offline rich fallback until storage recovers and purges it',async()=>{
 const f=fixture();f.setView(state(19,true));await f.keep();assert.equal(f.store.root.records[0].state.settings.spoilers,true);
 const edit=f.store.edit.bind(f.store);let blocked=true;f.store.edit=change=>blocked?Promise.reject(Error('Storage blocked')):edit(change);
 f.setTime(NOW+1000);f.setView(state(19,false));f.setScopedView({...state(19,false),huntSpeciesOptions:['Mallard'],zones:[]});
 const live=await f.cache.get('/api/state?reserve=19&huntSpecies=all');assert.equal(live.settings.spoilers,false);
 assert.equal(f.cache.spoilersDenied,true);assert.match(f.cache.settings(),/revocation could not be saved/);
 f.setStatus(503);await assert.rejects(f.cache.get('/api/state?reserve=19&huntSpecies=all'),/no saved copy/);
 assert.equal(f.store.root.records[0].state.settings.spoilers,true,'blocked storage has not falsely claimed durable removal');
 blocked=false;await assert.rejects(f.cache.get('/api/state?reserve=19&huntSpecies=all'),/no saved copy/);
 assert.equal(f.cache.spoilersDenied,false);assert.equal(f.store.root.spoilerMode,false);assert.deepEqual(f.store.root.records,[]);
});

test('a pre-canceled cache read sends no authorization request and preserves private copies',async()=>{
 const f=fixture();await f.keep();const before=structuredClone(f.store.root),calls=f.calls.length,controller=new AbortController(),reason=Error('Obsolete view');controller.abort(reason);
 await assert.rejects(f.cache.get('/api/state?reserve=19',{signal:controller.signal}),error=>error===reason);
 assert.equal(f.calls.length,calls);assert.deepEqual(f.store.root,before);assert.equal(f.cache.readOnly,false);
});

test('canceling a fresh bootstrap body preserves its reason and cannot bind another source',async()=>{
 const f=fixture();await f.keep();const before=structuredClone(f.store.root),controller=new AbortController(),reason=Error('Bootstrap deadline');let arrived;
 const seen=new Promise(resolve=>arrived=resolve);
 f.cache.fetch=async (_url,{signal})=>{assert.equal(signal,controller.signal);return new Response(new ReadableStream({start(stream){signal.addEventListener('abort',()=>stream.error(signal.reason),{once:true});arrived();}}),{headers:{'x-grindzone-cache-scope':B}});};
 const pending=f.cache.get('/api/state?reserve=19',{signal:controller.signal});await seen;controller.abort(reason);
 await assert.rejects(pending,error=>error===reason);assert.deepEqual(f.store.root,before);assert.equal(f.cache.authority.scope,A);assert.equal(f.cache.readOnly,false);
});

test('canceling an authenticated 503 body never falls back to a saved view or captures it',async()=>{
 const f=fixture();await f.keep();const before=structuredClone(f.store.root),original=f.cache.fetch,controller=new AbortController(),reason=Object.assign(Error('Obsolete scoped read'),{status:503,cacheScope:A});let arrived;
 const seen=new Promise(resolve=>arrived=resolve);
 f.cache.fetch=async (url,options)=>{assert.equal(options.signal,controller.signal);if(url.endsWith('/api/bootstrap'))return original(url);return new Response(new ReadableStream({start(stream){options.signal.addEventListener('abort',()=>stream.error(options.signal.reason),{once:true});arrived();}}),{status:503,headers:{'x-grindzone-cache-scope':A}});};
 const pending=f.cache.get('/api/state?reserve=19',{signal:controller.signal});await seen;controller.abort(reason);
 await assert.rejects(pending,error=>error===reason);assert.deepEqual(f.store.root,before);assert.equal(f.cache.readOnly,false);assert.equal(f.cache.cachedAt,null);
});

test('a transport that finishes an obsolete body despite cancellation cannot overwrite the cache',async()=>{
 const f=fixture();await f.keep();const before=structuredClone(f.store.root),original=f.cache.fetch,controller=new AbortController(),reason=Error('View changed');let arrived,release;
 const seen=new Promise(resolve=>arrived=resolve),hold=new Promise(resolve=>release=resolve);
 f.cache.fetch=async (url,options)=>{if(url.endsWith('/api/bootstrap'))return original(url);assert.equal(options.signal,controller.signal);return {ok:true,status:200,headers:new Headers({'x-grindzone-cache-scope':A}),async json(){arrived();await hold;return {...state(),harvests:[{id:'obsolete-receipt'}]};}};};
 const pending=f.cache.get('/api/state?reserve=19',{signal:controller.signal});await seen;controller.abort(reason);release();
 await assert.rejects(pending,error=>error===reason);assert.deepEqual(f.store.root,before);assert.equal(f.cache.readOnly,false);
});

test('canceling before a delayed storage transaction commits blocks obsolete snapshot capture',async()=>{
 const f=fixture();await f.keep();const before=structuredClone(f.store.root),edit=f.store.edit.bind(f.store),controller=new AbortController(),reason=Error('Storage write became obsolete');let arrived,release,calls=0;
 const seen=new Promise(resolve=>arrived=resolve),hold=new Promise(resolve=>release=resolve);
 f.setView({...state(),harvests:[{id:'obsolete-receipt'}]});
 f.store.edit=async change=>{if(++calls===2){arrived();await hold;}return edit(change);};
 const pending=f.cache.get('/api/state?reserve=19',{signal:controller.signal});await seen;controller.abort(reason);release();
 await assert.rejects(pending,error=>error===reason);assert.deepEqual(f.store.root,before);
});
