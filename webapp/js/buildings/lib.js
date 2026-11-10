// ============================================================================
//  BUILDINGS — geometry kit.
//  All construction happens in PLAN coordinates (x = E, y = N, z = up) inside
//  local orthonormal "frames"; vertices are converted to three.js world
//  (X = x, Y = z, Z = -y) when written into a MeshData buffer.
//  A MeshData collects flat-shaded triangles with position / normal / uv /
//  vertex colour / grime-atlas uv, and becomes ONE BufferGeometry per
//  (building, material) so the whole module stays at a few dozen draw calls.
// ============================================================================

// ---------- small vector helpers (arrays, plan coords) ----------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Seeded xorshift RNG → () => [0,1) */
export function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ---------- frames ----------
/** Frame: origin o and axes x, y, z (plan coords, orthonormal, right-handed). */
export function frame(o, x, y, z) { return { o, x, y, z: z || cross(x, y) }; }
export function fpt(F, a, b, c) {
  return [F.o[0] + F.x[0] * a + F.y[0] * b + F.z[0] * c,
          F.o[1] + F.x[1] * a + F.y[1] * b + F.z[1] * c,
          F.o[2] + F.x[2] * a + F.y[2] * b + F.z[2] * c];
}
export function fdir(F, a, b, c) {
  return [F.x[0] * a + F.y[0] * b + F.z[0] * c, F.x[1] * a + F.y[1] * b + F.z[1] * c, F.x[2] * a + F.y[2] * b + F.z[2] * c];
}
/** Frame offset to local point (a,b,c) keeping axes. */
export function fshift(F, a, b, c) { return { o: fpt(F, a, b, c), x: F.x, y: F.y, z: F.z }; }
/** Frame whose z axis points from p0 to p1 (for tubes). */
export function frameAlong(p0, p1) {
  const z = norm(sub(p1, p0));
  const ref = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const x = norm(cross(ref, z));
  const y = cross(z, x);
  return { o: p0, x, y, z };
}

// ---------- plane helpers (same maths as site-data.makePlane) ----------
export function makePlane(def) {
  let { eaveStart, eaveEnd, highStart } = def;
  let u = norm(sub(eaveEnd, eaveStart));
  let v = norm(sub(highStart, eaveStart));
  let n = norm(cross(u, v));
  if (n[2] < 0) {
    eaveStart = def.eaveEnd; eaveEnd = def.eaveStart;
    highStart = add(def.highStart, sub(def.eaveEnd, def.eaveStart));
    u = norm(sub(eaveEnd, eaveStart)); v = norm(sub(highStart, eaveStart)); n = norm(cross(u, v));
  }
  return { ...def, eaveStart, eaveEnd, highStart, u, v, n,
    width: len(sub(eaveEnd, eaveStart)), length: len(sub(highStart, eaveStart)) };
}
export const planeFrame = (pl) => ({ o: pl.eaveStart, x: pl.u, y: pl.v, z: pl.n });
export function pZ(pl, x, y) { const n = pl.n, e = pl.eaveStart; return e[2] - (n[0] * (x - e[0]) + n[1] * (y - e[1])) / n[2]; }

