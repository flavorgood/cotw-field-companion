/** Shared read-only locations workspace for the existing grind and harvest screens. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>Number.isFinite(v)?v.toLocaleString(undefined,{maximumFractionDigits:1}):'—';
const stamp=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Time unavailable';
const hasPoint=e=>Number.isInteger(e?.reserve)&&e.reserve>=0&&e.reserve<=999&&['reported_point','player_selected_zone'].includes(e?.location?.basis)&&[e?.location?.x,e?.location?.z].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);
const choices=new Map();
const kinds={shot:'Shot reported',death:'Death reported',harvest:'Harvest'};
const locationLabel=e=>({reported_point:'Player-reported point',player_selected_zone:'Player-selected zone · not exact GPS',spoiler_hidden:'Undiscovered zone hidden',conflicting_association:'Conflicting location associations',unavailable:'Location not established'}[e?.location?.basis]||'Location not established');
export function locationRows(events,selected=null){
 return events.map(e=>`<article class="gz-location-event ${selected===e.id?'is-selected':''}" data-location-event="${esc(e.id)}"><div class="gz-location-type" data-kind="${esc(e.kind)}"><span aria-hidden="true">${e.kind==='shot'?'S':e.kind==='death'?'D':'H'}</span><strong>${e.kind==='harvest'?(e.recordSource==='saved_harvest'?'Saved harvest':'Harvest reported'):kinds[e.kind]||'Observation'}</strong></div><div class="gz-location-body"><h3>${esc(e.species)}</h3><p>${esc(e.reserveName)} · <time>${esc(stamp(e.time))}</time></p><p>${esc(locationLabel(e))}${e.location?.zoneName?' · '+esc(e.location.zoneName):''}${e.location?.zoneStatus==='removed'?' · Zone removed':''}</p>${hasPoint(e)?`<p class="gz-location-coordinates">X ${number(e.location.x)} / Z ${number(e.location.z)}</p>`:''}${e.score!==null&&Number.isFinite(e.score)?`<span class="gz-location-score">Trophy score ${number(e.score)}</span>`:''}</div><button type="button" class="button subtle gz-location-show" data-location-show="${esc(e.id)}" ${hasPoint(e)?'':'disabled'}>${hasPoint(e)?'Show on map':'No mapped point'}</button></article>`).join('');
}
export function huntLocationsView(state,{sessionId=null}={}){
  // Static reference pages never instantiate a private-data reader.
  if(globalThis.document?.documentElement?.dataset?.runtime==='public'||state?.app?.name!=='GrindZone'&&state?.zoneLedgerVersion!==1)return '';
  if(sessionId){
   const session=state.sessions?.find(s=>s.id===sessionId);
   if(!session||session.endedAt!=null)return '<section class="gz-locations" aria-label="Hunt locations"><h2>Where it happened</h2><p>Continue this grind to see locations from its tracking periods. Your journal is preserved.</p></section>';
  }
  const offline=state?.phone?.mode==='cached_snapshot';
  return `<gz-hunt-locations data-session="${esc(sessionId||'active')}" data-source="${esc(state.app?.startedAt||'current')}" data-offline="${offline}" data-terrain="${state.settings?.terrain===true}"></gz-hunt-locations>`;
}
const HTMLElementBase=globalThis.HTMLElement||class {};
class HuntLocations extends HTMLElementBase{
 connectedCallback(){
  if(globalThis.document?.documentElement?.dataset?.runtime==='public'){this.textContent='Location history is available in your private companion.';return;}
  if(this.running)return;this.running=true;this.sequence=0;this.data=null;this.map=null;
  this.key=JSON.stringify([this.dataset.source||'',this.dataset.session||'']);
  const previous=choices.get(this.key)||{};
  this.filters={reserve:'all',species:'all',zone:'all',kind:'all',precision:'all',...(previous.filters||{})};
  this.offset=previous.offset||0;this.pageRevision=previous.revision||null;this.selected=previous.selected||null;this.savedMapView=previous.mapView||null;this.render();
  this.events=new AbortController();const options={signal:this.events.signal};
  this.addEventListener('click',event=>this.click(event),options);
  this.addEventListener('change',event=>{const field=event.target.closest('[data-location-filter]');if(!field)return;event.stopPropagation();this.filters[field.dataset.locationFilter]=field.value;this.remember();this.offset=0;this.load();},options);
  this.load();this.timer=setInterval(()=>{if(!this.hidden&&document.visibilityState!=='hidden'&&!this.loading&&this.offset===0)this.load({quiet:true});},10000);
 }
 disconnectedCallback(){this.remember();this.running=false;++this.sequence;clearInterval(this.timer);this.request?.abort();this.events?.abort();this.map?.destroy();this.map=null;}
 remember(){if(!this.filters)return;if(this.map?.box)this.savedMapView={id:this.selected,reserve:this.map.reserve,box:[...this.map.box]};choices.delete(this.key);choices.set(this.key,{filters:{...this.filters},offset:this.offset,revision:this.data?.revision||this.pageRevision,selected:this.selected,mapView:this.savedMapView});while(choices.size>20)choices.delete(choices.keys().next().value);}
 async click(event){
  const button=event.target.closest('[data-location-kind],[data-location-show],[data-location-page],[data-location-refresh],[data-location-map-action]');if(!button)return;event.stopPropagation();
  if(button.hasAttribute('data-location-kind')){this.filters.kind=button.dataset.locationKind;this.offset=0;this.remember();return this.load();}
  if(button.hasAttribute('data-location-refresh')){this.offset=0;return this.load();}
  if(button.hasAttribute('data-location-page')){this.offset=Number(button.dataset.locationPage);this.remember();return this.load();}
  if(button.hasAttribute('data-location-map-action')){const action=button.dataset.locationMapAction;if(action==='in')this.map?.zoom(1/1.4);else if(action==='out')this.map?.zoom(1.4);else this.map?.fitVisible();return;}
  this.map?.destroy();this.map=null;this.selected=button.dataset.locationShow;this.savedMapView=null;this.remember();this.render();await this.showMap();
  this.querySelector('.gz-location-map')?.scrollIntoView({block:'nearest'});this.querySelector('svg')?.focus({preventScroll:true});
 }
 async load({quiet=false}={}){
  if(this.dataset.offline==='true'){this.error='Your PC is unavailable. Reconnect it to load the durable location history. Your previously saved grind view remains available.';this.render();return;}
  const sequence=++this.sequence;this.request?.abort();this.request=new AbortController();this.loading=true;
  if(!quiet)this.status('Loading recorded locations…');
  const params=new URLSearchParams({...this.filters,offset:String(this.offset),limit:'50'});
   params.set('session',this.dataset.session||'active');
  if(this.offset&&(this.data?.revision||this.pageRevision))params.set('revision',this.data?.revision||this.pageRevision);
  try{
   const response=await fetch(new URL('./api/locations?'+params,import.meta.url),{cache:'no-store',credentials:'same-origin',signal:this.request.signal});
   const result=await response.json();
   if(!this.running||sequence!==this.sequence)return;
   if(response.status===409&&this.offset){this.offset=0;this.loading=false;this.status('History changed. Returning to the newest page.');return this.load();}
   if(!response.ok)throw Object.assign(Error([401,403].includes(response.status)?'This phone no longer has access. Reopen the current paired companion.':response.status===503?'The PC is unavailable. Reconnect it to load recorded locations.':response.status===404?'Location history is unavailable for this grind or this PC version.':result.error||'Location history could not load.'),{status:response.status});
   if(result.schema!=='grindzone.hunt-locations.v1'||!Array.isArray(result.events)||!result.summary||!result.facets||!Number.isInteger(result.offset))throw Error('Location history returned an unsupported view.');
   const unchanged=quiet&&this.data?.revision===result.revision&&this.data.offset===result.offset&&!this.error;
   this.data=result;this.pageRevision=result.revision;this.error='';this.loading=false;this.remember();
   if(!unchanged){this.render();await this.showMap();}
  }catch(error){if(!this.running||sequence!==this.sequence||error.name==='AbortError')return;
   // Never leave private locations on screen after revocation or a different unavailable source.
   this.data=null;this.selected=null;this.error=error.message;this.loading=false;this.render();
  }
 }
 status(message){const node=this.querySelector('[data-location-status]');if(node)node.textContent=message;}
 render(){
  if(!this.running)return;
  const active=this.contains(document.activeElement)?document.activeElement:null;
  const focus=active?.dataset.locationFilter?['data-location-filter',active.dataset.locationFilter]:active?.dataset.locationKind?['data-location-kind',active.dataset.locationKind]:null;
  if(this.map?.box)this.savedMapView={id:this.selected,reserve:this.map.reserve,box:[...this.map.box]};
  this.map?.destroy();this.map=null;
  const d=this.data,summary=d?.summary,f=this.filters;
  const options=(rows,current)=>rows.map(([value,label])=>`<option value="${esc(value)}" ${String(value)===String(current)?'selected':''}>${esc(label)}</option>`).join('');
  const select=(name,label,rows)=>`<label><span>${label}</span><select data-location-filter="${name}">${options(rows,f[name])}</select></label>`;
  const events=d?.events||[];if(d&&this.selected&&!events.some(e=>e.id===this.selected))this.selected=null;
  const selected=events.find(e=>e.id===this.selected);
  const banner=this.error?`<p class="gz-location-alert" role="status">${esc(this.error)}</p>`:d?.sourceStatus==='retained'?'<p class="gz-location-alert" role="status">Saved harvest source is unavailable. Showing retained journal history, not a live position feed.</p>':'';
  const count=(value,label)=>`<div><strong>${number(value)}</strong><span>${label}</span></div>`;
  const pages=d?`<div class="gz-location-pages"><button class="button subtle" type="button" data-location-page="${Math.max(0,d.offset-50)}" ${d.offset?'':'disabled'}>Previous</button><span>${d.summary.total?number(d.offset+1)+'–'+number(d.offset+events.length):'0'} of ${number(d.summary.total)} events</span><button class="button subtle" type="button" data-location-page="${d.nextOffset??0}" ${d.nextOffset===null?'disabled':''}>Next</button></div>`:'';
   this.innerHTML=`<link rel="stylesheet" href="${esc(new URL('./hunt-locations.css',import.meta.url).href)}"><section class="gz-locations" aria-label="Hunt locations"><header class="gz-location-header"><div><span class="gz-location-kicker">${this.dataset.session==='active'?'CURRENT GRINDS':'THIS GRIND'}</span><h2>Where it happened</h2><p>Locations from current grind tracking periods. Paused time adds no locations.</p></div><button class="button subtle" type="button" data-location-refresh>Refresh</button></header>${banner}${d&&Object.values(d.invalid||{}).some(n=>n>0)?'<p class="gz-location-alert">Some records have conflicting or invalid identities. Affected locations are withheld.</p>':''}<div class="gz-location-stats" aria-label="Filtered event totals">${count(summary?.shotsReported,'Shots reported')}${count(summary?.deathsReported,'Deaths reported')}${count(summary?.savedHarvests,'Saved harvests')}${count(summary?.harvestsReported,'Unlinked harvest reports')}</div><div class="gz-location-kinds" role="group" aria-label="Event type">${[['all','All events'],['shot','Shots'],['death','Death reports'],['harvest','Harvests']].map(([kind,label])=>`<button type="button" data-location-kind="${kind}" aria-pressed="${f.kind===kind}">${label}</button>`).join('')}</div><div class="gz-location-filters">${select('reserve','Reserve',[['all','All reserves'],...(d?.facets.reserves||[]).map(r=>[r.id,r.name])])}${select('species','Species',[['all','All species'],...(d?.facets.species||[]).map(s=>[s,s])])}${select('zone','Selected zone',[['all','All zones'],...(d?.facets.zones||[]).map(z=>[z.id,z.name])])}${select('precision','Location evidence',[['all','All evidence'],['point','Reported point'],['zone','Selected zone only'],['unknown','Location unknown']])}</div><p class="gz-location-coverage" data-location-status role="status">${d?`${number(summary.reportedPoints)} reported points · ${number(summary.selectedZones)} zone attributions · ${number(summary.unknownLocations)} without a mapped point`:this.error?'Location data unavailable.':'Loading recorded locations…'}</p>${selected?`<div class="gz-location-map"><div class="gz-location-map-heading"><strong>${esc(selected.reserveName)}</strong><span>${esc(locationLabel(selected))}</span></div><div class="gz-location-map-buttons"><button type="button" data-location-map-action="in" aria-label="Zoom in">+</button><button type="button" data-location-map-action="out" aria-label="Zoom out">−</button><button type="button" data-location-map-action="fit">Fit page</button></div><svg role="application" aria-label="Recorded event locations on ${esc(selected.reserveName)}"></svg><p class="gz-location-map-note">Markers show this page’s known points on this reserve. A selected zone is an area reference, not the animal’s exact position.</p><p data-location-map-status role="status"></p></div>`:''}<div class="gz-location-list">${events.length?locationRows(events,this.selected):d?'<div class="gz-location-empty"><h3>No matching recorded events</h3><p>Start or resume a grind and keep tracking. Saved harvests appear after the game saves; unsupported automatic shot and death coordinates are not invented.</p></div>':''}</div>${pages}<details class="gz-location-explanation"><summary>What these locations establish</summary><p>Reported points belong to their own shot, death or pickup observation. A shot point is never reused as a pickup point. Selected-zone locations come from “Hunt here” attribution, including retained deleted zones; they are not automatic kill GPS.</p><p>Only events in current grind tracking periods are shown here. Paused time adds none. The durable journal retains older records. Shots, death reports and harvests are different events—not a unique total kill count. Exact automatic shot/death/pickup capture remains unavailable where the reader has no validated source.</p></details></section>`;
  if(focus)requestAnimationFrame(()=>{if(this.running)this.querySelector(`[${focus[0]}="${CSS.escape(focus[1])}"]`)?.focus({preventScroll:true});});
 }
 async showMap(){
  const selected=this.data?.events.find(e=>e.id===this.selected);if(!hasPoint(selected))return;
  const sequence=this.sequence,selectedId=this.selected;
  try{
   const [{FieldMap},{getCatalog}]=await Promise.all([import('./map.js'),import('./data-client.js')]);
   const catalogs=await getCatalog('maps');
   if(!this.running||sequence!==this.sequence||selectedId!==this.selected)return;
   const reserve=catalogs.reserves?.find(r=>r.id===selected.reserve);if(!reserve)throw Error('The reserve map is not available. The recorded coordinates remain listed below.');
   const svg=this.querySelector('svg');if(!svg)return;
   this.map=new FieldMap(svg,()=>{},(_point,pin)=>{if(pin?.eventId){this.selected=pin.eventId;this.querySelectorAll('[data-location-event]').forEach(n=>n.classList.toggle('is-selected',n.dataset.locationEvent===this.selected));this.querySelector(`[data-location-event="${CSS.escape(this.selected)}"]`)?.scrollIntoView({block:'nearest'});}},status=>{const node=this.querySelector('[data-location-map-status]');if(node&&status?.error)node.textContent='Terrain is unavailable. Coordinates and event markers remain usable.';});
   const pins=this.data.events.filter(e=>e.reserve===selected.reserve&&hasPoint(e)).map(e=>({id:e.id,eventId:e.id,x:e.location.x,z:e.location.z,kind:e.kind==='shot'?'shot':'last_seen',label:`${e.kind==='shot'?'S':e.kind==='death'?'D':'H'} · ${e.species} · ${locationLabel(e)}`,source:'player_report'}));
   this.map.update({reserve,zones:[],pins,terrain:this.dataset.terrain==='true',route:[]});
   if(this.savedMapView?.id===selectedId&&this.savedMapView.reserve===selected.reserve){this.map.box=[...this.savedMapView.box];this.map.draw();}else this.map.focus(selected.location.x,selected.location.z);

  }catch(error){if(!this.running||error.name==='AbortError')return;const node=this.querySelector('[data-location-map-status]');if(node)node.textContent=error.message;}
 }
}
if(globalThis.customElements&&!customElements.get('gz-hunt-locations'))customElements.define('gz-hunt-locations',HuntLocations);
