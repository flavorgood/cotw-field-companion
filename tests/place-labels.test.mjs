import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {Store} from '../lib/store.mjs';
import {Observer,normalizeFile} from '../lib/observer.mjs';
import {createPhoneBridge,provisionPhoneDevice,projectPhoneState,projectPhoneExport,projectPhoneCommandResult,validatePhoneCommand} from '../lib/phone-bridge.mjs';
import {createPhoneRelay} from '../cloud/server.mjs';
import {createPhoneEnrollmentToken} from '../cloud/auth.mjs';

const stamp={sha:'synthetic-only',mtime:'2026-01-01T00:00:00Z',checked:'2026-01-01T00:00:00Z',status:'ok'};
const item=(link,reserve=19,type=101,x=10)=>({ReserveId:reserve,SaveLinkId:link,EquipmentHash:type,Position:{X:x,Z:20}});
function reference(){return {reserves:{19:{id:19,name:'Synthetic reserve',poi:[{id:'poi:19:outpost:0',kind:'outpost',label:'Original outpost',x:50,z:60,source:'public_map_reference'},{id:'poi:19:outpost:1',kind:'outpost',label:'Second outpost',x:70,z:80,source:'public_map_reference'}]},3:{id:3,name:'Other reserve',poi:[{id:'poi:3:outpost:0',kind:'outpost',label:'Other outpost',x:30,z:40,source:'public_map_reference'}]}},equipment:{101:{name:'Tent',kind:'tent'},102:{name:'Tripod',kind:'tripod'}},populations:{}};}
function create(t){const store=new Store(':memory:');t.after(()=>store.close());return {store,observer:new Observer(store,null,reference())};}
function saveEquipment(observer,items){const payload=normalizeFile('worlditemsdata_adf',{value:{WorldItems:items}});observer.store.saveSource(observer.profile,'worlditemsdata_adf',{...stamp,payload});observer.cache.clear();return payload;}
function rename(observer,id,label,requestId=randomUUID()){const body={op:'place.rename',requestId,id,label};return observer.store.mutate(observer.profile,requestId,body,()=>observer.command(body));}

test('name-only zone rename preserves strategy and notes edited after its dialog opened',t=>{
 const {store,observer}=create(t),zoneId='synthetic-zone';
 const before=observer.command({op:'zone.annotate',zoneId,strategy:'shoot',name:'Old name',notes:'Old notes'}),pendingRename={op:'zone.rename',requestId:randomUUID(),zoneId,name:'  New spot name  '};
 const latest=observer.command({op:'zone.annotate',zoneId,strategy:'untouched',name:before.name,notes:'Keep the updated notes'});store.put(observer.profile,'annotations',{...latest,futureField:'preserved'});
 const send=()=>store.mutate(observer.profile,pendingRename.requestId,pendingRename,()=>observer.command(pendingRename)),renamed=send();
 assert.equal(renamed.name,'New spot name');assert.equal(renamed.strategy,'untouched');assert.equal(renamed.notes,'Keep the updated notes');assert.equal(renamed.futureField,'preserved');assert.equal(renamed.id,latest.id);assert.deepEqual(send(),renamed);
 const phone=projectPhoneCommandResult('zone.rename',renamed);assert.equal(phone.name,'New spot name');assert.equal(phone.strategy,'untouched');assert.equal(phone.notes,'Keep the updated notes');assert.equal(Object.hasOwn(phone,'futureField'),false);
 const cleared=observer.command({op:'zone.rename',zoneId,name:' '});assert.equal(cleared.name,'');assert.equal(cleared.strategy,'untouched');assert.equal(cleared.notes,'Keep the updated notes');
});

test('new spot names get safe defaults and reject fields that could overwrite a plan',t=>{
 const {store,observer}=create(t),base={op:'zone.rename',requestId:randomUUID(),zoneId:'new-zone',name:'Name'};
 for(const fields of [{zoneId:''},{zoneId:' '},{zoneId:'z'.repeat(201)},{name:null},{name:'n'.repeat(121)},{strategy:'shoot'},{notes:'Stale notes'}]){
  const body={...base,...fields};assert.throws(()=>observer.command(body),e=>e.status===400);assert.throws(()=>validatePhoneCommand(body),e=>e.status===400);
 }
 assert.equal(store.journal(observer.profile,'annotations').length,0);assert.deepEqual(validatePhoneCommand(base),base);
 const named=observer.command(base);assert.equal(named.name,'Name');assert.equal(named.strategy,'unassigned');assert.equal(named.notes,'');
});

