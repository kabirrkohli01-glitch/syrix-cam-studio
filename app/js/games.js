import { TIPS, Smooth, dist } from './tracking.js';
import { glowSprite, emojiSprite, rand, pick } from './fx/particles.js';

// Camera games. Scores live in memory for the session only.

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};

// ------------------------------------------------------------------ bubbles

class BubblePop {
  static info = {
    title: 'Bubble Pop',
    sub: 'Pop as many bubbles as you can in 45 seconds.',
    rules: [
      'Touch bubbles with any fingertip to pop them',
      'Gold bubbles are worth 5 points',
      'Red mines cost you 5 points, so steer clear',
      'Pop quickly in a row to build a ×2 and ×3 combo',
    ],
    duration: 45,
    lives: 0,
  };

  constructor(env) {
    this.env = env;
    this.bubbles = [];
    this.spawnT = 0;
    this.score = 0;
    this.combo = 0;
    this.lastPop = -9;
    this.time = 0;
  }

  spawn(W, H) {
    const s = H / 800;
    const roll = Math.random();
    const type = roll < 0.08 ? 'gold' : roll < 0.15 ? 'mine' : 'plain';
    const r = (type === 'plain' ? rand(30, 62) : rand(34, 46)) * s;
    this.bubbles.push({
      type, r, baseX: rand(r + 20, W - r - 20), x: 0, y: H + r,
      vy: -rand(95, 170) * s * (1 + this.time / 50),
      amp: rand(10, 40) * s, wf: rand(1, 2.4), ph: rand(0, 6),
      hue: rand(170, 320),
    });
  }

