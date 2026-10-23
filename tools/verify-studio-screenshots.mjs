/** Actual PC/paired-phone studio, local binary images and exported PNG pixels; no player media. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {createActivatedPhoneRelay} from '../cloud/activation-server.mjs';
import {createApp} from '../server.mjs';
import {fixture,defs} from '../tests/fixtures.mjs';
const hostRoot=path.resolve(process.argv[2]||'.'),mode=process.argv[3]||'local',output=path.resolve(process.argv[4]||'phone-acceptance');
assert.ok(['local','live'].includes(mode));
const require=createRequire(path.join(hostRoot,'package.json')),{chromium}=require('playwright'),sharp=require('sharp');
const dir=mkdtempSync(path.join(tmpdir(),'grindzone-studio-')),save=path.join(dir,'save');mkdirSync(save);
const saveBytes=fixture(defs,'rootHarvest',{HarvestHistory:[]}),saveFile=path.join(save,'hunting_log_adf');writeFileSync(saveFile,saveBytes);
const proof={at:new Date().toISOString(),source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode,checks:[],passed:false,fixture:'Actual application and paired browser, generated screenshot-shaped PNG/JPG/WebP/BMP files; no owner media',physicalPhoneVerified:false,windowsLaunchVerified:false,nativeGalleryVerified:false,exported:[]};
let relay,app,browser;const secrets=[],errors=[];
const paint={r:237,g:12,b:167,alpha:1};
const png=await sharp({create:{width:1920,height:1080,channels:4,background:paint}}).png().toBuffer();
const jpg=await sharp(png).jpeg().toBuffer(),webp=await sharp(png).webp().toBuffer();
// Minimal valid 24-bit BMP for browser-format coverage.
const bmp=Buffer.alloc(54+4*4*3);bmp.write('BM');bmp.writeUInt32LE(bmp.length,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);bmp.writeInt32LE(4,18);bmp.writeInt32LE(4,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);for(let i=54;i<bmp.length;i+=3){bmp[i]=167;bmp[i+1]=12;bmp[i+2]=237;}
const hasPixels=async bytes=>{const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});let n=0;for(let i=0;i<data.length;i+=4)if(data[i]>220&&data[i+1]<35&&data[i+2]>140&&data[i+2]<195)n++;assert.ok(n>10000,'The exported card must contain screenshot pixels, not just a file-strip thumbnail');return {width:info.width,height:info.height,screenshotPixels:n};};
const ready=async page=>{await page.waitForFunction(()=>{const b=document.querySelector('#studioDownload');return b&&!b.disabled;});};
const canvasBytes=async page=>Buffer.from(await page.locator('#studioCanvas').evaluate(c=>c.toDataURL('image/png').split(',')[1]),'base64');
const upload=async(page,files)=>{await page.locator('#studioPhotos').setInputFiles(files);await page.waitForFunction(()=>!document.querySelector('#studioImportStatus')?.textContent.includes('Opening screenshots'));await ready(page);};
const viaPicker=async(page,file)=>{const chooser=page.waitForEvent('filechooser');await page.locator('#studioChoosePhotos').click();await (await chooser).setFiles(file);await page.waitForFunction(()=>document.querySelectorAll('[data-photo-preview]').length===1);await ready(page);};
try{
 if(mode==='local')relay=await createActivatedPhoneRelay({key:randomBytes(32),publicOrigin:'http://127.0.0.1:0/grindzone',allowInsecureLoopback:true});
 const base=relay?.origin||'https://sway-tips.onrender.com/grindzone';proof.relay=base;
 app=await createApp({dataDir:path.join(dir,'journal'),saveDir:save,port:0,interval:100,phoneRelayUrl:base,phoneEnrollmentToken:null,allowInsecurePhoneLoopback:mode==='local',feedbackUrl:null,feedbackOwnerToken:null,feedbackOwnerOrigin:null});
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const pcContext=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),pc=await pcContext.newPage();pc.on('pageerror',e=>errors.push(e.message));
 const writes=[];pc.on('request',r=>{if(['POST','PUT','PATCH'].includes(r.method()))writes.push(r.url());});
 await pc.goto(app.url+'/#studio',{waitUntil:'domcontentloaded'});await pc.locator('#studioChoosePhotos').waitFor();
 assert.equal(await pc.locator('#studioPhotos').getAttribute('capture'),null);
 await viaPicker(pc,{name:'in-game-capture.PNG',mimeType:'',buffer:png});
 assert.equal(await pc.locator('[data-design="layout"]').inputValue(),'stats');
 await hasPixels(await canvasBytes(pc));
 proof.checks.push('Actual PC chooser accepts an in-game-shaped PNG without a MIME label; the default Career card renders its pixels');
 for(const [layout,size,dimensions] of [['stats','square',[1080,1080]],['trophy','portrait',[1080,1350]],['collage','wide',[1920,1080]],['thumbnail','thumbnail',[1280,720]]]){
  await pc.locator('[data-design="layout"]').selectOption(layout);await pc.locator('[data-design="size"]').selectOption(size);await ready(pc);
  const pending=pc.waitForEvent('download');await pc.locator('#studioDownload').click();const download=await pending,filename=path.join(dir,layout+'.png');await download.saveAs(filename);
  const check=await hasPixels(readFileSync(filename));assert.deepEqual([check.width,check.height],dimensions);proof.exported.push({layout,...check});
 }
 proof.checks.push('Career, trophy, collage and thumbnail PNG downloads all contain actual screenshot pixels at their requested output sizes');
 await pc.locator('#studioClearPhotos').click();
 await upload(pc,[{name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')},{name:'game.jpg',mimeType:'image/jpeg',buffer:jpg},{name:'game.webp',mimeType:'image/webp',buffer:webp},{name:'game.bmp',mimeType:'image/bmp',buffer:bmp}]);
 assert.equal(await pc.locator('[data-photo-preview]').count(),3);assert.match(await pc.locator('#studioImportStatus').innerText(),/broken.png/);await hasPixels(await canvasBytes(pc));
 // Paste on the preview/body rather than only inside the controls.
 await pc.evaluate(encoded=>{const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),transfer=new DataTransfer();transfer.items.add(new File([bytes],'clipboard.png',{type:''}));document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));},png.toString('base64'));
 await pc.waitForFunction(()=>document.querySelectorAll('[data-photo-preview]').length===4);await ready(pc);
 await pc.evaluate(encoded=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'drop.PNG',{type:'application/octet-stream'}));document.querySelector('#studioCanvas').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));},png.toString('base64'));
 await pc.waitForFunction(()=>document.querySelectorAll('[data-photo-preview]').length===5);await ready(pc);
 await pc.locator('[data-design="photoFit"]').selectOption('cover');await pc.locator('#studioPhotoStrip details').first().locator('summary').click();
 const slider=pc.locator('[data-photo-focus="x"]').first();await slider.focus();await slider.press('End');assert.equal(await slider.inputValue(),'100');await ready(pc);assert.equal(await slider.evaluate(n=>n===document.activeElement),true);
 assert.equal(writes.length,0,'Screenshot import/edit/export must not upload files or require an account command');
 proof.checks.push('JPG, WebP and BMP decode; malformed files leave good images usable; preview paste/drop and keyboard crop controls work with no upload requests');
 // Native share itself is platform UI; verify its prepared File and synchronous activation with an instrumented API.
 await pc.evaluate(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:({files})=>{window.studioShareProof={activated:navigator.userActivation.isActive,type:files[0].type,size:files[0].size};return Promise.resolve();}});});
 await pc.locator('#studioShare').click();const share=await pc.evaluate(()=>window.studioShareProof);assert.equal(share.activated,true);assert.equal(share.type,'image/png');assert.ok(share.size>1000);proof.nativeShareCall={...share,systemShareSheetVerified:false};
 await pc.goto(app.url+'/#settings',{waitUntil:'domcontentloaded'});await pc.locator('[data-action="phone-enable"]').click();await pc.locator('#modal input[name="consent"]').check();await pc.locator('#submitDialog').click();await pc.locator('.phone-pairing input[readonly]').waitFor({timeout:30000});
 const pair=await pc.locator('.phone-pairing input[readonly]').inputValue();secrets.push(new URL(pair).hash.slice(6));
 const phoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 await phoneContext.addInitScript(()=>{globalThis.createImageBitmap=undefined;});
 const phone=await phoneContext.newPage();phone.on('pageerror',e=>errors.push(e.message));await phone.goto(pair,{waitUntil:'domcontentloaded'});await phone.locator('#pair').click();await phone.waitForURL(u=>u.hash==='#map');
 await phone.goto(base+'/#studio',{waitUntil:'domcontentloaded'});await phone.locator('#studioChoosePhotos').waitFor();
 assert.equal(await phone.locator('[data-photo-preview]').count(),0,'PC media must not be transferred to the phone implicitly');assert.equal(await phone.locator('#studioPhotos').getAttribute('capture'),null);
 proof.phoneLayout=await phone.locator('#studioChoosePhotos').evaluate(b=>({width:innerWidth,buttonBottom:Math.round(b.getBoundingClientRect().bottom),height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1}));
 assert.equal(proof.phoneLayout.overflow,false);assert.ok(proof.phoneLayout.buttonBottom<proof.phoneLayout.height,'Screenshot import must be visible without scrolling through design fields');
 const phoneWrites=[];phone.on('request',r=>{if(['POST','PUT','PATCH'].includes(r.method()))phoneWrites.push(r.url());});
 await viaPicker(phone,{name:'saved-game-screenshot.jpg',mimeType:'image/jpeg',buffer:jpg});await hasPixels(await canvasBytes(phone));
 const phoneDownload=phone.waitForEvent('download');await phone.locator('#studioDownload').click();const file=await phoneDownload;const out=path.join(dir,'phone.png');await file.saveAs(out);proof.phoneExport=await hasPixels(readFileSync(out));assert.equal(phoneWrites.length,0);
 mkdirSync(output,{recursive:true});await phone.screenshot({path:path.join(output,mode+'-studio.png'),fullPage:false});
 proof.checks.push('Paired 390px phone has a visible non-camera screenshot chooser; HTML image fallback imports and exports JPG pixels without uploads or sharing PC media');
 assert.equal(createHash('sha256').update(readFileSync(saveFile)).digest('hex'),createHash('sha256').update(saveBytes).digest('hex'));assert.deepEqual(errors,[]);proof.passed=true;
}catch(error){let text=String(error.stack||error);for(const secret of secrets)text=text.split(secret).join('[redacted]');proof.error=text;process.exitCode=1;}
finally{await browser?.close();await app?.close().catch(()=>{});await relay?.close();rmSync(dir,{recursive:true,force:true});proof.finishedAt=new Date().toISOString();mkdirSync(output,{recursive:true});writeFileSync(path.join(output,mode+'-studio.json'),JSON.stringify(proof,null,2));console.log('GRINDZONE_STUDIO_SCREENSHOTS '+JSON.stringify(proof));}
