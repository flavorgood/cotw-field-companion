import {locationQuery,projectLocationPage} from './hunt-locations.mjs';
import {herdQuery,projectHerdView} from './herd-view.mjs';
/** Opt-in outbound phone relay. No filesystem access, raw save transport, or arbitrary URL proxy. */
import {randomUUID} from 'node:crypto';
import {projectSaveData,SAVE_DATA_SCHEMA} from './save-data.mjs';
import {projectPhonePressure} from './hunting-pressure.mjs';
import {projectZoneData,validateZonePhoneCommand,projectZoneCommandResult} from './zone-phone.mjs';

export const PHONE_PROTOCOL='cotw.phone.v1';
export const PHONE_MAX_BYTES=2*1024*1024;
const MAX_ITEMS=5000;
const fields=(value,names)=>Object.fromEntries(names.split(' ').filter(k=>Object.hasOwn(value??{},k)).flatMap(k=>{
  const v=value[k];return v===null||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v))||typeof v==='string'&&v.length<=4000?[[k,v]]:[];
}));
const rows=(value,project,max=MAX_ITEMS)=>{if(!Array.isArray(value))return [];if(value.length>max)throw Error('Phone view exceeds its item limit');return value.map(project);};
const annotation=v=>v?fields(v,'id zoneId strategy name notes updatedAt'):null;
const counter=v=>fields(v,'key label value display computed visible accuracySamples accuracySum');
const sourceNames=new Set(['statistics_adf','thp_player_profile_adf','playerinformation_adf','found_need_zones_adf','hunting_log_adf','worlditemsdata_adf','reserveworlddata_adf']);
const sourceName=v=>typeof v==='string'&&(sourceNames.has(v)||/^animal_population_\d{1,3}$/.test(v));
const sourceStatus=v=>['ok','missing','not_found','error','unsupported','unavailable','changed'].includes(v)?v:'unavailable';
const observation=v=>fields(v,'id type observedAt createdAt source x z notes harvestId');
const encounter=v=>({...fields(v,'id reserve species notes search version createdAt sessionId shots outcome label lastObservationAt terminal'),evidence:rows(v.evidence,observation,500)});
const zone=v=>({...fields(v,'id reserve zoneId scheduleIndex x z start end need source species speciesKey groups males females association createdAt'),annotation:annotation(v.annotation)});
const placeFields='renameId canRename renameUnavailableReason originalLabel customLabel';
const routeOptimization=v=>v?fields(v,'mode status startZoneId savedMeters distanceMeters originalDistanceMeters usesHours missingCount unknownHoursCount version'):null;
const stopSetup=v=>fields(v,'id reserve zoneId version tent stand standType feeder feederType structureId structureBuilt structureCost');
const setupBudget=v=>({...fields(v,'version nearbyMeters'),prices:rows(v?.prices,p=>fields(p,'item price'),30)});
const pin=v=>fields(v,'id reserve kind label x z notes source createdAt '+placeFields);
const harvest=v=>fields(v,'id species speciesHash score medalCode timestamp origin firstSeen linkedEncounter');
function sessionActivity(summary){
 if(!Object.hasOwn(summary,'activity'))return {};
 const value=summary.activity;
 if(!value||typeof value!=='object'||Array.isArray(value)||!['all','target','other'].every(key=>Array.isArray(value[key])))return {activity:null};
 return {activity:Object.fromEntries(['all','target','other'].map(key=>[key,rows(value[key],r=>fields(r,'id species score timestamp'),20)]))};
}
const session=v=>({...fields(v,'id reserve name startedAt endedAt pausedAt targetSpecies goal'),version:Number.isSafeInteger(v.version)&&v.version>0?v.version:1,harvestSummary:v.harvestSummary?{...fields(v.harvestSummary,'total scope timeBasis reserveScope targetTotal bestScore averageScore activeSeconds runs lastHarvestAt'),bySpecies:rows(v.harvestSummary.bySpecies,r=>fields(r,'species count'),2000),recent:rows(v.harvestSummary.recent,r=>fields(r,'id species score timestamp'),6),...sessionActivity(v.harvestSummary)}:null});
const change=v=>({...fields(v,'at boundary kind resetPossible killsInferred'),changed:rows(v.changed,c=>fields(c,'key before after delta'),2000),changes:rows(v.changes,c=>fields(c,'speciesHash appeared disappeared total'),500)});

