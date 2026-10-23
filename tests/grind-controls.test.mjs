import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Store} from '../lib/store.mjs';
import {sessionHarvestSummary,SESSION_MAX_PERIODS} from '../lib/career.mjs';
import {createPhoneBridge,provisionPhoneDevice,projectPhoneState,projectPhoneCommandResult,validatePhoneCommand} from '../lib/phone-bridge.mjs';
import {createPhoneRelay} from '../cloud/server.mjs';
import {createPhoneEnrollmentToken} from '../cloud/auth.mjs';

const startTime=Date.parse('2026-01-01T00:00:00.000Z'),iso=seconds=>new Date(startTime+seconds*1000).toISOString();
const receipt=(id,seconds,species='Moose',score=null)=>({id,timestamp:startTime/1000+seconds,species,score});
function db(t){const store=new Store(':memory:');t.after(()=>store.close());return store;}
function clock(t){t.mock.timers.enable({apis:['Date'],now:startTime});return seconds=>t.mock.timers.setTime(startTime+seconds*1000);}
const control=(store,s,op,fields={})=>store.command('synthetic',{op:'session.'+op,id:s.id,version:s.version??1,...fields});
const conflict=fn=>assert.throws(fn,e=>e.status===409);

test('start and edit persist bounded target, goal, map and version without inferring from the name',t=>{
 const store=db(t);clock(t);
 let s=store.command('synthetic',{op:'session.start',reserve:19,name:'Moose grind'});
 assert.equal(s.targetSpecies,null);assert.equal(s.goal,null);assert.equal(s.version,1);assert.equal(s.startedAt,iso(0));assert.deepEqual(s.periods,[{startedAt:iso(0),endedAt:null}]);
 s=control(store,s,'update',{name:'  Evening run  ',targetSpecies:'  Moose  ',goal:40,reserve:3});
 assert.equal(s.name,'Evening run');assert.equal(s.targetSpecies,'Moose');assert.equal(s.goal,40);assert.equal(s.reserve,3);assert.equal(s.version,2);
 for(const goal of [0,-1,1.5,'3',true,1000001,Infinity])assert.throws(()=>control(store,s,'update',{goal}));
 for(const targetSpecies of [5,{},'M'.repeat(121)])assert.throws(()=>control(store,s,'update',{targetSpecies}));
 for(const fields of [{name:' '},{reserve:-1},{startedAt:iso(1)},{pausedAt:iso(1)},{periods:[]},{endInclusive:true}])assert.throws(()=>control(store,s,'update',fields));
 assert.deepEqual(store.item('synthetic',s.id,'sessions'),s,'rejected updates have no partial side effects');
 s=control(store,s,'update',{targetSpecies:' ',goal:null});assert.equal(s.targetSpecies,null);assert.equal(s.goal,null);
});

test('pause, resume, finish and continue retain each run and exclude saved receipts from gaps',t=>{
 const store=db(t),at=clock(t);
 let s=store.command('synthetic',{op:'session.start',reserve:19,targetSpecies:'Moose',goal:1});
 at(10);s=control(store,s,'pause');assert.equal(s.pausedAt,iso(10));assert.equal(s.endedAt,null);
 const receipts=[receipt('one',1,'Moose',10),receipt('pause-boundary',10,'Moose',999),receipt('gap',15,'Moose',999),receipt('resume-boundary',20,'Moose',20),receipt('other',22,'Gray Wolf',999),receipt('finish-boundary',30,'Moose',999),receipt('after-finish',35,'Moose',999),receipt('continued',45,'Moose',30)];
 assert.equal(sessionHarvestSummary(s,receipts).targetTotal,1);
 at(20);s=control(store,s,'resume');assert.equal(s.version,3);assert.equal(s.periods.length,2);assert.equal(s.pausedAt,null);
 at(29);assert.equal(sessionHarvestSummary(s,receipts).targetTotal,2);assert.equal(s.endedAt,null,'reaching a goal does not finish automatically');
 at(30);s=control(store,s,'end');assert.equal(s.version,4);assert.equal(s.endedAt,iso(30));
 let summary=sessionHarvestSummary(s,receipts);assert.equal(summary.total,3);assert.equal(summary.targetTotal,2);assert.equal(summary.activeSeconds,20);
 at(40);s=control(store,s,'resume');assert.equal(s.periods.length,3);assert.equal(s.endedAt,null);assert.equal(s.startedAt,iso(0));
 at(50);s=control(store,s,'end');summary=sessionHarvestSummary(s,receipts);assert.equal(summary.total,4);assert.equal(summary.targetTotal,3);assert.equal(summary.activeSeconds,30);assert.equal(summary.runs,3);
});

