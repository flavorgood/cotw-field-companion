import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync,statSync,symlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AccountJournalStore,createAccountJournalRecovery} from '../cloud/account-journal-recovery.mjs';
import {createBrowserPlayHandler} from '../cloud/browser-play.mjs';
import {newJournal,applyJournalCommand,commandFingerprint,validateJournal} from '../public/browser-journal.js';
import {makeScreenshotEvidence} from '../public/harvest-intake-core.js';

const issuer='https://accounts.grindzone.test',origin='https://journal.grindzone.test';
const now=Date.parse('2026-10-08T12:00:00.000Z');
const pass=async()=>{};
const req=(cookie='alice-one',extra={})=>({headers:{host:'journal.grindzone.test',cookie:'fixture='+cookie,...extra}});
function account(subject,sessionId){return {issuer,subject,sessionId,expiresAt:now+60000,emailVerified:true,csrf:'fixture-csrf-'+sessionId,displayName:subject};}
function fixture(t){
 const directory=mkdtempSync(path.join(os.tmpdir(),'grindzone-recovery-')),filename=path.join(directory,'recovery.sqlite'),key=randomBytes(32);
 const store=new AccountJournalStore({filename,key}),sessions=new Map([['alice-one',account('alice','one')],['alice-two',account('alice','two')],['bob-one',account('bob','one')]]);
 const recovery=createAccountJournalRecovery({store,issuer,publicOrigin:origin+'/grindzone',authenticateAccount:async request=>sessions.get(String(request.headers.cookie).replace(/^fixture=/,'')),now:()=>now});
 t.after(async()=>{await store.close();rmSync(directory,{recursive:true,force:true});key.fill(0);});
 return {directory,filename,key,store,sessions,recovery};
}
async function journal(){
 let doc=newJournal({journalId:randomUUID(),platform:'xbox',now:'2026-10-08T11:00:00.000Z'});
 const command={id:randomUUID(),op:'grind.start',expectedRevision:doc.revision,data:{grindId:randomUUID(),name:'Private whitetail grind',targetSpecies:'Whitetail Deer',reserve:19}};
 doc=applyJournalCommand(doc,command,await commandFingerprint(command),'2026-10-08T11:00:00.000Z').journal;
 const capture=makeScreenshotEvidence({metadata:{mimeType:'image/png',byteLength:1000,width:320,height:640},imageSha256:'a'.repeat(64),method:'local_ocr',extraction:{fields:{species:'Whitetail Deer',score:270,medal:'diamond',sex:'male'}},reviewedAt:'2026-10-08T11:10:00.000Z'});
 const report={id:randomUUID(),op:'report.add',expectedRevision:doc.revision,data:{reportId:randomUUID(),grindId:doc.grinds[0].id,version:doc.grinds[0].version,species:'Whitetail Deer',score:270,medal:'diamond',sex:'male',occurredAt:'2026-10-08T11:09:00.000Z',points:{harvest:{x:0,z:42}},placeId:null,notes:'Private capture-derived report',screenshot:capture}};
 return applyJournalCommand(doc,report,await commandFingerprint(report),'2026-10-08T11:10:00.000Z').journal;
}
const writeReq=(session='one',cookie='alice-one')=>req(cookie,{origin,'x-grindzone-account-csrf':'fixture-csrf-'+session});
const input=async(version=0)=>({requestId:randomUUID(),expectedVersion:version,journal:await journal()});

