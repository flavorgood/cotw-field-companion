import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/phone.css',import.meta.url),'utf8');
test('the existing spoiler confirmation describes hidden areas and the public-only reference request',()=>{
 assert.match(app,/This reveals undiscovered zone areas assigned in your save/);
 assert.match(app,/never your game save or journal/);
 assert.doesNotMatch(app,/Locations are not revealed/);
});
test('map, list and selection keep undiscovered areas labelled after map redraws',()=>{
 assert.match(app,/class HuntFieldMap extends FieldMap/);
 assert.match(app,/super\.draw\(\)/);
 assert.match(app,/marker\.dataset\.discovery/);
 assert.match(app,/Undiscovered zone area/);
 assert.match(app,/data-discovery="\$\{isUndiscoveredZone\(z\)/);
 assert.match(css,/g\[data-discovery="undiscovered"\]/);
 assert.match(css,/stroke-dasharray:4 3/);
});
test('loaded hidden species enter the current filter and coverage is updated without another view',()=>{
 assert.match(app,/visibleSpecies=huntSpeciesOptions\(\)/);
 assert.match(app,/Array\.isArray\(state\.huntSpeciesOptions\)/);
 assert.match(app,/speciesPicker\.innerHTML=speciesOptions/);
 assert.match(app,/zoneDiscoveryNotice\(state\)/);
 assert.match(app,/state\.zoneActivity,state\.encounters/);
});
