import { request, hasHost } from '../bridge.js';
import { host } from '../store.js';

// Client for the SYRIX gateway. This app holds only a device token issued by
// the gateway's pairing endpoint; model access, search and rate limits all
// live on the gateway. The token is kept encrypted by the desktop host and is
// fetched into memory only when a request is made.

export const GATEWAY = 'https://your-syrix-gateway.example.workers.dev';

export class GatewayError extends Error {
  constructor(status, code, message) {
    super(message || 'SYRIX could not answer that.');
    this.status = status;
    this.code = code || 'error';
  }
}

let memToken = null;

async function token() {
  if (memToken) return memToken;
  if (!hasHost) return null;
  const r = await request({ type: 'token:get' }, 'token:value');
  memToken = (r && r.token) || null;
  return memToken;
}

export function forgetToken() { memToken = null; }

export async function isPaired() {
  return !!(host.paired || (await token()));
}

function deviceId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return `cam-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

async function readJson(res) {
  try { return await res.json(); } catch { return {}; }
}

// Exchanges the household pairing code for a device token. The code itself is
// never stored.
export async function pair(code) {
  const res = await fetch(`${GATEWAY}/v1/device/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: String(code).trim(), deviceId: deviceId(), label: 'SYRIX Cam' }),
  });
  const body = await readJson(res);
  if (!res.ok || !body.token) throw new GatewayError(res.status, body.error, body.message || 'Pairing failed.');
  if (hasHost) {
    const r = await request({ type: 'token:set', token: body.token }, 'token:state');
    host.paired = !!(r && r.paired);
  } else {
    host.paired = true;
  }
  memToken = body.token;
  return true;
}

export async function unpair() {
  memToken = null;
  host.paired = false;
  if (hasHost) await request({ type: 'token:clear' }, 'token:state');
}

async function post(path, payload, signal) {
  const tok = await token();
  if (!tok) throw new GatewayError(401, 'no_token', 'This device is not paired with SYRIX.');
  let res;
  try {
    res = await fetch(`${GATEWAY}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Syrix-Token': tok },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new GatewayError(0, 'offline', 'Can’t reach SYRIX. Check the internet connection.');
  }
  if (!res.ok) {
    const body = await readJson(res);
    if (res.status === 401) { memToken = null; host.paired = false; }
    throw new GatewayError(res.status, body.error, body.message);
  }
  return res;
}

// Streams a chat turn. Yields gateway events: {type:'token', text},
// {type:'tool_call', id, name, args}, {type:'error', message}, {type:'done'}.
export async function* chat(payload, signal) {
  const res = await post('/v1/chat', { ...payload, stream: true }, signal);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop();
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      yield ev;
      if (ev.type === 'done') return;
    }
  }
}

export async function search(query, freshness) {
  const res = await post('/v1/search', { query, freshness });
  const body = await readJson(res);
  return body.results || [];
}

export async function readPage(url) {
  const res = await post('/v1/search', { read: url });
  return readJson(res);
}

// Market data through the gateway: symbol search and price history.
export async function marketFind(query) {
  const res = await post('/v1/market', { find: String(query || '').slice(0, 60) });
  const body = await readJson(res);
  return body.results || [];
}

export async function marketChart(symbol, range = '1mo') {
  const res = await post('/v1/market', { chart: symbol, range });
  return readJson(res);
}
