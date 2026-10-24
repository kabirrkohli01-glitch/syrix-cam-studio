import {
  FilesetResolver, FaceLandmarker, GestureRecognizer, PoseLandmarker,
} from '../vendor/mediapipe/vision_bundle.mjs';
import {
  WASM_BASE, SEG_WIDTH, OBJECT_INTERVAL, createTask, peopleOptions,
  plainFace, plainHands, plainPose, objectList, MaskSmoother, personMask,
} from './vision-core.js';

export const FACE_TESSELATION = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
export const FACE_CONTOURS = FaceLandmarker.FACE_LANDMARKS_CONTOURS;
export const HAND_CONNECTIONS = GestureRecognizer.HAND_CONNECTIONS;
export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;

export const KINDS = ['seg', 'face', 'hands', 'pose', 'objects'];

// Frames are analysed at up to this width. Every model scales its input far
// below it, and landmarks are normalised, so a smaller copy loses no accuracy
// and costs less to hand to the worker.
const ANALYSE_WIDTH = 960;
// A frame the worker has not answered within this time is treated as lost,
// so tracking can never stall for good.
const FRAME_TIMEOUT = 1500;
// This many failed frames in a row (the worker's models throwing, or frames
// that cannot be handed to it) moves tracking back into the page, so a
// broken worker can never leave the app silently tracking nothing.
const MAX_FAILURES = 12;
// A model nothing has used for this long is closed and its memory given
// back; it loads again the next time an effect or Syrix needs it.
const UNLOAD_AFTER = 45000;

const EMPTY = Object.freeze({ face: null, hands: null, pose: null });

// The trackers. They normally run in a worker (vision.worker.js) so the page
// keeps drawing the camera at full frame rate while a frame is analysed, and
// a slow model frame only delays the next tracking update. If the worker
// cannot start its models, the same models run in the page instead.
//
// Each new camera frame is offered with submit(); take() returns the newest
// finished result once, or null while the next one is still being worked on.
export class Vision {
  constructor() {
    this.state = {};
    this.failed = {};
    this.pending = {};
    this.onChange = () => {};
    this.people = 2;

    this.mask = null;
    this.maskW = 0;
    this.maskH = 0;
    this.maskVersion = 0;
    this.objects = [];
    this.timings = { seg: 0, face: 0, hands: 0, pose: 0, objects: 0 };

    this.latest = null;
    this.frameId = 0;
    this.dropUpTo = 0;
    this.sentAt = 0;
    this.failures = 0;
    this.lastNeed = {};
    this.local = null;
    this.worker = null;
    this.startWorker();
  }

  ready(kind) { return this.state[kind] === 'ready'; }
  loading(kind) { return this.state[kind] === 'loading'; }

  // ------------------------------------------------------------- engines

  startWorker() {
    try {
      this.worker = new Worker(new URL('./vision.worker.js', import.meta.url), { type: 'module', name: 'vision' });
    } catch (err) {
      this.useLocal(err);
      return;
    }
    this.worker.onmessage = (e) => this.onWorker(e.data || {});
    this.worker.onerror = (e) => { e.preventDefault(); this.useLocal(e.message || 'worker error'); };
    this.worker.onmessageerror = () => this.useLocal('unreadable worker message');
    this.worker.postMessage({ type: 'people', n: this.people });
  }

  onWorker(msg) {
    if (msg.type === 'loaded') this.settle(msg.kind, true);
    else if (msg.type === 'failed') this.useLocal(`${msg.kind}: ${msg.error}`);
    else if (msg.type === 'result') this.onResult(msg);
  }

  // Moves every model into the page. Anything loaded or loading in the
  // worker is loaded again here.
  useLocal(reason) {
    if (this.local) return;
    console.warn('Vision worker unavailable; running the trackers in the page.', reason);
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.local = new LocalVision();
    this.local.people = this.people;
    this.sentAt = 0;
    for (const kind of KINDS) {
      if (this.state[kind] === 'ready') { this.state[kind] = 'loading'; this.onChange(kind); }
      if (this.state[kind] === 'loading') this.loadLocal(kind);
    }
  }

  loadLocal(kind) {
    this.local.load(kind).then((task) => this.settle(kind, !!task, this.local.failed[kind]));
  }

