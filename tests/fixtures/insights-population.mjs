/** Synthetic input for the actual ledger, classifier, query and phone projection. Not owner data. */
import {recordHerds} from '../../lib/herd-ledger.mjs';
import {HERD_REFERENCE_SCHEMA} from '../../lib/herd-trophies.mjs';
export function insightsFixture(){
 const values=new Map(),profile='synthetic-insights',at='2026-09-23T12:00:00.000Z';let serial=0;
 const animal=(fields={})=>({sex:1,weight:20,score:150,seed:++serial,nativeId:String(serial),scripted:false,greatOne:false,greatOneEvidence:'explicit_IsGreatOne',...fields});
 const group=(animals,index)=>({area:index+1,paths:[10+index,100+index,200+index],animals});
 const deer=Array.from({length:30},(_,i)=>group([animal(),animal({sex:2,score:20})],i));
 const ducks=[group([animal({sex:2}),animal({greatOne:true}),animal({greatOneEvidence:null,flags:1}),animal({scripted:true})],50)];
 const unknown=[group([animal({greatOneEvidence:null}),animal({sex:2,greatOneEvidence:null})],60)];
 const source={sha:'a'.repeat(64),mtime:at,payload:{seed:'synthetic-reserve',populations:[{hash:'101',revision:1,groups:deer},{hash:'102',revision:1,groups:ducks},{hash:'103',revision:1,groups:unknown}]}};
 const metadata={name:'animal_population_19',status:'ok',checked:at};
 const store={get:(key,fallback)=>values.has(key)?values.get(key):fallback,set:(key,v)=>values.set(key,structuredClone(v)),sources:()=>[metadata],journal:()=>[]};
 store.set('settings:'+profile,{spoilers:true});recordHerds(store,profile,19,source);
 const observer={profile,store,lastError:null,reference:{populations:{101:{key:'fixture_deer',name:'Test Deer'},102:{key:'fixture_duck',name:'Test Duck'}}},
  herdReference:{schema:HERD_REFERENCE_SCHEMA,species:{fixture_deer:{diamondScore:100,maleDiamondCapable:true,femaleDiamondCapable:false},fixture_duck:{diamondScore:100,maleDiamondCapable:true,femaleDiamondCapable:true}}},
  source:name=>name==='animal_population_19'?source:null,describeZones:zones=>zones,zoneSourceStatus:()=> 'ok'};
 return {observer,source,metadata,store,profile,values,animal};
}
