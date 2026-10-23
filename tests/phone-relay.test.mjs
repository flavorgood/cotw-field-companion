import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createPhoneRelay} from '../cloud/server.mjs';
import {createPhoneEnrollmentToken} from '../cloud/auth.mjs';
import {createPhoneBridge,provisionPhoneDevice,projectPhoneState,validatePhoneCommand,PHONE_PROTOCOL} from '../lib/phone-bridge.mjs';
import {Store} from '../lib/store.mjs';
import {Observer} from '../lib/observer.mjs';
import {normalizeStatistics,normalizeProfile} from '../lib/career.mjs';
import {readFileSync} from 'node:fs';
import {homeBox,validBox} from '../public/map-geometry.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<100;n++){if(await check())return;await pause(10);}throw Error('Condition did not become true');}
function state(marker='Owner A'){
  return {app:{name:'COTW Field Companion',version:'0.4.1'},profile:'PRIVATE_ACCOUNT_ID',selectedReserve:19,reserves:[{id:19,name:'Synthetic reserve',available:true,status:'ok',zoneCount:1}],settings:{spoilers:false,terrain:false},
    observer:{connected:true,busy:false,lastCycle:'2026-01-01T00:00:00Z',intervalMs:5000,readOnly:true,permissionWriteBlocked:true,sourceFolder:'C:\\PRIVATE_SAVE_FOLDER',error:'Unable to open C:\\PRIVATE_SAVE_FOLDER',sources:[{name:'statistics_adf',mtime:'2026-01-01T00:00:00Z',status:'ok',sha:'PRIVATE_SHA',payload:{RawSave:'PRIVATE_PAYLOAD'},error:'PRIVATE_ERROR_PATH'},{name:'C:\\PRIVATE_FILENAME',payload:'PRIVATE_PAYLOAD'},{name:'health_component_manager_adf',payload:'PRIVATE_HEALTH'}]},
    career:{status:'available',profile:{level:1,xp:0,cash:0,trackingId:'PRIVATE_TRACKING_ID'},counters:[{key:'shots_fired',label:'Shots',value:null,sourceId:'PRIVATE_SOURCE_HASH'}],allMaps:[],coverage:{source:'statistics_adf',conflicts:[],mapCount:1},summary:{shotsFired:null,lifetimeHarvests:0},shotReconciliation:{}},
    careerChanges:[],zones:[{id:'zone-a',reserve:19,species:marker,x:1,z:2,need:'drinking',start:1,end:3,payload:'PRIVATE_NESTED_PAYLOAD',annotation:{name:'Known crossing',path:'PRIVATE_ANNOTATION_PATH'}}],pins:[],equipment:[],encounters:[],harvests:[],harvestCount:0,sessions:[],route:[],population:null,changes:null,coverageEvents:[],healthDiagnostics:{payload:'PRIVATE_HEALTH'},rawSave:'PRIVATE_EXTRA'};
}
async function request(relay,path,{method='GET',cookie,body,csrf,origin,headers={}}={}){
  const response=await fetch(relay.origin+path,{method,redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(csrf?{'X-Companion-Token':csrf}:{}),...(origin?{Origin:origin}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();return {status:response.status,headers:response.headers,value:response.headers.get('content-type')?.includes('json')?JSON.parse(text):text};
}
async function fixture(t,options={}){
  const key=randomBytes(32);let relay=await createPhoneRelay({key,publicOrigin:'http://127.0.0.1:0',allowInsecureLoopback:true,...options});
  const bridges=[];
  t.after(async()=>{for(const bridge of bridges)await bridge.close();await relay.close();});
  const enroll=(overrides={})=>createPhoneEnrollmentToken({key,now:options.now,...overrides});
  return {key,enroll,get relay(){return relay;},set relay(value){relay=value;},async pc(marker='Owner A',overrides={}){
    const enrollmentToken=enroll(),credential=await provisionPhoneDevice({relayUrl:relay.origin,enrollmentToken,allowInsecureLoopback:true});
    let reads=0;const commands=[];
    const bridge=createPhoneBridge({relayUrl:relay.origin,deviceToken:credential.deviceToken,allowInsecureLoopback:true,reconnectMs:20,connectTimeoutMs:2000,readState:()=>{reads++;return state(marker);},runCommand:body=>{commands.push(body);},...overrides});
    bridges.push(bridge);await bridge.connect();return {credential,enrollmentToken,bridge,commands,get reads(){return reads;}};
  }};
}
async function pair(relay,pc){
  const link=await pc.bridge.pair();const token=new URLSearchParams(new URL(link.url).hash.slice(1)).get('pair');
  const paired=await request(relay,'/phone/pair',{method:'POST',origin:relay.origin,body:{token}});assert.equal(paired.status,200);
  const cookie=paired.headers.get('set-cookie').split(';')[0];const boot=await request(relay,'/api/bootstrap',{cookie});
  return {cookie,csrf:boot.value.token,link,token,paired};
}
async function nativePeer(relay,credential){
  const socket=new WebSocket(relay.origin.replace(/^http/,'ws')+'/phone/bridge',[PHONE_PROTOCOL,'cotw-auth.'+credential.deviceToken]);
  await message(socket,m=>m.type==='ready');return socket;
}
function message(socket,predicate){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.removeEventListener('message',handler);reject(Error('Expected socket message did not arrive'));},2000);function handler(e){const value=JSON.parse(e.data);if(predicate(value)){clearTimeout(timer);socket.removeEventListener('message',handler);resolve(value);}}socket.addEventListener('message',handler);});}
function rejectedSocket(relay,credential){return new Promise((resolve,reject)=>{const socket=new WebSocket(relay.origin.replace(/^http/,'ws')+'/phone/bridge',credential?[PHONE_PROTOCOL,'cotw-auth.'+credential]:[]);const timer=setTimeout(()=>{socket.close();reject(Error('Unauthenticated socket was not rejected promptly'));},1000);socket.addEventListener('error',()=>{});socket.addEventListener('open',()=>{clearTimeout(timer);socket.close();reject(Error('Unexpected socket authorization'));},{once:true});socket.addEventListener('close',()=>{clearTimeout(timer);resolve();},{once:true});});}

