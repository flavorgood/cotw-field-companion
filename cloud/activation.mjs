/** Self-service device setup; a random local key owns ONLY its newly derived identity. */
const ID=/^[A-Za-z0-9_-]{43}$/;
const DAY=86400000;
const validKey=value=>typeof value==='string'&&ID.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;
export function issueActivatedDevice(codec,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'activationKey')||!validKey(input.activationKey))throw Object.assign(Error('Invalid connection setup request'),{status:400});
  // Keyed, domain-separated identifiers cannot nominate an existing player or installation.
  const installationId=codec.mac('grindzone-self-install-v1:'+input.activationKey);
  const deviceId=codec.mac('grindzone-self-device-v1:'+input.activationKey);
  return {deviceId,deviceToken:codec.issue('device',{installationId,deviceId,generation:1},365*DAY)};
}
export function createActivationHandler({codec,publicOrigin,now=Date.now,limit=30,windowMs=60000,maxConcurrent=4}={}){
  const address=new URL(publicOrigin),route=address.pathname.replace(/\/$/,'')+'/phone/activate';
  let windowStart=now(),count=0,active=0;
  const send=(res,status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  return async function handle(req,res){
    if(req.method!=='POST')return send(res,405,{error:'Use GrindZone on your PC to connect.'});
    if(req.headers.host!==address.host||req.headers.origin||req.headers['sec-fetch-site']||req.headers.authorization)return send(res,403,{error:'Start phone access from GrindZone on your PC.'});
    if(req.url!==route)return send(res,400,{error:'Invalid connection setup address'});
    const time=now();if(time-windowStart>=windowMs||time<windowStart){windowStart=time;count=0;}
    if(++count>limit||active>=maxConcurrent)return send(res,429,{error:'Phone setup is busy. Try again in a minute.'});
    if(String(req.headers['content-type']||'').split(';')[0].trim()!=='application/json')return send(res,415,{error:'JSON required'});
    active++;
    try{
      let bytes=0;const chunks=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>512)return send(res,413,{error:'Connection setup request is too large'});chunks.push(chunk);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(res,400,{error:'Invalid connection setup request'});}
      return send(res,201,issueActivatedDevice(codec,input));
    }catch(error){return send(res,error.status===400?400:503,{error:error.status===400?'Invalid connection setup request':'Phone setup is temporarily unavailable.'});}
    finally{active--;}
  };
}
