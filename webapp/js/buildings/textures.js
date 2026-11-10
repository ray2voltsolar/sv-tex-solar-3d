// ============================================================================
//  BUILDINGS — procedural textures.
//   * tiling detail maps (DataTexture): painted plaster, hollow concrete block,
//     trapezoidal-sheet micro-rib normal + roughness.
//   * Grime atlases (CanvasTexture): every wall face / roof plane gets its own
//     rectangle, painted in metres with damp bases, rain streaks under sills,
//     drip lines, dust, rust and vent halos. Sampled through a custom `grimeUv`
//     attribute and multiplied onto the albedo (see materials.js).
// ============================================================================
import { rng, clamp } from './lib.js';

// ---------- periodic value noise ----------
function hash(i, j, seed) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const md = (a, n) => ((a % n) + n) % n;
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const i0 = md(xi, px), i1 = md(xi + 1, px), j0 = md(yi, py), j1 = md(yi + 1, py);
  const a = hash(i0, j0, seed), b = hash(i1, j0, seed), c = hash(i0, j1, seed), d = hash(i1, j1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** fbm on the unit square, tileable; f = base frequency (integer). */
export function fbm(x, y, fx, fy, oct, seed) {
  let s = 0, n = 0, amp = 0.5;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(x * fx, y * fy, fx, fy, seed + o * 31);
    n += amp; fx *= 2; fy *= 2; amp *= 0.5;
  }
  return s / n;
}

function dataTex(THREE, w, h, data, srgb, aniso) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = aniso || 1;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** height (metres) → tangent-space normal map (rows = +v). */
function heightToNormal(H, w, h, pxW, pxH) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = H[y * w + md(x - 1, w)], xr = H[y * w + md(x + 1, w)];
      const yd = H[md(y - 1, h) * w + x], yu = H[md(y + 1, h) * w + x];
      let nx = -(xr - xl) / (2 * pxW), ny = -(yu - yd) / (2 * pxH), nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const k = (y * w + x) * 4;
      out[k] = (nx * 0.5 + 0.5) * 255; out[k + 1] = (ny * 0.5 + 0.5) * 255; out[k + 2] = (nz * 0.5 + 0.5) * 255; out[k + 3] = 255;
    }
  }
  return out;
}

// ---------- detail textures ----------
/** Painted plaster: tile = 2.5 m. */
function plaster(THREE, N, aniso) {
  const H = new Float32Array(N * N), C = new Uint8Array(N * N * 4);
  const r = rng(11);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const fine = fbm(u, v, 64, 64, 3, 5);
    const mid = fbm(u, v, 12, 12, 4, 9);
    const low = fbm(u, v, 3, 3, 3, 21);
    H[y * N + x] = (fine - 0.5) * 0.0009 + (mid - 0.5) * 0.0016;
    let l = 0.955 + (low - 0.5) * 0.07 + (mid - 0.5) * 0.04 + (fine - 0.5) * 0.03;
    const k = (y * N + x) * 4;
    C[k] = clamp(l * 255, 0, 255); C[k + 1] = clamp(l * 253, 0, 255); C[k + 2] = clamp(l * 249, 0, 255); C[k + 3] = 255;
  }
  // pits / pores
  for (let i = 0; i < N * N / 90; i++) {
    const x = (r() * N) | 0, y = (r() * N) | 0; H[y * N + x] -= 0.0012;
    const k = (y * N + x) * 4; C[k] *= 0.9; C[k + 1] *= 0.9; C[k + 2] *= 0.9;
  }
  const px = 2.5 / N;
  return { map: dataTex(THREE, N, N, C, true, aniso), normal: dataTex(THREE, N, N, heightToNormal(H, N, N, px, px), false, aniso), tile: 2.5 };
}

/** Hollow concrete blocks 400 × 200 mm, running bond: tile 1.6 m × 1.0 m. */
function blocks(THREE, W, aniso) {
  const Hh = Math.round(W * 0.625);
  const H = new Float32Array(W * Hh), C = new Uint8Array(W * Hh * 4);
  const ppm = W / 1.6, mort = 0.011 * ppm;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const zm = y / ppm, course = Math.floor(zm / 0.2);
    const xm = x / ppm + (course % 2 ? 0.2 : 0);
    const bx = Math.floor(xm / 0.4);
    const fx = (xm - bx * 0.4) * ppm, fy = (zm - course * 0.2) * ppm;
    const edge = Math.min(fx, 0.4 * ppm - fx, fy, 0.2 * ppm - fy);
    const id = md(bx, 4) * 7 + course * 13;
    const tone = 0.9 + hash(id, course, 3) * 0.16;
    const n1 = fbm(x / W, y / Hh, 96, 60, 2, 41), n2 = fbm(x / W, y / Hh, 8, 5, 3, 77);
    const pore = hash(x, y, 99) > 0.985 ? -0.25 : 0;
    let l, h;
    if (edge < mort * 0.5) { l = 0.78 + n1 * 0.1; h = -0.004; }
    else { const bev = Math.min(1, (edge - mort * 0.5) / (0.004 * ppm)); l = tone * (0.86 + n1 * 0.16 + (n2 - 0.5) * 0.1) + pore; h = -0.002 * (1 - bev) + (n1 - 0.5) * 0.0012 + pore * 0.004; }
    const k = (y * W + x) * 4;
    C[k] = clamp(l * 162, 0, 255); C[k + 1] = clamp(l * 160, 0, 255); C[k + 2] = clamp(l * 154, 0, 255); C[k + 3] = 255;
    H[y * W + x] = h;
  }
  return { map: dataTex(THREE, W, Hh, C, true, aniso), normal: dataTex(THREE, W, Hh, heightToNormal(H, W, Hh, 1 / ppm, 1 / ppm), false, aniso), tileW: 1.6, tileH: 1.0 };
}

