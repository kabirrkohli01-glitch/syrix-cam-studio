// Skin read-out from a single camera frame. Regions are laid out in a
// face-aligned frame (eye line as the x axis, eye distance as the unit) and
// placed against the person's own nose, mouth and chin, so they stay on the
// right patch of skin whatever the head size or tilt. Each region is measured
// in CIELAB, which separates lightness from redness (a*) and yellowness (b*).
// Results are relative estimates for wellness, not a medical assessment, and
// they depend on light: the lighting check runs first and is reported.

const LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

function lab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Broad skin-colour gate in YCbCr that drops brows, hair, glasses frames and
// background without excluding any skin tone.
function isSkin(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 35 && y < 248 && cb > 72 && cb < 132 && cr > 130 && cr < 180;
}

const EYE_A = [33, 133, 159, 145, 160, 144];
const EYE_B = [362, 263, 386, 374, 385, 380];

export const REGIONS = [
  { id: 'forehead', name: 'Forehead' },
  { id: 'cheekL', name: 'Left cheek' },
  { id: 'cheekR', name: 'Right cheek' },
  { id: 'nose', name: 'Nose' },
  { id: 'chin', name: 'Chin' },
  { id: 'eyeL', name: 'Under left eye' },
  { id: 'eyeR', name: 'Under right eye' },
];

// Face frame and region rectangles (in eye-distance units) for normalised
// landmarks. "Left" and "right" are the person's own sides.
export function faceFrame(lm, vw, vh) {
  const P = (i) => [lm[i].x * vw, lm[i].y * vh];
  const avg = (ids) => ids.map(P).reduce((a, p) => [a[0] + p[0] / ids.length, a[1] + p[1] / ids.length], [0, 0]);
  let A = avg(EYE_A), B = avg(EYE_B);
  // In the un-mirrored video the person's right eye has the smaller x.
  const swap = A[0] > B[0];
  if (swap) [A, B] = [B, A];
  const ed = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const ex = [(B[0] - A[0]) / ed, (B[1] - A[1]) / ed];
  const ey = [-ex[1], ex[0]];
  const O = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const toLocal = (p) => [((p[0] - O[0]) * ex[0] + (p[1] - O[1]) * ex[1]) / ed, ((p[0] - O[0]) * ey[0] + (p[1] - O[1]) * ey[1]) / ed];
  const toPx = (u, v) => [O[0] + (ex[0] * u + ey[0] * v) * ed, O[1] + (ex[1] * u + ey[1] * v) * ed];
  const vTop = toLocal(P(10))[1];
  const vNose = toLocal(P(1))[1];
  const vMouth = toLocal(avg([13, 14]))[1];
  const vChin = toLocal(P(152))[1];
  const uSide = Math.min(Math.abs(toLocal(P(234))[0]), Math.abs(toLocal(P(454))[0]));
  // u < 0 is the person's right side in the un-mirrored video.
  const rects = {
    forehead: [-0.72, 0.72, vTop * 0.82, -0.5],
    cheekR: [-Math.min(0.95, uSide * 0.86), -0.36, 0.42, (vNose + vMouth) / 2 + 0.02],
    cheekL: [0.36, Math.min(0.95, uSide * 0.86), 0.42, (vNose + vMouth) / 2 + 0.02],
    nose: [-0.13, 0.13, 0.14, vNose - 0.06],
    chin: [-0.34, 0.34, vMouth + (vChin - vMouth) * 0.38, vChin - (vChin - vMouth) * 0.14],
    eyeR: [-0.76, -0.24, 0.17, 0.4],
    eyeL: [0.24, 0.76, 0.17, 0.4],
    // The eyes themselves, for the Eyes tab close-ups (not skin regions).
    eyeBoxR: [-0.86, -0.14, -0.24, 0.2],
    eyeBoxL: [0.14, 0.86, -0.24, 0.2],
  };
  return { O, ex, ey, ed, toLocal, toPx, rects, swap };
}