/** Explicit presentation schema: future save/parser fields are excluded by default. */
export function projectPhoneState(value){
  if(!value||typeof value!=='object')throw Error('PC view is unavailable');
  const c=value.career,o=value.observer??{};
  const career=c?{
    ...fields(c,'status savedAt checkedAt sourceStatus unharvested unharvestedSavedAt lifetimeKills killCoverage retainedHarvests recentScope'),
    profile:c.profile?fields(c.profile,'level xp cash skillPoints perkPoints'):null,
    counters:rows(c.counters,counter,2000),
    allMaps:rows(c.allMaps,r=>({...fields(r,'id name available zoneCount equipmentCount shotsFired kills harvests attribution'),stats:rows(r.stats,counter,2000)}),100),
    shotReconciliation:fields(c.shotReconciliation,'displayedShots accuracyDenominator consistent'),
    coverage:{source:'statistics_adf',conflicts:rows(c.coverage?.conflicts,()=> 'Withheld conflicting counter',2000),mapCount:Number.isInteger(c.coverage?.mapCount)?c.coverage.mapCount:null},
    summary:fields(c.summary,'shotsFired hits misses accuracy lifetimeHarvests diamonds greatOnes longestShot spooked deaths')
  }:null;
  const result={
    ...fields(value,'selectedReserve harvestCount candidateNotice'),...projectZoneData(value),
    ...(Array.isArray(value.huntSpeciesOptions)?{huntSpeciesOptions:rows(value.huntSpeciesOptions,v=>typeof v==='string'&&v.length>0&&v.length<=120?v:null,500).filter(Boolean)}:{}),
    app:fields(value.app,'name version release startedAt'),
    phone:{mode:'live_relay',receivedAt:new Date().toISOString(),privateDiagnosticsExcluded:true},
    reserves:rows(value.reserves,r=>({...fields(r,'id name available zoneCount'),status:sourceStatus(r.status),poi:r.id===value.selectedReserve?rows(r.poi,p=>fields(p,'id label '+placeFields),2000):[]}),100),
    settings:fields(value.settings,'spoilers terrain'),
    observer:{...fields(o,'connected busy lastCycle intervalMs readCount readOnly permissionWriteBlocked'),error:o.error?'The PC observer needs attention. Check the companion on the PC.':null,
      sources:rows(o.sources,s=>sourceName(s.name)?{name:s.name,...fields(s,'mtime checked'),status:sourceStatus(s.status),error:s.error?'This source needs attention on the PC.':null}:null,2000).filter(Boolean)},
    career,careerChanges:rows(value.careerChanges,change,100),
    huntingPressure:projectPhonePressure(value.huntingPressure,value.selectedReserve),
    zones:rows(value.zones,zone),pins:rows(value.pins,pin),
    equipment:rows(value.equipment,v=>({...fields(v,'id reserve x z label kind typeVerified source '+placeFields),bait:rows(v.bait,b=>fields(b,'amount destroyed'),100)})),
    encounters:rows(value.encounters,encounter,1000),harvests:rows(value.harvests,harvest,500),sessions:rows(value.sessions,session,2000),
    route:rows(value.route,v=>typeof v==='string'&&v.length<=200?v:null,MAX_ITEMS).filter(v=>v!==null),
    routeOptimization:routeOptimization(value.routeOptimization),
    routeSetup:{...setupBudget(value.routeSetup),stops:rows(value.routeSetup?.stops,stopSetup,MAX_ITEMS)},
    population:value.population===null?null:rows(value.population,v=>fields(v,'key name total males candidates coverage'),500),
    changes:value.changes===null?null:rows(value.changes,change,100),coverageEvents:rows(value.coverageEvents,change,100)
  };
  const visible=new Set([...result.pins,...result.equipment].filter(p=>p.reserve===result.selectedReserve&&p.canRename===true).map(p=>p.renameId));
  for(const r of result.reserves)if(r.id===result.selectedReserve)for(const p of r.poi)if(p.canRename===true)visible.add(p.renameId);
  result.placeLabels=rows(value.placeLabels,p=>fields(p,'placeId label')).filter(p=>typeof p.placeId==='string'&&p.placeId.length<=200&&visible.has(p.placeId)&&typeof p.label==='string'&&p.label.length>0&&p.label.length<=120);
  // Optional save summaries must not displace the core paired hunting view.
  const saveDataRoom=PHONE_MAX_BYTES-4096-Buffer.byteLength(JSON.stringify(result))-32;
  if(result.career&&c?.saveData){
    if(saveDataRoom>=1024)result.career.saveData=projectSaveData(c.saveData,{spoilers:result.settings.spoilers===true,reserve:result.selectedReserve,maxBytes:saveDataRoom});
    else if(saveDataRoom>=100)result.career.saveData={schema:SAVE_DATA_SCHEMA,status:'byte_limit'};
  }
  if(Buffer.byteLength(JSON.stringify(result))>PHONE_MAX_BYTES-4096)throw Error('Phone view exceeds its byte limit');
  return result;
}

