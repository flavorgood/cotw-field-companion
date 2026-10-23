/** Conservative English harvest-screen extraction. Suggestions are never game-save evidence. */
export const INTAKE_VERSION = 'grindzone.harvest-intake.v1';
export const OCR_ENGINE = 'tesseract.js/7.0.0';
export const IMAGE_LIMITS = Object.freeze({bytes: 12 * 1024 * 1024, pixels: 24000000, edge: 8192});
const error = message => { throw Object.assign(new Error(message), {code: 'intake'}); };
const normalize = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
const emptyFields = () => ({species: null, score: null, medal: 'unknown', sex: 'unknown'});
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const canonicalTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function inspectScreenshot(bytes, mimeType = '') {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > IMAGE_LIMITS.bytes) error('Choose a PNG or JPEG screenshot up to 12 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let type, width, height;
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) {
    if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12,16)) !== 'IHDR') error('Invalid PNG header.');
    type = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    type = 'image/jpeg'; let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) error('Invalid JPEG marker.');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) error('Incomplete JPEG header.');
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) error('Incomplete JPEG segment.');
      if ([192,193,194].includes(marker)) {
        if (length < 8) error('Invalid JPEG dimensions.');
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else error('Only PNG and JPEG screenshots are supported. SVG, GIF and HEIC are not read.');
  if (mimeType && mimeType !== type) error('The screenshot type does not match its content.');
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 32 || height < 32 || width > IMAGE_LIMITS.edge || height > IMAGE_LIMITS.edge || width * height > IMAGE_LIMITS.pixels) error('Choose a screenshot between 32 and 8192 pixels per side, up to 24 megapixels.');
  return {mimeType: type, byteLength: bytes.length, width, height};
}

/** Extract only exact labels and catalog names. Never infer a medal, place or event time. */
export function extractHarvest({text, confidence, speciesNames}) {
  if (typeof text !== 'string' || text.length > 50000 || !Array.isArray(speciesNames) || speciesNames.length > 1000) error('Invalid screenshot recognition output.');
  const fields = emptyFields(), warnings = [];
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 60 || confidence > 100) return {fields, warnings: ['Text recognition was uncertain. Review the image; no fields were filled.'], harvestScreen: false};
  const lines = text.split(/\r?\n/).map(normalize).filter(Boolean);
  const valuesFor = labels => {
    const values = [];
    for (let i = 0; i < lines.length; i++) for (const label of labels) {
      if (lines[i] === label || lines[i] === label + ':') { if (lines[i+1]) values.push(lines[i+1]); }
      else if (lines[i].startsWith(label + ':') || lines[i].startsWith(label + ' ')) values.push(lines[i].slice(label.length).replace(/^\s*:\s*/, '').trim());
    }
    return [...new Set(values)];
  };
  const scoreValues = valuesFor(['TROPHY RATING', 'TROPHY SCORE']);
  const context = lines.some(line => /^HARVEST (?:CHECK|SCREEN|DETAILS)$/.test(line)) || scoreValues.length && valuesFor(['WEIGHT']).length && valuesFor(['GENDER','SEX','FUR TYPE']).length;
  if (!context) return {fields, warnings: ['A harvest screen could not be established. Check the screenshot before entering any values.'], harvestScreen: false};
  const candidates = [];
  for (const name of speciesNames) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) continue;
    const key = normalize(name);
    if (lines.some(line => line === key || line === 'SPECIES: ' + key || line === 'SPECIES ' + key) || valuesFor(['SPECIES']).includes(key)) candidates.push(name);
  }
  if (new Set(candidates).size === 1) fields.species = candidates[0];
  else warnings.push(candidates.length ? 'More than one species was read. Choose the harvested species.' : 'Species was not clearly read. Choose it from the image.');
  if (scoreValues.length === 1 && /^(?:0|[1-9]\d{0,5})(?:\.\d{1,3}|,\d{1,2})?$/.test(scoreValues[0])) fields.score = Number(scoreValues[0].replace(',', '.'));
  else warnings.push('Trophy score was absent or ambiguous. It has been left blank.');
  const sexValues = valuesFor(['GENDER','SEX']);
  if (sexValues.length === 1 && ['MALE','FEMALE'].includes(sexValues[0])) fields.sex = sexValues[0].toLowerCase();
  const medalLabels = {'NO MEDAL':'none',BRONZE:'bronze',SILVER:'silver',GOLD:'gold',DIAMOND:'diamond','GREAT ONE':'great_one'};
  const medalValues = [...new Set([...valuesFor(['MEDAL','AWARDED MEDAL']), ...lines.filter(line => Object.hasOwn(medalLabels,line))])];
  if (medalValues.length === 1 && Object.hasOwn(medalLabels,medalValues[0])) fields.medal = medalLabels[medalValues[0]];
  else warnings.push('Awarded medal was not clearly read. No medal is inferred from the score.');
  return {fields, warnings, harvestScreen: true};
}

export function validateScreenshotEvidence(evidence) {
  if (!exact(evidence, ['kind','version','imageSha256','mimeType','byteLength','width','height','method','engine','language','extracted','reviewedAt']) || evidence.kind !== 'reviewed_screenshot' || evidence.version !== INTAKE_VERSION || !hex64(evidence.imageSha256) || !['image/png','image/jpeg'].includes(evidence.mimeType) || !Number.isSafeInteger(evidence.byteLength) || evidence.byteLength < 24 || evidence.byteLength > IMAGE_LIMITS.bytes || !Number.isSafeInteger(evidence.width) || !Number.isSafeInteger(evidence.height) || evidence.width < 32 || evidence.height < 32 || evidence.width > IMAGE_LIMITS.edge || evidence.height > IMAGE_LIMITS.edge || evidence.width * evidence.height > IMAGE_LIMITS.pixels || !canonicalTime(evidence.reviewedAt)) error('Invalid screenshot evidence.');
  if (!['local_ocr','manual_review'].includes(evidence.method) || evidence.engine !== OCR_ENGINE || evidence.language !== 'eng') error('Unsupported screenshot reader.');
  const f = evidence.extracted;
  if (!exact(f,['species','score','medal','sex']) || f.species !== null && (typeof f.species !== 'string' || !f.species.trim() || f.species.length > 100 || /[\x00-\x1f\x7f]/.test(f.species)) || f.score !== null && (typeof f.score !== 'number' || !Number.isFinite(f.score) || f.score < 0 || f.score > 1000000) || !['unknown','none','bronze','silver','gold','diamond','great_one'].includes(f.medal) || !['unknown','male','female'].includes(f.sex)) error('Invalid extracted fields.');
  if (evidence.method === 'manual_review' && Object.entries(emptyFields()).some(([key,value])=>f[key]!==value)) error('Manual image review cannot claim extracted values.');
  return structuredClone(evidence);
}

export function makeScreenshotEvidence({metadata, imageSha256, extraction, method, reviewedAt}) {
  return validateScreenshotEvidence({kind:'reviewed_screenshot',version:INTAKE_VERSION,imageSha256,...metadata,method,engine:OCR_ENGINE,language:'eng',extracted:method === 'local_ocr' ? extraction.fields : emptyFields(),reviewedAt});
}
