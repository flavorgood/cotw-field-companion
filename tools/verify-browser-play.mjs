/** No-PC acceptance. Actual browser IndexedDB and canonical maps; no fake account or PC process. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createActivatedPhoneRelay} from '../cloud/activation-server.mjs';
const hostRoot=path.resolve(process.argv[2]||'.'),mode=process.argv[3]||'local',output=path.resolve(process.argv[4]||'phone-acceptance');
assert(['local','live'].includes(mode));
const require=createRequire(path.join(hostRoot,'package.json')),{chromium}=require('playwright');
const proof={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),at:new Date().toISOString(),mode,passed:false,checks:[],viewports:[],pcProcessesCreated:0,accountsCreated:0,accountSyncVerified:false,automaticConsoleCaptureVerified:false,physicalPhoneVerified:false,fixture:'Actual standalone UI, IndexedDB, canonical FieldMap, public reference catalogs and deliberate synthetic player reports; no game reader or paired PC'};
let relay,browser;const errors=[],writes=[],privateCalls=[];
const until=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label)};
async function readJournal(page){return page.evaluate(async()=>{const {createBrowserJournalStorage}=await import('./browser-journal-storage.js');const storage=createBrowserJournalStorage();try{return await storage.read();}finally{await storage.close();}});}
async function save(page){await page.locator('#edit-save').click();await page.locator('#editor').waitFor({state:'hidden'});}
try{
 if(mode==='local')relay=await createActivatedPhoneRelay({key:randomBytes(32),publicOrigin:'http://127.0.0.1:0/grindzone',allowInsecureLoopback:true});
 const base=relay?.origin||'https://sway-tips.onrender.com/grindzone',url=base+'/play/';proof.url=url;
 assert.equal((await fetch(base+'/api/state')).status,401);
 const maps=await (await fetch(url+'catalog/maps.json')).json(),reserve=maps.reserves.find(r=>r.id===19);assert(reserve);
 const x=Math.round((reserve.bounds[0][0]+reserve.bounds[1][0])/2),z=Math.round((reserve.bounds[0][1]+reserve.bounds[1][1])/2);
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
 const watch=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);if(/\/api\/(?:state|command|locations|phone|herds)|\/phone\/(?:pair|device|activate)/.test(r.url()))privateCalls.push(new URL(r.url()).pathname);});};
 const page=await context.newPage();watch(page);
 await page.goto(base+'/phone/connect',{waitUntil:'domcontentloaded'});await page.locator('[data-browser-play]').click();await page.waitForURL(u=>u.pathname.endsWith('/play/'));
 await page.locator('#local-consent').check();await page.locator('[data-act=create]').click();
 await page.locator('[data-act=start]').click();await page.locator('[name=name]').fill('Synthetic console whitetail grind');await page.locator('[name=species]').fill('Whitetail Deer');await page.locator('[name=reserve]').selectOption('19');await save(page);
 let doc=await readJournal(page);assert.equal(doc.platform,'xbox');assert.equal(doc.grinds.length,1);assert.equal(doc.reports.length,0);assert.equal(await page.locator('.hero .big').innerText(),'0');
 assert.match(await page.locator('.local-note').innerText(),/Not an account backup/);
 proof.checks.push('Unpaired visitor enters through the real connection page, consents to browser storage and starts a console grind without a PC, account placeholder, or pairing request.');
 await page.locator('[data-act=report]').click();await page.locator('[name=score]').fill('250');await save(page);
 doc=await readJournal(page);assert.equal(doc.reports[0].source,'player_report');assert.equal(doc.reports[0].medal,'unknown');assert.deepEqual(doc.reports[0].points,{});
 await page.locator('[data-act=maps]').first().click();await page.locator('[data-act=place]').last().click();await page.locator('[name=name]').fill('Synthetic north lake');await page.locator('[name=x]').fill(String(x));await page.locator('[name=z]').fill(String(z));await page.locator('[name=need]').selectOption('drinking');await save(page);
 await until(()=>page.locator('#play-map g[data-pin]').count().then(n=>n===1),'canonical saved spot marker');
 const marker=page.locator('#play-map g[data-pin]');assert.equal(Number(await marker.getAttribute('data-world-x')),x);assert.equal(Number(await marker.getAttribute('data-world-z')),z);
 const box=await page.locator('#play-map').boundingBox();assert(box.width>=200&&box.height>=300);
 await page.locator('[data-act=hunt]').click();await page.locator('[data-act=report]').click();await page.locator('[name=medal]').selectOption('diamond');
 doc=await readJournal(page);await page.locator('[name=placeId]').selectOption(doc.places[0].id);
 await page.locator('#editor summary').click();for(const [kind,delta]of [['shot',10],['death',20],['harvest',30]]){await page.locator(`[name=${kind}X]`).fill(String(x+delta));await page.locator(`[name=${kind}Z]`).fill(String(z+delta));}
 await page.locator('[name=notes]').fill('Synthetic report\nNo source save supplied.');await save(page);
 doc=await readJournal(page);assert.equal(doc.reports.length,2);assert.deepEqual(doc.reports[0].points,{shot:{x:x+10,z:z+10},death:{x:x+20,z:z+20},harvest:{x:x+30,z:z+30}});
 await page.locator('[data-act=report-map][data-kind=harvest]').click();const pin=page.locator('#play-map g[data-pin="reported-event"]');await pin.waitFor();assert.equal(Number(await pin.getAttribute('data-world-x')),x+30);
 await page.locator('[data-act=hunt]').click();await page.locator('[data-act=report]').click();await page.locator('[name=species]').fill('North American Beaver');await save(page);
 assert.equal(await page.locator('.hero .big').innerText(),'2');doc=await readJournal(page);assert.equal(doc.reports.length,3);
 proof.checks.push('Actual canonical map renders saved spots and distinct reported shot/death/pickup coordinates. Reported target/other counts and medals retain explicit player provenance; unrecorded locations and medals stay unknown.');
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('.hero').waitFor();assert.equal((await readJournal(page)).reports.length,3);
 const before=await readJournal(page);await page.locator('[data-act=report]').click();await page.locator('[name=score]').fill('123');
 const tab=await context.newPage();watch(tab);await tab.goto(url,{waitUntil:'domcontentloaded'});await tab.locator('[data-act=pause]').click();
 await page.locator('#review-change').waitFor();await page.locator('#edit-save').click();assert.equal(await page.locator('#editor').isVisible(),true);assert.equal(await page.locator('[name=score]').inputValue(),'123');assert.equal((await readJournal(page)).reports.length,before.reports.length);
 await page.locator('#editor [data-close]').first().click();await tab.locator('[data-act=resume]').click();await page.locator('[data-act=refresh]').click();await tab.close();
 proof.checks.push('Reload retains IndexedDB history. A concurrent tab change cannot overwrite the journal or add a stale report; the draft remains visible for deliberate review.');
 await page.locator('[data-act=backup]').first().click();
 const downloadPromise=page.waitForEvent('download');await page.locator('[data-act=export]').click();const backup=await downloadPromise,bytes=readFileSync(await backup.path()),saved=JSON.parse(bytes);assert.equal(saved.journal.reports.length,3);assert.equal(saved.format,'grindzone.private-browser-backup');
 const second=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const other=await second.newPage();watch(other);await other.goto(url,{waitUntil:'domcontentloaded'});await other.locator('#local-consent').waitFor();assert.equal(await other.locator('.hero').count(),0);
 await other.locator('summary').click();await other.locator('#backup-file').setInputFiles({name:'private-test-backup.json',mimeType:'application/json',buffer:bytes});
 await other.locator('#editor').waitFor();assert.equal(await readJournal(other),null);await save(other);assert.deepEqual(await readJournal(other),saved.journal);
 await other.locator('[data-act=backup]').first().click();const retained=await readJournal(other);await other.locator('#backup-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"format":"raw-game-save","journal":{"account":"intruder"}}')});await other.locator('#notice').waitFor();assert.deepEqual(await readJournal(other),retained);
 proof.checks.push('Independent browser starts empty. Explicit export, validation, review and import transfer a private journal; a malformed backup cannot replace it. This proves file-based transfer, not account synchronization.');
 await page.locator('[data-act=hunt]').click();
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);proof.viewports.push({width,overflow:false});}
 await page.setViewportSize({width:390,height:844});mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,mode+'-browser-play.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(privateCalls,[]);assert.equal((await fetch(base+'/api/state')).status,401);
 proof.checks.push('390/320px browser workspace fits without overflow. No page script sent a journal upload, pairing action or private PC API request; the original protected API still requires authorization.');
 proof.passed=true;
}catch(e){proof.error=String(e.stack||e);process.exitCode=1;}
finally{await browser?.close();await relay?.close();proof.finishedAt=new Date().toISOString();mkdirSync(output,{recursive:true});writeFileSync(path.join(output,mode+'-browser-play.json'),JSON.stringify(proof,null,2));console.log('GRINDZONE_BROWSER_PLAY '+JSON.stringify(proof));}
