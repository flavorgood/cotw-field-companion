import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PhoneAccessUI} from '../public/phone-ui.js';
const base='https://relay.invalid/grindzone',link=base+'/phone/connect#pair='+'a'.repeat(43);
function fixture(post=async()=>{throw Error('Unexpected network call');}){
 let now=100000;const ui=new PhoneAccessUI(post,{now:()=>now});
 ui.info={available:true,enabled:true,status:'connected',serviceHost:'relay.invalid',relayUrl:base};
 ui.pairing={url:link,expiresAt:now+300000};ui.qr='<svg data-test-marker="existing-code"></svg>';
 return {ui,advance:ms=>{now+=ms;}};
}
test('the scan view offers a larger QR and a live expiry, with a separate private-link fallback',()=>{
 const {ui}=fixture();const html=ui.content();
 assert.match(html,/Show larger QR/);assert.match(html,/Expires in/);assert.match(html,/>5:00<\/span>/);
 assert.match(html,/--phone-qr-size:318px/);assert.match(html,/one browser once/);assert.match(html,/existing-code/);
 assert.match(html,/Copy private link/);assert.ok(html.includes(link));
});
test('elapsed codes are removed from both the QR and link rather than appearing scan-ready',()=>{
 const {ui,advance}=fixture();advance(300000);const html=ui.content();
 assert.equal(ui.pairing,null);assert.equal(ui.qr,'');assert.equal(ui.expired,true);
 assert.match(html,/connection code has expired/);assert.match(html,/New connection code/);
 assert.doesNotMatch(html,/existing-code|phone-qr-remaining|input type="text"/);assert.ok(!html.includes(link));
});
test('timer expiry does not create a new token or require a user action to remove the old code',()=>{
 let requests=0;const {ui,advance}=fixture(async()=>{requests++;});advance(300001);ui.tick();
 assert.equal(ui.pairing,null);assert.equal(ui.qr,'');assert.equal(requests,0);assert.equal(ui.expiryTimer,null);
});
test('countdown is stable and does not redraw or regenerate a still-valid QR',()=>{
 const {ui,advance}=fixture();advance(61000);assert.equal(ui.timeLeft(),'3:59');ui.tick();
 assert.ok(ui.qr.includes('existing-code'));assert.equal(ui.pairing.url,link);
});
test('requesting a replacement clears the invalidated old code even if the request fails',async()=>{
 const {ui}=fixture(async()=>{assert.equal(ui.pairing,null);assert.equal(ui.qr,'');throw Error('Temporary failure');});
 await assert.rejects(()=>ui.newPair(),/Temporary failure/);assert.equal(ui.pairing,null);assert.equal(ui.qr,'');
});
test('malformed, foreign, or already-expired pairing responses never become a QR',async()=>{
 for(const value of [{url:link,expiresAt:1},{url:'https://other.invalid/phone/connect#pair='+'a'.repeat(43),expiresAt:400000},{url:link+'&extra=1',expiresAt:400000},{url:link,expiresAt:'400000'},null]){
  const {ui}=fixture(async()=>value);await assert.rejects(()=>ui.newPair(),/unavailable/);assert.equal(ui.pairing,null);assert.equal(ui.qr,'');
 }
});
test('a disabled connection does not render an old private QR or a private link',()=>{
 const {ui}=fixture();ui.info.enabled=false;assert.doesNotMatch(ui.content(),/existing-code|readonly/);
});
test('clearCode stops the timer and removes its private material',()=>{
 const {ui}=fixture();ui.expiryTimer=setInterval(()=>{},1000);ui.clearPair();assert.equal(ui.expiryTimer,null);assert.equal(ui.pairing,null);assert.equal(ui.qr,'');
});
test('scan style reserves a white square with black modules, no icon stroke and optional enlargement',()=>{
 const css=readFileSync(new URL('../public/phone.css',import.meta.url),'utf8');
 assert.match(css,/shape-rendering:crispEdges/);assert.match(css,/rect\{fill:#fff;stroke:none/);assert.match(css,/path\{fill:#000;stroke:none/);
 assert.match(css,/phone-qr-enlarge:checked~\.phone-qr/);assert.match(css,/forced-color-adjust:none/);
 const source=readFileSync(new URL('../public/phone-ui.js',import.meta.url),'utf8');assert.match(source,/cellSize:6,margin:36/);
});