export function projectPhoneExport(state){
  const p=projectPhoneState(state);
  return {format:'cotw-phone-view',version:1,exportedAt:new Date().toISOString(),scope:'Current reserve, retained phone view and available all-reserve save summaries; private PC diagnostics excluded',saveData:p.career?.saveData??null,selectedReserve:p.selectedReserve,settings:p.settings,zones:p.zones,pins:p.pins,placeLabels:p.placeLabels,encounters:p.encounters,harvests:p.harvests,sessions:p.sessions,route:p.route,routeOptimization:p.routeOptimization,routeSetup:p.routeSetup,...projectZoneData(state)};
}

const commandFields={
  'route.setup':'reserve zoneId version tent stand standType feeder feederType structureId structureBuilt structureCost',
  'route.price':'reserve version item price',
  'route.budget':'reserve version nearbyMeters item price',
  'encounter.create':'reserve species notes x z observedAt',
  'encounter.evidence':'id version type observedAt notes x z harvestId sameAnimal',
  'encounter.search':'id version search',
  'route.reorder':'reserve order expectedOrder expectedVersion',
  'route.mode':'reserve mode expectedOrder expectedVersion',
  'route.start':'reserve zoneId expectedOrder expectedVersion',
  'zone.annotate':'zoneId strategy name notes',
  'zone.rename':'zoneId name',
  'zone.create':'reserve species need x z start end',
  'pin.create':'reserve kind label x z notes',
  'pin.delete':'id',
  'place.rename':'id label',
  'route.toggle':'reserve zoneId',
  'session.start':'reserve name targetSpecies goal',
  'session.update':'id version reserve name targetSpecies goal',
  'session.pause':'id version',
  'session.resume':'id version',
  'session.end':'id version',
  'settings':'spoilers confirmSpoilers terrain',
  'observer.scan':''
};
export function validatePhoneCommand(body){
  if(validateZonePhoneCommand(body))return body;
  if(!body||typeof body!=='object'||Array.isArray(body)||!Object.hasOwn(commandFields,body.op))throw Object.assign(Error('This action is not available from a phone'),{status:403});
  if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId))throw Object.assign(Error('A request identity is required'),{status:400});
  if(Buffer.byteLength(JSON.stringify(body))>32768)throw Object.assign(Error('Action is too large'),{status:413});
  const allowed=new Set(['op','requestId',...commandFields[body.op].split(' ').filter(Boolean)]);
  for(const [key,value]of Object.entries(body)){
    if(!allowed.has(key))throw Object.assign(Error('Unsupported action field'),{status:400});
    if(Array.isArray(value)){
      if(!['order','expectedOrder'].includes(key)||value.length>MAX_ITEMS||value.some(v=>typeof v!=='string'||v.length>200))throw Object.assign(Error('Invalid route'),{status:400});
    }else if(value!==null&&!['string','number','boolean'].includes(typeof value)||typeof value==='string'&&value.length>4000||typeof value==='number'&&!Number.isFinite(value))throw Object.assign(Error('Invalid action field'),{status:400});
  }
  if(body.op.startsWith('session.')&&body.op!=='session.start'&&(typeof body.id!=='string'||!body.id||body.id.length>200||!Number.isSafeInteger(body.version)||body.version<1))throw Object.assign(Error('Grind identity and version are required'),{status:400});
  if(body.op==='place.rename'&&(typeof body.id!=='string'||!body.id.trim()||body.id!==body.id.trim()||body.id.length>200||typeof body.label!=='string'||body.label.trim().length>120))throw Object.assign(Error('Choose a place and a name of at most 120 characters'),{status:400});
  if(body.op==='zone.rename'&&(typeof body.zoneId!=='string'||!body.zoneId.trim()||body.zoneId!==body.zoneId.trim()||body.zoneId.length>200||typeof body.name!=='string'||body.name.trim().length>120))throw Object.assign(Error('Choose a spot and a name of at most 120 characters'),{status:400});
  if(['route.mode','route.start'].includes(body.op)&&(!Array.isArray(body.expectedOrder)||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1||body.op==='route.mode'&&!['auto','manual'].includes(body.mode)||body.op==='route.start'&&(typeof body.zoneId!=='string'||!body.zoneId||body.zoneId.length>200)))throw Object.assign(Error('Current route identity and preferences are required'),{status:400});
  return body;
}

