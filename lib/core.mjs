import {harvestFields} from '../public/save-decoder.js';
import {createHash} from 'node:crypto';
export const hash = value => createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const OUTCOMES=['shot','hit','alive_observed','dead_observed','harvest_player','harvest_linked','unknown','note'];
export const STRATEGIES=['unassigned','shoot','exterior','untouched','stacked','collection','retired'];
export function text(value,max=1000) {if(typeof value!=='string'||value.length>max)throw Error('Invalid text');return value.trim();}
export function coordinate(value) {if(value===''||value===null||value===undefined)return null;const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>100000)throw Error('Invalid coordinate');return n;}
export function reserveId(value) {const n=Number(value);if(!Number.isInteger(n)||n<0||n>999)throw Error('Invalid reserve');return n;}
export function observationTime(value,now=Date.now()) {const date=value?new Date(value):new Date(now);if(!Number.isFinite(+date)||+date>now+300000||+date<946684800000)throw Error('Invalid observation time');return date.toISOString();}
export function normalizePopulation(root) {
  if(!Array.isArray(root.Populations)||root.Populations.length>250)throw Error('Unrecognized population schema');
  return {seed:String(root.ReserveSeed??''),populations:root.Populations.map(p=>{
    if(!Array.isArray(p.Groups))throw Error('Missing groups');
    return {hash:String(p.NameHashId),revision:p.Revision??null,groups:p.Groups.map((g,index)=>{
      if(!Array.isArray(g.Animals)||!Array.isArray(g.NeedZonePathGuids))throw Error('Missing animal/group data');
      return {index,area:g.SpawnAreadId,paths:g.NeedZonePathGuids.map(n=>n>>>0),animals:g.Animals.map(a=>{
        if(![1,2].includes(a.Gender)||![a.Weight,a.Score,a.VisualVariationSeed].every(Number.isFinite))throw Error('Invalid animal record');
        const explicit=typeof a.IsGreatOne==='boolean'||a.IsGreatOne===0||a.IsGreatOne===1;
        return {sex:a.Gender,weight:a.Weight,score:a.Score,seed:a.VisualVariationSeed,flags:a.FeatureModifiers?.Flags??null,scripted:!!a.IsScripted,
          nativeId:Number.isSafeInteger(a.Id)&&a.Id>0&&a.Id<=4294967295?String(a.Id):null,
          greatOne:explicit?(a.IsGreatOne===true||a.IsGreatOne===1):null,greatOneEvidence:explicit?'explicit_IsGreatOne':null};
      })};
    })};
  })};
}
function counts(population) {
  const map=new Map();
  for(const g of population.groups) for(const a of g.animals) {const key=hash([population.hash,a.sex,a.weight,a.score,a.seed,a.flags,a.scripted]);map.set(key,(map.get(key)||0)+1);}
  return map;
}
export function diffPopulation(before,after) {
  if(!before) return {boundary:'baseline',changes:[]};
  if(before.seed!==after.seed)return {boundary:'reserve_seed_changed',changes:[]};
  const changes=[];
  for(const p of after.populations) {
    const old=before.populations.find(x=>x.hash===p.hash);
    if(!old||old.revision!==p.revision)return {boundary:'population_schema_or_revision_changed',changes:[]};
    const a=counts(old),b=counts(p);let appeared=0,disappeared=0,total=0;
    for(const [key,n]of a){total+=n;disappeared+=Math.max(0,n-(b.get(key)||0));}
    for(const [key,n]of b)appeared+=Math.max(0,n-(a.get(key)||0));
    if(appeared+disappeared>Math.max(30,total*.5))return {boundary:'large_change_possible_reset_or_restore',changes:[]};
    if(appeared||disappeared)changes.push({speciesHash:p.hash,appeared,disappeared});
  }
  if(before.populations.length!==after.populations.length)return {boundary:'population_set_changed',changes:[]};
  return {boundary:null,changes};
}
export function harvestRows(root) {
  const duplicates=new Map();
  return harvestFields(root).map(raw=>{
    const key=hash(raw),ordinal=duplicates.get(key)||0;duplicates.set(key,ordinal+1);
    return {...raw,id:hash([key,ordinal])};
  });
}
export function harvestDelta(before,after,seenIds=new Set()) {
  const baseline=before===null;
  const overlap=!baseline&&after.some(h=>before.some(p=>p.id===h.id));
  const oldMax=before?.length?Math.max(...before.map(h=>h.timestamp)):0;
  const newMax=after.length?Math.max(...after.map(h=>h.timestamp)):0;
  const rollback=!baseline&&oldMax>newMax;
  const gap=!baseline&&before.length>0&&!overlap&&after.length>0;
  return {baseline,gap,rollback,records:after.filter(h=>!seenIds.has(h.id)).map(h=>({...h,origin:baseline?'baseline':rollback?'restore_history':gap?'coverage_gap':'observed'}))};
}
export function normalizeZones(root) {
  if(!Array.isArray(root.NZData))throw Error('Unrecognized zone schema');
  return root.NZData.flatMap(r=>{
    const reserve=reserveId(r.ReserveId);if(!Array.isArray(r.NeedZoneData))throw Error('Missing zone records');
    return r.NeedZoneData.map(z=>{
      const x=coordinate(z.Position?.X),y=coordinate(z.Position?.Z),index=z.NeedZoneScheduleIndex;
      if(x===null||y===null||!Number.isInteger(index)||index<0||index>50||![1,2,3].includes(z.NeedType))throw Error('Invalid zone record');
      return {id:`saved:${reserve}:${z.NeedZoneId>>>0}:${index}`,reserve,zoneId:z.NeedZoneId>>>0,scheduleIndex:index,x,z:y,start:z.NeedZoneStartTimeHours,end:z.NeedZoneEndTimeHours,need:['','feeding','drinking','resting'][z.NeedType],localizationHash:String(z.AnimalTypeLocalizationName),source:'save'};
    });
  });
}
export function linkZone(zone,population,reference) {
  const matches=[];
  for(const p of population?.populations??[]) {
    const groups=p.groups.filter(g=>g.paths[zone.scheduleIndex]===zone.zoneId);
    if(groups.length)matches.push({p,groups});
  }
  if(matches.length!==1)return {...zone,species:'Unresolved species',speciesKey:null,groups:null,males:null,females:null,association:'unresolved'};
  const {p,groups}=matches[0],a=groups.flatMap(g=>g.animals),ref=reference.populations?.[p.hash];
  return {...zone,species:ref?.name||`Species ${p.hash}`,speciesKey:ref?.key??null,speciesHash:p.hash,groups:groups.length,males:a.filter(v=>v.sex===1).length,females:a.filter(v=>v.sex===2).length,association:'saved_zone_and_schedule'};
}
// Range matches are candidates, never claims of an in-game-confirmed Great One.
export const GO_REFERENCE={
  black_bear:[290,291,409],moose:[620,621,700],whitetail:[100,101,110],whitetail_deer:[100,101,110],red_deer:[240,241,260],fallow_deer:[100,101,140],tahr:[140,141,180],mule_deer:[210,211,230],pheasant:[3,3,3.75],red_fox:[15.4,15.5,19],gray_wolf:[80,80,90],roe_deer:[35,36,42],wild_boar:[240,241,261],jaguar:[120,120,140]
};
export function candidateSummary(population,reference) {
  const species=[];
  for(const p of population?.populations??[]) {
    const ref=reference.populations?.[p.hash],key=ref?.key,r=GO_REFERENCE[key],a=p.groups.flatMap(g=>g.animals);
    const candidates=r?a.filter(v=>v.sex===1&&!v.scripted&&v.weight>r[0]&&v.weight>=r[1]&&v.weight<=r[2]).length:null;
    species.push({key,name:ref?.name||`Species ${p.hash}`,total:a.length,males:a.filter(v=>v.sex===1).length,candidates,coverage:r?'reference_range_only':'not_evaluated'});
  }
  return species;
}
export function reduceEncounter(encounter) {
  const ordered=[...encounter.evidence].sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.createdAt.localeCompare(b.createdAt));
  const relevant=ordered.filter(e=>!['note','shot'].includes(e.type));
  const latest=relevant.at(-1)||ordered.filter(e=>e.type==='shot').at(-1);
  const names={shot:'Hit unconfirmed',hit:'Hit reported · outcome unknown',alive_observed:'Alive at last observation',dead_observed:'Dead reported · not harvested',harvest_player:'Harvest reported by player',harvest_linked:'Harvest linked by player',unknown:'Outcome unknown'};
  const terminal=latest&&['harvest_player','harvest_linked'].includes(latest.type);
  return {...encounter,shots:ordered.filter(e=>e.type==='shot').length,outcome:latest?.type||'unknown',label:names[latest?.type]||'Outcome unknown',lastObservationAt:latest?.observedAt??null,terminal:!!terminal};
}
