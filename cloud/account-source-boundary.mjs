/** Canonical account/source authorization for synchronous or asynchronous registries.
 * Production callbacks must verify real provider sessions and current signed relay peers.
 * Storage completion is awaited; no Promise is treated as an ownership authorization.
 */
import {timingSafeEqual} from 'node:crypto';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const time=v=>Number.isSafeInteger(v)&&v>=0;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const only=(v,fields)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!fields.includes(k)))fail(400,'Unsupported account-source request');};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length>0&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createAccountSourceBoundary({registry,issuer,origin,authenticateAccount,resolvePairedPeer,verifyDevice,currentPeer,readPeer,projectState,now=Date.now}={}){
  if(!registry||!['authenticateAccount','resolvePairedPeer','verifyDevice','currentPeer','readPeer','projectState'].every(k=>typeof ({authenticateAccount,resolvePairedPeer,verifyDevice,currentPeer,readPeer,projectState})[k]==='function'))throw TypeError('Verified account, paired peer, device channel, reader and canonical projection callbacks are required');
  if(typeof issuer!=='string'||new URL(issuer).protocol!=='https:'||new URL(origin).origin!==origin||new URL(origin).protocol!=='https:')throw TypeError('Fixed HTTPS account issuer and application origin required');
  async function account(req,write=false){
    if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))fail(403,'Open GrindZone directly');
    const a=await authenticateAccount(req);
    if(!a||a.issuer!==issuer||!id(a.subject)||!id(a.sessionId)||a.emailVerified!==true||!time(a.expiresAt)||a.expiresAt<=now())fail(401,'A current verified GrindZone account is required');
    if(write&&(req.headers.origin!==origin||!equal(req.headers['x-grindzone-account-csrf'],a.csrf)))fail(403,'Refresh the account page before saving');
    return {owner:registry.tag('owner',issuer,a.subject),session:registry.tag('session',issuer,a.subject,a.sessionId),sessionExpires:a.expiresAt,displayName:typeof a.displayName==='string'?a.displayName.slice(0,80):'GrindZone player'};
  }
  async function recheck(req,prior,write=false){
    const current=await account(req,write);
    if(current.owner!==prior.owner||current.session!==prior.session)fail(401,'Account session changed');
    return current;
  }
  async function peer(prior){
    if(!prior||!id(prior.deviceId)||!id(prior.installationId)||!time(prior.expiresAt)||prior.expiresAt<=now())fail(409,'PC connection changed');
    const current=await currentPeer(prior.deviceId);
    if(!current||current.installationId!==prior.installationId||current.deviceId!==prior.deviceId||current.generation!==prior.generation||!time(current.expiresAt)||current.expiresAt<=now())fail(409,'PC connection changed');
    return current;
  }
  async function device(token){
    const d=await verifyDevice(token);
    if(!d||!time(d.exp)||d.exp<=now()||!Number.isSafeInteger(d.generation)||d.generation<1||!id(d.installationId)||!id(d.deviceId))fail(401,'Authenticated PC channel required');
    return peer({...d,expiresAt:d.exp});
  }
  function accountGuard(req,a,p=null,write=true){return {authorize:async()=>{
    await recheck(req,a,write);
    if(p){const paired=await resolvePairedPeer(req);if(!paired||paired.deviceId!==p.deviceId||paired.installationId!==p.installationId||paired.generation!==p.generation)fail(409,'The paired PC connection changed');await peer(p);}
  }};}
  return {
    async requestLink(req,input){
      only(input,['requestId','label']);const a=await account(req,true),p=await peer(await resolvePairedPeer(req));
      await recheck(req,a,true);const result=await registry.request(a,p,input,accountGuard(req,a,p));await recheck(req,a,true);return result;
    },
    async pendingOnPC(token){
      const p=await device(token),result=await registry.pendingFor(p,{authorize:()=>device(token)});await device(token);return result;
    },
    async approveOnPC(token,input){
      only(input,['requestId','approve']);const p=await device(token),result=await registry.decide(p,input,{authorize:()=>device(token)});await device(token);return result;
    },
    async completeLink(req,input){
      only(input,['requestId']);const a=await account(req,true),p=await peer(await resolvePairedPeer(req));
      const current=await recheck(req,a,true),result=await registry.complete(current,p,input,accountGuard(req,a,p));await recheck(req,a,true);return result;
    },
    async sources(req){const a=await account(req),result=await registry.sources(a.owner);await recheck(req,a);return result;},
    async principal(req,sourceId){
      const a=await account(req),lease=await registry.lease(a.owner,sourceId),current=await recheck(req,a);await registry.assertLease(lease);
      return {userId:a.owner,sourceId:lease.sourceId,lease,session:a.session,expiresAt:current.sessionExpires};
    },
    async read(req,sourceId){
      const a=await account(req),lease=await registry.lease(a.owner,sourceId);
      await recheck(req,a);const result=await readPeer(lease.sourceTag);
      await recheck(req,a);await registry.assertLease(lease);
      if(!result)return null;
      const p=await currentPeer(result.deviceId);
      if(!p||p.deviceId!==result.deviceId||p.generation!==result.generation||!time(p.expiresAt)||p.expiresAt<=now()||registry.tag('installation',p.installationId)!==lease.sourceTag)fail(409,'Source connection changed during the read');
      const projected=await projectState(result.state);
      await registry.observePeer(p,accountGuard(req,a,null,false));
      await recheck(req,a);await registry.assertLease(lease);await peer(p);
      return {ownerId:a.owner,sourceId:lease.sourceId,bindingEpoch:lease.epoch,sourceUpdatedAt:result.sourceUpdatedAt,state:projected};
    },
    async unlink(req,input){
      only(input,['sourceId','expectedVersion']);const a=await account(req,true),result=await registry.unlink(a.owner,input,accountGuard(req,a));await recheck(req,a,true);return result;
    },
    async cancelPending(req){const a=await account(req,true),cancelled=await registry.cancelSession(a.owner,a.session,accountGuard(req,a));await recheck(req,a,true);return {cancelled};}
  };
}
