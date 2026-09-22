/** Build-only vendoring. Never downloads or uploads a player's screenshot. */
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'public/vendor/ocr'),temporary=mkdtempSync(path.join(tmpdir(),'grindzone-ocr-'));
const files=[],packages=[];
function write(name,bytes){const target=path.join(output,name);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes);files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
function pack(name,version){
 const result=JSON.parse(execFileSync('npm',['pack',`${name}@${version}`,'--ignore-scripts','--json','--pack-destination',temporary],{encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024}));
 if(result.length!==1||result[0].name!==name||result[0].version!==version||!/^sha512-[A-Za-z0-9+/]+=*$/.test(result[0].integrity)||!/^[-A-Za-z0-9_.]+\.tgz$/.test(result[0].filename))throw Error('Unexpected OCR package identity');
 const file=path.join(temporary,result[0].filename),bytes=readFileSync(file),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
 if(integrity!==result[0].integrity)throw Error('OCR archive integrity mismatch');
 packages.push({name,version,integrity});
 const names=execFileSync('tar',['-tzf',file],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024}).trim().split('\n');
 return {names,read(member){if(!names.includes(member))throw Error('Missing OCR package asset: '+member);return execFileSync('tar',['-xOzf',file,member],{timeout:30000,maxBuffer:40*1024*1024});}};
}
async function pinnedGitFile(name,size,sha){
 const response=await fetch('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/'+name,{signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('English OCR model unavailable');
 const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>size)throw Error('English OCR model exceeds pinned size');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks),blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
 if(bytes.length!==size||blob!==sha)throw Error('English OCR model source identity changed; review before updating');
 return bytes;
}
try{
 const wrapper=pack('tesseract.js','7.0.0'),core=pack('tesseract.js-core','7.0.0');
 write('tesseract.min.js',wrapper.read('package/dist/tesseract.min.js'));write('worker.min.js',wrapper.read('package/dist/worker.min.js'));
 write('LICENSE-tesseract.txt',wrapper.read('package/LICENSE'));write('LICENSE-core.txt',core.read('package/LICENSE'));
 for(const kind of ['','-simd','-lstm','-simd-lstm','-relaxedsimd','-relaxedsimd-lstm']){
  const name='tesseract-core'+kind+'.wasm.js';write('core/'+name,core.read('package/'+name));
  const binary='tesseract-core'+kind+'.wasm';if(core.names.includes('package/'+binary))write('core/'+binary,core.read('package/'+binary));
 }
 write('lang/eng.traineddata.gz',gzipSync(await pinnedGitFile('eng.traineddata',4113088,'bbef4675053b5b468cdb477053e28b1c698ba08e'),{level:9}));
 write('LICENSE-language.txt',await pinnedGitFile('LICENSE',11358,'d645695673349e3947e8e5ae42332d0ac3164cd7'));
 writeFileSync(path.join(output,'manifest.json'),JSON.stringify({schema:'grindzone.ocr-vendor.v1',packages,language:{repository:'tesseract-ocr/tessdata_fast',blob:'bbef4675053b5b468cdb477053e28b1c698ba08e'},files},null,2)+'\n');
 console.log(JSON.stringify({kind:'grindzone_ocr_vendor_ready',packages,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)}));
}finally{rmSync(temporary,{recursive:true,force:true});}
