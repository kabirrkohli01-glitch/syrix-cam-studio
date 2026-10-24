import * as ort from '../vendor/voice/ort.wasm.min.mjs';

// Face ID: turns an aligned 112x112 face into a 128-number signature with
// SFace (OpenCV Model Zoo, Apache-2.0). Runs on the CPU, loads on first use
// and is closed by the page when idle. Only signatures leave this worker,
// never pixels, and they never leave the PC.

const base = new URL('../', import.meta.url);
ort.env.wasm.wasmPaths = {
  mjs: new URL('vendor/voice/ort-wasm-simd-threaded.mjs', base).href,
  wasm: new URL('vendor/voice/ort-wasm-simd-threaded.wasm', base).href,
};
ort.env.wasm.numThreads = 1;
// The model lists its weights as graph inputs, which makes the runtime print
// a warning per weight on load; only real errors are logged.
ort.env.logLevel = 'error';

const SIZE = 112;
let session = null;

async function load() {
  if (!session) session = await ort.InferenceSession.create(new URL('models/faceid/sface.onnx', base).href, { executionProviders: ['wasm'], logSeverityLevel: 3 });
  return session;
}

// RGBA pixels -> 1x3x112x112 RGB in 0-255, the input SFace was trained on.
async function embed(rgba) {
  const s = await load();
  const n = SIZE * SIZE;
  const x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    x[i] = rgba[i * 4];
    x[n + i] = rgba[i * 4 + 1];
    x[2 * n + i] = rgba[i * 4 + 2];
  }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, SIZE, SIZE]) });
  const v = Float32Array.from(out[s.outputNames[0]].data);
  let norm = 0;
  for (const a of v) norm += a * a;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'load') { await load(); self.postMessage({ type: 'loaded' }); }
    else if (m.type === 'embed') {
      const v = await embed(m.pixels);
      self.postMessage({ type: 'embedding', id: m.id, vector: v }, [v.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
