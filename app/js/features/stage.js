// Stage: things Syrix creates on top of the camera picture: drawings it
// writes as SVG, text, emoji and charts. Objects can be moved with the mouse
// or the hand cursor, edited by Syrix ("turn it into a rocket", "make it
// red"), animated, and pinned to the head or a hand so they follow the
// person. Nothing here is saved.
//
// SVG from the model is untrusted markup, so it is parsed and rebuilt from an
// allow-list of drawing elements and attributes: no scripts, event handlers,
// links, external references or foreign content survive.

const ELEMENTS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode',
  'feColorMatrix', 'feBlend', 'feFlood', 'feComposite', 'feDropShadow', 'pattern', 'symbol', 'use', 'image',
  'feTurbulence', 'feDisplacementMap', 'feSpecularLighting', 'feDiffuseLighting', 'fePointLight', 'feDistantLight', 'feSpotLight',
  'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA', 'feMorphology', 'feImage', 'feTile',
  'animate', 'animateTransform', 'animateMotion', 'mpath', 'set', 'textPath']);
const ATTRS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity',
  'fill-rule', 'clip-rule', 'transform', 'viewBox', 'id', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
  'fx', 'fy', 'font-size', 'font-weight', 'font-family', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'clip-path',
  'mask', 'filter', 'stdDeviation', 'in', 'in2', 'result', 'dx', 'dy', 'mode', 'operator', 'values', 'type', 'flood-color', 'flood-opacity',
  'preserveAspectRatio', 'k1', 'k2', 'k3', 'k4', 'maskUnits', 'filterUnits', 'patternUnits', 'spreadMethod',
  'patternContentUnits', 'patternTransform', 'maskContentUnits', 'primitiveUnits', 'href', 'stroke-dashoffset', 'paint-order', 'vector-effect',
  'baseFrequency', 'numOctaves', 'seed', 'stitchTiles', 'scale', 'xChannelSelector', 'yChannelSelector', 'radius',
  'surfaceScale', 'specularConstant', 'specularExponent', 'diffuseConstant', 'lighting-color', 'azimuth', 'elevation', 'z',
  'pointsAtX', 'pointsAtY', 'pointsAtZ', 'limitingConeAngle', 'slope', 'intercept', 'amplitude', 'exponent', 'tableValues',
  'attributeName', 'attributeType', 'dur', 'repeatCount', 'from', 'to', 'by', 'begin', 'end', 'keyTimes', 'keySplines', 'calcMode',
  'additive', 'accumulate', 'rotate', 'path', 'keyPoints', 'fill-rule', 'mix-blend-mode', 'startOffset', 'textLength', 'lengthAdjust']);
// href is kept only for in-document references and embedded raster images
// (the camera photo); animations may not retarget href or event attributes.
const SAFE_HREF = /^(#[\w-]+|data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+)$/;
const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color'];
export const ANIMATIONS = ['none', 'float', 'spin', 'pulse', 'bounce', 'wobble', 'glow', 'shake', 'orbit', 'launch'];
export const ANCHORS = ['screen', 'head', 'face', 'hand'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function sanitizeSvg(markup) {
  let src = String(markup || '').trim().slice(0, 3000000);
  src = src.replace(/^```(?:svg|xml|html)?\s*/i, '').replace(/```\s*$/, '');
  if (!/^<svg[\s>]/i.test(src)) src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${src}</svg>`;
  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const clean = (node) => {
    const name = node.localName;
    if (!ELEMENTS.has(name)) return null;
    const out = document.createElementNS(NS, name);
    for (const a of node.attributes) {
      const k = a.name === 'xlink:href' ? 'href' : a.name;
      if (!ATTRS.has(k)) continue;
      const v = a.value;
      if (k === 'href') {
        if (!SAFE_HREF.test(v.trim())) continue;
        if (name !== 'image' && name !== 'feImage' && !v.startsWith('#')) continue;
        out.setAttribute('href', v.trim());
        continue;
      }
      if (k === 'attributeName' && /^(href|xlink:href|on\w+|style)$/i.test(v.trim())) continue;
      if (/url\(/i.test(v) && !/^\s*url\(\s*#[\w-]+\s*\)\s*$/i.test(v)) continue;
      if (/javascript:|expression\(|@import/i.test(v)) continue;
      out.setAttribute(k, v.slice(0, 20000));
    }
    if ((name === 'image' || name === 'use' || name === 'feImage') && !out.getAttribute('href')) return null;
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { if (name === 'text' || name === 'tspan') out.append(c.textContent.slice(0, 200)); continue; }
      if (c.nodeType !== 1) continue;
      const cc = clean(c);
      if (cc) out.append(cc);
    }
    return out;
  };
  const svg = clean(root);
  if (!svg) return null;
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(root.getAttribute('width')) || 100, h = parseFloat(root.getAttribute('height')) || 100;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('xmlns', NS);
  return svg.outerHTML;
}

// Recolours artwork towards one hue while keeping each shape's lightness, so
// shading and highlights survive ("make it red" on a shaded rocket).
export function recolor(svg, target) {
  const t = toHsl(target);
  if (!t) return svg;
  return svg.replace(new RegExp(`(${COLOR_ATTRS.join('|')})="([^"]+)"`, 'g'), (m, attr, val) => {
    const c = toHsl(val);
    if (!c) return m;
    if (c.s < 0.08 && (c.l > 0.92 || c.l < 0.08)) return m;
    const l = clamp(c.l * 0.6 + t.l * 0.4, 0.05, 0.95);
    return `${attr}="hsl(${Math.round(t.h)} ${Math.round(t.s * 100)}% ${Math.round(l * 100)}%)"`;
  });
}

