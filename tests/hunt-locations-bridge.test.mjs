import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhoneBridge} from '../lib/phone-bridge.mjs';
import {buildLocationHistory} from '../lib/hunt-locations.mjs';
const tick=()=>new Promise(r=>setTimeout(r,5));
class Socket extends EventTarget{
 static current=null;
 constructor(){super();Socket.current=this;this.readyState=1;this.sent=[];queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:'{"type":"ready"}'})));}
 send(raw){this.sent.push(JSON.parse(raw));}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 receive(query){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'request',id:'request-12345678901234567890',operation:'locations',query})}));}
}
const page=()=>buildLocationHistory({harvests:[{id:'h1',timestamp:1700000000,species:'Deer'}],sessions:[{id:'running',startedAt:'2023-11-01T00:00:00.000Z',endedAt:null,pausedAt:null}],sourceStatus:'ok'});
async function setup(t,readLocations){let writes=0;const b=createPhoneBridge({relayUrl:'https://example.test/grindzone',deviceToken:'synthetic-token',readState:()=>({}),readLocations,runCommand:()=>{writes++;throw Error('Not a read');},WebSocketImpl:Socket});await b.connect();t.after(()=>b.close());return {b,socket:Socket.current,writes:()=>writes};}
test('location reads use the separate query path and explicit transport allowlist',async t=>{
 let query;const {socket,writes}=await setup(t,q=>{query=q;const d=page();d.private='SECRET';d.events[0].location.path='SECRET';return d;});
 socket.receive({reserve:'all',kind:'harvest',limit:20});await tick();
 assert.equal(query.kind,'harvest');assert.equal(query.session,'active');assert.equal(writes(),0);assert.equal(socket.sent[0].status,200);assert.doesNotMatch(JSON.stringify(socket.sent),/SECRET|path/);
});
test('phone relay rejects a PC page that silently widens location scope',async t=>{
 const {socket}=await setup(t,()=>({...page(),query:{...page().query,session:'older-grind'}}));
 socket.receive({});await tick();assert.equal(socket.sent[0].status,503);
});
test('remote profile or path injection is rejected before the source callback',async t=>{
 let reads=0;const {socket,writes}=await setup(t,()=>{reads++;return page();});socket.receive({profile:'other',path:'../private'});await tick();
 assert.equal(reads,0);assert.equal(writes(),0);assert.equal(socket.sent[0].status,400);
});
test('a disconnected generation cannot publish a delayed location response',async t=>{
 let resolve;const {socket,b}=await setup(t,()=>new Promise(r=>{resolve=r;}));socket.receive({});await tick();await b.close();resolve(page());await tick();assert.equal(socket.sent.length,0);
});
test('an older PC without the new read callback fails explicitly and executes no mutation',async t=>{
 const {socket,writes}=await setup(t,undefined);socket.receive({});await tick();assert.equal(socket.sent[0].status,503);assert.equal(writes(),0);
});