/** Preserve the local API's result shape without passing future/private fields through. */
export function projectPhoneCommandResult(op,result){
  if(['zone.track','zone.loss'].includes(op))return projectZoneCommandResult(op,result);
  const routeIds=value=>{if(!Array.isArray(value)||value.length>MAX_ITEMS||value.some(v=>typeof v!=='string'||v.length>200))throw Error('Invalid route result');return [...value];};
  if(op==='route.toggle')return {route:routeIds(result?.route)};
  if(op==='route.setup')return stopSetup(result);
  if(op==='route.price'||op==='route.budget')return setupBudget(result);
  if(op==='route.reorder')return routeIds(result);
  if(op==='route.mode'||op==='route.start')return {route:routeIds(result?.route),routeOptimization:routeOptimization(result?.routeOptimization)};
  if(op.startsWith('encounter.'))return encounter(result??{});
  if(op==='zone.annotate'||op==='zone.rename')return annotation(result);
  if(op==='zone.create')return zone(result??{});
  if(op==='pin.create')return pin(result??{});
  if(op==='pin.delete')return fields(result,'id removed');
  if(op==='place.rename')return fields(result,'id placeId label updatedAt');
  if(op.startsWith('session.'))return session(result??{});
  if(op==='settings')return fields(result,'spoilers terrain');
  if(op==='observer.scan')return fields(result,'scanned lastCycle');
  throw Error('Unsupported command result');
}

