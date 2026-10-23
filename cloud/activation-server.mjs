/** Add bounded self-service enrollment without changing the canonical pairing/data handlers. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPhoneRelay} from './server.mjs';
import {phoneTokenCodec} from './auth.mjs';
import {createActivationHandler} from './activation.mjs';
import {installPhoneCache} from './phone-cache-session.mjs';
import {installBrowserPlay} from './browser-play.mjs';
export async function createActivatedPhoneRelay(options){
  const relay=await createPhoneRelay(options),address=new URL(relay.origin);
  const route=address.pathname.replace(/\/$/,'')+'/phone/activate';
  const activate=createActivationHandler({codec:phoneTokenCodec({key:options.key,now:options.now}),publicOrigin:relay.origin,now:options.now,limit:options.activationLimit??30});
  const handlers=relay.server.listeners('request');
  relay.server.removeAllListeners('request');
  relay.server.on('request',(req,res)=>{
    if(req.url===route||req.url?.startsWith(route+'?'))return void activate(req,res);
    res.setHeader('X-GrindZone-Phone-Activation','self-service-v1');
    for(const handler of handlers)handler.call(relay.server,req,res);
  });
  try{return installBrowserPlay(installPhoneCache(relay,options));}catch(error){await relay.close();throw error;}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const relay=await createActivatedPhoneRelay({key:process.env.PHONE_RELAY_SIGNING_KEY,publicOrigin:process.env.PHONE_RELAY_ORIGIN||process.env.RENDER_EXTERNAL_URL,port:Number(process.env.PORT||10000),host:process.env.PHONE_RELAY_BIND_HOST||'0.0.0.0'});
  console.log('GrindZone phone activation ready. No game-save storage.');
  if(process.send)process.send({ready:true,port:relay.server.address().port});
  let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await relay.close();process.exit(0);});
}
