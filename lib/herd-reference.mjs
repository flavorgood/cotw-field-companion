import {existsSync,readFileSync} from 'node:fs';
import {HERD_REFERENCE_SCHEMA} from './herd-trophies.mjs';
/** Generated from a pinned public source during packaging. Never fetches player data. */
export function loadHerdReference(file=new URL('./herd-reference.json',import.meta.url)){
 if(!existsSync(file))return null;
 const raw=readFileSync(file);if(raw.length>512*1024)throw Error('Herd reference exceeds limit');
 const value=JSON.parse(raw);if(value.schema!==HERD_REFERENCE_SCHEMA||!value.species||value.source?.blob!=='4f531a152ad254633832e76cee54c7e25cd0abbc')throw Error('Unsupported herd reference');
 return value;
}
export function withHerdReference(catalog,reference){
 if(!catalog)return catalog;
 return {...catalog,species:catalog.species.map(row=>({...row,herdTrophies:reference?.species?.[row.key]??null})),herdReferenceSource:reference?.source??null};
}