test('finishing a paused grind retains its closed window and never counts the paused tail',t=>{
 const store=db(t),at=clock(t);let s=store.command('synthetic',{op:'session.start',reserve:19});
 at(10);s=control(store,s,'pause');at(40);s=control(store,s,'end');
 assert.equal(s.endedAt,iso(40));assert.equal(s.pausedAt,null);assert.deepEqual(s.periods,[{startedAt:iso(0),endedAt:iso(10)}]);
 const summary=sessionHarvestSummary(s,[receipt('active',1),receipt('tail',20)]);assert.equal(summary.total,1);assert.equal(summary.activeSeconds,10);
});

test('legacy editing preserves its window and continuing preserves its inclusive historical cutoff',t=>{
 const store=db(t),at=clock(t),legacy={id:'legacy',reserve:19,name:'Moose by name only',startedAt:iso(0),endedAt:iso(10)};
 store.put('synthetic','sessions',legacy);const receipts=[receipt('start',0,'Moose',10),receipt('end',10,'Moose',20),receipt('gap',15,'Moose',999),receipt('new',25,'Moose',30),receipt('new-end',30,'Moose',999)];
 const before=sessionHarvestSummary(legacy,receipts);assert.equal(before.targetTotal,2);assert.equal(before.bestScore,null);
 let s=control(store,legacy,'update',{name:'Legacy renamed'});assert.equal(s.version,2);assert.equal(Object.hasOwn(s,'periods'),false);assert.deepEqual(sessionHarvestSummary(s,receipts),before);
 at(20);s=control(store,s,'resume');assert.equal(s.periods[0].endInclusive,true);assert.equal(s.periods[0].endedAt,legacy.endedAt);
 at(30);s=control(store,s,'end');const after=sessionHarvestSummary(s,receipts);assert.equal(after.total,3);assert.equal(after.activeSeconds,20);assert.equal(after.runs,2);
});

test('legacy no-id finish remains compatible while partial identity is rejected',t=>{
 const store=db(t),at=clock(t),legacy={id:'legacy-active',reserve:19,name:'Legacy',startedAt:iso(0),endedAt:null};store.put('synthetic','sessions',legacy);
 assert.throws(()=>store.command('synthetic',{op:'session.end',id:legacy.id}),e=>e.status===400);
 assert.throws(()=>store.command('synthetic',{op:'session.end',version:1}),e=>e.status===400);
 at(10);const s=store.command('synthetic',{op:'session.end'});assert.equal(s.version,2);assert.equal(Object.hasOwn(s,'periods'),false);
 assert.equal(sessionHarvestSummary(s,[receipt('end',10)]).total,1);
});

test('modern and edited legacy grinds require identity and version before finishing',t=>{
 const store=db(t);clock(t);
 const modern=store.command('synthetic',{op:'session.start',reserve:19});
 for(const identity of [{},{id:modern.id},{version:modern.version}])assert.throws(()=>store.command('synthetic',{op:'session.end',...identity}),e=>e.status===400);
 assert.deepEqual(store.item('synthetic',modern.id,'sessions'),modern);
 const legacy={id:'edited-legacy',reserve:19,name:'Legacy',startedAt:iso(0),endedAt:null};store.put('legacy-profile','sessions',legacy);
 const edited=store.command('legacy-profile',{op:'session.update',id:legacy.id,version:1,name:'Edited'});assert.equal(Object.hasOwn(edited,'periods'),false);
 assert.throws(()=>store.command('legacy-profile',{op:'session.end'}),e=>e.status===400);assert.deepEqual(store.item('legacy-profile',edited.id,'sessions'),edited);
 const periodOnly={...modern,id:'period-only'};delete periodOnly.version;store.put('period-profile','sessions',periodOnly);
 assert.throws(()=>store.command('period-profile',{op:'session.end'}),e=>e.status===400);assert.deepEqual(store.item('period-profile',periodOnly.id,'sessions'),periodOnly);
});

