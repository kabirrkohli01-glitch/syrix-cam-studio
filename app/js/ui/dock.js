import { MODES } from '../catalog.js';

// Camera-style controls: a carousel whose centred item is the selection
// (with the shutter ring around it) and a row of secondary options. Clicking
// the centred item fires the shutter action. Modes are picked in the sidebar
// (rail.js).

export class Dock {
  constructor(handlers) {
    this.h = handlers;
    this.el = document.getElementById('dock');
    this.carousel = document.getElementById('carousel');
    this.extras = document.getElementById('extras');
    this.nameEl = document.getElementById('item-name');
    this.actionEl = document.getElementById('item-action');
    this.mode = null;
    this.selected = null;
    this.programmatic = 0;
    this.wheelAt = 0;

    this.carousel.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      if (chip.dataset.id === this.selected && this.isCentered(chip)) { this.fire(); return; }
      this.scrollTo(chip.dataset.id, true);
      this.choose(chip.dataset.id);
    });
    this.carousel.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.carousel.addEventListener('scrollend', () => this.settle());
    this.carousel.addEventListener('wheel', (e) => {
      e.preventDefault();
      const now = performance.now();
      if (now - this.wheelAt < 110) return;
      this.wheelAt = now;
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      this.step(d > 0 ? 1 : -1);
    }, { passive: false });

    this.extras.addEventListener('click', (e) => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'action') this.h.onAction(b.dataset.id);
      else this.h.onExtra(b.dataset.x, b.dataset.id);
    });
  }

  def() { return MODES.find((m) => m.id === this.mode); }

  // ---------------------------------------------------------------- build

  setMode(modeId, state) {
    const changed = modeId !== this.mode;
    this.mode = modeId;
    const m = this.def();
    if (changed) {
      this.carousel.style.scrollBehavior = 'auto';
      this.carousel.innerHTML = m.items.map((it, i) => `
        <button class="chip${it.off ? ' off' : ''}" role="option" data-id="${it.id}" title="${it.name}" style="--i:${i}">
          <span class="sw"><span class="sw-fill" style="background:${it.sw}"></span></span>
        </button>`).join('');
      this.selected = state[m.key];
      this.scrollTo(this.selected, false);
      requestAnimationFrame(() => {
        this.carousel.style.scrollBehavior = '';
        this.onScroll();
      });
    }
    this.renderExtras(state);
    this.sync(state);
  }

  renderExtras(state) {
    const m = this.def();
    const parts = [];
    for (const g of m.extras || []) {
      parts.push(`<span class="x-title">${g.title}</span>`);
      for (const it of g.items) parts.push(`<button class="pill-btn${state[g.key] === it.id ? ' on' : ''}" data-x="${g.key}" data-id="${it.id}">${it.name}</button>`);
    }
    if (m.actions) {
      parts.push('<span class="x-title">Edit</span>');
      for (const a of m.actions) parts.push(`<button class="pill-btn ghost" data-x="action" data-id="${a.id}">${a.name}</button>`);
    }
    this.extras.innerHTML = parts.join('');
  }

  sync(state) {
    const m = this.def();
    if (!m) return;
    const id = state[m.key];
    if (id !== this.selected) {
      this.selected = id;
      this.scrollTo(id, true);
    }
    for (const c of this.carousel.children) {
      c.classList.toggle('active', c.dataset.id === id);
      c.setAttribute('aria-selected', String(c.dataset.id === id));
    }
    for (const b of this.extras.querySelectorAll('[data-x]')) {
      if (b.dataset.x !== 'action') b.classList.toggle('on', state[b.dataset.x] === b.dataset.id);
    }
    const item = m.items.find((x) => x.id === id);
    this.nameEl.textContent = item ? item.name : '';
  }

  setAction(label) {
    this.actionEl.textContent = label ? `· ${label}` : '';
    this.el.classList.toggle('has-action', !!label);
  }

  setLoading(ids) {
    for (const c of this.carousel.children) c.classList.toggle('loading', ids.has(c.dataset.id));
  }

  // ---------------------------------------------------------------- carousel

  chipFor(id) { return this.carousel.querySelector(`.chip[data-id="${CSS.escape(String(id))}"]`); }

  isCentered(chip) {
    const c = this.carousel;
    const mid = c.scrollLeft + c.clientWidth / 2;
    return Math.abs(chip.offsetLeft + chip.offsetWidth / 2 - mid) < chip.offsetWidth * 0.5;
  }

  scrollTo(id, smooth) {
    const chip = this.chipFor(id);
    if (!chip) return;
    this.programmatic = performance.now();
    const left = chip.offsetLeft + chip.offsetWidth / 2 - this.carousel.clientWidth / 2;
    this.carousel.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }

  // Scales items by their distance from the centre, like a lens dial.
  onScroll() {
    const c = this.carousel;
    const mid = c.scrollLeft + c.clientWidth / 2;
    for (const chip of c.children) {
      const d = Math.abs(chip.offsetLeft + chip.offsetWidth / 2 - mid) / (c.clientWidth / 2);
      const k = Math.max(0.62, 1 - d * 0.42);
      chip.style.setProperty('--k', k.toFixed(3));
      chip.style.setProperty('--o', Math.max(0.3, 1 - d * 0.75).toFixed(3));
    }
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.settle(), 160);
  }

  settle() {
    if (performance.now() - this.programmatic < 450) return;
    const c = this.carousel;
    const mid = c.scrollLeft + c.clientWidth / 2;
    let best = null, bd = Infinity;
    for (const chip of c.children) {
      const d = Math.abs(chip.offsetLeft + chip.offsetWidth / 2 - mid);
      if (d < bd) { bd = d; best = chip; }
    }
    if (best && best.dataset.id !== this.selected) this.choose(best.dataset.id);
  }

  choose(id) {
    this.selected = id;
    this.h.onSelect(this.def().key, id);
  }

  step(dir) {
    const m = this.def();
    const ids = m.items.map((x) => x.id);
    const i = Math.max(0, ids.indexOf(this.selected));
    const next = ids[Math.min(ids.length - 1, Math.max(0, i + dir))];
    if (next === this.selected) return;
    this.scrollTo(next, true);
    this.choose(next);
  }

  fire() {
    this.el.classList.remove('fire');
    void this.el.offsetWidth;
    this.el.classList.add('fire');
    this.h.onShutter();
  }
}
