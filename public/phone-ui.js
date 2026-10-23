const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class PhoneAccessUI {
  constructor(post,{now=Date.now}={}){this.request=post;this.now=now;this.qrSize=318;this.expired=false;this.info=null;this.pairing=null;this.qr='';this.busy=false;this.error='';this.loading=null;this.expiryTimer=null;this.copyStatus='';}
  render(remote=false){
    if(remote)return '<section class="panel"><h2>Connected to your PC</h2><p>Keep your PC and companion running while you use your phone.</p><p class="small muted">To disconnect this phone, open Settings on your PC and turn off phone access.</p></section>';
    return `<section class="panel phone-access" id="phoneAccess">${this.content()}</section>`;
  }
  usablePair(){return !!this.pairing&&Number.isFinite(this.pairing.expiresAt)&&this.pairing.expiresAt>this.now()&&this.info?.enabled===true&&this.info?.status==='connected';}
  clearPair(){this.expired=false;clearInterval(this.expiryTimer);this.expiryTimer=null;this.pairing=null;this.qr='';this.copyStatus='';}
  expireCode(){if(this.pairing&&this.pairing.expiresAt<=this.now()){this.clearPair();this.expired=true;return true;}return false;}
  timeLeft(){const seconds=Math.max(0,Math.ceil(((this.pairing?.expiresAt??this.now())-this.now())/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
  tick(){if(this.expireCode()){this.draw();return;}const node=globalThis.document?.querySelector('#phoneAccess .phone-qr-remaining');if(node)node.textContent=this.timeLeft();}
  content(){
    this.expireCode();
    const i=this.info,button=(text,action)=>`<button class="button ${action==='phone-enable'?'primary':''}" data-action="${action}" ${this.busy?'disabled':''}>${text}</button>`;
    if(!i)return `<h2>Use your phone</h2><p class="muted">${this.error?esc(this.error):'Checking phone access…'}</p>`;
    if(!i.available)return '<h2>Use your phone</h2><p>This running copy does not have a phone-service address.</p><p class="small muted">Close the older copy and open the complete, current GrindZone download. Refreshing this tab does not update the PC app.</p>';
    const pairing=this.usablePair()?`<div class="phone-pairing" style="--phone-qr-size:${this.qrSize}px"><h3>Scan with your phone camera</h3><p>Keep the whole white square in view.</p><input class="phone-qr-enlarge" id="phoneQrEnlarge" type="checkbox"><label class="phone-qr-enlarge-label" for="phoneQrEnlarge">Show larger QR</label><div class="phone-qr" role="img" aria-label="Scan this code to connect your phone">${this.qr}</div><p>Scan with your phone camera, open the link, then tap <strong>Connect this phone</strong>.</p><label class="form-field">Private connection link<input data-phone-link type="text" readonly value="${esc(this.pairing.url)}"></label><button type="button" class="button" data-phone-copy>Copy private link</button><p class="small muted" role="status" aria-live="polite">${esc(this.copyStatus)}</p><p class="phone-qr-expiry">Expires in <span class="phone-qr-remaining" role="timer" aria-live="off">${this.timeLeft()}</span>. This link pairs one browser once. Only send it to your own phone.</p><p class="small muted">Use the browser you plan to keep using. Switching browsers or reopening a used link requires a new connection code.</p></div>`:this.pairing||this.expired?'<p class="phone-pairing" role="status">This connection code has expired or the PC connection changed. Select New connection code. A phone already connected does not need to pair again.</p>':'';
    return `<h2>Use your phone</h2><p>Open your map and harvests while you play, or check them away from home.</p><p class="small muted">Your PC and companion must stay on. Your phone connects through ${esc(i.serviceHost)}.</p>${i.enabled?`<p class="phone-connection-status"><span class="pill ${i.status==='connected'?'good':'warn'}">${i.status==='connected'?'Ready to connect':this.busy?'Connecting…':'Reconnecting…'}</span></p><div class="actions">${button(this.pairing||this.expired?'New connection code':'Connect a phone','phone-pair')}${button('Turn off phone access','phone-disable')}</div>`:button(this.busy?'Connecting…':'Connect my phone','phone-enable')}${pairing}${this.error?`<p class="error" role="alert">${esc(this.error)}</p>`:''}`;
  }
  draw(){const node=globalThis.document?.querySelector('#phoneAccess');if(node){const large=node.querySelector?.('#phoneQrEnlarge')?.checked;node.innerHTML=this.content();const toggle=node.querySelector?.('#phoneQrEnlarge');if(toggle&&large)toggle.checked=true;const copy=node.querySelector('[data-phone-copy]');if(copy)copy.onclick=()=>this.copyLink();}}
  async copyLink(){
    if(!this.usablePair()){this.draw();return;}
    const link=this.pairing.url;
    try{
      if(!globalThis.navigator?.clipboard?.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link);
      if(this.pairing?.url!==link)return;
      this.copyStatus='Private link copied. Open it on your own phone.';this.draw();
    }catch{
      if(this.pairing?.url!==link)return;
      this.copyStatus='Automatic copy is unavailable. Select and copy the private link above.';this.draw();
      const field=document.querySelector('#phoneAccess [data-phone-link]');field?.focus();field?.select();
    }
  }
  async load(){
    if(this.loading)return this.loading;
    this.loading=(async()=>{const previous=JSON.stringify([this.info,this.error,this.pairing?.url,this.expired]);try{const r=await fetch('/api/phone/status',{cache:'no-store'});if(!r.ok)throw Error('Could not check phone access.');this.info=await r.json();this.error='';if(!this.info.enabled||this.info.status!=='connected')this.clearPair();}catch(e){this.error=e.message;}finally{this.loading=null;if(previous!==JSON.stringify([this.info,this.error,this.pairing?.url,this.expired]))this.draw();}})();return this.loading;
  }
  async post(action,body={}){return this.request('/api/phone/'+action,body);}
  async run(action){if(this.busy)return;this.busy=true;this.error='';this.draw();try{return await action();}catch(e){this.error=e.message;throw e;}finally{this.busy=false;await this.load();this.draw();}}
  async enable(){return this.run(async()=>{this.info=await this.post('enable',{consent:true});await this.newPair();});}
  async newPair(){
    // The service invalidates the previous code when issuing a new one. Never leave it on screen during a retry.
    this.clearPair();this.expired=false;this.draw();
    const value=await this.post('pair');
    const expected=(this.info?.relayUrl??'').replace(/\/$/,'')+'/phone/connect#pair=';
    if(!this.info?.relayUrl||typeof value?.url!=='string'||!value.url.startsWith(expected)||!/^[-_A-Za-z0-9]{43}$/.test(value.url.slice(expected.length))||!Number.isFinite(value.expiresAt)||value.expiresAt<=this.now())throw Error('The connection code is unavailable. Request a new code.');
    const {default:qrcode}=await import('./qrcode.js');const qr=qrcode(0,'M');qr.addData(value.url);qr.make();
    // Six blank modules on every side. Eight display pixels per module also align at 125% and 150% zoom.
    this.qrSize=(qr.getModuleCount()+12)*8;
    this.qr=qr.createSvgTag({cellSize:6,margin:36,scalable:true});this.pairing=value;
    this.expiryTimer=setInterval(()=>this.tick(),1000);this.expiryTimer.unref?.();this.draw();
  }
  async pair(){return this.run(()=>this.newPair());}
  async disable(){return this.run(async()=>{this.info=await this.post('disable');this.clearPair();});}
}
