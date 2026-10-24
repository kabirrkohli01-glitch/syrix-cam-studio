import { settings } from '../store.js';

// Face ID: recognises the owner of this PC so Syrix knows who it is talking
// to. The owner scans their face once (about 20 views at slightly different
// angles); each view is aligned from the face tracker's landmarks and turned
// into a 128-number signature by faceid.worker.js. Only those numbers are
// stored, in the local settings file; no photo is kept and nothing is sent
// anywhere. Syrix is told only the outcome: owner, not the owner, or unsure.

// Where the eyes, nose tip and mouth corners sit in the 112x112 face the
// model expects (the standard ArcFace/SFace template).
const TEMPLATE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
const SIZE = 112;
// Mean of the three best matches against the enrolled views. Same-person
// scores with this model sit around 0.5-0.8 and different people below 0.3
// (OpenCV's single-pair threshold is 0.363).
const OWNER_AT = 0.42;
const OTHER_BELOW = 0.3;
const IDLE_MS = 60000;
const CACHE_MS = 15000;

export const SCAN_STEPS = [
  { say: 'Look straight at the camera', n: 6 },
  { say: 'Turn your head slightly left', n: 4 },
  { say: 'Now slightly right', n: 4 },
  { say: 'Chin up a little', n: 3 },
  { say: 'Back to the middle', n: 3 },
];

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// Least-squares similarity transform (scale, rotation, shift) taking the
// five source points onto the template.
function similarity(src) {
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += TEMPLATE[i][0]; dy += TEMPLATE[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i][0] - sx, y = src[i][1] - sy;
    const X = TEMPLATE[i][0] - dx, Y = TEMPLATE[i][1] - dy;
    num1 += x * X + y * Y;
    num2 += x * Y - y * X;
    den += x * x + y * y;
  }
  const p = num1 / den, q = num2 / den;
  return { p, q, tx: dx - (p * sx - q * sy), ty: dy - (q * sx + p * sy) };
}

