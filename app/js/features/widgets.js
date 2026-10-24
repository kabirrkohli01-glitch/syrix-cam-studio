// Floating widgets. Positions and on/off state are remembered as
// preferences; widget contents (notes, timers, counts) are not.

export const WIDGETS = [
  { id: 'clock', name: 'Clock', desc: 'Time and date', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { id: 'timer', name: 'Timer', desc: 'Stopwatch and focus timer', icon: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4M9 2h6"/>' },
  { id: 'posture', name: 'Posture Coach', desc: 'Nudges you to sit up', face: true, icon: '<path d="M12 4v16M8 8l4-4 4 4M7 20h10"/>' },
  { id: 'distance', name: 'Screen Distance', desc: 'Warns when too close', face: true, icon: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>' },
  { id: 'blink', name: 'Blink Coach', desc: 'Helps prevent eye strain', face: true, icon: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  { id: 'reps', name: 'Rep Counter', desc: 'Counts squats and jumps', face: true, icon: '<path d="M6 4v16M18 4v16M3 8v8M21 8v8M6 12h12"/>' },
  { id: 'mood', name: 'Mood Meter', desc: 'Live expression readout', face: true, icon: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>' },
  { id: 'note', name: 'Sticky Note', desc: 'A quick scratchpad', icon: '<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>' },
  { id: 'perf', name: 'Performance', desc: 'Frame rate and AI timing', icon: '<path d="M3 12h4l3-8 4 16 3-8h4"/>' },
];

const pad = (n) => String(n).padStart(2, '0');
const fmt = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;

export class Widgets {
  constructor(layer, settings, save, sfx, notify, bio) {
    this.layer = layer;
    this.settings = settings;
    this.save = save;
    this.sfx = sfx;
    this.notify = notify;
    this.bio = bio;
    this.els = new Map();
    this.drag = null;
    this.tick = 0;
    this.timer = { mode: 'stopwatch', running: false, elapsed: 0, total: 25 * 60, left: 25 * 60 };
    this.alerted = false;
    this.reps = { count: 0, top: null, down: false };
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', () => this.endDrag());
    window.addEventListener('pointercancel', () => this.endDrag());
    for (const w of WIDGETS) if (this.state(w.id).on) this.mount(w.id);
  }

  state(id) {
    if (!this.settings.widgets[id]) this.settings.widgets[id] = { on: false, x: null, y: null };
    return this.settings.widgets[id];
  }

  isOn(id) { return this.state(id).on; }
  get needsFace() { return WIDGETS.some((w) => w.face && this.isOn(w.id)); }
  get needsPose() { return this.isOn('posture') || this.isOn('reps'); }

  toggle(id, on = !this.isOn(id)) {
    this.state(id).on = on;
    if (on) this.mount(id); else this.unmount(id);
    this.save();
  }

  mount(id) {
    if (this.els.has(id)) return;
    const def = WIDGETS.find((w) => w.id === id);
    const st = this.state(id);
    const el = document.createElement('section');
    el.className = 'widget enter';
    el.dataset.w = id;
    const [x, y] = st.x != null ? [st.x, st.y] : this.freeSpot();
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - 120, x))}px`;
    el.style.top = `${Math.max(64, Math.min(window.innerHeight - 80, y))}px`;
    el.innerHTML = `<header class="w-head"><svg viewBox="0 0 24 24" class="ico">${def.icon}</svg><span>${def.name}</span>
      <button class="w-close" title="Close"><svg viewBox="0 0 24 24" class="ico"><path d="M18 6 6 18M6 6l12 12"/></svg></button></header>
      <div class="w-body">${this.body(id)}</div>`;
    this.layer.append(el);
    requestAnimationFrame(() => el.classList.remove('enter'));
    el.querySelector('.w-head').addEventListener('pointerdown', (e) => {
      if (e.target.closest('.w-close')) return;
      this.drag = { el, id, dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop };
      el.classList.add('dragging');
    });
    el.querySelector('.w-close').addEventListener('click', () => { this.toggle(id, false); if (this.onChange) this.onChange(); });
    el.addEventListener('click', (e) => this.action(id, e.target.closest('[data-a]')));
    this.els.set(id, el);
  }

  // New widgets fill columns from the right edge, below anything already
  // placed in that column.
  freeSpot() {
    const colW = 244;
    const top = 92;
    const limit = window.innerHeight - 260;
    for (let col = 0; col < 4; col++) {
      const x = window.innerWidth - 248 - col * colW;
      let y = top;
      for (const el of this.els.values()) {
        if (Math.abs(el.offsetLeft - x) < colW / 2) y = Math.max(y, el.offsetTop + el.offsetHeight + 10);
      }
      if (y < limit) return [x, y];
    }
    return [window.innerWidth - 248, top];
  }

  unmount(id) {
    const el = this.els.get(id);
    if (!el) return;
    this.els.delete(id);
    el.classList.add('enter');
    setTimeout(() => el.remove(), 250);
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    d.el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, e.clientX - d.dx))}px`;
    d.el.style.top = `${Math.max(56, Math.min(window.innerHeight - 50, e.clientY - d.dy))}px`;
  }

  endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.el.classList.remove('dragging');
    const st = this.state(d.id);
    st.x = d.el.offsetLeft;
    st.y = d.el.offsetTop;
    this.save();
  }

  body(id) {
    switch (id) {
      case 'clock': return '<div class="w-big" data-f="time">--:--</div><div class="w-sub" data-f="date"></div>';
      case 'timer': return `<div class="w-seg"><button data-a="sw" class="on">Stopwatch</button><button data-a="cd">Focus</button></div>
        <div class="w-big mono" data-f="t">00:00</div>
        <div class="w-row" data-f="presets" hidden><button class="pill-btn ghost" data-a="p5">5 min</button><button class="pill-btn ghost" data-a="p25">25 min</button><button class="pill-btn ghost" data-a="p50">50 min</button></div>
        <div class="w-row"><button class="pill-btn accent" data-a="go">Start</button><button class="pill-btn ghost" data-a="reset">Reset</button></div>`;
      case 'posture': return '<div class="w-status" data-f="st">Looking for you…</div><div class="w-sub" data-f="sub">Sit up straight, then calibrate.</div><div class="w-row"><button class="pill-btn accent" data-a="cal">Calibrate</button></div>';
      case 'distance': return '<div class="w-big" data-f="cm">-- cm</div><div class="w-meter"><i data-f="bar"></i></div><div class="w-sub" data-f="sub">An arm\'s length (50–75 cm) is ideal.</div>';
      case 'blink': return '<div class="w-big" data-f="rate">--</div><div class="w-sub">blinks per minute</div><div class="w-status" data-f="st">Measuring…</div>';
      case 'reps': return '<div class="w-big" data-f="n">0</div><div class="w-sub">Squats or jumps · stay in view</div><div class="w-row"><button class="pill-btn ghost" data-a="r0">Reset</button></div>';
      case 'mood': return `<div class="w-mood" data-f="emoji">😐</div><div class="w-sub" data-f="label">Calm</div>
        ${['Happy', 'Surprised', 'Focused', 'Sad'].map((m) => `<div class="w-bar"><span>${m}</span><b><i data-f="m-${m}"></i></b></div>`).join('')}`;
      case 'note': return '<textarea class="w-note" placeholder="Jot something down…"></textarea>';
      case 'perf': return '<div class="w-kv"><span>Frame rate</span><b data-f="fps">--</b><span>AI time</span><b data-f="ai">--</b><span>Render</span><b data-f="res">--</b></div>';
      default: return '';
    }
  }

  field(id, f) {
    const el = this.els.get(id);
    return el ? el.querySelector(`[data-f="${f}"]`) : null;
  }

  action(id, btn) {
    if (!btn) return;
    const a = btn.dataset.a;
    const T = this.timer;
    if (id === 'timer') {
      if (a === 'sw' || a === 'cd') {
        T.mode = a === 'sw' ? 'stopwatch' : 'focus';
        T.running = false;
        const el = this.els.get(id);
        el.querySelectorAll('.w-seg button').forEach((b) => b.classList.toggle('on', b.dataset.a === a));
        this.field(id, 'presets').hidden = T.mode !== 'focus';
      } else if (a === 'go') {
        T.running = !T.running;
      } else if (a === 'reset') {
        T.running = false; T.elapsed = 0; T.left = T.total;
      } else if (a[0] === 'p') {
        T.total = Number(a.slice(1)) * 60; T.left = T.total; T.running = false;
      }
      this.sfx.click();
    } else if (id === 'posture' && a === 'cal') {
      this.bio.calibratePosture();
      this.sfx.click();
    } else if (id === 'reps' && a === 'r0') {
      this.reps.count = 0;
    }
  }

  // Runs every frame; text is refreshed a few times a second.
  update(dt, t, face, info) {
    const T = this.timer;
    if (T.running) {
      if (T.mode === 'stopwatch') T.elapsed += dt;
      else {
        T.left = Math.max(0, T.left - dt);
        if (T.left === 0) {
          T.running = false;
          this.sfx.fanfare();
          this.notify('⏰  Focus session complete');
          T.left = T.total;
        }
      }
    }
    if (face) this.track(dt, t, face, info);
    this.tick += dt;
    if (this.tick < 0.1) return;
    this.tick = 0;
    this.render(t, face, info);
  }

  track(dt, t, f) {
    const P = this.bio.posture;
    if (P.bad > 12 && !this.alerted && this.isOn('posture')) { this.alerted = true; this.sfx.beep(false); this.notify('Sit up straight'); }
    if (P.bad < 1) this.alerted = false;

    // Reps: the head dipping by more than half a face height and coming back.
    const R = this.reps;
    const y = f.center[1];
    const fh = Math.max(f.height, 1);
    if (R.top == null || y < R.top) R.top = y;
    R.top += (y - R.top) * Math.min(1, dt * 0.15);
    if (!R.down && y - R.top > fh * 0.55) R.down = true;
    if (R.down && y - R.top < fh * 0.2) {
      R.down = false;
      R.count++;
      if (this.isOn('reps')) this.sfx.coin();
    }
  }

  render(t, f, info) {
    const now = new Date();
    if (this.els.has('clock')) {
      this.field('clock', 'time').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      this.field('clock', 'date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    }
    if (this.els.has('timer')) {
      const T = this.timer;
      this.field('timer', 't').textContent = fmt(T.mode === 'stopwatch' ? T.elapsed : T.left);
      const go = this.els.get('timer').querySelector('[data-a="go"]');
      go.textContent = T.running ? 'Pause' : 'Start';
    }
    const noFace = 'Looking for you…';
    if (this.els.has('posture')) {
      const P = this.bio.posture;
      const st = this.field('posture', 'st');
      const sub = this.field('posture', 'sub');
      if (!f) { st.textContent = noFace; st.dataset.s = ''; }
      else if (P.state === 'learning' || P.score == null) { st.textContent = 'Learning your posture…'; st.dataset.s = ''; sub.textContent = 'Sit how you normally sit up straight.'; }
      else {
        st.textContent = P.state === 'good' ? 'Great posture' : P.state === 'fair' ? 'Not bad' : 'Sit up straight';
        st.dataset.s = P.state === 'good' ? 'good' : P.state === 'fair' ? 'warn' : 'bad';
        sub.textContent = P.issues.length ? P.issues[0] : `Good posture ${Math.round((P.good / Math.max(P.total, 1)) * 100)}% of the time`;
      }
    }
    if (this.els.has('distance')) {
      const cmEl = this.field('distance', 'cm');
      const cmv = this.bio.distance;
      if (!f || cmv == null) cmEl.textContent = '-- cm';
      else {
        const cm = Math.round(cmv);
        cmEl.textContent = `${cm} cm`;
        const bar = this.field('distance', 'bar');
        bar.style.width = `${Math.max(4, Math.min(100, ((cm - 25) / 75) * 100))}%`;
        bar.dataset.s = cm < 45 ? 'bad' : cm > 90 ? 'warn' : 'good';
        this.field('distance', 'sub').textContent = cm < 45 ? 'Too close: lean back a little.' : cm > 90 ? 'Quite far away.' : 'Comfortable distance.';
      }
    }
    if (this.els.has('blink')) {
      const rate = this.bio.blinkRate(t);
      this.field('blink', 'rate').textContent = rate == null ? '--' : String(rate);
      const st = this.field('blink', 'st');
      st.textContent = !f ? noFace : rate == null ? 'Measuring…' : rate < 9 ? 'Blink more: eyes need rest' : 'Healthy blinking';
      st.dataset.s = rate != null && rate < 9 ? 'bad' : rate != null ? 'good' : '';
    }
    if (this.els.has('reps')) this.field('reps', 'n').textContent = String(this.reps.count);
    if (this.els.has('mood') && f) {
      const m = moodOf(f);
      this.field('mood', 'emoji').textContent = m.emoji;
      this.field('mood', 'label').textContent = m.label;
      for (const [k, v] of Object.entries(m.scores)) {
        const bar = this.field('mood', `m-${k}`);
        if (bar) bar.style.width = `${Math.round(v * 100)}%`;
      }
    }
    if (this.els.has('perf')) {
      this.field('perf', 'fps').textContent = `${info.fps} fps`;
      this.field('perf', 'ai').textContent = `${info.ai.toFixed(1)} ms`;
      this.field('perf', 'res').textContent = info.res;
    }
  }

  summary(f) {
    const parts = [];
    for (const w of WIDGETS) {
      if (!this.isOn(w.id)) continue;
      if (w.id === 'reps') parts.push(`rep counter: ${this.reps.count}`);
      else if (w.id === 'timer') parts.push(`timer: ${this.timer.mode} ${fmt(this.timer.mode === 'stopwatch' ? this.timer.elapsed : this.timer.left)}${this.timer.running ? ' running' : ''}`);
      else if (w.id === 'blink') parts.push(`blink rate: ${this.bio.blinkRate() ?? 'measuring'}`);
      else if (w.id === 'mood' && f) parts.push(`mood: ${moodOf(f).label}`);
      else parts.push(w.name.toLowerCase());
    }
    return parts.join('; ');
  }
}

export function moodOf(f) {
  const scores = {
    Happy: Math.min(1, f.smile * 1.2),
    Surprised: Math.min(1, (f.jaw * 0.6 + f.brows * 0.6)),
    Focused: Math.min(1, f.browDown * 1.4),
    Sad: Math.min(1, f.frown * 1.6),
  };
  let best = 'Calm', bv = 0.35;
  for (const [k, v] of Object.entries(scores)) if (v > bv) { best = k; bv = v; }
  const emoji = { Calm: '😌', Happy: '😄', Surprised: '😮', Focused: '🧐', Sad: '😟' }[best];
  return { label: best, emoji, scores };
}
