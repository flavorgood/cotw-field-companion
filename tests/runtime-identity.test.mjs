import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,cpSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runtimeIdentity,runtimeScope,assertRunningRuntime,probeRunningRuntime} from '../lib/runtime-identity.mjs';
const fingerprint='a'.repeat(64),scope='b'.repeat(64);
const selected={schema:'grindzone.runtime.v1',version:'0.4.1',fingerprint};
const running={...selected,scope};
function fixture(t){
  const root=mkdtempSync(path.join(tmpdir(),'gz-runtime-identity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const dir of ['lib','public'])mkdirSync(path.join(root,dir));
  for(const file of ['launcher.mjs','server.mjs','lib/reader.mjs','public/app.js'])writeFileSync(path.join(root,file),'// synthetic application\n');
  writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'0.4.1'}));return root;
}
test('fingerprints the actual runtime bytes, independent of install path',t=>{
  const root=fixture(t),copy=root+'-copy';cpSync(root,copy,{recursive:true});t.after(()=>rmSync(copy,{recursive:true,force:true}));
  assert.deepEqual(runtimeIdentity(root),runtimeIdentity(copy));
  writeFileSync(path.join(copy,'public/app.js'),'// changed Insights screen\n');
  assert.notEqual(runtimeIdentity(root).fingerprint,runtimeIdentity(copy).fingerprint);
});
test('backend and generated catalog changes alter the fingerprint',t=>{
  const root=fixture(t),first=runtimeIdentity(root);writeFileSync(path.join(root,'lib/reader.mjs'),'// new reader');
  const second=runtimeIdentity(root);assert.notEqual(first.fingerprint,second.fingerprint);
  writeFileSync(path.join(root,'lib/reference.json'),'{}');assert.notEqual(second.fingerprint,runtimeIdentity(root).fingerprint);
});
test('documentation and external player folders do not enter runtime identity',t=>{
  const root=fixture(t),before=runtimeIdentity(root);writeFileSync(path.join(root,'README.md'),'notes');
  mkdirSync(path.join(root,'player-data'));writeFileSync(path.join(root,'player-data/journal.sqlite'),'private synthetic marker');
  assert.deepEqual(runtimeIdentity(root),before);assert(!JSON.stringify(before).includes(root));
});
test('malformed package version is rejected',t=>{
  const root=fixture(t);writeFileSync(path.join(root,'package.json'),'{}');assert.throws(()=>runtimeIdentity(root),/version/);
});
test('runtime symlinks are rejected rather than following data outside the app',t=>{
  const root=fixture(t);symlinkSync(path.join(root,'lib'),path.join(root,'public/linked'),'junction');
  assert.throws(()=>runtimeIdentity(root),/symbolic link/);
});
test('profile equality includes both the save and companion journal directory',t=>{
  const root=fixture(t),data=path.join(root,'journal'),save=path.join(root,'save');
  assert.equal(runtimeScope(data,save),runtimeScope(path.join(root,'x/../journal'),save));
  assert.notEqual(runtimeScope(data,save),runtimeScope(path.join(root,'other-journal'),save));
  assert.notEqual(runtimeScope(data,save),runtimeScope(data,path.join(root,'other-save')));
  assert(!existsSync(data));assert(!existsSync(save));assert(!runtimeScope(data,save).includes(root));
});
test('verified same build and profile are reusable',()=>assert.doesNotThrow(()=>assertRunningRuntime(running,selected,scope)));
test('same version with different bytes is not reusable',()=>assert.throws(()=>assertRunningRuntime({...running,fingerprint:'c'.repeat(64)},selected,scope),/different GrindZone build/));
test('different journal profile is rejected even on identical code',()=>assert.throws(()=>assertRunningRuntime({...running,scope:'c'.repeat(64)},selected,scope),/profile or data directory/));
test('legacy, malformed and unknown protocols cannot silently reopen',()=>{
  for(const value of [null,{}, {...running,schema:'unknown'}, {...running,fingerprint:'short'}, {...running,scope:null}])assert.throws(()=>assertRunningRuntime(value,selected,scope),/cannot verify/);
});
test('connection refused alone means no running companion',async()=>{
  const fetcher=async()=>{throw Object.assign(Error('fetch failed'),{cause:{code:'ECONNREFUSED'}});};
  assert.equal(await probeRunningRuntime('http://127.0.0.1:12345',{fetcher}),null);
});
test('timeout, resets and unrelated errors cannot start another reader',async()=>{
  for(const code of ['ETIMEDOUT','ECONNRESET','EACCES'])await assert.rejects(probeRunningRuntime('http://127.0.0.1:12345',{fetcher:async()=>{throw Object.assign(Error('failed'),{cause:{code}});}}),/did not respond reliably/);
});
test('bootstrap parsing is bounded and rejects invalid responses',async()=>{
  for(const body of ['not-json','[]','null',' '.repeat(17000)])await assert.rejects(probeRunningRuntime('http://127.0.0.1:12345',{fetcher:async()=>new Response(body)}));
  await assert.rejects(probeRunningRuntime('http://127.0.0.1:12345',{fetcher:async()=>new Response('{}',{status:503})}),/occupied/);
});
test('bootstrap probe uses one read with no redirects and returns no session token',async()=>{
  let calls=0;const result=await probeRunningRuntime('http://127.0.0.1:12345',{fetcher:async(url,options)=>{
    calls++;assert.equal(url,'http://127.0.0.1:12345/api/bootstrap');assert.equal(options.redirect,'error');
    return new Response(JSON.stringify({runtime:running,token:'private-test-token'}));
  }});assert.equal(calls,1);assert.deepEqual(result,{runtime:running});
});