export class FaceID {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.worker = null;
    this.idle = 0;
    this.seq = 0;
    this.waiting = new Map();
    this.cache = null;
    this.scanning = false;
  }

  get enrolled() { return (settings.faceId.samples || []).length >= 8; }
  get name() { return settings.faceId.name || 'the owner'; }

  // ---------------------------------------------------------------- worker

  ensureWorker() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), IDLE_MS);
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../faceid.worker.js', import.meta.url), { type: 'module', name: 'faceid' });
    this.worker.onmessage = (e) => {
      const m = e.data || {};
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.type === 'embedding') w.resolve(m.vector); else w.reject(new Error(m.message || 'Face ID failed'));
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      for (const w of this.waiting.values()) w.reject(new Error('Face ID could not start'));
      this.waiting.clear();
      this.close();
    };
    return this.worker;
  }

  close() {
    clearTimeout(this.idle);
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }

  // ---------------------------------------------------------------- signatures

  points(video, face) {
    const L = face.raw;
    const vw = video.videoWidth, vh = video.videoHeight;
    const P = (i) => [L[i].x * vw, L[i].y * vh];
    const avg = (ids) => { let x = 0, y = 0; for (const i of ids) { const p = P(i); x += p[0]; y += p[1]; } return [x / ids.length, y / ids.length]; };
    const eyes = L.length >= 478 ? [P(468), P(473)] : [avg([33, 133]), avg([362, 263])];
    eyes.sort((a, b) => a[0] - b[0]);
    const mouth = [P(61), P(291)].sort((a, b) => a[0] - b[0]);
    return [eyes[0], eyes[1], P(1), mouth[0], mouth[1]];
  }

  async embed(video, face) {
    if (!face || !face.raw || !video.videoWidth) return null;
    const t = similarity(this.points(video, face));
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, SIZE, SIZE);
    c.setTransform(t.p, t.q, -t.q, t.p, t.tx, t.ty);
    c.drawImage(video, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const pixels = c.getImageData(0, 0, SIZE, SIZE).data;
    const id = ++this.seq;
    const w = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      w.postMessage({ type: 'embed', id, pixels }, [pixels.buffer]);
    });
  }

  score(v) {
    const sims = (settings.faceId.samples || []).map((s) => dot(v, s)).sort((a, b) => b - a);
    const top = sims.slice(0, 3);
    return top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
  }

  // ---------------------------------------------------------------- recognition

  // Who the main face is: { status: 'owner' | 'other' | 'unsure' | 'none' | 'off', score }.
  async identify(video, face) {
    if (!this.enrolled) return { status: 'off' };
    if (!face) return { status: 'none' };
    const now = performance.now();
    if (this.cache && this.cache.id === face.id && now - this.cache.at < CACHE_MS && this.cache.result.status !== 'unsure') return this.cache.result;
    let result;
    const turned = face.pose && (Math.abs(face.pose.yaw) > 35 || Math.abs(face.pose.pitch) > 30);
    try {
      const v = await this.embed(video, face);
      const s = this.score(v);
      const status = s >= OWNER_AT ? 'owner' : s < OTHER_BELOW && !turned ? 'other' : 'unsure';
      result = { status, score: Math.round(s * 100) / 100 };
    } catch (err) {
      console.warn(err);
      result = { status: 'unsure', score: 0 };
    }
    this.cache = { id: face.id, at: now, result };
    return result;
  }

  // One line for Syrix's <scene>.
  describe(result) {
    const n = this.name;
    switch (result && result.status) {
      case 'owner': return `Face ID: this is ${n}, the owner of this PC (match ${result.score})`;
      case 'other': return `Face ID: this is NOT ${n}, the owner; it is someone else (match ${result.score})`;
      case 'unsure': return `Face ID: unsure whether this is ${n} (face turned, covered or poorly lit)`;
      case 'none': return 'Face ID: no face clearly visible, so who it is is unknown';
      default: return 'Face ID: not set up yet, so you cannot tell who this is (it can be set up in Settings › Face ID or by asking you to scan their face)';
    }
  }

  // ---------------------------------------------------------------- enrolment

  // Captures views while the person follows the prompts. getFace returns the
  // current main face (or null); onStep reports progress for the overlay.
  async enroll(video, getFace, onStep, signal) {
    if (this.scanning) return { ok: false, reason: 'busy' };
    this.scanning = true;
    const samples = [];
    const total = SCAN_STEPS.reduce((a, s) => a + s.n, 0);
    const started = performance.now();
    try {
      for (const step of SCAN_STEPS) {
        let got = 0;
        onStep({ say: step.say, done: samples.length, total });
        await new Promise((r) => setTimeout(r, 700));
        while (got < step.n) {
          if (signal && signal.aborted) return { ok: false, reason: 'cancelled' };
          if (performance.now() - started > 40000) return { ok: false, reason: 'timeout', count: samples.length };
          const face = getFace();
          if (face && face.width > 60) {
            const v = await this.embed(video, face);
            if (v) { samples.push(Array.from(v, (x) => Math.round(x * 10000) / 10000)); got++; }
            onStep({ say: step.say, done: samples.length, total });
          } else {
            onStep({ say: 'Move into view, facing the camera', done: samples.length, total });
          }
          await new Promise((r) => setTimeout(r, 260));
        }
      }
      // Views of one person agree with each other; a low average means the
      // camera saw more than one face or the light was too poor.
      let agree = 0, pairs = 0;
      for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) { agree += dot(samples[i], samples[j]); pairs++; }
      if (agree / pairs < 0.35) return { ok: false, reason: 'inconsistent' };
      settings.faceId.samples = samples;
      settings.faceId.at = new Date().toISOString();
      this.cache = null;
      return { ok: true, count: samples.length };
    } finally {
      this.scanning = false;
    }
  }

  forget() {
    settings.faceId.samples = [];
    settings.faceId.at = null;
    this.cache = null;
    this.close();
  }
}
