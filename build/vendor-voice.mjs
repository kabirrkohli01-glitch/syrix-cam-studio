// Prepares the published kokoro-js module for loading straight from the app
// folder: bare package imports become relative files, the Node-only modules
// become empty stubs, and voices load from the bundled models instead of the
// model hub. Run after replacing build/vendor-src/kokoro.src.js (the
// published dist/kokoro.js of kokoro-js 1.2.1).
//
// Usage: node build/vendor-voice.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'app', 'vendor', 'voice');
let src = readFileSync(join(here, 'vendor-src', 'kokoro.src.js'), 'utf8');

const swaps = [
  ['from"@huggingface/transformers"', 'from"./transformers.min.js"'],
  ['from"phonemizer"', 'from"./phonemizer.js"'],
  ['import s from"path";import i from"fs/promises";', 'const s={},i={};'],
  ['https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${e}.bin',
   '${new URL("../../models/voice/kokoro/voices/"+e+".bin",import.meta.url).href}'],
];
for (const [from, to] of swaps) {
  if (!src.includes(from)) throw new Error(`kokoro.src.js no longer contains: ${from}`);
  src = src.split(from).join(to);
}
writeFileSync(join(dir, 'kokoro.js'), src);
console.log('Wrote app/vendor/voice/kokoro.js');