// ---------- MeshData ----------
export class MeshData {
  constructor(name, atlas = null) {
    this.name = name; this.atlas = atlas;
    this.p = []; this.n = []; this.uv = []; this.c = []; this.g = []; this.gr = [];
  }
  get vertexCount() { return this.p.length / 3; }
  _v(P, N, u, v, col, gu, gv, rect) {
    this.p.push(P[0], P[2], -P[1]); this.n.push(N[0], N[2], -N[1]);
    this.uv.push(u, v); this.c.push(col.r, col.g, col.b);
    if (this.atlas) { this.g.push(gu, gv); this.gr.push(rect); }
  }
  /** Triangle with explicit per-vertex normals (plan) or a face normal. */
  tri(P0, P1, P2, N, uvs, col, gr) {
    const f = N && !Array.isArray(N[0]) ? N : null;
    let fn = f;
    if (!N) fn = norm(cross(sub(P1, P0), sub(P2, P0)));
    const Ns = N && Array.isArray(N[0]) ? N : [fn, fn, fn];
    const U = uvs || [[0, 0], [0, 0], [0, 0]];
    const G = gr ? gr.g : null, R = gr ? gr.rect : null;
    this._v(P0, Ns[0], U[0][0], U[0][1], col, G ? G[0][0] : 0, G ? G[0][1] : 0, R);
    this._v(P1, Ns[1], U[1][0], U[1][1], col, G ? G[1][0] : 0, G ? G[1][1] : 0, R);
    this._v(P2, Ns[2], U[2][0], U[2][1], col, G ? G[2][0] : 0, G ? G[2][1] : 0, R);
  }
  /** Quad P0..P3 counter-clockwise seen from the front. N: face normal, 4 normals, or null (computed). */
  quad(P0, P1, P2, P3, N, uvs, col, gr) {
    let Ns;
    if (!N) { const fn = norm(cross(sub(P1, P0), sub(P3, P0))); Ns = [fn, fn, fn, fn]; }
    else if (Array.isArray(N[0])) Ns = N; else Ns = [N, N, N, N];
    const U = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const G = gr ? gr.g : null;
    const g0 = G ? [G[0], G[1], G[2]] : null, g1 = G ? [G[0], G[2], G[3]] : null;
    this.tri(P0, P1, P2, [Ns[0], Ns[1], Ns[2]], [U[0], U[1], U[2]], col, gr ? { rect: gr.rect, g: g0 } : null);
    this.tri(P0, P2, P3, [Ns[0], Ns[2], Ns[3]], [U[0], U[2], U[3]], col, gr ? { rect: gr.rect, g: g1 } : null);
  }
  /** Convert to BufferGeometry (call after the atlas is finalised). */
  toGeometry(THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.atlas) {
      const out = new Float32Array(this.g.length);
      const W = this.atlas.white;
      for (let i = 0, k = 0; i < this.gr.length; i++, k += 2) {
        const r = this.gr[i];
        if (r && r.ready) {
          out[k] = r.u0 + clamp(this.g[k], 0, 1) * (r.u1 - r.u0);
          out[k + 1] = r.v0 + clamp(this.g[k + 1], 0, 1) * (r.v1 - r.v0);
        } else { out[k] = W[0]; out[k + 1] = W[1]; }
      }
      g.setAttribute('grimeUv', new THREE.BufferAttribute(out, 2));
    }
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

// ---------- primitives ----------
/**
 * Axis-aligned box in frame F (local x0..x1, y0..y1, z0..z1).
 * uv = metric face coordinates. gfn(lx,ly,lz) → [gu,gv] local grime coords (with rect).
 * skip: set of faces to omit ('+x','-x','+y','-y','+z','-z').
 */
export function box(md, F, x0, x1, y0, y1, z0, z1, col, opt = {}) {
  const { rect = null, gfn = null, skip = null, uvScale = 1 } = opt;
  const P = (a, b, c) => fpt(F, a, b, c);
  const faces = [
    ['+x', [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], (p) => [p[1], p[2]], F.x],
    ['-x', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], (p) => [p[1], p[2]], mul(F.x, -1)],
    ['+y', [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], (p) => [p[0], p[2]], F.y],
    ['-y', [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], (p) => [p[0], p[2]], mul(F.y, -1)],
    ['+z', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], (p) => [p[0], p[1]], F.z],
    ['-z', [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], (p) => [p[0], p[1]], mul(F.z, -1)],
  ];
  for (const [id, c, uvf, N] of faces) {
    if (skip && skip.includes(id)) continue;
    const pts = c.map((q) => P(q[0], q[1], q[2]));
    const uvs = c.map((q) => { const t = uvf(q); return [t[0] * uvScale, t[1] * uvScale]; });
    const gr = rect && gfn ? { rect, g: c.map((q) => gfn(q[0], q[1], q[2], id)) } : null;
    md.quad(pts[0], pts[1], pts[2], pts[3], N, uvs, col, gr);
  }
}

/** Cylinder (or cone) along frame z from z0 to z1, radius r0 at z0 and r1 at z1. */
export function cylinder(md, F, r0, z0, z1, seg, col, opt = {}) {
  const { r1 = r0, capTop = true, capBottom = true, a0 = 0, a1 = Math.PI * 2 } = opt;
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const slope = (r0 - r1) / (z1 - z0);
  for (let i = 0; i < seg; i++) {
    const t0 = a0 + (a1 - a0) * i / seg, t1 = a0 + (a1 - a0) * (i + 1) / seg;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    const n0 = norm(fdir(F, c0, s0, slope)), n1 = norm(fdir(F, c1, s1, slope));
    const A = fpt(F, r0 * c0, r0 * s0, z0), B = fpt(F, r0 * c1, r0 * s1, z0);
    const C = fpt(F, r1 * c1, r1 * s1, z1), D = fpt(F, r1 * c0, r1 * s0, z1);
    const ua = i / seg * Math.PI * 2 * Math.max(r0, r1), ub = (i + 1) / seg * Math.PI * 2 * Math.max(r0, r1);
    md.quad(A, B, C, D, [n0, n1, n1, n0], [[ua, z0], [ub, z0], [ub, z1], [ua, z1]], col);
    if (full && capTop && r1 > 0) md.tri(fpt(F, 0, 0, z1), D, C, F.z, [[0, 0], [r1 * c0, r1 * s0], [r1 * c1, r1 * s1]], col);
    if (full && capBottom && r0 > 0) md.tri(fpt(F, 0, 0, z0), B, A, mul(F.z, -1), [[0, 0], [r0 * c1, r0 * s1], [r0 * c0, r0 * s0]], col);
  }
}

