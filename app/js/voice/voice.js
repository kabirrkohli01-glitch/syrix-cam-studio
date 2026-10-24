import { settings } from '../store.js';

// Hands-free conversation with Syrix. Recognition and speech both run on this
// PC in workers; only the recognised words go to SYRIX, through the chat.
//
// Flow: microphone -> audio worklet -> recognition worker (VAD + Whisper,
// English or Hindi) -> chat.ask(text, {voice: true}) -> streamed reply split
// into phrases -> speech worker -> gapless playback.
//
// Talking over Syrix: while it is speaking, the voice ducks the moment the
// user starts and pauses (it does not stop) once they have clearly been
// talking for a moment. Only the transcript decides what happens next: real
// words cancel the reply; a cough, a "yeah", the television or Syrix's own
// echo resumes it from exactly where it paused. Cancelling on loudness alone
// meant any burst of background noise ended the answer for good. While Syrix
// is still working on a reply, nothing is cancelled until the transcript
// shows the user really spoke. The interrupted question stays in the
// conversation, so a follow-up such as "and give me five, not one" is
// answered together with it.

const STATE_TEXT = {
  starting: 'Waking up', loading: 'Loading voice', listening: 'Listening',
  hearing: 'Listening', thinking: 'Thinking', speaking: 'Speaking', muted: 'Mic muted', error: 'Voice unavailable',
};

// Spoken only when Syrix goes off to do something that takes a moment (a
// search, a look through the camera, building something). There is no
// acknowledgement before ordinary answers: a canned "Right" or "Hmm" in front
// of every reply sounded random rather than attentive. Lines are rendered
// once per voice so they play with no delay. Hindi lines use the speaker's
// grammatical gender.
const CLIPS = {
  en: {
    search: ['Let me check that.', 'Let me look that up for you.', 'Give me a sec, I’ll pull that up.'],
    look: ['Let me take a look.', 'Okay, let me see.'],
    make: ['Sure, let me make that for you.', 'On it, give me a moment.'],
    wait: ['One moment.', 'Just a sec.'],
  },
  hi: {
    search: ['एक सेकंड, मैं देखता हूँ।', 'रुको, मैं पता करता हूँ।'],
    look: ['रुको, मैं देखता हूँ।'],
    make: ['ठीक है, अभी बनाता हूँ।'],
    wait: ['एक सेकंड।'],
  },
};
const FEMALE = new Set(['nova', 'aria']);
const feminine = (t) => t.replace(/देखता/g, 'देखती').replace(/करता/g, 'करती').replace(/बनाता/g, 'बनाती');
const TOOL_CLIP = {
  web_search: 'search', read_page: 'search', github_search: 'search', stock_chart: 'search',
  look: 'look', inspect_skin: 'look', view_object: 'look',
  create_object: 'make', update_object: 'make', create_app: 'make', update_app: 'make', show_chart: 'make',
  face_id: 'wait', health: 'wait',
};

// Short reactions that mean "go on", not "stop".
const BACKCHANNEL = /^(yeah|yep|yes|ya|ok(ay)?|mm+|mhm+|uh[- ]?huh|right|sure|cool|nice|wow|oh|ah|hmm+|haan|han|ha|accha|achha|acha|thik hai|theek hai|हाँ|हां|अच्छा|ठीक है|हम्म)[.!?,।]*$/i;
// Single words that always mean "stop talking".
const HALT = /^(stop|wait|pause|enough|cancel|quiet|shush|no|nope|ruko|bas|chup|रुको|बस|चुप)[.!?,।]*$/i;
const WAKE =/\b(syrix|cyrix|sirix|siri x|syrics|sirex|cirrus|sir ix|zyrix)\b|सिरिक्स|साइरिक्स/i;
const DUCK = 0.18;

// Text the voice should not read out: markdown, links, emoji, list markers.
function speakable(t) {
  return t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);

// Opens the microphone chosen in Settings, falling back to the Windows
// default if that one has been unplugged. Echo cancellation always stays on:
// without it Syrix hears itself through the speakers and interrupts itself.
export async function openMic() {
  const v = settings.voice;
  const base = { echoCancellation: true, noiseSuppression: v.noiseSuppression !== false, autoGainControl: v.autoGain !== false, channelCount: 1 };
  if (v.micId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: v.micId } } });
    } catch (err) {
      if (err && err.name === 'NotAllowedError') throw err;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base });
}

