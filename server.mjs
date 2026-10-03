import {isMain} from './updates/entry.mjs';
import {ManagedChild} from './updates/child.mjs';
import {runtimeIdentity,runtimeScope} from './lib/runtime-identity.mjs';
import {locationSearchParams} from './lib/hunt-locations.mjs';
import {herdSearchParams,projectHerdView} from './lib/herd-view.mjs';
import {loadHerdReference,withHerdReference} from './lib/herd-reference.mjs';
import http from 'node:http';
import {readFileSync,existsSync,realpathSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Store} from './lib/store.mjs';
import {Observer,inside} from './lib/observer.mjs';
import {reserveId} from './lib/core.mjs';
import {createPhoneAccess} from './lib/phone-access.mjs';
// Capture the build before serving assets; later disk changes cannot relabel a running process.
const bootRuntime=runtimeIdentity(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_GITHUB_FEEDBACK_URL='https://api.github.com/repos/infotradescout/cotw-field-companion/issues?state=open&labels=feedback&per_page=20';
export async function createApp({managedGate=null,dataDir,saveDir=null,port=47831,interval=5000,phoneRelayUrl=process.env.COMPANION_PHONE_RELAY_URL,phoneEnrollmentToken=process.env.COMPANION_PHONE_ENROLLMENT_TOKEN,allowInsecurePhoneLoopback=false,feedbackUrl=process.env.COMPANION_FEEDBACK_URL,feedbackOwnerToken=process.env.COMPANION_FEEDBACK_OWNER_TOKEN,feedbackOwnerOrigin=process.env.COMPANION_FEEDBACK_OWNER_ORIGIN,githubFeedbackUrl=process.env.COMPANION_FEEDBACK_GITHUB_URL||DEFAULT_GITHUB_FEEDBACK_URL}={}) {
  const appDir=path.dirname(fileURLToPath(import.meta.url));
  if(!dataDir)throw Error('Companion data directory is required');
  const identity=bootRuntime;
  if(process.env.GRINDZONE_EXPECTED_FINGERPRINT&&process.env.GRINDZONE_EXPECTED_FINGERPRINT!==identity.fingerprint)throw Error('The selected package changed during startup. No journal was opened; restart the complete package.');
  saveDir=saveDir?realpathSync(saveDir):null;dataDir=path.resolve(dataDir);
  let parent=dataDir;while(!existsSync(parent))parent=path.dirname(parent);
  const resolved=path.join(realpathSync(parent),path.relative(parent,dataDir));
  if(saveDir&&(inside(saveDir,resolved)||inside(resolved,saveDir)))throw Error('Companion data and game saves must be separate, non-overlapping directories');
  mkdirSync(dataDir,{recursive:true});dataDir=realpathSync(dataDir);
  if(saveDir&&process.permission?.has('fs.write',saveDir))throw Error('Refusing to start with save-folder write permission');
  const ratingFile=path.join(appDir,'lib/rating-data.json');
  const ratingCatalog=withHerdReference(existsSync(ratingFile)?JSON.parse(readFileSync(ratingFile,'utf8')):null,loadHerdReference());
  const gearCatalog=JSON.parse(readFileSync(path.join(appDir,'lib/gear-data.json'),'utf8'));
  const mapsCatalog=JSON.parse(readFileSync(path.join(appDir,'lib/maps-data.json'),'utf8'));
  const reference=JSON.parse(readFileSync(path.join(appDir,'lib/reference.json'),'utf8'));
  for(const r of mapsCatalog.reserves)reference.reserves[r.id]={...reference.reserves[r.id],...r};
  reference.equipment=gearCatalog.equipmentNames||{};
  const store=new Store(path.join(dataDir,'journal.sqlite'));
  const observer=new Observer(store,saveDir,reference,{interval});await observer.start();
  const runCommand=async body=>{if(body.op==='observer.scan'){await observer.scan(true);return {scanned:true,lastCycle:observer.lastCycle};}return store.mutate(observer.profile,body.requestId,body,()=>observer.command(body));};
  const phoneServiceFile=path.join(appDir,'lib/phone-service.json');
  const configuredRelay=phoneRelayUrl??(existsSync(phoneServiceFile)?JSON.parse(readFileSync(phoneServiceFile,'utf8')).relayUrl:null);
  const phone=createPhoneAccess({store,observer,relayUrl:configuredRelay,enrollmentToken:phoneEnrollmentToken,runCommand,allowInsecureLoopback:allowInsecurePhoneLoopback});
  if(!managedGate?.managed)void phone.start().catch(()=>{});
  const feedbackEndpoint=feedbackUrl?new URL(feedbackUrl):null;
  if(feedbackEndpoint&&!['https:','http:'].includes(feedbackEndpoint.protocol))throw Error('Companion feedback URL must use HTTP or HTTPS');
  if(feedbackEndpoint){feedbackEndpoint.pathname=feedbackEndpoint.pathname.replace(/\/+$/,'')+'/';feedbackEndpoint.search='';feedbackEndpoint.hash='';}
  const token=randomBytes(32).toString('hex');
  const runtime=Object.freeze({...identity,scope:runtimeScope(dataDir,saveDir)});
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  const assets=new Map(['/updates-ui.js','/herd-view.js','/herd-view.css','/','/index.html','/app.js','/zone-window.js','/dashboard.js','/save-data.js','/save-data.css','/hunt-locations.js','/hunt-locations.css','/grinds.js','/species-style.js','/commands.js','/route-stops.js','/route-setup.js','/setup-catalog.js','/harvest-view.js','/phone-ui.js','/phone.css','/qrcode.js','/map.js','/style.css','/icon.svg','/reference.js','/reference-core.js','/data-client.js','/career.js','/studio.js','/field-library.js','/field-theme.css','/hunting-workspace.css','/map-geometry.js','/terrain-layer.js','/map-atlas.js','/maps.css'].map(url=>[url,readFileSync(path.join(appDir,'public',url==='/'?'index.html':url.slice(1)))]));
  for(const url of ['/capture-source.js','/capture-source.css'])assets.set(url,readFileSync(path.join(appDir,'public',url.slice(1))));
  // This control is local-PC only; signed-phone HTML and permissions are unchanged.
  for(const url of ['/','/index.html'])assets.set(url,Buffer.from(assets.get(url).toString('utf8').replace('</body>','<script type="module" src="/updates-ui.js"></script></body>')));
  const server=http.createServer(async(req,res)=>{
    const actualPort=server.address().port;
    const goodHosts=[`127.0.0.1:${actualPort}`,`localhost:${actualPort}`];
    const origin=req.headers.origin;
    const sameOrigin=!origin||goodHosts.some(h=>origin==='http://'+h);
    const allowedSite=!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']);
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://mathartbang.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
    const json=(status,value)=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    const localTokenOk=()=>typeof req.headers['x-companion-token']==='string'&&req.headers['x-companion-token']===token;
    const feedbackOrigin=()=>feedbackOwnerOrigin||`http://127.0.0.1:${server.address()?.port??port}`;
    const feedbackProxy=async(pathname,method='GET')=>{
      if(!feedbackEndpoint||typeof feedbackOwnerToken!=='string'||feedbackOwnerToken.length<32)return json(503,{error:'Hosted feedback is not configured for this companion.'});
      const target=new URL(pathname,feedbackEndpoint);
      let upstream;
      try{upstream=await fetch(target,{method,headers:{Authorization:`Bearer ${feedbackOwnerToken}`,...(feedbackOwnerOrigin?{Origin:feedbackOrigin()}:{})},signal:AbortSignal.timeout(5000)});}
      catch{return json(503,{error:'Hosted feedback is temporarily unavailable.'});}
      const text=await upstream.text();let value;try{value=JSON.parse(text);}catch{value={error:'Hosted feedback returned an invalid response.'};}
      return json(upstream.status,value);
    };
    const githubFeedbackProxy=async()=>{
      let upstream;
      try{upstream=await fetch(githubFeedbackUrl,{headers:{Accept:'application/vnd.github+json','User-Agent':'COTW-Companion'},signal:AbortSignal.timeout(5000)});}
      catch{return json(503,{error:'GitHub feedback is temporarily unavailable.'});}
      if(!upstream.ok)return json(503,{error:'GitHub feedback is temporarily unavailable.'});
      const payload=await upstream.json().catch(()=>null);
      if(!Array.isArray(payload))return json(503,{error:'GitHub feedback returned an invalid response.'});
      const feedback=payload.filter(issue=>issue&&typeof issue==='object'&&!issue.pull_request).slice(0,20).map(issue=>({
        id:String(issue.number??''),title:String(issue.title??'Feedback').slice(0,200),message:String(issue.body??'').slice(0,4000),
        url:(typeof issue.html_url==='string'&&/^https:\/\/github\.com\/infotradescout\/cotw-field-companion\/issues\/\d+$/.test(issue.html_url))?issue.html_url:'',createdAt:issue.created_at??null,updatedAt:issue.updated_at??null,
        author:typeof issue.user?.login==='string'?issue.user.login:''
      }));
      return json(200,{source:'github',feedback});
    };
    if(!goodHosts.includes(req.headers.host)||!sameOrigin||!allowedSite)return json(403,{error:'Only same-origin local access is accepted'});
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/api/bootstrap')return json(200,{token,version:identity.version,runtime,selectedReserve:observer.source('reserveworlddata_adf')?.payload?.reserve??19});
      if(managedGate?.blocked)return json(503,{error:'GrindZone is finishing update startup. Please wait.'});
      if(req.method==='GET'&&url.pathname==='/api/updates/status')return json(200,await (managedGate||new ManagedChild({transport:{}})).request('status'));
      if(req.method==='POST'&&url.pathname==='/api/updates/check'){
        if(!localTokenOk())return json(403,{error:'Missing local session token'});
        return json(200,await (managedGate||new ManagedChild({transport:{}})).request('check'));
      }
      if(req.method==='GET'&&url.pathname==='/api/phone/status')return json(200,phone.status());
      if(req.method==='GET'&&url.pathname==='/api/maps')return json(200,mapsCatalog);
      if(req.method==='GET'&&url.pathname==='/api/gear')return json(200,gearCatalog);
      if(req.method==='GET'&&url.pathname==='/api/reference')return ratingCatalog?json(200,ratingCatalog):json(503,{error:'The animal reference catalog has not been installed.'});
      if(req.method==='GET'&&url.pathname==='/api/feedback/inbox'){
        if(!localTokenOk())return json(403,{error:'Missing local session token'});
        return feedbackProxy('/v1/owner/feedback?status=new&limit=20');
      }
      if(req.method==='GET'&&url.pathname==='/api/feedback/github'){
        if(!localTokenOk())return json(403,{error:'Missing local session token'});
        return githubFeedbackProxy();
      }
      const feedbackRead=url.pathname.match(/^\/api\/feedback\/([0-9a-f-]{36})\/read$/i);
      if(req.method==='POST'&&feedbackRead){
        if(!localTokenOk())return json(403,{error:'Missing local session token'});
        return feedbackProxy(`/v1/owner/feedback/${feedbackRead[1]}/read`,'POST');
      }
      if(req.method==='GET'&&url.pathname==='/api/herds')return json(200,projectHerdView(observer.herdView(herdSearchParams(url.searchParams))));
      if(req.method==='GET'&&url.pathname==='/api/locations')return json(200,observer.locationHistory(locationSearchParams(url.searchParams)));
      if(req.method==='GET'&&url.pathname==='/api/state'){
        const speciesValues=url.searchParams.getAll('huntSpecies');
        if(speciesValues.length>1||speciesValues.length===1&&(!speciesValues[0]||speciesValues[0].length>120||/[\x00-\x1f\x7f]/.test(speciesValues[0])))throw Object.assign(Error('Invalid Hunt species'),{status:400});
        return json(200,observer.state(reserveId(url.searchParams.get('reserve')??19),speciesValues.length?{huntSpecies:speciesValues[0]}:undefined));
      }
      if(req.method==='GET'&&url.pathname==='/api/export'){
        res.writeHead(200,{...headers,'Content-Type':'application/json','Content-Disposition':'attachment; filename="COTW-field-journal.json"'});return res.end(JSON.stringify(store.exportJournal(observer.profile),null,2));
      }
      if(req.method==='POST'&&['/api/command','/api/phone/enable','/api/phone/pair','/api/phone/disable'].includes(url.pathname)) {
        if(req.headers['x-companion-token']!==token)return json(403,{error:'Missing local session token'});
        if(!String(req.headers['content-type']).startsWith('application/json'))return json(415,{error:'JSON required'});
        const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>32768)return json(413,{error:'Request too large'});chunks.push(chunk);}
        const body=JSON.parse(Buffer.concat(chunks).toString());if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid request');
        if(url.pathname==='/api/phone/enable')return json(200,await phone.enable(body));
        if(url.pathname==='/api/phone/pair')return json(200,await phone.pair());
        if(url.pathname==='/api/phone/disable')return json(200,await phone.disable());
        return json(200,await runCommand(body));
      }
      if(req.method==='GET'&&assets.has(url.pathname)){res.writeHead(200,{...headers,'Content-Type':types[path.extname(url.pathname)]||types['.html']});return res.end(assets.get(url.pathname));}
      return json(404,{error:'Not found'});
    }catch(e){json(e.status??400,{error:String(e.message).slice(0,300)});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  // The old address is a redirect owned by this process, never a second observer or journal.
  let legacyRedirect=null;
  if(port===47831){legacyRedirect=http.createServer((req,res)=>{if(!['127.0.0.1:47821','localhost:47821'].includes(req.headers.host)){res.writeHead(403);return res.end();}if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(410,{'Content-Type':'text/plain'});return res.end('Use the canonical COTW Field Companion.');}res.writeHead(302,{Location:'http://127.0.0.1:47831/', 'Cache-Control':'no-store'});res.end();});await new Promise(resolve=>{legacyRedirect.once('error',()=>{legacyRedirect=null;resolve();});legacyRedirect.listen(47821,'127.0.0.1',resolve);});}
  let closing;const close=()=>closing||(closing=(async()=>{await phone.close();if(legacyRedirect)legacyRedirect.close();observer.stop();while(observer.busy)await new Promise(r=>setTimeout(r,25));await new Promise(r=>server.close(r));store.close();})());
  const app={server,store,observer,phone,close,url:`http://127.0.0.1:${server.address().port}`};
  managedGate?.ready(app,runtime,()=>phone.start());return app;
}
if(isMain(import.meta)){
  try{const app=await createApp({managedGate:new ManagedChild(),dataDir:process.env.COMPANION_DATA_DIR,saveDir:process.env.COTW_SAVE_DIR||null,port:Number(process.env.COMPANION_PORT||47831)});console.log(`COTW Field Companion listening at ${app.url}\nSave access: READ ONLY. Data: ${process.env.COMPANION_DATA_DIR}\nClose this window or press Ctrl+C to stop.`);let ending=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(ending)return;ending=true;await app.close();process.exit(0);});}catch(e){console.error(e.message);process.exitCode=1;}
}
