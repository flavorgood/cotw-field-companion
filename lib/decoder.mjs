/** Legacy Node wrapper around the canonical browser-compatible COTW decoder. */
import {inflateSync} from 'node:zlib';
import {decodeADF,decodeADFScalars,saveEnvelope} from '../public/save-decoder.js';
export {decodeADF};
function unwrapSave(file){const {compressed,expected}=saveEnvelope(file);const raw=inflateSync(compressed,{maxOutputLength:32*1024*1024});if(raw.length!==expected)throw Error('Save length mismatch');return raw;}
export function decodeSave(file){return decodeADF(unwrapSave(file));}
export function decodeSaveScalars(file,wanted){return decodeADFScalars(unwrapSave(file),wanted);}
