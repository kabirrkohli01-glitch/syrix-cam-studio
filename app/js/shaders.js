// GLSL sources for the render pipeline.
//
// Pass A  (COMPOSITE) camera + person mask + background + face warp -> base texture
// Pass B  (FILTERS)   a style applied to the base texture -> screen or scene texture
// Pass C  (POST)      time effects that need frame history (scan freeze, trails)
//
// Screen coordinates `s` run 0..1 with y pointing DOWN, matching the overlay
// canvas. Camera, mask and plate textures are stored in video orientation
// (row 0 = top of the image) and are addressed through camUV(), which applies
// the cover-fit crop and the selfie mirror.

export const VERT = `#version 300 es
out vec2 v_s;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_s = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
`;

// ---------------------------------------------------------------- Pass A

export const COMPOSITE = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_s;
out vec4 outColor;

uniform sampler2D u_cam;
uniform sampler2D u_mask;
uniform sampler2D u_plate;
uniform vec4 u_cover;      // xy = scale, zw = offset (screen -> video uv)
uniform vec2 u_res;
uniform float u_aspect;
uniform float u_time;
uniform int u_bg;
uniform float u_hasMask;
uniform vec2 u_maskTexel;
uniform int u_warp;
uniform float u_faceOn;
uniform vec4 u_eyes;       // eye A xy, eye B xy  (screen space)
uniform vec4 u_mf;         // mouth xy, face centre xy
uniform float u_faceR;     // face radius in screen-height units
uniform float u_autoLight;
uniform int u_enhance;     // 0 none, 2 soft skin, 3 studio, 4 vivid
uniform vec2 u_camTexel;
${COMMON}

vec2 camUV(vec2 s) { return s * u_cover.xy + u_cover.zw; }

// Camera colour with the selected enhancement applied. Soft skin is an
// edge-preserving blur; auto light reads the frame's mean brightness from
// the top mip level and applies a filmic exposure curve.
vec3 camAt(vec2 uv) {
  vec3 c = texture(u_cam, uv).rgb;
  if (u_enhance == 2) {
    vec3 acc = c;
    float wsum = 1.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      vec3 n = texture(u_cam, uv + vec2(cos(a), sin(a)) * u_camTexel * 3.2).rgb;
      vec3 d = n - c;
      float w = exp(-dot(d, d) * 70.0);
      acc += n * w;
      wsum += w;
    }
    c = mix(c, acc / wsum, 0.8);
  }
  if (u_autoLight > 0.5) {
    float avg = luma(textureLod(u_cam, vec2(0.5), 12.0).rgb);
    float k = clamp(0.46 / max(avg, 0.02), 0.85, 3.2) * 1.15;
    c = (1.0 - exp(-c * k)) / (1.0 - exp(-k));
  }
  if (u_enhance == 3) {
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.35) * vec3(1.05, 1.0, 0.94);
    c = mix(vec3(luma(c)), c, 1.08);
  } else if (u_enhance == 4) {
    c = mix(vec3(luma(c)), c, 1.38);
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
  }
  return clamp(c, 0.0, 1.0);
}
vec3 cam(vec2 s) { return camAt(camUV(s)); }

// The mask is far lower resolution than the screen; a small tent filter
// before the threshold turns its stair-stepped edge into a smooth one.
float personMask(vec2 s) {
  if (u_hasMask < 0.5) return 1.0;
  vec2 uv = camUV(s);
  vec2 d = u_maskTexel * 1.25;
  float m = texture(u_mask, uv).r * 0.36
    + (texture(u_mask, uv + vec2(d.x, d.y)).r + texture(u_mask, uv + vec2(-d.x, d.y)).r
     + texture(u_mask, uv + vec2(d.x, -d.y)).r + texture(u_mask, uv + vec2(-d.x, -d.y)).r) * 0.16;
  return smoothstep(0.4, 0.74, m);
}

// ---- face warps -----------------------------------------------------------

vec2 bulge(vec2 s, vec2 c, float r, float a) {
  vec2 asp = vec2(u_aspect, 1.0);
  vec2 d = (s - c) * asp;
  float dist = length(d);
  if (dist >= r) return s;
  float t = dist / r;
  float k = 1.0 - a * pow(1.0 - t * t, 2.0);
  return c + d * k / asp;
}

vec2 swirl(vec2 s, vec2 c, float r, float ang) {
  vec2 asp = vec2(u_aspect, 1.0);
  vec2 d = (s - c) * asp;
  float dist = length(d);
  if (dist >= r) return s;
  float t = 1.0 - dist / r;
  float th = ang * t * t;
  float cs = cos(th), sn = sin(th);
  d = vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
  return c + d / asp;
}

vec2 warp(vec2 s) {
  if (u_faceOn < 0.5 || u_warp == 0) return s;
  float R = u_faceR;
  if (u_warp == 1) {
    s = bulge(s, u_eyes.xy, R * 0.46, 0.62);
    s = bulge(s, u_eyes.zw, R * 0.46, 0.62);
  } else if (u_warp == 2) {
    s = bulge(s, u_mf.xy, R * 0.7, 0.58);
  } else if (u_warp == 3) {
    s = bulge(s, u_mf.zw, R * 1.45, 0.42);
  } else if (u_warp == 4) {
    s = bulge(s, u_mf.zw, R * 1.5, -0.62);
  } else if (u_warp == 5) {
    s = swirl(s, u_mf.zw, R * 1.5, 2.6 * sin(u_time * 1.4));
  } else if (u_warp == 6) {
    s = bulge(s, u_mf.xy, R * 0.75, -0.7);
    s = bulge(s, u_eyes.xy, R * 0.56, 0.78);
    s = bulge(s, u_eyes.zw, R * 0.56, 0.78);
  }
  return s;
}

// ---- procedural backgrounds -------------------------------------------------

