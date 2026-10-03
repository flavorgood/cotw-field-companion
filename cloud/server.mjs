import {locationSearchParams} from '../lib/hunt-locations.mjs';
import {herdSearchParams,projectHerdView} from '../lib/herd-view.mjs';
import {loadHerdReference,withHerdReference} from '../lib/herd-reference.mjs';
/** A bounded, single-instance live relay. The PC owns all journal persistence. */
import http from 'node:http';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {PHONE_PROTOCOL,PHONE_MAX_BYTES,phoneRelayOrigin,validatePhoneCommand} from '../lib/phone-bridge.mjs';
import {phoneTokenCodec,PHONE_DAY as DAY} from './auth.mjs';
import {mountClientSource} from './mount.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const random=()=>randomBytes(32).toString('base64url');
const hash=v=>createHash('sha256').update(v).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const assets=['herd-view.js','herd-view.css','hunt-locations.js','hunt-locations.css','save-data.js','save-data.css','app.js','zone-window.js','dashboard.js','grinds.js','map.js','style.css','icon.svg','reference.js','reference-core.js','data-client.js','career.js','studio.js','capture-source.js','capture-source.css','field-library.js','field-theme.css','map-geometry.js','terrain-layer.js','map-atlas.js','maps.css','hunting-workspace.css','species-style.js','commands.js','route-stops.js','route-setup.js','setup-catalog.js','harvest-view.js','phone-ui.js','phone.css','qrcode.js'];
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://mathartbang.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};

