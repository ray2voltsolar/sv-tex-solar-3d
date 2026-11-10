// ============================================================================
//  STRUCTURES — procedural canvas textures (no downloaded assets)
// ============================================================================
import * as THREE from 'three';

// ---------------------------------------------------------------- noise
function hash(ix, iy, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** periodic value noise, periods px/py integers (in noise cells) */
function vnoise(x, y, px, py, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((iy % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** fbm on u,v ∈ [0,1) tileable; fu/fv = base cell counts */
export function fbm(u, v, fu, fv, oct = 4, s = 0) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * fu * f, v * fv * f, fu * f, fv * f, s + o * 17);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** Fill pixels: fn(u, v, out[3]) with v = 0 at the BOTTOM row (texture convention). */
function fill(c, fn) {
  const g = c.getContext('2d'); const w = c.width, h = c.height;
  const img = g.createImageData(w, h); const d = img.data; const o = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      fn((x + 0.5) / w, v, o);
      const i = (y * w + x) * 4;
      d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return g;
}

function tex(c, { srgb = true, repeat = true, aniso = 8, clampT = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat && !clampT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Normal map from a height function h(u,v) (tileable), strength in "pixels". */
function normalMapFrom(w, h, hf, strength = 2, aniso = 8) {
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = hf((x + 0.5) / w, 1 - (y + 0.5) / h);
  const c = canvas(w, h); const g = c.getContext('2d'); const img = g.createImageData(w, h); const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = H[y * w + ((x - 1 + w) % w)], r = H[y * w + ((x + 1) % w)];
    const t = H[((y - 1 + h) % h) * w + x], b = H[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (b - t) * strength, nz = 1; // canvas y down → v up
    const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const i = (y * w + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false, aniso });
}

/** Draw downward-fading streaks (canvas top = texture top). Wraps horizontally. */
function streaks(g, w, h, R, n, { y0 = 0, len = [0.2, 0.8], wid = [1, 6], alpha = [0.04, 0.2], col = '40,40,36', xs = null } = {}) {
  for (let i = 0; i < n; i++) {
    const x = xs ? xs[i % xs.length] + (R() - 0.5) * w * 0.01 : R() * w;
    const L = mix(len[0], len[1], R()) * h, W = mix(wid[0], wid[1], R()), A = mix(alpha[0], alpha[1], R());
    const top = y0 * h + (R() - 0.2) * 3;
    const gr = g.createLinearGradient(0, top, 0, top + L);
    gr.addColorStop(0, `rgba(${col},${A})`); gr.addColorStop(0.6, `rgba(${col},${A * 0.5})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    for (const dx of [0, -w, w]) g.fillRect(x + dx - W / 2, top, W, L);
  }
}

// ======================================================================
//  Individual textures. S = size factor (1 high, .5 medium, .25 low)
// ======================================================================

/** Painted plaster compound wall: tile 8 m × wall height; v=0 ground, v=1 wall top. */
export function plasterWall(S, aniso) {
  const w = Math.max(256, 2048 * S | 0), h = Math.max(64, 512 * S | 0);
  const c = canvas(w, h); const R = rng(11);
  const g = fill(c, (u, v, o) => {
    const n1 = fbm(u, v, 32, 4, 4, 1), n2 = fbm(u, v, 8, 1, 3, 5), n3 = fbm(u, v, 128, 16, 2, 9);
    let r = 200, gg = 198, b = 189;
    const mott = (n1 - 0.5) * 30 + (n2 - 0.5) * 26 + (n3 - 0.5) * 10;
    r += mott; gg += mott; b += mott * 0.9;
    // chalky grey patches
    const patch = smooth(0.58, 0.72, n2);
    r = mix(r, 178, patch * 0.5); gg = mix(gg, 176, patch * 0.5); b = mix(b, 168, patch * 0.5);
    // peeled paint → grey cement plaster
    const peel = smooth(0.7, 0.8, fbm(u, v, 16, 2, 5, 21)) * smooth(0.1, 0.4, v) * 0.6;
    r = mix(r, 165, peel); gg = mix(gg, 163, peel); b = mix(b, 156, peel);
    // laterite splash band at the base
    const splash = Math.pow(clamp(1 - v / 0.22), 1.4) * (0.55 + 0.6 * fbm(u, v, 96, 12, 3, 33));
    r = mix(r, 152, clamp(splash)); gg = mix(gg, 112, clamp(splash)); b = mix(b, 86, clamp(splash));
    // damp / algae near ground
    const damp = smooth(0.52, 0.7, fbm(u, v, 12, 2, 4, 41)) * Math.pow(clamp(1 - v / 0.42), 1.2);
    r = mix(r, 92, damp * 0.75); gg = mix(gg, 96, damp * 0.75); b = mix(b, 82, damp * 0.75);
    // ---- LOW-FREQUENCY weathering (polish r2): must survive mip-mapping at 40-80 m (WA0010).
    // Features are 0.3-2 m wide so they stay in the 1/8..1/32 mips.
    const d = 1 - v; // depth below the coping (0 top .. 1 ground)
    // (a) rain-wash curtains hanging from the coping: per-column strength & length (1-D noise in u)
    const colA = fbm(u, 0.31, 40, 1, 3, 61), colB = fbm(u, 0.77, 10, 1, 3, 63);
    const cLen = 0.25 + 0.85 * fbm(u, 0.13, 24, 1, 2, 65);
    const curtain = clamp(smooth(0.42, 0.72, colA) * 0.75 + smooth(0.45, 0.7, colB) * 0.55)
      * (1 - smooth(cLen * 0.35, cLen, d)) * (0.75 + 0.5 * fbm(u, v, 64, 3, 2, 67));
    r = mix(r, 74, curtain * 0.52); gg = mix(gg, 80, curtain * 0.52); b = mix(b, 70, curtain * 0.52);
    // (b) black-green mould blotches climbing from the ground over the bottom ~45 %
    const reach = 0.18 + 0.32 * fbm(u, 0.5, 14, 1, 3, 71);
    const mould = smooth(0.42, 0.62, fbm(u, v, 20, 3, 5, 73)) * (1 - smooth(reach * 0.6, reach + 0.12, v));
    r = mix(r, 40, mould * 0.78); gg = mix(gg, 49, mould * 0.78); b = mix(b, 37, mould * 0.78);
    // (c) broad soiling / uneven repaint (patchy, metre scale)
    const soil = fbm(u, v, 6, 1, 3, 81);
    const k = 0.84 + 0.22 * soil;
    r *= k; gg *= k; b *= k * 0.98;
    o[0] = clamp(r, 0, 255); o[1] = clamp(gg, 0, 255); o[2] = clamp(b, 0, 255);
  });
  // grime band under the coping + rain streaks from the top
  const gt = g.createLinearGradient(0, 0, 0, h * 0.12);
  gt.addColorStop(0, 'rgba(50,54,46,0.7)'); gt.addColorStop(0.4, 'rgba(60,62,54,0.35)'); gt.addColorStop(1, 'rgba(70,70,62,0)');
  g.fillStyle = gt; g.fillRect(0, 0, w, h * 0.18);
  streaks(g, w, h, R, 70, { len: [0.2, 0.95], wid: [w / 2048 * 10, w / 2048 * 60], alpha: [0.05, 0.2], col: '70,70,62' });
  streaks(g, w, h, R, 50, { len: [0.15, 0.85], wid: [w / 2048 * 3, w / 2048 * 14], alpha: [0.06, 0.22], col: '58,58,52' });
  streaks(g, w, h, R, 30, { len: [0.3, 0.95], wid: [w / 2048 * 1, w / 2048 * 4], alpha: [0.12, 0.3], col: '45,44,40' });
  // black algae drip streaks running down from the coping (WA0009 / WA0010): clustered, narrow, dark
  for (let cl = 0; cl < 16; cl++) {
    const cx = R() * w, n = 2 + (R() * 6 | 0), spread = w * (0.006 + R() * 0.03);
    const xs = Array.from({ length: n }, () => cx + (R() - 0.5) * spread);
    streaks(g, w, h, R, n, { y0: 0.02, len: [0.12, 0.75], wid: [w / 2048 * 1.5, w / 2048 * 7], alpha: [0.08, 0.3], col: '38,42,36', xs });
  }
  // wide dark run-off tongues from the coping joints (~every 3 m; 10-30 cm wide → visible in low mips)
  for (let j = 0; j < 8; j++) {
    const cx = ((j + 0.5) / 8 + (R() - 0.5) * 0.05) * w;
    streaks(g, w, h, R, 3, { y0: 0.0, len: [0.35, 0.95], wid: [w / 2048 * 22, w / 2048 * 70], alpha: [0.18, 0.38], col: '44,50,42', xs: [cx] });
  }
  // greenish-black moss/damp band along the base
  const gb = g.createLinearGradient(0, h, 0, h * 0.72);
  gb.addColorStop(0, 'rgba(48,58,40,0.55)'); gb.addColorStop(0.5, 'rgba(60,70,50,0.25)'); gb.addColorStop(1, 'rgba(70,80,60,0)');
  g.fillStyle = gb; g.fillRect(0, h * 0.72, w, h * 0.28);
  for (let i = 0; i < 60; i++) { // ragged moss tongues climbing up
    const x = R() * w, W = w * (0.003 + R() * 0.012), L = h * (0.06 + R() * 0.22);
    const gr = g.createLinearGradient(0, h, 0, h - L);
    gr.addColorStop(0, 'rgba(40,52,34,0.45)'); gr.addColorStop(1, 'rgba(40,52,34,0)');
    g.fillStyle = gr; g.fillRect(x - W / 2, h - L, W, L);
  }
  // hairline cracks
  g.strokeStyle = 'rgba(60,58,52,0.35)'; g.lineWidth = Math.max(1, w / 2048 * 1.4);
  for (let i = 0; i < 7; i++) {
    let x = R() * w, y = h * (0.1 + R() * 0.8); g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 14; k++) { x += (R() - 0.5) * w * 0.006; y += (R() - 0.3) * h * 0.035; g.lineTo(x, y); }
    g.stroke();
  }
  return tex(c, { aniso, clampT: true });
}

/** Fine plaster/concrete grain normal map (tile 1 m). */
export function grainNormal(S, aniso) {
  const n = Math.max(128, 512 * S | 0);
  return normalMapFrom(n, n, (u, v) => fbm(u, v, 64, 64, 3, 3) * 0.7 + fbm(u, v, 16, 16, 2, 8) * 0.3, 2.2, aniso);
}

/** Weathered grey concrete (tile 3 m). */
export function concrete(S, aniso) {
  const n = Math.max(128, 1024 * S | 0);
  const c = canvas(n, n); const R = rng(5);
  const g = fill(c, (u, v, o) => {
    const a = fbm(u, v, 6, 6, 4, 2), b = fbm(u, v, 48, 48, 3, 4), sp = hash(u * n | 0, v * n | 0, 7);
    let k = 138 + (a - 0.5) * 40 + (b - 0.5) * 18 + (sp > 0.985 ? -28 : sp < 0.01 ? 22 : 0);
    const stain = smooth(0.6, 0.78, fbm(u, v, 4, 4, 4, 12));
    k -= stain * 30;
    o[0] = k + 2; o[1] = k; o[2] = k - 5;
  });
  // formwork joints
  g.fillStyle = 'rgba(60,60,58,0.18)';
  for (let i = 0; i < 3; i++) g.fillRect(0, (i / 3) * n, n, Math.max(1, n / 512));
  streaks(g, n, n, R, 20, { len: [0.1, 0.5], wid: [2, 10], alpha: [0.05, 0.15], col: '50,50,46' });
  return tex(c, { aniso });
}

/** Clarifier tank wall (lathe): v ∈ [0, 1] over profile length total (m); layout {outer, top, inner}. */
export function clarifierWall(S, aniso, layout) {
  const w = Math.max(256, 1024 * S | 0), h = Math.max(128, 512 * S | 0);
  const T = layout.outer + layout.top + layout.inner;
  const vO = layout.outer / T, vT = (layout.outer + layout.top) / T;
  const c = canvas(w, h); const R = rng(77);
  const g = fill(c, (u, v, o) => {
    const a = fbm(u, v, 12, 4, 4, 2), b = fbm(u, v, 64, 16, 3, 6);
    let r = 146 + (a - 0.5) * 36 + (b - 0.5) * 16, gg = r - 2, bb = r - 8;
    if (v < vO) {
      const z = v / vO; // 0 bottom .. 1 top
      const splash = Math.pow(clamp(1 - z / 0.2), 1.5) * (0.5 + 0.6 * b);
      r = mix(r, 140, splash); gg = mix(gg, 108, splash); bb = mix(bb, 86, splash);
      const algae = smooth(0.5, 0.75, fbm(u, v, 20, 3, 4, 31)) * (0.3 + 0.7 * z);
      r = mix(r, 78, algae * 0.5); gg = mix(gg, 84, algae * 0.5); bb = mix(bb, 66, algae * 0.5);
    } else if (v < vT) {
      r -= 12; gg -= 12; bb -= 14;
    } else {
      const z = (v - vT) / (1 - vT); // 0 at rim .. 1 down at the water
      const wet = smooth(0.15, 0.7, z);
      r = mix(r, 66, wet); gg = mix(gg, 70, wet); bb = mix(bb, 52, wet);
      const slime = smooth(0.55, 1.0, z) * (0.6 + 0.4 * b);
      r = mix(r, 58, slime); gg = mix(gg, 74, slime); bb = mix(bb, 40, slime);
    }
    o[0] = clamp(r, 0, 255); o[1] = clamp(gg, 0, 255); o[2] = clamp(bb, 0, 255);
  });
  // overflow / algae streaks running down the OUTER face from the rim (canvas y: 0=top of texture=v1)
  const yRimOuter = (1 - vO) * h; // canvas y of outer top edge
  const g2 = g;
  for (let i = 0; i < 70; i++) {
    const x = R() * w, L = mix(0.2, 0.95, R()) * vO * h, W = mix(2, 16, R()) * w / 1024, A = mix(0.06, 0.28, R());
    const gr = g2.createLinearGradient(0, yRimOuter, 0, yRimOuter + L);
    const col = R() < 0.5 ? '42,48,36' : '62,60,50';
    gr.addColorStop(0, `rgba(${col},${A})`); gr.addColorStop(1, `rgba(${col},0)`);
    g2.fillStyle = gr; for (const dx of [0, -w, w]) g2.fillRect(x + dx - W / 2, yRimOuter, W, L);
  }
  return tex(c, { aniso, clampT: true });
}

/** Chimney stack bands: u around (1 repeat), v = (z - z0) / span. */
export function stackBands(S, aniso, { z0, zTop, span, bandH, dark, light, innerFrom }) {
  const w = Math.max(64, 256 * S | 0), h = Math.max(512, 2048 * S | 0);
  const c = canvas(w, h); const R = rng(3);
  const dc = new THREE.Color(dark), lc = new THREE.Color(light);
  const D = [dc.r * 255, dc.g * 255, dc.b * 255], L = [lc.r * 255, lc.g * 255, lc.b * 255];
  // sRGB hex → canvas expects sRGB values: THREE.Color stores linear when ColorManagement enabled, convert back
  const dS = new THREE.Color(dark).getStyle(), lS = new THREE.Color(light).getStyle();
  const parse = (s) => s.match(/\d+(\.\d+)?/g).map(Number);
  const DD = parse(dS).slice(0, 3), LL = parse(lS).slice(0, 3);
  void D; void L;
  const g = fill(c, (u, v, o) => {
    const z = z0 + v * span;
    const n = fbm(u, v, 4, 64, 4, 3), f = fbm(u, v, 16, 256, 2, 7);
    if (z > innerFrom) { const k = 28 + n * 14; o[0] = k; o[1] = k; o[2] = k; return; } // inside the flue: soot
    const k = Math.floor((zTop - z) / bandH); const isDark = k % 2 === 0;
    const base = isDark ? DD : LL;
    let r = base[0], gg = base[1], b = base[2];
    const var1 = (n - 0.5) * (isDark ? 18 : 26) + (f - 0.5) * 8;
    r += var1; gg += var1; b += var1;
    if (!isDark) { // chalky, dusty white with a slight warm tint
      const dirt = 0.25 + smooth(0.45, 0.8, fbm(u, v, 6, 96, 3, 13)) * 0.35;
      r = mix(r, 172, dirt); gg = mix(gg, 168, dirt); b = mix(b, 158, dirt);
    }
    // soot near the top outlet
    const soot = smooth(zTop - 1.6, zTop, z);
    r = mix(r, 30, soot * 0.85); gg = mix(gg, 30, soot * 0.85); b = mix(b, 30, soot * 0.85);
    o[0] = clamp(r, 0, 255); o[1] = clamp(gg, 0, 255); o[2] = clamp(b, 0, 255);
  });
  // rust streaks below band joints / welds
  const yOf = (z) => (1 - (z - z0) / span) * h;
  for (let k = 1; k * bandH < zTop - z0; k++) {
    const zj = zTop - k * bandH; const y = yOf(zj);
    g.fillStyle = 'rgba(30,30,30,0.35)'; g.fillRect(0, y - 1, w, 2);
    for (let i = 0; i < 6; i++) {
      const x = R() * w, Lh = (0.4 + R() * 1.6) / span * h, W = 1 + R() * 3, A = 0.08 + R() * 0.2;
      const gr = g.createLinearGradient(0, y, 0, y + Lh);
      gr.addColorStop(0, `rgba(120,64,30,${A})`); gr.addColorStop(1, 'rgba(120,64,30,0)');
      g.fillStyle = gr; g.fillRect(x - W / 2, y, W, Lh);
    }
  }
  // soot streaks dripping from the top
  for (let i = 0; i < 14; i++) {
    const x = R() * w, y = yOf(zTop - 1.0), Lh = (0.8 + R() * 3) / span * h, W = 1 + R() * 4;
    const gr = g.createLinearGradient(0, y, 0, y + Lh);
    gr.addColorStop(0, 'rgba(25,25,25,0.4)'); gr.addColorStop(1, 'rgba(25,25,25,0)');
    g.fillStyle = gr; g.fillRect(x - W / 2, y, W, Lh);
  }
  return tex(c, { aniso, clampT: true });
}

function hexToRGB(hex) { const c = new THREE.Color(hex); const s = c.getStyle().match(/\d+(\.\d+)?/g).map(Number); return s.slice(0, 3); }

/**
 * Profiled sheet colour texture.
 *  mode 'H' (green screen, horizontal ribs): u = along run (tileU m), v = across band (tileV m, 0=bottom).
 *  mode 'V' (gate/fence, vertical ribs):     u = across (tileU m), v = height (tileV m, 0=bottom).
 */
export function sheet(S, aniso, { color, mode = 'H', tileU = 12, tileV = 1.25, sheetLen = 3.0, screwsU = 3.0, screwRowsV = [], seed = 1, pitch = 0.24, fade = 0.15, tintVar = 16, ribs = null }) {
  const w = Math.max(256, (mode === 'H' ? 2048 : 1024) * S | 0), h = Math.max(64, (mode === 'H' ? 256 : 1024) * S | 0);
  const base = hexToRGB(color); const R = rng(seed);
  const nSheets = Math.round(tileU / sheetLen); const tints = Array.from({ length: nSheets + 1 }, () => (R() - 0.5) * tintVar);
  const c = canvas(w, h);
  const g = fill(c, (u, v, o) => {
    const si = Math.floor(u * nSheets); const t = tints[si];
    const n1 = fbm(u, v, 24, 2, 4, seed), n2 = fbm(u, v, 96, 8, 2, seed + 3);
    let r = base[0] + t + (n1 - 0.5) * 14 + (n2 - 0.5) * 6, gg = base[1] + t + (n1 - 0.5) * 14 + (n2 - 0.5) * 6, b = base[2] + t + (n1 - 0.5) * 12;
    // UV fading / chalking (lighter, desaturated) in patches
    const f = smooth(0.45, 0.85, fbm(u, v, 6, 1, 3, seed + 9)) * fade;
    const lum = (r + gg + b) / 3 + 25;
    r = mix(r, lum, f); gg = mix(gg, lum, f); b = mix(b, lum, f);
    // dust: settles toward the bottom (V) or on everything (H, lighter at bottom)
    const yb = mode === 'V' ? v * tileV : v;
    const dust = mode === 'V' ? Math.pow(clamp(1 - yb / 0.6), 1.6) * (0.6 + 0.4 * n2) : (1 - v) * 0.12 * (0.6 + 0.6 * n1);
    r = mix(r, 168, dust * 0.7); gg = mix(gg, 140, dust * 0.7); b = mix(b, 112, dust * 0.7);
    o[0] = clamp(r, 0, 255); o[1] = clamp(gg, 0, 255); o[2] = clamp(b, 0, 255);
  });
  const ppmU = w / tileU, ppmV = h / tileV;
  // sheet laps
  g.fillStyle = 'rgba(15,20,20,0.45)';
  for (let i = 0; i <= nSheets; i++) g.fillRect(i * sheetLen * ppmU - 1, 0, Math.max(1.5, ppmU * 0.012), h);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (let i = 0; i <= nSheets; i++) g.fillRect(i * sheetLen * ppmU + 1, 0, Math.max(1, ppmU * 0.006), h);
  // screws + rust drips from them
  const screwR = Math.max(1, ppmU * 0.008);
  const drawScrew = (x, y) => {
    if (R() < 0.6) {
      const Lh = (0.05 + R() * 0.4) * ppmV, A = 0.1 + R() * 0.25;
      const gr = g.createLinearGradient(0, y, 0, y + Lh);
      gr.addColorStop(0, `rgba(125,62,25,${A})`); gr.addColorStop(1, 'rgba(125,62,25,0)');
      g.fillStyle = gr; g.fillRect(x - screwR * 0.8, y, screwR * 1.6, Lh);
    }
    g.fillStyle = 'rgba(40,40,40,0.8)'; g.beginPath(); g.arc(x, y, screwR, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(220,220,220,0.35)'; g.beginPath(); g.arc(x - screwR * 0.3, y - screwR * 0.3, screwR * 0.45, 0, Math.PI * 2); g.fill();
  };
  if (mode === 'H' && ribs) {
    // painted rib shading (mip-friendly, unlike the geometric flanks): shadowed lower flank,
    // soft highlight on the upper flank/crest. ribs = { phase, pitch, pan, slope, crest } in metres
    const { phase: ph, pan, slope: sl, crest: cr } = ribs;
    for (let b = ph - pitch; b < tileV + pitch; b += pitch) {
      const lo = b + pan / 2, hiC = lo + sl + cr;
      const y = (m) => h - m * ppmV;
      let gr = g.createLinearGradient(0, y(lo - 0.02), 0, y(lo + sl + 0.005));
      gr.addColorStop(0, 'rgba(8,16,14,0)'); gr.addColorStop(0.55, 'rgba(8,16,14,0.32)'); gr.addColorStop(1, 'rgba(8,16,14,0.42)');
      g.fillStyle = gr; g.fillRect(0, y(lo + sl + 0.005), w, (sl + 0.025) * ppmV);
      gr = g.createLinearGradient(0, y(hiC - 0.01), 0, y(hiC + sl + 0.01));
      gr.addColorStop(0, 'rgba(200,225,215,0.05)'); gr.addColorStop(0.6, 'rgba(200,225,215,0.13)'); gr.addColorStop(1, 'rgba(200,225,215,0)');
      g.fillStyle = gr; g.fillRect(0, y(hiC + sl + 0.01), w, (sl + 0.02) * ppmV);
    }
  }
  if (mode === 'H') {
    for (let x = 0; x < tileU + 1e-6; x += screwsU) for (let vb = 0.03; vb < tileV; vb += pitch) drawScrew(x * ppmU, h - vb * ppmV);
    streaks(g, w, h, R, 40, { len: [0.3, 1.0], wid: [2, 10], alpha: [0.03, 0.1], col: '20,25,22' });
  } else {
    for (const vr of screwRowsV) for (let x = pitch / 2; x < tileU; x += pitch) drawScrew(x * ppmU, h - vr * ppmV);
    streaks(g, w, h, R, 26, { len: [0.2, 0.7], wid: [3, 14], alpha: [0.04, 0.12], col: '30,32,40' });
    // scratches / scuffs low down
    g.strokeStyle = 'rgba(220,225,230,0.25)'; g.lineWidth = 1;
    for (let i = 0; i < 40; i++) { const x = R() * w, y = h * (0.6 + R() * 0.38); g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 30, y + (R() - 0.5) * 8); g.stroke(); }
  }
  return tex(c, { aniso });
}

/** Back (primer) side of PPGI sheets. */
export function sheetBack(S, aniso) {
  const n = Math.max(64, 256 * S | 0); const c = canvas(n, n);
  fill(c, (u, v, o) => { const k = 196 + (fbm(u, v, 8, 8, 3, 2) - 0.5) * 26; o[0] = k; o[1] = k + 2; o[2] = k - 2; });
  return tex(c, { aniso });
}

/** Murky water: colour (tile 6 m) and ripple normal (tile 3 m). */
export function water(S, aniso) {
  const n = Math.max(128, 512 * S | 0);
  const c = canvas(n, n);
  fill(c, (u, v, o) => {
    const a = fbm(u, v, 4, 4, 4, 5), b = fbm(u, v, 16, 16, 3, 8);
    let k = 0.75 + (a - 0.5) * 0.4 + (b - 0.5) * 0.15;
    const foam = smooth(0.66, 0.8, fbm(u, v, 8, 8, 4, 21)) * 0.8;
    const r = mix(k * 255, 225, foam), g = mix(k * 255, 220, foam), bb = mix(k * 255, 200, foam);
    o[0] = clamp(r, 0, 255); o[1] = clamp(g, 0, 255); o[2] = clamp(bb, 0, 255);
  });
  const color = tex(c, { aniso });
  const nm = normalMapFrom(n, n, (u, v) => {
    let s = 0;
    s += Math.sin((u * 7 + v * 3) * Math.PI * 2) * 0.25 + Math.sin((u * -4 + v * 9) * Math.PI * 2) * 0.2;
    s += Math.sin((u * 13 - v * 11) * Math.PI * 2) * 0.1;
    s += fbm(u, v, 12, 12, 4, 3) * 0.9;
    return s;
  }, 3.0, aniso);
  return { color, normal: nm };
}

/** Chequer plate normal (tile 0.3 m). */
export function chequerNormal(S, aniso) {
  const n = Math.max(64, 256 * S | 0);
  return normalMapFrom(n, n, (u, v) => {
    const cells = 6; const cu = u * cells, cv = v * cells;
    const iu = Math.floor(cu), iv = Math.floor(cv), fu = cu - iu - 0.5, fv = cv - iv - 0.5;
    const alt = (iu + iv) % 2 === 0;
    const a = alt ? (fu + fv) : (fu - fv), b = alt ? (fu - fv) : (fu + fv);
    const lens = Math.max(0, 1 - (a * a) / 0.12 - (b * b) / 0.012);
    return Math.sqrt(lens) * 0.7 + fbm(u, v, 16, 16, 2, 4) * 0.15;
  }, 3.0, aniso);
}

/** Steel bar grating alpha (tile 0.2 m): bearing bars every 33 mm, cross bars every 100 mm. */
export function gratingAlpha(S, aniso) {
  const n = Math.max(64, 256 * S | 0); const c = canvas(n, n);
  fill(c, (u, v, o) => {
    const bu = (u * 6) % 1, bv = (v * 2) % 1;
    const on = bu < 0.2 || bv < 0.06;
    const k = on ? 255 : 0; o[0] = k; o[1] = k; o[2] = k;
  });
  return tex(c, { srgb: false, aniso });
}

/** Brickwork (tile 0.94 m × 0.6 m: 4 bricks × 8 courses). */
export function brick(S, aniso) {
  const w = Math.max(128, 512 * S | 0), h = Math.max(80, 320 * S | 0);
  const R = rng(9); const cols = 4, rows = 8;
  const tint = Array.from({ length: rows * cols * 2 }, () => [R(), R()]);
  const mortar = (u, v) => {
    const row = Math.floor(v * rows); const off = row % 2 ? 0.5 : 0; const cu = u * cols + off;
    const fu = cu - Math.floor(cu), fv = v * rows - row;
    const m = Math.min(fu, 1 - fu) * 0.235 / 1, n = Math.min(fv, 1 - fv) * 0.075;
    return { m: Math.min(m, n), id: row * cols * 2 + (Math.floor(cu) % (cols * 2)) };
  };
  const c = canvas(w, h);
  fill(c, (u, v, o) => {
    const { m, id } = mortar(u, v);
    const nz = fbm(u, v, 24, 16, 3, 4);
    if (m < 0.006) { const k = 150 + nz * 30; o[0] = k; o[1] = k - 6; o[2] = k - 14; return; }
    const [t1, t2] = tint[id % tint.length];
    let r = 122 + t1 * 40 + (nz - 0.5) * 30, g = 70 + t2 * 22 + (nz - 0.5) * 18, b = 56 + t2 * 16 + (nz - 0.5) * 14;
    const soot = smooth(0.55, 0.8, fbm(u, v, 4, 3, 3, 12)) * 0.6;
    r = mix(r, 50, soot); g = mix(g, 42, soot); b = mix(b, 38, soot);
    o[0] = clamp(r, 0, 255); o[1] = clamp(g, 0, 255); o[2] = clamp(b, 0, 255);
  });
  const map = tex(c, { aniso });
  const normal = normalMapFrom(w, h, (u, v) => { const { m } = mortar(u, v); return smooth(0.0, 0.012, m) + fbm(u, v, 24, 16, 2, 4) * 0.2; }, 2.5, aniso);
  return { map, normal };
}

/** Aluminium insulation cladding (tile 1 m × 1 m): circumferential laps at v = 0. */
export function alumCladding(S, aniso) {
  const n = Math.max(128, 512 * S | 0); const c = canvas(n, n); const R = rng(14);
  const g = fill(c, (u, v, o) => {
    const a = fbm(u, v, 4, 4, 4, 2), b = fbm(u, v, 32, 32, 2, 6);
    let k = 168 + (a - 0.5) * 30 + (b - 0.5) * 10;
    const grime = smooth(0.55, 0.85, fbm(u, v, 6, 3, 3, 9)) * 0.45;
    let r = mix(k, 120, grime), gg = mix(k, 114, grime), bb = mix(k, 104, grime);
    o[0] = r; o[1] = gg; o[2] = bb;
  });
  g.fillStyle = 'rgba(40,40,40,0.55)'; g.fillRect(0, n - Math.max(2, n / 128), n, Math.max(2, n / 128));
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, n - Math.max(3, n / 80) - 2, n, Math.max(1, n / 256));
  // bands / straps
  g.fillStyle = 'rgba(70,70,70,0.4)'; g.fillRect(0, n * 0.48, n, Math.max(1, n / 256));
  streaks(g, n, n, R, 14, { len: [0.2, 1.0], wid: [2, 8], alpha: [0.05, 0.15], col: '60,55,45' });
  const map = tex(c, { aniso });
  const normal = normalMapFrom(n, n, (u, v) => fbm(u, v, 6, 6, 3, 31) * 0.8 + (v < 0.015 ? 1 : 0) * 0.6, 1.5, aniso);
  return { map, normal };
}

/** Logs: left half bark (u 0..0.5), right half end grain (u 0.5..1). */
export function logs(S, aniso) {
  const w = Math.max(128, 512 * S | 0), h = Math.max(64, 256 * S | 0); const c = canvas(w, h);
  fill(c, (u, v, o) => {
    if (u < 0.5) {
      const uu = u * 2; const crack = fbm(uu, v, 24, 3, 3, 4); const n = fbm(uu, v, 8, 8, 3, 2);
      let k = 88 + (n - 0.5) * 40 - smooth(0.55, 0.7, crack) * 40;
      o[0] = k + 10; o[1] = k - 4; o[2] = k - 18;
    } else {
      const uu = (u - 0.5) * 2 - 0.5, vv = v - 0.5; const r = Math.hypot(uu, vv) * 2;
      const ring = 0.5 + 0.5 * Math.sin(r * 40 + fbm(u, v, 8, 8, 2, 3) * 8);
      let k = 178 - ring * 26 - r * 25;
      if (r > 0.9) k = 80;
      const check = smooth(0.62, 0.7, fbm(u, v, 12, 12, 3, 8)) * 40;
      o[0] = k - check * 0.5; o[1] = k - 22 - check * 0.6; o[2] = k - 55 - check * 0.6;
    }
  });
  return tex(c, { aniso });
}

/** Painted steel with rust & dirt (tile 1 m). colour hex. */
export function paintedSteel(S, aniso, color, rust = 0.5, seed = 4) {
  const n = Math.max(64, 256 * S | 0); const c = canvas(n, n); const base = hexToRGB(color);
  fill(c, (u, v, o) => {
    const a = fbm(u, v, 6, 6, 4, seed), b = fbm(u, v, 24, 24, 3, seed + 2);
    let r = base[0] + (a - 0.5) * 22, g = base[1] + (a - 0.5) * 22, bb = base[2] + (a - 0.5) * 20;
    const rs = smooth(0.7 - rust * 0.15, 0.8, fbm(u, v, 10, 10, 4, seed + 7)) * (0.6 + 0.4 * b);
    r = mix(r, 118, rs); g = mix(g, 64, rs); bb = mix(bb, 34, rs);
    o[0] = clamp(r, 0, 255); o[1] = clamp(g, 0, 255); o[2] = clamp(bb, 0, 255);
  });
  return tex(c, { aniso });
}

/** Galvanised steel mottle (tile 1 m). */
export function galv(S, aniso) {
  const n = Math.max(64, 256 * S | 0); const c = canvas(n, n);
  fill(c, (u, v, o) => {
    const a = fbm(u, v, 8, 8, 4, 2), sp = fbm(u, v, 48, 48, 2, 5);
    let k = 172 + (a - 0.5) * 34 + (sp - 0.5) * 16;
    const dull = smooth(0.6, 0.8, fbm(u, v, 4, 4, 3, 9)) * 0.3;
    k = mix(k, 150, dull);
    o[0] = k; o[1] = k + 2; o[2] = k + 4;
  });
  return tex(c, { aniso });
}

/** HDPE tank surface (tile 1 m) — off-white with grime. */
export function hdpe(S, aniso) {
  const n = Math.max(64, 256 * S | 0); const c = canvas(n, n); const R = rng(31);
  const g = fill(c, (u, v, o) => {
    const a = fbm(u, v, 6, 6, 4, 3);
    const k = 226 + (a - 0.5) * 22; const dirt = Math.pow(1 - v, 3) * 0.4;
    o[0] = mix(k, 150, dirt); o[1] = mix(k - 2, 130, dirt); o[2] = mix(k - 8, 100, dirt);
  });
  streaks(g, n, n, R, 10, { len: [0.2, 0.7], wid: [2, 6], alpha: [0.05, 0.14], col: '90,80,60' });
  return tex(c, { aniso });
}
