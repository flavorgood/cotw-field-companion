import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const previous=globalThis.document;globalThis.document={documentElement:{dataset:{runtime:'local'}}};
const {ammoClasses,ammoClassLabel,ammoMatch}=await import('../public/field-library.js');
if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
const ammo=value=>({stats:{'Recommended Game Class':value}});
test('ammo class parsing preserves known classes and rejects incomplete or unknown values',()=>{
 assert.deepEqual(ammoClasses(ammo('4;5;6;7;8')),[4,5,6,7,8]);assert.equal(ammoClassLabel(ammoClasses(ammo('4;5;6;7;8'))),'Classes 4–8');
 assert.equal(ammoClassLabel(ammoClasses(ammo('1;3;5'))),'Classes 1, 3, 5');assert.equal(ammoClassLabel(ammoClasses(ammo('9'))),'Class 9');
 for(const raw of [undefined,null,0,9,'','4;unknown','0;1','9;10','4–8']){assert.equal(ammoClasses(ammo(raw)),null);assert.equal(ammoMatch(ammo(raw),4),null);}
 assert.equal(ammoMatch(ammo('4;5;6;7;8'),8),true);assert.equal(ammoMatch(ammo('4;5;6;7;8'),9),false);assert.equal(ammoMatch(ammo('1'),null),null);
});
test('every catalog ammo option preserves its exact supported class membership',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../lib/gear-data.json',import.meta.url),'utf8'));
 for(const item of catalog.items.filter(i=>i.kind==='ammo')){
  const source=item.stats['Recommended Game Class'].split(';').map(Number);
  for(let c=1;c<=9;c++)assert.equal(ammoMatch(item,c),source.includes(c),item.id+' class '+c);
 }
});
