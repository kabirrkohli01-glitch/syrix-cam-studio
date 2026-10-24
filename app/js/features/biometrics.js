// Measurements shared by widgets, the Health panel and Syrix: blinks, eye
// fatigue, screen distance, posture and yawns for the main person in view.
//
// Blinks are read from the raw landmarks, never the smoothed ones: the
// display smoother is tuned to hide jitter, and it flattened a 100 ms blink
// into a small dip that rarely crossed the threshold. The eye aspect ratio is
// combined with the model's own eyelid score, each against a baseline learned
// from this person's open eyes, so narrow eyes, glasses and a downward gaze
// do not read as closed.
//
// Distance combines two anatomical scales: the iris (about 11.7 mm across in
// almost every adult) and the distance between the pupils (about 63 mm). The
// pupils are five times further apart than the iris is wide, so that reading
// carries far less pixel noise; each is weighted by its own precision, and a
// short median rejects single bad frames.
//
// Posture is compared with the best posture seen this session (a high
// percentile of the recent samples) rather than whatever the first seconds
// happened to be, so starting out slumped no longer makes slumping "normal".
// Calibrate replaces that reference with the current posture. An issue is only
// reported after it has lasted a few seconds.

const IRIS_CM = 1.17;
const IPD_CM = 6.3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Eye aspect ratio points: outer corner, two upper lid, inner corner, two
// lower lid.
const EAR_A = [33, 160, 158, 133, 153, 144];
const EAR_B = [362, 385, 387, 263, 373, 380];
// A face lost for longer than this starts the measurements afresh.
const GAP_RESET = 2.5;
// Seconds an issue must persist before it is reported.
const ISSUE_HOLD = 3;

function percentile(arr, p) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
}

function median(arr) { return percentile(arr, 0.5); }

export class Biometrics {
  constructor() {
    this.reset();
  }

  reset() {
    this.blink = { earBase: null, lidBase: null, closed: false, since: 0, times: [], total: 0, lastLong: 0, peak: 0 };
    this.closedTrack = [];
    // Recent eye-closure readings (time, 0-1) for the Health panel's timeline.
    this.eyeTrace = [];
    this.perclos = 0;
    this.eyeOpen = 1;
    this.distance = null;
    this.distanceSrc = null;
    this.distWindow = [];
    this.posture = {
      ref: null, calibrated: null, samples: [], sampleAt: 0, warm: 0,
      state: 'unknown', score: null, issues: [], held: {}, good: 0, total: 0, bad: 0, angles: null,
    };
    this.yawn = { open: 0, count: 0, times: [] };
    this.attention = null;
    this.looking = false;
    this.seenFor = 0;
    this.lastSeen = -1e9;
  }

  calibratePosture() {
    const P = this.posture;
    P.calibrated = null;
    P.calibrating = { until: (this.lastT || 0) + 2.5, samples: [] };
  }

  update(dt, t, face, body, view) {
    this.lastT = t;
    if (!face) {
      if (t - this.lastSeen > GAP_RESET) this.seenFor = 0;
      return;
    }
    // A short dropout (a turned head, a hand in front of the face) keeps the
    // running blink rate; it used to restart the 15-second warm-up.
    if (t - this.lastSeen > GAP_RESET) { this.seenFor = 0; this.blink.times = []; this.closedTrack = []; }
    this.lastSeen = t;
    this.seenFor += dt;
    this.updateBlink(dt, t, face, view);
    this.updateDistance(face, view);
    this.updatePosture(dt, t, face, body);
    this.updateYawn(dt, t, face);
    const p = face.pose;
    this.looking = p ? Math.abs(p.yaw) < 25 && Math.abs(p.pitch) < 22 : Math.abs(face.turnX) < 0.18;
  }

  // ---------------------------------------------------------------- blinks

  rawEar(face, ids, ax) {
    const L = face.raw;
    const d = (a, b) => Math.hypot((L[a].x - L[b].x) * ax, L[a].y - L[b].y);
    const [p1, p2, p3, p4, p5, p6] = ids;
    const h = d(p1, p4);
    return h > 0 ? (d(p2, p6) + d(p3, p5)) / (2 * h) : 0;
  }

