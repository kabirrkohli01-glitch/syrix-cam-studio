import { FACE_TESSELATION, FACE_CONTOURS } from '../vision.js';
import { glowSprite, rand, pick } from './particles.js';

const SHADES = [
  'XXXXXXXXXXXXXXXXXXXXXXXXXX',
  '.XXWWXXXXXXX..XXWWXXXXXXX.',
  '.XWWXXXXXXXX..XWWXXXXXXXX.',
  '.XXXXXXXXXXX..XXXXXXXXXXX.',
  '..XXXXXXXXX....XXXXXXXXX..',
  '...XXXXXXX......XXXXXXX...',
];

const CONFETTI = [[244, 114, 182], [253, 224, 71], [52, 211, 153], [96, 165, 250], [167, 139, 250], [251, 146, 60]];
const HEARTS = ['❤️', '💖', '💕', '💗'];
const SURPRISE = ['WOW!', 'WHOA!', 'OMG!'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function bounds(f) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < f.n; i++) {
    const x = f.x(i), y = f.y(i);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function easeOutBounce(x) {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

export class FaceFX {
  constructor(particles, sfx) {
    this.P = particles;
    this.sfx = sfx;
    this.reset();
  }

  reset() {
    this.drop = 0;
    this.hadFace = false;
    this.cool = {};
    this.wink = 0;
    this.lasersOn = false;
    this.sfx.loop('fire', 0);
    this.sfx.loop('hum', 0);
  }

  ready(key, now, gap) {
    if (this.cool[key] && now - this.cool[key] < gap) return false;
    this.cool[key] = now;
    return true;
  }

  frame(ctx, dt, faces, id, t) {
    const has = faces.length > 0;
    if (has && !this.hadFace) this.drop = 0;
    this.hadFace = has;
    this.drop += dt;
    if (!has) {
      this.sfx.loop('fire', 0);
      this.sfx.loop('hum', 0);
      return;
    }
    let fire = 0;
    let laser = false;
    faces.forEach((f, i) => {
      switch (id) {
        case 'cyber': this.cyber(ctx, f, t); break;
        case 'neonmask': this.neon(ctx, f, t); break;
        case 'shades': this.shades(ctx, f); break;
        case 'crown': this.crown(ctx, f, t); break;
        case 'lasers': laser = this.lasers(ctx, f, t, i) || laser; break;
        case 'fire': fire = Math.max(fire, this.fire(ctx, f, dt)); break;
        case 'reactions': this.reactions(f, t, i); break;
        case 'catears': this.cat(ctx, f, t); break;
        case 'angel': this.angel(ctx, f, t); break;
        default: break;
      }
    });
    this.sfx.loop('fire', fire);
    this.sfx.loop('hum', laser ? 0.8 : 0);
  }

  // ---------------------------------------------------------------- cyber scan

  cyber(ctx, f, t) {
    const b = bounds(f);
    ctx.save();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(34,211,238,0.3)';
    ctx.beginPath();
    for (const c of FACE_TESSELATION) {
      ctx.moveTo(f.x(c.start), f.y(c.start));
      ctx.lineTo(f.x(c.end), f.y(c.end));
    }
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(103,232,249,0.85)';
    ctx.beginPath();
    for (const c of FACE_CONTOURS) {
      ctx.moveTo(f.x(c.start), f.y(c.start));
      ctx.lineTo(f.x(c.end), f.y(c.end));
    }
    ctx.stroke();

    // Sweeping scan band
    const h = b.y1 - b.y0;
    const sy = b.y0 + h * (0.5 + 0.5 * Math.sin(t * 2.2));
    const grd = ctx.createLinearGradient(0, sy - 26, 0, sy + 4);
    grd.addColorStop(0, 'rgba(34,211,238,0)');
    grd.addColorStop(1, 'rgba(34,211,238,0.35)');
    ctx.fillStyle = grd;
    ctx.fillRect(b.x0 - 10, sy - 26, b.x1 - b.x0 + 20, 30);
    ctx.fillStyle = 'rgba(165,243,252,0.9)';
    ctx.fillRect(b.x0 - 10, sy, b.x1 - b.x0 + 20, 1.5);

    // Corner brackets
    const pad = 16 + 3 * Math.sin(t * 4);
    const x0 = b.x0 - pad, y0 = b.y0 - pad, x1 = b.x1 + pad, y1 = b.y1 + pad;
    const L = Math.min(x1 - x0, y1 - y0) * 0.18;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
    ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
    ctx.moveTo(x1, y1 - L); ctx.lineTo(x1, y1); ctx.lineTo(x1 - L, y1);
    ctx.moveTo(x0 + L, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - L);
    ctx.stroke();

    // Live expression readout
    const rows = [
      ['SMILE', f.smile],
      ['MOUTH', f.jaw],
      ['BROWS', f.brows],
      ['BLINK', Math.max(f.blinkA, f.blinkB)],
      ['PUCKER', f.pucker],
    ];
    const pw = 168, ph = 26 + rows.length * 19;
    let px = x1 + 14;
    if (px + pw > ctx.canvas.clientWidth - 8) px = x0 - 14 - pw;
    const py = y0;
    ctx.fillStyle = 'rgba(4,20,28,0.62)';
    ctx.strokeStyle = 'rgba(103,232,249,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 8);
    ctx.fill();
    ctx.stroke();
    ctx.font = '600 11px "Cascadia Mono", Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = (t * 2) % 1 < 0.6 ? '#34d399' : 'rgba(52,211,153,0.3)';
    ctx.beginPath();
    ctx.arc(px + 14, py + 14, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a5f3fc';
    ctx.fillText('FACE LOCKED', px + 24, py + 14);
    rows.forEach(([label, v], i) => {
      const y = py + 34 + i * 19;
      ctx.fillStyle = 'rgba(165,243,252,0.75)';
      ctx.fillText(label, px + 10, y);
      ctx.fillStyle = 'rgba(103,232,249,0.15)';
      ctx.fillRect(px + 68, y - 4, 64, 8);
      ctx.fillStyle = v > 0.5 ? '#f0abfc' : '#67e8f9';
      ctx.fillRect(px + 68, y - 4, 64 * clamp(v, 0, 1), 8);
      ctx.fillStyle = '#e0f2fe';
      ctx.fillText(String(Math.round(v * 100)).padStart(3, ' '), px + 136, y);
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------- neon mask

  neon(ctx, f, t) {
    const lw = Math.max(2, f.width * 0.012);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass === 0 ? lw * 4 : lw;
      FACE_CONTOURS.forEach((c, i) => {
        const hue = (i * 4 + t * 90) % 360;
        ctx.strokeStyle = pass === 0 ? `hsla(${hue},100%,60%,0.22)` : `hsl(${hue},100%,72%)`;
        ctx.beginPath();
        ctx.moveTo(f.x(c.start), f.y(c.start));
        ctx.lineTo(f.x(c.end), f.y(c.end));
        ctx.stroke();
      });
    }
    const s = f.eyeDist * 0.5;
    for (const e of [f.irisL, f.irisR]) {
      ctx.drawImage(glowSprite([255, 80, 220]), e[0] - s / 2, e[1] - s / 2, s, s);
    }
    ctx.restore();
    if (Math.random() < 0.25) {
      const c = pick(FACE_CONTOURS);
      this.P.spawn({ kind: 'glow', x: f.x(c.start), y: f.y(c.start), vy: -30, life: 0.6, size: rand(8, 16), rgb: pick([[255, 80, 220], [80, 220, 255]]), grow: 0.2 });
    }
  }

  // ---------------------------------------------------------------- shades

  shades(ctx, f) {
    const w = f.eyeDist * 2.35;
    const px = w / SHADES[0].length;
    const k = Math.min(1, this.drop / 0.9);
    const dropY = -(1 - easeOutBounce(k)) * (f.eyeMid[1] + w);
    ctx.save();
    ctx.translate(f.eyeMid[0], f.eyeMid[1] + f.eyeDist * 0.1 + dropY);
    ctx.rotate(f.roll);
    ctx.translate(-w / 2, -px * 2.4);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let r = 0; r < SHADES.length; r++) {
      const row = SHADES[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== '.') ctx.fillRect(c * px + px * 0.35, r * px + px * 0.45, px + 0.6, px + 0.6);
      }
    }
    for (let r = 0; r < SHADES.length; r++) {
      const row = SHADES[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        ctx.fillStyle = ch === 'W' ? '#ffffff' : '#0a0a0a';
        ctx.fillRect(c * px, r * px, px + 0.6, px + 0.6);
      }
    }
    ctx.restore();
    if (k >= 1 && Math.random() < 0.02) {
      this.P.spawn({ kind: 'glow', x: f.eyeL[0] - f.eyeDist * 0.15, y: f.eyeL[1] - f.eyeDist * 0.05, life: 0.5, size: f.eyeDist * 0.5, grow: 0.1, rgb: [255, 255, 255] });
    }
  }

  // ---------------------------------------------------------------- crown

  crown(ctx, f, t) {
    const w = f.width * 0.95;
    const h = w * 0.55;
    const hb = h * 0.24;
    ctx.save();
    ctx.translate(f.forehead[0], f.forehead[1]);
    ctx.rotate(f.roll);
    ctx.translate(0, -f.height * 0.16);

    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(-w / 2, -h);
    ctx.lineTo(-w / 4, -h * 0.52);
    ctx.lineTo(0, -h * 1.12);
    ctx.lineTo(w / 4, -h * 0.52);
    ctx.lineTo(w / 2, -h);
    ctx.lineTo(w / 2, 0);
    ctx.closePath();
    const grd = ctx.createLinearGradient(0, -h * 1.12, 0, 0);
    grd.addColorStop(0, '#fff6c2');
    grd.addColorStop(0.45, '#f7c22b');
    grd.addColorStop(1, '#b26b00');
    ctx.fillStyle = grd;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1.5, w * 0.012);
    ctx.strokeStyle = '#7a4a00';
    ctx.stroke();

    // Moving highlight
    ctx.save();
    ctx.clip();
    const sx = ((t * 0.6) % 1.6 - 0.3) * w - w / 2;
    const sh = ctx.createLinearGradient(sx - w * 0.15, 0, sx + w * 0.15, 0);
    sh.addColorStop(0, 'rgba(255,255,255,0)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    sh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(-w / 2, -h * 1.2, w, h * 1.3);
    ctx.restore();

    ctx.fillStyle = 'rgba(122,74,0,0.35)';
    ctx.fillRect(-w / 2, -hb, w, hb);
    const jewels = [[-w / 3, '#ef4444'], [0, '#3b82f6'], [w / 3, '#22c55e']];
    for (const [jx, col] of jewels) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(jx, -hb / 2, hb * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(jx - hb * 0.1, -hb * 0.6, hb * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff1a8';
    for (const [bx, by] of [[-w / 2, -h], [0, -h * 1.12], [w / 2, -h]]) {
      ctx.beginPath();
      ctx.arc(bx, by, w * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (Math.random() < 0.18) {
      const a = f.roll - Math.PI / 2;
      const r = f.height * 0.16 + rand(0, h);
      const lx = rand(-w / 2, w / 2);
      const x = f.forehead[0] + Math.cos(a) * r - Math.sin(a) * lx;
      const y = f.forehead[1] + Math.sin(a) * r + Math.cos(a) * lx;
      this.P.spawn({ kind: 'glow', x, y, vy: -20, life: 0.7, size: rand(10, 20), grow: 0.1, rgb: [255, 236, 150] });
    }
  }

  // ---------------------------------------------------------------- laser eyes

  lasers(ctx, f, t, idx) {
    const on = f.brows > (this.lasersOn ? 0.28 : 0.38);
    if (on && !this.lasersOn && idx === 0) this.sfx.laserStart();
    if (idx === 0) this.lasersOn = on;
    const s = f.eyeDist;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of [f.irisL, f.irisR]) {
      const g = s * (on ? 1.5 : 0.9) * (1 + 0.08 * Math.sin(t * 20));
      ctx.drawImage(glowSprite([255, 30, 30], 128), e[0] - g / 2, e[1] - g / 2, g, g);
      ctx.strokeStyle = 'rgba(255,200,200,0.8)';
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 2; k++) {
        const a = t * 1.5 + (k * Math.PI) / 2;
        const L = g * 0.7;
        ctx.beginPath();
        ctx.moveTo(e[0] - Math.cos(a) * L, e[1] - Math.sin(a) * L);
        ctx.lineTo(e[0] + Math.cos(a) * L, e[1] + Math.sin(a) * L);
        ctx.stroke();
      }
    }
    if (on) {
      ctx.lineCap = 'round';
      for (const e of [f.irisL, f.irisR]) {
        let ox = e[0] - f.eyeMid[0];
        let oy = e[1] - f.eyeMid[1];
        const ol = Math.hypot(ox, oy) || 1;
        let dx = (ox / ol) * 0.55 + f.turnX * 3.2;
        let dy = (oy / ol) * 0.55 + f.turnY * 3.2 + 0.12;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl;
        dy /= dl;
        const ex = e[0] + dx * 4000, ey = e[1] + dy * 4000;
        const flick = 1 + 0.15 * Math.sin(t * 40 + e[0]);
        for (const [lw, col] of [[s * 0.42, 'rgba(255,20,20,0.16)'], [s * 0.18, 'rgba(255,60,30,0.55)'], [s * 0.06, 'rgba(255,255,255,0.95)']]) {
          ctx.lineWidth = lw * flick;
          ctx.strokeStyle = col;
          ctx.beginPath();
          ctx.moveTo(e[0], e[1]);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
        if (Math.random() < 0.6) {
          const k = rand(0.05, 0.5);
          this.P.spawn({ kind: 'glow', x: e[0] + dx * 1500 * k, y: e[1] + dy * 1500 * k, vx: rand(-80, 80), vy: rand(-80, 80), life: 0.35, size: rand(8, 18), rgb: [255, 90, 40], grow: 0.2 });
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255,0,0,0.05)';
      ctx.fillRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);
    }
    ctx.restore();
    return on;
  }

  // ---------------------------------------------------------------- dragon breath

  fire(ctx, f, dt) {
    const k = clamp((f.jaw - 0.25) / 0.4, 0, 1);
    if (k <= 0) return 0;
    const scale = f.width / 220;
    let dx = f.mouth[0] - f.bridge[0] + f.turnX * f.width * 1.5;
    let dy = f.mouth[1] - f.bridge[1];
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const n = Math.min(14, Math.round(k * 420 * dt + Math.random()));
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dy, dx) + rand(-0.38, 0.38);
      const sp = rand(260, 560) * scale * (0.6 + k * 0.6);
      this.P.spawn({
        kind: 'fire', x: f.mouth[0] + rand(-4, 4), y: f.mouth[1],
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: -260 * scale, drag: 0.3,
        life: rand(0.45, 0.85), size: rand(26, 50) * scale,
      });
    }
    const g = f.mouthOpen * 2.4;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.8 * k;
    ctx.drawImage(glowSprite([255, 160, 40], 128), f.mouth[0] - g, f.mouth[1] - g, g * 2, g * 2);
    ctx.restore();
    return k;
  }

  // ---------------------------------------------------------------- cat

  cat(ctx, f, t) {
    const w = f.width;
    const twitch = Math.sin(t * 9) > 0.96 ? 0.12 : 0;
    ctx.save();
    ctx.translate(f.forehead[0], f.forehead[1]);
    ctx.rotate(f.roll);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * w * 0.33, -f.height * 0.12);
      ctx.rotate(side * (0.32 + (side > 0 ? twitch : 0)));
      const ew = w * 0.3, eh = w * 0.42;
      ctx.beginPath();
      ctx.moveTo(-ew / 2, 0);
      ctx.quadraticCurveTo(-ew * 0.35, -eh * 0.7, 0, -eh);
      ctx.quadraticCurveTo(ew * 0.35, -eh * 0.7, ew / 2, 0);
      ctx.closePath();
      ctx.fillStyle = '#57534e';
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, w * 0.012);
      ctx.strokeStyle = '#292524';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-ew * 0.28, -eh * 0.08);
      ctx.quadraticCurveTo(0, -eh * 0.85, ew * 0.28, -eh * 0.08);
      ctx.closePath();
      ctx.fillStyle = '#f9a8d4';
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(f.nose[0], f.nose[1]);
    ctx.rotate(f.roll);
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.moveTo(-w * 0.045, -w * 0.02);
    ctx.lineTo(w * 0.045, -w * 0.02);
    ctx.lineTo(0, w * 0.035);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,27,24,0.85)';
    ctx.lineWidth = Math.max(1, w * 0.007);
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(side * w * 0.09, w * 0.04 + k * w * 0.02);
        ctx.quadraticCurveTo(side * w * 0.25, w * 0.02 + k * w * 0.045, side * w * 0.42, w * 0.01 + k * w * 0.08);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- angel / devil

  angel(ctx, f, t) {
    // A smile always wins, so mouth-shape noise never flips a happy face.
    const devil = f.smile < 0.3 && (f.browDown > 0.4 || f.frown > 0.4);
    const w = f.width;
    ctx.save();
    ctx.translate(f.forehead[0], f.forehead[1]);
    ctx.rotate(f.roll);
    if (!devil) {
      const y = -f.height * 0.42 + Math.sin(t * 2) * w * 0.02;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowSprite([255, 214, 120], 128), -w * 0.6, y - w * 0.3, w * 1.2, w * 0.6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = Math.max(3, w * 0.045);
      ctx.strokeStyle = '#fde68a';
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.ellipse(0, y, w * 0.38, w * 0.1, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (f.smile > 0.4 && Math.random() < 0.3) {
        this.P.spawn({ kind: 'glow', x: f.forehead[0] + rand(-w * 0.4, w * 0.4), y: f.forehead[1] - f.height * 0.42, vy: rand(-60, -20), life: 0.8, size: rand(8, 16), rgb: [255, 236, 170], grow: 0.2 });
      }
    } else {
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * w * 0.28, -f.height * 0.14);
        ctx.scale(side, 1);
        const hw = w * 0.13, hh = w * 0.36;
        const grd = ctx.createLinearGradient(0, 0, 0, -hh);
        grd.addColorStop(0, '#7f1d1d');
        grd.addColorStop(1, '#ef4444');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(-hw, 0);
        ctx.quadraticCurveTo(-hw * 0.2, -hh * 0.6, hw * 0.9, -hh);
        ctx.quadraticCurveTo(hw * 0.2, -hh * 0.45, hw, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      if (Math.random() < 0.4) {
        this.P.spawn({ kind: 'fire', x: f.forehead[0] + rand(-w * 0.35, w * 0.35), y: f.forehead[1] - f.height * 0.2, vx: rand(-20, 20), vy: rand(-90, -40), life: 0.5, size: rand(14, 26) });
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- reactions

  reactions(f, t, i) {
    const now = t;
    const scale = f.width / 220;
    if (f.smile > 0.55 && this.ready(`smile${i}`, now, 0.12)) {
      for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          this.P.spawn({
            kind: 'confetti', x: f.mouth[0] + side * f.width * 0.35, y: f.mouth[1],
            vx: side * rand(120, 380), vy: rand(-760, -420), g: 1100, drag: 0.55,
            life: rand(1.4, 2.2), size: rand(9, 15) * Math.max(0.8, scale), vr: rand(-12, 12), rot: rand(0, 6), rgb: pick(CONFETTI),
          });
        }
      }
    }
    if (f.pucker > 0.7 && f.jaw < 0.25 && this.ready(`kiss${i}`, now, 0.22)) {
      this.P.spawn({
        kind: 'emoji', ch: pick(HEARTS), x: f.mouth[0] + rand(-6, 6), y: f.mouth[1],
        vx: rand(-60, 60), vy: rand(-220, -140), g: -40, drag: 0.7, life: 1.8,
        size: rand(34, 52) * Math.max(0.8, scale), grow: 1.4, rot: rand(-0.3, 0.3), vr: rand(-1, 1),
      });
    }
    const winkA = f.blinkA > 0.55 && f.blinkB < 0.3;
    const winkB = f.blinkB > 0.55 && f.blinkA < 0.3;
    if ((winkA || winkB) && this.ready(`wink${i}`, now, 0.8)) {
      const e = winkA ? f.eyeL : f.eyeR;
      this.P.burst(e[0], e[1], 18, { kind: 'glow', speed: [80, 260], life: [0.4, 0.8], size: [10, 22], rgb: [[255, 236, 150], [255, 255, 255]], drag: 0.2, grow: 0.2 });
      this.P.spawn({ kind: 'emoji', ch: '✨', x: e[0], y: e[1] - f.eyeDist * 0.3, vy: -60, life: 0.9, size: f.eyeDist * 0.9, grow: 1.5 });
      this.sfx.sparkle();
    }
    if (f.jaw > 0.5 && f.brows > 0.45 && this.ready(`wow${i}`, now, 1.6)) {
      const x = f.center[0] + rand(-0.3, 0.3) * f.width;
      const y = f.forehead[1] - f.height * 0.45;
      this.P.spawn({ kind: 'text', text: pick(SURPRISE), x, y, vy: -30, life: 1.2, size: 64 * Math.max(0.8, scale), grow: 1.25, rot: rand(-0.25, 0.25), rgb: [253, 224, 71] });
      this.P.spawn({ kind: 'ring', x, y, life: 0.6, size: 40 * scale, grow: 4, rgb: [253, 224, 71] });
      this.sfx.coin();
    }
  }
}
