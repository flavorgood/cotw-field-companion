/** Bound bitmap decoding and release results that arrive after the caller has moved on. */
export async function decodeScreenshotBitmap(blob) {
  let deadline, expired = false;
  try {
    const bitmap = Promise.resolve(globalThis.createImageBitmap(blob));
    bitmap.then(image => { if (expired) image?.close?.(); }).catch(() => {});
    return await Promise.race([
      bitmap,
      new Promise((resolve, reject) => {
        deadline = setTimeout(() => { expired = true; reject(Error('The image took too long to open.')); }, 15000);
      })
    ]);
  } finally { clearTimeout(deadline); }
}
