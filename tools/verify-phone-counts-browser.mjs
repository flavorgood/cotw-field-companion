/** Actual loopback HTTP + Chromium/IndexedDB with disposable synthetic journals.
 * Does not verify physical phones, Xbox telemetry, customer data or deployment.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createBrowserPlayHandler} from '../cloud/browser-play.mjs';

const hostRoot=path.resolve(process.argv[2]), output=path.resolve(process.argv[3]);
const require=createRequire(path.join(hostRoot,'package.json')), {chromium}=require('playwright');
const medals=['unknown','none','bronze','silver','gold','diamond','great_one'];
const members=['public/browser-journal.js','public/browser-play.js','public/browser-play.css','cloud/browser-play.mjs','public/browser-journal-storage.js','tests/browser-journal-summary.test.mjs','tools/verify-phone-counts-browser.mjs'];
const hashes=()=>Object.fromEntries(members.map(name=>[name,createHash('sha256').update(readFileSync(new URL('../'+name,import.meta.url))).digest('hex')]));
const proof={at:new Date().toISOString(),sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceMembers:hashes(),scope:'Actual Chromium UI/IndexedDB and unmodified loopback HTTP handler, synthetic journal fixtures',physicalPhoneVerified:false,productionOrCustomerAccess:false,passed:false,checks:[],requests:[]};
const errors=[];
let handler, browser;
const server=http.createServer((req,res)=>{
 proof.requests.push({method:req.method,path:req.url});
 if(handler(req,res))return;res.writeHead(404);res.end('Not found');
});
const read=page=>page.evaluate(async()=>{
 const {createBrowserJournalStorage}=await import('./browser-journal-storage.js'), s=createBrowserJournalStorage();
 try{return await s.read();}finally{await s.close();}
});
async function countCheck(page,scope,expected,total){
 await page.locator(`[data-act=filter][data-filter=${scope}]`).click();
 assert.equal(await page.locator('[data-medal-summary]').getAttribute('data-scope'),scope);
 assert.equal(await page.locator('[data-filter-title]').textContent(),`${{target:'Target',other:'Other',all:'All'}[scope]} harvest reports: ${total}`);
 const actual=Object.fromEntries(await Promise.all(medals.map(async m=>[m,Number((await page.locator(`[data-medal-count=${m}]`).textContent()).replaceAll(',',''))])));
 assert.deepEqual(actual,expected);assert.equal(Object.values(actual).reduce((a,b)=>a+b,0),total);
 assert.equal(await page.locator('.feed [data-report-id]').count(),Math.min(20,total));
 assert.match(await page.locator('[data-medal-summary]').textContent(),/Medal not recorded/);
 assert.match(await page.locator('[data-medal-summary]').textContent(),/No medal/);
 return actual;
}
async function capture(page,name){
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no horizontal overflow');
 const report=page.locator('[data-act=report]');await report.scrollIntoViewIfNeeded();
 assert(await report.isVisible());assert(await report.isEnabled());
 assert((await report.boundingBox()).height>=44,'primary action touch height');
 await page.screenshot({path:path.join(output,name+'-top.png')});
 await page.locator('[data-medal-summary]').screenshot({path:path.join(output,name+'-counts.png')});
}
try{
 mkdirSync(output,{recursive:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 handler=createBrowserPlayHandler({publicOrigin:origin+'/grindzone'});
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{}),args:['--disable-dev-shm-usage']});
 async function newPage(width=390){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/grindzone/play/');await page.locator('[data-act=create]').waitFor();return {context,page};
 }
 // First use has no PC pairing, account bootstrap or fixture journal.
 const first=await newPage(320);
 await first.page.locator('#platform').selectOption('xbox');await first.page.locator('#local-consent').check();
 await first.page.locator('[data-act=create]').click();await first.page.locator('[data-act=start]').waitFor({state:'visible'});
 await first.page.waitForFunction(()=>!document.querySelector('[data-act=start]').disabled);
 await first.page.locator('[data-act=start]').click();await first.page.locator('[name=name]').fill('First phone grind');
 await first.page.locator('[name=species]').fill('Whitetail Deer');await first.page.locator('[name=reserve]').selectOption('19');
 await first.page.locator('#edit-save').click();await first.page.locator('[data-act=report]').waitFor();
 await countCheck(first.page,'target',Object.fromEntries(medals.map(m=>[m,0])),0);
 await first.page.locator('[data-act=report]').click();await first.page.locator('[name=species]').fill('whitetail deer');
 await first.page.locator('[name=score]').fill('999999');await first.page.locator('#edit-save').click();
 await first.page.waitForFunction(()=>document.querySelector('[data-report-count]')?.textContent==='1');
 await countCheck(first.page,'target',{unknown:1,none:0,bronze:0,silver:0,gold:0,diamond:0,great_one:0},1);
 assert.equal((await read(first.page)).platform,'xbox');await first.page.reload();
 await first.page.locator('[data-medal-summary]').waitFor();assert.equal((await read(first.page)).reports.length,1);
 proof.checks.push('Actual first-use Xbox journal, grind, case-variant high-score report and reload; no medal inference or PC/account dependency');
 await first.context.close();

 const fixture=await newPage();
 const seeded=await fixture.page.evaluate(async medals=>{
  const {createBrowserJournalStorage}=await import('./browser-journal-storage.js');
  const s=createBrowserJournalStorage(), now=new Date().toISOString();let d=await s.create('xbox'),last;
  const execute=async(op,data)=>{last={id:crypto.randomUUID(),op,expectedRevision:d.revision,data};d=await s.execute(d.id,last);};
  try{
   await execute('grind.start',{grindId:crypto.randomUUID(),name:'Synthetic mixed trophy grind',targetSpecies:'Whitetail Deer',reserve:19});
   await execute('place.add',{placeId:crypto.randomUUID(),name:'Synthetic drinking zone',reserve:19,need:'drinking',x:123,z:456});
   const rows=medals.flatMap(medal=>[{species:'whitetail deer',medal},{species:'Moose',medal}]);
   rows.push({species:'Whitetail',medal:'diamond'},{species:'Whitetail  Deer',medal:'gold'});
   rows.push(...Array.from({length:15},()=>({species:'WHITETAIL DEER',medal:'gold'})));
   for(let i=0;i<rows.length;i++){
    const row=rows[i],screenshot=i===0?{kind:'reviewed_screenshot',version:'grindzone.harvest-intake.v1',imageSha256:'a'.repeat(64),mimeType:'image/png',byteLength:200,width:320,height:180,method:'manual_review',engine:'tesseract.js/7.0.0',language:'eng',extracted:{species:null,score:null,medal:'unknown',sex:'unknown'},reviewedAt:now}:null;
    await execute('report.add',{reportId:crypto.randomUUID(),grindId:d.grinds[0].id,version:1,...row,score:i===0?999999:null,sex:'unknown',occurredAt:d.grinds[0].createdAt,placeId:d.places[0].id,points:{shot:{x:1,z:2},death:{x:3,z:4},harvest:{x:5,z:6}},notes:`Synthetic record ${i}`, ...(screenshot?{screenshot}:{})});
   }
   const beforeReplay=structuredClone(d);d=await s.execute(d.id,last);
   if(JSON.stringify(beforeReplay)!==JSON.stringify(d))throw Error('Receipt replay changed journal');
   const changed=structuredClone(d);changed.reports.find(r=>r.screenshot).species=' whitetail deer ';changed.grinds[0].targetSpecies=' Whitetail Deer ';
   d=await s.restore(changed,{id:d.id,revision:d.revision});return d;
  }finally{await s.close();}
 },medals);
 await fixture.page.reload();await fixture.page.locator('[data-medal-summary]').waitFor();
 const target={unknown:1,none:1,bronze:1,silver:1,gold:16,diamond:1,great_one:1};
 const other={unknown:1,none:1,bronze:1,silver:1,gold:2,diamond:2,great_one:1};
 const all=Object.fromEntries(medals.map(m=>[m,target[m]+other[m]]));
 await countCheck(fixture.page,'target',target,22);
 assert.match(await fixture.page.locator('body').textContent(),/Latest 20 of 22 reports shown/);
 assert.equal((await read(fixture.page)).reports.length,31);
 await countCheck(fixture.page,'other',other,9);
 assert(await fixture.page.locator('.feed h3').allTextContents().then(names=>names.includes('Whitetail')&&names.includes('Whitetail  Deer')));
 await countCheck(fixture.page,'all',all,31);
 proof.checks.push('All seven medal counts partition 31 reports across Target/Other/All; case and outer spaces match, aliases/internal spaces stay Other; totals include reports beyond 20-card feed');
 assert.deepEqual(await read(fixture.page),seeded);
 proof.checks.push('Counts and filter changes do not rewrite raw labels, screenshot evidence, receipts, spots or separate shot/death/pickup points');
 await fixture.page.setViewportSize({width:320,height:844});await countCheck(fixture.page,'target',target,22);await capture(fixture.page,'target-320');
 await fixture.page.setViewportSize({width:390,height:844});await countCheck(fixture.page,'other',other,9);await capture(fixture.page,'other-390');
 proof.checks.push('320px/390px rendered counts have no horizontal overflow and Record harvest remains reachable with at least 44px touch height');
 await fixture.page.locator('[data-act=report]').click();await fixture.page.locator('[name=species]').fill('WHITETAIL DEER');
 await fixture.page.locator('[name=medal]').selectOption('diamond');await fixture.page.locator('#edit-save').click();
 await fixture.page.waitForFunction(()=>!document.querySelector('#editor').open);
 target.diamond++;all.diamond++;
 await countCheck(fixture.page,'target',target,23);await countCheck(fixture.page,'other',other,9);await countCheck(fixture.page,'all',all,32);
 const recorded=await read(fixture.page);assert.equal(recorded.reports.length,32);
 await fixture.page.reload();await fixture.page.locator('[data-medal-summary]').waitFor();await countCheck(fixture.page,'target',target,23);
 proof.checks.push('Real Record harvest dialog adds case-variant Diamond once; scoped counts and IndexedDB survive reload');
 const duplicate=await fixture.page.evaluate(async()=>{
  const {createBrowserJournalStorage}=await import('./browser-journal-storage.js'),s=createBrowserJournalStorage();
  try{const d=await s.read(),r=d.reports.find(r=>r.screenshot);
   try{await s.execute(d.id,{id:crypto.randomUUID(),op:'report.add',expectedRevision:d.revision,data:{reportId:crypto.randomUUID(),grindId:r.grindId,version:d.grinds[0].version,species:r.species,medal:r.medal,score:r.score,sex:r.sex,occurredAt:r.occurredAt,placeId:r.placeId,points:r.points,notes:r.notes,screenshot:r.screenshot}});return 'unexpected success';}catch(e){return e.code;}
  }finally{await s.close();}
 });
 assert.equal(duplicate,'duplicate_screenshot');assert.deepEqual(await read(fixture.page),recorded);
 proof.checks.push('Actual IndexedDB command replay and duplicate screenshot guard do not add harvests or change counts');
 await fixture.page.locator('.tabs [data-act=backup]').click();
 const downloaded=fixture.page.waitForEvent('download');await fixture.page.locator('[data-act=export]').click();
 const download=await downloaded, backupPath=path.join(output,'synthetic-private-backup.json');await download.saveAs(backupPath);
 assert.deepEqual(JSON.parse(readFileSync(backupPath,'utf8')).journal,recorded);
 const restored=await newPage(320);await restored.page.locator('details').first().locator('summary').click();
 await restored.page.locator('#backup-file').setInputFiles(backupPath);await restored.page.locator('#editor[open]').waitFor();
 assert.equal(await read(restored.page),null);await restored.page.locator('[aria-label="Close editor"]').click();assert.equal(await read(restored.page),null);
 await restored.page.locator('#backup-file').setInputFiles(backupPath);await restored.page.locator('#editor[open]').waitFor();
 await restored.page.locator('#edit-save').click();await restored.page.locator('[data-medal-summary]').waitFor();
 assert.deepEqual(await read(restored.page),recorded);await countCheck(restored.page,'all',all,32);
 await restored.page.reload();await restored.page.locator('[data-medal-summary]').waitFor();assert.deepEqual(await read(restored.page),recorded);
 await countCheck(restored.page,'all',all,32);await capture(restored.page,'restored-all-320');
 proof.checks.push('Actual private file export and second isolated browser import: review/cancel causes no writes; confirm restores exact journal and all scoped counts persist after reload');
 assert.equal(proof.requests.some(r=>r.method!=='GET'),false,'browser journal made no upload request');
 assert.equal(proof.requests.some(r=>r.path.includes('/api/account/')||r.path.includes('/phone/')),false,'no account or PC requirement');
 assert.deepEqual(errors,[]);assert.deepEqual(hashes(),proof.sourceMembers,'candidate changed during proof');
 proof.passed=true;
}catch(e){proof.error=e.stack;process.exitCode=1;}
finally{
 proof.completedAt=new Date().toISOString();proof.pageErrors=errors;
 writeFileSync(path.join(output,'http-browser-acceptance.json'),JSON.stringify(proof,null,2));
 await browser?.close();await new Promise(resolve=>server.close(resolve));
 console.log(JSON.stringify({passed:proof.passed,checks:proof.checks,error:proof.error,receipt:path.join(output,'http-browser-acceptance.json')},null,2));
}
