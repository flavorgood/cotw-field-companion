import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Store} from '../lib/store.mjs';
import {Observer} from '../lib/observer.mjs';
import {createPhoneBridge,provisionPhoneDevice,projectPhoneState,projectPhoneCommandResult,validatePhoneCommand} from '../lib/phone-bridge.mjs';
import {createPhoneRelay} from '../cloud/server.mjs';
import {createPhoneEnrollmentToken} from '../cloud/auth.mjs';

const reference=()=>({reserves:{19:{id:19,name:'Synthetic',poi:[]},3:{id:3,name:'Other',poi:[]}},populations:{}});
const zone=(id,x,z,reserve=19)=>({id,reserve,x,z,start:null,end:null,species:'Moose',need:'drinking',source:'player_report'});
const routeKey=observer=>'route:'+observer.profile+':19',optionsKey=observer=>'route-options:'+observer.profile+':19';
function setup(t){const store=new Store(':memory:');t.after(()=>store.close());const observer=new Observer(store,null,reference());for(const z of [zone('a',0,0),zone('b',1000,0),zone('c',0,10),zone('d',1000,10)])store.put(observer.profile,'zones',z);return {store,observer};}
function send(observer,body){const request={requestId:randomUUID(),...body};return observer.store.mutate(observer.profile,request.requestId,request,()=>observer.command(request));}
function control(observer,op,extra={},state=observer.state(19)){return send(observer,{op,reserve:19,expectedOrder:state.route,expectedVersion:state.routeOptimization.version,...extra});}

test('existing routes optimize on read without journal writes and refresh from changed trusted coordinates',t=>{
 const {store,observer}=setup(t),raw=['a','b','c','d'];store.set(routeKey(observer),raw);
 const before=store.db.prepare('SELECT total_changes() AS n').get().n,state=observer.state(19);assert.deepEqual(state.route,['a','c','d','b']);assert.equal(state.routeOptimization.version,1);assert.deepEqual(store.get(routeKey(observer)),raw);assert.equal(store.db.prepare('SELECT total_changes() AS n').get().n,before);assert.equal(store.get(optionsKey(observer)),null);
 store.put(observer.profile,'zones',zone('c',2000,10));const changed=observer.state(19);assert.notDeepEqual(changed.route,state.route);assert.throws(()=>control(observer,'route.mode',{mode:'manual'},state),e=>e.status===409);assert.deepEqual(store.get(routeKey(observer)),raw);
 store.put(observer.profile,'zones',{...zone('a',0,0),start:6,end:8});store.put(observer.profile,'zones',{...zone('b',1000,0),start:20,end:22});store.put(observer.profile,'zones',{...zone('c',2000,10),start:8,end:10});assert.equal(observer.state(19).routeOptimization.usesHours,true);
});

test('add/remove automatically projects route order, preserves mode and chooses the next current start',t=>{
 const {store,observer}=setup(t);
 for(const zoneId of ['a','b','c','d']){const result=send(observer,{op:'route.toggle',reserve:19,zoneId});assert.deepEqual(Object.keys(result),['route']);}
 let state=observer.state(19);assert.deepEqual(state.route,['a','c','d','b']);assert.equal(state.routeOptimization.startZoneId,'a');assert.equal(store.get(optionsKey(observer)).startZoneId,'a');
 const started=control(observer,'route.start',{zoneId:'b'});assert.equal(started.route[0],'b');assert.equal(started.routeOptimization.startZoneId,'b');const following=started.route[1];
 const removed=send(observer,{op:'route.toggle',reserve:19,zoneId:'b'});assert.equal(removed.route[0],following);assert.equal(observer.state(19).routeOptimization.startZoneId,following);
 state=observer.state(19);control(observer,'route.mode',{mode:'manual'},state);const before=observer.state(19).route;send(observer,{op:'route.toggle',reserve:19,zoneId:'b'});assert.deepEqual(observer.state(19).route,[...before,'b']);assert.equal(observer.state(19).routeOptimization.mode,'manual');
});

test('manual reorder freezes chosen order and explicit start survives later source changes',t=>{
 const {store,observer}=setup(t);store.set(routeKey(observer),['a','b','c','d']);const manual=['d','c','b','a'];
 const result=control(observer,'route.reorder',{order:manual});assert.deepEqual(result,manual);let state=observer.state(19);assert.equal(state.routeOptimization.mode,'manual');assert.equal(state.routeOptimization.startZoneId,'d');
 store.put(observer.profile,'zones',zone('c',-10000,0));assert.deepEqual(observer.state(19).route,manual);
 state=control(observer,'route.start',{zoneId:'b'});assert.deepEqual(state.route,['b','d','c','a']);assert.equal(state.routeOptimization.mode,'manual');
 control(observer,'route.mode',{mode:'auto'});store.put(observer.profile,'zones',zone('d',20000,0));assert.equal(observer.state(19).route[0],'b');assert.equal(store.get(optionsKey(observer)).startZoneId,'b');
});