  updateBlink(dt, t, f, view) {
    const B = this.blink;
    const turned = f.pose && (Math.abs(f.pose.yaw) > 30 || Math.abs(f.pose.pitch) > 28);
    if (turned || !f.raw || f.raw.length < 400) return;
    const ax = view && view.vw && view.vh ? view.vw / view.vh : 16 / 9;
    const ear = (this.rawEar(f, EAR_A, ax) + this.rawEar(f, EAR_B, ax)) / 2;
    const lid = (f.blinkA + f.blinkB) / 2;
    if (!ear) return;
    if (B.earBase == null) { B.earBase = ear; B.lidBase = lid; }
    // Baselines learn only from frames that look open. The eyelid score has
    // its own baseline because looking down or squinting lifts it well above
    // zero without the eyes closing.
    const k = Math.min(1, dt * 0.8);
    if (ear > B.earBase * 0.8 && lid < B.lidBase + 0.25) {
      B.earBase += (ear - B.earBase) * k;
      B.lidBase += (Math.min(lid, 0.5) - B.lidBase) * k;
    }
    const byShape = clamp((B.earBase - ear) / (B.earBase * 0.45), 0, 1);
    const byModel = clamp((lid - B.lidBase) / Math.max(0.25, 0.85 - B.lidBase), 0, 1);
    // Both readings must agree: a smile narrows the eye shape without moving
    // the lid score, and a downward glance raises the lid score while the
    // shape stays open.
    const c = Math.min(1, byShape * 0.5 + byModel * 0.5 + (Math.min(byShape, byModel) > 0.55 ? 0.25 : 0));
    this.eyeOpen = 1 - c;
    this.eyeTrace.push([t, c]);
    while (this.eyeTrace.length && t - this.eyeTrace[0][0] > 12) this.eyeTrace.shift();

    if (!B.closed && c > 0.5 && byModel > 0.3) { B.closed = true; B.since = t; B.peak = c; }
    else if (B.closed) {
      B.peak = Math.max(B.peak, c);
      if (c < 0.3) {
        B.closed = false;
        const held = t - B.since;
        // A blink lasts 100-400 ms; one tracking frame either side is
        // allowed for. Longer closures are rests or microsleeps, which count
        // towards fatigue instead.
        if (held <= 0.6) { B.times.push(t); B.total++; }
        else B.lastLong = t;
      }
    }
    while (B.times.length && t - B.times[0] > 60) B.times.shift();

    this.closedTrack.push([t, c > 0.8 ? 1 : 0]);
    while (this.closedTrack.length && t - this.closedTrack[0][0] > 60) this.closedTrack.shift();
    let s = 0;
    for (const [, v] of this.closedTrack) s += v;
    this.perclos = this.closedTrack.length ? s / this.closedTrack.length : 0;
  }

  // Blinks per minute over the time actually observed (null until 15 s).
  blinkRate(t = this.lastT || 0) {
    const B = this.blink;
    const span = Math.min(60, this.seenFor);
    if (span < 15) return null;
    return Math.round((B.times.filter((x) => t - x <= span).length / span) * 60);
  }

  // ---------------------------------------------------------------- distance

  // Distance per unit focal length: cm = focal * scale. Null without iris
  // landmarks.
  scale(f, view) {
    const { vw, vh } = view;
    if (!vw || !f.raw || f.raw.length < 478) return null;
    const L = f.raw;
    const yawC = f.pose ? Math.max(0.7, Math.cos((Math.min(45, Math.abs(f.pose.yaw)) * Math.PI) / 180)) : 1;
    const iris = f.irisPx(vw, vh) / Math.max(0.8, yawC);
    const ipd = Math.hypot((L[468].x - L[473].x) * vw, (L[468].y - L[473].y) * vh) / yawC;
    if (!(iris > 2) || !(ipd > 10)) return null;
    // Landmark error is roughly constant in pixels, so each estimate's
    // relative error is inversely proportional to its size in pixels; the
    // anatomical spread (iris ~4 %, pupil distance ~6 %) is added on top.
    const relIris = Math.hypot(0.6 / iris, 0.04);
    const relIpd = Math.hypot(0.6 / ipd, 0.06);
    const wI = 1 / relIris ** 2, wP = 1 / relIpd ** 2;
    return ((IRIS_CM / iris) * wI + (IPD_CM / ipd) * wP) / (wI + wP);
  }