export class VoiceMode {
  constructor({ chat, toast, onState }) {
    this.chat = chat;
    this.toast = toast;
    this.onState = onState || (() => {});
    this.state = 'off';
    this.muted = false;
    this.stt = null;
    this.tts = null;
    this.ready = { stt: false, tts: false };
    this.progress = { stt: 0, tts: 0 };
    this.stream = null;
    this.capCtx = null;
    this.outCtx = null;
    this.outGain = null;
    this.analyser = null;
    this.micLevel = 0;
    this.sources = new Set();
    this.nextTime = 0;
    this.jobId = 1;
    this.turn = null;
    this.spoken = [];
    this.lastSpokeAt = 0;
    this.caption = '';
    this.userCaption = '';
    // Language of the user's last real utterance: 'en' or 'hi'.
    this.lang = 'en';
    // A sound heard while Syrix works or speaks, waiting for its transcript.
    this.barge = null;
    // Pre-rendered tool lines by key ("en:search:1"), for one voice.
    this.clips = new Map();
    this.clipVoice = null;
    this.recentClips = [];
    this.onSpeechStart = null;
    this.sink = this.makeSink();
  }

  get on() { return this.state !== 'off'; }

  setState(s, caption) {
    this.state = s;
    if (caption !== undefined) this.caption = caption;
    this.onState(s, STATE_TEXT[s] || '', this);
  }

  // ---------------------------------------------------------------- lifecycle

  async start() {
    if (this.on) return;
    this.setState('starting', '');
    // Audio contexts are created inside the click so they are allowed to run.
    if (!this.outCtx) {
      this.outCtx = new AudioContext({ latencyHint: 'interactive' });
      this.outGain = this.outCtx.createGain();
      this.analyser = this.outCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.outGain.connect(this.analyser);
      this.analyser.connect(this.outCtx.destination);
    }
    this.outCtx.resume();
    try {
      this.stream = await openMic();
    } catch (err) {
      this.setState('off');
      this.toast(err && err.name === 'NotAllowedError'
        ? 'Microphone is blocked. Allow it in Windows Settings › Privacy › Microphone.'
        : 'No microphone found.');
      return;
    }
    this.capCtx = new AudioContext({ sampleRate: 16000 });
    await this.capCtx.audioWorklet.addModule(new URL('./capture.worklet.js', import.meta.url));
    const src = this.capCtx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.capCtx, 'syrix-capture');
    const sink = this.capCtx.createGain();
    sink.gain.value = 0;
    src.connect(this.node).connect(sink).connect(this.capCtx.destination);
    this.node.port.onmessage = (e) => { if (e.data.level != null) this.micLevel = e.data.level; };

