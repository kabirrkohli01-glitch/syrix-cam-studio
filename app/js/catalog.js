// Every mode, its effects and their requirements. `needs` lists the vision
// models an option depends on, so the engine only runs what is in use.

const OFF = (name = 'Off') => ({ id: 'off', name, sw: 'radial-gradient(circle,#2a2622 0 58%,#3a342e 60%)', off: true });

export const LOOKS = [
  { id: 'original', name: 'Original', sw: 'linear-gradient(135deg,#3d3833,#9b958c)' },
  { id: 'cinematic', name: 'Cinematic', sw: 'linear-gradient(135deg,#0f3d47,#d4874a)', hint: 'Teal-and-orange film grade with widescreen bars.' },
  { id: 'neon', name: 'Neon Edges', sw: 'linear-gradient(135deg,#ff2bd6,#7c3aed,#22d3ee)', hint: 'Glowing outlines. Try it with <b>Ghost Trails</b>.' },
  { id: 'thermal', name: 'Thermal', sw: 'linear-gradient(135deg,#120050,#b0008f,#ff4000,#ffd000)', needs: ['seg'], hint: 'You glow hot against a cold room, like a real thermal camera.' },
  { id: 'anime', name: 'Anime', sw: 'linear-gradient(135deg,#ff9ec7,#7dd3fc)' },
  { id: 'comic', name: 'Comic', sw: 'linear-gradient(135deg,#ffd60a,#ef233c 60%,#111)' },
  { id: 'night', name: 'Night Vision', sw: 'radial-gradient(circle,#7dff8a,#0a3d12)' },
  { id: 'matrix', name: 'Matrix', sw: 'linear-gradient(180deg,#00ff66,#003311)', needs: ['seg'] },
  { id: 'dreamy', name: 'Dreamy', sw: 'radial-gradient(circle,#fff1f7,#f9a8d4 50%,#a78bfa)' },
  { id: 'film', name: 'Film 8mm', sw: 'linear-gradient(135deg,#6b4f2a,#e8c58a)' },
  { id: 'aerochrome', name: 'Infrared', sw: 'linear-gradient(135deg,#ff2d6f,#ffb3c6,#2b59c3)' },
  { id: 'pixel', name: 'Arcade', sw: 'conic-gradient(#ff004d 0 25%,#29adff 0 50%,#00e436 0 75%,#ffec27 0)' },
  { id: 'glitch', name: 'Glitch', sw: 'linear-gradient(90deg,#ff0040 0 33%,#00ffd0 0 66%,#3b00ff 0)' },
  { id: 'kaleido', name: 'Kaleidoscope', sw: 'conic-gradient(#f472b6,#a78bfa,#22d3ee,#34d399,#fde047,#f472b6)' },
  { id: 'twin', name: 'Mirror Twin', sw: 'linear-gradient(90deg,#c2410c 50%,#fdba74 50%)', hint: 'Stand in the middle and meet your twin.' },
  { id: 'vhs', name: 'VHS', sw: 'linear-gradient(180deg,#ff6ec7,#7873f5 50%,#4ade80)' },
  { id: 'popart', name: 'Pop Art', sw: 'conic-gradient(#ff3cac 0 25%,#ffe53b 0 50%,#2b86c5 0 75%,#00ff9d 0)' },
  { id: 'xray', name: 'X-Ray', sw: 'radial-gradient(circle,#e0f2ff,#1e3a8a)' },
  { id: 'sketch', name: 'Sketch', sw: 'repeating-linear-gradient(45deg,#f5f0e6 0 3px,#8a8a8a 3px 4px)' },
  { id: 'oil', name: 'Oil Paint', sw: 'linear-gradient(135deg,#f59e0b,#b91c1c,#1e40af)' },
  { id: 'fisheye', name: 'Fisheye', sw: 'radial-gradient(circle,#fff 0 20%,#38bdf8 60%,#0c4a6e)' },
  { id: 'duotone', name: 'Duotone', sw: 'linear-gradient(135deg,#2e026d,#ff4fa3,#ffe5f1)' },
  { id: 'noir', name: 'Noir', sw: 'linear-gradient(135deg,#000,#fff)' },
  { id: 'hex', name: 'Hex Mosaic', sw: 'conic-gradient(from 30deg,#f59e0b,#78350f,#f59e0b)' },
];

