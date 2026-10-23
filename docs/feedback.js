import {esc} from './data-client.js?v=267cb98126cd5bca';

const REPO='https://github.com/infotradescout/cotw-field-companion';

export class FeedbackPanel{
  constructor(root,onRender,{endpoint=''}={}){
    this.root=root;this.onRender=onRender;this.endpoint=this.#origin(endpoint);this.busy=false;this.status=null;
    root.addEventListener('submit',event=>{if(event.target.id==='feedbackForm')void this.submit(event);});
  }
  #origin(value){try{const url=new URL(String(value||''));return /^https?:$/.test(url.protocol)?url.origin:'';}catch{return '';}}
  render(){
    const status=this.status?`<p class="feedback-status ${this.status.error?'error':'success'}" role="status">${esc(this.status.text)}</p>`:'';
    if(!this.endpoint)return `<section class="panel feedback-panel"><div class="eyebrow">FIELD NOTES</div><h1>Help shape the companion.</h1><p>Tell the project what felt confusing, what broke, or what would make a grind easier. Never include a save file, account ID, or personal photo in feedback.</p><div class="callout"><strong>Send a public field note.</strong><p>Use GitHub Issues for now. The private Windows Companion checks these notes in its owner inbox. The optional hosted form will appear here after its owner auth and abuse controls are live.</p><a class="button primary" href="${REPO}/issues/new?template=feedback.yml" target="_blank" rel="noopener noreferrer">Send a field note</a></div></section>`;
    return `<section class="panel feedback-panel"><div class="eyebrow">FIELD NOTES</div><h1>Send feedback</h1><p>Help improve the hunt. Keep saves, account IDs, and personal photos out of messages.</p>${status}<form id="feedbackForm" class="feedback-form"><label>What kind of note is this?<select name="category"><option value="bug">Something is broken</option><option value="idea">I have an idea</option><option value="ui">The screen is confusing</option><option value="data">The data looks wrong</option><option value="other">Something else</option></select></label><label>Your message<textarea name="message" maxlength="4000" required placeholder="What happened? What were you trying to do?"></textarea></label><label>Reply email (optional)<input name="replyTo" type="email" maxlength="254" placeholder="you@example.com"></label><input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="feedback-honeypot"><button class="button primary" type="submit" ${this.busy?'disabled':''}>${this.busy?'Sending…':'Send feedback'}</button><p class="tiny muted">Messages are stored as plain text for the project owner. Screenshots are not uploaded.</p></form></section>`;
  }
  async submit(event){
    event.preventDefault();if(this.busy)return;const form=event.target,values=Object.fromEntries(new FormData(form));this.busy=true;this.status=null;this.onRender();
    try{
      const response=await fetch(this.endpoint+'/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,page:location.hash.slice(1)||'home',build:String(globalThis.COTW_BUILD_TAG||'public-preview')})});
      const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'Feedback could not be sent.');
      this.status={text:'Feedback received. Thank you.'};
    }catch(error){this.status={error:true,text:error.message};}
    finally{this.busy=false;this.onRender();}
  }
}