export function regionCorners(frame, id) {
  const [u0, u1, v0, v1] = frame.rects[id];
  return [frame.toPx(u0, v0), frame.toPx(u1, v0), frame.toPx(u1, v1), frame.toPx(u0, v1)];
}

// What most often hides each region from the camera, for "covered" notes.
export const COVERED_BY = {
  forehead: 'hair, a cap or a hand', cheekL: 'hair or a hand', cheekR: 'hair or a hand', nose: 'glare or a hand',
  chin: 'a beard, a hand or the angle', eyeL: 'glasses, glare or shadow', eyeR: 'glasses, glare or shadow',
};

// Canvas transform that draws a video frame so a face region (plus a margin)
// fills a w x h tile, upright in the face's own frame and mirrored like the
// live view. Use: ctx.setTransform(...cropTransform(...)); ctx.drawImage(video, 0, 0).
export function cropTransform(frame, id, w, h, pad = 0.18, mirror = true) {
  let [u0, u1, v0, v1] = frame.rects[id];
  const pu = (u1 - u0) * pad, pv = (v1 - v0) * pad;
  u0 -= pu; u1 += pu; v0 -= pv; v1 += pv;
  // Keep the tile's aspect ratio by widening the shorter side.
  const want = w / h, du0 = u1 - u0, dv0 = v1 - v0;
  if (du0 / dv0 < want) { const g = (dv0 * want - du0) / 2; u0 -= g; u1 += g; } else { const g = (du0 / want - dv0) / 2; v0 -= g; v1 += g; }
  const du = u1 - u0, dv = v1 - v0;
  const { ex, ey, O, ed } = frame;
  let a = (ex[0] * w) / (ed * du), c = (ex[1] * w) / (ed * du);
  let e = (-(ex[0] * O[0] + ex[1] * O[1]) * w) / (ed * du) - (u0 * w) / du;
  const b = (ey[0] * h) / (ed * dv), d = (ey[1] * h) / (ed * dv);
  const f = (-(ey[0] * O[0] + ey[1] * O[1]) * h) / (ed * dv) - (v0 * h) / dv;
  // The face frame's u axis runs from the person's right eye to their left,
  // which is left to right in the un-mirrored video.
  if (mirror) { a = -a; c = -c; e = w - e; }
  return { m: [a, b, c, d, e, f], box: [u0, u1, v0, v1] };
}

