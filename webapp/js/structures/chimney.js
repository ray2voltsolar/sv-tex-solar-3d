// ============================================================================
//  STRUCTURES — ~30 m chimney: banded steel stack inside a tapering lattice tower
// ============================================================================
import * as THREE from 'three';
import { V, D, UP, boxAt, boxUV, beam, cylBetween, angleMember, revolve, placeAt, handrail } from './kit.js';

export function buildChimney(ctx, B) {
  const c = ctx.site.FEATURES.chimney;
  const cx = c.x, cy = c.y, H = c.height, R = c.stackDia / 2;
  const low = ctx.quality === 'low';
  const z0 = 0.5;                       // pedestal top
  const zt = H - 1.8;                   // lattice top / platform level
  const b0 = c.lattice.baseWidth / 2, bt = c.lattice.topWidth / 2;
  const nP = Math.max(4, Math.round((zt - z0) / c.lattice.bracingEvery));
  const ph = (zt - z0) / nP;
  const half = (z) => b0 + (bt - b0) * (z - z0) / (zt - z0);
  const lv = (k) => z0 + k * ph;
  const info = { cx, cy, R, z0, zt, half, levels: Array.from({ length: nP + 1 }, (_, k) => lv(k)) };

  // ---- pedestal (concrete) + leg footings
  B.add('concrete', boxUV(boxAt(cx, cy, -0.3, 3.3, 3.3, 0.8), 1 / 3, 1 / 3));
  B.add('concrete', boxUV(boxAt(cx, cy, -0.3, 3.6, 3.6, 0.38), 1 / 3, 1 / 3)); // plinth step
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const px = cx + sx * (b0 - 0.08), py = cy + sy * (b0 - 0.08);
    B.add('steelDark', boxAt(px, py, z0, 0.34, 0.34, 0.025));
    for (const ox of [-0.11, 0.11]) for (const oy of [-0.11, 0.11]) B.add('steelDark', boxAt(px + ox, py + oy, z0 + 0.025, 0.035, 0.035, 0.045));
  }

  // ---- stack (banded; v mapped from height so bands are crisp)
  const vMap = { vFromY: [0.5, 1 / 32], uRep: 1 };
  B.add('stack', placeAt(revolve([[R + 0.001, z0 - 0.05], [R, H], [R - 0.008, H], [R - 0.008, H - 1.5]], 32, vMap), cx, cy));
  // top lip
  B.add('stack', placeAt(revolve([[R, H - 0.14], [R + 0.03, H - 0.14], [R + 0.03, H + 0.012], [R - 0.012, H + 0.012], [R - 0.012, H - 0.1]], 32, vMap), cx, cy));
  // ring stiffeners at band joints
  for (let z = H - c.bands.bandHeight; z > z0 + 0.6; z -= c.bands.bandHeight) {
    B.add('stack', placeAt(revolve([[R, z - 0.035], [R + 0.016, z - 0.03], [R + 0.016, z + 0.03], [R, z + 0.035]], 32, vMap), cx, cy));
  }
  // base flange + gussets
  B.add('steelDark', placeAt(revolve([[R, z0 + 0.03], [R + 0.22, z0 + 0.03], [R + 0.22, z0], [0.0, z0]], 32), cx, cy));
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const p = V(cx + ca * (R + 0.1), cy + sa * (R + 0.1), z0 + 0.16);
    B.add('steelDark', beamFromCenter(p, D(ca, sa), 0.012, 0.2, 0.26));
  }

  // ---- lattice tower: angle legs, horizontals + X bracing every panel
  const legS = 0.075, legT = 0.008;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const a = V(cx + sx * b0, cy + sy * b0, z0 + 0.025), b = V(cx + sx * bt, cy + sy * bt, zt);
    for (const g of angleMember(a, b, D(-sx, 0), D(0, -sy), legS, legT)) B.add('galv', g);
  }
  const faces = [
    { n: [1, 0], t: [0, 1] }, { n: [-1, 0], t: [0, 1] }, { n: [0, 1], t: [1, 0] }, { n: [0, -1], t: [1, 0] },
  ];
  const flueZ = 3.55; // duct entry height (west face)
  for (const f of faces) {
    const inward = D(-f.n[0], -f.n[1]);
    const pt = (z, s, inset = 0) => {
      const h = half(z);
      return V(cx + f.n[0] * (h - inset) + f.t[0] * s * h, cy + f.n[1] * (h - inset) + f.t[1] * s * h, z);
    };
    for (let k = 0; k <= nP; k++) {
      const z = lv(k) + (k === 0 ? 0.06 : 0);
      const size = k === nP ? 0.07 : 0.05;
      const ga = angleMember(pt(z, -0.97, 0.009), pt(z, 0.97, 0.009), UP, inward, size, 0.006);
      for (const g of ga) B.add('galv', g);
    }
    for (let k = 0; k < nP; k++) {
      const zA = lv(k) + 0.06, zB = lv(k + 1) - 0.04;
      const isWest = f.n[0] === -1;
      if (isWest && flueZ > lv(k) && flueZ < lv(k + 1)) {
        // portal around the flue inlet: two short posts instead of X bracing
        for (const s of [-0.55, 0.55]) for (const g of angleMember(pt(zA, s, 0.018), pt(zB, s, 0.018), D(f.t[0], f.t[1]), inward, 0.045, 0.006)) B.add('galv', g);
        continue;
      }
      const d1 = angleMember(pt(zA, -0.93, 0.018), pt(zB, 0.93, 0.018), UP, inward, 0.045, 0.006);
      const d2 = angleMember(pt(zA, 0.93, 0.027), pt(zB, -0.93, 0.027), UP, inward, 0.045, 0.006);
      for (const g of [...d1, ...d2]) B.add('galv', g);
    }
    // stack ties every second level
    for (let k = 2; k < nP; k += 2) {
      const z = lv(k) + 0.03;
      const a = V(cx + f.n[0] * R, cy + f.n[1] * R, z), b = V(cx + f.n[0] * (half(z) - 0.03), cy + f.n[1] * (half(z) - 0.03), z);
      B.add('galv', cylBetween(a, b, 0.03, 6));
    }
  }
  for (let k = 2; k < nP; k += 2) {
    const z = lv(k) + 0.03;
    B.add('galv', placeAt(revolve([[R, z - 0.06], [R + 0.012, z - 0.06], [R + 0.012, z + 0.06], [R, z + 0.06]], 24), cx, cy));
  }

  // ---- cat ladder with safety hoops on the north face
  const ladY = (z) => cy + half(Math.min(z, zt)) + 0.2 + (z > zt ? 0 : 0);
  const lz0 = z0 + 0.05, lz1 = zt + 1.1;
  for (const sx of [-0.21, 0.21]) {
    B.add('galv', beam(V(cx + sx, ladY(lz0), lz0), V(cx + sx, ladY(zt), zt), 0.012, 0.065, D(0, 1)));
    B.add('galv', beam(V(cx + sx, ladY(zt), zt), V(cx + sx, ladY(zt), lz1), 0.012, 0.065, D(0, 1)));
  }
  // grab-rail bends over the top
  for (const sx of [-0.21, 0.21]) B.add('galv', beam(V(cx + sx, ladY(zt), lz1), V(cx + sx, ladY(zt) - 0.3, lz1), 0.012, 0.05, UP));
  const rungStep = 0.3;
  for (let z = lz0 + 0.25; z < zt + 0.05; z += rungStep) B.add('galv', cylBetween(V(cx - 0.21, ladY(z), z), V(cx + 0.21, ladY(z), z), 0.011, 6));
  for (let k = 1; k <= nP; k++) {
    const z = lv(k) - 0.02;
    for (const sx of [-0.21, 0.21]) B.add('galv', beam(V(cx + sx, ladY(z), z), V(cx + sx, cy + half(z) - 0.01, z), 0.04, 0.008, UP));
  }
  if (!low) {
    const hz0 = z0 + 2.4, hz1 = zt - 0.25, hoopR = 0.36, cage = 0.36;
    const torus = new THREE.TorusGeometry(hoopR, 0.009, 4, 14, Math.PI);
    for (let z = hz0; z <= hz1 + 1e-3; z += 0.9) {
      const yl = ladY(z);
      const g = torus.clone(); g.rotateX(-Math.PI / 2); g.translate(cx, z, -(yl + cage));
      B.add('galv', g);
      for (const sx of [-hoopR, hoopR]) B.add('galv', cylBetween(V(cx + sx, yl, z), V(cx + sx, yl + cage, z), 0.009, 4));
      for (const sx of [-1, 1]) B.add('galv', cylBetween(V(cx + sx * 0.21, yl, z), V(cx + sx * hoopR, yl, z), 0.009, 4));
    }
    torus.dispose();
    // vertical straps
    for (const a of [0.15, 0.5, 0.85].map((t) => t * Math.PI)) {
      const sx = Math.cos(a) * hoopR, sy = Math.sin(a) * hoopR + cage;
      B.add('galv', beam(V(cx + sx, ladY(hz0) + sy, hz0), V(cx + sx, ladY(hz1) + sy, hz1), 0.04, 0.006, D(Math.cos(a), Math.sin(a))));
    }
    for (const sx of [-hoopR, hoopR]) B.add('galv', beam(V(cx + sx, ladY(hz0) + 0.18, hz0), V(cx + sx, ladY(hz1) + 0.18, hz1), 0.006, 0.04, D(1, 0)));
  }

  // ---- top platform (grating) with railing
  const P = 1.0, hole = 0.47, dz = zt + 0.07;
  const strip = (x0, x1, y0, y1) => B.add('grating', boxAt(cx + (x0 + x1) / 2, cy + (y0 + y1) / 2, dz - 0.035, x1 - x0, y1 - y0, 0.035));
  strip(-P, -0.3, hole, P); strip(0.3, P, hole, P); strip(-0.3, 0.3, hole, 0.62);
  strip(-P, P, -P, -hole); strip(hole, P, -hole, hole); strip(-P, -hole, -hole, hole);
  // perimeter frame + inner trimmer
  const fr = [[-P, -P], [P, -P], [P, P], [-P, P], [-P, -P]];
  for (let i = 0; i < 4; i++) B.add('steelDark', beam(V(cx + fr[i][0], cy + fr[i][1], dz - 0.06), V(cx + fr[i + 1][0], cy + fr[i + 1][1], dz - 0.06), 0.05, 0.09, UP));
  const hr = [[-hole, -hole], [hole, -hole], [hole, hole], [-hole, hole], [-hole, -hole]];
  for (let i = 0; i < 4; i++) B.add('steelDark', beam(V(cx + hr[i][0], cy + hr[i][1], dz - 0.06), V(cx + hr[i + 1][0], cy + hr[i + 1][1], dz - 0.06), 0.04, 0.08, UP));
  // brackets from lattice legs
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    B.add('steelDark', beam(V(cx + sx * half(zt - 0.9), cy + sy * half(zt - 0.9), zt - 0.9), V(cx + sx * (P - 0.05), cy + sy * (P - 0.05), dz - 0.1), 0.05, 0.05, UP));
  }
  handrail(B, 'galv', [[cx + 0.3, cy + P], [cx + P, cy + P], [cx + P, cy - P], [cx - P, cy - P], [cx - P, cy + P], [cx - 0.3, cy + P]], dz, { height: 1.05, postEvery: 1.0, r: 0.02 });

  // ---- aviation obstruction lamps at the top (blinking, see index.js)
  const lampG = [];
  for (const ang of [0, Math.PI]) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const p0 = V(cx + ca * R, cy + sa * R, H - 0.25), p1 = V(cx + ca * (R + 0.2), cy + sa * (R + 0.2), H - 0.25);
    B.add('steelDark', beam(p0, p1, 0.05, 0.05, UP));
    const bx = cx + ca * (R + 0.2), by = cy + sa * (R + 0.2);
    B.add('machGrey', placeAt(revolve([[0.0, 0], [0.07, 0], [0.07, 0.08], [0.0, 0.08]], 12), bx, by, H - 0.225));
    const dome = new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    placeAt(dome, bx, by, H - 0.145);
    lampG.push(dome);
  }
  for (const g of lampG) B.add('lamp', g);

  return info;
}

/** small radial plate helper (gusset) centred at p, radial direction dir */
function beamFromCenter(p, dir, t, w, h) {
  const a = p.clone().addScaledVector(dir, -w / 2), b = p.clone().addScaledVector(dir, w / 2);
  return beam(a, b, t, h, UP);
}
