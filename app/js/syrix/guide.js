import { MODES } from '../catalog.js';
import { WIDGETS } from '../features/widgets.js';

// The feature guide Syrix answers "how do I…" questions from. Item lists are
// generated from the catalog so the guide can never drift from what the app
// offers. Only a short summary rides in every request; the full sections are
// fetched through the app_guide tool, which keeps each request small enough
// for the gateway's free lanes.

const plain = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function modeSection(id) {
  const m = MODES.find((x) => x.id === id);
  if (!m) return '';
  const key = MODES.indexOf(m) + 1;
  const items = m.items.filter((x) => !x.off).map((x) => `${x.name} [${x.id}]${x.hint ? `: ${plain(x.hint)}` : ''}`);
  let out = `${m.label} mode (key ${key % 10}). Effects: ${items.join(' | ')}.`;
  for (const g of m.extras || []) out += `\n${g.title} row: ${g.items.map((x) => `${x.name} [${x.id}]${x.hint ? `: ${plain(x.hint)}` : ''}`).join(' | ')}.`;
  if (m.actions) out += `\nActions: ${m.actions.map((a) => a.name).join(', ')}.`;
  return out;
}

const HOWTO = {
  layout: `Bottom dock: mode tabs, the effect carousel (scroll, drag, mouse wheel or the arrow keys) and the round shutter in the middle (Space). The shutter does what the mode needs: freeze, slow-mo replay, start a game, bring a drawing to life, speak signed text or run a health scan.
Top bar: the island at the top centre shows Live (camera on/off, L) and what Syrix can see. Sidebar: Reset (back to the normal camera: all effects, drawing and Syrix objects cleared), Menu (Ctrl+K or /) to search every feature and setting, Widgets (W), Mini player (small always-on-top window), Full screen (F), Settings (S), the Syrix button (T opens chat) and the mic (V toggles voice mode).
Keys: 1-9 and 0 jump to modes, ↑ ↓ change mode, ← → change effect, H hides the interface, Esc closes panels, P shows the performance meter.`,
  draw: 'Point with your index finger to draw. Two fingers up (peace sign) moves without drawing. Hold an open palm still for a second to wipe everything. Hover over a colour dot at the top to pick it. A mouse or pen works too. Z or Ctrl+Z undo, C clears. The shutter brings the drawing to life with physics. Canvas › Face paint makes strokes stick to your face. Only a steady, clearly pointing hand draws, so stray movement does not scribble.',
  motion: 'Slow-Mo: do something, then press the shutter to replay the last two seconds in slow motion. Freeze holds the picture; press the shutter again for a new one. Delay Mirror shows you two seconds late. Replays live in memory only, nothing is saved.',
  sign: 'Spell: hold an ASL letter steady to type it, an open hand adds a space, the shutter speaks the text. Gesture Talk turns held gestures into phrases.',
  cursor: 'Playground opens a practice desktop (Notes, Calculator, Piano, Paint, 3D Cube). Hands-Free lets your hand drive the whole app in every mode. Move your hand to move the ring. Click: pinch thumb and index finger together and let go quickly; the ring fills as you pinch and flashes when it clicks. Drag or scroll: pinch and hold, move, then let go. Settings › Tracking has cursor speed and a hover-to-click option for when pinching is awkward.',
  games: 'Pick a game in the carousel, then press Start, Space or show a thumbs up. Bubble Pop and Fruit Slice use your hands, Rock Paper Scissors is best of five against Syrix (show your hand when it says shoot), Face Match copies expressions, Meteor Dodge is steered with your head. Esc leaves a game.',
  health: 'Health mode is an on-device wellness scan. Heart: heart rate from tiny colour changes in the forehead and cheeks (dashed boxes on the face, a dot beats at the measured rate). Skin: live close-ups of each area (forehead, under each eye, cheeks, nose, chin); Check my skin reads three frames, sweeps a magnifier over each area on the camera and marks spots; an area hidden by hair, a cap, glasses or a hand shows as Covered and is not measured; tap a tile to zoom in. Eyes: close-ups of both eyes, a blink timeline, blink rate, fatigue and screen distance. Posture: a skeleton drawn over the shoulders and head with tilt and forward-head angles, compared with your best posture this session or your calibration. Press the shutter for a 30-second full scan; sit still, face the camera, use even light. These are estimates, not medical measurements.',
  gestures: 'With Effect gestures on (Settings › General, or G; off by default): thumbs up or down = next or previous look, peace sign = next scene, 🤟 = hearts, open palm swiped left or right = previous or next effect, fist held for a second = freeze or unfreeze, wave at the camera in voice mode = say hi to Syrix. Gestures pause automatically in Draw, Sign and Cursor modes and during games.',
  widgets: `Open with W or the grid button. ${WIDGETS.map((w) => `${w.name} [${w.id}]: ${w.desc}`).join(' | ')}. Widgets can be dragged anywhere and close with their x.`,
  syrix: 'Chat (T or the Syrix button): type, or tap a starting card. The eye button lets Syrix look through the camera when a question needs it. Syrix can search the web and GitHub, change anything in the app, draw (including with your photo, such as a phone wallpaper), build games, 3D scenes and simulations in a window over the camera (playable with your hands or head; drag the title bar to move, the corner to resize), zoom in on your skin, and remember facts about you. Answers have Copy and Try again, and follow-up suggestions. Voice mode (V or the mic): talk hands-free; speech is recognised and spoken on this PC and only the words go to SYRIX. Talk over Syrix to interrupt. In voice mode the Syrix character in the island shows what Syrix is doing; click it to mute, double-click it for the chat. Voice understands and speaks English and Hindi, and Syrix replies in the language you used; talk over it to interrupt or add to your question. Settings › Syrix: pairing, personality, the voice-mode character, what Syrix remembers, app control, web search and camera access.',
  settings: 'General: sound, gestures, tips, auto-hide. Camera: device, resolution, mirror, Center Stage auto-framing, low-light boost. Tracking: smoothing, which AI models run (face, hands, background, body, objects), cursor speed, click style. Performance: quality. Syrix, Privacy, Shortcuts, About.',
  privacy: 'Video never leaves this PC and nothing is recorded or saved. Stored on the PC: preferences, Face ID signatures (numbers, not images) if set up, facts Syrix was asked to remember (Settings › Syrix lists and deletes them) and the encrypted SYRIX device token. Messages to Syrix (the words, plus a camera photo or close-up only when Syrix looks) go to the SYRIX gateway. Apps Syrix builds run sealed off with no internet access.',
};

export const GUIDE_TOPICS = ['layout', ...MODES.map((m) => m.id), 'gestures', 'widgets', 'syrix', 'settings', 'privacy'];

export function guideTopic(topic) {
  const parts = [];
  if (MODES.some((m) => m.id === topic)) parts.push(modeSection(topic));
  if (HOWTO[topic]) parts.push(HOWTO[topic]);
  return parts.join('\n') || `No guide section called "${topic}". Topics: ${GUIDE_TOPICS.join(', ')}.`;
}

export function guideSummary() {
  return `${HOWTO.layout}
Modes: ${MODES.map((m, i) => `${m.label} (${(i + 1) % 10})`).join(', ')}.
Gestures: thumbs up/down change look, peace changes scene, palm swipe changes effect, fist hold freezes. Cursor click = quick pinch.
Call app_guide(topic) for exact steps before explaining a feature you are unsure about.`;
}
