import test from 'node:test';
import assert from 'node:assert/strict';
import {planRoute,createRoutePlanner,MAX_OPTIMIZED_ROUTE_STOPS} from '../lib/route-planner.mjs';
const zone=(id,x,z,start=null,end=null)=>({id,x,z,start,end});

test('automatic distance ordering reduces backtracking, fixes the start and preserves every ID',()=>{
 const zones=Object.freeze([zone('a',0,0),zone('b',1000,0),zone('c',0,10),zone('d',1000,10)].map(Object.freeze)),route=Object.freeze(['a','b','c','d']);
 const planned=planRoute(route,zones);assert.deepEqual(planned.route,['a','c','d','b']);assert.equal(planned.routeOptimization.mode,'auto');assert.equal(planned.routeOptimization.status,'optimized_distance');assert.equal(planned.routeOptimization.startZoneId,'a');assert.equal(planned.routeOptimization.distanceMeters,1020);assert.ok(planned.routeOptimization.savedMeters>1900);assert.equal(planned.routeOptimization.usesHours,false);
 assert.deepEqual(planRoute(route,zones),planned,'the same saved facts yield the same route');assert.deepEqual(route,['a','b','c','d']);assert.deepEqual([...planned.route].sort(),[...route].sort());
 const chosen=planRoute(route,zones,{startZoneId:'b'});assert.equal(chosen.route[0],'b');assert.equal(chosen.routeOptimization.startZoneId,'b');
});

test('hour groups wrap midnight, retain a fixed start and distinguish already-open, all-day and unknown stops',()=>{
 const zones=[zone('night',0,0,22,2),zone('morning',1,0,6,10),zone('already-open',1000,0,20,23),zone('midnight',500,0,0,2),zone('late',400,0,23,24),zone('all-day',10,0,0,24),zone('closed-at-start',600,0,20,22),zone('unknown',1,1)];
 const result=planRoute(zones.map(p=>p.id),zones);assert.deepEqual(result.route,['night','all-day','already-open','late','midnight','morning','closed-at-start','unknown']);assert.equal(result.routeOptimization.usesHours,true);assert.equal(result.routeOptimization.unknownHoursCount,1);assert.equal(result.routeOptimization.status,'optimized_hours');
});

test('hours priority can report a longer distance without inventing a saving or arrival estimate',()=>{
 const zones=[zone('start',0,0,6,7),zone('near-late',1,0,20,21),zone('far-early',100,0,8,9)],result=planRoute(zones.map(p=>p.id),zones);
 assert.deepEqual(result.route,['start','far-early','near-late']);assert.equal(result.routeOptimization.originalDistanceMeters,100);assert.equal(result.routeOptimization.distanceMeters,199);assert.equal(result.routeOptimization.savedMeters,-99);assert.equal(result.routeOptimization.usesHours,true);assert.doesNotMatch(JSON.stringify(result),/speed|arrival|ETA/);
});

test('all-day or unknown starting hours use distance only; ambiguous equal hours remain unknown',()=>{
 for(const [start,end,unknown]of [[0,24,0],[null,null,1],[6,6,1],[24,0,1]]){
  const zones=[zone('first',0,0,start,end),zone('far',100,0,6,8),zone('near',1,0,20,22)],result=planRoute(['first','far','near'],zones);
  assert.deepEqual(result.route,['first','near','far']);assert.equal(result.routeOptimization.usesHours,false);assert.equal(result.routeOptimization.unknownHoursCount,unknown);
 }
});

