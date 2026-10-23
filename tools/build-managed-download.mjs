/** Build-only signing and managed installer packaging. The private key never enters the bundle. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {zipEntry,writeZip} from './build-windows-download.mjs';
import {runtimeIdentity} from '../lib/runtime-identity.mjs';
import {canonical,digest,encodeBundle,signedManifest,verifyDirectory,validateManifest} from '../updates/engine.mjs';
const legacyStoreContract='dc432ed6c7310c3c4838c3cc1bc75ca39a94360415a7a5a7c1b7923262ea78e1';
const concurrentGrindsStoreContract='36fa80548ed26eda06101b2db3c271a00547d1d14f5b94e18108ad4a86209e33';
export function storageMigrationDeclaration(storageContract){
 return storageContract===concurrentGrindsStoreContract?{fromContract:legacyStoreContract,toContract:concurrentGrindsStoreContract}:undefined;
}
export function signPackage({directory,revision,sequence,trust,privateKey,publishedAt}={}){
 const files=[];function walk(relative=''){for(const e of fs.readdirSync(path.join(directory,relative),{withFileTypes:true})){const p=path.posix.join(relative,e.name);if(e.isSymbolicLink())throw Error('Signing inputs cannot follow links');if(e.isDirectory())walk(p);else if(p!=='SIGNED-RELEASE.json'){const bytes=fs.readFileSync(path.join(directory,p));files.push({path:p,bytes:bytes.length,sha256:digest(bytes)});}}}walk();files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const entries=new Map(files.map(f=>[f.path,fs.readFileSync(path.join(directory,f.path))])),bundle=encodeBundle(entries),key=createPrivateKey(privateKey);
 if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 signing material is required');
 const publicPem=createPublicKey(key).export({format:'pem',type:'spki'}),keyId=Object.keys(trust.keys).find(k=>trust.keys[k]===publicPem);if(!keyId)throw Error('Signing key does not match the pinned public trust policy');
 const storageContract=digest(fs.readFileSync(path.join(directory,'lib/store.mjs')));
 const manifest=validateManifest({schema:'grindzone.update-manifest.v1',product:'GrindZone',channel:'stable',platform:'win32-x64',protocol:1,revision,sequence,journalEpoch:1,storageContract,...(storageMigrationDeclaration(storageContract)?{storageMigration:storageMigrationDeclaration(storageContract)}:{}),runtimeFingerprint:runtimeIdentity(directory).fingerprint,publishedAt,expiresAt:new Date(Date.parse(publishedAt)+90*86400000).toISOString(),bundle:{name:`payload-${digest(bundle)}.gz`,bytes:bundle.length,sha256:digest(bundle)},files});
 const payload=Buffer.from(canonical(manifest)),envelope={schema:'grindzone.signed-release.v1',keyId,payload:payload.toString('base64'),signature:sign(null,payload,key).toString('base64')};
 signedManifest(envelope,trust);fs.writeFileSync(path.join(directory,'SIGNED-RELEASE.json'),canonical(envelope)+'\n',{flag:'wx'});verifyDirectory(directory,manifest);return {manifest,envelope,bundle};
}
export function buildManagedDownload({sourceRoot,downloadRoot,revision,sequence,publishedAt,privateKey,trust}={}){
 const portable=JSON.parse(fs.readFileSync(path.join(downloadRoot,'release.json'),'utf8')),zip=fs.readFileSync(path.join(downloadRoot,portable.filename));
 if(portable.sourceRevision!==revision||zip.length!==portable.bytes||digest(zip)!==portable.sha256)throw Error('Portable download identity does not match the release candidate');
  const metadata=JSON.parse(zipEntry(zip,'GrindZone/PORTABLE-PACKAGE.json').toString('utf8'));
  if(!metadata.files.some(f=>f.path==='desktop/GrindZone.Desktop.exe')||!metadata.files.some(f=>f.path==='desktop/WebView2Loader.dll'))throw Error('Managed setup requires the built native desktop window');
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'grindzone-managed-build-'));
 try{
  const stage=path.join(work,'GrindZone');fs.mkdirSync(stage);
  for(const f of metadata.files){const bytes=zipEntry(zip,'GrindZone/'+f.path);if(bytes.length!==f.bytes||digest(bytes)!==f.sha256)throw Error('Portable input checksum mismatch');const to=path.join(stage,f.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,bytes,{flag:'wx'});}
  for(const name of ['engine.mjs','supervisor.mjs','context.mjs','child.mjs','boot.mjs','install.mjs','trust.json'])if(!fs.existsSync(path.join(stage,'updates',name)))throw Error('Managed installer modules are missing');
  const install=fs.readFileSync(path.join(stage,'INSTALL.cmd'));fs.writeFileSync(path.join(stage,'START.cmd'),install);
  const startMeta=metadata.files.find(f=>f.path==='START.cmd');startMeta.bytes=install.length;startMeta.sha256=digest(install);metadata.distribution='managed-install-seed';
  fs.writeFileSync(path.join(stage,'PORTABLE-PACKAGE.json'),JSON.stringify(metadata,null,2)+'\n');
  fs.writeFileSync(path.join(stage,'FIRST-START.txt'),'GrindZone — install once\r\n\r\nExtract the whole folder and open INSTALL.cmd (START.cmd also installs this package). Use the GrindZone desktop shortcut afterwards.\r\nUpdates download automatically and activate on the next launch. An active hunt is never restarted.\r\nThe existing journal and phone pairing stay in their current companion-data directory. Game-save access remains read-only.\r\nRelease payloads are Ed25519-signed. This is not a Windows Authenticode-signed executable installer.\r\n');
  const signed=signPackage({directory:stage,revision,sequence,trust,privateKey,publishedAt}),updates=path.join(downloadRoot,'updates');fs.mkdirSync(updates,{recursive:true});
  fs.writeFileSync(path.join(updates,signed.manifest.bundle.name),signed.bundle,{flag:'wx'});fs.writeFileSync(path.join(updates,'latest.json'),canonical(signed.envelope)+'\n',{flag:'wx'});
  const entries=signed.manifest.files.map(f=>({name:'GrindZone/'+f.path,bytes:fs.readFileSync(path.join(stage,f.path))}));entries.push({name:'GrindZone/SIGNED-RELEASE.json',bytes:Buffer.from(canonical(signed.envelope)+'\n')});
  const filename='GrindZone-Setup-Windows-x64.zip',output=path.join(downloadRoot,filename);writeZip(output,entries);const bytes=fs.readFileSync(output);
  const receipt={schema:'grindzone.managed-download.v1',revision,sequence,filename,bytes:bytes.length,sha256:digest(bytes),bundle:signed.manifest.bundle,files:entries.length,keyId:signed.envelope.keyId,signatureAlgorithm:'Ed25519',desktopWindow:'WebView2 WinForms',authenticodeSigned:false,playerDataIncluded:false,privateKeyIncluded:false,physicalWindowsVerified:false};
  fs.writeFileSync(path.join(downloadRoot,'managed-release.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
 }finally{fs.rmSync(work,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),revision=execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim(),seconds=Number(execFileSync('git',['show','-s','--format=%ct','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim());
 const encoded=process.env.GRINDZONE_UPDATE_SIGNING_KEY;if(!encoded)throw Error('The managed-release signing key is not configured');
 const trust=JSON.parse(fs.readFileSync(path.join(sourceRoot,'updates/trust.json'),'utf8'));
 const privateKey={key:Buffer.from(encoded,'base64'),format:'der',type:'pkcs8'};
 console.log('GRINDZONE_MANAGED_DOWNLOAD '+JSON.stringify(buildManagedDownload({sourceRoot,downloadRoot:path.join(sourceRoot,'downloads'),revision,sequence:seconds*1000,publishedAt:new Date(seconds*1000).toISOString(),trust,privateKey})));
}
