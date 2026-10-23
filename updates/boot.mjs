/** Small pinned verifier. Runs the signed versioned supervisor so the updater itself can update. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadState,readRelease,verifyDirectory,fallbackCode,plainPath,acquireLock,desktopWindowMode} from './engine.mjs';
import {launchContext} from './context.mjs';
import {isMain} from './entry.mjs';
function openBrowserWindow(port,browserLauncher){
 if(browserLauncher)return browserLauncher(port);
 if(process.platform==='win32'){const c=spawn('cmd.exe',['/d','/s','/c','start','','http://127.0.0.1:'+port],{stdio:'ignore',windowsHide:true});c.on('error',()=>{});}
}
export async function boot(home,{launchDesktop=false,launchBrowser=!launchDesktop,fetcher=fetch,onStarted,spawnRuntime,browserLauncher}={}){
 home=plainPath(home);const trust=JSON.parse(fs.readFileSync(path.join(home,'kernel/trust.json'),'utf8')),config=JSON.parse(fs.readFileSync(path.join(home,'config.json'),'utf8'));
 const context=launchContext({config});
 const equalPath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
 if(!equalPath(context.dataDir,config.dataDir)||((context.saveDir||null)!==(config.saveDir||null)&&(!context.saveDir||!config.saveDir||!equalPath(context.saveDir,config.saveDir)))||context.port!==config.port)throw Error('This managed installation is configured for another journal, save profile or port.');
 let selected,supervisor,unlock;
 try{unlock=acquireLock(home);}catch(e){if(e.code==='UPDATE_LOCKED'){
  let legacyBrowser=false;
  if(launchDesktop)try{const current=readRelease(home,loadState(home).current,trust);verifyDirectory(current.dir,current.manifest);legacyBrowser=desktopWindowMode(current.manifest)==='legacy-browser';}catch{}
  if(legacyBrowser||launchBrowser)openBrowserWindow(context.port,browserLauncher);
  else if(launchDesktop)console.log('GrindZone is already running. Bring its desktop window to the front.');
  return {status:'already_running'};
 }throw e;}
 try{

 for(let attempt=0;attempt<2;attempt++){
  try{selected=readRelease(home,loadState(home).current,trust);verifyDirectory(selected.dir,selected.manifest);supervisor=await import(pathToFileURL(path.join(selected.dir,'updates/supervisor.mjs')).href);if(typeof supervisor.supervise!=='function')throw Error('Signed supervisor is missing');break;}
  catch(e){if(attempt||!fallbackCode(home,trust))throw e;}
 }
 }finally{unlock();}
 if(launchDesktop&&desktopWindowMode(selected.manifest)==='legacy-browser'){
  launchDesktop=false;launchBrowser=true;
  console.log('The previous verified GrindZone release uses a browser window. Opening it while the desktop update is unavailable.');
 }
 return supervisor.supervise({home,trust,context,launchDesktop,launchBrowser,fetcher,onStarted,spawnRuntime,browserLauncher});
}
if(isMain(import.meta)){
 try{const launchDesktop=process.argv.includes('--desktop');const result=await boot(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),{launchDesktop});process.exitCode=result.code??0;}
 catch(e){console.error('GrindZone: '+e.message);process.exitCode=1;}
}
