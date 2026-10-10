import {esc,safePreference,savePreference} from './data-client.js?v=267cb98126cd5bca';
import {speciesName,isGreatOneSpecies,GREAT_ONE_COLOR} from './species-style.js?v=267cb98126cd5bca';
import {mountCaptureSource} from './capture-source.js?v=267cb98126cd5bca';
import {decodeScreenshotBitmap} from './screenshot-decode.js?v=267cb98126cd5bca';

const SIZES = {
  square: [1080, 1080],
  portrait: [1080, 1350],
  wide: [1920, 1080],
  thumbnail: [1280, 720]
};
const THEMES = {
  trail: ['#181c1a', '#e5aa49', '#f2eee3'],
  snow: ['#e8ece9', '#345c64', '#192523'],
  night: ['#10151d', '#8aa9dc', '#edf1f6']
};
const LABELS = {
  lifetimeHarvests: 'CAREER HARVESTS',
  shotsFired: 'SHOTS FIRED',
  diamonds: 'DIAMONDS',
  greatOnes: 'GREAT ONES',
  longestShot: 'LONGEST SHOT',
  accuracy: 'ACCURACY',
  retainedHarvests: 'SAVED HARVESTS'
};
const DEFAULT_DESIGN = {
  title: 'MY HUNT',
  subtitle: '',
  species: '',
  alias: '',
  layout: 'stats',
  size: 'square',
  theme: 'trail',
  photoFit: 'contain',
  source: 'saved',
  metrics: ['lifetimeHarvests', 'diamonds', 'shotsFired', 'accuracy'],
  custom: ''
};
const checked = (value, values) => values.includes(value) ? 'checked' : '';

// Validate local image bytes, not the OS-provided MIME label or filename alone.
// Screenshots never leave the browser; unsupported formats get an actionable error.
export async function screenshotType(file) {
  if (!file || typeof file.slice !== 'function' || !Number.isFinite(file.size) || file.size <= 0) throw Error('This file is empty or unreadable.');
  if (file.size > 32 * 1024 * 1024) throw Error('Choose a screenshot under 32 MB.');
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const begins = values => values.every((v, i) => bytes[i] === v);
  if (begins([137,80,78,71,13,10,26,10])) return 'image/png';
  if (begins([255,216,255])) return 'image/jpeg';
  if (begins([82,73,70,70]) && [87,69,66,80].every((v,i)=>bytes[i+8]===v)) return 'image/webp';
  if (begins([66,77])) return 'image/bmp';
  throw Error('Use PNG, JPG, WebP or BMP. For HEIC or HDR/JXR captures, save a PNG or JPG copy first.');
}

export function screenshotCrop(image, width, height) {
  const ratio = Math.max(width / image.width, height / image.height);
  const w = width / ratio, h = height / ratio;
  const fraction = v => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
  return [(image.width - w) * fraction(image.studioCrop?.x), (image.height - h) * fraction(image.studioCrop?.y), w, h];
}

