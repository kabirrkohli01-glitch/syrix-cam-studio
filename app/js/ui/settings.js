import { settings, host } from '../store.js';
import * as gw from '../syrix/gateway.js';
import { openMic } from '../voice/voice.js';

// Settings sheet, rendered from a declarative description. Each control
// writes to `settings` and notifies the app through `onChange(path)`.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const get = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), settings);
const set = (path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], settings)[last] = value;
};

const SHORTCUTS = [
  ['1 – 0', 'Switch mode'], ['← →', 'Previous / next effect'], ['↑ ↓', 'Previous / next mode'],
  ['Space', 'Shutter action'], ['Ctrl K', 'Search everything'], ['/', 'Search everything'], ['T', 'Syrix chat'], ['V', 'Voice mode'],
  ['W', 'Widgets'], ['L', 'Camera on / off'],
  ['F', 'Full screen'], ['H', 'Hide interface'], ['G', 'Effect gestures on / off'], ['M', 'Sound on / off'],
  ['C', 'Clear drawing'], ['Z', 'Undo drawing'], ['R', 'Restart time warp'], ['P', 'Performance meter'],
  ['S', 'Settings'], ['Esc', 'Close panel or leave game'],
];

export class SettingsSheet {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.section = 'general';
    this.sections = [
      { id: 'general', label: 'General', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
      { id: 'camera', label: 'Camera', icon: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>' },
      { id: 'tracking', label: 'Tracking', icon: '<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>' },
      { id: 'performance', label: 'Performance', icon: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>' },
      { id: 'ai', label: 'Syrix', icon: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>' },
      { id: 'faceid', label: 'Face ID', icon: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 10v1M15 10v1M12 10v3h-1M9.5 16a3.5 3.5 0 0 0 5 0"/>' },
      { id: 'voice', label: 'Voice', icon: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>' },
      { id: 'privacy', label: 'Privacy', icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>' },
      { id: 'shortcuts', label: 'Shortcuts', icon: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>' },
      { id: 'about', label: 'About', icon: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>' },
    ];
    root.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <nav class="sheet-nav">
          <div class="sheet-title">Settings</div>
          ${this.sections.map((s) => `<button class="nav-item" data-sec="${s.id}"><svg viewBox="0 0 24 24" class="ico">${s.icon}</svg><span>${s.label}</span></button>`).join('')}
        </nav>
        <div class="sheet-main">
          <button class="close-btn" data-close title="Close (Esc)"><svg viewBox="0 0 24 24" class="ico"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          <div class="sheet-content scroll-y"></div>
        </div>
      </div>`;
    this.content = root.querySelector('.sheet-content');
    root.addEventListener('click', (e) => {
      if (e.target === root || e.target.closest('[data-close]')) { this.toggle(false); return; }
      const nav = e.target.closest('[data-sec]');
      if (nav) { this.section = nav.dataset.sec; this.render(); }
    });
  }

  get open() { return !this.root.hidden; }

  toggle(open = !this.open, section) {
    if (section) this.section = section;
    if (!open) this.stopTest();
    this.root.hidden = !open;
    if (open) this.render();
  }

  render() {
    this.stopTest();
    for (const b of this.root.querySelectorAll('.nav-item')) b.classList.toggle('on', b.dataset.sec === this.section);
    const c = this.content;
    c.innerHTML = '';
    c.classList.remove('fade');
    void c.offsetWidth;
    c.classList.add('fade');
    const add = (html) => { c.insertAdjacentHTML('beforeend', html); return c.lastElementChild; };
    const title = (t, sub) => add(`<header class="sec-head"><h2>${t}</h2>${sub ? `<p>${sub}</p>` : ''}</header>`);

    switch (this.section) {
      case 'general':
        title('General');
        this.toggleRow(add, 'Sound effects', 'Pops, zaps and game sounds.', 'sound');
        this.slider(add, 'Volume', 'volume', 0, 1, 0.05);
        this.toggleRow(add, 'Effect gestures', '👍 / 👎 change the look, ✌️ changes the scene, a palm swipe changes effect, a held fist freezes. Hand cursor, drawing, sign reading and games keep working when this is off.', 'effectGestures');
        this.toggleRow(add, 'Tips', 'Short hints when you pick an effect.', 'hints');
        this.toggleRow(add, 'Auto-hide controls', 'Fade the interface away when you are not using the mouse.', 'autoHide');
        this.segment(add, 'Hide after', 'autoHideDelay', [[3, '3 s'], [4, '4 s'], [8, '8 s']]);
        break;
      case 'camera': {
        title('Camera');
        const cams = this.app.cameras();
        this.select(add, 'Camera', 'camera.deviceId', [[null, 'Automatic (best available)'], ...cams.map((d, i) => [d.deviceId, d.label || `Camera ${i + 1}`])]);
        this.segment(add, 'Resolution', 'camera.resolution', [['720', 'HD 720p'], ['1080', 'Full HD 1080p']]);
        this.toggleRow(add, 'Mirror view', 'Show the picture like a mirror.', 'camera.mirror');
        this.toggleRow(add, 'Center Stage', 'Automatically zooms and follows your face to keep you framed.', 'camera.autoFrame');
        this.toggleRow(add, 'Low-light boost', 'Brightens dark rooms in every look.', 'camera.lowLight');
        this.slider(add, 'Camera field of view', 'camera.fov', 55, 95, 1);
        add('<p class="note">Used to work out screen distance from your eyes. Most webcams are 65–80°. Tell Syrix how far away you are sitting (for example “I’m 60 cm away, calibrate distance”) to set it exactly.</p>');
        break;
      }
      case 'tracking':
        title('Tracking', 'Which AI models run on this PC and how tracking feels.');
        this.segment(add, 'People to track', 'tracking.people', [[1, 'One'], [2, 'Two'], [3, 'Three']]);
        this.toggleRow(add, 'Face tracking', 'Face effects, expressions, blinks, distance and health.', 'tracking.models.face');
        this.toggleRow(add, 'Hand tracking', 'Gestures, drawing, magic, cursor and games.', 'tracking.models.hands');
        this.toggleRow(add, 'Background cut-out', 'Scenes, blur and weather.', 'tracking.models.seg');
        this.toggleRow(add, 'Body pose', 'Posture, breathing and rep counting.', 'tracking.models.pose');
        this.toggleRow(add, 'Object recognition', 'Lets Syrix notice things like a phone, cup or laptop.', 'tracking.models.objects');
        this.toggleRow(add, 'Awareness bar', 'Shows what Syrix can see at the top of the screen.', 'awareness');
        this.segment(add, 'Smoothing', 'tracking.smoothing', [['responsive', 'Responsive'], ['balanced', 'Balanced'], ['smooth', 'Extra smooth']]);
        this.slider(add, 'Hand cursor speed', 'tracking.cursorSpeed', 0.6, 1.6, 0.05);
        this.segment(add, 'Hand cursor clicks', 'tracking.clickMode', [['pinch', 'Pinch'], ['dwell', 'Hover to click']]);
        break;
      case 'performance':
        title('Performance');
        this.segment(add, 'Quality', 'quality', [['battery', 'Battery saver'], ['balanced', 'Balanced'], ['max', 'Maximum']]);
        add('<p class="note">Battery saver renders at lower resolution and runs tracking every other frame. Maximum renders at full display resolution.</p>');
        break;
      case 'ai': {
        title('Syrix', 'Your SYRIX assistant, built by Kabirr Kohli.');
        const box = add(`<div class="key-box ${host.paired ? 'ok' : ''}">
          <div class="key-state"><span class="dot"></span>${host.paired ? 'Paired with SYRIX. This PC holds an encrypted device token.' : 'Not paired yet'}</div>
          <form class="key-form" ${host.paired ? 'hidden' : ''}><input type="password" placeholder="SYRIX pairing code" autocomplete="off" spellcheck="false"><button class="pill-btn accent" type="submit">Pair</button></form>
          <div class="key-note" data-note></div>
          ${host.paired ? '<div class="key-actions"><button class="pill-btn ghost" data-k="unpair">Unpair this PC</button></div>' : ''}
        </div>`);
        box.querySelector('.key-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const v = box.querySelector('input').value.trim();
          if (!v) return;
          box.querySelector('[data-note]').textContent = 'Pairing…';
          try { await gw.pair(v); this.render(); if (this.app.onPaired) this.app.onPaired(); } catch (err) { box.querySelector('[data-note]').textContent = err.message; }
        });
        box.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-k]');
          if (b && b.dataset.k === 'unpair') { await gw.unpair(); this.render(); if (this.app.onPaired) this.app.onPaired(); }
        });
        this.segment(add, 'Personality', 'ai.style', [['natural', 'Natural'], ['savage', 'Savage'], ['chill', 'Chill'], ['focused', 'Focused']]);
        this.segment(add, 'Answers', 'ai.brain', [['spark', 'Spark · fastest'], ['zenith', 'Zenith · deepest']]);
        this.toggleRow(add, 'Let Syrix see the camera', 'Syrix takes a photo only when a question needs one.', 'ai.snapshots');
        this.toggleRow(add, 'Let Syrix control the app', 'Ask for any effect, game, widget, setting or creation and Syrix does it.', 'ai.control');
        this.toggleRow(add, 'Web search', 'Products, prices, where to buy, news and live facts.', 'ai.webSearch');
        this.toggleRow(add, 'Reactions', 'In voice mode Syrix may say something when someone arrives or waves.', 'ai.reactions');
        this.segment(add, 'Syrix character in voice mode', 'pet.show', [['voice', 'Show'], ['off', 'Hide']]);
        this.memorySection(add);
        add('<p class="note">Sent to SYRIX when you talk to it: your words, a short text summary of what the trackers see and what the app is doing, and a camera photo only when Syrix looks. Video is never streamed and nothing is recorded.</p>');
        break;
      }
      case 'voice': {
        title('Voice', 'Speech recognition and the voice of Syrix run on this PC.');
        const voices = [['atlas', 'Atlas', 'Deep, British'], ['nova', 'Nova', 'Bright, British'], ['echo', 'Echo', 'Smooth, American'], ['aria', 'Aria', 'Warm, American']];
        const v = add(`<div class="voice-pick">${voices.map(([id, n, d]) => `<button class="vp ${settings.voice.voice === id ? 'on' : ''}" data-voice="${id}"><b>${n}</b><span>${d}</span></button>`).join('')}</div>`);
        v.addEventListener('click', (e) => {
          const b = e.target.closest('[data-voice]');
          if (!b) return;
          settings.voice.voice = b.dataset.voice;
          for (const x of v.querySelectorAll('[data-voice]')) x.classList.toggle('on', x === b);
          this.emit('voice.voice');
        });
        this.segment(add, 'Voice engine', 'voice.engine', [['fast', 'Fast'], ['expressive', 'Expressive · slower']]);
        this.micSection(add);
        this.segment(add, 'Wait before replying', 'voice.patience', [['quick', 'Quick'], ['normal', 'Normal'], ['relaxed', 'Relaxed']]);
        this.toggleRow(add, 'Only answer when I say “Syrix”', 'Keeps voice mode quiet while you talk to other people.', 'voice.wake');
        this.toggleRow(add, 'Greeting', 'Syrix says hello when voice mode starts.', 'voice.greeting');
        add('<p class="note">Voice runs on your graphics card and is unloaded as soon as voice mode ends. Fast starts replying within a moment; Expressive can laugh, sigh and sound sarcastic but takes longer to start each reply. Without a suitable graphics card, lighter models run on the processor instead.</p>');
        break;
      }
      case 'faceid': {
        title('Face ID', 'Lets Syrix recognise you, and tell when it is talking to someone else.');
        const f = this.app.faceId;
        const when = settings.faceId.at ? new Date(settings.faceId.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
        const box = add(`<div class="key-box ${f.enrolled ? 'ok' : ''}">
          <div class="key-state"><span class="dot"></span>${f.enrolled ? `Set up for <b>${f.name.replace(/[<>&]/g, '')}</b> on ${when}` : 'Not set up'}</div>
          <div class="faceid-form"><input type="text" maxlength="40" placeholder="Your name" value="${(settings.faceId.name || '').replace(/"/g, '&quot;')}">
          <button class="pill-btn accent" type="button" data-f="scan">${f.enrolled ? 'Scan again' : 'Scan my face'}</button></div>
          ${f.enrolled ? '<div class="key-actions"><button class="pill-btn ghost danger" type="button" data-f="forget">Delete my face data</button></div>' : ''}
        </div>`);
        const input = box.querySelector('input');
        input.addEventListener('change', () => { settings.faceId.name = input.value.trim() || 'Owner'; this.emit('faceId.name'); });
        box.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-f]');
          if (!b) return;
          if (b.dataset.f === 'forget') { this.app.forgetFace(); this.render(); return; }
          settings.faceId.name = input.value.trim() || 'Owner';
          await this.app.scanFace();
        });
        add('<p class="note">The scan takes about ten seconds: look at the camera, then turn your head a little each way when asked. It keeps a face signature (a list of numbers, not a photo) in this PC\'s settings and never sends it anywhere; Syrix is only told whether it is you, someone else, or unclear. You can also ask Syrix to “scan my face”.</p>');
        break;
      }
      case 'privacy': {
        title('Privacy');
        add(`<ul class="privacy-list">
          <li><b>Video stays on this PC.</b> Effects, tracking, health readings, games and voice recognition all run on your computer.</li>
          <li><b>Nothing is recorded.</b> No photos, video, audio or health results are saved. Replays and scan results live in memory only.</li>
          <li><b>One connection.</b> The app can only reach the SYRIX gateway, used when you talk to Syrix: your words, a text summary of the scene and the app, and a photo only when Syrix looks. Web searches Syrix makes go through the same gateway.</li>
          <li><b>Camera and mic off means off.</b> The camera is released when you turn it off or minimise; the microphone is used only while voice mode is on.</li>
          <li><b>Remembered:</b> your preferences, the encrypted SYRIX device token and, if you set up Face ID, your face signature (numbers, not a photo). Face ID runs on this PC and its signature is never sent.</li>
        </ul>`);
        const b = add('<button class="pill-btn ghost danger">Reset all preferences</button>');
        b.addEventListener('click', () => { this.app.resetAll(); this.render(); });
        break;
      }
      case 'shortcuts':
        title('Keyboard shortcuts');
        add(`<dl class="keys">${SHORTCUTS.map(([k, d]) => `<dt>${k.split(' ').map((x) => (x === '–' ? '–' : `<kbd>${x}</kbd>`)).join(' ')}</dt><dd>${d}</dd>`).join('')}</dl>`);
        break;
      default:
        add(`<div class="about">
          <img src="assets/logo-512.png" alt="SYRIX Cam logo">
          <h2>SYRIX Cam</h2>
          <p class="ver">Version ${host.version || '3.0'}</p>
          <p class="credit">Made by <b>Kabirr Kohli</b> · Powered by <b>SYRIX</b></p>
          <p class="note">Open-source licences for the components and on-device models are listed in THIRD_PARTY_NOTICES.txt next to the app.</p>
        </div>`);
    }
  }

  emit(path) { if (this.app.onSetting) this.app.onSetting(path); }

  // Microphone choice with a live level meter. The meter opens the
  // microphone only while "Test" is on and closes it when the page changes.
  micSection(add) {
    const row = add(`<div class="row mic-row"><div class="row-label">Microphone</div>
      <div class="mic-pick"><select class="select" data-mic><option value="">Windows default</option></select>
      <button class="pill-btn ghost" data-test type="button">Test</button></div>
      <div class="mic-meter" hidden><i></i></div></div>`);
    const sel = row.querySelector('[data-mic]');
    const fill = async () => {
      let devs = [];
      try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'); } catch { devs = []; }
      sel.innerHTML = '<option value="">Windows default</option>' + devs.map((d, i) => `<option value="${d.deviceId}">${(d.label || `Microphone ${i + 1}`).replace(/[<>&]/g, '')}</option>`).join('');
      sel.value = settings.voice.micId && devs.some((d) => d.deviceId === settings.voice.micId) ? settings.voice.micId : '';
    };
    fill();
    sel.addEventListener('change', () => { settings.voice.micId = sel.value || null; this.emit('voice.micId'); if (this.test) this.stopTest().then(() => row.querySelector('[data-test]').click()); });
    row.querySelector('[data-test]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (this.test) { await this.stopTest(); btn.textContent = 'Test'; return; }
      btn.textContent = 'Stop';
      const meter = row.querySelector('.mic-meter');
      try {
        const stream = await openMic();
        const ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        const bar = meter.querySelector('i');
        meter.hidden = false;
        this.test = { stream, ctx, raf: 0 };
        const tick = () => {
          if (!this.test || !meter.isConnected) { this.stopTest(); return; }
          an.getFloatTimeDomainData(buf);
          let s = 0;
          for (const v of buf) s += v * v;
          bar.style.width = `${Math.min(100, Math.sqrt(s / buf.length) * 900)}%`;
          this.test.raf = requestAnimationFrame(tick);
        };
        tick();
        fill();
      } catch (err) {
        btn.textContent = 'Test';
        meter.hidden = true;
        row.querySelector('.row-label').textContent = err && err.name === 'NotAllowedError' ? 'Microphone (blocked in Windows privacy settings)' : 'Microphone (could not open)';
      }
    });
    this.toggleRow(add, 'Clean up background noise', 'Filters fans, typing and room noise before Syrix listens.', 'voice.noiseSuppression');
    this.toggleRow(add, 'Even out my volume', 'Raises a quiet voice and tames a loud one.', 'voice.autoGain');
  }

  async stopTest() {
    const t = this.test;
    this.test = null;
    if (!t) return;
    cancelAnimationFrame(t.raf);
    for (const tr of t.stream.getTracks()) tr.stop();
    try { await t.ctx.close(); } catch { /* already closed */ }
  }

  toggleRow(add, label, desc, path) {
    const row = add(`<label class="row"><div><div class="row-label">${label}</div>${desc ? `<div class="row-desc">${desc}</div>` : ''}</div>
      <span class="switch"><input type="checkbox" ${get(path) ? 'checked' : ''}><i></i></span></label>`);
    row.querySelector('input').addEventListener('change', (e) => { set(path, e.target.checked); this.emit(path); });
  }

  segment(add, label, path, options) {
    const cur = get(path);
    const row = add(`<div class="row"><div class="row-label">${label}</div><div class="seg">${options.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div></div>`);
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      const opt = options.find(([v]) => String(v) === b.dataset.v);
      set(path, opt[0]);
      for (const x of row.querySelectorAll('[data-v]')) x.classList.toggle('on', x === b);
      this.emit(path);
    });
  }

  slider(add, label, path, min, max, step) {
    const row = add(`<div class="row"><div class="row-label">${label}</div><input class="range" type="range" min="${min}" max="${max}" step="${step}" value="${get(path)}"></div>`);
    row.querySelector('input').addEventListener('input', (e) => { set(path, Number(e.target.value)); this.emit(path); });
  }

  // Facts Syrix has saved about the user, each removable, plus clear all.
  memorySection(add) {
    const list = settings.memory || [];
    const box = add(`<div class="mem-box"><div class="mem-head"><b>What Syrix remembers</b><span>${list.length ? `${list.length} fact${list.length === 1 ? '' : 's'}, stored only on this PC` : 'Nothing yet. Tell Syrix things about you, or say “remember that…”.'}</span></div>
      ${list.length ? `<ul class="mem-list">${list.map((m, i) => `<li><span>${esc(m.text)}</span><button class="mem-x" data-m="${i}" title="Forget this">×</button></li>`).join('')}</ul><button class="pill-btn ghost" data-m="all">Forget everything</button>` : ''}</div>`);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      if (b.dataset.m === 'all') settings.memory = [];
      else settings.memory.splice(Number(b.dataset.m), 1);
      this.emit('memory');
      this.render();
    });
  }

  select(add, label, path, options) {
    const cur = get(path);
    const row = add(`<div class="row"><div class="row-label">${label}</div><select class="select">${options.map(([v, l]) => `<option value="${v == null ? '' : v}" ${String(v) === String(cur) || (v == null && !cur) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`);
    row.querySelector('select').addEventListener('change', (e) => { set(path, e.target.value || null); this.emit(path); });
  }
}
