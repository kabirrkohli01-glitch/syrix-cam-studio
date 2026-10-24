// Shared set-up for the on-device voice workers: every model and runtime file
// is loaded from the app folder, never from the internet.

import { env } from '../../vendor/voice/transformers.min.js';

const root = new URL('../../', import.meta.url);
export const appUrl = (path) => new URL(path, root).href;

env.allowRemoteModels = false;
env.allowLocalModels = true;
// A path, not a full URL: transformers.js only treats non-URL locations as
// local model folders, and would otherwise report every file as missing.
env.localModelPath = new URL('models/voice/', root).pathname;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: appUrl('vendor/voice/ort-wasm-simd-threaded.asyncify.mjs'),
  wasm: appUrl('vendor/voice/ort-wasm-simd-threaded.asyncify.wasm'),
};
env.backends.onnx.wasm.proxy = false;

export function setThreads(n) {
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? n : 1;
}

export async function hasWebGPU() {
  try {
    if (!self.navigator || !navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    return !!adapter && adapter.features.has('shader-f16');
  } catch {
    return false;
  }
}

// Reports aggregate download/initialisation progress across a model's files.
export function progressTracker(post) {
  const files = new Map();
  let last = 0;
  return (p) => {
    if (p.status === 'progress' && p.total) files.set(p.file, [p.loaded, p.total]);
    else if (p.status === 'done' && files.has(p.file)) files.set(p.file, [files.get(p.file)[1], files.get(p.file)[1]]);
    let a = 0, b = 0;
    for (const [l, t] of files.values()) { a += l; b += t; }
    const pct = b ? Math.round((a / b) * 100) : 0;
    if (pct !== last) { last = pct; post(pct); }
  };
}

// Minimal PCM WAV reader (16-bit or 32-bit float, any channel count; the
// first channel is used).
export function decodeWav(buf) {
  const v = new DataView(buf);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const len = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 'data') data = { offset: o + 8, length: len };
    o += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('Unreadable WAV file');
  const step = (fmt.bits / 8) * fmt.channels;
  const n = Math.floor(data.length / step);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = data.offset + i * step;
    out[i] = fmt.bits === 32 && fmt.format === 3 ? v.getFloat32(p, true) : v.getInt16(p, true) / 32768;
  }
  return { audio: out, rate: fmt.rate };
}
