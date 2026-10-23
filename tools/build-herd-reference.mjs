/** Reproducible public metadata only. Run before the native/browser/portable release gates. */
import {createHash} from 'node:crypto';
import {writeFileSync,renameSync,readFileSync} from 'node:fs';
import {deriveHerdReference} from '../lib/herd-trophies.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const sourceCommit='1bb50d00e184d8a512b4137d0514bcacebd2b48f';
export const sourceBlob='4f531a152ad254633832e76cee54c7e25cd0abbc';
export function verifyReferenceBytes(bytes){
 const digest=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 if(digest!==sourceBlob)throw Error('Herd reference does not match the pinned source');
 return deriveHerdReference(JSON.parse(bytes.toString('utf8')),{sourceCommit,sourceBlob});
}
export async function buildHerdReference(supplied=null,filename=new URL('../lib/herd-reference.json',import.meta.url)){
const bytes=supplied?readFileSync(supplied):await (async()=>{
 const url=`https://raw.githubusercontent.com/RyMaxim/apc/${sourceCommit}/apc/config/animal_details.json`;
 const response=await fetch(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Pinned herd reference HTTP '+response.status);
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw Error('Herd reference too large');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);
})();
const data=verifyReferenceBytes(bytes),encoded=JSON.stringify(data)+'\n';
writeFileSync(new URL(filename.href+'.tmp'),encoded);renameSync(new URL(filename.href+'.tmp'),filename);
console.log('GRINDZONE_HERD_REFERENCE '+JSON.stringify({sourceCommit,sourceBlob,species:Object.keys(data.species).length,femaleDiamondSpecies:Object.entries(data.species).filter(([,r])=>r.femaleDiamondCapable===true).map(([key])=>key),sha256:createHash('sha256').update(encoded).digest('hex')}));
return data;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildHerdReference(process.argv[2]);
