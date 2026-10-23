/** Player-owned zone history and explicit hunting-location attribution. Never writes game saves. */
import {createHash} from 'node:crypto';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validId=v=>typeof v==='string'&&v.length>0&&v.length<=200;
const validReserve=v=>Number.isInteger(v)&&v>=0&&v<=999;
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const key=(profile,id)=>'zone-history:'+digest([profile,id]);
const snapshotKeys='name id reserve zoneId scheduleIndex x z start end need localizationHash source species speciesKey speciesHash groups males females'.split(' ');
export function zoneSnapshot(zone){return Object.fromEntries(snapshotKeys.filter(k=>Object.hasOwn(zone,k)).map(k=>[k,zone[k]]));}

function attributionSnapshot(zone,at){
 if(!zone||!validId(zone.id)||!validReserve(zone.reserve)||!['save','player_report','population_path_reference'].includes(zone.source)||![zone.x,zone.z].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000))return null;
 return {id:zone.id,reserve:zone.reserve,x:zone.x,z:zone.z,source:zone.source,name:typeof (zone.annotation?.name||zone.name||zone.species)==='string'?String(zone.annotation?.name||zone.name||zone.species).slice(0,120):'Selected zone',capturedAt:instant(at)?at:null};
}
function selectedSnapshot(store,profile,tracking){
 const value=store.get('zone-tracking-location:'+profile,null);
 if(value?.version!==tracking.version||value?.zoneId!==tracking.zoneId||value?.reserve!==tracking.reserve)return null;
 return attributionSnapshot(value.snapshot,value.snapshot?.capturedAt);
}

/** Same minX/minZ, row-major raster mapping as HuntingPressureLayer. Nonzero is not a deletion threshold. */
export function pressureAtZone(zone,view){
 if(!zone||view?.status!=='available'||view.stale||view.reserve!==zone.reserve||view.width!==256||view.height!==256||!Array.isArray(view.values)||view.values.length!==65536||!Array.isArray(view.bounds)||view.bounds.length!==2||!view.bounds.every(p=>Array.isArray(p)&&p.length===2))return null;
 const [[minX,minZ],[maxX,maxZ]]=view.bounds;
 if(![minX,minZ,maxX,maxZ,zone.x,zone.z].every(Number.isFinite)||maxX<=minX||maxZ<=minZ||zone.x<minX||zone.x>maxX||zone.z<minZ||zone.z>maxZ)return null;
 const col=Math.min(255,Math.floor((zone.x-minX)/(maxX-minX)*256)),row=Math.min(255,Math.floor((zone.z-minZ)/(maxZ-minZ)*256)),value=view.values[row*256+col];
 return Number.isInteger(value)&&value>=0&&value<=255?{present:value>0,savedAt:instant(view.savedAt)?view.savedAt:null}:null;
}