test('preference versions reject stale writes even when mode or start changes leave the same order',t=>{
 const {store,observer}=setup(t);store.set(routeKey(observer),['a','b']);const stale=observer.state(19);control(observer,'route.mode',{mode:'manual'},stale);assert.deepEqual(observer.state(19).route,stale.route);
 for(const [op,extra]of [['route.mode',{mode:'auto'}],['route.start',{zoneId:'a'}],['route.reorder',{order:['a','b']}]] )assert.throws(()=>control(observer,op,extra,stale),e=>e.status===409);
 const current=observer.state(19);control(observer,'route.start',{zoneId:'a'},current);assert.throws(()=>control(observer,'route.mode',{mode:'auto'},current),e=>e.status===409);
 assert.throws(()=>send(observer,{op:'route.reorder',reserve:19,order:['a','b'],expectedOrder:['a','b']}),e=>e.status===409);
});

test('missing saved stops stay intact, remain removable, and repeated identities are not dropped by a new start',t=>{
 const {store,observer}=setup(t);store.set(routeKey(observer),['a','missing','b']);let state=observer.state(19);assert.deepEqual(state.route,['a','missing','b']);assert.equal(state.routeOptimization.distanceMeters,null);assert.equal(state.routeOptimization.missingCount,1);
 const removed=send(observer,{op:'route.toggle',reserve:19,zoneId:'missing'});assert.deepEqual(removed.route,['a','b']);assert.equal(observer.state(19).routeOptimization.missingCount,0);
 store.set(routeKey(observer),['a','b','a','c']);state=observer.state(19);const started=control(observer,'route.start',{zoneId:'a'},state);assert.deepEqual(started.route,['a','b','a','c']);assert.equal(started.routeOptimization.status,'duplicate_stops');
});

test('route commands are profile/reserve-scoped and reject client coordinates or unknown added zones',t=>{
 const {store,observer}=setup(t),other=new Observer(store,'C:/synthetic-route-profile',reference());store.set(routeKey(observer),['a','b']);
 assert.throws(()=>send(other,{op:'route.toggle',reserve:19,zoneId:'a'}),e=>e.status===409);assert.throws(()=>send(observer,{op:'route.toggle',reserve:3,zoneId:'a'}),e=>e.status===409);
 for(const op of ['route.mode','route.start','route.reorder','route.toggle']){const body={op,reserve:19,mode:'auto',zoneId:'a',expectedOrder:['a','b'],expectedVersion:1,x:1,z:2};assert.throws(()=>send(observer,body),e=>e.status===400);assert.throws(()=>validatePhoneCommand({...body,requestId:randomUUID()}),e=>e.status===400);}
 assert.deepEqual(store.get(routeKey(observer)),['a','b']);assert.equal(store.get('route:'+other.profile+':19'),null);assert.equal(store.get('route:'+observer.profile+':3'),null);
 assert.throws(()=>control(observer,'route.start',{zoneId:'not-in-route'}),e=>e.status===400);
});

test('idempotent mode/start/toggle retries do not repeat membership or preference changes',t=>{
 const {store,observer}=setup(t);store.set(routeKey(observer),['a','b','c']);let state=observer.state(19);
 for(const body of [{op:'route.mode',mode:'manual'},{op:'route.start',zoneId:'b'},{op:'route.toggle',zoneId:'d'}]){
  const request={...body,reserve:19,requestId:randomUUID(),...(body.op==='route.toggle'?{}:{expectedOrder:state.route,expectedVersion:state.routeOptimization.version})},first=send(observer,request),version=observer.state(19).routeOptimization.version;
  assert.deepEqual(send(observer,request),first);assert.equal(observer.state(19).routeOptimization.version,version);assert.throws(()=>send(observer,{...request,reserve:3}),e=>e.status===409);state=observer.state(19);
 }
 assert.equal(state.route.filter(id=>id==='d').length,1);assert.equal(state.routeOptimization.startZoneId,'b');assert.equal(state.routeOptimization.mode,'manual');
});

test('manual mode and chosen start survive restart; untouched legacy reorder remains compatible once',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cotw-route-test-')),file=path.join(dir,'synthetic.sqlite');let store=new Store(file);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});let observer=new Observer(store,null,reference());
 for(const z of [zone('a',0,0),zone('b',1000,0),zone('c',1,0)])store.put(observer.profile,'zones',z);store.set(routeKey(observer),['a','b','c']);
 const first=observer.state(19);send(observer,{op:'route.reorder',reserve:19,order:['c','b','a'],expectedOrder:first.route});const saved=observer.state(19);store.close();store=new Store(file);observer=new Observer(store,null,reference());
 assert.deepEqual(observer.state(19).route,saved.route);assert.deepEqual(observer.state(19).routeOptimization,saved.routeOptimization);assert.throws(()=>send(observer,{op:'route.reorder',reserve:19,order:saved.route,expectedOrder:saved.route}),e=>e.status===409);
});

