import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createActivatedPhoneRelay} from '../cloud/activation-server.mjs';

test('actual activated relay exposes no-PC assets without exposing a paired source',async()=>{
 const relay=await createActivatedPhoneRelay({key:randomBytes(32),publicOrigin:'http://127.0.0.1:0/grindzone',allowInsecureLoopback:true});
 try{
  const base=relay.origin,entry=await fetch(base+'/play/');assert.equal(entry.status,200);const html=await entry.text();assert(html.includes('browser-play.js'));assert(!entry.headers.has('set-cookie'));
  const connect=await fetch(base+'/phone/connect');assert((await connect.text()).includes('href="/grindzone/play/"'));
  for(const name of ['browser-play.js','browser-journal.js','browser-journal-storage.js','map.js','map-geometry.js','terrain-layer.js','route-stops.js','species-style.js','data-client.js']){const asset=await fetch(base+'/play/'+name);assert.equal(asset.status,200,name);assert(asset.headers.get('content-type').includes('javascript'));}
  const catalog=await fetch(base+'/play/catalog/maps.json');const data=await catalog.json();assert.equal(data.schema,'field.reserve_maps.v1');assert(data.reserves.length>=19);
  for(const pathname of ['/api/state','/api/locations','/api/herds'])assert.equal((await fetch(base+pathname)).status,401,pathname);
  assert.equal((await fetch(base+'/play/journal.sqlite')).status,404);
  assert.equal((await fetch(base+'/play/',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"journal":"private"}'})).status,405);
  const bad=await fetch(base+'/play/',{headers:{Origin:'https://other.example'}});assert.equal(bad.status,403);
 }finally{await relay.close();}
});
