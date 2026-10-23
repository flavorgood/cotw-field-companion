// A saved route belongs to the player. Keep its IDs and order even when a
// current save no longer contains one of the matching zones.
export function resolveRouteStops(route, zones) {
  const zonesById = new Map(zones.map(zone => [zone.id, zone]));
  return route.map((id, index) => ({id, number: index + 1, zone: zonesById.get(id) ?? null}));
}

// These are saved zone activity hours in the game, never arrival estimates.
export function formatZoneHours(start, end) {
  if (![start, end].every(value => Number.isFinite(value) && value >= 0 && value <= 24)) return 'Hours unavailable';
  const hour = value => {
    const minutes = Math.round(value * 60);
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  };
  return `${hour(start)}–${hour(end)}${end < start ? ' (overnight)' : ''}`;
}

export function routePlan(route, zones) {
  const stops = resolveRouteStops(route, zones).map(stop => ({
    ...stop,
    valid: Number.isFinite(stop.zone?.x) && Number.isFinite(stop.zone?.z),
  }));
  const legs = [];
  let knownDistanceMeters = 0;
  for (let index = 1; index < stops.length; index++) {
    const from = stops[index - 1], to = stops[index];
    if (!from.valid || !to.valid) continue;
    const distanceMeters = Math.hypot(to.zone.x - from.zone.x, to.zone.z - from.zone.z);
    if (!Number.isFinite(distanceMeters)) continue;
    legs.push({from, to, distanceMeters});
    knownDistanceMeters += distanceMeters;
  }
  return {stops, legs, knownDistanceMeters, missingCount: stops.filter(stop => !stop.valid).length};
}

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():'—';
const when=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():null;
export const zoneSourceReady=state=>state.observer?.connected===true&&!state.observer?.error&&state.observer?.sources?.some(s=>s.name==='found_need_zones_adf'&&s.status==='ok');
const action=(label,name,id,extra='',primary=false)=>`<button class="button ${primary?'primary':'small subtle'}" data-action="${name}" data-id="${escape(id)}" ${extra}>${label}</button>`;
const coordinateText=z=>Number.isFinite(z?.x)&&Number.isFinite(z?.z)?`X ${Math.round(z.x)} · Z ${Math.round(z.z)}`:'Location was not recorded';
const hiddenZone=zone=>zone?.source==='population_path_reference';
export function zoneDiscoveryNotice(state){
  if(state.settings?.spoilers!==true)return '';
  const info=state.zoneActivity?.discovery;
  if(!info)return '<p class="zone-discovery-note" role="status">Undiscovered zones require the current PC reader. Your existing connection can stay paired.</p>';
  const messages={loading:'Loading undiscovered zone areas…',population_unavailable:'Waiting for this reserve’s population save.',source_unavailable:'Waiting for readable saves before showing undiscovered zones.',reference_unavailable:'Undiscovered-zone reference is unavailable. Discovered zones remain usable.',reference_mismatch:'Zone reference does not match this save. Hidden locations are withheld rather than guessed.'};
  const available=['available','partial'].includes(info.status);
  const text=available?`${count(info.hiddenZones)} undiscovered zone areas${info.status==='partial'?' · incomplete reference coverage':''}`:messages[info.status]||'Undiscovered-zone reference is unavailable.';
  return `<details class="zone-discovery-note" data-disclosure-key="zone-discovery"><summary><span data-zone-discovery-status="${escape(info.status)}">${text}</span></summary><p>Hidden areas are matched to the zone paths in your population save. Their markers are reference areas, not live animal or exact kill locations. Feeding, drinking and resting follow each animal’s recorded schedule.</p><p>Public map-reference data comes from DECA. Only the reserve number is requested; your game files and journal stay on your PC.</p>${available?`<p>${count(info.unresolvedSlots??0)} unlocated activity references. Unsupported or inactive slots are not invented. Turning spoilers off hides undiscovered locations.</p>`:''}</details>`;
}

