/** Stable companion identities for saved groups. No save writes or guessed cross-reset lineage. */
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const uint=v=>Number.isInteger(v)&&v>=0&&v<=4294967295;
const key=(profile,reserve)=>'herd-ledger:'+profile+':'+reserve;
export const HERD_LEDGER_SCHEMA='grindzone.herd-ledger.v1';
const MAX_GROUPS=20000,MAX_RECORDS=100000;
const native=a=>typeof a?.nativeId==='string'&&/^[1-9]\d{0,9}$/.test(a.nativeId)?'id:'+a.nativeId:null;
const member=a=>native(a)||'traits:'+hash([a.sex,a.weight,a.score,a.seed,a.flags,a.scripted]);
function describe(payload,reserve){
 if(!Array.isArray(payload?.populations)||typeof payload.seed!=='string')throw Error('Invalid herd source');
 const species=new Set(),groups=[];let animalCount=0;
 for(const p of payload.populations){
  if(typeof p.hash!=='string'||!p.hash||species.has(p.hash)||!Array.isArray(p.groups))throw Error('Ambiguous population identity');species.add(p.hash);
  for(const [index,g]of p.groups.entries()){
   if(!Array.isArray(g?.animals)||!Array.isArray(g.paths)||g.paths.length>51||g.paths.some(v=>!uint(v)))throw Error('Invalid group assignment');
   if((animalCount+=g.animals.length)>500000)throw Error('Herd animal limit exceeded');
   if(g.animals.some(a=>![1,2].includes(a?.sex)||![a.weight,a.score,a.seed].every(Number.isFinite)))throw Error('Invalid herd member');
   const members=g.animals.map(member).sort(),epoch=hash([reserve,payload.seed,p.hash,p.revision??null]);
   // A spawn-area field is optional in an otherwise readable normalized population.
   // Missing/invalid origins cannot be used to infer structural continuity.
   const area=uint(g.area)?g.area:null,anchor=area===null?null:hash([area,g.paths]);
   groups.push({speciesHash:p.hash,index,epoch,area,paths:[...g.paths],members,signature:hash(members),anchor,animals:g.animals.length});
  }
 }
 if(groups.length>MAX_GROUPS)throw Error('Herd group limit exceeded');return groups;
}
const overlap=(a,b)=>{const counts=new Map();for(const v of a)counts.set(v,(counts.get(v)||0)+1);let result=0;for(const v of b)if((counts.get(v)||0)>0){result++;counts.set(v,counts.get(v)-1);}return result;};
export function hasHerdBaseline(store,profile,reserve){return store.get(key(profile,reserve),null)?.schema===HERD_LEDGER_SCHEMA;}
/** Caller owns the source transaction. A failed identity write must roll back its population too. */
export function recordHerds(store,profile,reserve,source){
 if(!Number.isInteger(reserve)||reserve<0||reserve>999||!stamp(source?.mtime)||typeof source.sha!=='string')throw Error('Herd source identity required');
 const groups=describe(source.payload,reserve),prior=store.get(key(profile,reserve),null);
 if(prior&&prior.schema!==HERD_LEDGER_SCHEMA)throw Error('Unsupported herd history');
 if(prior?.sourceSha===source.sha&&prior.savedAt===source.mtime)return false;
 let generation=prior?.generation??0;
 const rollback=prior&&Date.parse(source.mtime)<Date.parse(prior.savedAt);
 if(rollback)generation++;
 const records=prior?.records??[],eligible=rollback?[]:records.filter(r=>r.active),used=new Set(),assignments=new Map(),unmatched=new Set(groups.map((_,i)=>i));
 // Reuse only a one-to-one match. No arbitrary winner on duplicate animals or shared paths.
 const matchBy=(keys)=>{
  const index=new Map();
  for(const r of eligible)if(!used.has(r.id))for(const k of new Set(keys(r))){const key=r.epoch+':'+k;if(!index.has(key))index.set(key,[]);index.get(key).push(r);}
  const candidates=new Map(),reverse=new Map();
  for(const i of unmatched){const g=groups[i],found=new Map();let crowded=false;
   for(const k of new Set(keys(g))){const bucket=index.get(g.epoch+':'+k)||[];if(bucket.length>32){crowded=true;break;}for(const r of bucket)found.set(r.id,r);}
   if(crowded){g.ambiguous=true;continue;}
   const rows=[...found.values()];candidates.set(i,rows);if(rows.length>1)g.ambiguous=true;
   for(const r of rows){if(!reverse.has(r.id))reverse.set(r.id,[]);reverse.get(r.id).push(i);}
  }
  for(const [i,found]of candidates)if(found.length===1&&reverse.get(found[0].id).length===1){assignments.set(i,found[0]);used.add(found[0].id);unmatched.delete(i);}else if(found.length)groups[i].ambiguous=true;
 };
 matchBy(g=>g.members.length?['signature:'+g.signature]:[]);
 matchBy(g=>g.members.map(m=>'member:'+m));
 // Structural continuity is labeled; it is not native game identity.
 matchBy(g=>typeof g.anchor==='string'?['anchor:'+g.anchor]:[]);
 let next=store.get('herd-sequence:'+profile,0);
 if(!Number.isSafeInteger(next)||next<0)throw Error('Herd numbering unavailable');
 const at=new Date().toISOString(),active=[];
 for(const [i,g]of groups.entries()){
  const old=assignments.get(i),sameMembers=old?.signature===g.signature,shared=old?overlap(g.members,old.members):0;
  const id=old?.id||'herd:'+hash([profile,reserve,generation,source.sha,g.speciesHash,i,++next]);
  const label=old?.label||'H-'+String(next).padStart(6,'0');
  const changed=old&&JSON.stringify(old.paths)!==JSON.stringify(g.paths);
  const routeHistory=changed?[{savedAt:old.lastSeenAt,paths:[...old.paths],area:old.area},...(old.routeHistory||[])].slice(0,20):old?.routeHistory||[];
  active.push({...g,id,label,active:true,generation,firstSeenAt:old?.firstSeenAt||source.mtime,lastSeenAt:source.mtime,observedAt:at,
   continuity:old?(sameMembers?'member_signature':shared?'shared_members':'unique_saved_assignment'):rollback?'new_after_restore':g.ambiguous?'new_ambiguous':'new_group',routeHistory});
 }
 const retired=records.filter(r=>!used.has(r.id)).map(r=>r.active?{...r,active:false,missingSince:source.mtime,reason:rollback?'save_time_moved_backwards':groups.some(g=>g.speciesHash===r.speciesHash&&g.epoch!==r.epoch)?'population_reset':'not_matched'}:r);
 if(retired.length+active.length>MAX_RECORDS)throw Error('Herd history limit reached; existing history retained');
 const state={schema:HERD_LEDGER_SCHEMA,sourceSha:source.sha,savedAt:source.mtime,generation,records:[...retired,...active]};
 store.set(key(profile,reserve),state);store.set('herd-sequence:'+profile,next);return true;
}
export function readHerdLedger(store,profile,reserve){return store.get(key(profile,reserve),null);}
export function exportHerdLedgers(store,profile){
 return store.db.prepare('SELECT k,v FROM meta WHERE substr(k,1,?)=? ORDER BY k').all(('herd-ledger:'+profile+':').length,'herd-ledger:'+profile+':').map(r=>JSON.parse(r.v));
}

/** Rebuild only companion indexes from retained decoded snapshots. Never touches source files.
 * Runs synchronously before the observer scan, not in a read-only HTTP request.
 * One failed reserve does not suppress other retained populations or replace their status.
 */
export function recoverHerdSnapshots(observer){
 const failures=Object.create(null),{store,profile}=observer;
 for(const row of store.sources(profile)){
  if(!/^animal_population_\d{1,3}$/.test(row.name))continue;
  const reserve=Number(row.name.slice('animal_population_'.length));
  try{
   const source=observer.source(row.name);if(!source?.payload)continue;
   const previous=readHerdLedger(store,profile,reserve);
   if(previous?.schema===HERD_LEDGER_SCHEMA&&previous.sourceSha===source.sha&&previous.savedAt===source.mtime)continue;
   store.transaction(()=>recordHerds(store,profile,reserve,source));
  }catch{failures[reserve]='herd_index_unavailable';}
 }
 return failures;
}