export const ENHANCE = [
  { id: 'autolight', code: 1, name: 'Auto Light', hint: 'Brightens dark rooms automatically.' },
  { id: 'softskin', code: 2, name: 'Soft Skin' },
  { id: 'studio', code: 3, name: 'Studio' },
  { id: 'vivid', code: 4, name: 'Vivid' },
];

export const TIME_FX = [
  { id: 'scan-down', name: 'Time Warp ↓', hint: 'A line sweeps down and <b>freezes</b> everything above it. Press <b>R</b> to restart.' },
  { id: 'scan-across', name: 'Time Warp →', hint: 'A line sweeps across and <b>freezes</b> what it passes. Press <b>R</b> to restart.' },
  { id: 'trails', name: 'Ghost Trails', hint: 'Move fast and leave ghost trails behind you.' },
];

export const BACKGROUNDS = [
  { id: 'none', code: 0, name: 'Real World', sw: 'linear-gradient(135deg,#3d3833,#9b958c)' },
  { id: 'blur', code: 1, name: 'Portrait Blur', sw: 'radial-gradient(circle,#e2e8f0 0 30%,#64748b)', needs: ['seg'] },
  { id: 'studio', code: 12, name: 'Studio', sw: 'radial-gradient(circle at 50% 40%,#9a9590,#3a3633)', needs: ['seg'], hint: 'A clean seamless backdrop, made for video calls.' },
  { id: 'colorpop', code: 2, name: 'Colour Pop', sw: 'linear-gradient(90deg,#9ca3af 50%,#f43f5e 50%)', needs: ['seg'], hint: 'You stay in colour while the world goes grey.' },
  { id: 'spotlight', code: 3, name: 'Spotlight', sw: 'radial-gradient(circle,#fff7d6 0 25%,#111 70%)', needs: ['seg'] },
  { id: 'void', code: 13, name: 'Black Void', sw: 'radial-gradient(circle,#222 0 20%,#000 60%)', needs: ['seg'] },
  { id: 'space', code: 4, name: 'Deep Space', sw: 'radial-gradient(circle at 30% 30%,#7c3aed,#0b0420 70%)', needs: ['seg'] },
  { id: 'synthwave', code: 5, name: 'Synthwave', sw: 'linear-gradient(180deg,#1a0033,#ff2a8a 55%,#2b0a4f 56%)', needs: ['seg'] },
  { id: 'beach', code: 10, name: 'Sunset Beach', sw: 'linear-gradient(180deg,#ff8a3d,#ffcf70 45%,#1e6f9f 55%,#f1d7a4 80%)', needs: ['seg'] },
  { id: 'underwater', code: 11, name: 'Underwater', sw: 'radial-gradient(circle at 50% 0,#7dd3fc,#0c4a6e 70%)', needs: ['seg'] },
  { id: 'aurora', code: 6, name: 'Aurora', sw: 'linear-gradient(160deg,#020617,#10b981 55%,#7c3aed)', needs: ['seg'] },
  { id: 'rain', code: 7, name: 'Digital Rain', sw: 'repeating-linear-gradient(90deg,#00ff66 0 2px,#001a0a 2px 6px)', needs: ['seg'] },
  { id: 'invisible', code: 8, name: 'Invisibility', sw: 'radial-gradient(circle,rgba(186,230,253,.4),rgba(14,116,144,.2))', needs: ['seg'], hint: 'Step out of view for a second so the room is captured, then walk back in. You are <b>invisible</b>.' },
  { id: 'hologram', code: 9, name: 'Hologram', sw: 'repeating-linear-gradient(180deg,#67e8f9 0 2px,#0e7490 2px 4px)', needs: ['seg'] },
];

export const WEATHER = [
  { id: 'snow', name: 'Snowfall', needs: ['seg'], hint: 'Snow settles on your head and shoulders. Shake it off!' },
  { id: 'storm', name: 'Rain', needs: ['seg'] },
  { id: 'fireflies', name: 'Fireflies', needs: ['seg'] },
  { id: 'petals', name: 'Blossoms', needs: ['seg'] },
];