/** Tube between two plan points. */
export function tube(md, p0, p1, r, seg, col, opt = {}) {
  const F = frameAlong(p0, p1);
  cylinder(md, F, r, 0, len(sub(p1, p0)), seg, col, opt);
}

/** Polyline tube with small collars at joints. */
export function pipePath(md, pts, r, seg, col, collarCol) {
  for (let i = 0; i < pts.length - 1; i++) tube(md, pts[i], pts[i + 1], r, seg, col, { capTop: i === pts.length - 2, capBottom: i === 0 });
  for (let i = 1; i < pts.length - 1; i++) {
    // joint sleeve: short slightly fatter cylinder along the bisector-ish of the next segment
    const F = frameAlong(pts[i], pts[i + 1]);
    cylinder(md, F, r * 1.18, -0.05, 0.06, seg, collarCol || col);
  }
}

/**
 * Extrude a closed 2D polygon (local a = frame x, b = frame y), CCW, along frame z for length L.
 */
export function extrudePoly(THREE, md, F, poly, L, col, opt = {}) {
  const { caps = true, uvScale = 1 } = opt;
  const n = poly.length;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const A = fpt(F, p[0], p[1], 0), B = fpt(F, q[0], q[1], 0), C = fpt(F, q[0], q[1], L), D = fpt(F, p[0], p[1], L);
    const el = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const N = norm(fdir(F, q[1] - p[1], -(q[0] - p[0]), 0));
    md.quad(A, B, C, D, N, [[acc, 0], [acc + el, 0], [acc + el, L], [acc, L]].map(([u, v]) => [u * uvScale, v * uvScale]), col);
    acc += el;
  }
  if (!caps) return;
  const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const t of tris) {
    let [i0, i1, i2] = t;
    const a = poly[i0], b = poly[i1], c = poly[i2];
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (area < 0) [i1, i2] = [i2, i1];
    const P = (i, z) => fpt(F, poly[i][0], poly[i][1], z);
    const U = (i) => [poly[i][0], poly[i][1]];
    // cap at z = L faces +z (CCW), cap at z = 0 faces -z (reversed)
    md.tri(P(i0, L), P(i1, L), P(i2, L), F.z, [U(i0), U(i1), U(i2)], col);
    md.tri(P(i0, 0), P(i2, 0), P(i1, 0), mul(F.z, -1), [U(i0), U(i2), U(i1)], col);
  }
}

/** Append a three.js BufferGeometry defined in frame-local coords. */
export function appendGeometry(md, geo, F, col) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
  for (let i = 0; i < P.count; i += 3) {
    const pts = [], ns = [], uvs = [];
    for (let k = 0; k < 3; k++) {
      pts.push(fpt(F, P.getX(i + k), P.getY(i + k), P.getZ(i + k)));
      ns.push(N ? norm(fdir(F, N.getX(i + k), N.getY(i + k), N.getZ(i + k))) : null);
      uvs.push(UV ? [UV.getX(i + k), UV.getY(i + k)] : [0, 0]);
    }
    md.tri(pts[0], pts[1], pts[2], ns[0] ? ns : null, uvs, col);
  }
}

// ---------- trapezoidal profiled sheet ----------
/**
 * Generate a profiled (trapezoidal) sheet in frame F: s along F.x (profile direction),
 * t along F.y (rib direction), h along F.z (crest at h = 0, pans at h = -depth).
 * opts:
 *   s0, s1, P (rib pitch), depth, crest, flank, phase, sheetW, breaks[]
 *   t0At(sMid) → start t for the segment, t1At(s) → end t (linear per segment)
 *   splits(sheetIdx) → [k0, k1] | null  (t-range going to opts.splitMd)
 *   colorOf(sheetIdx) → THREE.Color ; splitColorOf(sheetIdx)
 *   md (front), back (MeshData|null), backOffset, backColor
 *   grime: { rect, sMin, sLen, tMin, tLen }
 */
