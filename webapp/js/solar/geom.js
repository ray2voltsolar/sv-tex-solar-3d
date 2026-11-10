// ============================================================================
//  SOLAR — geometry helpers (non-indexed position/normal/uv buffers, groups)
// ============================================================================
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();

/** Simple geometry builder with optional material groups. */
export class GB {
  constructor() { this.parts = []; this.cur = null; this.group(0); }
  group(mi) {
    let p = this.parts.find((q) => q.mi === mi);
    if (!p) { p = { mi, p: [], n: [], t: [] }; this.parts.push(p); }
    this.cur = p; return this;
  }
  _v(v, n, t) { this.cur.p.push(v.x, v.y, v.z); this.cur.n.push(n.x, n.y, n.z); this.cur.t.push(t ? t[0] : 0, t ? t[1] : 0); }
  /** triangle with a shared normal; winding fixed to agree with n */
  tri(a, b, c, n, ta, tb, tc) {
    _a.subVectors(b, a); _b.subVectors(c, a); _c.crossVectors(_a, _b);
    if (_c.dot(n) < 0) { [b, c] = [c, b]; [tb, tc] = [tc, tb]; }
    this._v(a, n, ta); this._v(b, n, tb); this._v(c, n, tc);
    return this;
  }
  /** quad a-b-c-d (any consistent order) with normal n */
  quad(a, b, c, d, n, uv) {
    uv = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.tri(a, b, c, n, uv[0], uv[1], uv[2]);
    this.tri(a, c, d, n, uv[0], uv[2], uv[3]);
    return this;
  }
  /** add any THREE geometry transformed by matrix (Matrix4) */
  add(geom, matrix) {
    let g = geom.index ? geom.toNonIndexed() : geom.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    const T = g.attributes.uv ? g.attributes.uv.array : null;
    for (let i = 0; i < P.length / 3; i++) {
      this.cur.p.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      this.cur.n.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
      this.cur.t.push(T ? T[i * 2] : 0, T ? T[i * 2 + 1] : 0);
    }
    g.dispose();
    return this;
  }
  /** oriented box from centre + three half-axis vectors (THREE.Vector3) */
  obox(c, ax, ay, az, uvScale = 1) {
    // a left-handed basis would mirror the box → flipped winding → inside-out (dark) faces.
    // The box is symmetric, so flipping one half-axis gives the identical solid, right-handed.
    const zx = az.clone().normalize();
    if (_c.crossVectors(ax, ay).dot(zx) < 0) zx.negate();
    const m = new THREE.Matrix4().makeBasis(ax.clone().normalize(), ay.clone().normalize(), zx);
    m.scale(new THREE.Vector3(ax.length() * 2, ay.length() * 2, az.length() * 2)).setPosition(c);
    const g = new THREE.BoxGeometry(1, 1, 1);
    if (uvScale !== 1) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale); }
    return this.add(g, m);
  }
  get triCount() { return this.parts.reduce((s, p) => s + p.p.length / 9, 0); }
  build() {
    const parts = this.parts.filter((p) => p.p.length).sort((a, b) => a.mi - b.mi);
    const P = [], N = [], T = [];
    const g = new THREE.BufferGeometry();
    let start = 0;
    for (const p of parts) {
      const cnt = p.p.length / 3;
      P.push(...chunk(p.p)); N.push(...chunk(p.n)); T.push(...chunk(p.t));
      if (parts.length > 1 || p.mi !== 0) g.addGroup(start, cnt, p.mi);
      start += cnt;
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(flat(P), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(flat(N), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(flat(T), 2));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
// avoid call-stack overflow with huge spreads
function chunk(a) { return [a]; }
function flat(arrs) {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Float32Array(n); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/** box between two points (world) with given cross-section w (side) × h (up), up hint vector */
export function beam(gb, p0, p1, w, h, upHint, extend = 0, uvScale = 1) {
  const f = new THREE.Vector3().subVectors(p1, p0);
  const L = f.length(); if (L < 1e-6) return gb;
  f.divideScalar(L);
  let up = upHint.clone();
  if (Math.abs(up.dot(f)) > 0.98) up = Math.abs(f.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3().crossVectors(f, up).normalize();
  up.crossVectors(side, f).normalize();
  const c = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
  return gb.obox(c, side.multiplyScalar(w / 2), up.multiplyScalar(h / 2), f.multiplyScalar(L / 2 + extend), uvScale);
}

/** cylinder between two points */
export function rod(gb, p0, p1, r, seg = 8, capped = true) {
  const d = new THREE.Vector3().subVectors(p1, p0); const L = d.length(); if (L < 1e-6) return gb;
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1, !capped);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  return gb.add(g, m);
}

/**
 * Sweep a closed 2D profile [(s, y)] around a rectangle (half sizes hw, hl in local X/Z),
 * s = inset from the outer edge, y = local up. Produces mitred corners automatically.
 * Profile must be ordered so that normal = normalize(dy, -ds) points outward of the solid.
 */
export function sweepRect(gb, profile, hw, hl) {
  const corners = (s) => [
    new THREE.Vector3(-hw + s, 0, -hl + s), new THREE.Vector3(hw - s, 0, -hl + s),
    new THREE.Vector3(hw - s, 0, hl - s), new THREE.Vector3(-hw + s, 0, hl - s)];
  const inward = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)];
  for (let i = 0; i < profile.length; i++) {
    const [s0, y0] = profile[i], [s1, y1] = profile[(i + 1) % profile.length];
    const ds = s1 - s0, dy = y1 - y0; const l = Math.hypot(ds, dy); if (l < 1e-9) continue;
    const ns = dy / l, ny = -ds / l;
    const c0 = corners(s0), c1 = corners(s1);
    for (let e = 0; e < 4; e++) {
      const n = inward[e].clone().multiplyScalar(ns).add(new THREE.Vector3(0, ny, 0)).normalize();
      const a = c0[e].clone().setY(y0), b = c0[(e + 1) % 4].clone().setY(y0);
      const c = c1[(e + 1) % 4].clone().setY(y1), d = c1[e].clone().setY(y1);
      gb.quad(a, b, c, d, n);
    }
  }
  return gb;
}

/** Extrude a convex-or-not closed 2D profile [(x, y)] along local Z from z0 to z1, with fan caps (convex only). */
export function extrudeProfile(gb, profile, z0, z1, caps = true) {
  for (let i = 0; i < profile.length; i++) {
    const [x0, y0] = profile[i], [x1, y1] = profile[(i + 1) % profile.length];
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy); if (l < 1e-9) continue;
    const n = new THREE.Vector3(dy / l, -dx / l, 0);
    gb.quad(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z0), new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x0, y0, z1), n);
  }
  if (caps) {
    const cx = profile.reduce((s, p) => s + p[0], 0) / profile.length, cy = profile.reduce((s, p) => s + p[1], 0) / profile.length;
    for (const [z, nz] of [[z0, -1], [z1, 1]]) {
      const n = new THREE.Vector3(0, 0, nz), c = new THREE.Vector3(cx, cy, z);
      for (let i = 0; i < profile.length; i++) {
        const [x0, y0] = profile[i], [x1, y1] = profile[(i + 1) % profile.length];
        gb.tri(c, new THREE.Vector3(x0, y0, z), new THREE.Vector3(x1, y1, z), n);
      }
    }
  }
  return gb;
}

/** plan [x,y,z] → world Vector3 */
export const W = (p) => new THREE.Vector3(p[0], p[2], -p[1]);
/** plan direction → world direction */
export const WD = (d) => new THREE.Vector3(d[0], d[2], -d[1]);

/** Matrix4 placing local (X=u, Y=n, Z=-v) at a roof-plane point */
export function planeMatrix(site, plane, u, v, h, flip = false) {
  const U = WD(plane.u), N = WD(plane.n), V = WD(plane.v);
  const m = new THREE.Matrix4();
  if (!flip) m.makeBasis(U, N, V.clone().negate()); else m.makeBasis(U.clone().negate(), N, V);
  m.setPosition(W(site.planePoint(plane, u, v, h)));
  return m;
}
