import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {phoneTokenCodec} from '../cloud/auth.mjs';
import {pairedCacheHeaders} from '../cloud/phone-cache-session.mjs';
const cookieName='__Secure-grindzone-phone',now=()=>1789900000000;
const codec=phoneTokenCodec({key:randomBytes(32),now});
const phone=(deviceId='a'.repeat(43),sid='b'.repeat(43))=>codec.issue('phone',{deviceId,sid},60000);
const headers=token=>pairedCacheHeaders(cookieName+'='+token,{codec,cookieName,now});
test('scope is stable, opaque and bound to the actual signed source and browser session',()=>{
 const first=headers(phone()),again=headers(phone());assert.deepEqual(first,again);assert.match(first['X-GrindZone-Cache-Scope'],/^[A-Za-z0-9_-]{43}$/);assert.equal(first['X-GrindZone-Cache-Expires'],String(now()+60000));
 assert.notEqual(first['X-GrindZone-Cache-Scope'],headers(phone('c'.repeat(43)))['X-GrindZone-Cache-Scope']);assert.notEqual(first['X-GrindZone-Cache-Scope'],headers(phone('a'.repeat(43),'d'.repeat(43)))['X-GrindZone-Cache-Scope']);
 assert.notEqual(first['X-GrindZone-Cache-Scope'],codec.mac('csrf:'+phone()));
});
test('missing, forged and expired cookies have no cache authority',()=>{
 for(const cookie of [null,'',cookieName+'=bad',cookieName+'='+phone().slice(1),'other='+phone()])assert.deepEqual(pairedCacheHeaders(cookie,{codec,cookieName,now}),{});
 const token=phone();assert.deepEqual(pairedCacheHeaders(cookieName+'='+token,{codec,cookieName,now:()=>now()+60000}),{});
});
test('duplicate cookies are rejected rather than taking the first authority',()=>{const token=phone();assert.deepEqual(pairedCacheHeaders(cookieName+'='+token+'; '+cookieName+'='+token,{codec,cookieName,now}),{});});
test('an enrollment or device credential is not a paired-browser session',()=>{
 for(const purpose of ['device','enrollment']){const token=codec.issue(purpose,{deviceId:'a'.repeat(43),installationId:'c'.repeat(43),generation:1,sid:'b'.repeat(43)},60000);assert.deepEqual(headers(token),{});}
});