test('a stale legacy finish request cannot end a different newer grind',t=>{
 const store=db(t),at=clock(t),legacy={id:'old-legacy',reserve:19,name:'Legacy',startedAt:iso(0),endedAt:null};store.put('synthetic','sessions',legacy);
 const oldRequest={op:'session.end',requestId:'legacy-finish-request'},send=body=>store.mutate('synthetic',body.requestId,body,()=>store.command('synthetic',body));
 at(10);const ended=send(oldRequest);at(20);const newer=store.command('synthetic',{op:'session.start',reserve:19,name:'New current grind'});
 assert.throws(()=>send({op:'session.end',requestId:'late-legacy-finish-request'}),e=>e.status===400);
 assert.deepEqual(send(oldRequest),ended,'a retry returns its original completed result');
 assert.deepEqual(store.item('synthetic',newer.id,'sessions'),newer);assert.equal(newer.endedAt,null);
});

test('stale or foreign grind identity never changes another grind, including paused ones',t=>{
 const store=db(t),at=clock(t);let s=store.command('synthetic',{op:'session.start',reserve:19});s=control(store,s,'update',{goal:5});
 for(const op of ['update','pause','resume','end']){
  conflict(()=>store.command('synthetic',{op:'session.'+op,id:'wrong-session',version:s.version}));
  conflict(()=>store.command('synthetic',{op:'session.'+op,id:s.id,version:1}));
  conflict(()=>store.command('other-profile',{op:'session.'+op,id:s.id,version:s.version}));
 }
 at(10);s=control(store,s,'pause');
 at(20);s=control(store,s,'end');const old=s;
 at(30);let other=store.command('synthetic',{op:'session.start',reserve:19});at(40);other=control(store,other,'pause');
 const continued=control(store,old,'resume');assert.equal(continued.endedAt,null);conflict(()=>control(store,old,'end'));assert.deepEqual(store.item('synthetic',other.id,'sessions'),other);
});
test('two grinds track independently and ambiguous legacy or encounter association never picks one',t=>{
 const store=db(t),at=clock(t);
 let first=store.command('synthetic',{op:'session.start',reserve:19,name:'First',targetSpecies:'Moose'});
 at(10);let second=store.command('synthetic',{op:'session.start',reserve:1,name:'Second',targetSpecies:'Red Deer'});
 assert.equal(store.journal('synthetic','sessions').filter(s=>!s.endedAt&&!s.pausedAt).length,2);
 conflict(()=>store.command('synthetic',{op:'session.end'}));
 assert.equal(store.command('synthetic',{op:'encounter.create',reserve:19,species:'Moose'}).sessionId,null,'overlap is not assigned to an arbitrary grind');
 at(20);first=control(store,first,'pause');assert.equal(store.item('synthetic',second.id,'sessions').pausedAt,null);
 assert.equal(store.command('synthetic',{op:'encounter.create',reserve:1,species:'Red Deer'}).sessionId,second.id);
 at(30);first=control(store,first,'resume');assert.equal(first.pausedAt,null);assert.equal(second.version,1);
 at(40);second=control(store,second,'end');assert.equal(store.item('synthetic',first.id,'sessions').endedAt,null);
 const receipts=[receipt('before',5),receipt('shared',15),receipt('gap',25),receipt('after',35)];
 assert.deepEqual([sessionHarvestSummary(first,receipts,Date.parse(iso(40))).total,sessionHarvestSummary(second,receipts).total],[3,3],'overlapping windows are independent and paused time stays excluded');
});

test('committed control retries run once and a different body cannot reuse that identity',t=>{
 const store=db(t),at=clock(t);let executions=0;
 const send=body=>store.mutate('synthetic',body.requestId,body,()=>{executions++;return store.command('synthetic',body);});
 const start={op:'session.start',requestId:'grind-start-request',reserve:19,targetSpecies:'Moose',goal:10};let s=send(start);assert.deepEqual(send(start),s);assert.equal(executions,1);
 at(10);const pause={op:'session.pause',requestId:'grind-pause-request',id:s.id,version:s.version};s=send(pause);assert.deepEqual(send(pause),s);
 at(20);const resume={op:'session.resume',requestId:'grind-resume-request',id:s.id,version:s.version};s=send(resume);assert.deepEqual(send(resume),s);assert.equal(s.periods.length,2);assert.equal(s.version,3);assert.equal(executions,3);
 conflict(()=>send({...resume,version:1}));assert.equal(executions,3);assert.equal(store.journal('synthetic','sessions').length,1);
});

