/** Private release staging from reviewed source only; never inspect the installed app or player data. */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHerdReference } from './build-herd-reference.mjs';

export const portableFiles = Object.freeze([
  'package.json', 'START.cmd', 'INSTALL.cmd', 'launcher.mjs', 'server.mjs', 'README.md',
  'licenses/APC-MIT.txt', 'licenses/qrcode-generator-MIT.txt',
  ...['entry.mjs','engine.mjs','supervisor.mjs','context.mjs','child.mjs','boot.mjs','install.mjs','trust.json'].map(name => `updates/${name}`),
  ...['runtime-identity.mjs','herd-ledger.mjs','herd-view.mjs','herd-trophies.mjs','herd-reference.mjs','herd-reference.json','hunt-locations.mjs','save-data.mjs','career.mjs','core.mjs','decoder.mjs','gear-data.json','hunting-pressure.mjs','maps-data.json','observer.mjs','save-observer.mjs','zone-discovery.mjs','zone-reference.mjs','phone-access.mjs','phone-registration.mjs','phone-bridge.mjs','phone-service.json','rating-data.json','reference.json','stat-definitions.json','store.mjs','route-planner.mjs','route-setup.mjs','zone-ledger.mjs','zone-phone.mjs'].map(name => `lib/${name}`),
  ...['updates-ui.js','herd-view.js','herd-view.css','hunt-locations.js','hunt-locations.css','save-data.js','save-data.css','save-decoder.js','app.js','zone-window.js','dashboard.js','grinds.js','commands.js','route-stops.js','route-setup.js','setup-catalog.js','harvest-view.js','phone-ui.js','phone.css','qrcode.js','species-style.js','career.js','data-client.js','feedback.js','field-library.js','field-theme.css','hunting-workspace.css','icon.svg','index.html','map-atlas.js','map-geometry.js','map.js','maps.css','public.html','public.js','reference-core.js','reference.js','studio.js','screenshot-decode.js','capture-source.js','capture-source.css','style.css','terrain-layer.js'].map(name => `public/${name}`),
]);
const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function buildPortable(root, destination, {desktopFiles=[]}={}) {
  const source = realpathSync(root), output = path.resolve(destination);
  if (existsSync(output)) throw Error('Portable destination already exists; use a new release directory.');
  const prepared = portableFiles.map(name => {
    const full = path.join(source, name);
    let part = source;
    for (const segment of name.split('/')) {
      part = path.join(part, segment);
      if (lstatSync(part).isSymbolicLink()) throw Error(`Portable source cannot follow a symlink: ${name}`);
    }
    if (!lstatSync(full).isFile()) throw Error(`Portable source must be a regular file: ${name}`);
    const bytes = readFileSync(full);
    return { name, full, bytes, sha256: hash(bytes) };
  });
  if(!Array.isArray(desktopFiles)||desktopFiles.length>16)throw Error('Invalid desktop build file list');
  const seen=new Set(prepared.map(item=>item.name.toLowerCase()));
  for(const item of desktopFiles){
    if(!item||typeof item.path!=='string'||!/^desktop\/[A-Za-z0-9_.-]+$/.test(item.path)||seen.has(item.path.toLowerCase())||!Buffer.isBuffer(item.bytes)||item.bytes.length<1||item.bytes.length>10*1024*1024)throw Error('Invalid desktop build member');
    seen.add(item.path.toLowerCase());prepared.push({name:item.path,bytes:item.bytes,sha256:hash(item.bytes)});
  }
  const version = JSON.parse(prepared.find(item => item.name === 'package.json').bytes).version;
  // Snapshot all reviewed input before creating output. Publication is a separate action.
  mkdirSync(output, { recursive: false });
  for (const item of prepared) {
    const target = path.join(output, item.name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, item.bytes, { flag: 'wx' });
  }
  const receipt = {
    schema: 'field.portable-package.v1', version,
    productName: 'GrindZone', finalNamePending: false,
    distribution: 'private-staged-local-preview', targetHub: 'Skill Gaming World',
    platform: 'Windows', requires: 'Node.js 22.13 or newer', entrypoint: 'START.cmd',
    price: 0, paymentRequired: false, donationUrl: null,
    onlineTerrain: 'Optional map imagery is streamed from DECA; images are not bundled.',
    playerDataIncluded: false, published: false,
    files: prepared.map(item => ({ path: item.name, bytes: item.bytes.length, sha256: item.sha256 })),
  };
  writeFileSync(path.join(output, 'PORTABLE-PACKAGE.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('Provide a new output directory: node tools/build-portable.mjs <directory>');
  await buildHerdReference();
  const receipt = buildPortable(sourceRoot, process.argv[2]);
  console.log(JSON.stringify({ output: path.resolve(process.argv[2]), files: receipt.files.length, bytes: receipt.files.reduce((sum, item) => sum + item.bytes, 0), published: false }));
}
