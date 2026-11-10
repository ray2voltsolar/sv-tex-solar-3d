// ============================================================================
//  STRUCTURES — small reusable equipment (motors, gear drives, pumps)
// ============================================================================
import * as THREE from 'three';
import { V, D, UP, cylBetween, orientedBox, revolve } from './kit.js';

const finCache = new Map();
function finnedBody(r, len, nFins = 18) {
  const key = `${r.toFixed(3)}_${len.toFixed(3)}_${nFins}`;
  if (finCache.has(key)) return finCache.get(key).clone();
  const s = new THREE.Shape();
  const step = Math.PI * 2 / nFins, hw = step * 0.16;
  let first = true;
  for (let i = 0; i < nFins; i++) {
    const a = i * step;
    const pts = [[a - hw * 1.8, r], [a - hw, r * 1.13], [a + hw, r * 1.13], [a + hw * 1.8, r], [a + step / 2, r]];
    for (const [ang, rr] of pts) {
      const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
      if (first) { s.moveTo(x, y); first = false; } else s.lineTo(x, y);
    }
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 1, steps: 1 });
  g.translate(0, 0, -len / 2);
  finCache.set(key, g);
  return g.clone();
}

function basisFor(dir) {
  const ez = dir.clone().normalize();
  const ref = Math.abs(ez.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const ex = new THREE.Vector3().crossVectors(ref, ez).normalize();
  const ey = new THREE.Vector3().crossVectors(ez, ex).normalize();
  return { ex, ey, ez };
}

/** Blue TEFC induction motor: body centred at p (world), shaft toward +dir. */
export function motor(B, p, dir, r = 0.14, len = 0.42, opts = {}) {
  const { ex, ey, ez } = basisFor(dir);
  const m = new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(p);
  const body = finnedBody(r, len); body.applyMatrix4(m); B.add(opts.mat || 'motorBlue', body);
  const back = p.clone().addScaledVector(ez, -len / 2), front = p.clone().addScaledVector(ez, len / 2);
  // fan cowl + grille
  B.add(opts.mat || 'motorBlue', cylBetween(back, back.clone().addScaledVector(ez, -r * 0.9), r * 1.1, 16, r * 1.02));
  B.add('rubber', cylBetween(back.clone().addScaledVector(ez, -r * 0.9), back.clone().addScaledVector(ez, -r * 0.93), r * 0.95, 16));
  // drive-end shield + shaft
  B.add(opts.mat || 'motorBlue', cylBetween(front, front.clone().addScaledVector(ez, r * 0.25), r * 1.02, 16, r * 0.8));
  B.add('galv', cylBetween(front, front.clone().addScaledVector(ez, r * 0.6), r * 0.16, 8));
  // terminal box on top (ey ~ up)
  const up = Math.abs(ez.y) > 0.9 ? ex : ey;
  const side = new THREE.Vector3().crossVectors(ez, up).normalize();
  B.add(opts.mat || 'motorBlue', orientedBox(p.clone().addScaledVector(up, r * 1.12), side, up, ez, r * 0.9, r * 0.45, r * 1.1));
  // feet
  if (opts.feet !== false && Math.abs(ez.y) < 0.5) {
    for (const s of [-1, 1]) B.add(opts.mat || 'motorBlue', orientedBox(p.clone().addScaledVector(up, -r * 0.95).addScaledVector(side, s * r * 0.6), side, up, ez, r * 0.35, r * 0.25, len * 0.7));
  }
}

/** Vertical geared drive: grey gearbox at (x,y,z) with blue motor standing on it. Returns top z. */
export function gearMotorV(B, x, y, z, s = 1) {
  const gr = 0.17 * s, gh = 0.3 * s;
  B.add('machGrey', cylBetween(V(x, y, z), V(x, y, z + 0.04 * s), gr * 1.35, 16));
  B.add('machGrey', revolveAt([[gr, 0], [gr, gh * 0.7], [gr * 0.75, gh], [0, gh]], x, y, z + 0.04 * s, 16));
  B.add('machGrey', orientedBox(V(x + gr * 0.9, y, z + 0.04 * s + gh * 0.4), D(1, 0), UP, D(0, 1), gr * 0.5, gh * 0.6, gr * 0.9));
  const mz = z + 0.04 * s + gh;
  B.add('motorBlue', cylBetween(V(x, y, mz), V(x, y, mz + 0.04 * s), 0.165 * s, 16));
  motor(B, V(x, y, mz + 0.04 * s + 0.22 * s), UP.clone().negate(), 0.15 * s, 0.44 * s, { feet: false });
  return mz + 0.04 * s + 0.44 * s + 0.15 * s;
}

function revolveAt(profile, x, y, z, seg) {
  const g = revolve(profile, seg); g.translate(x, z, -y); return g;
}

/** Monoblock pump set on a skid: motor along dir, volute at the front. */
export function pumpSet(B, x, y, z, dir, s = 1) {
  const d = dir.clone().normalize();
  const p = V(x, y, z + 0.16 * s);
  B.add('steelDark', orientedBox(V(x, y, z + 0.02 * s), new THREE.Vector3().crossVectors(UP, d).normalize(), UP, d, 0.32 * s, 0.04 * s, 0.75 * s));
  motor(B, p.clone().addScaledVector(d, -0.1 * s), d, 0.12 * s, 0.36 * s);
  const vc = p.clone().addScaledVector(d, 0.2 * s);
  B.add('machGrey', cylBetween(vc, vc.clone().addScaledVector(d, 0.12 * s), 0.15 * s, 16));
  B.add('machGrey', cylBetween(vc.clone().addScaledVector(d, 0.12 * s), vc.clone().addScaledVector(d, 0.28 * s), 0.06 * s, 10));
  B.add('machGrey', cylBetween(vc.clone().addScaledVector(d, 0.06 * s), vc.clone().addScaledVector(d, 0.06 * s).add(new THREE.Vector3(0, 0.25 * s, 0)), 0.05 * s, 10));
}
