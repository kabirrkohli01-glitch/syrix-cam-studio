// Speech synthesis worker. Two engines:
//   fast        Kokoro (full precision) on the GPU. Measured on an RTX 4060 at
//               0.6-1 s per sentence, about 5x faster than real time, so a
//               reply starts soon after its first sentence arrives.
//   expressive  Chatterbox Turbo on the GPU: can laugh, sigh and sound
//               sarcastic, but about 2x real time and 11 s to load.
// Without a suitable GPU, Kokoro runs on the CPU (about real time), with
// performance cues stripped since it cannot act them out.

import { ChatterboxModel, AutoProcessor, Tensor } from '../../vendor/voice/transformers.min.js';
import { appUrl, setThreads, hasWebGPU, progressTracker, decodeWav } from './runtime.js';
import { DEVANAGARI, hindiPhonemes } from './hindi.js';
import { phonemize } from '../../vendor/voice/phonemizer.js';

setThreads(4);

const RATE = 24000;
// Kokoro stands in for each Chatterbox voice when the GPU path is unavailable.
const KOKORO_VOICE = { atlas: 'bm_george', nova: 'bf_emma', echo: 'am_michael', aria: 'af_bella' };
// Kokoro's Hindi voices, matched to each voice's gender.
const HINDI_VOICE = { atlas: 'hm_omega', nova: 'hf_alpha', echo: 'hm_psi', aria: 'hf_beta' };
const CUE = /\[(laugh|chuckle|sigh|gasp|groan|cough|sniff|clear throat|shush|sarcastic|happy|surprised|angry|fear|whispering|dramatic|crying)\]/gi;

let engine = null;
let loading = null;
// Kokoro loaded on the side for Hindi when the expressive (English-only)
// voice is the main engine.
let hindiKokoro = null;
let cancelledBelow = 0;
const queue = [];
let working = false;

const post = (m, transfer) => self.postMessage(m, transfer || []);

// True when generated speech is real sound: no NaN or infinite samples and
// not near-silent. A GPU build that runs but produces garbage is rejected at
// start-up instead of making Syrix go quiet.
function audible(pcm) {
  if (!pcm || !pcm.length) return false;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    if (!Number.isFinite(v)) return false;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length) > 0.005;
}

// 4-bit weights with full-precision arithmetic. The half-precision builds run
// faster but GPT-2 style activations overflow in fp16 on the GPU, which turned
// whole sentences into mumbling; this set reads back word for word through
// speech recognition.
const DTYPE = { embed_tokens: 'q4', language_model: 'q4', speech_encoder: 'q4', conditional_decoder: 'q4' };

async function loadChatterbox(onProgress, dtype) {
  const model = await ChatterboxModel.from_pretrained('chatterbox', {
    device: 'webgpu',
    dtype: { ...DTYPE, ...dtype },
    progress_callback: onProgress,
  });
  const processor = await AutoProcessor.from_pretrained('chatterbox');
  return { kind: 'chatterbox', model, processor, speakers: new Map() };
}

async function loadKokoro(onProgress, gpu) {
  const { KokoroTTS } = await import('../../vendor/voice/kokoro.js');
  // The 8-bit build is the fastest on the CPU but runs slower than real time
  // on the GPU, so the GPU gets the full-precision build. The half-precision
  // build is not used: on WebGPU every sample it produced was NaN, so replies
  // were generated quickly and played as silence.
  const tts = gpu
    ? await KokoroTTS.from_pretrained('kokoro', { dtype: 'fp32', device: 'webgpu', progress_callback: onProgress })
    : await KokoroTTS.from_pretrained('kokoro', { dtype: 'q8', device: 'wasm', progress_callback: onProgress });
  return { kind: gpu ? 'kokoro-gpu' : 'kokoro', tts };
}

async function speaker(e, voice) {
  if (e.speakers.has(voice)) return e.speakers.get(voice);
  const res = await fetch(appUrl(`models/voice/voices/${voice}.wav`));
  if (!res.ok) throw new Error(`Voice "${voice}" is missing`);
  const { audio } = decodeWav(await res.arrayBuffer());
  const data = await e.model.encode_speech(new Tensor('float32', audio, [1, audio.length]));
  e.speakers.set(voice, data);
  return data;
}

async function init(voice, prefer, dtype) {
  if (engine) return engine;
  if (loading) return loading;
  loading = (async () => {
    const progress = progressTracker((pct) => post({ type: 'status', state: 'loading', progress: pct }));
    const gpu = prefer !== 'cpu' && await hasWebGPU();
    if (gpu && prefer === 'expressive') {
      try {
        engine = await loadChatterbox(progress, dtype);
        await speaker(engine, voice);
        // Warm-up compiles the GPU shaders so the first real reply is quick,
        // and proves the output is real sound.
        if (!audible(await synth('Hi there.', voice, 1))) throw new Error('Expressive voice produced no sound');
      } catch (err) {
        console.warn('Expressive voice unavailable, using the fast voice', err);
        engine = null;
      }
    }
    if (!engine && gpu) {
      try {
        engine = await loadKokoro(progress, true);
        // The first GPU run compiles shaders and takes about 2 s; it happens
        // here instead of on the first reply, and proves the output is real
        // sound.
        if (!audible(await synth('Hi there.', voice, 1))) throw new Error('GPU voice produced no sound');
      } catch (err) {
        console.warn('GPU voice unavailable, using the CPU voice', err);
        engine = null;
      }
    }
    if (!engine) engine = await loadKokoro(progress, false);
    post({ type: 'status', state: 'ready', engine: engine.kind });
    return engine;
  })();
  try {
    return await loading;
  } catch (err) {
    loading = null;
    post({ type: 'status', state: 'error', message: String(err && err.message || err) });
    throw err;
  }
}

