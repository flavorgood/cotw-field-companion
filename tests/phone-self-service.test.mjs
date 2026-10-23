import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createActivatedPhoneRelay} from '../cloud/activation-server.mjs';
import {createApp} from '../server.mjs';
import {createPhoneAccess} from '../lib/phone-access.mjs';
import {fixture,defs} from './fixtures.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<100;n++){if(await check())return;await pause(30);}throw Error('Expected connection state did not arrive');}
const mem=()=>{const m=new Map();return {get:(k,f=null)=>m.has(k)?m.get(k):f,set:(k,v)=>m.set(k,v)};};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
const bridge=opts=>({async connect(){opts.onStatus({status:'connected'});},async close(){opts.onStatus({status:'disabled'});},async pair(){return {};}});
test('uncertain setup retries the same secret without exposing it or recreating a revoked connection',async()=>{
 const store=mem(),keys=[];let fail=true;
 const access=createPhoneAccess({store,observer:{profile:'fixture'},relayUrl:'https://relay.invalid',provision:async o=>{keys.push(o.activationKey);if(fail){fail=false;throw Error('Lost response');}return {deviceToken:'fixture-only'};},bridgeFactory:bridge});
 await assert.rejects(()=>access.enable({consent:false}));assert.equal(keys.length,0);
 await assert.rejects(()=>access.enable({consent:true}),/Lost response/);
 assert.equal(access.status().enabled,false);assert.equal(JSON.stringify(access.status()).includes(keys[0]),false);
 await access.enable({consent:true});assert.equal(keys[0],keys[1]);assert.match(keys[0],/^[A-Za-z0-9_-]{43}$/);
 await access.disable();await access.enable({consent:true});assert.notEqual(keys[2],keys[0]);await access.close();
});
test('disable invalidates a pending registration even when the service response arrives later',async()=>{
 const pending=deferred(),store=mem();let bridges=0;
 const access=createPhoneAccess({store,observer:{profile:'fixture'},relayUrl:'https://relay.invalid',provision:()=>pending.promise,bridgeFactory:()=>{bridges++;return bridge({onStatus(){}});}});
 const work=access.enable({consent:true});await access.disable();pending.resolve({deviceToken:'late-response'});
 await assert.rejects(()=>work,/cancelled/);assert.equal(bridges,0);assert.equal(store.get('phone:connection:fixture'),null);assert.equal(store.get('phone:activation:fixture'),null);
});
test('native app activates, pairs, observes a save, reconnects and revokes with no operator credential',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'grindzone-self-phone-')),save=path.join(root,'save');mkdirSync(save);
 const log=path.join(save,'hunting_log_adf');writeFileSync(log,fixture(defs,'rootHarvest',{HarvestHistory:[]}));
 const relay=await createActivatedPhoneRelay({key:randomBytes(32),publicOrigin:'http://127.0.0.1:0/grindzone',allowInsecureLoopback:true});
 const options={dataDir:path.join(root,'journal-a'),saveDir:save,port:0,interval:50,phoneRelayUrl:relay.origin,phoneEnrollmentToken:null,allowInsecurePhoneLoopback:true};
 let a,b;
 const json=async r=>{const value=await r.json();assert.equal(r.ok,true,JSON.stringify(value));return value;};
 const post=async(app,route,body={})=>{const boot=await json(await fetch(app.url+'/api/bootstrap'));return fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':boot.token},body:JSON.stringify(body)});};
 const pair=async app=>{const link=await json(await post(app,'/api/phone/pair'));const r=await fetch(relay.origin+'/phone/pair',{method:'POST',headers:{Origin:new URL(relay.origin).origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URLSearchParams(new URL(link.url).hash.slice(1)).get('pair')})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 const phone=(cookie,route='/api/state')=>fetch(relay.origin+route,{headers:{Cookie:cookie}});
 try{
  a=await createApp(options);assert.equal(a.phone.status().enabled,false);assert.equal(a.store.get('phone:activation:'+a.observer.profile),null);
  assert.equal((await fetch(relay.origin+'/api/state')).status,401);
  assert.equal((await fetch(a.url+'/api/phone/enable',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"consent":true}'})).status,403);
  assert.equal((await post(a,'/api/phone/enable',{consent:false})).status,400);
  assert.equal((await post(a,'/api/phone/enable',{consent:true})).status,200);
  const first=a.store.get('phone:connection:'+a.observer.profile).deviceToken;
  assert.equal(a.store.get('phone:activation:'+a.observer.profile),null);
  const cookieA=await pair(a);const before=await json(await phone(cookieA));assert.equal(before.harvestCount,0);
  const grind=await json(await post(a,'/api/command',{requestId:randomUUID(),op:'session.start',reserve:19,name:'Private A grind',targetSpecies:null,goal:10}));
  await pause(1100);
  const data=fixture(defs,'rootHarvest',{HarvestHistory:[{SpeciesName:123,Score:42,TrophyScore:0,VariationName:0,Timestamp:Math.floor(Date.now()/1000),RegionName:0}]});writeFileSync(log,data);
  const expectedHash=createHash('sha256').update(data).digest('hex');
  await until(async()=>{const v=await json(await phone(cookieA));return v.harvestCount===1&&v.sessions.some(s=>s.id===grind.id&&s.harvestSummary.total===1);});
  assert.equal(createHash('sha256').update(readFileSync(log)).digest('hex'),expectedHash);
  const exported=await(await fetch(a.url+'/api/export')).text();assert.equal(exported.includes(first),false);assert.equal(exported.includes('activationKey'),false);
  b=await createApp({...options,dataDir:path.join(root,'journal-b'),saveDir:null});await json(await post(b,'/api/phone/enable',{consent:true}));const cookieB=await pair(b);
  assert.equal((await json(await phone(cookieB))).sessions.some(s=>s.id===grind.id),false);
  assert.equal((await json(await phone(cookieA,'/api/state?deviceId=another-player'))).sessions[0].id,grind.id);
  await a.close();a=await createApp(options);await until(()=>a.phone.status().status==='connected');assert.equal(a.store.get('phone:connection:'+a.observer.profile).deviceToken,first);assert.equal((await phone(cookieA)).status,200);
  await json(await post(a,'/api/phone/disable'));await until(async()=>(await phone(cookieA)).status===503);
  await json(await post(a,'/api/phone/enable',{consent:true}));assert.notEqual(a.store.get('phone:connection:'+a.observer.profile).deviceToken,first);assert.equal((await phone(cookieA)).status,503);
  const renewed=await pair(a);assert.equal((await json(await phone(renewed))).harvestCount,1);assert.equal((await phone(cookieB)).status,200);
 }finally{await a?.close();await b?.close();await relay.close();rmSync(root,{recursive:true,force:true});}
});
