/** Bootstrap discovers save folders but never changes them. Child gets restricted FS access. */
import {existsSync,mkdirSync,readdirSync,realpathSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {runtimeIdentity,runtimeScope,assertRunningRuntime,probeRunningRuntime} from './lib/runtime-identity.mjs';
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<13))throw Error('Node.js 22.13 or newer is required.');
const app=path.dirname(fileURLToPath(import.meta.url)),home=os.homedir();
const data=path.resolve(process.env.COMPANION_DATA_DIR||path.join(process.env.LOCALAPPDATA||path.join(home,'.local','share'),'COTW Field Companion'));
const roots=['Documents','OneDrive/Documents'].flatMap(d=>[path.join(home,d,'Avalanche Studios','COTW','Saves'),path.join(home,d,'Avalanche Studios','Epic Games Store','COTW','Saves')]);
const candidates=[];
if(process.env.COTW_SAVE_DIR){if(!existsSync(process.env.COTW_SAVE_DIR))throw Error('Selected save folder is unavailable.');candidates.push(realpathSync(process.env.COTW_SAVE_DIR));}
else for(const root of roots)if(existsSync(root))for(const child of readdirSync(root,{withFileTypes:true}))if(child.isDirectory()&&/^\d+$/.test(child.name))candidates.push(realpathSync(path.join(root,child.name)));
const unique=[...new Set(candidates)];
if(unique.length>1){console.error('Multiple profiles found. Select one with COTW_SAVE_DIR before starting:\n'+unique.join('\n'));process.exit(1);}
const save=unique[0]||null;
const port=Number(process.env.COMPANION_PORT||47831);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('COMPANION_PORT must be an integer from 1024 to 65535.');
const localUrl=`http://127.0.0.1:${port}`;
function openBrowser(){
  if(process.platform!=='win32')return;
  const browser=spawn('cmd.exe',['/d','/s','/c','start','',localUrl],{stdio:'ignore',windowsHide:true});
  browser.on('error',()=>{});
}
const selectedRuntime=runtimeIdentity(app);
const existing=await probeRunningRuntime(localUrl);
if(existing){
  assertRunningRuntime(existing.runtime,selectedRuntime,runtimeScope(data,save));
  console.log(`GrindZone build ${selectedRuntime.fingerprint.slice(0,12)} is already running at ${localUrl}`);
  if(process.argv.includes('--open'))openBrowser();
  process.exitCode=0;
}else{

function within(a,b){const r=path.relative(a,b);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
// Check the nearest existing parent before creating app data; reject junction overlap too.
let parent=data;while(!existsSync(parent))parent=path.dirname(parent);const resolvedData=path.join(realpathSync(parent),path.relative(parent,data));
if(save&&(within(save,resolvedData)||within(resolvedData,save)))throw Error('The companion data folder must not overlap game saves.');
mkdirSync(data,{recursive:true});
const args=['--permission',`--allow-fs-read=${app}`,`--allow-fs-read=${realpathSync(data)}`,`--allow-fs-write=${realpathSync(data)}`];
if(save)args.push(`--allow-fs-read=${save}`);
args.push(path.join(app,'server.mjs'));
const child=spawn(process.execPath,args,{stdio:process.argv.includes('--open')?['inherit','pipe','inherit']:'inherit',env:{...process.env,NODE_OPTIONS:'',GRINDZONE_EXPECTED_FINGERPRINT:selectedRuntime.fingerprint,COMPANION_DATA_DIR:realpathSync(data),COTW_SAVE_DIR:save||''}});
child.on('exit',code=>{process.exitCode=code??0;});child.on('error',e=>{console.error(e.message);process.exitCode=1;});
process.on('SIGINT',()=>{child.kill('SIGINT');});process.on('SIGTERM',()=>{child.kill('SIGTERM');});

if(child.stdout){let opened=false;child.stdout.on('data',chunk=>{process.stdout.write(chunk);if(!opened&&chunk.toString().includes('listening at')){opened=true;openBrowser();}});}

}