test('relay refuses missing signing key and non-HTTPS production origin',async()=>{
  await assert.rejects(()=>createPhoneRelay({publicOrigin:'https://example.invalid'}),/SIGNING_KEY/);
  await assert.rejects(()=>createPhoneRelay({key:randomBytes(32),publicOrigin:'http://example.invalid'}),/HTTPS/);
});


test('paired browser can load the complete app module graph',async t=>{
  const f=await fixture(t),pc=await f.pc(),phone=await pair(f.relay,pc),pending=['/app.js'],seen=new Set();
  while(pending.length){
    const pathname=pending.pop();if(seen.has(pathname))continue;seen.add(pathname);
    const response=await request(f.relay,pathname,{cookie:phone.cookie});
    assert.equal(response.status,200,pathname+' must be served to the paired browser');
    assert.match(response.headers.get('content-type'),/javascript/);
    for(const match of response.value.matchAll(/(?:\bfrom\s+|\bimport\s*)['"](\.\/[^'"]+)['"]/g))pending.push(new URL(match[1],f.relay.origin+pathname).pathname);
  }
  assert.ok(seen.has('/route-stops.js'));assert.ok(seen.has('/harvest-view.js'));
});

test('provisioning requires a valid purpose-bound unexpired private installation permit',async t=>{
  let now=Date.now();const f=await fixture(t,{now:()=>now});
  for(const authorization of [undefined,'Bearer invalid','Bearer '+'a'.repeat(2100)])assert.equal((await request(f.relay,'/phone/device',{method:'POST',body:{},headers:authorization?{Authorization:authorization}:{}})).status,401);
  const expired=f.enroll({now:()=>now,expiresAt:now+1});now+=2;
  assert.equal((await request(f.relay,'/phone/device',{method:'POST',body:{},headers:{Authorization:'Bearer '+expired}})).status,401);
  const pc=await f.pc();assert.equal((await request(f.relay,'/phone/device',{method:'POST',body:{},headers:{Authorization:'Bearer '+pc.credential.deviceToken}})).status,401);
  await assert.rejects(()=>provisionPhoneDevice({relayUrl:f.relay.origin,allowInsecureLoopback:true}),/private/);
});

