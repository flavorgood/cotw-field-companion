/** Browser-only COTW source. No localhost service, raw upload, or file writes. */
import {decodeSaveInBrowser,harvestFields} from './save-decoder.js';
const limit=32*1024*1024;
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),b=>b.toString(16).padStart(2,'0')).join('');
export async function readBrowserHarvests(file){
 if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<34||file.size>limit)throw Error('Choose a supported COTW harvest save');
 const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)throw Error('Save changed while reading; try again');
 const decoded=await decodeSaveInBrowser(bytes),duplicates=new Map(),harvests=[];
 for(const raw of harvestFields(decoded.value)){
  const key=await digest(JSON.stringify(raw)),ordinal=duplicates.get(key)||0;duplicates.set(key,ordinal+1);
  harvests.push({...raw,id:await digest(JSON.stringify([key,ordinal]))});
 }
 return {harvests,sourceUpdatedAt:Number.isFinite(file.lastModified)?new Date(file.lastModified).toISOString():null};
}
export class BrowserFolderSource{
 constructor({onSnapshot=()=>{},onStatus=()=>{},intervalMs=5000,pickDirectory}={}){
  if(typeof onSnapshot!=='function'||typeof onStatus!=='function'||!Number.isFinite(intervalMs)||intervalMs<1000||intervalMs>60000)throw TypeError('Invalid source options');
  this.onSnapshot=onSnapshot;this.onStatus=onStatus;this.intervalMs=intervalMs;
  this.pickDirectory=pickDirectory??(options=>globalThis.showDirectoryPicker(options));
  this.handle=null;this.epoch=0;this.timer=null;this.inflight=null;this.sourceId=null;this.snapshot=null;
 }
 static supported(){return globalThis.isSecureContext===true&&typeof globalThis.showDirectoryPicker==='function'&&typeof globalThis.DecompressionStream==='function';}
 async connect(){
  // Keep the picker directly inside the player's click gesture. Never ask for write access.
  const epoch=++this.epoch;
  const handle=await this.pickDirectory({id:'grindzone-cotw',mode:'read',startIn:'documents'});
  if(epoch!==this.epoch)return null;return this.useDirectory(handle);
 }
 async useDirectory(handle){
  if(!handle||handle.kind!=='directory'||typeof handle.getFileHandle!=='function'||typeof handle.queryPermission!=='function')throw TypeError('Choose the COTW save folder');
  const epoch=this.epoch;
  if(await handle.queryPermission({mode:'read'})!=='granted')throw Error('Read permission is required; reconnect the folder');
  if(epoch!==this.epoch)return null;
  this.disconnect();this.handle=handle;this.sourceId=crypto.randomUUID();this.snapshot=null;
  try{return await this.refresh();}finally{this.schedule();}
 }
 schedule(){
  clearTimeout(this.timer);if(!this.handle)return;
  this.timer=setTimeout(async()=>{try{await this.refresh();}catch{}finally{this.schedule();}},this.intervalMs);
 }
 async refresh(){
  if(!this.handle)throw Error('Connect the COTW save folder first');
  if(this.inflight)return null;
  const ticket={handle:this.handle,epoch:this.epoch,sourceId:this.sourceId};this.inflight=ticket;
  const current=()=>this.handle===ticket.handle&&this.epoch===ticket.epoch;
  try{
   if(await ticket.handle.queryPermission({mode:'read'})!=='granted')throw Error('Folder permission expired; reconnect to read new saves');
   if(!current())return null;
   // Read just the allowlisted harvest file, never traverse other folders or create files.
   const handle=await ticket.handle.getFileHandle('hunting_log_adf',{create:false});
   if(!current())return null;const before=await handle.getFile();
   if(!current())return null;const result=await readBrowserHarvests(before);
   if(!current())return null;const after=await handle.getFile();
   if(before.size!==after.size||before.lastModified!==after.lastModified)throw Error('The game is saving; the last snapshot is unchanged');
   if(!current())return null;
   const snapshot={sourceKind:'cotw-save',sourceId:ticket.sourceId,mode:'browser_local',capturedAt:new Date().toISOString(),...result};
   this.snapshot=snapshot;this.onSnapshot(snapshot);this.onStatus({state:'connected',capturedAt:snapshot.capturedAt});return snapshot;
  }catch(error){if(current())this.onStatus({state:'unavailable',message:'New save data is unavailable. Reconnect the folder or wait for the game to finish saving.'});throw error;}
  finally{if(this.inflight===ticket)this.inflight=null;}
 }
 disconnect(){clearTimeout(this.timer);this.timer=null;this.epoch++;this.handle=null;this.inflight=null;this.onStatus({state:'disconnected'});}
}
