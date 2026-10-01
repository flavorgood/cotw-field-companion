/** Complete app browser proof, synthetic loopback responses only. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bindPhoneCacheClient} from '../cloud/phone-cache-client.mjs';
import {mountClientSource} from '../cloud/mount.mjs';
const root=path.resolve(process.argv[2]||'.'),mode=process.argv[3]||'candidate',out=path.resolve(process.argv[4]||'evidence/refresh-loading/'+mode);
assert.ok(['baseline','candidate','hosted'].includes(mode));
const hosted=mode==='hosted',mount=hosted?'/grindzone':'';
fs.mkdirSync(out,{recursive:true});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright');
const state={app:{name:'GrindZone',startedAt:'synthetic-loading'},selectedReserve:19,reserves:[{id:19,name:'Synthetic reserve',bounds:[[0,0],[16000,16000]]},{id:20,name:'Other synthetic reserve',bounds:[[0,0],[16000,16000]]}],settings:{spoilers:false,terrain:false},career:{summary:{diamonds:123,greatOnes:4}},changes:[],careerChanges:[],population:[],zones:[],zoneLedgerVersion:1,zoneHistory:[],zoneTracking:{},zoneActivity:{},encounters:[],harvests:[],pins:[],equipment:[],route:[],sessions:[],observer:{connected:true,sources:[],intervalMs:5000}};
let holdState=false,bootstrapError=false,holdBootstrap=false,held=[],requests=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');if(hosted)url.pathname=url.pathname.replace(/^\/grindzone(?=\/)/,'');requests.push({method:req.method,path:url.pathname,query:url.search});
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...(hosted?{'X-GrindZone-Cache-Scope':'a'.repeat(43),'X-GrindZone-Cache-Expires':String(Date.now()+86400000)}:{})});res.end(JSON.stringify(body));};
 if(url.pathname==='/api/bootstrap'){
  if(bootstrapError)return json(503,{error:'Synthetic startup outage'});
  if(holdBootstrap){res.writeHead(200,{'Content-Type':'application/json'});res.write('{');held.push(res);return;}
  return json(200,{token:'synthetic',selectedReserve:19,phone:{remote:hosted}});
 }
 if(url.pathname==='/api/state'){
  if(holdState){res.writeHead(200,{'Content-Type':'application/json'});res.write('{');held.push(res);return;}
  return json(200,{...state,...(hosted?{phone:{mode:'live_relay'}}:{}),selectedReserve:Number(url.searchParams.get('reserve')||19)});
 }
 const rel=url.pathname==='/'?'index.html':url.pathname.slice(1);
 if(rel.includes('..'))return json(404,{});
 try{let body=fs.readFileSync(path.join(root,'public',rel));if(hosted&&rel==='app.js')body=mountClientSource(bindPhoneCacheClient(body.toString()),mount);else if(hosted&&(rel.endsWith('.html')||rel.endsWith('.js')))body=mountClientSource(body.toString(),mount);res.writeHead(200,{'Content-Type':rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream'});res.end(body);}catch{return json(404,{error:'Synthetic catalog unavailable'});}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port+mount,checks=[],errors=[];
let browser;
const release=()=>{for(const response of held)response.destroy();held=[];};
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.goto(base+'/#home',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#connection')?.textContent==='Save tracking on');
 holdState=true;
 await page.waitForResponse(response=>response.url().includes('/api/state?'));
 holdState=false;
 await page.locator('.desktop-navigation [data-view="map"]').click();
 if(mode==='baseline'){
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('[data-state-loading]').count(),1);
  assert.equal(requests.filter(r=>r.query.includes('huntSpecies')).length,0);
  checks.push('Baseline: held state response body prevents new Hunt request and leaves rendered loading screen');
  await page.screenshot({path:path.join(out,'held-state-navigation.png')});
 }else{
  await page.locator('#fieldMap').waitFor({timeout:5000});
  assert.ok(requests.some(r=>r.query.includes('huntSpecies')));
  checks.push('Changing to Hunt aborts obsolete held body and renders current scoped data within five seconds');
  await page.screenshot({path:path.join(out,'recovered-hunt-navigation.png')});
  // Rapid context changes cancel each obsolete body; finishing them afterward
  // cannot replace the selected reserve or view.
  holdState=true;
  const heldRequest=page.waitForResponse(response=>response.url().includes('/api/state?reserve=20'));
  await page.locator('#reserve').selectOption('20');await heldRequest;
  holdState=false;
  await page.evaluate(()=>{const picker=document.querySelector('#reserve');picker.value='19';picker.dispatchEvent(new Event('change'));location.hash='home';});
  await page.waitForFunction(()=>document.body.dataset.view==='home'&&document.querySelector('#reserve').value==='19'&&document.querySelector('#connection').textContent==='Save tracking on');
  for(const response of held)if(!response.destroyed)response.end(JSON.stringify({...state,selectedReserve:20}).slice(1));held=[];
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#reserve').inputValue(),'19');
  assert.equal(await page.locator('body').getAttribute('data-view'),'home');
  checks.push('Rapid reserve/view changes keep current Home/reserve19 when obsolete reserve20 body finishes');
  await page.evaluate(()=>{location.hash='studio';});
  await page.locator('[data-design="title"]').fill('Synthetic unsaved trophy draft');
  await page.evaluate(()=>{window.__draftInput=document.querySelector('[data-design="title"]');window.__draftCanvas=document.querySelector('#studioCanvas');});
  state.career.summary.diamonds++;
  await page.waitForResponse(response=>response.url().includes('/api/state?reserve=19'));
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-design="title"]').inputValue(),'Synthetic unsaved trophy draft');
  assert.equal(await page.evaluate(()=>window.__draftInput===document.querySelector('[data-design="title"]')&&window.__draftCanvas===document.querySelector('#studioCanvas')&&document.activeElement===window.__draftInput),true);
  checks.push('Changed background state poll preserves focused trophy draft input, text and preview canvas');
 }
 release();await page.close();
 const startup=await browser.newPage();startup.on('pageerror',e=>errors.push(e.message));
 bootstrapError=true;
 await startup.goto(base+'/#home',{waitUntil:'domcontentloaded'});
 await startup.getByRole('heading',{name:'Connect to your companion'}).waitFor();
 const retry=await startup.locator('[data-action="bootstrap-retry"]').count();
 if(mode==='baseline'){
  assert.equal(retry,0);bootstrapError=false;await startup.waitForTimeout(5500);
  assert.equal(await startup.getByRole('heading',{name:'Connect to your companion'}).count(),1);
  checks.push('Baseline: bootstrap outage remains on an unrecoverable startup screen after backend recovers');
 }else{
  assert.equal(retry,1);bootstrapError=false;
  const bootBefore=requests.filter(r=>r.path==='/api/bootstrap').length;
  await startup.evaluate(()=>{const retry=document.querySelector('[data-action="bootstrap-retry"]');retry.click();retry.click();});
  await startup.waitForFunction(()=>document.querySelector('#connection')?.textContent==='Save tracking on');
  // Hosted state reads independently verify the pairing after startup bootstrap.
  assert.equal(requests.filter(r=>r.path==='/api/bootstrap').length,bootBefore+(hosted?2:1));
  checks.push('Startup retry obtains a fresh session and renders the app without a page reload');
  await startup.close();
  const timeoutPage=await browser.newPage();timeoutPage.on('pageerror',e=>errors.push(e.message));
  holdBootstrap=true;
  await timeoutPage.goto(base+'/#home',{waitUntil:'domcontentloaded'});
  await timeoutPage.getByRole('heading',{name:'Connect to your companion'}).waitFor({timeout:18000});
  assert.match(await timeoutPage.locator('#content').innerText(),/timed out/i);
  holdBootstrap=false;release();
  await timeoutPage.locator('[data-action="bootstrap-retry"]').click();
  await timeoutPage.waitForFunction(()=>document.querySelector('#connection')?.textContent==='Save tracking on');
  checks.push('Deadline covers a stalled JSON body; retry recovers afterward');
  const beforePoll=requests.filter(r=>r.path==='/api/state').length;
  await timeoutPage.waitForTimeout(5200);
  assert.equal(requests.filter(r=>r.path==='/api/state').length,beforePoll+1);
  checks.push('Repeated startup retry schedules a single five-second state poll');
 }
 assert.deepEqual(errors,[]);
 assert.ok(requests.every(r=>r.method==='GET'),'verification sends no save commands');
 checks.push('No unexpected command or other write requests');
 const sourceNames=['public/app.js',...(hosted?['cloud/phone-cache-client.mjs','public/phone-cache.js']:[])];
 const result={passed:true,mode,sourceFiles:Object.fromEntries(sourceNames.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')])),checks,errors,requests,scope:'Actual public/app.js and dependencies'+(hosted?' through exact hosted cache binding and /grindzone mount':'')+'; synthetic loopback HTTP only; no installed UI or owner data'};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,requests:requests.length}));
}catch(e){fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:false,mode,error:String(e.stack),checks,errors,requests},null,2));throw e;}
finally{release();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
