import {
  MODES, LOOKS, ENHANCE, TIME_FX, BACKGROUNDS, WEATHER, FACE_OVERLAYS, FACE_WARPS,
  HAND_FX, MOTION, GAMES, BRUSHES, HEALTH, findItem,
} from './catalog.js';
import { Renderer } from './renderer.js';
import { Vision, KINDS } from './vision.js';
import {
  Mapper, buildFaces, buildHands, buildBodies, Smooth, LandmarkSmoother, Tracker, plausibleHand,
} from './tracking.js';
import { Particles } from './fx/particles.js';
import { FaceFX } from './fx/face.js';
import { HandFX, GESTURE_LABEL } from './fx/hands.js';
import { DrawFX, PALETTE } from './fx/draw.js';
import { Weather } from './fx/weather.js';
import { Games } from './games.js';
import { Sfx } from './audio.js';
import { on as onHost, send as sendHost } from './bridge.js';
import { settings, host, loadSettings, saveSettings, resetSettings } from './store.js';
import { Dock } from './ui/dock.js';
import { SettingsSheet } from './ui/settings.js';
import { SyrixChat } from './ui/chat.js';
import { Menu } from './ui/menu.js';
import { Intro } from './ui/intro.js';
import { Island } from './ui/island.js';
import { Rail } from './ui/rail.js';
import { Pet } from './ui/pet.js';
import { VoiceMode } from './voice/voice.js';
import { SignReader } from './features/sign.js';
import { HandCursor } from './features/cursor.js';
import { Desktop } from './features/desktop.js';
import { Widgets, WIDGETS } from './features/widgets.js';
import { Biometrics } from './features/biometrics.js';
import { Awareness } from './features/awareness.js';
import { Stage, ANIMATIONS, ANCHORS } from './features/stage.js';
import { Apps } from './features/apps.js';
import { Health } from './health/health.js';
import { FaceID } from './features/faceid.js';
import * as gw from './syrix/gateway.js';

const $ = (id) => document.getElementById(id);

const els = {
  video: $('cam'), gl: $('gl'), fx: $('fx'),
  dock: $('dock'), rail: $('rail'), island: $('island'), topActions: document.querySelector('.top-actions'),
  hint: $('hint'), toast: $('toast'), flash: $('flash-title'), fps: $('fps'), badge: $('motion-badge'),
  engine: $('engine-status'), engineText: $('engine-text'),
  btnLive: $('btn-live'), btnWidgets: $('btn-widgets'), btnPip: $('btn-pip'),
  btnFull: $('btn-full'), btnSettings: $('btn-settings'), btnSyrix: $('btn-syrix'), btnVoice: $('btn-voice'), btnMenu: $('btn-menu'),
  sense: $('sense'), senseChips: $('sense-chips'),
  picker: $('widget-picker'),
  cover: $('shutter-screen'), coverTitle: $('cover-title'), coverText: $('cover-text'), coverAction: $('cover-action'),
  welcome: $('welcome'),
};

const state = {
  mode: 'looks',
  look: 'original', enhance: null, time: null,
  bg: 'none', weather: null,
  overlay: 'off', warp: null,
  hand: 'off',
  brush: 'neon', anchor: 'screen', size: 'm',
  motion: 'off',
  sign: 'spell',
  cursor: 'off',
  game: 'bubbles',
  health: 'overview',
  cameraOn: false, manualOff: false, hiddenByHost: false,
  freeze: false,
  pip: false,
};

const sfx = new Sfx();
const particles = new Particles();
const faceFx = new FaceFX(particles, sfx);
const handFx = new HandFX(particles, sfx);
const draw = new DrawFX(particles, sfx);
const weather = new Weather(particles, sfx);
const vision = new Vision();
const mapper = new Mapper();
const faceSmoother = new LandmarkSmoother(1.0, 0.012);
const handSmoother = new LandmarkSmoother(1.0, 0.012);
const bodySmoother = new LandmarkSmoother(0.8, 0.01);
const faceTracker = new Tracker('f', { reach: 1.2, keep: 0.5 });
const handTracker = new Tracker('h', { reach: 1.8, keep: 0.25 });
const bodyTracker = new Tracker('b', { reach: 1.2, keep: 0.5 });
const warpSmooth = new Smooth(0.45, 0.9, 0.02);
const bio = new Biometrics();
const awareness = new Awareness();
const faceId = new FaceID();
let faceResult = null;
let faceScan = null;
const fxCtx = els.fx.getContext('2d');
const snapCanvas = document.createElement('canvas');
let renderer = null;
let dock, rail, sheet, chat, sign, cursor, desktop, widgets, stage, apps, health, voice, island, menu, intro, pet;

let stream = null;
let cameras = [];
let W = 1, H = 1, dpr = 1;
let faces = [];
let hands = [];
let bodies = [];
let pendingHint = null;
let fpsValue = 0;
const af = { zoom: 1, fu: 0.5, fv: 0.5 };

const pointer = {
  x: 0, y: 0, down: false, last: 0,
  get active() { return this.down || performance.now() - this.last < 120; },
};

const games = new Games({
  particles,
  sfx,
  dom: {
    panel: $('game-panel'), kicker: $('gp-kicker'), title: $('gp-title'), sub: $('gp-sub'),
    rules: $('gp-rules'), best: $('gp-best'), start: $('gp-start'), exit: $('gp-exit'),
    hud: $('game-hud'), score: $('hud-score'), time: $('hud-time'), timeBlock: $('hud-time-block'),
    lives: $('hud-lives'), livesBlock: $('hud-lives-block'),
  },
  onExit: () => { requestModels(); updateAction(); },
});

// ------------------------------------------------------------------ feedback

let hintTimer = 0;
function showHint(html, ms = 6500) {
  clearTimeout(hintTimer);
  if (!html || !settings.hints) { els.hint.classList.remove('show'); return; }
  els.hint.innerHTML = html;
  els.hint.classList.add('show');
  hintTimer = setTimeout(() => els.hint.classList.remove('show'), ms);
}

// Confirmations appear in the island at the top.
function toast(text) {
  if (island) island.toast(text);
}

function flashTitle(text) {
  els.flash.textContent = text;
  els.flash.classList.remove('show');
  void els.flash.offsetWidth;
  els.flash.classList.add('show');
}

function cameraFlash() {
  const f = document.createElement('div');
  f.className = 'camera-flash';
  document.body.append(f);
  setTimeout(() => f.remove(), 600);
}

function measureDock() {
  document.documentElement.style.setProperty('--dock-h', `${els.dock.offsetHeight}px`);
}

// ------------------------------------------------------------------ selection

function groupOf(key) {
  for (const m of MODES) {
    if (m.key === key) return { items: m.items, required: true, primary: true };
    for (const g of m.extras || []) if (g.key === key) return { ...g, primary: false };
  }
  return null;
}

function setValue(key, value, { quiet = false } = {}) {
  if (state[key] === value) return;
  state[key] = value;
  // Changing an effect always shows the live picture again.
  state.freeze = false;
  if (key === 'bg' && value === 'invisible') renderer.resetPlate();
  if (key === 'time') { renderer.resetScan(); renderer.resetTrails(); }
  if (key === 'overlay') faceFx.reset();
  if (key === 'hand') handFx.reset();
  if (key === 'weather') weather.set(value, W, H);
  if (key === 'sign' && state.mode === 'sign') sign.show(value);
  if (key === 'cursor') updateCursor();
  if (key === 'game' && state.mode === 'games') games.select(value);
  if (key === 'health') health.setTab(value);
  dock.sync(state);
  requestModels();
  updateEngineStatus();
  updateAction();
  const item = value ? findItem(key, value) : null;
  if (quiet || !item) return;
  if (groupOf(key) && groupOf(key).primary && !item.off) flashTitle(item.name);
  const waiting = item.needs && item.needs.some((n) => !vision.ready(n) && !vision.failed[n]);
  if (waiting) {
    pendingHint = item;
    showHint('<b>Warming up</b> the AI model for this effect…', 20000);
  } else {
    pendingHint = null;
    showHint(item.hint || null);
  }
}

function onExtra(key, id) {
  const g = groupOf(key);
  sfx.unlock();
  sfx.click();
  setValue(key, !g.required && state[key] === id ? null : id);
}

function setMode(id) {
  if (id === state.mode || !MODES.some((m) => m.id === id)) return;
  const prev = state.mode;
  state.freeze = false;
  if (prev === 'games') games.exit();
  if (prev === 'sign') sign.show(null);
  if (prev === 'health') health.show(false);
  state.mode = id;
  document.body.dataset.mode = id;
  dock.setMode(id, state);
  rail.setMode(id);
  if (id === 'games') games.select(state.game);
  if (id === 'sign') sign.show(state.sign);
  if (id === 'health') { health.show(true); health.setTab(state.health); }
  els.fx.classList.toggle('interactive', id === 'draw');
  updateCursor();
  requestModels();
  updateEngineStatus();
  updateAction();
  measureDock();
  sfx.click();
  const hints = {
    draw: 'Point your <b>index finger</b> to draw · <b>two fingers</b> to move without drawing · hold an <b>open palm</b> still to wipe. The mouse works too.',
    cursor: 'Move your hand to move the ring. <b>Pinch</b> thumb and finger and let go to click; pinch and hold to drag.',
    motion: 'Motion effects replay and loop the last few seconds, kept only in memory.',
    health: 'Face the camera in even light. Press the <b>shutter</b> for a 30-second full scan.',
  };
  showHint(hints[id] || null);
}

function cycleMode(dir) {
  const i = MODES.findIndex((m) => m.id === state.mode);
  setMode(MODES[(i + dir + MODES.length) % MODES.length].id);
}

function cycleKey(key, dir) {
  const g = groupOf(key);
  const ids = g.items.map((x) => x.id);
  const i = Math.max(0, ids.indexOf(state[key]));
  const next = ids[(i + dir + ids.length) % ids.length];
  setValue(key, next);
  return findItem(key, next);
}

// ------------------------------------------------------------------ shutter

function shutterLabel() {
  switch (state.mode) {
    case 'draw': return draw.alive ? 'tap to settle' : 'tap to bring to life';
    case 'sign': return 'tap to speak';
    case 'games': return games.playing ? 'tap to restart' : 'tap to play';
    case 'health': return health && health.scanning ? 'tap to stop scan' : 'tap for full scan';
    case 'motion':
      if (state.motion === 'slowmo') return renderer && renderer.replaying ? 'replaying' : 'tap to replay';
      if (state.motion === 'freeze') return 'tap to retake';
      return state.freeze ? 'tap to unfreeze' : 'tap to freeze';
    default:
      return state.freeze ? 'tap to unfreeze' : 'tap to freeze';
  }
}

