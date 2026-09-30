/** Synthetic account issuer + real canonical signed PC/phone credentials and real SQLite.
 * This proves the binding boundary, not email delivery or a hosted identity provider.
 */
import test from 'node:test';
import http from 'node:http';
import {createAccountSourceHandler} from '../cloud/account-source-http.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {AccountSourceRegistry,createAccountSourceBoundary} from '../cloud/account-source-binding.mjs';
import {phoneTokenCodec} from '../cloud/auth.mjs';
const random=()=>randomBytes(32).toString('base64url');
function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'grindzone-account-binding-')),file=path.join(dir,'owners.sqlite'),key=randomBytes(32),accountKey=randomBytes(32),origin='https://phone.example.test',issuer='https://accounts.example.test';
 let tick=1800000000000,reads=0,delayed=null;
 const clock=()=>tick,registries=[],openRegistry=()=>{const handle=new AccountSourceRegistry({filename:file,key,now:clock});registries.push(handle);return handle;},registry=openRegistry(),codec=phoneTokenCodec({key:randomBytes(32),now:clock}),revoked=new Set(),peers=new Map();
 // Windows cannot remove SQLite files while any fixture-owned handle remains open.
 t.after(()=>{for(const handle of registries)handle.close();rmSync(dir,{recursive:true,force:true});});
 function accountToken(subject,extra={}){const data=Buffer.from(JSON.stringify({issuer,subject,sessionId:random(),expiresAt:tick+3600000,emailVerified:true,csrf:random(),displayName:'Test player',...extra})).toString('base64url');return data+'.'+createHmac('sha256',accountKey).update(data).digest('base64url');}
 function verifyAccount(token){if(revoked.has(token)||typeof token!=='string')return null;const [s,signature,...rest]=token.split('.');if(!s||rest.length||!/^[A-Za-z0-9_-]{43}$/.test(signature||''))return null;const expected=createHmac('sha256',accountKey).update(s).digest('base64url');if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))return null;return JSON.parse(Buffer.from(s,'base64url'));}
 function req(token,phoneToken){const a=verifyAccount(token);return {headers:{host:new URL(origin).host,origin,'sec-fetch-site':'same-origin','x-grindzone-account-csrf':a?.csrf,authorization:'Bearer '+token,cookie:phoneToken?'__Secure-grindzone-phone='+phoneToken:''}};}
 function pc(installationId=random(),generation=1){const deviceId=random(),expiresAt=tick+86400000,p={deviceId,installationId,generation,expiresAt};for(const [id,v]of peers)if(v.installationId===installationId)peers.delete(id);peers.set(deviceId,p);const deviceToken=codec.issue('device',{deviceId,installationId,generation},86400000),phoneToken=codec.issue('phone',{deviceId,sid:random()},3600000);return {...p,deviceToken,phoneToken};}
 const a=accountToken('synthetic_account_alpha'),b=accountToken('synthetic_account_beta'),p=pc();
 const options={registry,issuer,origin,now:clock,
  authenticateAccount:async r=>verifyAccount(r.headers.authorization?.slice(7)),
  verifyDevice:token=>codec.verify(token,'device'),currentPeer:id=>peers.get(id)??null,
  readPeer:async tag=>{reads++;if(delayed)await delayed;const p=[...peers.values()].find(p=>registry.tag('installation',p.installationId)===tag);return p?{deviceId:p.deviceId,generation:p.generation,sourceUpdatedAt:new Date(tick).toISOString(),state:{harvestCount:7,secret:'NEVER_FORWARD'}}:null;},
  projectState:value=>({harvestCount:value.harvestCount})
 };
 // Keep cookie parsing identical to the literal cookie-name length, not an untested magic offset.
 options.resolvePairedPeer=async r=>{const name='__Secure-grindzone-phone=',cookies=r.headers.cookie.split(';').map(s=>s.trim()).filter(s=>s.startsWith(name));if(cookies.length!==1)return null;const c=codec.verify(cookies[0].slice(name.length),'phone');return c?peers.get(c.deviceId):null;};
 const boundary=createAccountSourceBoundary(options),link=async(token=a,device=p)=>{const r=await boundary.requestLink(req(token,device.phoneToken),{requestId:random(),label:'My hunting PC'});await boundary.approveOnPC(device.deviceToken,{requestId:r.requestId,approve:true});return boundary.completeLink(req(token,device.phoneToken),{requestId:r.requestId});};
 return {dir,file,key,registry,openRegistry,codec,origin,issuer,options,boundary,a,b,p,pc,req,link,accountToken,revoked,peers,reads:()=>reads,now:clock,advance:n=>tick+=n,delay:()=>{let resolve;delayed=new Promise(r=>resolve=r);return resolve;}};
}
const rejectsStatus=(promise,status)=>assert.rejects(promise,e=>e.status===status);

