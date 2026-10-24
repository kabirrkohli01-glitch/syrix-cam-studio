import { VERT, COMPOSITE, PLATE, COPY, SCAN, TRAIL, TRAIL_SHOW, MOTION, filterSource } from './shaders.js';

const SCAN_SECONDS = 7;
const TRAIL_KEEP = 0.8;
const RING_LAYERS = 72;
const RING_WIDTH = 768;

// WebGL 2 pipeline: composite -> style -> optional time or motion effect.
export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 is not available on this device.');
    this.gl = gl;
    this.canvas = canvas;
    this.vao = gl.createVertexArray();
    this.vs = this.compileShader(gl.VERTEX_SHADER, VERT);
    this.programs = new Map();
    this.cover = { sx: -1, sy: 1, ox: 1, oy: 0 };
    this.view = { mirror: true, zoom: 1, fu: 0.5, fv: 0.5 };

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.camTex = this.makeTex();
    this.maskTex = this.makeTex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    this.videoW = 0;
    this.videoH = 0;
    this.mipsValid = false;
    this.maskVersion = -1;

    this.base = null;
    this.sceneT = null;
    this.frozen = null;
    this.trail = [null, null];
    this.trailIdx = 0;
    this.trailFresh = true;
    this.plate = [null, null];
    this.plateIdx = 0;
    this.plateFresh = true;
    this.scanLine = 0;
    this.scanMode = null;

    this.ring = null;
    this.ringW = 0;
    this.ringH = 0;
    this.ringHead = -1;
    this.ringCount = 0;
    this.ringFbo = gl.createFramebuffer();
    this.motion = { mode: null, paused: false, replay: null, frozen: -1, held: -1, heldAt: 0 };

    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => window.location.reload());
  }

  // ---------------------------------------------------------------- resources

  compileShader(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`Shader compile failed: ${log}`);
    }
    return sh;
  }

  program(key, fragSrc) {
    let p = this.programs.get(key);
    if (p) return p;
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, this.vs);
    gl.attachShader(prog, this.compileShader(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Program link failed (${key}): ${gl.getProgramInfoLog(prog)}`);
    }
    p = { prog, locs: new Map() };
    this.programs.set(key, p);
    return p;
  }

  filterProgram(id) {
    try {
      return this.program(`filter:${id}`, filterSource(id));
    } catch (err) {
      console.error(err);
      return this.program('filter:original', filterSource('original'));
    }
  }

  use(p) { this.gl.useProgram(p.prog); this.cur = p; }

  loc(name) {
    const p = this.cur;
    let l = p.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(p.prog, name);
      p.locs.set(name, l);
    }
    return l;
  }

  u1i(n, v) { this.gl.uniform1i(this.loc(n), v); }
  u1f(n, v) { this.gl.uniform1f(this.loc(n), v); }
  u2f(n, a, b) { this.gl.uniform2f(this.loc(n), a, b); }
  u4f(n, a, b, c, d) { this.gl.uniform4f(this.loc(n), a, b, c, d); }

  makeTex() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  makeTarget(w, h) {
    const gl = this.gl;
    const tex = this.makeTex();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  freeTarget(t) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  bindTarget(t) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : this.canvas.width, t ? t.h : this.canvas.height);
  }

  bindTex(unit, tex, target) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target || gl.TEXTURE_2D, tex);
  }

  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---------------------------------------------------------------- sizing

  resize(w, h) {
    if (this.canvas.width === w && this.canvas.height === h && this.base) return;
    this.canvas.width = w;
    this.canvas.height = h;
    for (const t of [this.base, this.sceneT, this.frozen, ...this.trail]) this.freeTarget(t);
    this.base = this.makeTarget(w, h);
    this.sceneT = this.makeTarget(w, h);
    this.frozen = this.makeTarget(w, h);
    this.trail = [this.makeTarget(w, h), this.makeTarget(w, h)];
    this.trailFresh = true;
    this.scanLine = 0;
    if (this.ring) this.freeRing();
    this.updateCover();
  }

  // Maps screen coordinates to video coordinates: cover-fit, optional
  // mirror, and the zoom/focus used by auto-framing.
  setView(view) {
    const v = this.view;
    if (v.mirror === view.mirror && Math.abs(v.zoom - view.zoom) < 1e-4
      && Math.abs(v.fu - view.fu) < 1e-5 && Math.abs(v.fv - view.fv) < 1e-5) return;
    this.view = { ...view };
    this.updateCover();
  }

  updateCover() {
    const W = this.canvas.width, H = this.canvas.height;
    if (!this.videoW || !W) return;
    const sa = W / H, va = this.videoW / this.videoH;
    let kx = 1, ky = 1;
    if (sa > va) ky = va / sa; else kx = sa / va;
    const z = Math.max(1, this.view.zoom);
    const hx = kx / z / 2, hy = ky / z / 2;
    const fu = Math.min(1 - hx, Math.max(hx, this.view.fu));
    const fv = Math.min(1 - hy, Math.max(hy, this.view.fv));
    if (this.view.mirror) this.cover = { sx: -kx / z, sy: ky / z, ox: fu + hx, oy: fv - hy };
    else this.cover = { sx: kx / z, sy: ky / z, ox: fu - hx, oy: fv - hy };
  }

  // ---------------------------------------------------------------- uploads

  uploadVideo(video) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.camTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    this.mipsValid = false;
    if (video.videoWidth !== this.videoW || video.videoHeight !== this.videoH) {
      this.videoW = video.videoWidth;
      this.videoH = video.videoHeight;
      this.updateCover();
      this.ensurePlate(true);
    }
  }

  uploadMask(data, w, h, version) {
    if (version === this.maskVersion) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    this.maskVersion = version;
    this.maskW = w;
    this.maskH = h;
  }

  ensurePlate(force) {
    if (this.plate[0] && !force) return;
    this.freeTarget(this.plate[0]);
    this.freeTarget(this.plate[1]);
    const w = 640;
    const h = Math.max(2, Math.round(640 * (this.videoH || 360) / (this.videoW || 640)));
    this.plate = [this.makeTarget(w, h), this.makeTarget(w, h)];
    this.plateFresh = true;
  }

  resetPlate() { this.plateFresh = true; }
  resetScan() { this.scanLine = 0; }
  resetTrails() { this.trailFresh = true; }

  // ---------------------------------------------------------------- motion ring

  ensureRing() {
    if (this.ring) return;
    const gl = this.gl;
    this.ringW = Math.min(RING_WIDTH, this.canvas.width);
    this.ringH = Math.max(2, Math.round(this.ringW * this.canvas.height / this.canvas.width));
    this.ring = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.ring);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, this.ringW, this.ringH, RING_LAYERS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.ringHead = -1;
    this.ringCount = 0;
  }

  freeRing() {
    if (!this.ring) return;
    this.gl.deleteTexture(this.ring);
    this.ring = null;
    this.ringCount = 0;
    this.motion.replay = null;
    this.motion.frozen = -1;
  }

  layerAgo(n) {
    const k = Math.min(n, this.ringCount - 1);
    return (this.ringHead - k + RING_LAYERS * 4) % RING_LAYERS;
  }

  writeRing() {
    const gl = this.gl;
    this.ringHead = (this.ringHead + 1) % RING_LAYERS;
    this.ringCount = Math.min(RING_LAYERS, this.ringCount + 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ringFbo);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.ring, 0, this.ringHead);
    gl.viewport(0, 0, this.ringW, this.ringH);
    this.use(this.program('copy', COPY));
    this.bindTex(0, this.sceneT.tex);
    this.u1i('u_src', 0);
    this.u2f('u_res', this.ringW, this.ringH);
    this.draw();
  }

  // Starts a slow-motion replay of the last two seconds, or captures a new
  // freeze frame, depending on the active motion mode.
  motionAction() {
    const m = this.motion;
    if (!this.ring || this.ringCount < 2) return false;
    if (m.mode === 'slowmo') {
      const n = Math.min(60, this.ringCount);
      m.replay = { start: this.layerAgo(n - 1), length: n, pos: 0 };
      return true;
    }
    if (m.mode === 'freeze') {
      // Recording resumes for one frame, which becomes the new still.
      m.frozen = -1;
      return true;
    }
    return false;
  }

  get replaying() { return !!this.motion.replay; }
  get ringFill() { return this.ringCount / RING_LAYERS; }

  // ---------------------------------------------------------------- frame

  render(p) {
    if (this.lost || !this.base || !this.videoW) return;
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    const c = this.cover;

    gl.bindTexture(gl.TEXTURE_2D, this.camTex);
    if (p.needMips) {
      if (!this.mipsValid) { gl.generateMipmap(gl.TEXTURE_2D); this.mipsValid = true; }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }

    // Invisibility plate
    if (p.bg === 8 && p.hasMask) {
      this.ensurePlate(false);
      if (p.newFrame || this.plateFresh) {
        const src = this.plate[this.plateIdx];
        const dst = this.plate[this.plateIdx ^ 1];
        this.bindTarget(dst);
        this.use(this.program('plate', PLATE));
        this.bindTex(0, this.camTex);
        this.bindTex(1, this.maskTex);
        this.bindTex(2, src.tex);
        this.u1i('u_cam', 0); this.u1i('u_mask', 1); this.u1i('u_prev', 2);
        this.u1f('u_rate', 0.14);
        this.u1f('u_init', this.plateFresh ? 1 : 0);
        this.draw();
        this.plateIdx ^= 1;
        this.plateFresh = false;
      }
    }

    // Pass A: composite
    this.bindTarget(this.base);
    this.use(this.program('composite', COMPOSITE));
    this.bindTex(0, this.camTex);
    this.bindTex(1, this.maskTex);
    this.bindTex(2, this.plate[this.plateIdx] ? this.plate[this.plateIdx].tex : this.camTex);
    this.u1i('u_cam', 0); this.u1i('u_mask', 1); this.u1i('u_plate', 2);
    this.u4f('u_cover', c.sx, c.sy, c.ox, c.oy);
    this.u2f('u_res', W, H);
    this.u1f('u_aspect', W / H);
    this.u1f('u_time', p.time);
    this.u1i('u_bg', p.bg);
    this.u1f('u_hasMask', p.hasMask ? 1 : 0);
    this.u2f('u_maskTexel', 1 / (this.maskW || 256), 1 / (this.maskH || 144));
    this.u1f('u_autoLight', p.autoLight ? 1 : 0);
    this.u1i('u_enhance', p.enhance || 0);
    this.u2f('u_camTexel', 1 / this.videoW, 1 / this.videoH);
    const f = p.face;
    this.u1i('u_warp', p.warp);
    this.u1f('u_faceOn', f ? 1 : 0);
    if (f) {
      this.u4f('u_eyes', f.eyes[0], f.eyes[1], f.eyes[2], f.eyes[3]);
      this.u4f('u_mf', f.mouth[0], f.mouth[1], f.center[0], f.center[1]);
      this.u1f('u_faceR', f.radius);
    }
    this.draw();

    // Pass B: style
    const motion = p.motion || null;
    if (motion !== this.motion.mode) {
      this.motion.mode = motion;
      this.motion.replay = null;
      this.motion.frozen = -1;
      this.motion.held = -1;
      if (!motion) this.freeRing();
    }
    const post = motion ? null : p.post;
    if (post !== this.scanMode) {
      this.scanMode = post;
      this.scanLine = 0;
      this.trailFresh = true;
    }
    this.bindTarget(post || motion ? this.sceneT : null);
    this.use(this.filterProgram(p.look));
    this.bindTex(0, this.base.tex);
    this.u1i('u_base', 0);
    this.u2f('u_res', W, H);
    this.u1f('u_time', p.time);
    this.u1f('u_aspect', W / H);
    this.draw();

    if (motion) { this.renderMotion(p, W, H); return; }
    if (!post) return;

    // Pass C: time effects
    const scanDir = post === 'scan-down' ? 0 : post === 'scan-across' ? 1 : -1;
    if (scanDir >= 0) {
      const prev = this.scanLine;
      if (prev <= 1) {
        const next = Math.min(prev + p.dt / SCAN_SECONDS, 1.0001);
        this.bindTarget(this.frozen);
        this.use(this.program('copy', COPY));
        this.bindTex(0, this.sceneT.tex);
        this.u1i('u_src', 0);
        this.u2f('u_res', W, H);
        gl.enable(gl.SCISSOR_TEST);
        if (scanDir === 0) {
          const y0 = Math.floor(H * (1 - Math.min(next, 1)));
          const y1 = Math.ceil(H * (1 - prev)) + 1;
          gl.scissor(0, y0, W, Math.max(1, y1 - y0));
        } else {
          const x0 = Math.floor(W * prev) - 1;
          const x1 = Math.ceil(W * Math.min(next, 1));
          gl.scissor(Math.max(0, x0), 0, Math.max(1, x1 - x0), H);
        }
        this.draw();
        gl.disable(gl.SCISSOR_TEST);
        this.scanLine = next;
      }
      this.bindTarget(null);
      this.use(this.program('scan', SCAN));
      this.bindTex(0, this.sceneT.tex);
      this.bindTex(1, this.frozen.tex);
      this.u1i('u_scene', 0); this.u1i('u_frozen', 1);
      this.u2f('u_res', W, H);
      this.u1f('u_line', this.scanLine);
      this.u1i('u_dir', scanDir);
      this.draw();
      return;
    }

    const src = this.trail[this.trailIdx];
    const dst = this.trail[this.trailIdx ^ 1];
    this.bindTarget(dst);
    this.use(this.program('trail', TRAIL));
    this.bindTex(0, this.sceneT.tex);
    this.bindTex(1, src.tex);
    this.u1i('u_cur', 0); this.u1i('u_prev', 1);
    this.u2f('u_res', W, H);
    this.u1f('u_keep', this.trailFresh ? 0 : TRAIL_KEEP);
    this.draw();
    this.trailIdx ^= 1;
    this.trailFresh = false;

    this.bindTarget(null);
    this.use(this.program('trailShow', TRAIL_SHOW));
    this.bindTex(0, this.sceneT.tex);
    this.bindTex(1, dst.tex);
    this.u1i('u_cur', 0); this.u1i('u_acc', 1);
    this.u2f('u_res', W, H);
    this.draw();
  }

  renderMotion(p, W, H) {
    const gl = this.gl;
    const m = this.motion;
    this.ensureRing();
    const recording = !m.replay && !(m.mode === 'freeze' && m.frozen >= 0);
    if (p.newFrame && recording) this.writeRing();
    if (m.mode === 'freeze' && m.frozen < 0 && this.ringCount > 0) m.frozen = this.ringHead;

    let layer = this.ringHead;
    let mode = 0;
    const clones = [-1, -1, -1, -1];
    switch (m.mode) {
      case 'slowmo':
        if (m.replay) {
          m.replay.pos += p.dt * 30 * 0.32;
          if (m.replay.pos >= m.replay.length - 1) m.replay = null;
          else layer = (m.replay.start + Math.floor(m.replay.pos)) % RING_LAYERS;
        }
        break;
      case 'boomerang': {
        const n = Math.min(26, this.ringCount);
        const period = Math.max(1, (n - 1) * 2);
        const k = Math.floor((p.time * 30 * 1.25) % period);
        const back = k < n - 1 ? n - 1 - k : k - (n - 1);
        layer = this.layerAgo(back);
        break;
      }
      case 'delay':
        layer = this.layerAgo(RING_LAYERS - 2);
        break;
      case 'clones':
        mode = 1;
        for (let i = 0; i < 4; i++) {
          const ago = (i + 1) * 9;
          if (this.ringCount > ago) clones[i] = this.layerAgo(ago);
        }
        break;
      case 'stopmotion':
        if (m.held < 0 || p.time - m.heldAt > 0.125) { m.held = this.ringHead; m.heldAt = p.time; }
        layer = m.held;
        break;
      case 'freeze':
        layer = m.frozen >= 0 ? m.frozen : this.ringHead;
        break;
      default:
        break;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    this.use(this.program('motion', MOTION));
    this.bindTex(3, this.ring, gl.TEXTURE_2D_ARRAY);
    this.bindTex(0, this.sceneT.tex);
    this.u1i('u_ring', 3);
    this.u1i('u_live', 0);
    this.u2f('u_res', W, H);
    this.u1i('u_mode', mode);
    this.u1f('u_layer', Math.max(0, layer));
    this.u4f('u_clones', clones[0], clones[1], clones[2], clones[3]);
    this.draw();
  }

  get scanDone() { return this.scanLine > 1; }

  // Warm up shader compilation so switching effects never stalls a frame.
  // Time, motion and invisibility passes are included: compiling one the
  // first time its effect was picked froze the picture for a moment.
  precompile(ids) {
    const jobs = [
      ...[['plate', PLATE], ['scan', SCAN], ['trail', TRAIL], ['trailShow', TRAIL_SHOW], ['motion', MOTION]].map(([k, src]) => () => this.program(k, src)),
      ...ids.map((id) => () => this.filterProgram(id)),
    ];
    const run = (i) => {
      if (i >= jobs.length) return;
      try { jobs[i](); } catch (e) { console.error(e); }
      setTimeout(() => run(i + 1), 40);
    };
    try {
      this.program('composite', COMPOSITE);
      this.program('copy', COPY);
    } catch (e) { console.error(e); }
    run(0);
  }
}
