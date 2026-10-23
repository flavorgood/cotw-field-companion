/** Full Insights browser regression: synthetic HTTP state and actual herd ledger.
 * Set PLAYWRIGHT_MODULE/CHROMIUM_PATH to existing local dependencies when needed.
 * No production requests, installed-app control or customer data is used. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(process.argv[2]||fileURLToPath(new URL('..',import.meta.url))),mode=process.argv[3]||'candidate';
assert.ok(['baseline','candidate'].includes(mode));
const out=path.resolve(process.argv[4]||path.join(root,'evidence/insights-refresh',mode));fs.mkdirSync(out,{recursive:true});
const startedAt=new Date().toISOString();
const sourceFiles=Object.fromEntries(['public/app.js','public/herd-view.js','tools/verify-insights-refresh.mjs'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
const {insightsFixture}=await import(pathToFileURL(path.join(root,'tests/fixtures/insights-population.mjs')));
const {readHerdView,projectHerdView}=await import(pathToFileURL(path.join(root,'lib/herd-view.mjs')));
const {recordHerds}=await import(pathToFileURL(path.join(root,'lib/herd-ledger.mjs')));
const fixture=insightsFixture();let apiStatus=200,stateStatus=200,polls=0;
const state={app:{name:'GrindZone',startedAt:'synthetic-full-poll'},selectedReserve:19,reserves:[{id:19,name:'Synthetic reserve'},{id:20,name:'Other synthetic reserve'}],settings:{spoilers:true,terrain:false},career:{summary:{diamonds:123,greatOnes:4}},changes:[],careerChanges:[],population:[],zones:[],zoneLedgerVersion:1,zoneHistory:[],zoneTracking:{},zoneActivity:{},encounters:[],harvests:[],pins:[],equipment:[],route:[],sessions:[],observer:{connected:true,sources:[],intervalMs:5000}};
const requests=[],errors=[],checks=[];
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');requests.push({at:new Date().toISOString(),path:url.pathname,query:url.search});let body,status=200,type='application/json';try{
 if(url.pathname==='/api/bootstrap')body={token:'synthetic',selectedReserve:19,phone:{remote:false}};
 else if(url.pathname==='/api/state'){polls++;status=stateStatus;body=status===200?{...state,selectedReserve:Number(url.searchParams.get('reserve')||19)}:{error:'Synthetic PC unavailable'};}
 else if(url.pathname==='/api/herds'){status=apiStatus;body=status===200?projectHerdView(readHerdView(fixture.observer,Object.fromEntries(url.searchParams))):{error:'Synthetic access error'};}
 else {const rel=url.pathname==='/'?'index.html':url.pathname.slice(1);if(rel.includes('..'))throw Error('Invalid path');body=fs.readFileSync(path.join(root,'public',rel));type=rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream';}
 }catch(e){status=e.status||404;body={error:e.message};}res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(Buffer.isBuffer(body)?body:JSON.stringify(body));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const spec=process.env.PLAYWRIGHT_MODULE?pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright';
const {chromium}=await import(spec);let browser;
try{browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
 await page.goto('http://127.0.0.1:'+server.address().port+'/#insights');await page.locator('.gz-herd-card').first().waitFor();
 await page.locator('[data-herd-page="25"]').click();await page.waitForFunction(()=>document.querySelectorAll('.gz-herd-card').length===7);await page.evaluate(()=>window.proofNode=document.querySelector('gz-herds'));const beforePoll=polls;
 state.encounters.push({id:'synthetic-unrelated',species:'Synthetic observation'});state.career.summary.diamonds=124;state.changes=[{at:'2026-10-01T00:00:00Z',boundary:'synthetic_change_notice'}];
 await page.waitForFunction(()=>document.querySelector('.gz-herd-lifetime')?.textContent.includes('124'),{},{timeout:12000});
 const observation=await page.evaluate(()=>({sameNode:window.proofNode===document.querySelector('gz-herds'),cards:document.querySelectorAll('.gz-herd-card').length,pagination:document.querySelector('.gz-herd-pages')?.innerText,notice:document.querySelector('#content').textContent.includes('synthetic change notice')}));
 await page.screenshot({path:path.join(out,'after-unrelated-poll.png')});checks.push({name:'unrelated polling',beforePoll,polls,...observation});
 if(mode==='baseline'){assert.equal(observation.sameNode,false);await page.waitForFunction(()=>document.querySelectorAll('.gz-herd-card').length===25);checks.push({name:'baseline failure reproduced',resetPageCards:25});}
 else {assert.equal(observation.sameNode,true);assert.equal(observation.cards,7);assert.equal(observation.notice,true);
 fixture.source.payload.populations[0].groups[0].animals.push(fixture.animal());fixture.source.sha='b'.repeat(64);fixture.source.mtime='2026-10-01T00:01:00Z';recordHerds(fixture.store,fixture.profile,19,fixture.source);
 await page.waitForFunction(()=>document.querySelector('[data-population-species="fixture_deer"] [data-label="Animals"]')?.textContent==='61',{},{timeout:15000});checks.push({name:'component poll picks up changed actual population ledger revision and restarts stale page'});
 fixture.metadata.status='error';await page.getByText('Population refresh unavailable. Showing the last readable herd snapshot.',{exact:false}).waitFor({timeout:15000});checks.push({name:'component poll labels stale source'});fixture.metadata.status='ok';
 apiStatus=403;await page.locator('[data-herd-retry]').click();await page.getByText('This phone no longer has access. Reopen the current paired companion.',{exact:false}).waitFor();assert.equal(await page.locator('[data-population-species]').count(),0);checks.push({name:'revoked access clears counts'});apiStatus=200;await page.locator('[data-herd-retry]').click();await page.locator('.gz-herd-card').first().waitFor();
 stateStatus=503;apiStatus=503;await page.getByText('The PC is unavailable. Reconnect to load herd history.',{exact:false}).waitFor({timeout:15000});assert.equal(await page.locator('[data-population-species]').count(),0);checks.push({name:'disconnection clears counts and labels unavailable'});stateStatus=200;apiStatus=200;await page.locator('.gz-herd-card').first().waitFor({timeout:15000});checks.push({name:'reconnect recovers population'});
 state.settings.spoilers=false;fixture.store.set('settings:'+fixture.profile,{spoilers:false});await page.waitForFunction(()=>!document.querySelector('gz-herds'),{},{timeout:12000});assert.equal(await page.locator('[data-population-species]').count(),0);checks.push({name:'spoilers off hides all counts'});
 state.settings.spoilers=true;fixture.store.set('settings:'+fixture.profile,{spoilers:true});await page.locator('.gz-herd-card').first().waitFor({timeout:12000});await page.locator('#reserve').selectOption('20');await page.getByText('No matching readable herd snapshot is available yet.',{exact:false}).waitFor();assert.equal(await page.locator('[data-population-species]').count(),0);checks.push({name:'reserve switch scopes response'});
 }assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,mode,root,startedAt,finishedAt:new Date().toISOString(),sourceFiles,checks,errors,requests,scope:'Actual complete public/app.js and dependencies, actual backend herd query/projection, synthetic HTTP state and in-memory ledger. No installed app, owner data or production access.'},null,2));console.log(JSON.stringify({passed:true,mode,checks}));
}catch(e){fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:false,error:String(e),checks,errors,requests},null,2));throw e;}finally{await browser?.close();await new Promise(r=>server.close(r));}