export function phoneRelayOrigin(input,{allowInsecureLoopback=false}={}){
  let u;try{u=new URL(input);}catch{throw Error('Phone relay requires a valid HTTPS address');}
  if(u.username||u.password||!['/','/grindzone','/grindzone/'].includes(u.pathname)||u.search||u.hash||u.protocol!=='https:'&&!(allowInsecureLoopback&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('Phone relay requires an HTTPS origin');
  return u.origin+(u.pathname==='/'?'':'/grindzone');
}

export async function provisionPhoneDevice({relayUrl,enrollmentToken,allowInsecureLoopback=false,fetchImpl=fetch,timeoutMs=90000}={}){
  const origin=phoneRelayOrigin(relayUrl,{allowInsecureLoopback});
  if(typeof enrollmentToken!=='string'||enrollmentToken.length>2048||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]{43}$/.test(enrollmentToken))throw Error('This PC needs a private phone-access enrollment credential');
  const response=await fetchImpl(origin+'/phone/device',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+enrollmentToken},body:'{}',redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw Error('Phone service could not create a connection. Try again later.');
  const value=await response.json();
  if(typeof value.deviceToken!=='string'||value.deviceToken.length>2048||!/^[a-zA-Z0-9_-]{43}$/.test(value.deviceId))throw Error('Phone service returned an invalid connection');
  return {deviceToken:value.deviceToken,deviceId:value.deviceId};
}

export function createPhoneBridge({relayUrl,deviceToken,readState,runCommand,readHerds,readLocations,onStatus=()=>{},onPairing=()=>{},allowInsecureLoopback=false,WebSocketImpl=globalThis.WebSocket,connectTimeoutMs=90000,reconnectMs=1000}={}){
  const origin=phoneRelayOrigin(relayUrl,{allowInsecureLoopback});
  if(typeof deviceToken!=='string'||deviceToken.length>2048||!deviceToken||typeof readState!=='function'||typeof runCommand!=='function')throw Error('Phone bridge requires a device credential and scoped PC operations');
  let socket=null,enabled=false,status='disabled',generation=0,retry=null,first=null,inflight=0,reconnectAttempt=0;
  const pairRequests=new Map();
  const update=s=>{status=s;onStatus({status:s});};
  const send=(s,value)=>{const data=JSON.stringify(value);if(Buffer.byteLength(data)>PHONE_MAX_BYTES)throw Error('Phone message is too large');if(s.readyState===1)s.send(data);};
  function rejectPairing(){for(const item of pairRequests.values()){clearTimeout(item.timer);item.reject(Error('Phone connection changed; request a new pairing link.'));}pairRequests.clear();}
  function open(){
    if(!enabled)return;
    const current=++generation,s=new WebSocketImpl(origin.replace(/^http/,'ws')+'/phone/bridge',[PHONE_PROTOCOL,'cotw-auth.'+deviceToken]);socket=s;update('connecting');
    const handshake=setTimeout(()=>{if(s.readyState!==1||status!=='connected')s.close();},10000);handshake.unref?.();
    s.addEventListener('message',async event=>{
      if(current!==generation||!enabled)return;
      if(typeof event.data!=='string'||Buffer.byteLength(event.data)>PHONE_MAX_BYTES){s.close(1009);return;}
      let m;try{m=JSON.parse(event.data);}catch{s.close(1008);return;}
      if(m.type==='ready'){clearTimeout(handshake);reconnectAttempt=0;update('connected');first?.resolve();first=null;return;}
      if(m.type==='ping'){send(s,{type:'pong'});return;}
      if(m.type==='pairing'){
        const pending=pairRequests.get(m.requestId);if(!pending)return;
        pairRequests.delete(m.requestId);clearTimeout(pending.timer);
        if(typeof m.url!=='string'||!m.url.startsWith(origin+'/phone/connect#pair=')||!Number.isFinite(m.expiresAt)){pending.reject(Error('Invalid pairing response'));return;}
        const value={url:m.url,expiresAt:m.expiresAt};onPairing(value);pending.resolve(value);return;
      }
      if(m.type!=='request'||typeof m.id!=='string'||!/^[a-zA-Z0-9_-]{20,100}$/.test(m.id))return;
      if(inflight>=8){send(s,{type:'response',id:m.id,status:429,error:'The PC is busy. Try again shortly.'});return;}
      inflight++;
      try{
        let data;
        if(m.operation==='herds'){if(typeof readHerds!=='function')throw Object.assign(Error('Herds are unavailable in this PC version'),{status:503});data=projectHerdView(await readHerds(herdQuery(m.query)));}else if(m.operation==='locations'){
          if(typeof readLocations!=='function')throw Object.assign(Error('Update the PC companion to read location history.'),{status:503});
          const query=locationQuery(m.query),page=await readLocations(query);
          if(page?.query?.session!==query.session)throw Object.assign(Error('Location scope changed. Refresh the companion.'),{status:503});
          data=projectLocationPage(page);
        }else if(m.operation==='state'||m.operation==='export'){
          if(!Number.isInteger(m.reserve)||m.reserve<0||m.reserve>999)throw Object.assign(Error('Invalid reserve'),{status:400});
          if(m.operation==='state'&&m.huntSpecies!==undefined&&(typeof m.huntSpecies!=='string'||!m.huntSpecies||m.huntSpecies.length>120||/[\x00-\x1f\x7f]/.test(m.huntSpecies)))throw Object.assign(Error('Invalid Hunt species'),{status:400});
          const state=await readState(m.reserve,m.operation==='state'&&m.huntSpecies!==undefined?{huntSpecies:m.huntSpecies}:undefined);data=m.operation==='state'?projectPhoneState(state):projectPhoneExport(state);
        }else if(m.operation==='command'){
          const body=validatePhoneCommand(m.body);data=projectPhoneCommandResult(body.op,await runCommand(body));
        }else throw Object.assign(Error('Unsupported phone request'),{status:403});
        if(current===generation&&enabled)send(s,{type:'response',id:m.id,status:200,data});
      }catch(e){if(current===generation&&enabled)send(s,{type:'response',id:m.id,status:[400,403,404,409,413,429].includes(e.status)?e.status:503,error:e.status===409?'The journal changed. Refresh before saving again.':'The PC could not complete this request. Refresh and check the companion.'});}
      finally{inflight--;}
    });
    s.addEventListener('error',()=>{});
    s.addEventListener('close',()=>{
      clearTimeout(handshake);if(current!==generation)return;rejectPairing();update(enabled?'reconnecting':'disabled');
      if(enabled){const delay=Math.min(15000,reconnectMs*2**Math.min(reconnectAttempt++,5));retry=setTimeout(open,delay+Math.floor(Math.random()*Math.min(delay,1000)));retry.unref?.();}
    });
  }
  return {
    get status(){return status;},
    async connect(){
      if(enabled)return;if(!WebSocketImpl)throw Error('Node.js with native WebSocket support is required');enabled=true;
      const ready=new Promise((resolve,reject)=>{first={resolve,reject};});
      const timer=setTimeout(()=>{first?.reject(Error('Phone service is still unavailable; the PC will keep trying while enabled.'));first=null;},connectTimeoutMs);timer.unref?.();
      open();try{await ready;}finally{clearTimeout(timer);}
    },
    async pair(){
      if(!enabled||status!=='connected'||socket?.readyState!==1)throw Error('Wait for the PC to connect to the phone service');
      if(pairRequests.size>=2)throw Error('A pairing request is already in progress');
      const requestId=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pairRequests.delete(requestId);reject(Error('Pairing timed out. Request a new link.'));},10000);timer.unref?.();pairRequests.set(requestId,{resolve,reject,timer});send(socket,{type:'pair',requestId});});
    },
    async close(){enabled=false;++generation;clearTimeout(retry);rejectPairing();first?.reject(Error('Phone access was disabled'));first=null;socket?.close(1000,'Phone access disabled');socket=null;update('disabled');}
  };
}
