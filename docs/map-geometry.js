/** Geometry from reserve metadata, in game X/Z coordinates. No geographic projection or Y flip. */
export function validBounds(b){return Array.isArray(b)&&b.length===2&&b.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))&&b[1][0]>b[0][0]&&b[1][1]>b[0][1];}
export function validBox(b){return Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[2]>0&&b[3]>0;}
export function homeBox(reserve){const b=reserve.bounds;if(!validBounds(b))throw Error('Reserve bounds unavailable');const w=b[1][0]-b[0][0],h=b[1][1]-b[0][1];return [b[0][0]-w*.025,b[0][1]-h*.025,w*1.05,h*1.05];}
export function insideBounds(bounds,x,z){return validBounds(bounds)&&Number.isFinite(x)&&Number.isFinite(z)&&x>=bounds[0][0]&&x<=bounds[1][0]&&z>=bounds[0][1]&&z<=bounds[1][1];}
/** Collapse only anonymous, crowded zones at wide zoom; all source zones remain in map data. */
export function zoneMarkerPlan(zones,box,worldPerPixel,{cluster=false,selectedId=null,routeIds=new Set(),cellPixels=36}={}){
  if(!validBox(box)||!Number.isFinite(worldPerPixel)||worldPerPixel<=0)return {zones:[],clusters:[],visibleCount:0};
  const margin=60*worldPerPixel,cell=cellPixels*worldPerPixel,groups=new Map(),individual=[];
  let visibleCount=0;
  for(const zone of zones){
    if(!Number.isFinite(zone?.x)||!Number.isFinite(zone?.z)||zone.x<box[0]-margin||zone.x>box[0]+box[2]+margin||zone.z<box[1]-margin||zone.z>box[1]+box[3]+margin||routeIds.has(zone.id))continue;
    visibleCount++;
    if(!cluster||zone.source!=='population_path_reference'||zone.id===selectedId||zone.annotation?.name){individual.push(zone);continue;}
    const key=`${Math.floor((zone.x-box[0])/cell)}:${Math.floor((zone.z-box[1])/cell)}`;
    let group=groups.get(key);
    if(!group){group={key,count:0,sumX:0,sumZ:0,minX:zone.x,maxX:zone.x,minZ:zone.z,maxZ:zone.z,first:zone};groups.set(key,group);}
    group.count++;group.sumX+=zone.x;group.sumZ+=zone.z;
    group.minX=Math.min(group.minX,zone.x);group.maxX=Math.max(group.maxX,zone.x);
    group.minZ=Math.min(group.minZ,zone.z);group.maxZ=Math.max(group.maxZ,zone.z);
  }
  const clusters=[];
  for(const group of groups.values()){
    if(group.count===1){individual.push(group.first);continue;}
    clusters.push({key:group.key,count:group.count,x:group.sumX/group.count,z:group.sumZ/group.count,minX:group.minX,maxX:group.maxX,minZ:group.minZ,maxZ:group.maxZ});
  }
  return {zones:individual,clusters,visibleCount};
}
export function tileUrl(reserve,zoom,x,y){
 if(!Number.isInteger(reserve.id)||reserve.id<0||reserve.id>999)throw Error('Invalid reserve ID');
 const max=Number.isInteger(reserve.maxZoom)?Math.min(5,reserve.maxZoom):5;
 if(![zoom,x,y].every(Number.isInteger)||zoom<0||zoom>max||x<0||y<0||x>=2**zoom||y>=2**zoom)throw Error('Invalid tile address');
 return `https://mathartbang.com/deca/hp/data/r${reserve.id}/t_topo/${zoom}/${x}/${y}.png`;
}
export function tilePlan(reserve,box,screenWidth=850,maxTiles=64){
 if(!validBounds(reserve.mapBounds)||!validBox(box))return [];
 const bounds=reserve.mapBounds,[min,max]=bounds,W=max[0]-min[0],H=max[1]-min[1];
 const pixels=Number.isFinite(screenWidth)?Math.max(256,Math.min(2400,screenWidth)):850;
 let zoom=Math.max(0,Math.min(reserve.maxZoom??5,5,Math.ceil(Math.log2(W/box[2]*pixels/256))));
 function at(z){const count=2**z,w=W/count,h=H/count;
  const x0=Math.max(0,Math.floor((box[0]-min[0])/w)),x1=Math.min(count-1,Math.ceil((box[0]+box[2]-min[0])/w)-1);
  const y0=Math.max(0,Math.floor((box[1]-min[1])/h)),y1=Math.min(count-1,Math.ceil((box[1]+box[3]-min[1])/h)-1);
  const out=[];for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)out.push({key:`${z}/${x}/${y}`,url:tileUrl(reserve,z,x,y),zoom:z,col:x,row:y,x:min[0]+x*w,z:min[1]+y*h,width:w,height:h});return out;
 }
 let plan=at(zoom);while(plan.length>maxTiles&&zoom>0)plan=at(--zoom);return plan;
}
export function formatDistance(m){return m>=1000?(m/1000).toLocaleString(undefined,{maximumFractionDigits:2})+' km':Math.round(m).toLocaleString()+' m';}
export function scaleBar(box,pixels){if(!validBox(box)||!Number.isFinite(pixels)||pixels<=0)return null;const raw=box[2]/pixels*110,pow=10**Math.floor(Math.log10(raw));const length=[1,2,5,10].map(n=>n*pow).filter(n=>n<=raw).at(-1)||pow;return {length,pixels:length/box[2]*pixels,label:formatDistance(length)};}
