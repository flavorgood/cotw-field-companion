import {inspectScreenshot, extractHarvest} from './harvest-intake-core.js';
let library;
function loadLibrary() {
  if (!library) library = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('vendor/ocr/tesseract.min.js', import.meta.url).href;
    script.onload = () => globalThis.Tesseract?.createWorker ? resolve(globalThis.Tesseract) : reject(Error('Screenshot reader did not load.'));
    script.onerror = () => { script.remove(); library = null; reject(Error('Screenshot reader is unavailable. Your journal is unchanged.')); };
    document.head.append(script);
  }).catch(error=>{library=null;throw error;});
  return library;
}
export async function prepareScreenshot(file) {
  if (!(file instanceof Blob) || file.size > 12 * 1024 * 1024) throw Error('Choose a PNG or JPEG screenshot up to 12 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer()), metadata = inspectScreenshot(bytes, file.type);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const imageSha256 = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2,'0')).join('');
  // Decode before offering review. A valid-looking header is not a usable image.
  const bitmap = await createImageBitmap(file);
  try {
    if (Math.min(bitmap.width,bitmap.height) !== Math.min(metadata.width,metadata.height) || Math.max(bitmap.width,bitmap.height) !== Math.max(metadata.width,metadata.height)) throw Error('Screenshot dimensions do not match its header.');
  } finally { bitmap.close(); }
  return {metadata,imageSha256};
}

export async function recognizeScreenshot(file, speciesNames, {signal, onProgress = () => {}} = {}) {
  let worker, abandoned = false, timer, abort;
  const cancelError = () => Object.assign(new Error('Screenshot reading cancelled. Nothing was counted.'), {name:'AbortError'});
  const stop = () => { abandoned = true; if (worker) void worker.terminate().catch(() => {}); };
  const cancelled = new Promise((_,reject) => {
    abort = () => { stop(); reject(cancelError()); };
    if (signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
    timer = setTimeout(() => { stop(); reject(Error('Screenshot reading timed out. Retry or review the image manually.')); }, 120000);
  });
  const work = (async () => {
    const Tesseract = await loadLibrary();
    if (abandoned) throw cancelError();
    const base = new URL('vendor/ocr/', import.meta.url).href;
    worker = await Tesseract.createWorker('eng', 1, {
      workerPath: base + 'worker.min.js', corePath: base + 'core', langPath: base + 'lang',
      workerBlobURL: false, cacheMethod: 'none', gzip: true,
      logger: message => { if (!abandoned) onProgress(message.status, message.progress); }
    });
    if (abandoned) { await worker.terminate(); throw cancelError(); }
    await worker.setParameters({tessedit_pageseg_mode: '11'});
    const result = await worker.recognize(file, {}, {text:true});
    if (abandoned) throw cancelError();
    return extractHarvest({text:result.data.text, confidence:result.data.confidence, speciesNames});
  })();
  try { return await Promise.race([work,cancelled]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); stop(); }
}
