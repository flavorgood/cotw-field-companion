import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {readHerdView,projectHerdView} from '../lib/herd-view.mjs';
import {summarizeHerdCounts,summarizeHerdSpecies,trophyCounts} from '../lib/herd-trophies.mjs';
import {populationSpeciesTable,populationTrophyLabel,herdWorkspaceView} from '../public/herd-view.js';
import {insightsFixture} from './fixtures/insights-population.mjs';
const view=(fixture=insightsFixture(),query={})=>projectHerdView(readHerdView(fixture.observer,{reserve:19,...query}));
test('species totals include every herd beyond the first detail page',()=>{
 const d=view();assert.equal(d.herds.length,25);assert.equal(d.summary.herds,32);assert.equal(d.summary.animals,66);
 const deer=d.speciesSummary.find(s=>s.key==='fixture_deer');assert.equal(deer.counts.herds,30);assert.equal(deer.counts.diamonds,30);assert.equal(deer.counts.males,30);assert.equal(deer.counts.females,30);
});
test('next page retains the same full-filter summary, not seven remaining herds',()=>{
 const f=insightsFixture(),a=view(f),b=view(f,{offset:25,revision:a.revision});assert.equal(b.herds.length,7);assert.deepEqual(a.speciesSummary,b.speciesSummary);assert.deepEqual(a.summary,b.summary);
});
test('female Diamonds count, but saved Great Ones, candidates and scripted animals do not double count',()=>{
 const d=view(),duck=d.speciesSummary.find(s=>s.key==='fixture_duck');assert.equal(duck.femaleDiamondCapable,true);assert.equal(duck.counts.diamonds,1);assert.equal(duck.counts.greatOnes,1);assert.equal(duck.counts.greatOneCandidates,1);assert.equal(duck.counts.scripted,1);assert.equal(d.summary.diamonds,31);
});
test('species filter applies to totals and detail together',()=>{
 const d=view(undefined,{species:'fixture_duck'});assert.equal(d.summary.herds,1);assert.equal(d.summary.animals,4);assert.equal(d.speciesSummary.length,1);assert.ok(d.herds.every(h=>h.speciesKey==='fixture_duck'));
});
test('zone filter changes totals without requiring a mapped zone',()=>{
 const d=view(undefined,{zone:'saved:19:10:0'});assert.equal(d.summary.herds,1);assert.equal(d.summary.animals,2);assert.equal(d.speciesSummary[0].counts.diamonds,1);
});
test('Diamond filter includes all qualifying herds across pages',()=>{const d=view(undefined,{trophy:'diamond'});assert.equal(d.summary.herds,31);assert.equal(d.summary.diamonds,31);});
test('Great One filter keeps explicit and candidate counts separate',()=>{const d=view(undefined,{trophy:'great_one'});assert.equal(d.summary.herds,1);assert.equal(d.summary.greatOnes,1);assert.equal(d.summary.greatOneCandidates,1);});
test('female-capable filter uses the pinned-rule capability rather than observed sex',()=>{const d=view(undefined,{trophy:'female_diamond'});assert.equal(d.summary.herds,1);assert.equal(d.speciesSummary[0].key,'fixture_duck');});
test('an unidentified population has unknown Diamond coverage, not zero',()=>{
 const d=view(undefined,{species:'Unidentified animal'});assert.equal(d.summary.diamonds,null);assert.equal(d.summary.unclassified,2);assert.equal(populationTrophyLabel(d.summary,'diamonds'),'Unknown');assert.equal(populationTrophyLabel(d.summary,'greatOnes'),'Unknown');
});
test('positive partial totals disclose known counts',()=>{const d=view();assert.equal(populationTrophyLabel(d.summary,'diamonds'),'31 known');assert.equal(populationTrophyLabel(d.summary,'greatOnes'),'1 known');});
test('a fully classified below-threshold population can report a true zero',()=>{
 const counts=trophyCounts([{sex:1,score:50,greatOne:false,greatOneEvidence:'explicit_IsGreatOne'}],{diamondScore:100,maleDiamondCapable:true,femaleDiamondCapable:false});assert.equal(populationTrophyLabel(counts,'diamonds'),'0');assert.equal(populationTrophyLabel(counts,'greatOnes'),'0');
});
test('all missing rules stay unknown after aggregation',()=>{
 const rows=[{counts:trophyCounts([{sex:1,score:100}],null)},{counts:trophyCounts([{sex:2,score:100}],null)}];assert.equal(summarizeHerdCounts(rows).diamonds,null);
});
test('zero with incomplete sex classification is not a negative trophy claim',()=>{
 const c=trophyCounts([{sex:2,score:150,greatOneEvidence:'explicit_IsGreatOne'}],{diamondScore:100,maleDiamondCapable:true,femaleDiamondCapable:null});assert.equal(c.diamonds,0);assert.equal(populationTrophyLabel(c,'diamonds'),'Unknown');
});
test('empty filter has zero herds and no invented species',()=>{const d=view(undefined,{species:'absent'});assert.equal(d.summary.herds,0);assert.equal(d.summary.diamonds,0);assert.deepEqual(d.speciesSummary,[]);});
test('spoiler revocation removes all population summaries and species',()=>{
 const f=insightsFixture();f.store.set('settings:'+f.profile,{spoilers:false});const d=view(f);assert.equal(d.status,'spoilers_off');assert.equal(d.summary,null);assert.equal(d.speciesSummary,undefined);assert.equal(populationSpeciesTable(d),'');assert.doesNotMatch(JSON.stringify(d),/Test Deer|Test Duck/);
});
test('a mismatched snapshot is unavailable rather than a stale numeric total',()=>{
 const f=insightsFixture();f.source.sha='b'.repeat(64);const d=view(f);assert.equal(d.status,'unavailable');assert.equal(d.summary,null);assert.equal(d.speciesSummary,undefined);
});
test('last readable source remains labeled stale',()=>{const f=insightsFixture();f.metadata.status='error';const d=view(f);assert.equal(d.status,'stale');assert.equal(d.summary.diamonds,31);});
test('stale page revision cannot mix populations',()=>{assert.throws(()=>view(undefined,{offset:25,revision:'f'.repeat(64)}),e=>e.status===409);});
test('old providers do not synthesize species totals from page data',()=>{
 const d=readHerdView(insightsFixture().observer);delete d.speciesSummary;delete d.speciesSummaryVersion;const p=projectHerdView(d);assert.equal(p.speciesSummary,undefined);assert.match(populationSpeciesTable(p),/current herd page is not a reserve total/);
});
test('phone projection strips raw private values at every new aggregate level',()=>{
 const d=readHerdView(insightsFixture().observer);d.speciesSummary[0].privatePath='SECRET';d.speciesSummary[0].counts.seed='SECRET';assert.doesNotMatch(JSON.stringify(projectHerdView(d)),/SECRET/);
});
test('phone projection bounds aggregate cardinality',()=>{
 const d=readHerdView(insightsFixture().observer);d.speciesSummary=Array.from({length:251},(_,i)=>({...d.speciesSummary[0],key:'s'+i}));assert.throws(()=>projectHerdView(d),e=>e.status===503);
});
test('phone projection rejects duplicate aggregate identities',()=>{
 const d=readHerdView(insightsFixture().observer);d.speciesSummary.push(d.speciesSummary[0]);assert.throws(()=>projectHerdView(d),e=>e.status===503);
});
test('invalid provider numbers remain unknown, not zero',()=>{
 const d=readHerdView(insightsFixture().observer);d.speciesSummary[0].counts.diamonds=-1;const p=projectHerdView(d);assert.equal(p.speciesSummary[0].counts.diamonds,null);assert.equal(populationTrophyLabel(p.speciesSummary[0].counts,'diamonds'),'Unknown');
});
test('species aggregation is deterministic under herd order changes',()=>{
 const rows=readHerdView(insightsFixture().observer,{limit:50}).herds;assert.deepEqual(summarizeHerdSpecies(rows),summarizeHerdSpecies([...rows].reverse()));
});
test('overview renders all requested columns and female capability next to the species',()=>{
 const html=populationSpeciesTable(view());for(const name of ['Herds','Animals','Males','Females','Diamond potential','Saved Great Ones','Additional GO candidates'])assert.ok(html.includes(name));assert.match(html,/Test Duck<\/button>|Test Duck<span/);assert.match(html,/Females can reach Diamond/);assert.match(html,/All 32 matching herds/);
});
test('species names and keys are escaped in both text and data attributes',()=>{
 const d=view();d.speciesSummary[0].name='<img src=x onerror=alert(1)>';d.speciesSummary[0].key='\" onclick=alert(1)';const html=populationSpeciesTable(d);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/data-herd-species="&quot;/);
});
test('actual insights renderer mounts the canonical overview and preserves observations',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.match(source,/import \{herdWorkspaceView\} from '\.\/herd-view.js'/);
 const fn=source.slice(source.indexOf('function insights(){'),source.indexOf('\nfunction settings(){'));
 const context={state:{app:{name:'GrindZone'},settings:{spoilers:true},population:[{total:99999}],changes:[]},reserve:19,herdWorkspaceView,intro:()=>'',empty:()=>'',button:()=>'',esc:v=>String(v??''),date:()=>''};
 const html=vm.runInNewContext(fn+';insights()',context);assert.match(html,/data-overview="true"/);assert.match(html,/Population change observations/);assert.doesNotMatch(html,/Herd count|GO range candidates|99999/);
 context.state.settings.spoilers=false;assert.doesNotMatch(vm.runInNewContext(fn+';insights()',context),/<gz-herds/);
});
test('other herd workspace consumers do not acquire the overview by default',()=>{
 const state={app:{name:'GrindZone'},settings:{spoilers:true},career:{summary:{diamonds:123,greatOnes:4}}};assert.match(herdWorkspaceView(state),/data-overview="false"/);assert.match(herdWorkspaceView(state,{overview:true}),/Career Diamonds <strong>123/);
});
