/** Read-only journal projection. Coordinates retain their evidence; a selected zone is not kill GPS. */
import {createHash} from 'node:crypto';
import {sessionPeriods} from './career.mjs';

export const LOCATION_SCHEMA='grindzone.hunt-locations.v1';
export const LOCATION_PAGE_MAX=100;
const validId=v=>typeof v==='string'&&v.length>0&&v.length<=200;
const text=(v,max=120)=>typeof v==='string'&&v.trim()&&v.length<=max?v:null;
const reserveId=v=>Number.isInteger(v)&&v>=0&&v<=999?v:null;
const point=v=>typeof v?.x==='number'&&typeof v?.z==='number'&&[v.x,v.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=100000);
const at=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const failure=(message,status=400)=>Object.assign(Error(message),{status});
const emptyLocation=(basis='unavailable')=>({basis,x:null,z:null,zoneId:null,zoneName:null,zoneStatus:null});
const periodsContain=(time,periods)=>Number.isFinite(time)&&periods.some(p=>time>=Date.parse(p.startedAt)&&(p.endedAt===null||time<Date.parse(p.endedAt)||p.endInclusive===true&&time===Date.parse(p.endedAt)));
const safeKind=new Set(['all','shot','death','harvest']);
const safePrecision=new Set(['all','point','zone','unknown']);
const queryKeys=new Set(['reserve','session','species','zone','kind','precision','offset','limit','revision']);

export function locationQuery(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw failure('Invalid location filters');
  if(Object.keys(input).some(k=>!queryKeys.has(k)))throw failure('Unsupported location filter');
  const result={reserve:'all',session:'active',species:null,zone:null,kind:'all',precision:'all',offset:0,limit:50,revision:null};
  for(const key of ['session','species','zone'])if(input[key]!=null&&input[key]!==''&&input[key]!=='all'){
    if(!text(input[key],key==='species'?120:200))throw failure('Invalid '+key+' filter');result[key]=input[key];
  }
  if(input.reserve!=null&&input.reserve!==''&&input.reserve!=='all'){
    if(!(typeof input.reserve==='number'||typeof input.reserve==='string'&&/^\d{1,3}$/.test(input.reserve)))throw failure('Invalid reserve');
    result.reserve=reserveId(Number(input.reserve));if(result.reserve===null)throw failure('Invalid reserve');
  }
  for(const [key,allowed] of [['kind',safeKind],['precision',safePrecision]])if(input[key]!=null){if(!allowed.has(input[key]))throw failure('Invalid '+key+' filter');result[key]=input[key];}
  for(const [key,min,max] of [['offset',0,1000000],['limit',1,LOCATION_PAGE_MAX]])if(input[key]!=null){
    if(!(typeof input[key]==='number'||typeof input[key]==='string'&&/^\d{1,7}$/.test(input[key])))throw failure('Invalid page');
    const n=Number(input[key]);if(!Number.isSafeInteger(n)||n<min||n>max)throw failure('Invalid page');result[key]=n;
  }
  if(input.revision!=null&&input.revision!==''){if(typeof input.revision!=='string'||!/^[a-f0-9]{64}$/.test(input.revision))throw failure('Invalid history revision');result.revision=input.revision;}
  return result;
}
export function locationSearchParams(params){
  const query=Object.create(null);for(const [key,value] of params){if(!queryKeys.has(key))throw failure('Unsupported location filter');if(Object.hasOwn(query,key))throw failure('Duplicate location filter');query[key]=value;}return locationQuery(query);
}

