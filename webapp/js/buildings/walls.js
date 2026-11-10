// ============================================================================
//  BUILDINGS — walls: masonry (with real reveals around openings), plinth,
//  profiled PPGI cladding above the masonry, drip flashing, corner trims,
//  windows, doors, rolling shutters, louvres, sills, ramps.
//  Wall frame: x = along the wall (s), y = up (z), z = outward normal.
//  Wall runs are given counter-clockwise around a footprint so x × up = outward.
// ============================================================================
import { frame, fpt, fshift, box, extrudePoly, profiledSheet, cross, norm, mul, add, rng, clamp } from './lib.js';
import { paintMasonry, paintCladding } from './textures.js';

export function wallFrame(p0, p1) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy);
  const x = [dx / L, dy / L, 0], y = [0, 0, 1];
  return { F: frame([p0[0], p0[1], 0], x, y, cross(x, y)), L };
}
/** plan coordinate along the wall axis → s */
function sOf(w, F, at) {
  return Math.abs(F.x[0]) > Math.abs(F.x[1]) ? (at - F.o[0]) / F.x[0] : (at - F.o[1]) / F.x[1];
}

/**
 * Build one wall run.
 * w = { p0, p1, s0, s1, t, base, mTop, masonry:{bucket,color}, clad:{colorAt(i),P,sheetW,top(x,y),breaks,rust,dirt,trim}|null,
 *       openings:[{kind,at,w,z0,h,style,color}], dirt, north, seed, spouts:[at], pipes:[at], cornerStart, cornerEnd, plinth }
 */
export function buildWall(K, Bd, w) {
  const { THREE } = K;
  const { F, L } = wallFrame(w.p0, w.p1);
  const t = w.t ?? 0.23, base = w.base ?? -0.03, mTop = w.mTop;
  const s0 = w.s0 ?? 0, s1 = w.s1 ?? L;
  const rnd = rng(w.seed || 7);
  const ops = (w.openings || []).map((o) => {
    const sc = o.s != null ? o.s : sOf(w, F, o.at);
    return { ...o, s0: sc - o.w / 2, s1: sc + o.w / 2, z1: o.z0 + o.h };
  }).sort((a, b) => a.s0 - b.s0);
  const holes = ops.filter((o) => !(o.kind === 'louvre' && o.z0 >= mTop - 1e-3));

  // ---------------- masonry ----------------
  const mb = Bd.md(w.masonry.bucket || 'masonry');
  const mcol = K.col(w.masonry.color, 0.015, rnd);
  const H = mTop - base, GL = s1 - s0;
  const rect = K.wallAtlas.request(GL, H, paintMasonry({
    seed: w.seed, dirt: w.dirt ?? 1, north: w.north, topDrip: !!w.clad || w.topDrip, dripK: w.dripK ?? 1,
    openings: holes.map((o) => ({ s0: o.s0 - s0, s1: o.s1 - s0, z0: o.z0 - base, z1: o.z1 - base, kind: o.kind })),
    spouts: (w.spouts || []).map((a) => sOf(w, F, a) - s0), pipes: (w.pipes || []).map((a) => sOf(w, F, a) - s0),
  }));
  const gfn = (lx, ly) => [(lx - s0) / GL, (ly - base) / H];
  const piece = (a, b, z0, z1) => { if (b - a > 1e-4 && z1 - z0 > 1e-4) box(mb, F, a, b, z0, z1, -t, 0, mcol, { rect, gfn }); };
  let cur = s0;
  for (const o of holes) {
    const a = Math.max(o.s0, s0), b = Math.min(o.s1, s1);
    piece(cur, a, base, mTop);
    piece(a, b, base, Math.max(base, o.z0));
    if (o.z1 < mTop) piece(a, b, o.z1, mTop);
    cur = b;
  }
  piece(cur, s1, base, mTop);

  // ---------------- openings ----------------
  for (const o of ops) buildOpening(K, Bd, F, o, w, t, mTop);

  // ---------------- cladding ----------------
  if (w.clad) {
    const c = w.clad;
    const cf = fshift(F, 0, 0, 0.06);
    const topAt = (s) => { const p = fpt(F, s, 0, 0); return c.top(p[0], p[1]) - 0.04; };
    let hmax = 0; for (let s = 0; s <= L; s += L / 16) hmax = Math.max(hmax, topAt(s));
    for (const b of c.breaks || []) hmax = Math.max(hmax, topAt(b));
    const tMin = mTop - 0.045, Hc = Math.max(0.2, hmax - tMin);
    const crect = K.wallAtlas.request(L, Hc, paintCladding({ seed: (w.seed || 1) + 99, dirt: c.dirt ?? w.dirt ?? 1, rust: c.rust || 0, sheetW: c.sheetW }));
    const notches = ops.filter((o) => o.z1 > mTop - 0.05 && o.kind !== 'louvre');
    const breaks = [...(c.breaks || [])];
    for (const o of notches) breaks.push(o.s0, o.s1);
    const cols = {};
    profiledSheet({
      F: cf, s0: 0, s1: L, P: c.P || 0.25, depth: c.depth ?? 0.025, crest: c.crest ?? 0.03, flank: c.flank ?? 0.022, sheetW: c.sheetW || 1.0, phase: c.phase || 0,
      breaks,
      t0At: (sm) => { for (const o of notches) if (sm > o.s0 && sm < o.s1) return o.z1 + (o.kind === 'shutter' ? 0.47 : 0.03); return tMin; },
      t1At: topAt,
      colorOf: (i) => cols[i] || (cols[i] = K.col(c.colorAt(i), c.vary ?? 0.03, rnd)),
      md: Bd.md('clad'), back: Bd.md('back'), backColor: K.col('#6b6e70'),
      grime: { rect: crect, sMin: 0, sLen: L, tMin, tLen: Hc },
    });
    const tb = Bd.md('trim'), tc = K.col(c.trim || '#d9dcdc');
    // drip flashing at the masonry / cladding junction
    box(tb, F, 0, L, mTop - 0.07, mTop - 0.055, 0, 0.088, tc);
    box(tb, F, 0, L, mTop - 0.11, mTop - 0.055, 0.084, 0.09, tc);
    // flashing over shutter / door notches
    for (const o of notches) box(tb, F, o.s0 - 0.05, o.s1 + 0.05, o.z1 + (o.kind === 'shutter' ? 0.44 : 0.0), o.z1 + (o.kind === 'shutter' ? 0.47 : 0.03), 0.0, 0.075, tc);
    // corner trims (L-angles)
    if (w.cornerEnd !== false) box(tb, F, L - 0.1, L + 0.064, mTop - 0.11, topAt(L) + 0.01, 0.06, 0.066, tc);
    if (w.cornerStart !== false) box(tb, F, -0.068, 0.1, mTop - 0.11, topAt(0) + 0.01, 0.06, 0.068, tc);
  }
  return { F, L };
}

