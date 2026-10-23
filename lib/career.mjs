/** Career projections use named game counters; never infer deaths from population changes. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const dictionary=JSON.parse(readFileSync(new URL('./stat-definitions.json',import.meta.url),'utf8'));
const defs=new Map(dictionary.definitions.map(d=>[d.id,d]));
const pretty=s=>s.replace(/^playerstat_/,'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
export const SESSION_MAX_PERIODS=500;
const compareActivityText=(a,b)=>a<b?-1:a>b?1:0;
const compareActivity=(a,b)=>b.timestamp-a.timestamp||compareActivityText(a.id??'',b.id??'')||compareActivityText(a.species??'',b.species??'')||(a.score??-Infinity)-(b.score??-Infinity);
function keepRecentActivity(recent,receipt){
 const index=recent.findIndex(existing=>compareActivity(receipt,existing)<0);
 if(index<0){if(recent.length<20)recent.push(receipt);return;}
 recent.splice(index,0,receipt);if(recent.length>20)recent.pop();
}
function sessionTime(value){
 const parts=typeof value==='string'?value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/):null;
 if(!parts)return NaN;
 const [year,month,day,hour,minute,second]=parts.slice(1).map(Number),days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
 if(month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59)return NaN;
 return Date.parse(value);
}

/** Missing periods are the original inclusive legacy window, never an empty history. */
export function sessionPeriods(session){
 if(!session||typeof session!=='object')return null;
 const start=sessionTime(session.startedAt),end=session.endedAt==null?Infinity:sessionTime(session.endedAt),paused=session.pausedAt==null?null:sessionTime(session.pausedAt);
 if(!Number.isFinite(start)||Number.isNaN(end)||end<start||paused!==null&&(!Number.isFinite(paused)||paused<start||paused>end))return null;
 if(session.periods===undefined)return [{startedAt:session.startedAt,endedAt:session.endedAt??null,endInclusive:true}];
 if(!Array.isArray(session.periods)||!session.periods.length||session.periods.length>SESSION_MAX_PERIODS)return null;
 const periods=[];
 for(const [i,p]of session.periods.entries()){
  if(!p||typeof p!=='object'||Array.isArray(p)||!Object.hasOwn(p,'endedAt'))return null;
  const a=sessionTime(p.startedAt),b=p.endedAt==null?Infinity:sessionTime(p.endedAt);
  if(!Number.isFinite(a)||Number.isNaN(b)||a<start||b<a||b>end||paused!==null&&b>paused||p.endInclusive!==undefined&&typeof p.endInclusive!=='boolean')return null;
  if(b===Infinity&&(i!==session.periods.length-1||end!==Infinity||paused!==null))return null;
  periods.push({startedAt:p.startedAt,endedAt:p.endedAt??null,...(p.endInclusive===true?{endInclusive:true}:{})});
 }
 // A running explicit session must have an open period. A finished or paused one cannot.
 if(end===Infinity&&paused===null&&periods.at(-1).endedAt!==null)return null;
 return periods;
}