function updateAction() {
  if (dock) dock.setAction(shutterLabel());
}

function toggleFreeze() {
  state.freeze = !state.freeze;
  if (state.freeze) { sfx.shutter(); cameraFlash(); }
  else sfx.click();
  updateAction();
}

// Back to the plain camera: every effect off, drawing and anything Syrix made
// cleared, picture unfrozen. Settings, widgets and voice are left alone.
function resetEffects() {
  const plain = { look: 'original', enhance: null, time: null, bg: 'none', weather: null, overlay: 'off', warp: null, hand: 'off', motion: 'off' };
  for (const [k, v] of Object.entries(plain)) setValue(k, v, { quiet: true });
  state.freeze = false;
  if (games.active) games.exit();
  draw.clear();
  stage.remove('all');
  apps.remove('all');
  renderer.resetScan();
  renderer.resetPlate();
  showHint(null);
  updateAction();
  sfx.click();
  toast('Back to normal camera');
}

function shutter() {
  sfx.unlock();
  switch (state.mode) {
    case 'draw':
      if (!draw.count) { toast('Draw something first'); break; }
      draw.toggleLife();
      break;
    case 'sign':
      if (!sign.speak()) toast('Nothing to say yet');
      break;
    case 'games':
      if (!games.active) games.select(state.game);
      games.start();
      requestModels();
      break;
    case 'health':
      health.startScan();
      break;
    case 'motion':
      if (state.motion === 'slowmo' || state.motion === 'freeze') {
        if (renderer.motionAction()) { sfx.shutter(); if (state.motion === 'freeze') cameraFlash(); }
      } else {
        toggleFreeze();
      }
      break;
    default:
      toggleFreeze();
  }
  updateAction();
}

// ------------------------------------------------------------------ vision

function cursorActive() {
  return state.cursor === 'handsfree' || (state.cursor === 'playground' && state.mode === 'cursor');
}

function updateCursor() {
  cursor.setActive(cursorActive());
  desktop.show(state.mode === 'cursor' && state.cursor === 'playground');
}

const aware = () => settings.awareness || (chat && chat.open) || (voice && voice.on);

function needs() {
  const n = { seg: false, face: false, hands: false, pose: false, objects: false };
  const add = (item) => { if (item && item.needs) for (const k of item.needs) n[k] = true; };
  add(findItem('look', state.look));
  add(findItem('bg', state.bg));
  add(findItem('weather', state.weather));
  add(findItem('warp', state.warp));
  add(findItem('motion', state.motion));
  if (games.active) {
    add(findItem('game', games.id));
    if (games.waitingToStart) n.hands = true;
  } else {
    if (state.overlay !== 'off') add(findItem('overlay', state.overlay));
    if (state.hand !== 'off') add(findItem('hand', state.hand));
  }
  if (state.mode === 'draw') { n.hands = true; if (state.anchor === 'face') n.face = true; }
  if (draw.strokes.some((s) => s.anchor === 'face')) n.face = true;
  if (state.mode === 'sign') n.hands = true;
  if (state.mode === 'health') { n.face = true; n.pose = true; }
  if (cursorActive()) n.hands = true;
  if (faceScan) n.face = true;
  if (settings.camera.autoFrame || widgets.needsFace) n.face = true;
  if (widgets.needsPose) n.pose = true;
  if (settings.effectGestures) n.hands = true;
  if (stage && [...stage.objects.values()].some((o) => o.anchor !== 'screen')) { n.face = true; n.hands = true; }
  // Open apps receive live hand and face input.
  if (apps && apps.count) { n.face = true; n.hands = true; }
  if (aware()) { n.face = true; n.hands = true; n.objects = true; }
  // Models switched off in Settings › Tracking never run.
  const off = settings.tracking.models;
  const map = { seg: 'seg', face: 'face', hands: 'hands', pose: 'pose', objects: 'objects' };
  for (const k of KINDS) if (off[map[k]] === false) n[k] = false;
  return n;
}

function requestModels() {
  const n = needs();
  for (const k of Object.keys(n)) if (n[k]) vision.load(k);
}

function updateEngineStatus() {
  const n = needs();
  const busy = Object.keys(n).some((k) => n[k] && vision.loading(k));
  const failed = Object.keys(n).some((k) => n[k] && vision.failed[k]);
  els.engine.hidden = !busy && !failed;
  els.engine.querySelector('.spinner').hidden = !busy;
  els.engineText.textContent = busy ? 'Loading AI' : 'AI unavailable';
  const loadingIds = new Set();
  const m = MODES.find((x) => x.id === state.mode);
  for (const it of m.items) if (it.needs && it.needs.some((k) => vision.loading(k))) loadingIds.add(it.id);
  dock.setLoading(loadingIds);
}

vision.onChange = (kind) => {
  updateEngineStatus();
  if (vision.failed[kind]) toast('This effect could not start its AI model on this PC');
  if (pendingHint && pendingHint.needs.every((k) => vision.ready(k) || vision.failed[k])) {
    showHint(pendingHint.hint || null);
    pendingHint = null;
  }
};

function applySmoothing() {
  const p = { responsive: [2.2, 0.02], balanced: [1.0, 0.012], smooth: [0.45, 0.006] }[settings.tracking.smoothing] || [1.0, 0.012];
  faceSmoother.configure(p[0], p[1]);
  handSmoother.configure(p[0], p[1]);
}

// ------------------------------------------------------------------ gestures

const gest = { name: null, since: 0, fired: false, until: 0 };
const ACTIONABLE = new Set(['Thumb_Up', 'Thumb_Down', 'Victory', 'ILoveYou', 'Closed_Fist']);
const swipes = new Map();
let swipeUntil = 0;

function gesturesAllowed() {
  return settings.effectGestures && !games.active && !['draw', 'sign', 'cursor', 'health'].includes(state.mode)
    && !cursorActive() && els.welcome.hidden && $('settings').hidden && !menu.open;
}

// Held gestures (thumbs, peace, fist) and a quick open-palm swipe. A swipe is
// only accepted if no swing back follows within a third of a second, so a
// wave is never mistaken for a swipe.
function handleGestures(list, t, dt) {
  let best = null;
  for (const h of list) {
    if (h.age < 3) continue;
    if (ACTIONABLE.has(h.gesture) && h.gestureScore > 0.62 && (!best || h.gestureScore > best.gestureScore)) best = h;
  }
  const name = best ? best.gesture : null;
  if (!els.welcome.hidden || !$('settings').hidden) return;
  if (name !== gest.name) { gest.name = name; gest.since = t; gest.fired = false; }
  const hold = name === 'Closed_Fist' ? 1.0 : 0.45;
  if (name && !gest.fired && t - gest.since >= hold && t >= gest.until) {
    gest.fired = true;
    gest.until = t + 0.8;
    if (games.waitingToStart && name === 'Thumb_Up') { games.start(); requestModels(); updateAction(); return; }
    if (gesturesAllowed()) {
      const [emoji] = GESTURE_LABEL[name] || [''];
      if (name === 'Thumb_Up' || name === 'Thumb_Down') {
        const it = cycleKey('look', name === 'Thumb_Up' ? 1 : -1);
        if (it) toast(`${emoji}  ${it.name}`);
      } else if (name === 'Victory') {
        const it = cycleKey('bg', 1);
        if (it) toast(`${emoji}  ${it.name}`);
      } else if (name === 'Closed_Fist') {
        toggleFreeze();
        toast(state.freeze ? '✊  Frozen' : '✊  Live');
      } else if (name === 'ILoveYou') {
        const x = best.palm[0], y = best.palm[1];
        for (let i = 0; i < 16; i++) {
          particles.spawn({
            kind: 'emoji', ch: ['❤️', '🧡', '💛', '💖'][i % 4], x: x + (Math.random() - 0.5) * 60, y,
            vx: (Math.random() - 0.5) * 420, vy: -200 - Math.random() * 380, g: 280, drag: 0.6,
            life: 1.8, size: 30 + Math.random() * 26, grow: 1.2, rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 2,
          });
        }
        sfx.sparkle();
        pet.react('love', 2200);
        toast(`${emoji}  Love you too`);
      }
    }
  }

  // Swipes.
  const seen = new Set();
  for (const h of list) {
    seen.add(h.id);
    let s = swipes.get(h.id);
    if (!s) { s = { x: h.palm[0], t, hist: [] }; swipes.set(h.id, s); }
    s.hist.push([t, h.palm[0], h.open && h.count >= 4]);
    while (s.hist.length && t - s.hist[0][0] > 0.35) s.hist.shift();
    if (s.pending && t - s.pending.t > 0.32) {
      if (gesturesAllowed() && t >= swipeUntil) {
        // The view is mirrored, so a hand moving to the user's right moves
        // right on screen: next effect.
        dock.step(s.pending.dir);
        sfx.whoosh();
        swipeUntil = t + 0.7;
      }
      s.pending = null;
    }
    const first = s.hist[0];
    if (!first || !s.hist.every((p) => p[2])) continue;
    const dx = h.palm[0] - first[1];
    const span = t - first[0];
    if (Math.abs(dx) > W * 0.22 && span < 0.34 && span > 0.08) {
      const dir = Math.sign(dx);
      if (s.pending && s.pending.dir !== dir) s.pending = null;
      else if (!s.pending) s.pending = { dir, t };
      s.hist = [];
    }
  }
  for (const k of [...swipes.keys()]) if (!seen.has(k)) swipes.delete(k);
  void dt;
}

// ------------------------------------------------------------------ camera

const isVirtualCam = (label) => /virtual|obs|snap camera|manycam|xsplit|droidcam/i.test(label || '');

async function videoInputs() {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

// Opens the chosen camera or the best available one. Physical webcams are
// preferred over virtual cameras, which often deliver no picture until their
// host application is streaming, and every camera is tried before giving up.
async function acquireStream() {
  const hd = settings.camera.resolution === '1080';
  const base = { width: { ideal: hd ? 1920 : 1280 }, height: { ideal: hd ? 1080 : 720 }, frameRate: { ideal: 30 } };
  const tried = new Set();
  let lastErr = null;
  const attempt = async (id) => {
    tried.add(id || 'default');
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: id ? { ...base, deviceId: { exact: id } } : { ...base, facingMode: 'user' },
      });
    } catch (err) {
      lastErr = err;
      return null;
    }
  };
  const preferred = settings.camera.deviceId;
  let s = await attempt(preferred);
  const cams = await videoInputs();
  if (s && !preferred && isVirtualCam(s.getVideoTracks()[0].label)) {
    const physical = cams.find((c) => !isVirtualCam(c.label));
    if (physical) {
      const s2 = await attempt(physical.deviceId);
      if (s2) { for (const t of s.getTracks()) t.stop(); s = s2; }
    }
  }
  if (!s) {
    const order = [...cams].sort((a, b) => isVirtualCam(a.label) - isVirtualCam(b.label));
    for (const c of order) {
      if (tried.has(c.deviceId)) continue;
      s = await attempt(c.deviceId);
      if (s) break;
    }
  }
  if (!s) {
    const err = lastErr || new Error('No camera available');
    err.cameras = cams;
    throw err;
  }
  return s;
}