export function profiledSheet(opts) {
  const { s0, s1, P = 0.25, depth = 0.028, crest = 0.035, flank = 0.025, phase = 0, sheetW = 1.0,
    breaks = [], t0At, t1At, splits = null, colorOf, splitColorOf, md, splitMd, back = null,
    backOffset = 0.004, backColor, grime = null, backGrime = null, F, ribsPerUv = 4 } = opts;
  const a = (P - crest - 2 * flank) / 2;
  const hAt = (s) => {
    let f = (s - phase) % P; if (f < 0) f += P;
    if (f < a) return -depth;
    if (f < a + flank) return -depth + depth * (f - a) / flank;
    if (f < a + flank + crest) return 0;
    if (f < a + 2 * flank + crest) return -depth * (f - a - flank - crest) / flank;
    return -depth;
  };
  const pts = new Set([s0, s1]);
  const k0 = Math.floor((s0 - phase) / P) - 1, k1 = Math.ceil((s1 - phase) / P) + 1;
  for (let k = k0; k <= k1; k++) {
    const b = phase + k * P;
    for (const o of [0, a, a + flank, a + flank + crest, a + 2 * flank + crest]) {
      const s = b + o; if (s > s0 + 1e-6 && s < s1 - 1e-6) pts.add(+s.toFixed(6));
    }
  }
  for (const b of breaks) if (b > s0 + 1e-6 && b < s1 - 1e-6) pts.add(b);
  const S = [...pts].sort((x, y) => x - y);
  const uvx = (s) => (s - phase) / (P * ribsPerUv);
  const GB = (s, t) => [(s - backGrime.sMin) / backGrime.sLen, (t - backGrime.tMin) / backGrime.tLen];
  const G = (s, t) => grime ? [(s - grime.sMin) / grime.sLen, (t - grime.tMin) / grime.tLen] : [0, 0];
  for (let i = 0; i < S.length - 1; i++) {
    const sa = S[i], sb = S[i + 1];
    if (sb - sa < 1e-5) continue;
    const sm = (sa + sb) / 2;
    const hA = hAt(sa), hB = hAt(sb);   // profile is continuous piecewise-linear
    const idx = Math.floor((sm - phase) / sheetW);
    const t0 = t0At(sm), ta1 = t1At(sa), tb1 = t1At(sb);
    if (ta1 <= t0 + 1e-4 && tb1 <= t0 + 1e-4) continue;
    const ivs = [];
    const sp = splits ? splits(idx) : null;
    if (sp && sp[0] > t0 && sp[1] < Math.min(ta1, tb1)) {
      ivs.push([t0, t0, sp[0], sp[0], md, colorOf(idx)]);
      ivs.push([sp[0], sp[0], sp[1], sp[1], splitMd, splitColorOf(idx)]);
      ivs.push([sp[1], sp[1], ta1, tb1, md, colorOf(idx)]);
    } else ivs.push([t0, t0, ta1, tb1, md, colorOf(idx)]);
    for (const [ua0, ub0, ua1, ub1, M, col] of ivs) {
      const A = fpt(F, sa, ua0, hA), B = fpt(F, sb, ub0, hB), C = fpt(F, sb, ub1, hB), D = fpt(F, sa, ua1, hA);
      const N = norm(cross(sub(B, A), sub(D, A)));
      const uvs = [[uvx(sa), ua0 / 2], [uvx(sb), ub0 / 2], [uvx(sb), ub1 / 2], [uvx(sa), ua1 / 2]];
      const gr = grime ? { rect: grime.rect, g: [G(sa, ua0), G(sb, ub0), G(sb, ub1), G(sa, ua1)] } : null;
      M.quad(A, B, C, D, N, uvs, col, gr);
      if (back) {
        const o = -backOffset;
        const A2 = fpt(F, sa, ua0, hA + o), B2 = fpt(F, sb, ub0, hB + o), C2 = fpt(F, sb, ub1, hB + o), D2 = fpt(F, sa, ua1, hA + o);
        back.quad(A2, D2, C2, B2, mul(N, -1), [uvs[0], uvs[3], uvs[2], uvs[1]], backColor,
          backGrime ? { rect: backGrime.rect, g: [GB(sa, ua0), GB(sa, ua1), GB(sb, ub1), GB(sb, ub0)] } : null);
      }
    }
  }
  return { hAt, crestCenters: (k) => phase + (k + 0.5) * P };
}