  update(dt, inp) {
    const { W, H, t } = inp;
    this.time += dt;
    this.spawnT -= dt;
    const interval = Math.max(0.22, 0.6 - this.time * 0.008);
    while (this.spawnT <= 0) { this.spawn(W, H); this.spawnT += interval; }

    const pts = inp.points;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.y += b.vy * dt;
      b.x = b.baseX + Math.sin(t * b.wf + b.ph) * b.amp;
      if (b.y < -b.r) { this.bubbles.splice(i, 1); continue; }
      for (const p of pts) {
        if (dist(p[0], p[1], b.x, b.y) < b.r + 8) {
          this.pop(b, t);
          this.bubbles.splice(i, 1);
          break;
        }
      }
    }
  }

  pop(b, t) {
    const { P, sfx, fx } = this.env;
    if (b.type === 'mine') {
      this.score = Math.max(0, this.score - 5);
      this.combo = 0;
      P.burst(b.x, b.y, 30, { kind: 'glow', speed: [100, 380], life: [0.3, 0.7], size: [10, 24], rgb: [[255, 60, 60], [255, 160, 60]], drag: 0.2, grow: 0.2 });
      fx.flash([255, 40, 40]);
      fx.shake(12);
      fx.float(b.x, b.y, '−5', [255, 120, 120]);
      sfx.hit();
      return;
    }
    this.combo = t - this.lastPop < 0.9 ? this.combo + 1 : 1;
    this.lastPop = t;
    const mult = this.combo >= 10 ? 3 : this.combo >= 5 ? 2 : 1;
    const pts = (b.type === 'gold' ? 5 : 1) * mult;
    this.score += pts;
    const rgb = b.type === 'gold' ? [255, 215, 80] : hueRgb(b.hue);
    P.spawn({ kind: 'ring', x: b.x, y: b.y, life: 0.35, size: b.r, grow: 1.8, rgb: [255, 255, 255] });
    P.burst(b.x, b.y, 14, { kind: 'glow', speed: [80, 260], life: [0.3, 0.6], size: [6, 14], rgb, drag: 0.2, g: 300, grow: 0.3 });
    fx.float(b.x, b.y, mult > 1 ? `+${pts} ×${mult}` : `+${pts}`, b.type === 'gold' ? [253, 224, 71] : [255, 255, 255]);
    if (b.type === 'gold') sfx.coin(); else sfx.pop();
  }

  draw(ctx) {
    for (const b of this.bubbles) {
      const { x, y, r } = b;
      ctx.save();
      if (b.type === 'mine') {
        ctx.fillStyle = '#3b0a0a';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const rr = k % 2 ? r * 0.78 : r * 1.05;
          ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.25, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const gold = b.type === 'gold';
        const c = gold ? [255, 210, 70] : hueRgb(b.hue);
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
        g.addColorStop(0, `rgba(255,255,255,${gold ? 0.55 : 0.25})`);
        g.addColorStop(0.6, `rgba(${c[0]},${c[1]},${c[2]},${gold ? 0.45 : 0.14})`);
        g.addColorStop(0.92, `rgba(${c[0]},${c[1]},${c[2]},${gold ? 0.9 : 0.55})`);
        g.addColorStop(1, `rgba(255,255,255,0.8)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.12, -0.7, 0, Math.PI * 2);
        ctx.fill();
        if (gold) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(glowSprite([255, 200, 60]), x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
        }
      }
      ctx.restore();
    }
  }
}

function hueRgb(h) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return 0.6 - 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// ------------------------------------------------------------------ fruit slice

const FRUIT = [
  ['🍉', [255, 70, 90]], ['🍊', [255, 160, 40]], ['🍎', [230, 40, 40]], ['🍍', [255, 220, 60]],
  ['🍋', [250, 240, 80]], ['🥝', [140, 200, 60]], ['🍇', [150, 60, 200]], ['🍑', [255, 150, 110]],
  ['🍓', [240, 40, 70]], ['🥥', [240, 240, 230]],
];

class FruitSlice {
  static info = {
    title: 'Fruit Slice',
    sub: 'Slice the fruit and dodge the bombs before time runs out.',
    rules: [
      'Swipe fast with your index finger to slice',
      'Slice several fruit in one swipe for a combo bonus',
      'Hitting a bomb costs one of your three lives',
      'The mouse works as a blade too',
    ],
    duration: 60,
    lives: 3,
  };

  constructor(env) {
    this.env = env;
    this.objs = [];
    this.halves = [];
    this.blades = new Map();
    this.waveT = 0.6;
    this.score = 0;
    this.lives = 3;
    this.time = 0;
    this.comboT = 0;
    this.comboN = 0;
    this.comboAt = [0, 0];
  }

  wave(W, H) {
    const n = 1 + Math.floor(Math.random() * Math.min(4, 1 + this.time / 14));
    const g = H * 1.15;
    let bombs = 0;
    for (let i = 0; i < n; i++) {
      const x = rand(0.15, 0.85) * W;
      const vy = -Math.sqrt(2 * g * rand(0.5, 0.82) * H);
      const bomb = bombs === 0 && Math.random() < Math.min(0.28, 0.1 + this.time * 0.003);
      if (bomb) bombs++;
      const f = pick(FRUIT);
      this.objs.push({
        x, y: H + 50, vx: ((W * 0.5 - x) * rand(0.25, 0.65)) / 1.4, vy,
        r: (H / 800) * rand(40, 52), rot: rand(0, 6), vr: rand(-3, 3),
        ch: bomb ? '💣' : f[0], juice: f[1], bomb,
      });
    }
  }

  update(dt, inp) {
    const { W, H, t } = inp;
    const { P, sfx, fx } = this.env;
    this.time += dt;
    const g = H * 1.15;
    this.waveT -= dt;
    if (this.waveT <= 0) {
      this.wave(W, H);
      this.waveT = rand(0.9, 1.6) * Math.max(0.6, 1 - this.time / 120);
    }

    // Blade trails
    const live = new Set();
    for (const b of inp.blades) {
      live.add(b.key);
      let tr = this.blades.get(b.key);
      if (!tr) { tr = []; this.blades.set(b.key, tr); }
      tr.push({ x: b.x, y: b.y, t });
    }
    for (const [k, tr] of this.blades) {
      while (tr.length && t - tr[0].t > 0.18) tr.shift();
      if (!live.has(k) && !tr.length) this.blades.delete(k);
    }

    for (const o of this.objs) {
      o.vy += g * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.rot += o.vr * dt;
      if (o.bomb && Math.random() < 0.5) {
        P.spawn({ kind: 'glow', x: o.x + o.r * 0.45, y: o.y - o.r * 0.6, vx: rand(-60, 60), vy: rand(-90, -20), life: 0.3, size: rand(6, 12), rgb: [255, 200, 80], grow: 0.2 });
      }
    }

    const minSpeed = 900 * (H / 800);
    for (const tr of this.blades.values()) {
      if (tr.length < 2) continue;
      const a = tr[tr.length - 2], b = tr[tr.length - 1];
      const sp = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(b.t - a.t, 1 / 240);
      if (sp < minSpeed) continue;
      for (let i = this.objs.length - 1; i >= 0; i--) {
        const o = this.objs[i];
        if (segDist(o.x, o.y, a.x, a.y, b.x, b.y) < o.r) {
          this.objs.splice(i, 1);
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          if (o.bomb) {
            this.lives--;
            P.burst(o.x, o.y, 60, { kind: 'fire', speed: [150, 600], life: [0.4, 0.9], size: [30, 60], drag: 0.2 });
            P.spawn({ kind: 'ring', x: o.x, y: o.y, life: 0.5, size: 30, grow: 8, rgb: [255, 200, 120] });
            fx.flash([255, 255, 255]);
            fx.shake(22);
            sfx.boom();
          } else {
            this.score++;
            this.comboN = t - this.comboT < 0.3 ? this.comboN + 1 : 1;
            this.comboT = t;
            this.comboAt = [o.x, o.y];
            if (this.comboN >= 3) {
              this.score += 1;
              fx.float(o.x, o.y - 40, `Combo ×${this.comboN}`, [253, 224, 71]);
            }
            for (const side of [-1, 1]) {
              this.halves.push({
                x: o.x, y: o.y, vx: o.vx * 0.4 + Math.cos(ang + Math.PI / 2) * side * 160,
                vy: o.vy * 0.3 + Math.sin(ang + Math.PI / 2) * side * 160 - 120,
                rot: o.rot, vr: o.vr + side * 4, cut: ang - Math.PI / 2, side, r: o.r, ch: o.ch, life: 1.6,
              });
            }
            P.burst(o.x, o.y, 22, { kind: 'glow', speed: [100, 420], life: [0.3, 0.7], size: [8, 18], rgb: o.juice, g: 900, drag: 0.4, grow: 0.4 });
            sfx.slice();
            sfx.splat();
          }
        }
      }
    }

    for (let i = this.objs.length - 1; i >= 0; i--) if (this.objs[i].y > H + 120 && this.objs[i].vy > 0) this.objs.splice(i, 1);
    for (let i = this.halves.length - 1; i >= 0; i--) {
      const h = this.halves[i];
      h.vy += g * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.rot += h.vr * dt;
      h.cut += h.vr * dt;
      h.life -= dt;
      if (h.life <= 0 || h.y > H + 120) this.halves.splice(i, 1);
    }
  }

  get over() { return this.lives <= 0; }

  draw(ctx) {
    for (const h of this.halves) {
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(h.cut);
      ctx.beginPath();
      ctx.rect(h.side < 0 ? -h.r * 1.2 : 0, -h.r * 1.2, h.r * 1.2, h.r * 2.4);
      ctx.clip();
      ctx.rotate(h.rot - h.cut);
      ctx.drawImage(emojiSprite(h.ch), -h.r * 1.2, -h.r * 1.2, h.r * 2.4, h.r * 2.4);
      ctx.restore();
    }
    for (const o of this.objs) {
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(o.rot);
      if (o.bomb) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(glowSprite([255, 60, 40], 128), -o.r * 1.6, -o.r * 1.6, o.r * 3.2, o.r * 3.2);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(emojiSprite(o.ch), -o.r * 1.2, -o.r * 1.2, o.r * 2.4, o.r * 2.4);
      ctx.restore();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const tr of this.blades.values()) {
      for (let i = 1; i < tr.length; i++) {
        const a = i / tr.length;
        ctx.strokeStyle = `rgba(160,230,255,${a * 0.9})`;
        ctx.lineWidth = 2 + a * 12;
        ctx.beginPath();
        ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
        ctx.lineTo(tr[i].x, tr[i].y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------------ meteor dodge

class MeteorDodge {
  static info = {
    title: 'Meteor Dodge',
    sub: 'Your head is the shield. Lean and duck to survive the meteor shower.',
    rules: [
      'Move your head to dodge the meteors',
      'Grab stars for 3 bonus points',
      'Every second you survive scores a point',
      'Three hits and the shield is gone',
    ],
    duration: 0,
    lives: 3,
  };

  constructor(env) {
    this.env = env;
    this.meteors = [];
    this.stars = [];
    this.time = 0;
    this.lives = 3;
    this.bonus = 0;
    this.spawnT = 1;
    this.starT = 2;
    this.inv = 0;
    this.smooth = new Smooth(0.5, 0.95, 20);
    this.player = null;
    this.paused = false;
  }

  get score() { return Math.floor(this.time) + this.bonus; }
  get over() { return this.lives <= 0; }

  update(dt, inp) {
    const { W, H, face } = inp;
    const { P, sfx, fx } = this.env;
    if (!face) {
      this.paused = true;
      return;
    }
    this.paused = false;
    const [x, y, r] = this.smooth.push([face.center[0], face.center[1], face.width * 0.58]);
    this.player = { x, y, r };
    this.time += dt;
    this.inv = Math.max(0, this.inv - dt);
    const s = H / 800;

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(0.22, 0.95 - this.time * 0.014) * rand(0.7, 1.3);
      const mr = rand(22, 48) * s;
      const pts = [];
      for (let k = 0; k < 9; k++) pts.push(rand(0.72, 1.05));
      this.meteors.push({ x: rand(mr, W - mr), y: -mr * 2, vx: rand(-60, 60) * s, vy: rand(240, 400) * s * (1 + this.time / 45), r: mr, rot: 0, vr: rand(-2, 2), pts });
    }
    this.starT -= dt;
    if (this.starT <= 0) {
      this.starT = rand(1.8, 3.2);
      this.stars.push({ x: rand(60, W - 60), y: -40, vy: rand(160, 240) * s, r: 30 * s, rot: 0 });
    }

    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.rot += m.vr * dt;
      if (Math.random() < 0.8) {
        P.spawn({ kind: 'fire', x: m.x + rand(-m.r, m.r) * 0.4, y: m.y - m.r * 0.6, vx: rand(-20, 20), vy: -m.vy * 0.25, life: rand(0.25, 0.45), size: m.r * rand(0.9, 1.4) });
      }
      if (m.y > H + m.r * 2) { this.meteors.splice(i, 1); continue; }
      if (this.inv <= 0 && dist(m.x, m.y, x, y) < r * 0.85 + m.r * 0.8) {
        this.meteors.splice(i, 1);
        this.lives--;
        this.inv = 1.4;
        P.burst(m.x, m.y, 40, { kind: 'fire', speed: [120, 500], life: [0.3, 0.8], size: [24, 50], drag: 0.2 });
        fx.flash([255, 60, 40]);
        fx.shake(18);
        sfx.hit();
        sfx.boom();
      }
    }
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const st = this.stars[i];
      st.y += st.vy * dt;
      st.rot += dt * 2;
      if (st.y > H + 60) { this.stars.splice(i, 1); continue; }
      if (dist(st.x, st.y, x, y) < r + st.r) {
        this.stars.splice(i, 1);
        this.bonus += 3;
        P.burst(st.x, st.y, 20, { kind: 'glow', speed: [80, 300], life: [0.3, 0.7], size: [8, 18], rgb: [255, 230, 120], drag: 0.2, grow: 0.2 });
        fx.float(st.x, st.y, '+3', [253, 224, 71]);
        sfx.coin();
      }
    }
  }

  draw(ctx, t) {
    for (const st of this.stars) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowSprite([255, 220, 100]), st.x - st.r * 1.8, st.y - st.r * 1.8, st.r * 3.6, st.r * 3.6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.translate(st.x, st.y);
      ctx.rotate(Math.sin(st.rot) * 0.4);
      ctx.drawImage(emojiSprite('⭐'), -st.r, -st.r, st.r * 2, st.r * 2);
      ctx.restore();
    }
    for (const m of this.meteors) {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.rot);
      ctx.beginPath();
      m.pts.forEach((k, i) => {
        const a = (i / m.pts.length) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * m.r * k, Math.sin(a) * m.r * k);
      });
      ctx.closePath();
      const g = ctx.createRadialGradient(-m.r * 0.3, -m.r * 0.3, m.r * 0.1, 0, 0, m.r);
      g.addColorStop(0, '#a8a29e');
      g.addColorStop(0.6, '#57534e');
      g.addColorStop(1, '#1c1917');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(251,146,60,0.8)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(28,25,23,0.6)';
      ctx.beginPath();
      ctx.arc(m.r * 0.25, m.r * 0.1, m.r * 0.18, 0, Math.PI * 2);
      ctx.arc(-m.r * 0.3, m.r * 0.35, m.r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const p = this.player;
    if (p && !(this.inv > 0 && Math.floor(t * 12) % 2)) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 1 + 0.04 * Math.sin(t * 6);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(34,211,238,0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(34,211,238,0.18)';
      ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const a = t * 1.5 + (k * Math.PI) / 3;
        ctx.drawImage(glowSprite([120, 230, 255]), p.x + Math.cos(a) * p.r * pulse - 9, p.y + Math.sin(a) * p.r * pulse - 9, 18, 18);
      }
      ctx.restore();
    }
  }
}

// ------------------------------------------------------------------ rock paper scissors

const RPS = { rock: '✊', paper: '✋', scissors: '✌️' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const COUNTER = { rock: 'paper', paper: 'scissors', scissors: 'rock' };

class RockPaperScissors {
  static info = {
    title: 'Rock Paper Scissors',
    sub: 'First to three wins. Syrix learns your habits as you play.',
    rules: [
      'Pump your fist with the beat, then show your move on Shoot',
      '✊ beats ✌️, ✌️ beats ✋, ✋ beats ✊',
      'Hold your hand up clearly so the camera can see it',
    ],
    duration: 0,
    lives: 0,
    ownCountdown: true,
  };

  constructor(env) {
    this.env = env;
    this.score = 0;
    this.cpu = 0;
    this.phase = 'count';
    this.t = 0;
    this.history = [];
    this.trans = {};
    this.votes = {};
    this.streak = 0;
    this.streakMove = null;
    this.lastBeat = -1;
  }

  get over() { return (this.score >= 3 || this.cpu >= 3) && this.phase === 'show' && this.t > 1.6; }

  moveOf(h) {
    if (h.gestureScore > 0.5) {
      if (h.gesture === 'Closed_Fist') return 'rock';
      if (h.gesture === 'Open_Palm') return 'paper';
      if (h.gesture === 'Victory') return 'scissors';
    }
    if (h.fist || h.count === 0) return 'rock';
    if (h.open || h.count >= 4) return 'paper';
    if (h.ext[1] && h.ext[2] && !h.ext[3] && !h.ext[4]) return 'scissors';
    return null;
  }

  // Predicts the player's next move from what they tended to play after
  // their previous move, then counters it; a little randomness keeps it fair.
  cpuPick() {
    const moves = ['rock', 'paper', 'scissors'];
    const last = this.history[this.history.length - 1];
    if (last && this.trans[last] && Math.random() > 0.3) {
      const counts = this.trans[last];
      let guess = null, best = -1;
      for (const m of moves) if ((counts[m] || 0) > best) { best = counts[m] || 0; guess = m; }
      if (best > 0) return COUNTER[guess];
    }
    return pick(moves);
  }

  // Rock, paper, scissors on a steady beat, then "Shoot!". The throw is read
  // from the closest hand during the shoot window and accepted once the same
  // shape has held for a few frames, so a hand still moving into position is
  // not read as the wrong move.
  update(dt, inp) {
    const { sfx, fx, P } = this.env;
    this.t += dt;
    if (this.phase === 'count') {
      const beat = Math.floor(this.t / BEAT);
      if (beat !== this.lastBeat && beat <= 3) { this.lastBeat = beat; sfx.beep(beat === 3); }
      if (this.t >= BEAT * 3) {
        let hand = null;
        for (const h of inp.hands) if (h.age >= 2 && (!hand || h.size > hand.size)) hand = h;
        const m = hand ? this.moveOf(hand) : null;
        if (m && m === this.streakMove) this.streak++;
        else { this.streakMove = m; this.streak = m ? 1 : 0; }
        if (m) this.votes[m] = (this.votes[m] || 0) + 1;
      }
      const decided = this.streak >= 4 && this.t >= BEAT * 3 + 0.12;
      if (decided || this.t >= BEAT * 3 + 0.85) {
        let you = decided ? this.streakMove : null;
        if (!you) { let best = 0; for (const [m, n] of Object.entries(this.votes)) if (n > best) { best = n; you = m; } }
        this.votes = {};
        this.streak = 0;
        this.streakMove = null;
        if (!you) { this.phase = 'miss'; this.t = 0; sfx.hit(); return; }
        const cpu = this.cpuPick();
        const prev = this.history[this.history.length - 1];
        if (prev) { this.trans[prev] = this.trans[prev] || {}; this.trans[prev][you] = (this.trans[prev][you] || 0) + 1; }
        this.history.push(you);
        this.round = { you, cpu, result: you === cpu ? 'draw' : BEATS[you] === cpu ? 'win' : 'lose' };
        if (this.round.result === 'win') { this.score++; sfx.coin(); P.burst(inp.W * 0.32, inp.H * 0.46, 34, { kind: 'glow', speed: [100, 420], life: [0.4, 0.9], size: [8, 18], rgb: [[255, 255, 255], [160, 220, 255]], drag: 0.2, grow: 0.2 }); }
        else if (this.round.result === 'lose') { this.cpu++; sfx.hit(); fx.shake(8); }
        else sfx.beep(true);
        this.phase = 'show';
        this.t = 0;
      }
    } else if (this.phase === 'show' || this.phase === 'miss') {
      if (this.t > (this.phase === 'miss' ? 1.4 : 2.0) && !(this.score >= 3 || this.cpu >= 3)) {
        this.phase = 'count';
        this.t = 0;
        this.lastBeat = -1;
      }
    }
  }

  draw(ctx, t, W, H) {
    const font = (w, px) => `${w} ${px}px "Segoe UI Variable Display", "Segoe UI", sans-serif`;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Score pills.
    const pill = (x, label, n, lead) => {
      ctx.fillStyle = lead ? 'rgba(255,255,255,0.18)' : 'rgba(10,12,18,0.55)';
      roundRect(ctx, x - 70, 112, 140, 46, 23);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = font(600, 13);
      ctx.fillText(label, x - 22, 135);
      ctx.fillStyle = '#fff';
      ctx.font = font(800, 24);
      ctx.fillText(String(n), x + 34, 136);
    };
    pill(W * 0.32, 'YOU', this.score, this.score > this.cpu);
    pill(W * 0.68, 'SYRIX', this.cpu, this.cpu > this.score);

    const size = Math.min(170, W * 0.14);
    if (this.phase === 'count') {
      const i = Math.min(3, Math.floor(this.t / BEAT));
      const k = (this.t % BEAT) / BEAT;
      // Both fists pump on every beat, like the real game.
      const bob = i < 3 ? Math.sin(Math.min(1, k * 1.6) * Math.PI) * size * 0.35 : 0;
      ctx.drawImage(emojiSprite('✊', 160), W * 0.32 - size / 2, H * 0.44 - size / 2 - bob, size, size);
      ctx.save();
      ctx.translate(W * 0.68, H * 0.44 - bob);
      ctx.scale(-1, 1);
      ctx.drawImage(emojiSprite('✊', 160), -size / 2, -size / 2, size, size);
      ctx.restore();
      const words = ['Rock', 'Paper', 'Scissors', 'Shoot!'];
      ctx.globalAlpha = i === 3 ? 1 : 1 - k * 0.5;
      ctx.font = font(800, Math.round((i === 3 ? 96 : 70) * (1 + (1 - k) * 0.12)));
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(8,10,16,0.75)';
      ctx.strokeText(words[i], W / 2, H * 0.7);
      ctx.fillStyle = '#fff';
      ctx.fillText(words[i], W / 2, H * 0.7);
      if (i === 3) {
        ctx.globalAlpha = 1;
        ctx.font = font(600, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText('Show your hand now', W / 2, H * 0.7 + 62);
      }
    } else if (this.phase === 'miss') {
      ctx.font = font(700, 32);
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(8,10,16,0.75)';
      ctx.strokeText('Didn\'t catch that. Hold your hand up clearly', W / 2, H * 0.46);
      ctx.fillStyle = '#fff';
      ctx.fillText('Didn\'t catch that. Hold your hand up clearly', W / 2, H * 0.46);
    } else if (this.round) {
      const s = Math.min(1, this.t / 0.22);
      const sz = size * (0.7 + 0.3 * easeBack(s));
      ctx.drawImage(emojiSprite(RPS[this.round.you], 160), W * 0.32 - sz / 2, H * 0.44 - sz / 2, sz, sz);
      ctx.save();
      ctx.translate(W * 0.68, H * 0.44);
      ctx.scale(-1, 1);
      ctx.drawImage(emojiSprite(RPS[this.round.cpu], 160), -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
      const msg = { win: 'You win the round', lose: 'Syrix wins the round', draw: 'Draw' }[this.round.result];
      ctx.font = font(800, 46);
      ctx.lineWidth = 9;
      ctx.strokeStyle = 'rgba(8,10,16,0.75)';
      ctx.strokeText(msg, W / 2, H * 0.7);
      ctx.fillStyle = this.round.result === 'win' ? '#a7f3d0' : this.round.result === 'lose' ? '#fecdd3' : '#fff';
      ctx.fillText(msg, W / 2, H * 0.7);
    }
    ctx.restore();
    void t;
  }
}

const BEAT = 0.6;
const easeBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------------ face match

const FACES = [
  { emoji: '😁', label: 'Big smile', test: (f) => f.smile > 0.6 },
  { emoji: '😮', label: 'Open wide', test: (f) => f.jaw > 0.55 },
  { emoji: '😗', label: 'Kissy face', test: (f) => f.pucker > 0.62 },
  { emoji: '😉', label: 'Wink', test: (f) => Math.abs(f.blinkA - f.blinkB) > 0.4 && Math.max(f.blinkA, f.blinkB) > 0.55 },
  { emoji: '🤨', label: 'Eyebrows up', test: (f) => f.brows > 0.5 },
  { emoji: '🐡', label: 'Puff your cheeks', test: (f) => f.puff > 0.4 },
  { emoji: '😠', label: 'Angry face', test: (f) => f.browDown > 0.42 },
  { emoji: '😟', label: 'Sad face', test: (f) => f.frown > 0.32 },
];

class FaceMatch {
  static info = {
    title: 'Face Match',
    sub: 'Copy each expression before the ring runs out.',
    rules: [
      'Match the face shown at the top of the screen',
      'Hold it for half a second to score',
      'Quick matches earn a bonus point',
      '45 seconds on the clock',
    ],
    duration: 45,
    lives: 0,
  };

  constructor(env) {
    this.env = env;
    this.score = 0;
    this.time = 0;
    this.next(-1);
  }

  next(prev) {
    let i;
    do { i = Math.floor(Math.random() * FACES.length); } while (i === prev);
    this.cur = i;
    this.hold = 0;
    this.left = Math.max(2.2, 4 - this.time / 20);
    this.window = this.left;
    this.pop = 0;
  }

  update(dt, inp) {
    const { sfx, P } = this.env;
    const f = inp.face;
    this.paused = !f;
    if (!f) return;
    this.time += dt;
    this.left -= dt;
    this.pop = Math.min(1, this.pop + dt * 4);
    if (FACES[this.cur].test(f)) this.hold += dt; else this.hold = Math.max(0, this.hold - dt * 2);
    if (this.hold >= 0.5) {
      const quick = this.window - this.left < 1.4;
      this.score += quick ? 2 : 1;
      sfx.coin();
      P.burst(f.center[0], f.center[1], 26, { kind: 'glow', speed: [120, 380], life: [0.4, 0.8], size: [8, 16], rgb: [[255, 165, 31], [255, 230, 150]], drag: 0.2, grow: 0.2 });
      this.env.fx.float(f.center[0], f.forehead[1] - 30, quick ? 'Quick! +2' : '+1', [255, 200, 90]);
      this.next(this.cur);
    } else if (this.left <= 0) {
      sfx.hit();
      this.next(this.cur);
    }
  }

  draw(ctx, t, W) {
    const face = FACES[this.cur];
    const cx = W / 2, cy = 190;
    const k = Math.max(0, this.left / this.window);
    ctx.save();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = k < 0.3 ? '#fb7185' : '#ffa51f';
    ctx.beginPath();
    ctx.arc(cx, cy, 58, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
    ctx.stroke();
    const s = 84 * (0.7 + 0.3 * this.pop);
    ctx.drawImage(emojiSprite(face.emoji, 160), cx - s / 2, cy - s / 2, s, s);
    ctx.textAlign = 'center';
    ctx.font = '700 24px "Segoe UI Variable Display", "Segoe UI", sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(10,8,6,0.8)';
    ctx.strokeText(face.label, cx, cy + 92);
    ctx.fillStyle = '#fff';
    ctx.fillText(face.label, cx, cy + 92);
    if (this.hold > 0) {
      ctx.fillStyle = 'rgba(255,165,31,0.9)';
      ctx.fillRect(cx - 60, cy + 108, 120 * Math.min(1, this.hold / 0.5), 5);
    }
    ctx.restore();
    void t;
  }
}

const GAME_CLASSES = { bubbles: BubblePop, ninja: FruitSlice, meteor: MeteorDodge, rps: RockPaperScissors, facematch: FaceMatch };

// ------------------------------------------------------------------ manager

export class Games {
  constructor({ particles, sfx, dom, onExit }) {
    this.P = particles;
    this.sfx = sfx;
    this.dom = dom;
    this.onExit = onExit;
    this.best = {};
    this.id = null;
    this.phase = null;
    this.game = null;
    this.shakeAmt = 0;
    this.flashAmt = 0;
    this.flashRgb = [255, 255, 255];
    this.floats = [];
    this.lastHud = '';
    this.env = {
      P: particles,
      sfx,
      fx: {
        flash: (rgb) => { this.flashRgb = rgb; this.flashAmt = 0.45; },
        shake: (a) => { this.shakeAmt = Math.max(this.shakeAmt, a); },
        float: (x, y, text, rgb) => this.P.spawn({ kind: 'text', text, x, y, vy: -70, life: 0.9, size: 30, grow: 1.15, rgb }),
      },
    };
    dom.start.addEventListener('click', () => this.start());
    dom.exit.addEventListener('click', () => this.exit());
  }

  get active() { return !!this.id; }
  get playing() { return this.phase === 'countdown' || this.phase === 'play'; }
  get waitingToStart() { return this.phase === 'intro' || this.phase === 'over'; }

  select(id) {
    this.id = id;
    this.phase = 'intro';
    this.game = null;
    this.showPanel();
  }

  showPanel(result) {
    const C = GAME_CLASSES[this.id];
    const d = this.dom;
    d.kicker.textContent = result ? 'Round over' : 'Game';
    d.title.textContent = C.info.title;
    d.sub.textContent = C.info.sub;
    d.rules.replaceChildren(...C.info.rules.map((r) => {
      const li = document.createElement('li');
      li.textContent = r;
      return li;
    }));
    d.rules.hidden = !!result;
    const best = this.best[this.id];
    if (result) {
      d.best.innerHTML = '';
      const big = document.createElement('span');
      big.className = 'score-big';
      big.textContent = String(result.score);
      d.best.append('Your score', big);
      const line = document.createElement('div');
      if (result.newBest) {
        line.className = 'new-best';
        line.textContent = 'New best this session!';
      } else {
        line.textContent = `Best this session: ${best}`;
      }
      d.best.append(line);
      d.start.textContent = 'Play again';
    } else {
      d.best.textContent = best != null ? `Best this session: ${best}` : 'No score yet this session.';
      d.start.textContent = 'Start';
    }
    d.panel.hidden = false;
    d.hud.hidden = true;
    setTimeout(() => d.start.focus(), 50);
  }

  start() {
    if (!this.id) return;
    this.sfx.unlock();
    this.dom.panel.hidden = true;
    this.P.clear();
    this.game = new GAME_CLASSES[this.id](this.env);
    const own = GAME_CLASSES[this.id].info.ownCountdown;
    this.phase = own ? 'play' : 'countdown';
    this.count = 3;
    this.lastBeep = 4;
    this.elapsed = 0;
    const info = GAME_CLASSES[this.id].info;
    this.dom.timeBlock.hidden = !info.duration;
    this.dom.livesBlock.hidden = !info.lives;
    this.dom.hud.hidden = !!info.ownCountdown;
    this.lastHud = '';
    this.updateHud(true);
  }

  exit() {
    this.id = null;
    this.phase = null;
    this.game = null;
    this.dom.panel.hidden = true;
    this.dom.hud.hidden = true;
    this.P.clear();
    this.onExit();
  }

  finish() {
    const score = this.game.score;
    const prev = this.best[this.id];
    const newBest = prev == null || score > prev;
    if (newBest) this.best[this.id] = score;
    this.phase = 'over';
    if (newBest && score > 0) this.sfx.fanfare(); else this.sfx.gameOver();
    setTimeout(() => { if (this.phase === 'over') this.showPanel({ score, newBest: newBest && score > 0 }); }, 700);
  }

  updateHud(force) {
    const g = this.game;
    const info = GAME_CLASSES[this.id].info;
    const left = info.duration ? Math.max(0, Math.ceil(info.duration - this.elapsed)) : 0;
    const lives = info.lives ? '❤️'.repeat(Math.max(0, g.lives)) + '🖤'.repeat(Math.max(0, info.lives - Math.max(0, g.lives))) : '';
    const key = `${g.score}|${left}|${lives}`;
    if (!force && key === this.lastHud) return;
    const prevScore = this.lastHud.split('|')[0];
    this.lastHud = key;
    this.dom.score.textContent = String(g.score);
    if (prevScore !== String(g.score) && !force) {
      this.dom.score.classList.remove('bump');
      void this.dom.score.offsetWidth;
      this.dom.score.classList.add('bump');
    }
    this.dom.time.textContent = String(left);
    this.dom.lives.textContent = lives;
  }

  // Builds the per-frame input from tracked hands, face and pointer.
  input(frame) {
    const points = [];
    const blades = [];
    frame.hands.forEach((h, i) => {
      for (const tp of TIPS) points.push([h.x(tp), h.y(tp)]);
      blades.push({ key: `hand${i}`, x: h.x(8), y: h.y(8) });
    });
    if (frame.pointer.active) {
      points.push([frame.pointer.x, frame.pointer.y]);
      blades.push({ key: 'mouse', x: frame.pointer.x, y: frame.pointer.y });
    }
    return { W: frame.W, H: frame.H, t: frame.t, points, blades, hands: frame.hands, face: frame.faces[0] || null };
  }

  frame(ctx, dt, frame) {
    if (!this.id) return;
    const W = frame.W, H = frame.H;
    ctx.save();
    if (this.shakeAmt > 0.5) {
      ctx.translate(rand(-1, 1) * this.shakeAmt, rand(-1, 1) * this.shakeAmt);
      this.shakeAmt *= Math.pow(0.002, dt);
    }

    if (this.phase === 'countdown') {
      this.count -= dt;
      const n = Math.ceil(this.count);
      if (n !== this.lastBeep && n > 0) { this.lastBeep = n; this.sfx.beep(false); }
      if (this.count <= 0) {
        this.phase = 'play';
        this.sfx.beep(true);
        this.P.spawn({ kind: 'text', text: 'GO!', x: W / 2, y: H / 2, life: 0.8, size: 110, grow: 1.5, rgb: [255, 165, 31] });
      } else {
        const k = this.count - Math.floor(this.count);
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(1 + (1 - k) * 0.4, 1 + (1 - k) * 0.4);
        ctx.globalAlpha = Math.min(1, k * 2.2);
        ctx.font = '800 150px Bahnschrift, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 14;
        ctx.strokeStyle = 'rgba(10,10,25,0.85)';
        ctx.strokeText(String(n), 0, 0);
        ctx.fillStyle = '#fff';
        ctx.fillText(String(n), 0, 0);
        ctx.restore();
      }
    }

    if (this.phase === 'play' && this.game) {
      const g = this.game;
      g.update(dt, this.input(frame));
      if (!g.paused) this.elapsed += dt;
      const info = GAME_CLASSES[this.id].info;
      if ((info.duration && this.elapsed >= info.duration) || g.over) this.finish();
    }

    if (this.game && this.phase !== 'intro') {
      this.game.draw(ctx, frame.t, W, H);
      if (this.game.paused && this.phase === 'play') {
        ctx.fillStyle = 'rgba(5,5,12,0.55)';
        ctx.fillRect(-50, -50, W + 100, H + 100);
        ctx.font = '700 30px Bahnschrift, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText('Show your face to keep playing', W / 2, H / 2);
      }
      this.updateHud(false);
    }
    ctx.restore();

    if (this.flashAmt > 0.01) {
      ctx.fillStyle = `rgba(${this.flashRgb[0]},${this.flashRgb[1]},${this.flashRgb[2]},${this.flashAmt})`;
      ctx.fillRect(0, 0, W, H);
      this.flashAmt *= Math.pow(0.02, dt);
    }
  }
}
