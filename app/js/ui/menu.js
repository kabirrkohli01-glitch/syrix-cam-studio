// Search-everything menu (Ctrl+K or /): every mode, effect, widget, action
// and settings page in one list, filtered as you type. Anything that matches
// nothing can be handed straight to Syrix.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, ' ');

export class Menu {
  constructor(root, { commands, ask, onToggle }) {
    this.root = root;
    this.commands = commands;
    this.ask = ask;
    this.onToggle = onToggle || (() => {});
    this.input = root.querySelector('#menu-input');
    this.list = root.querySelector('#menu-list');
    this.items = [];
    this.sel = 0;
    this.input.addEventListener('input', () => { this.sel = 0; this.render(); });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this.run(this.items[this.sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); this.toggle(false); }
      else if (e.key === 'Tab') { e.preventDefault(); this.askSyrix(); }
    });
    this.list.addEventListener('click', (e) => {
      const it = e.target.closest('[data-i]');
      if (it) this.run(this.items[Number(it.dataset.i)]);
    });
    this.list.addEventListener('pointermove', (e) => {
      const it = e.target.closest('[data-i]');
      if (it && Number(it.dataset.i) !== this.sel) { this.sel = Number(it.dataset.i); this.highlight(); }
    });
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.toggle(false); });
  }

  get open() { return !this.root.hidden; }

  toggle(open = !this.open, query = '') {
    if (open === this.open) return;
    if (open) {
      this.root.hidden = false;
      requestAnimationFrame(() => this.root.classList.add('show'));
      this.input.value = query;
      this.sel = 0;
      this.render();
      setTimeout(() => this.input.focus(), 30);
    } else {
      this.root.classList.remove('show');
      this.input.blur();
      setTimeout(() => { if (!this.root.classList.contains('show')) this.root.hidden = true; }, 240);
    }
    this.onToggle(open);
  }

  filter(q) {
    const all = this.commands();
    if (!q.trim()) return all.filter((c) => c.featured);
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const scored = [];
    for (const c of all) {
      const hay = norm(`${c.label} ${c.group} ${c.keywords || ''}`);
      const label = norm(c.label);
      if (!terms.every((t) => hay.includes(t))) continue;
      let score = 0;
      if (label.startsWith(terms[0])) score += 3;
      if (label.split(' ').some((w) => w.startsWith(terms[0]))) score += 2;
      if (label === norm(q).trim()) score += 5;
      score -= label.length / 100;
      scored.push([score, c]);
    }
    return scored.sort((a, b) => b[0] - a[0]).map((x) => x[1]).slice(0, 40);
  }

  render() {
    const q = this.input.value;
    this.items = this.filter(q);
    if (q.trim()) this.items.push({ label: `Ask Syrix: “${q.trim()}”`, group: 'Syrix', icon: 'syrix', run: () => this.ask(q.trim()) });
    let group = null;
    this.list.innerHTML = this.items.map((c, i) => {
      const head = c.group !== group ? `<div class="menu-group">${esc((group = c.group))}</div>` : '';
      const icon = c.icon === 'syrix' ? '<img src="assets/syrix-logo-128.png" alt="">' : c.swatch ? `<i style="background:${c.swatch}"></i>` : `<svg viewBox="0 0 24 24" class="ico">${c.icon || '<circle cx="12" cy="12" r="3"/>'}</svg>`;
      return `${head}<button class="menu-item${c.on ? ' on' : ''}" data-i="${i}" role="option"><span class="mi-icon">${icon}</span><span class="mi-label">${esc(c.label)}</span>${c.sub ? `<span class="mi-sub">${esc(c.sub)}</span>` : ''}${c.on ? '<span class="mi-on">On</span>' : ''}</button>`;
    }).join('') || '<div class="menu-empty">Nothing found</div>';
    this.highlight();
  }

  highlight() {
    this.list.querySelectorAll('.menu-item').forEach((el) => el.classList.toggle('sel', Number(el.dataset.i) === this.sel));
    const cur = this.list.querySelector('.menu-item.sel');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  move(d) {
    if (!this.items.length) return;
    this.sel = (this.sel + d + this.items.length) % this.items.length;
    this.highlight();
  }

  run(c) {
    if (!c) return;
    this.toggle(false);
    setTimeout(() => c.run(), 60);
  }

  askSyrix() {
    const q = this.input.value.trim();
    if (!q) return;
    this.toggle(false);
    this.ask(q);
  }
}