// ---------------------------------------------------------------------------
function buildOpening(K, Bd, F, o, w, t, mTop) {
  const tb = Bd.md('trim'), gl = Bd.md('glass'), mb = Bd.md('masonry');
  const onClad = o.kind === 'louvre' && o.z0 >= mTop - 1e-3;
  const { s0, s1, z0, z1 } = o;
  const rnd = rng(Math.round(s0 * 100) + 3);
  const fr = K.col(o.color || '#6f88a6', 0.04, rnd);
  const dark = K.col('#2a2c2d');
  const conc = K.col(o.sillColor || '#cfcbc2', 0.02, rnd);
  const mid = (s0 + s1) / 2;
  if (o.kind === 'window' || o.kind === 'vent') {
    // projecting concrete sill (top 15 mm above the reveal bottom → no coplanar faces)
    box(mb, F, s0 - 0.06, s1 + 0.06, z0 - 0.05, z0 + 0.015, -0.12, 0.05, conc);
    const zb = z0 + 0.015;
    const D0 = -0.135, D1 = -0.085; // frame depth band (recessed)
    box(tb, F, s0, s0 + 0.045, zb, z1, D0, D1, fr); box(tb, F, s1 - 0.045, s1, zb, z1, D0, D1, fr);
    box(tb, F, s0 + 0.045, s1 - 0.045, z1 - 0.045, z1, D0, D1, fr); box(tb, F, s0 + 0.045, s1 - 0.045, zb, zb + 0.045, D0, D1, fr);
    if (o.style === 'steel') {
      // two side-hung steel shutters, each with a mid rail
      const zi0 = zb + 0.045, zi1 = z1 - 0.045;
      for (const [a, b] of [[s0 + 0.045, mid - 0.006], [mid + 0.006, s1 - 0.045]]) {
        box(tb, F, a, b, zi0, zi1, -0.118, -0.098, fr);
        box(tb, F, a + 0.03, b - 0.03, (zi0 + zi1) / 2 - 0.02, (zi0 + zi1) / 2 + 0.02, -0.098, -0.092, fr);
        box(tb, F, a + 0.03, b - 0.03, zi1 - 0.08, zi1 - 0.05, -0.098, -0.093, fr);
        box(tb, F, a + 0.03, b - 0.03, zi0 + 0.05, zi0 + 0.08, -0.098, -0.093, fr);
      }
      box(tb, F, mid - 0.006, mid + 0.006, zi0, zi1, -0.125, -0.1, dark);
      box(tb, F, mid - 0.05, mid - 0.035, (zi0 + zi1) / 2 - 0.06, (zi0 + zi1) / 2 + 0.06, -0.092, -0.075, dark); // handle
    } else {
      // glazed steel window with transom, mullion and a security grill
      box(gl, F, s0 + 0.045, s1 - 0.045, zb + 0.045, z1 - 0.045, -0.115, -0.108, dark);
      box(tb, F, mid - 0.02, mid + 0.02, zb + 0.045, z1 - 0.045, -0.13, -0.095, fr);
      const zt = z1 - (z1 - zb) * 0.3;
      box(tb, F, s0 + 0.045, s1 - 0.045, zt - 0.02, zt + 0.02, -0.13, -0.095, fr);
      if (o.kind === 'vent') { // louvred glass vent (bathrooms)
        for (let z = zb + 0.08; z < z1 - 0.06; z += 0.07) box(gl, F, s0 + 0.05, s1 - 0.05, z, z + 0.05, -0.1, -0.09, dark);
      }
      const gc = K.col('#34383a');
      for (let s = s0 + 0.12; s < s1 - 0.08; s += 0.12) box(tb, F, s - 0.006, s + 0.006, zb, z1, -0.07, -0.058, gc);
      for (const z of [zb + (z1 - zb) * 0.33, zb + (z1 - zb) * 0.66]) box(tb, F, s0, s1, z - 0.012, z + 0.012, -0.075, -0.07, gc);
    }
    if (o.chajja) box(mb, F, s0 - 0.15, s1 + 0.15, z1 + 0.12, z1 + 0.2, 0, o.chajja, K.col('#c4c5c1'));
  } else if (o.kind === 'door') {
    const D0 = -0.14, D1 = -0.09;
    box(tb, F, s0, s0 + 0.05, z0, z1, D0, D1, fr); box(tb, F, s1 - 0.05, s1, z0, z1, D0, D1, fr);
    box(tb, F, s0 + 0.05, s1 - 0.05, z1 - 0.05, z1, D0, D1, fr);
    const leaves = o.style === 'double' ? [[s0 + 0.05, mid - 0.004], [mid + 0.004, s1 - 0.05]] : [[s0 + 0.05, s1 - 0.05]];
    const lc = K.col(o.leafColor || o.color || '#7c8794', 0.03, rnd);
    for (const [a, b] of leaves) {
      box(tb, F, a, b, z0 + 0.01, z1 - 0.05, -0.125, -0.1, lc);
      // raised panels
      const hh = z1 - 0.05 - z0;
      for (const [f0, f1] of [[0.08, 0.42], [0.52, 0.94]]) box(tb, F, a + 0.07, b - 0.07, z0 + hh * f0, z0 + hh * f1, -0.1, -0.092, lc);
      const hx = (a + b) / 2 > mid || leaves.length === 1 ? a + 0.07 : b - 0.07;
      box(tb, F, hx - 0.012, hx + 0.012, z0 + 0.95, z0 + 1.1, -0.092, -0.06, K.col('#2f3133'));
    }
    if (o.style === 'double') box(tb, F, mid - 0.004, mid + 0.004, z0, z1 - 0.05, -0.13, -0.1, dark);
    if (o.chajja) box(mb, F, s0 - 0.2, s1 + 0.2, z1 + 0.15, z1 + 0.23, 0, o.chajja, K.col('#c4c5c1'));
    if (o.ramp) ramp(K, Bd, F, s0, s1, z0, o.ramp);
  } else if (o.kind === 'shutter') {
    // rolling shutter mounted on the outside face: guides, curtain of slats, hood box
    const gc = K.col(o.color || '#a3a9ab', 0.03, rnd);
    box(tb, F, s0 - 0.07, s0 + 0.01, z0, z1 + 0.05, 0, 0.075, gc);
    box(tb, F, s1 - 0.01, s1 + 0.07, z0, z1 + 0.05, 0, 0.075, gc);
    const pitch = 0.076;
    const sl = tb;
    for (let z = z0 + 0.06; z < z1; z += pitch) {
      const za = z, zb2 = Math.min(z1, z + pitch);
      const c = K.col(o.color || '#a3a9ab', 0.035, rnd);
      const P = (s, zz, d) => fpt(F, s, zz, d);
      const prof = [[za, 0.025], [za + 0.012, 0.045], [zb2 - 0.012, 0.045], [zb2, 0.025]];
      for (let i = 0; i < 3; i++) {
        const [ya, da] = prof[i], [yb, db] = prof[i + 1];
        sl.quad(P(s0, ya, da), P(s1, ya, da), P(s1, yb, db), P(s0, yb, db), null, [[s0, ya], [s1, ya], [s1, yb], [s0, yb]], c);
      }
    }
    box(tb, F, s0, s1, z0, z0 + 0.06, 0.02, 0.055, K.col('#6d7274'));           // bottom bar
    box(tb, F, mid - 0.1, mid + 0.1, z0 + 0.25, z0 + 0.29, 0.045, 0.07, dark);    // handle
    box(tb, F, s0 - 0.12, s1 + 0.12, z1 + 0.02, z1 + 0.44, 0, 0.34, gc);          // hood
    box(tb, F, s0 - 0.13, s1 + 0.13, z1 + 0.42, z1 + 0.46, 0, 0.36, gc);
    // dark interior behind the curtain is never visible; padlock plates
    for (const s of [s0 + 0.25, s1 - 0.25]) box(tb, F, s - 0.03, s + 0.03, z0 + 0.03, z0 + 0.12, 0.055, 0.07, dark);
    if (o.ramp) ramp(K, Bd, F, s0 - 0.1, s1 + 0.1, z0, o.ramp);
  } else if (o.kind === 'louvre') {
    const d = onClad ? 0.2 : 0;
    const fc = K.col(o.color || '#8f9599', 0.03, rnd);
    box(tb, F, s0, s0 + 0.04, z0, z1, -0.12 + d, -0.06 + d, fc); box(tb, F, s1 - 0.04, s1, z0, z1, -0.12 + d, -0.06 + d, fc);
    box(tb, F, s0, s1, z1 - 0.04, z1, -0.12 + d, -0.06 + d, fc); box(tb, F, s0, s1, z0, z0 + 0.04, -0.12 + d, -0.06 + d, fc);
    box(tb, F, s0 + 0.04, s1 - 0.04, z0 + 0.04, z1 - 0.04, onClad ? 0.064 : -0.2, onClad ? 0.07 : -0.19, K.col('#161818'));
    const a = 0.7;
    for (let z = z0 + 0.09; z < z1 - 0.05; z += 0.075) {
      const y = add(mul(F.y, Math.cos(a)), mul(F.z, Math.sin(a)));
      const Fs = { o: fpt(F, 0, z, -0.09 + d), x: F.x, y, z: cross(F.x, y) };
      box(tb, Fs, s0 + 0.04, s1 - 0.04, -0.045, 0.045, -0.002, 0.002, fc);
    }
    if (!onClad) box(mb, F, s0 - 0.04, s1 + 0.04, z0 - 0.04, z0 + 0.012, -0.1, 0.04, conc);
  }
}