// Continuous exposure, white balance and focus where the webcam supports
// them; many default to fixed values that look flat or blurry.
async function tuneTrack(track) {
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const adv = {};
    if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
    if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) adv.whiteBalanceMode = 'continuous';
    if (caps.focusMode && caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
    if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] });
  } catch { /* camera keeps its defaults */ }
}

async function startCamera() {
  if (stream) return true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCover('error', 'Camera not supported', 'This system does not expose a camera to SYRIX Cam.');
    return false;
  }
  try {
    stream = await acquireStream();
    els.video.srcObject = stream;
    await els.video.play();
    const track = stream.getVideoTracks()[0];
    tuneTrack(track);
    track.addEventListener('ended', () => {
      stopCamera();
      showCover('error', 'Camera disconnected', 'The camera stopped responding. Reconnect it and try again.');
    });
    state.cameraOn = true;
    state.manualOff = false;
    els.cover.hidden = true;
    updateLive();
    cameras = await videoInputs();
    renderer.resetPlate();
    renderer.resetScan();
    return true;
  } catch (err) {
    stream = null;
    state.cameraOn = false;
    updateLive();
    const name = err && err.name;
    const cams = (err && err.cameras) || [];
    cameras = cams;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      showCover('error', 'Camera access is blocked', 'Allow camera access for desktop apps in Windows Settings › Privacy & security › Camera, then try again.');
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError' || !cams.length) {
      showCover('error', 'No camera found', 'Connect a webcam. SYRIX Cam starts automatically as soon as one is plugged in.');
    } else if (cams.every((c) => isVirtualCam(c.label))) {
      const label = cams[0].label || 'virtual camera';
      showCover('error', 'No webcam picture', `The only camera on this PC is “${label}”, which shows a picture only while its app is streaming. Connect a webcam (it is picked up automatically) or start the virtual camera, then try again.`);
    } else if (name === 'NotReadableError' || name === 'AbortError') {
      showCover('error', 'Camera is busy', 'Another app is using the camera. Close it and try again.');
    } else {
      showCover('error', 'Camera could not start', (err && err.message) || 'Unknown error.');
    }
    return false;
  }
}

function stopCamera() {
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
  els.video.srcObject = null;
  state.cameraOn = false;
  faces = [];
  hands = [];
  bodies = [];
  // Nothing seen before the camera went off may be reported as current.
  vision.reset();
  awareness.reset();
  particles.clear();
  sfx.stopLoops();
  updateLive();
}

async function restartCamera() {
  stopCamera();
  await startCamera();
}

function showCover(mode, title, text) {
  els.coverTitle.textContent = title;
  els.coverText.textContent = text;
  els.coverAction.textContent = mode === 'off' ? 'Turn camera on' : 'Try again';
  els.cover.hidden = false;
}

function updateLive() {
  els.btnLive.classList.toggle('off', !state.cameraOn);
  els.btnLive.querySelector('.status-text').textContent = state.cameraOn ? 'Live' : 'Off';
  els.btnLive.title = state.cameraOn ? 'Turn camera off (L)' : 'Turn camera on (L)';
}

async function toggleCamera(on = !state.cameraOn) {
  if (!on && state.cameraOn) {
    stopCamera();
    state.manualOff = true;
    showCover('off', 'Camera is off', 'The camera light is off and nothing is being captured.');
  } else if (on && !state.cameraOn) {
    await startCamera();
  }
}

let deviceChangeTimer = 0;
function onDeviceChange() {
  clearTimeout(deviceChangeTimer);
  deviceChangeTimer = setTimeout(async () => {
    cameras = await videoInputs();
    if (!state.cameraOn && !state.manualOff && !state.hiddenByHost) {
      if (await startCamera()) toast('Camera connected');
    }
  }, 800);
}

function onHostHidden() {
  if (state.cameraOn) { state.hiddenByHost = true; stopCamera(); }
}
function onHostVisible() {
  if (state.hiddenByHost && !state.manualOff) { state.hiddenByHost = false; startCamera(); }
}

// The JPEG is encoded with toBlob, off the main thread: a synchronous
// toDataURL froze the picture for a moment every time Syrix looked.
async function snapshot() {
  const v = els.video;
  if (!state.cameraOn || !v.videoWidth) return null;
  const w = Math.min(1024, v.videoWidth);
  const h = Math.round((w * v.videoHeight) / v.videoWidth);
  snapCanvas.width = w;
  snapCanvas.height = h;
  snapCanvas.getContext('2d').drawImage(v, 0, 0, w, h);
  const blob = await new Promise((resolve) => snapCanvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) return null;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

// A square JPEG of the main face with some margin, for artwork that uses the
// user's face (camera:face).
async function faceCrop() {
  const v = els.video;
  const f = faces[0];
  if (!state.cameraOn || !v.videoWidth || !f || !f.raw) return null;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of f.raw) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const cx = ((x0 + x1) / 2) * v.videoWidth, cy = ((y0 + y1) / 2) * v.videoHeight;
  const side = Math.max((x1 - x0) * v.videoWidth, (y1 - y0) * v.videoHeight) * 1.6;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  c.getContext('2d').drawImage(v, cx - side / 2, cy - side / 2 - side * 0.05, side, side, 0, 0, 512, 512);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
  if (!blob) return null;
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
}

// Swaps the camera:photo and camera:face placeholders in Syrix's SVG for a
// photo taken now. The photo goes only into the on-screen artwork; the
// conversation keeps the placeholder.
async function withCameraImages(input) {
  if (!input.svg || !/camera:(photo|face)/.test(input.svg)) return input;
  let svg = input.svg;
  if (svg.includes('camera:photo')) {
    const snap = await snapshot();
    if (!snap) return { error: 'The camera is off, so there is no photo to put in the artwork.' };
    svg = svg.split('camera:photo').join(snap.dataUrl);
  }
  if (svg.includes('camera:face')) {
    const crop = await faceCrop();
    if (!crop) return { error: 'No face is in view to put in the artwork.' };
    svg = svg.split('camera:face').join(crop);
  }
  return { ...input, svg };
}

const view = () => ({ vw: els.video.videoWidth, vh: els.video.videoHeight, fov: settings.camera.fov, video: els.video });

// ------------------------------------------------------------------ Syrix

const nameOf = (key, id) => { const it = findItem(key, id); return it ? it.name : 'off'; };