vec3 stars(vec2 p, float density) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float sc = 22.0 + fi * 18.0;
    vec2 g = p * sc + vec2(fi * 13.1 + u_time * 0.02 * (fi + 1.0), fi * 7.7);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash12(id + fi * 31.0);
    if (h > 1.0 - density) {
      vec2 o = vec2(hash12(id + 3.1), hash12(id + 7.3)) - 0.5;
      float d = length(f - o * 0.6);
      float tw = 0.55 + 0.45 * sin(u_time * (1.5 + h * 3.0) + h * 40.0);
      col += vec3(0.85, 0.9, 1.0) * smoothstep(0.09, 0.0, d) * tw * (0.6 + fi * 0.2);
    }
  }
  return col;
}

vec3 bgSpace(vec2 s) {
  vec2 p = (s - 0.5) * vec2(u_aspect, 1.0);
  float t = u_time * 0.02;
  float n1 = fbm(p * 1.8 + vec2(t, -t * 0.5));
  float n2 = fbm(p * 3.1 + n1 * 1.6 - vec2(t * 0.7, 0.0));
  vec3 col = vec3(0.012, 0.006, 0.04);
  col += vec3(0.50, 0.12, 0.75) * pow(n2, 3.0) * 1.9;
  col += vec3(0.05, 0.35, 0.75) * pow(n1, 3.5) * 1.6;
  col += vec3(0.9, 0.3, 0.6) * pow(max(n1 * n2, 0.0), 2.5) * 1.2;
  col += stars(p, 0.12);

  vec2 pc = p - vec2(u_aspect * 0.33, -0.26);
  float r = length(pc);
  float R = 0.13;
  if (r < R) {
    vec3 nrm = normalize(vec3(pc, sqrt(max(R * R - r * r, 0.0))));
    float lit = clamp(dot(nrm, normalize(vec3(-0.6, -0.5, 0.65))), 0.0, 1.0);
    float bands = 0.5 + 0.5 * sin(pc.y * 70.0 + fbm(pc * 12.0) * 4.0);
    vec3 pcol = mix(vec3(0.85, 0.45, 0.35), vec3(0.98, 0.8, 0.55), bands);
    col = mix(col, pcol * (0.08 + lit * 1.1), smoothstep(R, R - 0.003, r));
  }
  col += vec3(0.35, 0.55, 1.0) * smoothstep(R + 0.05, R, r) * step(R - 0.003, r) * 0.35;
  return col;
}

vec3 bgSynth(vec2 s) {
  float hz = 0.6;
  vec2 p = vec2((s.x - 0.5) * u_aspect, s.y);

  // Floor grid is evaluated unconditionally: fwidth() needs uniform control flow.
  float y = max(s.y - hz, 0.0006);
  float z = 0.09 / y;
  float gx = p.x * z * 1.2;
  float gz = z + u_time * 1.2;
  float lx = 1.0 - smoothstep(0.0, 1.6, abs(fract(gx - 0.5) - 0.5) / max(fwidth(gx), 1e-4));
  float lz = 1.0 - smoothstep(0.0, 1.6, abs(fract(gz - 0.5) - 0.5) / max(fwidth(gz), 1e-4));
  float grid = max(lx, lz) * smoothstep(0.0, 0.05, y);

  if (s.y >= hz) {
    float fade = smoothstep(0.0, 0.3, y);
    vec3 col = vec3(0.05, 0.0, 0.1) + vec3(0.14, 0.0, 0.2) * (1.0 - fade);
    col += vec3(1.0, 0.25, 0.85) * grid * (0.3 + 0.7 * fade);
    col += vec3(1.0, 0.3, 0.6) * 0.35 * (1.0 - smoothstep(0.0, 0.07, y));
    return col;
  }

  float t = s.y / hz;
  vec3 col = mix(vec3(0.06, 0.0, 0.16), vec3(0.95, 0.25, 0.55), pow(t, 2.2));
  col += stars(p, 0.08) * (1.0 - t);

  vec2 c = vec2(0.0, hz - 0.17);
  float R = 0.21;
  float r = length(p - c);
  float yy = (s.y - (c.y - R)) / (2.0 * R);
  float gap = clamp((yy - 0.45) * 0.9, 0.0, 0.5);
  float stripe = step(gap, fract(yy * 9.0 + u_time * 0.25));
  float sun = smoothstep(R, R - 0.004, r) * stripe;
  vec3 sunCol = mix(vec3(1.0, 0.92, 0.35), vec3(1.0, 0.2, 0.55), clamp(yy, 0.0, 1.0));
  col = mix(col, sunCol, sun);
  col += vec3(1.0, 0.3, 0.6) * 0.32 * smoothstep(0.6, 0.0, r) * (1.0 - sun);

  float ridge = hz - (0.015 + 0.09 * fbm(vec2(p.x * 2.6, 4.0))) * smoothstep(0.15, 0.9, abs(p.x));
  if (s.y > ridge) {
    col = mix(vec3(0.16, 0.0, 0.24), vec3(0.04, 0.0, 0.09), (s.y - ridge) / max(hz - ridge, 1e-3));
    col += vec3(1.0, 0.3, 0.8) * smoothstep(0.004, 0.0, s.y - ridge) * 0.8;
  }
  return col;
}

vec3 bgAurora(vec2 s) {
  vec2 p = vec2((s.x - 0.5) * u_aspect, s.y);
  vec3 col = mix(vec3(0.0, 0.015, 0.05), vec3(0.01, 0.06, 0.12), s.y);
  col += stars(p, 0.1) * 0.8;
  float t = u_time * 0.08;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float band = 0.3 + fi * 0.09 + 0.08 * sin(p.x * 1.6 + t * 2.0 + fi * 1.7)
               + 0.07 * fbm(vec2(p.x * 1.2 + t + fi, fi));
    float d = band - s.y;
    float glow = smoothstep(-0.012, 0.01, d) * exp(-max(d, 0.0) * (5.0 + fi * 2.0));
    float rays = 0.35 + 0.65 * fbm(vec2(p.x * 14.0 + fi * 3.0, t * 3.0));
    vec3 c = mix(vec3(0.1, 1.0, 0.55), vec3(0.6, 0.25, 1.0), clamp(d * 3.5 + fi * 0.25, 0.0, 1.0));
    col += c * glow * rays * 0.6;
  }
  float ridge = 0.8 + 0.06 * fbm(vec2(p.x * 2.2, 3.0)) - 0.05 * abs(sin(p.x * 1.3 + 0.4));
  col = mix(col, vec3(0.004, 0.01, 0.02), smoothstep(ridge, ridge + 0.004, s.y));
  return col;
}

