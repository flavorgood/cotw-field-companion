/** Signed release transport and crash-recoverable side-by-side installation. Never reads game saves. */
import {createHash,createPublicKey,verify,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import * as fs from 'node:fs';
import path from 'node:path';
export const PROTOCOL=1, MAX_BUNDLE=160*1024*1024, MAX_EXPANDED=256*1024*1024;
const MAGIC=Buffer.from('GZUP001\0'), HEX=/^[a-f0-9]{64}$/, SHA=/^[a-f0-9]{40}$/;
// This directed transition was verified against both Store versions with a synthetic journal.
// The declaration must also be present in the signed candidate manifest.
const STORAGE_MIGRATION={
 fromContract:'dc432ed6c7310c3c4838c3cc1bc75ca39a94360415a7a5a7c1b7923262ea78e1',
 toContract:'36fa80548ed26eda06101b2db3c271a00547d1d14f5b94e18108ad4a86209e33',
};
export function fileDigest(file){const fd=fs.openSync(file,'r'),buf=Buffer.alloc(1024*1024),h=createHash('sha256');try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))h.update(buf.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
export const digest=b=>createHash('sha256').update(b).digest('hex');
const fail=m=>{throw Error(m);};
export function canonical(v){
 if(v===null||typeof v!=='object')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
}
export function safeName(v){
 if(typeof v!=='string'||v.length>200||!/^[A-Za-z0-9_.\/-]+$/.test(v))fail('Invalid release path');
 const parts=v.split('/');
 if(parts.some(p=>!p||p==='.'||p==='..'||p.endsWith('.')||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))fail('Unsafe Windows release path');
 return v;
}
export function inside(a,b){const r=path.relative(a,b);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
/** Reject junctions/symlinks on every existing ancestor, including installation parents. */
export function plainPath(p){
 const full=path.resolve(p),parts=[];let at=full;
 while(true){parts.push(at);const up=path.dirname(at);if(up===at)break;at=up;}
 for(const part of parts.reverse()){let st;try{st=fs.lstatSync(part);}catch(e){if(e.code==='ENOENT')continue;throw e;}if(st.isSymbolicLink())fail('Managed paths cannot use symbolic links or junctions');}
 return full;
}
function syncDir(dir){let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd);}catch(e){if(!['EINVAL','EISDIR','EPERM','EBADF','EACCES'].includes(e.code))throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}}
export function atomicJson(file,value){
 plainPath(file);const tmp=file+'.'+randomUUID()+'.tmp',fd=fs.openSync(tmp,'wx',0o600);
 try{fs.writeFileSync(fd,canonical(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.renameSync(tmp,file);syncDir(path.dirname(file));}catch(e){fs.rmSync(tmp,{force:true});throw e;}
}
function readJson(file,max=1024*1024){plainPath(file);const st=fs.statSync(file);if(!st.isFile()||st.size>max)fail('Invalid managed metadata');return JSON.parse(fs.readFileSync(file,'utf8'));}
export function validateManifest(m){
 if(!m||m.schema!=='grindzone.update-manifest.v1'||m.product!=='GrindZone'||m.channel!=='stable'||m.platform!=='win32-x64'||m.protocol!==PROTOCOL)fail('Incompatible signed release');
 if(!Number.isSafeInteger(m.sequence)||m.sequence<1||!SHA.test(m.revision)||!HEX.test(m.runtimeFingerprint)||!HEX.test(m.storageContract)||m.journalEpoch!==1)fail('Invalid release identity or storage contract');
 if(m.storageMigration!==undefined){
  const migration=m.storageMigration;
  if(!migration||typeof migration!=='object'||Array.isArray(migration)||Object.keys(migration).sort().join(',')!=='fromContract,toContract'||!HEX.test(migration.fromContract)||migration.toContract!==m.storageContract||migration.fromContract===migration.toContract)fail('Invalid signed storage migration');
 }
 if(!Number.isFinite(Date.parse(m.publishedAt))||!Number.isFinite(Date.parse(m.expiresAt))||Date.parse(m.expiresAt)<=Date.parse(m.publishedAt))fail('Invalid release dates');
 if(!m.bundle||m.bundle.name!==`payload-${m.bundle.sha256}.gz`||!HEX.test(m.bundle.sha256)||!Number.isSafeInteger(m.bundle.bytes)||m.bundle.bytes<1||m.bundle.bytes>MAX_BUNDLE)fail('Invalid release bundle');
 if(!Array.isArray(m.files)||m.files.length<4||m.files.length>512)fail('Invalid release file list');
 const seen=new Set();let total=0;
 for(const f of m.files){safeName(f.path);const key=f.path.toLowerCase();if(seen.has(key)||!HEX.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>150*1024*1024)fail('Invalid or duplicate release member');seen.add(key);total+=f.bytes;}
 if(total>MAX_EXPANDED)fail('Expanded release is too large');
 for(const n of ['package.json','server.mjs','launcher.mjs','runtime/node.exe'])if(!seen.has(n))fail('Incomplete application release');
 if(!Array.isArray(m.files)||m.files.some(f=>/\.(sqlite|pem|key|env)(?:$|\.)/i.test(f.path)||/(^|\/)\.env/.test(f.path)))fail('Private files cannot enter a release');
 return m;
}
/** Signed contract equality or the one audited, directed journal transition. */
export function canActivateStorageContract(oldManifest,nextManifest){
 if(!oldManifest||!nextManifest||oldManifest.journalEpoch!==1||nextManifest.journalEpoch!==oldManifest.journalEpoch||!HEX.test(oldManifest.storageContract)||!HEX.test(nextManifest.storageContract))return false;
 if(oldManifest.storageContract===nextManifest.storageContract)return true;
 const migration=nextManifest.storageMigration;
 return Number.isSafeInteger(oldManifest.sequence)&&Number.isSafeInteger(nextManifest.sequence)&&nextManifest.sequence>oldManifest.sequence
  &&oldManifest.storageContract===STORAGE_MIGRATION.fromContract
  &&nextManifest.storageContract===STORAGE_MIGRATION.toContract
  &&migration?.fromContract===STORAGE_MIGRATION.fromContract
  &&migration?.toContract===STORAGE_MIGRATION.toContract
  &&oldManifest.files?.some(file=>file.path==='lib/store.mjs'&&file.sha256===oldManifest.storageContract)
  &&nextManifest.files?.some(file=>file.path==='lib/store.mjs'&&file.sha256===nextManifest.storageContract);
}
export function signedManifest(envelope,trust,{network=false,now=Date.now()}={}){
 if(!envelope||envelope.schema!=='grindzone.signed-release.v1'||typeof envelope.keyId!=='string'||typeof envelope.payload!=='string'||typeof envelope.signature!=='string')fail('Signed release required');
 if(envelope.payload.length>300000||!/^[-A-Za-z0-9+/]*={0,2}$/.test(envelope.payload)||!/^[-A-Za-z0-9+/]*={0,2}$/.test(envelope.signature))fail('Invalid signature encoding');
 const pem=trust?.keys?.[envelope.keyId];if(typeof pem!=='string')fail('Release signing key is not trusted');
 const key=createPublicKey(pem);if(key.asymmetricKeyType!=='ed25519')fail('An Ed25519 release key is required');
 const bytes=Buffer.from(envelope.payload,'base64'),sig=Buffer.from(envelope.signature,'base64');
 if(sig.length!==64||!verify(null,bytes,key,sig))fail('Release signature is invalid');
 let m;try{m=JSON.parse(bytes.toString('utf8'));}catch{fail('Invalid signed payload');}
 if(canonical(m)!==bytes.toString('utf8'))fail('Release payload is not canonical');validateManifest(m);
 if(network&&(Date.parse(m.expiresAt)<=now||Date.parse(m.publishedAt)>now+86400000))fail('Release metadata is expired or future dated');
 return m;
}
export function encodeBundle(entries){
 entries=[...entries];
 const parts=[MAGIC,Buffer.alloc(4)];parts[1].writeUInt32LE(entries.length);
 for(const [name,bytes] of entries){safeName(name);const n=Buffer.from(name),h=Buffer.alloc(6);h.writeUInt16LE(n.length);h.writeUInt32LE(bytes.length,2);parts.push(h,n,bytes);}
 return gzipSync(Buffer.concat(parts),{level:6});
}
export function decodeBundle(bytes,m){
 if(!Buffer.isBuffer(bytes)||bytes.length!==m.bundle.bytes||digest(bytes)!==m.bundle.sha256)fail('Downloaded release checksum mismatch');
 const raw=gunzipSync(bytes,{maxOutputLength:MAX_EXPANDED+1024*1024});
 if(raw.length<12||!raw.subarray(0,8).equals(MAGIC)||raw.readUInt32LE(8)!==m.files.length)fail('Invalid release container');
 let at=12;const entries=new Map(),expected=new Map(m.files.map(f=>[f.path,f]));
 for(let i=0;i<m.files.length;i++){
  if(at+6>raw.length)fail('Truncated release container');const n=raw.readUInt16LE(at),size=raw.readUInt32LE(at+2);at+=6;
  if(n<1||n>200||at+n+size>raw.length)fail('Truncated release member');const name=raw.toString('utf8',at,at+n);at+=n;safeName(name);
  const f=expected.get(name),data=raw.subarray(at,at+size);at+=size;
  if(!f||entries.has(name)||size!==f.bytes||digest(data)!==f.sha256)fail('Release member checksum mismatch');entries.set(name,data);
 }
 if(at!==raw.length)fail('Unexpected trailing release content');return entries;
}
export async function download(url,{maxBytes,timeoutMs=120000,fetcher=fetch,signal}={}){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.hash)fail('Updates require credential-free HTTPS');
 const response=await fetcher(u.href,{redirect:'error',credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs),headers:{Accept:'application/octet-stream'}});
 if(!response.ok||!response.body)fail('Update download is unavailable');
 const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>maxBytes)fail('Update response exceeds its limit');
 const chunks=[];let total=0;try{for await(const chunk of response.body){total+=chunk.length;if(total>maxBytes)fail('Update response exceeds its limit');chunks.push(Buffer.from(chunk));}}catch(e){throw e;}
 return Buffer.concat(chunks);
}
export function acquireLock(home){
 plainPath(home);fs.mkdirSync(home,{recursive:true});plainPath(path.join(home,'update-lock.sqlite'));
 const db=new DatabaseSync(path.join(home,'update-lock.sqlite'));
 try{db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner(id INTEGER);');}
 catch(e){db.close();throw Object.assign(Error('GrindZone is already running or another installation is updating.'),{code:'UPDATE_LOCKED',cause:e});}
 let closed=false;return ()=>{if(!closed){closed=true;try{db.exec('ROLLBACK');}finally{db.close();}}};
}
export function loadState(home){
 const file=path.join(home,'state.json');if(!fs.existsSync(file))return {schema:'grindzone.install-state.v1',current:null,previous:null,staged:null,pending:null,highWater:0,rejected:[],lastCheck:null,lastError:null};
 const s=readJson(file);if(s.schema!=='grindzone.install-state.v1'||!Number.isSafeInteger(s.highWater)||s.highWater<0||!Array.isArray(s.rejected)||s.rejected.some(x=>!SHA.test(x)))fail('Installation state is invalid');
 for(const k of ['current','previous','staged'])if(s[k]!==null&&!SHA.test(s[k]))fail('Invalid installed release pointer');
 if(s.pending&&(!SHA.test(s.pending.candidate)||!SHA.test(s.pending.previous)||!['prepared','committed'].includes(s.pending.phase)||!/^backup-[a-f0-9-]{36}$/.test(s.pending.backup)))fail('Invalid pending update');
 return s;
}
export const saveState=(home,s)=>atomicJson(path.join(home,'state.json'),s);
export function releaseDir(home,revision){if(!SHA.test(revision))fail('Invalid release revision');return plainPath(path.join(home,'releases',revision));}
export function readRelease(home,revision,trust){const dir=releaseDir(home,revision),envelope=readJson(path.join(dir,'SIGNED-RELEASE.json'));const manifest=signedManifest(envelope,trust);if(manifest.revision!==revision)fail('Installed release identity mismatch');return {dir,envelope,manifest};}
export function verifyDirectory(dir,m){
 plainPath(dir);const expected=new Set(m.files.map(f=>f.path));
 for(const f of m.files){const full=plainPath(path.join(dir,safeName(f.path))),st=fs.statSync(full);if(!st.isFile()||st.size!==f.bytes||digest(fs.readFileSync(full))!==f.sha256)fail('Installed release integrity failed: '+f.path);}
 function walk(relative=''){for(const e of fs.readdirSync(path.join(dir,relative),{withFileTypes:true})){const name=path.posix.join(relative,e.name);if(e.isSymbolicLink())fail('Installed release contains a link');if(e.isDirectory())walk(name);else if(name!=='SIGNED-RELEASE.json'&&!expected.has(name))fail('Unexpected installed release file');}}
 walk();return true;
}
export function stageEntries(home,envelope,trust,entries){
 const m=signedManifest(envelope,trust),target=releaseDir(home,m.revision);
 if(fs.existsSync(target)){const old=readRelease(home,m.revision,trust);if(canonical(old.manifest)!==canonical(m))fail('Release revision was reused with different contents');verifyDirectory(target,m);return m;}
 const parent=plainPath(path.join(home,'releases'));fs.mkdirSync(parent,{recursive:true});const temporary=path.join(parent,'.stage-'+randomUUID());fs.mkdirSync(temporary);
 try{
  for(const f of m.files){const data=entries.get(f.path);if(!data||data.length!==f.bytes||digest(data)!==f.sha256)fail('Release member did not match signature');const full=path.join(temporary,f.path);fs.mkdirSync(path.dirname(full),{recursive:true});const fd=fs.openSync(full,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  atomicJson(path.join(temporary,'SIGNED-RELEASE.json'),envelope);verifyDirectory(temporary,m);fs.renameSync(temporary,target);syncDir(parent);return m;
 }catch(e){fs.rmSync(temporary,{recursive:true,force:true});throw e;}
}
export function installSeed(home,source,envelope,trust){
 const m=signedManifest(envelope,trust);verifyDirectory(source,m);const state=loadState(home);
 if(state.current){const old=readRelease(home,state.current,trust);verifyDirectory(old.dir,old.manifest);return {installed:false,state};}
 const entries=new Map(m.files.map(f=>[f.path,fs.readFileSync(path.join(source,f.path))]));stageEntries(home,envelope,trust,entries);
 saveState(home,{...state,current:m.revision,highWater:m.sequence});return {installed:true,state:loadState(home)};
}
export async function checkAndStage(home,trust,{fetcher=fetch,now=Date.now(),signal}={}){
 let s=loadState(home);if(!s.current)fail('Install GrindZone before checking for updates');
 try{
  const base=new URL(trust.updateUrl);if(base.protocol!=='https:'||!base.pathname.endsWith('/latest.json')||base.search||base.hash)fail('Invalid trusted update endpoint');
  const raw=await download(base.href,{maxBytes:400000,timeoutMs:15000,fetcher,signal}),envelope=JSON.parse(raw.toString('utf8'));
  const m=signedManifest(envelope,trust,{network:true,now}),old=readRelease(home,s.current,trust).manifest;
  if(m.sequence<s.highWater||m.sequence===s.highWater&&!([s.current,s.staged].includes(m.revision)))fail('Older or conflicting update metadata was rejected');
  if(m.revision===s.current){s.lastCheck=new Date(now).toISOString();s.lastError=null;saveState(home,s);return {status:'current',revision:m.revision};}
  if(s.rejected.includes(m.revision))fail('This update previously failed startup; the working version is retained');
  if(!canActivateStorageContract(old,m))fail('This release changes journal compatibility and requires a separately verified migration');
  const bytes=await download(new URL(m.bundle.name,base).href,{maxBytes:m.bundle.bytes,fetcher,signal});const entries=decodeBundle(bytes,m);stageEntries(home,envelope,trust,entries);
  s={...s,staged:m.revision,highWater:m.sequence,lastCheck:new Date(now).toISOString(),lastError:null};saveState(home,s);return {status:'staged',revision:m.revision};
 }catch(e){s.lastCheck=new Date(now).toISOString();s.lastError=String(e.message).slice(0,200);saveState(home,s);return {status:'unavailable',error:s.lastError};}
}
const JOURNAL_FILES=['journal.sqlite','journal.sqlite-wal','journal.sqlite-shm'];
function dataPath(home,dataDir){plainPath(dataDir);if(inside(home,dataDir)||inside(dataDir,home))fail('Installation and journal directories must be separate');return path.resolve(dataDir);}
/** Cold journal copy: caller must own the installation and have no app child running. */
export function snapshotJournal(home,dataDir){
 dataPath(home,dataDir);const name='backup-'+randomUUID(),dir=plainPath(path.join(home,'backups',name));fs.mkdirSync(dir,{recursive:true});const files=[];
 try{
  for(const n of JOURNAL_FILES){const full=plainPath(path.join(dataDir,n));if(!fs.existsSync(full))continue;const st=fs.statSync(full);if(!st.isFile()||st.size>2*1024*1024*1024)fail('Journal backup exceeds its safe size');fs.copyFileSync(full,path.join(dir,n),fs.constants.COPYFILE_EXCL);const fd=fs.openSync(path.join(dir,n),'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}files.push({name:n,bytes:st.size,sha256:fileDigest(path.join(dir,n))});}
  atomicJson(path.join(dir,'backup.json'),{schema:'grindzone.cold-backup.v1',dataScope:digest(Buffer.from(path.resolve(dataDir))),files});return name;
 }catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
}
export function restoreJournal(home,dataDir,name){
 dataPath(home,dataDir);if(!/^backup-[a-f0-9-]{36}$/.test(name))fail('Invalid recovery backup');const dir=plainPath(path.join(home,'backups',name)),b=readJson(path.join(dir,'backup.json'));
 if(b.schema!=='grindzone.cold-backup.v1'||b.dataScope!==digest(Buffer.from(path.resolve(dataDir)))||!Array.isArray(b.files))fail('Backup belongs to another journal');
 const seen=new Set();for(const f of b.files){if(!JOURNAL_FILES.includes(f.name)||seen.has(f.name))fail('Invalid backup file');seen.add(f.name);const p=plainPath(path.join(dir,f.name));if(fs.statSync(p).size!==f.bytes||fileDigest(p)!==f.sha256)fail('Recovery backup integrity failed');}
 fs.mkdirSync(dataDir,{recursive:true});
 // Preserve failed-candidate journal bytes separately; recovery never erases unrelated user files.
 const quarantine=path.join(dir,'failed-'+randomUUID());fs.mkdirSync(quarantine);
 for(const n of JOURNAL_FILES){const full=plainPath(path.join(dataDir,n));if(fs.existsSync(full))fs.copyFileSync(full,path.join(quarantine,n),fs.constants.COPYFILE_EXCL);}
 // Prepare and verify every restore member before replacing any current journal bytes.
 const staged=new Map();
 try{
  for(const f of b.files){const tmp=plainPath(path.join(dataDir,f.name)+'.recover-'+randomUUID());staged.set(f.name,tmp);try{fs.copyFileSync(plainPath(path.join(dir,f.name)),tmp,fs.constants.COPYFILE_EXCL);}catch(error){if(error.code==='EEXIST')staged.delete(f.name);throw error;}const fd=fs.openSync(tmp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(fs.statSync(tmp).size!==f.bytes||fileDigest(tmp)!==f.sha256)fail('Recovery staging integrity failed');}
  for(const n of JOURNAL_FILES){const full=plainPath(path.join(dataDir,n));if(seen.has(n))fs.renameSync(staged.get(n),full);else fs.rmSync(full,{force:true});}
  syncDir(dataDir);
 }finally{for(const tmp of staged.values())fs.rmSync(tmp,{force:true});}
}
export function beginActivation(home,dataDir,trust){
 const s=loadState(home);if(!s.staged||s.pending)return null;
 const old=readRelease(home,s.current,trust),next=readRelease(home,s.staged,trust);verifyDirectory(next.dir,next.manifest);
 if(!canActivateStorageContract(old.manifest,next.manifest))fail('Unsafe journal migration');
 const backup=snapshotJournal(home,dataDir);s.pending={previous:s.current,candidate:s.staged,backup,phase:'prepared'};saveState(home,s);return s.pending;
}
export function commitActivation(home){
 const s=loadState(home);if(!s.pending||s.pending.phase!=='prepared')fail('No pending activation');
 s.previous=s.current;s.current=s.pending.candidate;s.staged=null;s.pending.phase='committed';saveState(home,s);
 // The durable committed phase forbids restoring the old journal after user commands can resume.
 s.pending=null;saveState(home,s);return s;
}
export function recoverActivation(home,dataDir){
 const s=loadState(home);if(!s.pending)return false;
 if(s.pending.phase==='prepared'){
  restoreJournal(home,dataDir,s.pending.backup);s.current=s.pending.previous;s.staged=null;s.rejected=[...new Set([...s.rejected,s.pending.candidate])].slice(-50);s.lastError='The update did not finish startup. The previous version and journal were restored.';
 }
 s.pending=null;saveState(home,s);return true;
}
export function publicStatus(home){const s=loadState(home);return {schema:'grindzone.updates.v1',managed:true,current:s.current,previous:s.previous,staged:s.staged,lastCheck:s.lastCheck,lastError:s.lastError,policy:'Downloads automatically. Activates on the next launch; an active hunt is never restarted.'};}

// The last browser-based installed release must remain visible if a desktop update
// cannot activate. No other signed release may silently substitute a browser.
export function desktopWindowMode(manifest){
 if(manifest.files.some(file=>file.path==='desktop/GrindZone.Desktop.exe'))return 'native';
 if(manifest.revision==='ea4214c3d60011b4f1ae201d39d90fc157f329d5')return 'legacy-browser';
 fail('The signed release does not include its desktop window.');
}

/** Revert executable code only after commitment. Never rewind post-activation player writes. */
export function fallbackCode(home,trust){
 const s=loadState(home);if(s.pending||!s.previous)return false;
 const old=readRelease(home,s.previous,trust),current=readRelease(home,s.current,trust);
 if(old.manifest.storageContract!==current.manifest.storageContract)fail('Code rollback is not journal-compatible');
 verifyDirectory(old.dir,old.manifest);s.rejected=[...new Set([...s.rejected,s.current])].slice(-50);s.current=s.previous;s.previous=null;s.staged=null;s.lastError='The newer app could not start. The previous compatible app was selected without rewinding your journal.';saveState(home,s);return true;
}
