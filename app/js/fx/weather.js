import { glowSprite, rand } from './particles.js';

// Weather that reacts to the person: particles test the segmentation mask
// so snow settles on shoulders, rain splashes off heads and blossoms slide
// around the body.

export class Weather {
  constructor(particles, sfx) {
    this.P = particles;
    this.sfx = sfx;
    this.kind = null;
    this.items = [];
    this.flash = 0;
    this.nextBolt = 6;
  }

  set(kind, W, H) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.items = [];
    if (!kind) return;
    const n = { snow: 340, storm: 240, fireflies: 46, petals: 80 }[kind];
    for (let i = 0; i < n; i++) this.items.push(this.spawn(W, H, true));
  }

  spawn(W, H, anywhere) {
    const y = anywhere ? rand(-H * 0.1, H) : rand(-60, -10);
    switch (this.kind) {
      case 'snow': return { x: rand(0, W), y, r: rand(1.2, 4.2), ph: rand(0, 6), stuck: 0, life: 0 };
      case 'storm': return { x: rand(-W * 0.1, W), y, v: rand(900, 1400), len: rand(14, 28) };
      case 'fireflies': return { x: rand(0, W), y: rand(0, H), vx: rand(-30, 30), vy: rand(-30, 30), ph: rand(0, 6) };
      default: return { x: rand(-W * 0.2, W), y, vx: rand(30, 80), vy: rand(50, 110), rot: rand(0, 6), vr: rand(-2, 2), flip: rand(0, 6), s: rand(6, 11) };
    }
  }

  frame(ctx, dt, t, W, H, maskAt) {
    if (!this.kind) return;
    const k = this.kind;
    ctx.save();
    if (k === 'snow') this.snow(ctx, dt, t, W, H, maskAt);
    else if (k === 'storm') this.storm(ctx, dt, t, W, H, maskAt);
    else if (k === 'fireflies') this.fireflies(ctx, dt, t, W, H, maskAt);
    else this.petals(ctx, dt, t, W, H, maskAt);
    ctx.restore();
  }

  snow(ctx, dt, t, W, H, maskAt) {
    const sprite = glowSprite([255, 255, 255], 32);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.items.length; i++) {
      const f = this.items[i];
      if (f.stuck) {
        f.life -= dt;
        if (maskAt(f.x, f.y) < 0.3) f.stuck = 0;
        if (f.life <= 0) { this.items[i] = this.spawn(W, H, false); continue; }
      } else {
        f.y += (25 + f.r * 18) * dt;
        f.x += Math.sin(t * 1.3 + f.ph) * 14 * dt;
        if (maskAt(f.x, f.y + f.r) > 0.55) { f.stuck = 1; f.life = rand(2.5, 6); }
        if (f.y > H - f.r) { f.stuck = 1; f.life = rand(1, 3); f.y = H - f.r; }
      }
      const a = f.stuck ? Math.min(1, f.life / 0.6) : 0.9;
      const s = f.r * 3.2;
      ctx.globalAlpha = a;
      ctx.drawImage(sprite, f.x - s / 2, f.y - s / 2, s, s);
    }
  }

  storm(ctx, dt, t, W, H, maskAt) {
    ctx.fillStyle = 'rgba(10,18,40,0.16)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(190,210,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < this.items.length; i++) {
      const d = this.items[i];
      d.y += d.v * dt;
      d.x += d.v * 0.14 * dt;
      let hit = false;
      if (maskAt(d.x, d.y) > 0.55) hit = true;
      if (d.y > H) hit = true;
      if (hit) {
        if (Math.random() < 0.5) {
          for (let k = 0; k < 2; k++) {
            this.P.spawn({ kind: 'glow', x: d.x, y: Math.min(d.y, H - 2), vx: rand(-90, 90), vy: rand(-220, -80), g: 900, life: 0.35, size: rand(3, 6), rgb: [190, 210, 255], alpha: 0.7, grow: 0.5 });
          }
        }
        this.items[i] = this.spawn(W, H, false);
        continue;
      }
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.14, d.y - d.len);
    }
    ctx.stroke();
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.flash = 1;
      this.nextBolt = rand(7, 15);
      setTimeout(() => this.sfx.boom(), 350);
    }
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(220,230,255,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
      this.flash *= Math.pow(0.004, dt);
    }
  }

  fireflies(ctx, dt, t, W, H, maskAt) {
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.items) {
      f.vx += rand(-60, 60) * dt;
      f.vy += rand(-60, 60) * dt;
      if (maskAt(f.x, f.y) > 0.6) { f.vx += (f.x < W / 2 ? -1 : 1) * 160 * dt; f.vy -= 60 * dt; }
      f.vx *= Math.pow(0.6, dt);
      f.vy *= Math.pow(0.6, dt);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < 0) f.x += W;
      if (f.x > W) f.x -= W;
      if (f.y < 0) f.y += H;
      if (f.y > H) f.y -= H;
      const glow = 0.25 + 0.75 * Math.max(0, Math.sin(t * 2.2 + f.ph));
      const s = 10 + glow * 22;
      ctx.globalAlpha = glow;
      ctx.drawImage(glowSprite([214, 255, 120]), f.x - s / 2, f.y - s / 2, s, s);
    }
  }

  petals(ctx, dt, t, W, H, maskAt) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      p.x += (p.vx + Math.sin(t + p.flip) * 25) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.flip += dt * 2.5;
      if (maskAt(p.x, p.y) > 0.55) {
        p.vx += (Math.random() < 0.5 ? -1 : 1) * 140 * dt * 8;
        p.vy *= 0.6;
      } else {
        p.vx += (55 - p.vx) * dt * 0.5;
        p.vy += (80 - p.vy) * dt * 0.5;
      }
      if (p.y > H + 20 || p.x > W + 40 || p.x < -60) { this.items[i] = this.spawn(W, H, false); continue; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(p.flip)));
      ctx.fillStyle = 'rgba(255,183,213,0.92)';
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,236,244,0.8)';
      ctx.beginPath();
      ctx.ellipse(-p.s * 0.25, -p.s * 0.1, p.s * 0.35, p.s * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
