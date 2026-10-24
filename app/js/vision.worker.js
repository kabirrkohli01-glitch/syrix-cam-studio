import ModuleFactory from '../vendor/mediapipe/wasm/vision_wasm_internal.mjs';
import { FilesetResolver } from '../vendor/mediapipe/vision_bundle.mjs';
import {
  WASM_BASE, SEG_WIDTH, OBJECT_INTERVAL, createTask, peopleOptions,
  plainFace, plainHands, plainPose, objectList, MaskSmoother, personMask,
} from './vision-core.js';

// Runs every MediaPipe tracker off the page's main thread. The page keeps
// drawing the camera at full frame rate while a frame is being analysed here;
// a slow model frame delays the next tracking update instead of freezing the
// picture.
//
// Protocol (page -> worker):
//   { type: 'load', kind }                 load one model
//   { type: 'people', n }                  change how many people are tracked
//   { type: 'frame', id, bitmap, needs }   analyse one frame (bitmap is transferred)
// Worker -> page:
//   { type: 'loaded' | 'failed', kind, error? }
//   { type: 'result', id, face, hands, pose, objects?, mask?, timings }

// MediaPipe fetches its WebAssembly glue with importScripts(), which module
// workers do not support. The glue is imported above as a module, and the
// loader call is answered with it. Only the SIMD glue is bundled that way; a
// request for anything else fails, and the page then runs the models itself.
self.importScripts = (url) => {
  if (!/vision_wasm_internal\.js(\?|$)/.test(String(url))) throw new Error(`Unsupported loader ${url}`);
  self.ModuleFactory = ModuleFactory;
};

const tasks = { seg: null, face: null, hands: null, pose: null, objects: null };
let people = 2;
let fileset = null;
let objectsAt = -1e9;
let lastTs = 0;
const masks = new MaskSmoother();
let segCanvas = null;
let segCtx = null;

// MediaPipe requires strictly increasing timestamps per task.
function ts() {
  const t = performance.now();
  lastTs = t > lastTs ? t : lastTs + 1;
  return lastTs;
}

// Models are created one at a time: MediaPipe parks the glue on a global while
// a model starts, and two starting together would race for it.
let queue = Promise.resolve();
function load(kind) {
  queue = queue.then(async () => {
    if (tasks[kind]) { postMessage({ type: 'loaded', kind }); return; }
    try {
      if (!fileset) fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      tasks[kind] = await createTask(fileset, kind, people);
      postMessage({ type: 'loaded', kind });
    } catch (err) {
      postMessage({ type: 'failed', kind, error: String((err && err.message) || err) });
    }
  });
}

function unload(kind) {
  // Queued behind any load of the same model, so a load and an unload sent
  // in quick succession are applied in order.
  queue = queue.then(() => {
    const task = tasks[kind];
    tasks[kind] = null;
    if (task) { try { task.close(); } catch (err) { console.warn(err); } }
  });
}

function setPeople(n) {
  if (n === people) return;
  people = n;
  for (const kind of ['face', 'hands', 'pose']) {
    const task = tasks[kind];
    if (task) task.setOptions(peopleOptions(kind, n)).catch((err) => console.warn(`Could not update ${kind} options`, err));
  }
}

// A model that throws is reported back in errors, so the page can tell a
// broken worker from a frame that simply has nobody in it.
function timed(timings, kind, fn, errors) {
  const t0 = performance.now();
  let out = null;
  try { out = fn(); } catch (err) { console.error(err); errors.push(kind); }
  timings[kind] = performance.now() - t0;
  return out;
}

function segment(bitmap, timings) {
  const t0 = performance.now();
  const w = SEG_WIDTH;
  const h = Math.max(2, Math.round((SEG_WIDTH * bitmap.height) / bitmap.width));
  if (!segCanvas || segCanvas.width !== w || segCanvas.height !== h) {
    segCanvas = new OffscreenCanvas(w, h);
    segCtx = segCanvas.getContext('2d', { alpha: false });
    masks.reset();
  }
  segCtx.drawImage(bitmap, 0, 0, w, h);
  let result = null;
  try {
    result = tasks.seg.segmentForVideo(segCanvas, ts());
    const m = personMask(result);
    return m ? { data: masks.push(m.data), w: m.w, h: m.h } : null;
  } catch (err) {
    console.error(err);
    return null;
  } finally {
    if (result) result.close();
    timings.seg = performance.now() - t0;
  }
}

function analyse({ id, bitmap, needs }) {
  const timings = { seg: 0, face: 0, hands: 0, pose: 0, objects: 0 };
  const errors = [];
  const out = { type: 'result', id, face: null, hands: null, pose: null, timings, errors };
  const transfer = [];
  try {
    if (needs.seg && tasks.seg) {
      const mask = segment(bitmap, timings);
      if (mask) { out.mask = mask; transfer.push(mask.data.buffer); }
    }
    if (needs.face && tasks.face) out.face = plainFace(timed(timings, 'face', () => tasks.face.detectForVideo(bitmap, ts()), errors));
    if (needs.hands && tasks.hands) out.hands = plainHands(timed(timings, 'hands', () => tasks.hands.recognizeForVideo(bitmap, ts()), errors));
    if (needs.pose && tasks.pose) out.pose = plainPose(timed(timings, 'pose', () => tasks.pose.detectForVideo(bitmap, ts()), errors));
    if (needs.objects && tasks.objects && performance.now() - objectsAt > OBJECT_INTERVAL) {
      objectsAt = performance.now();
      const r = timed(timings, 'objects', () => tasks.objects.detectForVideo(bitmap, ts()), errors);
      if (r) out.objects = objectList(r, bitmap.width, bitmap.height);
    } else if (!needs.objects) {
      out.objects = [];
    }
  } catch (err) {
    // A result is always sent: the page waits for one before sending the
    // next frame.
    console.error(err);
    errors.push('frame');
  } finally {
    bitmap.close();
  }
  postMessage(out, transfer);
}

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'load') load(msg.kind);
  else if (msg.type === 'people') setPeople(msg.n);
  else if (msg.type === 'unload') unload(msg.kind);
  else if (msg.type === 'frame') analyse(msg);
};

postMessage({ type: 'ready' });
