/** Account/source ownership only. No account provider, game parser or network fetch is invented here.
 * Host callbacks must verify accounts and live relay peers; tests must not replace them in production.
 * Binding is NOT consent to copy player data or publish it. Keep those grants separate.
 */
import {DatabaseSync} from 'node:sqlite';
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {chmodSync,lstatSync} from 'node:fs';
import path from 'node:path';
const schema='grindzone.account-sources.v1';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const time=v=>Number.isSafeInteger(v)&&v>=0;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const only=(v,fields)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!fields.includes(k)))fail(400,'Unsupported account-source request');};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length>0&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const view=r=>r?{sourceId:r.source_id,label:r.label,version:r.version,linkedAt:r.linked_at}:null;

/** Durable exclusive ownership. The database stores HMAC identity tags, not raw credentials or source identifiers.
 * Friendly names are explicitly supplied display text, not verified account identity.
 * Caller owns this dedicated SQLite file. Never point it at the PC journal or an unrelated app DB.
 */
export class AccountSourceRegistry{
 #db;#key;#now;#closed=false;
 constructor({filename,key,now=Date.now}={}){
  if(typeof filename!=='string'||!filename||filename===':memory:'||!Buffer.isBuffer(key)||key.length!==32||typeof now!=='function')throw TypeError('A dedicated durable registry filename, 32-byte key and clock are required');
  for(let current=path.resolve(filename);;current=path.dirname(current)){
   try{if(lstatSync(current).isSymbolicLink())throw TypeError('Registry cannot follow a symbolic link');}catch(e){if(e.code!=='ENOENT')throw e;}
   if(path.dirname(current)===current)break;
  }
  this.#key=Buffer.from(key);this.#now=now;this.#db=new DatabaseSync(filename);
  try{
   this.#db.exec('PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;');
   const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
   if(tables.length){
    if(!tables.some(r=>r.name==='gz_binding_meta'))throw TypeError('Refusing an unrelated database');
    const entries=new Map(this.#db.prepare('SELECT name,value FROM gz_binding_meta').all().map(r=>[r.name,r.value]));
    if(entries.get('schema')!==schema||!equal(entries.get('key-check'),this.tag('key-check',schema)))throw TypeError('Registry schema or key mismatch');
   }
   this.#db.exec(`PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS gz_binding_meta(name TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gz_source_bindings(source_id TEXT PRIMARY KEY,source_tag TEXT NOT NULL UNIQUE,owner_tag TEXT NOT NULL,label TEXT NOT NULL,version INTEGER NOT NULL,epoch TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),linked_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS gz_source_owner ON gz_source_bindings(owner_tag,active);
    CREATE TABLE IF NOT EXISTS gz_binding_requests(id TEXT PRIMARY KEY,request_tag TEXT NOT NULL UNIQUE,owner_tag TEXT NOT NULL,session_tag TEXT NOT NULL,source_tag TEXT NOT NULL,device_tag TEXT NOT NULL,generation INTEGER NOT NULL,label TEXT NOT NULL,display_name TEXT NOT NULL,expires INTEGER NOT NULL,state TEXT NOT NULL,source_id TEXT);
    CREATE TABLE IF NOT EXISTS gz_source_generations(source_tag TEXT PRIMARY KEY,generation INTEGER NOT NULL,device_tag TEXT NOT NULL);`);
   this.#db.prepare('INSERT OR IGNORE INTO gz_binding_meta VALUES(?,?)').run('schema',schema);
   this.#db.prepare('INSERT OR IGNORE INTO gz_binding_meta VALUES(?,?)').run('key-check',this.tag('key-check',schema));
   chmodSync(filename,0o600);
  }catch(e){this.#db.close();this.#key.fill(0);throw e;}
 }
 tag(kind,...values){if(this.#closed)throw Error('Registry is closed');return createHmac('sha256',this.#key).update(JSON.stringify([schema,kind,...values])).digest('hex');}
 #tx(fn){this.#db.exec('BEGIN IMMEDIATE');try{const r=fn();this.#db.exec('COMMIT');return r;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
 #clock(){const now=this.#now();if(!time(now))throw Error('Invalid registry clock');return now;}
 #purge(now){this.#db.prepare('DELETE FROM gz_binding_requests WHERE expires<=?').run(now);}
 #generation(peer){
  if(!id(peer?.installationId)||!id(peer.deviceId)||!Number.isSafeInteger(peer.generation)||peer.generation<1||!time(peer.expiresAt)||peer.expiresAt<=this.#clock())fail(401,'Current authenticated PC connection required');
  const source=this.tag('installation',peer.installationId),device=this.tag('device',peer.deviceId),old=this.#db.prepare('SELECT * FROM gz_source_generations WHERE source_tag=?').get(source);
  if(old&&(peer.generation<old.generation||peer.generation===old.generation&&device!==old.device_tag))fail(409,'The PC credential was replaced');
  if(!old||peer.generation>old.generation){
   this.#db.prepare('INSERT INTO gz_source_generations VALUES(?,?,?) ON CONFLICT(source_tag) DO UPDATE SET generation=excluded.generation,device_tag=excluded.device_tag').run(source,peer.generation,device);
   this.#db.prepare("UPDATE gz_binding_requests SET state='cancelled' WHERE source_tag=? AND state IN('pending','pc_approved')").run(source);
  }
  return {source,device};
 }
 observePeer(peer){return this.#tx(()=>this.#generation(peer));}
 request({owner,session,sessionExpires,displayName},peer,{requestId,label}={}){
  if(!id(owner)||!id(session)||!time(sessionExpires)||sessionExpires<=this.#clock()||!id(requestId)||typeof label!=='string'||!label.trim()||label.length>80||typeof displayName!=='string'||displayName.length>80)fail(400,'Invalid source-link request');
  return this.#tx(()=>{
   const now=this.#clock();this.#purge(now);const {source,device}=this.#generation(peer),requestTag=this.tag('request',owner,requestId);
   const old=this.#db.prepare('SELECT * FROM gz_binding_requests WHERE request_tag=?').get(requestTag);
   if(old){if(old.source_tag!==source||old.session_tag!==session||old.label!==label.trim())fail(409,'Request identity already used');return {requestId:old.id,state:old.state,expiresAt:old.expires};}
   const binding=this.#db.prepare('SELECT * FROM gz_source_bindings WHERE source_tag=?').get(source);
   if(binding?.active&&binding.owner_tag!==owner)fail(409,'This PC is already linked to another account');
   if(this.#db.prepare("SELECT count(*) AS n FROM gz_binding_requests WHERE owner_tag=? AND state IN('pending','pc_approved')").get(owner).n>=5||this.#db.prepare('SELECT count(*) AS n FROM gz_binding_requests').get().n>=2048)fail(429,'Too many source-link requests');
   const request=randomUUID(),expires=Math.min(now+300000,sessionExpires,peer.expiresAt);
   this.#db.prepare('INSERT INTO gz_binding_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)').run(request,requestTag,owner,session,source,device,peer.generation,label.trim(),displayName,expires,'pending');
   return {requestId:request,state:'pending',expiresAt:expires};
  });
 }
 pendingFor(peer){return this.#tx(()=>{const {source,device}=this.#generation(peer);this.#purge(this.#clock());return this.#db.prepare("SELECT id,display_name,label,expires FROM gz_binding_requests WHERE source_tag=? AND device_tag=? AND state IN('pending','pc_approved')").all(source,device).map(r=>({requestId:r.id,accountDisplayName:r.display_name,label:r.label,expiresAt:r.expires}));});}
 decide(peer,{requestId,approve}={}){
  if(!id(requestId)||typeof approve!=='boolean')fail(400,'Explicit PC approval or rejection is required');
  return this.#tx(()=>{
   const now=this.#clock(),{source,device}=this.#generation(peer),r=this.#db.prepare('SELECT * FROM gz_binding_requests WHERE id=?').get(requestId);
   if(!r||r.expires<=now||r.source_tag!==source||r.device_tag!==device||r.generation!==peer.generation)fail(404,'Source-link request unavailable');
   if(['pc_approved','approved'].includes(r.state)&&approve)return {requestId:r.id,state:'pc_approved',expiresAt:r.expires};
   if(r.state==='rejected'&&!approve)return {state:'rejected'};
   if(r.state!=='pending')fail(409,'This source-link request has already been handled');
   this.#db.prepare('UPDATE gz_binding_requests SET state=? WHERE id=?').run(approve?'pc_approved':'rejected',r.id);
   return approve?{requestId:r.id,state:'pc_approved',expiresAt:r.expires}:{state:'rejected'};
  });
 }
 complete({owner,session,sessionExpires},peer,{requestId}={}){
  if(!id(owner)||!id(session)||!id(requestId)||!time(sessionExpires)||sessionExpires<=this.#clock())fail(401,'A current account session is required to finish linking');
  return this.#tx(()=>{
   const now=this.#clock(),{source,device}=this.#generation(peer),r=this.#db.prepare('SELECT * FROM gz_binding_requests WHERE id=? AND owner_tag=? AND session_tag=?').get(requestId,owner,session);
   if(!r||r.expires<=now||r.source_tag!==source||r.device_tag!==device||r.generation!==peer.generation)fail(404,'Source-link request unavailable');
   if(r.state==='approved'){
    const saved=this.#db.prepare('SELECT * FROM gz_source_bindings WHERE source_id=? AND active=1 AND owner_tag=?').get(r.source_id,owner);
    if(!saved)fail(410,'The approved binding was removed');return {...view(saved),state:'approved'};
   }
   if(r.state!=='pc_approved')fail(409,'Approve this request on the PC first');
   const old=this.#db.prepare('SELECT * FROM gz_source_bindings WHERE source_tag=?').get(source);
   if(old?.active&&old.owner_tag!==owner)fail(409,'This PC is already linked to another account');
   if(!old?.active&&this.#db.prepare('SELECT count(*) AS n FROM gz_source_bindings WHERE owner_tag=? AND active=1').get(owner).n>=10)fail(429,'Account source limit reached');
   const sourceId=old?.active?old.source_id:randomUUID(),version=old?old.version+1:1,epoch=randomUUID();
   if(!Number.isSafeInteger(version))fail(409,'Binding version exhausted');
   this.#db.prepare('INSERT INTO gz_source_bindings VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(source_tag) DO UPDATE SET source_id=excluded.source_id,owner_tag=excluded.owner_tag,label=excluded.label,version=excluded.version,epoch=excluded.epoch,active=1,linked_at=excluded.linked_at').run(sourceId,source,owner,r.label,version,epoch,now);
   this.#db.prepare("UPDATE gz_binding_requests SET state='approved',source_id=? WHERE id=?").run(sourceId,r.id);
   this.#db.prepare("UPDATE gz_binding_requests SET state='cancelled' WHERE source_tag=? AND state IN('pending','pc_approved')").run(source);
   return {...view(this.#db.prepare('SELECT * FROM gz_source_bindings WHERE source_id=?').get(sourceId)),state:'approved'};
  });
 }
 sources(owner){if(!id(owner))fail(401,'Verified account required');return this.#db.prepare('SELECT * FROM gz_source_bindings WHERE owner_tag=? AND active=1 ORDER BY linked_at,source_id').all(owner).map(view);}
 lease(owner,sourceId){if(!id(owner)||!id(sourceId))fail(400,'Invalid source');const r=this.#db.prepare('SELECT * FROM gz_source_bindings WHERE owner_tag=? AND source_id=? AND active=1').get(owner,sourceId);if(!r)fail(404,'Source not linked to this account');return Object.freeze({ownerId:owner,sourceId:r.source_id,sourceTag:r.source_tag,epoch:r.epoch,version:r.version});}
 assertLease(lease){const current=this.lease(lease.ownerId,lease.sourceId);if(current.epoch!==lease.epoch||current.version!==lease.version)fail(409,'Source ownership changed during this request');return current;}
 cancelSession(owner,session){if(!id(owner)||!id(session))fail(400,'Invalid session');return this.#db.prepare("UPDATE gz_binding_requests SET state='cancelled' WHERE owner_tag=? AND session_tag=? AND state IN('pending','pc_approved')").run(owner,session).changes;}
 unlink(owner,{sourceId,expectedVersion}={}){return this.#tx(()=>{const lease=this.lease(owner,sourceId);if(!Number.isSafeInteger(expectedVersion)||expectedVersion!==lease.version||expectedVersion>=Number.MAX_SAFE_INTEGER)fail(409,'Refresh the source before unlinking');this.#db.prepare('UPDATE gz_source_bindings SET active=0,epoch=?,version=version+1 WHERE source_id=?').run(randomUUID(),sourceId);this.#db.prepare("UPDATE gz_binding_requests SET state='cancelled' WHERE source_tag=? AND state IN('pending','pc_approved')").run(lease.sourceTag);return {unlinked:true,sourceId,version:expectedVersion+1,sourceFilesModified:false};});}
 close(){if(!this.#closed){this.#db.close();this.#key.fill(0);this.#closed=true;}}
}

/** Host-owned provider verification and live-peer resolution are mandatory; no fallback identity.
 * authenticateAccount returns issuer, subject, sessionId, expiresAt, emailVerified, csrf, displayName.
 * resolvePairedPeer validates the existing phone cookie against a CURRENT authenticated PC peer.
 * approveOnPC accepts a credential delivered by the authenticated PC channel, never a browser body.
 */
export function createAccountSourceBoundary({registry,issuer,origin,authenticateAccount,resolvePairedPeer,verifyDevice,currentPeer,readPeer,projectState,now=Date.now}={}){
 if(!registry||!['authenticateAccount','resolvePairedPeer','verifyDevice','currentPeer','readPeer','projectState'].every(k=>typeof ({authenticateAccount,resolvePairedPeer,verifyDevice,currentPeer,readPeer,projectState})[k]==='function'))throw TypeError('Verified account, paired peer, device channel, reader and canonical projection callbacks are required');
 if(typeof issuer!=='string'||new URL(issuer).protocol!=='https:'||new URL(origin).origin!==origin||new URL(origin).protocol!=='https:')throw TypeError('Fixed HTTPS account issuer and application origin required');
 async function account(req,write=false){
  if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))fail(403,'Open GrindZone directly');
  const a=await authenticateAccount(req);
  if(!a||a.issuer!==issuer||!id(a.subject)||!id(a.sessionId)||a.emailVerified!==true||!time(a.expiresAt)||a.expiresAt<=now())fail(401,'A current verified GrindZone account is required');
  if(write&&(req.headers.origin!==origin||!equal(req.headers['x-grindzone-account-csrf'],a.csrf)))fail(403,'Refresh the account page before saving');
  return {owner:registry.tag('owner',issuer,a.subject),session:registry.tag('session',issuer,a.subject,a.sessionId),sessionExpires:a.expiresAt,displayName:typeof a.displayName==='string'?a.displayName.slice(0,80):'GrindZone player'};
 }
 async function device(token){const d=await verifyDevice(token);if(!d||!time(d.exp)||d.exp<=now()||!Number.isSafeInteger(d.generation)||d.generation<1||!id(d.installationId)||!id(d.deviceId))fail(401,'Authenticated PC channel required');const p=await currentPeer(d.deviceId);if(!p||p.installationId!==d.installationId||p.deviceId!==d.deviceId||p.generation!==d.generation||p.expiresAt<=now())fail(409,'PC connection changed');return p;}
 return {
  async requestLink(req,input){only(input,['requestId','label']);const a=await account(req,true),p=await resolvePairedPeer(req);if(!p||p.expiresAt<=now())fail(409,'Pair with an online PC before linking it');const active=await currentPeer(p.deviceId);if(!active||active.deviceId!==p.deviceId||active.installationId!==p.installationId||active.generation!==p.generation)fail(409,'PC connection changed');return registry.request(a,active,input);},
  async pendingOnPC(token){return registry.pendingFor(await device(token));},
  async approveOnPC(token,input){only(input,['requestId','approve']);return registry.decide(await device(token),input);},
  async completeLink(req,input){
   only(input,['requestId']);const a=await account(req,true),p=await resolvePairedPeer(req);
   if(!p)fail(409,'The paired PC must still be connected');
   const active=await currentPeer(p.deviceId);if(!active||active.installationId!==p.installationId||active.deviceId!==p.deviceId||active.generation!==p.generation)fail(409,'PC connection changed');
   const current=await account(req,true);if(current.owner!==a.owner||current.session!==a.session)fail(401,'Account session changed');
   return registry.complete(current,active,input);
  },
  async sources(req){const a=await account(req);return registry.sources(a.owner);},
  async principal(req,sourceId){const a=await account(req);const lease=registry.lease(a.owner,sourceId);return {userId:a.owner,sourceId:lease.sourceId,lease,session:a.session,expiresAt:a.sessionExpires};},
  async read(req,sourceId){
   const a=await account(req),lease=registry.lease(a.owner,sourceId);
   const result=await readPeer(lease.sourceTag);
   const current=await account(req);if(current.owner!==a.owner||current.session!==a.session)fail(401,'Account session changed');registry.assertLease(lease);
   if(!result)return null;
   const p=await currentPeer(result.deviceId);
   if(!p||p.generation!==result.generation||p.expiresAt<=now()||registry.tag('installation',p.installationId)!==lease.sourceTag)fail(409,'Source connection changed during the read');
   registry.observePeer(p);const finalAccount=await account(req);if(finalAccount.owner!==a.owner||finalAccount.session!==a.session)fail(401,'Account session changed');registry.assertLease(lease);
   return {ownerId:a.owner,sourceId:lease.sourceId,bindingEpoch:lease.epoch,sourceUpdatedAt:result.sourceUpdatedAt,state:projectState(result.state)};
  },
  async unlink(req,input){only(input,['sourceId','expectedVersion']);const a=await account(req,true);return registry.unlink(a.owner,input);},
  async cancelPending(req){const a=await account(req,true);return {cancelled:registry.cancelSession(a.owner,a.session)};}
 };
}