let probe = null;
function toHsl(color) {
  if (!color || /^(none|transparent|currentColor|inherit)$/i.test(color) || /url\(/i.test(color)) return null;
  if (!probe) probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#010203';
  probe.fillStyle = color;
  const v = probe.fillStyle;
  if (v === '#010203' && !/^#010203$/i.test(color)) return null;
  let r, g, b;
  if (v[0] === '#') { const n = parseInt(v.slice(1), 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; } else {
    const m = v.match(/\d+(\.\d+)?/g);
    if (!m) return null;
    [r, g, b] = m.map(Number);
  }
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

// ---------------------------------------------------------------- charts

export function chartSvg(spec) {
  const W = 420, H = 250, pad = { l: 46, r: 16, t: 44, b: 34 };
  const kind = spec.kind || 'line';
  const color = spec.color || '#7dd3fc';
  const title = esc(spec.title || '');
  const sub = esc(spec.subtitle || '');
  const head = `<rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="rgba(12,14,20,0.82)" stroke="rgba(255,255,255,0.14)"/>
    <text x="18" y="26" fill="#fff" font-size="15" font-weight="700" font-family="Segoe UI, sans-serif">${title}</text>
    <text x="${W - 16}" y="26" fill="${spec.subColor || 'rgba(255,255,255,0.7)'}" font-size="13" font-weight="600" text-anchor="end" font-family="Segoe UI, sans-serif">${sub}</text>`;
  if (kind === 'pie') {
    const vals = (spec.values || []).map(Number).filter((v) => v > 0);
    const total = vals.reduce((s, v) => s + v, 0) || 1;
    const palette = ['#7dd3fc', '#f472b6', '#facc15', '#34d399', '#a78bfa', '#fb923c', '#f87171', '#60a5fa'];
    let a0 = -Math.PI / 2;
    const cx = 120, cy = 145, r = 80;
    const arcs = vals.map((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`;
      a0 = a1;
      return `<path d="${d}" fill="${palette[i % palette.length]}" stroke="rgba(12,14,20,0.9)" stroke-width="2"/>`;
    }).join('');
    const legend = (spec.labels || []).slice(0, vals.length).map((l, i) => `<rect x="236" y="${70 + i * 22}" width="12" height="12" rx="3" fill="${palette[i % palette.length]}"/><text x="254" y="${80 + i * 22}" fill="#e5e7eb" font-size="12" font-family="Segoe UI, sans-serif">${esc(l)} · ${Math.round((vals[i] / total) * 100)}%</text>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${head}${arcs}${legend}</svg>`;
  }
  const ys = (spec.values || []).map(Number).filter((v) => isFinite(v));
  if (ys.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${head}<text x="${W / 2}" y="${H / 2}" fill="#aaa" text-anchor="middle" font-size="14">No data</text></svg>`;
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (kind === 'bar') lo = Math.min(0, lo);
  const span = hi - lo || 1;
  lo -= span * 0.06; hi += span * 0.06;
  const X = (i) => pad.l + (i / (ys.length - 1)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const grid = [0, 0.5, 1].map((k) => {
    const v = lo + (hi - lo) * k;
    return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,0.08)"/><text x="${pad.l - 6}" y="${Y(v) + 4}" fill="rgba(255,255,255,0.55)" font-size="10" text-anchor="end" font-family="Segoe UI, sans-serif">${fmtNum(v)}</text>`;
  }).join('');
  const labels = spec.labels || [];
  const xl = labels.length ? [0, Math.floor(labels.length / 2), labels.length - 1].map((i) => `<text x="${X(Math.min(i, ys.length - 1))}" y="${H - 12}" fill="rgba(255,255,255,0.55)" font-size="10" text-anchor="middle" font-family="Segoe UI, sans-serif">${esc(labels[i] || '')}</text>`).join('') : '';
  let body;
  if (kind === 'bar') {
    const bw = Math.max(2, ((W - pad.l - pad.r) / ys.length) * 0.7);
    body = ys.map((v, i) => `<rect x="${X(i) - bw / 2}" y="${Math.min(Y(v), Y(0))}" width="${bw}" height="${Math.abs(Y(v) - Y(Math.max(lo, 0)))}" rx="2" fill="${color}"/>`).join('');
  } else {
    const pts = ys.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    body = `<defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <polygon points="${X(0)},${Y(lo)} ${pts} ${X(ys.length - 1)},${Y(lo)}" fill="url(#cg)"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(ys.length - 1)}" cy="${Y(ys[ys.length - 1])}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${head}${grid}${body}${xl}</svg>`;
}

function fmtNum(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (a >= 100) return v.toFixed(0);
  return v.toFixed(2);
}

// ---------------------------------------------------------------- stage

export class Stage {
  constructor(root, { sfx, onChange }) {
    this.root = root;
    this.sfx = sfx;
    this.onChange = onChange || (() => {});
    this.objects = new Map();
    this.next = 1;
    this.drag = null;
    this.last = null;
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', () => this.endDrag());
    window.addEventListener('pointercancel', () => this.endDrag());
    root.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.stage-obj');
      if (!el) return;
      if (e.target.closest('.so-x')) { this.remove(el.dataset.id); return; }
      const o = this.objects.get(el.dataset.id);
      if (!o) return;
      if (o.anchor !== 'screen') { o.anchor = 'screen'; }
      this.drag = { o, dx: e.clientX - (o.x / 100) * innerWidth, dy: e.clientY - (o.y / 100) * innerHeight };
      el.classList.add('dragging');
      this.bringToFront(o);
    });
    root.addEventListener('wheel', (e) => {
      const el = e.target.closest('.stage-obj');
      if (!el) return;
      e.preventDefault();
      const o = this.objects.get(el.dataset.id);
      o.w = clamp(o.w * (e.deltaY < 0 ? 1.08 : 0.92), 3, 95);
      this.place(o);
    }, { passive: false });
  }

  get count() { return this.objects.size; }

  resolve(id) {
    if (id == null || id === '' || id === 'last' || id === 'it' || id === 'this') return this.last ? this.objects.get(this.last) : null;
    const key = String(id).replace(/^#/, '');
    return this.objects.get(key) || [...this.objects.values()].find((o) => o.name && o.name.toLowerCase() === String(id).toLowerCase()) || null;
  }

  // spec: { name, kind: svg|text|emoji|chart, svg, text, emoji, chart, x, y,
  // size, rotation, color, animation, anchor, opacity }
  create(spec) {
    const id = String(this.next++);
    const o = { id, name: spec.name || spec.kind || 'object', kind: spec.kind || 'svg', x: 50, y: 45, w: 22, rot: 0, anchor: 'screen', animation: 'none', opacity: 1, art: '' };
    const el = document.createElement('div');
    el.className = 'stage-obj appear';
    el.dataset.id = id;
    el.innerHTML = '<div class="so-anim"><div class="so-art"></div></div><button class="so-x" title="Remove">×</button>';
    o.el = el;
    this.objects.set(id, o);
    this.root.append(el);
    const err = this.apply(o, spec, true);
    if (err) { this.remove(id, true); return { ok: false, message: err }; }
    this.makeRoom(o, spec.x == null && spec.y == null);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('appear')));
    this.last = id;
    this.sfx.sparkle();
    this.onChange();
    return { ok: true, id, message: `Created #${id} (${o.name})` };
  }

  update(id, spec) {
    const o = this.resolve(id);
    if (!o) return { ok: false, message: `No object ${id}. Objects: ${this.list() || 'none'}` };
    const err = this.apply(o, spec, false);
    if (err) return { ok: false, message: err };
    o.el.classList.remove('morph');
    void o.el.offsetWidth;
    o.el.classList.add('morph');
    this.last = o.id;
    this.onChange();
    return { ok: true, id: o.id, message: `Updated #${o.id} (${o.name})` };
  }

  apply(o, spec, fresh) {
    if (spec.name) o.name = String(spec.name).slice(0, 40);
    if (spec.kind) o.kind = spec.kind;
    let art = null;
    if (spec.svg) {
      art = sanitizeSvg(spec.svg);
      if (!art) return 'That SVG could not be read. Send one complete <svg> element with a viewBox.';
      o.kind = 'svg';
      o.base = art;
    } else if (spec.text != null && (spec.kind === 'text' || o.kind === 'text' || fresh)) {
      o.kind = 'text';
      o.text = String(spec.text).slice(0, 200);
      art = `<div class="so-text">${esc(o.text)}</div>`;
    } else if (spec.emoji) {
      o.kind = 'emoji';
      o.emoji = String(spec.emoji).slice(0, 16);
      art = `<div class="so-emoji">${esc(o.emoji)}</div>`;
    } else if (spec.chart) {
      o.kind = 'chart';
      o.chart = { ...(o.chart || {}), ...spec.chart };
      art = chartSvg(o.chart);
      o.base = art;
    }
    if (art) o.art = art;
    if (spec.color) {
      if (o.kind === 'chart') { o.chart.color = spec.color; o.art = chartSvg(o.chart); }
      else if (o.kind === 'svg' && o.base) o.art = recolor(o.base, spec.color);
      else o.color = spec.color;
    }
    if (!o.art) return 'Nothing to draw: give svg, text, emoji or chart.';
    o.el.querySelector('.so-art').innerHTML = o.art;
    o.el.classList.toggle('is-text', o.kind === 'text');
    o.el.classList.toggle('is-chart', o.kind === 'chart');
    if (o.color && (o.kind === 'text' || o.kind === 'emoji')) o.el.style.setProperty('--so-color', o.color);
    if (spec.x != null) o.x = clamp(Number(spec.x), 0, 100);
    if (spec.y != null) o.y = clamp(Number(spec.y), 0, 100);
    if (spec.size != null) o.w = clamp(Number(spec.size), 3, o.kind === 'chart' ? 45 : 95);
    else if (fresh && o.kind === 'chart') o.w = 34;
    if (spec.rotation != null) o.rot = Number(spec.rotation) || 0;
    if (spec.opacity != null) o.opacity = clamp(Number(spec.opacity), 0.1, 1);
    if (spec.anchor && ANCHORS.includes(spec.anchor)) o.anchor = spec.anchor;
    if (spec.animation && ANIMATIONS.includes(spec.animation)) {
      o.animation = spec.animation;
      const a = o.el.querySelector('.so-anim');
      a.className = `so-anim${o.animation !== 'none' ? ` anim-${o.animation}` : ''}`;
      if (o.animation === 'launch') this.sfx.whoosh();
    }
    this.place(o);
    return null;
  }

  // New objects never land on top of existing ones: an unplaced object goes
  // to the first free spot around the centre, and a placed one is nudged
  // sideways until it no longer overlaps.
  makeRoom(o, unplaced) {
    const others = [...this.objects.values()].filter((x) => x !== o && x.anchor === 'screen');
    if (!others.length) return;
    const clash = (x, y) => others.some((b) => Math.abs(b.x - x) < (b.w + o.w) / 2 * 0.85 && Math.abs(b.y - y) < Math.max(14, (b.w + o.w) / 3));
    if (!clash(o.x, o.y)) return;
    const spots = unplaced ? [[50, 40], [28, 40], [72, 40], [28, 62], [72, 62], [50, 22]] : [[o.x + 30, o.y], [o.x - 30, o.y], [o.x, o.y - 25], [o.x + 30, o.y - 20], [o.x - 30, o.y - 20]];
    for (const [x, y] of spots) {
      const cx = clamp(x, o.w / 2, 100 - o.w / 2), cy = clamp(y, 12, 80);
      if (!clash(cx, cy)) { o.x = cx; o.y = cy; this.place(o); return; }
    }
  }

  remove(id, quiet) {
    if (id === 'all') {
      const n = this.objects.size;
      for (const o of [...this.objects.values()]) this.remove(o.id, true);
      this.onChange();
      return { ok: true, message: n ? `Removed ${n} object${n === 1 ? '' : 's'}` : 'Nothing to remove' };
    }
    const o = this.resolve(id);
    if (!o) return { ok: false, message: `No object ${id}` };
    this.objects.delete(o.id);
    o.el.classList.add('leaving');
    setTimeout(() => o.el.remove(), 320);
    if (this.last === o.id) this.last = [...this.objects.keys()].pop() || null;
    if (!quiet) { this.sfx.pop(); this.onChange(); }
    return { ok: true, message: `Removed #${o.id}` };
  }

  bringToFront(o) {
    this.root.append(o.el);
  }

  place(o, px, py, scale = 1) {
    const x = px != null ? px : (o.x / 100) * innerWidth;
    const y = py != null ? py : (o.y / 100) * innerHeight;
    const w = (o.w / 100) * innerWidth * scale;
    o.el.style.width = `${w}px`;
    o.el.style.opacity = String(o.opacity);
    o.el.style.transform = `translate(${x - w / 2}px, ${y}px) translateY(-50%) rotate(${o.rot}deg)`;
  }

  // Anchored objects follow the head or a hand every frame.
  frame(faces, hands) {
    for (const o of this.objects.values()) {
      if (o.anchor === 'screen' || this.drag?.o === o) continue;
      if (o.anchor === 'hand') {
        const h = hands[0];
        if (!h) continue;
        this.place(o, h.x(8), h.y(8) - h.size * 0.9, h.size / (innerWidth * 0.12) / Math.max(0.2, o.w / 22));
        continue;
      }
      const f = faces[0];
      if (!f) continue;
      const scale = (f.width * 1.25) / ((o.w / 100) * innerWidth);
      if (o.anchor === 'head') this.place(o, f.forehead[0] + (f.forehead[0] - f.chin[0]) * 0.35, f.forehead[1] - f.height * 0.45, scale);
      else this.place(o, f.center[0], f.center[1], scale);
    }
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    d.o.x = clamp(((e.clientX - d.dx) / innerWidth) * 100, 0, 100);
    d.o.y = clamp(((e.clientY - d.dy) / innerHeight) * 100, 0, 100);
    this.place(d.o);
  }

  endDrag() {
    if (!this.drag) return;
    this.drag.o.el.classList.remove('dragging');
    this.drag = null;
  }

  relayout() { for (const o of this.objects.values()) if (o.anchor === 'screen') this.place(o); }

  // Renders an object to a JPEG on a neutral background, so Syrix can look
  // at its own drawing and correct it.
  async render(id) {
    const o = this.resolve(id);
    if (!o || !o.art) return null;
    const size = 768;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, '#3a3a40');
    bg.addColorStop(1, '#1d1d21');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    if (o.kind === 'svg' || o.kind === 'chart') {
      const url = URL.createObjectURL(new Blob([o.art], { type: 'image/svg+xml' }));
      try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const vb = (o.art.match(/viewBox="([^"]+)"/) || [])[1];
        const [, , vw = 1, vh = 1] = vb ? vb.split(/[\s,]+/).map(Number) : [];
        const k = (size * 0.9) / Math.max(vw, vh);
        ctx.drawImage(img, (size - vw * k) / 2, (size - vh * k) / 2, vw * k, vh * k);
      } catch {
        return null;
      } finally {
        URL.revokeObjectURL(url);
      }
    } else {
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = o.kind === 'emoji' ? '360px "Segoe UI Emoji"' : '700 64px "Segoe UI", sans-serif';
      ctx.fillText(o.kind === 'emoji' ? (o.emoji || '') : (o.text || ''), size / 2, size / 2, size * 0.9);
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
    if (!blob) return null;
    const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
    return dataUrl ? { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) } : null;
  }

  list() {
    return [...this.objects.values()].map((o) => `#${o.id} ${o.name} (${o.kind}${o.kind === 'chart' && o.chart ? ` ${o.chart.title || ''}` : ''}, at ${Math.round(o.x)}%,${Math.round(o.y)}%, size ${Math.round(o.w)}%${o.anchor !== 'screen' ? `, pinned to ${o.anchor}` : ''}${o.animation !== 'none' ? `, ${o.animation}` : ''})`).join('; ');
  }
}