function ramp(K, Bd, F, s0, s1, zTop, depth) {
  const x = F.z, y = F.y, z = norm(cross(x, y));          // z = -along
  const Fr = { o: fpt(F, s1 + 0.12, 0, 0), x, y, z };
  extrudePoly(K.THREE, Bd.md('masonry'), Fr, [[0, -0.03], [depth, -0.03], [depth, 0.012], [0, zTop]], (s1 - s0) + 0.24, K.col('#a8a59f', 0.02, Math.random));
}

/** Plinth band around a rectangular footprint (box, outset by 4 cm). */
export function buildPlinth(K, Bd, f, h, color = '#8f8b84', opt = {}) {
  const o = opt.out ?? 0.04;
  const W = f.x1 - f.x0 + 2 * o, D = f.y1 - f.y0 + 2 * o;
  const F = frame([f.x0 - o, f.y0 - o, -0.05], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const per = 2 * (W + D);
  const rect = K.wallAtlas.request(per, h + 0.05, paintMasonry({ seed: opt.seed || 5, dirt: 1.3, topDrip: false, dampH: h * 0.8 }));
  const gfn = (lx, ly, lz, id) => {
    let s = 0;
    if (id === '-y') s = lx; else if (id === '+x') s = W + ly; else if (id === '+y') s = W + D + (W - lx); else if (id === '-x') s = 2 * W + D + (D - ly); else s = lx;
    return [s / per, lz / (h + 0.05)];
  };
  box(Bd.md('masonry'), F, 0, W, 0, D, 0, h + 0.05, K.col(color), { rect, gfn, skip: ['-z'] });
}
