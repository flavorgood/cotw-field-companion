/** PostgreSQL persistence for the existing account/source ownership contract.
 * Receives a dedicated node-postgres-compatible pool; never discovers credentials,
 * creates schemas, opens another product database, or stores game-save contents.
 */
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
export const ACCOUNT_POSTGRES_SCHEMA='grindzone.account-sources.postgres.v1';
const TAG_DOMAIN='grindzone.account-sources.v1';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const tag=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length>0&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const safeInt=value=>{
  if(typeof value==='string'&&!/^(0|[1-9]\d*)$/.test(value))throw Error('Invalid registry integer');
  if(!['string','number'].includes(typeof value))throw Error('Invalid registry integer');
  const n=Number(value);if(!time(n))throw Error('Registry integer exceeds supported range');return n;
};
const view=r=>r?{sourceId:r.source_id,label:r.label,version:safeInt(r.version),linkedAt:safeInt(r.linked_at)}:null;
const pendingView=r=>({requestId:r.id,state:r.state,expiresAt:safeInt(r.expires)});
const one=async(client,sql,values=[])=>{const r=await client.query(sql,values);return r.rows[0]??null;};
const many=async(client,sql,values=[])=>{const r=await client.query(sql,values);return r.rows;};
const guard=async options=>{if(options?.authorize)await options.authorize();};

/** Parameter binding and transaction affinity are provided by the actual PG driver.
 * The transaction-level lock serializes bounded ownership changes across processes,
 * including global request/source limits. Reads do not acquire this write lock.
 * No automatic retry follows an uncertain COMMIT: callers retain request IDs.
 */
