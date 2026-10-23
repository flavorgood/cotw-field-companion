/** Scan the actual rendered PC code. These optical approximations are not a physical camera claim. */
import assert from 'node:assert/strict';
export async function verifyPhoneQR({page,link,sharp,jsQR}){
  const checks=[];
  async function decode(bytes,label){
    const image=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const value=jsQR(new Uint8ClampedArray(image.data),image.info.width,image.info.height);
    assert.ok(value?.data===link,`Rendered QR scan failed: ${label}`);checks.push(label);
  }
  const code=page.locator('.phone-qr');
  const geometry=await code.locator('svg').evaluate(svg=>{
    const bounds=svg.querySelector('path').getBBox(),box=svg.getBoundingClientRect(),view=svg.viewBox.baseVal;
    return {width:box.width,height:box.height,left:bounds.x,top:bounds.y,right:view.width-bounds.x-bounds.width,bottom:view.height-bounds.y-bounds.height};
  });
  assert.ok(geometry.width>=270&&Math.abs(geometry.width-geometry.height)<1);
  for(const edge of ['left','right','top','bottom'])assert.equal(geometry[edge],36,'Six-module white border must survive the rendered symbol');
  const original=await code.screenshot();await decode(original,'default desktop size');
  await decode(await sharp(original).resize(240,240).png().toBuffer(),'240px camera framing');
  await decode(await sharp(original).resize(216,216).png().toBuffer(),'216px camera framing');
  await decode(await sharp(original).blur(0.4).png().toBuffer(),'mild optical blur');
  await decode(await sharp(original).rotate(7,{background:'#ffffff'}).png().toBuffer(),'seven-degree tilt');
  await decode(await sharp(original).jpeg({quality:75}).toBuffer(),'JPEG capture');
  await decode(await sharp(original).modulate({brightness:0.75}).png().toBuffer(),'reduced brightness');
  await page.locator('#phoneQrEnlarge').check();
  const enlarged=await code.boundingBox();assert.ok(enlarged.width>geometry.width*1.4);
  await decode(await code.screenshot(),'enlarged desktop QR');
  await page.locator('#phoneQrEnlarge').uncheck();
  const viewport=page.viewportSize();
  try{
    for(const zoom of [0.8,1.25]){
      await page.evaluate(value=>{document.body.style.zoom=String(value);},zoom);
      await decode(await code.screenshot(),`browser content scale ${zoom}`);
    }
    await page.evaluate(()=>{document.body.style.zoom='';});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await decode(await code.screenshot(),'390px viewport');
    await page.emulateMedia({forcedColors:'active'});
    await decode(await code.screenshot(),'forced-colors accessibility mode');
  }finally{
    await page.emulateMedia({forcedColors:'none'});await page.evaluate(()=>{document.body.style.zoom='';});await page.setViewportSize(viewport);
  }
  assert.equal(await page.locator('.phone-pairing input[readonly]').inputValue(),link,'Changing display size must not rotate the pairing token');
  assert.match(await page.locator('.phone-qr-remaining').innerText(),/^\d+:\d{2}$/);
  return {checks,quietZoneModules:6,defaultPixels:geometry.width,enlargedPixels:enlarged.width,physicalCameraVerified:false};
}
