/** ESM entry identity. Path spelling is not process identity on Windows. */
import path from 'node:path';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export function isMain(meta, argv = process.argv[1], {resolve = path.resolve, realpath = realpathSync.native, platform = process.platform} = {}) {
  if (typeof meta?.main === 'boolean') return meta.main;
  if (typeof argv !== 'string' || !argv || typeof meta?.url !== 'string') return false;
  try {
    const left = realpath(resolve(argv));
    const right = realpath(fileURLToPath(meta.url));
    return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
  } catch { return false; }
}
