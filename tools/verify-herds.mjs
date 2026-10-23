/** Real app, SQLite, canonical map and signed phone relay; generated game saves, never owner data. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createApp} from '../server.mjs';
import {createActivatedPhoneRelay} from '../cloud/activation-server.mjs';
import {writeSaveDataFixture,saveHashes} from '../tests/save-data-workflow-fixture.mjs';
import {fixture,defs,animal} from '../tests/fixtures.mjs';
import {readyDiscoveryReader} from '../tests/zone-discovery-fixture.mjs';
import {findHerdRule} from '../lib/herd-trophies.mjs';
const hostRoot=path.resolve(process.argv[2]||'.'),mode=process.argv[3]||'local',output=path.resolve(process.argv[4]||'phone-acceptance');assert(['local','live'].includes(mode));
const require=createRequire(path.join(hostRoot,'package.json')),{chromium}=require('playwright');
const root=mkdtempSync(path.join(tmpdir(),'grindzone-herds-browser-')),save=path.join(root,'save');mkdirSync(save);writeSaveDataFixture(save);
const proof={at:new Date().toISOString(),source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode,passed:false,checks:[],viewports:[],physicalPhoneVerified:false,windowsLaunchVerified:false,realPlayerSaveVerified:false,fixture:'Actual app, binary decoder, SQLite, canonical FieldMap and signed relay. Synthetic animals and zones; trophy metadata generated from pinned public source.'};
let relay,app,browser;const errors=[],secrets=[];
const until=async(fn,label)=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);};
const read=(page,query='reserve=19')=>page.evaluate(async query=>{const r=await fetch(new URL('api/herds?'+query,location.href),{cache:'no-store'});return {status:r.status,data:await r.json()};},query);
const open=async base=>{const result=await createApp({dataDir:path.join(root,'journal'),saveDir:save,port:0,interval:250,phoneRelayUrl:base,phoneEnrollmentToken:null,allowInsecurePhoneLoopback:mode==='local',feedbackUrl:null,feedbackOwnerToken:null,githubFeedbackUrl:null});result.observer.zoneReference.close();result.observer.zoneReference=readyDiscoveryReader();return result;};
try{
 if(mode==='local')relay=await createActivatedPhoneRelay({key:randomBytes(32),publicOrigin:'http://127.0.0.1:0/grindzone',allowInsecureLoopback:true});
 const base=relay?.origin||'https://sway-tips.onrender.com/grindzone';proof.relay=base;assert.equal((await fetch(base+'/api/herds')).status,401);app=await open(base);
 const reference=app.observer.herdReference;assert.equal(reference?.source?.blob,'4f531a152ad254633832e76cee54c7e25cd0abbc','Use the pinned real reference, never a fixture trophy table');
 const female=Object.entries(app.observer.reference.populations).find(([,s])=>findHerdRule(reference,s.key)?.femaleDiamondCapable===true);assert(female,'Female-capable mapped species required');
 const [femaleHash,femaleSpecies]=female,femaleRule=findHerdRule(reference,femaleSpecies.key),whitetail=app.observer.reference.populations['3845994887'],deerRule=findHerdRule(reference,whitetail.key);assert(deerRule);
 proof.reference={commit:reference.source.commit,blob:reference.source.blob,femaleExample:femaleSpecies.key};
 const herdDefs={...defs,animal:{...defs.animal,Id:'u32',IsGreatOne:'u8'}};
 const a=(id,sex,score,go=0)=>({...animal(id,sex),Id:id,Score:score,IsGreatOne:go});
 const group=(members,paths=[101,102,103],area=100)=>({SpawnAreadId:area,NeedZonePathGuids:paths,Animals:members});
 let deerGroups=[group([a(101,1,deerRule.diamondScore+1),a(102,2,0)]),group([a(103,1,deerRule.diamondScore+10,1)])];
 const writePopulation=(time)=>{const value={ReserveSeed:123,Populations:[{NameHashId:3845994887,Revision:1,Groups:deerGroups},{NameHashId:Number(femaleHash),Revision:1,Groups:[group([a(201,2,femaleRule.diamondScore+1)],[201,202,203],200)]}]};const f=path.join(save,'animal_population_19');writeFileSync(f,fixture(herdDefs,'rootPopulation',value));utimesSync(f,new Date(time),new Date(time));};
 const zone=(id,slot,localization)=>({Position:{X:8000+id,Y:0,Z:8100},NeedZoneId:id,NeedType:slot+1,NeedZoneStartTimeHours:slot*8,NeedZoneEndTimeHours:((slot+1)*8)%24,AnimalTypeLocalizationName:localization,NeedZoneScheduleIndex:slot});
 writeFileSync(path.join(save,'found_need_zones_adf'),fixture(defs,'rootZones',{NZData:[{ReserveId:19,NeedZoneData:[...Array.from({length:3},(_,i)=>zone(101+i,i,1124598738)),...Array.from({length:3},(_,i)=>zone(201+i,i,987654))]}]}));
 writePopulation('2026-09-21T12:00:00Z');let expected=saveHashes(save);await until(()=>!app.observer.busy,'initial reader idle');await app.observer.scan(true);
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const pc=await browser.newPage({viewport:{width:1440,height:1000}});pc.on('pageerror',e=>errors.push(e.message));
 await pc.goto(app.url+'/#harvests',{waitUntil:'domcontentloaded'});await pc.locator('gz-herds').waitFor();await until(async()=>/Enable population spoilers/.test(await pc.locator('gz-herds').innerText()),'spoiler notice');assert.equal((await read(pc)).data.status,'spoilers_off');
 await pc.goto(app.url+'/#settings');await pc.locator('#spoilerSetting').click();await pc.locator('#modal input[name="consent"]').check();await pc.locator('#submitDialog').click();
 await pc.goto(app.url+'/#harvests');await pc.locator('[data-herd-id]').first().waitFor();let result=(await read(pc)).data;
 assert.equal(result.summary.herds,3);assert.equal(result.summary.diamonds,2);assert.equal(result.summary.greatOnes,1);const ids=result.herds.map(h=>h.id);assert.equal(new Set(ids).size,3);
 const zoneFacet=result.facets.zones.find(z=>z.id==='saved:19:102:1');assert.equal(zoneFacet.herds.length,2);assert.equal(result.herds.find(h=>h.speciesKey===femaleSpecies.key).counts.femaleDiamondCapable,true);
 assert.equal(await pc.locator(`.gz-herd-card .female-diamond-mark`).count(),1);const firstDeer=result.herds.find(h=>h.speciesKey===whitetail.key);
 await pc.locator(`[data-herd-map="${firstDeer.id}"]`).click();await until(()=>pc.locator('gz-herds').evaluate(e=>!!e.map&&e.map.data.zones.length===3),'canonical herd map');
 assert.deepEqual(new Set(await pc.locator('gz-herds').evaluate(e=>e.map.data.zones.map(z=>z.need))),new Set(['feeding','drinking','resting']));
 proof.checks.push('Actual PC shows stable unique herd labels, both trophy categories and source-backed female marker; a shared zone links two herds and FieldMap shows all three assigned activity types.');
 await pc.goto(app.url+'/#settings');await pc.locator('[data-action="phone-enable"]').click();await pc.locator('#modal input[name="consent"]').check();await pc.locator('#submitDialog').click();await pc.locator('[data-phone-link]').waitFor({timeout:30000});const pair=await pc.locator('[data-phone-link]').inputValue();secrets.push(new URL(pair).hash.slice(6));
 const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});phone.on('pageerror',e=>errors.push(e.message));await phone.goto(pair);await phone.locator('#pair').click();await phone.waitForURL(u=>u.hash==='#map');await phone.goto(base+'/#harvests');await phone.locator('[data-herd-id]').first().waitFor();
 assert.deepEqual((await read(phone)).data.herds.map(h=>h.id),ids);assert.equal((await read(phone,'profile=another')).status,400);
 await phone.locator('[data-herd-filter="zone"]').selectOption('saved:19:102:1');await until(async()=>await phone.locator('[data-herd-id]').count()===2,'zone-to-herds filter');
 for(const width of [390,320]){await phone.setViewportSize({width,height:844});assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);proof.viewports.push({width,overflow:false});}
 await phone.setViewportSize({width:390,height:844});await phone.locator('[data-herd-filter="zone"]').selectOption('all');await phone.locator('[data-herd-filter="trophy"]').selectOption('female_diamond');await until(async()=>await phone.locator('[data-herd-id]').count()===1,'female-capable filter');assert.equal(await phone.locator('.gz-herd-card .female-diamond-mark').count(),1);
 await phone.locator('[data-herd-filter="trophy"]').selectOption('all');await until(async()=>await phone.locator('[data-herd-id]').count()===3,'all herds restored');
 deerGroups=[deerGroups[1],{...deerGroups[0],Animals:[...deerGroups[0].Animals].reverse()}];writePopulation('2026-09-21T12:01:00Z');expected=saveHashes(save);await until(async()=>{const v=(await read(phone)).data;return v.savedAt==='2026-09-21T12:01:00.000Z';},'automatic population update');assert.deepEqual((await read(phone)).data.herds.map(h=>h.id),ids);assert.deepEqual(saveHashes(save),expected);
 proof.checks.push('Signed phone uses the same IDs and counts, rejects caller profile selection, filters both zone-to-herds and female-capable species, fits 320/390px and retains identities after binary group/member reordering.');


 // Check the owner's actual Insights route under the complete PC and signed-phone app shell.
 proof.insightsLayouts=[];
 for(const [page,width] of [[pc,1440],[phone,390],[phone,320]]){
  await page.setViewportSize({width,height:width===1440?1000:844});
  await page.goto((page===pc?app.url:base)+'/#insights',{waitUntil:'domcontentloaded'});
  await page.locator('[data-population-species]').first().waitFor();
  assert.equal(await page.locator('[data-population-species]').count(),2);
  const deer=page.locator(`[data-population-species="${whitetail.key}"]`);
  assert.equal(await deer.locator('[data-label="Herds"]').innerText(),'2');
  assert.equal(await deer.locator('[data-label="Animals"]').innerText(),'3');
  assert.equal(await deer.locator('[data-label="Diamond potential"]').innerText(),'1');
  assert.equal(await deer.locator('[data-label="Saved Great Ones"]').innerText(),'1');
  const females=page.locator(`[data-population-species="${femaleSpecies.key}"]`);
  assert.equal(await females.locator('[data-label="Diamond potential"]').innerText(),'1');
  assert.equal(await females.locator('.female-diamond-mark').count(),1);
  const layout=await page.locator('.gz-population-table').evaluate(table=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,tableWidth:table.getBoundingClientRect().width}));
  assert.ok(layout.scrollWidth<=layout.width+1,'Insights must fit '+width+'px');
  assert.ok(layout.tableWidth>=200,'Insights trophy table must remain readable');proof.insightsLayouts.push(layout);
  if(width===390){mkdirSync(output,{recursive:true});await page.locator('.gz-population-overview').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,mode+'-insights.png'),fullPage:false});}
 }
 proof.insightsVerified=true;
 proof.checks.push('Actual #insights on PC and signed phone shows per-species Diamond potential, separate saved Great Ones, real herd/animal counts and female eligibility at 1440/390/320px without page overflow.');

 // Exercise the real grind shell as well as Harvests: generic toolbar SVG rules and
 // display:contents placement previously hid usable maps and pushed recent results down.
 app.observer.command({op:'session.start',reserve:19,name:'Herd workflow verification',targetSpecies:whitetail.name,goal:10});
 proof.grindLayouts=[];
 for(const [page,width] of [[pc,1440],[phone,390],[phone,320]]){
  await page.setViewportSize({width,height:width===1440?1000:844});
  await page.goto((page===pc?app.url:base)+'/#grinds',{waitUntil:'domcontentloaded'});
  await page.locator('[data-herd-id]').first().waitFor();
  await page.locator(`[data-herd-map="${firstDeer.id}"]`).click();
  await until(()=>page.locator('gz-herds').evaluate(e=>!!e.map&&e.map.data.zones.length===3),'grind herd map at '+width);
  const layout=await page.evaluate(()=>{
   const host=document.querySelector('gz-herds'),svg=host.querySelector('.gz-herd-map svg'),map=svg.getBoundingClientRect();
   const results=document.querySelector('.grind-results').getBoundingClientRect(),herds=host.getBoundingClientRect();
   return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,mapWidth:map.width,mapHeight:map.height,mapParentWidth:svg.parentElement.getBoundingClientRect().width,resultsBottom:results.bottom,herdsTop:herds.top};
  });
  assert.ok(layout.herdsTop>=layout.resultsBottom-1,'Supporting herd details must follow current grind results');
  assert.ok(layout.mapWidth>=200&&layout.mapWidth>=layout.mapParentWidth*.95,'Herd map must fill its panel, not inherit toolbar-icon sizing');
  assert.ok(layout.mapHeight>=300,'Herd map must have a usable actual viewport');
  assert.ok(layout.scrollWidth<=layout.width+1,'Grind herd map must fit '+width+'px');
  proof.grindLayouts.push(layout);
 }
 await phone.setViewportSize({width:390,height:844});await phone.goto(base+'/#harvests',{waitUntil:'domcontentloaded'});await phone.locator('[data-herd-id]').first().waitFor();
 proof.checks.push('The real grind shell keeps herd details after current results; actual FieldMap viewports fill their panels at 1440, 390 and 320px without inheriting toolbar icon sizing or page overflow.');

 await app.close();app=null;app=await open(base);await until(async()=>{try{return (await read(phone)).status===200;}catch{return false;}},'PC reconnect');assert.deepEqual((await read(phone)).data.herds.map(h=>h.id),ids);
 app.observer.command({op:'settings',spoilers:false});await phone.locator('[data-herd-retry]').click();await until(async()=>await phone.locator('[data-herd-id]').count()===0,'spoiler revocation');assert.equal((await read(phone)).data.summary,null);assert.equal(await phone.locator('.gz-herd-map svg').count(),0);
 app.observer.command({op:'settings',spoilers:true,confirmSpoilers:true});await phone.locator('[data-herd-retry]').click();await phone.locator('[data-herd-id]').first().waitFor();assert.deepEqual(saveHashes(save),expected);
 mkdirSync(output,{recursive:true});await phone.locator('gz-herds').scrollIntoViewIfNeeded();await phone.screenshot({path:path.join(output,mode+'-herds.png'),fullPage:false});
 await app.phone.disable();await phone.locator('[data-herd-retry]').click();await until(async()=>await phone.locator('[data-herd-id]').count()===0,'disconnected data cleared');assert.equal((await fetch(base+'/api/herds')).status,401);assert.deepEqual(errors,[]);
 proof.checks.push('Real app/SQLite restart preserves identities; spoiler revocation removes herd details and map; disconnect clears the new phone view and anonymous access remains denied.');proof.passed=true;
}catch(error){let message=String(error.stack||error);for(const s of secrets)message=message.split(s).join('[redacted]');proof.error=message.replace(/pair=[A-Za-z0-9_-]{43}/g,'pair=[redacted]');process.exitCode=1;}
finally{await browser?.close();await app?.close().catch(()=>{});await relay?.close();rmSync(root,{recursive:true,force:true});proof.finishedAt=new Date().toISOString();mkdirSync(output,{recursive:true});writeFileSync(path.join(output,mode+'-herds.json'),JSON.stringify(proof,null,2));console.log('GRINDZONE_HERD_BROWSER '+JSON.stringify(proof));}
