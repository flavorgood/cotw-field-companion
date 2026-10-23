/** Real browser polling check with a disposable local journal. Never uses owner data. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createApp} from '../server.mjs';
import {fixture,defs,zones as savedZones} from '../tests/fixtures.mjs';

const hostRoot=path.resolve(process.argv[2]||'.'),output=process.argv[3]&&path.resolve(process.argv[3]);
const {chromium}=createRequire(path.join(hostRoot,'package.json'))('playwright');
const root=mkdtempSync(path.join(tmpdir(),'grindzone-poll-continuity-')),save=path.join(root,'save');
mkdirSync(save);
writeFileSync(path.join(save,'found_need_zones_adf'),fixture(defs,'rootZones',savedZones));
writeFileSync(path.join(save,'reserveworlddata_adf'),fixture(defs,'rootReserve',{Reserve:19}));
const status={schema:'grindzone.updates.v1',managed:true,current:'a'.repeat(40),staged:null,policy:'Automatic updates enabled.',lastError:null};
const gate={blocked:false,request:async()=>({...status}),ready:()=>{}};
const proof={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks:[],passed:false};
let app,browser;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check,label)=>{for(let i=0;i<100;i++){if(await check())return;await sleep(100);}throw Error('Timed out: '+label);};
try{
 app=await createApp({managedGate:gate,dataDir:path.join(root,'journal'),saveDir:save,port:0,interval:200,phoneRelayUrl:null,feedbackUrl:null,githubFeedbackUrl:null});
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(app.url+'/#home',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#connection')?.textContent!=='Connecting…');
 await page.locator('.desktop-navigation .nav-group').last().locator('summary').click();
 await page.locator('.desktop-navigation [data-view="settings"]').click();
 await page.locator('.settings-details').waitFor();
 assert.equal(await page.locator('#content [data-state-loading]').count(),0,'Home to Settings uses immediate navigation rendering');
 await page.locator('gz-updates .panel').waitFor();
 await page.locator('#phoneAccess h2').waitFor();
 await page.waitForFunction(()=>document.querySelector('gz-updates')?.textContent.includes('Automatic updates enabled'));
 await page.evaluate(()=>{
  document.querySelector('.settings-details').open=true;
  const summary=document.querySelector('.settings-details summary');summary.focus();
  window.__pollNodes={settings:document.querySelector('.settings-details'),updates:document.querySelector('gz-updates'),updatePanel:document.querySelector('gz-updates .panel'),phone:document.querySelector('#phoneAccess'),summary};
 });
 await sleep(11200);
 const stable=await page.evaluate(()=>{
  const n=window.__pollNodes;
  return {settings:n.settings===document.querySelector('.settings-details'),updates:n.updates===document.querySelector('gz-updates'),updatePanel:n.updatePanel===document.querySelector('gz-updates .panel'),phone:n.phone===document.querySelector('#phoneAccess'),detailsOpen:n.settings.open,focus:document.activeElement===n.summary};
 });
 assert.deepEqual(stable,{settings:true,updates:true,updatePanel:true,phone:true,detailsOpen:true,focus:true});
 proof.checks.push('Home to Settings navigation and its first two unchanged 5-second state polls kept Settings, phone, update panel, open details, and focus intact');

 status.staged='b'.repeat(40);
 await page.evaluate(()=>document.querySelector('gz-updates').refresh());
 await page.waitForFunction(()=>document.querySelector('gz-updates')?.textContent.includes('Update ready for your next launch'));
 assert.equal(await page.evaluate(()=>window.__pollNodes.updates===document.querySelector('gz-updates')),true);
 proof.checks.push('A changed updater status became visible without replacing its custom element');

 const changedPhone=route=>route.fulfill({json:{available:true,enabled:false,status:'disabled',serviceHost:'relay.invalid',relayUrl:'https://relay.invalid'}});
 await page.route('**/api/phone/status',changedPhone);
 await page.waitForFunction(()=>document.querySelector('#phoneAccess')?.textContent.includes('relay.invalid'),null,{timeout:8000});
 assert.equal(await page.evaluate(()=>window.__pollNodes.phone===document.querySelector('#phoneAccess')),true);
 await page.unroute('**/api/phone/status',changedPhone);
 proof.checks.push('A changed phone-service status updated its panel without replacing the Settings page');

 let requests=0;
 const delay=async route=>{requests++;await sleep(6500);await route.continue();};
 await page.route('**/api/state?**',delay);
 await until(()=>requests===1,'first delayed state poll');
 await sleep(7600);
 assert.equal(requests,1,'an overlapping timer tick must not launch a forced follow-up fetch');
 await page.unroute('**/api/state?**',delay);
 proof.checks.push('A slow state response skipped the incidental overlapping timer tick instead of starting a forced fetch loop');

 const initialTerrain=await page.locator('#terrainSetting').isChecked();
 const boot=await fetch(app.url+'/api/bootstrap').then(response=>response.json());
 const command=body=>fetch(app.url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Companion-Token':boot.token},body:JSON.stringify({...body,requestId:randomUUID()})});
 const response=await command({op:'settings',terrain:!initialTerrain});
 assert.equal(response.ok,true,await response.text());
 await page.waitForFunction(expected=>document.querySelector('#terrainSetting')?.checked===expected,!initialTerrain,{timeout:12000});
 assert.equal(await page.evaluate(()=>window.__pollNodes.settings!==document.querySelector('.settings-details')),true);
 proof.checks.push('An actual Settings change rebuilt the affected view and updated the visible checkbox on the next state poll');

 const species=app.observer.state(19).zones.find(zone=>zone.source==='save')?.species;
 assert.ok(species,'synthetic discovered zone is available');
 await page.goto(app.url+'/#map',{waitUntil:'domcontentloaded'});
 const scoped=page.waitForResponse(response=>response.url().includes('/api/state?reserve=19&huntSpecies='+encodeURIComponent(species))&&response.ok());
 await page.locator('#filterSpecies').selectOption(species);
 await scoped;
 await page.waitForFunction(()=>!document.querySelector('#zoneListCount')?.textContent.includes('Loading')&&!!document.querySelector('#fieldMap g[data-zone]'));
 await sleep(5200);
 await page.locator('#fieldMap g[data-zone]').first().waitFor();
 await page.evaluate(()=>{window.__zoneMarker=document.querySelector('#fieldMap g[data-zone]');});
 const huntUrl=app.url+'/api/state?reserve=19&huntSpecies='+encodeURIComponent(species);
 const beforeHunt=await fetch(huntUrl).then(response=>response.json());
 const unrelated=await command({op:'encounter.create',reserve:19,species:'Synthetic observation'});
 assert.equal(unrelated.ok,true,unrelated.status);
 const encounter=await unrelated.json();
 const afterHunt=await fetch(huntUrl).then(response=>response.json());
 const changedMapFields=['reserves','zones','route','pins','equipment','huntingPressure','settings'].filter(key=>JSON.stringify(beforeHunt[key])!==JSON.stringify(afterHunt[key]));
 await page.waitForResponse(async response=>response.url().includes('/api/state?reserve=19&huntSpecies=')&&response.ok()&&(await response.json()).encounters.some(row=>row.id===encounter.id));
 await sleep(100);
 assert.equal(await page.evaluate(()=>window.__zoneMarker===document.querySelector('#fieldMap g[data-zone]')),true,'unrelated encounter must not rebuild the same zone marker; changed map fields: '+changedMapFields.join(', '));
 proof.checks.push('An unrelated encounter changed app state without replacing the Hunt SVG zone marker');
 const pin=await command({op:'pin.create',reserve:19,kind:'stand',label:'Synthetic stand',x:12810,z:7830});
 assert.equal(pin.ok,true,await pin.text());
 await page.locator('#fieldMap g[data-pin]').first().waitFor({timeout:12000});
 assert.equal(await page.evaluate(()=>window.__zoneMarker===document.querySelector('#fieldMap g[data-zone]')),false,'a real map input change must redraw markers');
 proof.checks.push('A new map pin still redraws the SVG and appears on the selected-species Hunt map');
 let disconnected=true;
 const warningState=async route=>{const response=await route.fetch(),body=await response.json();body.observer.connected=!disconnected;await route.fulfill({response,json:body});};
 await page.route('**/api/state?**',warningState);
 await page.waitForFunction(()=>document.querySelector('#huntNotice .callout')?.textContent.includes('disconnected'),null,{timeout:8000});
 await page.evaluate(()=>{window.__warningNode=document.querySelector('#huntNotice .callout');});
 await page.waitForResponse(response=>response.url().includes('/api/state?reserve=19&huntSpecies=')&&response.ok());
 await sleep(100);
 assert.equal(await page.evaluate(()=>window.__warningNode===document.querySelector('#huntNotice .callout')),true,'unchanged warning must keep the same DOM node');
 disconnected=false;
 await page.waitForFunction(()=>document.querySelector('#huntNotice')?.innerHTML==='',null,{timeout:8000});
 await page.unroute('**/api/state?**',warningState);
 proof.checks.push('An unchanged Hunt tracking warning kept its DOM node across polling, then disappeared when connection state recovered');
 const offline=await browser.newPage(),offlineErrors=[];
 offline.on('pageerror',error=>offlineErrors.push(error.message));
 await offline.route('**/api/state?**',route=>route.abort());
 await offline.goto(app.url+'/#home',{waitUntil:'domcontentloaded'});
 await offline.locator('#content h1').filter({hasText:'Companion unavailable'}).waitFor();
 await offline.evaluate(()=>{location.hash='settings';});
 await sleep(100);
 assert.deepEqual(offlineErrors,[],'changing views during a missing state must not throw');
 proof.checks.push('A view change while the state request is unavailable did not throw during reconnect');
 assert.deepEqual(errors,[]);
 proof.passed=true;
}catch(error){proof.error=String(error.stack||error);process.exitCode=1;}
finally{
 await browser?.close();await app?.close().catch(()=>{});
 assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(root).startsWith('grindzone-poll-continuity-'));
 for(let i=0;i<5;i++){
  try{rmSync(root,{recursive:true,force:true});break;}
  catch(error){if(i===4)proof.cleanupError=String(error);else await sleep(250);}
 }
 if(output)writeFileSync(output,JSON.stringify(proof,null,2));
 console.log('GRINDZONE_POLL_CONTINUITY '+JSON.stringify(proof));
}
