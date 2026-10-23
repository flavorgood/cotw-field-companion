import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionHarvestSummary} from '../lib/career.mjs';
import {projectPhoneState,projectPhoneCommandResult,projectPhoneExport} from '../lib/phone-bridge.mjs';

const iso=seconds=>new Date(seconds*1000).toISOString();
const receipt=(id,timestamp,species='Moose',score=null)=>({id,timestamp,species,score});
const ids=rows=>rows.map(row=>row.id);
const session={id:'activity-session',startedAt:iso(1000),endedAt:iso(2000),targetSpecies:'Moose',periods:[{startedAt:iso(1000),endedAt:iso(2000)}]};

test('activity caps each filter after the complete journal rather than the latest500 browser receipts',()=>{
 const retained=Array.from({length:700},(_,i)=>receipt('old-'+String(i).padStart(3,'0'),1001+i,i%2?'Moose':'Whitetail Deer',i));
 const later=Array.from({length:600},(_,i)=>receipt('later-'+i,3001+i,'Gray Wolf',9999));
 const summary=sessionHarvestSummary(session,[...later,...retained]);
 assert.equal(summary.total,700);assert.equal(summary.targetTotal,350);assert.deepEqual(summary.bySpecies,[{species:'Whitetail Deer',count:350},{species:'Moose',count:350}]);
 assert.deepEqual(ids(summary.activity.all),retained.slice(-20).reverse().map(h=>h.id));
 assert.deepEqual(ids(summary.activity.target),retained.filter(h=>h.species==='Moose').slice(-20).reverse().map(h=>h.id));
 assert.deepEqual(ids(summary.activity.other),retained.filter(h=>h.species!=='Moose').slice(-20).reverse().map(h=>h.id));
 assert.equal(summary.activity.all.filter(h=>h.species==='Moose').length,10);assert.equal(summary.activity.target.length,20,'each filter keeps its own20 even when only10 appear in All');
 assert.deepEqual(summary.recent,summary.activity.target.slice(0,6));assert.equal(summary.bestScore,699);assert.ok(Math.abs(summary.averageScore-350)<1e-9);
 const phone=projectPhoneState({sessions:[{...session,harvestSummary:summary}],harvests:later.slice(0,500)});assert.deepEqual(phone.sessions[0].harvestSummary,summary);assert.equal(phone.harvests.length,500);
});

test('activity uses the period union and receipt dedupe, excluding paused, finished and invalid records',()=>{
 const split={...session,endedAt:iso(1150),periods:[{startedAt:iso(1000),endedAt:iso(1050)},{startedAt:iso(1100),endedAt:iso(1150)},{startedAt:iso(1120),endedAt:iso(1140)}]};
 const target=receipt('target',1125,'Moose',20),other=receipt('other',1130,'Gray Wolf',30),records=[receipt('before',999),receipt('first',1000),receipt('pause-boundary',1050),receipt('pause-gap',1080),receipt('resume-boundary',1100,'Whitetail Deer'),target,other,target,other,receipt('end',1150),receipt('after',1160),receipt('bad',NaN),receipt('string','1135')];
 const summary=sessionHarvestSummary(split,records);assert.equal(summary.total,4);assert.equal(summary.targetTotal,2);assert.deepEqual(ids(summary.activity.all),['other','target','resume-boundary','first']);assert.deepEqual(ids(summary.activity.target),['target','first']);assert.deepEqual(ids(summary.activity.other),['other','resume-boundary']);
 const targetIds=new Set(ids(summary.activity.target));assert.ok(summary.activity.other.every(h=>!targetIds.has(h.id)));assert.equal(new Set(ids(summary.activity.all)).size,4);
});

test('late-arriving older receipts are inserted by saved time without displacing newer activity',()=>{
 const early=[receipt('newer',1900,'Moose',100),receipt('newest',1950,'Gray Wolf',50)],late={...receipt('late-arrival',1200,'Moose',25),firstSeen:iso(3000)};
 const before=sessionHarvestSummary(session,early),after=sessionHarvestSummary(session,[late,...early]);
 assert.equal(after.total,before.total+1);assert.equal(after.targetTotal,before.targetTotal+1);assert.deepEqual(ids(after.activity.all),['newest','newer','late-arrival']);assert.deepEqual(ids(after.activity.target),['newer','late-arrival']);assert.equal(after.lastHarvestAt,iso(1900));
 const many=Array.from({length:25},(_,i)=>receipt('new-'+i,1500+i));const capped=sessionHarvestSummary(session,[late,...many]);assert.equal(capped.total,26);assert.equal(capped.activity.all.length,20);assert.equal(capped.activity.all.some(h=>h.id===late.id),false);
});

