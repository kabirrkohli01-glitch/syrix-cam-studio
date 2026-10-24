// Messaging with the native host window. When the page runs outside the
// host (for development in a browser) every call degrades gracefully.

const wv = window.chrome && window.chrome.webview ? window.chrome.webview : null;
const handlers = new Map();
let seq = 0;

export const hasHost = !!wv;

if (wv) {
  wv.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    const set = handlers.get(msg.type);
    if (set) for (const fn of [...set]) fn(msg);
  });
}

export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type).delete(fn);
}

export function send(msg) {
  if (wv) wv.postMessage(msg);
}

// Sends a message and resolves with the first reply of `replyType` whose id
// matches (when the reply carries one).
export function request(msg, replyType, timeout = 4000) {
  if (!wv) return Promise.resolve(null);
  const id = String(++seq);
  return new Promise((resolve) => {
    const off = on(replyType, (reply) => {
      if (reply.id != null && reply.id !== id) return;
      off();
      clearTimeout(timer);
      resolve(reply);
    });
    const timer = setTimeout(() => { off(); resolve(null); }, timeout);
    send({ ...msg, id });
  });
}

export function openExternal(url) {
  if (wv) send({ type: 'open', url });
  else window.open(url, '_blank', 'noopener');
}
