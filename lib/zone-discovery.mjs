/** Read-only population-path projection. Discovered zones remain the authoritative discoveries.
 * A reference area is a zone area, never an animal's live position or a guessed lake/centroid.
 * Input format follows the public DECA reserve catalogue; no network or file access occurs here.
 */
const own=(v,k)=>Object.hasOwn(v??{},k);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uint=v=>Number.isInteger(v)&&v>=-2147483648&&v<=4294967295?v>>>0:null;
const hour=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<24;
const point=v=>Array.isArray(v)&&v.length===2&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);
const needs={1:'feeding',2:'drinking',3:'resting'};
const MAX_AREAS=50000,MAX_TILES=1000000,MAX_SLOTS=200000;

/** Normalize only public geometry and schedules. Keep dataset provenance, not raw scripts. */
export function normalizeZoneReference(raw,{reserve,sha256,fetchedAt}={}){
  if(!Number.isInteger(reserve)||reserve<0||reserve>999||!object(raw)||!object(raw.areas)||!object(raw.population_info)||!point(raw.center)||!point(raw.scale)||raw.scale.some(n=>n<=0))throw Error('Invalid zone reference');
  if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||!Number.isFinite(Date.parse(fetchedAt)))throw Error('Zone reference provenance required');
  const areas=Object.create(null),conflicts=new Set(),schedules=Object.create(null);let areaCount=0,tileCount=0;
  for(const [populationId,pop] of Object.entries(raw.areas)){
    if(!object(pop)||!object(pop.layers))throw Error('Invalid reference population');
    for(const layer of Object.values(pop.layers)){
      if(!object(layer))throw Error('Invalid reference layer');
      for(const area of Object.values(layer)){
        if(++areaCount>MAX_AREAS)throw Error('Zone reference area limit exceeded');
        if(!object(area)||uint(area.key)===null||!Array.isArray(area.Tiles))throw Error('Invalid reference area');
        const id=String(uint(area.key));if(id==='4294967295')continue;
        const tiles=[...new Set(area.Tiles)];tileCount+=tiles.length;
        if(tileCount>MAX_TILES||tiles.some(t=>!Number.isInteger(t)||t<0||t>=65536))throw Error('Invalid zone reference tiles');
        if(!tiles.length)continue;
        // Keep every cell, then choose a real cell nearest the mean as a display anchor.
        // A simple average can fall outside a disjoint area and must not be used as a kill location.
        const cells=tiles.map(t=>[(t%256-128+.5)*raw.scale[0]+raw.center[0],(Math.floor(t/256)-128+.5)*raw.scale[1]+raw.center[1]]);
        if(cells.some(c=>!point(c)))throw Error('Reference coordinates out of range');
        const mean=cells.reduce((p,c)=>[p[0]+c[0]/cells.length,p[1]+c[1]/cells.length],[0,0]);
        cells.sort((a,b)=>Math.hypot(a[0]-mean[0],a[1]-mean[1])-Math.hypot(b[0]-mean[0],b[1]-mean[1])||a[0]-b[0]||a[1]-b[1]);
        const normalized={zoneId:Number(id),populationId,x:cells[0][0],z:cells[0][1],cellWidth:raw.scale[0],cellHeight:raw.scale[1],tiles:tiles.sort((a,b)=>a-b),hasSpawnPoints:Array.isArray(area.SpawnCenterPoints)&&area.SpawnCenterPoints.length>0};
        if(own(areas,id)&&JSON.stringify(areas[id])!==JSON.stringify(normalized))conflicts.add(id);else areas[id]=normalized;
      }
    }
  }
  for(const id of conflicts)delete areas[id];
  for(const [hash,row]of Object.entries(raw.population_info)){
    if(!/^\d+$/.test(hash)||uint(Number(hash))===null||!object(row)||!Array.isArray(row.start_times)||!object(row.need_types))continue;
    const times=row.start_times;if(!times.length||times.length>51||times.some(t=>!hour(t))||new Set(times).size!==times.length)continue;
    const slots=times.map((start,i)=>({start,end:times[(i+1)%times.length],need:needs[row.need_types[start.toFixed(1)]]??null}));
    schedules[String(uint(Number(hash)))]=slots;
  }
  return {schema:'grindzone.zone-reference.v1',reserve,source:'https://mathartbang.com/deca/hp/data/r'+reserve+'/reserve.json',sha256,fetchedAt,areas,schedules,conflictingAreaCount:conflicts.size};
}