test('pause history and command receipts survive a database restart',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cotw-grind-test-')),filename=path.join(dir,'synthetic.sqlite');let store=new Store(filename);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});const at=clock(t);
 let s=store.command('synthetic',{op:'session.start',reserve:19,targetSpecies:'Moose',goal:10});at(10);
 const body={op:'session.pause',requestId:'persist-pause-request',id:s.id,version:s.version};s=store.mutate('synthetic',body.requestId,body,()=>store.command('synthetic',body));
 store.close();store=new Store(filename);assert.deepEqual(store.item('synthetic',s.id,'sessions'),s);
 assert.deepEqual(store.mutate('synthetic',body.requestId,body,()=>{throw Error('Retry must not execute');}),s);
 at(20);s=control(store,s,'resume');at(30);s=control(store,s,'end');store.close();store=new Store(filename);
 assert.deepEqual(store.item('synthetic',s.id,'sessions'),s);const summary=sessionHarvestSummary(s,[receipt('active',1),receipt('gap',15),receipt('resumed',25)]);assert.equal(summary.targetTotal,2);assert.equal(summary.activeSeconds,20);
});

test('run limits and clock rollback reject continuation without changing existing history',t=>{
 const store=db(t),at=clock(t),periods=Array.from({length:SESSION_MAX_PERIODS},(_,i)=>({startedAt:iso(i*2),endedAt:iso(i*2+1)}));
 const s={id:'at-limit',name:'At limit',reserve:19,startedAt:iso(0),endedAt:null,pausedAt:iso(999),periods,version:1};store.put('synthetic','sessions',s);
 at(2000);conflict(()=>control(store,s,'resume'));assert.deepEqual(store.item('synthetic',s.id,'sessions'),s);const ended=control(store,s,'end');assert.equal(ended.periods.length,500);
 const malformed={...s,id:'malformed',periods:[{startedAt:'invalid',endedAt:iso(1)}]};store.put('bad-profile','sessions',malformed);
 conflict(()=>store.command('bad-profile',{op:'session.end',id:malformed.id,version:1}));
 at(3000);let current=store.command('synthetic',{op:'session.start',reserve:19});at(3010);current=control(store,current,'pause');at(3005);conflict(()=>control(store,current,'resume'));assert.deepEqual(store.item('synthetic',current.id,'sessions'),current);
});

test('phone projection keeps only safe control and summary fields with strict existing size limits',()=>{
 const recent=Array.from({length:6},(_,i)=>({...receipt('safe-'+i,i,'Moose',i),raw:'PRIVATE_RECEIPT'}));
 const session={id:'safe-session',reserve:19,name:'Test',startedAt:iso(0),endedAt:iso(20),pausedAt:null,targetSpecies:'Moose',goal:10,version:4,periods:[{startedAt:iso(0),endedAt:iso(20),secret:'PRIVATE_PERIOD'}],privatePath:'PRIVATE_PATH',harvestSummary:{total:6,targetTotal:6,bestScore:5,averageScore:2.5,activeSeconds:20,runs:1,lastHarvestAt:iso(5),scope:'full_retained_journal',timeBasis:'saved_harvest_time',reserveScope:'all_reserves',bySpecies:[{species:'Moose',count:6}],recent,raw:'PRIVATE_SUMMARY'}};
 const projected=projectPhoneState({sessions:[session]});assert.doesNotMatch(JSON.stringify(projected),/PRIVATE_|periods|privatePath/);assert.equal(projected.sessions[0].version,4);assert.equal(projected.sessions[0].targetSpecies,'Moose');assert.equal(projected.sessions[0].harvestSummary.recent.length,6);
 assert.deepEqual(projectPhoneCommandResult('session.update',session),projected.sessions[0]);
 assert.throws(()=>projectPhoneState({sessions:[{...session,harvestSummary:{...session.harvestSummary,recent:[...recent,recent[0]]}}]}),/item limit/);
 assert.throws(()=>projectPhoneState({sessions:Array(2001).fill(session)}),/item limit/);
 assert.throws(()=>projectPhoneState({sessions:Array.from({length:1000},()=>({...session,name:'x'.repeat(4000)}))}),/byte limit/);
 for(const op of ['session.update','session.pause','session.resume','session.end']){
  assert.doesNotThrow(()=>validatePhoneCommand({op,requestId:randomUUID(),id:'session',version:1}));
  for(const identity of [{},{id:'session'},{version:1},{id:'session',version:0},{id:'session',version:'1'}])assert.throws(()=>validatePhoneCommand({op,requestId:randomUUID(),...identity}),e=>e.status===400);
 }
 for(const fields of [{periods:[]},{startedAt:iso(0)},{endedAt:iso(1)},{pausedAt:iso(1)},{rawPath:'private'}])assert.throws(()=>validatePhoneCommand({op:'session.start',requestId:randomUUID(),reserve:19,...fields}),/field/);
});