  updateDistance(f, view) {
    const { vw, fov } = view;
    if (!vw) return;
    const focal = (vw / 2) / Math.tan(((fov || 70) * Math.PI) / 360);
    const s = this.scale(f, view);
    let cm;
    if (s) {
      cm = focal * s;
      this.distanceSrc = 'eyes';
    } else {
      cm = (focal * 14.5) / Math.max(1, f.uv.w * vw);
      this.distanceSrc = 'face';
    }
    if (!isFinite(cm) || cm < 10 || cm > 400) return;
    this.distWindow.push(cm);
    if (this.distWindow.length > 9) this.distWindow.shift();
    const med = median(this.distWindow);
    this.distance = this.distance == null ? med : this.distance + (med - this.distance) * 0.2;
  }

  // Horizontal field of view that makes the current reading equal a known
  // distance; used by "I'm sitting N cm away" calibration.
  fovFor(actualCm, f, view) {
    const s = this.scale(f, view);
    if (!s) return null;
    const focal = actualCm / s;
    return (2 * Math.atan(view.vw / 2 / focal) * 180) / Math.PI;
  }

  // ---------------------------------------------------------------- posture

  // Forward head angle in degrees from the pose model's 3D landmarks: how far
  // the ears sit in front of the shoulders, 0 when stacked upright.
  headForward(body) {
    const w = body.world;
    if (!w || w.length < 13) return null;
    const ear = [(w[7].y + w[8].y) / 2, (w[7].z + w[8].z) / 2];
    const sh = [(w[11].y + w[12].y) / 2, (w[11].z + w[12].z) / 2];
    const up = sh[0] - ear[0];
    if (up <= 0.02) return null;
    return (Math.atan2(sh[1] - ear[1], up) * 180) / Math.PI;
  }

