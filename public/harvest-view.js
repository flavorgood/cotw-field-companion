import {herdWorkspaceView} from './herd-view.js';
import {huntLocationsView} from './hunt-locations.js';
import {speciesName} from './species-style.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>value==null?'—':Number(value).toLocaleString();
const timestamp=harvest=>typeof harvest.timestamp==='number'&&Number.isFinite(new Date(harvest.timestamp*1000).getTime())?harvest.timestamp*1000:null;
const dayStart=value=>{const date=new Date(value);date.setHours(0,0,0,0);return date.getTime();};
const svg=paths=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons={
  log:svg('<path d="M8 4H5v17h14V4h-3M8 3h8v4H8V3Zm0 9h8m-8 4h5"/>'),
  gold:svg('<circle cx="12" cy="9" r="5"/><path d="m8 13-1 8 5-3 5 3-1-8"/>'),
  diamond:svg('<path d="m3 8 4-5h10l4 5-9 13L3 8Zm0 0h18M8 8l4 13 4-13M7 3l1 5 4-5 4 5 1-5"/>'),
  search:svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
};

export function selectHarvests(harvests,{query='',range='all',now=Date.now(),limit=50,keepVisibleId=null}={}){
  const today=dayStart(now),week=new Date(today);week.setDate(week.getDate()-6);
  const after=range==='today'?today:range==='week'?week.getTime():null;
  const search=query.trim().toLocaleLowerCase();
  const matches=harvests.filter(h=>(!search||String(h.species??'').toLocaleLowerCase().includes(search))&&(after===null||timestamp(h)!==null&&timestamp(h)>=after&&timestamp(h)<=now)).slice().sort((a,b)=>(timestamp(b)??-Infinity)-(timestamp(a)??-Infinity));
  if(keepVisibleId!==null)limit=Math.max(limit,matches.findIndex(h=>h.id===keepVisibleId)+1);
  const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);
  const totals=new Map();for(const h of matches){const time=timestamp(h),key=time===null?'unknown':dayStart(time);totals.set(key,(totals.get(key)||0)+1);}
  const groups=[];
  for(const harvest of matches.slice(0,limit)){
    const time=timestamp(harvest),key=time===null?'unknown':dayStart(time);
    let group=groups.at(-1);
    if(!group||group.key!==key){
      const label=key==='unknown'?'Date unavailable':key===today?'Today':key===yesterday.getTime()?'Yesterday':new Date(key).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',...(new Date(key).getFullYear()!==new Date(now).getFullYear()?{year:'numeric'}:{})});
      group={key,label,total:totals.get(key),harvests:[]};groups.push(group);
    }
    group.harvests.push(harvest);
  }
  return {groups,total:matches.length,shown:Math.min(matches.length,limit)};
}

function entry(harvest,state){
  const time=timestamp(harvest),knownTime=time!==null,score=typeof harvest.score==='number'&&Number.isFinite(harvest.score)?harvest.score.toFixed(2):'—';
  const note=harvest.linkedEncounter?'<button class="button subtle" data-action="view-recovery">Open field notes</button>':state.encounters?.length?`<button class="button subtle" data-action="harvest-link" data-id="${esc(harvest.id)}">Link a field note</button>`:'';
  return `<article class="harvest-entry" data-harvest-id="${esc(harvest.id)}"><div class="harvest-entry-main"><h3>${speciesName(harvest.species||'Unknown animal')}</h3><time${knownTime?` datetime="${new Date(time).toISOString()}"`:''}>${knownTime?new Date(time).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'Time unavailable'}</time></div><div class="harvest-entry-score"><strong>${score}</strong><span>Trophy score</span></div>${note?`<details class="harvest-entry-details"><summary>Field notes</summary>${note}</details>`:''}</article>`;
}

export function harvestFeed(state,filters={}){
  const result=selectHarvests(state.harvests||[],filters);
  const groups=result.groups.map(group=>`<section class="harvest-day"><div class="harvest-day-head"><h2>${esc(group.label)}</h2><span>${group.harvests.length<group.total?`${number(group.harvests.length)} of `:''}${number(group.total)} ${group.total===1?'harvest':'harvests'}</span></div><div class="harvest-day-entries">${group.harvests.map(h=>entry(h,state)).join('')}</div></section>`).join('');
  const empty=state.harvests?.length?'<div class="harvest-empty"><h2>No matching harvests</h2><p>Try another animal or date.</p><button class="button" data-action="harvest-reset">Clear filters</button></div>':'<div class="harvest-empty"><h2>Your next harvest goes here</h2><p>Claim an animal and let the game save. Your Companion will add it automatically.</p></div>';
  return {html:groups||empty,count:result.total===result.shown?`${number(result.total)} ${result.total===1?'harvest':'harvests'}`:`${number(result.shown)} of ${number(result.total)} harvests`,more:result.shown<result.total,shown:result.shown};
}

export function harvestView(state,filters={},medals={gold:null,diamond:null}){
  const feed=harvestFeed(state,filters);
  const total=(icon,value,label,kind='',detail='')=>`<article class="harvest-total ${kind}"><span class="harvest-total-icon">${icons[icon]}</span><strong${value==null?' aria-label="Not available"':''}>${number(value)}</strong><span class="harvest-total-label">${label}</span>${detail?`<small>${detail}</small>`:''}</article>`;
  return `<div class="harvest-page"><header class="harvest-page-head"><div><span class="harvest-scope">Hunting journal · all maps</span><h1>Harvests</h1><p>Added automatically after the game saves.</p></div></header><section class="harvest-totals" aria-label="Harvest totals">${total('log',state.harvestCount,'Saved harvests')}${total('gold',medals.gold,'Lifetime Gold','gold')}${total('diamond',medals.diamond,'Lifetime Diamond','diamond')}</section>${state.career?.sourceStatus&&state.career.sourceStatus!=='ok'?'<p class="harvest-data-note">Medal totals are from your last readable save.</p>':''}<div class="harvest-toolbar"><label class="search-field">${icons.search}<span class="sr-only">Find an animal</span><input id="harvestSearch" type="search" placeholder="Search animals" value="${esc(filters.query||'')}" autocomplete="off"></label><label class="harvest-range"><span class="sr-only">Show harvests from</span><select id="harvestRange">${[['all','Any date'],['today','Today'],['week','Last 7 days']].map(([value,label])=>`<option value="${value}" ${value===(filters.range||'all')?'selected':''}>${label}</option>`).join('')}</select></label></div><div class="harvest-feed-summary"><span id="harvestMatchCount" role="status" aria-live="polite">${feed.count}</span><span>Newest first</span></div><div id="harvestFeed" class="harvest-feed">${feed.html}</div><button id="harvestMore" class="button harvest-more" data-action="harvest-more" ${feed.more?'':'hidden'}>Show more harvests</button>${herdWorkspaceView(state)}${huntLocationsView(state)}<details class="harvest-about"><summary>About your hunting journal</summary><p>Gold animal names have Great One variants. A gold name does not mean that individual animal was a Great One.</p><p>Your medal totals cover your whole career. This list holds the recent harvests in your first import and new harvests saved since then.${state.coverageEvents?.length?' Some older harvests are missing from the game’s recent history.':''}</p><p>Individual medals and fur types still need verified mappings. Known reserve and location associations appear in Where it happened; unlocated harvests are not assigned to the current map.</p></details></div>`;
}