test('activity ordering is deterministic by timestamp and ID even when source order changes',()=>{
 const records=[receipt('z',1500,'Moose',5),receipt('a',1500,'Gray Wolf',6),receipt('A',1500,'Moose',7),receipt('latest',1600,'Moose',8)];
 const a=sessionHarvestSummary(session,records),b=sessionHarvestSummary(session,[...records].reverse());assert.deepEqual(a.activity,b.activity);assert.deepEqual(ids(a.activity.all),['latest','A','a','z']);
});

test('unknown species remain unresolved and count as unmatched, with no medal inference',()=>{
 const unresolved={...receipt('unresolved',1300,'Species hash 12345',Infinity),medalCode:3,medal:'DIAMOND',sex:'male',reserve:19,raw:{private:'PRIVATE_RAW'}};
 const missingName=receipt('missing-name',1350,null,0),known=receipt('known',1400,'Moose',15),summary=sessionHarvestSummary(session,[unresolved,missingName,known]);
 assert.equal(summary.total,3);assert.equal(summary.targetTotal,1);assert.deepEqual(summary.activity.other,[{id:'missing-name',species:null,score:0,timestamp:1350},{id:'unresolved',species:'Species hash 12345',score:null,timestamp:1300}]);
 assert.deepEqual(summary.activity.target,[known]);assert.ok(summary.activity.all.every(row=>Object.keys(row).sort().join(',')==='id,score,species,timestamp'));assert.doesNotMatch(JSON.stringify(summary.activity),/medal|DIAMOND|male|reserve|PRIVATE_/);
});

test('untargeted grinds have All activity and preserve the legacy recent6 meaning',()=>{
 const untargeted={...session,targetSpecies:null},records=Array.from({length:35},(_,i)=>receipt('receipt-'+i,1200+i,i%2?'Moose':'Whitetail Deer',i)),summary=sessionHarvestSummary(untargeted,records);
 assert.equal(summary.total,35);assert.equal(summary.targetTotal,35);assert.equal(summary.activity.all.length,20);assert.deepEqual(summary.activity.target,[]);assert.deepEqual(summary.activity.other,[]);assert.deepEqual(summary.recent,summary.activity.all.slice(0,6));assert.equal(summary.bestScore,null);assert.equal(summary.averageScore,null);
 const empty=sessionHarvestSummary(untargeted,[]);assert.deepEqual(empty.activity,{all:[],target:[],other:[]});assert.equal(empty.total,0);
});

test('activity preserves inclusive legacy cutoffs and unavailable malformed session windows',()=>{
 const legacy={id:'legacy',startedAt:iso(1000),endedAt:iso(1100),targetSpecies:'Moose'},records=[receipt('start',1000),receipt('end',1100,'Gray Wolf')],summary=sessionHarvestSummary(legacy,records);
 assert.deepEqual(ids(summary.activity.all),['end','start']);assert.deepEqual(ids(summary.activity.target),['start']);assert.deepEqual(ids(summary.activity.other),['end']);
 assert.equal(sessionHarvestSummary({...legacy,startedAt:'invalid'},records),null);
});

test('phone activity is allowlisted, independently capped, and distinct from missing legacy data',()=>{
 const clean=sessionHarvestSummary(session,[receipt('saved',1200)]),dirty={...clean,activity:{all:[{...clean.activity.all[0],raw:'PRIVATE_RAW',medalCode:4,firstSeen:iso(3000)}],target:[{...clean.activity.target[0],sourcePath:'PRIVATE_PATH'}],other:[],private:'PRIVATE_ACTIVITY'}};
 const value={sessions:[{...session,harvestSummary:dirty}]},projected=projectPhoneState(value).sessions[0].harvestSummary;assert.deepEqual(projected,clean);assert.doesNotMatch(JSON.stringify(projected),/PRIVATE_|medal|firstSeen/);
 assert.deepEqual(projectPhoneCommandResult('session.update',{...session,harvestSummary:dirty}).harvestSummary.activity,clean.activity);assert.deepEqual(projectPhoneExport(value).sessions[0].harvestSummary.activity,clean.activity);
 const {activity,...legacy}=clean;assert.equal(Object.hasOwn(projectPhoneState({sessions:[{...session,harvestSummary:legacy}]}).sessions[0].harvestSummary,'activity'),false);
 for(const unavailable of [null,undefined,{},[],{all:[],target:[]},{all:[],target:null,other:[]}])assert.equal(projectPhoneState({sessions:[{...session,harvestSummary:{...legacy,activity:unavailable}}]}).sessions[0].harvestSummary.activity,null);
 for(const key of ['all','target','other']){
  const oversized={...activity,[key]:Array(21).fill(receipt('id',1200))};assert.throws(()=>projectPhoneState({sessions:[{...session,harvestSummary:{...clean,activity:oversized}}]}),/item limit/);
  assert.throws(()=>projectPhoneCommandResult('session.update',{...session,harvestSummary:{...clean,activity:oversized}}),/item limit/);
 }
});
