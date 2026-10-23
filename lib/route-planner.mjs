/** Deterministic ordering of saved stops. Distances are straight lines, never paths or ETAs. */
export const MAX_OPTIMIZED_ROUTE_STOPS=1000;
export const MAX_ROUTE_STOPS=5000;
const EPSILON=1e-7,MAX_REVERSAL_CHECKS=50000;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const length=stops=>stops.slice(1).reduce((sum,p,i)=>sum+distance(stops[i],p),0);

function hours(zone){
 const start=zone?.start,end=zone?.end;
 if(![start,end].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=24))return null;
 if(start===0&&end===24)return {start:0,duration:24,allDay:true};
 const duration=(end-start+24)%24;if(duration===0)return null;
 return {start:start%24,duration,allDay:false};
}
function openingGroup(schedule,anchor){
 if(!schedule)return Infinity;
 if(schedule.allDay||(anchor-schedule.start+24)%24<schedule.duration)return 0;
 return (schedule.start-anchor+24)%24;
}
function nearestGroup(group,from){
 const remaining=new Set(group),result=[];let current=from;
 while(remaining.size){let best=null,bestDistance=Infinity;
  for(const p of remaining){const d=distance(current,p);if(d<bestDistance-EPSILON||Math.abs(d-bestDistance)<=EPSILON&&(best===null||p.id<best.id)){best=p;bestDistance=d;}}
  result.push(best);remaining.delete(best);current=best;
 }
 return result;
}
function reduceBacktracking(stops,groups){
 const result=[...stops];let checks=0;
 for(let pass=0;pass<3;pass++){let changed=false;
  for(let i=1;i<result.length-1;i++)for(let j=i+1;j<result.length&&groups[i]===groups[j];j++){
   if(++checks>MAX_REVERSAL_CHECKS)return result;
   const before=distance(result[i-1],result[i])+(j+1<result.length?distance(result[j],result[j+1]):0);
   const after=distance(result[i-1],result[j])+(j+1<result.length?distance(result[i],result[j+1]):0);
   if(after<before-EPSILON){for(let a=i,b=j;a<b;a++,b--)[result[a],result[b]]=[result[b],result[a]];changed=true;}
  }
  if(!changed)break;
 }
 return result;
}

export function planRoute(route,zones,{mode='auto',startZoneId=null,version=1}={}){
 if(!Array.isArray(route)||!Array.isArray(zones))throw Error('Route and complete zones must be arrays');
 const actualMode=mode==='manual'?'manual':'auto',byId=new Map(),counts=new Map();
 for(const z of zones){if(!z||typeof z.id!=='string')continue;byId.set(z.id,z);counts.set(z.id,(counts.get(z.id)||0)+1);}
 const rows=route.map(id=>byId.get(id)),missingCount=rows.filter((z,i)=>!z||counts.get(route[i])!==1||!Number.isFinite(z.x)||!Number.isFinite(z.z)).length,unknownHoursCount=rows.filter(z=>hours(z)===null).length;
 const originalDistanceMeters=missingCount?null:length(rows),finiteDistance=originalDistanceMeters!==null&&Number.isFinite(originalDistanceMeters)?originalDistanceMeters:null;
 const base={mode:actualMode,version:Number.isSafeInteger(version)&&version>0?version:1,status:'unchanged',startZoneId:route[0]??null,savedMeters:finiteDistance===null?null:0,distanceMeters:finiteDistance,originalDistanceMeters:finiteDistance,usesHours:false,missingCount,unknownHoursCount};
 const unchanged=status=>({route:[...route],routeOptimization:{...base,status}});
 if(!route.length)return unchanged('empty');
 if(missingCount||finiteDistance===null)return unchanged('missing_coordinates');
 if(actualMode==='manual')return unchanged('manual');
 if(route.length>MAX_OPTIMIZED_ROUTE_STOPS)return unchanged('limited');
 if(new Set(route).size!==route.length)return unchanged('duplicate_stops');
 if(route.length===1)return unchanged('single_stop');
 const first=route.includes(startZoneId)?startZoneId:route[0],ordered=[byId.get(first),...rows.filter(z=>z.id!==first)],anchor=hours(ordered[0]),usesHours=!!anchor&&!anchor.allDay;
 const buckets=new Map();for(const p of ordered.slice(1)){const group=usesHours?openingGroup(hours(p),anchor.start):0;if(!buckets.has(group))buckets.set(group,[]);buckets.get(group).push(p);}
 const groups=[...buckets].sort(([a],[b])=>a-b),stable=[ordered[0]],nearest=[ordered[0]],groupIds=[-1];
 for(const [group,stops]of groups){stable.push(...stops);nearest.push(...nearestGroup(stops,nearest.at(-1)));groupIds.push(...stops.map(()=>group));}
 const stableImproved=reduceBacktracking(stable,groupIds),nearestImproved=reduceBacktracking(nearest,groupIds),stableDistance=length(stableImproved),nearestDistance=length(nearestImproved);
 let best=nearestDistance<stableDistance-EPSILON?nearestImproved:stableImproved,bestDistance=length(best);
 // Distance-only reordering never makes a fixed-start route longer.
 const fixedStartDistance=length(ordered);if(!usesHours&&bestDistance>=fixedStartDistance-EPSILON){best=ordered;bestDistance=fixedStartDistance;}
 const result=best.map(p=>p.id),changed=JSON.stringify(result)!==JSON.stringify(route);
 return {route:result,routeOptimization:{...base,status:changed?(usesHours?'optimized_hours':'optimized_distance'):'unchanged',startZoneId:first,savedMeters:finiteDistance-bestDistance,distanceMeters:bestDistance,usesHours}};
}

/** Cache only route-relevant source facts. Names, filters and UI state cannot affect ordering. */
export function createRoutePlanner({maxEntries=24,planner=planRoute}={}){
 if(!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>64)throw Error('Invalid route cache size');
 const cache=new Map();
 return (route,zones,options={})=>{
  const ids=new Set(route),facts=zones.filter(z=>z&&ids.has(z.id)).map(z=>[z.id,z.x,z.z,z.start,z.end]);
  const key=JSON.stringify([route,options.mode,options.startZoneId,options.version,facts]);let result=cache.get(key);
  if(!result){result=planner(route,zones,options);cache.set(key,result);while(cache.size>maxEntries)cache.delete(cache.keys().next().value);}
  else{cache.delete(key);cache.set(key,result);}
  return {route:[...result.route],routeOptimization:{...result.routeOptimization}};
 };
}