  updatePosture(dt, t, f, body) {
    const P = this.posture;
    const hasBody = !!(body && body.shoulders && body.seen(7, 0.35) && body.seen(8, 0.35));
    const roll = f.pose ? f.pose.roll : (f.roll * 180) / Math.PI;
    const pitch = f.pose ? f.pose.pitch : 0;
    let sample;
    if (hasBody) {
      const sw = Math.max(body.shoulderW, 1);
      sample = {
        body: true,
        neck: (body.shoulderMid[1] - body.earMid[1]) / sw,
        tilt: (Math.atan2(Math.abs(body.y(11) - body.y(12)), Math.abs(body.x(11) - body.x(12))) * 180) / Math.PI,
        lean: f.width / sw,
        forward: this.headForward(body),
        cy: f.uv.y,
      };
    } else {
      sample = { body: false, neck: null, tilt: null, lean: f.uv.w, forward: null, cy: f.uv.y };
    }
    P.angles = { roll, pitch, tilt: sample.tilt, forward: sample.forward, neck: sample.neck, body: hasBody };

    // Explicit calibration: the median of the next few seconds.
    if (P.calibrating) {
      P.calibrating.samples.push(sample);
      if (t >= P.calibrating.until && P.calibrating.samples.length > 10) {
        const S = P.calibrating.samples.filter((s) => s.body === sample.body);
        const med = (k) => median(S.map((s) => s[k]).filter((v) => v != null));
        P.calibrated = { body: sample.body, neck: med('neck'), lean: med('lean'), forward: med('forward'), cy: med('cy') };
        P.calibrating = null;
      }
      P.state = 'learning';
      return;
    }

    // Reference samples, about five a second, for the last ten minutes.
    if (t - P.sampleAt > 0.2) {
      P.sampleAt = t;
      P.samples.push(sample);
      if (P.samples.length > 3000) P.samples.shift();
    }
    const same = P.samples.filter((s) => s.body === sample.body);
    if (same.length < 15) { P.state = 'learning'; return; }
    // Upright posture: the tallest neck, the face furthest back, the smallest
    // forward head angle and the highest head position seen.
    const auto = {
      body: sample.body,
      neck: percentile(same.map((s) => s.neck).filter((v) => v != null), 0.85),
      lean: percentile(same.map((s) => s.lean), 0.2),
      forward: percentile(same.map((s) => s.forward).filter((v) => v != null), 0.15),
      cy: percentile(same.map((s) => s.cy), 0.15),
    };
    const ref = P.calibrated && P.calibrated.body === sample.body ? P.calibrated : auto;
    P.ref = ref;

    const found = [];
    let score = 100;
    if (sample.body) {
      const drop = ref.neck ? (ref.neck - sample.neck) / ref.neck : 0;
      if (drop > 0.15) { found.push(['neck', 'Head dropping forward']); score -= Math.min(40, drop * 130); }
      if (sample.forward != null && ref.forward != null && sample.forward - ref.forward > 12) {
        found.push(['forward', 'Head pushed forward of the shoulders']);
        score -= Math.min(25, (sample.forward - ref.forward - 12) * 1.5 + 8);
      }
      if (sample.tilt > 6) { found.push(['tilt', 'Shoulders uneven']); score -= Math.min(20, (sample.tilt - 6) * 3); }
      if (sample.lean > ref.lean * 1.15) { found.push(['lean', 'Leaning in towards the screen']); score -= Math.min(20, ((sample.lean / ref.lean) - 1.15) * 120 + 8); }
    } else {
      if (sample.cy - ref.cy > 0.06) { found.push(['sink', 'Sinking down in the seat']); score -= Math.min(35, (sample.cy - ref.cy) * 400); }
      if (sample.lean > ref.lean * 1.15) { found.push(['lean', 'Leaning in towards the screen']); score -= 20; }
    }
    if (Math.abs(roll) > 10) { found.push(['roll', 'Head tilted to one side']); score -= Math.min(15, (Math.abs(roll) - 10) * 1.5 + 5); }
    if (pitch < -18) { found.push(['pitch', 'Looking down a lot (neck strain)']); score -= 12; }

    // Issues are held for a few seconds before they count, so a glance down
    // or a stretch does not flash a warning.
    const now = new Set(found.map(([k]) => k));
    for (const k of Object.keys(P.held)) if (!now.has(k)) delete P.held[k];
    for (const [k] of found) P.held[k] = (P.held[k] || 0) + dt;
    const lasting = found.filter(([k]) => P.held[k] >= ISSUE_HOLD);
    const penalty = 100 - clamp(score, 0, 100);
    const share = found.length ? lasting.length / found.length : 1;
    const settled = clamp(Math.round(100 - penalty * share), 0, 100);
    P.score = P.score == null ? settled : P.score + (settled - P.score) * Math.min(1, dt * 0.8);
    P.issues = lasting.map(([, label]) => label);
    P.state = P.score >= 75 ? 'good' : P.score >= 55 ? 'fair' : 'poor';
    P.total += dt;
    if (P.state === 'poor') P.bad += dt; else { P.good += dt; P.bad = Math.max(0, P.bad - dt * 2); }
  }

  // ---------------------------------------------------------------- yawns

  updateYawn(dt, t, f) {
    const Y = this.yawn;
    if (f.jaw > 0.55 && f.mouthOpen > f.height * 0.12) Y.open += dt;
    else {
      if (Y.open > 1.2) { Y.count++; Y.times.push(t); }
      Y.open = 0;
    }
    while (Y.times.length && t - Y.times[0] > 600) Y.times.shift();
  }

  // Simple fatigue estimate from blink rate, eyelid closure and yawns, 0-100.
  fatigue(t = this.lastT || 0) {
    const rate = this.blinkRate(t);
    let f = 0;
    if (rate != null) f += rate < 8 ? 25 : rate > 26 ? 20 : 0;
    f += clamp(this.perclos * 400, 0, 40);
    f += Math.min(30, this.yawn.times.length * 10);
    if (t - this.blink.lastLong < 60) f += 10;
    return clamp(Math.round(f), 0, 100);
  }

  summary(t = this.lastT || 0) {
    const parts = [];
    const r = this.blinkRate(t);
    if (r != null) parts.push(`blinks ${r}/min`);
    if (this.distance) parts.push(`about ${Math.round(this.distance)} cm from the screen`);
    if (this.posture.score != null) parts.push(`posture ${this.posture.state} (${Math.round(this.posture.score)}/100${this.posture.issues.length ? `: ${this.posture.issues.join(', ').toLowerCase()}` : ''})`);
    if (this.yawn.times.length) parts.push(`${this.yawn.times.length} yawns in 10 min`);
    parts.push(this.looking ? 'looking at the screen' : 'looking away');
    return parts.join('; ');
  }
}
