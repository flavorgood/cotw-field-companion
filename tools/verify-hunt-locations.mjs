/** Actual app, journal, phone relay and canonical FieldMap. All game data is disposable and synthetic. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createApp} from '../server.mjs';
import {createActivatedPhoneRelay} from '../cloud/activation-server.mjs';
import {writeSaveDataFixture,saveHashes} from '../tests/save-data-workflow-fixture.mjs';
import {readyDiscoveryReader} from '../tests/zone-discovery-fixture.mjs';
import {makeHarvest,harvest} from '../tests/fixtures.mjs';
const hostRoot=path.resolve(process.argv[2]||'.'),mode=process.argv[3]||'local',output=path.resolve(process.argv[4]||'phone-acceptance');
assert.ok(['local','live'].includes(mode));
const require=createRequire(path.join(hostRoot,'package.json')),{chromium}=require('playwright');
const root=mkdtempSync(path.join(tmpdir(),'grindzone-location-browser-')),save=path.join(root,'save');mkdirSync(save);writeSaveDataFixture(save);
const proof={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),at:new Date().toISOString(),mode,passed:false,checks:[],viewports:[],fixture:'Actual application and canonical FieldMap with generated binary saves, synthetic journal observations, real SQLite and signed phone pairing',physicalPhoneVerified:false,windowsLaunchVerified:false,automaticExactKillGpsVerified:false};
let app,relay,browser;const errors=[],secrets=[];
const until=async(fn,label)=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);};
// FieldMap has invisible click targets and visible marker groups with the same data-pin.
// Assert the visible group, its exact world coordinates and its actual rendered geometry.
const verifyMarker=async(page,x,z)=>{
 const marker=page.locator('.gz-location-map svg g[data-pin]');
 assert.equal(await marker.count(),1);
 assert.equal(await marker.isVisible(),true);
 assert.equal(Number(await marker.getAttribute('data-world-x')),x);
 assert.equal(Number(await marker.getAttribute('data-world-z')),z);
 assert.equal(await marker.getAttribute('role'),'button');
 assert.equal(await marker.locator(':scope > path').count(),1);
 const box=await marker.boundingBox();assert(box&&box.width>0&&box.height>0,'Visible marker must have rendered geometry');
 const canvas=await page.locator('.gz-location-map > svg').boundingBox();
 const frame=await page.locator('.gz-location-map').boundingBox();
 assert(canvas&&frame&&canvas.height>=250&&canvas.width>=200,'Recorded map must be usable, not shrunk to a toolbar icon');
 assert(canvas.width>=frame.width-4,'Recorded map must fill the available map panel');
};
const read=async(page,query='')=>page.evaluate(async query=>{const r=await fetch(new URL('api/locations'+(query?'?'+query:''),location.href),{cache:'no-store'});return {status:r.status,data:await r.json()};},query);
try{
 if(mode==='local')relay=await createActivatedPhoneRelay({key:randomBytes(32),publicOrigin:'http://127.0.0.1:0/grindzone',allowInsecureLoopback:true});
 const base=relay?.origin||'https://sway-tips.onrender.com/grindzone';proof.relay=base;
 assert.equal((await fetch(base+'/api/locations')).status,401);
 app=await createApp({dataDir:path.join(root,'journal'),saveDir:save,port:0,interval:250,phoneRelayUrl:base,phoneEnrollmentToken:null,allowInsecurePhoneLoopback:mode==='local',feedbackUrl:null,feedbackOwnerToken:null,githubFeedbackUrl:null});
 app.observer.zoneReference.close();app.observer.zoneReference=readyDiscoveryReader();
 const command=body=>app.observer.command(body);
 command({op:'settings',terrain:false});
 const grind=command({op:'session.start',reserve:19,name:'Synthetic location acceptance',targetSpecies:'Whitetail Deer',goal:20});
 const zone=app.observer.state(19).zones[0];
 command({op:'zone.track',reserve:19,zoneId:zone.id,expectedVersion:0});
 await new Promise(r=>setTimeout(r,1100));
 const encounter=command({op:'encounter.create',reserve:19,species:'Whitetail Deer',x:zone.x+10,z:zone.z+10});
 const dead=command({op:'encounter.evidence',id:encounter.id,version:encounter.version,type:'dead_observed',x:zone.x+20,z:zone.z+20});
 const timestamp=Math.floor(Date.now()/1000),rows=[harvest(timestamp,220),harvest(timestamp,230)];
 writeFileSync(path.join(save,'hunting_log_adf'),makeHarvest(rows));
 await until(()=>app.store.harvests(app.observer.profile).length===2,'automatic saved-harvest import');
 const receipt=app.store.harvests(app.observer.profile).find(h=>h.score===220);
 command({op:'encounter.evidence',id:encounter.id,version:dead.version,type:'harvest_linked',harvestId:receipt.id,sameAnimal:true,x:zone.x+30,z:zone.z+30});
 const expected=saveHashes(save),state=app.observer.locationHistory({session:grind.id});
 assert.equal(state.summary.total,4);assert.equal(state.summary.reportedPoints,3);assert.equal(state.summary.selectedZones,1);
 assert.equal(state.events.find(e=>e.kind==='shot').location.x,zone.x+10);
 assert.equal(state.events.find(e=>e.kind==='death').location.x,zone.x+20);
 assert.equal(state.events.find(e=>e.harvestId===receipt.id).location.x,zone.x+30);
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const pc=await browser.newPage({viewport:{width:1440,height:1000}});pc.on('pageerror',e=>errors.push(e.message));
 await pc.goto(app.url+'/#grinds',{waitUntil:'domcontentloaded'});await pc.locator('gz-hunt-locations [data-location-event]').first().waitFor();
 assert.equal(await pc.locator('gz-hunt-locations').getAttribute('data-session'),grind.id);
 assert.equal(await pc.locator('[data-location-event]').count(),4);
 await pc.locator('[data-location-kind="death"]').click();await until(async()=>await pc.locator('[data-location-event]').count()===1,'death filter');
 assert.match(await pc.locator('[data-location-event]').innerText(),/Death reported/);
 await pc.locator('[data-location-show]').click();await until(()=>pc.locator('.gz-location-map svg g[data-pin]').count().then(n=>n===1),'canonical death marker');
 const rendered=await pc.locator('gz-hunt-locations').evaluate(e=>e.map.data.pins.map(p=>({x:p.x,z:p.z})));
 assert.deepEqual(rendered,[{x:zone.x+20,z:zone.z+20}]);
 await verifyMarker(pc,zone.x+20,zone.z+20);
 proof.checks.push('Existing grind screen loads its own durable events; shot/death/pickup coordinates remain distinct and the real FieldMap renders the selected death point.');
 await pc.goto(app.url+'/#settings',{waitUntil:'domcontentloaded'});await pc.locator('[data-action="phone-enable"]').click();await pc.locator('#modal input[name="consent"]').check();await pc.locator('#submitDialog').click();await pc.locator('[data-phone-link]').waitFor({timeout:30000});
 const pair=await pc.locator('[data-phone-link]').inputValue();secrets.push(new URL(pair).hash.slice(6));
 const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});phone.on('pageerror',e=>errors.push(e.message));
 await phone.goto(pair,{waitUntil:'domcontentloaded'});await phone.locator('#pair').click();await phone.waitForURL(url=>url.hash==='#map');
 await phone.goto(base+'/#grinds',{waitUntil:'domcontentloaded'});await phone.locator('[data-location-event]').first().waitFor();
 let response=await read(phone,'session='+grind.id);assert.equal(response.status,200);assert.equal(response.data.summary.total,4);assert.equal(response.data.summary.reportedPoints,3);
 const privateRead=await read(phone,'profile=another-player');assert.equal(privateRead.status,400);
 assert.equal((await read(phone,'reserve=1&reserve=19')).status,400);
 for(const width of [390,320]){
  await phone.setViewportSize({width,height:844});assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);proof.viewports.push({width,overflow:false});
 }
 await phone.setViewportSize({width:390,height:844});
 await phone.locator('[data-location-filter="precision"]').selectOption('zone');await until(async()=>await phone.locator('[data-location-event]').count()===1,'selected-zone filter');
 assert.match(await phone.locator('[data-location-event]').innerText(),/Player-selected zone · not exact GPS/);
 await phone.locator('[data-location-show]').click();await until(()=>phone.locator('.gz-location-map svg g[data-pin]').count().then(n=>n===1),'phone selected-zone marker');
 assert.equal(await phone.locator('gz-hunt-locations').evaluate(e=>e.map.data.pins[0].x),zone.x);
 await verifyMarker(phone,zone.x,zone.z);
 await phone.reload({waitUntil:'domcontentloaded'});await phone.locator('[data-location-event]').first().waitFor();
 // Reload does not persist private filter state to disk; filters survive ordinary parent rerenders below.
 await phone.locator('[data-location-kind="death"]').click();await until(async()=>await phone.locator('[data-location-event]').count()===1,'phone death filter');
 await phone.evaluate(()=>{const old=document.querySelector('gz-hunt-locations'),next=old.cloneNode(false);old.replaceWith(next);});
 await until(async()=>await phone.locator('[data-location-event]').count()===1,'parent rerender restores filter');
 assert.equal(await phone.locator('[data-location-kind="death"]').getAttribute('aria-pressed'),'true');
 proof.checks.push('Signed phone reads use the same filtered history, reject caller profile injection and duplicate filters, distinguish selected-zone references, fit 320/390px, and preserve filters across parent rerenders.');
 const profile=app.observer.profile;
 // The page-size fixture must fall inside the current tracking period. Keep a
 // separate older receipt to prove retained journal data does not leak to phone locations.
 const historic=Array.from({length:620},(_,i)=>({id:'in-grind-location-'+i,timestamp,speciesHash:'1124598738',score:100,origin:'baseline'}));
 const preGrindReceipt={id:'pre-grind-location',timestamp:timestamp-100000,speciesHash:'1124598738',score:100,origin:'baseline'};
 app.store.importHarvests(profile,null,[...historic,preGrindReceipt]);
 const original=app.store.harvests(profile).find(h=>h.recordId==='in-grind-location-619');
 const preGrind=app.store.harvests(profile).find(h=>h.recordId===preGrindReceipt.id);
 const snapshot={id:zone.id,reserve:19,x:zone.x,z:zone.z,name:'Captured zone',source:'save',capturedAt:new Date().toISOString()};
 app.store.put(profile,'harvestZones',{id:'in-grind-location-link',harvestId:original.id,zoneId:zone.id,reserve:19,basis:'player_selected_zone',snapshot});
 app.store.put(profile,'harvestZones',{id:'pre-grind-location-link',harvestId:preGrind.id,zoneId:zone.id,reserve:19,basis:'player_selected_zone',snapshot});
 response=await read(phone,'precision=zone&kind=harvest');assert.equal(response.status,200);assert(response.data.events.some(e=>e.harvestId===original.id));assert.equal(response.data.events.some(e=>e.harvestId===preGrind.id),false);
 const page1=(await read(phone,'limit=50')).data,page2=(await read(phone,'limit=50&offset=50&revision='+page1.revision)).data;
 assert(page1.summary.total>500);assert.equal(page2.events.some(e=>page1.events.some(a=>a.id===e.id)),false);
 assert.equal((await read(phone,'session='+grind.id)).data.summary.total,624);
 assert.deepEqual(saveHashes(save),expected);
 const exported=app.store.exportJournal(profile);assert(exported.harvestZones.some(a=>a.harvestId===preGrind.id&&a.snapshot));assert(exported.harvests.some(h=>h.id===preGrind.id));assert(exported.encounterZones.some(a=>a.snapshot));
 proof.checks.push('In-grind attributed receipts beyond the ordinary 500-record state window remain queryable; pages do not repeat records, pre-grind receipts stay off phone locations, and explicit journal exports retain their records and attribution snapshots.');
 await phone.locator('[data-location-show]').click();await until(()=>phone.locator('.gz-location-map svg g[data-pin]').count().then(n=>n===1),'final death map');
 await verifyMarker(phone,zone.x+20,zone.z+20);
 mkdirSync(output,{recursive:true});await phone.locator('.gz-location-map').scrollIntoViewIfNeeded();await phone.screenshot({path:path.join(output,mode+'-locations.png'),fullPage:false});
 assert.deepEqual(errors,[]);
 await app.phone.disable();
 await phone.locator('[data-location-refresh]').click();await until(async()=>await phone.locator('[data-location-event]').count()===0,'revoked phone clears locations');
 assert.equal((await fetch(base+'/api/locations')).status,401);
 proof.checks.push('Disabling the PC connection clears the new phone location view; anonymous access remains denied; no unhandled browser errors or source-save writes occurred.');
 proof.passed=true;
}catch(error){let message=String(error.stack||error);for(const secret of secrets)message=message.split(secret).join('[redacted]');proof.error=message.replace(/pair=[A-Za-z0-9_-]{43}/g,'pair=[redacted]');process.exitCode=1;}
finally{await browser?.close();await app?.close().catch(()=>{});await relay?.close();rmSync(root,{recursive:true,force:true});proof.finishedAt=new Date().toISOString();mkdirSync(output,{recursive:true});writeFileSync(path.join(output,mode+'-locations.json'),JSON.stringify(proof,null,2));console.log('GRINDZONE_HUNT_LOCATIONS '+JSON.stringify(proof));}
