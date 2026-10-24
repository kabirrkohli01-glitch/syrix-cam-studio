import { Pulse, Breath } from './signals.js';
import { analyseSkin, interpret, faceFrame, regionCorners, cropTransform, mergeSkin, REGIONS, COVERED_BY } from './skin.js';

// Health mode: a live wellness read-out from the camera. Heart rate and
// breathing are measured continuously while the panel is open; a full scan
// (shutter) also captures the skin and compiles a report. Nothing is saved:
// the last report lives in memory until the app closes.
//
// Every tab shows the part of the camera picture it measures. Skin regions
// appear as live, face-aligned close-ups, and a check sweeps a magnifier over
// each region on the camera view; the Eyes tab shows both eyes up close with
// a closure timeline; the Posture tab draws the tracked skeleton over the
// person. A region that is covered (hair, a cap, a hand, glasses) is shown and
// reported as covered instead of being measured.

const SCAN_SECONDS = 30;
// A skin read merges this many frames taken this far apart.
const SKIN_FRAMES = 3;
const SKIN_GAP = 0.22;
// The magnifier rests this long on each region after a check.
const SWEEP_STEP = 0.5;
const CROP_FPS = 20;
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const BROW_A = [70, 63, 105, 66, 107];
const BROW_B = [336, 296, 334, 293, 300];
const EYE_A = [33, 160, 159, 158, 133, 153, 145, 144];
const EYE_B = [362, 385, 386, 387, 263, 373, 374, 380];
const LIPS = [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91];
const NOSE = [168, 6, 197, 195, 5, 4, 98, 97, 2, 326, 327, 4];
const LEVEL_COLOR = ['#34d399', '#facc15', '#fb923c', '#f43f5e'];
const LEVEL_TEXT = ['Clear', 'Mild', 'Moderate', 'Notable'];
const TABS = [['overview', 'Overview'], ['heart', 'Heart'], ['skin', 'Skin'], ['eyes', 'Eyes'], ['posture', 'Posture']];
// Tile order in the Skin tab, top of the face to the bottom.
const TILE_ORDER = ['forehead', 'eyeR', 'eyeL', 'cheekR', 'cheekL', 'nose', 'chin'];
export const SKIN_REGION_IDS = REGIONS.map((r) => r.id);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const regionName = (id) => (REGIONS.find((r) => r.id === id) || { name: id }).name;

export class Health {
  constructor(root, { bio, sfx, toast, ask, view }) {
    this.root = root;
    this.bio = bio;
    this.sfx = sfx;
    this.toast = toast;
    this.ask = ask;
    this.view = view;
    this.pulse = new Pulse();
    this.breath = new Breath();
    this.active = false;
    this.tab = 'overview';
    this.scan = null;
    this.report = null;
    this.skin = null;
    this.skinLm = null;
    this.showMap = true;
    this.selRegion = 'forehead';
    this.sweep = null;
    this.focus = null;
    this.checking = false;
    this.computeAt = 0;
    this.renderAt = 0;
    this.cropAt = 0;
    this.lastFace = null;
    this.lastCenter = null;
    this.motion = 0;
    this.sample = document.createElement('canvas');
    this.sctx = this.sample.getContext('2d', { willReadFrequently: true });
    this.grab = document.createElement('canvas');
    this.gctx = this.grab.getContext('2d', { willReadFrequently: true });
    this.loupe = document.createElement('canvas');
    this.loupe.width = 240;
    this.loupe.height = 170;
    this.lctx = this.loupe.getContext('2d');
    this.build();
  }

  // ---------------------------------------------------------------- lifecycle

  show(on) {
    if (on === this.active) return;
    this.active = on;
    this.root.hidden = !on;
    if (on) {
      requestAnimationFrame(() => this.root.classList.add('show'));
      this.pulse.reset();
      this.breath.reset();
      this.render(true);
    } else {
      this.root.classList.remove('show');
      this.stopScan(true);
      this.sweep = null;
      this.focus = null;
    }
  }

  setTab(tab) {
    if (!TABS.some(([id]) => id === tab)) return;
    this.tab = tab;
    this.render(true);
  }

  startScan() {
    if (this.scan) { this.stopScan(); return; }
    // Two groups of skin frames, early and late in the scan; the most frontal
    // group is kept.
    this.scan = { t: 0, groups: [[], []], plan: [8, 8 + SKIN_GAP, 8 + SKIN_GAP * 2, 20, 20 + SKIN_GAP, 20 + SKIN_GAP * 2], next: 0, startedAt: performance.now() };
    this.pulse.reset();
    this.breath.reset();
    this.sfx.click();
    this.render(true);
  }

  stopScan(silent) {
    if (!this.scan) return;
    this.scan = null;
    if (!silent) this.toast('Scan stopped');
    this.render(true);
  }

  get scanning() { return !!this.scan; }

  // ---------------------------------------------------------------- per frame

  update(dt, t, face, body, video) {
    if (!this.active) return;
    this.lastFace = face;
    this.lastBody = body;
    this.video = video;
    if (face) {
      const c = [face.uv.x, face.uv.y];
      if (this.lastCenter) {
        // Head speed in face widths per second; normal stillness is under 0.1.
        const speed = Math.hypot(c[0] - this.lastCenter[0], c[1] - this.lastCenter[1]) / Math.max(0.01, face.uv.w) / Math.max(dt, 1 / 120);
        this.motion += (Math.max(0, Math.min(1, (speed - 0.08) / 1.2)) - this.motion) * 0.1;
      }
      this.lastCenter = c;
      this.samplePulse(t, face, video);
      const breathY = body && body.shoulders ? body.shoulderMid[1] / Math.max(1, body.shoulderW) : face.center[1] / Math.max(1, face.height);
      this.breath.push(t, breathY);
    }
    if (t - this.computeAt > 0.5) {
      this.computeAt = t;
      this.pulse.compute();
      this.breath.compute();
    }
    if (this.scan) {
      this.scan.t += dt;
      const s = this.scan;
      if (face && s.next < s.plan.length && s.t >= s.plan[s.next]) {
        const read = this.captureSkin(face, video);
        if (read) s.groups[s.next < SKIN_FRAMES ? 0 : 1].push(read);
        s.next++;
      }
      if (s.t >= SCAN_SECONDS) this.finishScan();
    }
    if (t - this.renderAt > 0.25) { this.renderAt = t; this.render(false); }
    if (this.tab === 'heart') this.drawWave();
    const now = performance.now();
    if ((this.tab === 'skin' || this.tab === 'eyes') && now - this.cropAt > 1000 / CROP_FPS) {
      this.cropAt = now;
      this.drawCrops();
      if (this.tab === 'eyes') this.drawTrace();
    }
  }