test('anonymous WebSockets cannot consume authenticated PC capacity',async t=>{
  const f=await fixture(t,{maxPeers:1});
  for(let n=0;n<20;n++)await rejectedSocket(f.relay);
  const owner=await f.pc(),paired=await pair(f.relay,owner);
  assert.equal((await request(f.relay,'/api/state',{cookie:paired.cookie})).status,200);
});

test('valid device replacement works at full capacity and stale installation generations cannot displace it',async t=>{
  const f=await fixture(t,{maxPeers:1}),enrollmentToken=f.enroll();
  const provision=()=>provisionPhoneDevice({relayUrl:f.relay.origin,enrollmentToken,allowInsecureLoopback:true});
  const oldCredential=await provision(),first=await nativePeer(f.relay,oldCredential);t.after(()=>first.close());
  const sameIdentity=await nativePeer(f.relay,oldCredential);t.after(()=>sameIdentity.close());assert.equal(sameIdentity.protocol,PHONE_PROTOCOL);
  const newerCredential=await provision(),newer=await nativePeer(f.relay,newerCredential);t.after(()=>newer.close());
  assert.notEqual(newerCredential.deviceId,oldCredential.deviceId);
  await rejectedSocket(f.relay,oldCredential.deviceToken);
  const outsider=await provisionPhoneDevice({relayUrl:f.relay.origin,enrollmentToken:f.enroll(),allowInsecureLoopback:true});await rejectedSocket(f.relay,outsider.deviceToken);
  const pairing=message(newer,m=>m.type==='pairing');newer.send(JSON.stringify({type:'pair',requestId:randomUUID()}));assert.match((await pairing).url,/#pair=/);
});

test('enable and handshake send no player data; every app API requires pairing',async t=>{
  const f=await fixture(t),pc=await f.pc();assert.equal(pc.reads,0);
  for(const path of ['/api/bootstrap','/api/state','/api/maps','/api/gear','/api/reference','/api/export','/api/feedback/inbox'])assert.equal((await request(f.relay,path)).status,401,path);
  assert.equal(pc.reads,0);assert.equal((await request(f.relay,'/')).status,302);
  const paired=await pair(f.relay,pc);assert.match(paired.paired.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  const view=await request(f.relay,'/api/state?reserve=19',{cookie:paired.cookie});assert.equal(view.status,200);assert.equal(view.value.zones[0].species,'Owner A');assert.ok(view.value.reserves[0].bounds);assert.equal(pc.reads,1);
  assert.equal((await request(f.relay,'/api/feedback/inbox',{cookie:paired.cookie})).status,404,'paired players never receive the project owner inbox');
});

test('pairing is one-use, expires, and has a bounded guessing rate',async t=>{
  let now=Date.now();const f=await fixture(t,{now:()=>now,pairAttemptLimit:3,pairTtlMs:1000}),pc=await f.pc();const first=await pair(f.relay,pc);
  assert.equal((await request(f.relay,'/phone/pair',{method:'POST',origin:f.relay.origin,body:{token:first.token}})).status,400);
  const second=await pc.bridge.pair();now+=1001;const expired=new URLSearchParams(new URL(second.url).hash.slice(1)).get('pair');
  assert.equal((await request(f.relay,'/phone/pair',{method:'POST',origin:f.relay.origin,body:{token:expired}})).status,400);
  assert.equal((await request(f.relay,'/phone/pair',{method:'POST',origin:f.relay.origin,body:{token:randomBytes(32).toString('base64url')}})).status,429);
});

test('cookie and device credentials are purpose-bound and tampering fails closed',async t=>{
  const f=await fixture(t),pc=await f.pc(),p=await pair(f.relay,pc);
  assert.equal((await request(f.relay,'/api/state',{cookie:'__Host-cotw-phone='+pc.credential.deviceToken})).status,401);
  assert.equal((await request(f.relay,'/api/state',{cookie:p.cookie+'x'})).status,401);
  const split=p.cookie.lastIndexOf('.');assert.equal((await request(f.relay,'/api/state',{cookie:p.cookie.slice(0,split+1)+'é'.repeat(43)})).status,401);
  const socket=new WebSocket(f.relay.origin.replace(/^http/,'ws')+'/phone/bridge',[PHONE_PROTOCOL,'cotw-auth.'+p.cookie.split('=')[1]]);
  const closed=new Promise(resolve=>socket.addEventListener('close',resolve,{once:true}));
  socket.addEventListener('error',()=>{});
  assert.equal((await closed).code,1006);
});

test('two owners cannot select each others PC or mutation target',async t=>{
  const f=await fixture(t),a=await f.pc('Alpha'),b=await f.pc('Beta'),pa=await pair(f.relay,a),pb=await pair(f.relay,b);
  assert.equal((await request(f.relay,'/api/state?reserve=19&deviceId='+b.credential.deviceId,{cookie:pa.cookie})).value.zones[0].species,'Alpha');
  assert.equal((await request(f.relay,'/api/state?reserve=19',{cookie:pb.cookie})).value.zones[0].species,'Beta');
  const command={op:'pin.create',requestId:randomUUID(),reserve:19,kind:'tent',x:1,z:2,label:'Alpha pin'};
  assert.equal((await request(f.relay,'/api/command',{method:'POST',origin:f.relay.origin,cookie:pa.cookie,csrf:pa.csrf,body:command})).status,200);
  assert.deepEqual(a.commands,[command]);assert.equal(b.commands.length,0);
});

test('cross-site, missing CSRF, foreign Host, and remote configuration actions are rejected',async t=>{
  const f=await fixture(t),pc=await f.pc(),p=await pair(f.relay,pc),command={op:'observer.scan',requestId:randomUUID()};
  assert.equal((await request(f.relay,'/api/command',{method:'POST',origin:f.relay.origin,cookie:p.cookie,body:command})).status,403);
  assert.equal((await request(f.relay,'/api/command',{method:'POST',origin:'https://attacker.invalid',cookie:p.cookie,csrf:p.csrf,body:command})).status,403);
  assert.equal((await request(f.relay,'/api/state',{cookie:p.cookie,headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await request(f.relay,'/api/command',{method:'POST',origin:f.relay.origin,cookie:p.cookie,csrf:p.csrf,body:{op:'phone.enable',requestId:randomUUID()}})).status,403);
  assert.equal((await request(f.relay,'/api/command',{method:'POST',origin:f.relay.origin,cookie:p.cookie,csrf:p.csrf,body:{...command,url:'http://127.0.0.1/private'}})).status,400);
  const hostStatus=await new Promise((resolve,reject)=>http.get(f.relay.origin+'/api/state',{headers:{Host:'attacker.invalid',Cookie:p.cookie}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));assert.equal(hostStatus,403);assert.equal(pc.commands.length,0);
});

test('phone projection excludes raw identities, paths, errors, health, hashes and parser data',()=>{
  const projected=projectPhoneState(state()),encoded=JSON.stringify(projected);assert.doesNotMatch(encoded,/PRIVATE_/);
  assert.equal(Object.hasOwn(projected,'profile'),false);assert.equal(Object.hasOwn(projected,'healthDiagnostics'),false);assert.equal(Object.hasOwn(projected.observer,'sourceFolder'),false);
  assert.equal(projected.observer.sources.length,1);assert.equal(projected.observer.sources[0].name,'statistics_adf');assert.equal(projected.observer.sources[0].mtime,'2026-01-01T00:00:00Z');
  assert.equal(projected.career.summary.shotsFired,null);assert.equal(projected.career.summary.lifetimeHarvests,0);assert.deepEqual(projected.career.profile,{level:1,xp:0,cash:0});
});

test('cloud export is an explicit projected view and never a raw PC export',async t=>{
   const f=await fixture(t),pc=await f.pc(),p=await pair(f.relay,pc);const exported=await request(f.relay,'/api/export?reserve=19',{cookie:p.cookie});
   assert.equal(exported.status,200);assert.equal(exported.value.format,'cotw-phone-view');assert.match(exported.value.scope,/Current reserve/);assert.doesNotMatch(JSON.stringify(exported.value),/PRIVATE_/);
 });

test('paired Hunt state forwards only a validated species while full state and export stay complete',async t=>{
 const f=await fixture(t),reads=[];
 const pc=await f.pc('Mallard',{readState:(reserve,options)=>{
  reads.push({reserve,options});const value=state('Mallard');
  if(options){value.huntSpeciesOptions=['Mallard','Whitetail Deer'];value.zones=options.huntSpecies==='all'?[]:value.zones;}
  return value;
 }}),p=await pair(f.relay,pc);
 const full=await request(f.relay,'/api/state?reserve=19',{cookie:p.cookie});assert.equal(full.status,200);assert.equal(full.value.zones.length,1);assert.equal(full.value.huntSpeciesOptions,undefined);
 const choose=await request(f.relay,'/api/state?reserve=19&huntSpecies=Mallard',{cookie:p.cookie});assert.equal(choose.status,200);assert.equal(choose.value.zones[0].species,'Mallard');assert.deepEqual(choose.value.huntSpeciesOptions,['Mallard','Whitetail Deer']);
 const defaultHunt=await request(f.relay,'/api/state?reserve=19&huntSpecies=all',{cookie:p.cookie});assert.equal(defaultHunt.status,200);assert.equal(defaultHunt.value.zones.length,0);
 const exported=await request(f.relay,'/api/export?reserve=19&huntSpecies=all',{cookie:p.cookie});assert.equal(exported.status,200);assert.equal(exported.value.zones.length,1);
 assert.deepEqual(reads.map(r=>r.options?.huntSpecies??null),[null,'Mallard','all',null]);
 const before=reads.length;
 for(const query of ['&huntSpecies=','&huntSpecies=all&huntSpecies=Mallard','&huntSpecies='+encodeURIComponent('x'.repeat(121)),'&huntSpecies=%00'])assert.equal((await request(f.relay,'/api/state?reserve=19'+query,{cookie:p.cookie})).status,400);
 assert.equal(reads.length,before,'invalid scopes never reach the PC');
});
test('an older paired PC can ignore a Hunt scope without losing its phone session',async t=>{
 const f=await fixture(t),pc=await f.pc('Old PC'),p=await pair(f.relay,pc);
 const scoped=await request(f.relay,'/api/state?reserve=19&huntSpecies=all',{cookie:p.cookie});
 assert.equal(scoped.status,200);assert.equal(scoped.value.zones[0].species,'Old PC');
 assert.equal((await request(f.relay,'/api/state?reserve=19',{cookie:p.cookie})).status,200);
});

test('body, schema and provisioning caps reject before journal mutation',async t=>{
  const f=await fixture(t,{provisionLimit:2}),pc=await f.pc(),p=await pair(f.relay,pc);
  const oversized={op:'pin.create',requestId:randomUUID(),notes:'a'.repeat(40000)};
  assert.equal((await request(f.relay,'/api/command',{method:'POST',origin:f.relay.origin,cookie:p.cookie,csrf:p.csrf,body:oversized})).status,413);
  assert.throws(()=>validatePhoneCommand({op:'settings',requestId:randomUUID(),terrain:{path:'secret'}}),/field/);
  await provisionPhoneDevice({relayUrl:f.relay.origin,enrollmentToken:pc.enrollmentToken,allowInsecureLoopback:true});
  assert.equal((await request(f.relay,'/phone/device',{method:'POST',body:{},headers:{Authorization:'Bearer '+pc.enrollmentToken}})).status,429);assert.equal(pc.commands.length,0);
});

test('journal request identity survives relay and preserves real Store idempotency',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const f=await fixture(t),pc=await f.pc('Owner',{runCommand:body=>store.mutate('synthetic-phone',body.requestId,body,()=>store.command('synthetic-phone',body))}),p=await pair(f.relay,pc);
  const command={op:'pin.create',requestId:randomUUID(),reserve:19,kind:'tent',label:'Synthetic pin',x:1,z:2};
  for(let n=0;n<2;n++)assert.equal((await request(f.relay,'/api/command',{method:'POST',origin:f.relay.origin,cookie:p.cookie,csrf:p.csrf,body:command})).status,200);
  assert.equal(store.journal('synthetic-phone','pins').length,1);
  assert.equal((await request(f.relay,'/api/command',{method:'POST',origin:f.relay.origin,cookie:p.cookie,csrf:p.csrf,body:{...command,x:99}})).status,409);
});

test('real Observer career shape renders through the existing career view and map geometry',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  const reference=JSON.parse(readFileSync(new URL('../lib/reference.json',import.meta.url)));
  const stamp={sha:'synthetic-only',mtime:'2026-01-01T00:00:00Z',checked:'2026-01-01T00:00:00Z',status:'ok'};
  store.saveSource('manual','statistics_adf',{...stamp,payload:normalizeStatistics({StatsNameHash:[114106766,3658525314],StatsData:[{IntValue:7,FloatValue:0,AvgCount:0,AvgValue:0},{IntValue:3,FloatValue:0,AvgCount:0,AvgValue:0}]})});
  store.saveSource('manual','thp_player_profile_adf',{...stamp,payload:normalizeProfile({Level:3,Xp:300,Cash:4,SkillPoints:1,PerkPoints:2,TrackingID:'PRIVATE_TRACKING'})});
  const observer=new Observer(store,null,reference),f=await fixture(t),pc=await f.pc('unused',{readState:reserve=>observer.state(reserve)}),p=await pair(f.relay,pc);
  const view=await request(f.relay,'/api/state?reserve=19',{cookie:p.cookie});assert.equal(view.status,200);assert.equal(view.value.career.summary.shotsFired,10);assert.equal(view.value.career.profile.level,3);
  assert.equal(validBox(homeBox(view.value.reserves.find(r=>r.id===19))),true);
  const before=globalThis.document;globalThis.document={documentElement:{dataset:{runtime:'phone'}}};
  try{const {careerView}=await import('../public/career.js');const html=careerView(view.value);assert.equal([...html.matchAll(/data-career-reserve="\d+"/g)].length,view.value.career.allMaps.length);assert.match(html,/data-career-reserve="19"/);assert.doesNotMatch(html,/undefined|PRIVATE_/);}finally{if(before===undefined)delete globalThis.document;else globalThis.document=before;}
  for(const asset of ['species-style.js','commands.js','phone-ui.js','phone.css','qrcode.js'])assert.equal((await request(f.relay,'/'+asset,{cookie:p.cookie})).status,200,asset);
});

test('real route and encounter result shapes are preserved for optimistic phone UI',async t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const f=await fixture(t),pc=await f.pc('Owner',{runCommand:body=>store.mutate('synthetic-phone',body.requestId,body,()=>store.command('synthetic-phone',body))}),p=await pair(f.relay,pc);
  const send=body=>request(f.relay,'/api/command',{method:'POST',origin:f.relay.origin,cookie:p.cookie,csrf:p.csrf,body:{requestId:randomUUID(),...body}});
  const toggled=await send({op:'route.toggle',reserve:19,zoneId:'zone-a'});assert.equal(toggled.status,200);assert.deepEqual(toggled.value,{route:['zone-a']});
  const reordered=await send({op:'route.reorder',reserve:19,order:['zone-a'],expectedOrder:['zone-a']});assert.equal(reordered.status,200);assert.deepEqual(reordered.value,['zone-a']);
  const created=await send({op:'encounter.create',reserve:19,species:'Whitetail'});assert.equal(created.status,200);assert.equal(typeof created.value.id,'string');assert.equal(created.value.version,1);assert.equal(created.value.evidence[0].type,'shot');
  const updated=await send({op:'encounter.evidence',id:created.value.id,version:created.value.version,type:'alive_observed'});assert.equal(updated.status,200);assert.equal(updated.value.version,2);
});

test('ambiguous command timeout is reported and never automatically retried',async t=>{
  let count=0;const f=await fixture(t,{requestTimeoutMs:30}),pc=await f.pc('Owner',{runCommand:async()=>{count++;await pause(80);}}),p=await pair(f.relay,pc);
  const response=await request(f.relay,'/api/command',{method:'POST',origin:f.relay.origin,cookie:p.cookie,csrf:p.csrf,body:{op:'observer.scan',requestId:randomUUID()}});
  assert.equal(response.status,504);assert.match(response.value.error,/unknown/);await pause(100);assert.equal(count,1);
});

test('disabled identity cannot read a newly provisioned PC connection',async t=>{
  const f=await fixture(t),a=await f.pc('Before disable'),pa=await pair(f.relay,a);await a.bridge.close();
  await until(async()=>!(await request(f.relay,'/api/bootstrap',{cookie:pa.cookie})).value.phone.online);
  const b=await f.pc('Fresh identity'),pb=await pair(f.relay,b);assert.notEqual(a.credential.deviceId,b.credential.deviceId);
  assert.equal((await request(f.relay,'/api/state',{cookie:pa.cookie})).status,503);
  assert.equal((await request(f.relay,'/api/state',{cookie:pb.cookie})).value.zones[0].species,'Fresh identity');
});

test('persistent signing key retains pairing across relay restart and PC reconnect',async t=>{
  const f=await fixture(t),pc=await f.pc('After restart'),p=await pair(f.relay,pc);const origin=f.relay.origin,port=f.relay.server.address().port;
  await f.relay.close();f.relay=await createPhoneRelay({key:f.key,publicOrigin:origin,port,allowInsecureLoopback:true});
  // A pooled GET connection can close during this deliberate same-port restart.
  // Retry only expected transport failures within the existing readiness bound.
  await until(async()=>{try{return (await request(f.relay,'/api/bootstrap',{cookie:p.cookie})).value.phone?.online===true;}catch(e){if(['ECONNRESET','ECONNREFUSED','UND_ERR_SOCKET'].includes(e.cause?.code))return false;throw e;}});
  assert.equal((await request(f.relay,'/api/state',{cookie:p.cookie})).value.zones[0].species,'After restart');
});

test('authenticated socket replacement invalidates old pending requests',async t=>{
  const f=await fixture(t),credential=await provisionPhoneDevice({relayUrl:f.relay.origin,enrollmentToken:f.enroll(),allowInsecureLoopback:true}),old=await nativePeer(f.relay,credential);t.after(()=>old.close());
  const pairing=message(old,m=>m.type==='pairing');old.send(JSON.stringify({type:'pair',requestId:randomUUID()}));const link=await pairing,token=new URLSearchParams(new URL(link.url).hash.slice(1)).get('pair');
  const paired=await request(f.relay,'/phone/pair',{method:'POST',origin:f.relay.origin,body:{token}}),cookie=paired.headers.get('set-cookie').split(';')[0];
  const pending=message(old,m=>m.type==='request');const response=request(f.relay,'/api/state',{cookie});const oldRequest=await pending;
  const replacement=await nativePeer(f.relay,credential);t.after(()=>replacement.close());
  assert.equal((await response).status,503);
  if(old.readyState===1)old.send(JSON.stringify({type:'response',id:oldRequest.id,status:200,data:{profile:'SHOULD_NOT_ESCAPE'}}));
  const next=message(replacement,m=>m.type==='request');const nextResponse=request(f.relay,'/api/state',{cookie});const current=await next;assert.notEqual(current.id,oldRequest.id);
  replacement.send(JSON.stringify({type:'response',id:oldRequest.id,status:200,data:{profile:'SHOULD_NOT_ESCAPE'}}));
  replacement.send(JSON.stringify({type:'response',id:current.id,status:200,data:projectPhoneState(state('Current socket'))}));
  assert.equal((await nextResponse).value.zones[0].species,'Current socket');
});
