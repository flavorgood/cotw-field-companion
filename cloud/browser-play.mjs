/** Public, no-PC entry to a private browser-owned journal. No account or save API proxy. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export const browserPlayAssets=Object.freeze([
 'browser-play.js','browser-play.css','browser-journal.js','browser-journal-storage.js',
 'harvest-intake.js','harvest-intake-core.js','harvest-intake.css','harvest-ocr.js',
 'map.js','map-geometry.js','terrain-layer.js','route-stops.js','species-style.js','data-client.js','icon.svg'
]);
export const ocrVendorAssets=Object.freeze(['tesseract.min.js','worker.min.js','lang/eng.traineddata.gz',...['','-simd','-lstm','-simd-lstm','-relaxedsimd','-relaxedsimd-lstm'].flatMap(kind=>['core/tesseract-core'+kind+'.wasm.js','core/tesseract-core'+kind+'.wasm'])]);
const types={'.wasm':'application/wasm','.gz':'application/gzip','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://mathartbang.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
export function createBrowserPlayHandler({publicOrigin,readAsset=name=>readFileSync(path.join(root,name))}={}){
 const base=new URL(publicOrigin),origin=base.origin,mount=base.pathname==='/'?'':base.pathname.replace(/\/$/,'');
 if(base.username||base.password||base.search||base.hash||!['','/grindzone'].includes(mount))throw Error('A fixed GrindZone mount is required');
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('HTTPS is required');
 const prefix=mount+'/play',assets=new Map(browserPlayAssets.map(name=>[prefix+'/'+name,readAsset('public/'+name)]));
 assets.set(prefix+'/',readAsset('public/browser-play.html'));assets.set(prefix+'/index.html',assets.get(prefix+'/'));
 for(const [name,file]of [['maps','maps-data'],['reference','rating-data'],['gear','gear-data']])assets.set(prefix+'/catalog/'+name+'.json',readAsset('lib/'+file+'.json'));
 function send(res,status,body,type='text/plain; charset=utf-8'){res.writeHead(status,{...headers,'Content-Type':type});res.end(body);}
 return (req,res)=>{
  if(typeof req.url!=='string'||!req.url.startsWith(prefix))return false;
  let url;try{url=new URL(req.url,origin);}catch{send(res,400,'Invalid request');return true;}
  // Do not broaden the matched route into other relay paths or filesystem locations.
  if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
  if(req.headers.host!==base.host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&['same-site','cross-site'].includes(req.headers['sec-fetch-site'])){send(res,403,'Open GrindZone directly');return true;}
  if(!['GET','HEAD'].includes(req.method)){send(res,405,'This entry accepts no journal uploads or remote changes.');return true;}
  if(url.pathname===prefix){res.writeHead(302,{...headers,Location:prefix+'/'});res.end();return true;}
  const vendor=ocrVendorAssets.find(name=>url.pathname===prefix+'/vendor/ocr/'+name);
  if(vendor){try{const body=readAsset('public/vendor/ocr/'+vendor);send(res,200,req.method==='HEAD'?'':body,types[path.extname(vendor)]);}catch{send(res,503,'Screenshot reader asset unavailable. Your journal is unchanged.');}return true;}
  if(!assets.has(url.pathname)){send(res,404,'Not found');return true;}
  const type=types[path.extname(url.pathname)]||types['.html'];send(res,200,req.method==='HEAD'?'':assets.get(url.pathname),type);return true;
 };
}
export function installBrowserPlay(relay,options={}){
 const handle=createBrowserPlayHandler({publicOrigin:relay.origin,...options}),prior=relay.server.listeners('request');
 relay.server.removeAllListeners('request');relay.server.on('request',(req,res)=>{if(handle(req,res))return;for(const handler of prior)handler.call(relay.server,req,res);});return relay;
}