test('account backup round trip on a second session preserves canonical screenshot evidence and coordinates',async t=>{
 const {recovery}=fixture(t),data=await input(),before=structuredClone(data.journal);
 const first=await recovery.status(req());assert.equal(first.backup,null);
 assert.equal((await recovery.publish(writeReq(),data)).version,1);
 const second=await recovery.read(req('alice-two'));assert.deepEqual(second.backup.journal,before);assert.notEqual(first.scope,second.scope);
 assert.equal(second.backup.journal.reports[0].source,'player_report');assert.equal(second.backup.journal.reports[0].screenshot.imageSha256,'a'.repeat(64));
 assert.deepEqual(data.journal,before);assert(!('xboxIdentity' in second.backup.journal));
});
test('another verified account sees no backup and cannot supply an owner identity',async t=>{
 const {recovery}=fixture(t);await recovery.publish(writeReq(),await input());
 assert.equal((await recovery.read(req('bob-one'))).backup,null);
 const data=await input();await assert.rejects(()=>recovery.publish(writeReq(),{...data,owner:'bob'}),error=>error.status===400);
});
test('stale account backup version fails instead of overwriting a newer phone',async t=>{
 const {recovery}=fixture(t),data=await input();await recovery.publish(writeReq(),data);
 const before=(await recovery.read(req())).backup;
 await assert.rejects(()=>recovery.publish(writeReq('two','alice-two'),{...data,requestId:randomUUID()}),error=>error.status===409);
 assert.deepEqual((await recovery.read(req())).backup,before);
});
test('lost acknowledgement retry is durable, while reused identity with changed content rejects',async t=>{
 const {recovery,store,filename,key}=fixture(t),data=await input();await recovery.publish(writeReq(),data);
 assert.equal((await recovery.publish(writeReq(),data)).replay,true);
 const altered=structuredClone(data);altered.journal.platform='pc';await assert.rejects(()=>recovery.publish(writeReq(),altered),error=>error.status===409);
 const reopened=new AccountJournalStore({filename,key});t.after(()=>reopened.close());
 const result=await reopened.publish(store.identity('owner',issuer,'alice'),data,{authorize:pass,now:new Date(now).toISOString()});assert.equal(result.replay,true);
 assert.equal((await reopened.read(store.identity('owner',issuer,'alice'),{authorize:pass})).version,1);
});
test('an old accepted request cannot rewind a subsequently replaced account backup',async t=>{
 const {recovery}=fixture(t),old=await input();await recovery.publish(writeReq(),old);
 const next=await input(1);await recovery.publish(writeReq(),next);await recovery.publish(writeReq(),old);
 assert.deepEqual((await recovery.read(req())).backup.journal,next.journal);assert.equal((await recovery.read(req())).backup.version,2);
});
test('unverified, expired, wrong-issuer and browser-invented account identities deny',async t=>{
 const {recovery,sessions}=fixture(t);
 for(const change of [{emailVerified:false},{expiresAt:now},{issuer:'https://foreign.test'},{subject:'__proto__'},{csrf:''}]){sessions.set('bad',{...account('alice','bad'),...change});await assert.rejects(()=>recovery.status(req('bad')),error=>error.status===401);}
 await assert.rejects(()=>recovery.status(req('not-a-session',{gamertag:'claimed-owner'})),error=>error.status===401);
});
test('exact Origin, current CSRF and allowed fetch site are mandatory before a backup write',async t=>{
 const {recovery}=fixture(t),data=await input();
 for(const headers of [{},{origin:'https://foreign.test','x-grindzone-account-csrf':'fixture-csrf-one'},{origin,'x-grindzone-account-csrf':'wrong'},{origin,'x-grindzone-account-csrf':'fixture-csrf-one','sec-fetch-site':'cross-site'},{origin,'x-grindzone-account-csrf':'fixture-csrf-one',host:'foreign.test'}])await assert.rejects(()=>recovery.publish(req('alice-one',headers),data),error=>error.status===403);
 assert.equal((await recovery.read(req())).backup,null);
});
test('queued authorization is rechecked before storage, with zero writes after session revocation',async t=>{
 const {recovery,store,sessions}=fixture(t);let release;const gate=new Promise(resolve=>release=resolve);
 const owner=store.identity('owner',issuer,'alice'),blocked=store.read(owner,{authorize:()=>gate});
 const publishing=recovery.publish(writeReq(),await input());await new Promise(resolve=>setImmediate(resolve));sessions.delete('alice-one');release();await blocked;
 await assert.rejects(()=>publishing,error=>error.status===401);
 assert.equal(await store.read(owner,{authorize:pass}),null);
});
test('changing account during an asynchronous recovery read does not return previous owner data',async t=>{
 const {recovery,sessions,store}=fixture(t);await recovery.publish(writeReq(),await input());
 let release;const gate=new Promise(resolve=>release=resolve),blocked=store.read(store.identity('owner',issuer,'alice'),{authorize:()=>gate});
 const reading=recovery.read(req());await new Promise(resolve=>setImmediate(resolve));sessions.set('alice-one',account('bob','one'));release();await blocked;
 await assert.rejects(()=>reading,error=>error.status===401);
});
test('storage refuses an unrelated database, wrong private key and symbolic target',async t=>{
 const {filename,key,directory}=fixture(t),other=path.join(directory,'unrelated.sqlite'),db=new DatabaseSync(other);db.exec('CREATE TABLE customer_data(value TEXT)');db.close();
 assert.throws(()=>new AccountJournalStore({filename:other,key}),/unrelated/);
 assert.throws(()=>new AccountJournalStore({filename,key:randomBytes(32)}),/key mismatch/);
 const linked=path.join(directory,'link.sqlite');symlinkSync(filename,linked);assert.throws(()=>new AccountJournalStore({filename:linked,key}),/symbolic/);
 if(process.platform!=='win32')assert.equal(statSync(filename).mode&0o777,0o600);
});
test('raw saves, forged telemetry, malformed schema and unsupported request fields cannot replace backup',async t=>{
 const {recovery}=fixture(t),data=await input();await recovery.publish(writeReq(),data);
 for(const invalid of [{journal:{save:'console'}},{owner:'foreign'},{journal:{...data.journal,xboxAccount:'injected'}},{expectedVersion:-1}])await assert.rejects(()=>recovery.publish(writeReq(),{...data,requestId:randomUUID(),expectedVersion:1,...invalid}));
 assert.deepEqual((await recovery.read(req())).backup.journal,data.journal);
});
test('mounted existing browser handler exposes recovery only through explicitly configured verified boundary',async t=>{
 const {recovery}=fixture(t);
 const handle=createBrowserPlayHandler({publicOrigin:origin+'/grindzone',readAsset:name=>Buffer.from('fixture-asset '+name),accountRecovery:recovery});
 const server=http.createServer((request,response)=>{if(!handle(request,response)){response.writeHead(404);response.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(route,options={})=>new Promise((resolve,reject)=>{const outgoing=http.request(base+'/grindzone/play/'+route,{method:options.method||'GET',headers:{Host:'journal.grindzone.test',Cookie:'fixture=alice-one',...options.headers}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:response.statusCode,body:response.headers['content-type']?.includes('application/json')?JSON.parse(text):text});});});outgoing.on('error',reject);outgoing.end(options.body);});
 const session=await request('recovery/status');assert.equal(session.status,200);assert.equal(session.body.backup,null);
 const data=await input(),posted=await request('recovery/backup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-GrindZone-Account-CSRF':session.body.csrf},body:JSON.stringify(data)});assert.equal(posted.status,200);
 const second=await request('recovery/backup',{headers:{Cookie:'fixture=alice-two'}});assert.equal(second.status,200);assert.deepEqual(second.body.backup.journal,data.journal);
 const foreign=await request('recovery/backup',{headers:{Cookie:'fixture=bob-one'}});assert.equal(foreign.body.backup,null);
 assert.equal((await request('recovery/status',{headers:{Origin:'https://foreign.test'}})).status,403);
 assert.equal((await request('recovery/status?owner=bob')).status,400);
 assert.equal((await request('recovery/backup',{method:'DELETE',headers:{Origin:origin}})).status,405);
 const asset=await request('account-recovery.js');assert.equal(asset.status,200);
 const defaultHandle=createBrowserPlayHandler({publicOrigin:origin+'/grindzone',readAsset:name=>Buffer.from(name)});let output;
 const match=defaultHandle({url:'/grindzone/play/recovery/status',method:'GET',headers:{host:'journal.grindzone.test'}},{writeHead:status=>output=status,end:()=>{}});assert.equal(match,true);await new Promise(resolve=>setImmediate(resolve));assert.equal(output,503);
});
test('recovery cannot invent an account provider, activate a noncanonical mount, or accept foreign sign-in destinations',t=>{
 const {store}=fixture(t);
 assert.throws(()=>createAccountJournalRecovery({store,issuer,publicOrigin:origin+'/grindzone'}),/authentication/);
 assert.throws(()=>createAccountJournalRecovery({store,issuer,publicOrigin:origin+'/foreign',authenticateAccount:pass}),/origin/);
 assert.throws(()=>createAccountJournalRecovery({store,issuer,publicOrigin:origin+'/grindzone',authenticateAccount:pass,signInPath:'https://foreign.test/account/login'}),/same-origin/);
 assert.throws(()=>createAccountJournalRecovery({store,issuer,publicOrigin:origin+'/grindzone',authenticateAccount:pass,signInPath:'/grindzone/account/../private'}),/same-origin/);
});
