import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {crc32,writeZip,zipEntry,verifiedRuntime,windowsRuntime,buildWindowsDownload} from '../tools/build-windows-download.mjs';
const fixture=t=>{const root=mkdtempSync(path.join(tmpdir(),'grindzone-download-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};
test('ZIP CRC matches the standard check vector',()=>assert.equal(crc32(Buffer.from('123456789')),0xcbf43926));
test('ZIP roundtrip retains exact binary, empty and text members',t=>{
 const root=fixture(t),file=path.join(root,'sample.zip'),entries=[{name:'GrindZone/START.cmd',bytes:Buffer.from('@echo off\r\n')},{name:'GrindZone/runtime/node.exe',bytes:Buffer.from([77,90,0,255,1])},{name:'GrindZone/empty.txt',bytes:Buffer.alloc(0)}];
 writeZip(file,entries);const bytes=readFileSync(file);for(const e of entries)assert.deepEqual(zipEntry(bytes,e.name),e.bytes);
 assert.throws(()=>zipEntry(bytes,'not-a-member'),/missing/);assert.throws(()=>zipEntry(bytes,entries[1].name,2),/Unsafe/);
});
test('ZIP output is deterministic and refuses an existing destination',t=>{
 const root=fixture(t),a=path.join(root,'a.zip'),b=path.join(root,'b.zip'),entries=[{name:'GrindZone/a.txt',bytes:Buffer.from('hello')}];writeZip(a,entries);writeZip(b,entries);assert.deepEqual(readFileSync(a),readFileSync(b));const original=readFileSync(a);assert.throws(()=>writeZip(a,entries),/EEXIST/);assert.deepEqual(readFileSync(a),original);
});
test('ZIP creation rejects traversal, absolute, empty and duplicate paths before opening output',t=>{
 const root=fixture(t);for(const name of ['../save','/save','a/../save','a//file','a/./file','C:\\save','a\\file']){const p=path.join(root,'bad.zip');assert.throws(()=>writeZip(p,[{name,bytes:Buffer.from('x')}]),/Unsafe/);assert.equal(existsSync(p),false);}
 const p=path.join(root,'duplicate.zip');assert.throws(()=>writeZip(p,[{name:'A',bytes:Buffer.from('1')},{name:'a',bytes:Buffer.from('2')}]),/Unsafe/);assert.equal(existsSync(p),false);
});
test('ZIP read rejects corruption, local-name mismatch and truncation',t=>{
 const root=fixture(t),p=path.join(root,'a.zip');writeZip(p,[{name:'GrindZone/a.txt',bytes:Buffer.from('sample data')}]);const original=readFileSync(p),bad=Buffer.from(original);bad[30]=88;assert.throws(()=>zipEntry(bad,'GrindZone/a.txt'),/mismatch/);assert.throws(()=>zipEntry(original.subarray(0,original.length-1),'GrindZone/a.txt'),/missing/);
 const crcBad=Buffer.from(original);const cd=crcBad.readUInt32LE(crcBad.length-6);crcBad.writeUInt32LE(0,cd+16);assert.throws(()=>zipEntry(crcBad,'GrindZone/a.txt'),/integrity/);
});
test('runtime validator accepts no unverified placeholder or executable',()=>{
 assert.throws(()=>verifiedRuntime(Buffer.from('MZ fake executable')),/checksum mismatch/);assert.throws(()=>verifiedRuntime('bad'),/checksum mismatch/);assert.match(windowsRuntime.archiveSha256,/^[a-f0-9]{64}$/);assert.match(windowsRuntime.executableSha256,/^[a-f0-9]{64}$/);
});
test('failed runtime download cannot create a distribution or touch source sentinels',async t=>{
 const root=fixture(t),sentinel=path.join(root,'journal.sqlite'),out=path.join(root,'download');writeFileSync(sentinel,'private');let request;
 await assert.rejects(buildWindowsDownload({sourceRoot:root,outputRoot:out,sourceRevision:'a'.repeat(40),fetchImpl:async(url,options)=>{request={url,options};return new Response('wrong archive');}}),/checksum mismatch/);
 assert.equal(request.url,windowsRuntime.url);assert.equal(request.options.redirect,'error');assert.equal(existsSync(out),false);assert.equal(readFileSync(sentinel,'utf8'),'private');
});
test('existing output and missing revision are rejected without network access',async t=>{
 const root=fixture(t);const fetchImpl=()=>{throw Error('NETWORK MUST NOT RUN');};await assert.rejects(buildWindowsDownload({sourceRoot:root,outputRoot:root,sourceRevision:'a'.repeat(40),fetchImpl}),/already exists/);await assert.rejects(buildWindowsDownload({sourceRoot:root,outputRoot:path.join(root,'new'),sourceRevision:'main',fetchImpl}),/Exact source/);
});
test('packaged start path uses the included runtime, with no remote tool or policy commands',()=>{
 const launcher=readFileSync(new URL('../START.cmd',import.meta.url),'utf8');assert.match(launcher,/if exist "%~dp0runtime\\node.exe"/);assert.match(launcher,/"%~dp0runtime\\node.exe" "%~dp0launcher.mjs" --open/);assert.doesNotMatch(launcher,/powershell|ExecutionPolicy|Desktop.Commander|curl|reg add|taskkill/i);
});
test('bundled phone address points to the approved existing relay and contains no credentials',()=>{
 const value=JSON.parse(readFileSync(new URL('../lib/phone-service.json',import.meta.url),'utf8'));assert.deepEqual(value,{relayUrl:'https://sway-tips.onrender.com/grindzone'});
});