export function sessionHarvestSummary(session,harvests,now=Date.now()){
 const periods=sessionPeriods(session),target=session?.targetSpecies??null;
 if(!periods||!Array.isArray(harvests)||!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime())||target!==null&&(typeof target!=='string'||!target.trim()||target.length>120))return null;
 const windows=periods.map(p=>({start:sessionTime(p.startedAt),end:p.endedAt===null?now:sessionTime(p.endedAt),inclusive:p.endInclusive===true}));
 if(windows.some(p=>p.end<p.start))return null;
 // Merge only for duration; test each receipt once against the full window union.
 const merged=[];
 for(const p of [...windows].sort((a,b)=>a.start-b.start)){
  const last=merged.at(-1);if(last&&p.start<=last.end)last.end=Math.max(last.end,p.end);else merged.push({...p});
 }
 const species=new Map(),seen=new Set(),matched=[],activity={all:[],target:[],other:[]};let total=0;
 for(const h of harvests){
  if(!h||typeof h.timestamp!=='number'||!Number.isFinite(h.timestamp)||!Number.isFinite(new Date(h.timestamp*1000).getTime()))continue;
  const time=h.timestamp*1000;
  if(!windows.some(p=>time>=p.start&&(time<p.end||p.inclusive&&time===p.end)))continue;
  if(typeof h.id==='string'&&h.id){if(seen.has(h.id))continue;seen.add(h.id);}
  total++;species.set(h.species,(species.get(h.species)||0)+1);
  const receipt={id:typeof h.id==='string'?h.id:null,species:typeof h.species==='string'?h.species:null,score:typeof h.score==='number'&&Number.isFinite(h.score)?h.score:null,timestamp:h.timestamp};
  keepRecentActivity(activity.all,receipt);
  if(target===null||h.species===target)matched.push(receipt);
  // "Other" means unmatched to the selected target, including unresolved species.
  if(target!==null)keepRecentActivity(h.species===target?activity.target:activity.other,receipt);
 }
 matched.sort((a,b)=>b.timestamp-a.timestamp||String(a.id??'').localeCompare(String(b.id??'')));
 const scored=target===null?[]:matched.filter(h=>h.score!==null);
 return {total,bySpecies:[...species].map(([species,count])=>({species,count})),scope:'full_retained_journal',timeBasis:'saved_harvest_time',reserveScope:'all_reserves',
  targetTotal:matched.length,bestScore:scored.length?scored.reduce((best,h)=>Math.max(best,h.score),-Infinity):null,averageScore:scored.length?scored.reduce((sum,h)=>sum+h.score/scored.length,0):null,
  activeSeconds:Math.floor(merged.reduce((sum,p)=>sum+p.end-p.start,0)/1000),runs:periods.length,lastHarvestAt:matched.length?new Date(matched[0].timestamp*1000).toISOString():null,recent:matched.slice(0,6),activity};
}
export function normalizeStatistics(root){
 if(!Array.isArray(root?.StatsNameHash)||!Array.isArray(root.StatsData)||root.StatsNameHash.length!==root.StatsData.length||root.StatsData.length>20000)throw Error('Unsupported career statistics schema');
 const rows={},conflicts=[];
 root.StatsNameHash.forEach((id,i)=>{const r=root.StatsData[i];if(!Number.isInteger(id)||!r||!['IntValue','FloatValue','AvgCount','AvgValue'].every(k=>Number.isFinite(r[k])))throw Error('Invalid career counter');
  const key=String(id>>>0),value={int:r.IntValue,float:r.FloatValue,count:r.AvgCount,sum:r.AvgValue};
  if(rows[key]&&JSON.stringify(rows[key])!==JSON.stringify(value))conflicts.push(key);else rows[key]=value;
 });
 for(const key of conflicts)delete rows[key];
 return {rows,conflicts:[...new Set(conflicts)],rawRecordCount:root.StatsData.length,uniqueRecordCount:Object.keys(rows).length};
}
export function normalizeProfile(root){
 const fields={level:root.Level,xp:root.Xp,cash:root.Cash,skillPoints:root.SkillPoints,perkPoints:root.PerkPoints};
 if(!Object.values(fields).every(v=>Number.isFinite(v)&&v>=0))throw Error('Unsupported career profile');
 return fields; // No tracking ID, account identity, inventory, consent or cosmetic state is retained.
}
export function careerCounters(snapshot){
 const rows=snapshot?.rows||{},memo=new Map();
 function get(id,depth=0){if(depth>10)return null;if(memo.has(id))return memo.get(id);const d=defs.get(id),r=rows[id];let value=null;
  if(!d)return null;
  if(d.type===3){const values=d.children.map(x=>get(x,depth+1));if(values.length&&values.every(Number.isFinite))value=values.reduce((a,b)=>a+b,0);}
  else if(r&&d.type===0)value=r.int;else if(r&&d.type===1)value=r.float;
  else if(r&&d.type===4&&r.count>0)value=r.sum/r.count;
  memo.set(id,value);return value;}
 return dictionary.definitions.filter(d=>d.type!==2).map(d=>({key:d.key,label:d.label||pretty(d.labelKey||d.key),value:get(d.id),display:d.display,computed:d.type===3,visible:d.visible,sourceId:d.id,...(d.type===4?{accuracySamples:rows[d.id]?.count??null,accuracySum:rows[d.id]?.sum??null}:{})}));
}
export function buildCareer({statistics,profile,player,reserves,zones,equipment,harvests,sourceStatus}){
 const counters=careerCounters(statistics?.payload),byKey=Object.fromEntries(counters.map(r=>[r.key,r]));
 const lookup=key=>byKey[key]?.value??null;
 const allMaps=reserves.map(r=>{const prefix=Object.keys(dictionary.reserveIds).find(k=>dictionary.reserveIds[k]===r.id);return {
  id:r.id,name:r.name,available:r.available,zoneCount:zones.filter(z=>z.reserve===r.id).length,
  equipmentCount:equipment.filter(p=>p.reserve===r.id).length,statPrefix:prefix,
  stats:prefix?counters.filter(c=>c.key.startsWith(prefix+'_')).map(c=>({...c,label:pretty(c.key.slice(prefix.length+1))})):[],
  shotsFired:null,kills:null,harvests:null,attribution:'Per-reserve shot/kill/harvest totals are not defined by the inspected statistics schema.'
 };});
 const accuracy=lookup('accuracy'),shots=lookup('shots_fired');
 const accuracyDef=dictionary.definitions.find(d=>d.key==='accuracy');const denominator=statistics?.payload?.rows?.[accuracyDef?.id]?.count??null;
 return {status:statistics?'available':'not_available',savedAt:statistics?.mtime??null,checkedAt:statistics?.checked??null,sourceStatus:sourceStatus??'missing',
  profile:profile?.payload??null,unharvested:player?.payload?.unharvested??null,unharvestedSavedAt:player?.mtime??null,
  lifetimeKills:null,killCoverage:'The inspected save does not expose a validated lifetime-kill total. The unharvested counter is current saved state, not all animals ever left behind.',
  counters,allMaps,retainedHarvests:harvests.length,recentScope:'Retained log, not a complete lifetime ledger',
  shotReconciliation:{displayedShots:shots,accuracyDenominator:denominator,consistent:shots!==null&&denominator!==null?shots===denominator:null},
  coverage:{source:'statistics_adf',dictionarySource:dictionary.source,definitionHash:dictionary.sourceSha256,conflicts:statistics?.payload?.conflicts??[],mapCount:reserves.length},
  summary:{shotsFired:shots,hits:lookup('shots_hit'),misses:lookup('shots_missed'),accuracy,lifetimeHarvests:lookup('harvests'),diamonds:lookup('harvests_platinum'),greatOnes:lookup('harvests_greatone'),longestShot:lookup('longest_shot'),spooked:lookup('animals_spooked'),deaths:lookup('deaths')}
 };
}
export function statisticsDelta(before,after){
 const a=Object.fromEntries(careerCounters(before).map(v=>[v.key,v.value]));
 const changed=careerCounters(after).filter(v=>Number.isFinite(a[v.key])&&Number.isFinite(v.value)&&v.value!==a[v.key]).map(v=>({key:v.key,before:a[v.key],after:v.value,delta:v.value-a[v.key]}));
 return {kind:'career_counter_change',changed,resetPossible:changed.some(c=>['shots_fired','harvests','xp','level'].includes(c.key)&&c.delta<0),killsInferred:0};
}
