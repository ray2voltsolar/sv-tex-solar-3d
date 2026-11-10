// ============================================================================
//  BUILDINGS — roofs: trapezoidal sheets whose CREST surface lies exactly on
//  the roof plane (h = 0 in the plane frame; pans/ribs are below), polycarbonate
//  skylight sheets, undersides, purlins & eave cantilevers, verge / apron /
//  ridge flashings, box gutters with downpipes, fastener positions.
// ============================================================================
import { fpt, box, extrudePoly, profiledSheet, planeFrame, pipePath, cross, norm, mul, add, sub, rng, frame } from './lib.js';
import { paintRoof, paintUnder } from './textures.js';

export const RIB = { P: 0.25, depth: 0.028, crest: 0.035, flank: 0.025, sheetW: 1.0 };

/** Purlin lines (t along the slope) for a plane. */
export function purlinTs(L, tWall) {
  const ts = [0.12];
  let last = 0.12;
  if (tWall != null && tWall > 0.3) { ts.push(tWall + 0.2); last = tWall + 0.2; }
  const end = L - 0.22;
  const n = Math.max(1, Math.ceil((end - last) / 1.45));
  for (let i = 1; i <= n; i++) ts.push(last + (end - last) * i / n);
  return ts;
}

/**
 * o: { bucket, color, vary, replaced, rusty, skylight:{every, phase, t0, t1}, trimBucket, trimColor,
 *      underColor, edges:{s0,s1,high,low} ('verge' | 'apron:<d>' | 'flash' | null), tWall, brackets:[s],
 *      grime:{dirt,dust,rust,moss,soot}, obstacles:[{u,v}], seed, screws:bool }
 */
export function buildRoofPlane(K, Bd, pl, o) {
  const F = planeFrame(pl), W = pl.width, L = pl.length;
  const rnd = rng(o.seed || 17);
  const ts = purlinTs(L, o.tWall);
  const laps = o.laps ?? (L > 8.5 ? [L * 0.52] : []);
  const sk = o.skylight;
  const skyRects = [];
  if (sk) for (let i = sk.phase; (i + 1) * RIB.sheetW <= W + 1e-6; i += sk.every) skyRects.push({ s0: i * RIB.sheetW, s1: (i + 1) * RIB.sheetW, t0: sk.t0, t1: L - sk.t1 });
  const rect = K.roofAtlas.request(W, L, paintRoof({ seed: o.seed, ...(o.grime || {}), lift: true, obstacles: o.obstacles || [], laps, fastenerRows: ts, skyRects }));
  const g = o.grime || {};
  const urect = K.underAtlas.request(W, L, paintUnder({ seed: o.seed, rust: (g.rust ?? 0.2) + 0.1, soot: g.soot, purlins: ts, dirt: g.dirt ?? 1 }));
  const cols = {}, skc = {};
  const colorOf = (i) => {
    if (cols[i]) return cols[i];
    let hex = o.color;
    if (o.replaced && rnd() < o.replaced) hex = o.replacedColor || o.color;
    const c = K.col(hex, o.vary ?? 0.035, rnd);
    if (o.rusty && rnd() < o.rusty) c.lerp(K.col('#8a6a52'), 0.25 + rnd() * 0.2);
    return (cols[i] = c);
  };
  profiledSheet({
    F, s0: 0, s1: W, ...RIB, phase: 0,
    t0At: () => 0, t1At: () => L,
    splits: sk ? (i) => ((i - sk.phase) % sk.every === 0 && i >= sk.phase ? [sk.t0, L - sk.t1] : null) : null,
    colorOf, splitColorOf: (i) => skc[i] || (skc[i] = K.col(o.skyColor || '#b4b8ad', 0.05, rnd)),
    md: Bd.md(o.bucket), splitMd: sk ? Bd.md('skylight') : null,
    back: Bd.md('back'), backColor: K.col(o.underColor || '#8d9090'),
    backGrime: { rect: urect, sMin: 0, sLen: W, tMin: 0, tLen: L },
    grime: { rect, sMin: 0, sLen: W, tMin: 0, tLen: L },
  });
  // purlins (C-sections) under the sheets, full width; visible in overhangs
  const tb = Bd.md('trim'), pc = K.col(o.purlinColor || '#6f6b63');
  const hU = -RIB.depth - 0.006;
  const pi = o.purlinInset ?? 0.03;
  for (const t of ts) box(tb, F, pi, W - pi, t - 0.032, t + 0.032, hU - 0.15, hU, pc);
  // eave cantilevers (only in the overhang)
  const bd = o.bracketDepth ?? 0.12;
  if (o.tWall != null && o.brackets) for (const s of o.brackets) box(tb, F, s - 0.03, s + 0.03, 0.02, o.tWall + 0.06, hU - 0.15 - bd, hU - 0.15, pc);
  // edges
  const fb = Bd.md(o.trimBucket || 'trim'), fc = K.col(o.trimColor || o.color);
  for (const [edge, kind] of Object.entries(o.edges || {})) if (kind) edgeFlash(K, fb, pl, edge, kind, fc);
  // fasteners
  const screwCol = K.col(o.screwColor || o.color).multiplyScalar(o.screwTone ?? 0.92);
  if (o.screws !== false && K.quality !== 'low') {
    for (const t of ts) for (let k = 0; (k + 0.5) * RIB.P < W; k += 2) {
      const s = (k + 0.5) * RIB.P;
      if (s < 0.2 || s > W - 0.2) continue;
      K.screws.push({ p: fpt(F, s, t, 0), u: pl.u, n: pl.n, c: screwCol });
    }
  }
  return { F, ts, rect };
}

