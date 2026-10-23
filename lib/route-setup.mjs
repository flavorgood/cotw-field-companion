import {hash,reserveId} from './core.mjs';
import {setupItems,feederItems,standItems,defaultStopSetup} from '../public/setup-catalog.js';
const invalid=message=>Object.assign(Error(message),{status:400});
const conflict=()=>Object.assign(Error('This setup changed. Refresh before saving.'),{status:409});
const cash=value=>value===null||(Number.isSafeInteger(value)&&value>=0&&value<=10000000);
const key=(profile,reserve)=>`route-budget:${profile}:${reserve}`;
export function routeSetupState(store,profile,reserve){
 const budget=store.get(key(profile,reserve),{version:0,nearbyMeters:300,prices:[]});
 return {...budget,stops:store.journal(profile,'routeSetups').filter(s=>s.reserve===reserve)};
}
export function routeSetupCommand(store,profile,body,{route=[],structures=[]}={}){
 const reserve=reserveId(body.reserve),state=routeSetupState(store,profile,reserve);
 if(body.op==='route.setup'){
  const allowed=['op','requestId','reserve','zoneId','version','tent','stand','standType','feeder','feederType','structureId','structureBuilt','structureCost'];
  if(Object.keys(body).some(k=>!allowed.includes(k))||typeof body.zoneId!=='string'||!route.includes(body.zoneId))throw invalid('Choose a current route stop');
  const current=state.stops.find(s=>s.zoneId===body.zoneId)||defaultStopSetup;
  if(body.version!==current.version)throw conflict();
  const s={...current,...Object.fromEntries(allowed.slice(5).filter(k=>Object.hasOwn(body,k)).map(k=>[k,body[k]]))};
  if(!['auto','bring','buy','none'].includes(s.tent)||!['auto','bring','buy','structure','none'].includes(s.stand)||!standItems.includes(s.standType)||!['none','auto','bring','buy'].includes(s.feeder))throw invalid('Choose a valid equipment plan');
  if(s.feeder!=='none'&&!feederItems.includes(s.feederType))throw invalid('Choose a feeder type');
  if(s.feederType!==null&&!feederItems.includes(s.feederType))throw invalid('Unknown feeder type');
  if(typeof s.structureBuilt!=='boolean'||!cash(s.structureCost))throw invalid('Use a whole in-game cash amount');
  if(s.structureId!==null&&(typeof s.structureId!=='string'||!structures.some(p=>p.canRename===true&&p.renameId===s.structureId&&['hunting_blind','machan'].includes(p.kind))))throw invalid('Choose a nearby hunting structure');
  if(s.stand==='structure'&&!s.structureId)throw invalid('Choose the hunting structure');
  return store.put(profile,'routeSetups',{id:hash(['route-setup',profile,reserve,body.zoneId]),reserve,zoneId:body.zoneId,...Object.fromEntries(Object.keys(defaultStopSetup).map(k=>[k,s[k]])),version:current.version+1});
 }
 if(body.op==='route.price'||body.op==='route.budget'){
  const allowed=body.op==='route.price'?['op','requestId','reserve','version','item','price']:['op','requestId','reserve','version','nearbyMeters','item','price'];
  if(Object.keys(body).some(k=>!allowed.includes(k)))throw invalid('Unsupported budget setting');
  if(body.version!==state.version)throw conflict();
  let prices=state.prices,nearbyMeters=state.nearbyMeters;
  if(body.op==='route.price'||body.item){
   if(!Object.hasOwn(setupItems,body.item)||!cash(body.price))throw invalid('Choose equipment and a whole in-game cash price');
   prices=[...prices.filter(p=>p.item!==body.item),{item:body.item,price:body.price}];
  }
  if(body.op==='route.budget'){
   if(!Number.isInteger(body.nearbyMeters)||body.nearbyMeters<50||body.nearbyMeters>1000)throw invalid('Nearby range must be 50–1000 metres');
   nearbyMeters=body.nearbyMeters;
  }
  const result={version:state.version+1,nearbyMeters,prices};store.set(key(profile,reserve),result);return result;
 }
 throw invalid('Unsupported setup action');
}
