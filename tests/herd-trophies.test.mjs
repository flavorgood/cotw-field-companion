import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveHerdReference,trophyCounts,findHerdRule} from '../lib/herd-trophies.mjs';
import {speciesName,femaleDiamondCapability} from '../public/species-style.js';
const raw=(femaleMax,maleMax=300,diamond=250)=>({gender:{male:{score_high:maleMax,weight_low:60,weight_high:100},female:{score_high:femaleMax,weight_low:40,weight_high:60},great_one_male:{weight_low:101,weight_high:110}},trophy:{diamond:{score_low:diamond}},truracs:true});
const reference=deriveHerdReference({female_possible:raw(300),male_only:raw(0),female_only:raw(300,200),unknown:{}});
const animal=(sex,score,extra={})=>({sex,score,weight:80,flags:0,greatOne:false,greatOneEvidence:'explicit_IsGreatOne',scripted:false,...extra});
test('female capability follows sex-specific maximum versus the species Diamond threshold',()=>{
 assert.equal(reference.species.female_possible.femaleDiamondCapable,true);assert.equal(reference.species.male_only.femaleDiamondCapable,false);assert.equal(reference.species.female_only.maleDiamondCapable,false);assert.equal(reference.species.unknown.femaleDiamondCapable,null);
});
test('Diamond score thresholds use exact stored values without display rounding',()=>{
 const c=trophyCounts([animal(1,249.99999),animal(1,250),animal(2,260)],reference.species.female_possible);assert.equal(c.diamonds,2);assert.equal(c.greatOnes,0);
});
test('explicit Great Ones are a separate count and never counted a second time as Diamonds',()=>{
 const c=trophyCounts([animal(1,300,{greatOne:true}),animal(1,300)],reference.species.female_possible);assert.equal(c.greatOnes,1);assert.equal(c.diamonds,1);assert.equal(c.animals,2);
});
test('legacy flags and weight matches stay candidates, not confirmed Great Ones or Diamonds',()=>{
 const c=trophyCounts([animal(1,300,{greatOne:null,greatOneEvidence:null,flags:1}),animal(1,300,{greatOneEvidence:null,weight:105})],reference.species.female_possible);assert.equal(c.greatOneCandidates,2);assert.equal(c.greatOnes,0);assert.equal(c.diamonds,0);
});
test('scripted animals are not silently counted as ordinary Diamond or Great One spawns',()=>{
 const c=trophyCounts([animal(1,300,{scripted:true,greatOne:true})],reference.species.female_possible);assert.equal(c.scripted,1);assert.equal(c.greatOnes,0);assert.equal(c.diamonds,0);
});
test('female-ineligible species do not count high-scoring females as Diamond potential',()=>{
 assert.equal(trophyCounts([animal(2,300)],reference.species.male_only).diamonds,0);
});
test('missing reference produces unavailable Diamond classification, not an invented zero',()=>{
 const c=trophyCounts([animal(1,300)],null);assert.equal(c.diamonds,null);assert.equal(c.unclassified,1);
});
test('the female symbol describes species capability without replacing the Great One cue',()=>{
 const html=speciesName('Red Fox','red_fox',{femaleDiamondCapable:true});assert.match(html,/♀/);assert.match(html,/Great One species/);assert.match(html,/Females can reach Diamond/);
 assert.doesNotMatch(speciesName('Whitetail Deer','whitetail',{femaleDiamondCapable:false}),/♀/);
});
test('marker lookup matches canonical keys and names and leaves unknowns unmarked',()=>{
 const catalog={species:[{key:'gemsbok',name:'Gemsbok',herdTrophies:{femaleDiamondCapable:true}},{key:'whitetail_deer',name:'Whitetail Deer',herdTrophies:{femaleDiamondCapable:false}}]};
 assert.equal(femaleDiamondCapability(catalog,'GEMSBOK'),true);assert.equal(femaleDiamondCapability(catalog,'whitetail'),false);assert.equal(femaleDiamondCapability(catalog,'unknown'),null);
});
test('species names and marker attributes cannot inject markup',()=>{
 const html=speciesName('<script>bad</script>','x',{femaleDiamondCapable:true});assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
