import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync} from 'node:crypto';
import {buildPortable} from '../tools/build-portable.mjs';
import {signPackage,storageMigrationDeclaration} from '../tools/build-managed-download.mjs';
import {verifyDirectory} from '../updates/engine.mjs';
import {desktopFiles} from '../tools/build-desktop.mjs';

test('native window members survive portable staging and Ed25519 managed signing',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gz-desktop-package-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const sourceRoot=fileURLToPath(new URL('../',import.meta.url)),stage=path.join(root,'stage');
 const assets=desktopFiles.map(name=>({path:'desktop/'+name,bytes:Buffer.from(name.endsWith('.config')?'configuration':'MZ signed fixture')}));
 const portable=buildPortable(sourceRoot,stage,{desktopFiles:assets});
 assert.deepEqual(portable.files.filter(f=>f.path.startsWith('desktop/')).map(f=>f.path),assets.map(a=>a.path));
 fs.mkdirSync(path.join(stage,'runtime'));fs.writeFileSync(path.join(stage,'runtime/node.exe'),'MZ test runtime');fs.writeFileSync(path.join(stage,'runtime/LICENSE'),'test license');
 const pair=generateKeyPairSync('ed25519'),trust={keys:{test:pair.publicKey.export({format:'pem',type:'spki'})},updateUrl:'https://example.test/latest.json'};
 fs.writeFileSync(path.join(stage,'updates/trust.json'),JSON.stringify(trust));
 const {manifest}=signPackage({directory:stage,revision:'a'.repeat(40),sequence:1,publishedAt:'2026-09-24T00:00:00Z',trust,privateKey:pair.privateKey.export({format:'pem',type:'pkcs8'})});
 assert.deepEqual(manifest.storageMigration,storageMigrationDeclaration(manifest.storageContract));
 assert(manifest.files.some(f=>f.path==='desktop/GrindZone.Desktop.exe'));
 assert(verifyDirectory(stage,manifest));
});

test('directed storage migration declaration is emitted only for the designated package digest',()=>{
 const from='dc432ed6c7310c3c4838c3cc1bc75ca39a94360415a7a5a7c1b7923262ea78e1';
 const to='36fa80548ed26eda06101b2db3c271a00547d1d14f5b94e18108ad4a86209e33';
 assert.equal(storageMigrationDeclaration(from),undefined);
 assert.equal(storageMigrationDeclaration('f'.repeat(64)),undefined);
 assert.deepEqual(storageMigrationDeclaration(to),{fromContract:from,toContract:to});
});
