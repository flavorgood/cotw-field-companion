import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {bindPhoneCacheClient} from '../cloud/phone-cache-client.mjs';
import {mountClientSource} from '../cloud/mount.mjs';
const original=()=>readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('hosted cache hooks bind the actual canonical app and retain its original write guard',()=>{
 const input=original(),output=bindPhoneCacheClient(input);
 assert.notEqual(output,input);assert.equal((output.match(/new PhoneSnapshotCache\(/g)||[]).length,1);
 assert.match(output,/if\(!connectionReady\)throw Object\.assign\(Error\('Reconnect to your PC before saving\.'/);
 assert.match(output,/connectionState\(!phoneCache.readOnly\)/);
 assert.match(output,/phoneCache\.updateStatus\(badge\)/);
 assert.match(output,/return JSON\.stringify\(\[phoneCache\.readOnly,phoneCache\.cachedAt,viewSignature\]\);/);
 assert.match(output,/phoneCache\.settings\(\)/);
 assert.match(output,/return await phoneCache\.get\(url,\{token,signal:controller\.signal\}\)/);
 assert.match(output,/setTimeout\(\(\)=>controller\.abort\(Error\('Connection timed out\. Try again\.'\)\),15000\)/);
 assert.match(output,/finally\{clearTimeout\(timer\);signal\?\.removeEventListener\('abort',abort\);\}/);
 assert.match(output,/e\.cacheDenied\|\|state&&state\.selectedReserve!==requestedReserve/);
 assert.match(output,/if\(state&&!cachedReserveMatches\)\{clearZoneSelection\(\);state=null;map\?\.destroy\(\);map=null;\}/,'a failed reserve switch clears private selection before phone cache fallback');
 const mounted=mountClientSource(output,'/grindzone');
 const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:mounted,encoding:'utf8'});
 assert.equal(checked.status,0,checked.stderr);
 assert.equal(original(),input);
 assert.match(bindPhoneCacheClient(input.replace(/\r?\n/g,'\r\n')),/return await phoneCache\.get\(url,\{token,signal:controller\.signal\}\)/,'CRLF checkout retains the exact bounded hook');
});
test('client binding fails closed on missing, duplicated or already applied hooks',()=>{
 const input=original();assert.throws(()=>bindPhoneCacheClient(bindPhoneCacheClient(input)));
 assert.throws(()=>bindPhoneCacheClient(input.replace('async function get(url,{signal}={}){','async function movedGet(url,{signal}={}){')));
 const read=input.slice(input.indexOf('async function get('),input.indexOf('const postJSON='));
 assert.throws(()=>bindPhoneCacheClient(input+'\n'+read),'duplicated bounded read anchor fails closed');
 assert.throws(()=>bindPhoneCacheClient(input+"\nfunction warning(){const failed=0;}"));
});

test('deleting a browser copy does not depend on the offline-disabled PC write dialog',()=>{
 const output=bindPhoneCacheClient(original());
 const deletion=output.split("if(action==='cache-delete')")[1]?.split("if(action==='zone-track'")[0];
 assert.ok(deletion);assert.match(deletion,/await phoneCache\.forget\(\)/);assert.doesNotMatch(deletion,/openDialog|command\(/);assert.match(deletion,/await refresh\(true\)/);
});