vec3 bgRain(vec2 s) {
  vec2 px = s * u_res;
  float cw = max(10.0, floor(u_res.y / 46.0));
  vec2 cell = floor(px / cw);
  vec2 f = fract(px / cw);
  float seed = hash12(vec2(cell.x, 7.0));
  float rows = u_res.y / cw;
  float total = rows + 26.0;
  float head = mod(u_time * (5.0 + seed * 11.0) + seed * total, total);
  float d = head - cell.y;
  float trail = d >= 0.0 ? exp(-d * 0.13) : 0.0;
  vec2 g = floor(f * vec2(4.0, 5.0));
  float tick = floor(u_time * (1.5 + seed * 5.0));
  float on = step(0.48, hash12(cell * 13.0 + g + tick * 0.37));
  float inside = step(0.12, f.x) * step(f.x, 0.88) * step(0.08, f.y) * step(f.y, 0.92);
  on *= inside;
  vec3 col = vec3(0.0, 0.03, 0.012);
  col += vec3(0.1, 1.0, 0.4) * on * trail;
  col += vec3(0.75, 1.0, 0.85) * on * step(d, 1.0) * step(0.0, d);
  return col;
}

vec3 bgStudio(vec2 s) {
  vec2 p = (s - vec2(0.5, 0.36)) * vec2(u_aspect, 1.0);
  vec3 col = mix(vec3(0.6, 0.58, 0.555), vec3(0.13, 0.125, 0.12), smoothstep(0.0, 1.15, length(p)));
  col *= 0.94 + 0.06 * smoothstep(0.62, 1.0, s.y);
  return col + (hash12(s * u_res) - 0.5) * (2.0 / 255.0);
}

vec3 bgVoid(vec2 s) {
  vec2 p = (s - vec2(0.5, 0.45)) * vec2(u_aspect, 1.0);
  return vec3(0.03, 0.026, 0.022) * smoothstep(1.0, 0.0, length(p)) + (hash12(s * u_res) - 0.5) / 255.0;
}

vec3 bgBeach(vec2 s) {
  vec2 p = vec2((s.x - 0.5) * u_aspect, s.y);
  float hz = 0.5;
  float t = u_time;
  vec2 sun = vec2(-0.32 * u_aspect, hz - 0.07);
  float sd = length(p - sun);
  if (s.y < hz) {
    float k = s.y / hz;
    vec3 col = mix(vec3(0.24, 0.16, 0.42), vec3(1.0, 0.6, 0.3), pow(k, 1.6));
    col = mix(col, vec3(1.0, 0.82, 0.55), smoothstep(0.75, 1.0, k) * 0.6);
    float cloud = smoothstep(0.55, 0.85, fbm(vec2(p.x * 2.2 + t * 0.01, p.y * 7.0)));
    col = mix(col, vec3(1.0, 0.7, 0.62), cloud * 0.35 * (1.0 - k * 0.5));
    col += vec3(1.0, 0.75, 0.4) * (smoothstep(0.075, 0.07, sd) * 1.2 + exp(-sd * 9.0) * 0.45);
    return col;
  }
  if (s.y < 0.76) {
    float y = s.y - hz;
    float z = 0.08 / max(y, 0.002);
    float w = sin(p.x * z * 6.0 + z * 3.0 - t * 1.6) * 0.5 + sin(p.x * z * 11.0 - z * 2.0 + t * 1.1) * 0.5;
    vec3 col = mix(vec3(0.5, 0.42, 0.55), vec3(0.06, 0.24, 0.36), smoothstep(0.0, 0.24, y));
    col += vec3(0.12, 0.1, 0.08) * w * smoothstep(0.0, 0.1, y);
    float glint = exp(-abs(p.x - sun.x) * (6.0 + 30.0 * y)) * (0.5 + 0.5 * w);
    col += vec3(1.0, 0.7, 0.35) * glint * 0.8;
    float foam = smoothstep(0.012, 0.0, abs(s.y - (0.745 + 0.008 * sin(p.x * 9.0 + t * 1.3))));
    return col + foam * 0.7;
  }
  vec3 sand = mix(vec3(0.86, 0.68, 0.48), vec3(0.62, 0.45, 0.3), smoothstep(0.76, 1.0, s.y));
  return sand * (0.92 + 0.1 * vnoise(s * u_res / 2.5));
}

float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.2831, 6.2831) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

vec3 bgWater(vec2 s) {
  vec2 p = vec2((s.x - 0.5) * u_aspect, s.y);
  vec3 col = mix(vec3(0.06, 0.5, 0.62), vec3(0.0, 0.07, 0.17), pow(s.y, 0.9));
  col += vec3(0.55, 0.9, 1.0) * clamp(caustic(p * 0.55, u_time * 0.45), 0.0, 1.0) * 0.32 * (1.0 - s.y * 0.7);
  float rays = pow(max(0.0, sin(p.x * 7.0 + sin(u_time * 0.25 + p.x * 2.0) * 1.4)), 10.0);
  col += vec3(0.5, 0.85, 1.0) * rays * (1.0 - s.y) * 0.18;
  vec2 g = vec2(p.x * 9.0, s.y * 9.0 + u_time * 1.2);
  vec2 id = floor(g);
  float h = hash12(id);
  if (h > 0.86) {
    vec2 f = fract(g) - 0.5 - (vec2(hash12(id + 2.0), hash12(id + 5.0)) - 0.5) * 0.4;
    float r = 0.08 + h * 0.12;
    col += vec3(0.7, 0.95, 1.0) * smoothstep(0.03, 0.0, abs(length(f) - r)) * 0.45;
  }
  return col;
}

