/** Read-only, bounded player-facing projections of the canonical observer's saved data.
 * Source timestamps describe saves, not live events. No account IDs, raw objects or seeds leave here.
 */
export const SAVE_DATA_SCHEMA = 'grindzone.save-data.v1';
export const SAVE_DATA_LIMITS = Object.freeze({species:250, equipment:80, progress:20, bytes:65536});
const iso = v => typeof v==='string' && Number.isFinite(Date.parse(v)) ? v : null;
const text = (v,n=120) => typeof v==='string' && v.trim() && v.length<=n ? v : null;
const count = v => Number.isSafeInteger(v) && v>=0 ? v : null;
const finite = v => typeof v==='number' && Number.isFinite(v) && v>=0 ? v : null;
const reserveId = v => Number.isInteger(v) && v>=0 && v<=999 ? v : null;
const profileKeys = ['level','xp','cash','skillPoints','perkPoints'];
const list = v => Array.isArray(v) ? v : [];
// Failed first reads can create metadata-only rows; they are not retained decoded snapshots.
const hasPayload = source => source?.payload !== null && source?.payload !== undefined;
function profileValues(value){return Object.fromEntries(profileKeys.map(k=>[k,finite(value?.[k])]))}
export function sourceInfo(source,status){
 return {status:!hasPayload(source)?'unavailable':status==='ok'?'available':'stale',savedAt:hasPayload(source)?iso(source.mtime):null,checkedAt:iso(source?.checked)};
}

