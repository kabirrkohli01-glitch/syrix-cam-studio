// Shared particle system and pre-rendered sprites for the overlay canvas.
// Sprites are rasterised once and reused, which keeps hundreds of glowing
// particles cheap to draw every frame.

const sprites = new Map();

export function glowSprite(rgb, size = 64) {
  const key = `g${rgb.join(',')}:${size}`;
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const r = size / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    const [R, G, B] = rgb;
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.15, `rgba(${R},${G},${B},1)`);
    grd.addColorStop(0.45, `rgba(${R},${G},${B},0.35)`);
    grd.addColorStop(1, `rgba(${R},${G},${B},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    sprites.set(key, c);
  }
  return c;
}

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

export function emojiSprite(ch, size = 96) {
  const key = `e${ch}:${size}`;
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.font = `${Math.round(size * 0.78)}px ${EMOJI_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, size / 2, size / 2 + size * 0.04);
    sprites.set(key, c);
  }
  return c;
}

const FIRE = [[255, 244, 190], [255, 176, 48], [255, 84, 12], [170, 28, 10]];

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export class Particles {
  constructor(limit = 2600) {
    this.list = [];
    this.limit = limit;
  }

  // kind: glow | fire | confetti | emoji | text | ring
  spawn(p) {
    if (this.list.length >= this.limit) return null;
    const q = {
      kind: 'glow', x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 1, life: 1, size: 10, grow: 1,
      rot: 0, vr: 0, alpha: 1, rgb: [255, 255, 255], ...p,
    };
    q.max = q.life;
    this.list.push(q);
    return q;
  }

  burst(x, y, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(opts.speed[0], opts.speed[1]);
      this.spawn({
        ...opts, x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(opts.life[0], opts.life[1]),
        size: rand(opts.size[0], opts.size[1]),
        rgb: Array.isArray(opts.rgb[0]) ? pick(opts.rgb) : opts.rgb,
        speed: undefined,
      });
    }
  }

  clear() { this.list.length = 0; }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) {
        L[i] = L[L.length - 1];
        L.pop();
        continue;
      }
      if (p.drag !== 1) {
        const k = Math.pow(p.drag, dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  draw(ctx) {
    const L = this.list;
    if (!L.length) return;
    ctx.save();
    for (const p of L) {
      if (p.kind === 'glow' || p.kind === 'fire' || p.kind === 'ring') continue;
      const t = p.life / p.max;
      ctx.globalAlpha = p.alpha * Math.min(1, t * 2.5);
      if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 1.7));
        ctx.fillStyle = `rgb(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]})`;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else if (p.kind === 'emoji') {
        const s = p.size * (1 + (1 - t) * (p.grow - 1));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(emojiSprite(p.ch), -s / 2, -s / 2, s, s);
        ctx.restore();
      } else if (p.kind === 'text') {
        const s = p.size * (1 + (1 - t) * (p.grow - 1));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.font = `900 ${s}px Bahnschrift, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = s * 0.16;
        ctx.strokeStyle = 'rgba(10,10,20,0.9)';
        ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = `rgb(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]})`;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of L) {
      const t = p.life / p.max;
      if (p.kind === 'glow') {
        const s = p.size * (1 + (1 - t) * (p.grow - 1));
        ctx.globalAlpha = p.alpha * Math.min(1, t * 2);
        ctx.drawImage(glowSprite(p.rgb), p.x - s / 2, p.y - s / 2, s, s);
      } else if (p.kind === 'fire') {
        const s = p.size * (1 + (1 - t) * 0.9);
        const stage = t > 0.72 ? 0 : t > 0.48 ? 1 : t > 0.24 ? 2 : 3;
        ctx.globalAlpha = Math.min(1, t * 1.6) * p.alpha;
        ctx.drawImage(glowSprite(FIRE[stage]), p.x - s / 2, p.y - s / 2, s, s);
      } else if (p.kind === 'ring') {
        const r = p.size * (1 + (1 - t) * (p.grow - 1));
        ctx.globalAlpha = p.alpha * t;
        ctx.strokeStyle = `rgb(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]})`;
        ctx.lineWidth = Math.max(1, 6 * t);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
