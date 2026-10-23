import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhoneBridge} from '../lib/phone-bridge.mjs';
const tick=()=>new Promise(r=>setTimeout(r,5));
class Socket extends EventTarget{
 static current=null;
 constructor(){super();Socket.current=this;this.readyState=1;this.sent=[];queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:'{"type":"ready"}'})));}
 send(raw){this.sent.push(JSON.parse(raw));}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 receive(query){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'request',id:'request-12345678901234567890',operation:'herds',query})}));}
}
const page=()=>({schema:'grindzone.herds.v1',status:'spoilers_off',reserve:19,query:{reserve:19},herds:[],summary:null,facets:{species:[],zones:[]},revision:null,nextOffset:null});
async function setup(t,readHerds){let writes=0;const bridge=createPhoneBridge({relayUrl:'https://example.test/grindzone',deviceToken:'synthetic-token',readState:()=>({}),readHerds,runCommand:()=>{writes++;throw Error('Unexpected write');},WebSocketImpl:Socket});await bridge.connect();t.after(()=>bridge.close());return {bridge,socket:Socket.current,writes:()=>writes};}
test('herd requests use a read-only query and strip hidden/raw data independently',async t=>{
 let query;const {socket,writes}=await setup(t,q=>{query=q;return {...page(),nativeId:'PRIVATE',herds:[{members:['PRIVATE']}]};});socket.receive({reserve:19});await tick();assert.equal(query.reserve,19);assert.equal(socket.sent[0].status,200);assert.equal(writes(),0);assert.doesNotMatch(JSON.stringify(socket.sent),/PRIVATE|members|nativeId/);
});
test('remote profile/path injection is rejected before invoking the herd reader',async t=>{let reads=0;const {socket}=await setup(t,()=>{reads++;return page();});socket.receive({profile:'someone-else',path:'../private'});await tick();assert.equal(reads,0);assert.equal(socket.sent[0].status,400);});
test('late herd results cannot leak after disconnection',async t=>{let resolve;const {socket,bridge}=await setup(t,()=>new Promise(r=>{resolve=r;}));socket.receive({});await tick();await bridge.close();resolve(page());await tick();assert.equal(socket.sent.length,0);});
test('an older PC without herd support fails explicitly rather than executing another operation',async t=>{const {socket,writes}=await setup(t);socket.receive({});await tick();assert.equal(socket.sent[0].status,503);assert.equal(writes(),0);});
