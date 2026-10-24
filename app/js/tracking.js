// Converts raw landmark results (normalised, un-mirrored video coordinates)
// into screen-space structures with the measurements effects need, and keeps
// a stable identity for every face, hand and body from frame to frame.

export class Mapper {
  constructor() {
    this.W = 1;
    this.H = 1;
    this.c = { sx: -1, sy: 1, ox: 1, oy: 0 };
  }
  set(cover, W, H) { this.c = cover; this.W = W; this.H = H; }
  x(nx) { return ((nx - this.c.ox) / this.c.sx) * this.W; }
  y(ny) { return ((ny - this.c.oy) / this.c.sy) * this.H; }
}

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

class Landmarks {
  constructor(lm, map) {
    const n = lm.length;
    const p = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      p[i * 2] = map.x(lm[i].x);
      p[i * 2 + 1] = map.y(lm[i].y);
    }
    this.p = p;
    this.n = n;
    this.raw = lm;
    this.id = null;
    this.age = 0;
  }
  x(i) { return this.p[i * 2]; }
  y(i) { return this.p[i * 2 + 1]; }
  pt(i) { return [this.p[i * 2], this.p[i * 2 + 1]]; }
  d(i, j) { return dist(this.p[i * 2], this.p[i * 2 + 1], this.p[j * 2], this.p[j * 2 + 1]); }
  avg(ids) {
    let x = 0, y = 0;
    for (const i of ids) { x += this.p[i * 2]; y += this.p[i * 2 + 1]; }
    return [x / ids.length, y / ids.length];
  }
  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const x = this.p[i * 2], y = this.p[i * 2 + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  }
}

const EYE_A = [33, 133, 159, 145];
const EYE_B = [263, 362, 386, 374];
// Eye aspect ratio points (corner, two upper lid, corner, two lower lid).
const EAR_A = [33, 160, 158, 133, 153, 144];
const EAR_B = [362, 385, 387, 263, 373, 380];

export class Face extends Landmarks {
  constructor(lm, categories, matrix, map) {
    super(lm, map);
    const b = {};
    if (categories) for (const c of categories) b[c.categoryName] = c.score;
    this.blend = b;
    this.matrix = matrix || null;
    // Face centre and width in video coordinates, used for auto-framing.
    this.uv = {
      x: (lm[234].x + lm[454].x + lm[10].x + lm[152].x) / 4,
      y: (lm[234].y + lm[454].y + lm[10].y + lm[152].y) / 4,
      w: Math.hypot(lm[234].x - lm[454].x, lm[234].y - lm[454].y),
      h: Math.hypot(lm[10].x - lm[152].x, lm[10].y - lm[152].y),
    };
    this.pose = headPose(matrix);
    this.refresh();
  }

  refresh() {
    const b = this.blend;
    const ea = this.avg(EYE_A), eb = this.avg(EYE_B);
    [this.eyeL, this.eyeR] = ea[0] < eb[0] ? [ea, eb] : [eb, ea];
    if (this.n >= 478) {
      const ia = this.pt(468), ib = this.pt(473);
      [this.irisL, this.irisR] = ia[0] < ib[0] ? [ia, ib] : [ib, ia];
    } else {
      this.irisL = this.eyeL;
      this.irisR = this.eyeR;
    }
    this.eyeDist = dist(this.eyeL[0], this.eyeL[1], this.eyeR[0], this.eyeR[1]);
    this.roll = Math.atan2(this.eyeR[1] - this.eyeL[1], this.eyeR[0] - this.eyeL[0]);
    this.eyeMid = [(this.eyeL[0] + this.eyeR[0]) / 2, (this.eyeL[1] + this.eyeR[1]) / 2];
    this.mouth = this.avg([13, 14]);
    this.mouthOpen = this.d(13, 14);
    this.nose = this.pt(1);
    this.bridge = this.pt(168);
    this.forehead = this.pt(10);
    this.chin = this.pt(152);
    this.width = this.d(234, 454);
    this.height = this.d(10, 152);
    this.center = this.avg([10, 152, 234, 454]);

    // Head turn: how far the nose sits from the face centre, in face widths.
    this.turnX = (this.nose[0] - this.center[0]) / Math.max(this.width, 1);
    this.turnY = (this.nose[1] - this.center[1]) / Math.max(this.width, 1);

    const g = (k) => b[k] || 0;
    this.smile = (g('mouthSmileLeft') + g('mouthSmileRight')) / 2;
    this.jaw = g('jawOpen');
    this.brows = Math.max(g('browInnerUp'), (g('browOuterUpLeft') + g('browOuterUpRight')) / 2);
    this.blinkA = g('eyeBlinkLeft');
    this.blinkB = g('eyeBlinkRight');
    this.pucker = g('mouthPucker');
    this.browDown = (g('browDownLeft') + g('browDownRight')) / 2;
    this.frown = (g('mouthFrownLeft') + g('mouthFrownRight')) / 2;
    this.puff = g('cheekPuff');
    this.squint = (g('eyeSquintLeft') + g('eyeSquintRight')) / 2;
    this.earA = this.ear(EAR_A);
    this.earB = this.ear(EAR_B);
  }

