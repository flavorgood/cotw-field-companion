import test from 'node:test';
import assert from 'node:assert/strict';
import {FieldMap} from '../public/map.js';
import {huntRouteForSpecies,huntZonesForSpecies,visibleZonePage} from '../public/zone-window.js';

// Stub only SVG nodes and terrain/pressure rendering. The real update, draw,
// layer, selection and fitRoute methods execute against the saved route data.
function node(tag = 'g') {
  return {
    tag, attributes: new Map(), children: [], listeners: new Map(), classes: new Set(), text: '',
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    append(...children) { for (const child of children) child.parent = this; this.children.push(...children); },
    remove() { if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null; },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    set textContent(value) { this.text = String(value); },
    get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); },
    getComputedTextLength() { return this.textContent.length * Number(this.getAttribute('font-size')) * .6; },
    get dataset() { return Object.fromEntries([...this.attributes].filter(([name]) => name.startsWith('data-')).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()), value])); },
    closest(selector) { return this.attributes.has(selector.slice(1, -1)) ? this : this.parent?.closest(selector) ?? null; },
    get classList() { return {toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)}; },
    querySelectorAll(selector) { return descendants(this).filter(child => child.attributes.has(selector.slice(1, -1))); },
  };
}
function descendants(parent) { return parent.children.flatMap(child => [child, ...descendants(child)]); }
function harness(t, size = {width: 500, height: 500}) {
  const originalDocument = globalThis.document;
  globalThis.document = {createElementNS: (_namespace, tag) => node(tag)};
  t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
  const svg = node('svg'), overlay = node(), selected = [], terrainCalls = [], pressureCalls = [];
  svg.getBoundingClientRect = () => size;
  svg.append(overlay);
  const map = Object.assign(Object.create(FieldMap.prototype), {
    svg, overlay, background: node('rect'), box: [0, 0, 1000, 1000], reserve: 19,
    point: null, poiFilter: 'all',
    layers: {route: true, zones: true, equipment: true, poi: true, grid: false, pressure: true},
    terrain: {update: (...args) => terrainCalls.push(args)},
    pressure: {update: (...args) => pressureCalls.push(args)},
    onSelect: id => selected.push(id), onPoint() {},
  });
  const reserve = {id: 19, bounds: [[0, 0], [1000, 1000]], poi: []};
  const update = data => map.update({reserve, terrain: true, ...data});
  const nodes = attribute => descendants(overlay).filter(child => child.attributes.has(attribute));
  return {map, update, nodes, selected, terrainCalls, pressureCalls};
}
const zone = (id, x, z, extra = {}) => ({id, x, z, species: 'Moose', need: 'drinking', start: 6, end: 10, ...extra});

test('Hunt requires a species before rendering reference zones, saved zones, cards or route markers', t => {
  const h=harness(t),references=Array.from({length:2970},(_,i)=>zone(`mallard-${i}`,50+i%55*70,50+Math.floor(i/55)*70,{species:'Mallard',source:'population_path_reference'}));
  const moose=zone('saved-moose',200,200,{source:'save'}),zones=[...references,moose],route=['mallard-0','saved-moose'];
  h.map.box=[0,0,4000,4000];
  const unselected={zones:huntZonesForSpecies(zones,'all'),...huntRouteForSpecies(zones,route,'all')};
  assert.equal(visibleZonePage(unselected.zones).total,0,'the zone list has no cards before selection');
  h.update({...unselected,equipment:[{id:'tent',x:300,z:300,kind:'tent',label:'Saved tent'}]});
  assert.equal(h.map.data.zones.length,0,'the map receives no zones to cluster');
  assert.equal(h.nodes('data-zone').length,0);
  assert.equal(h.nodes('data-zone-cluster').length,0);
  assert.equal(h.nodes('data-route-stop').length,0,'another animal’s route cannot leak a location');
  assert.equal(h.nodes('data-pin').some(item=>item.getAttribute('data-pin')==='tent'),true,'equipment remains useful without animal markers');
  const selected={zones:huntZonesForSpecies(zones,'Moose'),...huntRouteForSpecies(zones,route,'Moose')};
  assert.deepEqual(selected.zones.map(item=>item.id),['saved-moose']);
  assert.deepEqual(selected.route,['saved-moose']);
  assert.equal(visibleZonePage(selected.zones).total,1);
  h.update({...selected,equipment:[{id:'tent',x:300,z:300,kind:'tent',label:'Saved tent'}]});
  assert.deepEqual([...new Set(h.nodes('data-zone').filter(item=>item.tag==='g').map(item=>item.getAttribute('data-zone')))],['saved-moose']);
  assert.deepEqual(h.nodes('data-route-stop').map(item=>item.getAttribute('data-zone')),['saved-moose']);
  assert.equal(h.nodes('data-zone-cluster').length,0);
});

