// Synthesised sound effects. Nothing is loaded from disk and the microphone
// is never used: every sound is generated with oscillators and noise.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.7;
    this.loops = {};
    this.last = {};
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.level();
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  level() { return this.enabled ? 0.55 * this.volume : 0; }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.02);
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.02);
  }

  ok(key, gap = 0) {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return false;
    if (key) {
      const now = performance.now();
      if (this.last[key] && now - this.last[key] < gap) return false;
      this.last[key] = now;
    }
    return true;
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, slide = null, delay = 0, attack = 0.005 } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, { vol = 0.3, freq = 1200, q = 1, type = 'bandpass', slide = null, delay = 0 } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  click() { if (this.ok('click', 40)) this.tone(1400, 0.05, { type: 'triangle', vol: 0.08 }); }
  pop() { if (this.ok('pop', 25)) { const f = 500 + Math.random() * 400; this.tone(f, 0.12, { vol: 0.35, slide: f * 2.4 }); } }
  coin() { if (this.ok('coin', 60)) { this.tone(988, 0.08, { type: 'square', vol: 0.12 }); this.tone(1319, 0.22, { type: 'square', vol: 0.12, delay: 0.07 }); } }
  slice() { if (this.ok('slice', 40)) this.noise(0.18, { vol: 0.5, freq: 3000, slide: 900, q: 0.8 }); }
  splat() { if (this.ok('splat', 40)) this.noise(0.14, { vol: 0.4, freq: 500, type: 'lowpass' }); }
  boom() {
    if (!this.ok('boom', 150)) return;
    this.noise(0.9, { vol: 0.9, freq: 900, slide: 60, type: 'lowpass' });
    this.tone(90, 0.6, { vol: 0.5, slide: 35 });
  }
  hit() { if (this.ok('hit', 200)) { this.tone(220, 0.3, { type: 'sawtooth', vol: 0.2, slide: 80 }); this.noise(0.25, { vol: 0.4, freq: 400, type: 'lowpass' }); } }
  zap() { if (this.ok('zap', 90)) this.noise(0.07, { vol: 0.16, freq: 4000 + Math.random() * 3000, q: 4 }); }
  sparkle() {
    if (!this.ok('sparkle', 120)) return;
    [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.06, delay: i * 0.05 }));
  }
  whoosh() { if (this.ok('whoosh', 200)) this.noise(0.4, { vol: 0.3, freq: 400, slide: 2400, q: 0.7 }); }
  beep(high) { if (this.ok()) this.tone(high ? 1046 : 523, high ? 0.35 : 0.15, { type: 'square', vol: 0.12 }); }
  fanfare() { if (this.ok('fanfare', 500)) [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.16, delay: i * 0.1 })); }
  gameOver() { if (this.ok('over', 500)) [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.15, delay: i * 0.16 })); }
  note(freq) {
    if (!this.ok()) return;
    this.tone(freq, 0.9, { type: 'triangle', vol: 0.22, attack: 0.004 });
    this.tone(freq * 2, 0.5, { type: 'sine', vol: 0.06, attack: 0.004 });
  }
  shutter() {
    if (!this.ok('shutter', 120)) return;
    this.noise(0.05, { vol: 0.5, freq: 5000, q: 0.7, type: 'highpass' });
    this.noise(0.09, { vol: 0.35, freq: 1800, q: 1.2, delay: 0.06 });
  }
  chime() { if (this.ok('chime', 300)) [880, 1318].forEach((f, i) => this.tone(f, 0.5, { type: 'sine', vol: 0.1, delay: i * 0.09 })); }
  laserStart() { if (this.ok('laser', 400)) this.tone(1800, 0.35, { type: 'sawtooth', vol: 0.1, slide: 300 }); }

  // Continuous sounds whose level follows an effect's intensity (0..1).
  loop(name, level) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    let l = this.loops[name];
    if (!l) {
      if (level <= 0.001) return;
      const c = this.ctx;
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      if (name === 'fire') {
        const src = c.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 700;
        src.connect(f).connect(g);
        src.start();
        l = { g, nodes: [src] };
      } else {
        const o1 = c.createOscillator();
        const o2 = c.createOscillator();
        o1.type = 'sine';
        o2.type = 'sine';
        o1.frequency.value = 110;
        o2.frequency.value = 113;
        o1.connect(g);
        o2.connect(g);
        o1.start();
        o2.start();
        l = { g, nodes: [o1, o2], osc: o1 };
      }
      this.loops[name] = l;
    }
    const target = this.enabled ? Math.max(0, Math.min(1, level)) * (name === 'fire' ? 0.55 : 0.18) : 0;
    l.g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    if (l.osc) l.osc.frequency.setTargetAtTime(100 + level * 80, this.ctx.currentTime, 0.1);
  }

  stopLoops() {
    for (const name of Object.keys(this.loops)) this.loop(name, 0);
  }
}
