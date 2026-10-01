import {grindSummary, isTargetSpecies, exportJournal, importJournal, JOURNAL_LIMITS} from './browser-journal.js';
import {createBrowserJournalStorage} from './browser-journal-storage.js';
import {createHarvestIntake} from './harvest-intake.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits: 2}) : 'Not recorded';
const date = value => new Date(value).toLocaleString(undefined, {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const platformName = {xbox:'Xbox',playstation:'PlayStation',pc:'PC',other:'Other platform'};
const medalName = {unknown:'Medal not recorded',none:'No medal',bronze:'Bronze',silver:'Silver',gold:'Gold',diamond:'Diamond',great_one:'Great One'};
const play = document.querySelector('#play'), dialog = document.querySelector('#editor'), form = document.querySelector('#edit-form');
let doc = null, maps = null, references = null, fatal = null, catalogError = null, view = 'hunt', selected = null, reserve = 19;
let map = null, generation = 0, picked = null, inspected = null, pending = null, editor = null, busy = false, foreignChange = false, filter = 'target';
let channel = null;
const storage = createBrowserJournalStorage({notify: message => channel?.postMessage(message)});
const active = () => doc?.grinds.find(g => g.id === selected) || doc?.grinds.find(g => g.status === 'tracking') || doc?.grinds[0] || null;
const intake = createHarvestIntake({storage, getContext: () => ({journal:doc, grind:active(), speciesNames:(references?.species||[]).map(s=>s.name).filter(s=>typeof s==='string'), reserveName:reserveName(active()?.reserve)}), onSaved:(journal,grindId)=>{doc=journal;selected=grindId;view='hunt';filter='all';foreignChange=false;render();notice('Reviewed screenshot saved in this browser.');}});
const reserveName = id => maps?.reserves.find(r => r.id === id)?.name || 'Reserve '+id;
const options = (rows, chosen) => rows.map(([value, text]) => `<option value="${esc(value)}" ${String(value)===String(chosen)?'selected':''}>${esc(text)}</option>`).join('');
const reserveOptions = chosen => options((maps?.reserves||[]).map(r => [r.id,r.name]), chosen);
const field = (name, title, value='', extra='') => `<label>${title}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
const speciesList = () => `<datalist id="species-list">${(references?.species||[]).filter(s=>typeof s.name==='string').map(s=>`<option value="${esc(s.name)}"></option>`).join('')}</datalist>`;
const button = (action, text, extra='') => `<button type="button" data-act="${action}" ${extra}>${text}</button>`;
function notice(text) { document.querySelector('#notice').textContent=text; clearTimeout(notice.timer); notice.timer=setTimeout(()=>document.querySelector('#notice').textContent='',7000); }
function download(name, text) { const url=URL.createObjectURL(new Blob([text],{type:'application/json'})), a=document.createElement('a'); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000); }
function sourceNote(){return `<aside class="local-note"><p><strong>Saved in this browser · ${esc(platformName[doc.platform])}</strong>Not an account backup. Keep a private export before changing phones or clearing browser data.</p>${button('backup','Back up')}</aside>`;}
function reportCard(r){
 const place=doc.places.find(p=>p.id===r.placeId);
 return `<article class="report" data-report-id="${esc(r.id)}"><div class="row"><h3>${esc(r.species)}</h3><span class="score">${r.score===null?'':number(r.score)}</span></div><time datetime="${r.occurredAt}">${esc(date(r.occurredAt))}</time><span class="source">${r.screenshot?'Reviewed screenshot':'Player report'} · ${esc(medalName[r.medal])}</span><p>${esc(reserveName(r.reserve))}${place?' · '+esc(place.name)+' (selected spot)':' · No spot selected'}</p><div class="points">${['shot','death','harvest'].filter(k=>r.points[k]).map(kind=>button('report-map',({shot:'Shot point',death:'Found-dead point',harvest:'Pickup point'})[kind],`data-id="${r.id}" data-kind="${kind}"`)).join('')}${place?button('spot-map','Show selected spot',`data-id="${place.id}"`):''}</div>${r.notes?`<p>${esc(r.notes)}</p>`:''}${r.screenshot?`<details><summary>Screenshot source</summary><p>${r.screenshot.method==='local_ocr'?'Local text recognition, reviewed by player.':'Manual image review; no successful text extraction.'} Not a verified game-save receipt. Image fingerprint: ${esc(r.screenshot.imageSha256.slice(0,16))}… Original image is not included in the journal backup.</p></details>`:''}</article>`;
}
function huntView(){
 const g=active(),summary=g?grindSummary(doc,g.id):null;
 if(!g)return `<section class="panel intro"><h1>Start your first grind</h1><p>Choose a reserve and a target. Keep your harvest reports, selected spots and trophy notes together—no PC required.</p>${button('start','Start a grind',`class="primary" ${maps?'':'disabled'}`)}<p class="muted">This browser workspace records what you enter. Import a harvest screenshot after starting a grind. Automatic console-save capture is not connected.</p></section>`;
 const scopeTitle={target:'Target',other:'Other',all:'All'}[filter];
 const reports=summary.recent.filter(r=>filter==='all'||(isTargetSpecies(r.species,g.targetSpecies))===(filter==='target'));
 return `<div class="workspace"><div><section class="panel hero"><div class="panel-head"><span class="muted">CURRENT SELECTION</span><span class="status">${g.status}</span></div><h1>${esc(g.name)}</h1><p class="target">${esc(g.targetSpecies)} · ${esc(reserveName(g.reserve))}</p><div class="count-row"><strong class="big">${number(summary.target)}</strong><div>target harvest reports<br><small>${number(summary.other)} other · ${number(summary.total)} total</small></div></div><div class="actions">${button('report','Record harvest',`class="primary" ${g.status==='tracking'?'':'disabled'}`)}${button('screenshot','Import screenshot')}${button(g.status==='tracking'?'pause':'resume',g.status==='tracking'?'Pause':'Continue',`data-id="${g.id}" ${g.status!=='tracking'&&doc.grinds.some(x=>x.status==='tracking')?'disabled':''}`)}</div><div class="metrics"><div><strong>${number(summary.diamonds)}</strong><span>Reported target Diamonds</span></div><div><strong>${number(summary.greatOnes)}</strong><span>Reported target Great Ones</span></div><div><strong>${number(summary.other)}</strong><span>Other-animal reports</span></div></div><small>Medals are what you report, not inferred from trophy scores. These counts are not imported game statistics.</small></section><section class="panel"><div class="panel-head"><h2>Recent reports</h2><span class="muted">This grind</span></div><div class="filters">${['target','other','all'].map(k=>button('filter',`${{target:'Target',other:'Other',all:'All'}[k]} (${number(k==='all'?summary.total:summary[k])})`,`data-filter="${k}" aria-pressed="${filter===k}"`)).join('')}</div><section class="medal-summary" data-medal-summary data-scope="${filter}" aria-label="${scopeTitle} reported medal counts"><h3 data-filter-title>${scopeTitle} harvest reports: <span data-report-count>${number(reports.length)}</span></h3><dl class="medal-counts">${Object.entries(medalName).map(([medal,title])=>`<div><dt>${esc(title)}</dt><dd data-medal-count="${medal}">${number(summary.medalCounts[filter][medal])}</dd></div>`).join('')}</dl><small>All ${scopeTitle.toLowerCase()} reports in this grind. Medals are player reported.</small></section><div class="feed">${reports.length?reports.slice(0,20).map(reportCard).join(''):'<p class="empty">No reports in this filter.</p>'}</div>${reports.length>20?`<p class="muted">Latest 20 of ${reports.length} reports shown. Your backup contains the full journal.</p>`:''}</section></div><aside><section class="panel"><h2>Hunting spots</h2><p class="muted">Use map coordinates to save drinking, feeding or resting areas you found.</p><div class="actions" style="margin-top:16px">${button('maps','Open reserve map',`data-reserve="${g.reserve}"`)}</div><details><summary>Manage this grind</summary><p class="muted">Pausing stops new reports for this grind until you continue. No offline command queue or automatic game connection is running.</p><div class="actions" style="margin-top:12px">${g.status!=='finished'?button('finish','Finish grind',`data-id="${g.id}"`):''}${button('start','New grind',doc.grinds.some(x=>x.status==='tracking')?'disabled':'')}</div></details></section><section class="panel"><h2>Your grinds</h2><ul class="history">${doc.grinds.map(x=>`<li>${button('select',`<span>${esc(x.name)}<small>${esc(x.targetSpecies)} · ${x.status}</small></span><span>${grindSummary(doc,x.id).target}</span>`,`data-id="${x.id}"`)}</li>`).join('')}</ul></section></aside></div>`;
}
function mapView(){
 const spots=doc.places.filter(p=>p.reserve===reserve);
 return `<div class="workspace"><section class="panel map-panel"><div class="panel-head"><h1>Maps &amp; spots</h1><label><span class="muted">Reserve</span><select id="map-reserve">${reserveOptions(reserve)}</select></label></div><div class="map-controls">${button('zoom-in','+', 'aria-label="Zoom in"')}${button('zoom-out','−','aria-label="Zoom out"')}${button('fit','Fit spots')}${button('place','Save selected spot',picked?'':'disabled')}</div><svg id="play-map" role="application" aria-label="Hunting reference map"></svg><p id="map-status" class="map-caption">Loading the existing GrindZone map…</p><div class="map-caption"><label class="check"><input type="checkbox" id="terrain" ${doc.settings.terrain?'checked':''}><span>Show reference terrain from DECA. Enabling sends tile requests to the external map provider.</span></label><p id="picked-status">${picked?`Selected point: X ${number(picked.x)} / Z ${number(picked.z)}`:'Tap the map to select a spot. This is an area reference, not automatic animal GPS.'}</p></div></section><section class="panel"><div class="panel-head"><h2>Your saved spots</h2>${button('place','Add coordinates')}</div><div class="spots">${spots.length?spots.map(p=>`<div class="spot"><div><strong>${esc(p.name)}</strong><small>${p.need} · X ${number(p.x)} / Z ${number(p.z)}</small></div>${button('spot-map','Show',`data-id="${p.id}"`)}</div>`).join(''):'<p class="empty">No spots saved on this reserve yet.</p>'}</div><p class="muted" style="margin-top:16px">Public map points are reference locations, not your personal discoveries. Animal populations, health and undiscovered need zones require a supported data source.</p></section></div>`;
}
function backupView(){return `<section class="panel"><div class="panel-head"><h1>Your journal, your backup</h1><span class="muted">Private · browser storage</span></div><p>${doc.grinds.length} grinds · ${doc.reports.length} reports · ${doc.places.length} spots. Last saved ${esc(date(doc.updatedAt))}.</p><p class="muted" style="margin-top:10px">Browser storage can be cleared or evicted. Export a private file regularly. This is not cloud sync, account sign-in, or automatic recovery on a new phone.</p></section><div class="backup-grid" style="margin-top:16px"><section class="panel"><h2>Export</h2><p>Save all reports and spots in a validated GrindZone backup. This file contains private hunting coordinates; share it only deliberately.</p>${button('export','Export private backup','class="primary"')}</section><section class="panel"><h2>Restore on a phone</h2><p>Choose a backup file, review its counts, then confirm replacement. The current browser journal is never silently merged or overwritten.</p>${button('import','Choose backup')}<input id="backup-file" type="file" accept="application/json,.json" class="inline-file"></section></div><section class="panel" style="margin-top:16px"><h2>Additional connections</h2><p class="muted" style="margin:12px 0">The separate PC reader can provide automatic saved-game information. It is optional for this browser journal. These two journals are not automatically merged.</p><a href="../phone/connect">Connect a PC companion</a><details><summary>Remove this browser’s journal</summary><p class="muted">This removes only this workspace’s local journal. It does not change PC saves, other browser copies, or files you exported.</p>${button('erase','Review deletion','class="danger"')}</details></section>`;}
function render(){
 ++generation;map?.destroy();map=null;
 if(fatal){play.innerHTML=`<section class="panel"><h1>Journal could not be opened</h1><p class="unavailable">${esc(fatal)}</p><p class="muted">No replacement journal has been created and existing data has not been erased.</p>${button('retry','Try again')}</section>`;return;}
 if(!doc){play.innerHTML=`<section class="panel intro"><span class="muted">THEHUNTER: CALL OF THE WILD</span><h1 style="margin-top:10px">Your grind. On your phone.</h1><p>Plan on the map, record harvests and keep trophy notes without a Windows download or PC pairing.</p><label>Where do you play?<select id="platform">${options(Object.entries(platformName),'xbox')}</select></label><label class="check"><input type="checkbox" id="local-consent"><span>Save my journal in this browser. I understand it is not linked to an account and I need a backup before clearing data or changing phones.</span></label>${button('create','Start on this phone','class="primary"')}<details><summary>Restore an existing browser backup</summary><p class="muted">Open a private GrindZone browser-journal backup. Not a console game-save file.</p>${button('import','Choose backup')}<input id="backup-file" type="file" accept="application/json,.json" class="inline-file"></details><p class="muted">This workspace currently supports player-entered reports. Automatic console data and account recovery are not yet connected.</p><a href="../phone/connect">Already using the PC companion?</a></section>`;return;}
 play.innerHTML=`${sourceNote()}${foreignChange?`<div class="catalog-error" role="status">This journal changed in another tab. ${button('refresh','Refresh saved progress')}</div>`:''}${catalogError?`<div class="catalog-error">${esc(catalogError)} ${button('catalogs','Retry map catalog')}</div>`:''}<nav class="tabs" aria-label="Browser workspace">${[['hunt','Grind'],['maps','Maps & spots'],['backup','Backup']].map(([key,title])=>button(key,title,`aria-current="${view===key?'page':'false'}"`)).join('')}</nav>${view==='maps'?mapView():view==='backup'?backupView():huntView()}`;
 if(view==='maps')void mountMap(generation);
}
async function mountMap(expected){
 try{
  const r=maps?.reserves.find(r=>r.id===reserve);if(!r)throw Error('This reserve map is unavailable. Retry the catalog; your journal is unchanged.');
  const {FieldMap}=await import('./map.js');if(expected!==generation||view!=='maps')return;
  map=new FieldMap(document.querySelector('#play-map'),()=>{},(point)=>{picked={x:point[0],z:point[1]};document.querySelector('#picked-status').textContent=`Selected point: X ${number(picked.x)} / Z ${number(picked.z)}`;play.querySelector('[data-act=place]').disabled=false;},s=>{const n=document.querySelector('#map-status');if(n)n.textContent=s?.error?'Reference terrain unavailable. Coordinate grid and your spots remain usable.':doc.settings.terrain?'Reference terrain · DECA. Not a live animal feed.':'Coordinate map · reference terrain off';});
  const pins=doc.places.filter(p=>p.reserve===reserve).map(p=>({...p,label:p.name,kind:'last_seen'}));
  if(inspected?.reserve===reserve)pins.push({...inspected,id:'reported-event',label:inspected.label,kind:'last_seen',source:'player_report'});
  map.update({reserve:r,zones:[],pins,terrain:doc.settings.terrain,route:[]});if(inspected?.reserve===reserve)map.focus(inspected.x,inspected.z);
  document.querySelector('#map-status').textContent=doc.settings.terrain?'Reference terrain · DECA.':'Coordinate map · reference terrain off';
 }catch(e){const n=document.querySelector('#map-status');if(expected===generation&&n)n.textContent=e.message;}
}
function openEditor(kind,data={}){
 if(busy)return;pending=null;editor={kind,...data,revision:doc?.revision,id:doc?.id};form.reset();document.querySelector('#edit-error').textContent='';document.querySelector('#review-change').hidden=true;
 const g=active(),species=speciesList();let title,fields;
 if(kind==='start'){title='Start a grind';fields=field('name','Grind name','','required maxlength="100" autocomplete="off"')+field('species','Target species','','required maxlength="100" list="species-list"')+`<label>Reserve<select name="reserve">${reserveOptions(reserve)}</select></label>${species}`;}
 if(kind==='report'){
  editor.grindId=g.id;editor.version=g.version;title='Record a harvest';
  fields=`<p class="muted">Player report for ${esc(g.name)}. No medal or location is inferred.</p>`+field('species','Species',g.targetSpecies,'required maxlength="100" list="species-list"')+`<div class="two-fields">${field('score','Trophy score (optional)','','type="number" min="0" max="1000000" step="any" inputmode="decimal"')}<label>Medal<select name="medal">${options(Object.entries(medalName),'unknown')}</select></label></div><div class="two-fields"><label>Sex<select name="sex">${options([['unknown','Not recorded'],['male','Male'],['female','Female']],'unknown')}</select></label><label>Selected spot<select name="placeId">${options([['','No spot selected'],...doc.places.filter(p=>p.reserve===g.reserve).map(p=>[p.id,p.name])],'')}</select></label></div><details><summary>Record shot or recovery coordinates</summary><p class="muted">Each point belongs only to that observation. Leave unknown coordinates blank.</p>${['shot','death','harvest'].map(k=>`<fieldset><legend>${{shot:'Shot point',death:'Found-dead point',harvest:'Pickup point'}[k]}</legend><div class="two-fields">${field(k+'X','X','','type="number" min="-100000" max="100000" step="any" inputmode="decimal"')}${field(k+'Z','Z','','type="number" min="-100000" max="100000" step="any" inputmode="decimal"')}</div></fieldset>`).join('')}</details><label>Notes<textarea name="notes" maxlength="500"></textarea></label>${species}`;
 }
 if(kind==='place'){title='Save a hunting spot';fields=`<p class="muted">${esc(reserveName(reserve))} · A player-selected area, not confirmed animal GPS.</p>`+field('name','Spot name','','required maxlength="100"')+`<label>Type<select name="need">${options([['pin','Map marker'],['drinking','Drinking area'],['feeding','Feeding area'],['resting','Resting area']],'pin')}</select></label><div class="two-fields">${field('x','Map X',picked?.x??'','type="number" min="-100000" max="100000" step="any" required')}${field('z','Map Z',picked?.z??'','type="number" min="-100000" max="100000" step="any" required')}</div>`;editor.reserve=reserve;}
 if(kind==='finish'){title='Finish this grind?';editor.grindId=g.id;editor.version=g.version;fields=`<p>${esc(g.name)} and all of its reports remain in your journal. You can deliberately continue it later.</p>`;}
 if(kind==='restore'){title='Replace browser journal?';fields=`<p>Backup: ${data.imported.grinds.length} grinds, ${data.imported.reports.length} reports, ${data.imported.places.length} spots.</p><p class="muted">${doc?'This replaces the journal currently saved here. Export it first to retain both.':'This creates a browser journal from your backup.'} Nothing is uploaded or written to a console.</p>${doc?button('export','Export current journal first'):''}`;}
 if(kind==='erase'){title='Delete this browser journal?';fields='<p>This permanently removes the local journal from this browser only. Export a backup first. PC saves and other browser copies are not affected.</p>'+button('export','Export before deleting')+'<label class="check"><input type="checkbox" name="confirmDelete" required><span>I understand this removes the journal saved here.</span></label>';}
 document.querySelector('#editor-title').textContent=title;document.querySelector('#edit-fields').innerHTML=fields;document.querySelector('#edit-save').textContent=kind==='restore'?'Replace with backup':kind==='erase'?'Delete local journal':kind==='finish'?'Finish grind':'Save';dialog.showModal();
}
async function commit(op,data){doc=await storage.execute(doc.id,{id:crypto.randomUUID(),op,expectedRevision:doc.revision,data});foreignChange=false;render();notice('Saved in this browser.');}
async function loadCatalogs(){
 const get=async name=>{const r=await fetch(new URL('catalog/'+name+'.json',import.meta.url),{credentials:'omit',cache:'no-cache'});if(!r.ok)throw Error('Map reference catalog could not load.');return r.json();};
 try{const value=await get('maps');if(value.schema!=='field.reserve_maps.v1'||!Array.isArray(value.reserves))throw Error('Map reference format is unavailable.');maps=value;catalogError=null;}catch(e){catalogError=e.message;}
 try{const value=await get('reference');if(Array.isArray(value.species))references=value;}catch{}
 // The welcome form owns unsaved consent/platform choices; catalogs cannot replace it.
 if(doc&&!dialog.open)render();
}
async function refresh(){try{doc=await storage.read();fatal=null;foreignChange=false;if(!dialog.open)render();}catch(e){fatal=e.message;if(!dialog.open)render();}}
async function chooseBackup(file){if(!file)return;try{if(file.size>JOURNAL_LIMITS.bytes+10000)throw Error('This backup is too large.');const imported=importJournal(await file.text());openEditor('restore',{imported});}catch(e){notice(e.message);}finally{const n=document.querySelector('#backup-file');if(n)n.value='';}}
async function action(target){
 const act=target.dataset.act;if(busy||intake.isOpen())return;
 if(act==='screenshot'){intake.open();return;}
 if(['hunt','maps','backup'].includes(act)){view=act;if(act==='maps'&&target.dataset.reserve){reserve=Number(target.dataset.reserve);picked=null;inspected=null;}render();return;}
 if(act==='create'){if(!document.querySelector('#local-consent').checked){notice('Confirm browser-only storage before starting.');return;}doc=await storage.create(document.querySelector('#platform').value);render();return;}
 if(act==='retry'){await refresh();return;}
 if(act==='catalogs'){await loadCatalogs();return;}
 if(act==='refresh'){await refresh();return;}
 if(act==='select'){selected=target.dataset.id;filter='target';render();return;}
 if(act==='filter'){filter=target.dataset.filter;render();return;}
 if(act==='export'){if(doc)download('GrindZone-private-journal-'+new Date().toISOString().slice(0,10)+'.json',exportJournal(doc));return;}
 if(act==='import'){document.querySelector('#backup-file')?.click();return;}
 if(['start','report','place','finish','erase'].includes(act)){openEditor(act);return;}
 if(act==='pause'||act==='resume'){const g=doc.grinds.find(g=>g.id===target.dataset.id);await commit('grind.'+act,{grindId:g.id,version:g.version});return;}
 if(act==='spot-map'){const p=doc.places.find(p=>p.id===target.dataset.id);if(!p)return;reserve=p.reserve;inspected={...p,label:'Selected spot · '+p.name};picked=null;view='maps';render();return;}
 if(act==='report-map'){const r=doc.reports.find(r=>r.id===target.dataset.id),p=r?.points[target.dataset.kind];if(!p)return;reserve=r.reserve;inspected={...p,reserve:r.reserve,label:target.dataset.kind+' report · '+r.species};picked=null;view='maps';render();return;}
 if(act==='zoom-in')map?.zoom(1/1.4);if(act==='zoom-out')map?.zoom(1.4);if(act==='fit')map?.fitVisible();
}
document.addEventListener('click',event=>{const target=event.target.closest('[data-act]');if(target){event.preventDefault();action(target).catch(e=>notice(e.message));}if(event.target.closest('[data-close]')&&!busy)dialog.close();});
play.addEventListener('change',event=>{
 if(event.target.id==='backup-file')void chooseBackup(event.target.files[0]);
 if(event.target.id==='map-reserve'){reserve=Number(event.target.value);picked=null;inspected=null;render();}
 if(event.target.id==='terrain'){const enabled=event.target.checked;void commit('settings',{terrain:enabled}).catch(e=>{event.target.checked=!enabled;notice(e.message);});}
});
dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
document.querySelector('#review-change').addEventListener('click',async()=>{try{doc=await storage.read();if(!doc||doc.id!==editor.id)throw Error('The journal was replaced. Close this editor and reopen the current journal.');editor.revision=doc.revision;const g=doc.grinds.find(g=>g.id===editor.grindId);if(g)editor.version=g.version;pending=null;foreignChange=false;document.querySelector('#review-change').hidden=true;document.querySelector('#edit-error').textContent='Current progress loaded. Review these fields, then choose Save again.';}catch(e){document.querySelector('#edit-error').textContent=e.message;}});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!editor)return;busy=true;document.querySelector('#edit-save').disabled=true;document.querySelector('#edit-error').textContent='';
 try{
  const f=new FormData(form),kind=editor.kind,formKey=JSON.stringify([...f]);
  if(kind==='restore'){doc=await storage.restore(editor.imported,editor.id?{id:editor.id,revision:editor.revision}:null);selected=null;}
  else if(kind==='erase'){if(!f.get('confirmDelete'))throw Error('Confirm deletion first.');doc=await storage.erase({id:editor.id,revision:editor.revision});selected=null;}
  else {
   if(!pending||pending.formKey!==formKey){let data,op;
    if(kind==='start'){op='grind.start';data={grindId:crypto.randomUUID(),name:f.get('name'),targetSpecies:f.get('species'),reserve:Number(f.get('reserve'))};}
    if(kind==='finish'){op='grind.finish';data={grindId:editor.grindId,version:editor.version};}
    if(kind==='place'){op='place.add';data={placeId:crypto.randomUUID(),name:f.get('name'),reserve:editor.reserve,need:f.get('need'),x:Number(f.get('x')),z:Number(f.get('z'))};}
    if(kind==='report'){
     const points={};for(const k of ['shot','death','harvest']){const x=f.get(k+'X'),z=f.get(k+'Z');if(x!==''||z!==''){if(x===''||z==='')throw Error('Enter both X and Z for each recorded point.');points[k]={x:Number(x),z:Number(z)};}}
     op='report.add';data={reportId:crypto.randomUUID(),grindId:editor.grindId,version:editor.version,species:f.get('species'),score:f.get('score')===''?null:Number(f.get('score')),medal:f.get('medal'),sex:f.get('sex'),placeId:f.get('placeId')||null,points,notes:f.get('notes'),occurredAt:new Date().toISOString()};
    }
    pending={formKey,command:{id:crypto.randomUUID(),op,expectedRevision:editor.revision,data}};
   }
   doc=await storage.execute(editor.id,pending.command);if(kind==='start')selected=pending.command.data.grindId;
  }
  foreignChange=false;dialog.close();editor=null;pending=null;render();notice('Saved in this browser.');
 }catch(e){document.querySelector('#edit-error').textContent=e.message;document.querySelector('#review-change').hidden=e.code!=='conflict';}
 finally{busy=false;document.querySelector('#edit-save').disabled=false;}
});
function connectChanges(){
 if(channel||typeof BroadcastChannel!=='function')return;channel=new BroadcastChannel('grindzone-browser-journal-changes');
 channel.addEventListener('message',()=>{foreignChange=true;if(intake.isOpen()){intake.changed();return;}if(dialog.open){document.querySelector('#edit-error').textContent='Another tab changed this journal. Refresh and review before saving.';document.querySelector('#review-change').hidden=false;}else render();});
}
window.addEventListener('pagehide',()=>{intake.abandon();map?.destroy();channel?.close();channel=null;void storage.close();});
window.addEventListener('pageshow',event=>{if(event.persisted){connectChanges();void refresh();}});
connectChanges();await refresh();void loadCatalogs();
