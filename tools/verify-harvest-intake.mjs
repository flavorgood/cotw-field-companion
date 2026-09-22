/** Actual browser/OCR acceptance using generated English images, never player screenshots. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {createActivatedPhoneRelay} from '../cloud/activation-server.mjs';
const hostRoot=path.resolve(process.argv[2]||'.'),mode=process.argv[3]||'local',output=path.resolve(process.argv[4]||'phone-acceptance');
assert(['local','live'].includes(mode));
const require=createRequire(path.join(hostRoot,'package.json')),{chromium}=require('playwright'),sharp=require('sharp');
const proof={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),at:new Date().toISOString(),mode,passed:false,checks:[],viewports:[],realOcrEngineVerified:false,automaticConsoleCaptureVerified:false,physicalXboxCaptureVerified:false,accountSyncVerified:false,pcProcessesCreated:0,accountsCreated:0,fixture:'Generated English harvest-screen images, actual application, image decoder, Tesseract.js, WebAssembly and IndexedDB; not a real console screenshot'};
let relay,browser;const errors=[],writes=[],external=[],privateCalls=[];
const until=async(fn,label)=>{for(let i=0;i<120;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);};
async function readJournal(page){return page.evaluate(async()=>{const {createBrowserJournalStorage}=await import('./browser-journal-storage.js');const storage=createBrowserJournalStorage();try{return await storage.read();}finally{await storage.close();}});}
const lines=['HARVEST CHECK','WHITETAIL DEER','TROPHY RATING','271.25','GENDER','FEMALE','DIAMOND'];
const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="850"><rect width="1400" height="850" fill="white"/>${lines.map((line,i)=>`<text x="80" y="${90+i*105}" font-family="DejaVu Sans" font-size="52" fill="black">${line}</text>`).join('')}</svg>`);
const image=await sharp(svg).png().toBuffer(),secondImage=await sharp(image).composite([{input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="black"/></svg>'),left:1390,top:840}]).png().toBuffer();
const file=buffer=>({name:'synthetic-harvest.png',mimeType:'image/png',buffer});
try{
 if(mode==='local')relay=await createActivatedPhoneRelay({key:randomBytes(32),publicOrigin:'http://127.0.0.1:0/grindzone',allowInsecureLoopback:true});
 const base=relay?.origin||'https://sway-tips.onrender.com/grindzone',url=base+'/play/';proof.url=url;
 // Public mode must execute the candidate's exact reader bytes, not an older live app.
 for(const name of ['browser-play.js','browser-journal.js','harvest-intake.js','harvest-intake-core.js','harvest-ocr.js']){
  const response=await fetch(url+name);assert.equal(response.status,200);
  assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),createHash('sha256').update(readFileSync('public/'+name)).digest('hex'),name+' source identity');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
 const watch=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);if(!r.url().startsWith(url))external.push(r.url());if(/\/api\/|\/phone\//.test(r.url()))privateCalls.push(r.url());});};
 const page=await context.newPage();watch(page);await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.locator('#local-consent').check();await page.locator('[data-act=create]').click();await page.locator('[data-act=start]').click();
 await page.locator('#edit-form [name=name]').fill('Screenshot acceptance grind');await page.locator('#edit-form [name=species]').fill('Whitetail Deer');await page.locator('#edit-form [name=reserve]').selectOption('19');await page.locator('#edit-save').click();await page.locator('#editor').waitFor({state:'hidden'});
 await page.locator('[data-act=screenshot]').click();await page.locator('.harvest-intake [name=image]').setInputFiles(file(image));
 await page.waitForFunction(()=>document.querySelector('.harvest-intake [data-review]')?.disabled===false,{},{timeout:130000});
 assert.equal(await page.locator('.harvest-intake [name=species]').inputValue(),'Whitetail Deer');assert.equal(await page.locator('.harvest-intake [name=score]').inputValue(),'271.25');assert.equal(await page.locator('.harvest-intake [name=sex]').inputValue(),'female');assert.equal(await page.locator('.harvest-intake [name=medal]').inputValue(),'diamond');assert.equal(await page.locator('.harvest-intake [name=occurredAt]').inputValue(),'');assert.equal((await readJournal(page)).reports.length,0);
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);const box=await page.locator('.harvest-intake').boundingBox();assert(box.width<=width&&box.x>=0);proof.viewports.push({width,reviewFits:true});}
 await page.setViewportSize({width:390,height:844});mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,mode+'-harvest-intake.png'),fullPage:true});
 await page.locator('.harvest-intake [data-now]').click();await page.locator('.harvest-intake [name=reviewed]').check();await page.evaluate(()=>{const b=document.querySelector('.harvest-intake [data-save]');b.click();b.click();});await page.locator('.harvest-intake').waitFor({state:'detached'});
 let doc=await readJournal(page);assert.equal(doc.reports.length,1);assert.equal(doc.reports[0].source,'player_report');assert.deepEqual(doc.reports[0].points,{});assert.equal(doc.reports[0].screenshot.method,'local_ocr');assert.equal(doc.reports[0].screenshot.engine,'tesseract.js/7.0.0');assert.equal(doc.reports[0].screenshot.imageSha256,createHash('sha256').update(image).digest('hex'));proof.realOcrEngineVerified=true;
 proof.checks.push('Actual local Tesseract/WebAssembly reads the generated image; suggestions do not count a harvest or invent time/GPS. Explicit review and rapid double-submit save exactly one source-labeled record.');
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('.hero').waitFor();assert.equal(await page.locator('.hero .big').innerText(),'1');assert.match(await page.locator('.report .source').innerText(),/Reviewed screenshot/);
 await page.locator('[data-act=screenshot]').click();await page.locator('.harvest-intake [name=image]').setInputFiles(file(image));await until(()=>page.locator('.harvest-intake [data-status]').innerText().then(t=>t.includes('already recorded')),'duplicate rejection');assert.equal(await page.locator('.harvest-intake [data-save]').isDisabled(),true);assert.equal((await readJournal(page)).reports.length,1);await page.locator('.harvest-intake [data-cancel]').click();
 proof.checks.push('Reload retains evidence and counts; an exact-byte duplicate image cannot be counted again. Re-encoded or cropped copies are not claimed deduplicated.');
 // Cancellation is deliberate and before review; no synthetic OCR responses are injected.
 await page.locator('[data-act=screenshot]').click();await page.locator('.harvest-intake [name=image]').setInputFiles(file(secondImage));await page.locator('.harvest-intake [data-stop]').waitFor();await page.locator('.harvest-intake [data-stop]').click();await until(()=>page.locator('.harvest-intake [data-review]').isEnabled(),'cancelled review');assert.equal(await page.locator('.harvest-intake [name=species]').inputValue(),'');await page.locator('.harvest-intake [data-cancel]').click();assert.equal((await readJournal(page)).reports.length,1);
 proof.checks.push('Cancelling the actual reader enables manual review without counting a harvest; abandoned output cannot change journal counts.');
 await page.locator('[data-act=screenshot]').click();await page.locator('.harvest-intake [name=image]').setInputFiles(file(secondImage));await page.waitForFunction(()=>document.querySelector('.harvest-intake [data-review]')?.disabled===false,{},{timeout:130000});
 assert.equal(await page.locator('.harvest-intake [name=medal]').inputValue(),'diamond');await page.locator('.harvest-intake [data-now]').click();await page.locator('.harvest-intake [name=medal]').selectOption('gold');
 const tab=await context.newPage();watch(tab);await tab.goto(url,{waitUntil:'domcontentloaded'});await tab.locator('.hero').waitFor();
 await tab.evaluate(async()=>{const {createBrowserJournalStorage}=await import('./browser-journal-storage.js');const channel=new BroadcastChannel('grindzone-browser-journal-changes'),s=createBrowserJournalStorage({notify:m=>channel.postMessage(m)});try{const d=await s.read();await s.execute(d.id,{id:crypto.randomUUID(),op:'settings',expectedRevision:d.revision,data:{terrain:false}});}finally{await s.close();channel.close();}});
 await page.locator('.harvest-intake [data-refresh]').waitFor();await page.locator('.harvest-intake [name=reviewed]').check();await page.locator('.harvest-intake [data-save]').click();await until(()=>page.locator('.harvest-intake [data-status]').innerText().then(t=>t.includes('changed in another tab')),'stale write rejection');assert.equal((await readJournal(page)).reports.length,1);assert.equal(await page.locator('.harvest-intake [name=medal]').inputValue(),'gold');
 await page.locator('.harvest-intake [data-refresh]').click();await until(()=>page.locator('.harvest-intake [data-status]').innerText().then(t=>t.includes('Current progress loaded')),'explicit refresh');await page.locator('.harvest-intake [name=reviewed]').check();await page.locator('.harvest-intake [data-save]').click();await page.locator('.harvest-intake').waitFor({state:'detached'});await tab.close();
 doc=await readJournal(page);assert.equal(doc.reports.length,2);assert.equal(doc.reports[0].medal,'gold');assert.equal(doc.reports[0].screenshot.extracted.medal,'diamond');
 proof.checks.push('A concurrent IndexedDB write rejects the stale save, preserves the corrected draft and requires fresh review. Confirmed fields remain distinct from OCR suggestions.');
 await page.locator('[data-act=backup]').first().click();const downloadPromise=page.waitForEvent('download');await page.locator('[data-act=export]').click();const backup=await downloadPromise,bytes=readFileSync(await backup.path());
 const second=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const other=await second.newPage();watch(other);await other.goto(url,{waitUntil:'domcontentloaded'});await other.locator('#local-consent').waitFor();assert.equal(await readJournal(other),null);await other.locator('.intro summary').click();await other.locator('#backup-file').setInputFiles({name:'private-synthetic-backup.json',mimeType:'application/json',buffer:bytes});await other.locator('#editor').waitFor();await other.locator('#edit-save').click();await other.locator('#editor').waitFor({state:'hidden'});assert.deepEqual(await readJournal(other),doc);
 await other.locator('[data-act=screenshot]').click();await other.locator('.harvest-intake [name=image]').setInputFiles(file(image));await until(()=>other.locator('.harvest-intake [data-status]').innerText().then(t=>t.includes('already recorded')),'restored duplicate rejection');assert.equal((await readJournal(other)).reports.length,2);
 proof.checks.push('Explicit backup file transfer to a fresh independent browser preserves screenshot evidence and duplicate protection. It is not account-based phone recovery.');
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);assert.deepEqual(privateCalls,[]);assert.equal((await fetch(base+'/api/state')).status,401);proof.browserUploads=0;proof.privatePcApiRequests=0;
 proof.checks.push('No page errors, screenshot uploads, external browser requests or private PC API calls; the original protected API remains unauthorized.');proof.passed=true;
}catch(e){proof.error=String(e.stack||e);process.exitCode=1;}
finally{await browser?.close();await relay?.close();proof.finishedAt=new Date().toISOString();mkdirSync(output,{recursive:true});writeFileSync(path.join(output,mode+'-harvest-intake.json'),JSON.stringify(proof,null,2));console.log('GRINDZONE_HARVEST_INTAKE '+JSON.stringify(proof));}