/** Duplicate/conflicting identities are withheld, never resolved by last-write-wins. */
function uniqueIndex(rows,key){
  const result=new Map(),conflicts=new Set();
  for(const row of rows){const id=row?.[key];if(!validId(id))continue;
    if(result.has(id)&&JSON.stringify(result.get(id))!==JSON.stringify(row))conflicts.add(id);else result.set(id,row);
  }
  for(const id of conflicts)result.delete(id);return {result,conflicts};
}
function locationSnapshot(value){
  if(!value||!validId(value.id)||reserveId(value.reserve)===null||!point(value)||!['save','player_report','population_path_reference'].includes(value.source))return null;
  return {id:value.id,reserve:value.reserve,x:value.x,z:value.z,source:value.source,name:text(value.name)||text(value.species)||'Selected zone',capturedAt:at(value.capturedAt)};
}
function indexAssignments(rows,identity){
  // A duplicated identical association is harmless. Metadata does not change location identity.
  return uniqueIndex(rows.filter(r=>validId(r?.[identity])&&validId(r.zoneId)&&reserveId(r.reserve)!==null)
    .map(r=>({[identity]:r[identity],zoneId:r.zoneId,reserve:r.reserve,snapshot:locationSnapshot(r.snapshot)})),identity);
}

export function buildLocationHistory({harvests=[],encounters=[],harvestZones=[],encounterZones=[],zones=[],zoneHistory=[],annotations=[],sessions=[],reserves=[],spoilers=false,sourceStatus='unavailable',zoneSourceStatus=sourceStatus,hiddenZoneIds=[],now=Date.now()}={},input={}){
  const query=locationQuery(input),events=[],invalid={harvests:0,evidence:0,associations:0};
  const harvestIndex=uniqueIndex(harvests,'id'),encounterIndex=uniqueIndex(encounters,'id');
  invalid.harvests=harvestIndex.conflicts.size;invalid.evidence=encounterIndex.conflicts.size;
  const ha=indexAssignments(harvestZones,'harvestId'),ea=indexAssignments(encounterZones,'encounterId');
  invalid.associations=ha.conflicts.size+ea.conflicts.size;
  const live=uniqueIndex(zones,'id'),past=uniqueIndex(zoneHistory,'zoneId'),notes=uniqueIndex(annotations,'zoneId');
  const names=new Map(reserves.filter(r=>reserveId(r?.id)!==null).map(r=>[r.id,text(r.name)||'Reserve '+r.id]));
  const speciesNames=new Map();
  for(const z of [...zones.filter(z=>z?.source==='save'),...zoneHistory.map(r=>r?.snapshot).filter(z=>z?.source==='save')])
    if(text(z.localizationHash,40)&&text(z.species)&&z.speciesKey)speciesNames.set(z.localizationHash,z.species);
  const speciesOf=h=>text(h.species)&&!/^Species(?: hash)? \d+$/.test(h.species)?h.species:speciesNames.get(h.speciesHash)||'Unidentified animal';
  const source=sourceStatus==='ok'?'current':'retained';
  function selectedZone(assignment){
    if(!assignment)return emptyLocation();
    if(spoilers!==true&&hiddenZoneIds.includes(assignment.zoneId)&&!live.result.has(assignment.zoneId))return emptyLocation('spoiler_hidden');
    const current=live.result.get(assignment.zoneId),history=past.result.get(assignment.zoneId);
    const captured=assignment.snapshot?.id===assignment.zoneId&&assignment.snapshot.reserve===assignment.reserve?assignment.snapshot:null;
    const z=captured||current||history?.snapshot;
    if(z?.reserve!==assignment.reserve)return emptyLocation();
    if(z.source==='population_path_reference'&&spoilers!==true&&current?.source!=='save')return emptyLocation('spoiler_hidden');
    // Hidden references are not put in zoneHistory. Missing selected references disclose no old name/point.
    if(!z||!point(z))return emptyLocation();
    const label=notes.result.get(assignment.zoneId)?.name||z.name||z.species||'Selected zone';
    return {basis:'player_selected_zone',x:z.x,z:z.z,zoneId:assignment.zoneId,zoneName:text(label)||'Selected zone',zoneStatus:history?.state==='removed'&&!current?'removed':zoneSourceStatus!=='ok'?'retained':'active',capturedAt:captured?.capturedAt??null};
  }
  function location(evidence,assignment){
    if(evidence&&['player_report','save_receipt_player_association'].includes(evidence.source)&&point(evidence)){
      // Never transplant the shot coordinates to a later death or pickup lacking its own coordinates.
      return {...selectedZone(assignment),basis:'reported_point',x:evidence.x,z:evidence.z};
    }
    return selectedZone(assignment);
  }
  const links=new Map();
  for(const e of encounterIndex.result.values())for(const v of Array.isArray(e.evidence)?e.evidence:[]){
    if(v?.type!=='harvest_linked'||!validId(v.harvestId))continue;
    if(!links.has(v.harvestId))links.set(v.harvestId,[]);
    links.get(v.harvestId).push({encounter:e,evidence:v});
  }
  for(const h of harvestIndex.result.values()){
    const time=typeof h.timestamp==='number'&&Number.isFinite(new Date(h.timestamp*1000).getTime())?new Date(h.timestamp*1000).toISOString():null;
    const linked=links.get(h.id)||[],one=linked.length===1?linked[0]:null;
    const assigned=ha.result.get(h.id),inherited=one?ea.result.get(one.encounter.id):null;
    const conflict=ha.conflicts.has(h.id)||linked.length>1||one&&ea.conflicts.has(one.encounter.id)||assigned&&inherited&&(assigned.zoneId!==inherited.zoneId||assigned.reserve!==inherited.reserve)||one&&assigned&&reserveId(one.encounter.reserve)!==null&&one.encounter.reserve!==assigned.reserve;
    const association=conflict?null:assigned||inherited;
    const reserve=conflict?null:association?.reserve??reserveId(one?.encounter?.reserve);
    const loc=conflict?emptyLocation('conflicting_association'):location(one?.evidence,association);
    events.push({id:'harvest:'+h.id,kind:'harvest',recordSource:'saved_harvest',harvestId:h.id,encounterId:one?.encounter?.id??null,time,species:speciesOf(h),score:typeof h.score==='number'&&Number.isFinite(h.score)?h.score:null,reserve,location:reserve===null?emptyLocation(conflict?'conflicting_association':loc.basis==='spoiler_hidden'?'spoiler_hidden':'unavailable'):loc});
  }
  for(const e of encounterIndex.result.values()){
    const rows=Array.isArray(e.evidence)?e.evidence:[],evidenceIndex=uniqueIndex(rows,'id');invalid.evidence+=evidenceIndex.conflicts.size;
    for(const v of evidenceIndex.result.values()){
      const kind=v.type==='shot'?'shot':v.type==='dead_observed'?'death':v.type==='harvest_player'?'harvest':null;
      if(!kind)continue;
      if(!['player_report','save_receipt_player_association'].includes(v.source)){invalid.evidence++;continue;}
      // A saved receipt already represents this encounter's harvest; do not count its report again.
      if(kind==='harvest'&&rows.some(x=>x?.type==='harvest_linked'&&harvestIndex.result.has(x.harvestId)))continue;
      const reserve=reserveId(e.reserve),assignment=ea.result.get(e.id);
      const conflict=ea.conflicts.has(e.id)||assignment&&assignment.reserve!==reserve;
      const loc=conflict?emptyLocation('conflicting_association'):location(v,assignment);
      events.push({id:kind+':'+e.id+':'+v.id,kind,recordSource:'player_report',harvestId:null,encounterId:e.id,time:at(v.observedAt),species:text(e.species)||'Unidentified animal',score:null,reserve,location:reserve===null?emptyLocation():loc});
    }
  }
  events.sort((a,b)=>(Date.parse(b.time)||0)-(Date.parse(a.time)||0)||a.id.localeCompare(b.id));
  const current=sessions.filter(s=>s.endedAt==null);
  const selected=query.session==='active'?current:[current.find(s=>s.id===query.session)].filter(Boolean);
  if(query.session!=='active'&&!selected.length){
    if(sessions.some(s=>s.id===query.session))throw failure('This grind is finished. Continue it to see its locations.',409);
    throw failure('This grind is no longer available. Refresh the tracker.',404);
  }
  if(!Number.isFinite(now))throw failure('Current observation time is unavailable.',503);
  const windows=selected.map(session=>{
    const periods=sessionPeriods(session);if(!periods)throw failure('This grind has an unavailable time history.',409);
    return {id:session.id,version:session.version??null,periods};
  });
  // One event appears once in the combined view, even when tracking windows overlap.
  const scope=events.filter(e=>Date.parse(e.time)<=now&&windows.some(s=>periodsContain(Date.parse(e.time),s.periods)));
  const facets={
    reserves:[...new Set(scope.map(e=>e.reserve).filter(r=>r!==null))].sort((a,b)=>a-b).map(id=>({id,name:names.get(id)||'Reserve '+id})),
    species:[...new Set(scope.map(e=>e.species))].sort(),
    zones:[...new Map(scope.filter(e=>e.location.zoneId).map(e=>[e.location.zoneId,{id:e.location.zoneId,name:e.location.zoneName,reserve:e.reserve}])).values()].sort((a,b)=>a.name.localeCompare(b.name))
  };
  facets.omittedZones=Math.max(0,facets.zones.length-500);facets.zones=facets.zones.slice(0,500);
  const filtered=scope.filter(e=>(query.reserve==='all'||e.reserve===query.reserve)&&(!query.species||e.species===query.species)&&(!query.zone||e.location.zoneId===query.zone)&&(query.kind==='all'||e.kind===query.kind)&&(query.precision==='all'||query.precision==='point'&&e.location.basis==='reported_point'||query.precision==='zone'&&e.location.basis==='player_selected_zone'||query.precision==='unknown'&&!point(e.location)));
  const revision=hash([filtered,sourceStatus,query.session,windows,spoilers===true]);
  if(query.offset&&query.revision!==revision)throw failure('History changed. Reload the first page before continuing.',409);
  const summary={total:filtered.length,shotsReported:0,deathsReported:0,savedHarvests:0,harvestsReported:0,reportedPoints:0,selectedZones:0,unknownLocations:0};
  for(const e of filtered){
    if(e.kind==='shot')summary.shotsReported++;else if(e.kind==='death')summary.deathsReported++;else if(e.recordSource==='saved_harvest')summary.savedHarvests++;else summary.harvestsReported++;
    if(e.location.basis==='reported_point')summary.reportedPoints++;else if(e.location.basis==='player_selected_zone')summary.selectedZones++;else summary.unknownLocations++;
  }
  const page=filtered.slice(query.offset,query.offset+query.limit).map(e=>({...e,reserveName:e.reserve===null?'Reserve not established':names.get(e.reserve)||'Reserve '+e.reserve}));
  return {schema:LOCATION_SCHEMA,revision,sourceStatus:source,query,scopeTotal:scope.length,journalEventTotal:scope.length,summary,facets,events:page,offset:query.offset,nextOffset:query.offset+page.length<filtered.length?query.offset+page.length:null,invalid,basis:'Events from current grinds only; paused intervals add none. Saved harvests plus player-reported shot, death and harvest observations are not a unique kill count. Zone attribution is not exact animal GPS.'};
}