/** A missing record is not proof of deletion or overpressure. Preserve the distinction. */
export function zoneRouteStatus(zone,history,sourceReady){
  if(hiddenZone(zone))return {label:'Undiscovered · spoiler area',state:'active',detail:'Assigned in the population save and located with a public reference. The marker is an area, not a discovered point or live animal position.'};
  if(zone)return zone.source!=='save'||sourceReady?{label:'Active zone',state:'active',detail:''}:{label:'Waiting for readable save',state:'stale',detail:'Showing the last known zone. Its removal has not been established.'};
  if(history?.status==='spoiler_hidden')return {label:'Undiscovered stop hidden',state:'hidden',detail:'Turn spoilers on to display this reference again. This is not a deleted zone.'};
  if(history?.status==='reference_unavailable')return {label:'Undiscovered reference unavailable',state:'stale',detail:'The hidden area cannot currently be resolved. Its removal has not been established.'};
  if(!sourceReady||history?.status==='source_unavailable')return {label:'Waiting for readable save',state:'stale',detail:'The source is unavailable. Last known details and history are retained.'};
  if(history?.status!=='removed')return {label:'Zone not in current save',state:'unrecorded',detail:'GrindZone has no confirmed removal record for this stop. Its cause is unknown.'};
  if(history.reason==='overpressure_reported')return {label:'Removed · overpressure reported',state:'removed',detail:'You reported overpressure as the cause. This is not an automatic diagnosis.'};
  if(history.reason==='pressure_present')return {label:'Removed · pressure detected',state:'removed',detail:'Saved pressure overlapped this location near its disappearance. That does not prove overpressure caused the removal.'};
  if(history.reason==='save_changed')return {label:'Zone absent after save change',state:'removed',detail:'A save reset, restore or population change was observed. Overpressure is not established.'};
  return {label:'Removed from save · cause unconfirmed',state:'removed',detail:'A readable save no longer contains this zone. Its history is retained; the cause is not known.'};
}
export function zoneHuntButton(state,zone){
  if(state.zoneLedgerVersion!==1||!zone)return '';
  const active=state.zoneTracking?.active===true&&state.zoneTracking.zoneId===zone.id;
  const ready=zone.source!=='save'||zoneSourceReady(state);
  const note=hiddenZone(zone)?'<span class="zone-reference-label">Undiscovered area · not an exact animal location</span>':'';
  return note+action(active?'Hunting here':'Hunt here','zone-track',zone.id,`aria-pressed="${active}" ${!ready||active?'disabled':''}`,!active);
}
export function zoneTrackingBar(state){
  const discovery=zoneDiscoveryNotice(state);
  if(state.zoneLedgerVersion!==1)return discovery+'<p class="small muted zone-upgrade">Zone history and location tracking require the current PC version. Your existing phone connection can stay paired.</p>';
  const tracking=state.zoneTracking;
  if(tracking?.active)return discovery+`<section class="zone-tracking-bar" aria-label="Selected hunting location"><div><strong>Hunting: ${escape(tracking.name||'Selected zone')}</strong><small>New harvests use this selected location, not detected kill coordinates.</small></div>${action('Stop location tracking','zone-stop',tracking.zoneId,`data-reserve="${tracking.reserve}"`)}</section>`;
  const reason=tracking?.stopReason==='zone_removed'?'The selected zone disappeared; location tracking stopped.':tracking?.stopReason==='app_restarted'?'Choose your hunting location again after restarting.':tracking?.stopReason==='spoilers_disabled'?'Spoilers are off; hidden-location tracking stopped.':'Choose Hunt here to assign new saved harvests to a zone.';
  return discovery+`<p class="zone-tracking-hint" role="status">${reason} Previous counts remain saved.</p>`;
}
export function renderRouteCards(state,{stops=resolveRouteStops(state.route||[],state.zones||[]),limit=Infinity,editing=false,routeButton,formatSpecies=escape}={}){
  const history=new Map((state.zoneHistory||[]).map(z=>[z.id,z]));
  const counts=new Map((state.zoneActivity?.byZone||[]).map(z=>[z.zoneId,z]));
  const ready=zoneSourceReady(state),manual=state.routeOptimization?.mode==='manual';
  return stops.slice(0,limit).map(({id,number,zone})=>{
    const past=history.get(id),concealed=['spoiler_hidden','reference_unavailable'].includes(past?.status),last=zone||(concealed?null:past?.snapshot),status=zoneRouteStatus(zone,past,ready),stats=counts.get(id);
    const title=zone?.annotation?.name?escape(zone.annotation.name):last?.name?escape(last.name):last?.species?formatSpecies(last.species,last.speciesKey):'Previously saved stop';
    const hours=last?formatZoneHours(last.start,last.end):'Hours were not recorded';
    const meta=concealed?'Hidden reference details are not displayed.':[last?.need, hours, coordinateText(last)].filter(Boolean).map(escape).join(' · ');
    const note=zone?.annotation?.notes||past?.notes;
    const totals=state.zoneLedgerVersion===1?`<span class="zone-stop-counts" data-zone-counts="${escape(id)}"><b>${count(stats?stats.harvests:0)}</b> harvests · <b>${count(stats?stats.unlinkedDeathReports:0)}</b> unlinked death reports <small>All retained history for this zone</small></span>`:'';
    const remove=routeButton?routeButton(id,true):action('Remove stop','route',id);
    const reorder=editing&&manual?action('↑ Up','route-up',id,`${number===1?'disabled':''} aria-label="Move stop ${number} up"`)+action('↓ Down','route-down',id,`${number===stops.length?'disabled':''} aria-label="Move stop ${number} down"`):editing&&zone&&number>1?action('Start here','route-start',id):'';
    const report=!zone&&!concealed&&ready&&state.zoneLedgerVersion===1?action('Record observed cause','zone-loss',id):'';
    return `<article class="zone-route-card" data-zone-stop="${escape(id)}" data-zone-state="${status.state}"><div class="zone-stop-top"><span class="zone-stop-number">${number}</span><div><h2>${title}</h2><p class="zone-stop-status">${status.label}</p><p class="zone-stop-meta">${zone||concealed?'':'Last recorded · '}${meta}</p></div></div><div class="zone-stop-main">${totals}<div class="zone-stop-actions">${zone?zoneHuntButton(state,zone)+action('Map','zone-view',id):''}</div></div><details data-disclosure-key="zone-stop:${escape(id)}"><summary>Details &amp; route controls</summary>${status.detail?`<p>${status.detail}</p>`:''}${past?.lastSeenAt?`<p class="small muted">Last seen ${escape(when(past.lastSeenAt)||'time unavailable')}${when(past.removedAt)?' · disappearance observed '+escape(when(past.removedAt)):''}.</p>`:''}${note?`<p class="zone-stop-notes">${escape(note)}</p>`:''}${zone?`<p class="small muted">Known animals: ${count(zone.males)} male · ${count(zone.females)} female. Counts are not kill totals.</p>`:''}<div class="zone-stop-actions">${reorder}${report}${remove}</div><p class="small muted">Removing a route stop does not erase its recorded activity.</p></details></article>`;
  }).join('');
}
export function zoneActivityPanel(state,{sessionId=null}={}){
  const ledger=state.zoneActivity;if(state.zoneLedgerVersion!==1||!ledger)return '';
  const selected=sessionId?ledger.byGrind?.find(s=>s.sessionId===sessionId):ledger;
  if(!selected||selected.available===false)return '<p class="small muted">Activity for this grind is unavailable.</p>';
  const label=sessionId?'This grind · all maps':'All retained activity · all maps';
  const rows=(selected.bySpecies||[]).map(r=>`<tr><th scope="row">${escape(r.species)}</th><td>${count(r.harvests)}</td><td>${count(r.unlinkedDeathReports)}</td></tr>`).join('');
  const grinds=!sessionId?(ledger.byGrind||[]).map(g=>`<tr><th scope="row">${escape(state.sessions?.find(s=>s.id===g.sessionId)?.name||'Saved grind')}</th><td>${g.available===false?'—':count(g.harvests)}</td><td>${g.available===false?'—':count(g.unlinkedDeathReports)}</td></tr>`).join(''):'';
  return `<section class="zone-activity-panel" data-zone-activity><details data-disclosure-key="zone-activity:${escape(sessionId||'all')}"><summary>${label}: ${count(selected.harvests)} harvests · ${count(selected.unlinkedDeathReports)} unlinked death reports</summary><p class="small muted">A reported death is not a saved harvest. Linking a report to its receipt prevents double counting. Missing population records are never counted as kills.</p>${!sessionId?`<p class="small muted">${count(ledger.unassignedHarvests)} saved harvests have no selected zone. Older harvests are not assigned retroactively.</p>`:''}<div class="table-wrap"><table><thead><tr><th>Species</th><th>Harvests</th><th>Unlinked deaths</th></tr></thead><tbody>${rows||'<tr><td colspan="3">No recorded activity yet.</td></tr>'}</tbody></table></div>${grinds?`<div class="table-wrap"><table><thead><tr><th>Grind</th><th>Harvests</th><th>Unlinked deaths</th></tr></thead><tbody>${grinds}</tbody></table></div>`:''}</details></section>`;
}
