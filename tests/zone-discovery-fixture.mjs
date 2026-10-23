/** Synthetic fixtures only. Real public-reference acceptance is separate from these test coordinates. */
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fixture,defs,animal} from './fixtures.mjs';
import {normalizeZoneReference} from '../lib/zone-discovery.mjs';
export const discoveryHash=3845994887;
export const discoveryRawReference=()=>({center:[8192,8192],scale:[32,32],areas:{deer:{population_name:'Whitetail Deer',layers:{'0':{spawn:{key:100,Tiles:[32890],SpawnCenterPoints:[]}},'1':{feed:{key:101,Tiles:[32895,32896],SpawnCenterPoints:[]}},'2':{drink:{key:102,Tiles:[32638,32639],SpawnCenterPoints:[]}},'3':{rest:{key:103,Tiles:[33156,33157],SpawnCenterPoints:[]}}}}},population_info:{[discoveryHash]:{start_times:[0,8,16],need_types:{'0.0':1,'8.0':2,'16.0':3}}}});
export function discoveryCatalog(){const raw=discoveryRawReference();return normalizeZoneReference(raw,{reserve:19,sha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),fetchedAt:new Date().toISOString()});}
export const discoveryReference={reserves:{19:{id:19,name:'Synthetic reserve',bounds:[[5696,4296],[13888,12488]],mapBounds:[[0,0],[16384,16384]]}},populations:{[discoveryHash]:{name:'Whitetail Deer',key:'whitetail'}}};
export function discoveredSave(ids=[102]){return fixture(defs,'rootZones',{NZData:[{ReserveId:19,NeedZoneData:ids.map(id=>{const slot=id-101;return {Position:{X:8000+(id-101)*64,Y:0,Z:8000},NeedZoneId:id,NeedType:slot+1,NeedZoneStartTimeHours:slot*8,NeedZoneEndTimeHours:(slot+1)*8%24,AnimalTypeLocalizationName:1124598738,NeedZoneScheduleIndex:slot};})}]});}
export function writeDiscoveryFixture(save){
 const population={ReserveSeed:123,Populations:[{NameHashId:discoveryHash,Revision:1,Groups:[{SpawnAreadId:100,NeedZonePathGuids:[101,102,103],Animals:[animal(1),animal(2,2)]}]}]};
 const files={'animal_population_19':fixture(defs,'rootPopulation',population),found_need_zones_adf:discoveredSave(),hunting_log_adf:fixture(defs,'rootHarvest',{HarvestHistory:[]}),reserveworlddata_adf:fixture(defs,'rootReserve',{Reserve:19})};
 for(const [name,bytes]of Object.entries(files))writeFileSync(path.join(save,name),bytes);
 return files;
}
export function readyDiscoveryReader(catalog=discoveryCatalog()){
 return {calls:0,current:catalog,currentStatus:'ready',ensure(_r,{enabled}={}){if(enabled)this.calls++;return Promise.resolve(this.current);},catalog(){return this.current;},status(){return this.currentStatus;},suspend(){},close(){}};
}
