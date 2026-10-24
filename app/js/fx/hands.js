import { HAND_CONNECTIONS } from '../vision.js';
import { TIPS, dist } from '../tracking.js';
import { glowSprite, emojiSprite, rand, pick } from './particles.js';

const FINGER_RGB = [[255, 99, 216], [167, 139, 250], [96, 165, 250], [52, 211, 153], [253, 224, 71]];
const HAND_RGB = [[34, 211, 238], [244, 114, 182]];

export const GESTURE_LABEL = {
  Thumb_Up: ['👍', 'Thumbs up'],
  Thumb_Down: ['👎', 'Thumbs down'],
  Victory: ['✌️', 'Peace'],
  ILoveYou: ['🤟', 'Love you'],
  Open_Palm: ['✋', 'Open palm'],
  Closed_Fist: ['✊', 'Fist'],
  Pointing_Up: ['☝️', 'Pointing up'],
};

const rgbStr = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const easeOut = (x) => 1 - Math.pow(1 - x, 3);

// ------------------------------------------------------------------ lightning

function boltPoints(x1, y1, x2, y2, disp, out, depth = 0) {
  if (depth > 6 || disp < 2) {
    out.push(x2, y2);
    return;
  }
  const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * disp;
  const my = (y1 + y2) / 2 + (Math.random() - 0.5) * disp;
  boltPoints(x1, y1, mx, my, disp / 2, out, depth + 1);
  boltPoints(mx, my, x2, y2, disp / 2, out, depth + 1);
}

function drawBolt(ctx, x1, y1, x2, y2, w, rgb = [140, 170, 255]) {
  const pts = [x1, y1];
  boltPoints(x1, y1, x2, y2, Math.hypot(x2 - x1, y2 - y1) * 0.22, pts);
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.strokeStyle = rgbStr(rgb, 0.22);
  ctx.lineWidth = w * 5;
  ctx.stroke();
  ctx.strokeStyle = rgbStr([Math.min(255, rgb[0] + 40), Math.min(255, rgb[1] + 40), 255], 0.75);
  ctx.lineWidth = w * 2;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = w * 0.7;
  ctx.stroke();
}

// ------------------------------------------------------------------ hand fx

export class HandFX {
  constructor(particles, sfx) {
    this.P = particles;
    this.sfx = sfx;
    this.prevTips = new Map();
    this.trailsHist = new Map();
    this.charge = new Map();
    this.pinched = new Map();
    this.paths = new Map();
    this.portals = [];
    this.balls = [];
    this.W = 1;
    this.H = 1;
  }

  resize(W, H) { this.W = W; this.H = H; }

  reset() {
    this.trailsHist.clear();
    this.prevTips.clear();
    this.charge.clear();
    this.paths.clear();
    this.portals = [];
    this.balls = [];
    this.sfx.loop('hum', 0);
    this.sfx.loop('fire', 0);
  }

  frame(ctx, dt, hands, id, t) {
    switch (id) {
      case 'portal': this.portal(ctx, dt, hands, t); break;
      case 'balls': this.forceBalls(ctx, dt, hands, t); break;
      case 'ice': this.iceHands(ctx, dt, hands); break;
      case 'trails': this.trails(ctx, dt, hands); break;
      case 'lightning': this.lightning(ctx, hands); break;
      case 'orb': this.orb(ctx, dt, hands, t); break;
      case 'firehands': this.fireHands(ctx, dt, hands); break;
      case 'skeleton': this.skeleton(ctx, hands); break;
      default: break;
    }
    if (id !== 'orb') this.sfx.loop('hum', 0);
    if (id !== 'firehands' && id !== 'portal') this.sfx.loop('fire', 0);
  }

  // ---------------------------------------------------------------- portal