/** Reveal only references actually assigned to groups in this player's selected reserve. */
export function undiscoveredZoneView({spoilers=false,reserve,population,discoveredZones=[],catalog,reference={},sourceStatus='ok',discoveryStatus='ok',species=null}={}){
  // This branch must execute before touching any hidden data, including counts.
  if(spoilers!==true)return {status:'disabled',zones:[]};
  if(!Number.isInteger(reserve)||reserve<0||reserve>999||!Array.isArray(discoveredZones))throw Error('Invalid zone-view scope');
  if(!population||!Array.isArray(population.populations))return {status:'population_unavailable',zones:[]};
  if(!catalog||catalog.schema!=='grindzone.zone-reference.v1'||catalog.reserve!==reserve||!object(catalog.areas)||!object(catalog.schedules))return {status:'reference_unavailable',zones:[]};
  if(sourceStatus!=='ok'||discoveryStatus!=='ok')return {status:'source_unavailable',zones:[]};
  const discovered=new Set(discoveredZones.filter(z=>z?.reserve===reserve&&z.source==='save').map(z=>z.id));
  const located=new Map(),ambiguous=new Set();let unresolvedSlots=0,disabledSlots=0,examined=0;
  for(const pop of population.populations){
    if(!object(pop)||!Array.isArray(pop.groups))throw Error('Invalid population groups');
    const hash=String(pop.hash),schedule=catalog.schedules[hash];
    if(species!==null&&(reference.populations?.[hash]?.name||`Species ${hash}`)!==species)continue;
    for(const group of pop.groups){
      if(!object(group)||!Array.isArray(group.paths)||!Array.isArray(group.animals))throw Error('Invalid population group');
      if((examined+=group.paths.length)>MAX_SLOTS)throw Error('Population zone limit exceeded');
      const spawn=catalog.areas[String(uint(group.area))];
      for(const [slot,path]of group.paths.entries()){
        const zoneId=uint(path);if(zoneId===4294967295){disabledSlots++;continue;}
        const id=`saved:${reserve}:${zoneId}:${slot}`;
        if(discovered.has(id))continue;
        const area=zoneId===null?null:catalog.areas[String(zoneId)],activity=schedule?.[slot];
        // No nearest discovered zone, index-to-need guess, invented schedule or empty herd.
        if(!group.animals.length)continue;
        if(!spawn||spawn.hasSpawnPoints||pop.usesWarrens===true||!area||area.populationId!==spawn.populationId||!Array.isArray(schedule)||schedule.length!==group.paths.length||!activity?.need||!hour(activity.start)||!hour(activity.end)||!Number.isFinite(area.x)||!Number.isFinite(area.z)){
          unresolvedSlots++;continue;
        }
        const animals=group.animals;if(animals.some(a=>!a||![1,2].includes(a.sex))){unresolvedSlots++;continue;}
        const species=reference.populations?.[hash];
        const row={id,reserve,zoneId,scheduleIndex:slot,x:area.x,z:area.z,start:activity.start,end:activity.end,need:activity.need,source:'population_path_reference',discovery:'undiscovered',locationAccuracy:'reference_area',species:species?.name||`Species ${hash}`,speciesKey:species?.key??null,speciesHash:hash,association:'population_path_and_reference',groups:1,males:animals.filter(a=>a.sex===1).length,females:animals.filter(a=>a.sex===2).length};
        const old=located.get(id);
        if(old){if(old.speciesHash!==row.speciesHash||old.need!==row.need||old.start!==row.start||old.end!==row.end){ambiguous.add(id);continue;}old.groups++;old.males+=row.males;old.females+=row.females;}
        else located.set(id,row);
      }
    }
  }
  for(const id of ambiguous)located.delete(id);
  const zones=[...located.values()].sort((a,b)=>a.id.localeCompare(b.id));
  return {status:unresolvedSlots||ambiguous.size?'partial':'available',zones,unresolvedSlots,disabledSlots,ambiguousZones:ambiguous.size,referenceSha256:catalog.sha256,referenceFetchedAt:catalog.fetchedAt,locationAccuracy:'reference_area'};
}
