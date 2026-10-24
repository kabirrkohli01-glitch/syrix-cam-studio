// Signal processing for the Health panel: camera heart rate (remote
// photoplethysmography), breathing rate from body movement, and the small
// numeric helpers they share. Everything runs on this PC on numbers taken
// from the video; no images are kept.

const TAU = Math.PI * 2;

// In-place radix-2 FFT. re and im must have a power-of-two length.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length)); };

// Resamples irregular (time, value) samples onto a fixed rate.
export function resample(times, values, rate, seconds) {
  const end = times[times.length - 1];
  const start = Math.max(times[0], end - seconds);
  const n = Math.floor((end - start) * rate);
  const out = new Float64Array(Math.max(0, n));
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = start + i / rate;
    while (j < times.length - 2 && times[j + 1] < t) j++;
    const t0 = times[j], t1 = times[j + 1] ?? t0;
    const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    out[i] = values[j] + ((values[j + 1] ?? values[j]) - values[j]) * Math.max(0, Math.min(1, k));
  }
  return out;
}

function detrend(x) {
  const n = x.length;
  if (n < 3) return x;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; }
  const b = (n * sxy - sx * sy) / Math.max(1e-9, n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] - (a + b * i);
  return out;
}

// Dominant frequency between lo and hi Hz, with a quality score: the share of
// in-band power that sits at the peak and its first harmonic.
export function dominant(x, rate, lo, hi) {
  const d = detrend(x);
  let n = 1;
  while (n < d.length * 4) n <<= 1;
  n = Math.max(n, 1024);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < d.length; i++) re[i] = d[i] * (0.5 - 0.5 * Math.cos((TAU * i) / (d.length - 1)));
  fft(re, im);
  const bin = rate / n;
  const a = Math.ceil(lo / bin), b = Math.floor(hi / bin);
  let best = -1, bp = 0, total = 0;
  const pow = new Float64Array(n / 2);
  for (let k = 1; k < n / 2; k++) pow[k] = re[k] * re[k] + im[k] * im[k];
  for (let k = a; k <= b; k++) { total += pow[k]; if (pow[k] > bp) { bp = pow[k]; best = k; } }
  if (best < 0 || total <= 0) return null;
  // Parabolic interpolation refines the peak between bins.
  const y0 = pow[best - 1] || 0, y1 = pow[best], y2 = pow[best + 1] || 0;
  const shift = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
  const freq = (best + Math.max(-0.5, Math.min(0.5, shift))) * bin;
  const span = Math.max(1, Math.round(0.08 / bin));
  let peak = 0;
  for (let k = best - span; k <= best + span; k++) peak += pow[k] || 0;
  const h = best * 2;
  for (let k = h - span; k <= h + span; k++) if (k < n / 2) peak += (pow[k] || 0) * 0.5;
  return { freq, quality: Math.min(1, peak / total) };
}

// Simple band-pass made of two one-pole sections, applied forwards and
// backwards so the waveform is not shifted in time.
export function bandpass(x, rate, lo, hi) {
  const run = (arr, f) => {
    const out = new Float64Array(arr.length);
    const dt = 1 / rate;
    const rcL = 1 / (TAU * hi), aL = dt / (rcL + dt);
    const rcH = 1 / (TAU * lo), aH = rcH / (rcH + dt);
    let low = arr[0], prevLow = arr[0], high = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = f ? arr[i] : arr[arr.length - 1 - i];
      low += aL * (v - low);
      high = aH * (high + low - prevLow);
      prevLow = low;
      out[f ? i : arr.length - 1 - i] = high;
    }
    return out;
  };
  return run(run(x, true), false);
}

// Camera heart rate with the POS method (Wang et al., "Algorithmic Principles
// of Remote PPG", 2017): skin colour is normalised over short windows and
// projected onto the plane orthogonal to skin tone, where the pulse shows up
// and most lighting and motion changes cancel out.
export class Pulse {
  constructor() { this.reset(); }

  reset() {
    this.t = [];
    this.rgb = [];
    this.motion = [];
    this.bpm = null;
    this.quality = 0;
    this.wave = [];
    this.hrv = null;
  }

  push(t, r, g, b, motion) {
    this.t.push(t);
    this.rgb.push([r, g, b]);
    this.motion.push(motion);
    while (this.t.length && t - this.t[0] > 20) { this.t.shift(); this.rgb.shift(); this.motion.shift(); }
  }

  get seconds() { return this.t.length ? this.t[this.t.length - 1] - this.t[0] : 0; }