/** Net changes between two readable profile saves, never purchase/earnings or session attribution. */
export function recordProfileProgress(store,profile,source,status,observedAt=new Date().toISOString()){
 if(status!=='ok'||!iso(source?.mtime)||!text(source?.sha,128)||!iso(observedAt))return false;
 const values=profileValues(source.payload);
 if(Object.values(values).some(v=>v===null))return false;
 const key='save-data-progress:'+profile,previous=store.get(key,null);
 if(previous?.sha===source.sha&&previous?.savedAt===source.mtime)return false;
 const before=profileValues(previous?.values),validBefore=!!iso(previous?.savedAt)&&Object.values(before).every(v=>v!==null);
 const backwards=validBefore&&Date.parse(source.mtime)<Date.parse(previous.savedAt);
 const changes=validBefore?profileKeys.filter(k=>before[k]!==values[k]).map(k=>({key:k,before:before[k],after:values[k],delta:values[k]-before[k]})):[];
 const restored=values.level<before.level||values.level<=before.level&&values.xp<before.xp;
 const event=validBefore&&(changes.length||backwards)?{savedAt:source.mtime,previousSavedAt:previous.savedAt,observedAt,kind:backwards?'save_moved_backwards':restored?'possible_restore':'net_change',changes}:null;
 const events=[...(event?[event]:[]),...list(previous?.events)].slice(0,SAVE_DATA_LIMITS.progress);
 store.set(key,{version:1,sha:source.sha,savedAt:source.mtime,values,events});
 return true;
}
function distribution(values){
 return values.length?{min:values.reduce((a,b)=>Math.min(a,b),Infinity),max:values.reduce((a,b)=>Math.max(a,b),-Infinity),average:values.reduce((s,v)=>s+v/values.length,0)}:{min:null,max:null,average:null};
}
function distributions(animals){return {weight:distribution(animals.map(a=>a.weight)),score:distribution(animals.map(a=>a.score))}}
export function herdSaveData(source,status,{spoilers=false,reference={},zones=[],reserve=null}={}){
 if(spoilers!==true)return {status:'spoilers_off',reserve,species:[],totalSpecies:null,omittedSpecies:0};
 const info=sourceInfo(source,status),populations=source?.payload?.populations;
 if(!Array.isArray(populations)||populations.length>SAVE_DATA_LIMITS.species)return {...info,status:'unavailable',reserve,species:[],totalSpecies:null,omittedSpecies:0};
 const rows=[],seen=new Set();let invalidSpecies=0;
 for(const p of populations){
  if(!text(p?.hash,40)||seen.has(p.hash)||!Array.isArray(p.groups)){invalidSpecies++;continue}seen.add(p.hash);
  const animals=p.groups.flatMap(g=>list(g?.animals));
  if(p.groups.some(g=>!Array.isArray(g?.animals))||animals.length>200000||animals.some(a=>![1,2].includes(a?.sex)||finite(a?.weight)===null||finite(a?.score)===null)){invalidSpecies++;continue}
  const ref=reference.populations?.[p.hash],males=animals.filter(a=>a.sex===1),females=animals.filter(a=>a.sex===2);
  // An animal may use several schedules; never add zone populations together to count animals.
  const matched=new Map(zones.filter(z=>z?.reserve===reserve&&(z.speciesHash===p.hash||ref?.key&&z.speciesKey===ref.key)).map(z=>[z.id,z]));
  const needs=Object.fromEntries(['drinking','feeding','resting'].map(need=>[need,[...matched.values()].filter(z=>z.need===need).length]));
  rows.push({id:p.hash,species:text(ref?.name)||'Unidentified species',speciesKey:text(ref?.key),groups:p.groups.length,animals:animals.length,males:males.length,females:females.length,scripted:animals.filter(a=>a.scripted===true).length,male:distributions(males),female:distributions(females),zones:needs});
 }
 rows.sort((a,b)=>b.animals-a.animals||a.species.localeCompare(b.species));
 return {...info,reserve,species:rows,totalSpecies:populations.length,invalidSpecies,omittedSpecies:0};
}
export function baitState(bait){
 if(!Array.isArray(bait)||!bait.length)return {status:'not_recorded',amount:null,sites:0,emptySites:0,destroyedSites:0,unknownSites:0};
 const unknownSites=bait.filter(b=>finite(b?.amount)===null||typeof b?.destroyed!=='boolean').length;
 const destroyedSites=bait.filter(b=>b?.destroyed===true).length,emptySites=bait.filter(b=>b?.amount===0).length;
 const status=destroyedSites?'destroyed':unknownSites?'unknown':emptySites===bait.length?'empty':emptySites?'partly_empty':'bait_recorded';
 return {status,amount:unknownSites?null:bait.reduce((n,b)=>n+b.amount,0),sites:bait.length,emptySites,destroyedSites,unknownSites};
}
export function equipmentSaveData(source,status,equipment,reserves,selectedReserve){
 const info=sourceInfo(source,status);
 if(!Array.isArray(source?.payload)||!Array.isArray(equipment))return {...info,status:'unavailable',items:[],total:null,attention:null,unknown:null,byReserve:[],omittedItems:0,invalidItems:0};
 const names=new Map(list(reserves).map(r=>[r.id,text(r.name)||'Unnamed reserve'])),seen=new Set(),items=[];let invalidItems=0;
 for(const p of equipment){
  if(p?.source!=='save'||!text(p.id,240)||reserveId(p.reserve)===null||!Number.isFinite(p.x)||!Number.isFinite(p.z)||Math.abs(p.x)>100000||Math.abs(p.z)>100000||seen.has(p.id)){invalidItems++;continue}seen.add(p.id);
  const bait=baitState(p.bait);
  items.push({id:p.id,reserve:p.reserve,reserveName:names.get(p.reserve)||'Reserve '+p.reserve,label:text(p.label)||'Unidentified deployed item',typeVerified:p.typeVerified===true,x:p.x,z:p.z,bait,needsAttention:['empty','partly_empty','destroyed'].includes(bait.status)});
 }
 const byReserve=[...new Set(items.map(p=>p.reserve))].sort((a,b)=>a-b).map(reserve=>({reserve,name:names.get(reserve)||'Reserve '+reserve,total:items.filter(p=>p.reserve===reserve).length,attention:items.filter(p=>p.reserve===reserve&&p.needsAttention).length}));
 items.sort((a,b)=>Number(b.needsAttention)-Number(a.needsAttention)||Number(b.reserve===selectedReserve)-Number(a.reserve===selectedReserve)||a.reserve-b.reserve||a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
 return {...info,total:items.length,attention:items.filter(p=>p.needsAttention).length,unknown:items.filter(p=>!p.typeVerified||p.bait.status==='unknown').length,byReserve,items:items.slice(0,SAVE_DATA_LIMITS.equipment),omittedItems:Math.max(0,items.length-SAVE_DATA_LIMITS.equipment),invalidItems};
}
/** A decoded record count is not a validated animal identity or survival signal. */
function healthCoverage(source,status){
 const records=count(source?.payload?.recordCount);
 if(!source||records===null)return {key:'health',label:'Animal recovery',status:'unavailable',detail:'No readable health snapshot is available; animal/event identity and survival status remain unresolved.'};
 const snapshot=status==='ok'?'Saved health snapshot':'Last retained health snapshot (stale)';
 return {key:'health',label:'Animal recovery',status:'partial',detail:`${snapshot}: ${records} records. This does not establish whether an animal is alive or wounded; animal/event identity remains unresolved.`};
}
export function buildSaveData({profileSource,playerSource,populationSource,equipmentSource,healthSource,statusByName={},equipment=[],reference={},state={},progress=null}={}){
 const status=name=>state.observer?.error||state.observer?.connected===false?'unavailable':statusByName[name]?.status;
 const reserve=reserveId(state.selectedReserve),profile=profileValues(profileSource?.payload),player=playerSource?.payload;
 return {schema:SAVE_DATA_SCHEMA,
  profile:{...sourceInfo(profileSource,status('thp_player_profile_adf')),...profile},
  player:{...sourceInfo(playerSource,status('playerinformation_adf')),unharvested:count(player?.unharvested),harvestStreak:count(player?.harvestStreak)},
  equipment:equipmentSaveData(equipmentSource,status('worlditemsdata_adf'),equipment,state.reserves,reserve),
  herds:herdSaveData(populationSource,status('animal_population_'+reserve),{spoilers:state.settings?.spoilers===true,reference,zones:state.zones,reserve}),
  progression:{status:progress?.version===1?'available':'awaiting_baseline',events:list(progress?.events).slice(0,SAVE_DATA_LIMITS.progress)},
  coverage:[
   {key:'profile',label:'Player progression',status:hasPayload(profileSource)?'decoded':'unavailable',detail:'Level, XP, game cash and unspent points; net changes between observed profile saves.'},
   {key:'equipment',label:'Deployed equipment',status:Array.isArray(equipmentSource?.payload)?'decoded':'unavailable',detail:'Positioned world items and recorded bait values. Not carried inventory.'},
   {key:'population',label:'Herd composition',status:state.settings?.spoilers!==true?'spoilers_off':Array.isArray(populationSource?.payload?.populations)?'decoded':'unavailable',detail:'Saved animal and group records. No live positions or confirmed respawn events.'},
   {key:'harvest',label:'Harvest details',status:'partial',detail:'Saved score and time where decoded; individual medals, region and fur identifiers still require separate verification.'},
   healthCoverage(healthSource,status('health_component_manager_adf')),
   {key:'inventory',label:'Inventory and loadouts',status:'unmapped',detail:'Not mapped by the current reader; this is not a claim that the saves lack these fields.'},
   {key:'progression',label:'Detailed missions, builds and unlocks',status:'unmapped',detail:'Current counters do not establish individual objectives, chosen skills or weapon unlocks.'},
   {key:'collections',label:'Lodge collections and companion progression',status:'unmapped',detail:'Requires save-schema inspection and field validation.'}
  ]};
}
export function observerSaveData(observer,state){
 try{
 const statusByName=Object.fromEntries(observer.store.sources(observer.profile).map(s=>[s.name,s]));
 // The payload cache retains last-good bytes; check attempts are maintained separately in SQLite.
 // Never relabel the saved time with the latest check time or mutate the cached snapshot.
 const source=n=>{const cached=observer.source(n),metadata=statusByName[n];return cached?{...cached,checked:iso(metadata?.checked)??cached.checked}:metadata?{...metadata,payload:null}:null;};
 const data=buildSaveData({profileSource:source('thp_player_profile_adf'),playerSource:source('playerinformation_adf'),populationSource:source('animal_population_'+state.selectedReserve),equipmentSource:source('worlditemsdata_adf'),healthSource:source('health_component_manager_adf'),statusByName,equipment:observer.equipmentPlaces(),reference:observer.reference,state,progress:observer.store.get('save-data-progress:'+observer.profile,null)});
 if(observer.saveDataHistoryError)data.progression={status:'unavailable',events:[]};
 return data;
 }catch{return {schema:SAVE_DATA_SCHEMA,status:'unavailable'}}
}

/** Independent presentation allowlist. Never spreads caller-controlled nested source records. */
export function projectSaveData(value,{spoilers=false,reserve=null,maxBytes=SAVE_DATA_LIMITS.bytes}={}){
 if(value?.schema!==SAVE_DATA_SCHEMA)return null;
 if(['unavailable','byte_limit'].includes(value.status))return {schema:SAVE_DATA_SCHEMA,status:value.status};
 const meta=v=>({status:['available','stale','unavailable','spoilers_off','awaiting_baseline'].includes(v?.status)?v.status:'unavailable',savedAt:iso(v?.savedAt),checkedAt:iso(v?.checkedAt)});
 const dist=v=>({min:finite(v?.min),max:finite(v?.max),average:finite(v?.average)});
 const sex=v=>({weight:dist(v?.weight),score:dist(v?.score)});
 const herds=value.herds,eq=value.equipment;
 const result={schema:SAVE_DATA_SCHEMA,
  profile:{...meta(value.profile),...profileValues(value.profile)},
  player:{...meta(value.player),unharvested:count(value.player?.unharvested),harvestStreak:count(value.player?.harvestStreak)},
  equipment:{...meta(eq),total:count(eq?.total),attention:count(eq?.attention),unknown:count(eq?.unknown),omittedItems:count(eq?.omittedItems),invalidItems:count(eq?.invalidItems),
   byReserve:list(eq?.byReserve).slice(0,1000).filter(r=>reserveId(r?.reserve)!==null).map(r=>({reserve:r.reserve,name:text(r.name),total:count(r.total),attention:count(r.attention)})),
   items:list(eq?.items).slice(0,SAVE_DATA_LIMITS.equipment).filter(p=>text(p?.id,240)&&reserveId(p.reserve)!==null&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&Math.abs(p.x)<=100000&&Math.abs(p.z)<=100000).map(p=>({id:p.id,reserve:p.reserve,reserveName:text(p.reserveName),label:text(p.label),typeVerified:p.typeVerified===true,x:p.x,z:p.z,needsAttention:p.needsAttention===true,bait:{status:['not_recorded','destroyed','unknown','empty','partly_empty','bait_recorded'].includes(p.bait?.status)?p.bait.status:'unknown',amount:finite(p.bait?.amount),sites:count(p.bait?.sites),emptySites:count(p.bait?.emptySites),destroyedSites:count(p.bait?.destroyedSites),unknownSites:count(p.bait?.unknownSites)}}))},
  herds:spoilers===true&&herds?.reserve===reserve?{...meta(herds),reserve,totalSpecies:count(herds.totalSpecies),invalidSpecies:count(herds.invalidSpecies),omittedSpecies:count(herds.omittedSpecies),species:list(herds.species).slice(0,SAVE_DATA_LIMITS.species).map(s=>({id:text(s.id,40),species:text(s.species)||'Unidentified species',speciesKey:text(s.speciesKey),groups:count(s.groups),animals:count(s.animals),males:count(s.males),females:count(s.females),scripted:count(s.scripted),male:sex(s.male),female:sex(s.female),zones:Object.fromEntries(['drinking','feeding','resting'].map(k=>[k,count(s.zones?.[k])]))}))}:{status:spoilers?'unavailable':'spoilers_off',reserve,species:[],totalSpecies:null,omittedSpecies:0},
  progression:{...meta(value.progression),events:list(value.progression?.events).slice(0,SAVE_DATA_LIMITS.progress).filter(e=>iso(e?.savedAt)&&iso(e?.observedAt)&&['net_change','save_moved_backwards','possible_restore'].includes(e.kind)).map(e=>({savedAt:e.savedAt,previousSavedAt:iso(e.previousSavedAt),observedAt:e.observedAt,kind:e.kind,changes:list(e.changes).filter(c=>profileKeys.includes(c?.key)&&finite(c.before)!==null&&finite(c.after)!==null).slice(0,5).map(c=>({key:c.key,before:c.before,after:c.after,delta:c.after-c.before}))}))},
  coverage:list(value.coverage).slice(0,12).filter(r=>text(r?.key,40)&&text(r.label)&&text(r.detail,300)).map(r=>r.key==='population'&&(spoilers!==true||herds?.reserve!==reserve)?{key:'population',label:'Herd composition',status:spoilers===true?'unavailable':'spoilers_off',detail:spoilers===true?'No matching population summary is available for this reserve.':'Population details are hidden until spoilers are enabled.'}:{key:r.key,label:r.label,detail:r.detail,status:['decoded','partial','unmapped','unavailable','spoilers_off'].includes(r.status)?r.status:'unmapped'})
 };
 const budget=Number.isSafeInteger(maxBytes)&&maxBytes>=1024?Math.min(maxBytes,SAVE_DATA_LIMITS.bytes):SAVE_DATA_LIMITS.bytes;
 const size=()=>new TextEncoder().encode(JSON.stringify(result)).length;
 while(size()>budget&&result.equipment.items.length){result.equipment.items.pop();result.equipment.omittedItems=(result.equipment.omittedItems||0)+1}
 while(size()>budget&&result.herds.species.length){result.herds.species.pop();result.herds.omittedSpecies=(result.herds.omittedSpecies||0)+1}
 while(size()>budget&&result.progression.events.length){result.progression.events.pop();result.progression.omittedEvents=(result.progression.omittedEvents||0)+1}
 return size()<=budget?result:{schema:SAVE_DATA_SCHEMA,status:'byte_limit'};
}