export const FACE_OVERLAYS = [
  OFF(),
  { id: 'cyber', name: 'Cyber Scan', sw: 'linear-gradient(135deg,#0e7490,#22d3ee)', needs: ['face'], hint: 'Face tracking HUD with a live expression readout.' },
  { id: 'catears', name: 'Cat', sw: 'radial-gradient(circle at 50% 70%,#fbcfe8 0 25%,#78716c 26%)', needs: ['face'] },
  { id: 'angel', name: 'Angel · Devil', sw: 'linear-gradient(135deg,#fde68a 50%,#dc2626 50%)', needs: ['face'], hint: '<b>Smile</b> for a halo. <b>Frown</b> and the horns come out.' },
  { id: 'neonmask', name: 'Neon Mask', sw: 'linear-gradient(135deg,#ff2bd6,#22d3ee)', needs: ['face'] },
  { id: 'shades', name: 'Cool Shades', sw: 'linear-gradient(180deg,#000 0 60%,#fff 60% 70%,#000 70%)', needs: ['face'] },
  { id: 'crown', name: 'Royal Crown', sw: 'linear-gradient(135deg,#fde68a,#d97706)', needs: ['face'] },
  { id: 'lasers', name: 'Laser Eyes', sw: 'radial-gradient(circle,#fff 0 15%,#ff1f1f 35%,#450a0a)', needs: ['face'], hint: '<b>Raise your eyebrows</b> to fire. Turn your head to aim.' },
  { id: 'fire', name: 'Dragon Breath', sw: 'linear-gradient(0deg,#7f1d1d,#f97316,#fde047)', needs: ['face'], hint: '<b>Open your mouth</b> wide to breathe fire.' },
  { id: 'reactions', name: 'Reactions', sw: 'conic-gradient(#f472b6,#fde047,#4ade80,#60a5fa,#f472b6)', needs: ['face'], hint: '<b>Smile</b> for confetti, <b>pucker</b> for hearts, <b>wink</b> for sparkles, <b>gasp</b> for a surprise.' },
];

export const FACE_WARPS = [
  { id: 'bigeyes', code: 1, name: 'Big Eyes', needs: ['face'] },
  { id: 'bigmouth', code: 2, name: 'Big Mouth', needs: ['face'] },
  { id: 'bighead', code: 3, name: 'Big Head', needs: ['face'] },
  { id: 'tiny', code: 4, name: 'Tiny Face', needs: ['face'] },
  { id: 'swirl', code: 5, name: 'Swirl', needs: ['face'] },
  { id: 'alien', code: 6, name: 'Alien', needs: ['face'] },
];

export const HAND_FX = [
  OFF(),
  { id: 'portal', name: 'Portal', sw: 'radial-gradient(circle,#000 0 40%,#ff9d1c 46%,#7c2d12 60%,#000 70%)', needs: ['hands'], hint: '<b>Draw a circle</b> in the air with your index finger to open a portal. Make a <b>fist</b> to close it.' },
  { id: 'trails', name: 'Magic Trails', sw: 'radial-gradient(circle,#fff,#c084fc 40%,#1e1b4b)', needs: ['hands'], hint: 'Wave your fingers. <b>Pinch</b> for a spark burst.' },
  { id: 'lightning', name: 'Lightning', sw: 'linear-gradient(135deg,#1e1b4b,#93c5fd,#fff)', needs: ['hands'], hint: 'Spread your fingers. Use <b>both hands</b> to arc lightning between them.' },
  { id: 'orb', name: 'Energy Orb', sw: 'radial-gradient(circle,#fff 0 15%,#22d3ee 40%,#1e3a8a)', needs: ['hands'], hint: '<b>Open your palm</b> to charge an orb. Bring <b>both hands</b> together for a giant one.' },
  { id: 'balls', name: 'Force Balls', sw: 'radial-gradient(circle at 35% 35%,#fff7ed,#fb923c 40%,#7c2d12)', needs: ['hands'], hint: 'Bat the glowing balls around with your hands.' },
  { id: 'firehands', name: 'Fire Hands', sw: 'linear-gradient(0deg,#7f1d1d,#f97316,#fde047)', needs: ['hands'] },
  { id: 'ice', name: 'Ice Hands', sw: 'radial-gradient(circle,#fff,#bae6fd 40%,#0369a1)', needs: ['hands'] },
  { id: 'skeleton', name: 'Hand Tracker', sw: 'linear-gradient(135deg,#22d3ee,#f472b6)', needs: ['hands'], hint: 'Shows tracked joints, your gesture and how many fingers are up.' },
];

