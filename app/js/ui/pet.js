// Syrix as a small character that lives in the island during voice mode and
// shows what Syrix is doing: listening, thinking, using a tool, talking.
// It watches the person (its eyes follow their face on screen), reacts to
// smiles, waves and gestures, and can be petted. Clicking it mutes or unmutes
// the microphone; a double click opens the chat. It replaces the voice orb.
//
// Everything is drawn on one canvas from a handful of eased parameters
// (eye openness, gaze, mouth, squash, hop), so each change of mood blends
// into the next instead of switching frames.

const S = 200; // drawing space; the canvas is scaled to fit
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (cur, target, k) => cur + (target - cur) * k;
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

// Antenna star colour per mood: the SYRIX gold, violet and cyan.
const GLOW = {
  idle: [227, 196, 107], listening: [127, 211, 255], hearing: [127, 211, 255], thinking: [184, 168, 255],
  working: [184, 168, 255], speaking: [255, 207, 138], happy: [255, 214, 120], love: [255, 120, 170],
  surprised: [255, 233, 176], sleepy: [120, 120, 140], muted: [150, 150, 160], error: [255, 105, 97], loading: [184, 168, 255],
};
const TOOL_ICON = {
  web_search: 'search', read_page: 'search', github_search: 'code', stock_chart: 'chart', show_chart: 'chart',
  look: 'eye', inspect_skin: 'eye', view_object: 'eye', create_object: 'pencil', update_object: 'pencil',
  create_app: 'cube', update_app: 'cube', health: 'heart', face_id: 'eye', remember: 'star', open_link: 'globe',
};

export class Pet {
  constructor(root, { onClick, onChat }) {
    this.root = root;
    this.handlers = { onClick, onChat };
    root.innerHTML = '<canvas class="pet-canvas" width="176" height="176" aria-label="Syrix"></canvas>';
    root.title = 'Click to mute or unmute · double-click for the chat';
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.voice = 'off';
    this.busy = false;
    this.tool = null;
    this.toolUntil = 0;
    this.flash = null; // short reaction: { mood, until }
    this.levels = () => ({ mic: 0, out: 0 });
    this.gaze = { x: 0, y: 0 };
    this.target = { x: 0, y: 0, at: 0 };
    this.smiling = 0;
    this.lastSeen = performance.now();
    this.lastPoke = performance.now();
    this.p = { eye: 1, px: 0, py: 0, mouth: 0, smile: 0.4, squash: 0, hop: 0, vy: 0, y: 0, tilt: 0, glow: GLOW.idle.slice(), spin: 0, blush: 0, arms: 0 };
    this.blinkAt = performance.now() + 2500;
    this.blinkT = -1;
    this.particles = [];
    this.pet = 0;
    this.running = false;
    this.visible = false;
    this.bindInput();
  }

  // ---------------------------------------------------------------- inputs

  setVoice(state, muted) {
    if (state !== this.voice && state === 'listening' && this.voice === 'loading') this.react('happy', 900);
    this.voice = state;
    this.muted = !!muted;
  }

  setBusy(on) {
    this.busy = on;
    if (!on) this.tool = null;
  }

  // A tool started (badge and status), or the turn finished.
  activity(kind, name) {
    if (kind === 'tool') {
      const icon = TOOL_ICON[name];
      if (!icon) return;
      this.tool = icon;
      this.toolUntil = performance.now() + 6000;
    } else if (kind === 'done') {
      this.tool = null;
      this.react('happy', 1000);
      this.sparkle(5);
    } else if (kind === 'error') {
      this.tool = null;
      this.react('error', 1600);
    }
  }

  // The main face on screen (CSS pixels) and how much it smiles, or null.
  watch(face) {
    const now = performance.now();
    if (face) {
      this.target = { x: face.center[0], y: face.center[1], at: now };
      this.smiling = face.smile || 0;
      if (now - this.lastSeen > 20000) this.react('surprised', 900);
      this.lastSeen = now;
    }
  }

