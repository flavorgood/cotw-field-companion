import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('screenshot picker precedes the mobile-reordered preview and long design panel',()=>{
 const source=readFileSync(new URL('../public/studio.js',import.meta.url),'utf8');
 const input=source.indexOf('id="studioPhotos"');
 assert.ok(input>0);
 assert.ok(input<source.indexOf('class="studio-layout"'));
 assert.ok(input<source.indexOf('id="studioControls"'));
 assert.match(source,/class="panel studio-controls studio-import"/);
 assert.match(source,/closest\('\.studio-layout,\.studio-import'\)/);
});