vec3 blurCam(vec2 s) {
  vec2 uv = camUV(s);
  vec3 acc = textureLod(u_cam, uv, 3.0).rgb * 0.2;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 o = vec2(cos(a), sin(a) * 1.7778) * 0.018;
    acc += textureLod(u_cam, uv + o, 3.6).rgb * 0.1;
  }
  return acc;
}

vec3 composite(vec2 s) {
  vec3 c = cam(s);
  if (u_bg == 0) return c;
  float m = personMask(s);
  float edge = 4.0 * m * (1.0 - m);

  if (u_bg == 8) {
    vec2 wob = vec2(sin(s.y * 90.0 + u_time * 5.0), cos(s.x * 70.0 - u_time * 4.0)) * 0.005 * m;
    vec3 plate = texture(u_plate, camUV(s + wob)).rgb;
    vec3 col = plate * (1.0 + 0.06 * m * sin(u_time * 7.0 + s.y * 50.0));
    return col + vec3(0.55, 0.85, 1.0) * edge * 0.22;
  }

  if (u_bg == 9) {
    float glitch = step(0.93, hash12(vec2(floor(s.y * 40.0), floor(u_time * 9.0))));
    vec2 hs = s + vec2(glitch * 0.02, 0.0);
    float mh = personMask(hs);
    float l = luma(cam(hs));
    float scan = 0.7 + 0.3 * sin(s.y * u_res.y * 0.9 - u_time * 12.0);
    float flick = 0.9 + 0.1 * sin(u_time * 31.0) * sin(u_time * 7.0);
    vec3 holo = vec3(0.25, 0.85, 1.0) * (pow(l, 0.8) * 1.5 + 0.08) * scan * flick;
    holo += vec3(0.5, 1.0, 1.0) * 4.0 * mh * (1.0 - mh) * 0.8;
    vec3 room = c * vec3(0.14, 0.18, 0.24);
    room += vec3(0.0, 0.25, 0.35) * pow(max(0.0, 1.0 - abs(s.x - 0.5) * 2.2), 3.0) * smoothstep(0.4, 1.0, s.y) * 0.4;
    return room + holo * mh * 0.95;
  }

  vec3 b;
  vec3 fg = c;
  if (u_bg == 1) b = blurCam(s);
  else if (u_bg == 2) b = vec3(luma(c)) * 0.92;
  else if (u_bg == 3) {
    vec2 d = (s - vec2(0.5, 0.42)) * vec2(u_aspect, 1.0);
    b = mix(vec3(luma(c)), c, 0.3) * 0.16 + vec3(1.0, 0.85, 0.6) * 0.12 * smoothstep(0.75, 0.0, length(d));
    fg = c * 1.08;
  }
  else if (u_bg == 4) b = bgSpace(s);
  else if (u_bg == 5) b = bgSynth(s);
  else if (u_bg == 6) b = bgAurora(s);
  else if (u_bg == 7) b = bgRain(s);
  else if (u_bg == 10) b = bgBeach(s);
  else if (u_bg == 11) b = bgWater(s);
  else if (u_bg == 12) b = bgStudio(s);
  else b = bgVoid(s);

  vec3 col = mix(b, fg, m);
  if (u_bg >= 4) col = mix(col, b, edge * 0.25);
  return col;
}

// Alpha carries the person mask so styles in pass B can treat the person
// and the surroundings differently.
void main() {
  vec2 s = warp(v_s);
  outColor = vec4(composite(s), u_hasMask > 0.5 ? personMask(s) : 1.0);
}`;

// Background plate for the invisibility effect, kept in video orientation.
// Pixels the mask marks as background are blended in over time, so the plate
// fills in as the person moves around.
export const PLATE = `#version 300 es
precision highp float;
in vec2 v_s;
out vec4 outColor;
uniform sampler2D u_cam;
uniform sampler2D u_mask;
uniform sampler2D u_prev;
uniform float u_rate;
uniform float u_init;
void main() {
  vec2 uv = vec2(v_s.x, 1.0 - v_s.y);
  vec3 cur = texture(u_cam, uv).rgb;
  if (u_init > 0.5) { outColor = vec4(cur, 1.0); return; }
  vec3 prev = texture(u_prev, uv).rgb;
  float m = texture(u_mask, uv).r;
  const float d = 0.025;
  m = max(m, texture(u_mask, uv + vec2(d, 0.0)).r);
  m = max(m, texture(u_mask, uv - vec2(d, 0.0)).r);
  m = max(m, texture(u_mask, uv + vec2(0.0, d * 1.6)).r);
  m = max(m, texture(u_mask, uv - vec2(0.0, d * 1.6)).r);
  float bgw = 1.0 - smoothstep(0.06, 0.25, m);
  outColor = vec4(mix(prev, cur, clamp(u_rate * bgw, 0.0, 1.0)), 1.0);
}`;

// ---------------------------------------------------------------- Pass B

const FILTER_HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_s;
out vec4 outColor;
uniform sampler2D u_base;
uniform vec2 u_res;
uniform float u_time;
uniform float u_aspect;
${COMMON}
vec3 scene(vec2 s) { return texture(u_base, vec2(s.x, 1.0 - s.y)).rgb; }
float person(vec2 s) { return texture(u_base, vec2(s.x, 1.0 - s.y)).a; }
float edgeMag(vec2 s, float k) {
  vec2 px = k / u_res;
  float tl = luma(scene(s + px * vec2(-1.0, -1.0)));
  float t  = luma(scene(s + px * vec2( 0.0, -1.0)));
  float tr = luma(scene(s + px * vec2( 1.0, -1.0)));
  float l  = luma(scene(s + px * vec2(-1.0,  0.0)));
  float r  = luma(scene(s + px * vec2( 1.0,  0.0)));
  float bl = luma(scene(s + px * vec2(-1.0,  1.0)));
  float b  = luma(scene(s + px * vec2( 0.0,  1.0)));
  float br = luma(scene(s + px * vec2( 1.0,  1.0)));
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  return length(vec2(gx, gy));
}
float vignette(vec2 s, float inner, float outer) {
  return smoothstep(outer, inner, length((s - 0.5) * vec2(u_aspect, 1.0)));
}
`;

