/** Per-user signed setup and repair. Player journals and game files stay in place. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {acquireLock,installSeed,atomicJson,plainPath,inside,verifyDirectory,signedManifest,loadState,readRelease,stageEntries,saveState,canonical,canActivateStorageContract} from './engine.mjs';
import {launchContext} from './context.mjs';
import {isMain} from './entry.mjs';
export const kernelFiles=['engine.mjs','context.mjs','entry.mjs','boot.mjs','trust.json'];

/** Explicitly rerunning a signed installer repairs its bootstrap, not the player's data. */
function repairBootstrap({source,home,kernelFiles}) {
 const copies=[...kernelFiles.map(name=>({from:'updates/'+name,to:'kernel/'+name})),...['node.exe','LICENSE'].map(name=>({from:'runtime/'+name,to:'runtime/'+name}))];
 const start=Buffer.from('@echo off\r\nsetlocal\r\nset "NODE_OPTIONS="\r\necho Starting GrindZone desktop...\r\nif not exist "%~dp0runtime\\node.exe" goto missing\r\n"%~dp0runtime\\node.exe" "%~dp0kernel\\boot.mjs" --desktop\r\nif errorlevel 1 goto failed\r\nexit /b 0\r\n:missing\r\necho The installed runtime is missing. Run the complete GrindZone setup to repair it.\r\n:failed\r\necho GrindZone did not start. The error is shown above.\r\npause\r\nexit /b 1\r\n');
 copies.push({to:'START.cmd',bytes:start});
 let backup=null;const repaired=[];
 for(const item of copies){
  const to=plainPath(path.join(home,item.to)),bytes=item.bytes||fs.readFileSync(path.join(source,item.from));
  if(fs.existsSync(to)&&fs.readFileSync(to).equals(bytes))continue;
  if(fs.existsSync(to)){
   if(!backup)backup=path.join(home,'bootstrap-backups',randomUUID());
   const prior=plainPath(path.join(backup,item.to));fs.mkdirSync(path.dirname(prior),{recursive:true});fs.copyFileSync(to,prior,fs.constants.COPYFILE_EXCL);
  }
  fs.mkdirSync(path.dirname(to),{recursive:true});const temporary=to+'.repair-'+randomUUID(),fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.renameSync(temporary,to);}catch(e){fs.rmSync(temporary,{force:true});throw e;}
  repaired.push(item.to);
 }
 return repaired;
}

export function install({source,home,context,trust,desktop=false}={}){
 source=plainPath(source);home=plainPath(home);
 if(inside(source,home)||inside(home,source)||inside(home,context.dataDir)||inside(context.dataDir,home)||context.saveDir&&(inside(home,context.saveDir)||inside(context.saveDir,home)))throw Error('Install, source, journal and game-save directories must not overlap.');
 const envelope=JSON.parse(fs.readFileSync(path.join(source,'SIGNED-RELEASE.json'),'utf8')),m=signedManifest(envelope,trust);verifyDirectory(source,m);
 const unlock=acquireLock(home);let result,updateStaged=false,repaired=[];
 try{
  const oldConfig=path.join(home,'config.json');
  if(fs.existsSync(oldConfig)){
   const prior=JSON.parse(fs.readFileSync(oldConfig,'utf8'));
   const equalPath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
   if(!equalPath(prior.dataDir,context.dataDir)||((prior.saveDir||null)!==(context.saveDir||null)&&(!prior.saveDir||!context.saveDir||!equalPath(prior.saveDir,context.saveDir)))||prior.port!==context.port)throw Error('This installation already uses another journal or game profile. Its configuration was not replaced.');
   const installedTrust=JSON.parse(fs.readFileSync(path.join(home,'kernel/trust.json'),'utf8'));
   if(canonical(installedTrust)!==canonical(trust))throw Error('The existing installation uses a different trust policy. It was not replaced.');
  }
  const before=loadState(home);
  if(before.pending)throw Error('An earlier update needs recovery. Start the installed copy before running setup again.');
  if(before.current&&m.sequence<before.highWater)throw Error('This setup is older than an installed or verified update. Use the latest setup; no files were replaced.');
  result=installSeed(home,source,envelope,trust);
  if(before.current&&before.current!==m.revision){
   const old=readRelease(home,before.current,trust).manifest;
   if(m.sequence===before.highWater&&before.staged!==m.revision)throw Error('Setup conflicts with an already verified release sequence.');
   if(!canActivateStorageContract(old,m))throw Error('This setup needs a separately verified journal migration. Your journal was not changed.');
   if(before.rejected.includes(m.revision))throw Error('This release previously failed startup. The working version was retained.');
   stageEntries(home,envelope,trust,new Map(m.files.map(f=>[f.path,fs.readFileSync(path.join(source,f.path))])));
   saveState(home,{...loadState(home),staged:m.revision,highWater:m.sequence,lastError:null});updateStaged=true;
  }
  repaired=repairBootstrap({source,home,kernelFiles});
  const config={schema:'grindzone.install-config.v1',dataDir:path.resolve(context.dataDir),saveDir:context.saveDir||null,port:context.port};
  if(!fs.existsSync(oldConfig))atomicJson(oldConfig,config);
 }finally{unlock();}
 let shortcut=false;
 if(desktop&&process.platform==='win32'){
  const ps=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$s=New-Object -ComObject WScript.Shell; $l=$s.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'GrindZone.lnk')); $l.TargetPath=Join-Path $env:GZ_INSTALL_HOME 'START.cmd'; $l.WorkingDirectory=$env:GZ_INSTALL_HOME; $l.WindowStyle=7; $l.Description='GrindZone desktop app'; $l.Save()"],{env:{...process.env,GZ_INSTALL_HOME:home},encoding:'utf8',timeout:15000,windowsHide:true});shortcut=ps.status===0;
 }
 return {...result,home,shortcut,revision:loadState(home).current,setupRevision:m.revision,updateStaged,repaired};
}

