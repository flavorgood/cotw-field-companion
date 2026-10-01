/** Optional private copies in this paired browser. No cloud player database, raw saves or write queue. */
export const CACHE_SCHEMA='grindzone.paired-browser.v1';
export const CACHE_DATABASE='GrindZone.private-phone-progress.v1';
export const CACHE_MAX_RESERVES=3;
export const CACHE_MAX_BYTES=2*1024*1024;
export const CACHE_RETENTION_MS=7*86400000;
export const CACHE_HUNT_REFRESH_MS=5*60000;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validReserve=v=>Number.isInteger(v)&&v>=0&&v<=999;
const validScope=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const fail=(message,status=0,cacheDenied=false)=>Object.assign(Error(message),{status,cacheDenied});
const checkSignal=signal=>{if(signal?.aborted)throw signal.reason;};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=v=>Number.isFinite(v)?new Date(v).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'unavailable';
const newEpoch=()=>globalThis.crypto.randomUUID();
const stateFields='app selectedReserve harvestCount candidateNotice reserves settings career careerChanges huntingPressure zones pins equipment placeLabels encounters harvests sessions route routeOptimization routeSetup population changes coverageEvents zoneLedgerVersion zoneTracking zoneHistory zoneActivity zoneDiscovery'.split(' ');

export function cacheAuthority(bootstrap,now=Date.now()){
 const c=bootstrap?.phone?.cache;
 if(bootstrap?.phone?.remote!==true||!validScope(c?.scope)||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now)return null;
 return {scope:c.scope,expiresAt:c.expiresAt};
}
/** Only an existing, authenticated phone projection is accepted. No credentials are copied. */
export function snapshotState(value,reserve){
  if(!plain(value)||value.selectedReserve!==reserve||!validReserve(reserve)||value.phone?.mode!=='live_relay'||!plain(value.settings)||!Array.isArray(value.zones)||!Array.isArray(value.sessions)||!Array.isArray(value.reserves)||Array.isArray(value.huntSpeciesOptions))throw fail('A complete live phone view is required for this reserve.',409,true);
 const snapshot=Object.fromEntries(stateFields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
 const o=value.observer||{};
 snapshot.observer={connected:o.connected===true,busy:false,lastCycle:typeof o.lastCycle==='string'?o.lastCycle:null,readOnly:true,error:o.error?'The source needed attention when this copy was saved.':null,sources:Array.isArray(o.sources)?o.sources.map(s=>({name:s.name,mtime:s.mtime,checked:s.checked,status:s.status,error:s.error?'Source needed attention':null})):[]};
 const encoded=JSON.stringify(snapshot);
 if(new TextEncoder().encode(encoded).length>CACHE_MAX_BYTES)throw fail('This reserve is too large to keep in the phone cache.',413);
 return JSON.parse(encoded);
}
export function storedView(record,authority,reserve,now=Date.now()){
 if(!authority||!record||record.schema!==CACHE_SCHEMA||record.scope!==authority.scope||record.reserve!==reserve||!Number.isSafeInteger(record.capturedAt)||!Number.isSafeInteger(record.expiresAt)||!plain(record.state)||record.expiresAt<=now||record.capturedAt>now+300000||record.expiresAt>Math.min(record.capturedAt+CACHE_RETENTION_MS,authority.expiresAt)||record.state?.selectedReserve!==reserve)return null;
 const s=structuredClone(record.state);
 s.phone={mode:'cached_snapshot',readOnly:true,cachedAt:new Date(record.capturedAt).toISOString(),expiresAt:new Date(record.expiresAt).toISOString(),privateDiagnosticsExcluded:true};
 s.observer={...s.observer,connected:false,busy:false};
 if(s.huntingPressure)s.huntingPressure={...s.huntingPressure,stale:true};
 if(s.zoneTracking)s.zoneTracking={...s.zoneTracking,active:false,stopReason:'cached_view'};
 return s;
}

/** One small transactional store: erase/consent epochs reject writes already in flight, including other tabs. */
export class BrowserSnapshotStore{
 constructor(indexedDB=globalThis.indexedDB){this.indexedDB=indexedDB;this.opened=null;}
 async open(){
  if(!this.indexedDB)throw fail('This browser does not allow private saved progress. Live access still works.');
  if(this.opened)return this.opened;
  this.opened=new Promise((resolve,reject)=>{
   const request=this.indexedDB.open(CACHE_DATABASE,1);
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('cache'))request.result.createObjectStore('cache');};
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.opened=null;};resolve(db);};
   request.onerror=()=>{this.opened=null;reject(fail('Private storage is unavailable. Live access still works.'));};
   request.onblocked=()=>{this.opened=null;reject(fail('Close another GrindZone tab before changing private storage.'));};
  });
  return this.opened;
 }
 async read(){const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('cache','readonly'),r=tx.objectStore('cache').get('root');let value;r.onsuccess=()=>{value=r.result??null;};tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(fail('Could not read private saved progress.'));});}
 async edit(change){
  const db=await this.open();return new Promise((resolve,reject)=>{
   const tx=db.transaction('cache','readwrite'),store=tx.objectStore('cache'),r=store.get('root');let result,error;
    r.onsuccess=()=>{try{const next=change(r.result??null);result=next.result;if(next.root===null)store.delete('root');else if(next.root!==undefined)store.put(next.root,'root');}catch(e){error=e;tx.abort();}};
   tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(error||fail('Could not save private progress. Storage may be full or blocked.'));
  });
 }
 async close(){if(this.opened)(await this.opened).close();this.opened=null;}
}

