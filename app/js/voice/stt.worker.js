// Speech recognition worker. Microphone frames (16 kHz mono, 512 samples)
// arrive on a MessagePort straight from the audio thread. Silero VAD decides
// when speech starts and ends; Whisper large-v3-turbo on the GPU transcribes
// each utterance, with Moonshine on the CPU as the fallback. Partial
// transcripts are produced while the user is still talking so captions keep
// up with speech.

import { pipeline, Tensor } from '../../vendor/voice/transformers.min.js';
import * as ort from '../../vendor/voice/ort.wasm.min.mjs';
import { appUrl, setThreads, hasWebGPU, progressTracker } from './runtime.js';

setThreads(4);
ort.env.wasm.wasmPaths = { mjs: appUrl('vendor/voice/ort-wasm-simd-threaded.mjs'), wasm: appUrl('vendor/voice/ort-wasm-simd-threaded.wasm') };
ort.env.wasm.numThreads = 1;

const SR = 16000;
const FRAME = 512;
const FRAME_MS = (FRAME / SR) * 1000;
const CONTEXT = 64;

const cfg = {
  // 'auto' picks English or Hindi for each utterance; 'en' or 'hi' forces one.
  language: 'auto',
  endSilenceMs: 650,
  // A finished-sounding sentence ends the turn after this much silence
  // instead of the full endSilenceMs.
  quickEndMs: 420,
  // Transcription of the utterance starts this far into a pause, while the
  // end of the turn is still being decided.
  specMs: 240,
  minSpeechMs: 260,
  // Confident speech an utterance needs before it is transcribed at all.
  minConfidentMs: 220,
  // Confident speech that counts as the user really talking over Syrix.
  longMs: 900,
  // Extra time past endSilenceMs that unconfident murmur may hold a turn open.
  unsureGraceMs: 450,
  maxUtteranceMs: 25000,
  startProb: 0.5,
  bargeProb: 0.85,
  confidentProb: 0.6,
  endProb: 0.35,
  speaking: false,
  enabled: true,
};

let asr = null;
let engineKind = null;
let vad = null;
let vadState = null;
let vadContext = new Float32Array(CONTEXT);
const srTensor = () => new ort.Tensor('int64', BigInt64Array.from([BigInt(SR)]), []);

const pre = [];
const PRE_FRAMES = Math.round(400 / FRAME_MS);
let seg = null;
let busy = false;
let partialAt = 0;
let spec = null;
let queue = Promise.resolve();

const post = (m) => self.postMessage(m);

// ---------------------------------------------------------------- input gain
//
// A voice from across the room reaches the microphone at a fraction of the
// level of one at arm's length, and the speech detector then rarely becomes
// confident enough to start. Frames are boosted towards a steady speech level
// before detection and recognition: the gain follows the recent loudest
// frames (decaying over about half a minute), never cuts, is capped at 6x,
// and is held down so the room's noise floor stays well below speech level.
// Lifting a fan or traffic to near speech level made the detector hover just
// above its end threshold, so a turn in a noisy room never ended. A soft
// limiter keeps boosted peaks from clipping.
const agc = { gain: 1, peak: 0.03 };
const TARGET = 0.09;
const MAX_GAIN = 6;

const rms = (frame) => {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
};

function levelUp(frame, r) {
  agc.peak = r > agc.peak ? agc.peak + (r - agc.peak) * 0.3 : agc.peak * 0.9985;
  const want = Math.min(MAX_GAIN, Math.max(1, TARGET / Math.max(agc.peak, 1e-4), 1), 0.006 / Math.max(room.floor, 1e-5));
  agc.gain += (Math.max(1, want) - agc.gain) * 0.05;
  if (agc.gain < 1.02) return frame;
  const out = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] * agc.gain;
    out[i] = v > 0.8 || v < -0.8 ? Math.tanh(v) : v;
  }
  return out;
}

// ---------------------------------------------------------------- room noise
//
// The level of the room without anyone talking, measured on the raw
// microphone signal. It drops at once to any quieter frame and rises within
// about a second while the detector hears no speech (a fan switching on), but
// barely at all while someone talks. A frame only counts as speech when it is
// clearly louder than this floor, so steady noise cannot hold a turn open or
// start one, however the detector scores it.
const room = { floor: 0.002 };
const SPEECH_OVER_FLOOR = 1.8;
const START_OVER_FLOOR = 2.5;

