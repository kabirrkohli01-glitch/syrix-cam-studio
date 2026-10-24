import { MODES } from '../catalog.js';

// Sidebar of modes. Every mode is one click away with an icon and a name,
// replacing the scrolling strip of mode names under the effect dial.

const ICONS = {
  looks: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" opacity=".35"/>',
  scenes: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.6"/>',
  face: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  magic: '<path d="m4 20 10-10M14 4v3M14 13v3M10 8.5H7M21 8.5h-3M17.5 5l-1.5 1.5M17.5 12 16 10.5"/>',
  draw: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  motion: '<path d="M4 12h3M5 7h4M5 17h4"/><circle cx="15" cy="12" r="5"/><path d="M15 9.5V12l1.5 1.5"/>',
  sign: '<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  cursor: '<path d="m5 3 14 7-6 2-2 6z"/>',
  games: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3M15 12h.01M18 11h.01"/>',
  health: '<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/><path d="M3.5 12h4l2-3 3 6 2-3h6"/>',
};

export class Rail {
  constructor({ onMode }) {
    this.el = document.getElementById('rail-modes');
    this.el.innerHTML = MODES.map((m, i) => `
      <button class="rail-mode" data-mode="${m.id}" title="${m.label} (${(i + 1) % 10})" aria-label="${m.label}">
        <svg viewBox="0 0 24 24" class="ico">${ICONS[m.id] || '<circle cx="12" cy="12" r="8"/>'}</svg>
        <span>${m.label}</span>
      </button>`).join('');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) onMode(b.dataset.mode);
    });
  }

  setMode(id) {
    for (const b of this.el.children) {
      const on = b.dataset.mode === id;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
  }
}
