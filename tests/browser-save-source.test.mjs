import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,defs} from './fixtures.mjs';
import {decodeSave} from '../lib/decoder.mjs';
import {harvestRows} from '../lib/core.mjs';
import {decodeSaveInBrowser} from '../public/save-decoder.js';
import {BrowserFolderSource,readBrowserHarvests} from '../public/save-source.js';
const row={SpeciesName:100,Score:123.5,TrophyScore:2,VariationName:9,Timestamp:1789800000,RegionName:19};
const bytes=fixture(defs,'rootHarvest',{HarvestHistory:[row,row,{...row,Score:144.25,Timestamp:1789800060}]});
const file=()=>new File([bytes],'hunting_log_adf',{lastModified:1789800080000});
const directory=(getFile=async()=>file())=>({kind:'directory',async queryPermission(options){assert.deepEqual(options,{mode:'read'});return 'granted';},async getFileHandle(name,options){assert.equal(name,'hunting_log_adf');assert.deepEqual(options,{create:false});return {getFile};}});
test('native browser decompression and canonical ADF parser equal the Node reader',async()=>{assert.deepEqual(await decodeSaveInBrowser(new Uint8Array(bytes)),decodeSave(bytes));});
test('browser harvest projection keeps canonical identities and duplicate ordinals',async()=>{
 const result=await readBrowserHarvests(file());assert.deepEqual(result.harvests,harvestRows(decodeSave(bytes).value));assert.equal(new Set(result.harvests.map(h=>h.id)).size,3);
 assert.deepEqual(Object.keys(result),['harvests','sourceUpdatedAt']);assert.equal(result.sourceUpdatedAt,'2026-09-19T06:41:20.000Z');
});
test('browser decoder retains unsigned 64 bit precision',async()=>{
 const save=fixture(defs,'rootHealth',{SavedHealthComponentList:[{HealhComponentId:18446744073709551610n,MaxHealth:500,CurrentHealth:250}]});
 assert.deepEqual(await decodeSaveInBrowser(save),decodeSave(save));
});
test('browser rejects wrong wrapper, truncated stream, mismatched and oversized output',async()=>{
 for(const mutate of [b=>{b[0]=0;},b=>{b.writeBigUInt64LE(1n,24);},b=>{b.writeBigUInt64LE(33554433n,24);}]){const b=Buffer.from(bytes);mutate(b);await assert.rejects(()=>decodeSaveInBrowser(b));}
 await assert.rejects(()=>decodeSaveInBrowser(bytes.subarray(0,bytes.length-5)));await assert.rejects(()=>readBrowserHarvests({size:33554433,arrayBuffer(){throw Error('must not read');}}));
});
test('folder connection requests read access and only reads the named harvest file',async t=>{
 let selected,emitted;const source=new BrowserFolderSource({pickDirectory:async options=>{selected=options;return directory();},onSnapshot:s=>{emitted=s;}});t.after(()=>source.disconnect());
 const result=await source.connect();assert.equal(selected.mode,'read');assert.equal(result.mode,'browser_local');assert.equal(emitted.harvests.length,3);assert.equal(result.sourceKind,'cotw-save');assert.ok(result.sourceId);
 assert.equal('bytes' in result,false);assert.equal('path' in result,false);assert.equal('handle' in result,false);
});
test('permission denial does not read files or prompt for write permission',async t=>{
 let opened=0;const source=new BrowserFolderSource();t.after(()=>source.disconnect());
 await assert.rejects(()=>source.useDirectory({kind:'directory',queryPermission:async options=>{assert.equal(options.mode,'read');return 'denied';},getFileHandle:async()=>{opened++;}}));assert.equal(opened,0);
});
test('disconnect cannot be undone by a pending folder picker',async()=>{
 let finish;const source=new BrowserFolderSource({pickDirectory:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=source.connect();source.disconnect();finish(directory());assert.equal(await pending,null);assert.equal(source.handle,null);assert.equal(source.timer,null);
});
test('disconnect discards an in-flight read and makes no further file reads',async()=>{
 let finish,started;const reading=new Promise(resolve=>{started=resolve;});let opened=0,emitted=0;
 const blocked={size:bytes.length,lastModified:1789800080000,arrayBuffer(){started();return new Promise(resolve=>{finish=resolve;});}};
 const source=new BrowserFolderSource({onSnapshot:()=>emitted++});
 const pending=source.useDirectory(directory(async()=>{opened++;return blocked;}));await reading;source.disconnect();finish(Uint8Array.from(bytes).buffer);
 assert.equal(await pending,null);assert.equal(emitted,0);assert.equal(opened,1);assert.equal(source.timer,null);
});
test('unstable saves never publish a partially read snapshot',async t=>{
 let calls=0,emitted=0;const source=new BrowserFolderSource({onSnapshot:()=>emitted++});t.after(()=>source.disconnect());
 await assert.rejects(()=>source.useDirectory(directory(async()=>new File([bytes],'hunting_log_adf',{lastModified:1789800080000+(calls++)}))),/game is saving/);assert.equal(emitted,0);
});
test('source code has no local service, filesystem writes, or raw upload transport',()=>{
 const source=readFileSync(new URL('../public/save-source.js',import.meta.url),'utf8');assert.doesNotMatch(source,/node:|createWritable|removeEntry|XMLHttpRequest|\bfetch\(|WebSocket|127\.0\.0\.1/);
});