// Alpha keeps the person mask so motion effects can cut people out of
// earlier frames.
const FILTER_MAIN = `
void main() { outColor = vec4(clamp(fx(v_s), 0.0, 1.0), person(v_s)); }`;

const BODIES = {
  original: `vec3 fx(vec2 s) { return scene(s); }`,

  cinematic: `
vec3 fx(vec2 s) {
  vec3 c = scene(s);
  float l = luma(c);
  vec3 g = c;
  g = mix(g, g * 0.62 + vec3(0.0, 0.3, 0.36) * 0.38, 0.5 * (1.0 - l));
  g = mix(g, g * 0.82 + vec3(1.0, 0.62, 0.3) * 0.26, 0.4 * l);
  g = mix(g, g * g * (3.0 - 2.0 * g), 0.4);
  g = mix(vec3(luma(g)), g, 1.12);
  g += (hash12(s * u_res + fract(u_time) * 91.0) - 0.5) * 0.035;
  g *= vignette(s, 0.35, 1.05);
  float bar = max(0.0, (1.0 - u_aspect / 2.39) * 0.5);
  if (s.y < bar || s.y > 1.0 - bar) g = vec3(0.0);
  return g;
}`,

  anime: `
vec3 fx(vec2 s) {
  vec2 px = 1.5 / u_res;
  vec3 b = (scene(s) * 4.0 + scene(s + vec2(px.x, 0.0)) + scene(s - vec2(px.x, 0.0))
          + scene(s + vec2(0.0, px.y)) + scene(s - vec2(0.0, px.y))) / 8.0;
  float l = luma(b);
  float band = floor(l * 4.0 + 0.5) / 4.0;
  vec3 hue = b / max(l, 0.05);
  vec3 cel = clamp(hue * mix(band, l, 0.25), 0.0, 1.0);
  cel = mix(vec3(luma(cel)), cel, 1.45) * 1.06 + 0.03;
  float e = smoothstep(0.32, 0.6, edgeMag(s, 1.1));
  return mix(cel, vec3(0.08, 0.05, 0.1), e);
}`,

  aerochrome: `
vec3 fx(vec2 s) {
  vec3 c = scene(s);
  vec3 ir = vec3(clamp(c.g * 1.35 + c.r * 0.15, 0.0, 1.0), c.r * 0.75 + c.b * 0.1, c.b * 1.05 + 0.04);
  ir = mix(vec3(luma(ir)), ir, 1.3);
  return ir * vignette(s, 0.4, 1.1);
}`,

  dreamy: `
vec3 fx(vec2 s) {
  vec3 c = scene(s);
  vec3 bloom = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    float r = i < 6 ? 7.0 : 16.0;
    bloom += scene(s + vec2(cos(a), sin(a)) * r / u_res);
  }
  bloom /= 12.0;
  vec3 col = c * 0.82 + max(bloom - 0.42, 0.0) * 1.9 + vec3(0.07, 0.035, 0.07);
  col *= vec3(1.04, 0.97, 1.06);
  vec2 g = s * vec2(u_aspect, 1.0) * 14.0 + vec2(0.0, u_time * 0.25);
  vec2 id = floor(g);
  float h = hash12(id);
  float tw = 0.5 + 0.5 * sin(u_time * 3.0 + h * 40.0);
  col += smoothstep(0.08, 0.0, length(fract(g) - 0.5)) * step(0.93, h) * tw * 0.6;
  return col;
}`,

  film: `
vec3 fx(vec2 s) {
  float fr = floor(u_time * 18.0);
  vec2 weave = (vec2(hash12(vec2(fr, 1.0)), hash12(vec2(fr, 2.0))) - 0.5) * vec2(0.003, 0.004);
  vec3 c = scene(s + weave);
  float l = luma(c);
  vec3 col = mix(c, vec3(l * 1.07 + 0.04, l * 0.94 + 0.02, l * 0.72), 0.75);
  col *= 0.92 + 0.08 * hash12(vec2(fr, 3.0));
  float sx = hash12(vec2(fr, 4.0));
  col += step(0.6, hash12(vec2(fr, 5.0))) * smoothstep(0.0015, 0.0, abs(s.x - sx)) * 0.35;
  col = mix(col, vec3(0.08), step(0.9985, hash12(floor(s * u_res / 3.0) + fr)) * 0.8);
  col += (hash12(s * u_res + fr) - 0.5) * 0.07;
  return col * vignette(s, 0.25, 0.95);
}`,

  neon: `
vec3 fx(vec2 s) {
  vec2 px = 1.5 / u_res;
  float tl = luma(scene(s + px * vec2(-1.0, -1.0)));
  float t  = luma(scene(s + px * vec2( 0.0, -1.0)));
  float tr = luma(scene(s + px * vec2( 1.0, -1.0)));
  float l  = luma(scene(s + px * vec2(-1.0,  0.0)));
  float r  = luma(scene(s + px * vec2( 1.0,  0.0)));
  float bl = luma(scene(s + px * vec2(-1.0,  1.0)));
  float b  = luma(scene(s + px * vec2( 0.0,  1.0)));
  float br = luma(scene(s + px * vec2( 1.0,  1.0)));
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float g = length(vec2(gx, gy));
  float hue = fract(atan(gy, gx) / 6.2831853 + u_time * 0.07 + s.y * 0.25);
  return hsv2rgb(vec3(hue, 0.85, 1.0)) * smoothstep(0.06, 0.45, g) * 1.7 + scene(s) * 0.05;
}`,

  thermal: `
vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.0, 0.0, 0.12), c1 = vec3(0.2, 0.0, 0.55), c2 = vec3(0.75, 0.0, 0.6);
  vec3 c3 = vec3(1.0, 0.25, 0.0), c4 = vec3(1.0, 0.8, 0.0), c5 = vec3(1.0, 1.0, 0.9);
  if (t < 0.2) return mix(c0, c1, t / 0.2);
  if (t < 0.4) return mix(c1, c2, (t - 0.2) / 0.2);
  if (t < 0.6) return mix(c2, c3, (t - 0.4) / 0.2);
  if (t < 0.8) return mix(c3, c4, (t - 0.6) / 0.2);
  return mix(c4, c5, (t - 0.8) / 0.2);
}
vec3 fx(vec2 s) {
  vec2 px = 2.5 / u_res;
  vec3 c = scene(s) * 2.0 + scene(s + vec2(px.x, 0.0)) + scene(s - vec2(px.x, 0.0))
         + scene(s + vec2(0.0, px.y)) + scene(s - vec2(0.0, px.y));
  c /= 6.0;
  float l = luma(c);
  float body = 0.56 + 0.44 * (l * 0.6 + c.r * 0.4);
  float room = 0.1 + 0.36 * l;
  return heat(mix(room, body, smoothstep(0.1, 0.9, person(s))));
}`,

  night: `
vec3 fx(vec2 s) {
  float l = pow(luma(scene(s)), 0.7) * 1.55;
  float n = hash12(s * u_res + fract(u_time) * 173.0);
  vec3 col = vec3(0.12, 1.0, 0.3) * (l + (n - 0.5) * 0.28);
  col *= 0.86 + 0.14 * sin(s.y * u_res.y * 0.75);
  col *= vignette(s, 0.3, 0.95);
  return col;
}`,

  comic: `
vec3 fx(vec2 s) {
  vec3 c = scene(s);
  float e = smoothstep(0.35, 0.8, edgeMag(s, 1.2));
  vec3 p = floor(c * 4.0 + 0.5) / 4.0;
  p = mix(vec3(luma(p)), p, 1.6);
  mat2 rot = mat2(0.7071, -0.7071, 0.7071, 0.7071);
  vec2 cell = fract(rot * (s * u_res / 7.0)) - 0.5;
  float r = sqrt(max(1.0 - luma(c), 0.0)) * 0.55;
  float dotm = smoothstep(r, r - 0.08, length(cell));
  p *= mix(1.0, 0.72, dotm * step(luma(c), 0.62));
  return mix(clamp(p, 0.0, 1.0), vec3(0.04), e);
}`,

  pixel: `
const vec3 PAL[16] = vec3[16](
  vec3(0.0), vec3(0.114, 0.169, 0.325), vec3(0.494, 0.145, 0.325), vec3(0.0, 0.529, 0.318),
  vec3(0.671, 0.322, 0.212), vec3(0.373, 0.341, 0.31), vec3(0.761, 0.765, 0.78), vec3(1.0, 0.945, 0.91),
  vec3(1.0, 0.0, 0.302), vec3(1.0, 0.639, 0.0), vec3(1.0, 0.925, 0.153), vec3(0.0, 0.894, 0.212),
  vec3(0.161, 0.678, 1.0), vec3(0.514, 0.463, 0.612), vec3(1.0, 0.467, 0.659), vec3(1.0, 0.8, 0.667));
vec3 fx(vec2 s) {
  vec2 cs = vec2(u_aspect, 1.0) * 104.0;
  vec2 cell = floor(s * cs);
  vec3 c = scene((cell + 0.5) / cs);
  float bayer = mod(cell.x, 2.0) * 0.5 + mod(cell.y, 2.0) * 0.25 + mod(cell.x + cell.y, 2.0) * 0.125;
  c += (bayer - 0.4375) * 0.16;
  vec3 best = PAL[0];
  float bd = 1e9;
  for (int i = 0; i < 16; i++) {
    vec3 d = (c - PAL[i]) * vec3(0.30, 0.59, 0.11);
    float dd = dot(d, d) + 0.25 * dot(c - PAL[i], c - PAL[i]);
    if (dd < bd) { bd = dd; best = PAL[i]; }
  }
  vec2 f = fract(s * cs);
  return best * (1.0 - step(0.9, max(f.x, f.y)) * 0.22);
}`,

  matrix: `
float glyph(int n, vec2 p) {
  p = floor(p * vec2(-4.0, 4.0) + 2.5);
  if (p.x < 0.0 || p.x > 4.0 || p.y < 0.0 || p.y > 4.0) return 0.0;
  int a = int(p.x + 0.5) + 5 * int(p.y + 0.5);
  return float((n >> a) & 1);
}
vec3 fx(vec2 s) {
  float cell = max(7.0, floor(u_res.y / 110.0));
  vec2 pix = gl_FragCoord.xy;
  vec2 c = floor(pix / cell);
  vec2 uv = (c * cell + cell * 0.5) / u_res;
  vec2 cs = vec2(uv.x, 1.0 - uv.y);
  float g = clamp(pow(luma(scene(cs)), 0.75) * mix(0.3, 1.45, person(cs)), 0.0, 1.0);
  int n = 4096;
  if (g > 0.15) n = 65600;
  if (g > 0.25) n = 163153;
  if (g > 0.35) n = 15255086;
  if (g > 0.45) n = 13121101;
  if (g > 0.55) n = 15252014;
  if (g > 0.65) n = 13195790;
  if (g > 0.78) n = 11512810;
  float on = glyph(n, mod(pix / (cell * 0.5), 2.0) - 1.0);
  float seed = hash12(vec2(c.x, 3.7));
  float rows = u_res.y / cell;
  float head = mod(u_time * (8.0 + seed * 14.0) + seed * rows, rows + 30.0);
  float d = head - (rows - c.y);
  float trail = d >= 0.0 ? exp(-d * 0.09) : 0.0;
  return vec3(0.1, 1.0, 0.35) * on * (0.12 + g * 1.3) + vec3(0.6, 1.0, 0.7) * on * trail * 0.6;
}`,

  glitch: `
vec3 fx(vec2 s) {
  float t = floor(u_time * 12.0);
  float burst = step(0.6, hash12(vec2(t, 1.7)));
  float band = floor(s.y * 18.0);
  float shift = (hash12(vec2(band, t)) - 0.5) * 0.12 * burst * step(0.55, hash12(vec2(band * 1.3, t + 3.0)));
  vec2 q = s + vec2(shift, 0.0);
  float ca = 0.005 + 0.018 * burst;
  vec3 col = vec3(scene(q + vec2(ca, 0.0)).r, scene(q).g, scene(q - vec2(ca, 0.0)).b);
  vec2 blk = floor(s * vec2(16.0, 9.0));
  if (burst > 0.5 && hash12(blk + t) > 0.985) col = 1.0 - col;
  col *= 0.92 + 0.08 * sin(s.y * u_res.y * 1.5 + u_time * 30.0);
  return col;
}`,

  kaleido: `
vec3 fx(vec2 s) {
  vec2 p = (s - 0.5) * vec2(u_aspect, 1.0);
  float r = length(p);
  float seg = 6.2831853 / 8.0;
  float a = mod(atan(p.y, p.x) + u_time * 0.12, seg);
  a = abs(a - seg * 0.5) - 1.9;
  vec2 q = vec2(cos(a), sin(a)) * r * 0.9;
  return scene(clamp(q / vec2(u_aspect, 1.0) + vec2(0.5, 0.45), 0.0, 1.0));
}`,

  twin: `vec3 fx(vec2 s) { return scene(vec2(s.x < 0.5 ? s.x : 1.0 - s.x, s.y)); }`,

  vhs: `
vec3 fx(vec2 s) {
  float wob = sin(s.y * 10.0 + u_time * 2.0) * 0.002
            + (hash12(vec2(floor(s.y * 240.0), floor(u_time * 30.0))) - 0.5) * 0.003;
  float bandPos = fract(u_time * 0.12);
  float band = smoothstep(0.04, 0.0, abs(s.y - bandPos));
  vec2 q = s + vec2(wob + band * 0.03, 0.0);
  vec3 col = vec3(scene(q + vec2(0.004, 0.0)).r, scene(q).g, scene(q - vec2(0.004, 0.0)).b);
  col = mix(col, (scene(q + vec2(0.003, 0.0)) + scene(q - vec2(0.003, 0.0))) * 0.5, 0.3);
  col = col * 0.88 + vec3(0.06, 0.03, 0.07);
  col = mix(vec3(luma(col)), col, 1.25);
  col += (hash12(s * u_res + u_time * 60.0) - 0.5) * 0.08;
  col += band * 0.3;
  col *= 0.9 + 0.1 * sin(s.y * u_res.y * 0.5);
  return col * vignette(s, 0.45, 1.05);
}`,

  popart: `
vec3 fx(vec2 s) {
  vec2 cell = floor(s * 2.0);
  vec2 q = fract(s * 2.0);
  float l = smoothstep(0.1, 0.9, luma(scene(q)));
  int idx = int(cell.x) + 2 * int(cell.y);
  vec3 d0, d1, d2;
  if (idx == 0)      { d0 = vec3(0.12, 0.05, 0.35); d1 = vec3(1.0, 0.2, 0.6);  d2 = vec3(1.0, 0.92, 0.3); }
  else if (idx == 1) { d0 = vec3(0.05, 0.2, 0.3);   d1 = vec3(0.0, 0.85, 0.75); d2 = vec3(1.0, 0.55, 0.75); }
  else if (idx == 2) { d0 = vec3(0.3, 0.0, 0.1);    d1 = vec3(1.0, 0.45, 0.0);  d2 = vec3(0.55, 0.95, 1.0); }
  else               { d0 = vec3(0.05, 0.05, 0.25); d1 = vec3(0.55, 0.3, 1.0);  d2 = vec3(0.7, 1.0, 0.35); }
  vec3 col = l < 0.38 ? d0 : (l < 0.66 ? d1 : d2);
  vec2 cp = fract(q * u_res * 0.5 / 6.0) - 0.5;
  if (l >= 0.38 && l < 0.66) col = mix(col, col * 0.75, step(length(cp), 0.28));
  float gut = min(min(q.x, 1.0 - q.x) * u_res.x, min(q.y, 1.0 - q.y) * u_res.y) * 0.5;
  return mix(col, vec3(0.02), step(gut, 3.0));
}`,

  xray: `
vec3 fx(vec2 s) {
  float l = pow(1.0 - luma(scene(s)), 1.6);
  float e = smoothstep(0.2, 0.8, edgeMag(s, 1.3));
  vec3 col = vec3(0.55, 0.82, 1.0) * l + vec3(0.85, 0.96, 1.0) * e * 0.8;
  return col * vignette(s, 0.4, 1.1);
}`,

  sketch: `
vec3 fx(vec2 s) {
  float l = luma(scene(s));
  float ink = smoothstep(0.25, 0.75, edgeMag(s, 1.0) * 1.3);
  vec2 p = s * u_res;
  float h1 = 1.0 - smoothstep(0.0, 1.1, abs(mod(p.x + p.y, 7.0) - 3.5));
  float h2 = 1.0 - smoothstep(0.0, 1.1, abs(mod(p.x - p.y, 7.0) - 3.5));
  float h3 = 1.0 - smoothstep(0.0, 1.1, abs(mod(p.y, 5.0) - 2.5));
  float shade = h1 * step(l, 0.62) + h2 * step(l, 0.4) + h3 * step(l, 0.2);
  vec3 paper = vec3(0.965, 0.945, 0.9) - hash12(floor(p / 2.0)) * 0.03;
  return paper * (1.0 - clamp(ink + shade * 0.32, 0.0, 0.92));
}`,

  oil: `
vec3 fx(vec2 s) {
  vec2 px = 2.6 / u_res;
  vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
  vec3 q0 = vec3(0.0), q1 = vec3(0.0), q2 = vec3(0.0), q3 = vec3(0.0);
  for (int j = 0; j <= 3; j++) {
    for (int i = 0; i <= 3; i++) {
      vec2 o = vec2(float(i), float(j)) * px;
      vec3 c;
      c = scene(s + vec2(-o.x, -o.y)); m0 += c; q0 += c * c;
      c = scene(s + vec2( o.x, -o.y)); m1 += c; q1 += c * c;
      c = scene(s + vec2( o.x,  o.y)); m2 += c; q2 += c * c;
      c = scene(s + vec2(-o.x,  o.y)); m3 += c; q3 += c * c;
    }
  }
  m0 /= 16.0; m1 /= 16.0; m2 /= 16.0; m3 /= 16.0;
  float v0 = dot(abs(q0 / 16.0 - m0 * m0), vec3(1.0));
  float v1 = dot(abs(q1 / 16.0 - m1 * m1), vec3(1.0));
  float v2 = dot(abs(q2 / 16.0 - m2 * m2), vec3(1.0));
  float v3 = dot(abs(q3 / 16.0 - m3 * m3), vec3(1.0));
  vec3 col = m0; float mv = v0;
  if (v1 < mv) { mv = v1; col = m1; }
  if (v2 < mv) { mv = v2; col = m2; }
  if (v3 < mv) { mv = v3; col = m3; }
  col = mix(vec3(luma(col)), col, 1.2);
  return col * (0.96 + 0.06 * vnoise(s * u_res / 3.0));
}`,

  fisheye: `
vec3 fx(vec2 s) {
  vec2 p = (s - 0.5) * vec2(u_aspect, 1.0);
  float r = length(p);
  vec2 q = p * (0.55 + 0.9 * r * r);
  return scene(q / vec2(u_aspect, 1.0) + 0.5) * smoothstep(1.05, 0.45, r);
}`,

  duotone: `
vec3 fx(vec2 s) {
  float l = smoothstep(0.05, 0.95, luma(scene(s)));
  vec3 a = vec3(0.13, 0.02, 0.38), b = vec3(1.0, 0.31, 0.64), c = vec3(1.0, 0.93, 0.85);
  return l < 0.5 ? mix(a, b, l * 2.0) : mix(b, c, l * 2.0 - 1.0);
}`,

  noir: `
vec3 fx(vec2 s) {
  float l = pow(smoothstep(0.08, 0.85, luma(scene(s))), 1.2);
  l += (hash12(s * u_res + floor(u_time * 24.0)) - 0.5) * 0.09;
  return vec3(l) * vignette(s, 0.3, 1.0);
}`,

  hex: `
vec3 fx(vec2 s) {
  float size = u_res.y / 46.0;
  vec2 p = s * u_res / size;
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec3 col = scene((p - gv) * size / u_res);
  vec2 q = abs(gv);
  float d = max(dot(q, normalize(r)), q.x);
  float border = smoothstep(0.43, 0.5, d);
  float shine = smoothstep(0.5, 0.0, length(gv + vec2(0.15, 0.2))) * 0.12;
  return col * (1.0 - border * 0.55) + shine;
}`,
};

