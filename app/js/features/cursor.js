import { OneEuro } from '../tracking.js';

// Hand cursor: the hand moves a pointer inside the app and a pinch clicks or
// drags. Input is delivered as synthetic pointer events, so it only ever acts
// on SYRIX Cam's own interface, never on the desktop.
//
// The pointer follows the point between thumb tip and index tip. That point
// barely moves while the fingers close, so a pinch lands where the user was
// aiming; following the index tip alone dragged the pointer off target on
// every click. A quick pinch and release is a click even if the hand drifts
// a little; holding the pinch and moving is a drag.

const CLICKABLE = 'button, a, input, textarea, select, label, [data-hand], .chip, .rail-mode, .isl-answer, .pill-btn, .win-bar, .app-icon, .piano-key, .calc-key, .menu-item, .stage-obj';
const POINTER_ID = 41;
const PRESS = 0.3;
const RELEASE = 0.45;

export class HandCursor {
  constructor(el, sfx) {
    this.el = el;
    this.sfx = sfx;
    this.filter = new OneEuro(1.6, 0.02, 1.0);
    this.active = false;
    this.visible = false;
    this.pinched = false;
    this.x = 0;
    this.y = 0;
    this.down = null;
    this.hover = null;
    this.dwell = 0;
    this.speed = 1;
    this.clickMode = 'pinch';
    this.handId = null;
    this.lost = 0;
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    if (!on) {
      this.release(true);
      this.setHover(null);
      this.el.classList.remove('show');
      this.visible = false;
      this.filter.reset();
    }
  }

  configure({ speed, clickMode }) {
    if (speed) this.speed = speed;
    if (clickMode) this.clickMode = clickMode;
  }

  // The hand that was driving keeps driving; otherwise the nearest (largest)
  // settled hand takes over.
  pick(hands) {
    const settled = hands.filter((h) => h.age >= 3);
    const same = settled.find((h) => h.id === this.handId);
    if (same) return same;
    let best = null;
    for (const h of settled) if (!best || h.size > best.size) best = h;
    return best;
  }

  update(hands, t, W, H, dt) {
    if (!this.active) return;
    const h = this.pick(hands);
    if (!h) {
      this.lost += dt;
      if (this.lost > 0.25) {
        if (this.visible) { this.el.classList.remove('show'); this.visible = false; }
        this.release(true);
        this.filter.reset();
        this.handId = null;
      }
      return;
    }
    this.lost = 0;
    if (h.id !== this.handId) { this.filter.reset(); this.release(true); this.handId = h.id; }
    if (!this.visible) { this.el.classList.add('show'); this.visible = true; }

    // A central region of the camera covers the whole screen, so the hand
    // never has to reach the edges of the frame.
    const gain = 1.5 * this.speed;
    const [ax, ay] = h.pinchPoint;
    let x = W / 2 + (ax - W / 2) * gain;
    let y = H / 2 + (ay - H * 0.48) * gain * 1.15;
    x = Math.max(2, Math.min(W - 2, x));
    y = Math.max(2, Math.min(H - 2, y));
    const p = this.filter.filter([x, y], t);
    this.x = p[0];
    this.y = p[1];

    const ratio = h.pinch;
    const was = this.pinched;
    if (!this.pinched && ratio < PRESS) this.pinched = true;
    else if (this.pinched && ratio > RELEASE) this.pinched = false;
    const progress = Math.max(0, Math.min(1, (0.75 - ratio) / (0.75 - PRESS)));

    if (this.pinched && !was) this.press(t);
    else if (!this.pinched && was) this.release(false, t);
    if (this.pinched) this.move(t);

    const target = this.targetAt(this.x, this.y);
    const clickable = target ? target.closest(CLICKABLE) : null;
    this.setHover(this.down ? this.hover : clickable);
    if (this.clickMode === 'dwell' && clickable && !this.pinched) {
      this.dwell += dt;
      if (this.dwell > 1.0) { this.dwell = -0.8; this.tap(clickable); }
    } else if (!clickable) {
      this.dwell = 0;
    }

    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    this.el.classList.toggle('pressed', this.pinched);
    this.el.classList.toggle('over', !!clickable);
    this.el.style.setProperty('--pinch', progress.toFixed(3));
    this.el.style.setProperty('--dwell', String(Math.max(0, this.dwell)));
  }

  targetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && !this.el.contains(el) ? el : null;
  }

  evt(type, target, buttons) {
    if (!target) return;
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: this.x, clientY: this.y, pointerId: POINTER_ID, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons,
    }));
  }

  press(t) {
    const target = this.targetAt(this.x, this.y);
    this.down = {
      target, x: this.x, y: this.y, t, dragging: false,
      scroller: target ? target.closest('.carousel, .chat-log, .scroll-y, .menu-list') : null,
      lastX: this.x, lastY: this.y,
    };
    this.evt('pointerdown', target, 1);
  }

  move(t) {
    const d = this.down;
    if (!d) return;
    const far = Math.hypot(this.x - d.x, this.y - d.y);
    if (!d.dragging && far > 28 && t - d.t > 0.12) d.dragging = true;
    if (d.dragging && d.scroller) {
      const dx = this.x - d.lastX, dy = this.y - d.lastY;
      if (d.scroller.classList.contains('carousel')) d.scroller.scrollLeft -= dx * 1.5;
      else d.scroller.scrollTop -= dy * 1.5;
    }
    d.lastX = this.x;
    d.lastY = this.y;
    this.evt('pointermove', this.targetAt(this.x, this.y) || document.body, 1);
  }

  release(cancel, t = 0) {
    const d = this.down;
    if (!d) return;
    this.down = null;
    const target = this.targetAt(this.x, this.y) || document.body;
    this.evt(cancel ? 'pointercancel' : 'pointerup', target, 0);
    if (cancel || !d.target) return;
    const quick = t - d.t < 0.6 && Math.hypot(this.x - d.x, this.y - d.y) < 70;
    if (!d.dragging || quick) this.tap(d.target);
  }

  tap(target) {
    const el = target.closest(CLICKABLE) || target;
    if (el.matches('input, textarea')) el.focus();
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: this.x, clientY: this.y }));
    this.sfx.click();
    this.el.classList.remove('tap');
    void this.el.offsetWidth;
    this.el.classList.add('tap');
  }

  setHover(el) {
    if (el === this.hover) return;
    if (this.hover) this.hover.classList.remove('hand-hover');
    this.hover = el;
    if (el) el.classList.add('hand-hover');
    this.dwell = 0;
  }
}