export async function openScreenshot(file) {
  const type = await screenshotType(file), blob = file.slice(0, file.size, type);
  let decoded, objectUrl;
  try {
    if (typeof globalThis.createImageBitmap === 'function') {
      try { decoded = await decodeScreenshotBitmap(blob); } catch { /* Try the browser image decoder below. */ }
    }
    if (!decoded) {
      decoded = await new Promise((resolve, reject) => {
        const image = new Image();
        objectUrl = URL.createObjectURL(blob);
        const timeout = setTimeout(() => { image.src = ''; reject(Error('The image took too long to open.')); }, 15000);
        image.onload = () => { clearTimeout(timeout); resolve(image); };
        image.onerror = () => { clearTimeout(timeout); reject(Error('This image could not be decoded. Try another PNG or JPG copy.')); };
        image.src = objectUrl;
      });
    }
    const width = decoded.naturalWidth || decoded.width, height = decoded.naturalHeight || decoded.height;
    if (!(width > 0 && height > 0) || width * height > 40000000) throw Error('Use an image up to 40 megapixels.');
    // Bound retained memory even for six 4K/8K captures; never modify the source file.
    const scale = Math.min(1, 2560 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('This browser could not open the image editor.');
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    canvas.studioCrop = {x:0.5,y:0.5};
    canvas.close = () => { canvas.width = 0; canvas.height = 0; };
    return canvas;
  } finally {
    decoded?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function fitted(ctx, text, x, y, width, size, style = 'bold', animal = false) {
  let fontSize = Math.max(12, size);
  ctx.font = style + ' ' + fontSize + 'px Bahnschrift, Arial, sans-serif';
  while (ctx.measureText(text).width > width && fontSize > 12) {
    ctx.font = style + ' ' + (--fontSize) + 'px Bahnschrift, Arial, sans-serif';
  }
  const previous = ctx.fillStyle;
  if (animal && isGreatOneSpecies(text)) {
    ctx.fillStyle = '#17221d';
    ctx.fillRect(x - 6, y - fontSize - 4, Math.min(width, ctx.measureText(text).width) + 12, fontSize * 1.35);
    ctx.fillStyle = GREAT_ONE_COLOR;
  }
  ctx.fillText(text, x, y);
  ctx.fillStyle = previous;
}

function cover(ctx, img, x, y, width, height, fit = 'contain') {
  if (!img) return;
  if (fit === 'contain') {
    const ratio = Math.min(width / img.width, height / img.height);
    const drawWidth = img.width * ratio;
    const drawHeight = img.height * ratio;
    ctx.drawImage(img, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    return;
  }
  ctx.drawImage(img, ...screenshotCrop(img, width, height), x, y, width, height);
}

function selectOptions(values, current) {
  return values.map(item => '<option value="' + esc(item[0]) + '"' + (current === item[0] ? ' selected' : '') + '>' + esc(item[1]) + '</option>').join('');
}

export class ShareStudio {
  constructor(root) {
    this.root = root;
    this.photos = [];
    this.state = null;
    this.error = '';
    this.busy = false;
    this.currentBlob = null;
    this.imageGeneration = 0;
    this.drawVersion = 0;
    this.exporting = false;
    this.design = Object.assign({}, DEFAULT_DESIGN, safePreference('studio-design', {}));
    this.normalize();

    root.addEventListener('input', event => this.handleDesign(event));
    root.addEventListener('change', event => {
      if (event.target.id === 'studioPhotos') {
        this.addPhotos(event.target.files);
        return;
      }
      this.handleDesign(event);
    });
    root.addEventListener('dragover', event => {
      const zone = event.target.closest('.studio-layout,.studio-import') && this.root.querySelector('#studioDropzone');
      if (!zone) return;
      event.preventDefault();
      zone.classList.add('dragging');
    });
    root.addEventListener('dragleave', event => {
      const zone = event.target.closest('.studio-layout,.studio-import') && this.root.querySelector('#studioDropzone');
      if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('dragging');
    });
    root.addEventListener('drop', event => {
      const zone = event.target.closest('.studio-layout,.studio-import') && this.root.querySelector('#studioDropzone');
      if (!zone) return;
      event.preventDefault();
      zone.classList.remove('dragging');
      this.addPhotos(event.dataTransfer?.files || []);
    });
    document.addEventListener('paste', event => {
      if (!this.root.querySelector('#studioCanvas')) return;
      // Ordinary text paste in titles/notes must keep working.
      if (event.target.closest?.('input,textarea,[contenteditable]') && event.clipboardData?.getData('text/plain')) return;
      const files = [...(event.clipboardData?.files || [])];
      if (files.length) { event.preventDefault(); void this.addPhotos(files); }
    });
    root.addEventListener('click', event => {
      const remove = event.target.closest('[data-photo-remove]');
      const move = event.target.closest('[data-photo-left]');
      if (remove) {
        const index = Number(remove.dataset.photoRemove);
        this.photos[index]?.close?.();
        this.photos.splice(index, 1);
        this.draw();
      }
      if (move) {
        const index = Number(move.dataset.photoLeft);
        if (index > 0 && index < this.photos.length) {
          [this.photos[index - 1], this.photos[index]] = [this.photos[index], this.photos[index - 1]];
          this.draw();
        }
      }
      if (event.target.closest('#studioChoosePhotos')) this.root.querySelector('#studioPhotos')?.click();
      if (event.target.closest('#studioDownload')) this.export(false);
      if (event.target.closest('#studioShare')) this.export(true);
      if (event.target.closest('#studioClearPhotos')) {
        this.imageGeneration++; // A late decoder must never restore a cleared image.
        this.photos.forEach(photo => photo.close?.());
        this.photos = [];
        this.draw();
        this.message('Photos cleared. Nothing was uploaded.');
      }
      if (event.target.closest('#studioClearDesign')) this.resetDesign();
    });
  }

  normalize() {
    if (!Array.isArray(this.design.metrics)) this.design.metrics = DEFAULT_DESIGN.metrics.slice();
    this.design.metrics = this.design.metrics.filter(key => Object.hasOwn(LABELS, key)).slice(0, 6);
    for (const key of ['title', 'subtitle', 'species', 'alias', 'custom']) {
      if (typeof this.design[key] !== 'string') this.design[key] = '';
    }
    if (!['stats', 'trophy', 'collage', 'thumbnail'].includes(this.design.layout)) this.design.layout = 'stats';
    if (!Object.hasOwn(SIZES, this.design.size)) this.design.size = 'square';
    if (!Object.hasOwn(THEMES, this.design.theme)) this.design.theme = 'trail';
    if (!['contain', 'cover'].includes(this.design.photoFit)) this.design.photoFit = 'contain';
    if (!['saved', 'custom'].includes(this.design.source)) this.design.source = 'custom';
  }

  handleDesign(event) {
    const target = event.target;
    if (target.dataset.photoFocus) {
      const photo = this.photos[Number(target.dataset.photoIndex)];
      const value = Number(target.value) / 100;
      if (photo && ['x','y'].includes(target.dataset.photoFocus) && Number.isFinite(value)) {
        photo.studioCrop[target.dataset.photoFocus] = Math.max(0, Math.min(1, value));
        this.draw(false); // Keep the range control and keyboard focus intact during adjustment.
      }
      return;
    }
    if (!target.closest('#studioControls')) return;
    if (target.name === 'studioMetric') {
      this.design.metrics = [...this.root.querySelectorAll('[name=studioMetric]:checked')].map(input => input.value).slice(0, 6);
      this.draw();
      this.persist();
      return;
    }
    const key = target.dataset.design;
    if (!key) return;
    this.design[key] = target.value;
    if (key === 'layout' && target.value === 'thumbnail') this.design.size = 'thumbnail';
    if (key === 'layout' && target.value !== 'thumbnail' && this.design.size === 'thumbnail') this.design.size = 'square';
    if (key === 'layout') {
      const sizeSelect = this.root.querySelector('select[data-design="size"]');
      if (sizeSelect) sizeSelect.value = this.design.size;
    }
    this.currentBlob = null;
    this.draw();
    this.persist();
  }

  persist() {
    savePreference('studio-design', Object.assign({}, this.design, {metrics: this.design.metrics.slice()}));
  }

  resetDesign() {
    this.design = Object.assign({}, DEFAULT_DESIGN, {metrics: DEFAULT_DESIGN.metrics.slice()});
    this.persist();
    this.draw();
    this.message('Design reset. Your photos were not stored.');
    const controls = this.root.querySelector('#studioControls');
    if (controls) {
      controls.querySelectorAll('[data-design]').forEach(input => {
        const value = this.design[input.dataset.design];
        if (input.type === 'checkbox') input.checked = this.design.metrics.includes(input.value);
        else input.value = value || '';
      });
    }
  }

  message(text, error = false) {
    for (const element of this.root.querySelectorAll('#studioMessage,#studioImportStatus')) {
      element.textContent = text;
      element.className = error ? 'error' : 'muted small';
    }
  }

  exportControls() {
    for (const button of this.root.querySelectorAll('#studioDownload,#studioShare')) button.disabled = this.busy || this.exporting || !this.currentBlob;
  }

  prepareExport(canvas, version) {
    this.exportControls();
    // Encode before a Share click so native sharing keeps its user activation.
    canvas.toBlob(blob => {
      if (version !== this.drawVersion || this.root.querySelector('#studioCanvas') !== canvas) return;
      this.currentBlob = blob;
      this.exportControls();
      if (!blob) this.message('The preview could not be exported. Try a smaller image.', true);
    }, 'image/png');
  }

  async addPhotos(files) {
    if (this.busy) { this.message('Images are still opening. Wait before choosing more.', true); return; }
    const selected = Array.from(files || []);
    if (!selected.length) return; // Cancelling the picker leaves the working card untouched.
    if (this.photos.length >= 6) { this.message('Six images are already added. Remove one before adding another.', true); return; }
    this.busy = true;
    this.currentBlob = null;
    this.exportControls();
    const generation = this.imageGeneration, errors = [];
    let added = 0;
    this.message('Opening screenshots on this device…');
    try {
      for (const file of selected) {
        if (generation !== this.imageGeneration) break;
        if (this.photos.length >= 6) { errors.push('Only six images fit. Remove one to add another.'); break; }
        try {
          const image = await openScreenshot(file);
          if (generation !== this.imageGeneration) { image.close?.(); break; }
          this.photos.push(image); added++;
        } catch (error) {
          errors.push(String(file?.name || 'Image').slice(0,80) + ': ' + (error.message || 'Could not open this image.'));
        }
      }
    } finally {
      this.busy = false;
      const input = this.root.querySelector('#studioPhotos');
      if (input) input.value = '';
      this.draw(); // A bad file must not hide the valid screenshots in the same batch.
    }
    if (generation !== this.imageGeneration) return;
    this.message((added ? added + ' screenshot(s) added to your card. ' : '') + (errors.length ? errors.join(' ') : 'Images stay in this browser. Career, trophy and thumbnail cards use the first image; collage uses all.'), errors.length > 0);
  }

  render(state) {
    this.state = state;
    const design = this.design;
    const hasStats = Boolean(state?.career?.summary);
    const demo = state?.demo === true;
    if (!hasStats && design.source === 'saved') design.source = 'custom';
    const styleOptions = selectOptions([
      ['stats', 'Career card'],
      ['trophy', 'Trophy card'],
      ['collage', 'Photo collage'],
      ['thumbnail', 'Hunting thumbnail']
    ], design.layout);
    const sizeOptions = selectOptions([
      ['square', 'Square · 1080 × 1080'],
      ['portrait', 'Portrait · 1080 × 1350'],
      ['wide', 'Wide · 1920 × 1080'],
      ['thumbnail', 'Thumbnail · 1280 × 720']
    ], design.size);
    const themeOptions = selectOptions([
      ['trail', 'Trail'],
      ['snow', 'Snow'],
      ['night', 'Night']
    ], design.theme);
    const metricOptions = Object.entries(LABELS).map(entry => {
      const key = entry[0], label = entry[1];
      return '<label><input type="checkbox" name="studioMetric" value="' + esc(key) + '" ' + checked(key, design.metrics) + '>' + esc(label.toLowerCase()) + '</label>';
    }).join('');
    const sourceOptions = hasStats
      ? '<option value="custom"' + (design.source === 'custom' ? ' selected' : '') + '>What I enter</option><option value="saved"' + (design.source === 'saved' ? ' selected' : '') + '>' + (demo ? 'Sample hunter data · fictional' : 'My game saves') + '</option>'
      : '<option value="custom" selected>What I enter</option>';
    const demoBadge = demo ? '<span class="pill studio-demo-badge">DEMO DATA · FICTIONAL SAMPLE</span>' : '<span class="pill">Photos stay on this device</span>';

    queueMicrotask(() => {
      this.captureSource?.dispose();
      const captureHost=this.root.querySelector('[data-studio-capture-source]');
      if(captureHost)this.captureSource=mountCaptureSource(captureHost,{onSelect:file=>this.addPhotos([file])});
      this.draw();
    });
    return [
      '<div class="intro studio-intro"><div><div class="eyebrow">SHARE YOUR HUNT</div><h1>Trophy studio</h1><p>Make a card or a hunting thumbnail in three quick steps.</p></div>' + demoBadge + '</div>',
      '<div class="studio-steps" aria-label="Studio steps"><div><b>1</b><span>Add a screenshot</span></div><div><b>2</b><span>Pick a style</span></div><div><b>3</b><span>Save or share</span></div></div>',
      '<section class="panel studio-controls studio-import" aria-label="Choose your screenshots">',
      '<div data-studio-capture-source></div>',
      '<div id="studioDropzone" class="studio-dropzone" tabindex="0"><strong>1. Add an in-game screenshot</strong><span>Choose a saved screenshot from Photos or Files. You can also drop or paste one.</span><button id="studioChoosePhotos" type="button" class="button primary studio-photo-button">Choose screenshots</button><input id="studioPhotos" class="studio-file-input" type="file" accept="image/*,.png,.jpg,.jpeg,.webp,.bmp" multiple><small>Up to 6 images · PNG, JPG, WebP or BMP · 32 MB each</small></div>',
      '<p id="studioImportStatus" role="status" class="muted small">Screenshots are processed locally, not uploaded.</p>',
      '<div id="studioPhotoStrip" class="studio-photo-strip" aria-live="polite"></div>',
      '</section><div class="studio-layout"><section id="studioControls" class="panel studio-controls"><h2>Style your card</h2>',
      '<label>2. Pick a style<select data-design="layout">' + styleOptions + '</select></label>',
      '<div class="form-grid"><label>Picture shape<select data-design="size">' + sizeOptions + '</select></label><label>Colors<select data-design="theme">' + themeOptions + '</select></label></div>',
      '<label>Title<input data-design="title" maxlength="70" value="' + esc(design.title) + '"></label>',
      '<label>Your name <span class="muted">(optional)</span><input data-design="alias" maxlength="50" placeholder="Only shown on your image" value="' + esc(design.alias) + '"></label>',
      '<label>Animal <span class="muted">(optional)</span><input data-design="species" maxlength="70" placeholder="For example, Moose" value="' + esc(design.species) + '"></label>',
      '<p id="studioSpeciesLabel" class="small great-one-hint" ' + (design.species ? '' : 'hidden') + '>' + (design.species ? speciesName(design.species) : '') + '</p>',
      '<label>Extra details <span class="muted">(optional)</span><input data-design="subtitle" maxlength="140" placeholder="Score, reserve, date…" value="' + esc(design.subtitle) + '"></label>',
      '<details class="studio-section"><summary>Stats on your image</summary><label>Use stats from<select data-design="source">' + sourceOptions + '</select></label>',
      '<fieldset class="studio-metrics" ' + (hasStats ? '' : 'hidden') + '><legend>Choose up to 6 stats</legend>' + metricOptions + '</fieldset>',
      '<label>Your own stats <span class="muted">(name: value)</span><textarea data-design="custom" rows="4" maxlength="800" placeholder="Favorite reserve: Askiy Ridge&#10;Best trophy: 9.6">' + esc(design.custom) + '</textarea></label></details>',
      '<label>Photo fit<select data-design="photoFit"><option value="contain"' + (design.photoFit === 'contain' ? ' selected' : '') + '>Show the whole photo</option><option value="cover"' + (design.photoFit === 'cover' ? ' selected' : '') + '>Crop to fill · adjust each image above</option></select></label>',
      '<p class="small muted">Career, trophy and thumbnail cards use the first image. Choose Photo collage to show several.</p>',
      '<div class="actions"><button id="studioClearPhotos" class="button subtle" type="button">Clear images</button><button id="studioClearDesign" class="button subtle" type="button">Reset design</button></div>',
      '<p class="tiny muted">Images are processed in this browser. They are not uploaded or saved by this companion.</p></section>',
      '<section class="studio-preview"><div class="panel-head"><div><div class="eyebrow">LIVE PREVIEW</div><h2>Your image</h2></div><span class="small muted">PNG export</span></div><canvas id="studioCanvas" width="1080" height="1080" aria-label="Preview of your hunting image"></canvas><div class="studio-export"><button id="studioDownload" class="button primary" type="button">Save image</button><button id="studioShare" class="button" type="button">Share image</button></div><p id="studioMessage" role="status" class="muted small">Check the preview, then save or share. Stats you enter are labeled on the image.</p></section></div>'
    ].join('');
  }

  metrics() {
    const design = this.design;
    if (design.source === 'custom') {
      return design.custom.split(/\r?\n/).filter(line => line.includes(':')).slice(0, 6).map(line => {
        const index = line.indexOf(':');
        return {label: line.slice(0, index).trim().slice(0, 36), value: line.slice(index + 1).trim().slice(0, 48)};
      });
    }
    const summary = Object.assign({}, this.state?.career?.summary, {retainedHarvests: this.state?.career?.retainedHarvests});
    return design.metrics.slice(0, 6).map(key => {
      const value = summary[key];
      let formatted = 'Not available';
      if (Number.isFinite(value)) {
        if (key === 'accuracy') formatted = (value * 100).toFixed(1) + '%';
        else if (key === 'longestShot') formatted = value.toFixed(1) + ' m';
        else formatted = value.toLocaleString();
      }
      return {label: LABELS[key] || key, value: formatted};
    });
  }

  renderPhotos() {
    const host = this.root.querySelector('#studioPhotoStrip');
    if (!host) return;
    host.innerHTML = this.photos.map((photo, index) => {
      return '<div class="studio-photo"><canvas width="160" height="100" data-photo-preview="' + index + '" aria-label="Photo ' + (index + 1) + '"></canvas><div><button type="button" class="button small" data-photo-left="' + index + '" aria-label="Move photo ' + (index + 1) + ' left"' + (index === 0 ? ' disabled' : '') + '>&larr;</button><button type="button" class="button small" data-photo-remove="' + index + '" aria-label="Remove photo ' + (index + 1) + '">&times;</button></div></div>';
    }).join('') + (this.design.photoFit === 'cover' ? this.photos.map((photo,index) => '<details class="studio-section"><summary>Adjust crop · image ' + (index + 1) + '</summary><label>Left / right<input type="range" min="0" max="100" value="' + Math.round((photo.studioCrop?.x ?? 0.5)*100) + '" data-photo-focus="x" data-photo-index="' + index + '"></label><label>Top / bottom<input type="range" min="0" max="100" value="' + Math.round((photo.studioCrop?.y ?? 0.5)*100) + '" data-photo-focus="y" data-photo-index="' + index + '"></label></details>').join('') : '');
    host.querySelectorAll('canvas').forEach((canvas, index) => {
      const context = canvas.getContext('2d');
      context.fillStyle = '#101711';
      context.fillRect(0, 0, 160, 100);
      cover(context, this.photos[index], 0, 0, 160, 100, 'contain');
    });
  }

  draw(renderPhotos = true) {
    if (renderPhotos) this.renderPhotos();
    const canvas = this.root.querySelector('#studioCanvas');
    if (!canvas) return;
    const version = ++this.drawVersion;
    this.currentBlob = null;
    const design = this.design;
    const speciesElement = this.root.querySelector('#studioSpeciesLabel');
    if (speciesElement) {
      speciesElement.hidden = !design.species;
      speciesElement.innerHTML = design.species ? speciesName(design.species) : '';
    }
    const size = SIZES[design.size] || SIZES.square;
    const palette = THEMES[design.theme] || THEMES.trail;
    const width = size[0], height = size[1], background = palette[0], accent = palette[1], ink = palette[2];
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const pad = width * 0.055;

    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = accent;
    context.globalAlpha = 0.09;
    context.lineWidth = 1.5;
    for (let index = 0; index < 11; index += 1) {
      context.beginPath();
      context.ellipse(width * 0.86, height * 0.21, width * (0.09 + index * 0.035), height * (0.08 + index * 0.033), -0.3, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
    context.fillStyle = accent;
    context.fillRect(pad, pad, width * 0.09, 7);
    context.fillStyle = ink;
    fitted(context, design.alias ? design.alias.toUpperCase() : 'GRINDZONE', pad, pad + 45, width - (2 * pad), Math.min(28, width * 0.025));
    const metrics = this.metrics();

    if (design.layout === 'thumbnail') {
      this.drawThumbnail(context, metrics, width, height, pad, background, accent, ink);
      this.prepareExport(canvas, version);
      return;
    }

    fitted(context, design.title || 'MY HUNT', pad, pad + 125, width - (2 * pad), Math.min(84, width * 0.06, height * 0.065));
    if (design.species) fitted(context, design.species, pad, pad + 175, width - (2 * pad), width * 0.027, 'bold', true);
    if (design.subtitle) fitted(context, design.subtitle, pad, pad + (design.species ? 216 : 175), width - (2 * pad), width * 0.024, 'normal');

    const top = pad + (design.species && design.subtitle ? 250 : 210);
    const bottom = height - 110;
    const available = Math.max(120, bottom - top);
    if (design.layout === 'collage' || design.layout === 'trophy' || this.photos.length) {
      const count = design.layout === 'collage' ? Math.max(1, Math.min(6, this.photos.length || 4)) : 1;
      const columns = count === 1 ? 1 : count > 4 ? 3 : 2;
      const rows = Math.ceil(count / columns);
      const gap = 12;
      const imageHeight = metrics.length ? available * 0.64 : available;
      for (let index = 0; index < count; index += 1) {
        const imageWidth = (width - (2 * pad) - (gap * (columns - 1))) / columns;
        const imageBoxHeight = (imageHeight - (gap * (rows - 1))) / rows;
        const x = pad + (index % columns) * (imageWidth + gap);
        const y = top + Math.floor(index / columns) * (imageBoxHeight + gap);
        context.fillStyle = accent;
        context.globalAlpha = 0.13;
        context.fillRect(x, y, imageWidth, imageBoxHeight);
        context.globalAlpha = 1;
        if (this.photos[index]) cover(context, this.photos[index], x, y, imageWidth, imageBoxHeight, design.photoFit);
        else {
          context.fillStyle = ink;
          fitted(context, 'ADD YOUR TROPHY PHOTO', x + 20, y + (imageBoxHeight / 2), imageWidth - 40, width * 0.02);
        }
      }
      if (metrics.length) this.drawMetrics(context, metrics, pad, top + imageHeight + 25, width - (2 * pad), available - imageHeight - 25, accent, ink, Math.min(3, metrics.length));
    } else {
      this.drawMetrics(context, metrics.length ? metrics : [{label: 'YOUR RECORD', value: 'Choose stats in the editor'}], pad, top, width - (2 * pad), available, accent, ink, 2);
    }
    this.drawFooter(context, width, height, pad, accent, ink);
    this.prepareExport(canvas, version);
  }

  drawThumbnail(context, metrics, width, height, pad, background, accent, ink) {
    const imageWidth = Math.round(width * 0.46);
    const imageX = width - imageWidth;
    context.fillStyle = '#0c1110';
    context.fillRect(imageX, 0, imageWidth, height);
    if (this.photos[0]) cover(context, this.photos[0], imageX, 0, imageWidth, height, this.design.photoFit);
    context.fillStyle = background;
    context.globalAlpha = 0.92;
    context.fillRect(0, 0, imageX + 10, height);
    context.globalAlpha = 1;
    context.fillStyle = accent;
    context.fillRect(pad, pad + 18, 110, 8);
    fitted(context, 'THE HUNT', pad, pad + 72, imageX - (2 * pad), Math.min(28, width * 0.025), 'bold');
    fitted(context, this.design.title || 'MY HUNT', pad, pad + 165, imageX - (2 * pad), Math.min(82, width * 0.075));
    if (this.design.species) fitted(context, this.design.species, pad, pad + 220, imageX - (2 * pad), width * 0.034, 'bold', true);
    if (this.design.subtitle) fitted(context, this.design.subtitle, pad, pad + 260, imageX - (2 * pad), width * 0.022, 'normal');
    if (!this.photos.length) {
      context.fillStyle = accent;
      context.globalAlpha = 0.16;
      context.fillRect(imageX + 22, 22, imageWidth - 44, height - 44);
      context.globalAlpha = 1;
      context.fillStyle = ink;
      fitted(context, 'ADD A SCREENSHOT', imageX + 45, height / 2, imageWidth - 90, width * 0.02);
    }
    const thumbMetrics = metrics.slice(0, 3);
    if (thumbMetrics.length) this.drawMetrics(context, thumbMetrics, pad, height - 170, imageX - (2 * pad), 120, accent, ink, Math.min(3, thumbMetrics.length));
    this.drawFooter(context, width, height, pad, accent, ink);
  }

  drawMetrics(context, metrics, x, y, width, height, accent, ink, columns) {
    const rows = Math.ceil(metrics.length / columns);
    const gap = 18;
    const cellWidth = (width - (gap * (columns - 1))) / columns;
    const cellHeight = Math.max(54, (height - (gap * (rows - 1))) / rows);
    metrics.forEach((metric, index) => {
      const xx = x + (index % columns) * (cellWidth + gap);
      const yy = y + Math.floor(index / columns) * (cellHeight + gap);
      context.strokeStyle = accent;
      context.globalAlpha = 0.45;
      context.strokeRect(xx, yy, cellWidth, cellHeight);
      context.globalAlpha = 1;
      context.fillStyle = ink;
      fitted(context, String(metric.label).toUpperCase(), xx + 24, yy + 38, cellWidth - 48, Math.min(22, cellHeight * 0.16), 'normal');
      const upper = String(metric.label).toUpperCase();
      context.fillStyle = upper.includes('DIAMOND') ? '#b9dfe5' : upper.includes('GOLD') || upper.includes('GREAT ONE') ? '#f0c76d' : accent;
      fitted(context, String(metric.value), xx + 24, yy + Math.max(75, cellHeight * 0.66), cellWidth - 48, Math.min(72, cellHeight * 0.40), 'bold');
    });
  }

  drawFooter(context, width, height, pad, accent, ink) {
    context.strokeStyle = accent;
    context.globalAlpha = 0.45;
    context.beginPath();
    context.moveTo(pad, height - 80);
    context.lineTo(width - pad, height - 80);
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = ink;
    const source = !this.metrics().length ? 'PLAYER SCREENSHOT' : this.design.source === 'saved'
      ? (this.state?.demo ? 'DEMO DATA · FICTIONAL SAMPLE' : 'FROM GAME SAVES · ' + (this.state?.career?.savedAt ? new Date(this.state.career.savedAt).toLocaleDateString() : 'last update'))
      : 'CUSTOM STATS · ENTERED BY PLAYER';
    fitted(context, source, pad, height - 47, width * 0.68, width * 0.017, 'normal');
    context.textAlign = 'right';
    fitted(context, 'GRINDZONE', width - pad, height - 47, width * 0.25, width * 0.017);
    context.textAlign = 'left';
  }

  async export(share) {
    if (this.exporting) return;
    try {
      const canvas = this.root.querySelector('#studioCanvas');
      if (!canvas) throw Error('Open the studio preview first.');
      const blob = this.currentBlob;
      if (this.busy || !blob) throw Error('Wait for your screenshot preview to finish before saving.');
      this.exporting = true;
      this.exportControls();
      const filename = this.design.layout === 'thumbnail' ? 'cotw-hunting-thumbnail.png' : 'cotw-hunting-card.png';
      const file = new File([blob], filename, {type: 'image/png'});
      if (share && navigator.share && navigator.canShare?.({files: [file]})) {
        await navigator.share({files: [file], title: this.design.title || 'COTW Companion'});
        this.message('Image shared through your device.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      this.message(share ? 'Sharing is not available in this browser. Your image is ready to save instead.' : 'Your image is ready to save. Your photos were not uploaded.');
    } catch (error) {
      if (error.name !== 'AbortError') this.message(error.message || 'Could not export this image.', true);
    } finally {
      this.exporting = false;
      this.exportControls();
    }
  }
}