  // A circle traced by the index fingertip opens a spinning spark portal.
  portal(ctx, dt, hands, t) {
    const now = t;
    for (const h of hands) {
      let path = this.paths.get(h.id);
      if (!path) { path = []; this.paths.set(h.id, path); }
      if (h.ext[1]) path.push({ x: h.x(8), y: h.y(8), t: now });
      while (path.length && now - path[0].t > 1.6) path.shift();
      if (path.length > 14 && this.portals.length < 3) {
        const c = this.detectCircle(path, h.size);
        if (c) {
          this.portals.push({ x: c.x, y: c.y, r: c.r, born: now, closing: 0 });
          path.length = 0;
          this.sfx.whoosh();
          this.sfx.sparkle();
        }
      }
      if (h.count === 0 || h.gesture === 'Closed_Fist') {
        for (const p of this.portals) {
          if (!p.closing && dist(h.palm[0], h.palm[1], p.x, p.y) < p.r * 1.6) { p.closing = now; this.sfx.whoosh(); }
        }
      }
    }
    for (const k of [...this.paths.keys()]) if (!hands.some((h) => h.id === k)) this.paths.delete(k);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const path of this.paths.values()) {
      for (let i = 1; i < path.length; i++) {
        const a = i / path.length;
        ctx.strokeStyle = `rgba(255,170,60,${a * 0.6})`;
        ctx.lineWidth = 1 + a * 4;
        ctx.beginPath();
        ctx.moveTo(path[i - 1].x, path[i - 1].y);
        ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
    }
    ctx.restore();

    this.portals = this.portals.filter((p) => !(p.closing && now - p.closing > 0.45) && now - p.born < 25);
    for (const p of this.portals) {
      const open = Math.min(1, (now - p.born) / 0.5);
      const shut = p.closing ? Math.max(0, 1 - (now - p.closing) / 0.45) : 1;
      const r = p.r * easeOut(open) * shut;
      if (r < 2) continue;
      ctx.save();
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, 'rgba(8,4,2,0.85)');
      g.addColorStop(0.7, 'rgba(40,14,2,0.55)');
      g.addColorStop(1, 'rgba(255,140,30,0.0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = `rgba(255,${150 + k * 30},${40 + k * 30},${0.55 - k * 0.12})`;
        ctx.lineWidth = 3 + k * 2;
        ctx.setLineDash([r * 0.25, r * 0.12]);
        ctx.lineDashOffset = -now * (180 + k * 70);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (1 - k * 0.04), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
      const n = Math.round(10 + r / 6);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rand(140, 320);
        this.P.spawn({
          kind: 'glow', x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r,
          vx: -Math.sin(a) * sp + Math.cos(a) * 40, vy: Math.cos(a) * sp + Math.sin(a) * 40, g: 220, drag: 0.25,
          life: rand(0.25, 0.6), size: rand(4, 9), rgb: pick([[255, 170, 50], [255, 220, 120], [255, 120, 30]]), grow: 0.3,
        });
      }
    }
    this.sfx.loop('fire', this.portals.length ? 0.25 : 0);
  }

  detectCircle(path, handSize) {
    let cx = 0, cy = 0;
    for (const p of path) { cx += p.x; cy += p.y; }
    cx /= path.length;
    cy /= path.length;
    let mean = 0;
    const rs = path.map((p) => { const r = dist(p.x, p.y, cx, cy); mean += r; return r; });
    mean /= path.length;
    if (mean < handSize * 0.45 || mean > Math.min(this.W, this.H) * 0.4) return null;
    let v = 0;
    for (const r of rs) v += (r - mean) * (r - mean);
    if (Math.sqrt(v / rs.length) / mean > 0.32) return null;
    let sweep = 0;
    let prev = Math.atan2(path[0].y - cy, path[0].x - cx);
    for (let i = 1; i < path.length; i++) {
      const a = Math.atan2(path[i].y - cy, path[i].x - cx);
      let d = a - prev;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      sweep += d;
      prev = a;
    }
    if (Math.abs(sweep) < Math.PI * 1.65) return null;
    return { x: cx, y: cy, r: mean * 1.15 };
  }

  // ---------------------------------------------------------------- force balls

  forceBalls(ctx, dt, hands, t) {
    const W = this.W, H = this.H;
    if (!this.balls.length) {
      const colors = [[255, 165, 31], [255, 100, 60], [255, 220, 120], [120, 210, 255], [255, 140, 200], [180, 255, 160]];
      for (let i = 0; i < 6; i++) {
        this.balls.push({ x: rand(W * 0.2, W * 0.8), y: rand(H * 0.2, H * 0.6), vx: rand(-80, 80), vy: rand(-80, 80), r: Math.min(W, H) * rand(0.035, 0.055), rgb: colors[i] });
      }
    }
    const tips = [];
    for (const h of hands) {
      for (const tp of [4, 8, 12, 16, 20, 9]) {
        const key = `${h.id}:${tp}`;
        const x = h.x(tp), y = h.y(tp);
        const prev = this.prevTips.get(key);
        const vx = prev ? (x - prev[0]) / Math.max(dt, 1 / 120) : 0;
        const vy = prev ? (y - prev[1]) / Math.max(dt, 1 / 120) : 0;
        this.prevTips.set(key, [x, y]);
        tips.push({ x, y, vx, vy, r: tp === 9 ? h.size * 0.5 : h.size * 0.12 });
      }
    }
    for (const b of this.balls) {
      b.vy += 40 * dt;
      b.vx *= Math.pow(0.7, dt);
      b.vy *= Math.pow(0.7, dt);
      for (const tp of tips) {
        const d = dist(b.x, b.y, tp.x, tp.y);
        const min = b.r + tp.r;
        if (d < min && d > 0.01) {
          const nx = (b.x - tp.x) / d, ny = (b.y - tp.y) / d;
          b.x = tp.x + nx * min;
          b.y = tp.y + ny * min;
          const push = Math.max(120, (tp.vx * nx + tp.vy * ny) * 1.1);
          b.vx = nx * push + tp.vx * 0.35;
          b.vy = ny * push + tp.vy * 0.35;
          if (push > 220) {
            this.sfx.pop();
            this.P.burst(b.x - nx * b.r, b.y - ny * b.r, 8, { kind: 'glow', speed: [60, 200], life: [0.2, 0.4], size: [5, 10], rgb: b.rgb, drag: 0.2 });
          }
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.85; }
      if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.85; }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.85; }
      if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * 0.85; }
    }
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i], b = this.balls[j];
        const d = dist(a.x, a.y, b.x, b.y);
        const min = a.r + b.r;
        if (d < min && d > 0.01) {
          const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
          const overlap = (min - d) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            a.vx += rel * nx; a.vy += rel * ny;
            b.vx -= rel * nx; b.vy -= rel * ny;
          }
        }
      }
    }
    ctx.save();
    for (const b of this.balls) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowSprite(b.rgb, 128), b.x - b.r * 2.6, b.y - b.r * 2.6, b.r * 5.2, b.r * 5.2);
      ctx.globalCompositeOperation = 'source-over';
      const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, rgbStr(b.rgb));
      g.addColorStop(1, rgbStr(b.rgb.map((v) => v * 0.35)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    void t;
  }

  // ---------------------------------------------------------------- ice hands

  iceHands(ctx, dt, hands) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const h of hands) {
      const s = h.size / 100;
      const g = h.size * 2.2;
      ctx.globalAlpha = 0.45;
      ctx.drawImage(glowSprite([150, 220, 255], 128), h.palm[0] - g / 2, h.palm[1] - g / 2, g, g);
      ctx.globalAlpha = 1;
      TIPS.forEach((tp, f) => {
        if (!h.ext[f] && Math.random() < 0.6) return;
        this.P.spawn({ kind: 'glow', x: h.x(tp) + rand(-5, 5), y: h.y(tp) + rand(-5, 5), vx: rand(-30, 30) * s, vy: rand(-10, 60) * s, g: 40, drag: 0.5, life: rand(0.6, 1.2), size: rand(6, 14) * s, rgb: pick([[200, 240, 255], [150, 210, 255], [255, 255, 255]]), grow: 0.2 });
        if (Math.random() < 0.035) {
          this.P.spawn({ kind: 'emoji', ch: '❄️', x: h.x(tp), y: h.y(tp), vx: rand(-40, 40), vy: rand(20, 80), g: 60, life: 1.6, size: rand(16, 26) * s, grow: 0.6, rot: rand(0, 6), vr: rand(-2, 2) });
        }
      });
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- trails

  trails(ctx, dt, hands) {
    const seen = new Set();
    for (const h of hands) {
      const s = h.size / 110;
      for (let f = 0; f < 5; f++) {
        const key = `${h.id}:${f}`;
        seen.add(key);
        const x = h.x(TIPS[f]), y = h.y(TIPS[f]);
        const prev = this.prevTips.get(key);
        const vx = prev ? (x - prev[0]) / Math.max(dt, 1e-3) : 0;
        const vy = prev ? (y - prev[1]) / Math.max(dt, 1e-3) : 0;
        this.prevTips.set(key, [x, y]);
        let hist = this.trailsHist.get(key);
        if (!hist) { hist = []; this.trailsHist.set(key, hist); }
        hist.push(x, y);
        if (hist.length > 28) hist.splice(0, hist.length - 28);
        const n = 2;
        for (let k = 0; k < n; k++) {
          this.P.spawn({
            kind: 'glow', x: x + rand(-3, 3), y: y + rand(-3, 3),
            vx: vx * 0.12 + rand(-40, 40), vy: vy * 0.12 + rand(-40, 40), g: 60, drag: 0.4,
            life: rand(0.45, 0.9), size: rand(10, 22) * s, rgb: FINGER_RGB[f], grow: 0.15,
          });
        }
        if (Math.random() < 0.06) {
          this.P.spawn({ kind: 'glow', x, y, vx: rand(-90, 90), vy: rand(-140, -40), g: 120, life: 0.9, size: rand(5, 9), rgb: [255, 255, 255], grow: 0.3 });
        }
      }
      const pinch = h.pinch < 0.3;
      if (pinch && !this.pinched.get(h.id)) {
        const px = (h.x(4) + h.x(8)) / 2, py = (h.y(4) + h.y(8)) / 2;
        this.P.burst(px, py, 36, { kind: 'glow', speed: [120, 420], life: [0.4, 0.9], size: [8, 20], rgb: FINGER_RGB, drag: 0.15, grow: 0.2 });
        this.P.spawn({ kind: 'ring', x: px, y: py, life: 0.5, size: 12, grow: 6, rgb: [255, 255, 255] });
        this.sfx.sparkle();
      }
      this.pinched.set(h.id, pinch);
    }
    for (const k of [...this.trailsHist.keys()]) {
      if (!seen.has(k)) { this.trailsHist.delete(k); this.prevTips.delete(k); }
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [key, hist] of this.trailsHist) {
      const f = Number(key.split(':')[1]);
      const c = FINGER_RGB[f];
      for (let i = 2; i < hist.length; i += 2) {
        const a = i / hist.length;
        ctx.strokeStyle = rgbStr(c, a * 0.7);
        ctx.lineWidth = 1 + a * 7;
        ctx.beginPath();
        ctx.moveTo(hist[i - 2], hist[i - 1]);
        ctx.lineTo(hist[i], hist[i + 1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- lightning

  lightning(ctx, hands) {
    if (!hands.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let arcs = 0;
    if (hands.length >= 2) {
      const [a, b] = hands;
      const w = Math.max(1.2, (a.size + b.size) / 2 / 70);
      for (let f = 0; f < 5; f++) {
        const ax = a.x(TIPS[f]), ay = a.y(TIPS[f]), bx = b.x(TIPS[f]), by = b.y(TIPS[f]);
        if (Math.hypot(ax - bx, ay - by) < ctx.canvas.clientWidth * 0.95 && Math.random() < 0.85) {
          drawBolt(ctx, ax, ay, bx, by, w);
          arcs++;
        }
      }
    }
    for (const h of hands) {
      const w = Math.max(1, h.size / 90);
      const tips = TIPS.filter((_, f) => h.ext[f]);
      for (let i = 0; i < tips.length - 1; i++) {
        if (Math.random() < 0.7) {
          drawBolt(ctx, h.x(tips[i]), h.y(tips[i]), h.x(tips[i + 1]), h.y(tips[i + 1]), w * 0.8);
          arcs++;
        }
      }
      for (const tp of tips) {
        const x = h.x(tp), y = h.y(tp);
        const g = h.size * 0.45;
        ctx.drawImage(glowSprite([120, 160, 255]), x - g / 2, y - g / 2, g, g);
        if (Math.random() < 0.25) {
          const ang = Math.atan2(y - h.palm[1], x - h.palm[0]) + rand(-0.6, 0.6);
          const L = h.size * rand(0.4, 0.9);
          drawBolt(ctx, x, y, x + Math.cos(ang) * L, y + Math.sin(ang) * L, w * 0.6);
        }
      }
      if (Math.random() < 0.3) {
        const tp = pick(TIPS);
        this.P.spawn({ kind: 'glow', x: h.x(tp), y: h.y(tp), vx: rand(-150, 150), vy: rand(-150, 150), drag: 0.1, life: 0.3, size: rand(6, 12), rgb: [180, 210, 255], grow: 0.2 });
      }
    }
    ctx.restore();
    if (arcs) this.sfx.zap();
  }

  // ---------------------------------------------------------------- energy orb

  orb(ctx, dt, hands, t) {
    const seen = new Set();
    for (const h of hands) {
      seen.add(h.id);
      const c = this.charge.get(h.id) || 0;
      this.charge.set(h.id, Math.max(0, Math.min(1, c + (h.open || h.count >= 4 ? dt * 1.8 : -dt * 2.5))));
    }
    for (const k of [...this.charge.keys()]) if (!seen.has(k)) this.charge.delete(k);

    let level = 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (hands.length >= 2) {
      const [a, b] = hands;
      const ca = this.charge.get(a.id) || 0, cb = this.charge.get(b.id) || 0;
      const d = dist(a.palm[0], a.palm[1], b.palm[0], b.palm[1]);
      const avg = (a.size + b.size) / 2;
      if (ca > 0.2 && cb > 0.2 && d < avg * 4.5) {
        const k = Math.min(ca, cb);
        const x = (a.palm[0] + b.palm[0]) / 2, y = (a.palm[1] + b.palm[1]) / 2;
        const r = Math.max(avg * 0.5, d * 0.36) * k;
        this.drawOrb(ctx, x, y, r, t, [120, 90, 255]);
        for (const h of [a, b]) {
          for (const tp of TIPS) if (Math.random() < 0.35) drawBolt(ctx, x, y, h.x(tp), h.y(tp), 1.2, [150, 120, 255]);
        }
        level = k;
        ctx.restore();
        this.sfx.loop('hum', level);
        if (Math.random() < 0.5) this.inflow(x, y, r, [170, 140, 255]);
        return;
      }
    }
    for (const h of hands) {
      const k = this.charge.get(h.id) || 0;
      if (k < 0.02) continue;
      const ox = h.x(9) - h.x(0), oy = h.y(9) - h.y(0);
      const x = h.palm[0] + ox * 0.45, y = h.palm[1] + oy * 0.45;
      const r = h.size * 0.55 * k;
      this.drawOrb(ctx, x, y, r, t, [34, 211, 238]);
      level = Math.max(level, k);
      if (Math.random() < 0.35 * k) this.inflow(x, y, r, [120, 230, 255]);
    }
    ctx.restore();
    this.sfx.loop('hum', level * 0.7);
  }

  inflow(x, y, r, rgb) {
    const a = Math.random() * Math.PI * 2;
    const R = r * 2.6;
    this.P.spawn({
      kind: 'glow', x: x + Math.cos(a) * R, y: y + Math.sin(a) * R,
      vx: -Math.cos(a) * R * 2.2, vy: -Math.sin(a) * R * 2.2, life: 0.4, size: rand(6, 12), rgb, grow: 0.3,
    });
  }

  drawOrb(ctx, x, y, r, t, rgb) {
    if (r < 2) return;
    const pulse = 1 + 0.06 * Math.sin(t * 9);
    const R = r * pulse;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(glowSprite(rgb, 128), x - R * 3, y - R * 3, R * 6, R * 6);
    ctx.globalAlpha = 1;
    ctx.drawImage(glowSprite([200, 245, 255], 128), x - R * 1.2, y - R * 1.2, R * 2.4, R * 2.4);
    ctx.lineWidth = Math.max(1.5, R * 0.05);
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = rgbStr(rgb, 0.65);
      ctx.beginPath();
      ctx.ellipse(x, y, R * (0.95 + k * 0.12), R * 0.32, t * (1.6 + k * 0.7) + k * 1.1, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let k = 0; k < 8; k++) {
      const a = t * 3.2 + (k * Math.PI) / 4;
      const px = x + Math.cos(a) * R * 1.25;
      const py = y + Math.sin(a * 1.3) * R * 0.6;
      const s = R * 0.35;
      ctx.drawImage(glowSprite([255, 255, 255]), px - s / 2, py - s / 2, s, s);
    }
  }

  // ---------------------------------------------------------------- fire hands

  fireHands(ctx, dt, hands) {
    for (const h of hands) {
      const s = h.size / 100;
      TIPS.forEach((tp, f) => {
        const n = h.ext[f] ? 3 : 1;
        for (let k = 0; k < n; k++) {
          this.P.spawn({
            kind: 'fire', x: h.x(tp) + rand(-4, 4) * s, y: h.y(tp),
            vx: rand(-40, 40) * s, vy: rand(-220, -90) * s, g: -160 * s, drag: 0.5,
            life: rand(0.3, 0.6), size: rand(20, 34) * s,
          });
        }
      });
      if (h.count === 0) {
        for (let k = 0; k < 5; k++) {
          this.P.spawn({ kind: 'fire', x: h.palm[0] + rand(-20, 20) * s, y: h.palm[1] + rand(-20, 20) * s, vx: rand(-60, 60) * s, vy: rand(-260, -120) * s, g: -100 * s, drag: 0.5, life: rand(0.4, 0.8), size: rand(40, 70) * s });
        }
      }
    }
    this.sfx.loop('fire', hands.length ? 0.4 : 0);
  }

  // ---------------------------------------------------------------- tracker

  skeleton(ctx, hands) {
    ctx.save();
    hands.forEach((h, idx) => {
      const c = HAND_RGB[idx % 2];
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const [lw, a] of [[9, 0.22], [3, 0.95]]) {
        ctx.lineWidth = lw;
        ctx.strokeStyle = rgbStr(c, a);
        ctx.beginPath();
        for (const con of HAND_CONNECTIONS) {
          ctx.moveTo(h.x(con.start), h.y(con.start));
          ctx.lineTo(h.x(con.end), h.y(con.end));
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 21; i++) {
        const tip = TIPS.includes(i);
        ctx.fillStyle = tip ? '#fff' : rgbStr(c);
        ctx.beginPath();
        ctx.arc(h.x(i), h.y(i), tip ? 6 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        if (tip) {
          ctx.strokeStyle = rgbStr(c);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Finger count badge
      const bx = h.palm[0], by = h.palm[1];
      ctx.fillStyle = 'rgba(10,10,20,0.7)';
      ctx.strokeStyle = rgbStr(c);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx, by, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '700 24px Bahnschrift, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(h.count), bx, by + 1);

      // Gesture label below the wrist
      const g = GESTURE_LABEL[h.gesture];
      if (g && h.gestureScore > 0.5) {
        const text = g[1];
        ctx.font = '600 14px "Segoe UI", sans-serif';
        const tw = ctx.measureText(text).width;
        const w = tw + 52, hh = 34;
        const x = h.x(0) - w / 2, y = h.y(0) + 18;
        ctx.fillStyle = 'rgba(10,10,20,0.75)';
        ctx.strokeStyle = rgbStr(c, 0.8);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(x, y, w, hh, 17);
        ctx.fill();
        ctx.stroke();
        ctx.drawImage(emojiSprite(g[0]), x + 6, y + 3, 28, 28);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(text, x + 40, y + hh / 2 + 1);
      }
    });
    ctx.restore();
  }
}
