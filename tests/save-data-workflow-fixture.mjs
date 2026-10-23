/** Synthetic binary saves for the real reader and paired UI. Never imported by runtime code. */
import {writeFileSync,utimesSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fixture,defs,animal} from './fixtures.mjs';
export const SAVE_TIME='2026-09-20T10:00:00.000Z';
export const workflowDefs={...defs,
  profile:{Level:'u32',Xp:'u32',Cash:'u32',SkillPoints:'u32',PerkPoints:'u32'},
  player:{NumUnharvestedAnimals:'u32',AnimalHarvestStreak:'u32',TimeOfDay:'f32'},
  bait:{BaitAmountLeft:'f32',IsDestroyed:'u8'},
  worldItem:{ReserveId:'u32',SaveLinkId:'u64',Position:'vector',EquipmentHash:'u32',BaitSiteData:'bait[]'},
  worldItems:{WorldItems:'worldItem[]'}
};
export function writeProfile(save,{cash=18750,level=42,xp=9000,skillPoints=3,perkPoints=2,savedAt=SAVE_TIME}={}){
  const bytes=fixture(workflowDefs,'profile',{Level:level,Xp:xp,Cash:cash,SkillPoints:skillPoints,PerkPoints:perkPoints});
  const file=path.join(save,'thp_player_profile_adf');writeFileSync(file,bytes);utimesSync(file,new Date(savedAt),new Date(savedAt));return bytes;
}
export function writeSaveDataFixture(save){
  // The same small assigned-zone dataset used by the existing discovery tests.
  const population={ReserveSeed:123,Populations:[{NameHashId:3845994887,Revision:1,Groups:[{SpawnAreadId:100,NeedZonePathGuids:[101,102,103],Animals:[animal(1),animal(2,2)]}]}]};
  const zones={NZData:[{ReserveId:19,NeedZoneData:[{Position:{X:8064,Y:0,Z:8000},NeedZoneId:102,NeedType:2,NeedZoneStartTimeHours:8,NeedZoneEndTimeHours:16,AnimalTypeLocalizationName:1124598738,NeedZoneScheduleIndex:1}]}]};
  const discovered={'animal_population_19':fixture(defs,'rootPopulation',population),found_need_zones_adf:fixture(defs,'rootZones',zones),hunting_log_adf:fixture(defs,'rootHarvest',{HarvestHistory:[]}),reserveworlddata_adf:fixture(defs,'rootReserve',{Reserve:19})};
  for(const [name,bytes]of Object.entries(discovered))writeFileSync(path.join(save,name),bytes);
  writeProfile(save);
  writeFileSync(path.join(save,'playerinformation_adf'),fixture({player:workflowDefs.player},'player',{NumUnharvestedAnimals:2,AnimalHarvestStreak:9,TimeOfDay:12}));
  writeFileSync(path.join(save,'worlditemsdata_adf'),fixture(workflowDefs,'worldItems',{WorldItems:[
    {ReserveId:19,SaveLinkId:1001,Position:{X:8000,Y:0,Z:8100},EquipmentHash:123456,BaitSiteData:[{BaitAmountLeft:0,IsDestroyed:0}]},
    {ReserveId:1,SaveLinkId:1002,Position:{X:5000,Y:0,Z:5100},EquipmentHash:123457,BaitSiteData:[]}
  ]}));
  writeFileSync(path.join(save,'health_component_manager_adf'),fixture(workflowDefs,'rootHealth',{SavedHealthComponentList:[{HealhComponentId:1,MaxHealth:100,CurrentHealth:50}]}));
  for(const name of readdirSync(save))utimesSync(path.join(save,name),new Date(SAVE_TIME),new Date(SAVE_TIME));
  return saveHashes(save);
}
export function saveHashes(save){return Object.fromEntries(readdirSync(save).sort().map(name=>[name,createHash('sha256').update(readFileSync(path.join(save,name))).digest('hex')]));}
