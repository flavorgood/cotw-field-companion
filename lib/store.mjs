import {exportHerdLedgers} from './herd-ledger.mjs';
import {DatabaseSync} from 'node:sqlite';
import {routeSetupCommand} from './route-setup.mjs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {hash,harvestDelta,reduceEncounter,OUTCOMES,STRATEGIES,text,coordinate,reserveId,observationTime} from './core.mjs';
import {sessionPeriods,SESSION_MAX_PERIODS} from './career.mjs';
import {planRoute,MAX_ROUTE_STOPS} from './route-planner.mjs';
const sessionConflict=message=>Object.assign(Error(message),{status:409});
const sessionInvalid=message=>Object.assign(Error(message),{status:400});
const sessionFields={start:'reserve name targetSpecies goal',update:'id version reserve name targetSpecies goal',pause:'id version',resume:'id version',end:'id version'};
function sessionTarget(value){if(value==null)return null;if(typeof value!=='string'||value.trim().length>120)throw sessionInvalid('Target species must be at most 120 characters');return value.trim()||null;}
function sessionGoal(value){if(value==null)return null;if(!Number.isSafeInteger(value)||value<1||value>1000000)throw sessionInvalid('Harvest goal must be a whole number from 1 to 1000000');return value;}
function sessionName(value){const name=text(value,120);if(!name)throw sessionInvalid('Give this grind a name');return name;}
export class Store {
  constructor(filename) {
    this.db=new DatabaseSync(filename);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(profile TEXT,name TEXT,sha TEXT,mtime TEXT,checked TEXT,status TEXT,error TEXT,payload BLOB,PRIMARY KEY(profile,name));
      CREATE TABLE IF NOT EXISTS changes(id INTEGER PRIMARY KEY,profile TEXT,reserve INTEGER,at TEXT,data TEXT);
      CREATE TABLE IF NOT EXISTS harvests(id TEXT PRIMARY KEY,profile TEXT,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS journal(id TEXT PRIMARY KEY,profile TEXT,kind TEXT,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,body_hash TEXT NOT NULL,result TEXT NOT NULL);`);
    const version=this.get('schema_version',1);if(version!==1)throw Error('Unsupported companion database version');this.set('schema_version',1);
  }
  get(k,fallback=null){const r=this.db.prepare('SELECT v FROM meta WHERE k=?').get(k);return r?JSON.parse(r.v):fallback;}
  set(k,v){this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k,JSON.stringify(v));}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  source(profile,name){const r=this.db.prepare('SELECT * FROM sources WHERE profile=? AND name=?').get(profile,name);if(!r)return null;return {...r,payload:r.payload?JSON.parse(gunzipSync(r.payload).toString()):null};}
  sources(profile){return this.db.prepare('SELECT name,sha,mtime,checked,status,error FROM sources WHERE profile=? ORDER BY name').all(profile);}
  saveSource(profile,name,data){this.db.prepare(`INSERT INTO sources VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(profile,name) DO UPDATE SET sha=excluded.sha,mtime=excluded.mtime,checked=excluded.checked,status=excluded.status,error=excluded.error,payload=excluded.payload`).run(profile,name,data.sha,data.mtime,data.checked,data.status,data.error??null,data.payload?gzipSync(JSON.stringify(data.payload)):null);}
  sourceStatus(profile,name,status,error){this.db.prepare(`INSERT INTO sources(profile,name,checked,status,error) VALUES(?,?,?,?,?) ON CONFLICT(profile,name) DO UPDATE SET checked=excluded.checked,status=excluded.status,error=excluded.error`).run(profile,name,new Date().toISOString(),status,error??null);}
  touch(profile,name,mtime=null){this.db.prepare('UPDATE sources SET checked=?,mtime=COALESCE(?,mtime),status=?,error=NULL WHERE profile=? AND name=?').run(new Date().toISOString(),mtime,'ok',profile,name);}
  change(profile,reserve,data){this.db.prepare('INSERT INTO changes(profile,reserve,at,data) VALUES(?,?,?,?)').run(profile,reserve,new Date().toISOString(),JSON.stringify(data));this.db.prepare('DELETE FROM changes WHERE id NOT IN (SELECT id FROM changes ORDER BY id DESC LIMIT 5000)').run();}
  changes(profile,reserve){return this.db.prepare('SELECT at,data FROM changes WHERE profile=? AND reserve=? ORDER BY id DESC LIMIT 80').all(profile,reserve).map(r=>({...JSON.parse(r.data),at:r.at}));}
  journal(profile,kind){return this.db.prepare('SELECT data FROM journal WHERE profile=? AND kind=?').all(profile,kind).map(r=>JSON.parse(r.data));}
  item(profile,id,kind){return this.journal(profile,kind).find(r=>r.id===id);}
  put(profile,kind,data){this.db.prepare('INSERT INTO journal VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(data.id,profile,kind,JSON.stringify(data));return data;}
  harvests(profile){return this.db.prepare('SELECT data FROM harvests WHERE profile=?').all(profile).map(r=>JSON.parse(r.data));}
  importHarvests(profile,before,after){
    const seen=new Set(this.harvests(profile).map(r=>r.recordId));const d=harvestDelta(before,after,seen);
    for(const h of d.records){const id=hash([profile,h.id]);this.db.prepare('INSERT OR IGNORE INTO harvests VALUES(?,?,?)').run(id,profile,JSON.stringify({...h,id,recordId:h.id,firstSeen:new Date().toISOString()}));}
    if(d.gap||d.rollback)this.change(profile,-1,{boundary:d.rollback?'harvest_history_rollback':'harvest_history_coverage_gap',changes:[]});
    return d;
  }
  mutate(profile,requestId,body,fn){
    if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw Error('Request ID required');
    const key=profile+':'+requestId,bh=hash(body);
    return this.transaction(()=>{const old=this.db.prepare('SELECT body_hash,result FROM requests WHERE id=?').get(key);if(old){if(old.body_hash!==bh)throw Object.assign(Error('Request ID reused with different content'),{status:409});return JSON.parse(old.result);}const result=fn();this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(key,bh,JSON.stringify(result));return result;});
  }
  command(profile,body,{canRenamePlace,routePlanner,setupContext}={}){
    const now=new Date().toISOString(),id=randomUUID(),op=body.op;
    if(['route.setup','route.price','route.budget'].includes(op))return routeSetupCommand(this,profile,body,typeof setupContext==='function'?setupContext(reserveId(body.reserve)):{});
    if(op==='encounter.create') {
      const tracking=this.journal(profile,'sessions').filter(s=>s.endedAt==null&&s.pausedAt==null);
      const e={id,reserve:reserveId(body.reserve),species:text(body.species??'Unknown',120),notes:text(body.notes??''),search:'searching',version:1,createdAt:now,sessionId:tracking.length===1?tracking[0].id:null,evidence:[]};
      const x=coordinate(body.x),z=coordinate(body.z);if((x===null)!==(z===null))throw Error('Supply both coordinates');
      e.evidence.push({id:randomUUID(),type:'shot',observedAt:observationTime(body.observedAt),createdAt:now,source:'player_report',x,z,notes:'Initial shot reported'});
      return this.put(profile,'encounters',e);
    }
    if(op==='encounter.evidence'||op==='encounter.search') {
      const e=this.item(profile,body.id,'encounters');if(!e)throw Error('Encounter not found');
      if(e.version!==body.version)throw Object.assign(Error('Encounter changed in another tab. Refresh before saving.'),{status:409});
      if(op==='encounter.search'){if(!['searching','paused','abandoned'].includes(body.search))throw Error('Invalid search state');e.search=body.search;}
      else {
        if(!OUTCOMES.includes(body.type))throw Error('Invalid observation type');
        const ev={id:randomUUID(),type:body.type,observedAt:observationTime(body.observedAt),createdAt:now,source:'player_report',notes:text(body.notes??''),x:coordinate(body.x),z:coordinate(body.z)};
        if((ev.x===null)!==(ev.z===null))throw Error('Supply both coordinates');
        if(body.type==='harvest_linked') {
          const h=this.harvests(profile).find(h=>h.id===body.harvestId);if(!h)throw Error('Harvest receipt not found');
          const already=this.journal(profile,'encounters').some(r=>r.evidence.some(v=>v.harvestId===h.id));if(already)throw Object.assign(Error('Harvest receipt is already linked'),{status:409});
          ev.harvestId=h.id;ev.source='save_receipt_player_association';ev.observedAt=new Date(h.timestamp*1000).toISOString();
        }
        e.evidence.push(ev);
      }
      e.version++;return this.put(profile,'encounters',e);
    }
    if(['route.reorder','route.toggle','route.mode','route.start'].includes(op)) {
      const fields={'route.reorder':['reserve','order','expectedOrder','expectedVersion'],'route.toggle':['reserve','zoneId'],'route.mode':['reserve','mode','expectedOrder','expectedVersion'],'route.start':['reserve','zoneId','expectedOrder','expectedVersion']};
      if(Object.keys(body).some(k=>!['op','requestId',...fields[op]].includes(k)))throw Object.assign(Error('Unsupported route field'),{status:400});
      const rid=reserveId(body.reserve),key='route:'+profile+':'+rid,preferencesKey='route-options:'+profile+':'+rid,saved=this.get(key,[]),preferences=this.get(preferencesKey,{});
      const options={mode:preferences.mode==='manual'?'manual':'auto',startZoneId:preferences.startZoneId??saved[0]??null,version:preferences.version??1},project=(route,settings=options)=>typeof routePlanner==='function'?routePlanner(rid,route,settings):planRoute(route,[],settings);
      if(!Number.isSafeInteger(options.version)||options.version<1||options.version>=Number.MAX_SAFE_INTEGER)throw Object.assign(Error('Route preferences are unavailable'),{status:409});
      const current=project(saved),validIds=value=>Array.isArray(value)&&value.length<=MAX_ROUTE_STOPS&&value.every(v=>typeof v==='string'&&v.length>0&&v.length<=200);
      if(op!=='route.toggle'){
        if(!validIds(body.expectedOrder)||JSON.stringify(body.expectedOrder)!==JSON.stringify(current.route))throw Object.assign(Error('Circuit changed in another tab. Refresh before saving.'),{status:409});
        if((op!=='route.reorder'||preferences.version!==undefined||body.expectedVersion!==undefined)&&(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion!==options.version))throw Object.assign(Error('Route preferences changed in another tab. Refresh before saving.'),{status:409});
        if(['route.mode','route.start'].includes(op)&&typeof routePlanner!=='function')throw Object.assign(Error('Complete zone data is required for route controls'),{status:409});
      }
      let next=[...current.route],nextOptions={...options,version:options.version+1};
      if(op==='route.reorder'){
        const counts=new Map();for(const id of current.route)counts.set(id,(counts.get(id)||0)+1);
        if(!validIds(body.order)||body.order.length!==current.route.length||body.order.some(id=>{const n=counts.get(id)||0;counts.set(id,n-1);return n<1;}))throw Object.assign(Error('Circuit order must preserve the current stops'),{status:400});
        next=[...body.order];nextOptions.mode='manual';nextOptions.startZoneId=next[0]??null;
      }else if(op==='route.mode'){
        if(!['auto','manual'].includes(body.mode))throw Object.assign(Error('Invalid route mode'),{status:400});
        nextOptions.mode=body.mode;nextOptions.startZoneId=current.route[0]??null;
        if(body.mode==='auto'&&options.mode==='auto')next=[...saved];
      }else{
        if(typeof body.zoneId!=='string'||!body.zoneId||body.zoneId.length>200)throw Object.assign(Error('Choose a route stop'),{status:400});
        if(op==='route.start'){
          if(!current.route.includes(body.zoneId))throw Object.assign(Error('Starting stop must belong to this route'),{status:400});
          next=[...current.route];next.splice(next.indexOf(body.zoneId),1);next.unshift(body.zoneId);nextOptions.startZoneId=body.zoneId;
        }else{
          if(current.route.includes(body.zoneId))next=current.route.filter(id=>id!==body.zoneId);
          else{
            if(current.route.length>=MAX_ROUTE_STOPS)throw Object.assign(Error('Route stop limit reached'),{status:400});
            if(typeof routePlanner==='function'&&project([body.zoneId]).routeOptimization.missingCount)throw Object.assign(Error('This zone is unavailable in the selected reserve'),{status:409});
            next=[...current.route,body.zoneId];
          }
          nextOptions.startZoneId=next[0]??null;
        }
      }
      // Untouched legacy low-level toggle callers have no trusted zone projection or preferences.
      if(op!=='route.toggle'||typeof routePlanner==='function'||preferences.version!==undefined)this.set(preferencesKey,nextOptions);
      this.set(key,next);const result=project(next,nextOptions);
      if(op==='route.toggle')return {route:result.route};
      if(op==='route.reorder')return result.route;
      return result;
    }
    if(op==='zone.annotate') {
      const key=text(body.zoneId,200);if(!STRATEGIES.includes(body.strategy))throw Error('Invalid strategy');
      const annotation={id:hash([profile,key]),zoneId:key,strategy:body.strategy,name:text(body.name??'',120),notes:text(body.notes??''),updatedAt:now};return this.put(profile,'annotations',annotation);
    }
    if(op==='zone.rename') {
      if(Object.keys(body).some(k=>!['op','requestId','zoneId','name'].includes(k))||typeof body.zoneId!=='string'||!body.zoneId.trim()||body.zoneId!==body.zoneId.trim()||body.zoneId.length>200||typeof body.name!=='string'||body.name.trim().length>120)throw Object.assign(Error('Choose a spot and a name of at most 120 characters'),{status:400});
      const key=body.zoneId,id=hash([profile,key]),current=this.item(profile,id,'annotations');
      return this.put(profile,'annotations',{...(current??{id,zoneId:key,strategy:'unassigned',notes:''}),name:body.name.trim(),updatedAt:now});
    }
    if(op==='zone.create') {
      const x=coordinate(body.x),z=coordinate(body.z);if(x===null||z===null)throw Error('Zone coordinates required');
      if(!['feeding','drinking','resting'].includes(body.need))throw Error('Invalid need type');
      const start=Number(body.start),end=Number(body.end);if(![start,end].every(n=>Number.isFinite(n)&&n>=0&&n<=24)||start===end)throw Error('Invalid schedule');
      return this.put(profile,'zones',{id:'manual:'+id,reserve:reserveId(body.reserve),species:text(body.species??'Unknown',120),x,z,start,end,need:body.need,source:'player_report',createdAt:now});
    }
    if(op==='pin.create') {
      if(!['tent','stand','feeder','outpost','last_seen','shot','scout'].includes(body.kind))throw Error('Invalid pin type');
      const x=coordinate(body.x),z=coordinate(body.z);if(x===null||z===null)throw Error('Pin coordinates required');
      return this.put(profile,'pins',{id,reserve:reserveId(body.reserve),kind:body.kind,label:text(body.label||body.kind,120),x,z,notes:text(body.notes??''),source:'player_report',createdAt:now});
    }
    if(op==='pin.delete') {const p=this.item(profile,body.id,'pins');if(!p)throw Error('Pin not found');this.db.prepare('DELETE FROM journal WHERE id=? AND profile=? AND kind=?').run(p.id,profile,'pins');return {id:p.id,removed:true};}
    if(op==='place.rename') {
      if(Object.keys(body).some(k=>!['op','requestId','id','label'].includes(k)))throw Object.assign(Error('Unsupported place field'),{status:400});
      if(typeof body.id!=='string'||!body.id.trim()||body.id!==body.id.trim()||body.id.length>200||typeof body.label!=='string'||body.label.trim().length>120)throw Object.assign(Error('Choose a place and a name of at most 120 characters'),{status:400});
      if(typeof canRenamePlace!=='function'||canRenamePlace(body.id)!==true)throw Object.assign(Error('This place cannot be renamed. Refresh the map before trying again.'),{status:409});
      const label=body.label.trim(),data={id:hash(['place-label',profile,body.id]),placeId:body.id,label,updatedAt:now};
      if(!label){this.db.prepare('DELETE FROM journal WHERE id=? AND profile=? AND kind=?').run(data.id,profile,'placeLabels');return data;}
      if(!this.item(profile,data.id,'placeLabels')&&this.journal(profile,'placeLabels').length>=5000)throw Object.assign(Error('The place-name limit has been reached'),{status:409});
      return this.put(profile,'placeLabels',data);
    }
    if(op.startsWith('session.')&&Object.hasOwn(sessionFields,op.slice(8))) {
      const action=op.slice(8),allowed=new Set(['op','requestId',...sessionFields[action].split(' ')]);
      if(Object.keys(body).some(k=>!allowed.has(k)))throw sessionInvalid('Unsupported grind field');
      const sessions=this.journal(profile,'sessions');
      if(action==='start') {
        return this.put(profile,'sessions',{id,reserve:reserveId(body.reserve),name:sessionName(body.name||'Field session'),targetSpecies:sessionTarget(body.targetSpecies),goal:sessionGoal(body.goal),version:1,startedAt:now,endedAt:null,pausedAt:null,periods:[{startedAt:now,endedAt:null}]});
      }
      const legacyEnd=action==='end'&&body.id===undefined&&body.version===undefined;
      if(!legacyEnd&&(typeof body.id!=='string'||!body.id||body.id.length>200||!Number.isSafeInteger(body.version)||body.version<1))throw sessionInvalid('Grind identity and version are required');
      const legacyCandidates=legacyEnd?sessions.filter(s=>s.endedAt==null):[];
      if(legacyCandidates.length>1)throw sessionConflict('Choose the grind to finish.');
      const s=legacyEnd?legacyCandidates[0]:sessions.find(s=>s.id===body.id);
      if(!s)throw sessionConflict('This grind is no longer available. Refresh before saving.');
      // Compatibility belongs only to untouched pre-control records, never a newer current grind.
      if(legacyEnd&&(Object.hasOwn(s,'periods')||Object.hasOwn(s,'version')))throw sessionInvalid('Grind identity and version are required');
      const version=s.version??1;
      if(!Number.isSafeInteger(version)||version<1||version>=Number.MAX_SAFE_INTEGER||!legacyEnd&&version!==body.version)throw sessionConflict('This grind changed in another tab. Refresh before saving.');
      if(action==='update') {
        if(body.reserve!==undefined)s.reserve=reserveId(body.reserve);
        if(body.name!==undefined)s.name=sessionName(body.name);
        if(body.targetSpecies!==undefined)s.targetSpecies=sessionTarget(body.targetSpecies);
        if(body.goal!==undefined)s.goal=sessionGoal(body.goal);
      }else {
        const periods=sessionPeriods(s);
        if(!periods)throw sessionConflict('This grind has an unavailable time history and cannot be changed safely.');
        const last=periods.at(-1),lastTime=Math.max(...periods.map(p=>Date.parse(p.endedAt??p.startedAt)),Date.parse(s.endedAt??s.pausedAt??s.startedAt));
        if(Date.parse(now)<lastTime)throw sessionConflict('The computer clock is earlier than this grind. Try again after it catches up.');
        if(action==='resume') {
          if(s.endedAt==null&&s.pausedAt==null)throw sessionConflict('This grind is already running');
          if(periods.length>=SESSION_MAX_PERIODS)throw sessionConflict('This grind has reached its 500-run limit. Finish it and start a new grind.');
          // Preserve a finished legacy window's inclusive cutoff when adding its next run.
          s.periods=[...periods,{startedAt:now,endedAt:null}];s.endedAt=null;s.pausedAt=null;
        }else if(action==='pause') {
          if(s.endedAt!=null||s.pausedAt!=null||last.endedAt!==null)throw sessionConflict('Only a running grind can be paused');
          s.periods=[...periods.slice(0,-1),{startedAt:last.startedAt,endedAt:now}];s.pausedAt=now;
        }else if(action==='end') {
          if(s.endedAt!=null)throw sessionConflict('This grind is already finished');
          if(s.periods!==undefined)s.periods=last.endedAt===null?[...periods.slice(0,-1),{startedAt:last.startedAt,endedAt:now}]:periods;
          s.endedAt=now;s.pausedAt=null;
        }
      }
      s.version=version+1;s.targetSpecies??=null;s.goal??=null;s.pausedAt??=null;
      return this.put(profile,'sessions',s);
    }
    if(op==='settings') {
      const settings=this.get('settings:'+profile,{spoilers:false,terrain:false});
      if(body.spoilers!==undefined){if(typeof body.spoilers!=='boolean'||(body.spoilers&&body.confirmSpoilers!==true))throw Error('Explicit spoiler consent required');settings.spoilers=body.spoilers;}
      if(body.terrain!==undefined){if(typeof body.terrain!=='boolean')throw Error('Invalid terrain setting');settings.terrain=body.terrain;}
      this.set('settings:'+profile,settings);return settings;
    }
    throw Error('Unknown command');
  }
  exportJournal(profile){return {herdHistory:exportHerdLedgers(this,profile),format:'cotw-field-companion-journal',version:1,exportedAt:new Date().toISOString(),settings:this.get('settings:'+profile,{spoilers:false,terrain:false}),encounters:this.journal(profile,'encounters'),zones:this.journal(profile,'zones'),annotations:this.journal(profile,'annotations'),pins:this.journal(profile,'pins'),placeLabels:this.journal(profile,'placeLabels'),sessions:this.journal(profile,'sessions'),harvests:this.harvests(profile),zoneHistory:this.journal(profile,'zoneHistory'),harvestZones:this.journal(profile,'harvestZones'),encounterZones:this.journal(profile,'encounterZones')};}
  close(){this.db.close();}
}