  // Mean skin colour over forehead and both cheeks, from a small copy of the
  // frame; skin-coloured pixels only, so hair and glasses do not dilute it.
  samplePulse(t, face, video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    const w = 320, h = Math.round((w * vh) / vw);
    if (this.sample.width !== w) { this.sample.width = w; this.sample.height = h; }
    this.sctx.drawImage(video, 0, 0, w, h);
    const F = faceFrame(face.raw, w, h);
    let r = 0, g = 0, b = 0, n = 0;
    for (const id of ['forehead', 'cheekL', 'cheekR']) {
      const pts = regionCorners(F, id);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      const img = this.sctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
      const [u0, u1, v0, v1] = F.rects[id];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const [u, v] = F.toLocal([x, y]);
          if (u < u0 || u > u1 || v < v0 || v > v1) continue;
          const i = ((y - y0) * (x1 - x0 + 1) + (x - x0)) * 4;
          const R = img[i], G = img[i + 1], B = img[i + 2];
          if (R < 40 || R < B || G > R) continue;
          r += R; g += G; b += B; n++;
        }
      }
    }
    if (n > 20) this.pulse.push(t, r / n, g / n, b / n, this.motion);
  }

  // One full-resolution skin read of the current frame.
  captureSkin(face, video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !face) return null;
    if (this.grab.width !== vw) { this.grab.width = vw; this.grab.height = vh; }
    this.gctx.drawImage(video, 0, 0, vw, vh);
    const img = this.gctx.getImageData(0, 0, vw, vh);
    const res = analyseSkin(img, vw, vh, face.raw);
    const frontal = !face.pose || (Math.abs(face.pose.yaw) < 15 && Math.abs(face.pose.pitch) < 15);
    return { res, lm: face.raw.map((p) => ({ x: p.x, y: p.y })), frontal };
  }

  useSkin(read) {
    this.skin = interpret(read.res);
    this.skin.raw = read.res;
    this.skinLm = read.lm;
    if (this.skin.covered.includes(this.selRegion) || !this.skin.per[this.selRegion]) {
      const worst = REGIONS.map(({ id }) => id).filter((id) => this.skin.per[id].level != null).sort((a, b) => this.skin.per[b].level - this.skin.per[a].level)[0];
      if (worst) this.selRegion = worst;
    }
  }

  // A skin check outside a full scan (Skin tab button or Syrix): a few frames
  // a moment apart, merged, then a magnifier sweep over each region.
  async checkSkinNow(video) {
    if (this.checking) return false;
    if (!this.lastFace) { this.toast('Face the camera first'); return false; }
    this.checking = true;
    this.render(true);
    const reads = [];
    try {
      for (let i = 0; i < SKIN_FRAMES; i++) {
        if (i) await new Promise((r) => setTimeout(r, SKIN_GAP * 1000));
        const read = this.captureSkin(this.lastFace, video);
        if (read) reads.push(read);
      }
    } finally {
      this.checking = false;
    }
    if (!reads.length) { this.render(true); return false; }
    this.useSkin(mergeSkin(reads));
    this.sweep = { t0: performance.now(), order: TILE_ORDER.slice() };
    this.render(true);
    return true;
  }

  finishScan() {
    const s = this.scan;
    this.scan = null;
    const merged = s.groups.filter((g) => g.length).map(mergeSkin);
    const pick = merged.find((x) => x.frontal) || merged[merged.length - 1];
    if (pick) this.useSkin(pick);
    const t = this.bio.lastT || 0;
    this.report = {
      at: new Date(),
      heart: this.pulse.bpm != null && this.pulse.quality > 0.2 ? { bpm: Math.round(this.pulse.bpm), quality: this.pulse.quality, hrv: this.pulse.hrv } : null,
      breath: this.breath.rpm != null && this.breath.quality > 0.25 ? { rpm: Math.round(this.breath.rpm), quality: this.breath.quality } : null,
      skin: this.skin ? { score: this.skin.score, findings: this.skin.findings.map((f) => `${f.title} (${LEVEL_TEXT[f.level]})`), covered: this.skin.covered.map(regionName) } : null,
      blink: this.bio.blinkRate(t),
      fatigue: this.bio.fatigue(t),
      posture: this.bio.posture.score != null ? { score: Math.round(this.bio.posture.score), issues: this.bio.posture.issues } : null,
      distance: this.bio.distance ? Math.round(this.bio.distance) : null,
    };
    this.sfx.fanfare();
    this.tab = 'overview';
    this.render(true);
    if (this.onReport) this.onReport(this.report);
  }

  // A close-up of one region at full camera resolution, for Syrix to look
  // at. The region is also highlighted on the camera view while Syrix looks.
  async inspect(id, video) {
    const f = this.lastFace;
    const vw = video && video.videoWidth, vh = video && video.videoHeight;
    if (!f || !vw) return { ok: false, message: 'No face in view. Ask the user to face the camera.' };
    const F = faceFrame(f.raw, vw, vh);
    if (!F.rects[id]) return { ok: false, message: `Unknown region ${id}.` };
    this.focus = { id, until: performance.now() + 6000 };
    if (SKIN_REGION_IDS.includes(id)) this.selRegion = id;
    this.render(true);
    // Coverage of the region right now, so Syrix can say "your forehead is
    // covered" instead of describing hair as skin.
    const read = SKIN_REGION_IDS.includes(id) ? this.captureSkin(f, video) : null;
    const r = read && read.res.regions[id];
    const covered = !!(r && !r.visible && r.covered);
    const w = 768, h = 512;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const { m } = cropTransform(F, id, w, h, 0.25, false);
    ctx.setTransform(...m);
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) return { ok: false, message: 'Could not capture the close-up.' };
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
    const coverage = r ? Math.round((r.coverage || 0) * 100) : null;
    return {
      ok: true, covered, dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      message: covered
        ? `The ${regionName(id).toLowerCase()} is covered right now (${COVERED_BY[id]}; only ${coverage}% of it is visible skin). Tell the user it is covered and ask them to move it if they want it checked. The close-up is attached.`
        : `Close-up of the ${regionName(id).toLowerCase()} attached (not mirrored, ${coverage != null ? `${coverage}% visible skin` : 'eye area'}). Describe only what is actually visible in it.`,
    };
  }

  // ---------------------------------------------------------------- summary

  summary() {
    const parts = [];
    const t = this.bio.lastT || 0;
    if (this.pulse.bpm != null) parts.push(`heart rate about ${Math.round(this.pulse.bpm)} bpm (signal ${this.qualityWord(this.pulse.quality)})`);
    if (this.breath.rpm != null) parts.push(`breathing about ${Math.round(this.breath.rpm)}/min (${this.qualityWord(this.breath.quality)})`);
    if (this.pulse.hrv) parts.push(`HRV (RMSSD) about ${this.pulse.hrv} ms, rough`);
    if (this.skin) {
      parts.push(`skin score ${this.skin.score}/100 (from ${this.skin.raw.frames || 1} frames); ${this.skin.findings.map((f) => `${f.title.toLowerCase()} ${LEVEL_TEXT[f.level].toLowerCase()}: ${f.what}`).join(' ')} Lighting: ${this.skin.lighting.note}`);
      if (this.skin.covered.length) parts.push(`not measured because covered: ${this.skin.covered.map((id) => `${regionName(id).toLowerCase()} (${COVERED_BY[id]})`).join(', ')}`);
    }
    parts.push(`eye fatigue ${this.bio.fatigue(t)}/100`);
    if (this.scan) parts.push(`scan in progress, ${Math.round(this.scan.t)} of ${SCAN_SECONDS} s`);
    return parts.join('; ');
  }

  qualityWord(q) { return q > 0.45 ? 'strong' : q > 0.25 ? 'fair' : 'weak'; }

  // ---------------------------------------------------------------- overlay

  drawOverlay(ctx, map) {
    if (!this.active) return;
    const vw = this.view().vw, vh = this.view().vh;
    if (!vw) return;
    if (this.tab === 'posture') this.drawSkeleton(ctx);
    if (!this.lastFace) return;
    const f = this.lastFace;
    const F = faceFrame(f.raw, vw, vh);
    const toScreen = (p) => [map.x(p[0] / vw), map.y(p[1] / vh)];
    const pxScale = Math.abs(map.W / (map.c.sx * vw));
    ctx.save();
    if (this.scan || this.tab === 'heart') {
      // Where the pulse is read from.
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      for (const id of ['forehead', 'cheekL', 'cheekR']) poly(ctx, regionCorners(F, id).map(toScreen));
      ctx.setLineDash([]);
      // A dot on the forehead that beats at the measured rate.
      if (this.pulse.bpm && this.pulse.quality > 0.15) {
        const c = toScreen(F.toPx(0, (F.rects.forehead[2] + F.rects.forehead[3]) / 2));
        const ph = ((performance.now() / 1000) * this.pulse.bpm) / 60;
        const k = Math.exp(-((ph % 1) * 6));
        ctx.fillStyle = `rgba(255,55,95,${0.5 + k * 0.5})`;
        ctx.beginPath();
        ctx.arc(c[0], c[1], 5 + k * 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (this.skin && this.showMap && (this.tab === 'skin' || this.tab === 'overview')) {
      for (const { id } of REGIONS) {
        const r = this.skin.per[id];
        if (!r) continue;
        if (r.covered) {
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.fillStyle = 'rgba(120,120,130,0.12)';
          ctx.lineWidth = 1.2;
          poly(ctx, regionCorners(F, id).map(toScreen), true);
          ctx.setLineDash([]);
          continue;
        }
        if (r.level == null) continue;
        ctx.fillStyle = hexA(LEVEL_COLOR[r.level], r.level ? 0.2 : 0.08);
        ctx.strokeStyle = hexA(LEVEL_COLOR[r.level], id === this.selRegion && this.tab === 'skin' ? 0.95 : 0.55);
        ctx.lineWidth = id === this.selRegion && this.tab === 'skin' ? 2.2 : 1.2;
        poly(ctx, regionCorners(F, id).map(toScreen), true);
      }
      // Spot markers are re-placed relative to the live face so they follow
      // the head.
      const raw = this.skin.raw;
      if (raw && this.skinLm) {
        const F0 = faceFrame(this.skinLm, raw.frame.w, raw.frame.h);
        for (const reg of Object.values(raw.regions)) {
          if (!reg || !reg.spots) continue;
          for (const s of reg.spots) {
            const [u, v] = F0.toLocal([s.x * raw.frame.w, s.y * raw.frame.h]);
            const p = toScreen(F.toPx(u, v));
            ctx.strokeStyle = s.kind === 'red' ? 'rgba(251,113,133,0.95)' : 'rgba(250,204,21,0.9)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(p[0], p[1], Math.max(4, (s.r / F0.ed) * F.ed * 1.4 * pxScale), 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    }
    // Magnifier: the sweep after a check, or the region Syrix is looking at.
    const now = performance.now();
    let lens = null;
    if (this.sweep) {
      const i = Math.floor((now - this.sweep.t0) / 1000 / SWEEP_STEP);
      if (i >= this.sweep.order.length) this.sweep = null;
      else lens = { id: this.sweep.order[i], label: this.regionLabel(this.sweep.order[i]) };
    }
    if (!lens && this.focus) {
      if (now > this.focus.until) this.focus = null;
      else lens = { id: this.focus.id, label: `Syrix is looking · ${regionName(this.focus.id)}` };
    }
    if (lens) this.drawLens(ctx, F, lens, toScreen, f);
    if (this.scan) {
      const k = this.scan.t / SCAN_SECONDS;
      const c = toScreen([F.O[0], F.O[1]]);
      const rad = F.ed * 1.9 * pxScale;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(c[0], c[1] + rad * 0.35, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(c[0], c[1] + rad * 0.35, rad, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      ctx.stroke();
      // Scan line sweeping over the face.
      const sy = c[1] - rad * 0.6 + ((now / 1000) % 1.8) / 1.8 * rad * 1.9;
      const g = ctx.createLinearGradient(0, sy - 18, 0, sy + 18);
      g.addColorStop(0, 'rgba(160,220,255,0)');
      g.addColorStop(0.5, 'rgba(160,220,255,0.35)');
      g.addColorStop(1, 'rgba(160,220,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(c[0] - rad, sy - 18, rad * 2, 36);
    }
    ctx.restore();
  }

  regionLabel(id) {
    const r = this.skin && this.skin.per[id];
    if (!r) return regionName(id);
    if (r.covered) return `${r.name} · covered`;
    return `${r.name} · ${r.level == null ? 'not visible' : LEVEL_TEXT[r.level]}`;
  }

  // Corner brackets around a region, and a round magnifier beside the face
  // showing it up close, joined by a thin line.
  drawLens(ctx, F, lens, toScreen, face) {
    const video = this.video;
    if (!video || !video.videoWidth) return;
    const pts = regionCorners(F, lens.id).map(toScreen);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const r = this.skin && this.skin.per[lens.id];
    const col = r && r.covered ? '#d4d4d8' : r && r.level != null ? LEVEL_COLOR[r.level] : '#7dd3fc';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    const L = Math.min(16, (x1 - x0) * 0.3);
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]]) {
      ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y);
    }
    ctx.stroke();
    // Lens position: out to the side of the face the region is on, above it
    // for the forehead and below it for the chin.
    const fc = face.center;
    const R = 74;
    let lx = cx + Math.sign(cx - fc[0] || 1) * (face.width * 0.85 + R * 0.3);
    let ly = cy;
    if (lens.id === 'forehead') { lx = cx + face.width * 0.9; ly = cy - face.height * 0.2; }
    if (lens.id === 'chin' || lens.id === 'nose') { lx = cx - face.width * 0.95; }
    lx = Math.max(R + 12, Math.min(innerWidth - R - 12, lx));
    ly = Math.max(R + 80, Math.min(innerHeight - R - 120, ly));
    const lc = this.lctx;
    const { m } = cropTransform(F, lens.id, this.loupe.width, this.loupe.height, 0.3, true);
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, this.loupe.width, this.loupe.height);
    lc.setTransform(...m);
    lc.drawImage(video, 0, 0);
    lc.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = hexA(col.length === 7 ? col : '#ffffff', 0.7);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(lx - Math.sign(lx - cx) * R, ly);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx, ly, R, 0, Math.PI * 2);
    ctx.clip();
    const s = (R * 2) / Math.min(this.loupe.width, this.loupe.height);
    ctx.drawImage(this.loupe, lx - (this.loupe.width * s) / 2, ly - (this.loupe.height * s) / 2, this.loupe.width * s, this.loupe.height * s);
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(lx, ly, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = '600 13px "Segoe UI Variable Text", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(lens.label).width + 18;
    ctx.fillStyle = 'rgba(12,12,16,0.82)';
    roundRect(ctx, lx - tw / 2, ly + R + 8, tw, 24, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(lens.label, lx, ly + R + 25);
  }

  // Shoulders, neck and head from the body tracker, drawn over the person,
  // with the measurements the posture score uses.
  drawSkeleton(ctx) {
    const b = this.lastBody;
    if (!b || !b.shoulders) return;
    const P = this.bio.posture;
    const col = P.state === 'good' ? '#34d399' : P.state === 'fair' ? '#facc15' : P.state === 'poor' ? '#fb7185' : '#7dd3fc';
    const sm = b.shoulderMid, em = b.earMid;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sm[0], sm[1]);
    ctx.lineTo(sm[0], sm[1] - b.shoulderW * 0.9);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(b.x(11), b.y(11));
    ctx.lineTo(b.x(12), b.y(12));
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sm[0], sm[1]);
    ctx.lineTo(em[0], em[1]);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const i of [7, 8, 11, 12]) {
      if (!b.seen(i, 0.35)) continue;
      ctx.beginPath();
      ctx.arc(b.x(i), b.y(i), 6, 0, Math.PI * 2);
      ctx.fill();
    }
    const A = P.angles || {};
    const tags = [];
    if (A.tilt != null) tags.push(`Shoulders ${A.tilt.toFixed(0)}°`);
    if (A.roll != null) tags.push(`Head tilt ${Math.abs(A.roll).toFixed(0)}°`);
    if (A.forward != null) tags.push(`Head forward ${Math.max(0, A.forward).toFixed(0)}°`);
    ctx.font = '600 13px "Segoe UI Variable Text", "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    let y = sm[1] + 26;
    const x = Math.max(b.x(11), b.x(12)) + 16;
    for (const t of tags) {
      const w = ctx.measureText(t).width + 18;
      ctx.fillStyle = 'rgba(12,12,16,0.8)';
      roundRect(ctx, x, y - 16, w, 24, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(t, x + 9, y + 1);
      y += 30;
    }
    ctx.restore();
  }

  // Live close-ups in the Skin and Eyes tabs, plus spot markers on the skin
  // tiles.
  drawCrops() {
    const f = this.lastFace;
    const video = this.video;
    const canvases = this.body.querySelectorAll('canvas[data-crop]');
    if (!canvases.length) return;
    if (!f || !video || !video.videoWidth) {
      for (const c of canvases) c.closest('[data-tile]')?.classList.add('noface');
      return;
    }
    const vw = video.videoWidth, vh = video.videoHeight;
    const F = faceFrame(f.raw, vw, vh);
    const raw = this.skin && this.skin.raw;
    const F0 = raw && this.skinLm ? faceFrame(this.skinLm, raw.frame.w, raw.frame.h) : null;
    for (const c of canvases) {
      c.closest('[data-tile]')?.classList.remove('noface');
      const id = c.dataset.crop;
      if (!F.rects[id]) continue;
      const ctx = c.getContext('2d');
      const { m } = cropTransform(F, id, c.width, c.height, Number(c.dataset.pad || 0.18), true);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(...m);
      ctx.drawImage(video, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const reg = raw && raw.regions[id];
      if (c.dataset.spots === '1' && reg && reg.spots && F0) {
        const k = Math.hypot(m[0], m[1]);
        for (const s of reg.spots) {
          const [u, v] = F0.toLocal([s.x * raw.frame.w, s.y * raw.frame.h]);
          const p = F.toPx(u, v);
          const x = m[0] * p[0] + m[2] * p[1] + m[4], y = m[1] * p[0] + m[3] * p[1] + m[5];
          ctx.strokeStyle = s.kind === 'red' ? 'rgba(251,113,133,0.95)' : 'rgba(250,204,21,0.95)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(5, (s.r / F0.ed) * F.ed * k * 1.6), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  // Eye closure over the last 12 seconds, with a tick for every counted blink.
  drawTrace() {
    const c = this.body.querySelector('canvas.hp-trace');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const tr = this.bio.eyeTrace;
    const t1 = this.bio.lastT || 0, t0 = t1 - 12;
    const X = (t) => ((t - t0) / 12) * w;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();
    if (tr.length > 1) {
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      tr.forEach(([t, v], i) => { const x = X(t), y = h - 8 - v * (h - 22); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    for (const bt of this.bio.blink.times) {
      if (bt < t0) continue;
      ctx.beginPath();
      ctx.arc(X(bt), 8, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '500 18px "Segoe UI Variable Text", "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('closed', 8, 30);
    ctx.fillText('open', 8, h - 12);
  }

  // ---------------------------------------------------------------- panel

  build() {
    this.root.innerHTML = `
      <header class="hp-head">
        <div class="hp-title"><span class="hp-dot"></span>Health</div>
        <div class="hp-tabs" role="tablist">${TABS.map(([id, label]) => `<button class="hp-tab" data-tab="${id}" role="tab">${label}</button>`).join('')}</div>
      </header>
      <div class="hp-body scroll-y"></div>
      <footer class="hp-foot">Estimates from your camera for wellness, not medical measurements. Nothing is saved.</footer>`;
    this.body = this.root.querySelector('.hp-body');
    this.root.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { this.setTab(tab.dataset.tab); if (this.onTab) this.onTab(tab.dataset.tab); return; }
      const region = e.target.closest('[data-region]');
      if (region) {
        this.selRegion = region.dataset.region;
        this.focus = { id: this.selRegion, until: performance.now() + 2500 };
        this.sfx.click();
        this.render(true);
        return;
      }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'scan') this.startScan();
      else if (a === 'skin') { this.checkSkinNow(this.view().video).then((ok) => { if (ok) this.sfx.sparkle(); }); }
      else if (a === 'map') { this.showMap = !this.showMap; this.render(true); }
      else if (a === 'calibrate') { this.bio.calibratePosture(); this.toast('Sit up straight and hold still'); }
      else if (a === 'ask') this.ask(act.dataset.q);
    });
  }

  render(full) {
    if (!this.active) return;
    for (const b of this.root.querySelectorAll('.hp-tab')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const key = `${this.tab}|${!!this.scan}|${this.checking}|${this.selRegion}`;
    if (full || this.renderedKey !== key || this.renderedSkin !== this.skin) {
      const tabChanged = !this.renderedKey || this.renderedKey.split('|')[0] !== this.tab;
      this.renderedKey = key;
      this.renderedSkin = this.skin;
      const scroll = this.body.scrollTop;
      this.body.innerHTML = this[`view_${this.tab}`]();
      // The entrance animation plays when the tab changes, not when the same
      // tab is redrawn (a tile picked, a check finished).
      if (tabChanged) {
        this.body.classList.remove('fade');
        void this.body.offsetWidth;
        this.body.classList.add('fade');
      } else {
        this.body.scrollTop = scroll;
      }
      this.waveCanvas = this.body.querySelector('canvas.hp-wave');
      this.drawCrops();
    }
    this.patch();
  }

  // Live numbers are patched in place so the panel never flickers.
  patch() {
    const set = (k, v) => { const el = this.body.querySelector(`[data-v="${k}"]`); if (el && el.textContent !== String(v)) el.textContent = v; };
    const bar = (k, v) => { const el = this.body.querySelector(`[data-bar="${k}"]`); if (el) el.style.setProperty('--v', String(Math.max(0, Math.min(1, v)))); };
    const t = this.bio.lastT || 0;
    const bpm = this.pulse.bpm != null && this.pulse.quality > 0.15 ? Math.round(this.pulse.bpm) : '--';
    const rpm = this.breath.rpm != null && this.breath.quality > 0.2 ? Math.round(this.breath.rpm) : '--';
    set('bpm', bpm);
    set('rpm', rpm);
    set('hrv', this.pulse.hrv ? `${this.pulse.hrv} ms` : '--');
    set('pq', this.lastFace ? this.qualityWord(this.pulse.quality) : 'No face');
    bar('pq', this.pulse.quality / 0.6);
    set('bq', this.qualityWord(this.breath.quality));
    const still = this.lastFace ? (this.motion < 0.12 ? 'Still' : this.motion < 0.35 ? 'Moving a little' : 'Moving: hold still') : 'No face';
    set('still', still);
    bar('still', 1 - this.motion);
    const rate = this.bio.blinkRate(t);
    set('blink', rate == null ? '--' : rate);
    set('blinkwarm', rate == null ? `Measuring · ${Math.max(0, Math.ceil(15 - this.bio.seenFor))} s` : rate < 8 ? 'Low: blink more' : rate > 26 ? 'High' : 'Normal');
    set('blinks', this.bio.blink.total);
    set('perclos', `${Math.round(this.bio.perclos * 100)}%`);
    const fat = this.bio.fatigue(t);
    set('fatigue', fat);
    bar('fatigue', fat / 100);
    set('dist', this.bio.distance ? `${Math.round(this.bio.distance)} cm` : '--');
    bar('dist', this.bio.distance ? (this.bio.distance - 25) / 75 : 0);
    set('distnote', !this.bio.distance ? 'Face the camera' : this.bio.distance < 45 ? 'Too close: lean back' : this.bio.distance > 90 ? 'Quite far away' : 'Comfortable distance');
    const P = this.bio.posture;
    set('posture', P.score != null ? Math.round(P.score) : '--');
    bar('posture', (P.score || 0) / 100);
    set('pstate', P.calibrating ? 'Calibrating…' : P.state === 'learning' ? 'Learning…' : P.state === 'unknown' ? 'Looking…' : P.state === 'good' ? 'Good' : P.state === 'fair' ? 'Fair' : 'Needs work');
    const issues = this.body.querySelector('[data-v="issues"]');
    if (issues) { const html = P.issues.length ? P.issues.map((i) => `<li>${esc(i)}</li>`).join('') : '<li class="ok">No problems spotted</li>'; if (issues.innerHTML !== html) issues.innerHTML = html; }
    const A = P.angles || {};
    set('ang-tilt', A.tilt != null ? `${A.tilt.toFixed(0)}°` : '--');
    set('ang-roll', A.roll != null ? `${Math.abs(A.roll).toFixed(0)}°` : '--');
    set('ang-fwd', A.forward != null ? `${Math.max(0, A.forward).toFixed(0)}°` : '--');
    set('ang-ref', P.calibrated ? 'Your calibration' : 'Your best posture this session');
    set('skin', this.skin ? this.skin.score : '--');
    if (this.scan) {
      set('scanleft', `${Math.max(0, Math.ceil(SCAN_SECONDS - this.scan.t))} s`);
      bar('scan', this.scan.t / SCAN_SECONDS);
      set('scanstep', this.scan.t < 8 ? 'Hold still · reading pulse' : this.scan.t < 22 ? 'Reading skin · keep facing the camera' : 'Breathing and posture');
    }
    const fig = this.body.querySelector('[data-v="figure"]');
    if (fig) fig.innerHTML = this.bodyFigure();
  }

  view_overview() {
    const r = this.report;
    const skinSub = this.skin ? (this.skin.covered.includes('forehead') ? 'Forehead covered' : esc(this.skin.findings[0].title)) : 'Run a scan';
    return `
      ${this.scanBlock()}
      <div class="hp-grid">
        ${card('Heart', '<span data-v="bpm">--</span><small>bpm</small>', '<span data-v="pq">--</span> signal', 'heart')}
        ${card('Breathing', '<span data-v="rpm">--</span><small>/min</small>', '<span data-v="bq">--</span> signal', 'heart')}
        ${card('Skin', '<span data-v="skin">--</span><small>/100</small>', skinSub, 'skin')}
        ${card('Eye fatigue', '<span data-v="fatigue">--</span><small>/100</small>', '<span data-v="blink">--</span> blinks/min', 'eyes')}
        ${card('Posture', '<span data-v="posture">--</span><small>/100</small>', '<span data-v="pstate">--</span>', 'posture')}
        ${card('Distance', '<span data-v="dist">--</span>', 'from the screen', 'eyes')}
      </div>
      ${r ? `<section class="hp-report"><h4>Last scan · ${r.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</h4>
        <ul>${[
          r.heart ? `Heart rate <b>${r.heart.bpm} bpm</b>${r.heart.hrv ? `, HRV about ${r.heart.hrv} ms` : ''}` : 'Heart rate: signal too weak (more light, hold still)',
          r.breath ? `Breathing <b>${r.breath.rpm}/min</b>` : 'Breathing: not enough movement to read',
          r.skin ? `Skin <b>${r.skin.score}/100</b>: ${esc(r.skin.findings.join(', '))}${r.skin.covered.length ? ` · covered: ${esc(r.skin.covered.join(', ').toLowerCase())}` : ''}` : '',
          `Eye fatigue <b>${r.fatigue}/100</b>${r.blink != null ? `, ${r.blink} blinks/min` : ''}`,
          r.posture ? `Posture <b>${r.posture.score}/100</b>${r.posture.issues.length ? `: ${esc(r.posture.issues.join(', ').toLowerCase())}` : ''}` : '',
        ].filter(Boolean).map((x) => `<li>${x}</li>`).join('')}</ul>
        <button class="pill-btn accent" data-act="ask" data-q="Explain my health scan results and what I should do about them.">Ask Syrix to explain</button></section>` : ''}`;
  }

  scanBlock() {
    if (this.scan) {
      return `<section class="hp-scan on"><div class="hp-ring" data-bar="scan"><span data-v="scanleft">30 s</span></div>
        <div><b>Scanning…</b><p data-v="scanstep">Hold still</p><button class="pill-btn ghost" data-act="scan">Stop</button></div></section>`;
    }
    return `<section class="hp-scan"><button class="hp-go" data-act="scan" title="Start a 30-second scan (Space)"><svg viewBox="0 0 24 24" class="ico"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg></button>
      <div><b>Full scan · 30 s</b><p>Sit still, face the camera, even light. Reads heart, breathing, skin, eyes and posture.</p></div></section>`;
  }

  view_heart() {
    return `${this.scanBlock()}
      <section class="hp-big"><div class="hp-num"><span data-v="bpm">--</span><small>bpm</small></div>
        <div class="hp-q"><span>Signal</span><b class="hp-bar" data-bar="pq"><i></i></b><em data-v="pq">--</em>
        <span>Stillness</span><b class="hp-bar" data-bar="still"><i></i></b><em data-v="still">--</em></div></section>
      <canvas class="hp-wave" width="680" height="160"></canvas>
      <div class="hp-kv"><span>Breathing</span><b><span data-v="rpm">--</span>/min</b><span>HRV (RMSSD, rough)</span><b data-v="hrv">--</b></div>
      <details class="hp-more" open><summary>How this works</summary>
        <p>Each heartbeat pushes blood into the skin and changes its colour very slightly. The forehead and cheeks (dashed boxes on your face) are read 30 times a second and the rhythm is found with the POS method used in research on camera heart rate. The red dot beats at the measured rate.</p>
        <p>Typical resting heart rate is 60–100 bpm. Exercise, caffeine, stress and being a teenager push it up; fitness pulls it down.</p>
        <p><b>For a good reading:</b> bright, even light on your face, stay still, don't talk. Weak signal means the number may be off.</p>
      </details>`;
  }

  tile(id) {
    const s = this.skin;
    const r = s && s.per[id];
    const state = !r ? '' : r.covered ? 'Covered' : r.level == null ? 'Not visible' : LEVEL_TEXT[r.level];
    const cls = !r ? '' : r.covered ? 'covered' : r.level == null ? 'unseen' : `lvl${r.level}`;
    const wide = id === 'forehead' ? ' wide' : '';
    return `<button class="hp-tile ${cls}${wide}${id === this.selRegion ? ' sel' : ''}" data-region="${id}" data-tile>
      <canvas data-crop="${id}" width="${wide ? 340 : 160}" height="${wide ? 110 : 104}"></canvas>
      <span class="hp-tile-t">${esc(regionName(id))}</span>${state ? `<em>${state}</em>` : ''}</button>`;
  }

  view_skin() {
    const s = this.skin;
    const sel = s && s.per[this.selRegion];
    const head = s
      ? `<section class="hp-skin-top"><div class="hp-num"><span data-v="skin">${s.score}</span><small>/100</small></div>
          <div class="hp-skin-side"><p class="hp-light ${s.lighting.ok ? 'ok' : 'warn'}">${esc(s.lighting.note)}</p>
          <div class="hp-legend">${LEVEL_TEXT.map((t, i) => `<span><i style="background:${LEVEL_COLOR[i]}"></i>${t}</span>`).join('')}<span><i class="cov"></i>Covered</span></div></div></section>`
      : `<section class="hp-skin-top empty"><p>Live close-ups of each area are below. Face the camera in even, bright light, then check.</p></section>`;
    const zoom = `<section class="hp-zoom">
        <div class="hp-zoom-view" data-tile><canvas data-crop="${this.selRegion}" data-spots="1" data-pad="0.22" width="680" height="400"></canvas>
          <span class="hp-zoom-t">${esc(regionName(this.selRegion))}</span>${sel && sel.covered ? '<span class="hp-zoom-cov">Covered</span>' : ''}</div>
        ${sel ? `<ul class="hp-zoom-notes">${(sel.notes.length ? sel.notes : ['Clear in this light']).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        <div class="hp-actions">
          <button class="pill-btn ${s ? 'ghost' : 'accent'}" data-act="skin" ${this.checking ? 'disabled' : ''}>${this.checking ? 'Checking…' : s ? 'Check again' : 'Check my skin'}</button>
          ${s ? `<button class="pill-btn ghost" data-act="map">${this.showMap ? 'Hide' : 'Show'} on my face</button>` : ''}
          <button class="pill-btn accent" data-act="ask" data-q="Inspect my ${esc(regionName(this.selRegion).toLowerCase())} up close and tell me what you can actually see, what it probably is and what to do about it.">Ask Syrix about this area</button>
        </div></section>`;
    return `${head}${zoom}
      <div class="hp-tiles">${TILE_ORDER.map((id) => this.tile(id)).join('')}</div>
      ${s ? s.findings.map((f) => `<details class="hp-finding" ${f.level >= 2 ? 'open' : ''}><summary><i style="background:${LEVEL_COLOR[f.level]}"></i>${esc(f.title)}<em>${LEVEL_TEXT[f.level]}</em></summary>
        <p><b>What we saw:</b> ${esc(f.what)}</p><p><b>What it usually means:</b> ${esc(f.means)}</p><p><b>What helps:</b> ${esc(f.care)}</p>${f.doctor ? `<p class="hp-doc"><b>When to get it checked:</b> ${esc(f.doctor)}</p>` : ''}</details>`).join('') : ''}
      ${s ? `<details class="hp-more"><summary>Face map</summary><div class="hp-map">${this.faceMap()}</div></details>` : ''}`;
  }

  view_eyes() {
    return `<section class="hp-eyes">
        <div class="hp-eye" data-tile><canvas data-crop="eyeBoxR" data-pad="0.05" width="300" height="150"></canvas><span>Right eye</span></div>
        <div class="hp-eye" data-tile><canvas data-crop="eyeBoxL" data-pad="0.05" width="300" height="150"></canvas><span>Left eye</span></div>
      </section>
      <section class="hp-trace-wrap"><div class="hp-trace-head"><b>Blinks</b><span><span data-v="blinks">0</span> counted · dots mark each blink</span></div>
        <canvas class="hp-trace" width="680" height="150"></canvas></section>
      <div class="hp-grid">
        ${card('Blink rate', '<span data-v="blink">--</span><small>/min</small>', '<span data-v="blinkwarm">--</span>', 'eyes')}
        ${card('Eye fatigue', '<span data-v="fatigue">--</span><small>/100</small>', 'Eyes closed <span data-v="perclos">--</span> of the time', 'eyes')}
      </div>
      <section class="hp-dist"><div class="hp-dist-head"><span>Screen distance</span><b data-v="dist">--</b></div>
        <b class="hp-bar dist" data-bar="dist"><i></i></b><div class="hp-dist-scale"><span>25</span><span class="ok">50–75 cm ideal</span><span>100</span></div>
        <p data-v="distnote">--</p></section>
      <details class="hp-more"><summary>What this means</summary>
        <p>People blink about 15–20 times a minute, but staring at a screen can drop it under 8, which dries the eyes and makes them tired.</p>
        <p><b>20-20-20:</b> every 20 minutes, look at something 20 feet (6 m) away for 20 seconds. Keep the screen about an arm's length (50–75 cm) away.</p>
        <p>Distance is measured from the size of your irises and the gap between your pupils. If it reads off, tell Syrix how far away you are sitting to calibrate it.</p>
      </details>`;
  }

  view_posture() {
    return `<section class="hp-big"><div class="hp-num"><span data-v="posture">--</span><small>/100</small></div>
        <div class="hp-q"><span data-v="pstate">--</span><b class="hp-bar" data-bar="posture"><i></i></b></div></section>
      <div class="hp-figure" data-v="figure"></div>
      <div class="hp-kv"><span>Shoulder tilt</span><b data-v="ang-tilt">--</b><span>Head tilt</span><b data-v="ang-roll">--</b><span>Head forward</span><b data-v="ang-fwd">--</b><span>Compared with</span><b data-v="ang-ref">--</b></div>
      <ul class="hp-issues" data-v="issues"></ul>
      <div class="hp-actions"><button class="pill-btn ghost" data-act="calibrate">Calibrate to how I sit now</button></div>
      <details class="hp-more"><summary>How it's measured</summary>
        <p>The body tracker follows your ears and shoulders (drawn over you on the camera). Your head dropping towards your shoulders, the head pushed forward, uneven shoulders, a tilted head and leaning in all lower the score, compared with the best posture you have held this session, or with your calibration.</p>
        <p>A problem is only reported once it has lasted a few seconds. Sit back with feet flat, screen at eye level, shoulders relaxed, ears over shoulders.</p>
      </details>`;
  }

  // Line drawing of the shoulders, neck and head from the live body pose.
  bodyFigure() {
    const b = this.lastBody;
    if (!b || !b.shoulders) return '<p class="hp-dim">Move back until your shoulders are in view.</p>';
    const pts = [b.pt(11), b.pt(12), b.pt(7), b.pt(8), b.pt(0)];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const s = 150 / Math.max(1, Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 1.3);
    const P = (p) => `${(110 + (p[0] - cx) * s).toFixed(1)},${(95 + (p[1] - cy) * s).toFixed(1)}`;
    const ok = (this.bio.posture.state || '') === 'good';
    const col = ok ? '#34d399' : this.bio.posture.state === 'fair' ? '#facc15' : '#fb7185';
    const earMid = [(b.x(7) + b.x(8)) / 2, (b.y(7) + b.y(8)) / 2];
    // The reference neck length, as a faint ghost above the shoulders.
    const ref = this.bio.posture.ref;
    const refY = ref && ref.neck ? 95 + (b.shoulderMid[1] - cy) * s - ref.neck * b.shoulderW * s : null;
    return `<svg viewBox="0 0 220 190" class="hp-svg">
      <line x1="10" y1="${(95 + (b.shoulderMid[1] - cy) * s).toFixed(1)}" x2="210" y2="${(95 + (b.shoulderMid[1] - cy) * s).toFixed(1)}" stroke="rgba(255,255,255,.12)" stroke-dasharray="4 5"/>
      ${refY != null ? `<line x1="70" x2="150" y1="${refY.toFixed(1)}" y2="${refY.toFixed(1)}" stroke="rgba(52,211,153,.5)" stroke-dasharray="3 4"/><text x="152" y="${(refY + 3).toFixed(1)}" fill="rgba(52,211,153,.8)" font-size="9" font-family="Segoe UI, sans-serif">upright</text>` : ''}
      <polyline points="${P(b.pt(11))} ${P(b.pt(12))}" stroke="${col}" stroke-width="5" stroke-linecap="round" fill="none"/>
      <polyline points="${P(b.shoulderMid)} ${P(earMid)}" stroke="${col}" stroke-width="4" stroke-linecap="round" fill="none"/>
      <circle cx="${P(b.pt(0)).split(',')[0]}" cy="${P(b.pt(0)).split(',')[1]}" r="${Math.max(16, b.shoulderW * s * 0.22).toFixed(1)}" fill="none" stroke="${col}" stroke-width="3"/>
      ${[11, 12, 7, 8].map((i) => `<circle cx="${P(b.pt(i)).split(',')[0]}" cy="${P(b.pt(i)).split(',')[1]}" r="4" fill="#fff"/>`).join('')}
    </svg>`;
  }

  // Diagram of the user's own face outline with each region coloured by
  // what was found there and spots marked where they were seen.
  faceMap() {
    const lm = this.skinLm;
    const raw = this.skin.raw;
    if (!lm || !raw) return '';
    const W = raw.frame.w, H = raw.frame.h;
    const oval = FACE_OVAL.map((i) => [lm[i].x * W, lm[i].y * H]);
    const xs = oval.map((p) => p[0]), ys = oval.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min(200 / (x1 - x0), 250 / (y1 - y0));
    // Drawn mirrored, like the live view.
    const P = (p) => [(120 - (p[0] - (x0 + x1) / 2) * s).toFixed(1), (140 + (p[1] - (y0 + y1) / 2) * s).toFixed(1)];
    const path = (ids, close) => ids.map((i, k) => `${k ? 'L' : 'M'}${P([lm[i].x * W, lm[i].y * H]).join(',')}`).join('') + (close ? 'Z' : '');
    const F = faceFrame(lm, W, H);
    const regions = REGIONS.map(({ id }) => {
      const r = this.skin.per[id];
      if (!r) return '';
      const pts = regionCorners(F, id).map((p) => P(p).join(','));
      if (r.covered) return `<polygon points="${pts.join(' ')}" fill="rgba(160,160,170,.18)" stroke="rgba(255,255,255,.5)" stroke-dasharray="3 3" stroke-width="1"/>`;
      if (r.level == null) return '';
      return `<polygon points="${pts.join(' ')}" fill="${hexA(LEVEL_COLOR[r.level], 0.38)}" stroke="${LEVEL_COLOR[r.level]}" stroke-width="1"/>`;
    }).join('');
    const spots = [];
    for (const reg of Object.values(raw.regions)) {
      if (!reg || !reg.spots) continue;
      for (const sp of reg.spots) {
        const p = P([sp.x * W, sp.y * H]);
        spots.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${Math.max(2.2, sp.r * s * 1.3).toFixed(1)}" fill="none" stroke="${sp.kind === 'red' ? '#fb7185' : '#facc15'}" stroke-width="1.4"/>`);
      }
    }
    return `<svg viewBox="0 0 240 280" class="hp-svg">
      <defs><radialGradient id="hpface" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="rgba(255,255,255,.10)"/><stop offset="1" stop-color="rgba(255,255,255,.02)"/></radialGradient></defs>
      <path d="${path(FACE_OVAL, true)}" fill="url(#hpface)" stroke="rgba(255,255,255,.55)" stroke-width="1.4"/>
      ${regions}
      <path d="${path(BROW_A)}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.4" stroke-linecap="round"/>
      <path d="${path(BROW_B)}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.4" stroke-linecap="round"/>
      <path d="${path(EYE_A, true)}" fill="rgba(0,0,0,.25)" stroke="rgba(255,255,255,.7)" stroke-width="1.2"/>
      <path d="${path(EYE_B, true)}" fill="rgba(0,0,0,.25)" stroke="rgba(255,255,255,.7)" stroke-width="1.2"/>
      <path d="${path(NOSE)}" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.2"/>
      <path d="${path(LIPS, true)}" fill="rgba(255,120,140,.18)" stroke="rgba(255,255,255,.6)" stroke-width="1.2"/>
      ${spots.join('')}
    </svg>`;
  }

  drawWave() {
    const c = this.waveCanvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const wave = this.pulse.wave;
    if (!wave.length) {
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.font = '500 22px "Segoe UI Variable Text", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.lastFace ? 'Reading your pulse… hold still' : 'Face the camera', w / 2, h / 2 + 8);
      return;
    }
    let mx = 1e-9;
    for (const v of wave) mx = Math.max(mx, Math.abs(v));
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(251,113,133,0)');
    g.addColorStop(0.2, 'rgba(251,113,133,.9)');
    g.addColorStop(1, '#ffe4e6');
    ctx.strokeStyle = g;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    wave.forEach((v, i) => {
      const x = (i / (wave.length - 1)) * w;
      const y = h / 2 - (v / mx) * h * 0.4;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}

function card(title, value, sub, tab) {
  return `<button class="hp-card" data-tab="${tab}"><span class="hp-card-t">${title}</span><span class="hp-card-v">${value}</span><span class="hp-card-s">${sub}</span></button>`;
}

function poly(ctx, pts, fill) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  if (fill) ctx.fill();
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
