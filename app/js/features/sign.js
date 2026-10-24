// Sign reader. "Spell" recognises a set of static ASL fingerspelling
// letters from hand geometry; "Gesture Talk" maps common gestures to
// phrases. Recognised text can be spoken with the system's offline voices.

const HOLD = 0.65;
const SPACE = '␣';

export const LETTER_GUIDE = [
  ['A', 'Fist, thumb resting at the side'],
  ['B', 'Flat hand, fingers together, thumb folded in'],
  ['C', 'Curve the hand like a C'],
  ['D', 'Index up, other fingertips touch the thumb'],
  ['E', 'Fingers curled down onto the thumb'],
  ['F', 'Thumb and index touch, three fingers up'],
  ['I', 'Pinky up'],
  ['L', 'Thumb and index make an L'],
  ['O', 'All fingertips meet the thumb in an O'],
  ['S', 'Fist, thumb across the fingers'],
  ['U', 'Index and middle up, together'],
  ['V', 'Index and middle up, apart'],
  ['W', 'Index, middle and ring up'],
  ['Y', 'Thumb and pinky out'],
  [SPACE, 'Open hand, fingers spread'],
];

const PHRASES = {
  Thumb_Up: ['👍', 'Yes'],
  Thumb_Down: ['👎', 'No'],
  Open_Palm: ['✋', 'Hello'],
  Victory: ['✌️', 'Peace'],
  ILoveYou: ['🤟', 'I love you'],
  Closed_Fist: ['✊', 'Stop'],
  Pointing_Up: ['☝️', 'Wait a moment'],
};

const CHAINS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

// 1 for a straight finger, lower as it curls.
function straightness(h, f) {
  const [a, b, c, d] = CHAINS[f];
  const chain = h.d(a, b) + h.d(b, c) + h.d(c, d);
  return h.d(a, d) / Math.max(chain, 1);
}

function angleBetween(h, a1, a2, b1, b2) {
  const ax = h.x(a2) - h.x(a1), ay = h.y(a2) - h.y(a1);
  const bx = h.x(b2) - h.x(b1), by = h.y(b2) - h.y(b1);
  const dot = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}

export function classifyLetter(h) {
  const S = h.size;
  const s = [0, 1, 2, 3, 4].map((f) => straightness(h, f));
  const up = (f) => s[f] > 0.86;
  const curled = (f) => s[f] < 0.62;
  const near = (a, b, k) => h.d(a, b) < S * k;
  const thumbOut = h.d(4, 5) > S * 0.62 && s[0] > 0.8;
  const spreadIP = angleBetween(h, 5, 8, 17, 20);

  if (up(1) && up(2) && up(3) && up(4)) {
    if (thumbOut && spreadIP > 28) return SPACE;
    if (spreadIP < 26 && !thumbOut) return 'B';
    return null;
  }
  if (up(1) && up(2) && up(3) && curled(4)) return 'W';
  if (up(1) && up(2) && curled(3) && curled(4)) {
    if (near(8, 12, 0.34)) return 'U';
    if (h.d(8, 12) > S * 0.42) return 'V';
    return null;
  }
  if (near(8, 4, 0.3) && up(2) && up(3) && up(4)) return 'F';
  if (up(1) && curled(2) && curled(3) && curled(4)) {
    if (thumbOut && angleBetween(h, 2, 4, 5, 8) > 55) return 'L';
    if (near(12, 4, 0.45)) return 'D';
    return null;
  }
  if (up(4) && curled(1) && curled(2) && curled(3)) return thumbOut ? 'Y' : 'I';

  const allCurled = curled(1) && curled(2) && curled(3) && curled(4);
  const partial = (f) => s[f] >= 0.5 && s[f] <= 0.9;
  if (partial(1) && partial(2) && partial(3) && !allCurled) {
    const gap = h.d(4, 8) / S;
    if (gap > 0.42 && gap < 1.3) return 'C';
    if (gap < 0.32 && near(4, 12, 0.45)) return 'O';
  }
  if (allCurled) {
    if (near(8, 4, 0.36) && near(12, 4, 0.42)) return s[1] > 0.5 ? 'O' : 'E';
    if (near(4, 10, 0.42) || near(4, 14, 0.42)) return 'S';
    return 'A';
  }
  return null;
}

export class SignReader {
  constructor(root, sfx) {
    this.root = root;
    this.sfx = sfx;
    this.mode = null;
    this.text = '';
    this.cand = null;
    this.candT = 0;
    this.locked = null;
    this.lockClear = 0;
    this.autoSpeak = true;
    this.onAsk = null;
    this.build();
  }