function trackRoom(r, p) {
  if (r < room.floor) room.floor += (r - room.floor) * 0.2;
  else room.floor += (r - room.floor) * (p < 0.25 ? 0.03 : 0.0005);
  room.floor = Math.max(room.floor, 1e-5);
}

// ---------------------------------------------------------------- language
//
// The speech pipeline in transformers.js does not detect the language: with
// none given it transcribes everything as English, so Hindi came back as an
// English translation or as nonsense. The encoder runs once; one decoder step
// compares the model's own English, Hindi and Urdu language tokens (Urdu is
// spoken Hindi written in another script, so it counts as Hindi); then the
// transcript is generated in the winning language from the same encoder
// output, so the check costs one small decoder step.
let lastLang = 'en';
let lidBroken = false;

function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

function logitAt(t, i) {
  const v = t.data[i];
  return t.type === 'float16' && typeof v === 'number' && Number.isInteger(v) && !(t.data instanceof Float32Array) ? halfToFloat(v) : Number(v);
}

async function whisperTranscribe(audio) {
  const m = asr.model;
  // generate() keeps only the inputs named in forward_params, which for
  // Whisper leaves out encoder_outputs, so the encoder ran a second time
  // (measured: +0.55 s per utterance). Listing it lets the language check's
  // encoder pass be reused.
  if (Array.isArray(m.forward_params) && !m.forward_params.includes('encoder_outputs')) m.forward_params = [...m.forward_params, 'encoder_outputs'];
  const { input_features } = await asr.processor(audio);
  let language = cfg.language === 'auto' ? null : cfg.language;
  let encoderOutputs = null;
  if (!language && !lidBroken) {
    try {
      const g = m.generation_config || {};
      const ids = g.lang_to_id || {};
      const kw = await m._prepare_encoder_decoder_kwargs_for_generation({ inputs_tensor: input_features, model_inputs: { input_features }, model_input_name: 'input_features', generation_config: {} });
      encoderOutputs = kw.encoder_outputs;
      const out = await m.forward({ encoder_outputs: encoderOutputs, decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(g.decoder_start_token_id ?? 50258)]), [1, 1]) });
      const L = out.logits;
      const V = L.dims[L.dims.length - 1];
      const base = L.data.length - V;
      const score = (tok) => (ids[tok] != null ? logitAt(L, base + ids[tok]) : -Infinity);
      const en = score('<|en|>'), hi = score('<|hi|>'), ur = score('<|ur|>');
      const mx = Math.max(en, hi, ur);
      const pe = Math.exp(en - mx), ph = Math.exp(hi - mx) + Math.exp(ur - mx);
      const pHindi = ph / (pe + ph);
      // Staying in the language just used needs less evidence than switching.
      language = pHindi > (lastLang === 'hi' ? 0.35 : 0.6) ? 'hi' : 'en';
      if (out.past_key_values) for (const v of Object.values(out.past_key_values)) { try { v.dispose && v.dispose(); } catch { /* already freed */ } }
    } catch (err) {
      console.warn('Language check unavailable; transcribing as English', err);
      lidBroken = true;
      encoderOutputs = null;
    }
  }
  language = language || 'en';
  const ids = await m.generate({ input_features, ...(encoderOutputs ? { encoder_outputs: encoderOutputs } : {}), language, task: 'transcribe', max_new_tokens: 220 });
  const text = asr.tokenizer.batch_decode(ids, { skip_special_tokens: true })[0] || '';
  return { text, lang: language };
}

async function loadAsr() {
  const progress = progressTracker((pct) => post({ type: 'status', state: 'loading', progress: pct }));
  if (await hasWebGPU()) {
    try {
      asr = await pipeline('automatic-speech-recognition', 'whisper', {
        device: 'webgpu',
        dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' },
        progress_callback: progress,
      });
      engineKind = 'whisper';
      await whisperTranscribe(new Float32Array(SR));
      return;
    } catch (err) {
      console.warn('GPU recognition unavailable, using the CPU model', err);
      asr = null;
    }
  }
  asr = await pipeline('automatic-speech-recognition', 'moonshine', { device: 'wasm', dtype: 'q8', progress_callback: progress });
  engineKind = 'moonshine';
}

