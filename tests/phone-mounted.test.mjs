import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {createPhoneRelay} from '../cloud/server.mjs';
import {createPhoneBridge,provisionPhoneDevice,phoneRelayOrigin} from '../lib/phone-bridge.mjs';
import {createPhoneEnrollmentToken} from '../cloud/auth.mjs';
import {mountClientSource,isPhonePath,phoneProxyHeaders} from '../cloud/mount.mjs';
import {startSharedPhone} from '../cloud/shared-host.mjs';
const key=()=>randomBytes(32).toString('base64url');
const synthetic=()=>({app:{name:'GrindZone'},selectedReserve:19,reserves:[],settings:{},observer:{connected:true},harvests:[{id:'synthetic-receipt',species:'Moose',score:10,timestamp:1}],sessions:[]});
test('mount rewriting changes only root endpoints and asset references',()=>{
 assert.equal(mountClientSource("fetch('/api/state');fetch(`/phone/pair`);location.replace('/#map');x.split('/');import './a.js';<a href=\"/\"><script src=\"/app.js\">",'/grindzone'),"fetch('/grindzone/api/state');fetch(`/grindzone/phone/pair`);location.replace('/grindzone/#map');x.split('/');import './a.js';<a href=\"/grindzone/\"><script src=\"/grindzone/app.js\">");
 assert.throws(()=>mountClientSource('x','/other'));
 assert.equal(phoneRelayOrigin('https://phone.test/grindzone/'),'https://phone.test/grindzone');assert.throws(()=>phoneRelayOrigin('https://phone.test/other'));
 for(const x of ['/','/api/state','/grindzone-evil','/grindzone%2fapi'])assert.equal(isPhonePath(x),false);
});
test('proxy drops sibling cookies and unrelated app headers but retains all duplicate phone cookies for rejection',()=>{
 const h=phoneProxyHeaders({host:'phone.test',cookie:'sway=private; __Secure-grindzone-phone=one; __Secure-grindzone-phone=two','x-sway-session':'private','x-companion-token':'csrf'});
 assert.deepEqual(h,{host:'phone.test','x-companion-token':'csrf',cookie:'__Secure-grindzone-phone=one; __Secure-grindzone-phone=two'});
});
test('mounted relay pairs a browser and projects only that live owner',async t=>{
 const signing=key(),relay=await createPhoneRelay({key:signing,publicOrigin:'http://127.0.0.1:0/grindzone',allowInsecureLoopback:true});t.after(()=>relay.close());
 const base=relay.origin,origin=new URL(base).origin;
 assert.equal((await fetch(origin+'/api/state')).status,404);assert.equal((await fetch(base+'/api/state')).status,401);
 const credential=await provisionPhoneDevice({relayUrl:base,enrollmentToken:createPhoneEnrollmentToken({key:signing}),allowInsecureLoopback:true});
 const bridge=createPhoneBridge({relayUrl:base,deviceToken:credential.deviceToken,readState:synthetic,runCommand:()=>{throw Error('No test writes');},allowInsecureLoopback:true});t.after(()=>bridge.close());await bridge.connect();
 const pair=await bridge.pair();assert.ok(pair.url.startsWith(base+'/phone/connect#pair='));
 const response=await fetch(base+'/phone/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(pair.url).hash.slice(6)})});assert.equal(response.status,200);
 const set=response.headers.get('set-cookie');assert.match(set,/^__Secure-grindzone-phone=/);assert.match(set,/Path=\/grindzone\//);assert.match(set,/HttpOnly; Secure; SameSite=Strict/);const cookie=set.split(';')[0];
 const state=await (await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json();assert.equal(state.harvests[0].id,'synthetic-receipt');assert.equal('profile'in state,false);
 assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie+'; '+cookie}})).status,401);
 const html=await (await fetch(base+'/',{headers:{Cookie:cookie}})).text();assert.match(html,/src="\/grindzone\/app.js"/);assert.doesNotMatch(html,/src="\/app.js"/);
 const script=await (await fetch(base+'/app.js')).text();assert.match(script,/\/grindzone\/api\/bootstrap/);assert.doesNotMatch(script,/fetch\(['"]\/api\//);
 await bridge.close();assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie}})).status,503);
});
test('shared host keeps its original HTTP handler and isolates the relay child environment',async t=>{
 const fetch=(url,{headers={}}={})=>new Promise((resolve,reject)=>{const q=http.request(url,{headers},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:r.statusCode,headers:r.headers})));});q.on('error',reject);q.end();});
 const saved=process.env.UNRELATED_HOST_SECRET;process.env.UNRELATED_HOST_SECRET='must-not-inherit';t.after(()=>{if(saved===undefined)delete process.env.UNRELATED_HOST_SECRET;else process.env.UNRELATED_HOST_SECRET=saved;});
 const host=await startSharedPhone({publicBase:'https://phone.test/grindzone',key:key()});t.after(()=>host.close());
 const seen=[];const server=http.createServer(host.wrap((req,res)=>{seen.push({url:req.url,cookie:req.headers.cookie});res.end('original-app');}));host.attach(server);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const base='http://127.0.0.1:'+server.address().port,headers={Host:'phone.test'};
 const old=await fetch(base+'/api/health',{headers:{...headers,Cookie:'sway=kept; __Secure-grindzone-phone=not-for-host'}});assert.equal(await old.text(),'original-app');assert.match(seen[0].cookie,/sway=kept/);assert.doesNotMatch(seen[0].cookie,/grindzone/);
 assert.equal((await fetch(base+'/grindzone/api/state',{headers})).status,401);
 assert.equal((await fetch(base+'/grindzone/phone/connect',{headers})).status,200);
 const health=await (await fetch(base+'/grindzone/healthz',{headers})).json();assert.equal(health.ok,true);
 assert.equal((await fetch(base+'/grindzone/api/state',{headers:{Host:'wrong.test'}})).status,403);
 assert.equal(await (await fetch(base+'/grindzone-not-a-route',{headers})).text(),'original-app');assert.equal(seen.length,2);
});
test('shared-host HTTP and WebSocket proxy completes private pairing and live state read',async t=>{
 let handler=(_q,r)=>{r.writeHead(503);r.end();};
 const server=http.createServer((q,r)=>handler(q,r));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const httpBase='http://127.0.0.1:'+server.address().port,publicBase=httpBase.replace('http:','https:')+'/grindzone',signing=key();
 const host=await startSharedPhone({publicBase,key:signing});handler=host.wrap((_q,r)=>r.end('host-intact'));host.attach(server);
 t.after(async()=>{await host.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const localFetch=(url,options)=>fetch(url.replace(/^https:/,'http:'),options);
 const credential=await provisionPhoneDevice({relayUrl:publicBase,enrollmentToken:createPhoneEnrollmentToken({key:signing}),fetchImpl:localFetch});
 class LoopbackSocket extends WebSocket{constructor(url,protocols){super(url.replace(/^wss:/,'ws:'),protocols);}}
 const bridge=createPhoneBridge({relayUrl:publicBase,deviceToken:credential.deviceToken,readState:synthetic,runCommand:()=>{throw Error('No writes');},WebSocketImpl:LoopbackSocket});t.after(()=>bridge.close());
 await bridge.connect();const pair=await bridge.pair();assert.ok(pair.url.startsWith(publicBase+'/phone/connect#pair='));
 const response=await localFetch(publicBase+'/phone/pair',{method:'POST',headers:{Origin:new URL(publicBase).origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(pair.url).hash.slice(6)})});assert.equal(response.status,200);
 const cookie=response.headers.get('set-cookie').split(';')[0];const state=await (await localFetch(publicBase+'/api/state',{headers:{Cookie:cookie}})).json();
 assert.equal(state.harvests[0].id,'synthetic-receipt');assert.equal(await (await fetch(httpBase+'/')).text(),'host-intact');
 await bridge.close();assert.equal((await localFetch(publicBase+'/api/state',{headers:{Cookie:cookie}})).status,503);
});

test("pairing script and API links are mounted once",()=>{
 const input=`<script src="/phone/connect.js"></script><a href="/api/export">Export</a>`;
 const output=mountClientSource(input,"/grindzone");
 assert.equal(output,`<script src="/grindzone/phone/connect.js"></script><a href="/grindzone/api/export">Export</a>`);
 assert.equal(mountClientSource(output,"/grindzone"),output);
});