    this.ensureWorkers();
    const ch = new MessageChannel();
    this.node.port.postMessage({ port: ch.port1 }, [ch.port1]);
    this.stt.postMessage({ type: 'init', port: ch.port2 }, [ch.port2]);
    this.configure();
    this.chat.speech = this.sink;
    this.muted = false;
    this.setState(this.ready.stt && this.ready.tts ? 'listening' : 'loading', '');
  }

  // Applies a new microphone or voice engine. A new microphone keeps the
  // models loaded; a new engine reloads only the voice.
  async restart({ reloadVoice = false } = {}) {
    if (reloadVoice && this.tts) {
      this.tts.terminate();
      this.tts = null;
      this.ready.tts = false;
      this.clips.clear();
      this.clipVoice = null;
    }
    if (!this.on) return;
    this.stop({ keepModels: true });
    await this.start();
  }

  stop({ keepModels = false } = {}) {
    if (!this.on) return;
    this.interrupt();
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    if (this.capCtx) this.capCtx.close();
    this.capCtx = null;
    this.node = null;
    if (this.stt) this.stt.postMessage({ type: 'config', config: { enabled: false } });
    this.chat.speech = null;
    this.setState('off', '');
    // The speech models are closed as soon as voice mode ends, which gives
    // their memory back; they load again the next time it starts.
    if (!keepModels) this.unload();
  }

  toggle() { if (this.on) this.stop(); else this.start(); }

  unload() {
    if (this.on) return;
    if (this.stt) this.stt.terminate();
    if (this.tts) this.tts.terminate();
    this.stt = null;
    this.tts = null;
    this.ready = { stt: false, tts: false };
    this.clips.clear();
    this.clipVoice = null;
  }

  setMuted(m) {
    this.muted = m;
    if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = !m;
    // A muted microphone never delivers the words a paused reply waits for.
    if (m && this.barge) { this.barge = null; this.duck(false); this.resumeOutput(); }
    this.configure();
    if (m) this.setState('muted');
    else if (this.state === 'muted') this.setState('listening');
  }

  configure() {
    if (!this.stt) return;
    const v = settings.voice;
    this.stt.postMessage({
      type: 'config',
      config: {
        enabled: !this.muted && this.on,
        endSilenceMs: v.patience === 'quick' ? 480 : v.patience === 'relaxed' ? 950 : 650,
        // Any sound from the speakers raises the bar for detecting the user,
        // so the echo of Syrix's own voice is less likely to register.
        speaking: this.state === 'speaking' || this.sources.size > 0,
      },
    });
  }

  ensureWorkers() {
    if (!this.stt) {
      this.stt = new Worker(new URL('./stt.worker.js', import.meta.url), { type: 'module' });
      this.stt.onmessage = (e) => this.onStt(e.data);
      this.stt.onerror = (e) => { console.error('Recognition worker failed', e.message); this.fail(); };
    }
    if (!this.tts) {
      this.tts = new Worker(new URL('./tts.worker.js', import.meta.url), { type: 'module' });
      this.tts.onmessage = (e) => this.onTts(e.data);
      this.tts.onerror = (e) => { console.error('Speech worker failed', e.message); this.fail(); };
      this.tts.postMessage({ type: 'init', voice: settings.voice.voice, prefer: settings.voice.engine === 'expressive' ? 'expressive' : 'fast' });
    }
  }

  fail() {
    this.toast('Voice could not start on this PC');
    this.stop();
    this.setState('off');
  }

  loadingCaption() {
    const p = Math.round((this.progress.stt + this.progress.tts) / 2);
    return p > 0 && p < 100 ? `Loading voice models · ${p}%` : 'Getting the voice ready…';
  }

  // ---------------------------------------------------------------- recognition

  onStt(m) {
    if (m.type === 'status') {
      if (m.state === 'loading') { this.progress.stt = m.progress || 0; if (this.state === 'loading') this.setState('loading', this.loadingCaption()); }
      if (m.state === 'ready') { this.ready.stt = true; this.progress.stt = 100; this.maybeReady(); }
      if (m.state === 'error') { console.error('Recognition failed to load', m.message); this.fail(); }
      return;
    }
    if (!this.on || this.muted) return;
    if (m.type === 'speech' && m.state === 'start') {
      this.userCaption = '';
      // Work the next request will need (who is in view) starts while the
      // user is still talking, not after they finish.
      if (this.onSpeechStart) this.onSpeechStart();
      if (this.state === 'thinking') { this.barge = { during: 'thinking' }; return; }
      if (this.state === 'speaking') {
        this.barge = { during: 'speaking' };
        this.duck(true);
        return;
      }
      this.setState('hearing', '');
    } else if (m.type === 'speech' && m.state === 'long') {
      // Someone is clearly talking over Syrix's voice: hold it where it is
      // and wait for the words.
      if (this.barge && this.barge.during === 'speaking' && !this.barge.paused) {
        this.barge.paused = true;
        this.pauseOutput();
        this.setState('hearing', '');
      }
    } else if (m.type === 'partial') {
      if (this.state === 'hearing') { this.userCaption = m.text; this.setState('hearing', m.text); }
    } else if (m.type === 'final') {
      const text = m.text || '';
      const b = this.barge;
      this.barge = null;
      if (b) {
        // Over a reply, a short or doubtful sound needs to be plainly two
        // words or more before it is taken as the user cutting in.
        const doubtful = (m.confidentMs || 0) < 600 && words(text).length < 2 && !HALT.test(text.trim());
        const ignorable = !text || doubtful || this.isEcho(text) || BACKCHANNEL.test(text.trim()) || (settings.voice.wake && !WAKE.test(text));
        if (ignorable) {
          // Not meant for Syrix: carry on as if nothing happened.
          this.duck(false);
          if (b.paused) this.resumeOutput();
          return;
        }
        this.interrupt();
      }
      if (m.lang && text && !this.isEcho(text)) this.lang = m.lang;
      this.handleFinal(text);
    }
  }

  // Freezes playback mid-word. Suspending the output context holds every
  // scheduled phrase in place, and phrases still arriving from the speech
  // worker queue up behind them, so resuming continues exactly where it
  // stopped.
  pauseOutput() {
    if (!this.outCtx || this.paused) return;
    this.paused = true;
    this.outCtx.suspend().catch(() => {});
    // The recognition worker always answers a turn within its length limit;
    // this only guards against a pause outliving a lost message.
    clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => { if (this.paused) { this.barge = null; this.duck(false); this.resumeOutput(); } }, 30000);
  }

  resumeOutput() {
    if (!this.outCtx || !this.paused) return;
    this.paused = false;
    clearTimeout(this.pauseTimer);
    this.outCtx.resume().catch(() => {});
    if (this.state === 'hearing' && this.sources.size) this.setState('speaking');
    this.configure();
    this.settle();
  }

  // Lowers Syrix's voice while the user may be talking over it.
  duck(on) {
    if (!this.outGain || !this.outCtx) return;
    const g = this.outGain.gain;
    g.cancelScheduledValues(this.outCtx.currentTime);
    g.setTargetAtTime(on ? DUCK : 1, this.outCtx.currentTime, on ? 0.04 : 0.12);
  }

  handleFinal(text) {
    if (!text || this.isEcho(text)) {
      if (this.state === 'hearing') this.setState('listening', '');
      return;
    }
    if (settings.voice.wake && !WAKE.test(text)) {
      this.setState('listening', '');
      return;
    }
    // A pause mid-request ends an utterance early. If more speech follows
    // before Syrix has started answering, it belongs to the same request:
    // the pending one is withdrawn and the two are sent together.
    const now = performance.now();
    const answered = this.turn && this.turn.text;
    let replace = null;
    if (this.pendingText && now - this.pendingAt < 4500 && !answered) {
      replace = this.pendingText;
      text = `${this.pendingText} ${text}`;
    }
    this.pendingText = text;
    this.pendingAt = now;
    this.userCaption = text;
    this.setState('thinking', text);
    this.chat.ask(text, { voice: true, lang: this.lang, replace });
  }

  // Speech picked up from the speakers rather than the user: it repeats
  // Syrix's recent words in the same order. Matching single words against
  // everything Syrix had said threw away real questions, because "what",
  // "is", "that" and "the" occur in almost every reply; echo is recognised
  // by runs of words (pairs) instead.
  isEcho(text) {
    if (performance.now() - this.lastSpokeAt > 2500 && this.state !== 'speaking' && !this.sources.size) return false;
    const said = words(this.spoken.join(' '));
    const heard = words(text);
    if (!heard.length) return true;
    if (heard.length < 2) return false;
    if (heard.length === 2) return ` ${said.join(' ')} `.includes(` ${heard.join(' ')} `);
    const pairs = new Set();
    for (let i = 1; i < said.length; i++) pairs.add(`${said[i - 1]} ${said[i]}`);
    let hit = 0;
    for (let i = 1; i < heard.length; i++) if (pairs.has(`${heard[i - 1]} ${heard[i]}`)) hit++;
    return hit / (heard.length - 1) >= 0.6;
  }

  maybeReady() {
    if (this.ready.tts) this.prerender();
    if (this.ready.stt && this.ready.tts && (this.state === 'loading' || this.state === 'starting')) {
      this.setState('listening', '');
      this.say(settings.voice.greeting ? 'Hey, I’m listening.' : '');
    }
  }

  // ---------------------------------------------------------------- tool lines

  clipText(lang, group, i) {
    const t = CLIPS[lang][group][i];
    return lang === 'hi' && FEMALE.has(this.clipVoice) ? feminine(t) : t;
  }

  prerender() {
    const voice = settings.voice.voice;
    if (!this.tts || this.clipVoice === voice) return;
    this.clipVoice = voice;
    this.clips.clear();
    const clips = [];
    for (const lang of Object.keys(CLIPS)) {
      for (const [group, lines] of Object.entries(CLIPS[lang])) lines.forEach((_, i) => clips.push({ key: `${lang}:${group}:${i}`, text: this.clipText(lang, group, i) }));
    }
    this.tts.postMessage({ type: 'prerender', voice, clips });
  }

  // Plays a pre-rendered line from a group in the conversation's language,
  // avoiding the ones used most recently. Returns false if none is ready.
  playClip(group) {
    const ctx = this.outCtx;
    if (!ctx || !this.on || this.muted) return false;
    const lang = CLIPS[this.lang] ? this.lang : 'en';
    const keys = CLIPS[lang][group].map((_, i) => `${lang}:${group}:${i}`).filter((k) => this.clips.has(k));
    if (!keys.length) return false;
    const fresh = keys.filter((k) => !this.recentClips.includes(k));
    const pool = fresh.length ? fresh : keys;
    const key = pool[Math.floor(Math.random() * pool.length)];
    this.recentClips.push(key);
    if (this.recentClips.length > 4) this.recentClips.shift();
    const c = this.clips.get(key);
    const buf = ctx.createBuffer(1, c.pcm.length, c.rate);
    buf.copyToChannel(c.pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outGain);
    const at = Math.max(ctx.currentTime + 0.02, this.nextTime);
    src.start(at);
    this.nextTime = at + buf.duration + 0.05;
    this.sources.add(src);
    this.spoken.push(c.text);
    if (this.spoken.length > 8) this.spoken.shift();
    this.configure();
    src.onended = () => {
      this.sources.delete(src);
      this.lastSpokeAt = performance.now();
      this.configure();
      this.settle();
    };
    return true;
  }

  // A tool has started: say what is happening, once per reply, unless Syrix
  // is already talking or has said something itself.
  toolStarted(name) {
    const group = TOOL_CLIP[name];
    if (!group || !this.turn || this.turn.announced || this.sources.size || this.turn.text) return;
    if (this.playClip(group)) this.turn.announced = true;
  }

  // ---------------------------------------------------------------- speech

  onTts(m) {
    if (m.type === 'status') {
      if (m.state === 'loading') { this.progress.tts = m.progress || 0; if (this.state === 'loading') this.setState('loading', this.loadingCaption()); }
      if (m.state === 'ready') { this.ready.tts = true; this.progress.tts = 100; this.engine = m.engine; this.maybeReady(); }
      if (m.state === 'error') { console.error('Voice failed to load', m.message); this.fail(); }
      return;
    }
    if (m.type === 'clip') {
      if (m.voice !== this.clipVoice) return;
      const [lang, group, i] = m.key.split(':');
      this.clips.set(m.key, { pcm: m.pcm, rate: m.rate, text: this.clipText(lang, group, Number(i)) });
      return;
    }
    if (m.type === 'audio') {
      if (!this.turn || m.id < this.turn.firstJob) return;
      this.play(m.pcm, m.rate, m.id);
    } else if (m.type === 'error') {
      console.warn('Speech chunk failed', m.message);
      if (this.turn) this.turn.pending.delete(m.id);
      this.settle();
    }
  }

  play(pcm, rate, id) {
    const ctx = this.outCtx;
    if (!ctx || !pcm.length) { if (this.turn) this.turn.pending.delete(id); this.settle(); return; }
    const buf = ctx.createBuffer(1, pcm.length, rate);
    buf.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outGain);
    const at = Math.max(ctx.currentTime + 0.04, this.nextTime);
    src.start(at);
    this.nextTime = at + buf.duration;
    this.sources.add(src);
    if (this.state !== 'speaking' && this.state !== 'hearing') this.setState('speaking');
    this.pendingText = null;
    this.configure();
    src.onended = () => {
      this.sources.delete(src);
      this.lastSpokeAt = performance.now();
      if (this.turn) this.turn.pending.delete(id);
      this.settle();
    };
  }

  // Back to listening once the reply has been fully spoken.
  settle() {
    const t = this.turn;
    if (this.sources.size || (t && (t.pending.size || !t.ended))) return;
    if (this.on && !this.muted && (this.state === 'speaking' || this.state === 'thinking')) {
      this.setState('listening', '');
      this.configure();
    }
  }

  enqueue(text) {
    const clean = speakable(text);
    if (!clean || !this.tts) return;
    const id = this.jobId++;
    if (!this.turn) this.turn = { firstJob: id, pending: new Set(), ended: false };
    this.turn.pending.add(id);
    this.spoken.push(clean);
    if (this.spoken.length > 8) this.spoken.shift();
    this.caption = (this.turn.text = `${this.turn.text || ''} ${clean.replace(/\[[a-z ]+\]/gi, '')}`.trim());
    this.onState(this.state, STATE_TEXT[this.state], this);
    this.tts.postMessage({ type: 'speak', id, text: clean, voice: settings.voice.voice });
  }

  say(text) {
    if (!text || !this.on) return;
    this.turn = { firstJob: this.jobId, pending: new Set(), ended: true, text: '' };
    this.enqueue(text);
  }

  // Stops speech audio and queued speech, leaving the chat alone.
  silence() {
    if (this.tts) this.tts.postMessage({ type: 'cancel', below: this.jobId });
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    this.nextTime = 0;
    this.turn = null;
    this.duck(false);
    this.resumeOutput();
  }

  // Stops speech and any reply in progress.
  interrupt() {
    // The chat calls back into this when it is stopped, so a second entry
    // while already interrupting is ignored.
    if (this.interrupting) return;
    this.interrupting = true;
    try {
      if (this.tts) this.tts.postMessage({ type: 'cancel', below: this.jobId });
      for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
      this.sources.clear();
      this.nextTime = 0;
      this.turn = null;
      this.duck(false);
      this.resumeOutput();
      if (this.chat.busy) this.chat.stop({ interrupted: true });
    } finally {
      this.interrupting = false;
    }
  }

  // The chat streams its reply into this sink. Text is sent to the speech
  // worker in phrases as it arrives so Syrix starts talking while the rest is
  // still being written. Each piece is rendered separately and loses its
  // sentence melody at the join, so pieces are kept long: the first ends at
  // the first sentence (or at a pause, if that sentence is long), and later
  // ones gather whole sentences up to a natural length. Cutting at every comma
  // made the voice stop and start like someone reading a list.
  makeSink() {
    const self = this;
    let consumed = 0;
    let first = true;
    const END = /[.!?…।]+["')\]]?(?=\s)|\n/g;
    // Where the next piece ends in the unspoken text, or -1 to wait for more.
    const nextCut = (rest) => {
      const ends = [];
      END.lastIndex = 0;
      for (let m; (m = END.exec(rest));) ends.push(m.index + m[0].length);
      if (first) {
        if (ends.length && ends[0] <= 110) return ends[0];
        // A long opening sentence is split at its first pause that has at
        // least six words before it ("Sure," alone is too short a phrase).
        const PAUSE = /[,;:—–](?=\s)/g;
        for (let m; (m = PAUSE.exec(rest.slice(0, 140)));) {
          if (rest.slice(0, m.index).split(/\s+/).length >= 6) return m.index + 1;
        }
        if (ends.length) return ends[0];
      } else {
        // Whole sentences, at least about a line of speech each.
        const long = ends.find((e) => e >= 90);
        if (long != null) return long;
      }
      if (rest.length > 260) {
        const sp = rest.lastIndexOf(' ', 240);
        if (sp > 60) return sp;
      }
      return -1;
    };
    const flushFrom = (full, final) => {
      let rest = full.slice(consumed);
      for (;;) {
        const cut = nextCut(rest);
        if (cut < 0) break;
        const chunk = rest.slice(0, cut);
        consumed += cut;
        rest = rest.slice(cut);
        if (chunk.trim()) { self.enqueue(chunk); first = false; }
      }
      if (final && rest.trim()) { self.enqueue(rest); consumed += rest.length; first = false; }
    };
    let last = '';
    return {
      begin() {
        consumed = 0;
        first = true;
        last = '';
        self.silence();
        self.turn = { firstJob: self.jobId, pending: new Set(), ended: false, text: '' };
        self.setState('thinking');
      },
      push(full) { last = full; flushFrom(full, false); },
      tool(name) { self.toolStarted(name); },
      mark() { flushFrom(last, true); consumed = 0; last = ''; },
      end() {
        flushFrom(last, true);
        if (self.turn) self.turn.ended = true;
        self.settle();
      },
      cancel() { self.silence(); },
      say(text) { self.say(text); },
    };
  }

  // Output and input loudness for the animations, 0..1.
  levels() {
    let out = 0;
    if (this.analyser && this.sources.size) {
      const a = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(a);
      let s = 0;
      for (const v of a) s += ((v - 128) / 128) ** 2;
      out = Math.min(1, Math.sqrt(s / a.length) * 4);
    }
    return { mic: Math.min(1, this.micLevel * 9), out };
  }
}
