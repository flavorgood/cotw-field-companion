import {validateScreenshotEvidence} from './harvest-intake-core.js';

/** Player-authored browser journal. Never represents console saves or automatic telemetry.
 * Shared by browser persistence and a future authenticated account-storage adapter.
 */
export const JOURNAL_SCHEMA = 'grindzone.browser-journal.v1';
export const JOURNAL_LIMITS = Object.freeze({grinds: 200, reports: 10000, places: 2000, commands: 20000, bytes: 4 * 1024 * 1024});
const platforms = ['xbox', 'playstation', 'pc', 'other'];
const medals = ['unknown', 'none', 'bronze', 'silver', 'gold', 'diamond', 'great_one'];
const pointKinds = ['shot', 'death', 'harvest'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => { if (!isObject(value) || Object.keys(value).some(k => !keys.includes(k))) fail('invalid', 'Unsupported journal fields.'); };
const id = value => { if (typeof value !== 'string' || !uuid.test(value)) fail('invalid', 'Invalid record identity.'); return value; };
const label = (value, max = 100) => { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail('invalid', 'Enter a valid name.'); return value.trim(); };
const optionalText = (value, max) => { if(value==null||value==='')return ''; if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail('invalid','Enter valid notes.');return value.trim(); };
const integer = (value, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid', 'Invalid numeric value.'); return value; };
const iso = value => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid', 'Invalid recorded time.'); return value; };
const array = (value, limit) => { if (!Array.isArray(value) || value.length > limit) fail('capacity', 'This journal has reached its supported size. Export a backup before continuing.'); return value; };
const distinct = rows => { const seen = new Set(); for (const row of rows) { id(row.id); if (seen.has(row.id)) fail('invalid', 'Duplicate record identity.'); seen.add(row.id); } };
const revision = value => integer(value, 0, Number.MAX_SAFE_INTEGER - 1);
const time = value => Date.parse(value);
const coordinate = value => { if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100000) fail('invalid', 'Invalid map coordinate.'); return value; };
function point(value) {
  only(value, ['x', 'z']); return {x: coordinate(value.x), z: coordinate(value.z)};
}
function checkedPoints(value) {
  only(value, pointKinds);
  return Object.fromEntries(pointKinds.filter(k => value[k] != null).map(k => [k, point(value[k])]));
}
function checkPeriods(grind) {
  array(grind.periods, 1000);
  if (!grind.periods.length) fail('invalid', 'A grind needs a recorded start.');
  let lastEnd = -Infinity;
  for (const [index, period] of grind.periods.entries()) {
    only(period, ['startedAt', 'endedAt']); iso(period.startedAt);
    const start = time(period.startedAt);
    if (start < lastEnd) fail('invalid', 'Grind periods overlap.');
    if (period.endedAt === null) {
      if (index !== grind.periods.length - 1 || grind.status !== 'tracking') fail('invalid', 'Invalid open grind period.');
    } else { iso(period.endedAt); if (time(period.endedAt) < start) fail('invalid', 'Invalid grind duration.'); lastEnd = time(period.endedAt); }
  }
  if ((grind.periods.at(-1).endedAt === null) !== (grind.status === 'tracking')) fail('invalid', 'Grind status and periods do not agree.');
}
export function validateJournal(input) {
  only(input, ['schema', 'id', 'revision', 'createdAt', 'updatedAt', 'game', 'platform', 'settings', 'grinds', 'reports', 'places', 'receipts']);
  if (input.schema !== JOURNAL_SCHEMA || input.game !== 'cotw' || !platforms.includes(input.platform)) fail('invalid', 'Unsupported journal version, game or platform.');
  id(input.id); revision(input.revision); iso(input.createdAt); iso(input.updatedAt);
  only(input.settings, ['terrain']); if (typeof input.settings.terrain !== 'boolean') fail('invalid', 'Invalid map setting.');
  const grinds = array(input.grinds, JOURNAL_LIMITS.grinds), reports = array(input.reports, JOURNAL_LIMITS.reports), places = array(input.places, JOURNAL_LIMITS.places);
  distinct(grinds); distinct(reports); distinct(places);
  if (grinds.filter(g => g.status === 'tracking').length > 1) fail('invalid', 'Only one grind can be tracking.');
  for (const g of grinds) {
    only(g, ['id', 'name', 'targetSpecies', 'reserve', 'status', 'version', 'createdAt', 'updatedAt', 'periods']);
    label(g.name); label(g.targetSpecies); integer(g.reserve, 0, 999); integer(g.version, 1, Number.MAX_SAFE_INTEGER - 1); iso(g.createdAt); iso(g.updatedAt);
    if (!['tracking', 'paused', 'finished'].includes(g.status)) fail('invalid', 'Invalid grind status.'); checkPeriods(g);
  }
  for (const p of places) {
    only(p, ['id', 'name', 'reserve', 'need', 'x', 'z', 'createdAt', 'source']);
    label(p.name); integer(p.reserve, 0, 999); coordinate(p.x); coordinate(p.z); iso(p.createdAt);
    if (!['pin', 'drinking', 'feeding', 'resting'].includes(p.need) || p.source !== 'player_report') fail('invalid', 'Unsupported place evidence.');
  }
  const screenshotHashes = new Set();
  for (const r of reports) {
    only(r, ['id', 'grindId', 'species', 'reserve', 'score', 'medal', 'sex', 'occurredAt', 'recordedAt', 'placeId', 'points', 'notes', 'source', 'screenshot']);
    const grind = grinds.find(g => g.id === id(r.grindId));
    if (!grind || grind.reserve !== r.reserve) fail('invalid', 'A report must belong to its selected grind and reserve.');
    label(r.species); integer(r.reserve, 0, 999); iso(r.occurredAt); iso(r.recordedAt);
    if (r.score !== null && (typeof r.score !== 'number' || !Number.isFinite(r.score) || r.score < 0 || r.score > 1000000)) fail('invalid', 'Invalid reported trophy score.');
    if (!medals.includes(r.medal) || !['unknown', 'male', 'female'].includes(r.sex) || r.source !== 'player_report') fail('invalid', 'Unsupported harvest evidence.');
    if (r.placeId !== null && !places.some(p => p.id === r.placeId && p.reserve === r.reserve)) fail('invalid', 'The selected place is not in this reserve.');
    checkedPoints(r.points); optionalText(r.notes, 500);
    if (Object.hasOwn(r, 'screenshot')) {
      const evidence = validateScreenshotEvidence(r.screenshot);
      if (time(evidence.reviewedAt) > time(r.recordedAt)) fail('invalid', 'Screenshot review cannot follow its saved report.');
      if (screenshotHashes.has(evidence.imageSha256)) fail('invalid', 'The same screenshot appears in more than one report.');
      screenshotHashes.add(evidence.imageSha256);
    }
    if (!grind.periods.some(p => time(r.occurredAt) >= time(p.startedAt) && (p.endedAt === null || time(r.occurredAt) <= time(p.endedAt)))) fail('invalid', 'A reported harvest is outside this grind’s tracking periods.');
  }
  const receipts = array(input.receipts, JOURNAL_LIMITS.commands); distinct(receipts);
  for (const r of receipts) {
    only(r, ['id', 'fingerprint', 'revision']);
    if (typeof r.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(r.fingerprint)) fail('invalid', 'Invalid command receipt.');
    if (revision(r.revision) > input.revision) fail('invalid', 'Invalid command revision.');
  }
  if (new TextEncoder().encode(JSON.stringify(input)).length > JOURNAL_LIMITS.bytes) fail('capacity', 'Journal too large. Export a backup before adding more records.');
  return structuredClone(input);
}
export function newJournal({journalId, platform, now}) {
  return validateJournal({schema: JOURNAL_SCHEMA, id: journalId, revision: 0, createdAt: now, updatedAt: now,
    game: 'cotw', platform, settings: {terrain: false}, grinds: [], reports: [], places: [], receipts: []});
}
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function commandFingerprint(command) {
  // Revision is a precondition, not permission to reuse an identity for different data.
  const {expectedRevision, ...payload} = command;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(payload)));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function applyJournalCommand(input, command, fingerprint, now) {
  const doc = validateJournal(input); only(command, ['id', 'op', 'expectedRevision', 'data']); id(command.id); iso(now);
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) fail('invalid', 'Invalid command fingerprint.');
  const previous = doc.receipts.find(r => r.id === command.id);
  if (previous) { if (previous.fingerprint !== fingerprint) fail('conflict', 'This request identity was already used for another change.'); return {journal: doc, replay: true}; }
  if (command.expectedRevision !== doc.revision) fail('conflict', 'Your journal changed in another tab. Refresh and review before saving again.');
  const data = command.data;
  if (time(now) < time(doc.updatedAt)) fail('clock', 'Your device clock moved backwards. Correct the clock before changing this journal.');
  const getGrind = () => { const g = doc.grinds.find(g => g.id === data.grindId); if (!g) fail('missing', 'This grind is unavailable.'); if (data.version !== g.version) fail('conflict', 'The grind changed. Refresh before saving.'); return g; };
  switch (command.op) {
    case 'grind.start': {
      only(data, ['grindId', 'name', 'targetSpecies', 'reserve']); id(data.grindId);
      if (doc.grinds.some(g => g.status === 'tracking')) fail('conflict', 'Pause or finish the current grind before starting another.');
      if (doc.grinds.some(g => g.id === data.grindId)) fail('conflict', 'This grind identity already exists.');
      doc.grinds.unshift({id: data.grindId, name: label(data.name), targetSpecies: label(data.targetSpecies), reserve: integer(data.reserve, 0, 999), status: 'tracking', version: 1, createdAt: now, updatedAt: now, periods: [{startedAt: now, endedAt: null}]}); break;
    }
    case 'grind.pause': case 'grind.resume': case 'grind.finish': {
      only(data, ['grindId', 'version']); const g = getGrind();
      if (command.op === 'grind.resume') {
        if (g.status === 'tracking' || doc.grinds.some(other => other.status === 'tracking')) fail('conflict', 'A grind is already tracking.');
        g.periods.push({startedAt: now, endedAt: null}); g.status = 'tracking';
      } else {
        if (g.status === 'finished' || command.op === 'grind.pause' && g.status !== 'tracking') fail('conflict', 'This grind is not tracking.');
        if (g.periods.at(-1).endedAt === null) g.periods.at(-1).endedAt = now;
        g.status = command.op === 'grind.pause' ? 'paused' : 'finished';
      }
      g.version++; g.updatedAt = now; break;
    }
    case 'report.add': {
      only(data, ['reportId', 'grindId', 'version', 'species', 'score', 'medal', 'sex', 'placeId', 'points', 'notes', 'occurredAt', 'screenshot']);
      id(data.reportId); const g = getGrind(); iso(data.occurredAt);
      if (time(data.occurredAt) > time(now)) fail('invalid', 'A harvest cannot be reported in the future.');
      if (doc.reports.some(r => r.id === data.reportId)) fail('conflict', 'This report already exists.');
      const screenshot = Object.hasOwn(data, 'screenshot') ? validateScreenshotEvidence(data.screenshot) : null;
      if (screenshot && doc.reports.some(r => r.screenshot?.imageSha256 === screenshot.imageSha256)) fail('duplicate_screenshot', 'This exact screenshot is already recorded. No additional harvest was counted.');
      doc.reports.unshift({id: data.reportId, grindId: g.id, species: label(data.species), reserve: g.reserve, score: data.score ?? null,
        medal: data.medal ?? 'unknown', sex: data.sex ?? 'unknown', occurredAt: data.occurredAt, recordedAt: now, placeId: data.placeId ?? null,
        points: checkedPoints(data.points ?? {}), notes: optionalText(data.notes, 500), source: 'player_report', ...(screenshot ? {screenshot} : {})}); break;
    }
    case 'place.add': {
      only(data, ['placeId', 'name', 'reserve', 'need', 'x', 'z']); id(data.placeId);
      if (doc.places.some(p => p.id === data.placeId)) fail('conflict', 'This place identity already exists.');
      doc.places.unshift({id: data.placeId, name: label(data.name), reserve: integer(data.reserve, 0, 999), need: data.need, ...point({x: data.x, z: data.z}), source: 'player_report', createdAt: now}); break;
    }
    case 'settings': only(data, ['terrain']); if (typeof data.terrain !== 'boolean') fail('invalid', 'Invalid map setting.'); doc.settings.terrain = data.terrain; break;
    default: fail('unsupported', 'This action is not available for this browser journal.');
  }
  doc.revision++; doc.updatedAt = now; doc.receipts.push({id: command.id, fingerprint, revision: doc.revision});
  return {journal: validateJournal(doc), replay: false};
}
export function grindSummary(doc, grindId) {
  const grind = doc.grinds.find(g => g.id === grindId); if (!grind) return null;
  const reports = doc.reports.filter(r => r.grindId === grindId), target = reports.filter(r => r.species === grind.targetSpecies);
  return {total: reports.length, target: target.length, other: reports.length - target.length, diamonds: target.filter(r => r.medal === 'diamond').length, greatOnes: target.filter(r => r.medal === 'great_one').length,
    recent: [...reports].sort((a, b) => time(b.occurredAt) - time(a.occurredAt) || a.id.localeCompare(b.id)), source: 'player_report'};
}
export function exportJournal(input) {
  return JSON.stringify({format: 'grindzone.private-browser-backup', version: 1, notice: 'Player-authored records; not a game save or verified automatic telemetry. Keep this file private.', journal: validateJournal(input)}, null, 2);
}
export function importJournal(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > JOURNAL_LIMITS.bytes + 10000) fail('capacity', 'Backup too large.');
  let value; try { value = JSON.parse(text); } catch { fail('invalid', 'This is not a valid GrindZone backup.'); }
  only(value, ['format', 'version', 'notice', 'journal']);
  if (value.format !== 'grindzone.private-browser-backup' || value.version !== 1) fail('invalid', 'Choose a GrindZone browser-journal backup, not a game-save file.');
  return validateJournal(value.journal);
}