/** Sheet micro-ribs + oil canning: u spans 4 ribs, v spans 2 m. */
function sheet(THREE, aniso, hi) {
  const w = hi ? 256 : 128, h = hi ? 512 : 256;
  const H = new Float32Array(w * h), R = new Uint8Array(w * h * 4);
  const ribPx = w / 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let f = (x % ribPx) / ribPx; // 0 = pan centre
    const fc = f > 0.5 ? f - 1 : f; // -0.5..0.5
    let hh = 0;
    for (const m of [-0.16, 0.16]) hh += 0.0012 * Math.exp(-((fc - m) * (fc - m)) / (2 * 0.018 * 0.018));
    if (Math.abs(fc) < 0.3) hh += (fbm(x / w, y / h, 4, 2, 3, 7) - 0.5) * 0.0018 * (1 - Math.abs(fc) / 0.3);
    H[y * w + x] = hh;
    const st = fbm(x / w, y / h, 32, 2, 3, 19), sp = fbm(x / w, y / h, 16, 16, 2, 23);
    const k = (y * w + x) * 4;
    // crests are wiped clean by rain (smoother), pans hold dust (rougher)
    const rp = ribPhase(x / ribPx);
    const g = clamp((0.8 + (st - 0.5) * 0.35 + (sp - 0.5) * 0.15 + (rp.crest ? -0.12 : rp.pan ? 0.05 : 0)) * 255, 0, 255);
    R[k] = g; R[k + 1] = g; R[k + 2] = g; R[k + 3] = 255;
  }
  return { normal: dataTex(THREE, w, h, heightToNormal(H, w, h, 0.25 / ribPx, 2 / h), false, aniso), rough: dataTex(THREE, w, h, R, false, aniso),
    rib: ribAlbedo(THREE, aniso, hi) };
}

/** Position inside one trapezoidal rib (fraction 0..1 of the pitch, 0 = pan start as in profiledSheet). */
function ribPhase(f) {
  f -= Math.floor(f);
  const a = 0.335, fl = 0.1, cr = 0.13;   // pan / flank / crest fractions of the 0.25 m pitch
  if (f < a) return { pan: true, d: a - f };
  if (f < a + fl) return { flank: 1, t: (f - a) / fl };
  if (f < a + fl + cr) return { crest: true, t: (f - a - fl) / cr };
  if (f < a + 2 * fl + cr) return { flank: 2, t: (f - a - fl - cr) / fl };
  return { pan: true, d: f - (a + 2 * fl + cr) };
}
/**
 * Rib albedo (sRGB, multiplied with the vertex colour): baked cavity AO at the
 * pan / flank junctions, darker flanks, a bright clean crest line and faint pan
 * stiffeners, so the trapezoidal profile still reads (through the mips) when the
 * 28 mm geometric ribs are only a few pixels wide.  u spans 4 ribs, v 2 m.
 */
function ribAlbedo(THREE, aniso, hi) {
  const w = hi ? 256 : 128, h = 64;
  const C = new Uint8Array(w * h * 4), ribPx = w / 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rp = ribPhase((x + 0.5) / ribPx);
    let l;
    if (rp.pan) {
      l = 0.95 - 0.2 * Math.exp(-(rp.d * rp.d) / (2 * 0.035 * 0.035));
      if (Math.abs(rp.d - 0.13) < 0.014) l -= 0.04; // stiffener groove
    } else if (rp.flank) l = rp.flank === 1 ? 0.74 + 0.08 * rp.t : 0.84 - 0.1 * rp.t;
    else l = 1.0 - 0.04 * Math.abs(rp.t - 0.5) * 2;
    l *= 0.985 + (fbm(x / w, y / h, 4, 2, 2, 51) - 0.5) * 0.03;
    const k = (y * w + x) * 4, v = clamp(l * 255, 0, 255);
    C[k] = v; C[k + 1] = v; C[k + 2] = v; C[k + 3] = 255;
  }
  return dataTex(THREE, w, h, C, true, aniso);
}