export function readLocationHistory(observer,input={}){
  const store=observer.store,profile=observer.profile;
  // Read an existing journal only. No remote caller may supply a profile, path or account identity.
  const discovered=observer.source('found_need_zones_adf')?.payload||[];
  const settings=store.get('settings:'+profile,{spoilers:false});
  const zones=observer.describeZones(discovered).concat(store.journal(profile,'zones'));
  if(settings.spoilers===true){
    const reserves=new Set([...store.journal(profile,'harvestZones'),...store.journal(profile,'encounterZones')].map(r=>r.reserve));
    for(const reserve of reserves)zones.push(...observer.hiddenView(reserve).zones);
  }
  const status=observer.lastError?'error':store.sources(profile).find(r=>r.name==='hunting_log_adf')?.status;
  return buildLocationHistory({harvests:store.harvests(profile),encounters:store.journal(profile,'encounters'),harvestZones:store.journal(profile,'harvestZones'),encounterZones:store.journal(profile,'encounterZones'),zones,zoneHistory:store.journal(profile,'zoneHistory'),annotations:store.journal(profile,'annotations'),sessions:store.journal(profile,'sessions'),reserves:Object.values(observer.reference.reserves),spoilers:settings.spoilers===true,sourceStatus:status,zoneSourceStatus:observer.zoneSourceStatus(),hiddenZoneIds:store.get('zone-spoiler-selections:'+profile,[])},input);
}