export const BRUSHES = [
  { id: 'neon', name: 'Neon', sw: 'radial-gradient(circle,#fff 0 12%,#ffa51f 30%,#7c2d12 70%)' },
  { id: 'living', name: 'Living Ink', sw: 'repeating-radial-gradient(circle,#111 0 3px,#f5f0e6 3px 6px)', hint: 'Drawings wiggle like hand-drawn animation.' },
  { id: 'lightpaint', name: 'Light Paint', sw: 'linear-gradient(90deg,transparent,#fff7ed,#ffa51f,transparent)', hint: 'Long-exposure light painting: strokes glow, then fade away.' },
  { id: 'rainbow', name: 'Rainbow', sw: 'conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)' },
  { id: 'glitter', name: 'Glitter', sw: 'radial-gradient(circle,#fff 0 8%,#fcd34d 20%,#b45309 60%)' },
  { id: 'marker', name: 'Marker', sw: 'linear-gradient(135deg,#ef4444,#ef4444)' },
  { id: 'eraser', name: 'Eraser', sw: 'linear-gradient(135deg,#e7e5e4,#a8a29e)' },
];

export const ANCHORS = [
  { id: 'screen', name: 'On screen' },
  { id: 'face', name: 'Face paint', needs: ['face'], hint: 'Strokes stick to your face and move with it.' },
];

export const MOTION = [
  { id: 'off', name: 'Live', sw: 'radial-gradient(circle,#ef4444 0 22%,#2a2622 26%)', off: true },
  { id: 'slowmo', name: 'Slow-Mo Replay', sw: 'linear-gradient(90deg,#0ea5e9,#1e3a8a)', hint: 'Do something, then press the <b>shutter</b> (Space) to replay the last two seconds in slow motion.' },
  { id: 'boomerang', name: 'Boomerang', sw: 'linear-gradient(90deg,#f97316,#fde68a,#f97316)', hint: 'Everything plays forward and back on a loop.' },
  { id: 'delay', name: 'Delay Mirror', sw: 'linear-gradient(135deg,#334155,#94a3b8)', hint: 'Shows you two seconds late. Turn around and check your back.' },
  { id: 'clones', name: 'Clone Squad', sw: 'linear-gradient(90deg,#ffa51f 0 25%,#c2410c 25% 50%,#7c2d12 50% 75%,#431407 75%)', needs: ['seg'], hint: 'Move sideways and leave a line of clones behind you.' },
  { id: 'stopmotion', name: 'Stop Motion', sw: 'repeating-linear-gradient(90deg,#a16207 0 6px,#fde68a 6px 12px)' },
  { id: 'freeze', name: 'Freeze', sw: 'radial-gradient(circle,#e0f2fe,#38bdf8 60%,#0c4a6e)', hint: 'Frozen in time. Press the <b>shutter</b> to take a new one.' },
];

export const SIGN = [
  { id: 'spell', name: 'Spell (ASL)', sw: 'linear-gradient(135deg,#ffa51f,#7c2d12)', needs: ['hands'], hint: 'Hold an ASL letter steady to type it. <b>Open hand</b> adds a space. Shutter speaks it aloud.' },
  { id: 'phrases', name: 'Gesture Talk', sw: 'linear-gradient(135deg,#22d3ee,#1e3a8a)', needs: ['hands'], hint: 'Hold a gesture to say a phrase: 👍 yes · 👎 no · ✋ hello · ✌️ peace · 🤟 I love you · ✊ stop · ☝️ wait.' },
];

export const CURSOR = [
  OFF(),
  { id: 'playground', name: 'Playground', sw: 'linear-gradient(135deg,#1c1917 0 50%,#ffa51f 50%)', needs: ['hands'], hint: 'Point to move the cursor and <b>pinch</b> to click or drag. Open apps and move them around.' },
  { id: 'handsfree', name: 'Hands-Free', sw: 'radial-gradient(circle,#ffa51f 0 18%,#1c1917 20% 40%,#ffa51f 42% 48%,#1c1917 50%)', needs: ['hands'], hint: 'Control the whole app with your hand. Point to move, <b>pinch</b> to click. Stays on in every mode.' },
];