export class PhoneSnapshotCache{
  constructor({store=new BrowserSnapshotStore(),fetchImpl=(...args)=>fetch(...args),now=Date.now}={}){
   this.store=store;this.fetch=fetchImpl;this.now=now;this.authority=null;this.readOnly=false;this.cachedAt=null;this.expiresAt=null;this.enabled=false;this.records=[];this.storageError='';this.latest=null;this.fullRefresh=null;this.fullRefreshAttempt=new Map();this.spoilersRevokedAt=0;this.spoilersDenied=false;
 }
  async request(url,token,{signal}={}){
   checkSignal(signal);
   const response=await this.fetch(url,{cache:'no-store',headers:token?{'X-Companion-Token':token}:{},...(signal?{signal}:{})});
   checkSignal(signal);
  let data;try{data=await response.json();}catch{checkSignal(signal);throw fail('The phone service returned an unreadable response.',response.status);}
  checkSignal(signal);
  if(!response.ok)throw Object.assign(fail(data?.error||'Request failed',response.status,[401,403].includes(response.status)),{cacheScope:response.headers.get('x-grindzone-cache-scope')});
  return {response,data};
 }
 async bind(bootstrap,{signal}={}){
  checkSignal(signal);
  const authority=cacheAuthority(bootstrap,this.now());
   if(this.authority?.scope!==authority?.scope){this.latest=null;this.readOnly=false;this.cachedAt=null;this.fullRefreshAttempt.clear();this.spoilersRevokedAt=0;this.spoilersDenied=false;}
  this.authority=authority;
  if(!authority){this.enabled=false;return;}
  try{
   let root=await this.store.read();checkSignal(signal);
   if(root&&root.scope!==authority.scope){await this.store.edit(current=>{checkSignal(signal);return current?.scope!==authority.scope?{root:null,result:null}:{root:current,result:null};});root=null;}
   checkSignal(signal);
   this.enabled=root?.enabled===true&&root.scope===authority.scope;
   this.records=this.enabled?(root.records||[]).filter(r=>storedView(r,authority,r.reserve,this.now())).map(r=>({reserve:r.reserve,capturedAt:r.capturedAt,expiresAt:r.expiresAt})):[];
  }catch(error){checkSignal(signal);this.enabled=false;this.storageError=error.message;}
 }
 async forget(){
  this.latest=null;this.readOnly=false;this.cachedAt=null;this.expiresAt=null;this.enabled=false;this.records=[];
  await this.store.edit(root=>({root:{schema:CACHE_SCHEMA,scope:this.authority?.scope||root?.scope||null,enabled:false,epoch:newEpoch(),records:[]},result:null}));
 }
 async invalidate(){this.authority=null;await this.forget().catch(()=>{});}
 async authenticate(token,{signal}={}){
  try{const {response,data}=await this.request('/api/bootstrap',token,{signal});const metadata={...data,phone:{...data.phone,cache:{scope:response.headers.get('x-grindzone-cache-scope'),expiresAt:Number(response.headers.get('x-grindzone-cache-expires'))}}};await this.bind(metadata,{signal});checkSignal(signal);return data;}
  catch(error){if([401,403].includes(error.status)){await this.invalidate();error.cacheDenied=true;}throw error;}
 }
  async get(url,{token,signal}={}){
   if(/\/api\/bootstrap(?:\?|$)/.test(url))return this.authenticate(token,{signal});
   if(!/\/api\/state(?:\?|$)/.test(url))return (await this.request(url,token,{signal})).data;
   const bootstrap=await this.authenticate(token,{signal}),authority=this.authority,startedAt=this.now();
   const requestUrl=new URL(url,'https://grindzone.invalid'),scoped=requestUrl.searchParams.has('huntSpecies');
   const reserve=Number(requestUrl.searchParams.get('reserve')??bootstrap.selectedReserve??19);
   if(!validReserve(reserve))throw fail('Invalid reserve',400);
   let root=null;
   if(authority)try{root=await this.store.read();}catch(error){this.storageError=error.message;}
   checkSignal(signal);
   const observedEpoch=root?.scope===authority?.scope?root.epoch:null;
  let result;
  try{result=await this.request(url,token,{signal});}catch(error){
   checkSignal(signal);
   if([401,403].includes(error.status)){await this.invalidate();error.cacheDenied=true;throw error;}
   if(![503,504].includes(error.status)||!authority)throw error;
   if(error.cacheScope!==authority.scope){await this.invalidate();throw fail('The paired source changed. Reload before continuing.',409,true);}
   const saved=await this.read(reserve,authority);
   if(!saved){this.readOnly=false;error.cacheDenied=true;error.message='The PC is unavailable and this reserve has no saved copy in this browser. Reconnect the PC to load it.';throw error;}
   this.latest=null;this.readOnly=true;this.cachedAt=Date.parse(saved.phone.cachedAt);this.expiresAt=Date.parse(saved.phone.expiresAt);return saved;
  }
  const {response,data}=result;
   if(authority&&response.headers.get('x-grindzone-cache-scope')!==authority.scope){await this.invalidate();throw fail('The paired source changed. Reload before continuing.',409,true);}
   if(data?.selectedReserve!==reserve)throw fail('The phone received a different reserve. Retry before continuing.',409,true);
   this.readOnly=false;this.cachedAt=null;this.expiresAt=null;
   const spoilers=data.settings?.spoilers===true;
   if(!spoilers){this.spoilersRevokedAt=Math.max(this.spoilersRevokedAt,startedAt);this.spoilersDenied=true;}
   let mode=null;
   if(authority)try{mode=await this.reconcileSpoilerMode(authority,observedEpoch,spoilers,{signal});if(mode){this.storageError='';if(!spoilers||startedAt>this.spoilersRevokedAt)this.spoilersDenied=false;}}catch(error){checkSignal(signal);this.storageError=spoilers?error.message:'Private copy revocation could not be saved. Saved views remain unavailable until storage recovers.';}
   checkSignal(signal);
   this.latest=!scoped&&mode&&!this.spoilersDenied?{state:data,authority,startedAt,guardEpoch:mode.epoch}:null;
   if(authority&&mode?.permit){
    if(scoped){
     const previous=root?.records?.find(r=>r.reserve===reserve);
     if(mode.changed)this.fullRefreshAttempt.delete(authority.scope+':'+reserve);
     if(mode.changed||!previous||startedAt-previous.capturedAt>=CACHE_HUNT_REFRESH_MS)this.refreshCompleteCopy(requestUrl,token,reserve,authority,mode.permit,startedAt,spoilers);
    }else try{await this.save(data,reserve,authority,mode.permit,startedAt,{signal});}catch(error){checkSignal(signal);this.storageError=error.message;}
   }
   checkSignal(signal);
   return data;
  }
  async reconcileSpoilerMode(authority,observedEpoch,spoilers,{signal}={}){
   const outcome=await this.store.edit(root=>{
    checkSignal(signal);
    if(this.authority?.scope!==authority.scope||root&&root.scope!==authority.scope)return {root:undefined,result:null};
    if(spoilers){
     if((root?.epoch??null)!==observedEpoch)return {root:undefined,result:null};
     if(!root)return {root:undefined,result:{epoch:null,permit:null,changed:false}};
     if(root.spoilerMode===true)return {root:undefined,result:{epoch:root.epoch,permit:root.enabled?{scope:authority.scope,epoch:root.epoch}:null,changed:false}};
     const epoch=newEpoch();return {root:{...root,epoch,spoilerMode:true},result:{epoch,permit:root.enabled?{scope:authority.scope,epoch}:null,changed:true}};
    }
    const records=root?.enabled?(root.records||[]).filter(r=>r.state?.settings?.spoilers!==true):[];
    const changed=!root||root.spoilerMode!==false||records.length!==(root.records||[]).length;
    if(!changed)return {root:undefined,result:{epoch:root.epoch,permit:root.enabled?{scope:authority.scope,epoch:root.epoch}:null,changed:false}};
    const epoch=newEpoch(),next={schema:CACHE_SCHEMA,scope:authority.scope,expiresAt:authority.expiresAt,enabled:root?.enabled===true,epoch,spoilerMode:false,records};
    return {root:next,result:{epoch,permit:next.enabled?{scope:authority.scope,epoch}:null,changed:true}};
   });
   if(outcome?.changed)this.records=(await this.store.read())?.records?.map(r=>({reserve:r.reserve,capturedAt:r.capturedAt,expiresAt:r.expiresAt}))||[];
   return outcome;
  }
  refreshCompleteCopy(requestUrl,token,reserve,authority,permit,startedAt,spoilers){
   const key=authority.scope+':'+reserve;
   if(this.fullRefresh||startedAt-(this.fullRefreshAttempt.get(key)??-Infinity)<CACHE_HUNT_REFRESH_MS)return;
   this.fullRefreshAttempt.set(key,startedAt);
   const full=new URL(requestUrl);full.searchParams.delete('huntSpecies');
   const task=(async()=>{
    try{
     const {response,data}=await this.request(full.pathname+full.search,token,{signal:AbortSignal.timeout(15000)});
     if(this.authority?.scope!==authority.scope||response.headers.get('x-grindzone-cache-scope')!==authority.scope||data?.selectedReserve!==reserve||Array.isArray(data.huntSpeciesOptions)||data.settings?.spoilers!==spoilers)return;
     await this.save(data,reserve,authority,permit,startedAt);
    }catch(error){if(this.authority?.scope===authority.scope&&error.status!==503&&error.status!==504)this.storageError='Private copy could not refresh. Live Hunt access is unchanged.';}
   })();
   this.fullRefresh=task;
   void task.finally(()=>{if(this.fullRefresh===task)this.fullRefresh=null;});
  }
  async save(state,reserve,authority,permit,startedAt,{signal}={}){
  const data=snapshotState(state,reserve),now=this.now(),expiresAt=Math.min(now+CACHE_RETENTION_MS,authority.expiresAt);
  const record={schema:CACHE_SCHEMA,scope:authority.scope,reserve,capturedAt:now,startedAt,expiresAt,state:data};
  const saved=await this.store.edit(root=>{
    checkSignal(signal);
    if(!root?.enabled||root.scope!==permit.scope||root.epoch!==permit.epoch||this.authority?.scope!==authority.scope||root.spoilerMode!==undefined&&root.spoilerMode!==(data.settings?.spoilers===true)||data.settings?.spoilers===true&&startedAt<this.spoilersRevokedAt)return {root:undefined,result:false};
    let records=(root.records||[]).filter(r=>r.expiresAt>now);
   // Turning spoilers off removes hidden information from ALL saved reserves, not just the open map.
   if(data.settings?.spoilers!==true)records=records.filter(r=>r.state?.settings?.spoilers!==true);
   const previous=records.find(r=>r.reserve===reserve);
   if(previous?.startedAt>startedAt)return {root,result:false};
   records=[record,...records.filter(r=>r.reserve!==reserve)].sort((a,b)=>b.capturedAt-a.capturedAt).slice(0,CACHE_MAX_RESERVES);
    const spoilers=data.settings?.spoilers===true,epoch=root.spoilerMode===spoilers?root.epoch:newEpoch();
    return {root:{...root,epoch,spoilerMode:spoilers,records},result:true};
  });
  if(saved){this.storageError='';this.records=(await this.store.read())?.records?.map(r=>({reserve:r.reserve,capturedAt:r.capturedAt,expiresAt:r.expiresAt}))||[];}
  return saved;
 }
 async read(reserve,authority=this.authority){
  try{
   if(this.spoilersDenied){
    const mode=await this.reconcileSpoilerMode(authority,null,false);
    if(!mode)return null;
    this.spoilersDenied=false;this.storageError='';
   }
   const root=await this.store.read();return root?.enabled&&root.scope===authority?.scope?storedView(root.records?.find(r=>r.reserve===reserve),authority,reserve,this.now()):null;
  }catch(error){this.storageError=this.spoilersDenied?'Private copy revocation could not be saved. Saved views remain unavailable until storage recovers.':error.message;return null;}
 }
 async enable(state){
  const live=this.latest,authority=this.authority;
  if(!authority||this.readOnly||this.spoilersDenied||live?.state!==state||live.authority?.scope!==authority.scope||this.now()-live.startedAt>60000)throw fail('Reconnect and refresh this reserve before keeping a private copy.',409);
   // Verify before enabling; storage errors must not report a successful copy.
   snapshotState(state,state.selectedReserve);
   const epoch=newEpoch();
   await this.store.edit(root=>{
    if(root&&root.scope!==authority.scope)throw fail('The paired source changed. Reload before keeping a copy.',409,true);
    if(root?.enabled)throw fail('Private copies changed in another tab. Refresh Settings before keeping a copy.',409);
    if((root?.epoch??null)!==live.guardEpoch||root?.spoilerMode!==undefined&&root.spoilerMode!==(state.settings?.spoilers===true))throw fail('Private copies changed in another tab. Refresh Settings before keeping a copy.',409);
    return {root:{schema:CACHE_SCHEMA,scope:authority.scope,enabled:true,epoch,spoilerMode:state.settings?.spoilers===true,records:[]},result:null};
   });
  this.enabled=true;
  try{if(!await this.save(state,state.selectedReserve,authority,{scope:authority.scope,epoch},live.startedAt))throw fail('Cache settings changed in another tab.');}
  catch(error){
   await this.store.edit(root=>root?.scope===authority.scope&&root.epoch===epoch?{root:{...root,enabled:false,epoch:newEpoch(),records:[]},result:null}:{root:undefined,result:null}).catch(()=>{});
   const current=await this.store.read().catch(()=>null);
   this.enabled=current?.enabled===true&&current.scope===authority.scope;
   this.records=this.enabled?(current.records||[]).map(r=>({reserve:r.reserve,capturedAt:r.capturedAt,expiresAt:r.expiresAt})):[];
   throw error;
  }
 }
 notice(){return this.readOnly?'PC unavailable · saved '+stamp(this.cachedAt)+' · read only. No actions are queued.':'Tracking PC unavailable. Reconnecting automatically…';}
 warning(){return `<div class="callout warning phone-saved-notice"><strong>Saved view · read only</strong><p>Last received ${esc(stamp(this.cachedAt))}. Game-save timestamps are unchanged. Reconnect the PC for current progress or edits.</p></div>`;}
 updateStatus(node){if(this.readOnly&&node){node.textContent='Saved view · read only';node.className='pill warn';}}
 settings(){
  if(!this.authority)return '';
  const copies=this.records.map(r=>`<li>Reserve ${r.reserve} · saved ${esc(stamp(r.capturedAt))} · expires ${esc(stamp(r.expiresAt))}</li>`).join('');
  return `<section class="panel phone-private-cache"><h2>Progress when the PC is off</h2><p>Keep a private, read-only copy in this paired browser. The phone still needs internet to open GrindZone and verify its pairing.</p><p class="small muted">Your PC keeps the original saves and journal. Up to ${CACHE_MAX_RESERVES} recently viewed reserves are kept here for seven days or until pairing expires. This is not an account backup or public post.</p>${this.enabled?`<p role="status">Private copies enabled.</p><ul>${copies||'<li>No saved reserve yet.</li>'}</ul><button class="button" data-action="cache-delete">Delete saved copies</button>`:`<button class="button" data-action="cache-enable" ${this.readOnly||!this.latest?'disabled':''}>Keep progress on this phone</button>`}<p class="small muted">Use only a device you trust. Anyone using this paired browser may view these copies. Turning off live access on the PC does not erase a previously saved copy; delete it here. Clearing browser data also removes it.</p>${this.storageError?`<p class="error" role="status">${esc(this.storageError)}</p>`:''}</section>`;
 }
}
