// ============================================================================
//  TREES — coconut palms + broadleaf trees from FEATURES.trees, and (optional)
//  instanced "context" trees placed where the satellite shows canopy.
//  Alpha-tested canvas leaf cards, leaf shadows via customDepthMaterial,
//  gentle wind sway in the vertex shader (shared WIND uniforms).
// ============================================================================
import { rng, makeCanvas, GeoBuilder, addTube, patchFoliage, heightToNormal, fbm } from './util.js';

const QT = { high: { frondSeg: 12, tex: 1024, crownK: 9, trunkRad: 9 }, medium: { frondSeg: 9, tex: 512, crownK: 7, trunkRad: 7 }, low: { frondSeg: 6, tex: 256, crownK: 5, trunkRad: 6 } };

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------
function frondTexture(THREE, size) {
  const W = size / 4, H = size;               // u across (0..1), v along (0 base .. 1 tip)
  const c = makeCanvas(W, H); const g = c.getContext('2d');
  const r = rng(41);
  const Y = (v) => (1 - v) * H;
  // leaflets
  for (const side of [-1, 1]) {
    for (let v = 0.1; v < 0.99; v += 0.0085 + r() * 0.004) {
      if (r() < 0.07) continue;                                  // torn / missing leaflet
      const prof = Math.sin(Math.PI * Math.min(1, (v - 0.06) / 0.98)) ** 0.5;
      const L = (0.62 + r() * 0.36) * (W / 2) * Math.max(0.35, prof);
      const x0 = W / 2, y0 = Y(v);
      const fwd = (0.10 + r() * 0.05) * H * (0.5 + 0.5 * prof);  // leaflets sweep towards the tip
      const x1 = x0 + side * L, y1 = y0 - fwd * 0.55;
      const cx = x0 + side * L * 0.45, cy = y0 - fwd * 0.05;
      const gcol = [52 + r() * 34, 86 + r() * 34, 24 + r() * 18];
      if (r() < 0.12) { gcol[0] += 45; gcol[1] += 25; }            // yellowing leaflet
      const wdt = (0.013 + r() * 0.004) * H;
      g.fillStyle = `rgb(${gcol[0] | 0},${gcol[1] | 0},${gcol[2] | 0})`;
      g.beginPath();
      g.moveTo(x0, y0 - wdt * 0.5);
      g.quadraticCurveTo(cx, cy - wdt, x1, y1);
      g.quadraticCurveTo(cx, cy + wdt * 0.6, x0, y0 + wdt * 0.5);
      g.closePath(); g.fill();
      // midrib highlight
      g.strokeStyle = `rgba(${gcol[0] + 40 | 0},${gcol[1] + 40 | 0},${gcol[2] + 20 | 0},0.6)`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy - wdt * 0.2, x1, y1); g.stroke();
    }
  }
  // rachis (petiole), thick at base
  for (let v = 0; v < 1; v += 0.004) {
    const w = (1 - v) * 0.09 * W + 2;
    g.fillStyle = `rgb(${150 - v * 50 | 0},${150 - v * 40 | 0},${70 - v * 20 | 0})`;
    g.fillRect(W / 2 - w / 2, Y(v) - 2, w, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function leafClusterTexture(THREE, size, seed = 7, palette = 'dark') {
  const c = makeCanvas(size, size); const g = c.getContext('2d');
  const r = rng(seed); const S = size;
  // a few twigs
  g.strokeStyle = 'rgb(70,58,40)'; g.lineWidth = S * 0.006;
  for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(S * 0.5, S * 0.95); g.quadraticCurveTo(S * (0.3 + r() * 0.4), S * 0.6, S * (0.1 + r() * 0.8), S * (0.1 + r() * 0.4)); g.stroke(); }
  const n = Math.round(S * 1.1);
  for (let k = 0; k < n; k++) {
    // leaves fill a rounded blob (denser in the middle)
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 0.44;
    const x = S * (0.5 + Math.cos(a) * rr), y = S * (0.5 + Math.sin(a) * rr * 0.92);
    const L = S * (0.018 + r() * 0.016), Wd = L * (0.36 + r() * 0.14);
    const ang = a + (r() - 0.5) * 1.6;
    const shade = 0.75 + r() * 0.5;
    let col = palette === 'dark' ? [40, 70, 26] : [62, 92, 32];
    col = col.map((v) => Math.min(255, v * shade));
    if (r() < 0.08) col = [col[0] + 40, col[1] + 30, col[2]];     // yellowed leaf
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
    g.beginPath(); g.ellipse(0, 0, L, Wd, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(${col[0] + 45 | 0},${col[1] + 45 | 0},${col[2] + 25 | 0},0.5)`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-L * 0.9, 0); g.lineTo(L * 0.9, 0); g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function barkTexture(THREE, palm) {
  const W = 128, H = 256;
  const c = makeCanvas(W, H); const g = c.getContext('2d');
  const h = makeCanvas(W, H); const hg = h.getContext('2d');
  const img = g.createImageData(W, H), hi = hg.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    let ht, col;
    if (palm) {
      // leaf-scar rings: ~9 per texture repeat (0.9 m), slightly wavy
      const ring = (v * 9 + 0.05 * Math.sin(u * Math.PI * 2 * 2 + v * 20)) % 1;
      const groove = Math.exp(-((ring - 0.15) ** 2) / 0.004);
      const n = fbm(u * 8, v * 16, 3, 5, 8);
      ht = 0.7 - groove * 0.6 + n * 0.25;
      const l = 0.55 + n * 0.35 - groove * 0.3;
      col = [128 * l + 20, 118 * l + 18, 104 * l + 14];
    } else {
      const n = fbm(u * 6, v * 3, 4, 9, 6), m = fbm(u * 20, v * 4, 2, 3, 20);
      const fiss = Math.abs(Math.sin((u * 7 + n * 0.8) * Math.PI));
      ht = fiss * 0.7 + m * 0.3;
      const l = 0.45 + fiss * 0.35 + m * 0.2;
      col = [96 * l + 20, 84 * l + 18, 70 * l + 14];
    }
    const i = (y * W + x) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    hi.data[i] = hi.data[i + 1] = hi.data[i + 2] = ht * 255; hi.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); hg.putImageData(hi, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const nt = new THREE.CanvasTexture(heightToNormal(h, 3)); nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
  return { map: t, normalMap: nt };
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------
function foliageMaterials(THREE, map, { roughness = 0.75, alphaTest = 0.45, color = 0xffffff, noFlip = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({ map, color, vertexColors: true, alphaTest, side: THREE.DoubleSide, roughness, metalness: 0 });
  patchFoliage(mat, { sway: true, alphaFix: true, noFlip });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest, side: THREE.DoubleSide });
  patchFoliage(depth, { sway: true, alphaFix: true });
  return { mat, depth };
}
function solidMaterials(THREE, params) {
  const mat = new THREE.MeshStandardMaterial(params);
  patchFoliage(mat, { sway: true });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchFoliage(depth, { sway: true });
  return { mat, depth };
}

function finishMesh(ctx, geo, mats, name, occluder = true) {
  const m = new ctx.THREE.Mesh(geo, mats.mat);
  m.customDepthMaterial = mats.depth;
  m.castShadow = true; m.receiveShadow = true; m.name = name;
  if (occluder) ctx.registerOccluder(m);
  return m;
}

// ---------------------------------------------------------------------------
// coconut palm
// ---------------------------------------------------------------------------
function buildPalm(gbTrunk, gbFronds, gbNuts, x, y, H, seed, q) {
  const r = rng(seed);
  const phase = r() * 6.28;
  const az = r() * Math.PI * 2;
  const lean = H * (0.05 + r() * 0.09);
  const dx = Math.cos(az), dz = Math.sin(az);
  const base = [x, 0, -y];
  // curved trunk: leans out, then curves slightly back up
  const pts = [], radii = []; const N = 18;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const off = lean * (Math.sin(t * Math.PI * 0.5) * 1.0 - 0.15 * t * t);
    pts.push([base[0] + dx * off, t * H, base[2] + dz * off]);
    radii.push(0.15 + 0.07 * (1 - t) + 0.16 * Math.exp(-t * H / 0.55));
  }
  pts[0][1] = -0.05;
  const sScale = H / 13;
  addTube(gbTrunk, pts, radii, q.trunkRad, 0.9, [1, 1, 1], (t) => [t * t * sScale, phase, 0], false);
  const top = pts[N];
  // crown shaft / bole (leaf bases) — cone, darker
  const bole = [];
  for (let k = 0; k <= 4; k++) { const t = k / 4; bole.push([top[0], top[1] - 0.25 + t * 1.0, top[2]]); }
  addTube(gbNuts, bole, [0.24, 0.3, 0.32, 0.22, 0.05], 8, 1, (t) => [0.2 + t * 0.06, 0.17 + t * 0.08, 0.09], () => [sScale, phase, 0], true);
  // coconuts
  const nNuts = 5 + Math.floor(r() * 9);
  for (let k = 0; k < nNuts; k++) {
    const a = r() * 6.28, rr = 0.3 + r() * 0.12, hy = top[1] - 0.05 - r() * 0.35;
    const cx = top[0] + Math.cos(a) * rr, cz = top[2] + Math.sin(a) * rr;
    const rad = 0.1 + r() * 0.03;
    const col = r() < 0.7 ? [0.2 + r() * 0.06, 0.26 + r() * 0.06, 0.06] : [0.32, 0.22, 0.09];
    const seg = 6;
    // tiny lat-long sphere
    const rows = [];
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI; const row = [];
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * Math.PI * 2;
        const nrm = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        row.push(gbNuts.vert([cx + nrm[0] * rad, hy + nrm[1] * rad * 1.1, cz + nrm[2] * rad], nrm, [0, 0], col, [sScale, phase, 0]));
      }
      rows.push(row);
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) gbNuts.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
  }
  // fronds
  const nF = 21 + Math.floor(r() * 5);
  const golden = 2.39996;
  for (let f = 0; f < nF; f++) {
    const fa = f * golden + r() * 0.3;
    const age = f / nF;                         // 0 = youngest (upright) … 1 = oldest (drooping)
    const dead = age > 0.8 && r() < 0.75;          // a skirt of brown hanging fronds (WA0005 / WA0011)
    const yel = Math.max(0, (age - 0.55) / 0.35);    // older live fronds yellow towards the tips
    const el = (dead ? -1.25 : 0.95 - age * 1.35) + (r() - 0.5) * 0.25;
    const L = (dead ? 3.4 : 4.0 + r() * 1.3) * Math.min(1.15, Math.max(0.8, sScale));
    const bend = dead ? 0.25 : 0.95 + r() * 0.55 + age * 0.5;
    const hw = (dead ? 0.42 : 0.62 + r() * 0.18) * Math.min(1.1, sScale);
    const lv = 0.8 + r() * 0.12;                     // ≈15 % darker, less saturated crown than before
    const tint = dead ? [0.78 + r() * 0.12, 0.55 + r() * 0.08, 0.3] :
      [lv * (0.94 + yel * 0.3), lv * (0.92 + yel * 0.1), lv * (0.86 - yel * 0.2)];
    const ca = Math.cos(fa), sa = Math.sin(fa);
    let p = [top[0] + ca * 0.18, top[1] + 0.45 - age * 0.35, top[2] + sa * 0.18];
    const segs = q.frondSeg; const step = L / segs;
    const rows = [];
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      const ang = el - bend * Math.pow(s, 1.4);
      const tdir = [ca * Math.cos(ang), Math.sin(ang), sa * Math.cos(ang)];
      // side vector (horizontal, perpendicular to the frond's azimuth) with a little twist along the frond
      const tw = (r() - 0.5) * 0.04 + s * 0.25 * (f % 2 ? 1 : -1);
      let side = [-sa, 0, ca];
      side = [side[0] * Math.cos(tw), Math.sin(tw), side[2] * Math.cos(tw)];
      const prof = Math.min(1, s * 6) * (1 - 0.45 * s * s) * hw;
      const droop = prof * (dead ? 0.9 : 0.62 + s * 0.3);
      // leaflet plane normal ≈ up-ish, tilted
      const up = [-(tdir[0] * tdir[1]), 1 - tdir[1] * tdir[1], -(tdir[2] * tdir[1])];
      const ul = Math.hypot(...up) || 1;
      const nUp = up.map((v) => v / ul);
      const sw = [sScale, phase + f * 0.37, s];
      const L0 = [p[0] - side[0] * prof - nUp[0] * droop, p[1] - side[1] * prof - nUp[1] * droop, p[2] - side[2] * prof - nUp[2] * droop];
      const R0 = [p[0] + side[0] * prof - nUp[0] * droop, p[1] + side[1] * prof - nUp[1] * droop, p[2] + side[2] * prof - nUp[2] * droop];
      const nL = [nUp[0] - side[0] * 0.4, nUp[1] - side[1] * 0.4 + 0.3, nUp[2] - side[2] * 0.4];
      const nR = [nUp[0] + side[0] * 0.4, nUp[1] + side[1] * 0.4 + 0.3, nUp[2] + side[2] * 0.4];
      const nn = (v) => { const l = Math.hypot(...v) || 1; return v.map((a) => a / l); };
      rows.push([
        gbFronds.vert(L0, nn(nL), [0, s], tint, sw),
        gbFronds.vert(p.slice(), nn([nUp[0], nUp[1] + 0.3, nUp[2]]), [0.5, s], tint, sw),
        gbFronds.vert(R0, nn(nR), [1, s], tint, sw),
      ]);
      p = [p[0] + tdir[0] * step, p[1] + tdir[1] * step, p[2] + tdir[2] * step];
    }
    for (let k = 0; k < segs; k++) {
      gbFronds.quad(rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0]);
      gbFronds.quad(rows[k][1], rows[k][2], rows[k + 1][2], rows[k + 1][1]);
    }
  }
}

// ---------------------------------------------------------------------------
// broadleaf crown (cards) — shared by hero trees and instanced context trees
// ---------------------------------------------------------------------------
function addCrown(gb, cx, cy, cz, rx, ry, nCards, cardSize, seed, phase, sScale, tint = [1, 1, 1]) {
  const r = rng(seed);
  const nCl = 4 + Math.floor(r() * 4);
  const cl = [];
  for (let k = 0; k < nCl; k++) {
    const a = r() * 6.28, rr = r() * 0.45, hy = (r() - 0.35) * 0.5;
    cl.push([cx + Math.cos(a) * rx * rr, cy + hy * ry, cz + Math.sin(a) * rx * rr, 0.5 + r() * 0.25]);
  }
  for (let k = 0; k < nCards; k++) {
    const c = cl[Math.floor(r() * nCl)];
    // point on a shell (biased to outside)
    let d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]; let dl = Math.hypot(...d) || 1; d = d.map((v) => v / dl);
    const shell = 0.55 + Math.pow(r(), 0.5) * 0.45;
    const px = c[0] + d[0] * rx * c[3] * shell * 1.25, py = c[1] + d[1] * ry * c[3] * shell * 1.3, pz = c[2] + d[2] * rx * c[3] * shell * 1.25;
    // card orientation: random normal, biased outward
    let nrm = [d[0] * 0.6 + (r() - 0.5), d[1] * 0.6 + (r() - 0.5) + 0.25, d[2] * 0.6 + (r() - 0.5)];
    const nl = Math.hypot(...nrm) || 1; nrm = nrm.map((v) => v / nl);
    let a1 = Math.abs(nrm[1]) < 0.95 ? [nrm[2], 0, -nrm[0]] : [1, 0, 0];
    const al = Math.hypot(...a1); a1 = a1.map((v) => v / al);
    const a2 = [nrm[1] * a1[2] - nrm[2] * a1[1], nrm[2] * a1[0] - nrm[0] * a1[2], nrm[0] * a1[1] - nrm[1] * a1[0]];
    const rot = r() * 6.28, cr = Math.cos(rot), sr = Math.sin(rot);
    const e1 = a1.map((v, i) => v * cr + a2[i] * sr), e2 = a1.map((v, i) => -v * sr + a2[i] * cr);
    const sz = cardSize * (0.75 + r() * 0.5) / 2;
    // lighting normal: spherical from the crown centre (soft, volumetric look)
    let sn = [px - cx, (py - cy) * 1.2 + ry * 0.3, pz - cz]; const snl = Math.hypot(...sn) || 1; sn = sn.map((v) => v / snl);
    const ln = sn.map((v, i) => v * 0.8 + nrm[i] * 0.2);
    // AO: darker towards the inside and the bottom
    const rad = Math.hypot((px - cx) / rx, (py - cy) / ry, (pz - cz) / rx);
    const ao = Math.min(1, 0.45 + rad * 0.5) * (0.78 + 0.22 * Math.max(0, Math.min(1, (py - cy) / ry * 0.5 + 0.6)));
    const hue = 0.88 + r() * 0.24;
    const col = [tint[0] * ao * hue, tint[1] * ao * (0.94 + r() * 0.12), tint[2] * ao * hue];
    const sw = [sScale * Math.max(0.3, (py - (cy - ry)) / (2 * ry)), phase, 0.5 + r() * 0.5];
    const v = [];
    for (const [s1, s2, u, w] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      v.push(gb.vert([px + (e1[0] * s1 + e2[0] * s2) * sz, py + (e1[1] * s1 + e2[1] * s2) * sz, pz + (e1[2] * s1 + e2[2] * s2) * sz], ln, [u, w], col, sw));
    }
    gb.quad(v[0], v[1], v[2], v[3]);
  }
}

function buildBroadleaf(gbTrunk, gbCrown, x, y, h, cr, seed, q) {
  const r = rng(seed);
  const phase = r() * 6.28;
  const ry = Math.min(cr * 0.72, h * 0.36);
  const cy = h - ry;
  const cx = x + (r() - 0.5) * 0.8, cz = -y + (r() - 0.5) * 0.8;
  const sScale = 0.35 * h / 9;
  const tr = 0.1 + cr * 0.026;
  // trunk up to the crown centre-ish, with gentle kink
  const trunkTop = cy - ry * 0.15;
  const tp = [], trr = [];
  const kx = (r() - 0.5) * 0.8, kz = (r() - 0.5) * 0.8;
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    tp.push([x + kx * Math.sin(t * 2.2) + (cx - x) * t, -0.05 + t * trunkTop, -y + kz * Math.sin(t * 2.2) + (cz + y) * t]);
    trr.push(tr * (1 - t * 0.4) + 0.09 * Math.exp(-t * 8));
  }
  addTube(gbTrunk, tp, trr, q.trunkRad, 1.6, [1, 1, 1], (t) => [t * t * sScale * 0.5, phase, 0]);
  // main branches
  const nb = 4 + Math.floor(r() * 3);
  for (let b = 0; b < nb; b++) {
    const t0 = 0.55 + r() * 0.35; const i0 = Math.min(5, Math.floor(t0 * 6));
    const s = tp[i0]; const a = r() * 6.28; const reach = cr * (0.45 + r() * 0.35);
    const e = [cx + Math.cos(a) * reach, cy + (r() - 0.2) * ry * 0.8, cz + Math.sin(a) * reach];
    const m = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2 + 0.4, (s[2] + e[2]) / 2];
    const rb = trr[i0] * (0.45 + r() * 0.2);
    addTube(gbTrunk, [s, m, e], [rb, rb * 0.65, rb * 0.25], Math.max(5, q.trunkRad - 3), 1.6, [1, 1, 1], (t, p) => [sScale * 0.5 * (0.4 + t * 0.6), phase, 0]);
  }
  const nCards = Math.round(cr * cr * q.crownK * 1.15);
  addCrown(gbCrown, cx, cy, cz, cr, ry, nCards, 1.7 * Math.max(0.8, cr / 6), seed * 7 + 1, phase, sScale, [0.95, 1, 0.92]);
}

// ---------------------------------------------------------------------------
export function buildTrees(ctx, parent) {
  const { THREE, site } = ctx;
  const q = QT[ctx.quality] || QT.high;
  const T = site.FEATURES.trees;

  // palms
  const gbT = new GeoBuilder(), gbF = new GeoBuilder(), gbN = new GeoBuilder();
  // local override: WA0011 / WA0005 show the palms only BEHIND Block A (west / north) — the two palms that
  // site-data puts in the open east field (47,41) and (49,36.5) are moved into the north strip.
  const PALM_MOVE = { '47,41': [40.5, 73.5], '49,36.5': [21.5, 73.0] };
  const palms = T.coconut.map(([x, y, h]) => { const m = PALM_MOVE[`${x},${y}`]; return m ? [m[0], m[1], h] : [x, y, h]; });
  palms.forEach(([x, y, h], i) => buildPalm(gbT, gbF, gbN, x, y, h, 1000 + i * 31, q));
  const palmBark = barkTexture(THREE, true);
  const trunkM = solidMaterials(THREE, { map: palmBark.map, normalMap: palmBark.normalMap, roughness: 0.92, color: 0xd8d2c8 });
  const frondTex = frondTexture(THREE, q.tex);
  const frondM = foliageMaterials(THREE, frondTex, { roughness: 0.68, alphaTest: 0.42 });
  const nutM = solidMaterials(THREE, { vertexColors: true, roughness: 0.7 });
  parent.add(finishMesh(ctx, gbT.build(THREE, { sway: true }), trunkM, 'palm-trunks'));
  parent.add(finishMesh(ctx, gbF.build(THREE, { color: true, sway: true }), frondM, 'palm-fronds'));
  parent.add(finishMesh(ctx, gbN.build(THREE, { color: true, sway: true }), nutM, 'palm-crowns', false));

  // broadleaf
  const gbBT = new GeoBuilder(), gbBC = new GeoBuilder();
  T.broadleaf.forEach(([x, y, h, cr], i) => buildBroadleaf(gbBT, gbBC, x, y, h, cr, 2000 + i * 17, q));
  const bark = barkTexture(THREE, false);
  const btM = solidMaterials(THREE, { map: bark.map, normalMap: bark.normalMap, roughness: 0.95, color: 0xbdb5a8 });
  const leafTex = leafClusterTexture(THREE, q.tex / 2, 7, 'dark');
  const crownM = foliageMaterials(THREE, leafTex, { roughness: 0.8, alphaTest: 0.5 });
  parent.add(finishMesh(ctx, gbBT.build(THREE, { sway: true }), btM, 'broadleaf-trunks'));
  parent.add(finishMesh(ctx, gbBC.build(THREE, { color: true, sway: true }), crownM, 'broadleaf-crowns'));

  return { leafTex, crownM, btM, buildContextTrees: (points, grp = parent) => buildContextTrees(ctx, grp, points, crownM, btM, q) };
}

/**
 * Instanced context trees (positions picked from satellite canopy).
 * points: [[x, y, h, cr], ...] plan coords.
 */
function buildContextTrees(ctx, parent, points, crownM, btM, q) {
  const { THREE } = ctx;
  if (!points.length) return null;
  const variants = 3; const out = [];
  for (let v = 0; v < variants; v++) {
    const pts = points.filter((_, i) => i % variants === v);
    if (!pts.length) continue;
    // unit tree: height 1 at crown top, crown radius ≈ 0.5 → scaled per instance
    const gbT = new GeoBuilder(), gbC = new GeoBuilder();
    buildBroadleaf(gbT, gbC, 0, 0, 10, 5.5, 5000 + v * 13, { ...q, crownK: Math.max(3, q.crownK - 4), trunkRad: 5 });
    const gT = gbT.build(THREE, { sway: true }), gC = gbC.build(THREE, { color: true, sway: true });
    const mT = new THREE.InstancedMesh(gT, btM.mat, pts.length);
    const mC = new THREE.InstancedMesh(gC, crownM.mat, pts.length);
    mT.customDepthMaterial = btM.depth; mC.customDepthMaterial = crownM.depth;
    const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
    const r = rng(77 + v);
    pts.forEach(([x, y, h, cr], i) => {
      qn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      const vary = 0.75 + r() * 0.55; const sh = h * vary / 10, sr = cr * (0.8 + r() * 0.4) / 5.5;
      sc.set(sr, sh, sr); ps.set(x, 0, -y);
      m4.compose(ps, qn, sc); mT.setMatrixAt(i, m4); mC.setMatrixAt(i, m4);
      col.setRGB(0.85 + r() * 0.25, 0.9 + r() * 0.15, 0.8 + r() * 0.2); mC.setColorAt(i, col);
    });
    for (const m of [mT, mC]) {
      m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); m.frustumCulled = true;
      parent.add(m); ctx.registerOccluder(m); out.push(m);
    }
    mT.name = 'context-tree-trunks'; mC.name = 'context-tree-crowns';
  }
  return out;
}

export { leafClusterTexture, addCrown, foliageMaterials };
