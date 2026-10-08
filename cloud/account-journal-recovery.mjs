/** Opt-in account backup for the canonical browser journal. No identity provider or Xbox access is invented. */
import {DatabaseSync} from 'node:sqlite';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {chmodSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {validateJournal,JOURNAL_LIMITS} from '../public/browser-journal.js';

const schema='grindzone.account-journal.v1';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const tag=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length>0&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const only=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail(400,'Unsupported recovery fields.');};
const encoded=journal=>{let checked;try{checked=validateJournal(journal);}catch{fail(400,'Choose a valid GrindZone browser journal.');}const text=JSON.stringify(checked);if(Buffer.byteLength(text)>JOURNAL_LIMITS.bytes)fail(413,'The journal is too large to back up.');return text;};

/** A dedicated durable file, never the PC journal or existing account-source registry.
 * Host must provide its existing private key and verify sessions. This store creates neither.
 * All access is serialized; authorization is rechecked after queueing, immediately before storage access.
 */
export class AccountJournalStore{
 #db;#key;#queue=Promise.resolve();#closed=false;
 constructor({filename,key}={}){
  if(typeof filename!=='string'||!filename||filename===':memory:'||!Buffer.isBuffer(key)||key.length!==32)throw TypeError('A dedicated durable filename and existing 32-byte private key are required.');
  for(let current=path.resolve(filename);;current=path.dirname(current)){
   try{if(lstatSync(current).isSymbolicLink())throw TypeError('Recovery storage cannot follow symbolic links.');}catch(error){if(error.code!=='ENOENT')throw error;}
   if(path.dirname(current)===current)break;
  }
  this.#key=Buffer.from(key);this.#db=new DatabaseSync(filename);
  try{
   const tables=this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
   if(tables.length){
    if(!tables.some(row=>row.name==='gz_journal_meta'))throw TypeError('Refusing an unrelated database.');
    const metadata=new Map(this.#db.prepare('SELECT name,value FROM gz_journal_meta').all().map(row=>[row.name,row.value]));
    if(metadata.get('schema')!==schema||!equal(metadata.get('key-check'),this.identity('key-check',schema)))throw TypeError('Recovery schema or key mismatch.');
   }
   this.#db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS gz_journal_meta(name TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gz_journal_backups(owner_tag TEXT PRIMARY KEY,version INTEGER NOT NULL,updated_at TEXT NOT NULL,journal TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gz_journal_requests(owner_tag TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_tag,request_id));`);
   this.#db.prepare('INSERT OR IGNORE INTO gz_journal_meta VALUES(?,?)').run('schema',schema);
   this.#db.prepare('INSERT OR IGNORE INTO gz_journal_meta VALUES(?,?)').run('key-check',this.identity('key-check',schema));
   chmodSync(filename,0o600);
  }catch(error){this.#db.close();this.#key.fill(0);throw error;}
 }
 identity(kind,...values){if(this.#closed)throw Error('Recovery store is closed.');return createHmac('sha256',this.#key).update(JSON.stringify([schema,kind,...values])).digest('hex');}
 #run(authorize,work){
  if(typeof authorize!=='function')throw TypeError('A current account authorization guard is required.');
  const result=this.#queue.then(async()=>{if(this.#closed)throw Error('Recovery store is closed.');await authorize();return work();});
  this.#queue=result.catch(()=>{});return result;
 }
 read(owner,{authorize}={}){
  if(!tag(owner))fail(401,'Verified account required.');
  return this.#run(authorize,()=>{const row=this.#db.prepare('SELECT * FROM gz_journal_backups WHERE owner_tag=?').get(owner);return row?{version:row.version,updatedAt:row.updated_at,journal:validateJournal(JSON.parse(row.journal))}:null;});
 }
 publish(owner,input,{authorize,now}={}){
  only(input,['requestId','expectedVersion','journal']);
  if(!tag(owner)||!validId(input.requestId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||typeof now!=='string'||!Number.isFinite(Date.parse(now))||new Date(now).toISOString()!==now)fail(400,'Invalid recovery request.');
  const text=encoded(input.journal),fingerprint=createHash('sha256').update(JSON.stringify([input.expectedVersion,text])).digest('hex');
  return this.#run(authorize,()=>{
   this.#db.exec('BEGIN IMMEDIATE');
   try{
    const oldRequest=this.#db.prepare('SELECT * FROM gz_journal_requests WHERE owner_tag=? AND request_id=?').get(owner,input.requestId);
    if(oldRequest){if(oldRequest.fingerprint!==fingerprint)fail(409,'This request identity was used for a different backup.');this.#db.exec('COMMIT');return {version:oldRequest.version,updatedAt:oldRequest.updated_at,replay:true};}
    const current=this.#db.prepare('SELECT version FROM gz_journal_backups WHERE owner_tag=?').get(owner)?.version??0;
    if(current!==input.expectedVersion||current===Number.MAX_SAFE_INTEGER)fail(409,'Account backup changed. Refresh and review before replacing it.');
    if(this.#db.prepare('SELECT count(*) AS n FROM gz_journal_requests WHERE owner_tag=?').get(owner).n>=JOURNAL_LIMITS.commands)fail(429,'Backup request history is full. Existing backups remain available.');
    const version=current+1;
    this.#db.prepare('INSERT INTO gz_journal_backups VALUES(?,?,?,?) ON CONFLICT(owner_tag) DO UPDATE SET version=excluded.version,updated_at=excluded.updated_at,journal=excluded.journal').run(owner,version,now,text);
    this.#db.prepare('INSERT INTO gz_journal_requests VALUES(?,?,?,?,?)').run(owner,input.requestId,fingerprint,version,now);
    this.#db.exec('COMMIT');return {version,updatedAt:now,replay:false};
   }catch(error){this.#db.exec('ROLLBACK');throw error;}
  });
 }
 async close(){await this.#queue;if(!this.#closed){this.#db.close();this.#key.fill(0);this.#closed=true;}}
}

/** Real provider verification is a mandatory host callback. No gamertag, browser body or cross-product cookie is identity. */
export function createAccountJournalRecovery({store,issuer,publicOrigin,authenticateAccount,now=Date.now,signInPath=null}={}){
 if(!store||typeof authenticateAccount!=='function'||typeof now!=='function')throw TypeError('Durable storage and verified account authentication are required.');
 const base=new URL(publicOrigin),origin=base.origin,mount=base.pathname==='/'?'':base.pathname.replace(/\/$/,'');
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!['','/grindzone'].includes(mount)||typeof issuer!=='string'||new URL(issuer).protocol!=='https:')throw TypeError('Fixed HTTPS GrindZone origin and account issuer required.');
 if(signInPath!==null&&(typeof signInPath!=='string'||!signInPath.startsWith(mount+'/account/')||signInPath.includes('..')||new URL(signInPath,origin).origin!==origin))throw TypeError('Use an existing same-origin account route.');
 async function account(req,write=false){
  if(req.headers.host!==base.host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))fail(403,'Open GrindZone directly.');
  const value=await authenticateAccount(req),timestamp=now();
  if(!value||value.issuer!==issuer||!validId(value.subject)||!validId(value.sessionId)||value.emailVerified!==true||!Number.isSafeInteger(timestamp)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=timestamp||typeof value.csrf!=='string'||!value.csrf)fail(401,'Sign in to your verified GrindZone account.');
  if(write&&(req.headers.origin!==origin||!equal(req.headers['x-grindzone-account-csrf'],value.csrf)))fail(403,'Refresh account recovery before saving.');
  const owner=store.identity('owner',issuer,value.subject),scope=store.identity('session',issuer,value.subject,value.sessionId);
  return {owner,scope,csrf:value.csrf,displayName:typeof value.displayName==='string'?value.displayName.slice(0,80):'GrindZone player'};
 }
 async function recheck(req,prior,write=false){const current=await account(req,write);if(current.owner!==prior.owner||current.scope!==prior.scope)fail(401,'Account session changed. Refresh recovery.');return current;}
 return Object.freeze({
  signInPath,
  async status(req){const a=await account(req),backup=await store.read(a.owner,{authorize:()=>recheck(req,a)});await recheck(req,a);return {available:true,scope:a.scope,csrf:a.csrf,displayName:a.displayName,backup:backup?{version:backup.version,updatedAt:backup.updatedAt,grinds:backup.journal.grinds.length,reports:backup.journal.reports.length,places:backup.journal.places.length}:null};},
  async read(req){const a=await account(req),backup=await store.read(a.owner,{authorize:()=>recheck(req,a)});await recheck(req,a);return {scope:a.scope,backup};},
  async publish(req,input){const a=await account(req,true),result=await store.publish(a.owner,input,{authorize:()=>recheck(req,a,true),now:new Date(now()).toISOString()});await recheck(req,a,true);return {scope:a.scope,...result};}
 });
}

/** Synchronous route match, asynchronous response; safe in the existing relay's synchronous mounting chain. */
export function createAccountRecoveryHandler({recovery=null,prefix,origin,headers={}}={}){
 const send=(res,status,value)=>{res.writeHead(status,{...headers,'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 return (req,res)=>{
  let url;try{url=new URL(req.url,origin);}catch{return false;}
  if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
  void (async()=>{
   try{
    if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))fail(403,'Open GrindZone directly.');
    if(!recovery){send(res,503,{error:'Account recovery is not connected here.',available:false});return;}
    if(url.search)fail(400,'Unexpected recovery query.');
    if(req.method==='GET'&&url.pathname===prefix+'/status'){send(res,200,await recovery.status(req));return;}
    if(req.method==='GET'&&url.pathname===prefix+'/backup'){send(res,200,await recovery.read(req));return;}
    if(req.method!=='POST'||url.pathname!==prefix+'/backup')fail(405,'Recovery action is unavailable.');
    if(String(req.headers['content-type']??'').split(';')[0].trim()!=='application/json')fail(415,'JSON required.');
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>JOURNAL_LIMITS.bytes+16384)fail(413,'The backup is too large.');chunks.push(chunk);}
    let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'Invalid backup request.');}
    send(res,200,await recovery.publish(req,input));
   }catch(error){const status=[400,401,403,405,409,413,415,429].includes(error.status)?error.status:500;send(res,status,{error:status===500?'Account recovery could not complete. Your local journal is unchanged.':error.message,...(status===401&&recovery.signInPath?{signInPath:recovery.signInPath}:{})});}
  })();return true;
 };
}