test('custom place names decorate pins, equipment and public points without changing original sources',t=>{
 const {store,observer}=create(t),raw=saveEquipment(observer,[item(1)]),beforeReference=structuredClone(observer.reference);
 const pin=observer.command({op:'pin.create',reserve:19,kind:'stand',label:'Original marker',x:1,z:2});
 let state=observer.state(19);const targets=[state.pins[0],state.equipment[0],state.reserves.find(r=>r.id===19).poi[0]];
 for(const [i,p]of targets.entries()){assert.equal(p.canRename,true);rename(observer,p.renameId,'  Custom '+i+'  ');}
 state=observer.state(19);const renamed=[state.pins[0],state.equipment[0],state.reserves.find(r=>r.id===19).poi[0]];
 for(const [i,p]of renamed.entries()){assert.equal(p.label,'Custom '+i);assert.equal(p.customLabel,'Custom '+i);assert.equal(p.originalLabel,targets[i].label);assert.equal(p.kind,targets[i].kind);assert.equal(p.id,targets[i].id);}
 assert.equal(state.equipment[0].typeVerified,true);assert.deepEqual(store.source(observer.profile,'worlditemsdata_adf').payload,raw);assert.deepEqual(store.item(observer.profile,pin.id,'pins'),pin);assert.deepEqual(observer.reference,beforeReference);
 assert.equal(store.exportJournal(observer.profile).placeLabels.length,3);assert.equal(state.placeLabels.length,3);
 const cleared=rename(observer,targets[1].renameId,' ');assert.equal(cleared.label,'');state=observer.state(19);assert.equal(state.equipment[0].label,'Tent');assert.equal(state.equipment[0].customLabel,null);assert.equal(store.journal(observer.profile,'placeLabels').length,2);
});

test('equipment aliases survive array reorder but never follow a different type or missing identity',t=>{
 const {observer}=create(t);saveEquipment(observer,[item(11),item(22,19,102,30)]);
 const original=observer.state(19).equipment.find(p=>p.hash==='101');rename(observer,original.renameId,'North tent');
 saveEquipment(observer,[item(22,19,102,30),item(11)]);const reordered=observer.state(19).equipment.find(p=>p.hash==='101');
 assert.notEqual(reordered.id,original.id);assert.equal(reordered.renameId,original.renameId);assert.equal(reordered.label,'North tent');
 saveEquipment(observer,[item(11,19,102)]);const changedType=observer.state(19).equipment[0];assert.notEqual(changedType.renameId,original.renameId);assert.equal(changedType.customLabel,null);
 saveEquipment(observer,[item(undefined)]);const missing=observer.state(19).equipment[0];assert.equal(missing.canRename,false);assert.equal(missing.renameId,null);assert.match(missing.renameUnavailableReason,/identity/);assert.equal(missing.customLabel,null);
 assert.throws(()=>rename(observer,original.renameId,'Wrong target'),e=>e.status===409);
});

test('duplicate, missing and unsafe SaveLinkId values fail closed, including hidden invalid coordinates',t=>{
 const {observer}=create(t);
 for(const values of [[item(1),item(1,19,102,30)],[item(1),{...item(1),Position:{X:NaN,Z:10}}],[item(0)],[item(Number.MAX_SAFE_INTEGER+1)],[item('18446744073709551616')]]){
  saveEquipment(observer,values);for(const p of observer.state(19).equipment){assert.equal(p.canRename,false);assert.equal(p.renameId,null);assert.equal(p.customLabel,null);}
 }
 saveEquipment(observer,[item('18446744073709551615')]);assert.equal(observer.state(19).equipment[0].canRename,true,'unsigned 64-bit identity is preserved exactly as decimal text');
 saveEquipment(observer,[item(1,19),item(1,3)]);assert.equal(observer.state(19).equipment[0].canRename,true);assert.notEqual(observer.state(19).equipment[0].renameId,observer.state(3).equipment[0].renameId);
 const legacy={id:'equipment:19:1:0',reserve:19,x:10,z:20,hash:'101',label:'Old cache',source:'save'};observer.store.saveSource(observer.profile,'worlditemsdata_adf',{...stamp,payload:[legacy]});observer.cache.clear();assert.equal(observer.state(19).equipment[0].canRename,false,'legacy positional IDs are never parsed into an unverified alias identity');
});

test('public reference alias identity survives catalog reorder and rejects ambiguous or moved points',t=>{
 const {observer}=create(t);const initial=observer.state(19).reserves.find(r=>r.id===19).poi[0];rename(observer,initial.renameId,'West base');
 observer.reference.reserves[19].poi.reverse();observer.reference.reserves[19].poi.forEach((p,i)=>p.id='poi:19:outpost:'+i);
 let view=observer.state(19).reserves.find(r=>r.id===19).poi;const reordered=view.find(p=>p.x===50);assert.notEqual(reordered.id,initial.id);assert.equal(reordered.renameId,initial.renameId);assert.equal(reordered.label,'West base');
 observer.reference.reserves[19].poi.push({...observer.reference.reserves[19].poi.find(p=>p.x===50),id:'duplicate'});view=observer.state(19).reserves.find(r=>r.id===19).poi;assert.ok(view.filter(p=>p.x===50).every(p=>p.canRename===false&&p.customLabel===null));
 observer.reference.reserves[19].poi=[{...initial,x:initial.x+0.001,label:initial.originalLabel}];const moved=observer.state(19).reserves.find(r=>r.id===19).poi[0];assert.notEqual(moved.renameId,initial.renameId);assert.equal(moved.customLabel,null,'nearby coordinates are not treated as the same public place');
});