  ear(ids) {
    const [p1, p2, p3, p4, p5, p6] = ids;
    const h = this.d(p1, p4);
    return h > 0 ? (this.d(p2, p6) + this.d(p3, p5)) / (2 * h) : 0;
  }

  // Iris diameter in video pixels, averaged over both eyes (0 if unknown).
  irisPx(vw, vh) {
    if (this.raw.length < 478) return 0;
    const L = this.raw;
    const d = (a, b) => Math.hypot((L[a].x - L[b].x) * vw, (L[a].y - L[b].y) * vh);
    return (d(469, 471) + d(470, 472) + d(474, 476) + d(475, 477)) / 4;
  }
}

// Yaw, pitch and roll in degrees from the 4x4 face transformation matrix,
// plus the distance along the camera axis in cm. The flattened layout is
// detected from where the translation sits (the face is always tens of cm
// from the camera), so either row- or column-major data reads correctly.
function headPose(m) {
  if (!m || !m.data || m.data.length < 16) return null;
  const a = m.data;
  const colMajor = Math.abs(a[12]) + Math.abs(a[13]) + Math.abs(a[14]) > Math.abs(a[3]) + Math.abs(a[7]) + Math.abs(a[11]);
  const at = (r, c) => (colMajor ? a[c * 4 + r] : a[r * 4 + c]);
  const yaw = Math.atan2(-at(2, 0), Math.hypot(at(2, 1), at(2, 2)));
  const pitch = Math.atan2(at(2, 1), at(2, 2));
  const roll = Math.atan2(at(1, 0), at(0, 0));
  const deg = 180 / Math.PI;
  return { yaw: yaw * deg, pitch: pitch * deg, roll: roll * deg, z: Math.abs(at(2, 3)) };
}

const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
export const TIPS = [4, 8, 12, 16, 20];

export class Hand extends Landmarks {
  constructor(lm, handed, gesture, map, index) {
    super(lm, map);
    this.label = handed ? handed.categoryName : `Hand${index}`;
    this.score = handed ? handed.score : 0;
    this.gesture = gesture && gesture.categoryName ? gesture.categoryName : 'None';
    this.gestureScore = gesture ? gesture.score : 0;
    this.refresh();
  }

  refresh() {
    this.size = Math.max(this.d(0, 9), 1);

    const ext = [];
    const curl = [];
    ext[0] = this.d(4, 5) > this.size * 0.55 && this.d(4, 17) > this.d(2, 17);
    curl[0] = !ext[0];
    for (let f = 1; f < 5; f++) {
      const [mcp, pip, , tip] = FINGERS[f];
      const tipD = this.d(tip, 0), pipD = this.d(pip, 0), mcpD = this.d(mcp, 0);
      ext[f] = tipD > pipD * 1.12 && tipD > mcpD * 1.3;
      // Clearly folded: the fingertip is closer to the wrist than its own
      // middle joint. Ambiguous half-bent fingers are neither.
      curl[f] = tipD < pipD * 1.02;
    }
    this.ext = ext;
    this.curl = curl;
    this.count = ext.reduce((a, v) => a + (v ? 1 : 0), 0);
    this.palm = this.avg([0, 5, 9, 13, 17]);
    this.pinch = this.d(4, 8) / this.size;
    this.pinchPoint = [(this.x(4) + this.x(8)) / 2, (this.y(4) + this.y(8)) / 2];
    this.open = ext[1] && ext[2] && ext[3] && ext[4];
    this.fist = curl[1] && curl[2] && curl[3] && curl[4];
    this.pointing = ext[1] && !ext[2] && !ext[3] && !ext[4];
    // A deliberate point: index straight and well clear of the other fingers,
    // which are clearly folded. Used where a false positive draws on screen.
    const indexStraight = this.d(8, 5) > this.d(6, 5) * 1.6 && this.d(8, 0) > this.d(5, 0) * 1.55;
    this.strictPoint = indexStraight && curl[2] && curl[3] && curl[4];
    this.peace = ext[1] && ext[2] && !ext[3] && !ext[4];
  }
}