test('nothing links merely because an account and phone are signed in; PC approval is separate',async t=>{
 const f=fixture(t),r=await f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'Home PC'});
 assert.equal(r.state,'pending');assert.deepEqual(await f.boundary.sources(f.req(f.a)),[]);
 const inbox=await f.boundary.pendingOnPC(f.p.deviceToken);assert.equal(inbox.length,1);assert.equal(inbox[0].requestId,r.requestId);
 const approved=await f.boundary.approveOnPC(f.p.deviceToken,{requestId:r.requestId,approve:true});assert.equal(approved.state,'pc_approved');assert.deepEqual(await f.boundary.sources(f.req(f.a)),[]);await f.boundary.completeLink(f.req(f.a,f.p.phoneToken),{requestId:r.requestId});assert.equal((await f.boundary.sources(f.req(f.a))).length,1);
});
test('a phone cookie, invented device token, or old pairing cannot approve durable ownership',async t=>{
 const f=fixture(t),r=await f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'Home PC'});
 for(const token of [f.p.phoneToken,'invented',null])await rejectsStatus(f.boundary.approveOnPC(token,{requestId:r.requestId,approve:true}),401);
 assert.deepEqual(await f.boundary.sources(f.req(f.a)),[]);
});
test('owner and source IDs supplied by a browser are rejected instead of trusted',async t=>{
 const f=fixture(t);for(const extra of [{ownerId:'someone'},{sourceId:'stolen'},{installationId:f.p.installationId},{approved:true}])await rejectsStatus(f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'PC',...extra}),400);
});
test('unverified, wrong-issuer, expired and forged account sessions fail closed',async t=>{
 const f=fixture(t);for(const token of [f.accountToken('alpha',{emailVerified:false}),f.accountToken('alpha',{issuer:'https://wrong.example'}),f.accountToken('alpha',{expiresAt:f.now()}),f.a.slice(0,-1)+'!',null])await rejectsStatus(f.boundary.sources(f.req(token)),401);
});
test('linking and unlinking require same origin and independent account CSRF',async t=>{
 const f=fixture(t),r=await f.link();
 for(const patch of [{origin:'https://evil.example'},{host:'wrong.example'},{'sec-fetch-site':'cross-site'},{'x-grindzone-account-csrf':'wrong'},{origin:undefined}]){const req=f.req(f.a,f.p.phoneToken);Object.assign(req.headers,patch);await rejectsStatus(f.boundary.unlink(req,{sourceId:r.sourceId,expectedVersion:r.version}),403);}
 assert.equal((await f.boundary.sources(f.req(f.a))).length,1);
});
test('duplicate phone cookies and disconnected sources cannot request a binding',async t=>{
 const f=fixture(t),req=f.req(f.a,f.p.phoneToken);req.headers.cookie+='; '+req.headers.cookie;
 await rejectsStatus(f.boundary.requestLink(req,{requestId:random(),label:'PC'}),409);f.peers.clear();await rejectsStatus(f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'PC'}),409);
});
test('two accounts cannot claim the same installation, including pending approval races',async t=>{
 const f=fixture(t),r1=await f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'A'}),r2=await f.boundary.requestLink(f.req(f.b,f.p.phoneToken),{requestId:random(),label:'B'});
 await f.boundary.approveOnPC(f.p.deviceToken,{requestId:r1.requestId,approve:true});await f.boundary.completeLink(f.req(f.a,f.p.phoneToken),{requestId:r1.requestId});await rejectsStatus(f.boundary.approveOnPC(f.p.deviceToken,{requestId:r2.requestId,approve:true}),409);assert.deepEqual(await f.boundary.sources(f.req(f.b)),[]);
});
test('a different valid PC cannot approve the first PC link',async t=>{
 const f=fixture(t),other=f.pc(),r=await f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'PC'});await rejectsStatus(f.boundary.approveOnPC(other.deviceToken,{requestId:r.requestId,approve:true}),404);
});
test('link request and approval retries are idempotent, not duplicate sources',async t=>{
 const f=fixture(t),input={requestId:random(),label:'PC'},req=f.req(f.a,f.p.phoneToken),r=await f.boundary.requestLink(req,input);assert.deepEqual(await f.boundary.requestLink(req,input),r);
 await rejectsStatus(f.boundary.requestLink(req,{...input,label:'changed'}),409);
 const decision={requestId:r.requestId,approve:true},first=await f.boundary.approveOnPC(f.p.deviceToken,decision);assert.deepEqual(await f.boundary.approveOnPC(f.p.deviceToken,decision),first);const done=await f.boundary.completeLink(req,{requestId:r.requestId});assert.deepEqual(await f.boundary.completeLink(req,{requestId:r.requestId}),done);assert.equal((await f.boundary.sources(req)).length,1);
});
test('rejection and expired approval do not create ownership',async t=>{
 const f=fixture(t),r=await f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'PC'});
 assert.equal((await f.boundary.approveOnPC(f.p.deviceToken,{requestId:r.requestId,approve:false})).state,'rejected');await rejectsStatus(f.boundary.approveOnPC(f.p.deviceToken,{requestId:r.requestId,approve:true}),409);
 const later=await f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'PC'});f.advance(300001);await rejectsStatus(f.boundary.approveOnPC(f.p.deviceToken,{requestId:later.requestId,approve:true}),404);assert.deepEqual(await f.boundary.sources(f.req(f.a)),[]);
});
test('new login session of the same verified account sees its binding, not another account',async t=>{
 const f=fixture(t),r=await f.link(),next=f.accountToken('synthetic_account_alpha');assert.equal((await f.boundary.sources(f.req(next)))[0].sourceId,r.sourceId);
 await rejectsStatus(f.boundary.read(f.req(f.b),r.sourceId),404);assert.equal(f.reads(),0);
 assert.deepEqual((await f.boundary.read(f.req(next),r.sourceId)).state,{harvestCount:7});
});
test('logout cancellation invalidates pending approvals without unlinking an approved PC',async t=>{
 const f=fixture(t),approved=await f.link(),other=f.pc(),r=await f.boundary.requestLink(f.req(f.a,other.phoneToken),{requestId:random(),label:'Other PC'});
 assert.equal((await f.boundary.cancelPending(f.req(f.a))).cancelled,1);f.revoked.add(f.a);
 await rejectsStatus(f.boundary.approveOnPC(other.deviceToken,{requestId:r.requestId,approve:true}),409);await rejectsStatus(f.boundary.read(f.req(f.a),approved.sourceId),401);
 assert.equal((await f.boundary.sources(f.req(f.accountToken('synthetic_account_alpha')))).length,1);
});
test('source read is refused when the account session is revoked during a delayed read',async t=>{
 const f=fixture(t),r=await f.link(),finish=f.delay(),pending=f.boundary.read(f.req(f.a),r.sourceId);await new Promise(setImmediate);f.revoked.add(f.a);finish();await rejectsStatus(pending,401);
});
test('unlink invalidates an in-flight read and never writes game files',async t=>{
 const f=fixture(t),r=await f.link(),finish=f.delay(),pending=f.boundary.read(f.req(f.a),r.sourceId);await new Promise(setImmediate);
 const deleted=await f.boundary.unlink(f.req(f.a),{sourceId:r.sourceId,expectedVersion:r.version});assert.equal(deleted.sourceFilesModified,false);finish();await rejectsStatus(pending,404);
});
test('stale versions and other accounts cannot unlink a binding',async t=>{
 const f=fixture(t),r=await f.link();await rejectsStatus(f.boundary.unlink(f.req(f.b),{sourceId:r.sourceId,expectedVersion:r.version}),404);await rejectsStatus(f.boundary.unlink(f.req(f.a),{sourceId:r.sourceId,expectedVersion:r.version-1}),409);assert.equal((await f.boundary.sources(f.req(f.a))).length,1);
});
test('explicit transfer after unlink creates a different source ID, invalidating old cache leases',async t=>{
 const f=fixture(t),a=await f.link(),lease=(await f.boundary.principal(f.req(f.a),a.sourceId)).lease;
 await f.boundary.unlink(f.req(f.a),{sourceId:a.sourceId,expectedVersion:a.version});const b=await f.link(f.b);assert.notEqual(a.sourceId,b.sourceId);assert.throws(()=>f.registry.assertLease(lease),e=>e.status===404);await rejectsStatus(f.boundary.read(f.req(f.a),a.sourceId),404);assert.equal((await f.boundary.read(f.req(f.b),b.sourceId)).state.harvestCount,7);
});
test('device rotation retains approved ownership but invalidates pending requests from the old generation',async t=>{
 const f=fixture(t),a=await f.link(),pending=await f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'Renew'}),next=f.pc(f.p.installationId,2);
 await f.boundary.pendingOnPC(next.deviceToken);await rejectsStatus(f.boundary.approveOnPC(next.deviceToken,{requestId:pending.requestId,approve:true}),404);await rejectsStatus(f.boundary.approveOnPC(f.p.deviceToken,{requestId:pending.requestId,approve:true}),409);assert.equal((await f.boundary.sources(f.req(f.a)))[0].sourceId,a.sourceId);
});
test('an older device generation remains rejected after registry reopen',async t=>{
 const f=fixture(t);f.registry.observePeer(f.p);const next=f.pc(f.p.installationId,2);f.registry.observePeer(next);f.registry.close();const reopened=f.openRegistry();assert.throws(()=>reopened.observePeer(f.p),e=>e.status===409);
});
test('source ownership survives two independent SQLite handles and process-style reopen',async t=>{
 const f=fixture(t),r=await f.link(),principal=await f.boundary.principal(f.req(f.a),r.sourceId),second=f.openRegistry();assert.equal(second.sources(principal.userId)[0].sourceId,r.sourceId);
 second.unlink(principal.userId,{sourceId:r.sourceId,expectedVersion:r.version});await rejectsStatus(f.boundary.read(f.req(f.a),r.sourceId),404);
});
test('wrong key and unrelated DB are refused without overwriting existing bytes',async t=>{
 const f=fixture(t);await f.link();f.registry.close();const digest=()=>createHash('sha256').update(readFileSync(f.file)).digest('hex'),before=digest();
 assert.throws(()=>new AccountSourceRegistry({filename:f.file,key:randomBytes(32)}),/key mismatch/);assert.equal(digest(),before);
 const foreign=path.join(f.dir,'foreign.sqlite');writeFileSync(foreign,'unrelated file');assert.throws(()=>new AccountSourceRegistry({filename:foreign,key:f.key}));assert.equal(readFileSync(foreign,'utf8'),'unrelated file');
});
test('file-symlink registry targets are refused without overwriting existing bytes',t=>{
 const f=fixture(t);f.registry.close();const before=readFileSync(f.file),link=path.join(f.dir,'alias.sqlite');
 try{symlinkSync(f.file,link,'file');}
 catch(error){if(process.platform==='win32'&&['EPERM','ENOSYS'].includes(error.code)){t.skip('Windows file-symlink creation unavailable ('+error.code+'); native file-link rejection proof remains pending.');return;}throw error;}
 assert.equal(lstatSync(link).isSymbolicLink(),true);
 assert.throws(()=>new AccountSourceRegistry({filename:link,key:f.key}),/symbolic link/);
 assert.deepEqual(readFileSync(f.file),before);
});
test('registry never persists raw account subjects, device tokens, session tokens or installation IDs',async t=>{
 const f=fixture(t);const req=f.req(f.a,f.p.phoneToken);req.headers.email='must-not-save@example.test';await f.link();f.registry.close();const bytes=readFileSync(f.file);
 for(const secret of [f.p.deviceToken,f.p.phoneToken,f.p.installationId,f.a,'synthetic_account_alpha','must-not-save@example.test'])assert.equal(bytes.includes(Buffer.from(secret)),false);
});
test('linking alone grants neither private-cache consent nor permission to publish',async t=>{
 const f=fixture(t),r=await f.link();assert.deepEqual(Object.keys(r).sort(),['label','linkedAt','sourceId','state','version']);assert.equal('cacheEnabled'in r,false);assert.equal('public'in r,false);
});
test('construction without real account, source reader or projection integration fails',t=>{
 const f=fixture(t);for(const field of ['authenticateAccount','resolvePairedPeer','verifyDevice','currentPeer','readPeer','projectState'])assert.throws(()=>createAccountSourceBoundary({...f.options,[field]:undefined}),/required/);assert.throws(()=>new AccountSourceRegistry({filename:':memory:',key:f.key}),/durable/);
});
test('pending request count is bounded per account',async t=>{
 const f=fixture(t);for(let i=0;i<5;i++)await f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'PC'});await rejectsStatus(f.boundary.requestLink(f.req(f.a,f.p.phoneToken),{requestId:random(),label:'PC'}),429);
});

