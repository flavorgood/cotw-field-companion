import test from 'node:test';
import assert from 'node:assert/strict';
import {recentCaptures,CAPTURE_ENTRY_LIMIT,RECENT_CAPTURE_LIMIT} from '../public/capture-source.js';

function folder(entries){return {async *values(){yield* entries;}};}
function image(name,time,size=100){return {kind:'file',name,async getFile(){return {name,size,lastModified:time,arrayBuffer(){throw Error('Listing must not read image content');}};}};}

test('recent captures are newest-first, bounded, and never traverse directories or read image content',async()=>{
 const entries=Array.from({length:25},(_,i)=>image('capture-'+i+'.PNG',i));
 entries.splice(4,0,{kind:'directory',name:'private-subfolder',values(){throw Error('No recursive reads');}});
 entries.push({kind:'file',name:'notes.txt',getFile(){throw Error('Unsupported entries must not be opened');}},image('empty.png',99,0),image('too-large.png',100,33554433));
 const result=await recentCaptures(folder(entries));
 assert.equal(result.files.length,RECENT_CAPTURE_LIMIT);assert.equal(result.files[0].lastModified,24);assert.equal(result.files.at(-1).lastModified,13);assert.equal(result.truncated,false);
});

test('intake filters unsupported image formats and oversized captures without hiding readable files',async()=>{
 const result=await recentCaptures(folder([image('photo.webp',3),image('photo.jpg',2),{kind:'file',name:'removed.png',async getFile(){throw Error('Removed');}},image('big.png',4,12582913)]),{extensions:['.png','.jpg','.jpeg'],maxBytes:12*1024*1024});
 assert.deepEqual(result.files.map(f=>f.name),['photo.jpg']);
});

test('a large folder stops at the metadata limit and reports partial ordering',async()=>{
 let reads=0;
 const entries=Array.from({length:CAPTURE_ENTRY_LIMIT+20},(_,i)=>({kind:'file',name:i+'.png',async getFile(){reads++;return {name:this.name,size:10,lastModified:i};}}));
 const result=await recentCaptures(folder(entries));assert.equal(reads,CAPTURE_ENTRY_LIMIT);assert.equal(result.truncated,true);assert.equal(result.files[0].lastModified,CAPTURE_ENTRY_LIMIT-1);
});
