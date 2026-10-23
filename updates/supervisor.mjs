/** Install-once supervisor. Stage while running; activate only before the next app launch. */
import * as fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {acquireLock,loadState,readRelease,verifyDirectory,checkAndStage,beginActivation,commitActivation,recoverActivation,publicStatus,plainPath,fallbackCode,saveState,desktopWindowMode} from './engine.mjs';
import {launchContext} from './context.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function deadline(promise,ms){let timer;try{return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]);}finally{clearTimeout(timer);}}
export function openBrowser(port,{spawnImpl=spawn}={}){
 if(process.platform==='win32'){const c=spawnImpl('cmd.exe',['/d','/s','/c','start','','http://127.0.0.1:'+port],{stdio:'ignore',windowsHide:true});c.on('error',()=>{});}
}
/** The signed desktop host owns only the window. Its exit closes this supervisor's app child. */
export function spawnDesktopWindow({directory,home,port,fingerprint,spawnImpl=spawn}={}){
 if(process.platform!=='win32')throw Error('The desktop window requires Windows.');
 const executable=path.join(directory,'desktop','GrindZone.Desktop.exe');
 if(!fs.existsSync(executable))throw Error('The verified release has no desktop window.');
 const readyToken=randomBytes(32).toString('hex');
 const child=spawnImpl(executable,['--url','http://127.0.0.1:'+port+'/','--profile',path.join(home,'desktop-profile'),'--fingerprint',fingerprint,'--ready-token',readyToken],{cwd:directory,stdio:['pipe','pipe','inherit'],windowsHide:false});
 child.stdin?.on('error',()=>{});
 const exit=new Promise(resolve=>{child.once('error',error=>resolve({error}));child.once('exit',(code,signal)=>resolve({code,signal}));});
 const ready=new Promise((resolve,reject)=>{
  let output='',settled=false;
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);child.stdout?.off('data',receive);child.stdout?.resume();error?reject(error):resolve();};
  const receive=chunk=>{output+=chunk.toString();if(output.length>4096)return finish(Error('The desktop window sent too much startup output'));if(output.split(/\r?\n/).includes('gz-desktop-ready:'+readyToken))finish();};
  const timer=setTimeout(()=>finish(Error('The desktop window did not become ready')),30000);
  child.stdout?.on('data',receive);
  exit.then(result=>finish(Error('The desktop window closed before it became ready'+(result.error?': '+result.error.message:''))));
 });
 const canOpen=()=>child.exitCode===null&&!child.killed&&!!child.stdin?.writable&&!child.stdin.destroyed;
 return {child,exit,ready,canOpen,open:()=>{if(!canOpen())throw Error('The desktop window cannot open the app');child.stdin.write('open\n');},close:()=>{if(child.stdin?.writable)child.stdin.write('close\n');}};
}
async function portUnused(port){
 try{const r=await fetch('http://127.0.0.1:'+port+'/api/bootstrap',{signal:AbortSignal.timeout(1200),redirect:'error'});await r.body?.cancel();return false;}
 catch(e){if(e?.cause?.code==='ECONNREFUSED')return true;throw Error('The companion port is not responding reliably. No update was activated.');}
}
export function spawnApp({directory,context,fingerprint,executable,spawnImpl=spawn}){
 fs.mkdirSync(context.dataDir,{recursive:true});const nonce=randomBytes(32).toString('hex');
 const args=['--permission',`--allow-fs-read=${directory}`,`--allow-fs-read=${context.dataDir}`,`--allow-fs-write=${context.dataDir}`];
 if(context.saveDir)args.push(`--allow-fs-read=${context.saveDir}`);args.push(path.join(directory,'server.mjs'));
 const env={...process.env,NODE_OPTIONS:'',GRINDZONE_EXPECTED_FINGERPRINT:fingerprint,GRINDZONE_MANAGED_NONCE:nonce,COMPANION_DATA_DIR:context.dataDir,COTW_SAVE_DIR:context.saveDir||'',COMPANION_PORT:String(context.port)};
 // Release-signing material is never inherited by application children.
 delete env.GRINDZONE_UPDATE_SIGNING_KEY;
 const child=spawnImpl(executable,args,{cwd:directory,env,stdio:['inherit','inherit','inherit','ipc'],windowsHide:false});
 let ended=false,exitResult,resolveExit;const exit=new Promise(resolve=>{resolveExit=resolve;});
 child.once('error',e=>{ended=true;exitResult={code:1,error:e};resolveExit(exitResult);});
 child.once('exit',(code,signal)=>{ended=true;exitResult={code,signal};resolveExit(exitResult);});
 const send=m=>{if(child.connected)child.send({...m,nonce});};
 const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error('The updated app did not become ready'));},30000);
  const receive=m=>{if(m?.nonce!==nonce||m.type!=='gz-ready')return;
   if(m.fingerprint!==fingerprint||m.url!=='http://127.0.0.1:'+context.port){cleanup();reject(Error('The app did not match the selected signed release'));return;}
   cleanup();resolve();};
  const cleanup=()=>{clearTimeout(timer);child.off('message',receive);};child.on('message',receive);
  exit.then(()=>{cleanup();reject(Error('The app exited before startup completed'));});
 });
 const commit=async()=>{
  if(ended)throw Error('The app stopped before activation');
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.off('message',receive);reject(Error('The app did not acknowledge activation'));},5000);const receive=m=>{if(m?.nonce===nonce&&m.type==='gz-running'){clearTimeout(timer);child.off('message',receive);resolve();}};child.on('message',receive);send({type:'gz-commit'});});
 };
 const stop=async({probation=false}={})=>{
  if(ended)return;send({type:'gz-stop'});const result=await deadline(exit.then(()=>true),10000);
  if(!result){if(!probation)throw Error('GrindZone has not finished saving. Keep this window open.');child.kill('SIGTERM');if(!await deadline(exit.then(()=>true),5000))throw Error('Failed candidate is still running; recovery was not attempted');}
 };
 return {child,nonce,send,ready,commit,stop,exit,isAlive:()=>!ended,result:()=>exitResult};
}
export async function supervise({home,trust,context,spawnRuntime=spawnApp,desktopLauncher=spawnDesktopWindow,browserLauncher=openBrowser,activate=beginActivation,probe=portUnused,fetcher=fetch,checkInterval=3600000,launchDesktop=false,launchBrowser=!launchDesktop,log=console.log,onStarted,expectedStaged}={}){
 home=plainPath(home);let unlock;
 try{unlock=acquireLock(home);}catch(e){if(e.code==='UPDATE_LOCKED'){
  if(expectedStaged)throw Error('GrindZone started while setup was completing. Close it and rerun this signed setup to activate the verified update.');
  log('GrindZone is already running. Updates will apply on its next launch.');if(launchDesktop)log('Bring the existing GrindZone desktop window to the front.');else if(launchBrowser)browserLauncher(context.port);return {status:'already_running'};
 }throw e;}
 let runtime,desktop,timer,checking,shutting=false;const checkAbort=new AbortController();const signalHandlers=[];
 const stopDesktop=async()=>{if(!desktop)return;const window=desktop;desktop=null;window.close();if(!await deadline(window.exit.then(()=>true),5000)){window.child?.kill('SIGTERM');if(!await deadline(window.exit.then(()=>true),5000))throw Error('The desktop window did not close. Journal recovery was not attempted.');}};
 const check=()=>checking||(checking=checkAndStage(home,trust,{fetcher,signal:checkAbort.signal}).then(result=>{log(result.status==='staged'?'GrindZone update downloaded and verified. It will activate on the next launch.':result.status==='current'?'GrindZone is up to date.':'Update check unavailable; the installed version remains usable.');return result;}).finally(()=>{checking=null;}));
 const launch=async(revision)=>{
  const release=readRelease(home,revision,trust);verifyDirectory(release.dir,release.manifest);
  const windowMode=launchDesktop?desktopWindowMode(release.manifest):null;
  const executable=path.join(release.dir,'runtime','node.exe');
  runtime=spawnRuntime({directory:release.dir,context,fingerprint:release.manifest.runtimeFingerprint,executable});
  runtime.directory=release.dir;
  runtime.fingerprint=release.manifest.runtimeFingerprint;
  runtime.windowMode=windowMode;
  runtime.child.on('message',async m=>{
   if(m?.nonce!==runtime?.nonce||m.type!=='gz-request'||typeof m.id!=='string'||m.id.length>100)return;
   try{if(m.operation==='check')await check();else if(m.operation!=='status')throw Error('Unsupported update action');runtime.send({type:'gz-result',id:m.id,result:publicStatus(home)});}
   catch(e){runtime?.send({type:'gz-result',id:m.id,error:String(e.message).slice(0,200)});}
  });
  await runtime.ready;await wait(1000);if(!runtime.isAlive())throw Error('The app failed its startup stability check');return runtime;
 };
 const prepareDesktop=async()=>{
  if(!launchDesktop||runtime.windowMode!=='native')return;
  desktop=desktopLauncher({directory:runtime.directory,home,port:context.port,fingerprint:runtime.fingerprint});
  await desktop.ready;
  const early=await Promise.race([desktop.exit.then(result=>result),wait(750).then(()=>null)]);
  if(early)throw Error('The GrindZone desktop window closed before startup completed.');
  if(!desktop.canOpen())throw Error('The GrindZone desktop window cannot receive the app launch.');
 };
 try{
  if(expectedStaged){
   const state=loadState(home);
   if(!state.current||state.current===state.staged||state.staged!==expectedStaged.revision||state.highWater!==expectedStaged.sequence||state.pending||state.rejected.includes(expectedStaged.revision))throw Error('The verified setup update changed before activation.');
  }
  // A manager killed unexpectedly leaves its child briefly draining over IPC. Never restore under it.
  for(let i=0;!await probe(context.port);i++){if(i>=10)throw Error('Another GrindZone copy is running. Close that app window before starting the managed copy.');await wait(500);}
  recoverActivation(home,context.dataDir);
  let pending;try{pending=activate(home,context.dataDir,trust);}catch(e){log('Update activation deferred: '+e.message);const state=loadState(home);if(state.pending)throw e;state.lastError=String(e.message).slice(0,200);saveState(home,state);}let s=loadState(home);
  if(pending){
   log('Activating the verified GrindZone update…');
   try{await launch(pending.candidate);await prepareDesktop();commitActivation(home);}
   catch(e){await stopDesktop();await runtime?.stop({probation:true});recoverActivation(home,context.dataDir);log('Update startup failed. Restored the previous working version and journal.');runtime=null;await launch(loadState(home).current);await prepareDesktop();}
  }else {try{await launch(s.current);await prepareDesktop();}catch(e){await stopDesktop();await runtime?.stop({probation:true});if(!fallbackCode(home,trust))throw e;runtime=null;await launch(loadState(home).current);await prepareDesktop();}}
  // Persist successful activation BEFORE allowing either phone or browser writes.
  await runtime.commit();
  if(launchDesktop&&runtime.windowMode==='native'){
   desktop.open();
   void desktop.exit.then(result=>{if(!shutting){shutting=true;void runtime.stop().catch(e=>log(e.message));}});
  }else if(launchBrowser||launchDesktop&&runtime.windowMode==='legacy-browser'){
   if(launchDesktop)log('The previous verified GrindZone release uses a browser window. Opening it while the desktop update is unavailable.');
   browserLauncher(context.port);
  }
  void check();timer=setInterval(()=>{if(!shutting)void check();},Math.max(60000,checkInterval));
  const stop=()=>{if(shutting)return;shutting=true;void runtime.stop().catch(e=>log(e.message));};
  for(const sig of ['SIGINT','SIGTERM']){process.on(sig,stop);signalHandlers.push([sig,stop]);}
  if(onStarted)await onStarted(runtime);
  const result=await runtime.exit;
  if(desktop){desktop.close();if(!await deadline(desktop.exit.then(()=>true),5000))log('The GrindZone desktop window is still closing.');}
  return {status:'closed',...result};
 }catch(e){if(runtime?.isAlive())await runtime.stop({probation:!!loadState(home).pending});throw e;}
 finally{shutting=true;try{await stopDesktop();}finally{checkAbort.abort();clearInterval(timer);for(const [sig,fn] of signalHandlers)process.off(sig,fn);if(checking)await checking;unlock();}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const home=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),trust=JSON.parse(fs.readFileSync(path.join(home,'kernel','trust.json'),'utf8')),config=JSON.parse(fs.readFileSync(path.join(home,'config.json'),'utf8'));
  const launchDesktop=process.argv.includes('--desktop');const result=await supervise({home,trust,context:launchContext({config}),launchDesktop});process.exitCode=result.code??0;
 }catch(e){console.error('GrindZone: '+e.message);process.exitCode=1;}
}