/** Only a successfully parsed, explicitly included reserve snapshot can establish disappearance. */
export function rememberZones(store,profile,{zones,coveredReserves,savedAt,observedAt,sourceChanged=true,discontinuity=false,pressureFor=()=>null}={}){
 if(!Array.isArray(zones)||!Array.isArray(coveredReserves)||!coveredReserves.every(validReserve)||!instant(savedAt)||!instant(observedAt))fail('Invalid zone snapshot');
 const covered=new Set(coveredReserves),seen=new Set(),prior=new Map(store.journal(profile,'zoneHistory').map(r=>[r.zoneId,r]));
 for(const z of zones){if(!validId(z?.id)||!validReserve(z.reserve)||!covered.has(z.reserve)||seen.has(z.id))fail('Ambiguous zone snapshot');seen.add(z.id);}
 // Validate the entire input before the first write. Caller supplies the source transaction.
 for(const z of zones){
  const old=prior.get(z.id),older=old&&Date.parse(savedAt)<Date.parse(old.sourceSavedAt||old.lastSeenAt);
  if(older)continue;
  const returned=old?.state==='removed',eventCount=(old?.eventCount||0)+(returned?1:0);
  store.put(profile,'zoneHistory',{id:key(profile,z.id),zoneId:z.id,reserve:z.reserve,snapshot:zoneSnapshot(z),state:'active',firstSeenAt:old?.firstSeenAt||observedAt,lastSeenAt:savedAt,sourceSavedAt:savedAt,checkedAt:observedAt,eventCount,removedAt:null,reason:null,reportedReason:null,pressure:null,events:[...(old?.events||[]),...(returned?[{type:'rediscovered',at:observedAt}]:[])].slice(-50)});
 }
 if(!sourceChanged)return;
 for(const [id,old] of prior){
  if(seen.has(id)||!covered.has(old.reserve)||old.state!=='active'||Date.parse(savedAt)<Date.parse(old.sourceSavedAt||old.lastSeenAt))continue;
  const pressure=pressureAtZone(old.snapshot,pressureFor(old.reserve));
  const reason=discontinuity?'save_changed':pressure?.present?'pressure_present':'unconfirmed';
  store.put(profile,'zoneHistory',{...old,state:'removed',sourceSavedAt:savedAt,checkedAt:observedAt,removedAt:observedAt,reason,pressure,reportedReason:null,eventCount:(old.eventCount||0)+1,events:[...(old.events||[]),{type:'removed',at:observedAt,reason}].slice(-50)});
  const active=store.get('zone-tracking:'+profile,null);
  if(active?.zoneId===id&&active.active)store.set('zone-tracking:'+profile,{...active,active:false,version:active.version+1,stoppedAt:observedAt,stopReason:'zone_removed'});
 }
}

export function zoneHistoryView(store,profile,reserve,liveZones,sourceStatus='unavailable',route=[]){
 const live=new Set(liveZones.map(z=>z.id)),saved=new Map(store.journal(profile,'zoneHistory').filter(r=>r.reserve===reserve).map(r=>[r.zoneId,r]));
 const annotations=new Map(store.journal(profile,'annotations').map(a=>[a.zoneId,a]));
 const missing=new Set([...route.filter(id=>!live.has(id)),...Array.from(saved.values()).filter(r=>r.state==='removed').map(r=>r.zoneId)]);
 return Array.from(missing).map(id=>{
  const r=saved.get(id),available=sourceStatus==='ok',annotation=annotations.get(id);
  const snapshot=r?.snapshot?{...r.snapshot,...(annotation?.name?{name:annotation.name}:{})}:null;
  return {id,reserve,status:!available?'source_unavailable':r?.state==='removed'?'removed':'unrecorded',lastSeenAt:r?.lastSeenAt??null,removedAt:r?.removedAt??null,reason:r?.reportedReason?'overpressure_reported':r?.reason??'unconfirmed',evidence:r?.reportedReason?'player_report':r?.reason==='pressure_present'?'saved_pressure_overlap':'save_comparison',snapshot,notes:annotation?.notes??null,pressure:r?.pressure??null,eventCount:r?.eventCount??0};
 });
}

export function trackingState(store,profile){
 const v=store.get('zone-tracking:'+profile,null);
 return v&&Number.isSafeInteger(v.version)?{active:v.active===true,zoneId:v.zoneId,reserve:v.reserve,name:v.name,species:v.species,startedAt:v.startedAt,stoppedAt:v.stoppedAt??null,version:v.version,stopReason:v.stopReason??null}:{active:false,zoneId:null,reserve:null,name:null,species:null,startedAt:null,stoppedAt:null,version:0,stopReason:null};
}

