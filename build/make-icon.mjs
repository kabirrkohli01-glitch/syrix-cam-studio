// Builds the app icon and in-app brand image from assets/brand/logo-source.png.
//
// The artwork is cropped to its visible bounds, resampled to each icon size
// with gamma-correct area averaging (sharper than letting a renderer scale a
// large image), lightly sharpened at the small sizes, given rounded corners
// and packed into a multi-resolution .ico. No external tools are needed.
//
// Usage: node build/make-icon.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { decodePng, encodePng } from './png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const APP_SIZE = 512;
const PADDING = 0.075;      // empty margin around the artwork, per side
const CORNER = 0.225;       // corner radius as a fraction of the icon size

// ---------------------------------------------------------------- imaging

const toLin = new Float32Array(256).map((_, i) => Math.pow(i / 255, 2.2));
const toSrgb = (v) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2));

function bounds(img, threshold = 30) {
  let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 3;
      if (Math.max(img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]) > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

// Area-average resample of a square source region into size x size, in
// linear light. Pixels outside the image are treated as black.
function resample(img, sx, sy, side, size) {
  const out = new Float32Array(size * size * 3);
  const scale = side / size;
  for (let ty = 0; ty < size; ty++) {
    const y0 = sy + ty * scale, y1 = y0 + scale;
    for (let tx = 0; tx < size; tx++) {
      const x0 = sx + tx * scale, x1 = x0 + scale;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const w = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
          wsum += w;
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
          const i = (y * img.width + x) * 3;
          r += toLin[img.rgb[i]] * w; g += toLin[img.rgb[i + 1]] * w; b += toLin[img.rgb[i + 2]] * w;
        }
      }
      const o = (ty * size + tx) * 3;
      out[o] = r / wsum; out[o + 1] = g / wsum; out[o + 2] = b / wsum;
    }
  }
  return out;
}

// Unsharp mask with a 3x3 blur; restores edge contrast lost when shrinking.
function sharpen(px, size, amount) {
  if (amount <= 0) return px;
  const out = new Float32Array(px.length);
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(size - 1, Math.max(0, x + dx)), yy = Math.min(size - 1, Math.max(0, y + dy));
            const w = k[(dy + 1) * 3 + dx + 1];
            s += px[(yy * size + xx) * 3 + c] * w;
            n += w;
          }
        }
        const i = (y * size + x) * 3 + c;
        out[i] = px[i] + amount * (px[i] - s / n);
      }
    }
  }
  return out;
}

// Coverage of a rounded square, supersampled 4x4 per pixel for smooth edges.
function roundedAlpha(size) {
  const r = size * CORNER;
  const a = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
          const cx = Math.min(Math.max(px, r), size - r), cy = Math.min(Math.max(py, r), size - r);
          if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) hit++;
        }
      }
      a[y * size + x] = hit / 16;
    }
  }
  return a;
}

function renderIcon(img, crop, size) {
  let px = resample(img, crop.x, crop.y, crop.side, size);
  const amount = size <= 32 ? 0.7 : size <= 64 ? 0.4 : size <= 128 ? 0.15 : 0;
  px = sharpen(px, size, amount);
  // Small sizes get a gentle lift so the dark grey strokes stay visible.
  const lift = size <= 32 ? 1.35 : size <= 64 ? 1.15 : 1;
  const alpha = roundedAlpha(size);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = toSrgb(px[i * 3] * lift);
    out[i * 4 + 1] = toSrgb(px[i * 3 + 1] * lift);
    out[i * 4 + 2] = toSrgb(px[i * 3 + 2] * lift);
    out[i * 4 + 3] = Math.round(alpha[i] * 255);
  }
  return encodePng(size, out);
}

// ---------------------------------------------------------------- build

const img = decodePng(readFileSync(join(root, 'assets', 'brand', 'logo-source.png')));
const b = bounds(img);
const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
const art = Math.max(b.x1 - b.x0, b.y1 - b.y0);
const side = art / (1 - PADDING * 2);
const crop = { x: cx - side / 2, y: cy - side / 2, side };

const pngs = ICO_SIZES.map((size) => ({ size, buf: renderIcon(img, crop, size) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
const dir = Buffer.alloc(16 * pngs.length);
let offset = 6 + dir.length;
pngs.forEach(({ size, buf }, i) => {
  const o = i * 16;
  dir.writeUInt8(size >= 256 ? 0 : size, o);
  dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(buf.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += buf.length;
});
const ico = Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]);
writeFileSync(join(root, 'assets', 'syrixcam.ico'), ico);
writeFileSync(join(root, 'app', 'favicon.ico'), ico);
writeFileSync(join(root, 'assets', 'logo-256.png'), pngs.find((p) => p.size === 256).buf);
mkdirSync(join(root, 'app', 'assets'), { recursive: true });
writeFileSync(join(root, 'app', 'assets', `logo-${APP_SIZE}.png`), renderIcon(img, crop, APP_SIZE));
console.log(`Artwork bounds ${b.x0},${b.y0} to ${b.x1},${b.y1}; icon sizes ${ICO_SIZES.join(', ')} plus ${APP_SIZE}`);
