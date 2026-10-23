/** Read-only build identity. A content fingerprint is not a publisher signature. */
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readdirSync,readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';

const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const schema='grindzone.runtime.v1';
const extensions=new Set(['.mjs','.js','.json','.css','.html','.svg']);

export function runtimeIdentity(root){
  const base=realpathSync(root),files=[];let total=0;
  function walk(relative){
    const full=path.join(base,relative),stat=lstatSync(full);
    if(stat.isSymbolicLink())throw Error('Runtime identity cannot follow a symbolic link.');
    if(stat.isDirectory()){
      for(const name of readdirSync(full).sort())walk(path.posix.join(relative,name));
      return;
    }
    if(!extensions.has(path.extname(relative)))return;
    if(!stat.isFile())throw Error('Runtime identity requires regular files.');
    if(files.length>=4096||stat.size>32*1024*1024)throw Error('Runtime identity exceeds its file limit.');
    const bytes=readFileSync(full);total+=bytes.length;
    if(total>128*1024*1024)throw Error('Runtime identity exceeds its size limit.');
    files.push([relative,bytes.length,hash(bytes)]);
  }
  for(const relative of ['package.json','launcher.mjs','server.mjs','lib','public'])walk(relative);
  files.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const version=JSON.parse(readFileSync(path.join(base,'package.json'),'utf8')).version;
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))throw Error('Runtime package version is invalid.');
  return Object.freeze({schema,version,fingerprint:hash(JSON.stringify(files))});
}

function canonicalDirectory(directory,platform){
  const resolved=path.resolve(directory);let ancestor=resolved;
  while(!existsSync(ancestor)){
    const next=path.dirname(ancestor);if(next===ancestor)throw Error('Runtime directory cannot be resolved.');ancestor=next;
  }
  const canonical=path.join(realpathSync(ancestor),path.relative(ancestor,resolved));
  return platform==='win32'?canonical.replaceAll('\\','/').toLowerCase():canonical;
}

/** Only an opaque equality key is sent over the local bootstrap, never player paths. */
export function runtimeScope(dataDir,saveDir=null,{platform=process.platform}={}){
  if(typeof dataDir!=='string'||!dataDir)throw Error('Companion data directory is required.');
  return hash(JSON.stringify([canonicalDirectory(dataDir,platform),saveDir?canonicalDirectory(saveDir,platform):null]));
}

export function assertRunningRuntime(running,selected,scope){
  if(running?.schema!==schema||!digest(running.fingerprint)||!digest(running.scope)){
    throw Error('The running companion cannot verify its build. Close its app window (not just the browser tab), then start this complete GrindZone package. Your journal and phone pairing are not changed.');
  }
  if(running.scope!==scope)throw Error('Another companion profile or data directory is using this port. Close that app or choose a different COMPANION_PORT. No data was changed.');
  if(running.fingerprint!==selected.fingerprint){
    throw Error(`A different GrindZone build is still running (${running.fingerprint.slice(0,12)}); this package is ${selected.fingerprint.slice(0,12)}. Close the running app window, then start this package. The old build was not reopened; your journal and phone pairing are not changed.`);
  }
}

/** Only a refused loopback connection means no server. Timeouts and invalid replies fail closed. */
export async function probeRunningRuntime(localUrl,{fetcher=fetch,timeoutMs=1500}={}){
  let response;
  try{response=await fetcher(localUrl+'/api/bootstrap',{signal:AbortSignal.timeout(timeoutMs),redirect:'error',cache:'no-store'});}
  catch(error){if(error?.cause?.code==='ECONNREFUSED'||error?.code==='ECONNREFUSED')return null;throw Error('The local companion did not respond reliably. Close its app window and try again; another reader was not started.');}
  if(!response.ok)throw Error('The local port is occupied by an unavailable or different application. Another companion was not started.');
  const reader=response.body?.getReader();
  if(!reader)throw Error('The local companion returned no build response.');
  const chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384)throw Error('The local companion build response is too large.');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  let payload;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('The local companion returned an invalid build response.');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('The local companion returned an invalid build response.');
  return {runtime:payload.runtime??null};
}
