import {esc,pretty} from './data-client.js';
import {speciesName} from './species-style.js';

const num=n=>Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:1}):'Not available';
const date=v=>v?new Date(v).toLocaleString():'Not recorded';
const sections=['overview','weapons','hunter','reserves'];
const weaponTypes=['rifles','handguns','shotguns','bows'];
const icon=paths=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons={
 gold:icon('<circle cx="12" cy="9" r="5"/><path d="m8 13-1 8 5-3 5 3-1-8"/>'),
 diamond:icon('<path d="m3 8 4-5h10l4 5-9 13L3 8Zm0 0h18M7 3l5 18 5-18"/>'),
 greatOne:icon('<path d="m3 6 3 12h12l3-12-6 5-3-8-3 8-6-5Zm3 15h12"/>'),
 share:icon('<path d="M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8"/>'),
 arrow:icon('<path d="M5 12h14m-5-5 5 5-5 5"/>'),
 rifles:icon('<path d="m3 19 5-5 3 1 4-4-2-2 8-6M3 19l-1-3 5-5 3 1 4-4m-3-2 3 3m-1 6 2 2"/>'),
 handguns:icon('<path d="M4 6h16v5h-8l-2 9H5l2-9H4V6Zm10 5v4h-3M17 4v2"/>'),
 shotguns:icon('<path d="m2 19 4-5 3 1 4-4-2-2 9-7m-7 10 9-7M2 19l2 2 6-4m-4-3 3-3 2 2"/>'),
 bows:icon('<path d="M7 3c12 3 12 15 0 18L9 3v18M3 12h19m-4-3 4 3-4 3"/>')
};

