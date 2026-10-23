import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../lib/store.mjs';
import {routeSetupState,routeSetupCommand} from '../lib/route-setup.mjs';
import {projectPhoneState,projectPhoneCommandResult,validatePhoneCommand} from '../lib/phone-bridge.mjs';
const original=globalThis.document;globalThis.document={documentElement:{dataset:{runtime:'local'}}};
const {routeSetupModel,setupView}=await import('../public/route-setup.js');
if(original===undefined)delete globalThis.document;else globalThis.document=original;
const state=()=>({route:['a','b'],zones:[{id:'a',reserve:19,x:100,z:100,species:'Moose'},{id:'b',reserve:19,x:200,z:200,species:'Moose'}],equipment:[],reserves:[{id:19,poi:[]}]});
const gear=(id,kind,x=150,z=150,extra={})=>({id,renameId:'saved:'+id,canRename:true,typeVerified:true,reserve:19,source:'save',kind,x,z,label:kind,originalLabel:kind,...extra});
const db=t=>{const s=new Store(':memory:');t.after(()=>s.db.close());return s;};

test('default setup budgets one tent and stand per distinct located stop',()=>{
 const s=state();s.route.push('a','missing');const p=routeSetupModel(s,19);
 assert.equal(p.knownCost,64000);assert.equal(p.unknownCosts,0);assert.equal(p.missingStops,1);
 assert.deepEqual(p.purchase.map(p=>[p.item,p.count]),[['tent',2],['tripod',2]]);
});
test('one shared nearby stand is counted once and unverified items do not create free setups',()=>{
 const s=state();s.equipment=[gear('one','tripod'),gear('unknown','tent',140,140,{typeVerified:false}),gear('ambiguous','tent',150,150,{canRename:false})];
 const p=routeSetupModel(s,19);assert.equal(p.uniqueNearbyGear,1);assert.equal(p.knownCost,32000);
 assert.ok(p.rows.every(r=>r.slots.find(s=>s.name==='stand').status==='nearby'));
 assert.ok(p.rows.every(r=>r.slots.find(s=>s.name==='tent').status==='needed'));
});
test('custom feeder labels cannot change the verified feeder type',()=>{
 const s=state();s.route=['a'];s.routeSetup={stops:[{zoneId:'a',feeder:'auto',feederType:'bait_barrel'}]};
 s.equipment=[gear('box','feeder',150,150,{label:'BAIT BARREL',originalLabel:'BOX FEEDER'})];
 const p=routeSetupModel(s,19);assert.equal(p.unknownCosts,1);assert.equal(p.rows[0].slots[2].status,'needed');
 s.equipment[0].originalLabel='BAIT BARREL';const confirmed=routeSetupModel(s,19);assert.equal(confirmed.unknownCosts,0);assert.equal(confirmed.rows[0].slots[2].status,'nearby');
});
test('reference structures require confirmed build state or an explicitly unknown cost',()=>{
 const s=state();s.route=['a'];s.reserves[0].poi=[{id:'old-index',renameId:'stable-place',canRename:true,kind:'hunting_blind',x:120,z:120}];
 s.routeSetup={stops:[{zoneId:'a',stand:'structure',structureId:'stable-place'}]};
 let p=routeSetupModel(s,19);assert.equal(p.knownCost,16000);assert.equal(p.unknownCosts,1);
 s.reserves[0].poi[0].id='new-index';s.routeSetup.stops[0].structureBuilt=true;
 p=routeSetupModel(s,19);assert.equal(p.unknownCosts,0);assert.equal(p.rows[0].slots[1].status,'built');
});
test('user-owned plans and explicit zero prices differ from missing estimates',()=>{
 const s=state();s.route=['a'];s.routeSetup={stops:[{zoneId:'a',tent:'bring',stand:'none',feeder:'buy',feederType:'box'}],prices:[{item:'box',price:0}]};
 assert.equal(routeSetupModel(s,19).knownCost,0);assert.equal(routeSetupModel(s,19).unknownCosts,0);
 s.routeSetup.prices[0].price=null;assert.equal(routeSetupModel(s,19).unknownCosts,1);
});
test('shared structure costs are charged once and conflicting plans stay unknown',()=>{
 const s=state();s.reserves[0].poi=[{id:'reference',renameId:'stable-h',canRename:true,kind:'hunting_blind',x:150,z:150}];
 s.routeSetup={stops:s.route.map(zoneId=>({zoneId,tent:'none',stand:'structure',structureId:'stable-h',structureBuilt:false,structureCost:4000}))};
 let p=routeSetupModel(s,19);assert.equal(p.knownCost,4000);assert.equal(p.unknownCosts,0);
 s.routeSetup.stops[1].structureCost=5000;p=routeSetupModel(s,19);
 assert.equal(p.knownCost,0);assert.equal(p.unknownCosts,1);assert.equal(p.structureConflicts,1);
 assert.ok(p.rows.every(r=>r.slots[1].status==='conflicting_structure'));
 s.routeSetup.stops[1].structureCost=4000;s.routeSetup.stops[1].structureBuilt=true;
 p=routeSetupModel(s,19);assert.equal(p.unknownCosts,1);assert.match(setupView(s,19),/Shared structure plans disagree/);
 s.routeSetup.stops[0].structureBuilt=true;p=routeSetupModel(s,19);assert.equal(p.knownCost,0);assert.equal(p.unknownCosts,0);
});
test('feeder spacing uses actual shared saved placements when available',()=>{
 const s=state();s.routeSetup={stops:s.route.map(zoneId=>({zoneId,feeder:'auto',feederType:'box'}))};
 s.equipment=[gear('shared','feeder',150,150,{originalLabel:'BOX FEEDER'})];
 assert.deepEqual(routeSetupModel(s,19).feederConflicts,[]);
 s.equipment=[];assert.deepEqual(routeSetupModel(s,19).feederConflicts,[[1,2]]);
});
test('setup changes persist by profile/reserve and stale versions cannot overwrite them',t=>{
 const store=db(t),context={route:['a'],structures:[]},body={op:'route.setup',reserve:19,zoneId:'a',version:0,tent:'bring'};
 const saved=routeSetupCommand(store,'p',body,context);assert.equal(saved.version,1);
 assert.equal(routeSetupState(store,'p',19).stops[0].tent,'bring');assert.equal(routeSetupState(store,'other',19).stops.length,0);assert.equal(routeSetupState(store,'p',18).stops.length,0);
 assert.throws(()=>routeSetupCommand(store,'p',{...body,tent:'none'},context),e=>e.status===409);
 assert.throws(()=>routeSetupCommand(store,'p',{...body,zoneId:'removed'},context),e=>e.status===400);
});
test('budget update is atomic and rejects unsupported prices and invalid feeder plans',t=>{
 const store=db(t),context={route:['a'],structures:[]};
 assert.throws(()=>routeSetupCommand(store,'p',{op:'route.budget',reserve:19,version:0,nearbyMeters:10,item:'tent',price:1},context));
 assert.deepEqual(routeSetupState(store,'p',19).prices,[]);
 const result=routeSetupCommand(store,'p',{op:'route.budget',reserve:19,version:0,nearbyMeters:250,item:'tent',price:15000},context);
 assert.deepEqual(result,{version:1,nearbyMeters:250,prices:[{item:'tent',price:15000}]});
 assert.throws(()=>routeSetupCommand(store,'p',{op:'route.setup',reserve:19,zoneId:'a',version:0,feeder:'buy'},context),/feeder type/);
});
test('paired phone projection includes only the equipment planning presentation fields',()=>{
 const s=state();s.selectedReserve=19;s.routeSetup={version:2,nearbyMeters:300,privateData:'do-not-send',prices:[{item:'tent',price:null,secret:'do-not-send'}],stops:[{zoneId:'a',reserve:19,version:1,tent:'bring',privateData:'do-not-send'}]};
 const projected=projectPhoneState(s);assert.equal(projected.routeSetup.stops[0].tent,'bring');assert.doesNotMatch(JSON.stringify(projected),/do-not-send/);
 const body={op:'route.budget',requestId:'setup-test-request',reserve:19,version:2,nearbyMeters:300,item:'tent',price:16000};assert.doesNotThrow(()=>validatePhoneCommand(body));
 assert.throws(()=>validatePhoneCommand({...body,secret:'unexpected'}));assert.deepEqual(projectPhoneCommandResult('route.setup',{zoneId:'a',version:1,secret:'hidden'}),{zoneId:'a',version:1});
});
test('setup names are escaped and missing prices are visible in the budget',()=>{
 const s=state();s.zones[0].annotation={name:'<img src=x onerror=bad>'};s.routeSetup={stops:[{zoneId:'a',feeder:'buy',feederType:'box'}]};const html=setupView(s,19);
 assert.doesNotMatch(html,/<img/);assert.match(html,/prices needed/);assert.match(html,/Set up stop 1/);
});
