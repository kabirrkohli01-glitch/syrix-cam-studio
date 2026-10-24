// Makes the in-app SYRIX logos (transparent background) from
// assets/brand/thinking-syrix.png, the same mark the SYRIX HUD and website
// use inside apps: app/assets/syrix-logo-128.png and syrix-logo-256.png.
// The star is cropped to its bounds plus a margin, then downscaled with a
// premultiplied box filter so the edges stay clean at small sizes.
//
// Usage: node build/make-logo.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { encodePng } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function decodeRgba(buf) {
  let o = 8, W = 0, H = 0, type = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const kind = buf.toString('ascii', o + 4, o + 8);
    if (kind === 'IHDR') { W = buf.readUInt32BE(o + 8); H = buf.readUInt32BE(o + 12); type = buf[o + 17]; }
    if (kind === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  if (type !== 6) throw new Error('Expected an 8-bit RGBA PNG');
  const raw = inflateSync(Buffer.concat(idat));
  const st = W * 4;
  const px = new Uint8Array(W * H * 4);
  let prev = new Uint8Array(st);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (st + 1)];
    const line = raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1));
    const cur = new Uint8Array(st);
    for (let x = 0; x < st; x++) {
      const a = x >= 4 ? cur[x - 4] : 0, b = prev[x], c = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    px.set(cur, y * st);
    prev = cur;
  }
  return { W, H, px };
}

const { W, H, px } = decodeRgba(readFileSync(join(root, 'assets', 'brand', 'thinking-syrix.png')));

// Bounds of the clearly visible mark; the faint outer glow is cropped away.
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (px[(y * W + x) * 4 + 3] > 160) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
}
const side = Math.max(x1 - x0, y1 - y0) * 1.12;
const sx = (x0 + x1) / 2 - side / 2, sy = (y0 + y1) / 2 - side / 2;

function render(size) {
  const out = new Uint8Array(size * size * 4);
  const scale = side / size;
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const ax = sx + ox * scale, ay = sy + oy * scale;
      for (let y = Math.floor(ay); y < Math.ceil(ay + scale); y++) {
        for (let x = Math.floor(ax); x < Math.ceil(ax + scale); x++) {
          n++;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const i = (y * W + x) * 4, al = px[i + 3];
          r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al; a += al;
        }
      }
      const o = (oy * size + ox) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / n;
    }
  }
  return out;
}

for (const size of [128, 256]) {
  writeFileSync(join(root, 'app', 'assets', `syrix-logo-${size}.png`), encodePng(size, render(size)));
  console.log(`Wrote app/assets/syrix-logo-${size}.png`);
}
