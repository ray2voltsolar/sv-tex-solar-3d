// ============================================================================
//  STRUCTURES — geometry kit (world-space helpers + per-material batching)
//  Plan coords (x=E, y=N, z=up)  →  world (x, z, -y)
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
export const UP = new THREE.Vector3(0, 1, 0);
/** plan direction (dx, dy) → world unit-ish vector */
export const D = (dx, dy, dz = 0) => new THREE.Vector3(dx, dz, -dy);

const KEEP = new Set(['position', 'normal', 'uv']);
function prep(g) {
  for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) {
    const n = g.attributes.position.count; const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.clearGroups();
  return g;
}

/** Collects geometries per material key and merges them into one mesh each. */
export class Batch {
  constructor() { this.buckets = new Map(); }
  add(key, g) {
    prep(g);
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push(g);
    return g;
  }
  build(mats, group, ctx) {
    const meshes = {};
    for (const [key, list] of this.buckets) {
      const def = mats[key];
      if (!def) throw new Error(`structures: no material '${key}'`);
      const g = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, def.material);
      mesh.name = `structures:${key}`;
      mesh.castShadow = def.cast !== false;
      mesh.receiveShadow = def.receive !== false;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh);
      if (def.occluder) ctx.registerOccluder(mesh);
      meshes[key] = mesh;
    }
    return meshes;
  }
}

// ---------------------------------------------------------------------------
//  Primitive builders (all return world-space BufferGeometry)
// ---------------------------------------------------------------------------

/** Plan-aligned box: w along plan x (before rot), d along plan y, h up, base at z0. rot = plan angle (rad, CCW from east). */
export function boxAt(cx, cy, z0, w, d, h, rot = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.rotateY(rot);
  g.translate(cx, z0 + h / 2, -cy);
  return g;
}

/** Oriented box from centre and orthonormal axes (sizes along each). */
export function orientedBox(center, ex, ey, ez, sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  let z = ez;
  if (new THREE.Vector3().crossVectors(ex, ey).dot(ez) < 0) z = ez.clone().negate();
  const m = new THREE.Matrix4().makeBasis(ex, ey, z).setPosition(center);
  g.applyMatrix4(m);
  return g;
}

/** Rectangular member between world points a→b; w = width across (⊥ to up), h = depth along 'up' hint. */
export function beam(a, b, w, h, up = UP) {
  const L = a.distanceTo(b);
  const ez = new THREE.Vector3().subVectors(b, a).normalize();
  let ex = new THREE.Vector3().crossVectors(up, ez);
  if (ex.lengthSq() < 1e-8) ex = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), ez);
  ex.normalize();
  const ey = new THREE.Vector3().crossVectors(ez, ex).normalize();
  const c = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return orientedBox(c, ex, ey, ez, w, h, L);
}

/** Cylinder between world points (r0 at a, r1 at b). */
export function cylBetween(a, b, r0, seg = 8, r1 = r0, open = false) {
  const L = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, open);
  const ey = new THREE.Vector3().subVectors(b, a).normalize();
  const ref = Math.abs(ey.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const ex = new THREE.Vector3().crossVectors(ey, ref).normalize();
  const ez = new THREE.Vector3().crossVectors(ex, ey).normalize();
  const m = new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

/** Steel angle (L) section a→b; heel on the a-b line, flanges along dA and dB (world, will be orthogonalised). */
export function angleMember(a, b, dA, dB, size, t) {
  const ax = new THREE.Vector3().subVectors(b, a); const L = ax.length(); ax.normalize();
  const da = dA.clone().addScaledVector(ax, -dA.dot(ax)).normalize();
  let db = dB.clone().addScaledVector(ax, -dB.dot(ax)).addScaledVector(da, -dB.dot(da)).normalize();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const c1 = mid.clone().addScaledVector(da, size / 2).addScaledVector(db, t / 2);
  const c2 = mid.clone().addScaledVector(db, size / 2).addScaledVector(da, t / 2);
  return [orientedBox(c1, da, db, ax, size, t, L), orientedBox(c2, da, db, ax, t, size, L)];
}

/** Box-projection UVs from world coords (metres × scale). vOffset lets v start at 0 at ground. */
export function boxUV(g, su, sv = su, opts = {}) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const ou = opts.ou || 0, ov = opts.ov || 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = x * (opts.topScale || su); v = z * (opts.topScale || su); }
    else if (nx >= nz) { u = z * su; v = y * sv; }
    else { u = x * su; v = y * sv; }
    uv[i * 2] = u + ou; uv[i * 2 + 1] = v + ov;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * Revolve a profile [[r, y], ...] around world Y (origin). Sharp creases where the
 * profile turns more than ~35°, smooth elsewhere. UV: u around × uRep, v = profile length × vScale
 * (or v = (y - vFromY[0]) * vFromY[1] when vFromY given).
 */
