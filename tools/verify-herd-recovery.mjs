/** Actual PC/paired-phone upgrade path with retained synthetic saves, no player access. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {Store} from '../lib/store.mjs';
import {hash} from '../lib/core.mjs';
import {decodeSave} from '../lib/decoder.mjs';
import {normalizeFile} from '../lib/observer.mjs';
import {createApp} from '../server.mjs';
import {createActivatedPhoneRelay} from '../cloud/activation-server.mjs';
import {readyDiscoveryReader} from '../tests/zone-discovery-fixture.mjs';
import {fixture,defs,pop} from '../tests/fixtures.mjs';
const hostRoot=path.resolve(process.argv[2]||'.'),mode=process.argv[3]||'local',output=path.resolve(process.argv[4]||'phone-acceptance');
assert(['local','live'].includes(mode));
const require=createRequire(path.join(hostRoot,'package.json')),{chromium}=require('playwright');
const root=mkdtempSync(path.join(tmpdir(),'gz-retained-herds-browser-')),save=path.join(root,'save'),dataDir=path.join(root,'journal');mkdirSync(save);mkdirSync(dataDir);
const profile=hash(save.toLowerCase()).slice(0,20),fileName='animal_population_19',savedAt='2026-09-17T16:16:00.000Z';
const bytes=fixture({...defs,group:{NeedZonePathGuids:'u32[]',Animals:'animal[]'}},'rootPopulation',pop([1,2]));
const payload=normalizeFile(fileName,decodeSave(bytes));delete payload.herdProjectionVersion;
const seed=new Store(path.join(dataDir,'journal.sqlite'));
seed.saveSource(profile,fileName,{sha:hash(bytes),mtime:savedAt,checked:savedAt,status:'ok',error:null,payload});seed.set('settings:'+profile,{spoilers:true,terrain:false});
// Compare with the persisted baseline: JSON intentionally omits an undefined optional field.
const storedPayload=seed.source(profile,fileName).payload;
const storedBytes=Buffer.from(seed.db.prepare('SELECT payload FROM sources WHERE profile=? AND name=?').get(profile,fileName).payload);
seed.close();
// Deliberately no game file: updating the app must not require recreating an old save.
let relay,app,browser;const errors=[],secrets=[];
const proof={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode,at:new Date().toISOString(),passed:false,checks:[],physicalPhoneVerified:false,windowsLaunchVerified:false,realPlayerSaveVerified:false};
const until=async(fn,label)=>{for(let i=0;i<160;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);};
const read=page=>page.evaluate(async()=>{const r=await fetch(new URL('api/herds?reserve=19',location.href),{cache:'no-store'});return {status:r.status,data:await r.json()};});
const start=async base=>{const a=await createApp({dataDir,saveDir:save,port:0,interval:250,phoneRelayUrl:base,phoneEnrollmentToken:null,allowInsecurePhoneLoopback:mode==='local',feedbackUrl:null,githubFeedbackUrl:null});a.observer.zoneReference.close();a.observer.zoneReference=readyDiscoveryReader();return a;};
try{
 if(mode==='local')relay=await createActivatedPhoneRelay({key:randomBytes(32),publicOrigin:'http://127.0.0.1:0/grindzone',allowInsecureLoopback:true});
 const base=relay?.origin||'https://sway-tips.onrender.com/grindzone';proof.relay=base;app=await start(base);
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const pc=await browser.newPage({viewport:{width:1440,height:1000}});pc.on('pageerror',e=>errors.push(e.message));
 await pc.goto(app.url+'/#insights',{waitUntil:'domcontentloaded'});await pc.locator('[data-population-species]').first().waitFor();
 let value=(await read(pc)).data;assert.equal(value.status,'stale');assert.equal(value.summary.animals,2);assert.equal(value.summary.herds,1);assert.equal(value.savedAt,savedAt);
 assert.equal(await pc.locator('[data-population-species] [data-label="Animals"]').innerText(),'2');
 assert.doesNotMatch(await pc.locator('gz-herds').innerText(),/No matching readable herd snapshot/);const id=value.herds[0].id;
 proof.checks.push('Actual Insights restores two retained synthetic animals and one herd from a pre-herd journal with no population file and no spawn-area field; the old saved time remains explicit and stale.');
 await pc.goto(app.url+'/#settings');await pc.locator('[data-action="phone-enable"]').click();await pc.locator('#modal input[name="consent"]').check();await pc.locator('#submitDialog').click();await pc.locator('[data-phone-link]').waitFor({timeout:30000});
 const link=await pc.locator('[data-phone-link]').inputValue();secrets.push(new URL(link).hash.slice(6));
 const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});phone.on('pageerror',e=>errors.push(e.message));await phone.goto(link);await phone.locator('#pair').click();await phone.waitForURL(u=>u.hash==='#map');
 await phone.goto(base+'/#insights');await phone.locator('[data-population-species]').first().waitFor();assert.equal(await phone.locator('[data-population-species] [data-label="Animals"]').innerText(),'2');assert.equal((await read(phone)).data.herds[0].id,id);
 await app.close();app=null;app=await start(base);await until(async()=>{try{return (await read(phone)).data?.summary?.animals===2;}catch{return false;}},'existing phone reconnects');
 await phone.reload({waitUntil:'domcontentloaded'});await phone.locator('[data-population-species]').first().waitFor();value=(await read(phone)).data;assert.equal(value.herds[0].id,id);assert.equal(value.savedAt,savedAt);
 assert.equal(app.store.source(profile,fileName).sha,hash(bytes));assert.deepEqual(app.store.source(profile,fileName).payload,storedPayload);assert.deepEqual(Buffer.from(app.store.db.prepare('SELECT payload FROM sources WHERE profile=? AND name=?').get(profile,fileName).payload),storedBytes);assert.equal(app.store.harvests(profile).length,0);
 proof.checks.push('The signed phone shows the same retained counts and ID; an actual app/SQLite restart reconnects the existing pairing without a new game save, a fabricated harvest, or replacing source bytes.');
 for(const width of [390,320]){await phone.setViewportSize({width,height:844});assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
 mkdirSync(output,{recursive:true});await phone.locator('gz-herds').scrollIntoViewIfNeeded();await phone.screenshot({path:path.join(output,mode+'-herd-recovery.png'),fullPage:false});
 app.observer.command({op:'settings',spoilers:false});await phone.locator('[data-herd-retry]').click();await until(async()=>await phone.locator('[data-population-species]').count()===0,'spoilers revoked');assert.equal((await read(phone)).data.summary,null);
 assert.equal((await fetch(base+'/api/herds')).status,401);assert.deepEqual(errors,[]);proof.checks.push('Recovered data remains protected by spoiler consent and signed pairing; phone layout fits 320/390px.');proof.passed=true;
}catch(error){let detail=String(error.stack||error);for(const secret of secrets)detail=detail.split(secret).join('[redacted]');proof.error=detail;process.exitCode=1;}
finally{await browser?.close();await app?.close().catch(()=>{});await relay?.close();rmSync(root,{recursive:true,force:true});proof.finishedAt=new Date().toISOString();mkdirSync(output,{recursive:true});writeFileSync(path.join(output,mode+'-herd-recovery.json'),JSON.stringify(proof,null,2));console.log('GRINDZONE_HERD_RECOVERY '+JSON.stringify(proof));}