test('missing, invalid and ambiguous coordinates keep the entire route unchanged with unknown distances',()=>{
 const route=['a','middle','b'];
 for(const middle of [null,zone('middle',null,0),zone('middle','5',0),zone('middle',Infinity,0),zone('middle',5,NaN)]){
  const zones=[zone('a',0,0),zone('b',10,0),...(middle?[middle]:[])],result=planRoute(route,zones,{startZoneId:'b'});
  assert.deepEqual(result.route,route);assert.equal(result.routeOptimization.status,'missing_coordinates');assert.equal(result.routeOptimization.missingCount,1);assert.equal(result.routeOptimization.distanceMeters,null);assert.equal(result.routeOptimization.originalDistanceMeters,null);assert.equal(result.routeOptimization.savedMeters,null);assert.equal(result.routeOptimization.startZoneId,'a');
 }
 const duplicateSource=planRoute(['a','b'],[zone('a',0,0),zone('b',1,0),zone('b',2,0)]);assert.deepEqual(duplicateSource.route,['a','b']);assert.equal(duplicateSource.routeOptimization.missingCount,1);
});

test('manual mode, repeated stops and bounded large routes preserve saved order and IDs',()=>{
 const zones=[zone('a',0,0),zone('b',1000,0),zone('c',1,0)],route=['a','b','c'];
 assert.deepEqual(planRoute(route,zones,{mode:'manual',version:7}),{route,routeOptimization:{mode:'manual',version:7,status:'manual',startZoneId:'a',savedMeters:0,distanceMeters:1999,originalDistanceMeters:1999,usesHours:false,missingCount:0,unknownHoursCount:3}});
 const repeated=['a','b','a','c'],duplicates=planRoute(repeated,zones);assert.deepEqual(duplicates.route,repeated);assert.equal(duplicates.routeOptimization.status,'duplicate_stops');assert.equal(duplicates.routeOptimization.distanceMeters,2001);
 const many=Array.from({length:MAX_OPTIMIZED_ROUTE_STOPS+1},(_,i)=>zone('z'+i,i%2?i*10:-i*10,i)),large=planRoute(many.map(p=>p.id),many);assert.equal(large.route.length,many.length);assert.deepEqual(large.route,many.map(p=>p.id));assert.equal(large.routeOptimization.status,'limited');assert.ok(Number.isFinite(large.routeOptimization.distanceMeters));
 assert.equal(planRoute([],[]).routeOptimization.status,'empty');assert.equal(planRoute(['a'],zones).routeOptimization.status,'single_stop');
});

test('the maximum optimized route stays deterministic and keeps every stop within bounded work',()=>{
 const zones=Array.from({length:MAX_OPTIMIZED_ROUTE_STOPS},(_,i)=>zone('z'+i,(i*7919)%10000,(i*1543)%10000)),route=zones.map(p=>p.id),result=planRoute(route,zones);
 assert.equal(result.route.length,route.length);assert.equal(new Set(result.route).size,route.length);assert.equal(result.route[0],route[0]);assert.ok(result.routeOptimization.distanceMeters<=result.routeOptimization.originalDistanceMeters);assert.deepEqual(planRoute(route,zones),result);
});

test('route cache ignores names and unrelated zones but refreshes after coordinates, hours and preferences change',()=>{
 let calls=0;const planner=createRoutePlanner({maxEntries:2,planner:(...args)=>{calls++;return planRoute(...args);}}),route=['a','b','c'],zones=[zone('a',0,0,6,10),zone('b',100,0,6,10),zone('c',1,0,6,10)],options={mode:'auto',version:1};
 const first=planner(route,zones,options);first.route.reverse();first.routeOptimization.version=999;
 const second=planner(route,zones.map(z=>({...z,name:'Different name'})),options);assert.equal(calls,1);assert.equal(second.route[0],'a');assert.equal(second.routeOptimization.version,1);
 planner(route,[...zones,zone('not-a-route-stop',999,999)],options);assert.equal(calls,1);
 const moved=zones.map(z=>z.id==='c'?{...z,x:200}:z);planner(route,moved,options);assert.equal(calls,2);
 const changedHours=moved.map(z=>z.id==='c'?{...z,start:20,end:22}:z);planner(route,changedHours,options);assert.equal(calls,3);
 planner(route,changedHours,{mode:'manual',version:2});assert.equal(calls,4);planner(route,zones,options);assert.equal(calls,5,'bounded cache evicts its oldest entry');
});
