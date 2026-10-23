import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionHarvestSummary} from '../lib/career.mjs';
import {projectPhoneState} from '../lib/phone-bridge.mjs';

test('finished grind totals retain more than 500 receipts when the browser window moves',()=>{
 const session={id:'sample-session',startedAt:new Date(1000000).toISOString(),endedAt:new Date(2000000).toISOString()};
 const receipts=Array.from({length:650},(_,i)=>({timestamp:1001+i,species:i%2?'Moose':'Whitetail Deer'}));
 const later=Array.from({length:600},(_,i)=>({timestamp:3000+i,species:'Gray Wolf'}));
 const summary=sessionHarvestSummary(session,[...later,...receipts]);
 assert.equal(summary.total,650);assert.deepEqual(summary.bySpecies,[{species:'Whitetail Deer',count:325},{species:'Moose',count:325}]);
 const phone=projectPhoneState({sessions:[{...session,harvestSummary:summary}],harvests:later.slice(0,500)});
 assert.deepEqual(phone.sessions[0].harvestSummary,summary);assert.equal(phone.harvests.length,500);
});

test('invalid windows remain unavailable; real zero and boundaries are preserved',()=>{
 assert.equal(sessionHarvestSummary({startedAt:'invalid'},[]),null);
 const session={startedAt:new Date(1000000).toISOString(),endedAt:new Date(2000000).toISOString()};
 assert.equal(sessionHarvestSummary(session,[]).total,0);
 assert.equal(sessionHarvestSummary(session,[{timestamp:999,species:'Moose'},{timestamp:1000,species:'Moose'},{timestamp:2000,species:'Moose'},{timestamp:2001,species:'Moose'}]).total,2);
});

const iso=seconds=>new Date(seconds*1000).toISOString();
const receipt=(id,timestamp,species='Moose',score=null)=>({id,timestamp,species,score});

test('explicit runs exclude pause gaps and end boundaries using saved time, with target-only scores',()=>{
 const session={startedAt:iso(1000),endedAt:iso(1060),targetSpecies:'Moose',periods:[{startedAt:iso(1000),endedAt:iso(1020)},{startedAt:iso(1040),endedAt:iso(1060)}]};
 const receipts=[receipt('before',999),receipt('first',1001,'Moose',100),receipt('pause',1020,'Moose',900),receipt('gap',1030,'Moose',999),receipt('resume',1040,'Moose',0),receipt('other',1041,'Whitetail Deer',999),receipt('missing-score',1050,'Moose'),receipt('finish',1060,'Moose',999)];
 receipts[1].firstSeen=iso(9999);
 const summary=sessionHarvestSummary(session,receipts);
 assert.equal(summary.total,4);assert.equal(summary.targetTotal,3);assert.equal(summary.bestScore,100);assert.equal(summary.averageScore,50);
 assert.equal(summary.activeSeconds,40);assert.equal(summary.runs,2);assert.equal(summary.lastHarvestAt,iso(1050));
 assert.deepEqual(summary.recent.map(h=>h.id),['missing-score','resume','first']);
 assert.equal(sessionHarvestSummary({...session,targetSpecies:'moose'},receipts).targetTotal,0,'species names match exactly');
 const all=sessionHarvestSummary({...session,targetSpecies:null},receipts);assert.equal(all.targetTotal,4);assert.equal(all.bestScore,null);assert.equal(all.averageScore,null);
});

test('overlapping windows and duplicate receipt IDs count once before selecting recent six',()=>{
 const session={startedAt:iso(1000),endedAt:iso(1040),targetSpecies:'Moose',periods:[{startedAt:iso(1000),endedAt:iso(1030)},{startedAt:iso(1020),endedAt:iso(1040)}]};
 const receipts=Array.from({length:12},(_,i)=>receipt('receipt-'+i,1020+i,'Moose',i));
 const summary=sessionHarvestSummary(session,[...receipts,...receipts]);
 assert.equal(summary.total,12);assert.equal(summary.targetTotal,12);assert.equal(summary.activeSeconds,40);assert.equal(summary.runs,2);
 assert.deepEqual(summary.recent.map(h=>h.id),[11,10,9,8,7,6].map(i=>'receipt-'+i));assert.equal(summary.averageScore,5.5);
});

test('missing or malformed periods and timestamps remain unknown instead of inventing zero',()=>{
 const session={startedAt:iso(1000),endedAt:iso(1040)};
 for(const candidate of [{}, {...session,startedAt:1000},{...session,startedAt:'2026-02-30T00:00:00Z'},{...session,endedAt:''},{...session,periods:null},{...session,periods:[]},{...session,periods:[{endedAt:iso(1040)}]},{...session,periods:[{startedAt:iso(1000)}]},{...session,periods:[{startedAt:iso(1040),endedAt:iso(1000)}]},{...session,periods:[{startedAt:iso(1000),endedAt:null}]}])assert.equal(sessionHarvestSummary(candidate,[]),null,JSON.stringify(candidate));
 const summary=sessionHarvestSummary(session,[receipt('nan',NaN),receipt('infinity',Infinity),receipt('overflow',1e20),receipt('string','1020'),receipt('null',null),receipt('valid',1020)]);
 assert.equal(summary.total,1);assert.equal(summary.targetTotal,1);
 const empty=sessionHarvestSummary({...session,targetSpecies:'Moose'},[]);assert.equal(empty.targetTotal,0);assert.equal(empty.bestScore,null);assert.equal(empty.averageScore,null);assert.equal(empty.lastHarvestAt,null);
});

test('running tracked time is wall time, while a paused grind stops accumulating time',()=>{
 const running={startedAt:iso(1000),endedAt:null,pausedAt:null,periods:[{startedAt:iso(1000),endedAt:null}]};
 assert.equal(sessionHarvestSummary(running,[],1100000).activeSeconds,100);
 const paused={...running,pausedAt:iso(1020),periods:[{startedAt:iso(1000),endedAt:iso(1020)}]};
 assert.equal(sessionHarvestSummary(paused,[],1100000).activeSeconds,20);assert.equal(sessionHarvestSummary(paused,[],2000000).activeSeconds,20);
});

test('a target summary keeps its full journal scope even with more than 500 later browser receipts',()=>{
 const session={startedAt:iso(1000),endedAt:iso(2000),targetSpecies:'Moose',periods:[{startedAt:iso(1000),endedAt:iso(2000)}]};
 const full=Array.from({length:650},(_,i)=>receipt('old-'+i,1001+i,i%2?'Moose':'Whitetail Deer',i));
 const later=Array.from({length:700},(_,i)=>receipt('new-'+i,3000+i,'Moose',9999));
 const summary=sessionHarvestSummary(session,[...later,...full]);
 assert.equal(summary.total,650);assert.equal(summary.targetTotal,325);assert.equal(summary.bestScore,649);assert.equal(summary.averageScore,325);
 const phone=projectPhoneState({sessions:[{...session,harvestSummary:summary}],harvests:later.slice(-500)});
 assert.deepEqual(phone.sessions[0].harvestSummary,summary);assert.equal(phone.harvests.length,500);assert.equal(Object.hasOwn(phone.sessions[0],'periods'),false);
});