  compute() {
    if (this.seconds < 6) return null;
    const rate = 30;
    const secs = Math.min(15, this.seconds);
    const R = resample(this.t, this.rgb.map((c) => c[0]), rate, secs);
    const G = resample(this.t, this.rgb.map((c) => c[1]), rate, secs);
    const B = resample(this.t, this.rgb.map((c) => c[2]), rate, secs);
    const n = R.length;
    const l = Math.round(1.6 * rate);
    const H = new Float64Array(n);
    for (let m = 0; m + l <= n; m++) {
      const r = R.subarray(m, m + l), g = G.subarray(m, m + l), b = B.subarray(m, m + l);
      const mr = mean(r) || 1, mg = mean(g) || 1, mb = mean(b) || 1;
      const s1 = new Float64Array(l), s2 = new Float64Array(l);
      for (let i = 0; i < l; i++) {
        const cr = r[i] / mr, cg = g[i] / mg, cb = b[i] / mb;
        s1[i] = cg - cb;
        s2[i] = -2 * cr + cg + cb;
      }
      const alpha = std(s1) / (std(s2) || 1);
      const h = new Float64Array(l);
      for (let i = 0; i < l; i++) h[i] = s1[i] + alpha * s2[i];
      const mh = mean(h);
      for (let i = 0; i < l; i++) H[m + i] += h[i] - mh;
    }
    const wave = bandpass(H, rate, 0.7, 3.5);
    const res = dominant(wave, rate, 0.75, 3.3);
    if (!res) return null;
    const moving = mean(this.motion.slice(-90));
    // Head movement smears the colour signal, so quality is discounted.
    const quality = res.quality * Math.max(0.25, 1 - moving * 2);
    const bpm = res.freq * 60;
    this.quality = this.quality + (quality - this.quality) * 0.3;
    if (quality > 0.18) this.bpm = this.bpm == null ? bpm : this.bpm + (bpm - this.bpm) * (quality > 0.35 ? 0.35 : 0.15);
    this.wave = Array.from(wave.subarray(Math.max(0, wave.length - rate * 6)));
    this.hrv = this.beats(wave, rate, bpm);
    return { bpm: this.bpm, quality: this.quality };
  }

  // Beat-to-beat intervals from the filtered waveform: RMSSD in ms. Only
  // meaningful with a clean signal, so it is reported as an estimate.
  beats(wave, rate, bpm) {
    const minGap = Math.floor((rate * 60) / Math.min(190, bpm * 1.45));
    const peaks = [];
    for (let i = 1; i < wave.length - 1; i++) {
      if (wave[i] > wave[i - 1] && wave[i] >= wave[i + 1] && wave[i] > 0) {
        if (peaks.length && i - peaks[peaks.length - 1] < minGap) {
          if (wave[i] > wave[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
        } else peaks.push(i);
      }
    }
    if (peaks.length < 6) return null;
    const ibi = [];
    for (let i = 1; i < peaks.length; i++) ibi.push(((peaks[i] - peaks[i - 1]) / rate) * 1000);
    const med = [...ibi].sort((a, b) => a - b)[ibi.length >> 1];
    const clean = ibi.filter((v) => Math.abs(v - med) < med * 0.25);
    if (clean.length < 5) return null;
    let s = 0;
    for (let i = 1; i < clean.length; i++) s += (clean[i] - clean[i - 1]) ** 2;
    return Math.round(Math.sqrt(s / (clean.length - 1)));
  }
}

// Breathing rate from the slow rise and fall of the shoulders (or the head,
// when shoulders are out of view), normalised by body size.
export class Breath {
  constructor() { this.reset(); }

  reset() {
    this.t = [];
    this.v = [];
    this.rpm = null;
    this.quality = 0;
    this.wave = [];
  }

  push(t, v) {
    this.t.push(t);
    this.v.push(v);
    while (this.t.length && t - this.t[0] > 40) { this.t.shift(); this.v.shift(); }
  }

  get seconds() { return this.t.length ? this.t[this.t.length - 1] - this.t[0] : 0; }

  compute() {
    if (this.seconds < 12) return null;
    const rate = 10;
    const x = resample(this.t, this.v, rate, Math.min(30, this.seconds));
    const wave = bandpass(x, rate, 0.1, 0.7);
    const res = dominant(wave, rate, 0.1, 0.6);
    if (!res) return null;
    this.quality = this.quality + (res.quality - this.quality) * 0.3;
    const rpm = res.freq * 60;
    if (res.quality > 0.2) this.rpm = this.rpm == null ? rpm : this.rpm + (rpm - this.rpm) * 0.3;
    this.wave = Array.from(wave.subarray(Math.max(0, wave.length - rate * 20)));
    return { rpm: this.rpm, quality: this.quality };
  }
}
