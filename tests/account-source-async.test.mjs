import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAccountSourceBoundary} from '../cloud/account-source-boundary.mjs';
const later=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const failure=status=>Object.assign(Error('Expected test denial'),{status});
function fixture(){
 let revoked=false,session='test-session',reads=0;
 const now=1800000000000,origin='https://grindzone.test',issuer='https://issuer.test';
 const p={installationId:'test-installation',deviceId:'test-device',generation:1,expiresAt:now+60000};
 const tag=(...v)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const lease={ownerId:tag('owner',issuer,'test-user'),sourceId:'test-source',sourceTag:tag('installation',p.installationId),epoch:'one',version:1};
 const registry={tag,lease:async()=>lease,assertLease:async()=>lease,observePeer:async()=>({}),sources:async()=>[{sourceId:lease.sourceId}],cancelSession:async()=>2,
 request:async(_a,_p,_i,g)=>{await g.authorize();return {state:'pending'};},complete:async(_a,_p,_i,g)=>{await g.authorize();return {state:'approved'};},unlink:async(_a,_i,g)=>{await g.authorize();return {unlinked:true};},pendingFor:async()=>[],decide:async()=>({state:'pc_approved'})};
 const options={registry,issuer,origin,now:()=>now,authenticateAccount:async()=>revoked?null:{issuer,subject:'test-user',sessionId:session,emailVerified:true,expiresAt:now+60000,csrf:'csrf',displayName:'Synthetic'},resolvePairedPeer:async()=>p,currentPeer:async()=>p,verifyDevice:async()=>({...p,exp:p.expiresAt}),readPeer:async tag=>{reads++;assert.equal(tag,lease.sourceTag);return {deviceId:p.deviceId,generation:p.generation,sourceUpdatedAt:new Date(now).toISOString(),state:{harvestCount:3,private:'discard'}};},projectState:s=>({harvestCount:s.harvestCount})};
 const req={headers:{host:'grindzone.test',origin,'sec-fetch-site':'same-origin','x-grindzone-account-csrf':'csrf'}};
 return {registry,options,req,lease,p,boundary:()=>createAccountSourceBoundary(options),revoke:()=>revoked=true,switchSession:()=>session='different-session',reads:()=>reads};
}
test('async lease is resolved before the source reader and only projected data is returned',async()=>{const f=fixture();assert.deepEqual((await f.boundary().read(f.req,'test-source')).state,{harvestCount:3});assert.equal(f.reads(),1);});
test('an async ownership denial prevents every source read',async()=>{const f=fixture();f.registry.lease=async()=>{await Promise.resolve();throw failure(404);};await assert.rejects(f.boundary().read(f.req,'test-source'),e=>e.status===404);assert.equal(f.reads(),0);});
test('principal waits for async ownership and lease checks',async()=>{const f=fixture();let checked=0;f.registry.assertLease=async()=>{await Promise.resolve();checked++;return f.lease;};const p=await f.boundary().principal(f.req,'test-source');assert.equal(p.sourceId,'test-source');assert.equal(checked,1);});
test('cancelPending returns a number rather than a Promise object',async()=>{const f=fixture();assert.deepEqual(await f.boundary().cancelPending(f.req),{cancelled:2});});
for(const method of ['sources','principal','read'])test('revocation during '+method+' database lookup withholds the result',async()=>{const f=fixture(),g=later(),waiting=later();const key=method==='sources'?'sources':'lease';f.registry[key]=async()=>{waiting.resolve();await g.promise;return method==='sources'?[]:f.lease;};const pending=f.boundary()[method](f.req,'test-source');await waiting.promise;f.revoke();g.resolve();await assert.rejects(pending,e=>e.status===401);assert.equal(f.reads(),0);});
test('rejected delayed final lease check is awaited, never leaked as an unhandled rejection',async()=>{const f=fixture();let calls=0;f.registry.assertLease=async()=>{calls++;await Promise.resolve();if(calls===2)throw failure(404);return f.lease;};await assert.rejects(f.boundary().read(f.req,'test-source'),e=>e.status===404);assert.equal(calls,2);});
test('device-generation write is awaited before releasing source data',async()=>{const f=fixture();f.registry.observePeer=async()=>{await Promise.resolve();throw failure(409);};await assert.rejects(f.boundary().read(f.req,'test-source'),e=>e.status===409);});
test('session changes during source lookup are denied even for the same account',async()=>{const f=fixture();f.registry.lease=async()=>{f.switchSession();return f.lease;};await assert.rejects(f.boundary().read(f.req,'test-source'),e=>e.status===401);assert.equal(f.reads(),0);});
for(const [method,key,input]of [['requestLink','request',{requestId:'test-request',label:'PC'}],['completeLink','complete',{requestId:'test-request'}],['unlink','unlink',{sourceId:'test-source',expectedVersion:1}],['cancelPending','cancelSession',undefined]])test(method+' supplies a fresh authorization guard for the storage transaction',async()=>{const f=fixture();f.registry[key]=async(...args)=>{f.revoke();await args.at(-1).authorize();assert.fail('revoked transaction must not mutate');};await assert.rejects(f.boundary()[method](f.req,input),e=>e.status===401);});
test('source generation changing during lease validation withholds read',async()=>{const f=fixture();let n=0;f.options.currentPeer=async()=>++n>1?{...f.p,generation:2}:f.p;await assert.rejects(f.boundary().read(f.req,'test-source'),e=>e.status===409);});
test('async PC inbox cannot return after its signed source goes away',async()=>{const f=fixture();let online=true;f.options.currentPeer=async()=>online?f.p:null;f.registry.pendingFor=async()=>{online=false;return [{requestId:'hidden'}];};await assert.rejects(f.boundary().pendingOnPC('test-token'),e=>e.status===409);});
test('awaited cancellation failure propagates instead of a success envelope',async()=>{const f=fixture();f.registry.cancelSession=async()=>{throw failure(503);};await assert.rejects(f.boundary().cancelPending(f.req),e=>e.status===503);});
