import {esc} from './data-client.js';
import {saveDataView} from './save-data.js';
import {speciesName} from './species-style.js';
import {medalCounts} from './career.js';
import {resolveRouteStops} from './route-stops.js';
import {grindTotal} from './grinds.js';

const number=n=>Number.isFinite(n)?n.toLocaleString():'—';
const when=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Time unavailable';};
const time=n=>Number.isFinite(n)?`${String(Math.floor(n)).padStart(2,'0')}:${String(Math.round(n%1*60)).padStart(2,'0')}`:'—';
const arrow='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
const clock='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>';
const action=(label,kind,extra='',style='')=>`<button class="dashboard-action ${style}" data-action="${kind}" data-focus-key="${esc(label.replace(/<[^>]*>/g,'').trim())}" ${extra}>${label}</button>`;

export function dashboardData(state,reserve){
 const sessions=state.sessions||[];
 const current=sessions.filter(s=>!s.endedAt).sort((a,b)=>Number(!!a.pausedAt)-Number(!!b.pausedAt)||Date.parse(b.startedAt)-Date.parse(a.startedAt))[0]||null;
 const currentCount=sessions.filter(s=>!s.endedAt).length;
 const last=sessions.filter(s=>s.endedAt).slice().sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt))[0]||null;
 const grind=current||last;
 // A retained browser window is not the complete grind. Use the observer's durable session summary.
 const grindCount=grindTotal(grind);
 const recent=(state.harvests||[]).filter(h=>Number.isFinite(h.timestamp)&&Number.isFinite(new Date(h.timestamp*1000).getTime())).slice().sort((a,b)=>b.timestamp-a.timestamp).slice(0,3);
 const route=resolveRouteStops(state.route||[],state.zones||[]);
 return {current,currentCount,last,grind,grindCount,recent,route,missingStops:route.filter(s=>!s.zone).length,reserveName:state.reserves?.find(r=>r.id===reserve)?.name||'Selected reserve',medals:medalCounts(state)};
}
function grindMarkup(data){
 const {grind,current,grindCount}=data;
 if(!grind)return `<section class="dashboard-start"><div><strong>Grind counter</strong><span>Optional · count a session</span></div>${action('Start grind','session-start')}</section>`;
 return `<section class="dashboard-grind"><div class="dashboard-section-top"><span class="dashboard-kicker">${current?data.currentCount>1?`${data.currentCount} CURRENT GRINDS`:'CURRENT GRIND':'LAST GRIND'}</span>${current?`<span class="dashboard-live ${grind.pausedAt?'paused':''}">${grind.pausedAt?'Paused':'Tracking'}</span>`:'<span class="dashboard-meta">Finished</span>'}</div><div class="dashboard-grind-main"><div><h2>${esc(grind.name||'My grind')}</h2><span class="dashboard-meta">${current?'Started':'Finished'} ${when(current?grind.startedAt:grind.endedAt)}</span></div><div class="dashboard-grind-count"><strong${grindCount===null?' aria-label="Count unavailable"':''}>${number(grindCount)}</strong><span>harvests</span></div></div><div class="dashboard-grind-foot"><span>${grind.targetSpecies?speciesName(grind.targetSpecies):'All animals'} · all maps</span>${action('Open grind '+arrow,'grind-open',`data-id="${esc(grind.id)}"`,'text')}</div></section>`;
}
function activityMarkup(data){
 return `<section class="dashboard-activity"><div class="dashboard-section-top"><div><h2>Recent activity</h2><span class="dashboard-meta">Saved harvests · all reserves</span></div>${action('See all '+arrow,'view-harvests','aria-label="See all harvests"','text')}</div>${data.recent.length?`<div class="dashboard-feed">${data.recent.map(h=>`<div class="dashboard-harvest"><span class="dashboard-activity-icon">${clock}</span><div><h3>${speciesName(h.species||'Unknown animal')}</h3><time datetime="${new Date(h.timestamp*1000).toISOString()}">${when(h.timestamp*1000)}</time></div><div class="dashboard-score"><strong>${Number.isFinite(h.score)?h.score.toFixed(2):'—'}</strong><span>Trophy score</span></div></div>`).join('')}</div>`:`<div class="dashboard-no-activity"><h3>Your next harvest will appear here</h3><p>Claim an animal and let the game save.</p>${action('Open hunt map '+arrow,'view-map','','primary')}</div>`}</section>`;
}
function routeMarkup(data){
 const {route,reserveName,missingStops}=data;
 return `<section class="dashboard-route"><div class="dashboard-section-top"><div><h2>Your route</h2><span class="dashboard-meta">${esc(reserveName)}${route.length?' · '+route.length+' '+(route.length===1?'stop':'stops'):''}</span></div>${route.length?action('Open '+arrow,'view-herds','aria-label="Open your route"','text'):''}</div>${route.length?`<div class="dashboard-route-preview">${route.slice(0,2).map(({number,zone})=>`<div class="dashboard-route-stop"><span class="dashboard-stop-number">${number}</span><div><strong>${zone?(zone.annotation?.name?esc(zone.annotation.name):speciesName(zone.species,zone.speciesKey)):'Saved stop unavailable'}</strong><span>${zone?esc(zone.need)+' · '+time(zone.start)+'–'+time(zone.end):'Not found in the current save'}</span></div></div>`).join('')}</div>${missingStops?`<div class="dashboard-route-warning">${missingStops} ${missingStops===1?'stop needs':'stops need'} attention ${action('Review route','view-herds','','text')}</div>`:''}`:`<div class="dashboard-route-empty"><p>No saved route. You can hunt straight from the map.</p>${action('Choose a spot '+arrow,'view-map','','primary')}${action('Plan a route','view-herds','','text')}</div>`}</section>`;
}
export function dashboardView(state,{reserve}={}){
 const data=dashboardData(state,reserve),hasGrind=!!data.grind;
 const trophy=(count,label,tone)=>`<div class="dashboard-trophy ${tone}"><strong${count===null?' aria-label="Not available"':''}>${number(count)}</strong><span>${label}</span></div>`;
 return `<div class="hunt-dashboard"><header class="dashboard-heading"><h1>Your hunt</h1>${action('Hunt map '+arrow,'view-map','','primary')}</header><div class="dashboard-layout"><div class="dashboard-main">${hasGrind?grindMarkup(data):''}${activityMarkup(data)}${!hasGrind?grindMarkup(data):''}</div><div class="dashboard-side">${routeMarkup(data)}<section class="dashboard-career"><div class="dashboard-section-top"><h2>Career trophies</h2>${action('Stats '+arrow,'view-career','aria-label="Open career stats"','text')}</div><div class="dashboard-trophies">${trophy(data.medals.gold,'Gold','gold')}${trophy(data.medals.diamond,'Diamond','diamond')}${trophy(Number.isFinite(state.career?.summary?.greatOnes)?state.career.summary.greatOnes:null,'Great Ones','great-one')}</div><span class="dashboard-meta">Lifetime · all reserves</span></section></div></div>${saveDataView(state)}</div>`;
}
