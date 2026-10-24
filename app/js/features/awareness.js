import { moodOf } from './widgets.js';

// Scene awareness: a running, plain-language picture of what the camera sees,
// built from the on-device trackers. Syrix reads it with every message so it
// knows who is there and what is happening without needing a photo, and a
// few notable moments (someone arrives or leaves, a wave) are raised as
// events the app can react to.

const POS = (x, W) => (x < W * 0.38 ? 'left' : x > W * 0.62 ? 'right' : 'centre');

export class Awareness {
  constructor() {
    this.small = document.createElement('canvas');
    this.small.width = 64;
    this.small.height = 36;
    this.sctx = this.small.getContext('2d', { willReadFrequently: true });
    this.prev = null;
    this.light = null;
    this.warmth = null;
    this.motion = 0;
    this.sampleAt = 0;
    this.people = 0;
    this.pending = { n: 0, since: 0 };
    this.waves = new Map();
    this.talk = new Map();
    this.onEvent = () => {};
    this.objects = [];
    this.objSrc = null;
    this.objHist = [];
  }

  // Forgets everything seen (camera turned off), so nothing from before is
  // reported as if it were in view now.
  reset() {
    this.prev = null;
    this.light = null;
    this.warmth = null;
    this.motion = 0;
    this.sampleAt = 0;
    this.people = 0;
    this.pending = { n: 0, since: 0 };
    this.waves.clear();
    this.talk.clear();
    this.objects = [];
    this.objSrc = null;
    this.objHist = [];
    this.faces = [];
    this.hands = [];
    this.bodies = [];
  }

