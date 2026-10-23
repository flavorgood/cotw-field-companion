import {getCatalog,esc,safePreference,savePreference} from './data-client.js';
import {ReferencePanel} from './reference.js';
import {FieldLibrary} from './field-library.js';
import {ShareStudio} from './studio.js';
import {CareerScreen} from './career.js';
import {MapAtlas} from './map-atlas.js';
import {FeedbackPanel} from './feedback.js';
const root=document.querySelector('#content'),picker=document.querySelector('#reserve');
const careerScreen=new CareerScreen(root);
const views=['home','maps','reserves','reference','rares','gear','studio','career','faq','feedback'];
let view=views.includes(location.hash.slice(1))?location.hash.slice(1):'home',reserve=19,catalog=null,demoState=null;
const feedback=new FeedbackPanel(root,()=>{if(view==='feedback')render();},{endpoint:globalThis.COTW_FEEDBACK_ENDPOINT||document.querySelector('meta[name="cotw-feedback-endpoint"]')?.content||''});

function demoCounter(key,label,value,display=0,extra={}){return {key,label,value,display,computed:false,...extra};}
function makePublicDemoState(source){
 const reserves=source?.reserves||[];
 const allMaps=reserves.map((r,index)=>({id:r.id,name:r.name,available:true,zoneCount:18+(index%7),equipmentCount:7+(index%4),stats:[
  {key:String(r.id)+'_world_explored',value:0.42+(index%5)*0.06,display:1},
  {key:String(r.id)+'_distance_walked',value:18+(index*3.7),display:2},
  {key:String(r.id)+'_missions_main',value:4+(index%6)},
  {key:String(r.id)+'_missions_side',value:2+(index%5)},
  {key:String(r.id)+'_outposts',value:3+(index%4)}
 ]}));
 const counters=[
  demoCounter('harvests_gold','Gold',184),demoCounter('harvests_platinum','Diamond',37),demoCounter('harvests_greatone','Great Ones',2),
  demoCounter('harvests_silver','Silver',246),demoCounter('harvests_bronze','Bronze',119),demoCounter('harvests_copper','Other harvests',31),
  demoCounter('shots_hit','Shots hit',2840),demoCounter('shots_missed','Shots missed',1134),demoCounter('animals_spooked_hearing','Animals scared by noise',96),
  demoCounter('animals_spooked_eyesight','Animals scared by sight',58),demoCounter('animals_spooked_scent','Animals scared by scent',41),
  demoCounter('mp_competitions','Multiplayer competitions won',12),demoCounter('mp_coop_harvests','Cooperative harvests',74),
  demoCounter('accuracy_rifles','Rifles',0.674,1,{accuracySamples:1875}),demoCounter('accuracy_handguns','Handguns',0.492,1,{accuracySamples:284}),
  demoCounter('accuracy_shotguns','Shotguns',0.588,1,{accuracySamples:612}),demoCounter('accuracy_bows','Bows',0.381,1,{accuracySamples:403}),
  demoCounter('perks_rifles','Rifle perks',18),demoCounter('perks_handguns','Handgun perks',7),demoCounter('perks_shotguns','Shotgun perks',11),demoCounter('perks_bows','Bow perks',9),
  demoCounter('skills_active','Stalker points spent',21),demoCounter('skills_passive','Ambusher points spent',17)
 ];
 return {publicMode:true,demo:true,career:{status:'ok',sourceStatus:'ok',summary:{lifetimeHarvests:617,greatOnes:2,shotsFired:3974,accuracy:0.625,longestShot:412.6,spooked:195,deaths:3,hits:2840,misses:1134},profile:{level:60,xp:482910,cash:168430,skillPoints:4,perkPoints:3},counters,allMaps,unharvested:23,unharvestedSavedAt:'2026-09-01T12:00:00.000Z',retainedHarvests:96,shotReconciliation:{accuracyDenominator:3974,consistent:true},killCoverage:'This fictional sample shows the kind of career totals the companion can present.',coverage:{conflicts:[],source:'Fictional public demo fixture'},savedAt:'2026-09-01T12:00:00.000Z'}};
}
const reference=new ReferencePanel(root,()=>{if(view==='reference')render();});
const library=new FieldLibrary(root,()=>{if(['home','reserves','gear','rares','faq'].includes(view))render();},navigate);
const studio=new ShareStudio(root);
const atlas=new MapAtlas(root,()=>{if(view==='maps')render();});
function navigate(next,r){if(!views.includes(next))return;if(r!==undefined){reserve=Number(r);picker.value=String(reserve);}view=next;const url=new URL(location.href);url.hash=view;url.searchParams.set('reserve',reserve);history.replaceState(null,'',url);render();window.scrollTo({top:0,behavior:'smooth'});}
function render(){document.body.dataset.view=view;if(view!=='maps')atlas.suspend();document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===view?'page':'false'));if(view==='maps')root.innerHTML=atlas.render(reserve);else if(view==='reference')root.innerHTML=reference.render(reserve);else if(view==='studio')root.innerHTML=studio.render(demoState||{publicMode:true});else if(view==='career')root.innerHTML=careerScreen.render(demoState||{publicMode:true});else if(view==='feedback')root.innerHTML=feedback.render();else root.innerHTML=library.render(view,reserve);if(view==='career')careerScreen.restoreFocus();}
root.addEventListener('click',e=>{const reserveLink=e.target.closest('[data-career-reserve]');if(reserveLink){navigate('maps',reserveLink.dataset.careerReserve);return;}const b=e.target.closest('[data-action="view-studio"]');if(b)navigate('studio');});
document.querySelector('nav').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)navigate(b.dataset.view);});
picker.addEventListener('change',()=>{reserve=Number(picker.value);savePreference('reference-reserve',reserve);navigate(view,reserve);});
window.addEventListener('hashchange',()=>{const v=location.hash.slice(1);if(views.includes(v)){view=v;render();}});
try{catalog=await getCatalog('reference');demoState=makePublicDemoState(catalog);const requested=Number(new URL(location.href).searchParams.get('reserve')??safePreference('reference-reserve',19));reserve=catalog.reserves.some(r=>r.id===requested)?requested:19;picker.innerHTML=catalog.reserves.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('');picker.value=String(reserve);render();}catch(e){root.innerHTML=`<section class="panel"><h1>Library unavailable</h1><p>${esc(e.message)}</p><p>Reload the page when your connection is available. No player data has been requested.</p></section>`;}
