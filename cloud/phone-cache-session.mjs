/** Bind private browser copies to the canonical signed phone cookie.
 * Never changes original API authorization or forwards host credentials to a child.
 */
import {readFileSync} from 'node:fs';
import {phoneTokenCodec} from './auth.mjs';
import {mountClientSource} from './mount.mjs';
import {bindPhoneCacheClient} from './phone-cache-client.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Type':'text/javascript; charset=utf-8'};
export function pairedCacheHeaders(cookie,{codec,cookieName,now=Date.now}){
 const found=String(cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));
 if(found.length!==1)return {};
 const session=codec.verify(found[0].slice(cookieName.length+1),'phone');
 if(!session||typeof session.deviceId!=='string'||typeof session.sid!=='string'||!Number.isSafeInteger(session.exp)||session.exp<=now())return {};
 return {'X-GrindZone-Cache-Scope':codec.mac('paired-browser-cache:v1:'+session.deviceId+':'+session.sid),'X-GrindZone-Cache-Expires':String(session.exp)};
}
export function installPhoneCache(relay,{key,now=Date.now}){
 const address=new URL(relay.origin),mount=address.pathname.replace(/\/$/,''),cookieName=mount?'__Secure-grindzone-phone':'__Host-cotw-phone';
 const codec=phoneTokenCodec({key,now});
 const app=mountClientSource(bindPhoneCacheClient(readFileSync(new URL('../public/app.js',import.meta.url),'utf8')),mount);
 const client=mountClientSource(readFileSync(new URL('../public/phone-cache.js',import.meta.url),'utf8'),mount);
 const assets=new Map([[mount+'/app.js',app],[mount+'/phone-cache.js',client]]),handlers=relay.server.listeners('request');
 relay.server.removeAllListeners('request');
 relay.server.on('request',(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const sameOrigin=req.headers.host===address.host&&(!req.headers.origin||req.headers.origin===address.origin)&&!['cross-site','same-site'].includes(req.headers['sec-fetch-site']);
  if(sameOrigin&&req.method==='GET'&&assets.has(pathname)){res.writeHead(200,headers);return res.end(assets.get(pathname));}
  if(sameOrigin&&req.method==='GET'&&[mount+'/api/bootstrap',mount+'/api/state'].includes(pathname))for(const [name,value]of Object.entries(pairedCacheHeaders(req.headers.cookie,{codec,cookieName,now})))res.setHeader(name,value);
  // The original relay must still reject missing/expired/duplicate cookies and disallowed origins.
  for(const handler of handlers)handler.call(relay.server,req,res);
 });
 return relay;
}