async function loadVad() {
  vad = await ort.InferenceSession.create(appUrl('models/voice/vad/silero_vad.onnx'), { executionProviders: ['wasm'] });
  resetVad();
}

function resetVad() {
  vadState = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  vadContext = new Float32Array(CONTEXT);
}

async function speechProb(frame) {
  const x = new Float32Array(CONTEXT + FRAME);
  x.set(vadContext, 0);
  x.set(frame, CONTEXT);
  vadContext = frame.slice(FRAME - CONTEXT);
  const out = await vad.run({ input: new ort.Tensor('float32', x, [1, CONTEXT + FRAME]), state: vadState, sr: srTensor() });
  vadState = out.stateN;
  return out.output.data[0];
}

function concat(frames) {
  const out = new Float32Array(frames.length * FRAME);
  frames.forEach((f, i) => out.set(f, i * FRAME));
  return out;
}

// Whisper invents stock phrases for noise and silence; these are dropped
// when they make up the whole of a short utterance.
const HALLUCINATION = /^(thank you( (so much|very much))?( for watching)?[.!]?|thanks( for watching)?[.!]?|you|bye[.!]?|bye[- ]bye[.!]?|okay\.?|so\.?|uh+\.?|um+\.?|hmm+\.?|\.+|i'?m sorry\.?|please subscribe.*|see you (next time|in the next video).*|subtitles .*|\[.*\]|\(.*\)|♪.*)$/i;
const STOCK = /^(thank you( (so much|very much))?( for watching)?|thanks for watching|please subscribe.*|subtitles .*|♪.*|\[.*\]|\(.*\))[.!]?$/i;

// confidentMs: how much of the utterance the detector was sure was speech.
function clean(text, speechMs, confidentMs = speechMs) {
  let t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return '';
  if (speechMs < 1500 && HALLUCINATION.test(t)) return '';
  if (STOCK.test(t)) return '';
  // Whisper stuck in a loop repeats one word or phrase; one copy is kept.
  t = t.replace(/\b(\S+(?: \S+){0,3}?)(?:[ ,]+\1\b){3,}/giu, '$1');
  // Far more words than the speech could hold were invented from noise:
  // nobody says ten words in a second.
  const n = t.split(/\s+/).length;
  if (n > 4 + (confidentMs / 1000) * 6) return '';
  // The assistant's name is unusual, so recognisers spell it a few ways.
  return t.replace(/\b(cyrix|sirix|syrics|sirex|zyrix|cyrex|sy rix|siri x)\b/gi, 'Syrix');
}

// Text and language ('en' or 'hi') of an utterance.
async function transcribeNow(audio) {
  if (engineKind === 'whisper') return whisperTranscribe(audio);
  const out = await asr(audio, {});
  return { text: Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text, lang: 'en' };
}

// One model session cannot run two inferences at once, so every
// transcription, partial or final, goes through this single queue.
function transcribe(audio) {
  const run = queue.then(() => transcribeNow(audio));
  queue = run.catch(() => {});
  return run;
}

// Audio of the utterance without the trailing silence (200 ms is kept so the
// last word is not clipped).
function trimmed(s) {
  return concat(s.frames.slice(0, Math.max(1, s.frames.length - Math.max(0, s.silence - Math.round(200 / FRAME_MS)))));
}

// A transcript that reads as a finished sentence: terminal punctuation, and
// not trailing off on a conjunction or filler ("so I was thinking and.").
const TRAILING = /(\b(and|but|so|or|because|like|the|a|an|to|of|with|um|uh|if|then|matlab|toh|aur|ki|ke|ka|ko|jo|yaar)|और|तो|कि|के|का|को|जो|मतलब|यानी)[.?!।]?$/iu;
const complete = (t) => !!t && /[.?!।]["')]?$/.test(t) && !TRAILING.test(t);

// Speculative transcription: once a pause starts, the utterance so far is
// transcribed straight away. If the pause turns out to be the end of the
// turn, the text is already there and recognition costs no extra time after
// the silence window; if speech resumes, the result is thrown away.
function speculate(s) {
  const audio = trimmed(s);
  const t0 = performance.now();
  const job = { speechFrames: s.speechFrames, confident: s.confident, text: null, done: false, t0, audioMs: Math.round((audio.length / SR) * 1000) };
  job.promise = transcribe(audio).then((r) => {
    job.text = clean(r.text, job.speechFrames * FRAME_MS, job.confident * FRAME_MS);
    job.lang = r.lang;
    job.done = true;
    job.ms = Math.round(performance.now() - t0);
    // A complete sentence followed by a pause is very likely the end of the
    // turn, so it is answered without waiting out the full silence window.
    if (seg === s && spec === job && s.started && s.silence * FRAME_MS >= cfg.quickEndMs && complete(job.text)) finish('quick');
    return job.text;
  }, () => { job.done = true; return null; });
  return job;
}

function finish(reason) {
  const s = seg;
  const pending = spec;
  seg = null;
  spec = null;
  partialAt = 0;
  if (!s) return;
  post({ type: 'speech', state: 'end', reason });
  const speechMs = s.speechFrames * FRAME_MS;
  const confidentMs = Math.round(s.confident * FRAME_MS);
  if (speechMs < cfg.minSpeechMs) { post({ type: 'final', text: '', dropped: 'short' }); return; }
  // A turn the detector was never really sure about is a door, a cough or
  // the television, not someone talking; Whisper would still invent words
  // for it.
  if (confidentMs < cfg.minConfidentMs) { post({ type: 'final', text: '', dropped: 'noise', confidentMs }); return; }
  // The speculative pass covers everything said if no speech came after it.
  if (pending && pending.speechFrames === s.speechFrames) {
    pending.promise.then((text) => {
      if (text != null) { if (text) lastLang = pending.lang; post({ type: 'final', text, lang: pending.lang, ms: pending.ms, audioMs: pending.audioMs, confidentMs, speculative: true }); }
      else transcribeFinal(s, speechMs, confidentMs);
    });
    return;
  }
  transcribeFinal(s, speechMs, confidentMs);
}

function transcribeFinal(s, speechMs, confidentMs) {
  const audio = trimmed(s);
  const t0 = performance.now();
  transcribe(audio).then(
    (r) => { const text = clean(r.text, speechMs, confidentMs); if (text) lastLang = r.lang; post({ type: 'final', text, lang: r.lang, ms: Math.round(performance.now() - t0), audioMs: Math.round((audio.length / SR) * 1000), confidentMs }); },
    (err) => post({ type: 'final', text: '', error: String(err && err.message || err) }),
  );
}

async function onFrame(raw) {
  if (!vad || !asr || !cfg.enabled) return;
  const r = rms(raw);
  const frame = levelUp(raw, r);
  const p = await speechProb(frame);
  trackRoom(r, p);
  pre.push(frame);
  if (pre.length > PRE_FRAMES) pre.shift();
  const startProb = cfg.speaking ? cfg.bargeProb : cfg.startProb;
  // The detector's score alone is not enough in a noisy room: the frame must
  // also stand out from the room's own level.
  const voiced = p >= cfg.endProb && r >= room.floor * SPEECH_OVER_FLOOR;
  const sure = p >= Math.max(cfg.confidentProb, startProb * 0.8) && r >= room.floor * SPEECH_OVER_FLOOR;

  if (!seg) {
    if (p >= startProb && r >= room.floor * START_OVER_FLOOR) {
      seg = { frames: [...pre], run: 1, speechFrames: 1, confident: 1, silence: 0, unsure: 0, started: false };
    }
    return;
  }

  seg.frames.push(frame);
  if (sure) { seg.confident++; seg.unsure = 0; } else seg.unsure++;
  if (voiced) {
    seg.speechFrames++;
    seg.silence = 0;
    // Speech resumed: a speculative transcript of the pause is out of date.
    spec = null;
    if (!seg.started) {
      seg.run++;
      // Three confident frames in a row (about 100 ms) count as speech; one
      // loud click does not.
      if (seg.run >= 3 && sure) {
        seg.started = true;
        post({ type: 'speech', state: 'start' });
      }
    }
  } else {
    seg.silence++;
    if (!seg.started) { seg = null; partialAt = 0; return; }
  }

  const ms = seg.frames.length * FRAME_MS;
  // Close to a second of confident speech is a person talking, not a cough,
  // a click or Syrix's own echo: the page uses it to pause Syrix mid-sentence.
  if (seg.started && !seg.long && seg.confident * FRAME_MS >= cfg.longMs) { seg.long = true; post({ type: 'speech', state: 'long' }); }
  if (seg.started && seg.silence * FRAME_MS >= cfg.endSilenceMs) { finish('silence'); return; }
  // Murmur the detector half-believes (a television next door, a fan it
  // scores near the threshold) can keep "voiced" frames coming for ever. The
  // turn ends once nothing confident has been heard for a little longer than
  // the normal pause.
  if (seg.started && seg.unsure * FRAME_MS >= cfg.endSilenceMs + cfg.unsureGraceMs) { finish('unsure'); return; }
  if (seg.started && !spec && seg.silence * FRAME_MS >= cfg.specMs && seg.speechFrames * FRAME_MS >= cfg.minSpeechMs) spec = speculate(seg);
  if (seg.started && spec && spec.done && seg.silence * FRAME_MS >= cfg.quickEndMs && complete(spec.text)) { finish('quick'); return; }
  if (ms >= cfg.maxUtteranceMs) { finish('length'); return; }

  // Live captions: re-transcribe the growing utterance every couple of
  // seconds, never stacking requests behind each other. Each pass costs as
  // much as a final one (Whisper always encodes a 30 s window), and a pass
  // still running when the user stops talking delays the real answer by up to
  // a second. Most requests are under two seconds long, so none is captioned
  // until the utterance is past that; short questions are never slowed down.
  // No caption pass starts during a pause, where it would hold up the
  // speculative transcript of the finished turn.
  if (seg.started && !busy && seg.silence === 0 && ms - partialAt >= 2000 && ms > 2200) {
    partialAt = ms;
    busy = true;
    const audio = concat(seg.frames);
    transcribe(audio).then((r) => {
      if (seg) post({ type: 'partial', text: (r.text || '').trim() });
    }).catch(() => {}).finally(() => { busy = false; });
  }
}

let chain = Promise.resolve();
self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    m.port.onmessage = (e) => { const f = e.data; chain = chain.then(() => onFrame(f)); };
    try {
      post({ type: 'status', state: 'loading', progress: 0 });
      await Promise.all([loadVad(), loadAsr()]);
      post({ type: 'status', state: 'ready', engine: engineKind });
    } catch (err) {
      post({ type: 'status', state: 'error', message: String(err && err.message || err) });
    }
  } else if (m.type === 'config') {
    Object.assign(cfg, m.config);
    if (!cfg.enabled) { seg = null; spec = null; resetVad(); }
  } else if (m.type === 'reset') {
    seg = null;
    spec = null;
    pre.length = 0;
    resetVad();
  } else if (m.type === 'room') {
    // Development aid: the measured room level and input gain.
    post({ type: 'room', floor: room.floor, gain: agc.gain });
  } else if (m.type === 'bench') {
    // Development aid: times the stock pipeline against the language-aware path.
    const out = {};
    let t = performance.now();
    await asr(m.audio, { language: 'en', task: 'transcribe' });
    out.pipeline = Math.round(performance.now() - t);
    t = performance.now();
    await whisperTranscribe(m.audio);
    out.auto = Math.round(performance.now() - t);
    const prev = cfg.language;
    cfg.language = 'en';
    t = performance.now();
    await whisperTranscribe(m.audio);
    out.forcedEn = Math.round(performance.now() - t);
    cfg.language = prev;
    post({ type: 'bench', ...out });
  } else if (m.type === 'transcribe') {
    // Development aid: transcribes a supplied buffer directly.
    const t0 = performance.now();
    const prev = cfg.language;
    if (m.language) cfg.language = m.language;
    const r = await transcribe(m.audio);
    cfg.language = prev;
    post({ type: 'transcript', text: r.text, lang: r.lang, ms: Math.round(performance.now() - t0) });
  }
};
