import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {herdCards,populationSpeciesTable,herdWorkspaceView} from '../public/herd-view.js';
const counts={herds:1,animals:4,males:2,females:2,diamonds:0,greatOnes:0,greatOneCandidates:0,unknownGreatOne:0,unclassified:0,femaleDiamondCapable:true};
const card=changes=>({id:'herd-1',label:'H-000001',species:'Synthetic species',speciesKey:'synthetic',counts:{...counts,...changes},zones:[]});
test('complete zero classifications remain numeric zero',()=>{
  const html=herdCards([card({})]);assert.match(html,/<strong>0<\/strong> Diamond potential/);assert.match(html,/<strong>0<\/strong> saved Great Ones/);
});
test('an unclassified herd never claims zero Diamonds or Great Ones',()=>{
  const html=herdCards([card({unclassified:4,unknownGreatOne:4})]);assert.match(html,/<strong>Unknown<\/strong> Diamond potential/);assert.match(html,/<strong>Unknown<\/strong> saved Great Ones/);
});
test('known partial populations remain labeled partial on cards',()=>{
  const html=herdCards([card({diamonds:2,greatOnes:1,unclassified:1,unknownGreatOne:1})]);assert.match(html,/<strong>2 known<\/strong> Diamond potential/);assert.match(html,/<strong>1 known<\/strong> saved Great Ones/);
});
test('Great One candidates remain separate rather than being called confirmed',()=>{
  const html=herdCards([card({greatOneCandidates:2})]);assert.match(html,/<strong>Unknown<\/strong> saved Great Ones/);assert.match(html,/2 additional Great One candidates/);
});
test('missing reference fields remain unknown',()=>{
  const html=herdCards([card({diamonds:null,greatOnes:null,unclassified:undefined,unknownGreatOne:undefined})]);assert.match(html,/<strong>Unknown<\/strong> Diamond potential/);assert.match(html,/<strong>Unknown<\/strong> saved Great Ones/);
});
test('species table and card use identical coverage-aware counts',()=>{
  const r=card({diamonds:1,unclassified:2,unknownGreatOne:1}),data={status:'available',speciesSummaryVersion:1,summary:r.counts,speciesSummary:[{key:r.speciesKey,name:r.species,femaleDiamondCapable:true,counts:r.counts}]};
  const table=populationSpeciesTable(data),html=herdCards([r]);assert.match(table,/>1 known<\/button><\/td>/);assert.match(table,/>Unknown<\/(?:button|td)>/);assert.match(html,/>1 known<\/strong>/);assert.match(html,/Females can reach Diamond/);
});
test('all herd overview modes use the same label function',()=>{
  const source=readFileSync(new URL('../public/herd-view.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/num\((?:r\.counts|s)\.(?:diamonds|greatOnes)\)/);
  assert.match(source,/populationTrophyLabel\(s,'diamonds'\)/);assert.match(source,/populationTrophyLabel\(s,'greatOnes'\)/);
});
test('awarded career medals remain separate, without population qualifiers',()=>{
  const html=herdWorkspaceView({app:{name:'GrindZone'},career:{summary:{diamonds:7,greatOnes:1}}});
  assert.match(html,/Career Diamonds <strong>7<\/strong>/);assert.match(html,/Career Great Ones <strong>1<\/strong>/);assert.doesNotMatch(html,/known/);
});