  settle(kind, ok, error) {
    if (this.state[kind] !== 'loading') return;
    this.state[kind] = ok ? 'ready' : 'failed';
    if (!ok) {
      this.failed[kind] = error || 'failed';
      console.error(`Vision model "${kind}" failed to load`, error);
    }
    const p = this.pending[kind];
    if (p) p.resolve(ok);
    this.onChange(kind);
  }

  load(kind) {
    if (this.pending[kind]) return this.pending[kind].promise;
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    this.pending[kind] = { promise, resolve };
    this.state[kind] = 'loading';
    if (this.local) this.loadLocal(kind);
    else this.worker.postMessage({ type: 'load', kind });
    this.onChange(kind);
    return promise;
  }

  // The number of people to track changes how many faces, hands and bodies
  // each model looks for.
  setPeople(n) {
    if (n === this.people) return;
    this.people = n;
    if (this.local) this.local.setPeople(n);
    else if (this.worker) this.worker.postMessage({ type: 'people', n });
  }

  // ------------------------------------------------------------- frames

  // Loads what is needed now and closes what has not been needed for a while.
  manage(needs) {
    const now = performance.now();
    for (const k of KINDS) {
      if (needs[k]) {
        this.lastNeed[k] = now;
        if (!this.state[k]) this.load(k);
      } else if (this.state[k] === 'ready' && now - (this.lastNeed[k] || 0) > UNLOAD_AFTER) {
        this.unload(k);
      }
    }
  }

  unload(kind) {
    if (this.state[kind] !== 'ready') return;
    delete this.state[kind];
    delete this.pending[kind];
    if (this.local) this.local.unload(kind);
    else if (this.worker) this.worker.postMessage({ type: 'unload', kind });
    this.onChange(kind);
  }

  submit(video, needs) {
    if (!video.videoWidth) return;
    this.manage(needs);
    if (!needs.objects) this.objects = [];
    if (!KINDS.some((k) => needs[k] && this.ready(k))) {
      // Nothing to run: report an empty result so the app drops anything it
      // was still tracking.
      this.latest = EMPTY;
      return;
    }
    if (this.local) {
      this.latest = this.local.process(video, needs);
      this.mask = this.local.mask;
      this.maskW = this.local.maskW;
      this.maskH = this.local.maskH;
      this.maskVersion = this.local.maskVersion;
      if (needs.objects) this.objects = this.local.objects;
      this.timings = this.local.timings;
      return;
    }
    // One frame at a time: while the worker is busy, newer frames are not
    // queued behind it, so results never fall further and further behind.
    const now = performance.now();
    if (this.sentAt && now - this.sentAt < FRAME_TIMEOUT) return;
    this.sentAt = now;
    const id = ++this.frameId;
    const scale = Math.min(1, ANALYSE_WIDTH / video.videoWidth);
    const opts = scale < 1
      ? { resizeWidth: Math.round(video.videoWidth * scale), resizeHeight: Math.round(video.videoHeight * scale), resizeQuality: 'medium' }
      : undefined;
    const job = { ...needs };
    createImageBitmap(video, opts).then((bitmap) => {
      if (!this.worker || id <= this.dropUpTo) { bitmap.close(); if (this.frameId === id) this.sentAt = 0; return; }
      this.worker.postMessage({ type: 'frame', id, bitmap, needs: job }, [bitmap]);
    }, (err) => {
      if (this.frameId === id) this.sentAt = 0;
      this.noteFailure(`frame capture: ${err && err.message}`);
    });
  }

  noteFailure(reason) {
    if (++this.failures >= MAX_FAILURES) this.useLocal(reason);
  }

  onResult(msg) {
    if (msg.id === this.frameId) this.sentAt = 0;
    if (msg.id <= this.dropUpTo) return;
    if (msg.errors && msg.errors.length) this.noteFailure(`worker errors: ${msg.errors.join(', ')}`);
    else this.failures = 0;
    this.timings = msg.timings;
    if (msg.mask) {
      this.mask = msg.mask.data;
      this.maskW = msg.mask.w;
      this.maskH = msg.mask.h;
      this.maskVersion++;
    }
    if (msg.objects) this.objects = msg.objects;
    this.latest = { face: msg.face, hands: msg.hands, pose: msg.pose };
  }

  take() {
    const r = this.latest;
    this.latest = null;
    return r;
  }

