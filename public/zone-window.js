export const ZONE_PAGE_SIZE=60;

export function huntZonesForSpecies(zones,species){
 if(!species||species==='all')return [];
 return zones.filter(zone=>zone.species===species);
}

export function huntRouteForSpecies(zones,route,species){
 if(!species||species==='all')return {route:[],routeZones:[]};
 const routeIds=new Set(route),routeZones=zones.filter(zone=>zone.species===species&&routeIds.has(zone.id)),visibleIds=new Set(routeZones.map(zone=>zone.id));
 return {route:route.filter(id=>visibleIds.has(id)),routeZones};
}

export function visibleZonePage(zones,{page=0,selectedId=null}={}){
 const pageCount=Math.max(1,Math.ceil(zones.length/ZONE_PAGE_SIZE));
 const currentPage=Math.max(0,Math.min(pageCount-1,Math.floor(page)||0));
 const from=currentPage*ZONE_PAGE_SIZE,to=Math.min(zones.length,from+ZONE_PAGE_SIZE);
 const visible=zones.slice(from,to);
 const selected=selectedId==null?null:zones.find(zone=>zone.id===selectedId);
 const pinned=!!selected&&!visible.some(zone=>zone.id===selectedId);
 if(pinned)visible.unshift(selected);
 return {zones:visible,total:zones.length,shown:visible.length,from,to,page:currentPage,pageCount,hasPrevious:currentPage>0,hasNext:currentPage<pageCount-1,pinnedId:pinned?selectedId:null};
}
