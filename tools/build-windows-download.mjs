/** Build-only Windows distribution. Never installs, changes policy, or reads player data. */
import {buildPortable} from './build-portable.mjs';
import {buildHerdReference} from './build-herd-reference.mjs';
import {buildDesktopWindow} from './build-desktop.mjs';
import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,openSync,writeSync,closeSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Pins from https://nodejs.org/en/blog/release/v24.21.0 (signed release checksums).
export const windowsRuntime=Object.freeze({version:'24.21.0',architecture:'x64',
  url:'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip',
  archiveSha256:'158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
  executableSha256:'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'});
const hash=b=>createHash('sha256').update(b).digest('hex');
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
function bounds(buffer,offset,length){if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||offset+length>buffer.length)throw Error('Invalid ZIP bounds');}

/** Read one exact named member in a verified runtime archive; never extract paths. */
export function zipEntry(zip,name,maxBytes=150*1024*1024){
  let end=-1;for(let p=zip.length-22;p>=Math.max(0,zip.length-65557);p--)if(zip.readUInt32LE(p)===0x06054b50&&p+22+zip.readUInt16LE(p+20)===zip.length){end=p;break;}
  if(end<0)throw Error('ZIP directory missing');
  if(zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6)||zip.readUInt16LE(end+8)!==zip.readUInt16LE(end+10))throw Error('Unsupported ZIP disks');
  const count=zip.readUInt16LE(end+10),directorySize=zip.readUInt32LE(end+12);let pos=zip.readUInt32LE(end+16),found=null;
  bounds(zip,pos,directorySize);const directoryEnd=pos+directorySize;if(directoryEnd!==end||count>20000)throw Error('Invalid ZIP directory');
  for(let i=0;i<count;i++){
    bounds(zip,pos,46);if(zip.readUInt32LE(pos)!==0x02014b50)throw Error('Invalid ZIP member');
    const flags=zip.readUInt16LE(pos+8),method=zip.readUInt16LE(pos+10),crc=zip.readUInt32LE(pos+16),packed=zip.readUInt32LE(pos+20),size=zip.readUInt32LE(pos+24),n=zip.readUInt16LE(pos+28),extra=zip.readUInt16LE(pos+30),comment=zip.readUInt16LE(pos+32),local=zip.readUInt32LE(pos+42);
    bounds(zip,pos+46,n+extra+comment);const current=zip.toString('utf8',pos+46,pos+46+n);
    if(current===name){
      if(found||flags&1||![0,8].includes(method)||size>maxBytes)throw Error('Unsafe ZIP runtime member');
      bounds(zip,local,30);if(zip.readUInt32LE(local)!==0x04034b50||zip.readUInt16LE(local+8)!==method)throw Error('Invalid local ZIP header');
      const ln=zip.readUInt16LE(local+26),le=zip.readUInt16LE(local+28),start=local+30+ln+le;bounds(zip,local+30,ln+le);bounds(zip,start,packed);
      if(zip.toString('utf8',local+30,local+30+ln)!==name||start+packed>zip.readUInt32LE(end+16))throw Error('ZIP member mismatch');
      found=method===0?Buffer.from(zip.subarray(start,start+packed)):inflateRawSync(zip.subarray(start,start+packed),{maxOutputLength:maxBytes});
      if(found.length!==size||crc32(found)!==crc)throw Error('ZIP member integrity failed');
    }
    pos+=46+n+extra+comment;
  }
  if(pos!==directoryEnd||!found)throw Error('Expected ZIP member missing');return found;
}
export function verifiedRuntime(archive){
  if(!Buffer.isBuffer(archive)||archive.length>128*1024*1024||hash(archive)!==windowsRuntime.archiveSha256)throw Error('Official Windows runtime archive checksum mismatch');
  const prefix='node-v'+windowsRuntime.version+'-win-x64/',exe=zipEntry(archive,prefix+'node.exe'),license=zipEntry(archive,prefix+'LICENSE',2*1024*1024);
  if(hash(exe)!==windowsRuntime.executableSha256||exe.toString('ascii',0,2)!=='MZ'||license.length<100)throw Error('Official Windows runtime member mismatch');return {exe,license};
}