test('aliases are profile-local and commands cannot target arbitrary or deleted places',t=>{
 const {store,observer}=create(t),other=new Observer(store,'C:/synthetic-other-profile',reference());saveEquipment(observer,[item(1)]);saveEquipment(other,[item(1)]);
 const place=observer.state(19).equipment[0];rename(observer,place.renameId,'Owner A');assert.equal(other.state(19).equipment[0].customLabel,null);
 const pin=observer.command({op:'pin.create',reserve:19,kind:'stand',label:'Local pin',x:1,z:2});
 assert.throws(()=>rename(other,pin.id,'Foreign pin'),e=>e.status===409);
 for(const id of ['animal:secret','unknown','C:/private/path'])assert.throws(()=>rename(observer,id,'Unknown'),e=>e.status===409);
 assert.throws(()=>store.command(observer.profile,{op:'place.rename',id:place.renameId,label:'Bypass'}),e=>e.status===409);
 observer.command({op:'pin.delete',id:pin.id});assert.throws(()=>rename(observer,pin.id,'Deleted'),e=>e.status===409);
 assert.equal(store.journal(other.profile,'placeLabels').length,0);
});

test('place names and idempotent receipts survive restart and reject changed retry content',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cotw-place-labels-')),file=path.join(dir,'synthetic.sqlite');let store=new Store(file);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 let observer=new Observer(store,null,reference());saveEquipment(observer,[item(1)]);const target=observer.state(19).equipment[0].renameId,requestId=randomUUID(),saved=rename(observer,target,'Persisted',requestId);
 store.close();store=new Store(file);observer=new Observer(store,null,reference());assert.equal(observer.state(19).equipment[0].label,'Persisted');assert.deepEqual(rename(observer,target,'Persisted',requestId),saved);
 assert.throws(()=>rename(observer,target,'Different',requestId),e=>e.status===409);assert.equal(store.journal(observer.profile,'placeLabels').length,1);
});

test('place command validation rejects arbitrary fields and bounds names before any mutation',t=>{
 const {store,observer}=create(t);saveEquipment(observer,[item(1)]);const id=observer.state(19).equipment[0].renameId;
 for(const fields of [{id:' '},{id:'x'.repeat(201)},{label:null},{label:1},{label:'a'.repeat(121)},{x:1},{reserve:3},{path:'private'}]){
  const body={op:'place.rename',requestId:randomUUID(),id,label:'Name',...fields};assert.throws(()=>observer.command(body));assert.throws(()=>validatePhoneCommand(body));
 }
 assert.equal(store.journal(observer.profile,'placeLabels').length,0);assert.equal(rename(observer,id,'a'.repeat(120)).label.length,120);
});

test('phone aliases contain only current visible names and exclude private identity/source metadata',t=>{
 const {observer}=create(t);saveEquipment(observer,[item(1),item(2,3)]);
 const visible=observer.state(19).equipment[0],hidden=observer.state(3).equipment[0],poi=observer.state(19).reserves.find(r=>r.id===19).poi[0];
 rename(observer,visible.renameId,'Visible custom name');rename(observer,hidden.renameId,'HIDDEN_OTHER_RESERVE');rename(observer,poi.renameId,'Named public point');
 const state=observer.state(19);state.placeLabels.push({placeId:hidden.renameId,label:'HIDDEN_OTHER_RESERVE',rawPath:'PRIVATE_PATH'});state.equipment[0].rawPath='PRIVATE_PATH';
 const phone=projectPhoneState(state),encoded=JSON.stringify(phone);assert.doesNotMatch(encoded,/HIDDEN_OTHER_RESERVE|PRIVATE_PATH|saveLinkId|renameIdentityUnique|renameIdentityVersion/);
 assert.equal(phone.equipment[0].label,'Visible custom name');assert.equal(phone.equipment[0].originalLabel,'Tent');assert.equal(phone.equipment[0].renameId,visible.renameId);assert.equal(phone.placeLabels.length,2);
 const phonePoi=phone.reserves.find(r=>r.id===19).poi[0];assert.equal(phonePoi.label,'Named public point');assert.equal(phonePoi.renameId,poi.renameId);assert.equal(Object.hasOwn(phonePoi,'x'),false,'public coordinates remain the relay catalog owner');assert.deepEqual(phone.reserves.find(r=>r.id===3).poi,[]);
 assert.equal(projectPhoneExport(state).placeLabels.length,2);
 const result=projectPhoneCommandResult('place.rename',{id:'derived',placeId:visible.renameId,label:'Safe',updatedAt:stamp.checked,rawPath:'PRIVATE_PATH'});assert.deepEqual(Object.keys(result),['id','placeId','label','updatedAt']);
});

