import {tilePlan,tileUrl,validBounds} from './map-geometry.js?v=9312d4049b222121';
const NS='http://www.w3.org/2000/svg';
function group(){const n=document.createElementNS(NS,'g');n.setAttribute('pointer-events','none');return n;}
/** Keep image nodes alive across save refreshes and panning; never refetch on every frame. */
export class TerrainLayer{
 constructor(onStatus=()=>{}){this.node=group();this.base=group();this.detail=group();this.node.append(this.base,this.detail);this.onStatus=onStatus;this.entries=new Map();this.current=[];this.active=false;this.disposed=false;this.lastStatus='';}
 reset(){for(const e of this.entries.values())clearTimeout(e.timer);this.entries.clear();this.base.replaceChildren();this.detail.replaceChildren();this.current=[];this.lastStatus='';}
 image(key,url,rect,parent){let item=this.entries.get(key);if(item){item.used=Date.now();return item;}
  const node=document.createElementNS(NS,'image');for(const [k,v]of Object.entries({x:rect.x,y:rect.z,width:rect.width,height:rect.height,preserveAspectRatio:'none','data-tile':key,referrerpolicy:'no-referrer'}))node.setAttribute(k,String(v));
  item={node,state:'loading',used:Date.now(),timer:null};this.entries.set(key,item);
  const settle=state=>{if(this.disposed||this.entries.get(key)!==item)return;clearTimeout(item.timer);item.state=state;node.setAttribute('data-load-state',state);if(state==='error')node.setAttribute('visibility','hidden');else node.removeAttribute('visibility');this.report();};
  node.addEventListener('load',()=>settle('loaded'),{once:true});node.addEventListener('error',()=>settle('error'),{once:true});
  item.timer=setTimeout(()=>settle('error'),15000);node.setAttribute('data-load-state','loading');node.setAttribute('href',url);parent.append(node);return item;
 }
 update(reserve,box,enabled,pixels){
  if(this.disposed)return;this.active=!!enabled;this.node.style.display=enabled?'':'none';
  if(this.reserve!==reserve.id){this.reset();this.reserve=reserve.id;}
  this.last={reserve,box:[...box],enabled,pixels};
  if(!enabled){this.report();return;}if(!validBounds(reserve.mapBounds)){this.current=[];this.report('unavailable');return;}
  const [min,max]=reserve.mapBounds,overview=this.image('overview',tileUrl(reserve,0,0,0),{x:min[0],z:min[1],width:max[0]-min[0],height:max[1]-min[1]},this.base);
  const tiles=tilePlan(reserve,box,pixels);this.outside=tiles.length===0;this.current=tiles.filter(t=>t.zoom!==0).map(t=>t.key);
  const wanted=new Set(this.current);for(const [key,e]of this.entries)if(key!=='overview')e.node.style.display=wanted.has(key)?'':'none';
  for(const t of tiles)if(t.zoom!==0){const item=this.image(t.key,t.url,t,this.detail);item.node.style.display='';}
  const removable=[...this.entries].filter(([k,e])=>k!=='overview'&&!wanted.has(k)&&e.state!=='loading').sort((a,b)=>a[1].used-b[1].used);
  while(this.entries.size>96&&removable.length){const [key,e]=removable.shift();clearTimeout(e.timer);e.node.remove();this.entries.delete(key);}
  this.report();
 }
 report(forced){if(this.disposed)return;const base=this.entries.get('overview'),visible=this.current.map(k=>this.entries.get(k)).filter(Boolean),loaded=visible.filter(e=>e.state==='loaded').length,failed=visible.filter(e=>e.state==='error').length,pending=visible.filter(e=>e.state==='loading').length;
  let status=forced||(!this.active?'disabled':this.outside?'outside':!base?'loading':base.state==='error'&&!loaded?'error':failed?'partial':pending||base.state==='loading'?'loading':'ready');
  const packet={reserve:this.reserve,status,loaded,failed,pending,overview:base?.state??'missing',visibleTiles:visible.length};const key=JSON.stringify(packet);if(key===this.lastStatus)return;this.lastStatus=key;this.onStatus(packet);
 }
 retry(){if(!this.last||this.disposed)return;for(const [key,e]of this.entries)if(e.state==='error'){clearTimeout(e.timer);e.node.remove();this.entries.delete(key);}this.lastStatus='';const {reserve,box,enabled,pixels}=this.last;this.update(reserve,box,enabled,pixels);}
 destroy(){this.disposed=true;this.reset();this.node.remove();}
}
