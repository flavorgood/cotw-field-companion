import {validateJournal} from './browser-journal.js';

/** Explicit account recovery. The guest journal remains the authority on this phone. */
export function mountAccountRecovery(host,{storage,onRestore,canRestore=()=>true,onNotice=()=>{},fetcher=globalThis.fetch.bind(globalThis)}={}){
 let disposed=false,busy=false,state=null,pending=null,generation=0,controller=null;
 const events=new AbortController(),active=()=>!disposed&&host.isConnected;
 const node=(tag,text)=>{const value=document.createElement(tag);if(text)value.textContent=text;return value;};
 const button=(label,action)=>{const value=node('button',label);value.type='button';value.dataset.recoveryAction=action;value.disabled=busy;return value;};
 const endpoint=path=>new URL('recovery/'+path,import.meta.url);
 const accountPrefix=new URL(import.meta.url).pathname.replace(/\/play\/account-recovery\.js$/,'')+'/account/';
 async function request(path,options={}){
  const deadline=new AbortController(),abort=()=>deadline.abort(),parent=controller?.signal;
  if(parent?.aborted)abort();else parent?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>deadline.abort(),15000);
  try{
   const response=await fetcher(endpoint(path),{credentials:'same-origin',cache:'no-store',...options,signal:deadline.signal});
   let value;try{value=await response.json();}catch{throw Error('Account recovery returned an unreadable response. Your local journal is unchanged.');}
   if(!response.ok){const error=Error(value.error||'Account recovery is unavailable. Your local journal is unchanged.');error.status=response.status;error.signInPath=value.signInPath;throw error;}
   return value;
  }finally{clearTimeout(timer);parent?.removeEventListener('abort',abort);}
 }
 function render(message=''){
  if(!active())return;
  host.replaceChildren();host.classList.add('panel');host.style.marginTop='16px';host.append(node('h2','Recover on another phone'));
  const status=node('p',message);status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.dataset.recoveryStatus='';host.append(status);
  if(!state){host.append(node('p','Use a private file backup while account recovery is unavailable. Your local progress stays on this phone.'),button('Check account recovery','refresh'));return;}
  host.append(node('p','Signed in as '+state.displayName+'. Backups include your reports, spots and screenshot fingerprints. Original images stay in your photos.'));
  const summary=node('p',state.backup?`Account backup: ${state.backup.grinds} grinds · ${state.backup.reports} reports · ${state.backup.places} spots. Saved ${new Date(state.backup.updatedAt).toLocaleString()}.`:'No account backup saved yet.');summary.dataset.recoverySummary='';host.append(summary);
  const consent=node('label');consent.className='check';const check=node('input');check.type='checkbox';check.dataset.recoveryConsent='';check.disabled=busy;
  consent.append(check,node('span','I want to save this phone’s journal to this account, including private hunting coordinates. This replaces the account backup after review.'));
  host.append(consent,button('Back up this phone','publish'),button('Review account backup on this phone','restore'),button('Refresh account backup','refresh'));
  host.querySelector('[data-recovery-action=restore]').disabled=busy||!state.backup;
  host.append(node('p','Account backup does not connect to Xbox, read console saves or upload screenshots. Restoring requires review before replacing this phone’s journal.'));
 }
 async function refresh(){
  const expected=++generation;controller?.abort();controller=new AbortController();busy=true;render('Checking account recovery…');
  try{const next=await request('status');if(expected!==generation||!active())return;if(!next.available||typeof next.scope!=='string'||typeof next.csrf!=='string')throw Error('Account recovery is not connected here.');if(state?.scope!==next.scope)pending=null;state=next;render('Account backup loaded. Your local journal is unchanged.');}
  catch(error){if(expected===generation&&active()){state=null;pending=null;render(error.message);if(error.status===401&&typeof error.signInPath==='string'){const url=new URL(error.signInPath,location.origin);if(url.origin===location.origin&&url.pathname.startsWith(accountPrefix)&&!url.username&&!url.password){const link=node('a','Sign in to GrindZone');link.href=url.href;host.append(link);}}}}
  finally{if(expected===generation&&active()){busy=false;for(const control of host.querySelectorAll('button,input'))control.disabled=false;if(state&&!state.backup)host.querySelector('[data-recovery-action=restore]').disabled=true;}}
 }
 async function publish(){
  if(busy||!state||!active())return;
  if(!host.querySelector('[data-recovery-consent]')?.checked){render('Confirm which account receives this phone’s private journal first.');return;}
  const expected=++generation,captured=state;controller?.abort();controller=new AbortController();busy=true;render('Saving account backup…');
  try{
   const journal=await storage.read();if(expected!==generation||!active())return;if(!journal)throw Error('Create or restore a journal on this phone before backing it up.');
   const checked=validateJournal(journal),key=JSON.stringify([captured.scope,checked]),retry=pending?.key===key;
   if(!retry)pending={key,input:{requestId:crypto.randomUUID(),expectedVersion:captured.backup?.version??0,journal:checked}};
   const latest=await request('status');if(expected!==generation||!active())return;if(latest.scope!==captured.scope||latest.csrf!==captured.csrf)throw Error('Account session changed. Refresh recovery before saving.');
   if(!retry&&(latest.backup?.version??0)!==(captured.backup?.version??0)){pending=null;throw Error('Account backup changed. Refresh and review before replacing it.');}
   const result=await request('backup',{method:'POST',headers:{'Content-Type':'application/json','X-GrindZone-Account-CSRF':captured.csrf},body:JSON.stringify(pending.input)});
   if(expected!==generation||!active())return;if(result.scope!==captured.scope)throw Error('Account session changed. Refresh recovery.');
   pending=null;busy=false;const refreshed=refresh(),noticeGeneration=generation;await refreshed;
   if(active()&&generation===noticeGeneration&&state?.scope===captured.scope)onNotice('Account backup saved. This phone’s journal is unchanged.');
  }catch(error){if(expected===generation&&active()){if(error.status===401||error.status===403)state=null;if(error.status===409)pending=null;render(error.message+' Refresh before a deliberate retry.');}}
  finally{if(expected===generation&&active()){busy=false;render(host.querySelector('[data-recovery-status]')?.textContent||'');}}
 }
 async function restore(){
  if(busy||!state?.backup||!active())return;
  const expected=++generation,captured=state;controller?.abort();controller=new AbortController();busy=true;render('Opening account backup for review…');
  try{
   const result=await request('backup');if(expected!==generation||!active())return;
   if(result.scope!==captured.scope||!result.backup||result.backup.version!==captured.backup.version)throw Error('Account backup changed. Refresh and review the current backup.');
   const checked=validateJournal(result.backup.journal),latest=await request('status');if(expected!==generation||!active())return;
   if(latest.scope!==captured.scope||latest.backup?.version!==result.backup.version)throw Error('Account or backup changed. Refresh recovery.');
   if(!canRestore())throw Error('Finish the current journal review before opening an account backup. Nothing on this phone has been replaced.');
   onRestore(checked,{sourceLabel:'Account backup for '+captured.displayName});if(expected===generation)render('Backup opened for review. Nothing on this phone has been replaced.');
  }catch(error){if(expected===generation&&active()){if(error.status===401||error.status===403)state=null;render(error.message);}}
  finally{if(expected===generation&&active()){busy=false;render(host.querySelector('[data-recovery-status]')?.textContent||'');}}
 }
 host.addEventListener('click',event=>{const action=event.target.closest('[data-recovery-action]')?.dataset.recoveryAction;if(action==='refresh'&&!busy)void refresh();if(action==='publish')void publish();if(action==='restore')void restore();},{signal:events.signal});
 const ready=refresh();
 return {ready,pauseForJournalReview(){++generation;controller?.abort();busy=false;render('Journal review opened. Nothing on this phone has been replaced.');},dispose(){disposed=true;++generation;controller?.abort();events.abort();pending=null;state=null;}};
}
