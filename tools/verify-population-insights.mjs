/** Bounded browser fixture: exact Insights renderer + herd custom element + actual backend projection.
 * No owner saves, installed-app acceptance, managed accounts or production deployment is implied.
 * Install Playwright separately, or set PLAYWRIGHT_MODULE to its module path. */
import http from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {insightsFixture} from '../tests/fixtures/insights-population.mjs';
import {readHerdView,projectHerdView} from '../lib/herd-view.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=path.resolve(process.argv[2]||path.join(root,'evidence/insights-browser'));mkdirSync(evidence,{recursive:true});
const source=readFileSync(path.join(root,'public/app.js'),'utf8');
const renderer=source.slice(source.indexOf('function insights(){'),source.indexOf('\nfunction settings(){'));
assert.ok(renderer.includes('herdWorkspaceView(state,{reserve,overview:true})'));
const fixture=insightsFixture();let apiStatus=200;
const state={app:{name:'GrindZone',startedAt:'fixture'},settings:{spoilers:true,terrain:false},career:{summary:{diamonds:123,greatOnes:4}},changes:[]};
const bootstrap=`import {herdWorkspaceView} from './herd-view.js';const state=${JSON.stringify(state)};let reserve=19;const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const date=v=>String(v);const intro=(k,t,d)=>'<h1>'+esc(t)+'</h1>';const empty=(t)=>'<p>'+esc(t)+'</p>';const button=()=>'';${renderer};window.fixtureRender=(spoilers=true,rid=19)=>{state.settings.spoilers=spoilers;reserve=rid;document.querySelector('#content').innerHTML=insights();};window.fixtureRender();`;
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px system-ui;background:#101813;color:#eff4eb}*{box-sizing:border-box}#content{max-width:1150px;margin:auto;padding:12px}.species-accessible-cue{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}</style></head><body><main id="content"></main><script type="module" src="/fixture.js"></script></body></html>';
const allowed=new Set(['herd-view.js','herd-view.css','species-style.js']);
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let status=200,body,type='text/html';
 try{
  if(url.pathname==='/api/herds'){
   if(apiStatus!==200){status=apiStatus;body=JSON.stringify({error:'Synthetic revoked access'});}
   else body=JSON.stringify(projectHerdView(readHerdView(fixture.observer,Object.fromEntries(url.searchParams))));type='application/json';
  }else if(url.pathname==='/')body=html;
  else if(url.pathname==='/fixture.js'){body=bootstrap;type='text/javascript';}
  else if(allowed.has(url.pathname.slice(1))){body=readFileSync(path.join(root,'public',url.pathname.slice(1)));type=url.pathname.endsWith('.css')?'text/css':'text/javascript';}
  else{status=404;body='Not found';}
 }catch(error){status=error.status||500;body=JSON.stringify({error:error.message});type='application/json';}
 res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'"});res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const checks=[],shots=[],startedAt=new Date().toISOString();
try{
 const spec=process.env.PLAYWRIGHT_MODULE?pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright';
 const {chromium}=await import(spec);browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/#insights');
 await page.locator('[data-population-species="fixture_deer"]').waitFor();
 const deer=page.locator('[data-population-species="fixture_deer"]');
 assert.equal(await deer.locator('[data-label="Diamond potential"]').innerText(),'30');
 assert.equal(await deer.locator('[data-label="Animals"]').innerText(),'60');
 assert.equal(await deer.locator('[data-label="Herds"]').innerText(),'30');
 assert.equal(await page.locator('.gz-herd-card').count(),25);checks.push('Full 32-herd summary with 30 Deer Diamonds while only 25 herd cards render.');
 assert.equal(await page.locator('[data-population-species="fixture_duck"] .female-diamond-mark').count(),1);checks.push('Female capability marker is visible next to Test Duck.');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(50);
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,table:document.querySelector('.gz-population-table').getBoundingClientRect().width}));
  assert.ok(geometry.scroll<=width,JSON.stringify(geometry));assert.ok(geometry.table>=200);
  const file=path.join(evidence,'insights-'+width+'.png');await page.screenshot({path:file,fullPage:false});shots.push(file);checks.push('No page overflow at '+width+'px.');
 }
 await page.setViewportSize({width:1440,height:1000});await page.locator('[data-herd-page="25"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('.gz-herd-card').length===7);assert.equal(await deer.locator('[data-label="Diamond potential"]').innerText(),'30');checks.push('Pagination does not truncate or change species totals.');
 await page.locator('[data-herd-species="fixture_duck"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('.gz-herd-card').length===1);assert.equal(await page.locator('[data-population-species]').count(),1);
 assert.equal(await page.locator('[data-herd-filter="species"]').inputValue(),'fixture_duck');checks.push('Species selection filters both totals and herd details.');
 await page.locator('[data-herd-filter="species"]').selectOption('all');await page.waitForFunction(()=>document.querySelectorAll('[data-population-species]').length===3);
 fixture.metadata.status='error';await page.locator('[data-herd-retry]').click();await page.getByText('Population refresh unavailable. Showing the last readable herd snapshot.').waitFor();checks.push('Read failure labels last readable population as stale.');
 apiStatus=403;await page.locator('[data-herd-retry]').click();await page.getByText('This phone no longer has access. Reopen the current paired companion.').waitFor();assert.equal(await page.locator('[data-population-species]').count(),0);checks.push('Revoked access clears population results.');apiStatus=200;
 fixture.metadata.status='ok';await page.evaluate(()=>window.fixtureRender(false));assert.equal(await page.locator('gz-herds').count(),0);checks.push('Spoilers off removes the entire private herd component.');
 await page.evaluate(()=>window.fixtureRender(true,20));await page.getByText('No matching readable herd snapshot is available yet.',{exact:false}).waitFor();assert.equal(await page.locator('[data-population-species]').count(),0);checks.push('Reserve change cannot retain previous population results.');
 writeFileSync(path.join(evidence,'result.json'),JSON.stringify({passed:true,startedAt,finishedAt:new Date().toISOString(),checks,shots,scope:'Synthetic browser fixture using the exact extracted Insights function, production custom element/CSS, actual ledger/classifier/query/projection, and an in-memory test store. Not a full installed-app, SQLite, physical-phone or live-host test.',sourceFiles:Object.fromEntries(['public/app.js','public/herd-view.js','public/herd-view.css','lib/herd-trophies.mjs','lib/herd-view.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex')]))},null,2));
 console.log(JSON.stringify({passed:true,checks},null,2));
}catch(error){writeFileSync(path.join(evidence,'result.json'),JSON.stringify({passed:false,startedAt,error:String(error),checks,shots},null,2));throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