/** Flashing along one edge of a plane. kind: 'verge' (down-turned), 'apron:d' (up-stand against a wall d m outside the edge), 'flash' (over high edge, down-turned). */
export function edgeFlash(K, md, pl, edge, kind, col) {
  const W = pl.width, L = pl.length, u = pl.u, v = pl.v, n = pl.n;
  const P = (s, t) => add(add(pl.eaveStart, mul(u, s)), mul(v, t));
  let Fe, len;
  if (edge === 's0') { Fe = frame(P(0, L), u, n, mul(v, -1)); len = L; }
  else if (edge === 's1') { Fe = frame(P(W, 0), mul(u, -1), n, v); len = L; }
  else if (edge === 'high') { Fe = frame(P(W, L), mul(v, -1), n, mul(u, -1)); len = W; }
  else { Fe = frame(P(0, 0), v, n, u); len = W; }
  let poly;
  if (kind.startsWith('apron')) {
    const d = parseFloat(kind.split(':')[1] || '0');
    const a0 = -d - 0.004, a1 = -d, top = Math.max(0.15, -d + 0.15);
    poly = [[a0, 0.004], [top, 0.004], [top, 0.007], [a1, 0.007], [a1, 0.22], [a0, 0.22]];
  } else {
    const drop = kind.includes(':') ? parseFloat(kind.split(':')[1]) : kind === 'flash' ? 0.16 : 0.2;
    poly = [[-0.012, -drop], [-0.008, -drop], [-0.008, 0.004], [0.15, 0.004], [0.15, 0.007], [-0.012, 0.007]];
  }
  extrudePoly(K.THREE, md, Fe, poly, len, col);
}

/** Ridge capping along a gable ridge. axis 'NS' (ridge along y) or 'EW'. */
export function buildRidge(K, md, r, col) {
  // cross-section (a across, b up relative to the crest line at the ridge)
  const p = r.pitch, half = 0.25 * (r.wide || 1);
  const top = [];
  const prof = [[-half - 0.012, -half * p + 0.0045], [-half, -half * p + 0.008], [-0.12, -0.12 * p + 0.016], [-0.05, 0.045], [0, 0.058], [0.05, 0.045], [0.12, -0.12 * p + 0.016], [half, -half * p + 0.008], [half + 0.012, -half * p + 0.0045]];
  for (const q of prof) top.push(q);
  const bottom = top.map(([a, b], i) => [a + (i === 0 ? 0.004 : i === top.length - 1 ? -0.004 : 0), b - 0.003]);
  const poly = [...bottom, ...top.slice().reverse()];
  let F, length;
  if (r.axis === 'NS') { F = frame([r.at, r.to, r.z], [1, 0, 0], [0, 0, 1]); length = r.to - r.from; }
  else { F = frame([r.from, r.at, r.z], [0, 1, 0], [0, 0, 1]); length = r.to - r.from; }
  extrudePoly(K.THREE, md, F, poly, length, col);
}