export class PostgresAccountSourceRegistry {
  #pool;#key;#now;#ready=false;#closed=false;#closing=false;#pending=new Set();#ownsPool;
  constructor({pool,key,now=Date.now,ownsPool=false}={}){
    if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function'||!Buffer.isBuffer(key)||key.length!==32||typeof now!=='function')throw TypeError('A dedicated PostgreSQL pool, 32-byte registry key and clock are required');
    this.#pool=pool;this.#key=Buffer.from(key);this.#now=now;this.#ownsPool=ownsPool;
  }
  tag(kind,...values){if(this.#closed)throw Error('Registry is closed');return createHmac('sha256',this.#key).update(JSON.stringify([TAG_DOMAIN,kind,...values])).digest('hex');}
  #clock(){const value=this.#now();if(!time(value))throw Error('Invalid registry clock');return value;}
  async initialize(){
    if(this.#closed||this.#closing)throw Error('Registry is closed');
    const client=await this.#pool.connect();
    try{
      const r=await one(client,`SELECT current_database() AS database,current_user AS role,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,
        EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS inherits_roles
        FROM pg_roles WHERE rolname=current_user`);
      if(r?.database!=='grindzone'||r.role!=='grindzone_runtime'||[r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,r.inherits_roles].some(v=>v!==false))throw Error('Refusing a privileged or unrelated database connection');
      const meta=new Map((await many(client,'SELECT name,value FROM grindzone.gz_binding_meta')).map(r=>[r.name,r.value]));
      if(meta.get('schema')!==ACCOUNT_POSTGRES_SCHEMA||!equal(meta.get('key-check'),this.tag('key-check',ACCOUNT_POSTGRES_SCHEMA)))throw Error('Registry schema or provisioned key does not match');
      this.#ready=true;return this;
    }finally{client.release();}
  }
  #operation(fn){
    if(!this.#ready||this.#closed||this.#closing)return Promise.reject(Error('Registry is not ready'));
    const promise=Promise.resolve().then(fn);this.#pending.add(promise);
    promise.then(()=>this.#pending.delete(promise),()=>this.#pending.delete(promise));return promise;
  }
  #read(fn){return this.#operation(async()=>{const client=await this.#pool.connect();try{return await fn(client);}finally{client.release();}});}
  #tx(fn,options){return this.#operation(async()=>{
    const client=await this.#pool.connect();let began=false,commitStarted=false,destroy=false;
    try{
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');began=true;
      await client.query("SET LOCAL lock_timeout='3000ms'");
      await client.query('SELECT pg_advisory_xact_lock(1197106003,1)');
      await guard(options);
      const result=await fn(client);
      await guard(options);
      commitStarted=true;await client.query('COMMIT');began=false;return result;
    }catch(error){
      if(began){try{await client.query('ROLLBACK');}catch{destroy=true;}}
      if(commitStarted){destroy=true;fail(503,'Source action result is uncertain. Read current status before retrying with the same request identity.');}
      if(['23505','40001','40P01','55P03','57014'].includes(error.code))fail(409,'Source ownership is busy or changed. Refresh before retrying.');
      throw error;
    }finally{client.release(destroy);}
  });}
  async #purge(client,now){await client.query('DELETE FROM grindzone.gz_binding_requests WHERE expires<=$1',[now]);}
  async #generation(client,peer){
    if(!id(peer?.installationId)||!id(peer.deviceId)||!Number.isSafeInteger(peer.generation)||peer.generation<1||!time(peer.expiresAt)||peer.expiresAt<=this.#clock())fail(401,'Current authenticated PC connection required');
    const source=this.tag('installation',peer.installationId),device=this.tag('device',peer.deviceId);
    const old=await one(client,'SELECT generation,device_tag FROM grindzone.gz_source_generations WHERE source_tag=$1',[source]);
    if(old&&(peer.generation<safeInt(old.generation)||peer.generation===safeInt(old.generation)&&device!==old.device_tag))fail(409,'The PC credential was replaced');
    if(!old||peer.generation>safeInt(old.generation)){
      await client.query('INSERT INTO grindzone.gz_source_generations(source_tag,generation,device_tag) VALUES($1,$2,$3) ON CONFLICT(source_tag) DO UPDATE SET generation=EXCLUDED.generation,device_tag=EXCLUDED.device_tag',[source,peer.generation,device]);
      await client.query("UPDATE grindzone.gz_binding_requests SET state='cancelled' WHERE source_tag=$1 AND state IN('pending','pc_approved')",[source]);
    }
    return {source,device};
  }
  observePeer(peer,options){return this.#tx(c=>this.#generation(c,peer),options);}
  request({owner,session,sessionExpires,displayName},peer,{requestId,label}={},options){
    if(!tag(owner)||!tag(session)||!time(sessionExpires)||!id(requestId)||typeof label!=='string'||!label.trim()||label.length>80||typeof displayName!=='string'||displayName.length>80)return Promise.reject(Object.assign(Error('Invalid source-link request'),{status:400}));
    return this.#tx(async c=>{
      const now=this.#clock();if(sessionExpires<=now)fail(401,'Account session expired');
      await this.#purge(c,now);const {source,device}=await this.#generation(c,peer),requestTag=this.tag('request',owner,requestId);
      const old=await one(c,'SELECT * FROM grindzone.gz_binding_requests WHERE request_tag=$1',[requestTag]);
      if(old){if(old.source_tag!==source||old.session_tag!==session||old.label!==label.trim())fail(409,'Request identity already used');return pendingView(old);}
      const binding=await one(c,'SELECT owner_tag,active FROM grindzone.gz_source_bindings WHERE source_tag=$1',[source]);
      if(binding?.active===1&&binding.owner_tag!==owner)fail(409,'This PC is already linked to another account');
      const n=await one(c,"SELECT count(*) AS total,count(*) FILTER(WHERE owner_tag=$1 AND state IN('pending','pc_approved')) AS owned FROM grindzone.gz_binding_requests",[owner]);
      if(safeInt(n.owned)>=5||safeInt(n.total)>=2048)fail(429,'Too many source-link requests');
      const request=randomUUID(),expires=Math.min(now+300000,sessionExpires,peer.expiresAt);
      await c.query(`INSERT INTO grindzone.gz_binding_requests(id,request_tag,owner_tag,session_tag,source_tag,device_tag,generation,label,display_name,expires,state,source_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',NULL)`,[request,requestTag,owner,session,source,device,peer.generation,label.trim(),displayName,expires]);
      return {requestId:request,state:'pending',expiresAt:expires};
    },options);
  }
  pendingFor(peer,options){return this.#tx(async c=>{
    const {source,device}=await this.#generation(c,peer);await this.#purge(c,this.#clock());
    return (await many(c,"SELECT id,display_name,label,expires FROM grindzone.gz_binding_requests WHERE source_tag=$1 AND device_tag=$2 AND state IN('pending','pc_approved') ORDER BY expires,id",[source,device])).map(r=>({requestId:r.id,accountDisplayName:r.display_name,label:r.label,expiresAt:safeInt(r.expires)}));
  },options);}
  decide(peer,{requestId,approve}={},options){
    if(!uuid(requestId)||typeof approve!=='boolean')return Promise.reject(Object.assign(Error('Explicit PC approval or rejection is required'),{status:400}));
    return this.#tx(async c=>{
      const now=this.#clock(),{source,device}=await this.#generation(c,peer),r=await one(c,'SELECT * FROM grindzone.gz_binding_requests WHERE id=$1',[requestId]);
      if(!r||safeInt(r.expires)<=now||r.source_tag!==source||r.device_tag!==device||safeInt(r.generation)!==peer.generation)fail(404,'Source-link request unavailable');
      if(['pc_approved','approved'].includes(r.state)&&approve)return {...pendingView(r),state:'pc_approved'};
      if(r.state==='rejected'&&!approve)return {state:'rejected'};
      if(r.state!=='pending')fail(409,'This source-link request has already been handled');
      await c.query('UPDATE grindzone.gz_binding_requests SET state=$1 WHERE id=$2',[approve?'pc_approved':'rejected',r.id]);
      return approve?{requestId:r.id,state:'pc_approved',expiresAt:safeInt(r.expires)}:{state:'rejected'};
    },options);
  }
  complete({owner,session,sessionExpires},peer,{requestId}={},options){
    if(!tag(owner)||!tag(session)||!uuid(requestId)||!time(sessionExpires))return Promise.reject(Object.assign(Error('A current account session is required to finish linking'),{status:401}));
    return this.#tx(async c=>{
      const now=this.#clock();if(sessionExpires<=now)fail(401,'Account session expired');
      const {source,device}=await this.#generation(c,peer);
      const r=await one(c,'SELECT * FROM grindzone.gz_binding_requests WHERE id=$1 AND owner_tag=$2 AND session_tag=$3',[requestId,owner,session]);
      if(!r||safeInt(r.expires)<=now||r.source_tag!==source||r.device_tag!==device||safeInt(r.generation)!==peer.generation)fail(404,'Source-link request unavailable');
      if(r.state==='approved'){
        const saved=await one(c,'SELECT * FROM grindzone.gz_source_bindings WHERE source_id=$1 AND active=1 AND owner_tag=$2',[r.source_id,owner]);
        if(!saved)fail(410,'The approved binding was removed');return {...view(saved),state:'approved'};
      }
      if(r.state!=='pc_approved')fail(409,'Approve this request on the PC first');
      const old=await one(c,'SELECT * FROM grindzone.gz_source_bindings WHERE source_tag=$1',[source]);
      if(old?.active===1&&old.owner_tag!==owner)fail(409,'This PC is already linked to another account');
      const count=await one(c,'SELECT count(*) AS n FROM grindzone.gz_source_bindings WHERE owner_tag=$1 AND active=1',[owner]);
      if(old?.active!==1&&safeInt(count.n)>=10)fail(429,'Account source limit reached');
      const sourceId=old?.active===1?old.source_id:randomUUID(),version=old?safeInt(old.version)+1:1,epoch=randomUUID();
      if(!Number.isSafeInteger(version))fail(409,'Binding version exhausted');
      await c.query(`INSERT INTO grindzone.gz_source_bindings(source_id,source_tag,owner_tag,label,version,epoch,active,linked_at) VALUES($1,$2,$3,$4,$5,$6,1,$7)
        ON CONFLICT(source_tag) DO UPDATE SET source_id=EXCLUDED.source_id,owner_tag=EXCLUDED.owner_tag,label=EXCLUDED.label,version=EXCLUDED.version,epoch=EXCLUDED.epoch,active=1,linked_at=EXCLUDED.linked_at`,[sourceId,source,owner,r.label,version,epoch,now]);
      await c.query("UPDATE grindzone.gz_binding_requests SET state='approved',source_id=$1 WHERE id=$2",[sourceId,r.id]);
      await c.query("UPDATE grindzone.gz_binding_requests SET state='cancelled' WHERE source_tag=$1 AND state IN('pending','pc_approved')",[source]);
      return {sourceId,label:r.label,version,linkedAt:now,state:'approved'};
    },options);
  }
  sources(owner){
    if(!tag(owner))return Promise.reject(Object.assign(Error('Verified account required'),{status:401}));
    return this.#read(async c=>(await many(c,'SELECT * FROM grindzone.gz_source_bindings WHERE owner_tag=$1 AND active=1 ORDER BY linked_at,source_id',[owner])).map(view));
  }
  async #lease(c,owner,sourceId){
    if(!tag(owner)||!uuid(sourceId))fail(404,'Source not linked to this account');
    const r=await one(c,'SELECT * FROM grindzone.gz_source_bindings WHERE owner_tag=$1 AND source_id=$2 AND active=1',[owner,sourceId]);
    if(!r)fail(404,'Source not linked to this account');
    return Object.freeze({ownerId:owner,sourceId:r.source_id,sourceTag:r.source_tag,epoch:r.epoch,version:safeInt(r.version)});
  }
  lease(owner,sourceId){return this.#read(c=>this.#lease(c,owner,sourceId));}
  assertLease(lease){return this.#read(async c=>{const current=await this.#lease(c,lease?.ownerId,lease?.sourceId);if(current.epoch!==lease.epoch||current.version!==lease.version)fail(409,'Source ownership changed during this request');return current;});}
  cancelSession(owner,session,options){
    if(!tag(owner)||!tag(session))return Promise.reject(Object.assign(Error('Invalid session'),{status:400}));
    return this.#tx(async c=>(await c.query("UPDATE grindzone.gz_binding_requests SET state='cancelled' WHERE owner_tag=$1 AND session_tag=$2 AND state IN('pending','pc_approved')",[owner,session])).rowCount,options);
  }
  unlink(owner,{sourceId,expectedVersion}={},options){return this.#tx(async c=>{
    const lease=await this.#lease(c,owner,sourceId);
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion!==lease.version||expectedVersion>=Number.MAX_SAFE_INTEGER)fail(409,'Refresh the source before unlinking');
    const result=await c.query('UPDATE grindzone.gz_source_bindings SET active=0,epoch=$1,version=version+1 WHERE source_id=$2 AND owner_tag=$3 AND active=1 AND version=$4',[randomUUID(),sourceId,owner,expectedVersion]);
    if(result.rowCount!==1)fail(409,'Source ownership changed');
    await c.query("UPDATE grindzone.gz_binding_requests SET state='cancelled' WHERE source_tag=$1 AND state IN('pending','pc_approved')",[lease.sourceTag]);
    return {unlinked:true,sourceId,version:expectedVersion+1,sourceFilesModified:false};
  },options);}
  async close(){
    if(this.#closed)return;this.#closing=true;await Promise.allSettled([...this.#pending]);
    if(this.#ownsPool)await this.#pool.end();this.#key.fill(0);this.#closed=true;
  }
}