/** A signed setup may start its own staged supervisor to repair an older supervisor. */
async function stagedSupervisor(home,trust,result){
 const installedTrust=JSON.parse(fs.readFileSync(path.join(home,'kernel/trust.json'),'utf8'));
 if(canonical(installedTrust)!==canonical(trust))throw Error('The installed trust policy changed before setup startup.');
 const state=loadState(home);
 if(!state.current||state.current!==result.revision||state.staged!==result.setupRevision||state.pending||state.rejected.includes(result.setupRevision))throw Error('The verified setup update changed before startup.');
 const current=readRelease(home,state.current,installedTrust),next=readRelease(home,state.staged,installedTrust);
 if(next.manifest.sequence!==state.highWater||next.manifest.sequence<=current.manifest.sequence||!canActivateStorageContract(current.manifest,next.manifest))throw Error('The staged setup is not a newer compatible update.');
 verifyDirectory(next.dir,next.manifest);
 const supervisor=await import(pathToFileURL(path.join(next.dir,'updates/supervisor.mjs')).href);
 if(typeof supervisor.supervise!=='function')throw Error('Signed setup supervisor is missing.');
 return {supervise:supervisor.supervise,expectedStaged:{revision:next.manifest.revision,sequence:next.manifest.sequence},trust:installedTrust};
}

export async function runInstaller({source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),home=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'GrindZone'),open=process.argv.includes('--open'),platform=process.platform,arch=process.arch,context=launchContext(),desktop=true,launchDesktop=process.argv.includes('--desktop'),launchBrowser=!launchDesktop,fetcher=fetch,onStarted}={}){
 console.log('GrindZone setup: checking the complete signed package...');
 if(platform!=='win32'||arch!=='x64')throw Error('This installer requires Windows x64.');
 const trust=JSON.parse(fs.readFileSync(path.join(source,'updates/trust.json'),'utf8'));
 const result=install({source,home,context,trust,desktop});
 console.log(result.installed?'GrindZone files installed.':result.updateStaged?'GrindZone repair installed; checking verified update activation.':'GrindZone installation checked and repaired.');
 console.log('Journal and phone pairing remain in their existing data directory.');
 if(desktop&&!result.shortcut)console.log('Desktop shortcut could not be created. The installed launcher is: '+path.join(home,'START.cmd'));
 if(open){
  console.log('Starting GrindZone. Keep this window open; startup errors will appear here.');
  // Keep startup in this visible process. Detached/ignored output previously hid every boot failure.
  let started;
  if(result.updateStaged){
   const selected=await stagedSupervisor(home,trust,result);
   started=await selected.supervise({home,trust:selected.trust,context,launchDesktop,launchBrowser,fetcher,expectedStaged:selected.expectedStaged,onStarted:async runtime=>{
    if(loadState(home).current===result.setupRevision)console.log('GrindZone verified update activated.');
    else console.error('The verified update did not activate. The previous app remains usable; a newer corrected signed setup is needed.');
    if(onStarted)await onStarted(runtime);
   }});
  }else{
   const {boot}=await import(pathToFileURL(path.join(home,'kernel/boot.mjs')).href);
   started=await boot(home,{launchDesktop,launchBrowser,fetcher,onStarted});
  }
  if(started.code)throw Error('GrindZone stopped with exit code '+started.code);
  if(result.updateStaged&&started.status==='already_running')throw Error('GrindZone started while setup was completing. Close it and rerun this signed setup to activate the verified update.');
  if(result.updateStaged&&loadState(home).current!==result.setupRevision)throw Error('The verified update did not activate. The previous app and journal were retained; use a newer corrected signed setup.');
  return {...result,startup:started};
 }
 return result;
}
if(isMain(import.meta)){
 try{await runInstaller();}
 catch(e){console.error('GrindZone setup failed: '+e.message);console.error('No game-save files were changed. Keep this error visible when reporting the problem.');process.exitCode=1;}
}