  react(mood, ms = 1200) {
    this.flash = { mood, until: performance.now() + ms };
    if (mood === 'happy' || mood === 'surprised' || mood === 'love') this.p.vy = -220;
    if (mood === 'love') for (let i = 0; i < 5; i++) this.spawn('heart');
  }

  setVisible(on) {
    this.visible = on;
    this.root.hidden = !on;
    if (on) this.start();
  }

  // ---------------------------------------------------------------- mood

  mood(now) {
    if (this.flash && now < this.flash.until) return this.flash.mood;
    this.flash = null;
    if (this.voice === 'loading') return 'loading';
    if (this.muted && this.voice !== 'off') return 'muted';
    if (this.tool && now < this.toolUntil) return 'working';
    if (this.voice === 'speaking') return 'speaking';
    if (this.voice === 'hearing') return 'hearing';
    if (this.voice === 'thinking' || this.busy) return 'thinking';
    if (this.voice === 'listening') return 'listening';
    if (this.pet > 0.6) return 'love';
    if (this.smiling > 0.55 && now - this.target.at < 1500) return 'happy';
    if (now - this.lastSeen > 90000 && now - this.lastPoke > 90000) return 'sleepy';
    return 'idle';
  }

  // ---------------------------------------------------------------- frame

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  frame(now) {
    if (!this.visible) { this.running = false; return; }
    requestAnimationFrame((t) => this.frame(t));
    // Drawn only while the island shows the voice pane.
    if (!this.root.offsetParent) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const mood = this.mood(now);
    const { mic, out } = this.levels();
    const P = this.p;
    const k = 1 - Math.pow(0.0008, dt);
    const kf = 1 - Math.pow(0.00002, dt);

    // Gaze: towards the person's face, or the pointer when it is near, with
    // small idle glances; up and to the side while thinking.
    const r = this.canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.52;
    let gx = 0, gy = 0;
    const seen = now - this.target.at < 1500;
    if (mood === 'thinking' || mood === 'working') { gx = 0.6 * Math.sin(now / 700); gy = -0.8; }
    else if (mood === 'sleepy') { gx = 0; gy = 0.4; }
    else if (this.pointer && now - this.pointer.at < 1800) { gx = (this.pointer.x - cx) / 500; gy = (this.pointer.y - cy) / 400; }
    else if (seen) { gx = (this.target.x - cx) / 600; gy = (this.target.y - cy) / 450; }
    else { gx = Math.sin(now / 2300) * 0.5; gy = Math.sin(now / 3100) * 0.2; }
    P.px = ease(P.px, clamp(gx, -1, 1), k);
    P.py = ease(P.py, clamp(gy, -1, 1), k);

    // Blinks every few seconds (double blinks now and then).
    if (now > this.blinkAt) { this.blinkT = 0; this.blinkAt = now + 2200 + Math.random() * 3800 + (Math.random() < 0.15 ? -1900 : 0); }
    let blink = 1;
    if (this.blinkT >= 0) { this.blinkT += dt; blink = Math.abs(1 - this.blinkT / 0.08); if (this.blinkT > 0.16) this.blinkT = -1; }
    const eyeTarget = { sleepy: 0.18, happy: 0.0, love: 0.0, surprised: 1.25, hearing: 1.12, listening: 1.05, error: 1, muted: 0.75, thinking: 0.85 }[mood] ?? 1;
    P.eye = ease(P.eye, eyeTarget, kf);
    const eye = Math.min(P.eye, 1.3) * clamp(blink, 0, 1);

    const smileT = { happy: 1, love: 1, speaking: 0.55, idle: 0.45, listening: 0.6, hearing: 0.5, surprised: 0, thinking: 0.1, working: 0.35, error: -0.6, sleepy: 0.15, muted: 0.1, loading: 0.3 }[mood] ?? 0.4;
    P.smile = ease(P.smile, smileT, k);
    const mouthT = mood === 'speaking' ? clamp(out * 1.6, 0.05, 1) : mood === 'surprised' ? 0.7 : mood === 'hearing' ? 0.08 : 0;
    P.mouth = ease(P.mouth, mouthT, mood === 'speaking' ? 0.5 : k);
    P.blush = ease(P.blush, mood === 'happy' || mood === 'love' || this.pet > 0.3 ? 1 : 0, k);
    P.glow = mix(P.glow, GLOW[mood] || GLOW.idle, k);
    P.spin += dt * (mood === 'thinking' || mood === 'working' || mood === 'loading' ? 5 : 0.6);
    P.arms = ease(P.arms, mood === 'happy' || mood === 'love' ? 1 : mood === 'surprised' ? 0.7 : 0, k);

    // Body: bob, squash with voice level, hop under gravity.
    const bob = mood === 'sleepy' ? Math.sin(now / 1400) * 2 : Math.sin(now / (mood === 'working' ? 260 : 620)) * (mood === 'working' ? 5 : 4);
    const level = mood === 'hearing' || mood === 'listening' ? mic : mood === 'speaking' ? out : 0;
    P.squash = ease(P.squash, level * 0.12 + (mood === 'hearing' ? Math.sin(now / 160) * 0.02 : 0), 0.3);
    P.vy += 900 * dt;
    P.y += P.vy * dt;
    if (P.y > 0) { if (P.vy > 160) { P.squash -= 0.12; } P.y = 0; P.vy = 0; }
    P.tilt = ease(P.tilt, mood === 'thinking' ? 0.08 : mood === 'listening' ? -0.05 : mood === 'love' ? Math.sin(now / 200) * 0.08 : P.px * 0.06, k);
    this.pet = Math.max(0, this.pet - dt * 0.35);

    // Ambient particles.
    if (mood === 'sleepy' && Math.random() < dt * 0.7) this.spawn('z');
    if (mood === 'love' && Math.random() < dt * 2) this.spawn('heart');
    if ((mood === 'listening' || mood === 'hearing') && Math.random() < dt * (1 + mic * 8)) this.spawn('ring');

    this.draw(now, mood, eye, bob, level);
  }

