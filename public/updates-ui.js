/** Local-PC Settings control. The paired phone is not allowed to install or control updates. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class Updates extends HTMLElement{
 connectedCallback(){if(this.running)return;this.running=true;this.generation=0;this.pending=false;this.status=null;this.error='';this.render();this.onclick=e=>{if(e.target.closest('[data-check-updates]'))void this.refresh(true);};void this.refresh();this.timer=setInterval(()=>{if(!this.pending&&document.visibilityState==='visible')void this.refresh();},10000);}
 disconnectedCallback(){this.running=false;this.generation++;clearInterval(this.timer);this.request?.abort();}
 async refresh(check=false){if(this.pending)return;const previous=JSON.stringify([this.status,this.error]);this.pending=true;const ticket=++this.generation;this.request=new AbortController();if(check)this.render();
  try{let response;if(check){const boot=await fetch('/api/bootstrap',{cache:'no-store',signal:this.request.signal}).then(r=>r.json());response=await fetch('/api/updates/check',{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':boot.token},body:'{}',signal:this.request.signal});}else response=await fetch('/api/updates/status',{cache:'no-store',signal:this.request.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'Update status unavailable');if(data.schema!=='grindzone.updates.v1')throw Error('Unsupported update status');if(ticket!==this.generation||!this.running)return;this.status=data;this.error='';}
  catch(e){if(ticket===this.generation&&this.running&&e.name!=='AbortError')this.error=e.message;}
  finally{if(ticket===this.generation&&this.running){this.pending=false;if(check||previous!==JSON.stringify([this.status,this.error]))this.render();}}
 }
 render(){const s=this.status,html=`<section class="panel" aria-label="GrindZone updates"><h2>App updates</h2>${this.error?`<p role="status">${esc(this.error)}</p>`:''}${s?.managed?`<p><strong>${s.staged?'Update ready for your next launch':this.pending?'Checking for updates…':'Automatic updates enabled'}</strong></p><p>${esc(s.policy)}</p><p class="small muted">Current build ${esc(s.current?.slice(0,12))}${s.staged?' · Ready '+esc(s.staged.slice(0,12)):''}</p>${s.lastError?`<p role="status">${esc(s.lastError)}</p>`:''}<button type="button" class="button" data-check-updates ${this.pending?'disabled':''}>${this.pending?'Checking…':'Check for updates'}</button>`:s?`<p>${esc(s.policy)}</p><a class="button" href="https://sway-tips.onrender.com/grindzone-download/index.html" target="_blank" rel="noopener noreferrer">Get the install-once package</a>`:'<p role="status">Loading update status…</p>'}</section>`;if(this.innerHTML!==html)this.innerHTML=html;}
}
customElements.define('gz-updates',Updates);
const content=document.querySelector('#content');
function mount(){if(location.hash!=='#settings'||!content)return;if(!content.querySelector('gz-updates'))content.append(document.createElement('gz-updates'));}
if(content){new MutationObserver(mount).observe(content,{childList:true});addEventListener('hashchange',mount);mount();}
