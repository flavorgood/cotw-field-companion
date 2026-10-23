export const savedAt='2026-09-21T10:00:00.000Z';
export const source=payload=>({payload,mtime:savedAt,checked:savedAt,sha:'a'.repeat(64)});
export const animal=(sex,weight,score)=>({sex,weight,score,seed:987654321,flags:99,scripted:false});
export function fixture(){
 const state={selectedReserve:19,observer:{connected:true},settings:{spoilers:true},reserves:[{id:19,name:'Askiy Ridge'},{id:1,name:'Other reserve'}],zones:['drinking','feeding','resting'].map((need,i)=>({id:'zone:'+i,reserve:19,speciesKey:'whitetail_deer',need}))};
 const profileSource=source({level:42,xp:9000,cash:18750,skillPoints:3,perkPoints:2,accountId:'PRIVATE-ACCOUNT'});
 const playerSource=source({unharvested:2,harvestStreak:9,timeOfDay:5555,private:'PRIVATE-PLAYER'});
 const populationSource=source({populations:[{hash:'123',groups:[{animals:[animal(1,100,250),animal(1,80,190),animal(2,60,0)],paths:[111,222,333]}]}],private:'PRIVATE-POPULATION'});
 const equipment=[{id:'item:1',reserve:19,label:'Saved feeder',source:'save',typeVerified:true,x:1234,z:5678,bait:[{amount:0,destroyed:false}],private:'PRIVATE-EQUIPMENT'},{id:'item:2',reserve:1,label:'Saved tent',source:'save',typeVerified:true,x:1200,z:900,bait:[]}];
 const statusByName=Object.fromEntries(['thp_player_profile_adf','playerinformation_adf','animal_population_19','worlditemsdata_adf'].map(n=>[n,{status:'ok'}]));
 return {state,profileSource,playerSource,populationSource,equipmentSource:source(equipment),equipment,statusByName,reference:{populations:{123:{name:'Whitetail Deer',key:'whitetail_deer'}}}};
}