  build() {
    this.root.innerHTML = `
      <div class="sign-top">
        <div class="sign-letter"><svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="29"/><circle class="prog" cx="32" cy="32" r="29"/></svg><span class="sign-glyph">·</span></div>
        <div class="sign-body">
          <div class="sign-label"></div>
          <div class="sign-text" aria-live="polite"></div>
        </div>
      </div>
      <div class="sign-actions">
        <button class="pill-btn" data-act="space" title="Add a space">Space</button>
        <button class="pill-btn" data-act="back" title="Delete last character">Delete</button>
        <button class="pill-btn" data-act="clear">Clear</button>
        <button class="pill-btn accent" data-act="speak" title="Speak aloud (shutter)">Speak</button>
        <button class="pill-btn" data-act="ask" title="Ask Syrix to read your sign from the camera">Ask Syrix</button>
        <button class="pill-btn ghost" data-act="guide">Letters</button>
      </div>
      <div class="sign-guide" hidden></div>`;
    this.glyph = this.root.querySelector('.sign-glyph');
    this.prog = this.root.querySelector('.prog');
    this.label = this.root.querySelector('.sign-label');
    this.textEl = this.root.querySelector('.sign-text');
    this.guide = this.root.querySelector('.sign-guide');
    this.guide.innerHTML = LETTER_GUIDE.map(([l, d]) => `<div class="g-item"><b>${l === SPACE ? 'Space' : l}</b><span>${d}</span></div>`).join('');
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'space') this.append(' ');
      else if (act === 'back') { this.text = this.text.slice(0, -1); this.render(); }
      else if (act === 'clear') { this.text = ''; this.render(); }
      else if (act === 'speak') this.speak();
      else if (act === 'ask' && this.onAsk) this.onAsk();
      else if (act === 'guide') this.guide.hidden = !this.guide.hidden;
    });
    this.render();
  }

  show(mode) {
    this.mode = mode;
    this.root.hidden = !mode;
    this.root.dataset.mode = mode || '';
    this.cand = null;
    this.candT = 0;
    this.locked = null;
    this.label.textContent = mode === 'phrases' ? 'Hold a gesture to say it' : 'Hold a letter steady';
    this.render();
  }

  append(str) {
    this.text = (this.text + str).slice(-240);
    this.render();
    this.textEl.classList.remove('pop');
    void this.textEl.offsetWidth;
    this.textEl.classList.add('pop');
  }

  speak(text = this.text) {
    const t = text.trim();
    if (!t || !window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.rate = 1;
    window.speechSynthesis.speak(u);
    return true;
  }

  update(dt, hands) {
    if (!this.mode) return;
    const h = hands[0];
    let cand = null;
    let shown = '·';
    if (h) {
      if (this.mode === 'spell') {
        cand = classifyLetter(h);
        shown = cand === SPACE ? '␣' : cand || '?';
      } else {
        const p = h.gestureScore > 0.6 ? PHRASES[h.gesture] : null;
        cand = p ? h.gesture : null;
        shown = p ? p[0] : '·';
      }
    }
    if (cand !== this.cand) { this.cand = cand; this.candT = 0; } else this.candT += dt;
    if (this.locked && cand !== this.locked) {
      this.lockClear += dt;
      if (this.lockClear > 0.25) { this.locked = null; this.lockClear = 0; }
    } else {
      this.lockClear = 0;
    }
    const ready = cand && cand !== this.locked;
    const k = ready ? Math.min(1, this.candT / HOLD) : 0;
    if (ready && this.candT >= HOLD) {
      this.locked = cand;
      if (this.mode === 'spell') {
        this.append(cand === SPACE ? ' ' : cand);
      } else {
        const phrase = PHRASES[cand][1];
        this.append((this.text && !this.text.endsWith(' ') ? ' ' : '') + phrase + '.');
        if (this.autoSpeak) this.speak(phrase);
      }
      this.sfx.coin();
      this.root.classList.remove('hit');
      void this.root.offsetWidth;
      this.root.classList.add('hit');
    }
    this.glyph.textContent = shown;
    this.root.classList.toggle('has-hand', !!h);
    this.prog.style.strokeDashoffset = String(182.2 * (1 - k));
  }

  render() {
    this.textEl.textContent = this.text || (this.mode === 'phrases' ? 'Your phrases appear here' : 'Your words appear here');
    this.textEl.classList.toggle('empty', !this.text);
  }
}

export const SIGN_SPACE = SPACE;