export async function createPhoneRelay({key,publicOrigin,port=0,host='127.0.0.1',allowInsecureLoopback=false,now=Date.now,requestTimeoutMs=10000,pairTtlMs=300000,maxPeers=16,maxPending=4,pairAttemptLimit=30,provisionLimit=20}={}){
  const {mac,issue,verify}=phoneTokenCodec({key,now});
  let address=phoneRelayOrigin(publicOrigin,{allowInsecureLoopback}),origin=new URL(address).origin;
  const mount=new URL(address).pathname==='/'?'':'/grindzone',cookieName=mount?'__Secure-grindzone-phone':'__Host-cotw-phone',cookiePath=(mount||'')+'/';
  const peers=new Map(),pairs=new Map(),pending=new Map(),rates=new Map(),sessionReserve=new Map(),installationGenerations=new Map();
  const files=new Map(assets.map(name=>['/'+name,Buffer.from(mountClientSource(readFileSync(path.join(root,'public',name),'utf8'),mount))]));
  const index=mountClientSource(readFileSync(path.join(root,'public/index.html'),'utf8').replace('<html','<html data-runtime="phone"'),mount);
  const connectPage=mountClientSource(readFileSync(new URL('./connect.html',import.meta.url),'utf8'),mount);
  const connectScript=mountClientSource(readFileSync(new URL('./connect.js',import.meta.url),'utf8'),mount);
  const catalogs=Object.fromEntries([['maps','maps-data'],['gear','gear-data'],['reference','rating-data']].map(([name,file])=>[name,JSON.parse(readFileSync(path.join(root,'lib',file+'.json'),'utf8'))]));
  catalogs.reference=withHerdReference(catalogs.reference,loadHerdReference());
  function limited(key,limit,windowMs=60000){
    let r=rates.get(key);if(!r||r.until<=now()){if(rates.size>=2048){for(const [k,v]of rates)if(v.until<=now())rates.delete(k);if(rates.size>=2048)return true;}r={count:0,until:now()+windowMs};rates.set(key,r);}return ++r.count>limit;
  }
  function auth(req){
    const found=String(req.headers.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(cookieName+'='));if(found.length!==1)return null;
    const token=found[0].slice(cookieName.length+1),claims=verify(token,'phone');return claims&&typeof claims.sid==='string'?{...claims,token,csrf:mac('csrf:'+token)}:null;
  }
  const json=(res,status,value,extra={})=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(value));};
  function browserOrigin(req){return req.headers.origin===origin&&(!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='same-origin');}
  async function body(req){
    if(String(req.headers['content-type']??'').split(';')[0].trim()!=='application/json')throw Object.assign(Error('JSON required'),{status:415});
    let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>32768)throw Object.assign(Error('Request too large'),{status:413});chunks.push(chunk);}try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw Object.assign(Error('Invalid request'),{status:400});}
  }
  function invalidatePeer(peer){
    if(peers.get(peer.deviceId)===peer)peers.delete(peer.deviceId);
    for(const [key,value]of pairs)if(value.peer===peer)pairs.delete(key);
    for(const [key,value]of pending)if(value.peer===peer){clearTimeout(value.timer);pending.delete(key);value.reject(Object.assign(Error('PC connection changed. Refresh before retrying an action.'),{status:503}));}
  }
  function relay(peer,operation,data){
    if(!peer||peer.socket.readyState!==1)throw Object.assign(Error('Your PC companion is offline. Open it on your PC to reconnect.'),{status:503});
    if([...pending.values()].filter(v=>v.peer===peer).length>=maxPending)throw Object.assign(Error('Your PC is busy. Try again shortly.'),{status:429});
    const id=random();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Object.assign(Error(operation==='command'?'Action status is unknown. Refresh before retrying.':'The PC did not respond in time.'),{status:504}));},requestTimeoutMs);timer.unref?.();pending.set(id,{peer,resolve,reject,timer});peer.socket.send(JSON.stringify({type:'request',id,operation,...data}));});
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(mount){if(url.pathname===mount){res.writeHead(302,{...headers,Location:mount+'/'});return res.end();}if(!url.pathname.startsWith(mount+'/'))return json(res,404,{error:'Not found'});url.pathname=url.pathname.slice(mount.length);}
      if(req.method==='GET'&&url.pathname==='/healthz')return json(res,200,{ok:true,mode:'live_relay'});
      if(req.headers.host!==new URL(origin).host)return json(res,403,{error:'This address is not accepted'});
      if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&['cross-site','same-site'].includes(req.headers['sec-fetch-site']))return json(res,403,{error:'Use the phone companion directly'});
      if(req.method==='POST'&&url.pathname==='/phone/device'){
        const authorization=req.headers.authorization;
        const enrollment=typeof authorization==='string'&&authorization.length<=2055&&authorization.startsWith('Bearer ')?verify(authorization.slice(7),'enrollment'):null;
        if(!enrollment)return json(res,401,{error:'This installation has not been enrolled for phone access.'});
        if(limited('provision:'+enrollment.installationId,provisionLimit))return json(res,429,{error:'Connection setup is busy. Try again later.'});
        const input=await body(req);if(Object.keys(input).length)return json(res,400,{error:'No profile or save data is accepted during setup'});
        const previous=installationGenerations.get(enrollment.installationId);if(!previous&&installationGenerations.size>=2048)return json(res,429,{error:'Installation capacity has been reached.'});
        const deviceId=random(),generation=Math.max(now(),(previous?.generation??0)+1),lifetime=Math.min(365*DAY,enrollment.exp-now());
        installationGenerations.set(enrollment.installationId,{generation,deviceId,expiresAt:now()+lifetime});
        const active=[...peers.values()].find(p=>p.installationId===enrollment.installationId);if(active){invalidatePeer(active);active.socket.terminate();}
        return json(res,201,{deviceId,deviceToken:issue('device',{deviceId,installationId:enrollment.installationId,generation},lifetime)});
      }
      if(req.method==='GET'&&url.pathname==='/phone/connect'){res.writeHead(200,{...headers,'Content-Type':types['.html']});return res.end(connectPage);}
      if(req.method==='GET'&&url.pathname==='/phone/connect.js'){res.writeHead(200,{...headers,'Content-Type':types['.js']});return res.end(connectScript);}
      if(req.method==='POST'&&url.pathname==='/phone/pair'){
        if(!browserOrigin(req))return json(res,403,{error:'Pair from the phone connection page'});
        if(limited('pair-attempts',pairAttemptLimit)||limited('pair-attempts:'+req.socket.remoteAddress,pairAttemptLimit))return json(res,429,{error:'Too many pairing attempts. Try again later.'});
        const input=await body(req),pair=typeof input.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(input.token)?pairs.get(hash(input.token)):null;
        if(!pair||pair.expiresAt<=now()||peers.get(pair.peer.deviceId)!==pair.peer)return json(res,400,{error:'This pairing link is unavailable. Request a new one on the PC.'});
        pairs.delete(hash(input.token));const cookie=issue('phone',{deviceId:pair.peer.deviceId,sid:random()},30*DAY);
        return json(res,200,{paired:true},{'Set-Cookie':cookieName+'='+cookie+'; Path='+cookiePath+'; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000'});
      }
      const session=auth(req);
      if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){
        res.writeHead(session?200:302,{...headers,...(session?{'Content-Type':types['.html']}:{Location:mount+'/phone/connect'})});return res.end(session?index:'');
      }
      // Assets contain only application code and public catalogs; all data APIs below require a paired owner.
      if(req.method==='GET'&&files.has(url.pathname)){res.writeHead(200,{...headers,'Content-Type':types[path.extname(url.pathname)]});return res.end(files.get(url.pathname));}
      if(!session)return json(res,401,{error:'Pair this browser from the companion on the PC.'});
      if(limited('owner:'+session.deviceId,180))return json(res,429,{error:'Too many requests. Try again shortly.'});
      if(req.method==='POST'){
        if(!browserOrigin(req)||!equal(req.headers['x-companion-token'],session.csrf))return json(res,403,{error:'Refresh the phone page before saving.'});
        if(url.pathname==='/phone/logout')return json(res,200,{signedOut:true},{'Set-Cookie':cookieName+'=; Path='+cookiePath+'; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
        if(url.pathname==='/api/command'){
          if(limited('commands:'+session.deviceId,30))return json(res,429,{error:'Too many actions. Try again shortly.'});
          const command=validatePhoneCommand(await body(req));const result=await relay(peers.get(session.deviceId),'command',{body:command});return json(res,200,result);
        }
      }
      if(req.method==='GET'&&url.pathname==='/api/bootstrap')return json(res,200,{token:session.csrf,version:'0.4.1',selectedReserve:sessionReserve.get(session.sid)?.reserve??19,phone:{remote:true,online:peers.has(session.deviceId),mode:'live_relay'}});
      if(req.method==='GET'&&Object.hasOwn(catalogs,url.pathname.slice(5))&&url.pathname.startsWith('/api/'))return json(res,200,catalogs[url.pathname.slice(5)]);
      if(req.method==='GET'&&url.pathname==='/api/herds'){const query=herdSearchParams(url.searchParams);return json(res,200,projectHerdView(await relay(peers.get(session.deviceId),'herds',{query})));}
      if(req.method==='GET'&&url.pathname==='/api/locations'){
        const query=locationSearchParams(url.searchParams);
        return json(res,200,await relay(peers.get(session.deviceId),'locations',{query}));
      }
      if(req.method==='GET'&&['/api/state','/api/export'].includes(url.pathname)){
        const reserve=Number(url.searchParams.get('reserve')??sessionReserve.get(session.sid)?.reserve??19);if(!Number.isInteger(reserve)||reserve<0||reserve>999)return json(res,400,{error:'Invalid reserve'});
        const speciesValues=url.pathname==='/api/state'?url.searchParams.getAll('huntSpecies'):[];
        if(speciesValues.length>1||speciesValues.length===1&&(!speciesValues[0]||speciesValues[0].length>120||/[\x00-\x1f\x7f]/.test(speciesValues[0])))return json(res,400,{error:'Invalid Hunt species'});
        if(sessionReserve.size<2048||sessionReserve.has(session.sid))sessionReserve.set(session.sid,{reserve,expiresAt:session.exp});
        const result=await relay(peers.get(session.deviceId),url.pathname==='/api/state'?'state':'export',{reserve,...(speciesValues.length?{huntSpecies:speciesValues[0]}:{})});
        if(url.pathname==='/api/state')result.reserves=(result.reserves??[]).map(r=>({...catalogs.maps.reserves.find(x=>x.id===r.id),...r,poi:r.id===reserve?(catalogs.maps.reserves.find(x=>x.id===r.id)?.poi??[]).map(p=>{const key='place:poi:'+hash(JSON.stringify([r.id,p.kind,p.x,p.z])),matches=r.poi?.filter(x=>x.renameId===key)??[],duplicates=(catalogs.maps.reserves.find(x=>x.id===r.id)?.poi??[]).filter(x=>x.kind===p.kind&&x.x===p.x&&x.z===p.z).length;if(matches.length!==1||duplicates!==1)return {...p,canRename:false,renameId:null};const saved=matches[0],customLabel=typeof saved.customLabel==='string'&&saved.customLabel.length<=120?saved.customLabel:null;return {...p,renameId:key,canRename:saved.canRename===true,renameUnavailableReason:saved.renameUnavailableReason??null,originalLabel:p.label,customLabel,label:customLabel||p.label};}):[]}));
        return json(res,200,result,url.pathname==='/api/export'?{'Content-Disposition':'attachment; filename="COTW-phone-view.json"'}:{});
      }
      return json(res,404,{error:'Not found'});
    }catch(e){return json(res,[400,403,404,409,413,415,429,503,504].includes(e.status)?e.status:500,{error:[400,403,404,409,413,415,429,503,504].includes(e.status)?e.message:'The phone service could not complete the request.'});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  const wss=new WebSocketServer({noServer:true,maxPayload:PHONE_MAX_BYTES,perMessageDeflate:false,handleProtocols:protocols=>protocols.has(PHONE_PROTOCOL)?PHONE_PROTOCOL:false});
  const connections=new Set();
  server.on('upgrade',(req,socket,head)=>{
    const reject=(code=401)=>socket.end('HTTP/1.1 '+code+' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    if(req.url!==mount+'/phone/bridge'||req.headers.host!==new URL(origin).host||req.headers.origin)return reject();
    const header=req.headers['sec-websocket-protocol'];if(typeof header!=='string'||header.length>2100)return reject();
    const protocols=header.split(',').map(s=>s.trim());
    if(protocols.length!==2||!protocols.includes(PHONE_PROTOCOL))return reject();
    const credential=protocols.find(s=>s.startsWith('cotw-auth.'))?.slice(10),identity=verify(credential,'device');
    if(!identity)return reject();
    if(limited('upgrades:'+identity.installationId,120))return reject(429);
    const known=installationGenerations.get(identity.installationId);
    if(known&&(identity.generation<known.generation||identity.generation===known.generation&&identity.deviceId!==known.deviceId))return reject();
    const previous=[...peers.values()].find(p=>p.installationId===identity.installationId);
    if(!previous&&peers.size>=maxPeers||!known&&installationGenerations.size>=2048)return reject(503);
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,identity));
  });
  wss.on('connection',(socket,req,identity)=>{
    connections.add(socket);
    const peer={deviceId:identity.deviceId,installationId:identity.installationId,generation:identity.generation,socket,alive:true,expiresAt:identity.exp};
    const previous=[...peers.values()].find(p=>p.installationId===peer.installationId);if(previous){invalidatePeer(previous);previous.socket.terminate();}
    installationGenerations.set(peer.installationId,{generation:peer.generation,deviceId:peer.deviceId,expiresAt:peer.expiresAt});
    peers.set(peer.deviceId,peer);socket.send(JSON.stringify({type:'ready',deviceId:peer.deviceId}));
    socket.on('error',()=>{});
    socket.on('message',(bytes,isBinary)=>{
      try{
        if(isBinary||bytes.length>PHONE_MAX_BYTES)return socket.close(1009);
        let m;try{m=JSON.parse(bytes.toString());}catch{return socket.close(1008);}
        if(peers.get(peer.deviceId)!==peer)return socket.close(1008);
        if(peer.expiresAt<=now())return socket.close(1008,'Device credential expired');
        if(limited('messages:'+peer.deviceId,120))return socket.close(1008,'Too many messages');
        if(m.type==='pong'){peer.alive=true;return;}
        if(m.type==='pair'){
          if(typeof m.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(m.requestId)||limited('pair-create:'+peer.deviceId,10))return socket.close(1008);
          for(const [k,v]of pairs)if(v.expiresAt<=now()||v.peer===peer)pairs.delete(k);
          if(pairs.size>=maxPeers)return socket.close(1013);
          const token=random(),expiresAt=now()+pairTtlMs;pairs.set(hash(token),{peer,expiresAt});
          socket.send(JSON.stringify({type:'pairing',requestId:m.requestId,url:address+'/phone/connect#pair='+token,expiresAt}));return;
        }
        if(m.type==='response'){
          const waiting=pending.get(m.id);if(!waiting||waiting.peer!==peer)return;
          clearTimeout(waiting.timer);pending.delete(m.id);
          if(m.status===200&&m.data&&typeof m.data==='object')waiting.resolve(m.data);
          else waiting.reject(Object.assign(Error(m.status===409?'The journal changed. Refresh before saving.':'The PC could not complete this request.'),{status:[400,403,404,409,413,429].includes(m.status)?m.status:503}));
          return;
        }
        socket.close(1008,'Unsupported message');
      }catch{socket.close(1008,'Invalid message');}
    });
    socket.on('close',()=>{connections.delete(socket);invalidatePeer(peer);});
  });
  const cleanup=setInterval(()=>{
    for(const [k,p]of pairs)if(p.expiresAt<=now())pairs.delete(k);
    for(const [k,r]of rates)if(r.until<=now())rates.delete(k);
    for(const [k,s]of sessionReserve)if(s.expiresAt<=now())sessionReserve.delete(k);
    for(const [k,s]of installationGenerations)if(s.expiresAt<=now())installationGenerations.delete(k);
    for(const p of peers.values()){if(!p.alive||p.expiresAt<=now()){p.socket.terminate();continue;}p.alive=false;p.socket.send(JSON.stringify({type:'ping'}));}
  },30000);cleanup.unref();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  if(allowInsecureLoopback&&new URL(origin).port==='0'){origin=origin.replace(':0',':'+server.address().port);address=origin+mount;}
  return {server,origin:address,async close(){clearInterval(cleanup);for(const p of peers.values())invalidatePeer(p);for(const s of connections)s.terminate();await new Promise(resolve=>wss.close(resolve));server.closeIdleConnections?.();await new Promise(resolve=>server.close(resolve));}};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const relay=await createPhoneRelay({key:process.env.PHONE_RELAY_SIGNING_KEY,publicOrigin:process.env.PHONE_RELAY_ORIGIN||process.env.RENDER_EXTERNAL_URL,port:Number(process.env.PORT||10000),host:process.env.PHONE_RELAY_BIND_HOST||'0.0.0.0'});
  console.log('GrindZone phone relay ready. No game-save storage is configured.');
  if(process.send)process.send({ready:true,port:relay.server.address().port});
  let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await relay.close();process.exit(0);});
}
