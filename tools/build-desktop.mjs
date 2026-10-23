/** Build-only native WebView2 window. No installer or owner data is accessed. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const desktopFiles=Object.freeze([
 'GrindZone.Desktop.exe','GrindZone.Desktop.exe.config',
 'Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll',
 'Microsoft.Web.WebView2.Wpf.dll','WebView2Loader.dll',
]);
const linuxSdk=Object.freeze({
 url:'https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.425/dotnet-sdk-8.0.425-linux-x64.tar.gz',
 sha512:'934b8060a7190e5909ad1fd0785db542f487b3bbf6cdd14826b02095fdd0d0394298b1634085eff302928fccc33f7c1a7253e9b87df555fc36fce819bcd2e798',
});

async function pinnedLinuxSdk(work,{fetcher=fetch,exec=execFileSync,environment}={}){
 if(process.platform!=='linux'||process.arch!=='x64')throw Error('The pinned build-only SDK download supports Linux x64');
 const response=await fetcher(linuxSdk.url,{redirect:'error',signal:AbortSignal.timeout(180000)});
 if(!response.ok||!response.body)throw Error('The pinned .NET SDK download is unavailable');
 const archive=path.join(work,'sdk.tar.gz'),fd=fs.openSync(archive,'wx'),digest=createHash('sha512');let size=0;
 try{for await(const chunk of response.body){size+=chunk.length;if(size>350*1024*1024)throw Error('The pinned .NET SDK archive is too large');digest.update(chunk);fs.writeFileSync(fd,chunk);}}
 finally{fs.closeSync(fd);}
 if(digest.digest('hex')!==linuxSdk.sha512)throw Error('The pinned .NET SDK checksum is invalid');
 const sdk=path.join(work,'sdk');fs.mkdirSync(sdk);
 exec('tar',['-xzf',archive,'-C',sdk],{cwd:work,env:environment,encoding:'utf8',maxBuffer:1024*1024});
 return path.join(sdk,'dotnet');
}

export async function buildDesktopWindow({sourceRoot,dotnet=process.env.GRINDZONE_DOTNET||'dotnet',exec=execFileSync,fetcher=fetch}={}){
 const root=path.resolve(sourceRoot),project=path.join(root,'desktop','GrindZone.Desktop.csproj');
 if(!fs.statSync(project).isFile()||!fs.statSync(path.join(root,'desktop','packages.lock.json')).isFile())throw Error('Locked desktop source is missing');
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'grindzone-desktop-build-'));
 try{
  const environment={...process.env,DOTNET_CLI_HOME:process.env.DOTNET_CLI_HOME||work,NUGET_PACKAGES:process.env.NUGET_PACKAGES||path.join(work,'nuget'),DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1',DOTNET_GENERATE_ASPNET_CERTIFICATE:'false'};
  let version;try{version=exec(dotnet,['--version'],{cwd:path.join(root,'desktop'),env:environment,encoding:'utf8',windowsHide:true}).trim();}catch(e){if(process.env.GRINDZONE_DOTNET)throw e;}
  if(version!=='8.0.425'){
   if(process.env.GRINDZONE_DOTNET)throw Error('Configured .NET SDK is not pinned version 8.0.425');
   dotnet=await pinnedLinuxSdk(work,{fetcher,exec,environment});
   version=exec(dotnet,['--version'],{cwd:path.join(root,'desktop'),env:environment,encoding:'utf8',windowsHide:true}).trim();
  }
  if(version!=='8.0.425')throw Error('GrindZone desktop build requires pinned .NET SDK 8.0.425');
  exec(dotnet,['publish',project,'--configuration','Release','--runtime','win-x64','--output',work,'--nologo','-v','quiet','-p:RestoreLockedMode=true'],
   {cwd:path.join(root,'desktop'),env:environment,encoding:'utf8',windowsHide:true,maxBuffer:5*1024*1024});
  return desktopFiles.map(name=>{
   const full=path.join(work,name),stat=fs.lstatSync(full);
   if(!stat.isFile()||stat.size<1||stat.size>10*1024*1024)throw Error('Invalid desktop build member: '+name);
   const bytes=fs.readFileSync(full);
   if(/\.(exe|dll)$/i.test(name)&&bytes.toString('ascii',0,2)!=='MZ')throw Error('Desktop build member is not a Windows binary: '+name);
   return {path:'desktop/'+name,bytes};
  });
 }finally{fs.rmSync(work,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const files=await buildDesktopWindow({sourceRoot});
 console.log(JSON.stringify({status:'built',platform:'win-x64',files:files.map(f=>({path:f.path,bytes:f.bytes.length}))}));
}