/** Independent phone transport allowlist; never forwards an arbitrary callback's nested fields. */
export function projectLocationPage(value){
  const integer=v=>Number.isSafeInteger(v)&&v>=0?v:null;
  const identity=v=>typeof v==='string'&&v.length>0&&v.length<=500?v:null;
  if(value?.schema!==LOCATION_SCHEMA||!Array.isArray(value.events)||value.events.length>LOCATION_PAGE_MAX||typeof value.revision!=='string'||!/^[a-f0-9]{64}$/.test(value.revision))throw failure('Location history is unavailable.',503);
  const summary=Object.fromEntries(['total','shotsReported','deathsReported','savedHarvests','harvestsReported','reportedPoints','selectedZones','unknownLocations'].map(k=>[k,integer(value.summary?.[k])]));
  if(Object.values(summary).some(v=>v===null)||integer(value.offset)===null||value.nextOffset!==null&&integer(value.nextOffset)===null)throw failure('Location history counts are unavailable.',503);
  const events=value.events.map(row=>{
    if(!identity(row?.id)||!['shot','death','harvest'].includes(row.kind)||!['saved_harvest','player_report'].includes(row.recordSource))throw failure('Location record is unavailable.',503);
    const reserve=reserveId(row.reserve),raw=row.location;
    const allowed=['reported_point','player_selected_zone','unavailable','spoiler_hidden','conflicting_association'];
    const basis=allowed.includes(raw?.basis)?raw.basis:'unavailable';
    const mapped=reserve!==null&&['reported_point','player_selected_zone'].includes(basis)&&point(raw);
    return {id:row.id,kind:row.kind,recordSource:row.recordSource,harvestId:validId(row.harvestId)?row.harvestId:null,encounterId:validId(row.encounterId)?row.encounterId:null,time:at(row.time),species:text(row.species)||'Unidentified animal',score:typeof row.score==='number'&&Number.isFinite(row.score)?row.score:null,reserve,reserveName:text(row.reserveName)||'Reserve not established',location:{basis:mapped?basis:['reported_point','player_selected_zone'].includes(basis)?'unavailable':basis,x:mapped?raw.x:null,z:mapped?raw.z:null,zoneId:mapped&&validId(raw.zoneId)?raw.zoneId:null,zoneName:mapped?text(raw.zoneName):null,zoneStatus:mapped&&['active','removed','retained'].includes(raw.zoneStatus)?raw.zoneStatus:null,capturedAt:mapped?at(raw.capturedAt):null}};
  });
  const facets=value.facets||{};
  return {schema:LOCATION_SCHEMA,revision:value.revision,sourceStatus:value.sourceStatus==='current'?'current':'retained',query:locationQuery(value.query),scopeTotal:integer(value.scopeTotal),journalEventTotal:integer(value.journalEventTotal),summary,events,offset:value.offset,nextOffset:value.nextOffset,
    facets:{reserves:(Array.isArray(facets.reserves)?facets.reserves:[]).slice(0,1000).filter(r=>reserveId(r?.id)!==null).map(r=>({id:r.id,name:text(r.name)||'Reserve '+r.id})),species:(Array.isArray(facets.species)?facets.species:[]).slice(0,1000).filter(s=>text(s)),zones:(Array.isArray(facets.zones)?facets.zones:[]).slice(0,500).filter(z=>validId(z?.id)&&reserveId(z.reserve)!==null).map(z=>({id:z.id,name:text(z.name)||'Selected zone',reserve:z.reserve})),omittedZones:integer(facets.omittedZones)||0},
    invalid:Object.fromEntries(['harvests','evidence','associations'].map(k=>[k,integer(value.invalid?.[k])])),basis:'Saved harvests and player reports are distinct events, not a unique kill count. Zone attributions are not exact GPS.'};
}