function describe() {
  const mode = MODES.find((m) => m.id === state.mode);
  const lines = [
    `open mode: ${mode.label}`,
    `look: ${nameOf('look', state.look)}; enhance: ${state.enhance ? nameOf('enhance', state.enhance) : 'none'}; time effect: ${state.time ? nameOf('time', state.time) : 'none'}`,
    `scene: ${nameOf('bg', state.bg)}; weather: ${state.weather ? nameOf('weather', state.weather) : 'none'}`,
    `face effect: ${nameOf('overlay', state.overlay)}; face warp: ${state.warp ? nameOf('warp', state.warp) : 'none'}`,
    `hand magic: ${nameOf('hand', state.hand)}; motion: ${nameOf('motion', state.motion)}${state.freeze ? ' (picture frozen)' : ''}`,
    `drawing: ${draw.count} strokes, brush ${nameOf('brush', state.brush)}`,
    `camera: ${state.cameraOn ? `on, ${els.video.videoWidth}x${els.video.videoHeight}` : 'off'}; mirror ${settings.camera.mirror ? 'on' : 'off'}; Center Stage ${settings.camera.autoFrame ? 'on' : 'off'}`,
    `models running: ${KINDS.filter((k) => vision.ready(k) && needs()[k]).join(', ') || 'none'}; tracking up to ${settings.tracking.people} people`,
  ];
  if (state.mode === 'sign') lines.push(`sign reader (${nameOf('sign', state.sign)}) text so far: "${sign.text}"`);
  if (games.active) lines.push(`game: ${nameOf('game', games.id)}, ${games.phase || 'idle'}${games.game ? `, score ${games.game.score}` : ''}`);
  if (cursorActive()) lines.push(`hand cursor: ${state.cursor}`);
  const ws = widgets.summary(faces[0] || null);
  if (ws) lines.push(`widgets: ${ws}`);
  lines.push(`objects Syrix made on screen: ${stage.list() || 'none'}`);
  lines.push(`apps Syrix built (open windows): ${apps.list() || 'none'}`);
  lines.push(`voice mode: ${voice.on ? 'on' : 'off'}; personality: ${settings.ai.style}`);
  lines.push(`local time: ${new Date().toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
  return lines.join('\n');
}

// What Syrix is told it can see. With the camera off it is told exactly
// that: the trackers keep their last results in memory, and reporting those
// made Syrix describe people and objects that were no longer being filmed.
function scene() {
  const n = needs();
  const healthLine = health.report || health.skin ? `health readings: ${health.summary()}` : '';
  if (!state.cameraOn) {
    return [
      'CAMERA OFF: nothing is being captured. There is no current view of people, expressions, gestures, objects or light, and anything seen earlier in this conversation is out of date.',
      healthLine && `${healthLine} (from the last scan, not live)`,
    ].filter(Boolean).join('\n');
  }
  const tracking = ['face', 'hands'].some((k) => n[k] && vision.ready(k));
  const parts = [awareness.summary({ tracking })];
  if (faces[0]) parts.push(`main person: ${bio.summary()}`);
  parts.push(faceId.describe(faceResult));
  if (state.mode === 'health' || healthLine) parts.push(`health readings: ${health.summary()}`);
  return parts.join('\n');
}

const ids = (list) => list.map((x) => x.id);
const offable = (list) => [...ids(list).filter((x) => x !== 'off'), 'off'];
const S = (extra = {}) => ({ type: 'string', ...extra });
const tool = (name, description, properties, required = []) => ({ name, description, parameters: { type: 'object', properties, required } });
const SETTINGS_SECTIONS = ['general', 'camera', 'tracking', 'performance', 'ai', 'voice', 'privacy', 'shortcuts', 'about'];
const PALETTE_NAMES = ['orange', 'pink', 'purple', 'blue', 'green', 'white', 'black', 'rainbow'];

function toolSchemas() {
  const objProps = {
    name: S({ description: 'Short name, e.g. "rocket".' }),
    svg: S({ description: 'Complete <svg viewBox="0 0 512 512"> artwork in the style of a polished product illustration. Get the real proportions and the parts that make the thing recognisable right first (an iPhone: rounded slab, thin bezel, Dynamic Island pill, camera bump; a car: wheels under arches, windows, lights). Build it from many layered shapes (typically 20-60): gradients in <defs>, highlights, reflections, soft shadows, small details. Filters (feGaussianBlur, feDropShadow, feTurbulence), patterns and <animate>/<animateTransform> are allowed. To put the user\'s camera photo into the artwork (a phone wallpaper, a poster, a frame) use <image href="camera:photo" .../> (whole frame) or href="camera:face" (square face crop) with preserveAspectRatio="xMidYMid slice" inside a clipPath; the app swaps in a photo taken now. No external URLs, scripts or <foreignObject>.' }),
    text: S(), emoji: S(),
    x: { type: 'number', description: 'Centre, % of screen width (0-100).' },
    y: { type: 'number', description: 'Centre, % of screen height (0-100).' },
    size: { type: 'number', description: 'Width, % of screen width (3-95).' },
    rotation: { type: 'number' },
    color: S({ description: 'Recolours the object (CSS colour), keeping its shading.' }),
    animation: S({ enum: ANIMATIONS }),
    anchor: S({ enum: ANCHORS, description: 'screen = stays put; head/face/hand = follows the person.' }),
    opacity: { type: 'number' },
  };
  return [
    tool('set_effects', 'Change what SYRIX Cam shows. Include only the fields to change; "off" turns that effect off. Layers combine: one look, one scene, weather, face effect, face warp, hand magic and motion.', {
      look: S({ enum: ids(LOOKS) }), enhance: S({ enum: offable(ENHANCE) }), time_effect: S({ enum: offable(TIME_FX) }),
      scene: S({ enum: ids(BACKGROUNDS), description: '"none" is the real background.' }), weather: S({ enum: offable(WEATHER) }),
      face_effect: S({ enum: offable(FACE_OVERLAYS) }), face_warp: S({ enum: offable(FACE_WARPS) }),
      hand_magic: S({ enum: offable(HAND_FX) }), motion: S({ enum: offable(MOTION) }), brush: S({ enum: ids(BRUSHES) }),
    }),
    tool('open', 'Open a mode, panel or settings page.', {
      target: S({ enum: [...MODES.map((m) => m.id), 'settings', 'widgets', 'menu', 'close_panels'] }),
      section: S({ enum: [...SETTINGS_SECTIONS, ...ids(HEALTH)], description: 'Settings page, or Health tab when target is health.' }),
    }, ['target']),
    tool('start_game', 'Open a camera game and show its start card.', { game: S({ enum: ids(GAMES) }), start_now: { type: 'boolean' } }, ['game']),
    tool('toggle_widget', 'Show or hide a floating widget.', { widget: S({ enum: WIDGETS.map((w) => w.id) }), on: { type: 'boolean' } }, ['widget', 'on']),
    tool('set_timer', 'Start the focus timer widget for a number of minutes.', { minutes: { type: 'number' } }, ['minutes']),
    tool('app_setting', 'Turn an app or camera setting on or off.', {
      setting: S({ enum: ['camera', 'center_stage', 'mirror', 'low_light', 'effect_gestures', 'sound', 'hints', 'auto_hide', 'fullscreen', 'hide_interface', 'mini_player', 'awareness_bar', 'performance_meter', 'voice_mode'] }),
      on: { type: 'boolean' },
    }, ['setting', 'on']),
    tool('tracking_models', 'Switch the on-device AI models on or off, or change how many people are tracked.', {
      face: { type: 'boolean' }, hands: { type: 'boolean' }, background: { type: 'boolean' }, body: { type: 'boolean' }, objects: { type: 'boolean' },
      people: { type: 'number', description: '1 to 3' },
    }),
    tool('camera_action', 'Freeze or unfreeze the picture, replay slow motion, or restart time effects.', { action: S({ enum: ['freeze', 'unfreeze', 'replay', 'restart_effects', 'reset_to_normal'] }) }, ['action']),
    tool('drawing', 'Edit the Draw mode canvas.', {
      action: S({ enum: ['clear', 'undo', 'bring_to_life', 'settle'] }), brush: S({ enum: ids(BRUSHES) }), size: S({ enum: ['s', 'm', 'l'] }), color: S({ enum: PALETTE_NAMES }),
    }),
    tool('health', 'Health mode: open a tab, start or stop the 30-second scan, or check the skin now. Returns the latest readings.', {
      action: S({ enum: ['open', 'start_scan', 'stop_scan', 'check_skin', 'read'] }), tab: S({ enum: ids(HEALTH) }),
    }, ['action']),
    tool('calibrate_distance', 'Calibrate screen-distance readings when the user says how far away they are sitting.', { cm: { type: 'number' } }, ['cm']),
    tool('create_object', 'Create something on screen over the camera picture: a drawing (write the SVG yourself), text, an emoji or a chart. It can move, animate and follow the head or a hand.', objProps),
    tool('update_object', 'Change an object Syrix made: new artwork ("turn it into a rocket" = new svg), colour, position, size, animation or anchor. id "last" means the most recent one.', { id: S(), ...objProps }, ['id']),
    tool('remove_object', 'Remove an object Syrix made, or "all".', { id: S() }, ['id']),
    tool('show_chart', 'Draw a chart on screen from numbers you supply.', {
      title: S(), kind: S({ enum: ['line', 'bar', 'pie'] }), labels: { type: 'array', items: S() }, values: { type: 'array', items: { type: 'number' } },
      color: S(), x: { type: 'number' }, y: { type: 'number' }, size: { type: 'number' },
    }, ['values']),
    tool('stock_chart', 'Fetch live market data for a company, index, currency or crypto and draw its price chart on screen.', {
      query: S({ description: 'Company name or ticker, e.g. "Tesla" or "AAPL".' }), range: S({ enum: ['1d', '5d', '1mo', '6mo', '1y', '5y'] }),
      x: { type: 'number' }, y: { type: 'number' }, size: { type: 'number' },
    }, ['query']),
    tool('create_app', 'Build a working interactive app in a floating window over the camera: a game, a 3D scene or model, a simulation, a visualiser, a tool. Use this (not create_object) for anything that moves by itself, is played, or is 3D. Write ONE complete HTML document with inline <style> and <script type="module">. 3D: import * as THREE from "three" and { OrbitControls } from "three/addons/controls/OrbitControls.js" (the only libraries; no CDN or network, so no textures from URLs: generate them with canvas or shaders). Make it look finished: full-window canvas resized on window resize, real proportions and colours, lighting and shadows, a small title or HUD, keyboard and mouse controls explained on screen. Camera input is live in window.syrix: syrix.hands = [{x, y, palmX, palmY, pinch, open, fist, fingers, gesture}] (x/y 0-1 within the window, mirrored like the view), syrix.face = {x, y, yaw, pitch, smile, mouthOpen, blink} or null, syrix.on("input", fn); syrix.photo is a JPEG data URL of the user when use_photo is true. Games should offer hand or head control as well as keys. The result reports any errors so you can fix them with update_app.', {
      title: S(), html: S({ description: 'The complete HTML document.' }),
      use_photo: { type: 'boolean', description: 'Take a camera photo now and pass it to the app as syrix.photo.' },
      x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number', description: '% of screen width (20-96), default 52.' }, height: { type: 'number', description: '% of screen height (20-92), default 62.' },
    }, ['title', 'html']),
    tool('update_app', 'Replace an app\'s code (send the full new HTML document: "make it more detailed", "add a score", fixing errors), or move/resize/rename it. id "last" means the most recent app.', {
      id: S(), html: S(), title: S(), use_photo: { type: 'boolean' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
    }, ['id']),
    tool('close_app', 'Close an app window, or "all".', { id: S() }, ['id']),
    tool('face_id', 'Face ID for the owner of this PC: scan (enrol) their face so you recognise them, check who is in front of the camera now, or delete the saved face. Scanning takes about 10 seconds and asks them to turn their head.', {
      action: S({ enum: ['scan', 'check', 'forget'] }),
      name: S({ description: 'Name to remember the owner by, when scanning.' }),
    }, ['action']),
  ];
}

// ------------------------------------------------------------------ Face ID

// Guided scan: an overlay names each pose and fills a ring as views are
// captured. Resolves with the enrolment result.
async function scanFace(name) {
  if (faceScan) return { ok: false, reason: 'busy' };
  if (!state.cameraOn) return { ok: false, reason: 'camera' };
  if (name) settings.faceId.name = String(name).slice(0, 40);
  sheet.toggle(false);
  const el = $('faceid-scan');
  const ring = el.querySelector('.fs-prog');
  const step = $('fs-step');
  const count = $('fs-count');
  const abort = new AbortController();
  faceScan = abort;
  requestModels();
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  $('fs-cancel').onclick = () => abort.abort();
  let r;
  try {
    r = await faceId.enroll(els.video, () => faces[0] || null, ({ say, done, total }) => {
      if (step.textContent !== say) step.textContent = say;
      count.textContent = `${done} / ${total}`;
      ring.style.strokeDashoffset = String(339.3 * (1 - done / total));
    }, abort.signal);
  } finally {
    faceScan = null;
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 350);
  }
  if (r.ok) { saveSettings(); faceResult = null; toast(`Face ID set up for ${faceId.name}`); sfx.sparkle(); }
  else if (r.reason === 'inconsistent') toast('Only one face should be in view. Try again in good light.');
  else if (r.reason === 'timeout') toast('Face ID timed out. Face the camera and try again.');
  return r;
}

function forgetFace() {
  faceId.forget();
  faceResult = null;
  saveSettings();
}

// Runs before each message to Syrix, so the scene it reads says who is there.
// The check costs a model run (and a model load after a minute idle), which
// sat between the end of a spoken question and the request. Voice mode starts
// it when the user starts talking, so it is normally finished in time; a
// check already running is awaited rather than started twice.
let faceCheck = null;

async function beforeAsk({ fresh = false } = {}) {
  if (faceCheck && !fresh) return faceCheck;
  if (fresh && faceId.cache) faceId.cache = null;
  faceCheck = (async () => {
    faceResult = state.cameraOn && faceId.enrolled ? await faceId.identify(els.video, faces[0] || null) : faceId.enrolled ? { status: 'none' } : null;
  })().catch(() => {}).finally(() => { faceCheck = null; });
  return faceCheck;
}

// Friendly region names for the inspect_skin tool, mapped to the face-frame
// regions the Health panel uses.
const INSPECT_REGIONS = {
  forehead: 'forehead', left_cheek: 'cheekL', right_cheek: 'cheekR', nose: 'nose', chin: 'chin',
  under_left_eye: 'eyeL', under_right_eye: 'eyeR', left_eye: 'eyeBoxL', right_eye: 'eyeBoxR',
};

// Opens the Skin tab, waits for a tracked face and returns a close-up of one
// region with its coverage, for Syrix to look at.
async function inspectSkin(region) {
  const id = INSPECT_REGIONS[region] || region;
  if (!state.cameraOn) return { ok: false, message: 'The camera is off.' };
  if (state.mode !== 'health') setMode('health');
  if (!/^eyeBox/.test(id)) setValue('health', 'skin', { quiet: true });
  for (let i = 0; i < 20 && !health.lastFace; i++) await new Promise((r) => setTimeout(r, 100));
  return health.inspect(id, els.video);
}

const FIELD_KEYS = {
  look: 'look', enhance: 'enhance', time_effect: 'time', scene: 'bg', weather: 'weather',
  face_effect: 'overlay', face_warp: 'warp', hand_magic: 'hand', motion: 'motion', brush: 'brush',
};

async function runTool(name, input) {
  const bad = (m) => ({ ok: false, message: m });
  const ok = (m) => ({ ok: true, message: m });
  if (!input || typeof input !== 'object') return bad('Invalid input.');
  switch (name) {
    case 'set_effects': {
      const done = [];
      for (const [field, key] of Object.entries(FIELD_KEYS)) {
        if (!(field in input)) continue;
        const v = input[field];
        const g = groupOf(key);
        const valid = g.items.some((x) => x.id === v) || (v === 'off' && !g.required);
        if (!valid) return bad(`Unknown ${field}: ${v}`);
        setValue(key, v === 'off' && !g.items.some((x) => x.id === 'off') ? null : v, { quiet: true });
        done.push(`${field.replace('_', ' ')}: ${v === 'off' ? 'off' : nameOf(key, v)}`);
      }
      if (!done.length) return bad('No changes were given.');
      return ok(`Set ${done.join(', ')}`);
    }
    case 'open': {
      const t = input.target;
      if (MODES.some((m) => m.id === t)) {
        setMode(t);
        if (t === 'health' && input.section && HEALTH.some((h) => h.id === input.section)) setValue('health', input.section);
        return ok(`Opened ${MODES.find((m) => m.id === t).label}`);
      }
      if (t === 'settings') { sheet.toggle(true, SETTINGS_SECTIONS.includes(input.section) ? input.section : undefined); return ok('Opened settings'); }
      if (t === 'widgets') { togglePicker(true); return ok('Opened widgets'); }
      if (t === 'menu') { menu.toggle(true); return ok('Opened the menu'); }
      if (t === 'close_panels') { sheet.toggle(false); togglePicker(false); menu.toggle(false); return ok('Closed panels'); }
      return bad('Unknown target.');
    }
    case 'start_game': {
      if (!GAMES.some((g) => g.id === input.game)) return bad('Unknown game.');
      state.game = input.game;
      if (state.mode !== 'games') setMode('games'); else games.select(input.game);
      dock.sync(state);
      if (input.start_now) { games.start(); requestModels(); }
      return ok(`Opened ${nameOf('game', input.game)}`);
    }
    case 'toggle_widget': {
      if (!WIDGETS.some((w) => w.id === input.widget)) return bad('Unknown widget.');
      widgets.toggle(input.widget, !!input.on);
      requestModels();
      renderPicker();
      return ok(`${WIDGETS.find((w) => w.id === input.widget).name} ${input.on ? 'shown' : 'hidden'}`);
    }
    case 'set_timer': {
      const m = Math.max(1, Math.min(180, Math.round(Number(input.minutes) || 25)));
      widgets.toggle('timer', true);
      Object.assign(widgets.timer, { mode: 'focus', total: m * 60, left: m * 60, running: true });
      return ok(`Focus timer running for ${m} minutes`);
    }
    case 'app_setting': {
      const on = !!input.on;
      const paths = { center_stage: 'camera.autoFrame', mirror: 'camera.mirror', low_light: 'camera.lowLight', effect_gestures: 'effectGestures', sound: 'sound', hints: 'hints', auto_hide: 'autoHide', awareness_bar: 'awareness' };
      const p = paths[input.setting];
      if (p) {
        const keys = p.split('.');
        const last = keys.pop();
        keys.reduce((o, k) => o[k], settings)[last] = on;
        onSetting(p);
        return ok(`${input.setting.replace(/_/g, ' ')} ${on ? 'on' : 'off'}`);
      }
      if (input.setting === 'camera') { await toggleCamera(on); return ok(`Camera ${on ? 'on' : 'off'}`); }
      if (input.setting === 'fullscreen') { if (on !== !!document.fullscreenElement) toggleFullscreen(); return ok(`Full screen ${on ? 'on' : 'off'}`); }
      if (input.setting === 'hide_interface') { if (on !== document.body.classList.contains('ui-hidden')) toggleUi(); return ok(`Interface ${on ? 'hidden' : 'shown'}`); }
      if (input.setting === 'mini_player') { sendHost({ type: 'pip', on }); return ok(`Mini player ${on ? 'on' : 'off'}`); }
      if (input.setting === 'performance_meter') { els.fps.hidden = !on; return ok(`Performance meter ${on ? 'shown' : 'hidden'}`); }
      if (input.setting === 'voice_mode') { if (on) voice.start(); else voice.stop(); return ok(`Voice mode ${on ? 'on' : 'off'}`); }
      return bad('Unknown setting.');
    }
    case 'tracking_models': {
      const map = { face: 'face', hands: 'hands', background: 'seg', body: 'pose', objects: 'objects' };
      const done = [];
      for (const [k, v] of Object.entries(map)) {
        if (typeof input[k] === 'boolean') { settings.tracking.models[v] = input[k]; done.push(`${k} ${input[k] ? 'on' : 'off'}`); }
      }
      if (input.people) {
        settings.tracking.people = Math.max(1, Math.min(3, Math.round(input.people)));
        vision.setPeople(settings.tracking.people);
        done.push(`tracking ${settings.tracking.people} people`);
      }
      saveSettings();
      requestModels();
      updateEngineStatus();
      return done.length ? ok(done.join(', ')) : bad('Nothing to change.');
    }
    case 'camera_action': {
      if (input.action === 'freeze') { if (!state.freeze) toggleFreeze(); return ok('Picture frozen'); }
      if (input.action === 'unfreeze') { if (state.freeze) toggleFreeze(); return ok('Back to live'); }
      if (input.action === 'replay') {
        if (state.motion !== 'slowmo') { setMode('motion'); setValue('motion', 'slowmo', { quiet: true }); return ok('Slow-mo is ready; it can replay once a couple of seconds have been captured'); }
        renderer.motionAction();
        return ok('Replaying in slow motion');
      }
      if (input.action === 'reset_to_normal') { resetEffects(); return ok('Everything reset to the normal camera'); }
      if (input.action === 'restart_effects') { renderer.resetScan(); renderer.resetPlate(); return ok('Effects restarted'); }
      return bad('Unknown action.');
    }
    case 'drawing': {
      const done = [];
      if (input.brush && BRUSHES.some((b) => b.id === input.brush)) { setValue('brush', input.brush, { quiet: true }); done.push(`brush ${nameOf('brush', input.brush)}`); }
      if (input.size && ['s', 'm', 'l'].includes(input.size)) { setValue('size', input.size, { quiet: true }); done.push(`size ${input.size}`); }
      if (input.color) {
        const i = PALETTE_NAMES.indexOf(input.color);
        if (i >= 0) { draw.pickColor(i); done.push(`colour ${input.color}`); }
      }
      if (input.action === 'clear') done.push(draw.clear() ? 'cleared' : 'nothing to clear');
      if (input.action === 'undo') done.push(draw.undo() ? 'undone' : 'nothing to undo');
      if (input.action === 'bring_to_life' && !draw.alive && draw.count) { draw.toggleLife(); done.push('brought to life'); }
      if (input.action === 'settle' && draw.alive) { draw.toggleLife(); done.push('settled'); }
      if (state.mode !== 'draw' && (input.brush || input.size || input.color)) setMode('draw');
      return done.length ? ok(`Drawing: ${done.join(', ')}`) : bad('Nothing to change.');
    }
    case 'health': {
      if (state.mode !== 'health') setMode('health');
      if (input.tab && HEALTH.some((h) => h.id === input.tab)) setValue('health', input.tab, { quiet: true });
      if (input.action === 'start_scan' && !health.scanning) { health.startScan(); healthAsked = true; return ok('Full scan started; it takes 30 seconds. Results will follow.'); }
      if (input.action === 'stop_scan' && health.scanning) health.stopScan();
      if (input.action === 'check_skin') { setValue('health', 'skin', { quiet: true }); health.checkSkinNow(els.video); }
      return ok(`Health: ${health.summary() || 'no readings yet; hold still facing the camera'}`);
    }
    case 'calibrate_distance': {
      const cm = Number(input.cm);
      const f = faces[0];
      if (!f || !(cm > 15 && cm < 300)) return bad('Need a face in view and a distance between 15 and 300 cm.');
      const fov = bio.fovFor(cm, f, view());
      if (!fov) return bad('Could not see the eyes clearly enough to calibrate.');
      settings.camera.fov = Math.round(fov * 10) / 10;
      saveSettings();
      return ok(`Calibrated: camera field of view set to ${settings.camera.fov}°`);
    }
    case 'create_object': {
      const spec = await withCameraImages(input);
      if (spec.error) return bad(spec.error);
      const r = stage.create(spec);
      requestModels();
      return r;
    }
    case 'update_object': {
      const { id, ...rest } = await withCameraImages(input);
      if (rest.error) return bad(rest.error);
      const r = stage.update(id, rest);
      requestModels();
      return r;
    }
    case 'create_app': {
      const photo = input.use_photo ? await snapshot() : null;
      if (input.use_photo && !photo) return bad('The camera is off, so there is no photo to use.');
      if (state.mode === 'health') setMode('looks');
      return apps.create({ title: input.title, html: input.html, photo: photo && photo.dataUrl, x: input.x, y: input.y, width: input.width, height: input.height });
    }
    case 'update_app': {
      const photo = input.use_photo ? await snapshot() : null;
      const { id, ...rest } = input;
      return apps.update(id, { ...rest, photo: photo && photo.dataUrl });
    }
    case 'close_app':
      return apps.remove(input.id === 'all' ? 'all' : input.id);
    case 'remove_object':
      return stage.remove(input.id === 'all' ? 'all' : input.id);
    case 'show_chart':
      return stage.create({ name: input.title || 'chart', kind: 'chart', chart: { kind: input.kind || 'line', title: input.title, labels: input.labels, values: input.values, color: input.color }, x: input.x ?? 72, y: input.y ?? 38, size: input.size });
    case 'stock_chart': {
      const q = String(input.query || '').trim();
      if (!q) return bad('No company given.');
      let symbol = /^[A-Z0-9.^=-]{1,12}$/.test(q) ? q : null;
      if (!symbol) {
        const found = await gw.marketFind(q);
        if (!found.length) return bad(`No market symbol found for "${q}".`);
        symbol = found[0].symbol;
      }
      const data = await gw.marketChart(symbol, input.range || '1mo');
      const pts = (data.points || []).filter((p) => p.c != null);
      if (pts.length < 2) return bad(`No price history for ${symbol}.`);
      const first = pts[0].c, lastP = pts[pts.length - 1].c;
      const chg = ((lastP - first) / first) * 100;
      const dfmt = (t) => new Date(t).toLocaleDateString(undefined, data.range === '1d' ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' });
      const quote = data.quote || {};
      const title = `${quote.name || symbol} · ${symbol}`;
      const sub = `${lastP.toFixed(2)} ${quote.currency || ''} ${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(1)}% (${data.range})`;
      const r = stage.create({
        name: `${symbol} chart`, kind: 'chart',
        chart: { kind: 'line', title, subtitle: sub, subColor: chg >= 0 ? '#34d399' : '#fb7185', color: chg >= 0 ? '#34d399' : '#fb7185', labels: pts.map((p) => dfmt(p.t)), values: pts.map((p) => p.c) },
        x: input.x ?? 72, y: input.y ?? 38, size: input.size ?? 34,
      });
      return { ...r, message: `${r.message}. ${title}: last ${lastP.toFixed(2)} ${quote.currency || ''}, ${chg >= 0 ? 'up' : 'down'} ${Math.abs(chg).toFixed(1)}% over ${data.range}, range ${Math.min(...pts.map((p) => p.c)).toFixed(2)}–${Math.max(...pts.map((p) => p.c)).toFixed(2)}.` };
    }
    case 'face_id': {
      if (input.action === 'forget') { forgetFace(); return ok('Deleted the saved face. Face ID is off.'); }
      if (input.action === 'check') {
        await beforeAsk({ fresh: true });
        return ok(faceId.describe(faceResult));
      }
      if (input.action === 'scan') {
        const r = await scanFace(input.name);
        if (r.ok) return ok(`Face ID is set up for ${faceId.name} (${r.count} views saved on this PC).`);
        const why = { camera: 'the camera is off', busy: 'a scan is already running', cancelled: 'it was cancelled', timeout: 'no face was seen clearly in time', inconsistent: 'more than one face or poor light' }[r.reason] || 'it failed';
        return bad(`Face scan did not finish: ${why}.`);
      }
      return bad('Unknown Face ID action.');
    }
    default:
      return bad('Unknown tool.');
  }
}

let healthAsked = false;

// ------------------------------------------------------------------ settings

function onSetting(path) {
  saveSettings();
  if (path === 'sound') sfx.setEnabled(settings.sound);
  if (path === 'volume') sfx.setVolume(settings.volume);
  if (path === 'effectGestures') requestModels();
  if (path === 'camera.deviceId' || path === 'camera.resolution') restartCamera();
  if (path === 'camera.autoFrame') { requestModels(); toast(settings.camera.autoFrame ? 'Center Stage on' : 'Center Stage off'); }
  if (path.startsWith('tracking')) {
    applySmoothing();
    cursor.configure({ speed: settings.tracking.cursorSpeed, clickMode: settings.tracking.clickMode });
    vision.setPeople(settings.tracking.people);
    requestModels();
    updateEngineStatus();
  }
  if (path.startsWith('voice')) voice.configure();
  if (path === 'voice.voice') voice.prerender();
  if (path === 'voice.engine') voice.restart({ reloadVoice: true });
  if (path === 'voice.micId' || path === 'voice.noiseSuppression' || path === 'voice.autoGain') voice.restart();
  if (path === 'awareness') { requestModels(); updateSense(true); }
  if (path === 'quality') resize();
  if (path === 'autoHide' || path === 'autoHideDelay') wake();
  if (path === 'ai.snapshots') chat.syncEye();
  if (path === 'hints' && !settings.hints) showHint(null);
  if (path.startsWith('pet')) syncPet();
}

function renderPicker() {
  els.picker.innerHTML = `<div class="wp-title">Widgets</div>${WIDGETS.map((w) => `
    <label class="wp-item" data-hand>
      <span class="wp-icon"><svg viewBox="0 0 24 24" class="ico">${w.icon}</svg></span>
      <span class="wp-text"><b>${w.name}</b><span>${w.desc}</span></span>
      <span class="switch"><input type="checkbox" data-w="${w.id}" ${widgets.isOn(w.id) ? 'checked' : ''}><i></i></span>
    </label>`).join('')}`;
}

function togglePicker(open = els.picker.hidden) {
  els.picker.hidden = !open;
  els.btnWidgets.classList.toggle('on', open);
  if (open) renderPicker();
}

// ------------------------------------------------------------------ menu

const ICON = {
  mode: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="12" cy="12" r="3"/>',
  widget: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  action: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
};

function commands() {
  const list = [];
  MODES.forEach((m, i) => list.push({ group: 'Modes', label: m.label, sub: `${(i + 1) % 10}`, icon: ICON.mode, featured: true, on: state.mode === m.id, run: () => setMode(m.id) }));
  for (const m of MODES) {
    for (const g of [{ key: m.key, items: m.items, title: m.label }, ...(m.extras || [])]) {
      for (const it of g.items) {
        if (it.off) continue;
        list.push({
          group: m.label, label: it.name, sub: g.title !== m.label ? g.title : '', swatch: it.sw, keywords: `${m.label} ${g.title || ''} effect`,
          on: state[g.key] === it.id,
          run: () => { if (state.mode !== m.id && g.key === m.key) setMode(m.id); else if (state.mode !== m.id) setMode(m.id); setValue(g.key, it.id); },
        });
      }
    }
  }
  for (const w of WIDGETS) list.push({ group: 'Widgets', label: w.name, sub: w.desc, icon: w.icon, on: widgets.isOn(w.id), keywords: 'widget', run: () => { widgets.toggle(w.id); requestModels(); } });
  const act = (label, run, keywords = '', featured = false) => list.push({ group: 'Actions', label, icon: ICON.action, keywords, featured, run });
  act(voice.on ? 'End voice mode' : 'Talk to Syrix (voice mode)', () => voice.toggle(), 'voice mic speak hands free', true);
  act('Open Syrix chat', () => chat.toggle(true), 'assistant ai ask', true);
  act('Full health scan', () => { setMode('health'); health.startScan(); }, 'heart pulse skin posture scan', true);
  act(state.cameraOn ? 'Turn camera off' : 'Turn camera on', () => toggleCamera(), 'camera webcam light');
  act('Full screen', toggleFullscreen, 'fullscreen');
  act('Mini player', () => sendHost({ type: 'pip', on: !state.pip }), 'picture in picture pip small window');
  act('Hide interface', toggleUi, 'clean ui hide');
  act('Clear drawing', () => draw.clear(), 'erase wipe draw');
  act('Undo drawing', () => draw.undo(), 'draw');
  act('Remove everything Syrix made', () => stage.remove('all'), 'objects stage clear');
  act(state.freeze ? 'Unfreeze picture' : 'Freeze picture', toggleFreeze, 'pause still');
  act(settings.camera.autoFrame ? 'Turn off Center Stage' : 'Turn on Center Stage', () => { settings.camera.autoFrame = !settings.camera.autoFrame; onSetting('camera.autoFrame'); }, 'auto frame zoom follow');
  act(settings.effectGestures ? 'Turn off effect gestures' : 'Turn on effect gestures', () => { settings.effectGestures = !settings.effectGestures; onSetting('effectGestures'); }, 'thumbs peace swipe hand gesture background');
  act('Reset to normal camera', resetEffects, 'reset clear remove filters effects normal default', true);
  act(settings.sound ? 'Mute sounds' : 'Unmute sounds', () => { settings.sound = !settings.sound; onSetting('sound'); }, 'sound volume audio');
  act('Performance meter', () => { els.fps.hidden = !els.fps.hidden; }, 'fps speed');
  act('New Syrix chat', () => { chat.reset(); chat.toggle(true); }, 'clear conversation');
  for (const s of sheet.sections) list.push({ group: 'Settings', label: `${s.label} settings`, icon: s.icon, keywords: 'settings preferences options', run: () => sheet.toggle(true, s.id) });
  return list;
}

// ------------------------------------------------------------------ pet

// The Syrix character sits in the island while voice mode is on
// (Settings › Syrix can turn it off; the island then shows level bars).
function syncPet() {
  if (!pet) return;
  const show = settings.pet.show !== 'off' && !!(voice && voice.on);
  pet.setVisible(show);
  els.island.classList.toggle('with-pet', show);
}

// ------------------------------------------------------------------ idle

let idleTimer = 0;
function wake(e, delay) {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  if (!settings.autoHide) return;
  idleTimer = setTimeout(goIdle, delay || settings.autoHideDelay * 1000);
}
function goIdle() {
  const busy = !state.cameraOn || !$('settings').hidden || chat.open || !els.picker.hidden || games.waitingToStart || menu.open
    || state.mode === 'sign' || state.mode === 'health' || cursorActive() || voice.on
    || els.dock.matches(':hover') || els.rail.matches(':hover') || els.island.matches(':hover') || els.topActions.matches(':hover');
  if (busy) { idleTimer = setTimeout(goIdle, 1500); return; }
  document.body.classList.add('idle');
}

// ------------------------------------------------------------------ awareness

let senseAt = 0;
function updateSense(force) {
  const now = performance.now();
  if (!force && now - senseAt < 500) return;
  senseAt = now;
  els.sense.hidden = !settings.awareness;
  if (!settings.awareness) return;
  const chips = state.cameraOn ? awareness.chips() : ['Camera off'];
  const text = chips.join(' · ');
  if (els.senseChips.textContent !== text) els.senseChips.textContent = text;
  els.sense.classList.toggle('busy', !!(chat && chat.busy) || (voice && ['thinking', 'speaking'].includes(voice.state)));
}

let reactAt = -1e9;
function react(text, label) {
  if (!settings.ai.reactions || !voice.on || !host.paired || chat.busy) return;
  const now = performance.now();
  if (now - reactAt < 60000) return;
  reactAt = now;
  chat.ask(text, { voice: true, hidden: true, label });
}

awareness.onEvent = (type, d) => {
  if (type === 'wave') {
    pet.react('happy', 1400);
    if (voice.on) { reactAt = 0; react('(The user just waved at you through the camera. Greet them back in one short line.)', '👋 You waved'); }
    else if (gesturesAllowed()) {
      const [x, y] = d.hand.palm;
      particles.burst(x, y, 18, { kind: 'glow', speed: [80, 260], life: [0.4, 0.8], size: [6, 14], rgb: [[255, 255, 255], [180, 220, 255]], drag: 0.2, grow: 0.2 });
      toast('👋  Hey!');
    }
  } else if (type === 'arrived' && d.count > 1) {
    pet.react('surprised', 1200);
    react(`(Another person just came into view; there are now ${d.count} people. React in one short line.)`, '👥 Someone joined');
  }
};

// ------------------------------------------------------------------ frame loop

let last = performance.now();
const t0 = last;
let lastVideoTime = -1;
let fpsFrames = 0;
let fpsT = last;
let frameNo = 0;
let trackT = 0;
let lastBadge = '';

function autoFrame(dt) {
  let tz = 1, tu = 0.5, tv = 0.5;
  const vw = els.video.videoWidth, vh = els.video.videoHeight;
  if (settings.camera.autoFrame && faces[0] && vw) {
    const sa = W / H, va = vw / vh;
    const kx = sa > va ? 1 : sa / va;
    const ky = sa > va ? va / sa : 1;
    const f = faces[0].uv;
    tz = Math.max(1, Math.min(2.2, (0.3 * kx) / Math.max(f.w, 0.02)));
    tu = f.x;
    tv = f.y + (0.08 * ky) / tz;
  }
  const k = 1 - Math.pow(0.12, dt);
  af.zoom += (tz - af.zoom) * k;
  af.fu += (tu - af.fu) * k;
  af.fv += (tv - af.fv) * k;
  renderer.setView({ mirror: settings.camera.mirror, zoom: af.zoom, fu: af.fu, fv: af.fv });
}

function maskAt(x, y) {
  const m = vision.mask;
  if (!m) return 0;
  const c = renderer.cover;
  const u = (x / W) * c.sx + c.ox;
  const v = (y / H) * c.sy + c.oy;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  return m[Math.floor(v * vision.maskH) * vision.maskW + Math.floor(u * vision.maskW)] / 255;
}

function updateBadge(motionParam) {
  let text = '';
  if (state.freeze) text = 'Frozen';
  else if (motionParam === 'slowmo') text = renderer.replaying ? 'Replay · slow motion' : 'Slow-mo ready';
  else if (motionParam === 'delay') text = renderer.ringFill < 0.97 ? 'Delay · buffering' : 'Delay · 2 seconds';
  else if (motionParam === 'boomerang') text = 'Boomerang';
  else if (motionParam === 'clones') text = 'Clone squad';
  else if (motionParam === 'stopmotion') text = 'Stop motion';
  else if (motionParam === 'freeze') text = 'Frozen';
  if (text !== lastBadge) {
    lastBadge = text;
    els.badge.hidden = !text;
    els.badge.textContent = text;
    updateAction();
  }
}

function track(res, n, t) {
  const big = (x) => x.width || x.size || x.shoulderW || 1;
  faces = n.face ? buildFaces(res.face, mapper) : [];
  faceTracker.assign(faces, t, (f) => f.center, (f) => f.width);
  faceSmoother.apply(faces, t);
  const raw = n.hands ? buildHands(res.hands, mapper) : [];
  hands = raw.filter((h) => plausibleHand(h, faces, W, H));
  handTracker.assign(hands, t, (h) => h.palm, (h) => h.size * 1.6);
  handSmoother.apply(hands, t);
  bodies = n.pose ? buildBodies(res.pose, mapper) : [];
  bodyTracker.assign(bodies, t, (b) => b.center, (b) => big(b));
  bodySmoother.apply(bodies, t);
  // The largest face is the main person: closest to the camera.
  faces.sort((a, b) => b.width - a.width);
  bodies.sort((a, b) => b.shoulderW - a.shoulderW);
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  const t = (now - t0) / 1000;

  fpsFrames++;
  if (now - fpsT > 500) {
    fpsValue = Math.round((fpsFrames * 1000) / (now - fpsT));
    const v = vision.timings;
    if (!els.fps.hidden) els.fps.textContent = `${fpsValue} fps · AI ${(v.seg + v.face + v.hands + v.pose).toFixed(1)} ms`;
    fpsFrames = 0;
    fpsT = now;
  }
  updateSense(false);

  if (!state.cameraOn || els.video.readyState < 2 || !renderer) return;

  autoFrame(dt);
  mapper.set(renderer.cover, W, H);

  let newFrame = false;
  if (els.video.currentTime !== lastVideoTime) {
    lastVideoTime = els.video.currentTime;
    newFrame = true;
    frameNo++;
    renderer.uploadVideo(els.video);
    const skip = settings.quality === 'battery' && frameNo % 2 === 1;
    if (!skip) vision.submit(els.video, needs());
    if (aware()) awareness.sample(els.video, t);
  }

  // Tracking results arrive from the vision worker independently of the
  // display; each one is applied once, on the next display frame. Time-based
  // measurements use the real time between results, not the display frame.
  const res = vision.take();
  if (res) {
    const n = needs();
    const tdt = Math.min(0.2, Math.max(0.001, t - trackT));
    trackT = t;
    track(res, n, t);
    if (n.seg && vision.mask) renderer.uploadMask(vision.mask, vision.maskW, vision.maskH, vision.maskVersion);
    handleGestures(hands, t, tdt);
    bio.update(tdt, t, faces[0] || null, bodies[0] || null, view());
    awareness.update(t, tdt, { faces, hands, bodies, objects: vision.objects, W, H });
    apps.feed(hands, faces);
    pet.watch(faces[0] || null);
  }

  const warpItem = findItem('warp', state.warp);
  let face = null;
  if (warpItem && faces[0]) {
    const f = faces[0];
    const v = warpSmooth.push([
      f.eyeL[0] / W, f.eyeL[1] / H, f.eyeR[0] / W, f.eyeR[1] / H,
      f.mouth[0] / W, f.mouth[1] / H, f.center[0] / W, f.center[1] / H, f.width / 2 / H,
    ]);
    face = { eyes: v.slice(0, 4), mouth: [v[4], v[5]], center: [v[6], v[7]], radius: v[8] };
  } else if (!faces[0]) {
    warpSmooth.reset();
  }

  const bgItem = findItem('bg', state.bg);
  const lookItem = findItem('look', state.look);
  const motionParam = state.freeze ? 'freeze' : state.motion !== 'off' ? state.motion : null;
  const wantMask = bgItem.code > 0 || !!(lookItem.needs && lookItem.needs.includes('seg')) || motionParam === 'clones';
  const autoLight = settings.camera.lowLight || state.enhance === 'autolight';
  const enh = state.enhance ? findItem('enhance', state.enhance).code : 0;
  renderer.render({
    time: t, dt, newFrame,
    look: state.look,
    bg: bgItem.code,
    hasMask: wantMask && vision.ready('seg') && vision.maskVersion > 0,
    warp: warpItem ? warpItem.code : 0,
    face,
    post: state.time,
    motion: motionParam,
    autoLight,
    enhance: enh === 1 ? 0 : enh,
    needMips: bgItem.code === 1 || autoLight,
  });
  updateBadge(motionParam);

  drawOverlay(dt, t, motionParam);
  widgets.update(dt, t, faces[0] || null, { W, H, fps: fpsValue, ai: vision.timings.seg + vision.timings.face + vision.timings.hands, res: `${els.gl.width}×${els.gl.height}` });
  health.update(dt, t, faces[0] || null, bodies[0] || null, els.video);
  stage.frame(faces, hands);
  if (state.mode === 'sign') sign.update(dt, hands);
  cursor.update(hands, t, W, H, dt);
}

function drawOverlay(dt, t, motionParam) {
  const ctx = fxCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, els.fx.width, els.fx.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  particles.update(dt);
  const live = !motionParam || motionParam === 'clones';
  if (state.weather && vision.ready('seg')) weather.frame(ctx, dt, t, W, H, maskAt);
  if (state.mode === 'draw' && !games.active) {
    draw.updateHands(dt, hands, t, { brush: state.brush, anchor: state.anchor, size: state.size });
  }
  draw.render(ctx, t, dt, faces[0] || null, state.mode === 'draw' && !games.active);
  if (games.active) {
    games.frame(ctx, dt, { W, H, t, hands, faces, pointer });
  } else if (live) {
    if (state.overlay !== 'off') faceFx.frame(ctx, dt, faces, state.overlay, t);
    if (state.hand !== 'off') handFx.frame(ctx, dt, hands, state.hand, t);
  }
  if (state.mode === 'health') health.drawOverlay(ctx, mapper);
  particles.draw(ctx);
}

// ------------------------------------------------------------------ sizing

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  els.fx.width = Math.round(W * dpr);
  els.fx.height = Math.round(H * dpr);
  const q = { battery: [1, 1280], balanced: [1.5, 1920], max: [2, 2560] }[settings.quality] || [1.5, 1920];
  let rs = Math.min(window.devicePixelRatio || 1, q[0]);
  if (settings.quality === 'battery') rs *= 0.8;
  if (W * rs > q[1]) rs = q[1] / W;
  if (renderer) renderer.resize(Math.max(2, Math.round(W * rs)), Math.max(2, Math.round(H * rs)));
  handFx.resize(W, H);
  draw.resize(W, H);
  if (stage) stage.relayout();
  measureDock();
}

// ------------------------------------------------------------------ input

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

function toggleUi() {
  const hidden = document.body.classList.toggle('ui-hidden');
  if (hidden) toast('Press H to bring the interface back');
}

function bindUi() {
  els.btnLive.addEventListener('click', () => { sfx.unlock(); toggleCamera(); });
  els.btnWidgets.addEventListener('click', () => togglePicker());
  els.btnPip.addEventListener('click', () => sendHost({ type: 'pip', on: !state.pip }));
  els.btnFull.addEventListener('click', toggleFullscreen);
  els.btnSettings.addEventListener('click', () => sheet.toggle());
  els.btnMenu.addEventListener('click', () => menu.toggle());
  $('btn-reset').addEventListener('click', () => { sfx.unlock(); resetEffects(); });
  els.btnSyrix.addEventListener('click', () => { sfx.unlock(); chat.toggle(); });
  els.btnVoice.addEventListener('click', () => { sfx.unlock(); voice.toggle(); });
  $('chat-mic').addEventListener('click', () => { sfx.unlock(); voice.toggle(); });
  els.sense.addEventListener('click', () => { sfx.unlock(); chat.toggle(true); });
  els.coverAction.addEventListener('click', () => startCamera());
  els.picker.addEventListener('change', (e) => {
    const box = e.target.closest('[data-w]');
    if (!box) return;
    widgets.toggle(box.dataset.w, box.checked);
    requestModels();
  });
  $('welcome-go').addEventListener('click', () => {
    els.welcome.classList.add('leaving');
    setTimeout(() => { els.welcome.hidden = true; els.welcome.classList.remove('leaving'); }, 360);
    settings.firstRun = false;
    saveSettings();
    sfx.unlock();
    wake();
  });

  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, wake, { passive: true });

  window.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.last = performance.now(); });
  window.addEventListener('pointerdown', (e) => {
    sfx.unlock();
    if (!els.picker.hidden && !e.target.closest('#widget-picker, #btn-widgets')) togglePicker(false);
  });
  window.addEventListener('pointerup', () => { pointer.down = false; });

  const opts = () => ({ brush: state.brush, anchor: state.anchor, size: state.size });
  els.fx.addEventListener('pointerdown', (e) => {
    pointer.down = true;
    try { els.fx.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    draw.pointerDown(e.clientX, e.clientY, (performance.now() - t0) / 1000, opts());
  });
  els.fx.addEventListener('pointermove', (e) => {
    if (pointer.down) draw.pointerMove(e.clientX, e.clientY, (performance.now() - t0) / 1000, opts());
  });
  const up = () => { pointer.down = false; draw.pointerUp(); };
  els.fx.addEventListener('pointerup', up);
  els.fx.addEventListener('pointercancel', up);

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', resize);
  new ResizeObserver(measureDock).observe(els.dock);
  document.addEventListener('visibilitychange', () => { if (document.hidden) onHostHidden(); else onHostVisible(); });
  onHost('window', (m) => { if (m.state === 'hidden') onHostHidden(); else onHostVisible(); });
  onHost('pip', (m) => {
    state.pip = !!m.on;
    document.body.classList.toggle('pip', state.pip);
    setTimeout(resize, 50);
  });
  window.addEventListener('keydown', onKey);
}

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); menu.toggle(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && state.mode === 'draw') { e.preventDefault(); draw.undo(); }
    return;
  }
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  const k = e.key;
  if (k === 'Escape') {
    if (menu.open) menu.toggle(false);
    else if (!$('settings').hidden) sheet.toggle(false);
    else if (!els.welcome.hidden) $('welcome-go').click();
    else if (chat.open) chat.toggle(false);
    else if (!els.picker.hidden) togglePicker(false);
    else if (games.active) games.exit();
    else if (health.scanning) health.stopScan();
    else if (state.freeze) toggleFreeze();
    else if (document.body.classList.contains('ui-hidden')) toggleUi();
    if (typing) e.target.blur();
    return;
  }
  if (typing || !$('settings').hidden || !els.welcome.hidden || menu.open) return;
  sfx.unlock();

  if (/^[0-9]$/.test(k)) { const i = k === '0' ? 9 : Number(k) - 1; if (MODES[i]) setMode(MODES[i].id); return; }
  if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); dock.step(k === 'ArrowRight' ? 1 : -1); return; }
  if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); cycleMode(k === 'ArrowDown' ? 1 : -1); return; }
  if (k === 'Enter' && games.waitingToStart) { e.preventDefault(); shutter(); return; }

  switch (k.toLowerCase()) {
    case ' ':
      e.preventDefault();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      dock.fire();
      break;
    case '/': e.preventDefault(); menu.toggle(true); break;
    case 't': e.preventDefault(); chat.toggle(true); break;
    case 'v': voice.toggle(); break;
    case 'w': togglePicker(); break;
    case 's': sheet.toggle(); break;
    case 'l': toggleCamera(); break;
    case 'f': toggleFullscreen(); break;
    case 'h': toggleUi(); break;
    case 'g': settings.effectGestures = !settings.effectGestures; onSetting('effectGestures'); toast(settings.effectGestures ? 'Effect gestures on' : 'Effect gestures off'); break;
    case 'm': settings.sound = !settings.sound; onSetting('sound'); toast(settings.sound ? 'Sound on' : 'Sound off'); break;
    case 'c': if (draw.clear()) toast('Drawing cleared'); break;
    case 'z': if (draw.undo()) toast('Undone'); break;
    case 'r': renderer.resetScan(); renderer.resetPlate(); toast('Restarted'); break;
    case 'p': els.fps.hidden = !els.fps.hidden; break;
    default: break;
  }
}

// ------------------------------------------------------------------ boot

async function boot() {
  intro = new Intro($('intro'));
  intro.progress(8, 'Starting up');
  await loadSettings();
  sfx.enabled = settings.sound;
  sfx.volume = settings.volume;
  applySmoothing();
  vision.setPeople(settings.tracking.people);

  intro.progress(20, 'Starting graphics');
  try {
    renderer = new Renderer(els.gl);
  } catch (err) {
    console.error(err);
    intro.progress(100, 'This PC’s graphics driver does not support WebGL 2, which SYRIX Cam needs.');
    return;
  }

  dock = new Dock({
    onMode: (id) => setMode(id),
    onSelect: (key, id) => { sfx.unlock(); sfx.click(); setValue(key, id); },
    onExtra,
    onAction: (id) => {
      if (id === 'undo') { if (!draw.undo()) toast('Nothing to undo'); }
      else if (id === 'clear') { if (!draw.clear()) toast('Nothing to clear'); }
    },
    onShutter: shutter,
  });
  desktop = new Desktop($('desktop'), sfx);
  cursor = new HandCursor($('hand-cursor'), sfx);
  cursor.configure({ speed: settings.tracking.cursorSpeed, clickMode: settings.tracking.clickMode });
  widgets = new Widgets($('widgets'), settings, saveSettings, sfx, toast, bio);
  widgets.onChange = () => { requestModels(); if (!els.picker.hidden) renderPicker(); };
  sign = new SignReader($('sign-panel'), sfx);
  stage = new Stage($('stage-objects'), { sfx, onChange: () => requestModels() });
  apps = new Apps($('apps'), { sfx, onChange: () => requestModels() });
  const app = {
    snapshot, describe, scene, toolSchemas, runTool, saveSettings, beforeAsk, inspectSkin,
    renderObject: (id) => stage.render(id),
    inspectRegions: Object.keys(INSPECT_REGIONS),
    faceId, scanFace, forgetFace,
    cameras: () => cameras,
    resetAll: () => { resetSettings(); sfx.setEnabled(settings.sound); applySmoothing(); toast('Preferences reset'); },
    onSetting,
    onPaired: () => chat.refresh(),
  };
  pet = new Pet($('pet'), {
    onClick: () => voice.setMuted(!voice.muted),
    onChat: () => chat.toggle(true),
  });
  chat = new SyrixChat(app);
  chat.onToggle = (open) => { requestModels(); if (open) island.answer('', { done: true, chatOpen: true }); };
  // Replies show in the island whenever the chat panel is closed: in voice
  // mode inside the voice bar, otherwise as an answer card.
  chat.onAnswer = (text, opts) => island.answer(text, { ...opts, chatOpen: chat.open });
  chat.onBusy = (on) => { updateSense(true); pet.setBusy(on); };
  chat.onActivity = (kind, name) => pet.activity(kind, name);
  sheet = new SettingsSheet($('settings'), app);
  voice = new VoiceMode({ chat, toast, onState: (s, label, v) => { island.update(s, label, v); pet.setVoice(s, v.muted); syncPet(); els.btnVoice.setAttribute('aria-pressed', String(v.on)); els.btnVoice.dataset.state = s; requestModels(); } });
  voice.onSpeechStart = () => { beforeAsk().catch(() => {}); };
  pet.levels = () => voice.levels();
  syncPet();
  island = new Island(voice, { onOpenChat: () => chat.toggle(true) });
  health = new Health($('health'), { bio, sfx, toast, ask: (q) => chat.ask(q, { photo: true }), view });
  health.onTab = (tab) => setValue('health', tab, { quiet: true });
  health.onReport = () => {
    updateAction();
    if (healthAsked || voice.on || chat.open) {
      healthAsked = false;
      chat.ask('(The 30-second health scan just finished. Give the results in plain words: what is good, anything worth attention and one or two practical tips. Keep the wellness-estimate caveat short.)', { voice: voice.on, hidden: true, label: '❤️ Health scan finished' });
    }
  };
  menu = new Menu($('menu'), { commands, ask: (q) => chat.ask(q) });
  sign.onAsk = () => chat.ask('Look at my hand in the camera. What am I signing? If it is a letter or word in ASL, tell me which one and how confident you are.', { photo: true });
  draw.onColor = (i) => { settings.drawColor = i; saveSettings(); };
  draw.color = settings.drawColor || 0;
  void PALETTE;

  document.body.dataset.mode = state.mode;
  // Development aid: the page opened with ?dev exposes its parts to a debugger.
  if (new URLSearchParams(location.search).has('dev')) window.syrixCam = { island, chat, voice, faceId, vision, settings, host, apps, stage, health, pet, runTool };
  rail = new Rail({ onMode: (id) => { sfx.unlock(); sfx.click(); setMode(id); } });
  rail.setMode(state.mode);
  dock.setMode(state.mode, state);
  bindUi();
  resize();
  updateSense(true);

  intro.progress(42, 'Waking up the camera');
  const ok = await startCamera();
  intro.progress(70, 'Loading vision engine');
  requestModels();
  updateEngineStatus();
  updateAction();

  // Pairing state is re-checked against the stored token.
  gw.isPaired().then((p) => { host.paired = p; chat.refresh(); });

  intro.progress(100, ok ? 'Ready' : 'Camera unavailable');
  measureDock();
  requestAnimationFrame(loop);
  const v = els.video;
  const firstFrame = ok && v.requestVideoFrameCallback ? new Promise((r) => v.requestVideoFrameCallback(() => r())) : null;
  await intro.finish(sfx, firstFrame);
  // Every look's shaders are compiled once the reveal has played, in idle
  // time, so compiling never competes with the intro animation.
  const precompile = () => renderer.precompile(LOOKS.map((l) => l.id));
  if (window.requestIdleCallback) requestIdleCallback(precompile, { timeout: 2500 }); else setTimeout(precompile, 300);
  if (settings.firstRun) {
    els.welcome.hidden = false;
  } else {
    wake(null, 9000);
    if (ok) showHint('Scroll the carousel or swipe your palm to change effects. Press <b>V</b> to talk to Syrix, <b>Ctrl+K</b> to find anything.', 7000);
  }
}

boot();
