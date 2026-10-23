import test from 'node:test';
import assert from 'node:assert/strict';
const priorDocument=globalThis.document;
globalThis.document={documentElement:{dataset:{runtime:'local'}}};
const {grindsView,grindTotal,GrindActivitySelection}=await import('../public/grinds.js');
const {PhoneAccessUI}=await import('../public/phone-ui.js');
if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;
const record={id:'synthetic-record',species:'Moose',score:100,timestamp:1789891200};
const session=(extra={})=>({id:'synthetic-grind',name:'Synthetic hunt',reserve:19,targetSpecies:'Moose',goal:100,startedAt:'2026-09-20T12:00:00Z',endedAt:null,harvestSummary:{total:10,targetTotal:7,bySpecies:[{species:'Moose',count:7},{species:'Red Deer',count:3}],activity:{all:[record],target:[record],other:[{...record,id:'other',species:'Red Deer'}]}},...extra});
const view=s=>grindsView({sessions:[s],reserves:[{id:19,name:'Synthetic reserve'}]});
const section=(html,name)=>html.match(new RegExp('<section class="'+name+'"[^>]*>[\\s\\S]*?</section>'))?.[0]||'';
test('active grind reaches harvest activity before management, optional goals and finishing',()=>{
 const html=view(session()),hero=section(html,'grind-hero');
 assert.match(hero,/7 target · 3 other · 10 total in this grind/);
 assert.doesNotMatch(hero,/session-end|grind-add-goal|grind-animal-breakdown|grind-goal/);
 assert.ok(html.indexOf('class="grind-results"')<html.indexOf('Manage grind &amp; details'));
 const management=section(html,'grind-numbers');
 assert.match(management,/<details data-disclosure-key="grind-progress"><summary>Manage grind &amp; details/);
 assert.match(management,/data-action="session-end"/);assert.match(management,/Harvest goal/);assert.match(management,/Animals in this grind/);
 assert.doesNotMatch(management,/<details[^>]*\sopen(?:[\s>])/);
});
test('a missing goal creates no empty setup prompt ahead of recent activity',()=>{
 const html=view(session({goal:null}));
 assert.doesNotMatch(section(html,'grind-hero'),/Set a harvest goal/);
 assert.match(section(html,'grind-numbers'),/Set a harvest goal/);
});
test('secondary controls preserve the selected grind and unknown counts stay unknown',()=>{
 const s=session({id:'chosen"<unsafe>',harvestSummary:null});const html=view(s);
 assert.equal(grindTotal(s),null);assert.match(html,/— target · — other · — total/);
 assert.doesNotMatch(html,/<unsafe>|data-id="chosen"/);assert.match(html,/data-action="session-end" data-id="chosen&quot;&lt;unsafe&gt;"/);
});
test('phone quick actions retain home, map, route and pause but never finish',()=>{
 const html=view(session()),dock=html.match(/<nav class="grind-phone-dock"[\s\S]*?<\/nav>/)[0];
 for(const action of ['view-home','grind-hunt','grind-route','session-pause'])assert.match(dock,new RegExp('data-action="'+action+'"'));
 assert.equal((dock.match(/<button /g)||[]).length,4);assert.doesNotMatch(dock,/session-end/);
 const paused=view(session({pausedAt:'2026-09-20T12:05:00Z'}));assert.match(paused,/data-action="session-resume"/);
 const finished=view(session({endedAt:'2026-09-20T12:05:00Z'}));assert.match(finished,/FINISHED GRIND/);assert.doesNotMatch(finished,/CURRENT GRIND|data-action="session-end"/);
});
test('explicit activity filter choices survive the reorganized screen',()=>{
 const s=session(),selection=new GrindActivitySelection();selection.change(s,'target');selection.more(s);
 assert.deepEqual(selection.get(s),{activityFilter:'target',activityLimit:8});
 const html=grindsView({sessions:[s]},selection.get(s));assert.match(html,/data-filter="target"[^>]*aria-pressed="true"/);
 assert.doesNotMatch(html,/data-grind-harvest-id="other"/);
});
const paired=()=>{const ui=new PhoneAccessUI(async()=>{});ui.info={available:true,enabled:true,status:'connected',serviceHost:'relay.invalid'};ui.pairing={url:'https://relay.invalid/phone/connect#pair='+'x'.repeat(43),expiresAt:Date.now()+60000};ui.qr='<svg data-test-qr></svg>';return ui;};
test('QR has a visible non-camera fallback and one-use browser instructions',()=>{
 const html=paired().content();assert.match(html,/data-phone-copy>Copy private link/);assert.match(html,/data-phone-link[^>]*readonly/);
 assert.match(html,/one browser once/);assert.match(html,/Switching browsers/);assert.doesNotMatch(html,/<details/);
});
test('expired or disconnected codes expose neither the old QR nor private link',()=>{
 for(const status of ['expired','reconnecting','disabled']){
  const ui=paired(),secret=ui.pairing.url;
  if(status==='expired')ui.pairing.expiresAt=Date.now()-1;else{ui.info.status=status;ui.info.enabled=status!=='disabled';}
  const html=ui.content();assert.doesNotMatch(html,/data-test-qr|data-phone-copy/);assert.ok(!html.includes(secret));assert.match(html,/expired or the PC connection changed/);
 }
});
test('copy only sends a currently usable pairing link to the clipboard',async()=>{
 const ui=paired(),calls=[];ui.draw=()=>{};
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>calls.push(value)}}});
 try{await ui.copyLink();assert.deepEqual(calls,[ui.pairing.url]);assert.match(ui.copyStatus,/copied/);ui.pairing.expiresAt=0;await ui.copyLink();assert.equal(calls.length,1);}
 finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
test('denied clipboard access offers selection without another network action',async()=>{
 const ui=paired();ui.draw=()=>{};let focus=0,select=0;const doc=globalThis.document,nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.document={querySelector:()=>({focus:()=>focus++,select:()=>select++})};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async()=>{throw Error('denied');}}}});
 try{await ui.copyLink();assert.match(ui.copyStatus,/Select and copy/);assert.equal(focus,1);assert.equal(select,1);}
 finally{if(doc===undefined)delete globalThis.document;else globalThis.document=doc;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
});
test('a late copy cannot mark a replacement pairing link copied',async()=>{
 const ui=paired();ui.draw=()=>{};let resolve;const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:()=>new Promise(r=>resolve=r)}}});
 try{const pending=ui.copyLink();ui.clearPair();ui.pairing={url:'https://relay.invalid/phone/connect#pair='+'y'.repeat(43),expiresAt:Date.now()+60000};resolve();await pending;assert.equal(ui.copyStatus,'');}
 finally{if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
});
test('unavailable local configuration explains the running-copy problem instead of an indefinite setup promise',()=>{
 const ui=new PhoneAccessUI(()=>{});ui.info={available:false};assert.match(ui.content(),/running copy does not have a phone-service address/);assert.doesNotMatch(ui.content(),/is being set up/);
});
