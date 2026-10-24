// Generates app/vendor/mediapipe/wasm/vision_wasm_internal.mjs, an ES-module
// copy of MediaPipe's WebAssembly glue for the vision worker.
//
// MediaPipe loads its glue with importScripts(), which throws inside a module
// worker, and the glue only declares a script-scoped `var ModuleFactory`. The
// worker imports this copy instead and hands the factory to MediaPipe itself.
// Run again whenever vendor/mediapipe is updated.
//
//   node build/make-vision-worker.mjs [path-to-app-folder]

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const app = process.argv[2] || join(root, 'app');
const dir = join(app, 'vendor', 'mediapipe', 'wasm');
const src = readFileSync(join(dir, 'vision_wasm_internal.js'), 'utf8');
if (!/var ModuleFactory\s*=/.test(src)) throw new Error('Unexpected MediaPipe glue: no ModuleFactory declaration');
// Modules are strict mode. The glue declares its fallback logger inside an
// `if` block and calls it after the block, which only works in sloppy
// scripts; in a module the call throws and every model fails to start. The
// logger is declared once at module level instead.
if (!src.includes('function custom_dbg(text)')) throw new Error('Unexpected MediaPipe glue: custom_dbg fallback not found');
const prelude = 'function custom_dbg(text) { console.warn.apply(console, arguments); }\n';
writeFileSync(join(dir, 'vision_wasm_internal.mjs'), `${prelude}${src}\nexport default ModuleFactory;\n`);
console.log(`Wrote ${join(dir, 'vision_wasm_internal.mjs')}`);