// Body pose: shoulders, head and arms, for posture, breathing and people.
export class Body extends Landmarks {
  constructor(lm, world, map) {
    super(lm, map);
    this.world = world || null;
    this.vis = lm.map((p) => (p.visibility == null ? 1 : p.visibility));
    this.refresh();
  }

  seen(i, min = 0.6) { return this.vis[i] >= min; }

  refresh() {
    this.shoulders = this.seen(11) && this.seen(12);
    this.shoulderL = this.pt(11);
    this.shoulderR = this.pt(12);
    this.shoulderMid = [(this.x(11) + this.x(12)) / 2, (this.y(11) + this.y(12)) / 2];
    this.shoulderW = this.d(11, 12);
    this.earMid = [(this.x(7) + this.x(8)) / 2, (this.y(7) + this.y(8)) / 2];
    this.shoulderTilt = Math.atan2(this.y(11) - this.y(12), this.x(11) - this.x(12));
    this.center = this.shoulders ? this.shoulderMid : this.pt(0);
    this.handsUp = (this.seen(15) && this.y(15) < this.y(0)) || (this.seen(16) && this.y(16) < this.y(0));
  }
}

export function buildFaces(result, map) {
  if (!result || !result.faceLandmarks || !result.faceLandmarks.length) return [];
  return result.faceLandmarks.map((lm, i) => {
    const bs = result.faceBlendshapes && result.faceBlendshapes[i];
    const mx = result.facialTransformationMatrixes && result.facialTransformationMatrixes[i];
    return new Face(lm, bs ? bs.categories : null, mx, map);
  });
}

export function buildHands(result, map) {
  if (!result || !result.landmarks || !result.landmarks.length) return [];
  return result.landmarks.map((lm, i) => {
    const hd = result.handedness && result.handedness[i] ? result.handedness[i][0] : null;
    const g = result.gestures && result.gestures[i] ? result.gestures[i][0] : null;
    return new Hand(lm, hd, g, map, i);
  });
}

export function buildBodies(result, map) {
  if (!result || !result.landmarks || !result.landmarks.length) return [];
  return result.landmarks.map((lm, i) => new Body(lm, result.worldLandmarks && result.worldLandmarks[i], map));
}

// Gives each detection a stable id by matching it to the nearest track from
// the previous frames. MediaPipe's own order and left/right labels can swap
// between frames (and two people can both have a "Right" hand), so ids built
// from them make smoothing and gestures jump from one hand to another.
export class Tracker {
  constructor(prefix, { reach = 1.6, keep = 0.35 } = {}) {
    this.prefix = prefix;
    this.reach = reach;
    this.keep = keep;
    this.tracks = [];
    this.next = 1;
  }