// Combines skin reads of several frames taken a moment apart. Measurements
// are the median per region, and a spot is kept only if it shows up in the
// same place in at least two frames: sensor noise and compression blocks
// change from frame to frame, real marks do not.
export function mergeSkin(reads) {
  if (reads.length < 2) return reads[0];
  const base = reads[0];
  const frames = reads.map((r) => faceFrame(r.lm, r.res.frame.w, r.res.frame.h));
  const med = (a) => { const s = a.filter((v) => v != null && isFinite(v)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const regions = {};
  for (const { id } of REGIONS) {
    const all = reads.map((r) => r.res.regions[id]).filter(Boolean);
    const seen = all.filter((r) => r.visible);
    if (seen.length * 2 <= all.length || !seen.length) { regions[id] = all.find((r) => !r.visible) || all[0] || null; continue; }
    const pick = (k) => med(seen.map((r) => r[k]));
    // Spots in face-local units, so frames with slight head movement line up.
    const local = reads.map((r, i) => ((r.res.regions[id] && r.res.regions[id].spots) || []).map((s) => {
      const [u, v] = frames[i].toLocal([s.x * r.res.frame.w, s.y * r.res.frame.h]);
      return { ...s, u, v, ru: s.r / frames[i].ed };
    }));
    const kept = [];
    for (const s of local[0].concat(...local.slice(1))) {
      if (kept.some((k) => k.kind === s.kind && Math.hypot(k.u - s.u, k.v - s.v) < Math.max(0.03, k.ru * 1.6))) continue;
      const hits = local.filter((list) => list.some((o) => o.kind === s.kind && Math.hypot(o.u - s.u, o.v - s.v) < Math.max(0.03, s.ru * 1.8))).length;
      if (hits >= 2) kept.push(s);
    }
    const F0 = frames[0];
    const spots = kept.map((s) => { const [x, y] = F0.toPx(s.u, s.v); return { x: x / base.res.frame.w, y: y / base.res.frame.h, r: s.ru * F0.ed, kind: s.kind }; });
    regions[id] = {
      visible: true, coverage: pick('coverage'), L: pick('L'), a: pick('a'), b: pick('b'),
      texture: pick('texture'), blotch: pick('blotch'), shine: pick('shine'), area: pick('area'), spots,
    };
  }
  const aVals = REGIONS.map(({ id }) => regions[id]).filter((r) => r && r.visible).map((r) => r.a).sort((x, y) => x - y);
  const lighting = base.res.lighting;
  return { res: { regions, baseA: aVals.length ? aVals[aVals.length >> 1] : base.res.baseA, lighting, frame: base.res.frame, frames: reads.length }, lm: base.lm, frontal: base.frontal };
}

// Measures every region in an RGBA frame of the given size.
export function analyseSkin(img, w, h, lm) {
  const F = faceFrame(lm, w, h);
  const d = img.data;
  const regions = {};
  let allA = [];
  for (const { id } of REGIONS) {
    const pts = regionCorners(F, id);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < 4 || bh < 4) { regions[id] = null; continue; }
    const [u0, u1, v0, v1] = F.rects[id];
    const L = new Float32Array(bw * bh), A = new Float32Array(bw * bh), Bc = new Float32Array(bw * bh);
    const mask = new Uint8Array(bw * bh);
    let inside = 0, skin = 0, sL = 0, sA = 0, sB = 0, shine = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [u, v] = F.toLocal([x, y]);
        if (u < u0 || u > u1 || v < v0 || v > v1) continue;
        inside++;
        const i = (y * w + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const k = (y - y0) * bw + (x - x0);
        const [l, a, bb] = lab(r, g, b);
        L[k] = l; A[k] = a; Bc[k] = bb;
        // Specular highlights are near-white and would fail the skin test,
        // so shine is counted before it.
        if (l > 78 && Math.hypot(a, bb) < 16) { shine++; mask[k] = 2; continue; }
        if (!isSkin(r, g, b)) continue;
        mask[k] = 1;
        skin++;
        sL += l; sA += a; sB += bb;
      }
    }
    // Less than about 40 % skin inside the region means something is in the
    // way (hair, a cap, glasses, a hand); measuring the rest would describe
    // the covering rather than the skin.
    if (skin < 30 || (inside && skin / inside < 0.4)) { regions[id] = { visible: false, covered: inside > 30, coverage: inside ? skin / inside : 0 }; continue; }
    const mL = sL / skin, mA = sA / skin, mB = sB / skin;
    const tex = localStats(L, A, mask, bw, bh, Math.max(2, Math.round(F.ed * 0.06)));
    const minSpot = Math.max(3, (F.ed * 0.018) ** 2 * 3);
    const maxSpot = (F.ed * 0.13) ** 2 * 3;
    const spots = blobs(tex.red, bw, bh, minSpot, maxSpot).map((s) => ({ ...s, x: (s.x + x0) / w, y: (s.y + y0) / h, kind: 'red' }))
      .concat(blobs(tex.dark, bw, bh, minSpot, maxSpot).map((s) => ({ ...s, x: (s.x + x0) / w, y: (s.y + y0) / h, kind: 'dark' })));
    regions[id] = {
      visible: true,
      coverage: skin / Math.max(1, inside),
      L: mL, a: mA, b: mB,
      texture: tex.texture,
      blotch: tex.blotch,
      shine: shine / Math.max(1, inside),
      spots,
      area: skin,
    };
    allA.push(mA);
  }
  allA.sort((x, y) => x - y);
  const baseA = allA.length ? allA[allA.length >> 1] : 0;
  const vis = REGIONS.map((r) => regions[r.id]).filter((r) => r && r.visible);
  const faceL = vis.length ? vis.reduce((s, r) => s + r.L, 0) / vis.length : 0;
  const lighting = {
    level: faceL,
    uneven: regions.cheekL && regions.cheekR && regions.cheekL.visible && regions.cheekR.visible ? Math.abs(regions.cheekL.L - regions.cheekR.L) : 0,
  };
  lighting.ok = faceL > 38 && faceL < 82 && lighting.uneven < 14;
  lighting.note = faceL <= 38 ? 'Too dark: face a window or lamp.' : faceL >= 82 ? 'Too bright: the face is washing out.' : lighting.uneven >= 14 ? 'Light is coming from one side: one cheek is much darker.' : 'Light is even.';
  return { regions, baseA, lighting, frame: { ed: F.ed, w, h } };
}