  // Forgets everything seen so far (camera turned off): results for frames
  // already sent are discarded when they arrive.
  reset() {
    this.dropUpTo = this.frameId;
    this.sentAt = 0;
    this.latest = null;
    this.objects = [];
    if (this.local) this.local.objects = [];
  }
}

// The same trackers running in the page; used only when the worker cannot.
class LocalVision {
  constructor() {
    this.tasks = { seg: null, face: null, hands: null, pose: null, objects: null };
    this.pending = {};
    this.failed = {};
    this.lastTs = 0;
    this.people = 2;

    this.segCanvas = document.createElement('canvas');
    this.segCtx = this.segCanvas.getContext('2d', { alpha: false });
    this.masks = new MaskSmoother();
    this.mask = null;
    this.maskW = 0;
    this.maskH = 0;
    this.maskVersion = 0;
    this.objects = [];
    this.objectsAt = 0;
    this.timings = { seg: 0, face: 0, hands: 0, pose: 0, objects: 0 };
  }

  fileset() {
    if (!this._fileset) this._fileset = FilesetResolver.forVisionTasks(WASM_BASE);
    return this._fileset;
  }

  unload(kind) {
    const task = this.tasks[kind];
    this.tasks[kind] = null;
    delete this.pending[kind];
    if (task) { try { task.close(); } catch (err) { console.warn(err); } }
  }

  load(kind) {
    if (!this.pending[kind]) {
      this.pending[kind] = this.fileset().then((fs) => createTask(fs, kind, this.people)).then(
        (task) => { this.tasks[kind] = task; return task; },
        (err) => { this.failed[kind] = err; return null; },
      );
    }
    return this.pending[kind];
  }

  setPeople(n) {
    if (n === this.people) return;
    this.people = n;
    for (const kind of ['face', 'hands', 'pose']) {
      const task = this.tasks[kind];
      if (task) task.setOptions(peopleOptions(kind, n)).catch((err) => console.warn(`Could not update ${kind} options`, err));
    }
  }

  // MediaPipe requires strictly increasing timestamps per task.
  ts() {
    const t = performance.now();
    this.lastTs = t > this.lastTs ? t : this.lastTs + 1;
    return this.lastTs;
  }

  timed(kind, fn) {
    const t0 = performance.now();
    let out = null;
    try { out = fn(); } catch (err) { console.error(err); }
    this.timings[kind] = performance.now() - t0;
    return out;
  }

  process(video, needs) {
    const out = { face: null, hands: null, pose: null };
    if (needs.seg && this.tasks.seg) this.segment(video);
    if (needs.face && this.tasks.face) out.face = plainFace(this.timed('face', () => this.tasks.face.detectForVideo(video, this.ts())));
    if (needs.hands && this.tasks.hands) out.hands = plainHands(this.timed('hands', () => this.tasks.hands.recognizeForVideo(video, this.ts())));
    if (needs.pose && this.tasks.pose) out.pose = plainPose(this.timed('pose', () => this.tasks.pose.detectForVideo(video, this.ts())));
    if (needs.objects && this.tasks.objects && performance.now() - this.objectsAt > OBJECT_INTERVAL) {
      this.objectsAt = performance.now();
      const r = this.timed('objects', () => this.tasks.objects.detectForVideo(video, this.ts()));
      if (r) this.objects = objectList(r, video.videoWidth, video.videoHeight);
    }
    return out;
  }

  segment(video) {
    const t0 = performance.now();
    const w = SEG_WIDTH;
    const h = Math.max(2, Math.round((SEG_WIDTH * video.videoHeight) / video.videoWidth));
    if (this.segCanvas.width !== w || this.segCanvas.height !== h) {
      this.segCanvas.width = w;
      this.segCanvas.height = h;
      this.masks.reset();
    }
    this.segCtx.drawImage(video, 0, 0, w, h);
    let result = null;
    try {
      result = this.tasks.seg.segmentForVideo(this.segCanvas, this.ts());
      const m = personMask(result);
      if (!m) return;
      this.mask = this.masks.push(m.data);
      this.maskW = m.w;
      this.maskH = m.h;
      this.maskVersion++;
    } catch (err) {
      console.error(err);
    } finally {
      if (result) result.close();
      this.timings.seg = performance.now() - t0;
    }
  }
}
