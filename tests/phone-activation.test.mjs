import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {phoneTokenCodec} from '../cloud/auth.mjs';
import {issueActivatedDevice,createActivationHandler} from '../cloud/activation.mjs';
const key=()=>randomBytes(32).toString('base64url');
const codec=()=>phoneTokenCodec({key:key()});
test('new local identity produces a signed device credential but no phone or enrollment authority',()=>{
 const c=codec(),secret=key(),v=issueActivatedDevice(c,{activationKey:secret});
 const claims=c.verify(v.deviceToken,'device');assert.equal(claims.deviceId,v.deviceId);
 assert.notEqual(claims.installationId,secret);assert.notEqual(claims.installationId,v.deviceId);
 assert.equal(c.verify(v.deviceToken,'phone'),null);assert.equal(c.verify(v.deviceToken,'enrollment'),null);
 assert.equal(JSON.stringify(v).includes(secret),false);
 assert.equal(Buffer.from(v.deviceToken.split('.')[0],'base64url').toString().includes(secret),false);
});
test('uncertain activation can repeat without changing the owned identity',()=>{
 const c=codec(),input={activationKey:key()},a=issueActivatedDevice(c,input),b=issueActivatedDevice(c,input);
 assert.equal(a.deviceId,b.deviceId);assert.equal(c.verify(a.deviceToken,'device').installationId,c.verify(b.deviceToken,'device').installationId);
});
test('a fresh local key cannot nominate or collide with another installation',()=>{
 const c=codec(),a=issueActivatedDevice(c,{activationKey:key()}),b=issueActivatedDevice(c,{activationKey:key()});
 assert.notEqual(a.deviceId,b.deviceId);assert.notEqual(c.verify(a.deviceToken,'device').installationId,c.verify(b.deviceToken,'device').installationId);
 assert.throws(()=>issueActivatedDevice(c,{activationKey:key(),deviceId:a.deviceId}),{status:400});
});
for(const [name,value] of [['empty',{}],['array',[]],['null',null],['short',{activationKey:'short'}],['not canonical',{activationKey:'B'.repeat(43)}],['source data',{activationKey:key(),profile:'private'}],['extra field',{activationKey:key(),installationId:key()}]]){
 test('activation rejects '+name,()=>assert.throws(()=>issueActivatedDevice(codec(),value),{status:400}));
}
test('activation credentials fail under a different signing key or purpose',()=>{
 const c=codec(),v=issueActivatedDevice(c,{activationKey:key()});assert.equal(codec().verify(v.deviceToken,'device'),null);
 assert.equal(c.verify(v.deviceToken+'x','device'),null);
});
async function endpoint(t,options={}){
 let handle;const server=http.createServer((q,r)=>handle(q,r));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 handle=createActivationHandler({codec:codec(),publicOrigin:origin+'/grindzone',...options});
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const request=(body={activationKey:key()},headers={},suffix='',method='POST')=>new Promise((resolve,reject)=>{
  const q=http.request(origin+'/grindzone/phone/activate'+suffix,{method,headers:{'Content-Type':'application/json',...headers}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,text:Buffer.concat(chunks).toString()}));});q.on('error',reject);q.end(typeof body==='string'?body:JSON.stringify(body));
 });return {origin,request};
}
test('native setup returns only own device capability and is never cacheable',async t=>{
 const {request}=await endpoint(t),r=await request();assert.equal(r.status,201);assert.deepEqual(Object.keys(JSON.parse(r.text)).sort(),['deviceId','deviceToken']);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['access-control-allow-origin'],undefined);
});
test('browser initiation, wrong host and existing Authorization are rejected',async t=>{
 const {request,origin}=await endpoint(t);
 for(const headers of [{Origin:origin},{Origin:'https://evil.invalid'},{Host:'evil.invalid'},{'Sec-Fetch-Site':'same-origin'},{Authorization:'Bearer not-accepted'}])assert.equal((await request(undefined,headers)).status,403);
});
test('setup accepts no query strings, malformed JSON, large bodies, wrong type or GET',async t=>{
 const {request}=await endpoint(t);
 assert.equal((await request('{')).status,400);assert.equal((await request('x'.repeat(513))).status,413);
 assert.equal((await request(undefined,{'Content-Type':'text/plain'})).status,415);
 assert.equal((await request(undefined,{},'?device=other')).status,400);
 assert.equal((await request(undefined,{},'','GET')).status,405);
});
test('activation work is globally rate-limited and recovers after the window',async t=>{
 let time=100000;const {request}=await endpoint(t,{limit:2,now:()=>time});
 assert.equal((await request()).status,201);assert.equal((await request()).status,201);assert.equal((await request()).status,429);
 time+=60001;assert.equal((await request()).status,201);
});
