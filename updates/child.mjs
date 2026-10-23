/** Private parent/child lifecycle. No remote shutdown or update-install endpoint. */
import {randomUUID} from 'node:crypto';
export class ManagedChild {
 constructor({transport=process,nonce=process.env.GRINDZONE_MANAGED_NONCE}={}){
  this.transport=transport;this.nonce=nonce;this.managed=typeof transport.send==='function'&&/^[a-f0-9]{64}$/.test(nonce||'');
  this.blocked=this.managed;this.waiters=new Map();this.stopping=false;this.closed=false;
  if(this.managed){this.message=m=>this.receive(m);this.disconnected=()=>{void this.stop();};transport.on('message',this.message);transport.on('disconnect',this.disconnected);}
 }
 send(m){if(this.managed&&this.transport.connected)this.transport.send({...m,nonce:this.nonce});}
 async receive(m){
  if(!m||m.nonce!==this.nonce)return;
  if(m.type==='gz-commit'&&this.app&&!this.stopping){this.blocked=false;void this.activate().catch(()=>{});this.send({type:'gz-running'});}
  if(m.type==='gz-stop')await this.stop();
  if(m.type==='gz-result'&&this.waiters.has(m.id)){const w=this.waiters.get(m.id);this.waiters.delete(m.id);clearTimeout(w.timer);m.error?w.reject(Error(m.error)):w.resolve(m.result);}
 }
 ready(app,runtime,activate){
  if(!this.managed)return;this.app=app;this.activate=activate;
  if(this.stopping||!this.transport.connected){void this.stop();return;}
  this.send({type:'gz-ready',fingerprint:runtime.fingerprint,url:app.url});
 }
 async stop(){
  if(this.stopPromise)return this.stopPromise;this.stopping=true;this.blocked=true;
  if(!this.app)return;
  this.stopPromise=(async()=>{try{await this.app.close();this.closed=true;this.send({type:'gz-stopped'});this.transport.exitCode=0;this.transport.disconnect?.();}
  catch{this.send({type:'gz-stop-failed'});}
 for(const w of this.waiters.values()){clearTimeout(w.timer);w.reject(Error('GrindZone is closing'));}this.waiters.clear();})();return this.stopPromise;
 }
 request(operation){
  if(!this.managed)return Promise.resolve({schema:'grindzone.updates.v1',managed:false,policy:'Use the install-once Windows package to enable automatic updates.'});
  if(!['status','check'].includes(operation))return Promise.reject(Error('Unsupported update action'));
  return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{this.waiters.delete(id);reject(Error('Update manager is not responding'));},operation==='check'?180000:5000);this.waiters.set(id,{resolve,reject,timer});this.send({type:'gz-request',id,operation});});
 }
}
