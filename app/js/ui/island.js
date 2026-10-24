// The island: one black capsule at the top of the screen that is the app's
// status line and changes shape with what is happening. Panes, by priority:
//   toast   a short confirmation ("Center Stage on")
//   voice   voice mode: level bars, what Syrix is doing, live captions and
//           the reply (the Syrix pet shows the mood; the island stays text)
//   answer  a Syrix reply while the chat panel is closed
//   idle    camera status, what Syrix can see, model loading, privacy
// Every pane is laid out off-flow; the capsule animates its own width and
// height to the active pane, so changes morph instead of jumping.

const ANSWER_LINGER = 9000;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Replies arrive as Markdown; the island shows them as plain text.
const plain = (t) => String(t || '')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
  .replace(/[*_`#>]+/g, '')
  .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

export class Island {
  constructor(voice, { onOpenChat }) {
    this.voice = voice;
    this.el = document.getElementById('island');
    this.panes = {};
    for (const p of this.el.querySelectorAll('[data-pane]')) this.panes[p.dataset.pane] = p;
    this.stateEl = document.getElementById('vi-state');
    this.capEl = document.getElementById('vi-caption');
    this.toastEl = document.getElementById('toast');
    this.answerEl = document.getElementById('isl-answer');
    this.answerState = document.getElementById('isl-answer-state');
    this.bars = [...document.querySelectorAll('#vi-bars i')];
    this.voiceState = 'off';
    this.voiceView = null;
    this.reply = '';
    this.replyBusy = false;
    this.answerUntil = 0;
    this.toastUntil = 0;
    this.pane = null;
    this.levelsAt = new Float32Array(this.bars.length);
    this.running = false;
    this.panes.answer.addEventListener('click', () => onOpenChat());
    // Content changes inside the active pane (captions, chips) resize the
    // capsule too.
    this.ro = new ResizeObserver(() => this.layout());
    for (const p of Object.values(this.panes)) this.ro.observe(p);
    this.render();
  }

  // ---------------------------------------------------------------- inputs

  // Voice mode state from VoiceMode.
  update(state, label, v) {
    this.voiceState = state;
    this.voiceView = v;
    this.el.dataset.voice = state;
    this.stateEl.textContent = label;
    document.body.classList.toggle('voice-on', state !== 'off');
    if (state !== 'off' && !this.running) { this.running = true; requestAnimationFrame((t) => this.draw(t)); }
    this.render();
  }

  // A Syrix reply streaming in. chatOpen: the chat panel already shows it.
  answer(text, { done = false, chatOpen = false, label = '' } = {}) {
    this.reply = plain(text);
    this.replyBusy = !done;
    this.replyLabel = label;
    if (chatOpen || this.voiceState !== 'off') this.answerUntil = 0;
    else this.answerUntil = done ? performance.now() + ANSWER_LINGER : Infinity;
    if (done && this.answerUntil) setTimeout(() => this.render(), ANSWER_LINGER + 50);
    this.render();
  }

  toast(text, ms = 2200) {
    this.toastEl.textContent = text;
    this.toastUntil = performance.now() + ms;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.render(), ms + 30);
    this.render();
  }

  // ---------------------------------------------------------------- render

  render() {
    const now = performance.now();
    const voiceOn = this.voiceState !== 'off';
    let pane = 'idle';
    if (now < this.toastUntil) pane = 'toast';
    else if (voiceOn) pane = 'voice';
    else if (now < this.answerUntil) pane = 'answer';

    if (pane === 'voice') {
      const s = this.voiceState;
      const v = this.voiceView || {};
      // While Syrix replies, the island shows the reply itself; while the
      // user talks, what was heard so far.
      const cap = s === 'hearing' ? (v.userCaption || '')
        : (s === 'thinking' || s === 'speaking') ? (this.reply || v.caption || '')
          : s === 'loading' ? v.caption || '' : '';
      // Long replies keep their newest words in view.
      const shown = cap.length > 240 ? `…${cap.slice(-240)}` : cap;
      if (this.capEl.textContent !== shown) this.capEl.textContent = shown;
      this.panes.voice.classList.toggle('long', shown.length > 60);
    }
    if (pane === 'answer') {
      const t = this.reply.length > 320 ? `…${this.reply.slice(-320)}` : this.reply;
      this.answerEl.innerHTML = t ? esc(t) : '';
      this.answerState.textContent = this.replyBusy ? (t ? 'Answering' : 'Thinking') : (this.replyLabel || 'Syrix');
      this.panes.answer.classList.toggle('busy', this.replyBusy);
    }
    if (pane !== this.pane) {
      for (const [k, p] of Object.entries(this.panes)) {
        p.classList.toggle('on', k === pane);
        p.inert = k !== pane;
      }
      this.pane = pane;
      this.el.dataset.pane = pane;
    }
    this.layout();
  }

  layout() {
    const p = this.panes[this.pane];
    if (!p) return;
    const w = Math.ceil(p.offsetWidth);
    const h = Math.ceil(p.offsetHeight);
    if (w && h && (w !== this.w || h !== this.h)) {
      this.w = w;
      this.h = h;
      this.el.style.width = `${w}px`;
      this.el.style.height = `${h}px`;
    }
  }

  // ---------------------------------------------------------------- level bars

  // Five bars that follow the microphone while the user talks and the voice
  // while Syrix talks; a slow wave while thinking.
  draw(now) {
    if (this.voiceState === 'off') { this.running = false; return; }
    requestAnimationFrame((t) => this.draw(t));
    if (this.pane !== 'voice') return;
    const { mic, out } = this.voice.levels();
    const s = this.voiceState;
    const level = s === 'speaking' ? out : s === 'hearing' || s === 'listening' ? mic : 0;
    this.bars.forEach((b, i) => {
      const wave = s === 'thinking' ? 0.35 + 0.3 * Math.sin(now / 180 - i * 0.9) : 0.12;
      const target = Math.max(wave, Math.min(1, level * (0.75 + 0.5 * Math.sin(now / 90 + i * 1.7))));
      this.levelsAt[i] += (target - this.levelsAt[i]) * 0.35;
      b.style.transform = `scaleY(${(0.18 + this.levelsAt[i] * 0.82).toFixed(3)})`;
    });
  }
}