test('an account revoked after PC approval cannot complete ownership',async t=>{
 const f=fixture(t),req=f.req(f.a,f.p.phoneToken),r=await f.boundary.requestLink(req,{requestId:random(),label:'PC'});
 await f.boundary.approveOnPC(f.p.deviceToken,{requestId:r.requestId,approve:true});f.revoked.add(f.a);
 await rejectsStatus(f.boundary.completeLink(req,{requestId:r.requestId}),401);assert.deepEqual(await f.boundary.sources(f.req(f.accountToken('synthetic_account_alpha'))),[]);
});
test('a different account or session cannot finish another pending approval',async t=>{
 const f=fixture(t),req=f.req(f.a,f.p.phoneToken),r=await f.boundary.requestLink(req,{requestId:random(),label:'PC'});
 await f.boundary.approveOnPC(f.p.deviceToken,{requestId:r.requestId,approve:true});
 for(const token of [f.b,f.accountToken('synthetic_account_alpha')])await rejectsStatus(f.boundary.completeLink(f.req(token,f.p.phoneToken),{requestId:r.requestId}),404);
});
test('confirming the account before approval on the PC grants nothing',async t=>{
 const f=fixture(t),req=f.req(f.a,f.p.phoneToken),r=await f.boundary.requestLink(req,{requestId:random(),label:'PC'});
 await rejectsStatus(f.boundary.completeLink(req,{requestId:r.requestId}),409);assert.deepEqual(await f.boundary.sources(req),[]);
});
test('a source response from the wrong authenticated PC is rejected',async t=>{
 const f=fixture(t),r=await f.link(),other=f.pc(),boundary=createAccountSourceBoundary({...f.options,readPeer:async()=>({deviceId:other.deviceId,generation:other.generation,sourceUpdatedAt:new Date(f.now()).toISOString(),state:{harvestCount:999}})});
 await rejectsStatus(boundary.read(f.req(f.a),r.sourceId),409);
});

