import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ZONE_PAGE_SIZE,visibleZonePage} from '../public/zone-window.js';
import {portableFiles} from '../tools/build-portable.mjs';
import {createApp} from '../server.mjs';
import {writeSaveDataFixture} from './save-data-workflow-fixture.mjs';

test('three thousand matching zones stay bounded while a late map selection remains reachable',()=>{
 const zones=Array.from({length:3000},(_,index)=>({id:`zone-${index}`,species:index===2999?'Mallard':'Red Deer'}));
 const first=visibleZonePage(zones);
 assert.equal(first.total,3000);
 assert.equal(first.zones.length,ZONE_PAGE_SIZE);
 assert.equal(first.pageCount,50);
 assert.equal(first.hasPrevious,false);
 assert.equal(first.hasNext,true);
 const selected=visibleZonePage(zones,{selectedId:'zone-2999'});
 assert.equal(selected.zones.length,ZONE_PAGE_SIZE+1);
 assert.equal(selected.zones[0].id,'zone-2999');
 assert.equal(new Set(selected.zones.map(zone=>zone.id)).size,selected.zones.length);
 const last=visibleZonePage(zones,{page:49});
 assert.equal(last.zones.length,ZONE_PAGE_SIZE);
 assert.equal(last.zones[0].id,'zone-2940');
 assert.equal(last.hasNext,false);
 const searched=visibleZonePage(zones.filter(zone=>zone.species==='Mallard'));
 assert.deepEqual(searched.zones.map(zone=>zone.id),['zone-2999']);
 assert.equal(searched.hasNext,false);
});

test('the PC and signed portable package include the zone page module',async t=>{
 const root=mkdtempSync(path.join(tmpdir(),'grindzone-zone-page-')),save=path.join(root,'save');
 mkdirSync(save);writeSaveDataFixture(save);
 let app;
 t.after(async()=>{await app?.close();rmSync(root,{recursive:true,force:true});});
 app=await createApp({dataDir:path.join(root,'journal'),saveDir:save,port:0,interval:60000,phoneRelayUrl:null,phoneEnrollmentToken:null,feedbackUrl:null,feedbackOwnerToken:null,githubFeedbackUrl:null});
 const response=await fetch(app.url+'/zone-window.js');
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type'),/javascript/);
 assert(portableFiles.includes('public/zone-window.js'));
});