export function zoneCommand(store,profile,body,{zones,route=[],sourceStatus='unavailable',now=new Date().toISOString()}={}){
 const fields=body.op==='zone.track'?['op','requestId','zoneId','reserve','expectedVersion']:body.op==='zone.loss'?['op','requestId','zoneId','reserve','reason']:null;
 if(!fields)return null;
 if(Object.keys(body).some(k=>!fields.includes(k))||!validReserve(body.reserve)||!instant(now))fail('Invalid zone action');
 if(body.op==='zone.track'){
  const previous=trackingState(store,profile);
  if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion!==previous.version||body.expectedVersion>=Number.MAX_SAFE_INTEGER)fail('Tracking changed. Refresh before choosing a zone.',409);
  if(body.zoneId===null){const value={...previous,active:false,version:previous.version+1,stopReason:'player_paused',stoppedAt:now};store.set('zone-tracking:'+profile,value);return trackingState(store,profile);}
  const z=zones.find(z=>z.id===body.zoneId&&z.reserve===body.reserve);
  if(!z||z.source==='save'&&sourceStatus!=='ok')fail('Choose a current zone from a readable save.',409);
  const value={active:true,zoneId:z.id,reserve:z.reserve,name:z.annotation?.name||z.species||'Selected zone',species:z.species||null,startedAt:now,version:previous.version+1,stopReason:null};
  store.set('zone-tracking:'+profile,value);
  store.set('zone-tracking-location:'+profile,{version:value.version,zoneId:value.zoneId,reserve:value.reserve,snapshot:attributionSnapshot(z,now)});
  return trackingState(store,profile);
 }
 if(!validId(body.zoneId)||!['overpressure','unknown'].includes(body.reason))fail('Choose an observed cause or leave it unknown.');
 if(sourceStatus!=='ok'||zones.some(z=>z.id===body.zoneId))fail('The zone must be absent from a readable save before recording its loss.',409);
 let old=store.journal(profile,'zoneHistory').find(r=>r.zoneId===body.zoneId&&r.reserve===body.reserve);
 if(!old&&!route.includes(body.zoneId))fail('This zone is not in your saved route history.',404);
 if(!old)old={id:key(profile,body.zoneId),zoneId:body.zoneId,reserve:body.reserve,snapshot:null,state:'removed',firstSeenAt:null,lastSeenAt:null,checkedAt:now,removedAt:null,reason:'unconfirmed',events:[],eventCount:0};
 store.put(profile,'zoneHistory',{...old,reportedReason:body.reason==='overpressure'?{type:'overpressure',at:now}:null});
 return {zoneId:body.zoneId,reason:body.reason==='overpressure'?'overpressure_reported':old.reason,evidence:body.reason==='overpressure'?'player_report':'save_comparison'};
}

/** Attribute only NEW observed receipts while a player deliberately tracks a zone on that reserve.
 * This is a player-selected location, not proof of the animal's exact kill coordinates. */