async function httpFixture(t,f){
 const handle=createAccountSourceHandler({boundary:f.boundary,origin:f.origin,now:f.now});
 const server=http.createServer(async(req,res)=>{if(!await handle(req,res)){res.writeHead(404);res.end('Not found');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 return async(route,{token=f.a,phoneToken=f.p.phoneToken,body,method=body===undefined?'GET':'POST',headers={}}={})=>new Promise((resolve,reject)=>{
  const payload=body===undefined?null:JSON.stringify(body),reqHeaders={...f.req(token,phoneToken).headers,...(payload?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}),...headers};
  const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/grindzone/api/account/sources'+route,method,headers:Object.fromEntries(Object.entries(reqHeaders).filter(([,value])=>value!==undefined))},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();let body;try{body=JSON.parse(text);}catch{body=text;}resolve({status:res.statusCode,headers:res.headers,body});});});
  request.on('error',reject);request.end(payload);
 });
}
test('real HTTP requests require separate PC approval and return only source-owned projected data',async t=>{
 const f=fixture(t),send=await httpFixture(t,f),pending=await send('/link/request',{body:{requestId:random(),label:'PC'}});assert.equal(pending.status,200);
 assert.equal((await send('/link/complete',{body:{requestId:pending.body.requestId}})).status,409);
 await f.boundary.approveOnPC(f.p.deviceToken,{requestId:pending.body.requestId,approve:true});
 const linked=await send('/link/complete',{body:{requestId:pending.body.requestId}});assert.equal(linked.status,200);
 const read=await send('/read?source='+linked.body.sourceId);assert.equal(read.status,200);assert.deepEqual(read.body.state,{harvestCount:7});assert.equal(read.headers['cache-control'],'no-store');
 assert.equal('ownerId'in read.body,false);assert.equal('bindingEpoch'in read.body,false);assert.equal(JSON.stringify(read.body).includes('NEVER_FORWARD'),false);
});
test('browser HTTP cannot approve a PC link, override identity, or select a different account source',async t=>{
 const f=fixture(t),send=await httpFixture(t,f),r=await f.link();
 assert.equal((await send('/link/approve',{body:{token:f.p.deviceToken}})).status,404);
 assert.equal((await send('/link/request',{body:{requestId:random(),label:'PC',ownerId:'someone'}})).status,400);
 assert.equal((await send('/read?source='+r.sourceId,{token:f.b})).status,404);
 assert.equal((await send('/read?source='+r.sourceId+'&source=other')).status,400);
});
test('HTTP cross-origin writes, missing CSRF, and malicious referent paths are rejected',async t=>{
 const f=fixture(t),send=await httpFixture(t,f),r=await f.link();
 const body={sourceId:r.sourceId,expectedVersion:r.version};
 assert.equal((await send('/unlink',{body,headers:{origin:'https://evil.example'}})).status,403);
 assert.equal((await send('/unlink',{body,headers:{'x-grindzone-account-csrf':'wrong'}})).status,403);
 assert.equal((await send('/read?source='+encodeURIComponent('../../game/save'))).status,400);
 assert.equal((await send('/link/request',{body:{requestId:random(),label:'x'.repeat(4200)}})).status,413);
});
test('HTTP sessions cannot read after provider revocation; offline source has no invented cached response',async t=>{
 const f=fixture(t),send=await httpFixture(t,f),r=await f.link();f.peers.clear();assert.equal((await send('/read?source='+r.sourceId)).status,503);
 f.revoked.add(f.a);assert.equal((await send('')).status,401);
});

test('registry rejects a symbolic-link or junction parent without creating data at its target',t=>{
 const f=fixture(t),target=path.join(f.dir,'real'),link=path.join(f.dir,'alias');mkdirSync(target);symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
 assert.equal(lstatSync(link).isSymbolicLink(),true);assert.equal(realpathSync(link),realpathSync(target));
 assert.throws(()=>new AccountSourceRegistry({filename:path.join(link,'owners.sqlite'),key:f.key}),/symbolic link/);
 assert.throws(()=>readFileSync(path.join(target,'owners.sqlite')),e=>e.code==='ENOENT');
});
