import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sourceBlob,sourceCommit,verifyReferenceBytes} from '../tools/build-herd-reference.mjs';
import {loadHerdReference,withHerdReference} from '../lib/herd-reference.mjs';
test('reference generation is pinned and rejects different input before creating derived facts',()=>{
 assert.match(sourceBlob,/^[a-f0-9]{40}$/);assert.match(sourceCommit,/^[a-f0-9]{40}$/);
 for(const value of ['{}','{"gemsbok":{"trophy":{"diamond":{"score_low":1}}}}',''])assert.throws(()=>verifyReferenceBytes(Buffer.from(value)),/pinned source/);
});
test('missing optional reference stays unknown and import performs no writes',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'grindzone-reference-'));try{
  assert.equal(loadHerdReference(path.join(root,'absent.json')),null);assert.deepEqual(readdirSync(root),[]);
  const catalog={species:[{key:'example',name:'Example'}]},copy=withHerdReference(catalog,null);
  assert.equal(copy.species[0].herdTrophies,null);assert.equal(catalog.species[0].herdTrophies,undefined);
 }finally{rmSync(root,{recursive:true,force:true});}
});
