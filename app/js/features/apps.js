// Apps Syrix builds: games, 3D scenes, simulations and tools written as one
// HTML document and run in a floating window over the camera picture.
//
// Each app runs in sandbox.html inside an iframe sandboxed without
// same-origin (see that file): the code gets an opaque origin, no network and
// no access to this page. three.js and its orbit controls are handed over as
// text. The page forwards live hand and face positions to the app so games
// can be played with the camera, and reports errors back so Syrix can fix
// its own code. Nothing is saved.

const LIBS = { three: 'vendor/three/three.module.min.js', orbit: 'vendor/three/OrbitControls.js' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let libText = null;
async function libs() {
  if (!libText) {
    libText = (async () => {
      const out = {};
      for (const [k, url] of Object.entries(LIBS)) out[k] = await (await fetch(url)).text();
      return out;
    })().catch((err) => { libText = null; throw err; });
  }
  return libText;
}

export class Apps {
  constructor(root, { sfx, onChange }) {
    this.root = root;
    this.sfx = sfx;
    this.onChange = onChange || (() => {});
    this.apps = new Map();
    this.next = 1;
    this.last = null;
    this.drag = null;
    window.addEventListener('message', (e) => this.onMessage(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', () => this.endDrag());
    window.addEventListener('resize', () => { for (const a of this.apps.values()) this.place(a); });
  }

  get count() { return this.apps.size; }

  resolve(id) {
    if (id == null || id === '' || id === 'last' || id === 'it' || id === 'this') return this.last ? this.apps.get(this.last) : null;
    const key = String(id).replace(/^#?a?/, '');
    return this.apps.get(key) || [...this.apps.values()].find((a) => a.title.toLowerCase() === String(id).toLowerCase()) || null;
  }

  // spec: { title, html, x, y, width, height (percent of the screen), photo }
  async create(spec) {
    const id = String(this.next++);
    const a = {
      id, title: String(spec.title || 'App').slice(0, 60), html: '', photo: spec.photo || null,
      x: clamp(Number(spec.x ?? 56), 5, 95), y: clamp(Number(spec.y ?? 48), 8, 92),
      w: clamp(Number(spec.width ?? 52), 20, 96), h: clamp(Number(spec.height ?? 62), 20, 92),
      max: false, errors: [], state: 'loading',
    };
    const el = document.createElement('section');
    el.className = 'app-win appear';
    el.dataset.id = id;
    el.innerHTML = `<header class="app-bar"><span class="app-dot"></span><b class="app-title"></b><span class="app-state">Building…</span>
      <button class="app-btn" data-a="reload" title="Restart"><svg viewBox="0 0 24 24" class="ico"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>
      <button class="app-btn" data-a="max" title="Expand"><svg viewBox="0 0 24 24" class="ico"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>
      <button class="app-btn close" data-a="close" title="Close"><svg viewBox="0 0 24 24" class="ico"><path d="M18 6 6 18M6 6l12 12"/></svg></button></header>
      <div class="app-body"><div class="app-loading"><span class="app-spin"></span><span>Syrix is building this…</span></div></div><i class="app-grip" aria-hidden="true"></i>`;
    a.el = el;
    el.querySelector('.app-title').textContent = a.title;
    el.addEventListener('pointerdown', (e) => this.onDown(e, a));
    this.apps.set(id, a);
    this.root.append(el);
    this.place(a);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('appear')));
    this.last = id;
    this.sfx.sparkle();
    const r = await this.load(a, spec.html);
    this.onChange();
    return { ...r, id, message: `Created app #a${id} (${a.title}). ${r.report}` };
  }

  async update(id, spec) {
    const a = this.resolve(id);
    if (!a) return { ok: false, message: `No app ${id}. Apps: ${this.list() || 'none'}` };
    if (spec.title) { a.title = String(spec.title).slice(0, 60); a.el.querySelector('.app-title').textContent = a.title; }
    for (const k of ['x', 'y']) if (spec[k] != null) a[k] = clamp(Number(spec[k]), 5, 95);
    if (spec.width != null) a.w = clamp(Number(spec.width), 20, 96);
    if (spec.height != null) a.h = clamp(Number(spec.height), 20, 92);
    if (spec.photo) a.photo = spec.photo;
    this.place(a);
    this.last = a.id;
    if (!spec.html) return { ok: true, id: a.id, message: `Updated app #a${a.id}` };
    const r = await this.load(a, spec.html);
    return { ...r, id: a.id, message: `Updated app #a${a.id} (${a.title}). ${r.report}` };
  }

  remove(id) {
    if (id === 'all') {
      const n = this.apps.size;
      for (const a of [...this.apps.values()]) this.close(a);
      this.onChange();
      return { ok: true, message: n ? `Closed ${n} app${n === 1 ? '' : 's'}` : 'No apps open' };
    }
    const a = this.resolve(id);
    if (!a) return { ok: false, message: `No app ${id}` };
    this.close(a);
    this.onChange();
    return { ok: true, message: `Closed app #a${a.id}` };
  }

  close(a) {
    this.apps.delete(a.id);
    a.el.classList.add('leaving');
    setTimeout(() => a.el.remove(), 320);
    if (this.last === a.id) this.last = [...this.apps.keys()].pop() || null;
    this.sfx.pop();
  }

  // Loads (or reloads) an app's HTML into a fresh sandboxed frame and waits
  // briefly for it to start, collecting any errors it throws on the way.
  async load(a, html) {
    const src = String(html || '').replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!src) return { ok: false, report: 'No HTML was given.' };
    a.html = src.slice(0, 400000);
    a.errors = [];
    a.state = 'loading';
    this.setState(a, 'Building…');
    let lib;
    try { lib = await libs(); } catch { lib = {}; }
    const body = a.el.querySelector('.app-body');
    const old = body.querySelector('iframe');
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    frame.setAttribute('allow', 'fullscreen');
    frame.title = a.title;
    frame.src = 'sandbox.html';
    a.frame = frame;
    const started = new Promise((resolve) => { a.onReady = resolve; });
    a.onRunning = null;
    body.append(frame);
    if (old) old.remove();
    const ready = await Promise.race([started, new Promise((r) => setTimeout(() => r(false), 4000))]);
    if (ready === false) { this.setState(a, 'Failed to start'); return { ok: false, report: 'The app frame did not start.' }; }
    frame.contentWindow.postMessage({ type: 'load', html: a.html, libs: lib, photo: a.photo }, '*');
    // Errors usually surface while the scene is set up or on the first frames.
    await new Promise((r) => setTimeout(r, 1500));
    a.el.querySelector('.app-loading')?.remove();
    a.state = a.errors.length ? 'error' : 'running';
    this.setState(a, a.errors.length ? 'Error' : '');
    const report = a.errors.length
      ? `It threw ${a.errors.length} error${a.errors.length === 1 ? '' : 's'}: ${a.errors.slice(0, 3).join(' | ')}. Fix the code with update_app.`
      : 'It is running with no errors.';
    return { ok: !a.errors.length, report };
  }

  setState(a, text) {
    const s = a.el.querySelector('.app-state');
    s.textContent = text;
    s.hidden = !text;
    a.el.classList.toggle('has-error', a.state === 'error');
  }

  onMessage(e) {
    const m = e.data;
    if (!m || m.type !== 'syrix-app') return;
    const a = [...this.apps.values()].find((x) => x.frame && x.frame.contentWindow === e.source);
    if (!a) return;
    if (m.event === 'ready' && a.onReady) { a.onReady(true); a.onReady = null; }
    else if (m.event === 'error') {
      const msg = String(m.message || 'Unknown error').slice(0, 400);
      if (a.errors.length < 8 && !a.errors.includes(msg)) a.errors.push(msg);
      if (a.state === 'running') { a.state = 'error'; this.setState(a, 'Error'); }
    }
  }

  // ---------------------------------------------------------------- input

  // Hands and face in each app's own 0-1 coordinates (mirrored like the
  // view), sent to every running app.
  feed(hands, faces) {
    if (!this.apps.size) return;
    for (const a of this.apps.values()) {
      if (!a.frame || !a.frame.contentWindow || a.state === 'loading') continue;
      const r = a.frame.getBoundingClientRect();
      if (!r.width) continue;
      const nx = (x) => (x - r.left) / r.width, ny = (y) => (y - r.top) / r.height;
      const msg = {
        type: 'input',
        hands: hands.slice(0, 2).map((h) => ({
          x: nx(h.x(8)), y: ny(h.y(8)), palmX: nx(h.palm[0]), palmY: ny(h.palm[1]),
          pinch: h.pinch < 0.35, open: !!h.open, fist: !!h.fist, fingers: h.count,
          gesture: h.gesture && h.gesture !== 'None' ? h.gesture : null, side: h.label || null,
        })),
        face: faces[0] ? {
          x: nx(faces[0].center[0]), y: ny(faces[0].center[1]),
          yaw: faces[0].pose ? faces[0].pose.yaw : 0, pitch: faces[0].pose ? faces[0].pose.pitch : 0,
          smile: faces[0].smile, mouthOpen: faces[0].jaw, blink: Math.max(faces[0].blinkA, faces[0].blinkB),
        } : null,
      };
      a.frame.contentWindow.postMessage(msg, '*');
    }
  }

  // ---------------------------------------------------------------- window

  place(a) {
    const W = innerWidth, H = innerHeight;
    if (a.max) {
      Object.assign(a.el.style, { left: '110px', top: '78px', width: `${W - 130}px`, height: `${H - 300}px` });
      return;
    }
    const w = (a.w / 100) * W, h = (a.h / 100) * H;
    const x = clamp((a.x / 100) * W - w / 2, 8, W - w - 8), y = clamp((a.y / 100) * H - h / 2, 70, H - h - 8);
    Object.assign(a.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  onDown(e, a) {
    this.root.append(a.el);
    const btn = e.target.closest('[data-a]');
    if (btn) {
      const act = btn.dataset.a;
      if (act === 'close') this.remove(a.id);
      else if (act === 'reload') this.load(a, a.html);
      else if (act === 'max') { a.max = !a.max; a.el.classList.toggle('max', a.max); this.place(a); }
      return;
    }
    const grip = e.target.closest('.app-grip');
    if (!grip && !e.target.closest('.app-bar')) return;
    e.preventDefault();
    const r = a.el.getBoundingClientRect();
    this.drag = { a, mode: grip ? 'size' : 'move', sx: e.clientX, sy: e.clientY, r };
    a.el.classList.add('dragging');
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    const W = innerWidth, H = innerHeight;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    const a = d.a;
    a.max = false;
    a.el.classList.remove('max');
    if (d.mode === 'move') {
      a.x = clamp(((d.r.left + dx + d.r.width / 2) / W) * 100, 5, 95);
      a.y = clamp(((d.r.top + dy + d.r.height / 2) / H) * 100, 8, 92);
    } else {
      const w = clamp(d.r.width + dx, 260, W - 20), h = clamp(d.r.height + dy, 200, H - 90);
      a.w = (w / W) * 100;
      a.h = (h / H) * 100;
      a.x = ((d.r.left + w / 2) / W) * 100;
      a.y = ((d.r.top + h / 2) / H) * 100;
    }
    this.place(a);
  }

  endDrag() {
    if (!this.drag) return;
    this.drag.a.el.classList.remove('dragging');
    this.drag = null;
  }

  list() {
    return [...this.apps.values()].map((a) => `#a${a.id} ${esc(a.title)} (${a.state}${a.errors.length ? `, ${a.errors.length} errors` : ''})`).join('; ');
  }
}
