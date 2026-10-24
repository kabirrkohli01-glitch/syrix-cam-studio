import { dist } from '../tracking.js';
import { glowSprite, rand } from './particles.js';

// Drawing engine for the Draw mode. Strokes are drawn with a finger (index
// finger up) or the mouse, rendered live every frame so they can animate,
// fade, follow the face or come to life with simple physics.

export const PALETTE = [
  [255, 165, 31], [255, 77, 109], [192, 132, 252], [56, 189, 248],
  [52, 211, 153], [250, 250, 245], [24, 24, 27], 'rainbow',
];

const SIZES = { s: 0.0055, m: 0.0095, l: 0.016 };
const LIGHT_LIFE = 2.6;
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function hslRgb(h, l = 0.6) {
  const k = (n) => (n + h / 30) % 12;
  const a = Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// Small deterministic noise for the hand-drawn "boil" of Living Ink.
function jitter(seed, i) {
  const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

export class DrawFX {
  constructor(particles, sfx) {
    this.P = particles;
    this.sfx = sfx;
    this.strokes = [];
    this.active = new Map();
    this.cursor = new Map();
    this.dwell = new Map();
    this.handState = new Map();
    this.color = 0;
    this.hue = 0;
    this.palm = 0;
    this.palmAt = null;
    this.alive = false;
    this.W = 1;
    this.H = 1;
    this.face = null;
  }

  resize(W, H) { this.W = W; this.H = H; }

  get count() { return this.strokes.length; }

  colorFor() {
    const c = PALETTE[this.color];
    return c === 'rainbow' ? null : c;
  }

  swatch(i) {
    const gap = 46;
    return [this.W / 2 - ((PALETTE.length - 1) * gap) / 2 + i * gap, 118];
  }

  swatchAt(x, y) {
    for (let i = 0; i < PALETTE.length; i++) {
      const [sx, sy] = this.swatch(i);
      if (dist(x, y, sx, sy) < 22) return i;
    }
    return -1;
  }

  pickColor(i) {
    if (i === this.color) return;
    this.color = i;
    const [x, y] = this.swatch(i);
    const c = PALETTE[i];
    this.P.burst(x, y, 12, { kind: 'glow', speed: [60, 180], life: [0.3, 0.6], size: [8, 14], rgb: c === 'rainbow' ? [[255, 90, 90], [90, 255, 140], [90, 160, 255]] : c, drag: 0.2, grow: 0.2 });
    this.sfx.click();
    if (this.onColor) this.onColor(i);
  }

  // ---------------------------------------------------------------- face frame

  faceFrame(face) {
    if (!face) return null;
    return { cx: face.center[0], cy: face.center[1], roll: face.roll, s: Math.max(face.width, 1) };
  }

  toLocal(f, x, y) {
    const c = Math.cos(-f.roll), s = Math.sin(-f.roll);
    const dx = (x - f.cx) / f.s, dy = (y - f.cy) / f.s;
    return [dx * c - dy * s, dx * s + dy * c];
  }

  toScreen(f, lx, ly) {
    const c = Math.cos(f.roll), s = Math.sin(f.roll);
    return [f.cx + (lx * c - ly * s) * f.s, f.cy + (lx * s + ly * c) * f.s];
  }

  // ---------------------------------------------------------------- strokes

  begin(key, x, y, t, opts) {
    if (opts.brush === 'eraser') { this.erase(x, y); return null; }
    const anchor = opts.anchor === 'face' && this.face ? 'face' : 'screen';
    const s = {
      brush: opts.brush,
      rgb: this.colorFor(),
      hue: this.hue,
      width: Math.max(3, Math.min(this.W, this.H) * SIZES[opts.size || 'm']),
      anchor,
      pts: [],
      times: [],
      born: t,
      seed: Math.random() * 1000,
      body: null,
    };
    this.active.set(key, s);
    this.addPoint(s, x, y, t);
    return s;
  }

  addPoint(s, x, y, t) {
    let px = x, py = y;
    if (s.anchor === 'face') {
      const f = this.faceFrame(this.face);
      if (!f) return;
      [px, py] = this.toLocal(f, x, y);
    }
    s.pts.push(px, py);
    s.times.push(t);
    if (!s.rgb) this.hue = (this.hue + 2.4) % 360;
  }

  extend(key, x, y, t, opts) {
    if (opts.brush === 'eraser') { this.erase(x, y); return; }
    let s = this.active.get(key);
    if (!s) { this.begin(key, x, y, t, opts); return; }
    const n = s.pts.length;
    const [lx, ly] = s.anchor === 'face' && this.face ? this.toScreen(this.faceFrame(this.face), s.pts[n - 2], s.pts[n - 1]) : [s.pts[n - 2], s.pts[n - 1]];
    const d = dist(x, y, lx, ly);
    if (d < 2) return;
    // Long jumps between tracking frames are filled in so curves stay round.
    const steps = Math.min(6, Math.floor(d / 14));
    for (let k = 1; k <= steps; k++) {
      const a = k / (steps + 1);
      this.addPoint(s, lx + (x - lx) * a, ly + (y - ly) * a, t);
    }
    this.addPoint(s, x, y, t);
    if (s.brush === 'glitter' && Math.random() < 0.6) {
      this.P.spawn({ kind: 'glow', x, y, vx: rand(-50, 50), vy: rand(-80, 20), g: 160, life: rand(0.4, 0.9), size: rand(5, 11), rgb: [255, 236, 170], grow: 0.2 });
    } else if (s.brush === 'neon' && Math.random() < 0.25) {
      this.P.spawn({ kind: 'glow', x, y, vx: rand(-30, 30), vy: rand(-30, 30), life: 0.45, size: rand(5, 10), rgb: s.rgb || hslRgb(this.hue), grow: 0.2 });
    }
  }

  end(key) {
    const s = this.active.get(key);
    if (!s) return;
    this.active.delete(key);
    if (s.pts.length >= 2) {
      this.strokes.push(s);
      if (this.strokes.length > 400) this.strokes.shift();
    }
  }

  erase(x, y) {
    const r = 22;
    const f = this.faceFrame(this.face);
    const before = this.strokes.length;
    this.strokes = this.strokes.filter((s) => {
      for (let i = 0; i < s.pts.length; i += 2) {
        const [px, py] = this.screenPoint(s, i, f);
        if (dist(px, py, x, y) < r + s.width / 2) return false;
      }
      return true;
    });
    if (this.strokes.length !== before) {
      this.sfx.pop();
      this.P.burst(x, y, 8, { kind: 'glow', speed: [40, 140], life: [0.2, 0.4], size: [6, 10], rgb: [230, 225, 220], drag: 0.2 });
    }
  }

  undo() {
    const s = this.strokes.pop();
    if (s) this.sfx.click();
    return !!s;
  }

  clear() {
    const all = [...this.strokes, ...this.active.values()];
    if (!all.length) return false;
    const f = this.faceFrame(this.face);
    for (const s of all) {
      for (let i = 0; i < s.pts.length; i += 14) {
        const [x, y] = this.screenPoint(s, i, f);
        this.P.spawn({ kind: 'glow', x, y, vx: rand(-60, 60), vy: rand(-120, 20), g: 500, life: rand(0.5, 1), size: rand(7, 14), rgb: s.rgb || hslRgb(s.hue + i), grow: 0.3 });
      }
    }
    this.strokes = [];
    this.active.clear();
    this.alive = false;
    this.sfx.whoosh();
    return true;
  }

  // Strokes jump off the screen plane, tumble and bounce on the floor; a
  // second call sends them back to where they were drawn.
  toggleLife() {
    this.alive = !this.alive;
    for (const s of this.strokes) {
      if (s.anchor !== 'screen') continue;
      if (this.alive) {
        let cx = 0, cy = 0, minY = Infinity, maxY = -Infinity;
        const n = s.pts.length / 2;
        for (let i = 0; i < s.pts.length; i += 2) {
          cx += s.pts[i]; cy += s.pts[i + 1];
          minY = Math.min(minY, s.pts[i + 1]); maxY = Math.max(maxY, s.pts[i + 1]);
        }
        s.body = { cx: cx / n, cy: cy / n, half: (maxY - minY) / 2, x: 0, y: 0, rot: 0, vx: rand(-260, 260), vy: rand(-720, -380), vr: rand(-4, 4) };
      }
    }
    this.sfx.whoosh();
    return this.alive;
  }

  stepBodies(dt) {
    for (const s of this.strokes) {
      const b = s.body;
      if (!b) continue;
      if (this.alive) {
        b.vy += 1500 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.rot += b.vr * dt;
        const bottom = b.cy + b.y + b.half * 0.6;
        if (bottom > this.H - 6 && b.vy > 0) {
          b.y = this.H - 6 - b.cy - b.half * 0.6;
          b.vy *= -0.46;
          b.vx *= 0.82;
          b.vr *= 0.7;
          if (Math.abs(b.vy) > 120) this.sfx.pop();
        }
        const cx = b.cx + b.x;
        if ((cx < 20 && b.vx < 0) || (cx > this.W - 20 && b.vx > 0)) b.vx *= -0.7;
      } else {
        const k = 1 - Math.pow(0.0005, dt);
        b.x += (0 - b.x) * k;
        b.y += (0 - b.y) * k;
        b.rot += (0 - b.rot) * k;
        if (Math.abs(b.x) + Math.abs(b.y) + Math.abs(b.rot) < 0.5) s.body = null;
      }
    }
  }

  screenPoint(s, i, f) {
    let x = s.pts[i], y = s.pts[i + 1];
    if (s.anchor === 'face') {
      if (!f) return [NaN, NaN];
      [x, y] = this.toScreen(f, x, y);
    }
    const b = s.body;
    if (b) {
      const dx = x - b.cx, dy = y - b.cy;
      const c = Math.cos(b.rot), sn = Math.sin(b.rot);
      x = b.cx + b.x + dx * c - dy * sn;
      y = b.cy + b.y + dx * sn + dy * c;
    }
    return [x, y];
  }

  // ---------------------------------------------------------------- input

  // Finger drawing is gated so that only a deliberate point draws. A hand
  // must have been tracked for a few frames, hold a clear pointing pose for
  // a moment before the pen goes down, and stop pointing for a moment before
  // it lifts; a jump between frames (a re-detection, another hand taking
  // over) breaks the stroke instead of drawing a line across the screen. The
  // pen trails the fingertip on a short string, which turns tremor into a
  // smooth line without adding visible lag.
  updateHands(dt, hands, t, opts) {
    const seen = new Set();
    let palmHand = null;
    const jump = Math.min(this.W, this.H) * 0.18;
    for (const h of hands) {
      const key = h.id;
      seen.add(key);
      let st = this.handState.get(key);
      if (!st) { st = { point: 0, off: 0, down: false, pen: null, tip: null, palm: null, still: 0 }; this.handState.set(key, st); }
      const x = h.x(8), y = h.y(8);
      const settled = h.age >= 3;
      const wantDraw = settled && (h.strictPoint || (h.pointing && h.gesture === 'Pointing_Up' && h.gestureScore > 0.5));
      if (wantDraw) { st.point += dt; st.off = 0; } else { st.off += dt; st.point = 0; }
      if (!st.down && st.point >= 0.12) st.down = true;
      if (st.down && st.off >= 0.15) st.down = false;

      if (st.tip && dist(x, y, st.tip[0], st.tip[1]) > jump) {
        this.end(key);
        st.pen = null;
      }
      st.tip = [x, y];
      const r = Math.max(3, Math.min(this.W, this.H) * SIZES[opts.size || 'm'] * 0.55);
      if (!st.pen) st.pen = [x, y];
      const d = dist(x, y, st.pen[0], st.pen[1]);
      if (d > r) {
        const k = (d - r) / d;
        st.pen = [st.pen[0] + (x - st.pen[0]) * k, st.pen[1] + (y - st.pen[1]) * k];
      }
      const [px, py] = st.pen;
      const hovering = settled && (h.peace || h.pointing);
      const mode = st.down ? 'draw' : hovering ? 'hover' : 'idle';
      this.cursor.set(key, { x: px, y: py, mode });

      const sw = mode !== 'idle' ? this.swatchAt(px, py) : -1;
      if (sw >= 0) {
        const dw = this.dwell.get(key);
        const tt = dw && dw.i === sw ? dw.t + dt : 0;
        this.dwell.set(key, { i: sw, t: tt });
        if (tt > 0.35) this.pickColor(sw);
        this.end(key);
      } else {
        this.dwell.delete(key);
        if (mode === 'draw') this.extend(key, px, py, t, opts);
        else this.end(key);
      }

      // Wipe: an open palm held still for a second.
      if (settled && h.open && h.count >= 4) {
        const moved = st.palm ? dist(h.palm[0], h.palm[1], st.palm[0], st.palm[1]) : 0;
        st.still = moved < h.size * 0.08 ? st.still + dt : 0;
        st.palm = h.palm;
        if (st.still > 0.25) palmHand = h;
      } else {
        st.still = 0;
        st.palm = null;
      }
    }
    for (const key of [...this.active.keys()]) if (key !== 'mouse' && !seen.has(key)) this.end(key);
    for (const key of [...this.cursor.keys()]) if (!seen.has(key)) this.cursor.delete(key);
    for (const key of [...this.handState.keys()]) if (!seen.has(key)) this.handState.delete(key);
    if (palmHand) {
      if (this.palm >= 0) this.palm += dt;
      if (this.palm > 1.0) { this.clear(); this.palm = -1; }
    } else {
      this.palm = 0;
    }
    this.palmAt = palmHand ? palmHand.palm : null;
  }

  // ---------------------------------------------------------------- render

  render(ctx, t, dt, face, showTools) {
    this.face = face || null;
    this.stepBodies(dt);
    const f = this.faceFrame(this.face);
    const now = t;
    this.strokes = this.strokes.filter((s) => s.brush !== 'lightpaint' || now - s.times[s.times.length - 1] < LIGHT_LIFE);
    for (const s of this.strokes) this.paint(ctx, s, now, f);
    for (const s of this.active.values()) this.paint(ctx, s, now, f);
    if (showTools) this.drawTools(ctx, t);
  }

  paint(ctx, s, now, f) {
    const n = s.pts.length;
    if (n < 2) return;
    if (s.anchor === 'face' && !f) return;
    const pts = new Array(n);
    const boil = s.brush === 'living' ? Math.floor(now * 8) : 0;
    for (let i = 0; i < n; i += 2) {
      let [x, y] = this.screenPoint(s, i, f);
      if (boil) {
        const j = s.width * 0.55;
        x += jitter(s.seed + boil, i) * j + Math.sin(now * 3 + i * 0.05) * j * 0.4;
        y += jitter(s.seed + boil + 7, i) * j;
      }
      pts[i] = x;
      pts[i + 1] = y;
    }
    const color = s.rgb || hslRgb(s.hue);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (s.brush === 'lightpaint') {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 2; i < n; i += 2) {
        const age = now - s.times[i / 2];
        const a = Math.max(0, 1 - age / LIGHT_LIFE);
        if (a <= 0) continue;
        const c = s.rgb || hslRgb((s.hue + i) % 360);
        ctx.strokeStyle = rgb(c, a * 0.22);
        ctx.lineWidth = s.width * 3.2;
        line(ctx, pts, i);
        ctx.strokeStyle = rgb(c, a * 0.85);
        ctx.lineWidth = s.width * 1.1;
        line(ctx, pts, i);
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = s.width * 0.4;
        line(ctx, pts, i);
      }
      ctx.restore();
      return;
    }

    if (!s.rgb && s.brush !== 'marker') {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 2; i < n; i += 2) {
        const c = hslRgb((s.hue + i * 1.2) % 360);
        ctx.strokeStyle = rgb(c, 0.25);
        ctx.lineWidth = s.width * 2.6;
        line(ctx, pts, i);
        ctx.strokeStyle = rgb(c);
        ctx.lineWidth = s.width;
        line(ctx, pts, i);
      }
      ctx.globalCompositeOperation = 'source-over';
      trace(ctx, pts);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = s.width * 0.32;
      ctx.stroke();
      ctx.restore();
      return;
    }

    trace(ctx, pts);
    if (s.brush === 'marker' || s.brush === 'living') {
      ctx.strokeStyle = rgb(color);
      ctx.lineWidth = s.width * (s.brush === 'living' ? 0.85 : 1.1);
      ctx.stroke();
    } else {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgb(color, 0.16);
      ctx.lineWidth = s.width * 3.4;
      ctx.stroke();
      ctx.strokeStyle = rgb(color, 0.32);
      ctx.lineWidth = s.width * 1.8;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = rgb(color);
      ctx.lineWidth = s.width;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = s.width * 0.34;
      ctx.stroke();
    }
    if (s.brush === 'glitter') {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i += 10) {
        const tw = 0.5 + 0.5 * Math.sin(now * 6 + i);
        const g = s.width * (1.2 + tw * 1.6);
        ctx.globalAlpha = 0.5 + tw * 0.5;
        ctx.drawImage(glowSprite([255, 236, 170]), pts[i] - g / 2, pts[i + 1] - g / 2, g, g);
      }
    }
    ctx.restore();
  }

  drawTools(ctx, t) {
    ctx.save();
    for (let i = 0; i < PALETTE.length; i++) {
      const [x, y] = this.swatch(i);
      const c = PALETTE[i];
      const sel = i === this.color;
      ctx.beginPath();
      ctx.arc(x, y, sel ? 15 : 12, 0, Math.PI * 2);
      if (c === 'rainbow') {
        const g = ctx.createConicGradient(t, x, y);
        [0, 60, 120, 180, 240, 300, 360].forEach((h, k) => g.addColorStop(k / 6, `hsl(${h},100%,60%)`));
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = rgb(c);
      }
      ctx.fill();
      ctx.lineWidth = sel ? 3 : 1.5;
      ctx.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,0.3)';
      ctx.stroke();
    }
    for (const [key, c] of this.cursor) {
      const col = this.colorFor() || hslRgb(this.hue);
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgb(col, c.mode === 'draw' ? 1 : 0.55);
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.mode === 'draw' ? 9 : 14, 0, Math.PI * 2);
      ctx.stroke();
      if (c.mode === 'draw') {
        ctx.fillStyle = rgb(col);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const d = this.dwell.get(key);
      if (d) {
        const [sx, sy] = this.swatch(d.i);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, 21, -Math.PI / 2, -Math.PI / 2 + Math.min(1, d.t / 0.3) * Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.palm > 0.15 && this.palmAt) {
      const [x, y] = this.palmAt;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(x, y, 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 40, -Math.PI / 2, -Math.PI / 2 + Math.min(1, this.palm) * Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '600 12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Wipe', x, y + 4);
    }
    ctx.restore();
  }

  // Mouse or pen drawing.
  pointerDown(x, y, t, opts) {
    const sw = this.swatchAt(x, y);
    if (sw >= 0) { this.pickColor(sw); return; }
    this.begin('mouse', x, y, t, opts);
  }
  pointerMove(x, y, t, opts) {
    if (this.active.has('mouse') || opts.brush === 'eraser') this.extend('mouse', x, y, t, opts);
  }
  pointerUp() { this.end('mouse'); }
}

function trace(ctx, p) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (p.length === 2) { ctx.lineTo(p[0] + 0.1, p[1]); return; }
  for (let i = 2; i < p.length - 2; i += 2) {
    ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
}

function line(ctx, p, i) {
  ctx.beginPath();
  ctx.moveTo(p[i - 2], p[i - 1]);
  ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}