// Kokoro pads every clip with silence at both ends. Played back to back,
// two clips left a gap of about 0.4 s at every comma and full stop, which made
// Syrix sound like it was reading a list. Leading silence is cut to 20 ms and
// trailing silence to a short pause that is longer after a sentence than
// after a clause.
function trimSilence(pcm, text) {
  if (!pcm || pcm.length < RATE * 0.2) return pcm;
  const th = 0.012;
  let a = 0, b = pcm.length - 1;
  while (a < pcm.length && Math.abs(pcm[a]) < th) a++;
  while (b > a && Math.abs(pcm[b]) < th) b--;
  if (b <= a) return pcm;
  const tail = /[.!?…।]["')]?\s*$/.test(text) ? 0.16 : /[,;:—–]\s*$/.test(text) ? 0.07 : 0.03;
  const start = Math.max(0, a - Math.round(RATE * 0.02));
  const end = Math.min(pcm.length, b + Math.round(RATE * tail));
  return pcm.slice(start, end);
}

async function hindiTts() {
  if (engine && engine.kind !== 'chatterbox') return engine.tts;
  if (!hindiKokoro) hindiKokoro = loadKokoro(() => {}, await hasWebGPU());
  return (await hindiKokoro).tts;
}

async function synth(text, voice, speed) {
  const e = engine;
  // Hindi (Devanagari) goes to a Hindi voice with phonemes from hindi.js;
  // English words inside it use the English phonemizer.
  if (DEVANAGARI.test(text)) {
    const plain = text.replace(CUE, '').replace(/\s{2,}/g, ' ').trim();
    const tts = await hindiTts();
    const ph = await hindiPhonemes(plain, async (s) => (await phonemize(s, 'en-us')).join(' '));
    const { input_ids } = tts.tokenizer(ph, { truncation: true });
    const out = await tts.generate_from_ids(input_ids, { voice: HINDI_VOICE[voice] || 'hm_omega', speed: speed || 1 });
    return trimSilence(out.audio, plain);
  }
  if (e.kind === 'chatterbox') {
    const spk = await speaker(e, voice);
    const inputs = await e.processor(text);
    const words = text.split(/\s+/).length;
    const waveform = await e.model.generate({
      ...inputs,
      ...spk,
      max_new_tokens: Math.min(1000, 60 + words * 14),
      repetition_penalty: 1.2,
    });
    return trimSilence(waveform.data instanceof Float32Array ? waveform.data : Float32Array.from(waveform.data), text);
  }
  const plain = text.replace(CUE, '').replace(/\s{2,}/g, ' ').trim();
  if (!plain) return new Float32Array(0);
  const out = await e.tts.generate(plain, { voice: KOKORO_VOICE[voice] || 'bm_george', speed: speed || 1.05 });
  return trimSilence(out.audio, plain);
}

async function pump() {
  if (working) return;
  working = true;
  while (queue.length) {
    // Replies jump ahead of pre-rendered clips, which are only needed later.
    const at = queue.findIndex((j) => !j.clip);
    const job = queue.splice(at >= 0 ? at : 0, 1)[0];
    if (!job.clip && job.id < cancelledBelow) continue;
    try {
      await init(job.voice);
      const t0 = performance.now();
      const pcm = await synth(job.text, job.voice, job.speed);
      if (job.clip) {
        post({ type: 'clip', key: job.clip, voice: job.voice, pcm, rate: RATE }, [pcm.buffer]);
        continue;
      }
      if (job.id < cancelledBelow) continue;
      post({ type: 'audio', id: job.id, seq: job.seq, pcm, rate: RATE, ms: Math.round(performance.now() - t0) }, [pcm.buffer]);
    } catch (err) {
      post({ type: 'error', id: job.id, seq: job.seq, message: String(err && err.message || err) });
    }
  }
  working = false;
}

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    init(m.voice || 'atlas', m.prefer, m.dtype).catch(() => {});
  } else if (m.type === 'speak') {
    queue.push(m);
    pump();
  } else if (m.type === 'prerender') {
    // Short clips (acknowledgements, "one sec") rendered once in the
    // background so they can be played with no synthesis delay.
    for (const c of m.clips) queue.push({ clip: c.key, text: c.text, voice: m.voice });
    pump();
  } else if (m.type === 'cancel') {
    cancelledBelow = Math.max(cancelledBelow, m.below);
    for (let i = queue.length - 1; i >= 0; i--) if (!queue[i].clip && queue[i].id < cancelledBelow) queue.splice(i, 1);
  } else if (m.type === 'reference') {
    // Development aid: renders a reference clip with the CPU voice so new
    // voices can be added. Not used by the app at run time.
    const k = await loadKokoro(() => {});
    const out = await k.tts.generate(m.text, { voice: m.kokoro, speed: 1 });
    post({ type: 'reference', pcm: out.audio, rate: out.sampling_rate }, [out.audio.buffer]);
  }
};