  // Light level, colour temperature and overall movement from a tiny copy
  // of the frame, four times a second.
  sample(video, t) {
    if (t - this.sampleAt < 0.25 || !video.videoWidth) return;
    this.sampleAt = t;
    this.sctx.drawImage(video, 0, 0, 64, 36);
    const d = this.sctx.getImageData(0, 0, 64, 36).data;
    let L = 0, R = 0, B = 0, diff = 0;
    const cur = new Uint8Array(64 * 36);
    for (let i = 0, k = 0; i < d.length; i += 4, k++) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      cur[k] = y;
      L += y; R += d[i]; B += d[i + 2];
      if (this.prev) diff += Math.abs(y - this.prev[k]);
    }
    const n = 64 * 36;
    this.light = L / n;
    this.warmth = (R - B) / n;
    if (this.prev) this.motion += (diff / n / 40 - this.motion) * 0.4;
    this.prev = cur;
  }

  update(t, dt, { faces, hands, bodies, objects, W, H }) {
    // An object is reported only once the detector has found it in at least
    // two of its last three passes; single-pass detections are mostly
    // look-alikes and made Syrix name things that were not there.
    const list = objects || [];
    if (list !== this.objSrc) {
      this.objSrc = list;
      this.objHist.push(new Set(list.map((o) => o.label)));
      if (this.objHist.length > 3) this.objHist.shift();
    }
    this.objects = list.filter((o) => this.objHist.filter((h) => h.has(o.label)).length >= 2);
    const count = Math.max(faces.length, bodies.length);
    // A change in head count has to hold for a moment before it is believed.
    if (count !== this.people) {
      if (this.pending.n !== count) this.pending = { n: count, since: t };
      else if (t - this.pending.since > 1.5) {
        const before = this.people;
        this.people = count;
        if (count > before) this.onEvent('arrived', { count, before });
        else this.onEvent('left', { count, before });
      }
    } else {
      this.pending = { n: count, since: t };
    }

    // Talking: the jaw moving up and down rather than held open.
    for (const f of faces) {
      const s = this.talk.get(f.id) || { last: f.jaw, energy: 0 };
      s.energy += (Math.abs(f.jaw - s.last) / Math.max(dt, 1 / 60) - s.energy) * 0.08;
      s.last = f.jaw;
      this.talk.set(f.id, s);
    }
    for (const k of [...this.talk.keys()]) if (!faces.some((f) => f.id === k)) this.talk.delete(k);

    // Wave: an open hand swinging side to side at least three times.
    for (const h of hands) {
      if (!h.open || h.age < 3) { this.waves.delete(h.id); continue; }
      const w = this.waves.get(h.id) || { x: h.palm[0], dir: 0, swings: [], last: t };
      const dx = h.palm[0] - w.x;
      if (Math.abs(dx) > h.size * 0.25) {
        const dir = Math.sign(dx);
        if (dir !== w.dir) { w.swings.push(t); w.dir = dir; }
        w.x = h.palm[0];
      }
      w.swings = w.swings.filter((s) => t - s < 1.6);
      if (w.swings.length >= 4 && t - (w.fired || 0) > 4) {
        w.fired = t;
        w.swings = [];
        this.onEvent('wave', { hand: h });
      }
      this.waves.set(h.id, w);
    }
    for (const k of [...this.waves.keys()]) if (!hands.some((h) => h.id === k)) this.waves.delete(k);
    this.W = W;
    this.H = H;
    this.faces = faces;
    this.hands = hands;
    this.bodies = bodies;
  }

  // tracking: whether the face or hand model is running. Without one, an
  // empty frame and an unwatched frame look the same, so who is in view is
  // reported as unknown rather than as nobody.
  summary({ tracking = true } = {}) {
    const W = this.W || 1, H = this.H || 1;
    const faces = this.faces || [], hands = this.hands || [], bodies = this.bodies || [];
    const lines = [];
    const n = Math.max(faces.length, bodies.length);
    if (!tracking) lines.push('who is in view: unknown (person tracking is off or still loading)');
    else lines.push(n === 0 ? 'nobody in view' : n === 1 ? 'one person in view' : `${n} people in view`);
    faces.slice(0, 4).forEach((f, i) => {
      const bits = [];
      bits.push(`${POS(f.center[0], W)} of frame`);
      const size = f.width / W;
      bits.push(size > 0.32 ? 'very close to the camera' : size > 0.18 ? 'close' : size > 0.09 ? 'normal distance' : 'far back');
      const m = moodOf(f);
      bits.push(`looks ${m.label.toLowerCase()}`);
      if (f.smile > 0.5) bits.push('smiling');
      if ((f.blinkA + f.blinkB) / 2 > 0.7) bits.push('eyes closed');
      if (f.jaw > 0.45) bits.push('mouth open');
      const talk = this.talk.get(f.id);
      if (talk && talk.energy > 0.6) bits.push('talking');
      if (f.pose) {
        if (Math.abs(f.pose.yaw) > 25) bits.push(`looking to their ${f.pose.yaw > 0 ? 'left' : 'right'}`);
        else if (f.pose.pitch < -18) bits.push('looking down');
        else if (f.pose.pitch > 15) bits.push('looking up');
        else bits.push('looking at the camera');
        if (Math.abs(f.pose.roll) > 15) bits.push('head tilted');
      }
      const theirHands = hands.filter((h) => Math.abs(h.palm[0] - f.center[0]) < f.width * 3);
      for (const h of theirHands) {
        const g = h.gesture !== 'None' && h.gestureScore > 0.55 ? h.gesture.replace('_', ' ').toLowerCase() : h.fist ? 'fist' : h.pointing ? 'pointing' : h.open ? 'open hand' : `${h.count} fingers up`;
        const near = h.palm[1] < f.chin[1] && Math.abs(h.palm[0] - f.center[0]) < f.width ? ' near the face' : h.palm[1] < f.forehead[1] ? ' raised high' : '';
        bits.push(`hand: ${g}${near}`);
      }
      lines.push(`person ${i + 1}: ${bits.join(', ')}`);
    });
    for (const b of bodies.slice(0, 2)) if (b.handsUp) { lines.push('someone has a hand raised above their head'); break; }
    const objs = (this.objects || []).filter((o) => o.label !== 'person');
    if (objs.length) {
      const counts = {};
      for (const o of objs) counts[o.label] = (counts[o.label] || 0) + 1;
      lines.push(`objects the detector picked out (rough guesses; look before naming anything specific): ${Object.entries(counts).map(([k, v]) => (v > 1 ? `${v} ${k}s` : k)).join(', ')}`);
    }
    if (this.light != null) {
      const lv = this.light < 55 ? 'dim' : this.light > 170 ? 'very bright' : 'well lit';
      const tone = this.warmth > 18 ? 'warm' : this.warmth < -6 ? 'cool' : 'neutral';
      const mv = this.motion > 0.35 ? 'lots of movement' : this.motion > 0.12 ? 'some movement' : 'mostly still';
      lines.push(`room: ${lv}, ${tone} light, ${mv}`);
    }
    return lines.join('\n');
  }

  // Short chips for the on-screen awareness readout.
  chips() {
    const out = [];
    const faces = this.faces || [];
    const n = Math.max(faces.length, (this.bodies || []).length);
    out.push(n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'No one');
    const f = faces[0];
    if (f) out.push(moodOf(f).label);
    const g = (this.hands || []).find((h) => h.gesture !== 'None' && h.gestureScore > 0.6);
    if (g) out.push(g.gesture.replace('_', ' '));
    const objs = (this.objects || []).filter((o) => o.label !== 'person').slice(0, 2);
    for (const o of objs) out.push(o.label);
    return out;
  }
}
