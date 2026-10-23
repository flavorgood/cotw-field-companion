/** Runs the actual launcher against disposable loopback responses, never a real game save. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimeIdentity,runtimeScope} from '../lib/runtime-identity.mjs';
const launcher=fileURLToPath(new URL('../launcher.mjs',import.meta.url));
async function fixture(t,name,{otherSource=false,customData=false,matchingCustom=false,differentBuild=false,legacy=false}={}){
  const root=await mkdtemp(path.join(tmpdir(),'grindzone-launch-regression-'));
  const save=path.join(root,'synthetic-save'),appData=path.join(root,'app-data');await mkdir(save);await mkdir(appData);
  const marker=path.join(save,'test-sentinel.txt');await writeFile(marker,'Synthetic fixture, not a game save.');
  const defaultData=path.join(appData,'COTW Field Companion'),explicitData=path.join(root,'explicit-journal');
  const identity=runtimeIdentity(path.dirname(launcher));
  const runtime={...identity,scope:runtimeScope(matchingCustom?explicitData:defaultData,otherSource?path.join(root,'another-player'):save)};
  if(differentBuild)runtime.fingerprint='0'.repeat(64);
  const requests=[];
  const server=createServer((req,res)=>{
    requests.push({method:req.method,path:req.url});res.setHeader('Content-Type','application/json');
    if(!['GrindZone','COTW Field Companion'].includes(name)){res.statusCode=404;return res.end('{}');}
    res.end(JSON.stringify({version:'0.4.1',token:'synthetic-only',...(legacy||name==='COTW Field Companion'?{}:{runtime})}));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true});});
  const env={PATH:process.env.PATH||'',HOME:root,LOCALAPPDATA:appData,COTW_SAVE_DIR:save,COMPANION_PORT:String(server.address().port),...(process.env.SYSTEMROOT?{SYSTEMROOT:process.env.SYSTEMROOT}:{}),...(customData?{COMPANION_DATA_DIR:explicitData}:{})};
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[launcher],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>child.kill(),10000);
    child.stdout.setEncoding('utf8').on('data',chunk=>{stdout+=chunk;});child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;});
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',(code,signal)=>{clearTimeout(timer);if(signal)reject(Error(`Launcher terminated with ${signal}`));else resolve({code,stdout,stderr});});
  });
  const assertUntouched=async(readCount=1)=>{
    assert.equal(await readFile(marker,'utf8'),'Synthetic fixture, not a game save.');assert.deepEqual(await readdir(save),['test-sentinel.txt']);
    assert.deepEqual(await readdir(appData),[],'No duplicate journal is created');
    assert(!((await readdir(root)).includes('explicit-journal')),'Alternate journal is not created');
    assert.deepEqual(requests,Array.from({length:readCount},()=>({method:'GET',path:'/api/bootstrap'})),'Existing-app checks are read-only');
  };
  return {run,assertUntouched};
}
test('a legacy installed companion is not reopened without build evidence',async t=>{
  const f=await fixture(t,'COTW Field Companion'),r=await f.run();assert.notEqual(r.code,0);assert.match(r.stderr,/cannot verify its build/);await f.assertUntouched();
});
test('the verified GrindZone build reopens without another reader',async t=>{
  const f=await fixture(t,'GrindZone'),r=await f.run();assert.equal(r.code,0,r.stderr);assert.match(r.stdout,/GrindZone build [a-f0-9]{12} is already running/);await f.assertUntouched();
});
for(const name of ['Other Application','GrindZone Unrecognized',null])test(`unrecognized application ${name} is rejected`,async t=>{
  const f=await fixture(t,name),r=await f.run();assert.notEqual(r.code,0);assert.match(r.stderr,/occupied/);await f.assertUntouched();
});
test('a recognized GrindZone on another save is not reused',async t=>{
  const f=await fixture(t,'GrindZone',{otherSource:true}),r=await f.run();assert.notEqual(r.code,0);assert.match(r.stderr,/profile or data directory/);await f.assertUntouched();
});
test('a legacy companion on another save is still rejected',async t=>{
  const f=await fixture(t,'COTW Field Companion',{otherSource:true}),r=await f.run();assert.notEqual(r.code,0);assert.match(r.stderr,/cannot verify/);await f.assertUntouched();
});
test('an explicit alternate journal retains the conflict guard',async t=>{
  const f=await fixture(t,'GrindZone',{customData:true}),r=await f.run();assert.notEqual(r.code,0);assert.match(r.stderr,/profile or data directory/);await f.assertUntouched();
});
test('an explicitly selected matching journal can reuse its verified process',async t=>{
  const f=await fixture(t,'GrindZone',{customData:true,matchingCustom:true}),r=await f.run();assert.equal(r.code,0,r.stderr);await f.assertUntouched();
});
test('repeated launches reuse the verified app without writes',async t=>{
  const f=await fixture(t,'GrindZone');for(let i=0;i<2;i++){const r=await f.run();assert.equal(r.code,0,r.stderr);assert.match(r.stdout,/already running/);}await f.assertUntouched(2);
});
test('the same displayed version cannot hide an older running build',async t=>{
  const f=await fixture(t,'GrindZone',{differentBuild:true}),r=await f.run();assert.notEqual(r.code,0);assert.match(r.stderr,/different GrindZone build/);assert.doesNotMatch(r.stdout,/already running/);await f.assertUntouched();
});
test('old GrindZone branding alone does not establish a current build',async t=>{
  const f=await fixture(t,'GrindZone',{legacy:true}),r=await f.run();assert.notEqual(r.code,0);assert.match(r.stderr,/cannot verify/);await f.assertUntouched();
});
