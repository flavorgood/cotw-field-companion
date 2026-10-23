// In-game equipment, never real-money DLC prices. Unknown prices stay null.
export const setupItems=Object.freeze({
 tent:{name:'Tent',kind:'tent',price:16000,priceSource:'https://thehuntercotw.fandom.com/wiki/Elite_2_Tent',priceChecked:'2026-09-19'},
 tripod:{name:'Tripod stand',kind:'tripod',price:16000,priceSource:'https://thehuntercotw.fandom.com/wiki/Tripod_Stands',priceChecked:'2026-09-19'},
 treestand:{name:'Tree stand',kind:'treestand',price:16000,priceSource:'https://thehuntercotw.wordpress.com/items/portable-structures/',priceChecked:'2026-09-19',sourceUpdated:'2023-10-11'},
 groundblind:{name:'Ground blind',kind:'blind',price:8000,priceSource:'https://thehuntercotw.fandom.com/wiki/Groundblinds',priceChecked:'2026-09-19'},
 bait_barrel:{name:'Bait barrel',kind:'feeder',saveName:'BAIT BARREL',price:null},
 carcass:{name:'Carcass feeder',kind:'feeder',saveName:'CARCASS FEEDER',price:null},
 mineral:{name:'Mineral lick feeder',kind:'feeder',saveName:'MINERAL LICK FEEDER',price:null},
 post:{name:'Post feeder',kind:'feeder',saveName:'POST FEEDER',price:null},
 box:{name:'Box feeder',kind:'feeder',saveName:'BOX FEEDER',price:null},
 scent_tube:{name:'Scent tube feeder',kind:'feeder',saveName:'SCENT TUBE FEEDER',price:null},
});
export const feederItems=Object.keys(setupItems).filter(key=>setupItems[key].kind==='feeder');
export const standItems=['tripod','treestand','groundblind'];
export const defaultStopSetup=Object.freeze({version:0,tent:'auto',stand:'auto',standType:'tripod',feeder:'none',feederType:null,structureId:null,structureBuilt:false,structureCost:null});
