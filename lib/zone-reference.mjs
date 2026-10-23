/** Public catalogue reader. Fixed HTTPS GETs only; never transmits saves, account IDs or journal data. */
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {normalizeZoneReference} from './zone-discovery.mjs';
const MAX_BYTES=48*1024*1024,MAX_CACHE_BYTES=12*1024*1024;
const MAX_AGE=7*86400000;
const hash=b=>createHash('sha256').update(b).digest('hex');
const validReserve=n=>Number.isInteger(n)&&n>=0&&n<=999;
export async function fetchZoneReference(reserve,{fetchImpl=fetch,signal,now=Date.now}={}){
 if(!validReserve(reserve))throw Error('Invalid reserve reference');
 const url=`https://mathartbang.com/deca/hp/data/r${reserve}/reserve.json`;
 const response=await fetchImpl(url,{method:'GET',redirect:'error',signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});
 if(!response.ok)throw Error('Public zone reference unavailable');
 const size=Number(response.headers?.get('content-length'));
 if(Number.isFinite(size)&&size>MAX_BYTES)throw Error('Public zone reference exceeds size limit');
 const chunks=[];let bytes=0;
 for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>MAX_BYTES)throw Error('Public zone reference exceeds size limit');chunks.push(Buffer.from(chunk));}
 const raw=Buffer.concat(chunks),fetchedAt=new Date(now()).toISOString();
 const input=JSON.parse(raw.toString('utf8'));
 const catalogue={...normalizeZoneReference(input,{reserve,sha256:hash(raw),fetchedAt}),center:[...input.center],scale:[...input.scale]};
 if(!Object.keys(catalogue.areas).length||!Object.keys(catalogue.schedules).length)throw Error('Public reference has no supported areas or schedules');
 return catalogue;
}
function decodeCache(value,reserve,now){
 try{
  if(!value||value.schema!=='grindzone.reference-cache.v1'||typeof value.payload!=='string'||value.payload.length>MAX_CACHE_BYTES*2||!/^[a-f0-9]{64}$/.test(value.digest))return null;
  const bytes=gunzipSync(Buffer.from(value.payload,'base64'),{maxOutputLength:MAX_BYTES});
  if(hash(bytes)!==value.digest)return null;
  const c=JSON.parse(bytes.toString('utf8')),at=Date.parse(c.fetchedAt);
  if(c.schema!=='grindzone.zone-reference.v1'||c.reserve!==reserve||!Number.isFinite(at)||at>now+30000||now-at>MAX_AGE||!c.areas||!c.schedules)return null;
  return c;
 }catch{return null;}
}
/** One in-flight request per reserve; no startup network and no late commit after disable/close. */
export class ZoneReferenceReader{
 constructor(store,{fetchImpl=fetch,now=Date.now,timeoutMs=20000,retryMs=60000}={}){this.store=store;this.fetch=fetchImpl;this.now=now;this.timeoutMs=timeoutMs;this.retryMs=retryMs;this.entries=new Map();this.pending=new Map();this.epoch=0;this.closed=false;}
 status(reserve){return this.entries.get(reserve)?.status||'not_loaded';}
 catalog(reserve){const e=this.entries.get(reserve);return e?.status==='ready'&&this.now()-Date.parse(e.catalog.fetchedAt)<=MAX_AGE?e.catalog:null;}
 ensure(reserve,{enabled=false}={}){
  if(!enabled||this.closed||!validReserve(reserve))return Promise.resolve(null);
  if(this.pending.has(reserve))return this.pending.get(reserve).promise;
  const existing=this.entries.get(reserve);
  if(this.catalog(reserve))return Promise.resolve(this.catalog(reserve));
  if(existing?.retryAt>this.now())return Promise.resolve(null);
  const cached=decodeCache(this.store.get('zone-reference:'+reserve,null),reserve,this.now());
  if(cached){this.entries.set(reserve,{status:'ready',catalog:cached});return Promise.resolve(cached);}
  if(this.pending.size>=2){this.entries.set(reserve,{status:'queued'});return Promise.resolve(null);}
  const epoch=this.epoch,controller=new AbortController();this.entries.set(reserve,{status:'loading'});
  const timer=setTimeout(()=>controller.abort(),this.timeoutMs);timer.unref?.();
  const promise=fetchZoneReference(reserve,{fetchImpl:this.fetch,signal:controller.signal,now:this.now}).then(catalog=>{
   if(this.closed||epoch!==this.epoch||controller.signal.aborted)return null;
   const bytes=Buffer.from(JSON.stringify(catalog)),packed=gzipSync(bytes);
   if(packed.length>MAX_CACHE_BYTES)throw Error('Public reference cache exceeds limit');
   this.store.set('zone-reference:'+reserve,{schema:'grindzone.reference-cache.v1',payload:packed.toString('base64'),digest:hash(bytes)});
   this.entries.set(reserve,{status:'ready',catalog});
   // Bound the live decoded cache; compressed public references remain on the owner's machine.
   for(const id of this.entries.keys()){if(this.entries.size<=3)break;if(id!==reserve&&!this.pending.has(id))this.entries.delete(id);}
   return catalog;
  }).catch(()=>{if(epoch===this.epoch&&!this.closed)this.entries.set(reserve,{status:'unavailable',retryAt:this.now()+this.retryMs});return null;})
    .finally(()=>{clearTimeout(timer);if(this.pending.get(reserve)?.promise===promise)this.pending.delete(reserve);});
  this.pending.set(reserve,{promise,controller});return promise;
 }
 suspend(){this.epoch++;for(const p of this.pending.values())p.controller.abort();this.pending.clear();for(const [id,e]of this.entries)if(e.status==='loading')this.entries.delete(id);}
 close(){this.closed=true;this.suspend();}
}