// Local contrast against a box-blurred copy: texture is the spread of
// lightness detail, blotchiness the spread of slow tone changes, and pixels
// well redder or darker than their surroundings become spot candidates.
function localStats(L, A, mask, w, h, r) {
  const blur = (src) => {
    const I = new Float64Array((w + 1) * (h + 1)), C = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0, rc = 0;
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        const m = mask[k] === 1 ? 1 : 0;
        row += src[k] * m; rc += m;
        I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
        C[(y + 1) * (w + 1) + x + 1] = C[y * (w + 1) + x + 1] + rc;
      }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1), ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
        const s = I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa];
        const c = C[yb * (w + 1) + xb] - C[ya * (w + 1) + xb] - C[yb * (w + 1) + xa] + C[ya * (w + 1) + xa];
        out[y * w + x] = c ? s / c : src[y * w + x];
      }
    }
    return out;
  };
  const bL = blur(L), bA = blur(A);
  let n = 0, sd = 0, mean = 0;
  const red = new Uint8Array(w * h), dark = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) {
    if (mask[k] !== 1) continue;
    const dl = L[k] - bL[k];
    sd += dl * dl;
    mean += bL[k];
    n++;
    if (A[k] - bA[k] > 6.5) red[k] = 1;
    if (bL[k] - L[k] > 9) dark[k] = 1;
  }
  mean /= Math.max(1, n);
  let blot = 0;
  for (let k = 0; k < w * h; k++) if (mask[k] === 1) blot += (bL[k] - mean) ** 2;
  return { texture: Math.sqrt(sd / Math.max(1, n)), blotch: Math.sqrt(blot / Math.max(1, n)), red, dark };
}