export function assignNewHarvests(store,profile,harvests,{currentReserve,sourceStatus,observedAt=new Date().toISOString(),tracking=null}={}){
 const current=trackingState(store,profile),active=tracking||current;
 const same=current.version===active.version&&current.zoneId===active.zoneId;
 const justRemoved=current.zoneId===active.zoneId&&current.version===active.version+1&&current.stopReason==='zone_removed';
 if((!same&&!justRemoved)||!active.active||!instant(active.startedAt)||sourceStatus!=='ok'||currentReserve!==active.reserve)return 0;
 let count=0;const old=new Set(store.journal(profile,'harvestZones').map(r=>r.harvestId));
 for(const h of harvests){
  if(!validId(h?.id)||old.has(h.id)||h.origin!=='observed'||!Number.isFinite(h.timestamp)||h.timestamp*1000<Date.parse(active.startedAt)||h.timestamp*1000>Date.parse(observedAt)||justRemoved&&h.timestamp*1000>Date.parse(current.stoppedAt))continue;
  store.put(profile,'harvestZones',{id:'harvest-zone:'+digest([profile,h.id]),harvestId:h.id,zoneId:active.zoneId,reserve:active.reserve,assignedAt:observedAt,basis:'player_selected_zone',trackingStartedAt:active.startedAt,snapshot:selectedSnapshot(store,profile,active)});old.add(h.id);count++;
 }
 return count;
}
export function bindEncounterZone(store,profile,encounter){
 const active=trackingState(store,profile);
 if(!active.active||encounter?.reserve!==active.reserve||!validId(encounter.id))return;
 const shot=encounter.evidence?.find(e=>e.type==='shot');
 if(!instant(shot?.observedAt)||Date.parse(shot.observedAt)<Date.parse(active.startedAt))return;
 store.put(profile,'encounterZones',{id:'encounter-zone:'+digest([profile,encounter.id]),encounterId:encounter.id,zoneId:active.zoneId,reserve:active.reserve,basis:'player_selected_zone',snapshot:selectedSnapshot(store,profile,active)});
}
const tally=()=>({harvests:0,unlinkedDeathReports:0,recordedEvents:0});
const add=(v,kind)=>{v[kind]++;v.recordedEvents++;};
function counterRows(events,key){const rows=new Map();for(const e of events){const id=key(e);if(id===null||id===undefined)continue;if(!rows.has(id))rows.set(id,{id,...tally()});add(rows.get(id),e.kind);}return [...rows.values()];}
const inWindows=(time,periods)=>Array.isArray(periods)&&periods.some(p=>time>=Date.parse(p.startedAt)&&(p.endedAt===null||time<Date.parse(p.endedAt)||p.endInclusive===true&&time===Date.parse(p.endedAt)));
export function activityLedger(store,profile,{harvests,encounters,sessionWindows=[],now=Date.now()}={}){
 const assignments=new Map(store.journal(profile,'harvestZones').map(r=>[r.harvestId,r])),encounterZones=new Map(store.journal(profile,'encounterZones').map(r=>[r.encounterId,r])),seen=new Set(),events=[];
 // An explicit linked receipt inherits its encounter's selected zone, never a nearest-zone guess.
 for(const e of encounters){const at=encounterZones.get(e.id);if(!at)continue;for(const v of e.evidence||[])if(v.type==='harvest_linked'&&validId(v.harvestId)&&!assignments.has(v.harvestId))assignments.set(v.harvestId,at);}
 for(const h of harvests){if(!validId(h.id)||seen.has(h.id))continue;seen.add(h.id);const at=assignments.get(h.id);events.push({id:h.id,kind:'harvests',species:h.species||'Unidentified animal',zoneId:at?.zoneId??null,reserve:at?.reserve??null,time:Number.isFinite(h.timestamp)?h.timestamp*1000:null});}
 const encounterSeen=new Set();
 for(const e of encounters){
  if(!validId(e.id)||encounterSeen.has(e.id))continue;encounterSeen.add(e.id);
  if((e.evidence||[]).some(v=>v.type==='harvest_linked'&&seen.has(v.harvestId)))continue;
  const ordered=(e.evidence||[]).filter(v=>['dead_observed','harvest_player','harvest_linked','alive_observed','unknown'].includes(v.type)&&instant(v.observedAt)).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||String(a.createdAt).localeCompare(String(b.createdAt)));
  const last=ordered.at(-1);if(!last||!['dead_observed','harvest_player'].includes(last.type)||Date.parse(last.observedAt)>now)continue;
  const at=encounterZones.get(e.id);events.push({id:e.id,kind:'unlinkedDeathReports',species:e.species||'Unidentified animal',zoneId:at?.zoneId??null,reserve:at?.reserve??e.reserve??null,time:Date.parse(last.observedAt)});
 }
 const summarize=rows=>{const total=tally();for(const e of rows)add(total,e.kind);return {...total,bySpecies:counterRows(rows,e=>e.species).map(({id,...rest})=>({species:id,...rest}))};};
 const byZone=counterRows(events,e=>e.zoneId).map(({id,...rest})=>({zoneId:id,...rest,bySpecies:summarize(events.filter(e=>e.zoneId===id)).bySpecies}));
 const byGrind=sessionWindows.map(s=>({sessionId:s.id,...(s.periods===null?{available:false}:{available:true,...summarize(events.filter(e=>Number.isFinite(e.time)&&e.time<=now&&inWindows(e.time,s.periods)))})}));
 return {...summarize(events),unassignedHarvests:events.filter(e=>e.kind==='harvests'&&!e.zoneId).length,byZone,byGrind,basis:'Saved harvests and unlinked death reports are separate, not an exact total kill count; zone locations are player-selected, not automatic GPS. Missing animals are not counted as kills.'};
}