/** Deterministic ZIP with bounded, relative paths; entries must come from the portable allowlist. */
export function writeZip(file,entries){
  if(entries.length<1||entries.length>512)throw Error('Invalid ZIP entry count');
  const seen=new Set();for(const {name,bytes}of entries){if(typeof name!=='string'||!/^[A-Za-z0-9_. /-]+$/.test(name)||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(name.toLowerCase())||!Buffer.isBuffer(bytes)||bytes.length>150*1024*1024)throw Error('Unsafe ZIP entry');seen.add(name.toLowerCase());}
  const fd=openSync(file,'wx'),central=[];let offset=0;
  const write=b=>{let at=0;while(at<b.length)at+=writeSync(fd,b,at,b.length-at);};
  try{for(const {name,bytes}of entries){
    const filename=Buffer.from(name),packed=deflateRawSync(bytes,{level:6}),crc=crc32(bytes),h=Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(filename.length,26);
    write(h);write(filename);write(packed);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);central.push(c,filename);offset+=h.length+filename.length+packed.length;
    if(offset>0xffffffff)throw Error('ZIP exceeds limit');
  }const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);write(cd);write(end);
  }finally{closeSync(fd);}
}
async function downloadRuntime(fetchImpl){
  const response=await fetchImpl(windowsRuntime.url,{redirect:'error',signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('Official runtime download unavailable');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>128*1024*1024)throw Error('Runtime download too large');chunks.push(chunk);}return Buffer.concat(chunks);
}
export async function buildWindowsDownload({sourceRoot,outputRoot,sourceRevision,fetchImpl=fetch,desktopBuilder=buildDesktopWindow}={}){
  if(!/^[a-f0-9]{40}$/.test(sourceRevision||''))throw Error('Exact source revision required');
  if(existsSync(outputRoot))throw Error('Download destination already exists');
  const runtime=verifiedRuntime(await downloadRuntime(fetchImpl));const work=mkdtempSync(path.join(tmpdir(),'grindzone-package-'));
  try{
    const stage=path.join(work,'app'),desktopFiles=await desktopBuilder({sourceRoot}),manifest=buildPortable(sourceRoot,stage,{desktopFiles});
    const launch=readFileSync(path.join(stage,'START.cmd'),'utf8');if(!launch.includes('runtime\\node.exe'))throw Error('Bundled-runtime launcher missing');
    const extras=[{path:'runtime/node.exe',bytes:runtime.exe},{path:'runtime/LICENSE',bytes:runtime.license}];
    manifest.requires='Included Windows x64 Node runtime; .NET Framework 4.8 and Microsoft Edge WebView2 Runtime for the signed desktop install';manifest.distribution='portable-preview';manifest.sourceRevision=sourceRevision;
    manifest.bundledRuntime={...windowsRuntime,downloadedDuringBuild:true};manifest.files.push(...extras.map(e=>({path:e.path,bytes:e.bytes.length,sha256:hash(e.bytes)})));
    const firstStart=Buffer.from('GrindZone Windows preview\r\n\r\nExtract the whole GrindZone folder, then open START.cmd.\r\nThe runtime is included. No Desktop Commander, Node installation or browser extension is needed.\r\nThis download does not update or stop another installed copy automatically.\r\nGame saves are read-only; retained GrindZone history stays in its existing app data folder.\r\nPhone access is an enrolled preview. No private enrollment credential is included in this public package.\r\nAn existing older copy may open when it is already running; this is not proof that it was updated.\r\n');
    const entries=manifest.files.filter(e=>!e.path.startsWith('runtime/')).map(e=>({name:'GrindZone/'+e.path,bytes:readFileSync(path.join(stage,e.path))}));
    entries.push(...extras.map(e=>({name:'GrindZone/'+e.path,bytes:e.bytes})),{name:'GrindZone/PORTABLE-PACKAGE.json',bytes:Buffer.from(JSON.stringify(manifest,null,2)+'\n')},{name:'GrindZone/FIRST-START.txt',bytes:firstStart});
    mkdirSync(outputRoot,{recursive:false});const filename='GrindZone-Windows-x64.zip',archive=path.join(outputRoot,filename);writeZip(archive,entries);
    const bytes=readFileSync(archive),release={schema:'grindzone.windows-download.v1',sourceRevision,filename,bytes:bytes.length,sha256:hash(bytes),runtimeVersion:windowsRuntime.version,runtimeSha256:windowsRuntime.executableSha256,files:entries.length,playerDataIncluded:false,privateEnrollmentIncluded:false,windowsLaunchVerified:false};
    writeFileSync(path.join(outputRoot,'release.json'),JSON.stringify(release,null,2)+'\n',{flag:'wx'});return release;
  }finally{rmSync(work,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  await buildHerdReference();
  console.log(JSON.stringify(await buildWindowsDownload({sourceRoot:root,outputRoot:path.join(root,'downloads'),sourceRevision:revision})));
}