export const GAMES = [
  { id: 'bubbles', name: 'Bubble Pop', sw: 'radial-gradient(circle at 35% 35%,#fff 0 12%,#7dd3fc 30%,#6366f1)', needs: ['hands'] },
  { id: 'ninja', name: 'Fruit Slice', sw: 'linear-gradient(135deg,#ef4444,#f59e0b 50%,#22c55e)', needs: ['hands'] },
  { id: 'rps', name: 'Rock Paper Scissors', sw: 'conic-gradient(#ffa51f 0 33%,#e7e5e4 0 66%,#78716c 0)', needs: ['hands'] },
  { id: 'facematch', name: 'Face Match', sw: 'radial-gradient(circle,#fde047 0 45%,#a16207 46%)', needs: ['face'] },
  { id: 'meteor', name: 'Meteor Dodge', sw: 'radial-gradient(circle at 60% 40%,#fde047,#ea580c 40%,#1c1917)', needs: ['face'] },
];

export const HEALTH = [
  { id: 'overview', name: 'Overview', sw: 'radial-gradient(circle,#ffe4e6 0 18%,#fb7185 40%,#4c0519 75%)', needs: ['face', 'pose'], hint: 'Press the <b>shutter</b> for a 30-second full scan. Sit still and face the camera.' },
  { id: 'heart', name: 'Heart', sw: 'radial-gradient(circle,#fff 0 12%,#f43f5e 38%,#450a0a 75%)', needs: ['face', 'pose'], hint: 'Hold still in bright, even light. The pulse is read from tiny colour changes in your skin.' },
  { id: 'skin', name: 'Skin', sw: 'radial-gradient(circle at 40% 35%,#fde2cf,#d9a07b 55%,#7c4a2d)', needs: ['face'], hint: 'Face a window or lamp for the most accurate skin read.' },
  { id: 'eyes', name: 'Eyes', sw: 'radial-gradient(circle,#0b1020 0 18%,#38bdf8 22% 34%,#e0f2fe 38%,#94a3b8 70%)', needs: ['face'] },
  { id: 'posture', name: 'Posture', sw: 'linear-gradient(180deg,#34d399,#065f46)', needs: ['face', 'pose'], hint: 'Sit so your shoulders are in view. It learns your upright posture first.' },
];

// Modes in display order. `key` is the state field the carousel controls;
// `extras` are secondary option rows shown as pills.
export const MODES = [
  { id: 'looks', label: 'Looks', key: 'look', items: LOOKS, extras: [{ key: 'enhance', title: 'Enhance', items: ENHANCE }, { key: 'time', title: 'Time', items: TIME_FX }] },
  { id: 'scenes', label: 'Scenes', key: 'bg', items: BACKGROUNDS, extras: [{ key: 'weather', title: 'Weather', items: WEATHER }] },
  { id: 'face', label: 'Face', key: 'overlay', items: FACE_OVERLAYS, extras: [{ key: 'warp', title: 'Warp', items: FACE_WARPS }] },
  { id: 'magic', label: 'Magic', key: 'hand', items: HAND_FX },
  {
    id: 'draw', label: 'Draw', key: 'brush', items: BRUSHES,
    extras: [
      { key: 'anchor', title: 'Canvas', items: ANCHORS, required: true },
      { key: 'size', title: 'Size', items: [{ id: 's', name: 'Fine' }, { id: 'm', name: 'Medium' }, { id: 'l', name: 'Bold' }], required: true },
    ],
    actions: [{ id: 'undo', name: 'Undo' }, { id: 'clear', name: 'Clear' }],
  },
  { id: 'motion', label: 'Motion', key: 'motion', items: MOTION },
  { id: 'sign', label: 'Sign', key: 'sign', items: SIGN },
  { id: 'cursor', label: 'Cursor', key: 'cursor', items: CURSOR },
  { id: 'games', label: 'Games', key: 'game', items: GAMES },
  { id: 'health', label: 'Health', key: 'health', items: HEALTH },
];

export const ALL_GROUPS = MODES.flatMap((m) => [{ key: m.key, items: m.items }, ...(m.extras || [])]);

export function findItem(key, id) {
  if (id == null) return null;
  for (const g of ALL_GROUPS) if (g.key === key) return g.items.find((it) => it.id === id) || null;
  return null;
}

export function modeOf(key) {
  return MODES.find((m) => m.key === key || (m.extras || []).some((e) => e.key === key)) || null;
}