// Connected blobs (4-neighbour) within a size range; returns centre and size.
function blobs(grid, w, h, minA, maxA) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let k = 0; k < w * h; k++) {
    if (!grid[k] || seen[k]) continue;
    let area = 0, sx = 0, sy = 0;
    stack.push(k);
    seen[k] = 1;
    while (stack.length) {
      const c = stack.pop();
      const x = c % w, y = (c - x) / w;
      area++; sx += x; sy += y;
      for (const n of [c - 1, c + 1, c - w, c + w]) {
        if (n < 0 || n >= w * h || seen[n] || !grid[n]) continue;
        if ((n === c - 1 && x === 0) || (n === c + 1 && x === w - 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (area >= minA && area <= maxA) out.push({ x: sx / area, y: sy / area, r: Math.sqrt(area / Math.PI) });
  }
  return out.slice(0, 25);
}

// Turns raw region numbers into graded findings with plain explanations.
export function interpret(result) {
  const { regions, baseA, lighting } = result;
  const findings = [];
  const grade = (v, mild, moderate, notable) => (v >= notable ? 3 : v >= moderate ? 2 : v >= mild ? 1 : 0);
  const per = {};
  for (const { id, name } of REGIONS) {
    const r = regions[id];
    if (!r || !r.visible) {
      per[id] = r && r.covered
        ? { name, level: null, covered: true, notes: [`Covered (${COVERED_BY[id]}), so it could not be read`] }
        : { name, level: null, notes: ['Out of view (head angle or frame edge)'] };
      continue;
    }
    const notes = [];
    if (r.coverage < 0.6) notes.push('Partly covered, so this reading is less certain');
    let level = 0;
    const redness = r.a - baseA;
    const reds = r.spots.filter((s) => s.kind === 'red').length;
    const darks = r.spots.filter((s) => s.kind === 'dark').length;
    if (id.startsWith('eye')) {
      const cheek = regions[id === 'eyeL' ? 'cheekL' : 'cheekR'];
      const shade = cheek && cheek.visible ? cheek.L - r.L : 0;
      const g = grade(shade, 6, 10, 15);
      if (g) notes.push(['Slight', 'Noticeable', 'Strong'][g - 1] + ' darkness under the eye');
      level = Math.max(level, g);
      per[id] = { name, level, notes, shade };
      continue;
    }
    const gRed = grade(redness, 3, 6, 10);
    if (gRed) notes.push(['A little', 'Noticeably', 'Very'][gRed - 1] + ' redder than the rest of the face');
    const gSpots = grade(reds, 2, 4, 7);
    if (gSpots) notes.push(`${reds} small red spot${reds === 1 ? '' : 's'}`);
    const gDark = grade(darks, 3, 6, 10);
    if (gDark) notes.push(`${darks} darker mark${darks === 1 ? '' : 's'}`);
    const gTex = grade(r.texture, 3.2, 4.4, 6);
    if (gTex) notes.push(['Some', 'Visible', 'Strong'][gTex - 1] + ' texture');
    const gShine = grade(r.shine, 0.04, 0.09, 0.16);
    if (gShine) notes.push(['A bit of', 'Noticeable', 'Lots of'][gShine - 1] + ' shine');
    const gBlot = grade(r.blotch, 4.5, 6.5, 9);
    if (gBlot) notes.push('Uneven tone');
    level = Math.max(gRed, gSpots, gDark, gTex, Math.min(2, gShine), gBlot);
    per[id] = { name, level, notes, redness, reds, darks };
  }

  const sum = (k) => Object.values(per).reduce((s, r) => s + (r[k] || 0), 0);
  const avg = (k) => { const v = REGIONS.filter((x) => !x.id.startsWith('eye')).map((x) => regions[x.id]).filter((r) => r && r.visible); return v.length ? v.reduce((t, r) => t + (r[k] || 0), 0) / v.length : 0; };
  const reds = sum('reds');
  const darks = sum('darks');
  const shineT = ['forehead', 'nose', 'chin'].map((k) => regions[k]).filter((r) => r && r.visible).reduce((m, r) => Math.max(m, r.shine), 0);
  const shineC = ['cheekL', 'cheekR'].map((k) => regions[k]).filter((r) => r && r.visible).reduce((m, r) => Math.max(m, r.shine), 0);
  const cheekRed = Math.max(per.cheekL.redness || 0, per.cheekR.redness || 0);
  const noseRed = per.nose.redness || 0;
  const dark = Math.max(per.eyeL.shade || 0, per.eyeR.shade || 0);
  const tex = avg('texture');

  if (reds >= 3) findings.push({
    key: 'spots', level: reds >= 8 ? 3 : reds >= 5 ? 2 : 1, title: 'Red spots',
    what: `${reds} small red spots, mostly on the ${topRegion(per, 'reds')}.`,
    means: 'Small raised red spots are usually spots (acne), irritated hair follicles or bites. Clusters on the chin and jaw often follow hormones; on the forehead they can come from hair products, hats or sweat.',
    care: 'Wash twice a day with a gentle cleanser, use non-comedogenic moisturiser, avoid picking, and try a product with benzoyl peroxide or salicylic acid for a few weeks.',
    doctor: 'See a pharmacist or GP if spots are painful, deep, leaving scars, or not improving after about two months.',
  });
  if (cheekRed >= 6 || noseRed >= 6) findings.push({
    key: 'redness', level: Math.max(cheekRed, noseRed) >= 10 ? 3 : 2, title: 'Facial redness',
    what: `The ${cheekRed >= noseRed ? 'cheeks' : 'nose'} look redder than the rest of the face.`,
    means: 'Usually from heat, exercise, wind, a hot drink, alcohol or irritation from skincare. Redness that keeps coming back across the cheeks and nose, sometimes with small visible vessels or bumps, can be rosacea.',
    care: 'Use gentle fragrance-free products, daily SPF, and notice triggers (heat, spicy food, alcohol).',
    doctor: 'See a GP if the redness is persistent, burning, spreading, or comes with eye irritation.',
  });
  if (shineT >= 0.09) findings.push({
    key: 'oil', level: shineT >= 0.16 ? 2 : 1, title: 'Oily T-zone',
    what: `The forehead, nose or chin is shiny${shineC < 0.04 ? ' while the cheeks are not (combination skin)' : ''}.`,
    means: 'Shine comes from sebum (natural oil) and is common, especially in teens and in warm weather. It can make spots more likely.',
    care: 'A light gel moisturiser, a gentle cleanser and blotting during the day help. Over-washing makes skin produce more oil.',
    doctor: null,
  });
  if (dark >= 8) findings.push({
    key: 'darkcircles', level: dark >= 14 ? 2 : 1, title: 'Dark under-eyes',
    what: 'The skin under the eyes is darker than the cheeks.',
    means: 'Most often genetics, thin skin, tiredness, screen time, allergies or dehydration. It is very common and rarely a medical problem.',
    care: 'Regular sleep, water, cold compresses, and treating hay fever if you have it.',
    doctor: 'See a GP if it appears suddenly with swelling, or only on one side.',
  });
  if (darks >= 4) findings.push({
    key: 'pigment', level: darks >= 10 ? 2 : 1, title: 'Darker marks',
    what: `${darks} small darker marks.`,
    means: 'Usually freckles, old spot marks (post-inflammatory pigmentation) or sun spots.',
    care: 'Daily SPF stops them darkening; they often fade over months.',
    doctor: 'Have any mole or mark checked that is new, growing, changing colour or shape, itching or bleeding.',
  });
  if (tex >= 4.4) findings.push({
    key: 'texture', level: tex >= 6 ? 2 : 1, title: 'Visible texture',
    what: 'The skin surface shows visible texture (pores, bumps or dryness).',
    means: 'Enlarged pores, dryness or small bumps; the camera and side lighting exaggerate it.',
    care: 'Moisturise, exfoliate gently once or twice a week, and drink enough water.',
    doctor: null,
  });
  if (!findings.length) findings.push({
    key: 'clear', level: 0, title: 'Looking clear',
    what: 'No strong redness, spots or shine detected in this light.',
    means: 'Skin looks even. Results change with lighting, so compare scans in the same spot.',
    care: 'Keep up SPF, moisturiser and sleep.',
    doctor: null,
  });
  const penalty = Object.values(per).reduce((s, r) => s + (r.level || 0) * 4, 0);
  const score = Math.max(25, Math.min(100, Math.round(100 - penalty - (lighting.ok ? 0 : 5))));
  const covered = REGIONS.filter(({ id }) => per[id].covered).map(({ id }) => id);
  return { per, findings, score, lighting, covered };
}

function topRegion(per, key) {
  let best = null;
  for (const r of Object.values(per)) if (r[key] && (!best || r[key] > best[key])) best = r;
  return best ? best.name.toLowerCase() : 'face';
}
