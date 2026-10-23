import {esc} from './data-client.js';
import {speciesName} from './species-style.js';
import {setupItems,defaultStopSetup} from './setup-catalog.js';
export {setupItems,defaultStopSetup} from './setup-catalog.js';
const located=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.z);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export const cashLabel=value=>Number.isFinite(value)?Math.round(value).toLocaleString()+' cash':'Price needed';
export function nearbyGear(state,zone,reserve,range=300){
 if(!located(zone))return {equipment:[],structures:[],unidentified:0};
 const nearby=items=>items.filter(p=>located(p)&&distance(p,zone)<=range).map(p=>({...p,distance:distance(p,zone)})).sort((a,b)=>a.distance-b.distance||String(a.id).localeCompare(String(b.id)));
 const saved=nearby((state.equipment||[]).filter(p=>p.reserve===reserve&&p.source==='save'));
 const identified=p=>p.typeVerified===true&&p.canRename===true&&typeof p.renameId==='string';
 return {equipment:saved.filter(identified),unidentified:saved.filter(p=>!identified(p)).length,structures:nearby((state.reserves?.find(r=>r.id===reserve)?.poi||[]).filter(p=>['hunting_blind','machan'].includes(p.kind)))};
}
export function routeSetupModel(state,reserve){
 const settings=state.routeSetup||{version:0,nearbyMeters:300,prices:[],stops:[]},range=settings.nearbyMeters??300,prices=new Map((settings.prices||[]).map(p=>[p.item,p.price]));
 const unitPrice=item=>prices.has(item)?{price:prices.get(item),source:'Your estimate'}:{price:setupItems[item]?.price??null,source:setupItems[item]?.priceSource?'Reference price':'Price needed'};
 const unique=new Set(),purchase=new Map(),usedGear=new Set(),structurePlans=new Map(),rows=[];let knownCost=0,unknownCosts=0,missingStops=0,structureConflicts=0;
 for(const [index,id] of (state.route||[]).entries()){
  if(unique.has(id))continue;unique.add(id);
  const zone=state.zones?.find(z=>z.id===id),plan={...defaultStopSetup,...settings.stops?.find(p=>p.zoneId===id)},nearby=nearbyGear(state,zone,reserve,range);
  if(!located(zone)){missingStops++;rows.push({id,number:index+1,zone,plan,nearby,slots:[],missing:true});continue;}
  const slot=(name,choice,item)=>{
   if(choice==='none')return {name,item,status:'skip',cost:0};
   if(choice==='bring')return {name,item,status:'bring',cost:0};
   if(choice==='structure'){
    const structure=nearby.structures.find(p=>p.canRename===true&&p.renameId===plan.structureId);
    return {name,item:null,status:structure?(plan.structureBuilt?'built':'check'):'missing_structure',nearby:structure,cost:structure?(plan.structureBuilt?0:plan.structureCost):null,priceSource:'Your estimate'};
   }
   const saved=choice==='auto'?nearby.equipment.find(p=>name==='stand'?['tripod','treestand','blind'].includes(p.kind):p.kind===setupItems[item]?.kind&&(p.kind!=='feeder'||String(p.originalLabel||'').toUpperCase()===setupItems[item]?.saveName)):null;
   if(saved){usedGear.add(saved.renameId);return {name,item,status:'nearby',nearby:saved,cost:0};}
   const cost=unitPrice(item);purchase.set(item,(purchase.get(item)||0)+1);
   return {name,item,status:'needed',cost:cost.price,priceSource:cost.source,unidentified:nearby.unidentified};
  };
  const slots=[slot('tent',plan.tent,'tent'),slot('stand',plan.stand,plan.standType),slot('feeder',plan.feeder,plan.feederType)];
  for(const s of slots){
   if(s.name==='stand'&&plan.stand==='structure'&&plan.structureId){const shared=structurePlans.get(plan.structureId)||[];shared.push(s);structurePlans.set(plan.structureId,shared);}
   else if(Number.isFinite(s.cost))knownCost+=s.cost;else unknownCosts++;
  }
  rows.push({id,number:index+1,zone,plan,nearby,slots,missing:false});
 }
 for(const slots of structurePlans.values()){
  const first=slots[0],conflict=slots.some(s=>s.status!==first.status||s.cost!==first.cost);
  if(conflict){structureConflicts++;unknownCosts++;for(const s of slots){s.status='conflicting_structure';s.cost=null;}}
  else if(Number.isFinite(first.cost))knownCost+=first.cost;else unknownCosts++;
 }
 const feederStops=rows.filter(r=>r.plan.feeder!=='none'&&!r.missing),feederConflicts=[];
 for(let i=0;i<feederStops.length;i++)for(let j=i+1;j<feederStops.length;j++){
  const a=feederStops[i],b=feederStops[j],aGear=a.slots.find(s=>s.name==='feeder')?.nearby?.renameId,bGear=b.slots.find(s=>s.name==='feeder')?.nearby?.renameId;
  if(aGear&&aGear===bGear)continue;
  if(distance(a.slots.find(s=>s.name==='feeder')?.nearby||a.zone,b.slots.find(s=>s.name==='feeder')?.nearby||b.zone)<300)feederConflicts.push([a.number,b.number]);
 }
 const existingFeeders=new Set((state.equipment||[]).filter(e=>e.reserve===reserve&&e.typeVerified&&e.kind==='feeder'&&e.renameId).map(e=>e.renameId)).size,additionalFeeders=rows.reduce((n,r)=>n+r.slots.filter(s=>s.name==='feeder'&&['needed','bring'].includes(s.status)).length,0);
 return {rows,range,knownCost,unknownCosts,missingStops,structureConflicts,hasFeeders:feederStops.length>0,uniqueNearbyGear:usedGear.size,purchase:[...purchase].filter(([item])=>item).map(([item,count])=>({item,count,...unitPrice(item)})),feederConflicts,feederLimitExceeded:existingFeeders+additionalFeeders>8,settings};
}
const slotLabel=s=>s.status==='skip'?'Off':s.status==='nearby'?`Nearby · ${Math.round(s.nearby.distance)} m`:s.status==='bring'?'Use mine':s.status==='built'?'Built structure':s.status==='check'?'Check structure':s.status==='conflicting_structure'?'Check shared plan':s.status==='missing_structure'?'Structure unavailable':'To place';
export function setupView(state,reserve){
 const model=routeSetupModel(state,reserve);
 return `<section class="setup-budget"><div><span>Gear budget</span><strong>${cashLabel(model.knownCost)}${model.unknownCosts?' + prices needed':''}</strong><small>${model.purchase.length?model.purchase.map(p=>`${p.count} ${esc(setupItems[p.item].name)}${p.count===1?'':'s'}`).join(' · '):'No new portable gear planned'}</small></div><button class="button subtle" data-action="setup-budget">Prices & range</button><p>Estimated in-game cash. Nearby means within ${model.range} m; check placement in the game.${model.missingStops?` ${model.missingStops} missing stops excluded.`:''}${model.hasFeeders?' Feed and refill costs are extra.':''}</p></section>${model.structureConflicts?'<p class="setup-warning">Shared structure plans disagree. Check their build status and cost before using this budget.</p>':''}${model.feederLimitExceeded?'<p class="setup-warning">This plan goes beyond the published limit of 8 feeders per map. Check your deployed feeders.</p>':''}${model.feederConflicts.length?`<p class="setup-warning">Feeder plans at stops ${model.feederConflicts.map(p=>p.join(' & ')).join(', ')} are under 300 m apart. Adjust their positions in game.</p>`:''}<div class="setup-stops">${model.rows.map(row=>`<article class="setup-stop"><div class="setup-stop-title"><span class="number">${row.number}</span><strong>${row.zone?(row.zone.annotation?.name?esc(row.zone.annotation.name):speciesName(row.zone.species,row.zone.speciesKey)):'Saved stop unavailable'}</strong>${row.missing?'':`<button class="button small subtle" data-action="setup-stop" data-id="${esc(row.id)}" aria-label="Set up stop ${row.number}">Set up</button>`}</div>${row.missing?'<p>Restore this spot to plan its gear.</p>':`<div class="setup-slots">${row.slots.map(s=>`<span class="${s.status==='needed'?'needed':''}"><b>${s.name==='tent'?'Tent':s.name==='stand'?'Stand':'Feeder'}</b>${slotLabel(s)}</span>`).join('')}</div>`}</article>`).join('')}</div>`;
}
