import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createServer} from 'node:net';
import * as E from '../updates/engine.mjs';
import {install} from '../updates/install.mjs';
import {ManagedChild} from '../updates/child.mjs';
import {supervise,spawnApp} from '../updates/supervisor.mjs';
import {boot} from '../updates/boot.mjs';
const keys=generateKeyPairSync('ed25519'),trust={keys:{test:keys.publicKey.export({format:'pem',type:'spki'})},updateUrl:'https://updates.example.test/latest.json'},rev=n=>n.toString(16).padStart(40,'0');
const legacyRevision='ea4214c3d60011b4f1ae201d39d90fc157f329d5';
const sourceRoot=new URL('../',import.meta.url);
function build(root,n,{crash=false,desktop=true,revision=rev(n)}={}){
 const dir=path.join(root,'source'+n);fs.mkdirSync(dir);fs.mkdirSync(path.join(dir,'runtime'));fs.mkdirSync(path.join(dir,'updates'));
 const source=`import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {ManagedChild} from './updates/child.mjs';
 const gate=new ManagedChild(),data=process.env.COMPANION_DATA_DIR;${crash?"fs.writeFileSync(path.join(data,'journal.sqlite'),'failed-candidate');process.exit(7);":''}
 const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/bootstrap')return res.end(JSON.stringify({version:'test',runtime:{fingerprint:process.env.GRINDZONE_EXPECTED_FINGERPRINT}}));if(gate.blocked){res.statusCode=503;return res.end('{}');}if(req.url==='/check')return res.end(JSON.stringify(await gate.request('check')));if(req.url==='/status')return res.end(JSON.stringify(await gate.request('status')));if(req.url==='/write'){fs.appendFileSync(path.join(data,'journal.sqlite'),'|player-report');return res.end('{}');}res.end('{}');});
 await new Promise(resolve=>server.listen(Number(process.env.COMPANION_PORT),'127.0.0.1',resolve));const app={url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>server.close(r))};gate.ready(app,{fingerprint:process.env.GRINDZONE_EXPECTED_FINGERPRINT},async()=>{});`;
 fs.writeFileSync(path.join(dir,'server.mjs'),source);fs.writeFileSync(path.join(dir,'launcher.mjs'),'// synthetic launcher');fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module","version":"0.4.1"}');
 if(desktop){fs.mkdirSync(path.join(dir,'desktop'));fs.writeFileSync(path.join(dir,'desktop/GrindZone.Desktop.exe'),'MZ synthetic desktop window');}
 for(const f of ['entry.mjs','engine.mjs','child.mjs','context.mjs','supervisor.mjs','boot.mjs','install.mjs'])fs.copyFileSync(new URL('updates/'+f,sourceRoot),path.join(dir,'updates',f));fs.writeFileSync(path.join(dir,'updates/trust.json'),JSON.stringify(trust));fs.writeFileSync(path.join(dir,'INSTALL.cmd'),'synthetic installer entry');fs.writeFileSync(path.join(dir,'runtime/LICENSE'),'Synthetic test fixture');fs.writeFileSync(path.join(dir,'runtime/node.exe'),'MZ not run');
 const entries=new Map();function walk(p=''){for(const e of fs.readdirSync(path.join(dir,p),{withFileTypes:true})){const n=path.posix.join(p,e.name);if(e.isDirectory())walk(n);else entries.set(n,fs.readFileSync(path.join(dir,n)));}}walk();
 const bundle=E.encodeBundle(entries),manifest={schema:'grindzone.update-manifest.v1',product:'GrindZone',channel:'stable',platform:'win32-x64',protocol:1,sequence:n,revision,runtimeFingerprint:'a'.repeat(64),storageContract:'b'.repeat(64),journalEpoch:1,publishedAt:'2026-09-23T00:00:00Z',expiresAt:'2027-09-23T00:00:00Z',bundle:{name:`payload-${E.digest(bundle)}.gz`,bytes:bundle.length,sha256:E.digest(bundle)},files:[...entries].map(([path,bytes])=>({path,bytes:bytes.length,sha256:E.digest(bytes)}))};const payload=Buffer.from(E.canonical(manifest)),envelope={schema:'grindzone.signed-release.v1',keyId:'test',payload:payload.toString('base64'),signature:sign(null,payload,keys.privateKey).toString('base64')};fs.writeFileSync(path.join(dir,'SIGNED-RELEASE.json'),JSON.stringify(envelope));return {dir,entries,manifest,envelope,bundle};
}
async function fixture(t){const root=fs.mkdtempSync(path.join(tmpdir(),'gz-update-lifecycle-')),home=path.join(root,'installed'),dataDir=path.join(root,'journal'),saveDir=path.join(root,'synthetic-save');fs.mkdirSync(dataDir);fs.mkdirSync(saveDir);fs.writeFileSync(path.join(dataDir,'journal.sqlite'),'harvests|private-pairing');fs.writeFileSync(path.join(saveDir,'sentinel'),'do not write game data');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return {root,home,context:{dataDir,saveDir,port}};}
const fetchFor=r=>async url=>new Response(url.endsWith('latest.json')?JSON.stringify(r.envelope):r.bundle);
const spawnRuntime=options=>spawnApp({...options,executable:process.execPath});
test('install-once seeds signed code and desktop shortcut path without touching journal or save files',async t=>{const f=await fixture(t),a=build(f.root,1);const result=install({source:a.dir,home:f.home,context:f.context,trust});assert.equal(result.installed,true);assert.equal(fs.readFileSync(path.join(f.context.dataDir,'journal.sqlite'),'utf8'),'harvests|private-pairing');assert.equal(fs.readFileSync(path.join(f.context.saveDir,'sentinel'),'utf8'),'do not write game data');assert.match(fs.readFileSync(path.join(f.home,'START.cmd'),'utf8'),/kernel\\boot\.mjs" --desktop/);assert(fs.existsSync(path.join(f.home,'kernel/boot.mjs')));assert.equal(install({source:a.dir,home:f.home,context:f.context,trust}).installed,false);});
test('repeat install refuses switching journal configuration',async t=>{const f=await fixture(t),a=build(f.root,1);install({source:a.dir,home:f.home,context:f.context,trust});assert.throws(()=>install({source:a.dir,home:f.home,context:{...f.context,dataDir:path.join(f.root,'other')},trust}),/configuration/);});
test('real app child starts, downloads next release without interruption, then activates on next launch',async t=>{
 const f=await fixture(t),a=build(f.root,1),b=build(f.root,2);install({source:a.dir,home:f.home,context:f.context,trust});let pid;
 const common={home:f.home,trust,context:f.context,spawnRuntime,fetcher:fetchFor(b),launchBrowser:false,log:()=>{}};
 const first=await supervise({...common,onStarted:async runtime=>{pid=runtime.child.pid;const url='http://127.0.0.1:'+f.context.port;await fetch(url+'/write');const status=await fetch(url+'/check').then(r=>r.json());assert.equal(status.staged,rev(2));assert.equal(status.current,rev(1));assert.equal(runtime.child.pid,pid);await runtime.stop();}});assert.equal(first.code,0);assert.equal(E.loadState(f.home).current,rev(1));
 const second=await supervise({...common,onStarted:async runtime=>{assert.equal(E.loadState(f.home).current,rev(2));assert.equal(E.loadState(f.home).pending,null);const status=await fetch('http://127.0.0.1:'+f.context.port+'/status').then(r=>r.json());assert.equal(status.current,rev(2));await runtime.stop();}});assert.equal(second.code,0);assert.equal(fs.readFileSync(path.join(f.context.dataDir,'journal.sqlite'),'utf8'),'harvests|private-pairing|player-report');
});
test('signed desktop window owns both current and next-launch staged server lifetimes without browser launch',async t=>{
 const f=await fixture(t),a=build(f.root,1),b=build(f.root,2);install({source:a.dir,home:f.home,context:f.context,trust});
 const windows=[];let active,opened=0;
 const desktopLauncher=({directory,home,port})=>{
  assert.equal(home,f.home);assert.equal(port,f.context.port);assert(fs.existsSync(path.join(directory,'desktop/GrindZone.Desktop.exe')));
  if(windows.length===1){assert.equal(E.loadState(f.home).current,rev(1));assert.equal(E.loadState(f.home).pending?.candidate,rev(2));}
  let resolve;const exit=new Promise(r=>{resolve=r;});let closed=false;
  const window={exit,ready:Promise.resolve(),canOpen:()=>!closed,open:()=>{assert(!closed);if(windows.length===2){assert.equal(E.loadState(f.home).current,rev(2));assert.equal(E.loadState(f.home).pending,null);}opened++;},close:()=>{if(!closed){closed=true;resolve({code:0});}},userClose:()=>{if(!closed){closed=true;resolve({code:0});}}};
  windows.push({revision:path.basename(directory),window});active=window;return window;
 };
 const common={home:f.home,trust,context:f.context,spawnRuntime,desktopLauncher,fetcher:fetchFor(b),launchDesktop:true,log:()=>{}};
 const first=await supervise({...common,onStarted:async()=>{
  assert.equal(E.loadState(f.home).current,rev(1));
  const result=await E.checkAndStage(f.home,trust,{fetcher:fetchFor(b)});assert.equal(result.status,'staged');
  active.userClose();
 }});assert.equal(first.code,0);assert.equal(E.loadState(f.home).staged,rev(2));
 const second=await supervise({...common,onStarted:async()=>{
  assert.equal(E.loadState(f.home).current,rev(2));assert.equal(E.loadState(f.home).pending,null);
  active.userClose();
 }});assert.equal(second.code,0);
 assert.deepEqual(windows.map(w=>w.revision),[rev(1),rev(2)]);
 assert.equal(opened,2);
 assert.equal(fs.readFileSync(path.join(f.context.dataDir,'journal.sqlite'),'utf8'),'harvests|private-pairing');
});
test('desktop preflight failure keeps user writes gated and restores the legacy journal and browser',async t=>{
 const f=await fixture(t),old=build(f.root,1,{desktop:false,revision:legacyRevision}),next=build(f.root,2);
 install({source:old.dir,home:f.home,context:f.context,trust});install({source:next.dir,home:f.home,context:f.context,trust});
 const opened=[];let nativeLaunches=0,nativeOpens=0;
 const desktopLauncher=({port})=>{
  nativeLaunches++;let resolveExit;const exit=new Promise(resolve=>{resolveExit=resolve;});
  const ready=(async()=>{
   const state=E.loadState(f.home);assert.equal(state.current,legacyRevision);assert.equal(state.pending?.candidate,rev(2));
   const bootstrap=await fetch('http://127.0.0.1:'+port+'/api/bootstrap');assert.equal(bootstrap.status,200);
   const write=await fetch('http://127.0.0.1:'+port+'/write');assert.equal(write.status,503);
   throw Error('WebView2 startup failed');
  })();
  return {ready,exit,canOpen:()=>true,open:()=>{nativeOpens++;},close:()=>resolveExit({code:0})};
 };
 const result=await supervise({home:f.home,trust,context:f.context,spawnRuntime,desktopLauncher,
  browserLauncher:port=>opened.push(port),launchDesktop:true,fetcher:async()=>{throw Error('offline');},log:()=>{},
  onStarted:async runtime=>{
   const state=E.loadState(f.home);assert.equal(state.current,legacyRevision);assert.deepEqual(state.rejected,[rev(2)]);
   assert.equal(fs.readFileSync(path.join(f.context.dataDir,'journal.sqlite'),'utf8'),'harvests|private-pairing');
   await runtime.stop();
  }});
 assert.equal(result.code,0);assert.equal(nativeLaunches,1);assert.equal(nativeOpens,0);assert.deepEqual(opened,[f.context.port]);
});
test('failed real candidate startup rolls back DB before the previous child accepts writes',async t=>{
 const f=await fixture(t),a=build(f.root,1),bad=build(f.root,2,{crash:true});install({source:a.dir,home:f.home,context:f.context,trust});await E.checkAndStage(f.home,trust,{fetcher:fetchFor(bad)});
 const result=await supervise({home:f.home,trust,context:f.context,spawnRuntime,fetcher:fetchFor(bad),launchBrowser:false,log:()=>{},onStarted:async runtime=>{assert.equal(E.loadState(f.home).current,rev(1));assert.equal(fs.readFileSync(path.join(f.context.dataDir,'journal.sqlite'),'utf8'),'harvests|private-pairing');assert.deepEqual(E.loadState(f.home).rejected,[rev(2)]);await runtime.stop();}});assert.equal(result.code,0);
});
test('deferred desktop setup opens the verified legacy browser release and retains pairing',async t=>{
 const f=await fixture(t),old=build(f.root,1,{desktop:false,revision:legacyRevision}),next=build(f.root,2);
 install({source:old.dir,home:f.home,context:f.context,trust});install({source:next.dir,home:f.home,context:f.context,trust});
 assert.match(fs.readFileSync(path.join(f.home,'START.cmd'),'utf8'),/boot\.mjs" --desktop/);
 const opened=[];
 const result=await supervise({home:f.home,trust,context:f.context,spawnRuntime,launchDesktop:true,
  desktopLauncher:()=>{throw Error('Legacy release must not launch a native window');},browserLauncher:port=>opened.push(port),
  activate:()=>{throw Object.assign(Error('cold journal backup blocked'),{code:'EPERM'});},
  fetcher:async()=>{throw Error('offline');},log:()=>{},onStarted:async runtime=>{
   assert.equal(E.loadState(f.home).current,legacyRevision);
   assert.equal(E.loadState(f.home).staged,rev(2));
   assert.equal(fs.readFileSync(path.join(f.context.dataDir,'journal.sqlite'),'utf8'),'harvests|private-pairing');
   await runtime.stop();
  }});
 assert.equal(result.code,0);assert.deepEqual(opened,[f.context.port]);
});
test('failed desktop setup restores a visible legacy release and the repaired shortcut reopens it',async t=>{
 const f=await fixture(t),old=build(f.root,1,{desktop:false,revision:legacyRevision}),bad=build(f.root,2,{crash:true});
 install({source:old.dir,home:f.home,context:f.context,trust});install({source:bad.dir,home:f.home,context:f.context,trust});
 const opened=[];
 const common={home:f.home,trust,context:f.context,spawnRuntime,launchDesktop:true,
  desktopLauncher:()=>{throw Error('Legacy release must not launch a native window');},browserLauncher:port=>opened.push(port),
  fetcher:async()=>{throw Error('offline');},log:()=>{}};
 const first=await supervise({...common,onStarted:async runtime=>{
  const state=E.loadState(f.home);assert.equal(state.current,legacyRevision);assert.equal(state.staged,null);
  assert.deepEqual(state.rejected,[rev(2)]);
  assert.equal(fs.readFileSync(path.join(f.context.dataDir,'journal.sqlite'),'utf8'),'harvests|private-pairing');
  const already=await boot(f.home,{launchDesktop:true,browserLauncher:port=>opened.push(port)});
  assert.equal(already.status,'already_running');
  await runtime.stop();
 }});
 assert.equal(first.code,0);assert.deepEqual(opened,[f.context.port,f.context.port]);
 const reopened=await boot(f.home,{launchDesktop:true,spawnRuntime,browserLauncher:port=>opened.push(port),
  fetcher:async()=>{throw Error('offline');},onStarted:async runtime=>{
   assert.equal(E.loadState(f.home).current,legacyRevision);
   assert.equal(fs.readFileSync(path.join(f.context.dataDir,'journal.sqlite'),'utf8'),'harvests|private-pairing');
   await runtime.stop();
  }});
 assert.equal(reopened.code,0);assert.deepEqual(opened,[f.context.port,f.context.port,f.context.port]);
 assert.throws(()=>E.desktopWindowMode({revision:rev(3),files:[]}),/does not include its desktop window/);
});
test('offline launch stays usable with existing signed files',async t=>{const f=await fixture(t),a=build(f.root,1);install({source:a.dir,home:f.home,context:f.context,trust});const result=await supervise({home:f.home,trust,context:f.context,spawnRuntime,fetcher:async()=>{throw Error('offline');},launchBrowser:false,log:()=>{},onStarted:r=>r.stop()});assert.equal(result.code,0);assert.equal(E.loadState(f.home).current,rev(1));});
test('unmanaged app reports its installation requirement without starting a manager',async()=>{const c=new ManagedChild({transport:{}});assert.equal(c.blocked,false);assert.equal((await c.request('status')).managed,false);});
test('child holds all writes until correct parent nonce commits',async()=>{const transport=new EventEmitter();transport.send=()=>{};transport.connected=true;transport.disconnect=()=>{transport.connected=false;};const c=new ManagedChild({transport,nonce:'a'.repeat(64)});let activated=0,closed=0;c.ready({url:'x',close:async()=>{closed++;}},{fingerprint:'x'},async()=>{activated++;});await c.receive({type:'gz-commit',nonce:'b'.repeat(64)});assert.equal(c.blocked,true);await c.receive({type:'gz-commit',nonce:'a'.repeat(64)});assert.equal(c.blocked,false);assert.equal(activated,1);await c.stop();await c.stop();assert.equal(closed,1);});
test('parent disconnect before app is ready still drains once ready',async()=>{const transport=new EventEmitter();transport.send=()=>{};transport.connected=true;transport.disconnect=()=>{transport.connected=false;};const c=new ManagedChild({transport,nonce:'a'.repeat(64)});transport.connected=false;transport.emit('disconnect');let closed=0;c.ready({url:'x',close:async()=>{closed++;}},{fingerprint:'x'},async()=>{});await c.stopPromise;assert.equal(closed,1);assert.equal(c.blocked,true);});
