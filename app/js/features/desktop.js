// Playground: a small windowed desktop that lives inside the app, made for
// practising the hand cursor. Apps open in windows that can be dragged,
// focused and closed with a pinch or the mouse. Nothing here is saved.

const APPS = [
  { id: 'notes', name: 'Notes', icon: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>' },
  { id: 'calc', name: 'Calculator', icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>' },
  { id: 'piano', name: 'Piano', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v9M12 5v9M16 5v9M6.5 14v5M10.5 14v5M14 14v5M18 14v5"/>' },
  { id: 'paint', name: 'Paint', icon: '<path d="M19 3 9 13l2 2L21 5z"/><path d="M8 14c-2 0-3 1.5-3 3 0 1-1 2-2 2 3 2 7 1 7-2z"/>' },
  { id: 'cube', name: '3D Cube', icon: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class Desktop {
  constructor(root, sfx) {
    this.root = root;
    this.sfx = sfx;
    this.z = 10;
    this.drag = null;
    this.root.innerHTML = `<div class="app-rail">${APPS.map((a) => `
      <button class="app-icon" data-app="${a.id}" title="Open ${a.name}">
        <span class="app-glyph"><svg viewBox="0 0 24 24" class="ico">${a.icon}</svg></span><span>${a.name}</span>
      </button>`).join('')}</div>`;
    this.root.addEventListener('click', (e) => {
      const icon = e.target.closest('.app-icon');
      if (icon) this.open(icon.dataset.app, icon);
    });
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', () => { this.drag = null; });
    window.addEventListener('pointercancel', () => { this.drag = null; });
  }

  show(on) {
    this.root.hidden = !on;
  }

  open(id, from) {
    const existing = this.root.querySelector(`.win[data-app="${id}"]`);
    if (existing) { this.focus(existing); return; }
    const app = APPS.find((a) => a.id === id);
    const win = document.createElement('section');
    win.className = 'win opening';
    win.dataset.app = id;
    const count = this.root.querySelectorAll('.win').length;
    const W = window.innerWidth, H = window.innerHeight;
    const size = { notes: [320, 260], calc: [260, 340], piano: [520, 210], paint: [400, 320], cube: [300, 300] }[id];
    win.style.width = `${size[0]}px`;
    win.style.height = `${size[1]}px`;
    win.style.left = `${Math.min(W - size[0] - 20, 190 + count * 36)}px`;
    win.style.top = `${Math.min(H - size[1] - 200, 110 + count * 30)}px`;
    if (from) {
      const r = from.getBoundingClientRect();
      win.style.transformOrigin = `${r.left + r.width / 2 - parseFloat(win.style.left)}px ${r.top + r.height / 2 - parseFloat(win.style.top)}px`;
    }
    win.innerHTML = `
      <header class="win-bar"><span class="win-title">${app.name}</span><button class="win-close" title="Close">
        <svg viewBox="0 0 24 24" class="ico"><path d="M18 6 6 18M6 6l12 12"/></svg></button></header>
      <div class="win-body"></div>`;
    this.root.append(win);
    this.focus(win);
    requestAnimationFrame(() => win.classList.remove('opening'));
    win.addEventListener('pointerdown', () => this.focus(win));
    win.querySelector('.win-bar').addEventListener('pointerdown', (e) => {
      if (e.target.closest('.win-close')) return;
      this.drag = { win, dx: e.clientX - win.offsetLeft, dy: e.clientY - win.offsetTop };
    });
    win.querySelector('.win-close').addEventListener('click', () => {
      win.classList.add('closing');
      setTimeout(() => win.remove(), 220);
    });
    const body = win.querySelector('.win-body');
    ({ notes: notesApp, calc: calcApp, piano: pianoApp, paint: paintApp, cube: cubeApp })[id](body, this.sfx);
    this.sfx.click();
  }

  focus(win) {
    win.style.zIndex = String(++this.z);
    for (const w of this.root.querySelectorAll('.win')) w.classList.toggle('focused', w === win);
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    const W = window.innerWidth, H = window.innerHeight;
    d.win.style.left = `${Math.max(-d.win.offsetWidth + 80, Math.min(W - 80, e.clientX - d.dx))}px`;
    d.win.style.top = `${Math.max(60, Math.min(H - 60, e.clientY - d.dy))}px`;
  }
}

function notesApp(body) {
  body.innerHTML = '<textarea class="notes-area" placeholder="Type a note… (kept only until you close the app)"></textarea>';
}

// A tiny arithmetic evaluator; the page's security policy forbids eval.
function evaluate(expr) {
  const tokens = expr.match(/\d+(?:\.\d+)?|[+\-×÷]/g) || [];
  const out = [];
  const ops = [];
  const prec = { '+': 1, '-': 1, '×': 2, '÷': 2 };
  const apply = () => {
    const op = ops.pop();
    const b = out.pop(), a = out.pop();
    if (a === undefined || b === undefined) throw new Error('bad');
    out.push(op === '+' ? a + b : op === '-' ? a - b : op === '×' ? a * b : a / b);
  };
  let expectNumber = true;
  for (const t of tokens) {
    if (/\d/.test(t)) { out.push(parseFloat(t)); expectNumber = false; continue; }
    if (expectNumber && t === '-') { out.push(0); }
    while (ops.length && prec[ops[ops.length - 1]] >= prec[t]) apply();
    ops.push(t);
    expectNumber = true;
  }
  while (ops.length) apply();
  if (out.length !== 1 || !Number.isFinite(out[0])) throw new Error('bad');
  return Math.round(out[0] * 1e10) / 1e10;
}

function calcApp(body, sfx) {
  const keys = ['C', '⌫', '÷', '×', '7', '8', '9', '-', '4', '5', '6', '+', '1', '2', '3', '=', '0', '.'];
  body.innerHTML = `<div class="calc"><div class="calc-display">0</div><div class="calc-keys">${keys.map((k) => `<button class="calc-key${'÷×-+='.includes(k) ? ' op' : ''}${k === '=' ? ' eq' : ''}${k === '0' ? ' wide' : ''}" data-k="${k}">${k}</button>`).join('')}</div></div>`;
  const display = body.querySelector('.calc-display');
  let expr = '';
  body.addEventListener('click', (e) => {
    const b = e.target.closest('.calc-key');
    if (!b) return;
    const k = b.dataset.k;
    sfx.click();
    if (k === 'C') expr = '';
    else if (k === '⌫') expr = expr.slice(0, -1);
    else if (k === '=') {
      try { expr = String(evaluate(expr)); } catch { display.textContent = 'Error'; expr = ''; return; }
    } else expr += k;
    display.textContent = expr || '0';
  });
}

function pianoApp(body, sfx) {
  const keys = [];
  for (let i = 0; i < 24; i++) keys.push({ i, name: NOTE_NAMES[i % 12], black: NOTE_NAMES[i % 12].includes('#') });
  const whites = keys.filter((k) => !k.black);
  body.innerHTML = `<div class="piano">${whites.map((k) => `<button class="piano-key white" data-i="${k.i}"></button>`).join('')}${keys.filter((k) => k.black).map((k) => {
    const w = whites.findIndex((x) => x.i === k.i - 1);
    return `<button class="piano-key black" data-i="${k.i}" style="left:calc(${(w + 1) * (100 / whites.length)}% - 3.2%)"></button>`;
  }).join('')}</div>`;
  let last = null;
  const play = (el) => {
    if (!el || el === last) return;
    last = el;
    sfx.note(261.63 * Math.pow(2, Number(el.dataset.i) / 12));
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 180);
  };
  body.addEventListener('pointerdown', (e) => play(e.target.closest('.piano-key')));
  body.addEventListener('pointermove', (e) => { if (e.buttons) play(e.target.closest('.piano-key')); });
  window.addEventListener('pointerup', () => { last = null; });
}

function paintApp(body) {
  body.innerHTML = `<div class="paint"><canvas></canvas><div class="paint-bar">${['#ffa51f', '#ff4d6d', '#38bdf8', '#34d399', '#fafaf5'].map((c, i) => `<button class="paint-swatch${i === 0 ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}<button class="pill-btn ghost paint-clear">Clear</button></div></div>`;
  const canvas = body.querySelector('canvas');
  const g = canvas.getContext('2d');
  let color = '#ffa51f';
  let drawing = false;
  let lx = 0, ly = 0;
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.lineCap = 'round';
    g.lineJoin = 'round';
  };
  requestAnimationFrame(fit);
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; [lx, ly] = pos(e); });
  window.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    g.strokeStyle = color;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(lx, ly);
    g.lineTo(x, y);
    g.stroke();
    lx = x; ly = y;
  });
  window.addEventListener('pointerup', () => { drawing = false; });
  body.addEventListener('click', (e) => {
    const sw = e.target.closest('.paint-swatch');
    if (sw) {
      color = sw.dataset.c;
      for (const s of body.querySelectorAll('.paint-swatch')) s.classList.toggle('on', s === sw);
    }
    if (e.target.closest('.paint-clear')) g.clearRect(0, 0, canvas.width, canvas.height);
  });
}

function cubeApp(body) {
  const faces = ['S', 'Y', 'R', 'I', 'X', '◎'];
  body.innerHTML = `<div class="cube-stage"><div class="cube">${faces.map((f, i) => `<div class="face f${i}">${f}</div>`).join('')}</div><p class="cube-tip">Drag to spin</p></div>`;
  const cube = body.querySelector('.cube');
  let rx = -22, ry = 35, vx = 0, vy = 0.4, dragging = false, lx = 0, ly = 0;
  const stage = body.querySelector('.cube-stage');
  stage.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    vy = (e.clientX - lx) * 0.5;
    vx = -(e.clientY - ly) * 0.5;
    lx = e.clientX;
    ly = e.clientY;
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  const tick = () => {
    if (!cube.isConnected) return;
    rx += vx;
    ry += vy;
    if (!dragging) { vx *= 0.95; vy = vy * 0.95 + 0.4 * 0.05; }
    cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    requestAnimationFrame(tick);
  };
  tick();
}
