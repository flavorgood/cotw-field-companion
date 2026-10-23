/** Actual catalog loader under controlled completion timing; no browser storage or player data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/browser-play.js',import.meta.url),'utf8');
const start=source.indexOf('async function loadCatalogs(){'),end=source.indexOf('\nasync function refresh()',start);
assert(start>=0&&end>start);
const loader=source.slice(start,end).replace('import.meta.url',JSON.stringify('https://fixture.invalid/play/browser-play.js'));
function fixture({journal=null,open=false,error=false}={}){
 let release;const held=new Promise(resolve=>{release=resolve;});
 const state={doc:journal,dialog:{open},maps:null,references:null,catalogError:null,consent:true,platform:'playstation',renders:0};
 const context=vm.createContext({...state,URL,render(){context.renders++;if(!context.doc){context.consent=false;context.platform='xbox';}},fetch:async url=>{
  if(url.pathname.endsWith('reference.json')){await held;return {ok:true,json:async()=>({species:[{name:'Synthetic'}]})};}
  return {ok:!error,json:async()=>({schema:'field.reserve_maps.v1',reserves:[{id:19}]})};
 }});
 vm.runInContext(loader,context);return {context,release,run:()=>context.loadCatalogs()};
}
test('late catalogs do not rebuild the welcome form or erase consent and platform',async()=>{
 const f=fixture(),run=f.run();await Promise.resolve();f.release();await run;
 assert.equal(f.context.renders,0);assert.equal(f.context.consent,true);assert.equal(f.context.platform,'playstation');assert.equal(f.context.maps.reserves[0].id,19);
});
test('late failed map request also leaves the welcome selection untouched',async()=>{
 const f=fixture({error:true}),run=f.run();f.release();await run;assert.equal(f.context.renders,0);assert.equal(f.context.consent,true);assert.match(f.context.catalogError,/could not load/);
});
test('catalog loading never grants consent to an unchecked welcome form',async()=>{
 const f=fixture();f.context.consent=false;const run=f.run();f.release();await run;assert.equal(f.context.consent,false);assert.equal(f.context.doc,null);
});
test('journal created before catalogs complete still receives the loaded maps',async()=>{
 const f=fixture(),run=f.run();f.context.doc={id:'synthetic'};f.release();await run;assert.equal(f.context.renders,1);assert.equal(f.context.maps.reserves.length,1);
});
test('an existing workspace rerenders after catalog completion',async()=>{
 const f=fixture({journal:{id:'synthetic'}}),run=f.run();f.release();await run;assert.equal(f.context.renders,1);
});
test('an open editor is not rebuilt by late catalog completion',async()=>{
 const f=fixture({journal:{id:'synthetic'},open:true}),run=f.run();f.release();await run;assert.equal(f.context.renders,0);
});
