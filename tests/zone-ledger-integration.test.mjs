import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {createActivatedPhoneRelay} from '../cloud/activation-server.mjs';
import {fixture,defs,pop,harvest,zones,makeHarvest} from './fixtures.mjs';
import {projectPhoneState,validatePhoneCommand} from '../lib/phone-bridge.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pressureDefs={...defs,rootPopulation:{...defs.rootPopulation,HuntingPressureMap:'u8[]'}};
const zoneId='saved:19:789:2';
const absent={NZData:[{ReserveId:'19',NeedZoneData:[]}]};
function writeSources(save,rows){
 const files={animal_population_19:fixture(pressureDefs,'rootPopulation',{...pop(),HuntingPressureMap:Array(65536).fill(200)}),found_need_zones_adf:fixture(defs,'rootZones',zones),reserveworlddata_adf:fixture(defs,'rootReserve',{Reserve:19}),hunting_log_adf:makeHarvest(rows)};
 for(const [name,bytes]of Object.entries(files))writeFileSync(path.join(save,name),bytes);
 return files;
}
function quietObserver(app){clearInterval(app.observer.timer);clearTimeout(app.observer.debounce);app.observer.watchHandle?.close();}
async function responseJson(response){const data=await response.json();assert.equal(response.ok,true,JSON.stringify({status:response.status,error:data.error}));return data;}
function command(app,body,token){return fetch(app.url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':token},body:JSON.stringify({requestId:randomUUID(),...body})});}
async function newApp(root,save,relay){
 const app=await createApp({dataDir:path.join(root,'journal'),saveDir:save,port:0,interval:3600000,phoneRelayUrl:relay?.origin??null,phoneEnrollmentToken:null,allowInsecurePhoneLoopback:true,feedbackUrl:null});
 quietObserver(app);return app;
}
test('actual save updates retain removed zones and deliver selected-location activity through the private phone route', {timeout:60000}, async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'grindzone-zone-integration-')),save=path.join(root,'save');mkdirSync(save);
 const old=harvest(Math.floor(Date.now()/1000)-120,180),rows=[old];const expected=writeSources(save,rows);
 const relay=await createActivatedPhoneRelay({key:randomBytes(32),publicOrigin:'http://127.0.0.1:0/grindzone',allowInsecureLoopback:true});let app;
 try{
  app=await newApp(root,save,relay);let token=(await responseJson(await fetch(app.url+'/api/bootstrap'))).token;
  const post=body=>command(app,body,token).then(responseJson);
  let state=app.observer.state(19);
  assert.equal(state.observer.sources.find(s=>s.name==='found_need_zones_adf').status,'ok','u64 reserve IDs must normalize before ledger comparison');
  assert.equal(state.zones.length,1);assert.equal(state.zoneLedgerVersion,1);
  const species=state.zones[0].species;
  await post({op:'zone.annotate',zoneId,name:'North lake',notes:'Keep the tent nearby',strategy:'shoot'});
  await post({op:'route.toggle',zoneId,reserve:19});
  const grind=await post({op:'session.start',reserve:19,name:'Zone integration grind',targetSpecies:species,goal:null});
  assert.equal((await command(app,{op:'zone.track',zoneId,reserve:19,expectedVersion:0},'wrong-token')).status,403);
  const enabled=await fetch(app.url+'/api/phone/enable',{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':token},body:'{"consent":true}'});await responseJson(enabled);
  const pair=await responseJson(await fetch(app.url+'/api/phone/pair',{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':token},body:'{}'}));
  const paired=await fetch(relay.origin+'/phone/pair',{method:'POST',headers:{Origin:new URL(relay.origin).origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(pair.url).hash.slice(6)})});assert.equal(paired.status,200);
  const cookie=paired.headers.get('set-cookie').split(';')[0];
  const boot=await responseJson(await fetch(relay.origin+'/api/bootstrap',{headers:{Cookie:cookie}}));
  const remote=body=>fetch(relay.origin+'/api/command',{method:'POST',headers:{Cookie:cookie,Origin:new URL(relay.origin).origin,'X-Companion-Token':boot.token,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),...body})});
  const read=()=>fetch(relay.origin+'/api/state?reserve=19',{headers:{Cookie:cookie}}).then(responseJson);
  const selected=await responseJson(await remote({op:'zone.track',zoneId,reserve:19,expectedVersion:0}));assert.equal(selected.active,true);
  assert.equal((await remote({op:'zone.track',zoneId,reserve:19,expectedVersion:0})).status,409);
  assert.equal((await remote({op:'zone.track',zoneId,reserve:19,expectedVersion:selected.version,owner:'another-player'})).status,400);
  await sleep(1100);rows.push(harvest(Math.floor(Date.now()/1000),201));expected.hunting_log_adf=makeHarvest(rows);writeFileSync(path.join(save,'hunting_log_adf'),expected.hunting_log_adf);await app.observer.scan(true);
  state=await read();assert.equal(state.zoneActivity.byZone.find(z=>z.zoneId===zoneId).harvests,1);assert.equal(state.zoneActivity.unassignedHarvests,1);assert.equal(state.zoneActivity.byGrind.find(g=>g.sessionId===grind.id).harvests,1);
  assert.equal(state.zoneActivity.bySpecies.find(s=>s.species===species).harvests,2);
  const encounter=await post({op:'encounter.create',reserve:19,species,notes:''});
  const dead=await post({op:'encounter.evidence',id:encounter.id,version:encounter.version,type:'dead_observed',notes:''});
  assert.equal((await read()).zoneActivity.byZone.find(z=>z.zoneId===zoneId).unlinkedDeathReports,1);
  const receipt=app.observer.state(19).harvests.find(h=>h.score===201);
  await post({op:'encounter.evidence',id:dead.id,version:dead.version,type:'harvest_linked',harvestId:receipt.id,sameAnimal:true,notes:''});
  assert.equal((await read()).zoneActivity.unlinkedDeathReports,0,'A linked receipt must not count twice');
  await sleep(1100);rows.push(harvest(Math.floor(Date.now()/1000),202));expected.hunting_log_adf=makeHarvest(rows);writeFileSync(path.join(save,'hunting_log_adf'),expected.hunting_log_adf);
  expected.found_need_zones_adf=fixture(defs,'rootZones',absent);writeFileSync(path.join(save,'found_need_zones_adf'),expected.found_need_zones_adf);await app.observer.scan(true);
  state=await read();const removed=state.zoneHistory.find(z=>z.id===zoneId);
  assert.equal(removed.status,'removed');assert.equal(removed.reason,'pressure_present');assert.equal(removed.snapshot.name,'North lake');assert.equal(removed.notes,'Keep the tent nearby');assert.equal(removed.snapshot.x,12800);
  assert.equal(state.zoneTracking.active,false);assert.equal(state.zoneTracking.stopReason,'zone_removed');assert.equal(state.zoneActivity.byZone.find(z=>z.zoneId===zoneId).harvests,2);
  assert.equal(state.zoneActivity.byGrind.find(g=>g.sessionId===grind.id).harvests,2);assert.equal(state.route.includes(zoneId),true);
  assert.doesNotMatch(JSON.stringify(state.zoneHistory),/sourceFolder|localizationHash|deviceToken/);
  assert.equal((await remote({op:'zone.track',zoneId,reserve:19,expectedVersion:state.zoneTracking.version})).status,409);
  await responseJson(await remote({op:'zone.loss',zoneId,reserve:19,reason:'overpressure'}));assert.equal((await read()).zoneHistory[0].evidence,'player_report');
  await responseJson(await remote({op:'zone.loss',zoneId,reserve:19,reason:'unknown'}));assert.equal((await read()).zoneHistory[0].reason,'pressure_present');
  await post({op:'route.toggle',zoneId,reserve:19});state=await read();assert.equal(state.route.includes(zoneId),false);assert.equal(state.zoneHistory.length,1);assert.equal(state.zoneActivity.byZone[0].harvests,2);
  await app.close();app=await newApp(root,save,relay);token=(await responseJson(await fetch(app.url+'/api/bootstrap'))).token;
  state=app.observer.state(19);assert.equal(state.zoneActivity.byZone[0].harvests,2);assert.equal(state.zoneHistory[0].snapshot.name,'North lake');assert.equal(state.zoneTracking.active,false);
  expected.found_need_zones_adf=fixture(defs,'rootZones',zones);writeFileSync(path.join(save,'found_need_zones_adf'),expected.found_need_zones_adf);await app.observer.scan(true);
  state=app.observer.state(19);assert.equal(state.zones.length,1);assert.equal(state.zoneHistory.length,0);assert.equal(state.zoneActivity.byZone[0].harvests,2);assert.equal(state.zoneTracking.active,false);
  for(const [name,bytes]of Object.entries(expected))assert.deepEqual(readFileSync(path.join(save,name)),bytes,'Reader changed '+name);
  assert.equal((await fetch(relay.origin+'/api/state')).status,401);
 }finally{await app?.close();await relay.close();assert.match(path.basename(root),/^grindzone-zone-integration-/);rmSync(root,{recursive:true,force:true});}
});

test('unreadable and omitted reserve snapshots do not invent deleted zones, historical coordinates or kills', {timeout:30000}, async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'grindzone-zone-missing-')),save=path.join(root,'save');mkdirSync(save);writeSources(save,[harvest()]);let app;
 try{
  app=await newApp(root,save);const token=(await responseJson(await fetch(app.url+'/api/bootstrap'))).token;const post=body=>command(app,body,token).then(responseJson);
  await post({op:'route.toggle',zoneId,reserve:19});
  const file=path.join(save,'found_need_zones_adf');unlinkSync(file);await app.observer.scan(true);
  let state=app.observer.state(19);assert.equal(state.zones.length,1);assert.equal(state.observer.sources.find(s=>s.name==='found_need_zones_adf').status,'missing');assert.equal(state.zoneHistory.length,0);
  writeFileSync(file,Buffer.from('incomplete synthetic save'));await app.observer.scan(true);state=app.observer.state(19);assert.equal(state.zones.length,1);assert.equal(state.zoneActivity.unlinkedDeathReports,0);
  writeFileSync(file,fixture(defs,'rootZones',{NZData:[{ReserveId:'7',NeedZoneData:[]}]}));await app.observer.scan(true);state=app.observer.state(19);
  assert.equal(state.zoneHistory[0].status,'unrecorded');assert.notEqual(state.zoneHistory[0].reason,'pressure_present');assert.equal(app.store.journal(app.observer.profile,'zoneHistory')[0].state,'active');
  assert.deepEqual(projectPhoneState({...state,zoneLedgerVersion:undefined}).zoneHistory,undefined);
  assert.equal(validatePhoneCommand({op:'zone.loss',zoneId,reserve:19,reason:'unknown',requestId:'safe_request_id'}).op,'zone.loss');
 }finally{await app?.close();assert.match(path.basename(root),/^grindzone-zone-missing-/);rmSync(root,{recursive:true,force:true});}
});