export function revolve(profile, seg = 24, opts = {}) {
  const uRep = opts.uRep || 1, vScale = opts.vScale || 1;
  const phi0 = opts.phiStart || 0, phiL = opts.phiLength || Math.PI * 2;
  const n = profile.length;
  const segN = []; const segLen = [];
  for (let j = 0; j < n - 1; j++) {
    const dr = profile[j + 1][0] - profile[j][0], dy = profile[j + 1][1] - profile[j][1];
    const l = Math.hypot(dr, dy) || 1e-6; segLen.push(l);
    segN.push([dy / l, -dr / l]); // outward normal in (r, y)
  }
  const cum = [0]; for (let j = 0; j < n - 1; j++) cum.push(cum[j] + segLen[j]);
  const cosT = Math.cos(35 * Math.PI / 180);
  const pos = [], nor = [], uv = [], idx = [];
  for (let s = 0; s < n - 1; s++) {
    const ends = [s, s + 1];
    const nrm = ends.map((j, k) => {
      const other = k === 0 ? s - 1 : s + 1;
      if (other < 0 || other >= n - 1) return segN[s];
      const a = segN[s], b = segN[other];
      if (a[0] * b[0] + a[1] * b[1] > cosT) { const x = a[0] + b[0], y = a[1] + b[1]; const l = Math.hypot(x, y); return [x / l, y / l]; }
      return a;
    });
    const base = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const ph = phi0 + phiL * i / seg; const c = Math.cos(ph), sn = Math.sin(ph);
      for (let k = 0; k < 2; k++) {
        const [r, y] = profile[ends[k]];
        pos.push(r * c, y, -r * sn);
        nor.push(nrm[k][0] * c, nrm[k][1], -nrm[k][0] * sn);
        const v = opts.vFromY ? (y - opts.vFromY[0]) * opts.vFromY[1] : cum[ends[k]] * vScale;
        uv.push(i / seg * uRep, v);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2, b = a + 1, c2 = a + 2, d = a + 3;
      idx.push(a, c2, b, b, c2, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  fixWinding(g);
  return g;
}

/** Make triangle winding agree with the stored normals (per triangle). */
export function fixWinding(g) {
  const p = g.attributes.position, nrm = g.attributes.normal, ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  for (let t = 0; t < ix.length; t += 3) {
    a.fromBufferAttribute(p, ix[t]); b.fromBufferAttribute(p, ix[t + 1]); c.fromBufferAttribute(p, ix[t + 2]);
    n.subVectors(b, a).cross(c.sub(a));
    m.fromBufferAttribute(nrm, ix[t]).add(b.fromBufferAttribute(nrm, ix[t + 1])).add(c.fromBufferAttribute(nrm, ix[t + 2]));
    if (n.dot(m) < 0) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
  }
  return g;
}

/** Translate geometry to a plan point (base at z). */
export function placeAt(g, x, y, z = 0) { g.translate(x, z, -y); return g; }

/**
 * Sweep a 2D profile [[a, b], ...] along a straight direction (flat-shaded facets).
 * Point = origin + axA·a + axB·b (+ dir·len at the far end). Facet normals point to +axA side.
 * UV: u = along / uScale, v = (b + vOfs) / vScale.
 */
export function sweep(profile, origin, dir, len, axA, axB, opts = {}) {
  const uS = opts.uScale || 1, vS = opts.vScale || 1, vO = opts.vOfs || 0, flip = opts.flip ? -1 : 1;
  const pos = [], nor = [], uv = [], idx = [];
  const P = (a, b, t) => origin.clone().addScaledVector(axA, a).addScaledVector(axB, b).addScaledVector(dir, t);
  for (let j = 0; j < profile.length - 1; j++) {
    const [a0, b0] = profile[j], [a1, b1] = profile[j + 1];
    const p0 = P(a0, b0, 0), p1 = P(a1, b1, 0), p2 = P(a1, b1, len), p3 = P(a0, b0, len);
    const n = new THREE.Vector3().subVectors(p1, p0).cross(dir).normalize();
    if (n.dot(axA) * flip < 0) n.negate();
    // soften: bend rib-flank normals toward the sheet normal so thin flanks don't alias into
    // bright/dark hairlines at distance (the ribs still shade, just with softer contrast)
    if (opts.soften) n.lerp(axA.clone().multiplyScalar(flip), opts.soften).normalize();
    const base = pos.length / 3;
    for (const [p, t, b] of [[p0, 0, b0], [p1, 0, b1], [p2, len, b1], [p3, len, b0]]) {
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z);
      const uu = (t + (opts.uOfs || 0)) / uS, vv = (b + vO) / vS;
      if (opts.swap) uv.push(vv, uu); else uv.push(uu, vv);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  fixWinding(g);
  return g;
}

/** Trapezoidal sheet profile along b ∈ [b0, b1]: pans at a=0, crests at a=depth. */
export function trapProfile(b0, b1, pitch, crest, slope, depth, phase = 0) {
  const pts = [];
  const pan = pitch - crest - 2 * slope;
  // pattern within one pitch (starting mid-pan): [b, a]
  const pat = [[0, 0], [pan / 2, 0], [pan / 2 + slope, depth], [pan / 2 + slope + crest, depth], [pan / 2 + 2 * slope + crest, 0], [pitch, 0]];
  let k = Math.floor((b0 - phase) / pitch) - 1;
  const push = (b, a) => { if (b < b0 - 1e-6 || b > b1 + 1e-6) return; const l = pts[pts.length - 1]; if (l && Math.abs(l[1] - b) < 1e-5) return; pts.push([a, b]); };
  const aAt = (b) => { // profile height at b
    let x = ((b - phase) % pitch + pitch) % pitch;
    for (let i = 0; i < pat.length - 1; i++) {
      const [x0, y0] = pat[i], [x1, y1] = pat[i + 1];
      if (x >= x0 - 1e-9 && x <= x1 + 1e-9) return x1 - x0 < 1e-9 ? y0 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return 0;
  };
  push(b0, aAt(b0));
  for (; ; k++) {
    const base = phase + k * pitch;
    if (base > b1) break;
    for (const [x, a] of pat) { const b = base + x; if (b > b0 && b < b1) push(b, a); }
  }
  push(b1, aAt(b1));
  pts.sort((p, q) => p[1] - q[1]);
  return pts;
}

/** Tube along a polyline of world points with rounded bends. */
export function tubePath(points, r, radialSeg = 10, bendR = 0.3, spacing = 0.2) {
  points = points.filter((p, i) => i === 0 || p.distanceTo(points[i - 1]) > 1e-4);
  const path = new THREE.CurvePath();
  let prev = points[0].clone();
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], a = points[i - 1], b = points[i + 1];
    const da = p.distanceTo(a), db = p.distanceTo(b);
    const rr = Math.min(bendR, da * 0.45, db * 0.45);
    const pA = p.clone().addScaledVector(new THREE.Vector3().subVectors(a, p).normalize(), rr);
    const pB = p.clone().addScaledVector(new THREE.Vector3().subVectors(b, p).normalize(), rr);
    if (prev.distanceTo(pA) > 1e-4) path.add(new THREE.LineCurve3(prev, pA));
    path.add(new THREE.QuadraticBezierCurve3(pA, p.clone(), pB));
    prev = pB;
  }
  path.add(new THREE.LineCurve3(prev, points[points.length - 1].clone()));
  const L = path.getLength();
  const segs = Math.max(4, Math.min(400, Math.ceil(L / spacing) + (points.length - 2) * 6));
  return new THREE.TubeGeometry(path, segs, r, radialSeg, false);
}

/** Parabolic sag approximation of a catenary between world points. */
export function catenary(p, q, sag, n = 20) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const v = p.clone().lerp(q, t); v.y -= sag * 4 * t * (1 - t);
    pts.push(v);
  }
  return pts;
}

/** Simple tube through points (no bend rounding) — for wires. */
export function wireTube(points, r, radialSeg = 4) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, points.length * 2, r, radialSeg, false);
}

/** Seeded RNG. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Handrail run between plan points at deck z: posts, top/mid rails, toe plate. */
export function handrail(batch, key, pts, z, opts = {}) {
  const H = opts.height || 1.05, post = opts.postEvery || 1.5, r = opts.r || 0.021;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(L / post));
    for (let k = 0; k <= n; k++) {
      if (k === 0 && i > 0) continue;
      const t = k / n; const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      batch.add(key, cylBetween(V(x, y, z), V(x, y, z + H), r, 6));
    }
    batch.add(key, cylBetween(V(x0, y0, z + H), V(x1, y1, z + H), r * 1.05, 6));
    batch.add(key, cylBetween(V(x0, y0, z + H * 0.5), V(x1, y1, z + H * 0.5), r * 0.85, 6));
    if (opts.toe !== false) batch.add(key, beam(V(x0, y0, z + 0.05), V(x1, y1, z + 0.05), 0.006, 0.1));
  }
}