  // ---------------------------------------------------------------- drawing

  draw(now, mood, eye, bob, level) {
    const c = this.ctx;
    const P = this.p;
    // The character occupies the middle of the drawing space; the empty
    // margin is cropped so it fills the small circle in the island.
    const scale = this.canvas.width / (S - 44);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(scale, 0, 0, scale, -22 * scale, -18 * scale);
    const [gr, gg, gb] = P.glow.map(Math.round);
    const glow = (a) => `rgba(${gr},${gg},${gb},${a})`;
    const lift = bob + P.y;
    const by = 116 + lift;
    const sx = 1 + P.squash, sy = 1 - P.squash;

    // Shadow on the ground.
    const sh = clamp(1 + lift / 60, 0.5, 1.15);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.ellipse(100, 182, 44 * sh, 8 * sh, 0, 0, Math.PI * 2);
    c.fill();

    // Aura.
    const aura = c.createRadialGradient(100, by, 20, 100, by, 95);
    aura.addColorStop(0, glow(0.22 + level * 0.25));
    aura.addColorStop(1, glow(0));
    c.fillStyle = aura;
    c.beginPath();
    c.arc(100, by, 95, 0, Math.PI * 2);
    c.fill();

    c.save();
    c.translate(100, by);
    c.rotate(P.tilt);
    c.scale(sx, sy);

    // Arms: little nubs that lift when happy.
    for (const side of [-1, 1]) {
      const a = side * (0.5 + P.arms * (0.9 + Math.sin(now / 120) * 0.25));
      c.save();
      c.translate(side * 56, 8);
      c.rotate(a);
      c.fillStyle = '#25223a';
      c.strokeStyle = glow(0.85);
      c.lineWidth = 1.8;
      c.beginPath();
      c.ellipse(0, 12, 8.5, 15, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    }

    // Body: a soft rounded blob, dark glass with a brand-coloured rim light.
    const w = 60, h = 56;
    const wob = (i) => 1 + Math.sin(now / 500 + i * 1.7) * 0.012;
    c.beginPath();
    c.moveTo(0, -h * wob(0));
    c.bezierCurveTo(w * 0.62 * wob(1), -h, w * wob(2), -h * 0.5, w * wob(2), 2);
    c.bezierCurveTo(w, h * 0.62, w * 0.6, h * wob(3), 0, h * wob(3));
    c.bezierCurveTo(-w * 0.6, h * wob(3), -w, h * 0.62, -w * wob(4), 2);
    c.bezierCurveTo(-w * wob(4), -h * 0.5, -w * 0.62 * wob(1), -h, 0, -h * wob(0));
    c.closePath();
    const body = c.createRadialGradient(-18, -26, 6, 0, 6, 76);
    body.addColorStop(0, '#2c2940');
    body.addColorStop(0.55, '#16141f');
    body.addColorStop(1, '#0b0a10');
    c.fillStyle = body;
    c.fill();
    const rim = c.createLinearGradient(-w, -h, w, h);
    rim.addColorStop(0, 'rgba(227,196,107,0.95)');
    rim.addColorStop(0.5, 'rgba(184,168,255,0.85)');
    rim.addColorStop(1, 'rgba(127,211,255,0.9)');
    c.strokeStyle = rim;
    c.lineWidth = 2.4;
    c.stroke();
    // Gloss.
    c.fillStyle = 'rgba(255,255,255,0.09)';
    c.beginPath();
    c.ellipse(-20, -30, 22, 11, -0.5, 0, Math.PI * 2);
    c.fill();

    // Eyes.
    const ex = 21, ey = -6;
    const gx = P.px * 5, gy = P.py * 4;
    for (const side of [-1, 1]) {
      const x = side * ex + gx * 0.5, y = ey + gy * 0.4;
      if (mood === 'happy' || (mood === 'love' && this.pet <= 0.6)) {
        // Closed, smiling eyes: ^ ^
        c.strokeStyle = '#f5f3ff';
        c.lineWidth = 4;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(x, y + 4, 9, Math.PI * 1.15, Math.PI * 1.85);
        c.stroke();
        continue;
      }
      if (mood === 'love') { this.heart(c, x, y, 11, '#ff5d8f'); continue; }
      if (mood === 'error') {
        c.strokeStyle = '#f5f3ff';
        c.lineWidth = 3.5;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x - 7, y - 7); c.lineTo(x + 7, y + 7); c.moveTo(x + 7, y - 7); c.lineTo(x - 7, y + 7);
        c.stroke();
        continue;
      }
      const ry = 14 * clamp(eye, 0.06, 1.3), rx = 11.5;
      c.fillStyle = '#f5f3ff';
      c.shadowColor = glow(0.8);
      c.shadowBlur = 10;
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
      if (ry > 3) {
        c.save();
        c.beginPath();
        c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        c.clip();
        const heavy = mood === 'sleepy' || mood === 'muted';
        const pr = mood === 'hearing' || mood === 'surprised' ? 7.5 : 6.5;
        c.fillStyle = '#120f1d';
        c.beginPath();
        c.arc(x + gx, y + gy, pr, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#fff';
        c.beginPath();
        c.arc(x + gx - 2.4, y + gy - 2.8, 2.2, 0, Math.PI * 2);
        c.fill();
        // Heavy upper lids, kept inside the eye.
        if (heavy) {
          c.fillStyle = '#1b1928';
          c.fillRect(x - rx - 1, y - ry - 1, rx * 2 + 2, ry * 0.9);
          c.strokeStyle = 'rgba(245,243,255,0.5)';
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(x - rx, y - ry * 0.1);
          c.lineTo(x + rx, y - ry * 0.1);
          c.stroke();
        }
        c.restore();
      }
    }

    // Blush.
    if (P.blush > 0.02) {
      c.fillStyle = `rgba(255,110,150,${0.35 * P.blush})`;
      for (const side of [-1, 1]) { c.beginPath(); c.ellipse(side * 33, 13, 8, 4.5, 0, 0, Math.PI * 2); c.fill(); }
    }

    // Mouth.
    c.strokeStyle = '#f5f3ff';
    c.fillStyle = '#2a0f1c';
    c.lineWidth = 3;
    c.lineCap = 'round';
    const my = 22;
    if (P.mouth > 0.08) {
      const oh = 3 + P.mouth * 11, ow = 7 + P.mouth * 3 + Math.max(0, P.smile) * 3;
      c.beginPath();
      c.ellipse(gx * 0.3, my + oh * 0.3, ow, oh, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    } else if (mood === 'muted') {
      c.beginPath();
      c.moveTo(-9, my); c.lineTo(9, my);
      c.stroke();
      c.lineWidth = 1.5;
      for (let i = -6; i <= 6; i += 4) { c.beginPath(); c.moveTo(i, my - 3); c.lineTo(i, my + 3); c.stroke(); }
    } else {
      const s = P.smile * 7;
      c.beginPath();
      c.moveTo(-9 + gx * 0.3, my - s * 0.3);
      c.quadraticCurveTo(gx * 0.3, my + s, 9 + gx * 0.3, my - s * 0.3);
      c.stroke();
    }
    c.restore();

    // Antenna with the SYRIX star, glowing in the mood colour.
    const ax = 100 + Math.sin(now / 900) * 3 + P.tilt * 40, ay = 46 + lift * 1.15 - P.squash * 20;
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(100, by - 54 * sy);
    c.quadraticCurveTo(100, ay + 16, ax, ay + 6);
    c.stroke();
    c.save();
    c.translate(ax, ay);
    c.rotate(P.spin * 0.25);
    const st = c.createRadialGradient(0, 0, 0, 0, 0, 22);
    st.addColorStop(0, glow(0.75));
    st.addColorStop(1, glow(0));
    c.fillStyle = st;
    c.beginPath();
    c.arc(0, 0, 22, 0, Math.PI * 2);
    c.fill();
    this.star(c, 0, 0, 10 + level * 3, 3.2, `rgb(${Math.min(255, gr + 30)},${Math.min(255, gg + 30)},${Math.min(255, gb + 30)})`);
    c.restore();

    // Thinking dots orbiting the star.
    if (mood === 'thinking' || mood === 'loading') {
      for (let i = 0; i < 3; i++) {
        const a = P.spin + (i * Math.PI * 2) / 3;
        c.fillStyle = glow(0.9 - i * 0.2);
        c.beginPath();
        c.arc(ax + Math.cos(a) * 20, ay + Math.sin(a) * 9, 2.6, 0, Math.PI * 2);
        c.fill();
      }
    }

    // Tool badge.
    if (mood === 'working' && this.tool) this.badge(c, 152, 62 + lift * 0.6, this.tool, glow);

    this.drawParticles(c, now);
  }

  star(c, x, y, R, r, color) {
    c.fillStyle = color;
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const rad = i % 2 ? r : R;
      c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    c.closePath();
    c.fill();
  }

  heart(c, x, y, s, color) {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x, y + s * 0.7);
    c.bezierCurveTo(x - s * 1.2, y - s * 0.1, x - s * 0.6, y - s * 1.0, x, y - s * 0.35);
    c.bezierCurveTo(x + s * 0.6, y - s * 1.0, x + s * 1.2, y - s * 0.1, x, y + s * 0.7);
    c.fill();
  }

  badge(c, x, y, icon, glow) {
    c.save();
    c.translate(x, y);
    c.fillStyle = 'rgba(18,16,26,0.95)';
    c.strokeStyle = glow(0.9);
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, 0, 17, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.strokeStyle = '#f5f3ff';
    c.fillStyle = '#f5f3ff';
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    switch (icon) {
      case 'search': c.arc(-2, -2, 6, 0, Math.PI * 2); c.moveTo(2.5, 2.5); c.lineTo(8, 8); break;
      case 'code': c.moveTo(-4, -6); c.lineTo(-9, 0); c.lineTo(-4, 6); c.moveTo(4, -6); c.lineTo(9, 0); c.lineTo(4, 6); break;
      case 'chart': c.moveTo(-8, 7); c.lineTo(-3, 0); c.lineTo(1, 3); c.lineTo(8, -6); break;
      case 'eye': c.ellipse(0, 0, 9, 5.5, 0, 0, Math.PI * 2); c.moveTo(3, 0); c.arc(0, 0, 2.6, 0, Math.PI * 2); break;
      case 'pencil': c.moveTo(-7, 7); c.lineTo(-6, 2); c.lineTo(4, -8); c.lineTo(8, -4); c.lineTo(-2, 6); c.closePath(); break;
      case 'cube': c.moveTo(0, -8); c.lineTo(7, -4); c.lineTo(7, 4); c.lineTo(0, 8); c.lineTo(-7, 4); c.lineTo(-7, -4); c.closePath(); c.moveTo(-7, -4); c.lineTo(0, 0); c.lineTo(7, -4); c.moveTo(0, 0); c.lineTo(0, 8); break;
      case 'heart': c.stroke(); this.heart(c, 0, 1, 7, '#ff5d8f'); c.restore(); return;
      case 'star': c.stroke(); this.star(c, 0, 0, 8, 3, '#f5f3ff'); c.restore(); return;
      case 'globe': c.arc(0, 0, 8, 0, Math.PI * 2); c.moveTo(-8, 0); c.lineTo(8, 0); c.moveTo(0, -8); c.ellipse(0, 0, 3.5, 8, 0, 0, Math.PI * 2); break;
      default: break;
    }
    c.stroke();
    c.restore();
  }

  // ---------------------------------------------------------------- particles

  spawn(kind) {
    if (this.particles.length > 30) return;
    const p = { kind, x: 100 + (Math.random() - 0.5) * 40, y: kind === 'ring' ? 116 : 70, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 25, life: 0, max: kind === 'ring' ? 1.1 : 2.2, r: Math.random() };
    if (kind === 'z') { p.x = 128; p.y = 60; p.vx = 12; p.vy = -18; }
    this.particles.push(p);
  }

  sparkle(n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ kind: 'spark', x: 100, y: 110, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 40, life: 0, max: 0.9, r: Math.random() });
    }
  }

  drawParticles(c, now) {
    const dt = 1 / 60;
    this.particles = this.particles.filter((p) => (p.life += dt) < p.max);
    for (const p of this.particles) {
      const k = p.life / p.max;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = 1 - k;
      if (p.kind === 'ring') {
        c.strokeStyle = `rgba(127,211,255,${0.5 * a})`;
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(100, 116, 60 + k * 40, 56 + k * 38, 0, 0, Math.PI * 2);
        c.stroke();
      } else if (p.kind === 'heart') {
        c.globalAlpha = a;
        this.heart(c, p.x + Math.sin(now / 200 + p.r * 9) * 4, p.y, 6 + p.r * 4, '#ff5d8f');
        c.globalAlpha = 1;
      } else if (p.kind === 'z') {
        c.fillStyle = `rgba(200,200,220,${a})`;
        c.font = `700 ${12 + k * 8}px "Segoe UI", sans-serif`;
        c.fillText('z', p.x, p.y);
      } else if (p.kind === 'spark') {
        p.vy += 120 * dt;
        this.star(c, p.x, p.y, 5 * a + 1, 1.6, `rgba(255,233,176,${a})`);
      }
    }
  }

  // ---------------------------------------------------------------- input

  bindInput() {
    const cv = this.canvas;
    cv.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY, at: performance.now() };
      this.lastPoke = performance.now();
      // Stroking it with the pointer is petting.
      const speed = Math.hypot(e.movementX || 0, e.movementY || 0);
      this.pet = Math.min(1.2, this.pet + speed * 0.004);
      if (this.pet > 0.6 && Math.random() < 0.08) this.spawn('heart');
    });
    cv.addEventListener('click', () => {
      // A double click opens the chat instead, so a single click waits a
      // moment to see whether a second one follows.
      clearTimeout(this.clickTimer);
      this.clickTimer = setTimeout(() => { this.react('surprised', 400); if (this.handlers.onClick) this.handlers.onClick(); }, 260);
    });
    cv.addEventListener('dblclick', () => { clearTimeout(this.clickTimer); if (this.handlers.onChat) this.handlers.onChat(); });
  }
}