test('phone projection allowlists route ordering evidence and requires current preference versions',()=>{
 const optimization={mode:'auto',version:3,status:'optimized_hours',startZoneId:'a',savedMeters:-50,distanceMeters:100,originalDistanceMeters:50,usesHours:true,missingCount:0,unknownHoursCount:1,privatePath:'PRIVATE_PATH',coords:[1,2]},state={route:['a','b'],routeOptimization:optimization};
 const phone=projectPhoneState(state);assert.equal(phone.routeOptimization.savedMeters,-50);assert.equal(phone.routeOptimization.version,3);assert.doesNotMatch(JSON.stringify(phone),/PRIVATE_|coords/);
 assert.deepEqual(projectPhoneCommandResult('route.mode',state),{route:phone.route,routeOptimization:phone.routeOptimization});assert.deepEqual(projectPhoneCommandResult('route.start',state),{route:phone.route,routeOptimization:phone.routeOptimization});assert.deepEqual(projectPhoneCommandResult('route.toggle',state),{route:['a','b']});assert.deepEqual(projectPhoneCommandResult('route.reorder',['b','a']),['b','a']);
 for(const op of ['route.mode','route.start']){
  const fields=op==='route.mode'?{mode:'auto'}:{zoneId:'a'},body={op,requestId:randomUUID(),reserve:19,expectedOrder:['a','b'],expectedVersion:3,...fields};assert.deepEqual(validatePhoneCommand(body),body);
  for(const expectedVersion of [undefined,null,0,1.5,'3'])assert.throws(()=>validatePhoneCommand({...body,expectedVersion}),e=>e.status===400);
 }
});

test('paired phone route controls use the full trusted Observer route and reject stale preferences',async t=>{
 const {store,observer}=setup(t);store.set(routeKey(observer),['a','b','c','d']);const key=randomBytes(32),relay=await createPhoneRelay({key,publicOrigin:'http://127.0.0.1:0',allowInsecureLoopback:true});let bridge;t.after(async()=>{await bridge?.close();await relay.close();});
 const credential=await provisionPhoneDevice({relayUrl:relay.origin,enrollmentToken:createPhoneEnrollmentToken({key}),allowInsecureLoopback:true});bridge=createPhoneBridge({relayUrl:relay.origin,deviceToken:credential.deviceToken,allowInsecureLoopback:true,readState:reserve=>observer.state(reserve),runCommand:body=>send(observer,body)});await bridge.connect();
 const link=await bridge.pair(),token=new URLSearchParams(new URL(link.url).hash.slice(1)).get('pair'),paired=await fetch(relay.origin+'/phone/pair',{method:'POST',headers:{Origin:relay.origin,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(paired.status,200);await paired.text();const cookie=paired.headers.get('set-cookie').split(';')[0],boot=await (await fetch(relay.origin+'/api/bootstrap',{headers:{Cookie:cookie}})).json();
 const read=async()=>await(await fetch(relay.origin+'/api/state?reserve=19',{headers:{Cookie:cookie}})).json(),post=async body=>{const response=await fetch(relay.origin+'/api/command',{method:'POST',headers:{Cookie:cookie,Origin:relay.origin,'Content-Type':'application/json','X-Companion-Token':boot.token},body:JSON.stringify({requestId:randomUUID(),...body})});return {status:response.status,value:await response.json()};};
 let state=await read();assert.deepEqual(state.route,['a','c','d','b']);assert.equal(state.routeOptimization.mode,'auto');const stale={expectedOrder:state.route,expectedVersion:state.routeOptimization.version};
 const manual=await post({op:'route.mode',reserve:19,mode:'manual',...stale});assert.equal(manual.status,200);assert.equal(manual.value.routeOptimization.mode,'manual');assert.deepEqual(manual.value.route,state.route);
 assert.equal((await post({op:'route.start',reserve:19,zoneId:'a',...stale})).status,409);state=await read();const started=await post({op:'route.start',reserve:19,zoneId:'b',expectedOrder:state.route,expectedVersion:state.routeOptimization.version});assert.equal(started.status,200);assert.equal(started.value.route[0],'b');assert.equal(started.value.routeOptimization.startZoneId,'b');
 const toggled=await post({op:'route.toggle',reserve:19,zoneId:'b'});assert.equal(toggled.status,200);assert.deepEqual(Object.keys(toggled.value),['route']);assert.equal((await read()).routeOptimization.startZoneId,started.value.route[1]);
});