test('paired phone renames roundtrip through the Observer and preserve public catalog coordinates',async t=>{
 const {store,observer}=create(t),key=randomBytes(32),relay=await createPhoneRelay({key,publicOrigin:'http://127.0.0.1:0',allowInsecureLoopback:true});let bridge;
 t.after(async()=>{await bridge?.close();await relay.close();});
 const publicPoi=JSON.parse(readFileSync(new URL('../lib/maps-data.json',import.meta.url),'utf8')).reserves.find(r=>r.id===19).poi[0];observer.reference.reserves[19].poi=[{...structuredClone(publicPoi),id:'pc-reordered-public-point'}];saveEquipment(observer,[item(1)]);
 const credential=await provisionPhoneDevice({relayUrl:relay.origin,enrollmentToken:createPhoneEnrollmentToken({key}),allowInsecureLoopback:true});
 bridge=createPhoneBridge({relayUrl:relay.origin,deviceToken:credential.deviceToken,allowInsecureLoopback:true,readState:reserve=>observer.state(reserve),runCommand:body=>store.mutate(observer.profile,body.requestId,body,()=>observer.command(body))});
 await bridge.connect();const link=await bridge.pair(),token=new URLSearchParams(new URL(link.url).hash.slice(1)).get('pair');
 const paired=await fetch(relay.origin+'/phone/pair',{method:'POST',headers:{Origin:relay.origin,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(paired.status,200);await paired.text();
 const cookie=paired.headers.get('set-cookie').split(';')[0],boot=await (await fetch(relay.origin+'/api/bootstrap',{headers:{Cookie:cookie}})).json();
 const send=async body=>{const response=await fetch(relay.origin+'/api/command',{method:'POST',headers:{Cookie:cookie,Origin:relay.origin,'Content-Type':'application/json','X-Companion-Token':boot.token},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
 const local=observer.state(19),targets=[local.equipment[0],local.reserves.find(r=>r.id===19).poi[0]];assert.notEqual(targets[1].id,publicPoi.id,'PC and cloud positional IDs intentionally differ');
 for(const [i,p]of targets.entries()){const body={op:'place.rename',requestId:randomUUID(),id:p.renameId,label:'Phone name '+i},saved=await send(body);assert.equal(saved.status,200);assert.deepEqual(await send(body),saved);}
 const view=await (await fetch(relay.origin+'/api/state?reserve=19',{headers:{Cookie:cookie}})).json(),phonePoi=view.reserves.find(r=>r.id===19).poi.find(p=>p.id===publicPoi.id);
 assert.equal(view.equipment[0].label,'Phone name 0');assert.equal(view.equipment[0].originalLabel,'Tent');assert.equal(phonePoi.label,'Phone name 1');assert.equal(phonePoi.originalLabel,publicPoi.label);assert.equal(phonePoi.kind,publicPoi.kind);assert.equal(phonePoi.x,publicPoi.x);assert.equal(phonePoi.z,publicPoi.z);assert.equal(phonePoi.renameId,targets[1].renameId);assert.equal(phonePoi.canRename,true);
 assert.equal(store.journal(observer.profile,'placeLabels').length,2);assert.doesNotMatch(JSON.stringify(view),/saveLinkId|renameIdentityUnique|renameIdentityVersion/);
 const zone=observer.command({op:'zone.create',reserve:19,species:'Moose',x:1,z:2,need:'drinking',start:1,end:2});observer.command({op:'zone.annotate',zoneId:zone.id,strategy:'untouched',notes:'Current plan notes',name:'Old spot'});
 const renamedZone=await send({op:'zone.rename',requestId:randomUUID(),zoneId:zone.id,name:'Phone spot'});assert.equal(renamedZone.status,200);assert.equal(renamedZone.value.name,'Phone spot');assert.equal(renamedZone.value.strategy,'untouched');assert.equal(renamedZone.value.notes,'Current plan notes');
 const cleared=await send({op:'place.rename',requestId:randomUUID(),id:targets[1].renameId,label:''});assert.equal(cleared.status,200);assert.equal(cleared.value.label,'');assert.equal(observer.state(19).reserves.find(r=>r.id===19).poi[0].label,publicPoi.label);
});
