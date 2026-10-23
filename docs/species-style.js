// Great One eligibility is a species fact, not a prediction about an animal.
// Keep exact catalog names/keys and the reference guide's supported aliases.
export const GREAT_ONE_COLOR = '#f0c76d';
const normalize = value => typeof value === 'string'
  ? value.normalize('NFKC').trim().toLowerCase().replace(/[\s_-]+/g, '')
  : '';
const greatOneNames = new Set([
  'black_bear', 'fallow_deer', 'gray_wolf', 'jaguar', 'moose',
  'mule_deer', 'pheasant', 'Ring-Necked Pheasant', 'red_deer',
  'red_fox', 'roe_deer', 'tahr', 'taruca', 'whitetail_deer',
  'whitetail', 'wild_boar',
].map(normalize));
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function isGreatOneSpecies(value, key) {
  return greatOneNames.has(normalize(key)) || greatOneNames.has(normalize(value));
}

export function isUnidentifiedSpecies(name) {
  return !name || /^(?:Species(?: hash)? \d+|Unresolved species)$/i.test(name);
}

export function speciesName(name, key, traits) {
  const label = escape(isUnidentifiedSpecies(name) ? 'Unidentified animal' : name);
  const rendered = isGreatOneSpecies(name, key)
    ? `<span class="great-one-name" title="Great One species">${label}<span class="species-accessible-cue"> (Great One species)</span></span>`
    : label;
  if(traits?.femaleDiamondCapable===true)return rendered+femaleDiamondMarker();
  if(globalThis.customElements&&traits?.femaleDiamondCapable!==false)return rendered+`<gz-female-diamond data-species="${escape(key||name)}"></gz-female-diamond>`;
  return rendered;
}

export function femaleDiamondMarker(){return '<span class="female-diamond-mark" role="img" aria-label="Females can reach Diamond" title="Females can reach Diamond. This is a species capability, not this animal’s medal.">♀</span>';}
export function femaleDiamondCapability(catalog,name){
 const aliases={whitetail:'whitetaildeer',pheasant:'ringneckedpheasant'},key=aliases[normalize(name)]||normalize(name);
 const row=catalog?.species?.find(s=>[normalize(s.key),normalize(s.name)].includes(key));
 return typeof row?.herdTrophies?.femaleDiamondCapable==='boolean'?row.herdTrophies.femaleDiamondCapable:null;
}
const MarkerBase=globalThis.HTMLElement||class {};
class FemaleDiamond extends MarkerBase{
 async connectedCallback(){
  const ticket=(this.ticket||0)+1;this.ticket=ticket;
  try{const {getCatalog}=await import('./data-client.js'),catalog=await getCatalog('reference');
   if(!this.isConnected||ticket!==this.ticket)return;
   this.innerHTML=femaleDiamondCapability(catalog,this.dataset.species)===true?femaleDiamondMarker():'';
  }catch{if(this.isConnected&&ticket===this.ticket)this.textContent='';}
 }
 disconnectedCallback(){this.ticket=(this.ticket||0)+1;}
}
if(globalThis.customElements&&!customElements.get('gz-female-diamond'))customElements.define('gz-female-diamond',FemaleDiamond);
