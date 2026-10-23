/** Explicit phone projection for the retained zone ledger; never forward raw source records. */
const own=(value,names)=>Object.fromEntries(names.split(' ').filter(k=>Object.hasOwn(value??{},k)).flatMap(k=>{const v=value[k];return v===null||typeof v==='boolean'||typeof v==='string'&&v.length<=2000||typeof v==='number'&&Number.isFinite(v)?[[k,v]]:[];}));
const rows=(value,map,max=5000)=>{if(!Array.isArray(value))return [];if(value.length>max)throw Error('Zone view exceeds its item limit');return value.map(map);};
const counts=value=>Object.fromEntries(['harvests','unlinkedDeathReports','recordedEvents'].map(k=>[k,Number.isSafeInteger(value?.[k])&&value[k]>=0?value[k]:null]));
const species=value=>rows(value,r=>({...own(r,'species'),...counts(r)}),2000);
export function projectZoneTracking(value){return own(value,'active zoneId reserve name species startedAt stoppedAt version stopReason');}
export function projectZoneDiscovery(value,enabled,reserve){
  if(enabled!==true)return {status:'disabled',reserve};
  if(!value||value.reserve!==reserve)return {status:'reference_unavailable',reserve};
  const statuses=['loading','available','partial','population_unavailable','source_unavailable','reference_unavailable','reference_mismatch','selection_required'];
  const status=statuses.includes(value.status)?value.status:'reference_unavailable';
  const result={status,reserve};
  if(['available','partial'].includes(status)){
    for(const k of ['hiddenZones','unresolvedSlots','disabledSlots','ambiguousZones','omittedZones'])if(Number.isSafeInteger(value[k])&&value[k]>=0&&value[k]<=200000)result[k]=value[k];
    result.locationAccuracy='reference_area';
    if(typeof value.referenceFetchedAt==='string'&&Number.isFinite(Date.parse(value.referenceFetchedAt)))result.referenceFetchedAt=value.referenceFetchedAt;
    result.compatibility=value.compatibility==='discovered_schedules_matched'?'discovered_schedules_matched':'reference_assignment_only';
  }
  return result;
}
export function projectZoneData(value){
  if(value?.zoneLedgerVersion!==1)return {};
  const reserve=value.selectedReserve,ledger=value.zoneActivity;
  const history=rows((value.zoneHistory||[]).filter(r=>r?.reserve===reserve),r=>({
    ...own(r,'id reserve lastSeenAt removedAt eventCount notes'),
    status:['removed','source_unavailable','unrecorded','spoiler_hidden','reference_unavailable','scope_limited'].includes(r.status)?r.status:'source_unavailable',
    reason:['overpressure_reported','pressure_present','save_changed','unconfirmed'].includes(r.reason)?r.reason:'unconfirmed',
    evidence:['player_report','saved_pressure_overlap','save_comparison'].includes(r.evidence)?r.evidence:'save_comparison',
    snapshot:r.snapshot&&!['spoiler_hidden','reference_unavailable','scope_limited'].includes(r.status)?own(r.snapshot,'id reserve name x z start end need source species speciesKey groups males females'):null,
    pressure:r.pressure?own(r.pressure,'present savedAt'):null
  }));
  return {zoneLedgerVersion:1,zoneTracking:projectZoneTracking(value.zoneTracking),zoneHistory:history,zoneActivity:ledger?{
    ...counts(ledger),unassignedHarvests:Number.isSafeInteger(ledger.unassignedHarvests)&&ledger.unassignedHarvests>=0?ledger.unassignedHarvests:null,
    bySpecies:species(ledger.bySpecies),
    byZone:rows(ledger.byZone,r=>({...own(r,'zoneId'),...counts(r),bySpecies:species(r.bySpecies)})),
    byGrind:rows(ledger.byGrind,r=>({...own(r,'sessionId available'),...(r.available===true?{...counts(r),bySpecies:species(r.bySpecies)}:{})}),2000),
    ...(ledger.discovery?{discovery:projectZoneDiscovery(ledger.discovery,value.settings?.spoilers,reserve)}:{}),
    basis:'Saved harvests and unlinked death reports are separate. Zone locations are player-selected; missing animals are not kills.'
  }:null};
}
export function validateZonePhoneCommand(body){
  if(!['zone.track','zone.loss'].includes(body?.op))return false;
  const fields=body.op==='zone.track'?['op','requestId','reserve','zoneId','expectedVersion']:['op','requestId','reserve','zoneId','reason'];
  const id=v=>typeof v==='string'&&v.length>0&&v.length<=200;
  if(Object.keys(body).some(k=>!fields.includes(k))||!Number.isInteger(body.reserve)||body.reserve<0||body.reserve>999||typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId))throw Object.assign(Error('Invalid zone command'),{status:400});
  if(body.op==='zone.track'&&(body.zoneId!==null&&!id(body.zoneId)||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||body.expectedVersion>=Number.MAX_SAFE_INTEGER))throw Object.assign(Error('Current location-tracking version is required'),{status:400});
  if(body.op==='zone.loss'&&(!id(body.zoneId)||!['overpressure','unknown'].includes(body.reason)))throw Object.assign(Error('Choose a zone and an observed cause'),{status:400});
  return true;
}
export function projectZoneCommandResult(op,value){
  if(op==='zone.track')return projectZoneTracking(value);
  if(op==='zone.loss')return own(value,'zoneId reason evidence');
  throw Error('Unsupported zone command result');
}