export function statValue(c){
 if(!Number.isFinite(c?.value))return 'Not available';
 if(c.display===1)return num(c.value*100)+'%';
 if(c.display===2)return num(c.value)+' m';
 return num(c.value);
}
export function medalCounts(state){
 const value=key=>{const count=state?.career?.counters?.find(c=>c.key===key)?.value;return Number.isFinite(count)?count:null;};
 return {gold:value('harvests_gold'),diamond:value('harvests_platinum')};
}
const pairs=rows=>`<dl class="record-values">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
const expanded=(ui,key)=>ui.open?.has(key)?' open':'';
const disclosure=(ui,key,title,body)=>`<details class="record-disclosure" data-career-detail="${esc(key)}"${expanded(ui,key)}><summary>${title}</summary>${body}</details>`;
const percent=n=>Number.isFinite(n)?num(n*100)+'%':'Not available';
const meter=n=>`<span class="record-meter" aria-hidden="true">${Number.isFinite(n)?`<i style="width:${Math.min(100,Math.max(0,n*100))}%"></i>`:''}</span>`;

function weaponRow(key,byKey){
 const accuracy=byKey['accuracy_'+key];
 return `<span class="record-weapon-icon">${icons[key]}</span><span class="record-weapon-name">${pretty(key)}${meter(accuracy?.value)}</span><strong>${statValue(accuracy)}</strong>`;
}
function overview(c,byKey,medals,ui){
 const s=c.summary;
 const allTotals=disclosure(ui,'harvest-totals','All medals &amp; shot totals',pairs([
  ['Gold',num(medals.gold)],['Diamond',num(medals.diamond)],['Great Ones',num(s.greatOnes)],
  ['Silver',statValue(byKey.harvests_silver)],['Bronze',statValue(byKey.harvests_bronze)],['Other harvests',statValue(byKey.harvests_copper)],
  ['Shots hit',statValue(byKey.shots_hit)],['Shots missed',statValue(byKey.shots_missed)]
 ]));
 return `<div class="record-overview">
 <section class="record-summary" aria-label="Lifetime hunting totals">
  <div class="record-harvest-total"><span>Animals harvested</span><strong>${num(s.lifetimeHarvests)}</strong><span class="record-lifetime">Lifetime · all reserves</span></div>
  <div class="record-trophies">
   <div class="record-gold">${icons.gold}<strong>${num(medals.gold)}</strong><span>Gold</span></div>
   <div class="record-diamond">${icons.diamond}<strong>${num(medals.diamond)}</strong><span>Diamond</span></div>
   <div class="record-great-one">${icons.greatOne}<strong>${num(s.greatOnes)}</strong><span>Great Ones</span></div>
  </div>
  <div class="record-shooting"><div><strong>${num(s.shotsFired)}</strong><span>Shots fired</span></div><div><strong>${percent(s.accuracy)}</strong><span>Accuracy</span></div><div><strong>${Number.isFinite(s.longestShot)?num(s.longestShot)+' m':'Not available'}</strong><span>Longest shot</span></div></div>
  ${allTotals}
 </section>
 <section class="record-weapons" aria-labelledby="record-weapons-title">
  <div class="record-section-heading"><h2 id="record-weapons-title">Weapon accuracy</h2><button data-career-open="weapons" aria-label="See weapon details">Details ${icons.arrow}</button></div>
  <div class="record-weapon-list">${weaponTypes.map(k=>`<div class="record-weapon-row">${weaponRow(k,byKey)}</div>`).join('')}</div>
  
 </section>
 </div>`;
}
function weapons(byKey,ui){
 return `<section class="record-weapons record-weapon-details"><div class="record-section-heading"><h2>Weapon stats</h2><span>Accuracy</span></div>
 ${weaponTypes.map(k=>`<details class="record-weapon-detail" data-career-detail="weapon-${k}"${expanded(ui,'weapon-'+k)}><summary class="record-weapon-row">${weaponRow(k,byKey)}<span class="record-chevron" aria-hidden="true"></span></summary>${pairs([['Saved accuracy samples',num(byKey['accuracy_'+k]?.accuracySamples)],['Perk points spent',statValue(byKey['perks_'+k])]])}</details>`).join('')}
 <p class="record-caption">Individual gun stats aren’t in the game save.</p>
 ${disclosure(ui,'weapon-source','About these stats','<p class="record-caption">Accuracy and sample counts are saved by the game for each weapon type. A sample count is not a confirmed number of shots fired. Perk points are the points spent in that weapon category.</p>')}</section>`;
}
function hunter(c,byKey,ui,state){
 const p=c.profile||{},s=c.summary;
 const reconciliation=pairs([['Career harvests',num(s.lifetimeHarvests)],['Still uncollected',num(c.unharvested)],['All-time kills','Not available'],['Hits',num(s.hits)],['Misses',num(s.misses)],['Shots used for accuracy',num(c.shotReconciliation?.accuracyDenominator)],['Harvests in this companion',num(c.retainedHarvests)]])+`<p class="record-caption">The companion’s harvest list starts with the animals it has seen in your saves. Uncollected animals are not added to career harvests.</p>${c.shotReconciliation?.consistent===false?'<p class="record-warning" role="status">The game saved different shot totals for accuracy and for hits plus misses. Both are shown as saved.</p>':''}`;
 const technical=`<p class="record-caption">${esc(c.killCoverage)} Missing animals are not counted as confirmed kills.</p><div class="table-wrap"><table><thead><tr><th>Game stat</th><th>Value</th><th>Source</th></tr></thead><tbody>${c.counters.map(v=>`<tr><td>${speciesName(v.label)}<small class="muted code">${esc(v.key)}</small></td><td>${statValue(v)}</td><td>${v.computed?'Calculated from saved stats':'Saved by the game'}</td></tr>`).join('')}</tbody></table></div><p class="record-caption">${c.coverage?.conflicts?.length??0} conflicting identifiers withheld. Repeated records are not added together.</p>${(state.careerChanges||[]).slice(0,8).map(e=>`<p class="record-caption">${esc(date(e.at))} · ${esc(e.kind||'Stat change')} ${e.changed?e.changed.length+' stats changed':''}${e.resetPossible?' · possible reset or restore':''}</p>`).join('')}<p class="record-caption">Career saved ${esc(date(c.savedAt))}. Uncollected count saved ${esc(date(c.unharvestedSavedAt))}. Profile and world stats may have different save times. Source: ${esc(c.coverage?.source)}.</p>`;
 return `<div class="record-hunter-grid"><section class="record-hunter"><div class="record-profile"><div class="record-level"><span>Level</span><strong>${num(p.level)}</strong></div>${pairs([['XP',num(p.xp)],['Game cash',num(p.cash)]])}</div><h2>Skills &amp; perks</h2>${pairs([['Stalker points spent',statValue(byKey.skills_active)],['Ambusher points spent',statValue(byKey.skills_passive)],['Unspent skill points',num(p.skillPoints)],['Unspent perk points',num(p.perkPoints)]])}</section>
 <section class="record-hunter"><h2>Tracking &amp; multiplayer</h2>${pairs([['Animals scared away',num(s.spooked)],['By noise',statValue(byKey.animals_spooked_hearing)],['By sight',statValue(byKey.animals_spooked_eyesight)],['By scent',statValue(byKey.animals_spooked_scent)],['Hunter deaths',num(s.deaths)],['Competitions won',statValue(byKey.mp_competitions)],['Cooperative harvests',statValue(byKey.mp_coop_harvests)]])}</section></div>
 <div class="record-data-details">${disclosure(ui,'reconciliation','Why some totals differ',reconciliation)}${disclosure(ui,'technical','Saved data &amp; recent changes',technical)}</div>`;
}
function reserveList(c,ui){
 const query=(ui.query||'').trim().toLocaleLowerCase();
 return `<section class="record-reserves"><label class="record-search">Find a reserve<input type="search" data-career-search placeholder="Reserve name" value="${esc(ui.query||'')}" autocomplete="off"></label><div class="record-reserve-list">${(c.allMaps||[]).map(r=>{
  const v=suffix=>(r.stats||[]).find(s=>s.key.endsWith('_'+suffix));
  return `<details class="record-reserve" data-reserve-name="${esc(r.name.toLocaleLowerCase())}" data-career-detail="reserve-${r.id}"${expanded(ui,'reserve-'+r.id)}${!r.name.toLocaleLowerCase().includes(query)?' hidden':''}><summary><strong>${esc(r.name)}</strong><span>${r.available?statValue(v('world_explored'))+' explored':'No save found'}</span><i class="record-chevron" aria-hidden="true"></i></summary>${pairs([['Distance',statValue(v('distance_walked'))],['Main / side missions',statValue(v('missions_main'))+' / '+statValue(v('missions_side'))],['Outposts',statValue(v('outposts'))],['Zones',num(r.zoneCount)],['Equipment',num(r.equipmentCount)]])}<button class="record-map-link" data-career-reserve="${r.id}">Open map ${icons.arrow}</button></details>`;
 }).join('')}</div><p class="record-empty" data-career-no-results${(c.allMaps||[]).some(r=>r.name.toLocaleLowerCase().includes(query))?' hidden':''}>No reserves match your search.</p><p class="record-caption">Lifetime harvest and shot totals cover all reserves.</p></section>`;
}
export function careerView(state,ui={}){
 const c=state?.career;
 if(!c||c.status==='not_available')return `<section class="career-screen"><header class="record-heading"><h1>Hunting record</h1></header><div class="record-empty"><h2>${state?.publicMode?'Connect your game':'Waiting for your game'}</h2><p>${state?.publicMode?'Your Windows companion brings your career stats here.':'Play and save your game to load your career stats.'}</p><a class="button primary" href="https://github.com/infotradescout/cotw-field-companion#run-the-local-companion" target="_blank" rel="noopener">Get the companion</a></div></section>`;
 const byKey=Object.fromEntries(c.counters.map(r=>[r.key,r])),medals=medalCounts(state),active=sections.includes(ui.tab)?ui.tab:'overview';
 const panes={overview:overview(c,byKey,medals,ui),weapons:weapons(byKey,ui),hunter:hunter(c,byKey,ui,state),reserves:reserveList(c,ui)};
 return `<section class="career-screen"><header class="record-heading"><div><h1>Hunting record</h1></div><button class="record-share" data-action="view-studio" aria-label="Make a career card" title="Make a career card">${icons.share}<span>Make a card</span></button></header>
 ${state?.demo?'<p class="record-demo">Fictional sample data · public preview</p>':''}
 ${c.sourceStatus!=='ok'?'<p class="record-warning" role="status">Update unavailable. Showing your last saved totals.</p>':''}
 <div class="record-tabs" role="tablist" aria-label="Career stats">${sections.map(k=>`<button id="career-tab-${k}" role="tab" data-career-tab="${k}" aria-controls="career-panel-${k}" aria-selected="${k===active}" tabindex="${k===active?0:-1}">${pretty(k)}</button>`).join('')}</div>
 ${sections.map(k=>`<div role="tabpanel" id="career-panel-${k}" aria-labelledby="career-tab-${k}" tabindex="0"${k!==active?' hidden':''}>${panes[k]}</div>`).join('')}</section>`;
}

// Keep navigation, disclosures and reserve search stable when a new game save arrives.
export class CareerScreen {
 constructor(root){
  this.root=root;this.tab='overview';this.open=new Set();this.query='';this.focus=null;
  root.addEventListener('click',e=>{
   const target=e.target.closest('[data-career-tab],[data-career-open]');
   if(target)this.select(target.dataset.careerTab||target.dataset.careerOpen,true);
  });
  root.addEventListener('keydown',e=>{
   const tab=e.target.closest('[data-career-tab]');
   if(!tab||!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;
   e.preventDefault();const index=sections.indexOf(tab.dataset.careerTab);
   this.select(sections[e.key==='Home'?0:e.key==='End'?sections.length-1:(index+(e.key==='ArrowRight'?1:-1)+sections.length)%sections.length],true);
  });
  root.addEventListener('toggle',e=>{if(e.target.matches('[data-career-detail]')&&root.contains(e.target)){const key=e.target.dataset.careerDetail;if(e.target.open)this.open.add(key);else this.open.delete(key);}},true);
  root.addEventListener('input',e=>{if(!e.target.matches('[data-career-search]'))return;this.query=e.target.value;this.filter();});
 }
 select(key,focus=false){
  if(!sections.includes(key))return;this.tab=key;
  for(const button of this.root.querySelectorAll('[data-career-tab]')){const selected=button.dataset.careerTab===key;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected&&focus)button.focus();}
  for(const panel of this.root.querySelectorAll('[role="tabpanel"]'))panel.hidden=panel.id!=='career-panel-'+key;
 }
 filter(){
  const query=this.query.trim().toLocaleLowerCase();let matches=0;
  for(const row of this.root.querySelectorAll('[data-reserve-name]')){row.hidden=!row.dataset.reserveName.includes(query);if(!row.hidden)matches++;}
  const empty=this.root.querySelector('[data-career-no-results]');if(empty)empty.hidden=matches>0;
 }
 render(state){
  const focused=this.root.ownerDocument.activeElement;
  this.focus=this.root.contains(focused)?{tab:focused.dataset.careerTab,search:focused.matches('[data-career-search]'),detail:focused.parentElement?.dataset.careerDetail,action:focused.dataset.action,open:focused.dataset.careerOpen,reserve:focused.dataset.careerReserve,panel:focused.getAttribute('role')==='tabpanel'?focused.id:null}:null;
  return careerView(state,this);
 }
 restoreFocus(){
  if(!this.focus)return;
  const {tab,search,detail,panel,action,open,reserve}=this.focus;
  const button=Array.from(this.root.querySelectorAll('button')).find(el=>(action&&el.dataset.action===action)||(open&&el.dataset.careerOpen===open)||(reserve&&el.dataset.careerReserve===reserve));
  const target=button||(search?this.root.querySelector('[data-career-search]'):tab?this.root.querySelector(`[data-career-tab="${tab}"]`):detail?Array.from(this.root.querySelectorAll('[data-career-detail]')).find(el=>el.dataset.careerDetail===detail)?.querySelector('summary'):panel?this.root.querySelector('#'+panel):null);
  target?.focus({preventScroll:true});this.focus=null;
 }
}
