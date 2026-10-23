import {herdWorkspaceView} from './herd-view.js';
import {huntLocationsView} from './hunt-locations.js';
import {esc} from './data-client.js';
import {speciesName,isUnidentifiedSpecies} from './species-style.js';

const number=n=>Number.isFinite(n)?n.toLocaleString():'—';
const score=n=>Number.isFinite(n)?n.toFixed(2):'—';
const date=v=>v&&Number.isFinite(new Date(v).getTime())?new Date(v).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'Date unavailable';
const clock=v=>v&&Number.isFinite(new Date(v).getTime())?new Date(v).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'—';
const duration=s=>!Number.isFinite(s)?'—':s<60?'<1 min':s<3600?`${Math.floor(s/60)} min`:`${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`;
const arrow='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
const control=(label,action,session,kind='')=>`<button class="grind-action ${kind}" data-action="${action}" data-id="${esc(session?.id||'')}" data-focus-key="${esc(label.replace(/<[^>]*>/g,'').trim())}">${label}</button>`;
const harvestCount=n=>Number.isSafeInteger(n)&&n>=0?n:null;
function speciesCounts(summary){
 if(!Array.isArray(summary?.bySpecies))return null;
 const seen=new Set(),rows=[];let total=0;
 for(const row of summary.bySpecies){
  if(!row||typeof row.species!=='string'||!row.species.trim()||seen.has(row.species)||harvestCount(row.count)===null)return null;
  seen.add(row.species);rows.push({species:row.species,count:row.count});total+=row.count;
 }
 if(harvestCount(total)===null||total!==summary.total)return null;
 return rows;
}
export function grindTotal(session){
 const summary=session?.harvestSummary,total=harvestCount(summary?.total);
 if(total===null)return null;
 if(!session.targetSpecies)return summary.total;
 if(summary.targetTotal!==undefined&&summary.targetTotal!==null){
  const target=harvestCount(summary.targetTotal);return target!==null&&target<=total?target:null;
 }
 const rows=speciesCounts(summary);
 return rows===null?null:rows.find(r=>r.species===session.targetSpecies)?.count??0;
}
export function grindAnimals(session){
 const summary=session?.harvestSummary,total=harvestCount(summary?.total),targetSpecies=session?.targetSpecies||null,targetTotal=targetSpecies?grindTotal(session):null;
 const otherTotal=targetSpecies&&total!==null&&targetTotal!==null&&targetTotal<=total?total-targetTotal:null;
 let bySpecies=total===null?null:speciesCounts(summary);
 if(bySpecies&&targetSpecies&&targetTotal!==null&&(bySpecies.find(row=>row.species===targetSpecies)?.count??0)!==targetTotal)bySpecies=null;
 if(bySpecies){
  if(targetSpecies&&!bySpecies.some(row=>row.species===targetSpecies)&&targetTotal!==null)bySpecies.push({species:targetSpecies,count:targetTotal});
  bySpecies=bySpecies.map(row=>({...row,target:row.species===targetSpecies})).sort((a,b)=>Number(b.target)-Number(a.target)||b.count-a.count||a.species.localeCompare(b.species));
 }
 return {total,targetSpecies,targetTotal,otherTotal,bySpecies};
}
function animalBreakdown(session){
 const animals=grindAnimals(session),count=(value,label)=>`<strong aria-label="${esc(value===null?label+' unavailable':number(value)+' '+label)}">${number(value)}</strong>`;
 const counts=animals.targetSpecies?`<span>${count(animals.targetTotal,'target harvests')} target</span><span>${count(animals.otherTotal,'other-animal harvests')} other animals</span>`:`<span>${count(animals.total,'all-animal harvests')} all animals</span><span>No target selected</span>`;
 const rows=animals.bySpecies;
 const details=rows===null?'<p class="grind-no-results">This grind’s animal breakdown is unavailable.</p>':rows.length?`<ul class="grind-animal-list">${rows.map(row=>`<li class="grind-animal-row${row.target?' grind-animal-target':''}"><span>${speciesName(row.species)}${row.target?'<small>Target animal</small>':animals.targetSpecies?'<small>Other animal</small>':''}</span><strong>${number(row.count)}</strong></li>`).join('')}</ul>`:'<p class="grind-no-results">No animals harvested during this grind yet.</p>';
 return `<div class="grind-animal-summary" aria-label="Animals harvested during this grind">${counts}</div><details class="grind-animal-breakdown" data-disclosure-key="grind-animals:${esc(session.id)}"><summary>Animals in this grind</summary>${details}${animals.targetSpecies?'<p class="grind-animal-help">Only target animals count toward your goal.</p>':''}</details>`;
}
export function selectedGrind(state,id){
 return state.sessions?.find(s=>s.id===id)||state.sessions?.filter(s=>!s.endedAt).sort((a,b)=>Number(!!a.pausedAt)-Number(!!b.pausedAt)||Date.parse(b.startedAt)-Date.parse(a.startedAt))[0]||state.sessions?.slice().sort((a,b)=>Date.parse(b.endedAt||b.startedAt)-Date.parse(a.endedAt||a.startedAt))[0]||null;
}
export function grindActivity(session,{activityFilter='all',activityLimit=4}={}){
 const animals=grindAnimals(session),filter=animals.targetSpecies&&['target','other'].includes(activityFilter)?activityFilter:'all';
 const total=filter==='target'?animals.targetTotal:filter==='other'?animals.otherTotal:animals.total;
 const summary=session?.harvestSummary;
 let rows=summary?.activity?.[filter];
 if(summary?.activity===undefined&&filter===(animals.targetSpecies?'target':'all'))rows=summary?.recent;
 if(rows===undefined&&total===0)rows=[];
 const seen=new Set();
 const valid=Array.isArray(rows)&&rows.length<=20&&(total===null||rows.length<=total)&&rows.every(h=>{
  if(!h||typeof h.timestamp!=='number'||!Number.isFinite(new Date(h.timestamp*1000).getTime())||h.species!==null&&typeof h.species!=='string'||h.score!==null&&!Number.isFinite(h.score)||h.id!=null&&typeof h.id!=='string')return false;
  if(h.id){if(seen.has(h.id))return false;seen.add(h.id);}
  return filter==='all'||(h.species===animals.targetSpecies)===(filter==='target');
 });
 const available=valid&&(rows.length>0||total===0)?rows.slice().sort((a,b)=>b.timestamp-a.timestamp||String(a.id??'').localeCompare(String(b.id??''))):null;
 const limit=Number.isSafeInteger(activityLimit)?Math.min(20,Math.max(4,activityLimit)):4;
 return {filter,total,available:available?.length??null,rows:available?.slice(0,limit)??null,more:available!==null&&available.length>limit};
}
export class GrindActivitySelection{
 constructor(){this.choices=new Map();}
 key(session){return JSON.stringify([session.id,session.targetSpecies??null]);}
 get(session){return session?this.choices.get(this.key(session))||{}:{};}
 change(session,filter){if(!session||!['all','target','other'].includes(filter))return;this.choices.set(this.key(session),{activityFilter:session.targetSpecies?filter:'all',activityLimit:4});}
 more(session){if(!session)return;const current=this.get(session);this.choices.set(this.key(session),{...current,activityLimit:Math.min(20,(current.activityLimit||4)+4)});}
}
function activityView(session,options){
 const activity=grindActivity(session,options),animals=grindAnimals(session),target=animals.targetSpecies;
 const filters=target?[['all','All',animals.total],['target','Target',animals.targetTotal],['other','Other',animals.otherTotal]]:[['all','All animals',animals.total]];
 const controls=filters.map(([key,label,count])=>`<button class="grind-activity-filter" data-action="grind-activity-filter" data-id="${esc(session.id)}" data-filter="${key}" data-focus-key="${key}" aria-pressed="${activity.filter===key}">${label} <span>${number(count)}</span></button>`).join('');
 const result=h=>{
  const unknown=isUnidentifiedSpecies(h.species),badge=unknown?'Unidentified':target?(h.species===target?'Target':'Other'):'';
  const time=h.timestamp*1000,when=new Date(time),day=when.toLocaleDateString(undefined,{month:'short',day:'numeric',...(when.getFullYear()!==new Date().getFullYear()?{year:'numeric'}:{})});
  return `<article class="grind-result" data-grind-harvest-id="${esc(h.id||'')}"><div><strong>${speciesName(h.species||'Unidentified animal')}</strong><div class="grind-result-meta">${badge?`<span class="grind-result-kind ${badge.toLowerCase()}">${badge}</span>`:''}<time datetime="${when.toISOString()}">${day} · ${clock(time)}</time></div></div><div><b>${score(h.score)}</b><span>Trophy score</span></div></article>`;
 };
 const shown=activity.rows?.length??0,scope=activity.filter==='target'?'target':activity.filter==='other'?'other':'all';
 const capped=activity.total!==null&&activity.available!==null&&activity.total>activity.available;
 const status=activity.rows===null?'Results unavailable':activity.total===null?`${number(shown)} shown · total unavailable`:capped?`${number(shown)} of ${number(activity.available)} recent`:`${number(shown)}${shown!==activity.total?' of '+number(activity.total):''} ${scope==='all'?'harvests':scope+' harvests'}`;
 const empty=activity.rows===null?'Saved results are unavailable.':activity.filter==='target'?'No target animals harvested during this grind yet.':activity.filter==='other'?'No other animals harvested during this grind yet.':'No animals harvested during this grind yet.';
 const unknowns=activity.filter==='other'&&(animals.bySpecies?.some(h=>h.count>0&&isUnidentifiedSpecies(h.species))||activity.rows?.some(h=>isUnidentifiedSpecies(h.species)));
 return `<section class="grind-results"><header><h2>Harvests</h2><span>This grind</span></header><div class="grind-activity-filters" role="group" aria-label="Filter grind harvests">${controls}</div><div class="grind-activity-status"><span role="status" aria-live="polite" tabindex="-1">${status}</span><span>Newest first</span></div>${unknowns?'<p class="grind-activity-note">Other includes unidentified animals.</p>':''}${shown?activity.rows.map(result).join(''):`<p class="grind-no-results">${empty}</p>`}${activity.more?`<button class="grind-activity-more" data-action="grind-activity-more" data-id="${esc(session.id)}" data-focus-key="more">Show ${Math.min(4,activity.available-shown)} more</button>`:activity.available!==null&&activity.available>0&&activity.total!==null&&activity.available<activity.total?`<p class="grind-activity-note">Latest ${number(activity.available)} shown. Counts include all ${number(activity.total)}.</p>`:''}</section>`;
}
export function grindsView(state,{selectedId,reserve,activityFilter,activityLimit}={}){
 const grind=selectedGrind(state,selectedId),sessions=state.sessions||[];
 if(!grind)return `<div class="grind-screen"><header class="grind-page-heading"><h1>Grind tracker</h1></header><section class="grind-empty"><h2>Pick your animal. Start your grind.</h2><p>Your harvests count automatically. Pause for a break and continue where you left off.</p>${control('Start a grind','session-start',null,'primary')}</section></div>`;
 const summary=grind.harvestSummary,total=grindTotal(grind),active=!grind.endedAt,paused=active&&!!grind.pausedAt,goal=grind.goal,hasGoal=Number.isSafeInteger(goal)&&goal>0;
 const planningMap=state.reserves?.find(r=>r.id===grind.reserve)?.name||'Hunt map';
 const history=sessions.filter(s=>s.id!==grind.id&&s.endedAt).slice().sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt));
 const current=sessions.filter(s=>!s.endedAt).slice().sort((a,b)=>Number(!!a.pausedAt)-Number(!!b.pausedAt)||Date.parse(b.startedAt)-Date.parse(a.startedAt));
 const activeSwitch=current.length>1||!active&&current.length?`<nav class="grind-active-switch" aria-label="Current grinds"><strong>Current grinds · ${current.length}</strong><div>${current.map(s=>`<button type="button" data-action="grind-open" data-id="${esc(s.id)}" aria-current="${s.id===grind.id?'page':'false'}">${esc(s.name||'My grind')} <small>${s.pausedAt?'Paused':'Tracking'}</small></button>`).join('')}</div></nav>`:'';
 const status=active?(paused?'Paused':'Tracking'):'Finished';
 const phoneTracking=active?control(paused?'Resume':'Pause',paused?'session-resume':'session-pause',grind,'primary'):control('Continue','session-resume',grind,'primary');
 const animals=grindAnimals(grind);
 const countContext=grind.targetSpecies?`<p class="grind-activity-note" data-grind-count-context>${number(animals.targetTotal)} target · ${number(animals.otherTotal)} other · ${number(animals.total)} total in this grind</p>`:'';
 const phoneDock=`<nav class="grind-phone-dock" aria-label="Grind quick actions">${control('Home','view-home',grind)}${control('Map','grind-hunt',grind)}${control('Route','grind-route',grind)}${phoneTracking}</nav>`;
 return `<div class="grind-screen"><header class="grind-page-heading">${control('← Home','view-home',grind)}${control('Edit grind','session-edit',grind)}</header>${activeSwitch}<div class="grind-layout"><div class="grind-main"><section class="grind-hero"><div class="grind-hero-top"><span>${active?'CURRENT GRIND':'FINISHED GRIND'}</span><span class="grind-status ${paused?'paused':active?'tracking':'finished'}">${status}</span></div><h1>${esc(grind.name||'My grind')}</h1><div class="grind-target">${control((grind.targetSpecies?speciesName(grind.targetSpecies):'Choose target animal')+' <span aria-hidden="true">⌄</span>','session-edit',grind,'text')}</div><div class="grind-total"><strong aria-label="${total===null?'Harvest count unavailable':number(total)+' harvests'}">${number(total)}</strong><div><b>${grind.targetSpecies?'target harvests':'all-animal harvests'}</b><span>All maps</span></div></div>${countContext}<div class="grind-primary-actions">${active?control(paused?'Resume grind':'Pause grind',paused?'session-resume':'session-pause',grind):control('Continue this grind','session-resume',grind,'primary')}${control('Open map '+arrow,'grind-hunt',grind,'primary')}</div></section>${activityView(grind,{activityFilter,activityLimit})}${herdWorkspaceView(state,{reserve:grind.reserve})}${huntLocationsView(state,{sessionId:grind.id})}</div><div class="grind-side"><section class="grind-numbers"><details data-disclosure-key="grind-progress"><summary>Manage grind &amp; details</summary>${animalBreakdown(grind)}${hasGoal?`<div class="grind-goal"><div><span>Harvest goal</span><strong>${number(total)} / ${number(goal)}</strong></div>${total!==null?`<progress aria-label="Harvest goal" value="${Math.min(total,goal)}" max="${goal}"></progress>`:''}${total!==null&&total>=goal?`<span class="grind-goal-met">Goal reached${active?' · keep going or finish when you choose':''}</span>`:''}</div>`:`<div class="grind-add-goal">${control('Set a harvest goal','session-edit',grind,'text')}</div>`}${active?`<div class="grind-finish">${control('Finish grind','session-end',grind,'text')}</div>`:''}<header><h2>Grind progress</h2><span>Started ${date(grind.startedAt)}</span></header><div class="grind-stat-row"><div><strong>${duration(summary?.activeSeconds)}</strong><span>Tracked time</span></div><div><strong>${number(summary?.runs)}</strong><span>Tracking periods</span></div></div>${grind.targetSpecies?`<div class="grind-stat-row"><div><strong>${score(summary?.bestScore)}</strong><span>Best trophy score</span></div><div><strong>${score(summary?.averageScore)}</strong><span>Average score</span></div></div>`:'<div class="grind-target-hint">Choose an animal to compare trophy scores.</div>'}<details class="grind-time-help" data-disclosure-key="time-help"><summary>How tracking works</summary><p>Only harvests saved during tracking count. Each start or resume begins a tracking period. Paused time is excluded. Tracked time includes time left running while the game or Companion is closed.</p><p>Counts include all maps. Your hunting map below is for planning.</p></details></details></section><section class="grind-hunt-links"><div class="grind-map-caption"><strong>${esc(planningMap)}</strong><span>Hunting map</span></div><div class="grind-hunt-actions">${control('Open route '+arrow,'grind-route',grind)}${control('Setup plan '+arrow,'grind-setup',grind)}</div></section>${history.length?`<section class="grind-history"><details data-disclosure-key="grind-history"><summary>Other grinds <span>${history.length}</span></summary><div>${history.map(s=>`<button class="grind-history-row" data-action="grind-open" data-id="${esc(s.id)}"><span><strong>${esc(s.name||'My grind')}</strong><small>${s.targetSpecies?speciesName(s.targetSpecies):'All animals'} · ${s.endedAt?'Finished':s.pausedAt?'Paused':'Tracking'}</small></span><span><b>${number(grindTotal(s))}</b>${arrow}</span></button>`).join('')}</div></details></section>`:''}${control('Start another grind','session-start',null,'new-grind')}</div></div>${phoneDock}</div>`;
}
