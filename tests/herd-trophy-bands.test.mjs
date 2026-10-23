import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveHerdReference,trophyCounts,summarizeHerdCounts} from '../lib/herd-trophies.mjs';
import {readHerdView,projectHerdView} from '../lib/herd-view.mjs';
import {populationSpeciesTable,populationTrophyLabel,herdCards} from '../public/herd-view.js';
import {insightsFixture} from './fixtures/insights-population.mjs';
const rule=deriveHerdReference({test:{trophy:{bronze:{score_low:10},silver:{score_low:20},gold:{score_low:30},diamond:{score_low:40}},gender:{male:{score_high:50},female:{score_high:35}}}}).species.test;
const animal=(score,extra={})=>({sex:1,score,greatOne:false,greatOneEvidence:'explicit_IsGreatOne',...extra});
const bands=c=>[c.noTrophy,c.bronzes,c.silvers,c.golds,c.diamonds];
test('ordinary bands use exact inclusive lower thresholds with no decimal gaps',()=>{
 const c=trophyCounts([0,9.99999,10,19.99999,20,29.99999,30,39.99999,40].map(v=>animal(v)),rule);
 assert.deepEqual(bands(c),[2,2,2,2,1]);assert.equal(c.unclassifiedBands,0);
 assert.equal(bands(c).reduce((a,b)=>a+b),c.animals);
});
test('Diamond-incapable females retain lower bands and no-trophy, without false Diamond potential',()=>{
 const c=trophyCounts([animal(0,{sex:2}),animal(10,{sex:2}),animal(20,{sex:2}),animal(30,{sex:2}),animal(40,{sex:2})],rule);
 assert.deepEqual(bands(c),[1,1,1,1,0]);assert.equal(c.unclassifiedBands,1);
 assert.equal(populationTrophyLabel(c,'golds'),'1 known');
});
test('scripted, explicit Great Ones and legacy candidates stay outside ordinary bands',()=>{
 const c=trophyCounts([animal(30,{scripted:true,greatOne:true}),animal(40,{greatOne:true}),animal(30,{greatOneEvidence:null,flags:1}),animal(30)],rule);
 assert.deepEqual(bands(c),[0,0,0,1,0]);assert.equal(c.scripted,1);assert.equal(c.greatOnes,1);assert.equal(c.greatOneCandidates,1);
});
test('missing score, unknown sex and invalid thresholds never become no-trophy',()=>{
 for(const a of [animal(null),animal(NaN),animal(-1),animal(0,{sex:0})]){
  const c=trophyCounts([a],rule);assert.equal(c.noTrophy,0);assert.equal(c.unclassifiedBands,1);assert.equal(populationTrophyLabel(c,'noTrophy'),'Unknown');
 }
 for(const r of [null,{...rule,trophyThresholds:null},{...rule,trophyThresholds:{bronze:20,silver:10,gold:30,diamond:40}}]){
  const c=trophyCounts([animal(0)],r);assert.equal(c.noTrophy,null);assert.equal(c.unclassifiedBands,1);
 }
});
test('legacy diamond-only reference preserves Diamond and marks new bands unknown',()=>{
 const legacy={diamondScore:40,maleDiamondCapable:true,femaleDiamondCapable:false};
 const c=trophyCounts([animal(45)],legacy);assert.equal(c.diamonds,1);assert.equal(c.golds,null);
 const s=summarizeHerdCounts([{counts:c}]);assert.equal(s.golds,null);assert.equal(populationTrophyLabel(s,'golds'),'Unknown');
});
test('mixed complete and unknown herds aggregate known bands with partial coverage',()=>{
 const s=summarizeHerdCounts([{counts:trophyCounts([animal(30)],rule)},{counts:trophyCounts([animal(30)],null)}]);
 assert.equal(s.golds,1);assert.equal(s.unclassifiedBands,1);assert.equal(populationTrophyLabel(s,'golds'),'1 known');
 assert.equal(populationTrophyLabel(s,'bronzes'),'Unknown');
});
function f(){const value=insightsFixture();for(const r of Object.values(value.observer.herdReference.species))r.trophyThresholds={bronze:10,silver:50,gold:100,diamond:200};
 // Keep the existing Diamond threshold consistent with these test-only bands.
 for(const r of Object.values(value.observer.herdReference.species))r.diamondScore=200;
 return value;}
test('band and zone/species intersections select whole herds and retain IDs, all animals and shared zones',()=>{
 const fixture=f(),all=readHerdView(fixture.observer,{reserve:19,limit:50});
 const view=projectHerdView(readHerdView(fixture.observer,{reserve:19,species:'fixture_deer',zone:'saved:19:10:0',trophy:'gold'}));
 assert.equal(view.summary.herds,1);assert.equal(view.summary.animals,2);assert.equal(view.summary.golds,1);assert.equal(view.summary.bronzes,1);
 assert.equal(view.herds[0].id,all.herds[0].id);assert.deepEqual(view.herds[0].zones,all.herds[0].zones);
 assert.equal(view.speciesSummary[0].counts.golds,1);assert.match(view.trophyNotice,/totals include all animals/);
 assert.equal(readHerdView(fixture.observer,{trophy:'silver'}).summary.herds,0);
});
test('old provider fields and invalid band numbers remain null through phone projection',()=>{
 const fixture=f(),value=readHerdView(fixture.observer);for(const counts of [value.summary,value.herds[0].counts,value.speciesSummary[0].counts]){
  delete counts.noTrophy;delete counts.unclassifiedBands;counts.golds=-1;
 }
 const p=projectHerdView(value);for(const counts of [p.summary,p.herds[0].counts,p.speciesSummary[0].counts]){
  assert.equal(counts.noTrophy,null);assert.equal(counts.golds,null);assert.equal(counts.unclassifiedBands,null);assert.equal(populationTrophyLabel(counts,'noTrophy'),'Unknown');
 }
});
test('cards and species totals expose every band with honest scope and unknown labels',()=>{
 const data=projectHerdView(readHerdView(f().observer));const html=populationSpeciesTable(data),card=herdCards(data.herds);
 for(const label of ['No trophy','Bronze potential','Silver potential','Gold potential','Diamond potential']){assert.ok(html.includes(label));assert.ok(card.includes(label));}
 assert.match(html,/data-herd-band="gold"/);assert.match(html,/whole herds/);assert.match(html,/not awarded medals/);
});
