import * as gw from '../syrix/gateway.js';
import { systemPrompt, VOICE_RULES } from '../syrix/persona.js';
import { GUIDE_TOPICS, guideTopic } from '../syrix/guide.js';
import { openExternal } from '../bridge.js';
import { settings, host } from '../store.js';

// Syrix chat. Conversations go to the SYRIX gateway; the only data sent is
// the conversation itself, a summary of what the on-device trackers see and
// the app's state, and a camera photo when Syrix looks or the user asks.

// Starting points on the empty chat, one per kind of thing Syrix can do.
const SUGGESTIONS = [
  { icon: '<path d="M6 12h4M8 10v4M15 11h.01M18 13h.01"/><rect x="2" y="6" width="20" height="12" rx="6"/>', title: 'Build a game', sub: 'Played with your hands', q: 'Make me a game I can play with my hands' },
  { icon: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4"/><path d="M12 2v2M12 20v2"/>', title: '3D solar system', sub: 'Realistic, orbit it', q: 'Make a realistic 3D model of our solar system' },
  { icon: '<rect x="7" y="2" width="10" height="20" rx="3"/><path d="M11 5h2"/>', title: 'Draw an iPhone', sub: 'With my photo as wallpaper', q: 'Draw an iPhone, take my picture now and make it the wallpaper' },
  { icon: '<path d="M12 21s-7-4.4-9.3-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9z"/>', title: 'Check my skin', sub: 'Zooms in area by area', q: 'Look closely at my skin and tell me what you see' },
  { icon: '<path d="M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.8 2.8 5.8 3.1 5.8 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>', title: 'Search GitHub', sub: 'Projects and code', q: 'Find open-source hand tracking projects on GitHub' },
  { icon: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>', title: 'Roast my setup', sub: 'It sees the camera', q: 'Roast my setup' },
];

// Follow-ups offered under the newest answer, by what Syrix just did.
const FOLLOW_UPS = {
  app: ['Make it more detailed', 'Add hand controls', 'Make it look more realistic'],
  art: ['Make it more detailed', 'Animate it', 'Put my photo in it'],
  health: ['What should I do about it?', 'Check again'],
  search: ['Tell me more', 'Open the top result'],
};
const FOLLOW_KIND = { create_app: 'app', update_app: 'app', create_object: 'art', update_object: 'art', inspect_skin: 'health', health: 'health', web_search: 'search', github_search: 'search' };

// Questions that obviously need a photo get one straight away, which saves a
// round trip compared with waiting for Syrix to ask for it.
const NEEDS_PHOTO = /\b(wearing|outfit|t-?shirt|shirt|hoodie|jacket|hat|cap|shoes|trainers|glasses|hair(cut)?|my face|my skin|skin|acne|spots?|holding|hold(ing)? up|what('?s| is) (this|that)|read (this|it|that|the)|colou?r|behind me|my room|brand|logo|label|how do i look|rate (my|me)|do i look|see me|look at me)\b/i;

// Requests for artwork go to the deeper model, which draws far better SVG
// than the fast one; everything else stays on the fast lane. The match needs
// a drawing word: "make a timer" or "create a joke" used to be sent to the
// deep lane and took several times longer for no better answer.
const CREATIVE = /\b(draw|sketch|paint|doodle|illustrat\w*|artwork|logo|icon|svg|wallpaper|mock-?up)\b|\b(build|create|design|make|turn)\b[^.?!\n]{0,40}\b(drawing|picture|image|art|illustration|rocket|robot|spaceship|car|house|tree|animal|character|sticker|mascot|crown|hat|badge|phone|iphone|poster)s?\b/i;
// Interactive builds (games, 3D, simulations) write a whole HTML document,
// several thousand tokens, so they get the deep lane and a large budget.
const BUILD = /\b(game|3d|three\.?js|simulat\w*|solar system|interactive|visuali[sz]\w*|app|website|web page|animat\w*|playable|physics)\b/i;
// A follow-up that edits what was just built ("make it more detailed",
// "add a score") goes to the same lane; on the fast lane its budget would cut
// the rewritten document off half way.
const EDIT = /\b(make|add|change|turn|more|less|bigger|smaller|detail\w*|improve|fix|better|realistic|colou?r|faster|slower|remove|replace|swap|upgrade|again)\b/i;

// Spoken commands that only change the app are confirmed on the spot once
// the change has been made, instead of waiting for a second model round
// just to say "done". Anything that asks for an answer still gets one.
const QUICK_TOOLS = new Set(['set_effects', 'open', 'start_game', 'toggle_widget', 'set_timer', 'app_setting', 'tracking_models', 'camera_action', 'drawing', 'remove_object', 'close_app', 'open_link', 'remember', 'forget']);
const BUILD_TOOLS = { create_app: 'app', update_app: 'app', create_object: 'art', update_object: 'art' };
const NEEDS_ANSWER = /\?|\b(tell|what|why|how|who|when|where|which|joke|explain|story|think|roast|rate|describe|say|then|also)\b/i;
const CONFIRM = { natural: ['Done.', 'There you go.', 'Sorted.', 'Got it.'], savage: ['Done.', 'Sorted.', 'Easy.', 'There you go.'], chill: ['Done.', 'All set.', 'There you go.'], focused: ['Done.'] };

const MAX_ROUNDS = 6;
const KEEP_MESSAGES = 24;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Small, safe Markdown subset: escape first, then insert tags. The order is
// what keeps model output from injecting markup.
export function markdown(src) {
  const lines = esc(src).split('\n');
  const out = [];
  let list = null;
  const inline = (t) => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-ext>$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" data-ext>$2</a>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const ordered = /^\s*\d/.test(line);
      if (!list || list.ordered !== ordered) {
        if (list) out.push(list.ordered ? '</ol>' : '</ul>');
        list = { ordered };
        out.push(ordered ? '<ol>' : '<ul>');
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (list) { out.push(list.ordered ? '</ol>' : '</ul>'); list = null; }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) out.push(`<h4>${inline(h[1])}</h4>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(list.ordered ? '</ol>' : '</ul>');
  return out.join('');
}

// Some lanes narrate their plan before answering ("We need to answer the
// user..."). Leading paragraphs that are plainly narration are dropped; if
// every paragraph looks like narration the text is returned untouched, since
// an empty bubble is worse than a wordy one.
const NARRATION = /^(we need to|we should|the user (is|wants|asks|said|just)|let'?s (craft|answer|respond|write)|i need to (answer|respond|reply)|i should (answer|respond)|okay,? so the user)/i;
export function stripNarration(text) {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^<think>[\s\S]*$/i, '');
  const paras = t.split(/\n{2,}/);
  let i = 0;
  while (i < paras.length - 1 && NARRATION.test(paras[i].trim())) i++;
  t = paras.slice(i).join('\n\n');
  return t.trim() ? t : text;
}

// Markdown that is still streaming can end half way through a link, a bold
// run or a code span. The unfinished tail is held back until it is complete,
// so a raw "](http" or a stray "**" never flashes on screen.
function streamGuard(t) {
  let s = t;
  s = s.replace(/\[[^\]\n]*$/, '');
  s = s.replace(/\[([^\]\n]*)\]\([^)\n]*$/, '$1');
  if ((s.match(/\*\*/g) || []).length % 2) s = s.replace(/\*\*(?!.*\*\*)/, '');
  if ((s.match(/`/g) || []).length % 2) s = s.replace(/`(?!.*`)/, '');
  return s;
}

// Puts the streaming caret at the end of the last line of text.
function withCaret(html) {
  const m = html.match(/<\/(p|li|h4)>(<\/(ul|ol)>)?$/);
  if (!m) return `${html}<span class="caret"></span>`;
  const at = html.length - m[0].length;
  return `${html.slice(0, at)}<span class="caret"></span>${html.slice(at)}`;
}

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export class SyrixChat {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('chat');
    this.log = document.getElementById('chat-log');
    this.form = document.getElementById('chat-form');
    this.input = document.getElementById('chat-input');
    this.eye = document.getElementById('chat-eye');
    this.mic = document.getElementById('chat-mic');
    this.setup = document.getElementById('chat-setup');
    this.suggest = document.getElementById('chat-suggest');
    this.sub = document.getElementById('chat-sub');
    this.empty = document.getElementById('chat-empty');
    this.history = [];
    this.busy = false;
    this.abort = null;
    this.speech = null;
    this.onBusy = null;
    this.onToggle = null;

    this.suggest.innerHTML = SUGGESTIONS.map((s) => `<button class="chat-card" data-s="${esc(s.q)}"><span class="chat-card-ico"><svg viewBox="0 0 24 24" class="ico">${s.icon}</svg></span><b>${esc(s.title)}</b><span>${esc(s.sub)}</span></button>`).join('');
    this.greet = this.empty.querySelector('h3');
    this.suggest.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]');
      if (b) this.ask(b.dataset.s);
    });
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.busy) { this.stop(); return; }
      this.ask(this.input.value);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.form.requestSubmit(); }
      e.stopPropagation();
    });
    this.input.addEventListener('input', () => this.autosize());
    this.eye.addEventListener('click', () => {
      settings.ai.snapshots = !settings.ai.snapshots;
      this.app.saveSettings();
      this.syncEye();
    });
    document.getElementById('chat-close').addEventListener('click', () => this.toggle(false));
    document.getElementById('chat-new').addEventListener('click', () => this.reset());
    this.log.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-ext]');
      if (a) { e.preventDefault(); openExternal(a.href); return; }
      const f = e.target.closest('[data-follow]');
      if (f) { this.ask(f.dataset.follow); return; }
      const t = e.target.closest('[data-tool]');
      if (!t) return;
      const row = t.closest('.msg');
      if (t.dataset.tool === 'copy') {
        const text = row.querySelector('.md').innerText.trim();
        navigator.clipboard.writeText(text).then(() => { t.classList.add('done'); t.title = 'Copied'; setTimeout(() => t.classList.remove('done'), 1400); }, () => {});
      } else if (t.dataset.tool === 'retry') this.retry(row);
    });
    this.setup.addEventListener('submit', (e) => { e.preventDefault(); this.pairFromForm(); });
    this.syncEye();
    this.refresh();
  }

  get open() { return !this.el.hidden && this.el.classList.contains('show'); }

  toggle(open = !this.open) {
    if (open === this.open) return;
    if (open) {
      this.el.hidden = false;
      requestAnimationFrame(() => this.el.classList.add('show'));
      this.refresh();
      setTimeout(() => (host.paired ? this.input : this.setup.querySelector('input')).focus({ preventScroll: true }), 220);
    } else {
      this.el.classList.remove('show');
      setTimeout(() => { if (!this.el.classList.contains('show')) this.el.hidden = true; }, 380);
    }
    document.body.classList.toggle('chat-open', open);
    if (this.onToggle) this.onToggle(open);
  }

  refresh() {
    const paired = !!host.paired;
    this.setup.hidden = paired;
    this.form.hidden = !paired;
    const empty = paired && !this.busy && this.history.length === 0 && !this.log.children.length;
    this.el.classList.toggle('is-empty', empty);
    this.empty.hidden = !empty;
    if (empty && this.greet) {
      const h = new Date().getHours();
      const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      const name = (settings.faceId.samples || []).length >= 8 && settings.faceId.name ? `, ${settings.faceId.name}` : '';
      this.greet.textContent = `${part}${name}. What are we making?`;
    }
    this.sub.textContent = !paired ? 'Not paired yet' : this.busy ? 'Thinking…' : settings.ai.snapshots ? 'Can see your camera when it needs to' : 'Camera access off';
  }

  syncEye() {
    this.eye.setAttribute('aria-pressed', String(settings.ai.snapshots));
    this.eye.title = settings.ai.snapshots ? 'Syrix can look through the camera (click to block)' : 'Syrix can’t see the camera (click to allow)';
    this.refresh();
  }

  autosize() {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(140, this.input.scrollHeight)}px`;
  }

  async pairFromForm() {
    const field = this.setup.querySelector('input');
    const note = this.setup.querySelector('[data-note]');
    const code = field.value.trim();
    if (!code) return;
    note.textContent = 'Pairing…';
    try {
      await gw.pair(code);
      field.value = '';
      note.textContent = '';
      this.refresh();
      this.input.focus();
    } catch (err) {
      note.textContent = err.message || 'Pairing failed.';
    }
  }

  reset() {
    this.stop();
    this.history = [];
    this.lastBuild = null;
    this.log.innerHTML = '';
    this.refresh();
    if (this.open) this.input.focus();
  }

  // Withdraws the last exchange, from view and from the history (used when
  // voice merges an utterance split by a pause into one request).
  retract(text) {
    const rows = [...this.log.querySelectorAll('.msg')];
    const lastUser = rows.map((r) => r.classList.contains('user')).lastIndexOf(true);
    if (lastUser >= 0) for (const r of rows.slice(lastUser)) r.remove();
    if (text) {
      const at = this.history.map((m) => m.role === 'user' && m.content === text).lastIndexOf(true);
      if (at >= 0) this.history.length = at;
    }
  }

  retry(row) {
    const answers = [...this.log.querySelectorAll('.msg.assistant')];
    if (this.busy || row !== answers[answers.length - 1] || !row.dataset.ask) return;
    const text = row.dataset.ask;
    // The question and everything after it leave the history; the question
    // is then asked again as a new turn.
    const at = this.history.map((m) => (m.role === 'user' && m.content === text)).lastIndexOf(true);
    if (at >= 0) this.history.length = at;
    let prev = row.previousElementSibling;
    while (prev && !prev.classList.contains('user')) prev = prev.previousElementSibling;
    row.remove();
    if (prev) prev.remove();
    this.ask(text);
  }

  // interrupted: the user talked over a voice reply. The question (and what
  // was already said) then stays in the history, so the next thing they say
  // is understood as adding to it rather than replacing it.
  stop({ interrupted = false } = {}) {
    if (interrupted && this.busy) this.interrupted = true;
    if (this.abort) this.abort.abort();
    if (this.speech) this.speech.cancel();
  }

  // ---------------------------------------------------------------- tools

  tools() {
    const t = [
      fn('app_guide', 'Exact steps for using a SYRIX Cam feature. Call before explaining how to do something you are not certain about.',
        { topic: { type: 'string', enum: GUIDE_TOPICS } }, ['topic']),
    ];
    if (settings.ai.snapshots) {
      t.push(fn('look', 'Take a photo with the camera right now and look at it. Use for clothes, objects, text, colours, the room, skin, or anything the scene summary cannot answer.',
        { focus: { type: 'string', description: 'What to pay attention to.' } }));
      t.push(fn('inspect_skin', 'Zoom in on one area of the face at full camera resolution and look at it: a close-up photo is attached, the area is highlighted on screen, and the result says if it is covered (hair, a cap, glasses, a hand). Use for skin, spots, acne, redness, dark circles, eyes, or "look at my forehead". One call per area.',
        { region: { type: 'string', enum: this.app.inspectRegions } }, ['region']));
    }
    if (settings.ai.webSearch) {
      t.push(fn('web_search', 'Search the web for current information: products and prices, where to buy, news, facts that change.',
        { query: { type: 'string' }, freshness: { type: 'string', enum: ['day', 'week', 'month', 'any'] } }, ['query']));
      t.push(fn('read_page', 'Open a web page and read its text (a GitHub repository page returns its README).', { url: { type: 'string' } }, ['url']));
      t.push(fn('github_search', 'Find repositories, projects, libraries or code on GitHub. Returns repository pages with descriptions; read_page a result for its README.',
        { query: { type: 'string', description: 'What to look for, e.g. "hand tracking webcam game javascript".' } }, ['query']));
    }
    t.push(fn('open_link', 'Open a web page in the user\'s browser, only when they ask to open or go to a site or a result.', { url: { type: 'string' } }, ['url']));
    t.push(fn('remember', 'Save a lasting fact about the user so you know it in future chats: their name, preferences, goals, routines, things they asked you to remember. One short fact per call, in the third person ("Prefers dark mode"). Stored only on this PC.',
      { fact: { type: 'string' } }, ['fact']));
    t.push(fn('forget', 'Delete a remembered fact (matching text) or "all" of them.', { fact: { type: 'string' } }, ['fact']));
    if (settings.ai.control) {
      t.push(fn('view_object', 'Render one of your drawings and look at it, to check it is accurate and polished before saying it is done, or when the user asks you to improve it. id "last" for the newest.',
        { id: { type: 'string' } }, ['id']));
    }
    if (settings.ai.control) {
      for (const s of this.app.toolSchemas()) t.push(fn(s.name, s.description, s.parameters.properties, s.parameters.required || []));
    }
    return t;
  }

  async runTool(call, ctx) {
    const a = call.args || {};
    switch (call.name) {
      case 'app_guide':
        ctx.status('Checking the guide', 'Checked the guide');
        return guideTopic(a.topic);
      case 'look': {
        ctx.status('Looking through the camera', 'Looked through the camera');
        const snap = await this.app.snapshot();
        if (!snap) return 'The camera is off, so there is nothing to look at. Tell the user that and do not describe anything from earlier.';
        ctx.media = [{ mime: 'image/jpeg', data: snap.base64 }];
        ctx.photo = snap.dataUrl;
        return 'Photo taken. It is attached to the next message.';
      }
      case 'inspect_skin': {
        const where = String(a.region || 'forehead').replace(/_/g, ' ');
        ctx.status(`Zooming in on the ${where}`, `Looked closely at the ${where}`);
        const r = await this.app.inspectSkin(String(a.region || 'forehead'));
        if (!r.ok) return r.message;
        // Several areas in one round travel together.
        ctx.media = [...(ctx.media || []), { mime: 'image/jpeg', data: r.base64 }];
        ctx.photo = r.dataUrl;
        return r.message;
      }
      case 'web_search': {
        ctx.status(`Searching “${String(a.query || '').slice(0, 40)}”`, `Searched “${String(a.query || '').slice(0, 40)}”`);
        const results = await gw.search(String(a.query || ''), a.freshness === 'any' ? undefined : a.freshness);
        for (const r of results) if (r.url) ctx.sources.set(r.url, r.title || r.domain || new URL(r.url).hostname);
        return JSON.stringify(results.slice(0, 6).map((r) => ({
          title: r.title, url: r.url, date: r.dateNote, text: (r.text || r.snippet || '').slice(0, 900),
        })));
      }
      case 'github_search': {
        const q = String(a.query || '').slice(0, 120);
        ctx.status(`Searching GitHub for “${q.slice(0, 40)}”`, `Searched GitHub for “${q.slice(0, 40)}”`);
        const results = (await gw.search(`site:github.com ${q}`)).filter((r) => /^https:\/\/github\.com\//.test(r.url || ''));
        for (const r of results) ctx.sources.set(r.url, r.title || 'GitHub');
        if (!results.length) return 'No GitHub results. Try different words.';
        return JSON.stringify(results.slice(0, 8).map((r) => ({ title: r.title, url: r.url, text: (r.text || r.snippet || '').slice(0, 500) })));
      }
      case 'open_link': {
        let u;
        try { u = new URL(String(a.url || '')); } catch { return 'That is not a valid link.'; }
        if (!/^https?:$/.test(u.protocol)) return 'Only web links can be opened.';
        openExternal(u.href);
        ctx.status(`Opening ${u.hostname}`, null);
        ctx.actions.push(`Opened ${u.hostname}`);
        return `Opened ${u.href} in the browser.`;
      }
      case 'remember': {
        const fact = String(a.fact || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!fact) return 'Nothing to remember.';
        const list = settings.memory || (settings.memory = []);
        if (!list.some((m) => m.text.toLowerCase() === fact.toLowerCase())) list.push({ text: fact, at: Date.now() });
        while (list.length > 60) list.shift();
        this.app.saveSettings();
        ctx.actions.push('Remembered');
        return `Remembered: ${fact}`;
      }
      case 'forget': {
        const list = settings.memory || [];
        const q = String(a.fact || '').toLowerCase().trim();
        const before = list.length;
        settings.memory = q === 'all' ? [] : list.filter((m) => !m.text.toLowerCase().includes(q));
        this.app.saveSettings();
        const n = before - settings.memory.length;
        if (n) ctx.actions.push(`Forgot ${n}`);
        return n ? `Forgot ${n} fact${n === 1 ? '' : 's'}.` : 'Nothing matched.';
      }
      case 'view_object': {
        ctx.status('Checking the drawing', 'Checked the drawing');
        const img = await this.app.renderObject(a.id || 'last');
        if (!img) return 'There is no drawing with that id.';
        ctx.media = [...(ctx.media || []), { mime: 'image/jpeg', data: img.base64 }];
        return 'The rendered drawing is attached. Compare it with what was asked: proportions, recognisable parts, detail, polish. If anything is off, fix it with update_object (send a complete new svg); otherwise say it is done.';
      }
      case 'read_page': {
        let site = 'the page';
        try { site = new URL(a.url).hostname; } catch { /* reported by the gateway */ }
        ctx.status(`Reading ${site}`, `Read ${site}`);
        const page = await gw.readPage(String(a.url || ''));
        if (page.url) ctx.sources.set(page.url, page.title || site);
        return JSON.stringify({ title: page.title, url: page.url, text: (page.text || '').slice(0, 3500) });
      }
      default: {
        ctx.status('Changing the app', null);
        const r = await this.app.runTool(call.name, a);
        if (r.ok) ctx.actions.push(r.message); else ctx.failed = true;
        return r.message;
      }
    }
  }

  // ---------------------------------------------------------------- messages

  bubble(role, html, extraClass = '') {
    const row = document.createElement('div');
    row.className = `msg ${role} ${extraClass}`;
    if (role === 'assistant') row.innerHTML = '<span class="msg-avatar-wrap"><img class="msg-avatar" src="assets/syrix-logo-256.png" alt=""></span><div class="msg-body"></div>';
    else row.innerHTML = '<div class="msg-body"></div>';
    row.querySelector('.msg-body').innerHTML = html;
    this.log.append(row);
    this.el.classList.remove('is-empty');
    this.empty.hidden = true;
    this.scroll();
    return row;
  }

  scroll() {
    this.log.scrollTo({ top: this.log.scrollHeight, behavior: 'smooth' });
  }

  // Older tool output is squeezed hard; the free lanes count prompt and
  // answer against one budget, and a long history starves the answer.
  compact() {
    let list = this.history.slice(-KEEP_MESSAGES);
    // A trimmed history must still open on a user turn; a tool result whose
    // call was cut off is rejected by the model lanes.
    const first = list.findIndex((m) => m.role === 'user');
    list = first > 0 ? list.slice(first) : list;
    const lastTool = list.map((m) => m.role).lastIndexOf('tool');
    // Only the newest version of an app or drawing travels in full (Syrix
    // edits from it); earlier versions are thousands of tokens each and would
    // crowd out the answer.
    const isBuild = (m) => m.role === 'assistant' && m.tool_calls && m.tool_calls.some((c) => BUILD_TOOLS[c.name]);
    const lastBuild = list.map(isBuild).lastIndexOf(true);
    return list.map((m, i) => {
      if (isBuild(m) && i !== lastBuild) {
        return { ...m, tool_calls: m.tool_calls.map((c) => (BUILD_TOOLS[c.name] ? { ...c, args: { ...c.args, ...(c.args.html ? { html: '(earlier version omitted)' } : {}), ...(c.args.svg ? { svg: '(earlier version omitted)' } : {}) } } : c)) };
      }
      if (m.role !== 'tool') return m;
      const cap = i === lastTool ? 4000 : 1200;
      return m.content.length > cap ? { ...m, content: `${m.content.slice(0, cap)}…` } : m;
    });
  }

  // Asks Syrix something. Options: voice (spoken reply), hidden (no user
  // bubble: used for events such as a finished health scan), photo (force a
  // camera photo).
  async ask(raw, opts = {}) {
    const text = (raw || '').trim();
    if (!text) return;
    if (this.busy) { this.stop(); await this.idle(); }
    // Voice merges an utterance that a pause split in two: the first half is
    // withdrawn once its request has fully stopped.
    if (opts.replace) this.retract(opts.replace);
    if (!host.paired) {
      this.toggle(true);
      this.refresh();
      return;
    }
    if (!opts.voice && !opts.hidden && !this.open) this.toggle(true);
    this.input.value = '';
    this.autosize();

    const wantPhoto = settings.ai.snapshots && (opts.photo || NEEDS_PHOTO.test(text));
    const snap = wantPhoto ? await this.app.snapshot() : null;
    if (opts.hidden) {
      this.bubble('event', `<p>${esc(opts.label || text)}</p>`);
    } else {
      this.bubble('user', `${snap ? `<img class="msg-snap" src="${snap.dataUrl}" alt="Camera photo">` : ''}<p>${esc(text)}</p>`, opts.voice ? 'spoken' : '');
    }
    this.history.push({ role: 'user', content: text });
    this.reportLabel = opts.hidden ? (opts.label || '') : '';
    if (this.app.beforeAsk) await this.app.beforeAsk();
    const recent = this.lastBuild && this.history.length - this.lastBuild.at <= 10 ? this.lastBuild.kind : null;
    const build = BUILD.test(text) || (recent === 'app' && EDIT.test(text));
    const creative = build || CREATIVE.test(text) || (recent === 'art' && EDIT.test(text));
    await this.run({ text, voice: !!opts.voice, lang: opts.lang, creative, build, media: snap ? [{ mime: 'image/jpeg', data: snap.base64 }] : null });
  }

  idle() {
    return new Promise((resolve) => {
      const check = () => (this.busy ? setTimeout(check, 30) : resolve());
      check();
    });
  }

  setBusy(on) {
    this.busy = on;
    document.body.classList.toggle('syrix-busy', on);
    this.form.classList.toggle('busy', on);
    this.refresh();
    if (this.onBusy) this.onBusy(on);
  }

  async run({ text: asked = '', voice, lang, creative, build, media }) {
    this.setBusy(true);
    this.interrupted = false;
    for (const old of this.log.querySelectorAll('.msg-follow')) old.remove();
    const row = this.bubble('assistant', '<div class="think"><span class="think-label"></span></div><details class="msg-trace" hidden><summary></summary><ol></ol></details><div class="md"></div>', 'pending');
    // Event-driven turns (a finished scan) have no question to retry.
    row.dataset.ask = this.reportLabel ? '' : asked;
    const used = new Set();
    const md = row.querySelector('.md');
    const status = row.querySelector('.think');
    const label = row.querySelector('.think-label');
    // One shimmering line names the step Syrix is on; a new label slides in
    // when the step changes.
    const say = (text) => {
      status.hidden = false;
      if (label.textContent === text) return;
      label.classList.remove('in');
      void label.offsetWidth;
      label.textContent = text;
      label.classList.add('in');
    };
    say(media ? 'Looking at the photo' : build ? 'Designing it' : creative ? 'Sketching it out' : 'Thinking');
    const report = (text, done) => { if (this.onAnswer) this.onAnswer(text, { done, label: this.reportLabel }); };
    report('', false);
    const steps = [];
    const ctx = {
      media,
      photo: null,
      sources: new Map(),
      actions: [],
      failed: false,
      // done: how the step reads once finished, or null to leave it out of
      // the trace (app changes are listed as chips instead).
      status: (text, done) => { say(text); if (done) steps.push(done); },
    };
    const startLen = this.history.length;
    const abort = new AbortController();
    this.abort = abort;
    let shown = '';
    const speech = voice && this.speech ? this.speech : null;
    if (speech) speech.begin();

    const system = systemPrompt({
      style: settings.ai.style,
      canSee: settings.ai.snapshots,
      canControl: settings.ai.control,
      canSearch: settings.ai.webSearch,
      memory: settings.memory || [],
    }) + (voice ? `\n\n${VOICE_RULES}` : '');

    let emptyRetry = false;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const messages = [{ role: 'system', content: system }, ...this.compact()];
        // Live context rides on the newest user message only, so it is always
        // current and never piles up in the history.
        const lastUser = messages.map((m) => m.role).lastIndexOf('user');
        if (lastUser >= 0) {
          const ctxText = `\n\n<scene>\n${this.app.scene()}\n</scene>\n<app>\n${this.app.describe()}\n</app>${ctx.media ? '\n(A camera photo taken just now is attached. The picture is not mirrored.)' : ''}`;
          messages[lastUser] = { ...messages[lastUser], content: messages[lastUser].content + ctxText };
        }
        let text = '';
        const calls = [];
        const payload = {
          mode: creative ? 'zenith' : voice ? 'spark' : settings.ai.brain,
          messages,
          tools: this.tools(),
          temperature: settings.ai.style === 'savage' ? 0.8 : settings.ai.style === 'focused' ? 0.4 : 0.65,
          // Reasoning lanes spend part of the budget thinking before they
          // write; a tight voice budget (320) could be used up entirely and
          // leave Syrix with nothing to say. The spoken reply stays short
          // because of the voice rules, not the cap.
          maxTokens: (build ? 8000 : creative ? 5000 : voice ? 1000 : 1200) * (emptyRetry ? 2 : 1),
        };
        if (ctx.media) payload.media = ctx.media;
        ctx.media = null;

        for await (const ev of gw.chat(payload, abort.signal)) {
          if (ev.type === 'token') {
            text += ev.text;
            const clean = stripNarration(text);
            if (clean.trim()) {
              status.hidden = true;
              row.classList.remove('pending');
              row.classList.add('streaming');
              md.innerHTML = withCaret(markdown(streamGuard(shown + clean)));
              report(shown + clean, false);
              if (speech) speech.push(clean);
              this.scroll();
            }
          } else if (ev.type === 'tool_call') {
            calls.push({ id: ev.id || `call_${calls.length}`, name: ev.name, args: ev.args || {} });
          } else if (ev.type === 'error') {
            throw new gw.GatewayError(502, 'stream', ev.message);
          }
        }

        const clean = stripNarration(text).trim();
        // An empty reply (the lane ran out of budget while thinking) is asked
        // again once with twice the budget instead of ending in silence.
        if (!clean && !calls.length && !emptyRetry) { emptyRetry = true; round--; continue; }
        if (!calls.length) {
          this.history.push({ role: 'assistant', content: clean });
          shown += clean;
          break;
        }
        this.history.push({ role: 'assistant', content: clean, tool_calls: calls });
        if (clean) shown += `${clean}\n\n`;
        for (const call of calls) {
          if (speech && speech.tool) speech.tool(call.name);
          if (this.onActivity) this.onActivity('tool', call.name);
          used.add(call.name);
          if (BUILD_TOOLS[call.name]) this.lastBuild = { kind: BUILD_TOOLS[call.name], at: this.history.length };
          if (call.name === 'create_app' || call.name === 'update_app') say('Building the app');
          else if (call.name === 'create_object' || call.name === 'update_object') say('Drawing');
          let result;
          try {
            result = await this.runTool(call, ctx);
          } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            result = `That failed: ${err.message || err}`;
          }
          this.history.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: String(result) });
        }
        if (voice && round === 0 && !clean && !ctx.media && !ctx.failed && ctx.actions.length
          && calls.every((c) => QUICK_TOOLS.has(c.name)) && !NEEDS_ANSWER.test(asked)) {
          const words = lang === 'hi' ? ['हो गया।', 'ठीक है, हो गया।'] : CONFIRM[settings.ai.style] || CONFIRM.natural;
          // "Set scene: Deep Space, weather: Snowfall" is read as "Deep Space and Snowfall".
          const parts = ctx.actions.map((m) => (m.startsWith('Set ') ? m.slice(4).split(', ').map((x) => x.split(': ')[1] || x).join(' and ') : m));
          const said = lang === 'hi' ? words[Math.floor(Math.random() * words.length)] : `${words[Math.floor(Math.random() * words.length)]} ${parts.join('. ')}.`;
          this.history.push({ role: 'assistant', content: said });
          shown += said;
          if (speech) speech.push(said);
          break;
        }
        if (ctx.media) {
          if (ctx.photo) row.querySelector('.msg-body').insertAdjacentHTML('afterbegin', `<img class="msg-snap" src="${ctx.photo}" alt="Camera photo">`);
          // The gateway attaches images to the last user message, so the
          // photo travels with a short user turn after the tool results.
          this.history.push({ role: 'user', content: '(Here is the image you asked for.)' });
          say('Looking at the photo');
        } else {
          say(ctx.sources.size ? 'Putting the answer together' : 'Thinking');
        }
        row.classList.add('pending');
        row.classList.remove('streaming');
        if (speech) speech.mark();
      }
      md.innerHTML = markdown(shown || '…');
      report(shown, true);
      if (this.onActivity) this.onActivity('done');
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      if (!aborted && this.onActivity) this.onActivity('error');
      report(aborted ? shown : this.spokenError(err), true);
      const cutOff = aborted && this.interrupted;
      md.innerHTML = markdown(`${shown}${shown ? '\n\n' : ''}${cutOff ? '' : aborted ? '*Stopped.*' : this.describeError(err)}`);
      if (speech && !aborted) speech.say(this.spokenError(err));
      if (cutOff) {
        // Talked over in voice: the question stays, with what was already
        // said, so the next utterance is understood in its context. Tool
        // steps that did not finish are dropped (a call without its result is
        // rejected by the model lanes).
        this.history.length = startLen;
        const said = shown.trim();
        this.history.push({ role: 'assistant', content: said ? `${said} [cut off: the user started talking]` : '[Not answered yet: the user started talking before you replied.]' });
      } else {
        // The unfinished exchange is dropped so the next request starts from
        // a complete conversation.
        this.history.length = Math.max(0, startLen - 1);
      }
      if (!aborted && err && err.status === 401) this.refresh();
    } finally {
      if (speech) speech.end();
      if (this.abort === abort) this.abort = null;
      row.classList.remove('pending', 'streaming');
      status.hidden = true;
      const body = row.querySelector('.msg-body');
      if (steps.length) {
        const trace = row.querySelector('.msg-trace');
        const unique = [...new Set(steps)];
        trace.querySelector('summary').textContent = unique.length === 1 ? unique[0] : `${unique.length} steps`;
        trace.querySelector('ol').innerHTML = unique.map((x) => `<li>${esc(x)}</li>`).join('');
        trace.hidden = false;
      }
      if (ctx.actions.length) {
        body.insertAdjacentHTML('beforeend', `<div class="msg-actions">${ctx.actions.map((x) => `<span class="action-chip">${esc(x)}</span>`).join('')}</div>`);
      }
      if (shown && !body.querySelector('.msg-tools')) {
        body.insertAdjacentHTML('beforeend', `<div class="msg-tools"><button class="msg-tool" data-tool="copy" title="Copy"><svg viewBox="0 0 24 24" class="ico"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg></button><button class="msg-tool" data-tool="retry" title="Try again"><svg viewBox="0 0 24 24" class="ico"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button></div>`);
        const kind = [...used].map((n) => FOLLOW_KIND[n]).find(Boolean);
        if (kind && !ctx.failed) {
          body.insertAdjacentHTML('beforeend', `<div class="msg-follow">${FOLLOW_UPS[kind].map((q) => `<button class="follow-chip" data-follow="${esc(q)}">${esc(q)}</button>`).join('')}</div>`);
        }
      }
      if (ctx.sources.size) {
        body.insertAdjacentHTML('beforeend', `<div class="msg-sources"><span>Sources</span>${[...ctx.sources].slice(0, 6).map(([url, title]) => `<a href="${esc(url)}" data-ext title="${esc(url)}">${esc(title.length > 34 ? `${title.slice(0, 32)}…` : title)}</a>`).join('')}</div>`);
      }
      this.setBusy(false);
      this.scroll();
    }
  }

  describeError(err) {
    if (err && err.status === 401) return '**This PC isn’t paired with SYRIX any more.** Pair it again in Settings › Syrix.';
    if (err && err.status === 429) return '**Easy, I’m getting spammed.** Give it a minute and try again.';
    if (err && err.code === 'offline') return '**Can’t reach SYRIX.** Check the internet connection.';
    if (err && err.message) return `**${err.message}**`;
    console.error(err);
    return '**Something went wrong.** Try again.';
  }

  spokenError(err) {
    if (err && err.status === 401) return 'This PC isn’t paired with SYRIX any more. Pair it again in settings.';
    if (err && err.status === 429) return 'Too many messages at once. Give me a minute.';
    if (err && err.code === 'offline') return 'I can’t reach SYRIX right now. Check the internet.';
    return 'Something went wrong there. Try again.';
  }
}