test('paired phone control roundtrip preserves versions, idempotency, projection and CSRF protection',async t=>{
 const store=db(t),key=randomBytes(32),relay=await createPhoneRelay({key,publicOrigin:'http://127.0.0.1:0',allowInsecureLoopback:true});let bridge;
 t.after(async()=>{await bridge?.close();await relay.close();});
 const credentials=await provisionPhoneDevice({relayUrl:relay.origin,enrollmentToken:createPhoneEnrollmentToken({key}),allowInsecureLoopback:true});
 bridge=createPhoneBridge({relayUrl:relay.origin,deviceToken:credentials.deviceToken,allowInsecureLoopback:true,readState:()=>({selectedReserve:19,sessions:store.journal('synthetic','sessions').map(s=>({...s,harvestSummary:sessionHarvestSummary(s,[]),privatePath:'PRIVATE_PATH'}))}),runCommand:body=>store.mutate('synthetic',body.requestId,body,()=>store.command('synthetic',body))});
 await bridge.connect();const link=await bridge.pair(),token=new URLSearchParams(new URL(link.url).hash.slice(1)).get('pair');
 const pairing=await fetch(relay.origin+'/phone/pair',{method:'POST',headers:{Origin:relay.origin,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(pairing.status,200);await pairing.text();
 const cookie=pairing.headers.get('set-cookie').split(';')[0],boot=await (await fetch(relay.origin+'/api/bootstrap',{headers:{Cookie:cookie}})).json();
 const send=async(body,csrf=boot.token)=>{const response=await fetch(relay.origin+'/api/command',{method:'POST',headers:{Cookie:cookie,Origin:relay.origin,'Content-Type':'application/json',...(csrf?{'X-Companion-Token':csrf}:{})},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
 const start={op:'session.start',requestId:randomUUID(),reserve:19,name:'Phone grind',targetSpecies:'Moose',goal:20};
 assert.equal((await send(start,null)).status,403);assert.equal(store.journal('synthetic','sessions').length,0);
 let response=await send(start);assert.equal(response.status,200);let s=response.value;assert.equal(s.version,1);assert.equal(s.targetSpecies,'Moose');assert.equal(Object.hasOwn(s,'periods'),false);assert.deepEqual((await send(start)).value,s);
 for(const identity of [{},{id:s.id},{version:s.version}])assert.equal((await send({op:'session.end',requestId:randomUUID(),...identity})).status,400);
 assert.equal(store.item('synthetic',s.id,'sessions').endedAt,null);
 const update={op:'session.update',requestId:randomUUID(),id:s.id,version:s.version,name:'Phone edit',targetSpecies:'Whitetail Deer',goal:5,reserve:3};response=await send(update);assert.equal(response.status,200);s=response.value;assert.equal(s.version,2);assert.equal(s.reserve,3);assert.equal(s.targetSpecies,'Whitetail Deer');
 for(const op of ['session.pause','session.resume','session.end','session.resume']){
  const body={op,requestId:randomUUID(),id:s.id,version:s.version};response=await send(body);assert.equal(response.status,200,op);assert.equal(response.value.version,s.version+1);s=response.value;assert.deepEqual((await send(body)).value,s);
 }
 assert.equal((await send({...update,requestId:randomUUID()})).status,409);
 assert.equal((await send({op:'session.end',requestId:randomUUID(),id:'wrong',version:1})).status,409);
 const view=await (await fetch(relay.origin+'/api/state?reserve=19',{headers:{Cookie:cookie}})).json();assert.equal(view.sessions[0].version,s.version);assert.equal(view.sessions[0].harvestSummary.runs,3);assert.doesNotMatch(JSON.stringify(view),/PRIVATE_|periods/);assert.equal(store.journal('synthetic','sessions').length,1);
});