test('a crowded whole-reserve map groups reference zones and zooms to individual markers', t => {
  const h=harness(t),references=Array.from({length:2971},(_,i)=>zone(`reference-${i}`,50+i%55*70,50+Math.floor(i/55)*70,{source:'population_path_reference'}));
  const discovered=zone('discovered',150,150,{source:'save'}),offscreen=zone('offscreen',10000,10000,{source:'population_path_reference'});
  h.map.box=[0,0,4000,4000];
  h.update({zones:[...references,discovered,offscreen],routeZones:references,route:['reference-0'],selectedZone:'reference-2970'});
  const markerGroups=h.nodes('data-zone').filter(n=>n.tag==='g'),clusters=h.nodes('data-zone-cluster').filter(n=>n.tag==='g');
  assert.ok(markerGroups.length+clusters.length<350,'the initial SVG does not contain thousands of zone markers');
  assert.ok(clusters.length>0);
  assert.ok(clusters.every(n=>/\d+ undiscovered reference areas/.test(n.getAttribute('aria-label'))),'clusters report real counts and their zoom action');
  assert.ok(markerGroups.some(n=>n.getAttribute('data-zone')==='discovered'),'discovered zones stay individually selectable');
  assert.ok(markerGroups.some(n=>n.getAttribute('data-zone')==='reference-2970'),'selected reference stays individually selectable');
  assert.ok(h.nodes('data-route-stop').some(n=>n.getAttribute('data-zone')==='reference-0'),'route stop remains numbered');
  assert.ok(!markerGroups.some(n=>n.getAttribute('data-zone')==='offscreen'),'offscreen references do not get SVG markers');
  const before=h.map.box[2];let prevented=false;
  clusters[0].listeners.get('keydown')({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.ok(h.map.box[2]<before,'cluster action zooms into its area');
  assert.equal(h.nodes('data-zone-cluster').filter(n=>n.tag==='g').length,0,'detail zoom reveals individual references');
  assert.ok(h.nodes('data-zone').some(n=>n.tag==='g'&&n.getAttribute('data-zone')?.startsWith('reference-')));
  assert.equal(h.map.data.selectedZone,'reference-2970','zoom does not change selection');
  assert.equal(h.map.point,null,'zoom does not invent a selected coordinate');
  h.map.box=[0,0,4000,4000];h.map.draw();
  Object.assign(h.map,{abort:new AbortController(),pointers:new Map(),pinch:null,toWorld:e=>[e.clientX,e.clientY]});
  h.map.svg.setPointerCapture=()=>{};h.map.svg.hasPointerCapture=()=>false;h.map.setEvents();
  const target=h.nodes('data-zone-cluster').find(n=>n.tag==='g'),event={target,button:0,pointerId:1,clientX:100,clientY:100};
  h.map.svg.listeners.get('pointerdown')(event);h.map.svg.listeners.get('pointerup')(event);
  assert.ok(h.map.box[2]<4000,'pointer activation also zooms the cluster');
  assert.deepEqual(h.selected,[],'cluster activation does not select an arbitrary animal zone');
});

test('route markers and directed legs survive an empty species-filtered zone list', t => {
  const h = harness(t), full = [zone('a', 100, 100), zone('b', 700, 700)];
  h.update({zones: [], routeZones: full, route: ['a', 'b'], selectedZone: 'b'});
  assert.deepEqual(h.nodes('data-route-stop').map(item => [item.getAttribute('data-route-stop'), item.getAttribute('data-zone')]), [['1', 'a'], ['2', 'b']]);
  assert.deepEqual(h.nodes('data-route-leg').map(item => item.getAttribute('data-route-leg')), ['1-2']);
  const arrow = h.nodes('data-route-direction')[0];
  assert.ok(arrow, 'each nonzero leg has a visible forward arrow');
  const positions = arrow.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.ok(positions[2] > positions[0] && positions[3] > positions[1], 'the arrow tip points from stop1 toward stop2');
  assert.ok(h.nodes('data-route-stop')[1].classes.has('active-zone'), 'selection remains visible on its numbered marker');
  assert.equal(h.terrainCalls.length, 1);
  assert.deepEqual(h.pressureCalls, [[null, true]]);
  h.map.layers.zones = false;
  h.map.draw();
  assert.equal(h.nodes('data-route-stop').length, 2, 'the route layer is independent of the zones layer');
});

test('drawing never adds a shortcut across a missing or invalid middle route stop', t => {
  const h = harness(t), full = [zone('a', 100, 100), zone('b', 500, 500), zone('c', 800, 800), zone('bad', NaN, 300)];
  h.update({zones: full, routeZones: full, route: ['a', 'missing', 'b', 'c', 'bad', 'a']});
  assert.deepEqual(h.nodes('data-route-stop').map(item => item.getAttribute('data-route-stop')), ['1', '3', '4', '6']);
  assert.deepEqual(h.nodes('data-route-leg').map(item => item.getAttribute('data-route-leg')), ['3-4']);
  assert.equal(h.nodes('data-route-direction').length, 1);
  assert.equal(h.nodes('data-route-leg')[0].getAttribute('pointer-events'), 'none', 'route lines cannot intercept map gestures');
});

test('route marker labels expose names and validated in-game hours and remain selectable', t => {
  const h = harness(t), full = [
    zone('night', 100, 200, {start: 20, end: 2, annotation: {name: 'North lake'}}),
    zone('unknown', 700, 600, {start: null, end: undefined}),
  ];
  h.update({routeZones: full, route: ['night', 'unknown']});
  const markers = h.nodes('data-route-stop');
  assert.match(markers[0].getAttribute('aria-label'), /Route stop 1, North lake/);
  assert.match(markers[0].textContent, /20:00–02:00 \(overnight\) in-game/);
  assert.match(markers[1].textContent, /Hours unavailable/);
  assert.doesNotMatch(markers[1].textContent, /00:00/);
  let prevented = false;
  markers[0].listeners.get('keydown')({key: 'Enter', preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.deepEqual(h.selected, ['night']);
});

test('turning the route layer off removes route marks without changing route IDs', t => {
  const h = harness(t), route = Object.freeze(['a', 'b']), full = [zone('a', 100, 100), zone('b', 700, 700)];
  h.update({zones: full, routeZones: full, route});
  h.map.setLayer('route', false);
  assert.deepEqual(h.nodes('data-route-stop'), []);
  assert.deepEqual(h.nodes('data-route-leg'), []);
  assert.equal(h.map.data.route, route);
  assert.ok(h.nodes('data-zone').some(item => item.getAttribute('data-zone') === 'a'), 'normal zone markers are restored');
  h.map.setLayer('route', true);
  assert.equal(h.nodes('data-route-stop').length, 2);
});

test('fitRoute contains only valid saved route stops and preserves selection and map point', t => {
  const h = harness(t, {width: 390, height: 844}), point = [52, 84];
  const full = [zone('a', -2000, -4000), zone('b', 4500, 7500), zone('unrelated', 50000, 50000), zone('bad', Infinity, 0)];
  h.update({zones: [], routeZones: full, route: ['a', 'missing', 'bad', 'b'], selectedZone: 'a'});
  h.map.point = point;
  h.map.layers.route = false;
  assert.equal(h.map.fitRoute(), true);
  assert.equal(h.map.layers.route, true);
  const [x, z, width, height] = h.map.box;
  assert.ok(h.map.box.every(Number.isFinite));
  for (const stop of full.slice(0, 2)) assert.ok(stop.x >= x && stop.x <= x + width && stop.z >= z && stop.z <= z + height);
  assert.ok(x + width < 50000 && z + height < 50000, 'unrelated full-source zones do not widen the route framing');
  assert.equal(h.map.data.selectedZone, 'a');
  assert.equal(h.map.point, point);
  const before = [...h.map.box];
  h.map.data.route = ['missing', 'bad'];
  assert.equal(h.map.fitRoute(), false);
  assert.deepEqual(h.map.box, before, 'an unplottable route does not reset the current pan/zoom');
});

test('saved names are drawn on ordinary zones and equipment pins', t => {
  const h = harness(t);
  h.update({zones: [zone('a', 100, 100, {annotation: {name: 'South meadow'}})], pins: [{id: 'pin', x: 700, z: 700, label: 'Tent by the river', kind: 'tent'}]});
  const text = h.map.overlay.textContent;
  assert.match(text, /South meadow/);
  assert.match(text, /Tent by the river/);
  const pin = h.nodes('data-pin').find(item => item.tag === 'g');
  const diamond = pin.children.find(item => item.tag === 'path');
  assert.match(diamond.getAttribute('d'), /l-16,16l-16,-16Z$/, 'the existing equipment marker geometry is preserved');
});

test('phone route labels switch left, stay within the viewport and retain full schedules', t => {
  const h = harness(t, {width: 390, height: 844}), longName = 'North lake beyond the old lookout with the unusually long saved name';
  h.update({routeZones: [zone('a', 12800, 7832, {annotation: {name: 'North lake'}}), zone('b', 13100, 8380, {annotation: {name: longName}, start: 20, end: 2}), zone('c', 12100, 8520)], route: ['a', 'b', 'c']});
  h.map.fitRoute();
  const names = h.nodes('data-route-name'), name = names[1], marker = h.nodes('data-route-stop')[1];
  assert.equal(name.getAttribute('text-anchor'), 'end', 'the rightmost label uses the space to its left');
  assert.equal(names[0].textContent, 'North lake', 'ordinary saved names remain complete');
  assert.ok(name.textContent.endsWith('…'), 'only an overlong alias is shortened visually');
  assert.ok(marker.getAttribute('aria-label').includes(longName), 'the complete alias remains accessible');
  assert.deepEqual([marker.getAttribute('data-world-x'), marker.getAttribute('data-world-z')], ['13100', '8380']);
  const [left, , width] = h.map.box;
  for (const text of names) {
    const x = Number(text.getAttribute('x')), measured = text.getComputedTextLength(), end = text.getAttribute('text-anchor') === 'end';
    assert.ok((end ? x - measured : x) >= left && (end ? x : x + measured) <= left + width, 'the measured name fits inside the map');
  }
  const hours = h.nodes('data-route-hours')[1];
  assert.equal(hours.children.map(line => line.textContent).join(' '), 'drinking · 20:00–02:00 (overnight)', 'wrapped hours lose no schedule information');
  for (const line of hours.children) {
    const x = Number(line.getAttribute('x')), measured = line.textContent.length * Number(hours.getAttribute('font-size')) * .6;
    assert.ok(x - measured >= left && x <= left + width, 'each schedule line fits inside the map');
  }
});

test('route label, number and padded label area select the route zone through pointer gestures', t => {
  const h = harness(t), full = [zone('a', 100, 100), zone('b', 800, 800)];
  h.update({routeZones: full, route: ['a', 'b']});
  Object.assign(h.map, {abort: new AbortController(), pointers: new Map(), pinch: null, toWorld: e => [e.clientX, e.clientY]});
  h.map.svg.setPointerCapture = () => {};
  h.map.svg.hasPointerCapture = () => false;
  h.map.setEvents();
  const marker = h.nodes('data-route-stop')[0], name = h.nodes('data-route-name')[0], number = marker.children.find(child => child.tag === 'text'), hit = h.nodes('data-route-hit')[0];
  for (const text of [name, number, h.nodes('data-route-hours')[0]]) assert.equal(text.getAttribute('style'), 'pointer-events:all', 'inline pointer behavior overrides the shared noninteractive map-text CSS');
  assert.ok(Number(hit.getAttribute('width')) >= 88 && Number(hit.getAttribute('height')) >= 88, 'the hit rectangle covers at least 44 screen pixels at the current scale');
  const hitLayer = h.nodes('data-map-hit-layer')[0];
  assert.ok(h.map.overlay.children.indexOf(hitLayer) < h.map.overlay.children.indexOf(marker), 'padded hit targets cannot cover another visible marker');
  for (const target of [name, number, hit]) {
    const event = {target, button: 0, pointerId: 1, clientX: 150, clientY: 100};
    h.map.svg.listeners.get('pointerdown')(event);
    h.map.svg.listeners.get('pointerup')(event);
  }
  assert.deepEqual(h.selected, ['a', 'a', 'a']);
  assert.equal(h.map.point, null, 'route label taps do not create a map point');
});

test('route species labels use Great One gold while saved aliases stay neutral', t => {
  const h = harness(t);
  h.update({routeZones: [zone('a', 100, 100), zone('b', 700, 700, {annotation: {name: 'North lake'}})], route: ['a', 'b']});
  assert.deepEqual(h.nodes('data-route-name').map(item => item.getAttribute('fill')), ['#f0c76d', '#fff4db']);
});

test('a crowded route stays readable without losing numbered stops or their details', t => {
  const h = harness(t, {width: 390, height: 844});
  const full = [[100,200],[500,480],[502,505],[525,492],[565,520],[540,508],[535,545],[150,700],[820,780]]
    .map(([x,z], index) => zone(`stop-${index}`, x, z, {annotation:{name:`Lake ${index+1}`}}));
  h.update({routeZones:full, route:full.map(item => item.id)});
  const markers=h.nodes('data-route-stop'), names=h.nodes('data-route-name'), hours=h.nodes('data-route-hours');
  assert.equal(markers.length,9);
  assert.equal(h.nodes('data-route-leg').length,8);
  const visible=names.filter(item=>item.getAttribute('display')!=='none'), hidden=names.filter(item=>item.getAttribute('display')==='none');
  assert.ok(visible.length>0 && hidden.length>0,'show readable labels while collapsing only crowded ones');
  const overlaps=(a,b)=>a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];
  const textBox=(text, fontSize=Number(text.getAttribute('font-size')))=>{
    const x=Number(text.getAttribute('x')),y=Number(text.getAttribute('y')),width=text.textContent.length*fontSize*.6;
    const end=text.getAttribute('text-anchor')==='end'||text.parent?.getAttribute('text-anchor')==='end';
    return [end?x-width:x,y-fontSize,end?x:x+width,y+fontSize*.25];
  };
  const labelBoxes=visible.map(name=>{
    const schedule=hours.find(item=>item.getAttribute('data-route-hours')===name.getAttribute('data-route-name'));
    const boxes=[textBox(name),...schedule.children.map(line=>textBox(line,Number(schedule.getAttribute('font-size'))))];
    return [Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
  });
  for(let i=0;i<labelBoxes.length;i++){
    for(let j=i+1;j<labelBoxes.length;j++)assert.equal(overlaps(labelBoxes[i],labelBoxes[j]),false,'visible names and hours cannot overlap');
    for(const marker of markers){
      const circle=marker.children.find(child=>child.tag==='circle'),x=Number(circle.getAttribute('cx')),z=Number(circle.getAttribute('cy')),r=Number(circle.getAttribute('r'));
      assert.equal(overlaps(labelBoxes[i],[x-r,z-r,x+r,z+r]),false,'no label covers a numbered stop');
    }
  }
  for(const name of hidden){
    const number=name.getAttribute('data-route-name'),marker=markers.find(item=>item.getAttribute('data-route-stop')===number),hit=h.nodes('data-route-hit').find(item=>item.getAttribute('data-route-hit')===number);
    assert.match(marker.getAttribute('aria-label'),/Lake \d+, drinking · 06:00–10:00/);
    assert.ok(Math.abs(Number(hit.getAttribute('width'))-44*h.map.box[2]/390)<1e-8,'hidden text does not leave an invisible wide tap area');
    marker.listeners.get('keydown')({key:'Enter',preventDefault(){}});
    assert.equal(h.selected.at(-1),marker.getAttribute('data-zone'));
  }
  const hiddenId=markers.find(item=>item.getAttribute('data-route-stop')===hidden[0].getAttribute('data-route-name')).getAttribute('data-zone');
  const target=full.find(item=>item.id===hiddenId);
  h.map.zoom(.04,[target.x,target.z]);
  const zoomed=h.nodes('data-route-stop').find(item=>item.getAttribute('data-zone')===hiddenId);
  const revealed=zoomed.children.find(item=>item.getAttribute('data-route-name'));
  assert.notEqual(revealed.getAttribute('display'),'none','zooming recomputes placement and reveals the full label when room is available');
});

test('nearby route numbers separate with leaders to their unchanged saved coordinates', t=>{
  const h=harness(t,{width:390,height:844}),full=[zone('a',500,500),zone('b',501,507),zone('c',505,505)];
  h.update({routeZones:full,route:full.map(item=>item.id)});
  const markers=h.nodes('data-route-stop'),scale=h.map.box[2]/390;
  const centers=markers.map(marker=>{
    const circle=marker.children.find(child=>child.tag==='circle');
    return [Number(circle.getAttribute('cx')),Number(circle.getAttribute('cy'))];
  });
  for(let i=0;i<centers.length;i++)for(let j=i+1;j<centers.length;j++)
    assert.ok(Math.hypot(centers[i][0]-centers[j][0],centers[i][1]-centers[j][1])>=26*scale-.001,'all three number circles remain separately visible');
  for(let index=0;index<markers.length;index++){
    const marker=markers[index],saved=full[index];
    assert.deepEqual([marker.getAttribute('data-world-x'),marker.getAttribute('data-world-z')],[String(saved.x),String(saved.z)]);
    if(centers[index][0]!==saved.x||centers[index][1]!==saved.z){
      const leader=marker.children.find(child=>child.tag==='line');
      assert.deepEqual([Number(leader.getAttribute('x1')),Number(leader.getAttribute('y1'))],[saved.x,saved.z]);
      assert.deepEqual([Number(leader.getAttribute('x2')),Number(leader.getAttribute('y2'))],centers[index]);
    }
  }
  const leg=h.nodes('data-route-leg')[0].children.find(child=>child.tag==='line');
  assert.deepEqual(['x1','y1','x2','y2'].map(name=>Number(leg.getAttribute(name))),[500,500,501,507],'route distances and lines still use exact saved positions');
});

test('nine route stops crowded at a viewport corner still have separate numbers',t=>{
  const h=harness(t,{width:390,height:844});
  h.map.box=[0,0,390,844];
  const full=Array.from({length:9},(_,i)=>zone(`corner-${i}`,i*.1,i*.1));
  h.update({routeZones:full,route:full.map(item=>item.id)});
  const markers=h.nodes('data-route-stop'),centers=markers.map(marker=>{
    const circle=marker.children.find(child=>child.tag==='circle');
    return [Number(circle.getAttribute('cx')),Number(circle.getAttribute('cy'))];
  });
  assert.equal(centers.length,9);
  for(let i=0;i<centers.length;i++)for(let j=i+1;j<centers.length;j++)
    assert.ok(Math.hypot(centers[i][0]-centers[j][0],centers[i][1]-centers[j][1])>=25.999,'edge crowding cannot silently pile numbered stops together');
  for(let index=0;index<markers.length;index++){
    assert.equal(markers[index].getAttribute('data-world-x'),String(full[index].x));
    assert.equal(markers[index].getAttribute('data-world-z'),String(full[index].z));
  }
  assert.equal(h.nodes('data-route-leg').length,8);
});

test('zoom reveals zone hours and known herd counts, then hides them when zoomed out',t=>{
 const h=harness(t,{width:500,height:500}),animal=zone('herd',500,500,{species:'Whitetail Deer',males:4,females:2,annotation:{name:'North lake'}});
 h.map.box=[0,0,4000,4000];h.update({zones:[animal]});
 assert.equal(h.nodes('data-spot-info')[0].getAttribute('data-spot-info'),'name');
 assert.doesNotMatch(h.nodes('data-spot-info')[0].textContent,/males|06:00/);
 h.map.box=[0,0,1000,1000];h.map.draw();
 const info=h.nodes('data-spot-info')[0];
 assert.equal(info.getAttribute('data-spot-info'),'expanded');
 assert.match(info.textContent,/North lake/);assert.match(info.textContent,/Whitetail Deer/);
 assert.match(info.textContent,/06:00–10:00/);assert.match(info.textContent,/4 males · 2 females/);
 const species=info.children.find(n=>n.textContent==='Whitetail Deer');assert.equal(species.getAttribute('fill'),'#f0c76d');
 animal.males=null;animal.females=null;h.map.draw();assert.doesNotMatch(h.nodes('data-spot-info')[0].textContent,/0 males|0 females|2 females/);
});
test('expanded spot information does not cover route numbers even when selected',t=>{
 const h=harness(t,{width:500,height:500});h.map.box=[0,0,1000,1000];
 const ordinary=zone('ordinary',100,100,{annotation:{name:'North lake'},males:4,females:2}),routed=zone('routed',180,160);
 for(const selectedZone of [null,'ordinary']){
  h.update({zones:[ordinary],routeZones:[routed],route:['routed'],selectedZone});
  assert.equal(h.nodes('data-spot-info').length,0,'hide a colliding label while preserving its marker');
  const marker=h.nodes('data-zone').find(n=>n.getAttribute('role')==='button'&&n.getAttribute('data-zone')==='ordinary');
  assert.match(marker.getAttribute('aria-label'),/06:00–10:00/);
  marker.listeners.get('keydown')({key:'Enter',preventDefault(){}});assert.equal(h.selected.at(-1),'ordinary');
  assert.equal(h.nodes('data-route-stop').length,1);
 }
});
test('ordinary zone, equipment and place labels select their own record through pointer gestures',t=>{
 const h=harness(t),picked=[],herd=zone('herd',100,100,{males:4,females:2}),gear={id:'tripod',x:100,z:400,label:'Lake stand',kind:'tripod',typeVerified:true},place={id:'outpost',x:100,z:700,label:'Spoonside Rest',kind:'outpost'};
 h.map.onPoint=(point,item)=>picked.push({point,id:item?.id});
 h.update({zones:[herd],equipment:[gear],reserve:{id:19,bounds:[[0,0],[1000,1000]],poi:[place]}});
 Object.assign(h.map,{abort:new AbortController(),pointers:new Map(),pinch:null,toWorld:e=>[e.clientX,e.clientY]});
 h.map.svg.setPointerCapture=()=>{};h.map.svg.hasPointerCapture=()=>false;h.map.setEvents();
 for(const [kind,item] of [['zone',herd],['pin',gear],['poi',place]]){
  const label=h.nodes('data-spot-info').find(n=>n.parent.getAttribute('data-'+kind)===item.id),hit=h.nodes('data-spot-hit').find(n=>n.getAttribute('data-'+kind)===item.id);
  assert.ok(label&&hit);assert.equal(label.getAttribute('style'),'pointer-events:all');
  assert.equal(hit.parent,h.nodes('data-map-hit-layer')[0],'the wide label target stays below every visible marker');
  for(const target of [label,...label.children,hit]){
   const event={target,button:0,pointerId:1,clientX:777,clientY:888};
   h.map.svg.listeners.get('pointerdown')(event);h.map.svg.listeners.get('pointerup')(event);
   if(kind==='zone')assert.equal(h.selected.at(-1),item.id);
   else assert.deepEqual(picked.at(-1),{point:[item.x,item.z],id:item.id},'text taps use the saved location, not the pointer coordinate');
  }
 }
});
test('interactive equipment labels cannot cover an earlier visible zone marker',t=>{
 const h=harness(t);h.map.box=[0,0,4000,4000];
 const herd=zone('herd',1000,1000),gear={id:'gear',x:900,z:1000,label:'Lake stand',kind:'tripod'};
 h.update({zones:[herd],equipment:[gear]});
 assert.equal(h.nodes('data-spot-info').length,0,'collapse a label crossing another marker before its interactive text is painted');
 assert.equal(h.nodes('data-spot-hit').length,0,'collapsed labels leave no invisible hit rectangle');
 assert.ok(h.nodes('data-zone').some(n=>n.getAttribute('role')==='button'),'the earlier herd marker remains selectable');
 assert.ok(h.nodes('data-pin').some(n=>n.getAttribute('role')==='button'),'the equipment marker remains selectable');
 h.map.box=[800,800,400,400];h.map.draw();
 assert.ok(h.nodes('data-spot-info').some(n=>n.textContent.includes('Lake stand')),'zoom reveals the label again when space permits');
});
test('label collision and tap bounds use fitted glyph measurements, including wide letters',t=>{
 const h=harness(t);h.map.box=[0,0,4000,4000];
 const create=globalThis.document.createElementNS;
 globalThis.document.createElementNS=(ns,tag)=>{const n=create(ns,tag);if(tag==='tspan')n.getComputedTextLength=function(){assert.ok(this.parent?.parent,'measure while attached to the map');return this.textContent.length*Number(this.getAttribute('font-size'))*.95;};return n;};
 h.update({zones:[zone('herd',1050,1000)],equipment:[{id:'gear',x:400,z:1000,label:'WWWWWWWW',kind:'tripod'}]});
 assert.equal(h.nodes('data-spot-info').length,0,'wide glyphs overlapping the herd cannot become interactive labels');
 h.update({equipment:[{id:'gear',x:400,z:1000,label:'WWWWWWWW',kind:'tripod'}]});
 const label=h.nodes('data-spot-info')[0],hit=h.nodes('data-spot-hit')[0],span=label.children[0];
 assert.ok(Number(hit.getAttribute('width'))>=span.getComputedTextLength(),'the label hit box covers the entire visible wide text');
 globalThis.document.createElementNS=(ns,tag)=>{const n=create(ns,tag);if(tag==='tspan')n.getComputedTextLength=()=>NaN;return n;};
 h.map.draw();assert.equal(h.nodes('data-spot-info').length,0,'unmeasurable text falls back to its selectable marker');
});