export function filterSource(id) {
  return FILTER_HEAD + (BODIES[id] || BODIES.original) + FILTER_MAIN;
}

// ---------------------------------------------------------------- Pass C

export const COPY = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_res;
void main() { outColor = texture(u_src, gl_FragCoord.xy / u_res); }`;

export const SCAN = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_scene;
uniform sampler2D u_frozen;
uniform vec2 u_res;
uniform float u_line;
uniform int u_dir;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 s = vec2(uv.x, 1.0 - uv.y);
  float pos = u_dir == 0 ? s.y : s.x;
  vec3 col = pos < u_line ? texture(u_frozen, uv).rgb : texture(u_scene, uv).rgb;
  float px = u_dir == 0 ? 1.0 / u_res.y : 1.0 / u_res.x;
  float d = abs(pos - u_line);
  float visible = step(u_line, 1.0);
  col += vec3(0.2, 0.9, 1.0) * (smoothstep(px * 2.5, 0.0, d) * 1.4 + exp(-d * 140.0) * 0.45) * visible;
  outColor = vec4(col, 1.0);
}`;

export const TRAIL = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_cur;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_keep;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  outColor = vec4(mix(texture(u_cur, uv).rgb, texture(u_prev, uv).rgb, u_keep), 1.0);
}`;

// Plays frames back from the motion ring buffer. Mode 0 shows one stored
// frame; mode 1 composites up to four earlier cut-outs of the person behind
// the live picture.
export const MOTION = `#version 300 es
precision highp float;
precision highp sampler2DArray;
out vec4 outColor;
uniform sampler2DArray u_ring;
uniform sampler2D u_live;
uniform vec2 u_res;
uniform int u_mode;
uniform float u_layer;
uniform vec4 u_clones;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  if (u_mode == 0) {
    outColor = vec4(texture(u_ring, vec3(uv, u_layer)).rgb, 1.0);
    return;
  }
  vec4 live = texture(u_live, uv);
  vec3 col = live.rgb;
  float liveA = smoothstep(0.35, 0.8, live.a);
  for (int i = 3; i >= 0; i--) {
    float L = u_clones[i];
    if (L < 0.0) continue;
    vec4 c = texture(u_ring, vec3(uv, L));
    float a = smoothstep(0.35, 0.8, c.a) * (1.0 - liveA) * (0.9 - float(i) * 0.13);
    col = mix(col, mix(c.rgb, c.rgb * vec3(1.0, 0.72, 0.42), 0.2 + float(i) * 0.12), a);
  }
  outColor = vec4(col, 1.0);
}`;

export const TRAIL_SHOW = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_cur;
uniform sampler2D u_acc;
uniform vec2 u_res;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  outColor = vec4(mix(texture(u_acc, uv).rgb, texture(u_cur, uv).rgb, 0.5), 1.0);
}`;
