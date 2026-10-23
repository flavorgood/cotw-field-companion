import {recoverHerdSnapshots} from './herd-ledger.mjs';
import {readHerdView} from './herd-view.mjs';
import {loadHerdReference} from './herd-reference.mjs';
import {readLocationHistory} from './hunt-locations.mjs';
/** The canonical save observer plus opt-in public zone-reference enrichment. One parser, one journal. */
import {observerSaveData} from './save-data.mjs';
import {Observer as SaveObserver} from './save-observer.mjs';
import {ZoneReferenceReader} from './zone-reference.mjs';
import {undiscoveredZoneView} from './zone-discovery.mjs';
import {trackingState} from './zone-ledger.mjs';
export {allowedName,inside,stableRead,normalizeFile} from './save-observer.mjs';
const hidden=z=>z?.source==='population_path_reference';
export class Observer extends SaveObserver{
 constructor(store,root,reference,options={}){super(store,root,reference,options);this.herdReference=options.herdReference??loadHerdReference();this.zoneReference=options.zoneReferenceReader||new ZoneReferenceReader(store,options.zoneReferenceOptions);}
 async scan(force=false){
  if(this.busy||this.stopped||!this.root)return;
  // Cached populations may predate herd IDs or outlive unavailable game files.
  // Recovery uses the original saved time and source identity, never a new sighting.
  this.herdRecoveryFailures=recoverHerdSnapshots(this);
  return super.scan(force);
 }
 herdView(query){return readHerdView(this,query);}
 locationHistory(query){return readLocationHistory(this,query);}
 hiddenView(reserve,known=super.reserveZones(reserve),species=null){
  const enabled=this.store.get('settings:'+this.profile,{spoilers:false}).spoilers===true;
  if(!enabled)return {status:'disabled',zones:[]};
  if(!this.reference.reserves[reserve])return {status:'reference_unavailable',zones:[]};
  void this.zoneReference.ensure(reserve,{enabled:true});
  const catalog=this.zoneReference.catalog(reserve),population=this.source('animal_population_'+reserve)?.payload;
  const populationStatus=this.lastError?'error':this.store.sources(this.profile).find(s=>s.name==='animal_population_'+reserve)?.status??'unavailable';
  try{
   const described=this.describeZones(known);
   // Refuse an obviously obsolete catalogue instead of mapping reused IDs to another schedule.
   const checked=described.filter(z=>z.source==='save'&&z.speciesHash&&catalog?.areas?.[String(z.zoneId)]&&catalog?.schedules?.[z.speciesHash]);
   const mismatched=checked.some(z=>{const a=catalog.schedules[z.speciesHash][z.scheduleIndex];return !a||a.need!==z.need||a.start!==z.start||a.end!==z.end;});
   if(mismatched)return {status:'reference_mismatch',zones:[]};
   const view=undiscoveredZoneView({spoilers:true,reserve,population,discoveredZones:known,catalog,reference:this.reference,sourceStatus:populationStatus,discoveryStatus:this.zoneSourceStatus(),species});
   if(view.status==='reference_unavailable')view.status=['loading','queued'].includes(this.zoneReference.status(reserve))?'loading':'reference_unavailable';
   const removed=new Set(this.store.journal(this.profile,'zoneHistory').filter(r=>r.reserve===reserve&&r.state==='removed').map(r=>r.zoneId));
   const valid=view.zones.filter(z=>!removed.has(z.id));
   const room=Math.max(0,5000-known.length),zones=valid.slice(0,room),omittedZones=valid.length-zones.length;
   return {...view,zones,omittedZones,status:omittedZones?'partial':view.status,compatibility:checked.length?'discovered_schedules_matched':'reference_assignment_only'};
  }catch{return {status:'reference_mismatch',zones:[]};}
 }
 reserveZones(reserve){const known=super.reserveZones(reserve);return [...known,...this.hiddenView(reserve,known).zones];}
 command(body){
  const rememberedKey='zone-spoiler-selections:'+this.profile;
  const selected=['zone.track','route.toggle'].includes(body.op)&&body.zoneId?this.reserveZones(body.reserve).find(z=>z.id===body.zoneId&&hidden(z)):null;
  if(body.op==='zone.loss'&&(this.store.get(rememberedKey,[])||[]).includes(body.zoneId)&&!this.store.journal(this.profile,'zoneHistory').some(r=>r.zoneId===body.zoneId))throw Object.assign(Error('An undiscovered reference is not a confirmed removed discovery.'),{status:409});
  const result=super.command(body);
  if(selected){const ids=new Set(this.store.get(rememberedKey,[]));ids.add(selected.id);if(ids.size<=5000)this.store.set(rememberedKey,[...ids]);}
  if(body.op==='settings'&&body.spoilers===false){
   this.zoneReference.suspend();const active=trackingState(this.store,this.profile);
   if(active.active&&(this.store.get(rememberedKey,[])||[]).includes(active.zoneId)&&!super.reserveZones(active.reserve).some(z=>z.id===active.zoneId))this.store.set('zone-tracking:'+this.profile,{...active,active:false,name:null,species:null,version:active.version+1,stoppedAt:new Date().toISOString(),stopReason:'spoilers_disabled'});
  }
  return result;
 }
 state(reserve,{huntSpecies}={}){
  const scoped=huntSpecies!==undefined;
  if(scoped&&(typeof huntSpecies!=='string'||!huntSpecies||huntSpecies.length>120))throw Object.assign(Error('Invalid Hunt species'),{status:400});
  const state=super.state(reserve),known=state.zones;
  // The Hunt default needs the saved zones and species choices, not thousands of
  // optional reference locations. The no-parameter state remains the phone/API contract.
  const view=scoped&&huntSpecies==='all'?{status:state.settings.spoilers?'selection_required':'disabled',zones:[]}:this.hiddenView(reserve,undefined,scoped?huntSpecies:null);
  const annotations=new Map(this.store.journal(this.profile,'annotations').map(a=>[a.zoneId,a]));
  const visible=[...known,...view.zones.map(z=>({...z,annotation:annotations.get(z.id)??null}))];
  const selected=new Set(this.store.get('zone-spoiler-selections:'+this.profile,[])),ids=new Set(visible.map(z=>z.id));
  const history=state.zoneHistory.filter(r=>!ids.has(r.id)).map(r=>scoped&&r.status!=='removed'
   ?{...r,status:'scope_limited',reason:'unconfirmed',snapshot:null}
   :selected.has(r.id)&&!r.snapshot?{...r,status:state.settings.spoilers?'reference_unavailable':'spoiler_hidden',reason:'unconfirmed',snapshot:null}:r);
  const {zones,...discovery}=view;
  const population=this.source('animal_population_'+reserve)?.payload;
  const populationNames=state.settings.spoilers===true&&Array.isArray(population?.populations)?population.populations.map(p=>this.reference.populations?.[String(p?.hash)]?.name):[];
  const huntSpeciesOptions=scoped?[...new Set([...known.map(z=>z.species),...populationNames].filter(name=>typeof name==='string'&&name.length>0&&name.length<=120))].sort((a,b)=>a.localeCompare(b)):null;
  const routeView=this.routeState(reserve,undefined,undefined,visible);
  const visibleIds=new Set(visible.map(z=>z.id));
  const routeOmittedByScope=scoped&&state.route.some(id=>!visibleIds.has(id));
  const scopedRoute=routeOmittedByScope?{
   route:[...state.route],
   routeOptimization:{...routeView.routeOptimization,status:'scope_limited',savedMeters:null,distanceMeters:null,originalDistanceMeters:null,usesHours:false,missingCount:null,unknownHoursCount:null}
  }:routeView;
  return {...state,career:{...state.career,saveData:observerSaveData(this,{...state,zones:visible})},zones:visible,zoneHistory:history,
   zoneActivity:{...state.zoneActivity,discovery:{...discovery,reserve,hiddenZones:zones.length}},
   ...scopedRoute,...(scoped?{huntSpeciesOptions}:{})};
 }
 stop(){this.zoneReference.close();super.stop();}
}