/**
 * Box gutter under a horizontal eave (t = 0 edge) from s0 to s1, with downpipes.
 * o: { s0, s1, color, bucket, pipeColor, downs:[{s, wallOff, endZ}] }
 */
export function buildGutter(K, Bd, pl, o) {
  const u = pl.u, v = pl.v;
  const hout = norm([-v[0], -v[1], 0]);
  const up = [0, 0, 1];
  const z = cross(hout, up);
  const dir = Math.sign(z[0] * u[0] + z[1] * u[1]) || 1;
  const E = (s) => add(pl.eaveStart, mul(u, s));
  const sA = dir > 0 ? o.s0 : o.s1;
  const F = frame(E(sA), hout, up, z);
  const len = o.s1 - o.s0;
  const md = Bd.md(o.bucket || 'trim'), c = K.col(o.color || '#b8bcbc', 0.02, Math.random);
  // 150 mm eave gutter projecting ~11 cm beyond the sheet edge (so it reads from the air), sheet drips into it
  const X = 0.05;
  box(md, F, -0.09 + X, 0.06 + X, -0.17, -0.166, 0, len, c);
  box(md, F, -0.09 + X, -0.086 + X, -0.166, -0.05, 0, len, c);
  box(md, F, 0.056 + X, 0.06 + X, -0.166, -0.04, 0, len, c);
  box(md, F, 0.05 + X, 0.07 + X, -0.045, -0.033, 0, len, c);
  box(md, F, -0.086 + X, 0.056 + X, -0.166, -0.045, 0, 0.004, c);
  box(md, F, -0.086 + X, 0.056 + X, -0.166, -0.045, len - 0.004, len, c);
  // dark water / silt line inside the trough (visible from above)
  box(md, F, -0.084 + X, 0.054 + X, -0.163, -0.15, 0.004, len - 0.004, c.clone().multiplyScalar(0.55));
  for (let k = 0.5; k < len - 0.2; k += 1.0) box(md, F, -0.09 + X, 0.07 + X, -0.041, -0.037, k, k + 0.025, c);
  const pm = Bd.md('plastic'), pcol = K.col(o.pipeColor || '#a9aca9', 0.02, Math.random);
  for (const d of o.downs || []) {
    const G = add(E(d.s), mul(hout, 0.035));
    const zg = G[2] - 0.166;
    const Dh = d.wallOff - 0.13 + 0.035;
    const Wp = add(E(d.s), mul(hout, -(d.wallOff - 0.13)));
    const pts = [[G[0], G[1], zg + 0.01], [G[0], G[1], zg - 0.1]];
    let zc = zg - 0.1;
    if (Dh > 0.08) { zc -= Dh; pts.push([Wp[0], Wp[1], zc]); }
    const zEnd = (d.endZ ?? 0) + 0.32;
    if (zc - zEnd > 0.05) pts.push([Wp[0], Wp[1], zEnd]);
    const kick = add(Wp, mul(hout, 0.16));
    pts.push([kick[0], kick[1], zEnd - 0.16]);
    pipePath(pm, pts, 0.05, 10, pcol);
    // wall clamps every ~1.8 m
    for (let zz = zEnd + 0.6; zz < zc - 0.3; zz += 1.8) {
      const Fc = frame([Wp[0], Wp[1], zz], cross(up, hout), up, hout);
      box(md, Fc, -0.06, 0.06, -0.015, 0.015, -0.13, 0.058, K.col('#7d8183'));
    }
    // outlet socket at the gutter
    tubeSocket(pm, G, zg, pcol);
  }
}
function tubeSocket(md, G, zg, c) {
  pipePath(md, [[G[0], G[1], zg + 0.004], [G[0], G[1], zg - 0.04]], 0.058, 10, c);
}