/** Rolling-shutter slats are real geometry; this is a fine brushed-steel roughness. */
export function createDetailTextures(THREE, quality, aniso) {
  const hi = quality === 'high';
  const N = hi ? 1024 : quality === 'medium' ? 512 : 256;
  return {
    plaster: plaster(THREE, N, aniso),
    blocks: blocks(THREE, hi ? 1024 : 512, aniso),
    sheet: sheet(THREE, aniso, quality !== 'low'),
  };
}

// ============================================================================
//  GRIME ATLAS
// ============================================================================
export class Atlas {
  constructor(size, maxDensity = 64, base = 255) { this.size = size; this.maxD = maxDensity; this.base = base; this.items = []; this.white = [0.5 / size, 1 - 0.5 / size]; this.texture = null; }
  request(w, h, painter) { const r = { w: Math.max(w, 0.05), h: Math.max(h, 0.05), painter, ready: false, atlas: this }; this.items.push(r); return r; }
  _pack(d) {
    const S = this.size, pad = 3;
    const its = this.items.map((r) => ({ r, pw: Math.ceil(r.w * d), ph: Math.ceil(r.h * d) })).sort((a, b) => b.ph - a.ph);
    let x = 12, y = 0, shelf = 12;  // 12 px white reserved at the top-left
    for (const it of its) {
      if (it.pw + pad * 2 > S) return null;
      if (x + it.pw + pad > S) { x = 0; y += shelf + pad; shelf = 0; }
      if (y + it.ph + pad > S) return null;
      it.x = x + pad; it.y = y + pad; x += it.pw + pad * 2; shelf = Math.max(shelf, it.ph + pad);
    }
    return its;
  }
  finalize(THREE, aniso = 1) {
    const S = this.size;
    const area = this.items.reduce((a, r) => a + r.w * r.h, 0) || 1;
    let d = Math.min(this.maxD, Math.sqrt(0.8 * S * S / area));
    let its = null;
    for (let k = 0; k < 40 && !(its = this._pack(d)); k++) d *= 0.93;
    if (!its) throw new Error('grime atlas overflow');
    this.density = d;
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = `rgb(${this.base},${this.base},${this.base})`; g.fillRect(0, 0, S, S);
    for (const it of its) {
      const r = it.r;
      g.save();
      g.beginPath(); g.rect(it.x, it.y, it.pw, it.ph); g.clip();
      g.setTransform(d, 0, 0, -d, it.x, it.y + r.h * d);
      try { if (r.painter) r.painter(g, r.w, r.h, d); } catch (e) { console.warn('[buildings] grime painter', e); }
      g.restore();
      r.u0 = it.x / S; r.u1 = (it.x + r.w * d) / S;
      r.v1 = 1 - it.y / S; r.v0 = 1 - (it.y + r.h * d) / S;
      r.ready = true;
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.needsUpdate = true;
    this.texture = t;
    return t;
  }
}

// ============================================================================
//  Painters (draw in metres, origin bottom-left, y up). Multiply semantics:
//  white = clean, darker / tinted = grime.
// ============================================================================
const rgba = (r, g, b, a) => `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;

function blotch(g, x, y, r, c, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(c[0], c[1], c[2], a)); gr.addColorStop(1, rgba(c[0], c[1], c[2], 0));
  g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
}
function streak(g, x, ytop, length, w, c, a, rnd) {
  const gr = g.createLinearGradient(0, ytop, 0, ytop - length);
  gr.addColorStop(0, rgba(c[0], c[1], c[2], a)); gr.addColorStop(0.35, rgba(c[0], c[1], c[2], a * 0.7)); gr.addColorStop(1, rgba(c[0], c[1], c[2], 0));
  g.fillStyle = gr;
  // slightly wavy streak
  const n = 6, xs = [x];
  for (let i = 1; i <= n; i++) xs.push(xs[i - 1] + (rnd() - 0.5) * w * 0.6);
  g.beginPath(); g.moveTo(x - w / 2, ytop);
  for (let i = 1; i <= n; i++) g.lineTo(xs[i] - w / 2 * (1 - i / n * 0.6), ytop - length * i / n);
  for (let i = n; i >= 0; i--) g.lineTo(xs[i] + w / 2 * (1 - i / n * 0.6), ytop - length * i / n);
  g.closePath(); g.fill();
}
function hStreak(g, y, x0, x1, w, c, a) { // horizontal band
  const gr = g.createLinearGradient(0, y + w, 0, y - w);
  gr.addColorStop(0, rgba(c[0], c[1], c[2], 0)); gr.addColorStop(0.5, rgba(c[0], c[1], c[2], a)); gr.addColorStop(1, rgba(c[0], c[1], c[2], 0));
  g.fillStyle = gr; g.fillRect(x0, y - w, x1 - x0, 2 * w);
}
function crack(g, x, y, dx, dy, rnd, a = 0.35) {
  g.strokeStyle = rgba(70, 64, 58, a); g.lineWidth = 0.004;
  g.beginPath(); g.moveTo(x, y);
  let cx = x, cy = y; const n = 6;
  for (let i = 0; i < n; i++) { cx += dx / n + (rnd() - 0.5) * 0.03; cy += dy / n + (rnd() - 0.5) * 0.03; g.lineTo(cx, cy); }
  g.stroke();
}
function dampBase(g, W, h0, rnd, c, a) {
  // several stacked soft layers with a smooth, low-frequency wavy top → graded tide line
  const ph = rnd() * 10, ph2 = rnd() * 10;
  for (let k = 0; k < 4; k++) {
    const hk = h0 * (0.45 + 0.22 * k);
    g.beginPath(); g.moveTo(0, -0.05);
    for (let x = 0; x <= W + 0.25; x += 0.25) {
      const w = 0.62 + 0.22 * Math.sin(x * 0.9 + ph + k) + 0.16 * Math.sin(x * 2.3 + ph2 * (k + 1));
      g.lineTo(x, Math.max(0.04, hk * w));
    }
    g.lineTo(W + 0.25, -0.05); g.closePath();
    const gr = g.createLinearGradient(0, 0, 0, hk * 1.1);
    gr.addColorStop(0, rgba(c[0], c[1], c[2], a * 0.4)); gr.addColorStop(0.7, rgba(c[0], c[1], c[2], a * 0.22)); gr.addColorStop(1, rgba(c[0], c[1], c[2], a * 0.08));
    g.fillStyle = gr; g.fill();
  }
}
function speckles(g, W, z0, z1, n, rnd, c, a) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, z = z0 + Math.pow(rnd(), 2) * (z1 - z0), r = 0.004 + rnd() * 0.014;
    g.fillStyle = rgba(c[0], c[1], c[2], a * (0.5 + rnd() * 0.5)); g.fillRect(x - r, z - r, 2 * r, 2 * r);
  }
}

/**
 * Masonry / plaster wall face.
 * o: { seed, dirt (0..1), openings: [{s0,s1,z0,z1,kind}] (z relative to wall base), plinth, topDrip, spouts:[s], north }
 */
export function paintMasonry(o) {
  return (g, W, H) => {
    const rnd = rng(o.seed || 1), dirt = o.dirt ?? 1;
    // broad mottling
    for (let i = 0; i < W * H * 0.5 * dirt; i++) blotch(g, rnd() * W, rnd() * H, 0.25 + rnd() * 1.3, [125, 115, 98], 0.025 + rnd() * 0.05);
    // greenish-black algae tint on shaded faces
    if (o.north) for (let i = 0; i < W * 0.8; i++) blotch(g, rnd() * W, rnd() * 0.9, 0.3 + rnd() * 0.6, [90, 100, 80], 0.06 + rnd() * 0.06);
    // damp rising base + splash zone
    dampBase(g, W, (o.dampH ?? 0.55) * (0.7 + 0.5 * dirt), rnd, [92, 82, 66], 0.42 * dirt + 0.08);
    speckles(g, W, 0, 0.6, W * 140 * dirt, rnd, [80, 70, 58], 0.3);
    // drip streaks from the top (cladding flashing / parapet coping)
    if (o.topDrip !== false) {
      const dk = o.dripK ?? 1;   // < 1: sparser, fainter, shorter runs (offices: fresh-ish paint)
      for (let x = 0; x < W; x += (0.08 + rnd() * 0.35) / Math.max(0.3, dk)) {
        if (rnd() < 0.35) continue;
        streak(g, x, H + 0.02, (0.2 + Math.pow(rnd(), 1.6) * 1.8 * dirt) * (0.5 + 0.5 * dk), 0.015 + rnd() * 0.06, [78, 76, 70], (0.08 + rnd() * 0.22 * dirt) * dk, rnd);
      }
      hStreak(g, H - 0.03, 0, W, 0.06, [80, 78, 72], 0.25 * dirt + 0.05);
    }
    // openings: sill streaks and corner cracks
    for (const op of o.openings || []) {
      if (op.kind === 'window' || op.kind === 'louvre' || op.kind === 'vent') {
        const n = 2 + ((rnd() * 3) | 0);
        for (let i = 0; i < n; i++) {
          const x = op.s0 + 0.05 + rnd() * (op.s1 - op.s0 - 0.1);
          streak(g, x, op.z0 - 0.04, 0.3 + rnd() * 1.2 * dirt, 0.03 + rnd() * 0.07, [72, 68, 60], 0.12 + rnd() * 0.22, rnd);
        }
        streak(g, op.s0 - 0.02, op.z0 - 0.03, 0.4 + rnd() * 0.8, 0.05, [72, 68, 60], 0.18, rnd);
        streak(g, op.s1 + 0.02, op.z0 - 0.03, 0.4 + rnd() * 0.8, 0.05, [72, 68, 60], 0.18, rnd);
      }
      // dirty jambs (hands, splash) for doors
      if (op.kind === 'door' || op.kind === 'shutter') {
        blotch(g, op.s0 - 0.08, op.z0 + 1.0, 0.35, [90, 82, 70], 0.18 * dirt);
        blotch(g, op.s1 + 0.08, op.z0 + 1.0, 0.35, [90, 82, 70], 0.18 * dirt);
        hStreak(g, op.z1 + 0.04, op.s0 - 0.1, op.s1 + 0.1, 0.05, [70, 66, 60], 0.25);
      }
      if (rnd() < 0.7 && op.z1 < H - 0.3) crack(g, op.s1, op.z1, 0.15 + rnd() * 0.3, 0.2 + rnd() * 0.4, rnd);
      if (rnd() < 0.5 && op.z0 > 0.5) crack(g, op.s0, op.z0, -0.1 - rnd() * 0.3, -0.2 - rnd() * 0.3, rnd);
    }
    for (const s of o.spouts || []) {
      streak(g, s, H - 0.25, 1.2 + rnd() * 1.4, 0.18, [60, 62, 55], 0.35, rnd);
      streak(g, s + 0.05, H - 0.25, 2.2, 0.06, [50, 52, 46], 0.3, rnd);
    }
    for (const s of o.pipes || []) { streak(g, s, H, H * 0.9, 0.22, [80, 76, 68], 0.12, rnd); }
    // a few random hairline cracks
    for (let i = 0; i < W * 0.15; i++) crack(g, rnd() * W, 0.4 + rnd() * (H - 0.6), (rnd() - 0.5) * 0.5, (rnd() - 0.3) * 0.6, rnd, 0.25);
  };
}

/** Profiled sheet cladding (vertical ribs). o: { seed, dirt, rust, sheetW } */
export function paintCladding(o) {
  return (g, W, H) => {
    const rnd = rng(o.seed || 2), dirt = o.dirt ?? 1;
    for (let i = 0; i < W * H * 0.25 * dirt; i++) blotch(g, rnd() * W, rnd() * H, 0.3 + rnd() * 1.0, [120, 115, 105], 0.02 + rnd() * 0.04);
    // dust settling on the bottom of the sheets (above the drip flashing)
    const gr = g.createLinearGradient(0, 0, 0, 0.6);
    gr.addColorStop(0, rgba(110, 98, 80, 0.35 * dirt)); gr.addColorStop(1, rgba(110, 98, 80, 0));
    g.fillStyle = gr; g.fillRect(0, 0, W, 0.6);
    // drip lines from the eave / roof
    for (let x = 0; x < W; x += 0.1 + rnd() * 0.4) {
      if (rnd() < 0.5) continue;
      streak(g, x, H + 0.02, 0.2 + rnd() * 1.4 * dirt, 0.01 + rnd() * 0.03, [80, 80, 76], 0.05 + rnd() * 0.12 * dirt, rnd);
    }
    // fastener rows (girts every ~1.2 m) — rust pin-points with short runs
    if (o.rust) {
      for (let z = 0.15; z < H; z += 1.2) {
        for (let x = 0.12; x < W; x += 0.25) {
          if (rnd() > 0.35 * o.rust) continue;
          g.fillStyle = rgba(120, 70, 35, 0.4); g.fillRect(x - 0.008, z - 0.008, 0.016, 0.016);
          streak(g, x, z, 0.08 + rnd() * 0.35 * o.rust, 0.012, [130, 80, 45], 0.25 * o.rust, rnd);
        }
      }
      for (let i = 0; i < W * 0.3 * o.rust; i++) blotch(g, rnd() * W, rnd() * 0.5, 0.1 + rnd() * 0.3, [130, 82, 48], 0.25);
    }
    // sheet side-laps: slightly darker seam
    if (o.sheetW) for (let x = 0; x < W; x += o.sheetW) { g.fillStyle = rgba(70, 70, 70, 0.08); g.fillRect(x - 0.01, 0, 0.02, H); }
  };
}

/**
 * Roof plane, W along eave (u), L up-slope (v, 0 = eave).
 * o: { seed, dirt, dust, rust, moss, obstacles:[{u,v}], laps:[v], soot:{u,v,r}, fastenerRows:[v] }
 */
export function paintRoof(o) {
  return (g, W, L) => {
    const rnd = rng(o.seed || 3), dirt = o.dirt ?? 1, dust = o.dust ?? 0.5;
    g.fillStyle = rgba(160, 145, 120, 0.10 * dust); g.fillRect(0, 0, W, L);
    const chalk = (o.chalk ?? 0) * (o.lift ? 1 : 0);   // only atlases with base < 255 can lighten
    // per-sheet weathering (1 m sheets along the eave): each sheet fades / dirties a little differently
    for (let x = 0; x < W; x += 1.0) {
      const k = rnd();
      if (chalk && k < 0.55) { g.fillStyle = rgba(255, 255, 255, (0.05 + rnd() * 0.12) * chalk); g.fillRect(x, 0, 1.0, L); }
      else if (k > 0.75) { g.fillStyle = rgba(120, 110, 92, 0.04 + rnd() * 0.06 * dirt); g.fillRect(x, 0, 1.0, L); }
    }
    // chalky UV fade on the exposed upper slope
    if (chalk) {
      const gc = g.createLinearGradient(0, L, 0, L * 0.25);
      gc.addColorStop(0, rgba(255, 255, 255, 0.3 * chalk)); gc.addColorStop(1, rgba(255, 255, 255, 0));
      g.fillStyle = gc; g.fillRect(0, L * 0.25, W, L * 0.75);
    }
    // broad weathering, elongated down the slope (water carries the dirt)
    for (let i = 0; i < W * L * 0.22 * dirt; i++) {
      const x = rnd() * W, y = rnd() * L, r = 0.3 + rnd() * 1.4;
      g.save(); g.translate(x, y); g.scale(0.35 + rnd() * 0.25, 1.8 + rnd() * 1.6);
      blotch(g, 0, 0, r, [128, 116, 95], 0.03 + rnd() * 0.06 * dust + 0.02);
      g.restore();
    }
    // dust accumulation towards the eave
    const ge = g.createLinearGradient(0, 0, 0, Math.min(L, 2.8));
    ge.addColorStop(0, rgba(135, 118, 90, 0.42 * dust + 0.06)); ge.addColorStop(1, rgba(135, 118, 90, 0));
    g.fillStyle = ge; g.fillRect(0, 0, W, Math.min(L, 2.8));
    // water flow tracks down the slope (in the pans): long runs from the upper slope + short ones
    const n = W * 9 * dirt;
    for (let i = 0; i < n; i++) {
      const x = Math.round(rnd() * W / 0.25) * 0.25 + (rnd() - 0.5) * 0.04;
      const long = rnd() < 0.4;
      const top = long ? L * (0.55 + rnd() * 0.45) : rnd() * L;
      const l = long ? top * (0.6 + rnd() * 0.4) : 0.5 + rnd() * Math.min(top, 4);
      streak(g, x, top, l, (long ? 0.05 : 0.02) + rnd() * 0.06, [88, 82, 70], (long ? 0.06 : 0.05) + rnd() * 0.12, rnd);
    }
    // clean "washed" tracks (chalk-lifted), mostly on painted roofs
    if (chalk) for (let i = 0; i < W * 2.5; i++) {
      const x = Math.round(rnd() * W / 0.25) * 0.25 + 0.125, top = L * (0.4 + rnd() * 0.6);
      streak(g, x, top, top * (0.4 + rnd() * 0.6), 0.06 + rnd() * 0.08, [255, 255, 255], 0.06 + rnd() * 0.1 * chalk, rnd);
    }
    for (const t of o.laps || []) { hStreak(g, t, 0, W, 0.05, [70, 66, 58], 0.22 * dirt + 0.05); hStreak(g, t + 0.12, 0, W, 0.15, [110, 100, 85], 0.12 * dirt); }
    for (const t of o.fastenerRows || []) {
      for (let x = 0.125; x < W; x += 0.5) {
        if (o.rust && rnd() < 0.45 * o.rust) { g.fillStyle = rgba(125, 72, 38, 0.45); g.fillRect(x - 0.012, t - 0.012, 0.024, 0.024); streak(g, x, t, 0.15 + rnd() * 0.8 * o.rust, 0.018, [130, 78, 42], 0.3, rnd); }
        else if (rnd() < 0.2) { g.fillStyle = rgba(80, 78, 72, 0.12); g.fillRect(x - 0.01, t - 0.01, 0.02, 0.02); }
      }
    }
    if (o.rust) for (let i = 0; i < W * L * 0.08 * o.rust; i++) {
      const x = rnd() * W, y = rnd() * L;
      blotch(g, x, y, 0.08 + rnd() * 0.4, [140, 85, 45], 0.15 + rnd() * 0.25);
      if (rnd() < 0.5) streak(g, x, y, 0.3 + rnd() * 1.5, 0.04, [135, 82, 45], 0.2, rnd);
    }
    // bird droppings / dust specks, denser near the ridge (perch line)
    if (o.droppings) for (let i = 0; i < W * L * 0.9 * o.droppings; i++) {
      const y = L - Math.pow(rnd(), 2.2) * L, x = rnd() * W, r = 0.012 + rnd() * 0.03;
      g.fillStyle = rnd() < 0.7 ? rgba(250, 250, 245, 0.35 + rnd() * 0.3) : rgba(70, 64, 54, 0.3);
      g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.8), rnd() * 3, 0, 6.283); g.fill();
    }
    if (o.moss) for (let i = 0; i < W * 0.6 * o.moss; i++) blotch(g, rnd() * W, L - rnd() * 1.4, 0.15 + rnd() * 0.5, [80, 95, 60], 0.18 + rnd() * 0.2);
    if (o.soot) { blotch(g, o.soot.u, o.soot.v, o.soot.r, [40, 38, 35], 0.55); blotch(g, o.soot.u, o.soot.v, o.soot.r * 2.2, [60, 56, 50], 0.3); }
    // skylight sheets: dirty end laps + side laps, dust trapped on the lower half
    for (const r of o.skyRects || []) {
      hStreak(g, r.t0, r.s0, r.s1, 0.07, [60, 58, 50], 0.45); hStreak(g, r.t1, r.s0, r.s1, 0.07, [60, 58, 50], 0.4);
      g.fillStyle = rgba(70, 66, 58, 0.3); g.fillRect(r.s0 - 0.03, r.t0, 0.06, r.t1 - r.t0); g.fillRect(r.s1 - 0.03, r.t0, 0.06, r.t1 - r.t0);
      const gd = g.createLinearGradient(0, r.t0, 0, r.t0 + (r.t1 - r.t0) * 0.6);
      gd.addColorStop(0, rgba(140, 125, 100, 0.3)); gd.addColorStop(1, rgba(140, 125, 100, 0));
      g.fillStyle = gd; g.fillRect(r.s0, r.t0, r.s1 - r.s0, (r.t1 - r.t0) * 0.6);
    }
    // dirty band under ridge cap / high edge
    hStreak(g, L - 0.12, 0, W, 0.12, [90, 86, 78], 0.2 * dirt);
    for (const ob of o.obstacles || []) {
      blotch(g, ob.u, ob.v, 0.85, [70, 66, 58], 0.4);
      for (let i = 0; i < 5; i++) streak(g, ob.u + (rnd() - 0.5) * 0.7, ob.v - 0.4, 0.8 + rnd() * 2.5, 0.05 + rnd() * 0.06, [95, 75, 55], 0.25, rnd);
    }
  };
}

/**
 * Flat RCC slab top (W along x, H along y, y = H is the north / spout edge).
 * o: { seed, spouts:[x] } — weathered screed: low-frequency mottling, soft irregular damp / algae
 * patches where water ponds (no hard outlines), dark dirt lines at the parapet base, runs to the spouts.
 */
export function paintSlab(o) {
  return (g, W, H) => {
    const rnd = rng(o.seed || 4);
    // overall cement-grey tone + broad mottling (sun-bleached vs. dusty)
    g.fillStyle = rgba(150, 146, 136, 0.22); g.fillRect(0, 0, W, H);
    for (let i = 0; i < W * H * 1.2; i++) blotch(g, rnd() * W, rnd() * H, 0.25 + rnd() * 1.1, [100, 95, 84], 0.04 + rnd() * 0.08);
    for (let i = 0; i < W * H * 0.4; i++) blotch(g, rnd() * W, rnd() * H, 0.2 + rnd() * 0.7, [255, 255, 250], 0.04 + rnd() * 0.06);
    // ponding: each damp patch is a cluster of overlapping soft blobs → irregular, soft-edged stain
    const pond = (cx, cy, R, a) => {
      for (let k = 0; k < 14; k++) {
        const ang = rnd() * 6.283, d = Math.sqrt(rnd()) * R * 0.75;
        blotch(g, cx + Math.cos(ang) * d, cy + Math.sin(ang) * d * 0.7, R * (0.25 + rnd() * 0.45), [78, 80, 66], a * (0.5 + rnd() * 0.5));
      }
      for (let k = 0; k < 5; k++) blotch(g, cx + (rnd() - 0.5) * R, cy + (rnd() - 0.5) * R * 0.6, R * (0.1 + rnd() * 0.2), [55, 62, 48], a * 0.8);
    };
    for (let i = 0; i < 4; i++) pond(0.8 + rnd() * (W - 1.6), 0.8 + rnd() * (H - 1.6), 0.6 + rnd() * 0.9, 0.12);
    // dirt + algae line along the parapet base (all four sides, strongest on the north)
    const edge = (x, y, w, h, a) => { g.fillStyle = rgba(70, 70, 60, a); g.fillRect(x, y, w, h); };
    edge(0, 0, W, 0.12, 0.3); edge(0, 0, 0.12, H, 0.3); edge(W - 0.12, 0, 0.12, H, 0.3); edge(0, H - 0.18, W, 0.18, 0.38);
    for (let x = 0; x < W; x += 0.3) blotch(g, x + rnd() * 0.3, H - 0.1, 0.2 + rnd() * 0.35, [60, 70, 52], 0.15 + rnd() * 0.15);
    for (let x = 0; x < W; x += 0.4) blotch(g, x + rnd() * 0.4, 0.08, 0.15 + rnd() * 0.25, [80, 78, 68], 0.12 + rnd() * 0.12);
    // water runs converging on the rain spouts (north edge) + dark ponding at each outlet
    for (const sx of o.spouts || []) {
      for (let k = 0; k < 6; k++) {
        const x0 = sx + (rnd() - 0.5) * 3.5, y0 = H - 1.2 - rnd() * 2.2;
        g.strokeStyle = rgba(75, 78, 66, 0.1 + rnd() * 0.08); g.lineWidth = 0.08 + rnd() * 0.12; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x0, y0);
        g.quadraticCurveTo((x0 + sx) / 2 + (rnd() - 0.5) * 0.6, (y0 + H) / 2, sx, H - 0.1); g.stroke();
      }
      pond(sx, H - 0.35, 0.55, 0.22);
    }
    // a few cement patch repairs (slightly lighter, straight-ish edges)
    for (let i = 0; i < 3; i++) { g.fillStyle = rgba(235, 232, 222, 0.12); g.fillRect(rnd() * (W - 1), rnd() * (H - 1), 0.4 + rnd() * 0.6, 0.3 + rnd() * 0.5); }
  };
}

/**
 * Underside of a roof plane (same W × L frame as paintRoof, seen from below).
 * o: { seed, rust, soot:{u,v,r}, purlins:[v], dirt }
 */
export function paintUnder(o) {
  return (g, W, L) => {
    const rnd = rng((o.seed || 5) + 7), dirt = o.dirt ?? 1;
    // faint condensation mottling, a little stronger towards the eave
    for (let i = 0; i < W * L * 0.12 * dirt; i++) blotch(g, rnd() * W, rnd() * L, 0.3 + rnd() * 1.2, [110, 108, 104], 0.03 + rnd() * 0.05);
    // dust / cobweb lines along the purlins
    for (const t of o.purlins || []) { hStreak(g, t, 0, W, 0.09, [70, 68, 64], 0.22 * dirt); hStreak(g, t - 0.12, 0, W, 0.06, [95, 92, 86], 0.1 * dirt); }
    // rust runs in the pans (fixings, laps)
    const nr = W * 1.2 * (o.rust ?? 0.3);
    for (let i = 0; i < nr; i++) {
      const x = Math.round(rnd() * W / 0.25) * 0.25, top = rnd() * L;
      streak(g, x, top, 0.2 + rnd() * 1.4, 0.03 + rnd() * 0.05, [135, 84, 50], 0.12 + rnd() * 0.2, rnd);
    }
    if (o.soot) { // smoke-blackened patch over a burner
      const s = o.soot;
      blotch(g, s.u, s.v, s.r * 2.8, [60, 58, 56], 0.45);
      blotch(g, s.u, s.v, s.r * 1.6, [30, 29, 28], 0.6);
      blotch(g, s.u, s.v, s.r * 0.8, [18, 17, 16], 0.7);
      for (let i = 0; i < 10; i++) { // smoke creeping up-slope under the sheets
        const x = s.u + (rnd() - 0.5) * s.r * 2;
        streak(g, x, Math.min(L, s.v + s.r * 3), s.r * 2.5, 0.25 + rnd() * 0.3, [35, 33, 31], 0.25, rnd);
      }
    }
  };
}

/** Wet / sooty concrete floor patch (multiply decal, white = no change). o: { seed, W, H, soot:{x,y,r} } */
export function paintFloorDecal(cv, o) {
  const g = cv.getContext('2d'), S = cv.width, SH = cv.height, rnd = rng(o.seed || 9);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, SH);
  g.setTransform(S / o.W, 0, 0, -SH / o.H, 0, SH);
  for (let i = 0; i < o.W * o.H * 0.5; i++) blotch(g, rnd() * o.W, rnd() * o.H, 0.3 + rnd() * 1.6, [80, 82, 84], 0.08 + rnd() * 0.12);
  // wet trail down the middle of the passage + puddle edges
  for (let i = 0; i < 18; i++) blotch(g, o.W * (0.3 + rnd() * 0.4), rnd() * o.H, 0.6 + rnd() * 1.4, [60, 64, 68], 0.15 + rnd() * 0.15);
  // tyre / foot tracks
  g.strokeStyle = rgba(55, 54, 52, 0.12); g.lineWidth = 0.18;
  for (const x of [o.W * 0.42, o.W * 0.58]) { g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= o.H; y += 1) g.lineTo(x + Math.sin(y * 0.4 + x) * 0.2, y); g.stroke(); }
  if (o.soot) { blotch(g, o.soot.x, o.soot.y, o.soot.r * 2.2, [40, 38, 36], 0.55); blotch(g, o.soot.x, o.soot.y, o.soot.r, [25, 24, 23], 0.6); }
  // soft fade to white at the decal border
  g.setTransform(1, 0, 0, 1, 0, 0);
  const e = S * 0.06;
  for (const [x0, y0, x1, y1, w, h] of [[0, 0, e, 0, e, SH], [S, 0, S - e, 0, e, SH], [0, 0, 0, e, S, e], [0, SH, 0, SH - e, S, e]]) {
    const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(Math.min(x0, x1), Math.min(y0, y1), w, h);
  }
}
