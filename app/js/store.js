import { request, send, hasHost } from './bridge.js';

// User preferences. Only settings live here - never images, video or chat.

export const DEFAULTS = {
  firstRun: true,
  sound: true,
  volume: 0.7,
  effectGestures: false,
  hints: true,
  autoHide: true,
  autoHideDelay: 4,
  camera: { deviceId: null, resolution: '1080', mirror: true, autoFrame: false, lowLight: false, fov: 70 },
  tracking: {
    smoothing: 'balanced', cursorSpeed: 1.0, clickMode: 'pinch', people: 2,
    models: { face: true, hands: true, seg: true, pose: true, objects: true },
  },
  quality: 'balanced',
  ai: { brain: 'spark', style: 'natural', snapshots: true, webSearch: true, control: true, reactions: true },
  voice: { voice: 'atlas', wake: false, patience: 'normal', greeting: true, micId: null, noiseSuppression: true, autoGain: true, engine: 'fast' },
  awareness: true,
  // Face ID: the owner's face signatures (numbers only, no image).
  faceId: { name: 'Owner', samples: [], at: null },
  drawColor: 0,
  widgets: {},
  // Short facts about the user that Syrix was told or asked to remember
  // (text only), so it knows them in later chats.
  memory: [],
  // The Syrix character in the island during voice mode: 'voice' or 'off'.
  pet: { show: 'voice' },
};

function merge(base, extra) {
  if (!extra || typeof extra !== 'object') return structuredClone(base);
  const out = Array.isArray(base) ? [] : {};
  for (const k of Object.keys(base)) {
    const b = base[k];
    const e = extra[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && b !== null) out[k] = merge(b, e);
    else out[k] = e === undefined ? b : e;
  }
  for (const k of Object.keys(extra)) if (!(k in out)) out[k] = extra[k];
  return out;
}

export const settings = structuredClone(DEFAULTS);
export const host = { connected: false, paired: false, version: null };

export async function loadSettings() {
  let raw = null;
  if (hasHost) {
    const reply = await request({ type: 'hello' }, 'host');
    if (reply) {
      host.connected = true;
      host.paired = !!reply.paired;
      host.version = reply.version;
      raw = reply.settings;
    }
  } else {
    try { raw = localStorage.getItem('syrixcam.settings'); } catch { raw = null; }
  }
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  Object.assign(settings, merge(DEFAULTS, parsed));
  // One-time move to the adaptive "natural" personality, which replaced
  // "savage" as the default; a later choice of savage is kept.
  // The character used to float in a corner ('always'); it now lives in the
  // island during voice mode.
  if (settings.pet.show === 'always') settings.pet.show = 'voice';
  if (!settings.ai.personaV2) {
    if (settings.ai.style === 'savage') settings.ai.style = 'natural';
    settings.ai.personaV2 = true;
  }
  return settings;
}

let saveTimer = 0;
export function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = JSON.stringify(settings);
    if (hasHost) send({ type: 'settings:save', data });
    else { try { localStorage.setItem('syrixcam.settings', data); } catch { /* storage unavailable */ } }
  }, 300);
}

export function resetSettings() {
  if (hasHost) send({ type: 'settings:reset' });
  else { try { localStorage.removeItem('syrixcam.settings'); } catch { /* storage unavailable */ } }
  Object.assign(settings, structuredClone(DEFAULTS), { firstRun: false });
}