  assign(items, t, posOf, scaleOf) {
    const pairs = [];
    items.forEach((it, j) => {
      const p = posOf(it);
      const s = Math.max(scaleOf(it), 1);
      this.tracks.forEach((tr, i) => {
        const d = Math.hypot(p[0] - tr.x, p[1] - tr.y) / Math.max(s, tr.s);
        if (d < this.reach) pairs.push({ i, j, d: d + (tr.label && it.label && tr.label !== it.label ? 0.35 : 0) });
      });
    });
    pairs.sort((a, b) => a.d - b.d);
    const usedT = new Set(), usedI = new Set();
    for (const { i, j } of pairs) {
      if (usedT.has(i) || usedI.has(j)) continue;
      usedT.add(i);
      usedI.add(j);
      const tr = this.tracks[i];
      const it = items[j];
      const p = posOf(it);
      tr.x = p[0]; tr.y = p[1]; tr.s = scaleOf(it); tr.t = t; tr.age++; tr.label = it.label;
      it.id = tr.id;
      it.age = tr.age;
    }
    items.forEach((it, j) => {
      if (usedI.has(j)) return;
      const p = posOf(it);
      const tr = { id: `${this.prefix}${this.next++}`, x: p[0], y: p[1], s: scaleOf(it), t, age: 1, label: it.label };
      this.tracks.push(tr);
      it.id = tr.id;
      it.age = 1;
    });
    this.tracks = this.tracks.filter((tr) => t - tr.t <= this.keep);
    return items;
  }
}

// One-Euro filter (Casiez et al.): heavy smoothing when still, light
// smoothing when moving fast, which removes jitter without adding lag.
export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.008, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = null;
    this.t = 0;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  // Filters a whole array of values in place against one shared timeline.
  filter(arr, t) {
    if (!this.x || this.x.length !== arr.length) {
      this.x = Float32Array.from(arr);
      this.dx = new Float32Array(arr.length);
      this.t = t;
      return arr;
    }
    const dt = Math.max(1 / 240, Math.min(0.2, t - this.t));
    this.t = t;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    for (let i = 0; i < arr.length; i++) {
      const d = (arr[i] - this.x[i]) / dt;
      this.dx[i] += ad * (d - this.dx[i]);
      const cutoff = this.minCutoff + this.beta * Math.abs(this.dx[i]);
      this.x[i] += OneEuro.alpha(cutoff, dt) * (arr[i] - this.x[i]);
      arr[i] = this.x[i];
    }
    return arr;
  }
  reset() { this.x = null; }
}

// Keeps one filter per tracked hand, face or body and smooths landmark arrays
// before any measurement is taken from them.
export class LandmarkSmoother {
  constructor(minCutoff, beta) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.filters = new Map();
  }
  configure(minCutoff, beta) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    for (const f of this.filters.values()) { f.minCutoff = minCutoff; f.beta = beta; }
  }
  apply(items, t) {
    const seen = new Set();
    for (const it of items) {
      const key = it.id;
      seen.add(key);
      let f = this.filters.get(key);
      if (!f) { f = new OneEuro(this.minCutoff, this.beta); this.filters.set(key, f); }
      f.filter(it.p, t);
      it.refresh();
    }
    for (const k of [...this.filters.keys()]) if (!seen.has(k)) this.filters.delete(k);
  }
}

// Exponential smoothing that eases off when the target moves quickly,
// which removes jitter without adding lag to deliberate motion.
export class Smooth {
  constructor(base = 0.35, fast = 0.9, speedRef = 40) {
    this.base = base;
    this.fast = fast;
    this.ref = speedRef;
    this.v = null;
  }
  push(arr) {
    if (!this.v || this.v.length !== arr.length) { this.v = arr.slice(); return this.v; }
    let move = 0;
    for (let i = 0; i < arr.length; i++) move = Math.max(move, Math.abs(arr[i] - this.v[i]));
    const a = Math.min(this.fast, this.base + (move / this.ref) * (this.fast - this.base));
    for (let i = 0; i < arr.length; i++) this.v[i] += (arr[i] - this.v[i]) * a;
    return this.v;
  }
  reset() { this.v = null; }
}

// Hands that are really something else: a face, an ear or a blur at the edge
// of the frame. Rejected before any effect or control can react to them.
export function plausibleHand(h, faces, W, H) {
  if (h.score && h.score < 0.55) return false;
  const span = h.size / Math.max(1, Math.min(W, H));
  if (span < 0.02 || span > 0.6) return false;
  for (const f of faces) {
    const inside = Math.abs(h.palm[0] - f.center[0]) < f.width * 0.32 && Math.abs(h.palm[1] - f.center[1]) < f.height * 0.32;
    if (inside && h.size > f.width * 0.55 && h.count <= 1) return false;
  }
  return true;
}
