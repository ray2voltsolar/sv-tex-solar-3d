// ============================================================================
//  STRUCTURES — Effluent treatment plant: clarifiers, raised platform with
//  flocculator vessels, FRP filters, dosing tanks, RCC room, pipework.
// ============================================================================
import * as THREE from 'three';
import { V, D, UP, boxAt, boxUV, beam, cylBetween, revolve, placeAt, tubePath, handrail } from './kit.js';
import { gearMotorV, pumpSet } from './equipment.js';
import { CLARIFIER_LAYOUT } from './materials.js';

const WATER_COLORS = { 'ETP-1': '#5d6446', 'ETP-2': '#3f3a40', 'ETP-3': '#545a44' };

/** vertical ladder (stringers + rungs) from z0 to z1 at plan (x,y), rungs across 'side' dir */
function ladder(B, key, x, y, side, z0, z1, w = 0.42) {
  const sx = side[0] * w / 2, sy = side[1] * w / 2;
  for (const s of [-1, 1]) B.add(key, beam(V(x + s * sx, y + s * sy, z0), V(x + s * sx, y + s * sy, z1), 0.012, 0.06, D(-side[1], side[0])));
  for (let z = z0 + 0.25; z < z1 - 0.9; z += 0.3) B.add(key, cylBetween(V(x - sx, y - sy, z), V(x + sx, y + sy, z), 0.011, 6));
}

export function buildETP(ctx, B) {
  const E = ctx.site.FEATURES.etp;
  const waterGeoms = [];

  // ------------------------------------------------------------ clarifiers
  const L = CLARIFIER_LAYOUT;
  for (const cl of E.clarifiers) {
    const R = cl.dia / 2, Ht = cl.wallHeight, th = 0.2;
    const zW = Ht - 0.32, zL = zW - 0.17, Rw = R - th - 0.42;
    const prof = [[R, -0.1], [R, Ht - 0.03], [R - 0.03, Ht], [R - th + 0.03, Ht], [R - th, Ht - 0.03], [R - th, Ht - 0.75]];
    const uRep = Math.max(1, Math.round(Math.PI * 2 * R / 6));
    B.add('clarifier', placeAt(revolve(prof, 64, { uRep, vScale: 1 / (L.outer + L.top + L.inner) }), cl.x, cl.y));
    // launder weir wall + V-notch plate
    B.add('concrete', placeAt(revolve([[Rw + 0.05, zL - 0.5], [Rw + 0.05, zW + 0.04], [Rw - 0.05, zW + 0.04], [Rw - 0.05, zL - 0.5]], 64, { uRep: uRep * 2, vScale: 1 / 3 }), cl.x, cl.y));
    B.add('galv', placeAt(revolve([[Rw - 0.055, zW - 0.06], [Rw - 0.055, zW + 0.1], [Rw - 0.062, zW + 0.1], [Rw - 0.062, zW - 0.06]], 64), cl.x, cl.y));
    // launder brackets
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      B.add('concrete', beam(V(cl.x + Math.cos(a) * (Rw + 0.05), cl.y + Math.sin(a) * (Rw + 0.05), zL - 0.2), V(cl.x + Math.cos(a) * (R - th), cl.y + Math.sin(a) * (R - th), zL - 0.2), 0.08, 0.12, UP));
    }
    // water: main (inside weir) + launder channel annulus
    const col = new THREE.Color(WATER_COLORS[cl.id] || '#55583f');
    const main = new THREE.CircleGeometry(Rw - 0.05, 56); main.rotateX(-Math.PI / 2); main.translate(cl.x, zW, -cl.y);
    const ring = new THREE.RingGeometry(Rw + 0.05, R - th, 56, 1); ring.rotateX(-Math.PI / 2); ring.translate(cl.x, zL, -cl.y);
    for (const [g, k] of [[main, 1], [ring, 0.82]]) {
      const p = g.attributes.position; const uv = new Float32Array(p.count * 2); const c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / 6; uv[i * 2 + 1] = -p.getZ(i) / 6; c[i * 3] = col.r * k; c[i * 3 + 1] = col.g * k; c[i * 3 + 2] = col.b * k; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      waterGeoms.push(g);
    }
    // centre pier, feed well, drive platform & blue drive motor
    B.add('concrete', placeAt(revolve([[0.32, zW - 0.6], [0.32, Ht + 0.08], [0, Ht + 0.08]], 20, { vScale: 1 / 3 }), cl.x, cl.y));
    B.add('steelPaint', placeAt(revolve([[0.68, zW - 0.3], [0.68, zW + 0.28], [0.65, zW + 0.28], [0.65, zW - 0.3]], 32), cl.x, cl.y));
    B.add('steelDark', boxAt(cl.x, cl.y, Ht + 0.08, 1.15, 1.15, 0.12));
    B.add('chequer', boxUV(boxAt(cl.x, cl.y, Ht + 0.2, 1.25, 1.25, 0.012), 1 / 0.3));
    gearMotorV(B, cl.x, cl.y, Ht + 0.212, 1.0);
    B.add('machGrey', boxAt(cl.x - 0.42, cl.y + 0.42, Ht + 0.212, 0.26, 0.14, 0.42)); // local push-button box
    // radial bridge
    const ang = cl.id === 'ETP-1' ? Math.PI : cl.id === 'ETP-2' ? Math.PI : 0;
    const ca = Math.cos(ang), sa = Math.sin(ang), pa = -sa, pb = ca; // perpendicular
    const r0 = 0.62, r1 = R + 0.45, deckZ = Ht + 0.212;
    const at = (r, s, z) => V(cl.x + ca * r + pa * s, cl.y + sa * r + pb * s, z);
    for (const s of [-0.42, 0.42]) {
      B.add('steelPaint', beam(at(0.3, s, deckZ - 0.1), at(r1, s, deckZ - 0.1), 0.06, 0.18, UP));
    }
    B.add('grating', beam(at(r0, 0, deckZ - 0.015), at(r1, 0, deckZ - 0.015), 0.86, 0.03, UP));
    for (const s of [-0.43, 0.43]) {
      const a = at(r0 + 0.1, s, 0), b = at(r1, s, 0);
      handrail(B, 'galv', [[a.x, -a.z], [b.x, -b.z]], deckZ, { postEvery: 1.3 });
    }
    // access ladder down the outside at the bridge end
    const lp = at(R + 0.38, 0, 0);
    ladder(B, 'galv', lp.x, -lp.z, [pa, pb], 0, deckZ + 1.0, 0.44);
    // drain valve chamber at the base
    B.add('concrete', boxUV(boxAt(cl.x - ca * (R + 0.45), cl.y - sa * (R + 0.45), -0.05, 0.6, 0.6, 0.25, ang), 1 / 3));
  }

  // ------------------------------------------------------------ raised platform
  // Local override (polish r1): in WA0009/WA0010 the platform handrails, vessel heads and blue
  // gear motors stand clearly above the 4.95 m screen top, so the deck sits on top of the
  // flocculation tank at ~4.4 m (site-data says 3.0; change requested from the orchestrator).
  const P = { ...E.platform, deckZ: Math.max(E.platform.deckZ, 4.4), vessels: E.platform.vessels.map((v) => ({ ...v, h: Math.max(v.h, 2.4) })) };
  const dz = P.deckZ;
  const xs = [P.x0 + 0.1, (P.x0 + P.x1) / 2, P.x1 - 0.1], ys = [P.y0 + 0.1, (P.y0 + P.y1) / 2, P.y1 - 0.1];
  const beamBot = dz - 0.22;
  for (const x of xs) for (const y of ys) {
    B.add('steelPaint', boxAt(x, y, 0.15, 0.15, 0.15, beamBot - 0.15));
    B.add('steelDark', boxAt(x, y, 0.15, 0.3, 0.3, 0.02));
    B.add('concrete', boxUV(boxAt(x, y, -0.1, 0.42, 0.42, 0.25), 1 / 3));
  }
  const ibeam = (a, b) => { // I-section 200 deep: web + flanges (a, b at top of steel)
    B.add('steelPaint', beam(a.clone().setY(dz - 0.11), b.clone().setY(dz - 0.11), 0.008, 0.18, UP));
    B.add('steelPaint', beam(a.clone().setY(dz - 0.0105), b.clone().setY(dz - 0.0105), 0.1, 0.009, UP));
    B.add('steelPaint', beam(a.clone().setY(dz - 0.2095), b.clone().setY(dz - 0.2095), 0.1, 0.009, UP));
  };
  for (const y of ys) ibeam(V(P.x0 + 0.02, y, 0), V(P.x1 - 0.02, y, 0));
  for (const x of xs) ibeam(V(x, P.y0 + 0.02, 0), V(x, P.y1 - 0.02, 0));
  // X bracing on the south and west faces (first bay)
  for (const [a, b] of [[[xs[0], ys[0]], [xs[1], ys[0]]], [[xs[1], ys[0]], [xs[2], ys[0]]], [[xs[0], ys[0]], [xs[0], ys[1]]], [[xs[0], ys[1]], [xs[0], ys[2]]], [[xs[2], ys[1]], [xs[2], ys[2]]]]) {
    B.add('steelPaint', beam(V(a[0], a[1], 0.4), V(b[0], b[1], beamBot - 0.15), 0.06, 0.06, UP));
    B.add('steelPaint', beam(V(b[0], b[1], 0.4), V(a[0], a[1], beamBot - 0.15), 0.06, 0.06, UP));
  }
  // chequer-plate deck
  B.add('chequer', boxUV(boxAt((P.x0 + P.x1) / 2, (P.y0 + P.y1) / 2, dz, P.x1 - P.x0, P.y1 - P.y0, 0.02), 1 / 0.3, 1 / 0.3, { topScale: 1 / 0.3 }));
  const deck = dz + 0.02;
  // stairs on the north side ascending eastward + landing
  const sy0 = P.y1, sy1 = P.y1 + 0.75, sxTop = P.x1 - 0.8, run = deck / Math.tan(40 * Math.PI / 180), sxBot = sxTop - run;
  B.add('chequer', boxUV(boxAt(sxTop + 0.4, (sy0 + sy1) / 2, deck - 0.02, 0.8, 0.75, 0.02), 1 / 0.3));
  B.add('steelPaint', boxAt(P.x1 - 0.05, sy1 - 0.05, 0, 0.1, 0.1, deck - 0.02));
  B.add('steelPaint', boxAt(sxTop + 0.4, sy1 - 0.04, deck - 0.17, 0.8, 0.08, 0.15));
  for (const y of [sy0 + 0.05, sy1 - 0.05]) B.add('steelPaint', beam(V(sxBot, y, 0.05), V(sxTop, y, deck - 0.05), 0.05, 0.16, UP));
  const nSteps = Math.round(deck / 0.2);
  for (let k = 1; k < nSteps; k++) {
    const t = k / nSteps;
    B.add('grating', boxAt(sxBot + run * t, (sy0 + sy1) / 2, deck * t - 0.03, 0.24, 0.62, 0.03));
  }
  for (const y of [sy0 + 0.04, sy1 - 0.04]) {
    const pz = (x) => (x - sxBot) / run * deck;
    for (const x of [sxBot + 0.15, sxBot + run * 0.5, sxTop - 0.05]) B.add('galv', cylBetween(V(x, y, pz(x)), V(x, y, pz(x) + 0.95), 0.021, 6));
    B.add('galv', cylBetween(V(sxBot + 0.15, y, pz(sxBot + 0.15) + 0.95), V(sxTop - 0.05, y, pz(sxTop - 0.05) + 0.95), 0.022, 6));
    B.add('galv', cylBetween(V(sxBot + 0.15, y, pz(sxBot + 0.15) + 0.5), V(sxTop - 0.05, y, pz(sxTop - 0.05) + 0.5), 0.018, 6));
  }
  handrail(B, 'galv', [[sxTop, P.y1], [P.x0, P.y1], [P.x0, P.y0], [P.x1, P.y0], [P.x1, P.y1]], deck, { postEvery: 1.6 });
  handrail(B, 'galv', [[P.x1, P.y1], [P.x1, sy1], [sxTop, sy1]], deck, { postEvery: 1.0 });

  // flocculator / flash-mixer vessels with blue gear motors (WA0009)
  for (const v of P.vessels) {
    const r = v.dia / 2, zb = deck + 0.08, zc = zb + 0.42, zt = zb + v.h;
    B.add('stainless', placeAt(revolve([[0.06, zb], [r, zc], [r, zt - 0.06], [r + 0.03, zt - 0.06], [r + 0.03, zt], [0, zt]], 40, { vScale: 1 }), v.x, v.y));
    B.add('stainless', placeAt(revolve([[r + 0.004, zc + 0.6], [r + 0.012, zc + 0.6], [r + 0.012, zc + 0.66], [r + 0.004, zc + 0.66]], 40), v.x, v.y));
    for (const [ox, oy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const lx = v.x + ox * r * 0.72, ly = v.y + oy * r * 0.72;
      B.add('steelPaint', boxAt(lx, ly, deck, 0.08, 0.08, zc + 0.08 - deck));
      B.add('steelDark', boxAt(lx, ly, deck, 0.18, 0.18, 0.012));
    }
    // agitator bridge + drive
    B.add('steelPaint', boxAt(v.x, v.y, zt, 0.14, v.dia + 0.2, 0.14));
    for (const s of [-1, 1]) B.add('steelPaint', boxAt(v.x, v.y + s * (r + 0.02), zt - 0.12, 0.14, 0.06, 0.14));
    gearMotorV(B, v.x, v.y, zt + 0.14, 1.15);
    // inspection hatch
    B.add('stainless', boxAt(v.x + r * 0.45, v.y - r * 0.3, zt, 0.32, 0.32, 0.04));
  }
  // upper service walkway + top frame around vessel heads
  const vz = P.vessels[0];
  const topZ = deck + 0.08 + vz.h;
  const fx0 = Math.min(...P.vessels.map((v) => v.x)) - vz.dia / 2 - 0.4, fx1 = Math.max(...P.vessels.map((v) => v.x)) + vz.dia / 2 + 0.4;
  const fy0 = vz.y - vz.dia / 2 - 0.15, fy1 = vz.y + vz.dia / 2 + 0.5, wy0 = fy0 - 0.7;
  for (const [x, y] of [[fx0, fy0], [fx1, fy0], [fx0, fy1], [fx1, fy1]]) B.add('galv', boxAt(x, y, deck, 0.06, 0.06, topZ + 1.05 - deck));
  for (const [x, y] of [[fx0, wy0], [fx1, wy0]]) B.add('steelPaint', boxAt(x, y, deck, 0.08, 0.08, topZ - 0.12 - deck));
  B.add('steelPaint', beam(V(fx0, wy0 + 0.04, topZ - 0.07), V(fx1, wy0 + 0.04, topZ - 0.07), 0.06, 0.12, UP));
  B.add('steelPaint', beam(V(fx0, fy0 - 0.04, topZ - 0.07), V(fx1, fy0 - 0.04, topZ - 0.07), 0.06, 0.12, UP));
  B.add('grating', boxAt((fx0 + fx1) / 2, (wy0 + fy0) / 2, topZ - 0.01, fx1 - fx0, fy0 - wy0, 0.03));
  handrail(B, 'galv', [[fx1, wy0], [fx0, wy0], [fx0, fy0]], topZ + 0.02, { postEvery: 1.3 });
  // frame top rails (WA0009: square-tube frame with knee braces)
  const tr = topZ + 1.05;
  const ring = [[fx0, fy0], [fx1, fy0], [fx1, fy1], [fx0, fy1], [fx0, fy0]];
  for (let i = 0; i < 4; i++) {
    B.add('galv', beam(V(ring[i][0], ring[i][1], tr), V(ring[i + 1][0], ring[i + 1][1], tr), 0.05, 0.05, UP));
    if (i !== 0) B.add('galv', beam(V(ring[i][0], ring[i][1], topZ + 0.4), V(ring[i + 1][0], ring[i + 1][1], topZ + 0.4), 0.04, 0.04, UP));
  }
  for (const [x, y, dx, dy] of [[fx0, fy0, 1, 0], [fx1, fy0, -1, 0], [fx0, fy1, 1, 0], [fx1, fy1, -1, 0], [fx0, fy0, 0, 1], [fx0, fy1, 0, -1], [fx1, fy0, 0, 1], [fx1, fy1, 0, -1]]) {
    B.add('galv', beam(V(x, y, tr - 0.55), V(x + dx * 0.55, y + dy * 0.55, tr - 0.02), 0.04, 0.04, UP));
  }
  ladder(B, 'galv', fx1 + 0.1, (wy0 + fy0) / 2, [0, 1], deck, topZ + 1.0, 0.44);

  // ------------------------------------------------------------ FRP pressure filters
  const filters = E.filters.map((f) => ({ ...f, ...clearOf(f, E.clarifiers, 0.25) }));
  for (const f of filters) {
    const r = f.dia / 2, zb = 0.45, zt = zb + f.h;
    B.add('frpBlue', placeAt(revolve([[0.0, zb - 0.05], [r * 0.6, zb], [r * 0.92, zb + 0.12], [r, zb + 0.28], [r, zt - 0.28], [r * 0.92, zt - 0.12], [r * 0.6, zt - 0.02], [0.12, zt], [0, zt]], 32, { vScale: 1 }), f.x, f.y));
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.3;
      B.add('steelDark', beam(V(f.x + Math.cos(a) * r * 0.55, f.y + Math.sin(a) * r * 0.55, zb + 0.08), V(f.x + Math.cos(a) * r * 0.85, f.y + Math.sin(a) * r * 0.85, 0.0), 0.06, 0.06, UP));
    }
    B.add('concrete', boxUV(boxAt(f.x, f.y, -0.05, f.dia + 0.3, f.dia + 0.3, 0.1), 1 / 3));
    // multiport valve head + face piping toward the yard (west)
    B.add('machGrey', cylBetween(V(f.x, f.y, zt - 0.02), V(f.x, f.y, zt + 0.2), 0.12, 14));
    B.add('machGrey', cylBetween(V(f.x, f.y, zt + 0.2), V(f.x, f.y, zt + 0.28), 0.07, 10));
    B.add('pvc', tubePath([V(f.x, f.y, zt + 0.1), V(f.x - r - 0.15, f.y, zt + 0.1), V(f.x - r - 0.15, f.y, 0.6), V(f.x - r - 0.15, f.y, 0.25)], 0.045, 8, 0.12));
    B.add('pvc', tubePath([V(f.x, f.y, zb - 0.02), V(f.x, f.y, 0.25), V(f.x - r - 0.15, f.y + 0.15, 0.25)], 0.04, 8, 0.1));
    B.add('porcelain', cylBetween(V(f.x - 0.12, f.y - 0.06, zt + 0.12), V(f.x - 0.12, f.y - 0.12, zt + 0.12), 0.04, 10));
  }

  // ------------------------------------------------------------ dosing tanks (HDPE) on a plinth
  const dt = E.dosingTanks;
  const dx0 = Math.min(...dt.map((t) => t.x)) - 0.55, dx1 = Math.max(...dt.map((t) => t.x)) + 0.55;
  B.add('concrete', boxUV(boxAt((dx0 + dx1) / 2, dt[0].y, -0.05, dx1 - dx0, 1.1, 0.3), 1 / 3));
  for (const t of dt) {
    const r = 0.44, zb = 0.25;
    const prof = [[0, zb], [r - 0.03, zb], [r, zb + 0.04]];
    for (let z = zb + 0.2; z < zb + 0.95; z += 0.25) prof.push([r, z - 0.03], [r - 0.012, z], [r, z + 0.03]);
    prof.push([r, zb + 0.97], [r - 0.06, zb + 1.03], [0.16, zb + 1.06], [0.16, zb + 1.1], [0, zb + 1.1]);
    B.add('hdpe', placeAt(revolve(prof, 28, { vScale: 1 }), t.x, t.y));
    B.add('steelPaint', boxAt(t.x, t.y, zb + 1.06, 0.9, 0.06, 0.05));
    B.add('motorBlue', cylBetween(V(t.x, t.y, zb + 1.11), V(t.x, t.y, zb + 1.36), 0.07, 12));
    B.add('motorBlue', cylBetween(V(t.x, t.y, zb + 1.36), V(t.x, t.y, zb + 1.42), 0.075, 12, 0.06));
    B.add('pvc', tubePath([V(t.x + 0.25, t.y + 0.32, zb + 1.0), V(t.x + 0.25, t.y + 0.55, zb + 1.0), V(t.x + 0.25, t.y + 0.55, 0.3)], 0.018, 6, 0.08));
  }
  // dosing header to ETP-2 rim
  const c2 = E.clarifiers.find((c) => c.id === 'ETP-2') || E.clarifiers[0];
  B.add('pvc', tubePath([V(dt[0].x + 0.25, dt[0].y + 0.55, 0.35), V(c2.x - 1.2, dt[0].y + 0.55, 0.35), V(c2.x - 1.2, c2.y - c2.dia / 2 - 0.25, 0.35), V(c2.x - 1.2, c2.y - c2.dia / 2 - 0.25, c2.wallHeight + 0.15), V(c2.x - 1.2, c2.y - c2.dia / 2 + 0.6, c2.wallHeight + 0.15), V(c2.x - 1.2, c2.y - c2.dia / 2 + 0.6, c2.wallHeight - 0.2)], 0.025, 6, 0.12));

  // ------------------------------------------------------------ small RCC room
  const rm = E.room;
  const rw = rm.x1 - rm.x0, rd = rm.y1 - rm.y0, rcx = (rm.x0 + rm.x1) / 2, rcy = (rm.y0 + rm.y1) / 2;
  B.add('plaster', boxUV(boxAt(rcx, rcy, -0.05, rw, rd, rm.h + 0.05), 1 / 8, 1 / rm.h));
  B.add('concrete', boxUV(boxAt(rcx, rcy, rm.h, rw + 0.2, rd + 0.2, 0.12), 1 / 3));
  B.add('concrete', boxUV(boxAt(rcx, rcy, -0.05, rw + 0.3, rd + 0.3, 0.2), 1 / 3)); // plinth
  // door (west face) with frame and chajja
  B.add('steelPaint', boxAt(rm.x0 - 0.02, rcy, 0.15, 0.05, 0.95, 2.1));
  B.add('steelDark', boxAt(rm.x0 - 0.035, rcy, 0.15, 0.03, 1.05, 2.18));
  B.add('steelDark', boxAt(rm.x0 - 0.055, rcy + 0.35, 1.05, 0.03, 0.04, 0.14));
  B.add('concrete', boxUV(boxAt(rm.x0 - 0.25, rcy, 2.4, 0.5, 1.3, 0.07), 1 / 3));
  // window (north face, toward the lane) with grill and chajja
  B.add('glassDark', boxAt(rcx, rm.y1 + 0.005, 1.1, 0.9, 0.02, 0.9));
  B.add('steelDark', boxAt(rcx, rm.y1 + 0.03, 1.05, 1.0, 0.03, 0.05));
  B.add('steelDark', boxAt(rcx, rm.y1 + 0.03, 1.95, 1.0, 0.03, 0.05));
  for (let i = 0; i < 6; i++) B.add('steelDark', boxAt(rcx - 0.42 + i * 0.168, rm.y1 + 0.035, 1.1, 0.016, 0.016, 0.85));
  B.add('concrete', boxUV(boxAt(rcx, rm.y1 + 0.22, 2.15, 1.3, 0.45, 0.07), 1 / 3));

  // ------------------------------------------------------------ pipework
  const sleeper = (x, y) => B.add('concrete', boxUV(boxAt(x, y, -0.05, 0.3, 0.3, 0.3), 1 / 3));
  const pipe = (key, pts, r, bend = 0.25) => B.add(key, tubePath(pts.map(([x, y, z]) => V(x, y, z)), r, 10, bend));
  const c1 = E.clarifiers.find((c) => c.id === 'ETP-1') || E.clarifiers[0];
  const c3 = E.clarifiers.find((c) => c.id === 'ETP-3') || E.clarifiers[0];
  const shed = ctx.site.BUILDINGS.DYEING_SHED.footprint;
  // raw effluent from the dyeing shed into ETP-2
  const rimZ = c2.wallHeight + 0.25;
  pipe('pvc', [[30.5, shed.y1 + 0.05, 0.4], [30.5, 27.5, 0.4], [30.5, 27.5, rimZ], [29.8, 29.2, rimZ], [29.8, 29.2, 1.4]], 0.1, 0.3);
  sleeper(30.5, 26.4);
  // ETP-2 → ETP-3 transfer, ETP-3 → ETP-1 overflow
  pipe('pvc', [[c2.x + 2.3, c2.y - 0.05, 1.4], [c2.x + 2.3, c2.y - 0.05, rimZ], [c3.x - 2.3, c3.y + 0.05, rimZ], [c3.x - 2.3, c3.y + 0.05, 1.4]], 0.09, 0.3);
  pipe('pvc', [[c3.x - 0.05, c3.y + 1.8, 1.4], [c3.x - 0.05, c3.y + 1.8, rimZ], [c1.x + 0.05, c1.y - 1.9, rimZ], [c1.x + 0.05, c1.y - 1.9, 1.4]], 0.09, 0.3);
  // ETP-1 → platform vessel (pumped, rises up a column)
  const v2 = P.vessels[P.vessels.length - 1], v1 = P.vessels[0];
  pipe('machGrey', [[c1.x - 2.5, v2.y + 0.6, 1.4], [c1.x - 2.5, v2.y + 0.6, 2.4], [P.x1 - 0.18, v2.y + 0.6, 2.4], [P.x1 - 0.18, v2.y + 0.6, topZ + 0.3], [v2.x + 0.3, v2.y + 0.6, topZ + 0.3], [v2.x + 0.3, v2.y + 0.5, topZ - 0.05]], 0.06, 0.25);
  // vessel interconnect + bottom outlets down to ETP-2
  pipe('stainless', [[v1.x + v1.dia / 2 - 0.05, v1.y, deck + 1.2], [v2.x - v2.dia / 2 + 0.05, v2.y, deck + 1.2]], 0.07, 0.2);
  pipe('machGrey', [[v2.x, v2.y, deck + 0.1], [v2.x, v2.y, dz - 0.5], [v2.x, c2.y + 2.5, dz - 0.5], [v2.x, c2.y + 2.5, 1.4]], 0.07, 0.3);
  pipe('machGrey', [[v1.x, v1.y, deck + 0.1], [v1.x, v1.y, dz - 0.5], [v1.x, P.y0 + 0.2, dz - 0.5], [c2.x - 1.6, P.y0 + 0.2, dz - 0.5], [c2.x - 1.6, c2.y + 1.9, dz - 0.5], [c2.x - 1.6, c2.y + 1.9, 1.4]], 0.07, 0.3);
  // ETP-1 → pump → filters → treated water to the room
  const wallX = ctx.site.FEATURES.compoundWalls.runs.find((r) => r.id === 'E').from[0] - 0.115;
  const pumpY = (c1.y + c3.y) / 2 + 0.2, pumpX = wallX - 1.0;
  B.add('concrete', boxUV(boxAt(pumpX, pumpY, -0.05, 0.55, 1.0, 0.25), 1 / 3));
  pumpSet(B, pumpX, pumpY, 0.2, D(0, 1), 1.0);
  pipe('pvc', [[c1.x + 2.6, c1.y - 0.6, 1.4], [c1.x + 2.6, c1.y - 0.6, rimZ], [pumpX, c1.y - 0.6, rimZ], [pumpX, c1.y - 0.6, 0.36], [pumpX, pumpY + 0.46, 0.36]], 0.06, 0.25);
  const fN = filters.reduce((a, f) => (f.y > a.y ? f : a), filters[0]);
  pipe('pvc', [[pumpX, pumpY + 0.26, 0.6], [pumpX, pumpY + 0.26, 0.9], [wallX - 0.3, pumpY + 0.26, 0.9], [wallX - 0.3, fN.y, 0.9], [wallX - 0.3, fN.y, 0.45], [fN.x + fN.dia / 2 - 0.05, fN.y, 0.45]], 0.055, 0.2);
  pipe('pvc', [[filters[0].x + 0.2, filters[0].y, 2.8], [wallX - 0.18, filters[0].y, 2.8], [wallX - 0.18, rm.y0 + 0.4, 2.8], [rm.x1 - 0.3, rm.y0 + 0.4, 2.8], [rm.x1 - 0.3, rm.y0 - 0.02, 2.8]], 0.045, 0.2);
  for (let y = pumpY - 0.8; y > fN.y; y -= 2) { B.add('steelPaint', boxAt(wallX - 0.3, y, 0, 0.05, 0.05, 0.85)); B.add('steelPaint', boxAt(wallX - 0.3, y, 0.8, 0.15, 0.05, 0.04)); }
  for (const y of [filters[0].y, (filters[0].y + rm.y0) / 2, rm.y0 - 0.4]) {
    B.add('steelPaint', boxAt(wallX - 0.18, y, 0, 0.06, 0.06, 2.75));
    B.add('steelPaint', boxAt(wallX - 0.18, y, 2.72, 0.06, 0.2, 0.03));
  }

  // ------------------------------------------------------------ tall reactor column by the east wall (WA0009)
  reactorColumn(B, wallX - 1.05, 33.15);

  // merged water mesh
  return { waterGeoms };
}

/** Tall vertical flash-mixer / reactor column right behind the east screen: white vessel whose
 *  head, agitator lantern and blue gear motor rise above the screen, inside a square-tube frame
 *  with knee-braced top rails (WA0009). */
function reactorColumn(B, x, y) {
  const r = 0.46, zb = 0.55, zt = 5.35;
  B.add('concrete', boxUV(boxAt(x, y, -0.05, 1.4, 1.4, 0.2), 1 / 3));
  // vessel on a skirt with a coned bottom
  B.add('stainless', placeAt(revolve([[r * 0.92, 0.15], [r * 0.92, zb], [0.1, zb - 0.05]], 32), x, y));
  B.add('stainless', placeAt(revolve([[0.1, zb - 0.02], [r, zb + 0.35], [r, zt - 0.05], [r + 0.035, zt - 0.05], [r + 0.035, zt], [0, zt]], 40, { vScale: 1 }), x, y));
  for (const z of [1.6, 2.9, 4.2]) B.add('stainless', placeAt(revolve([[r + 0.003, z], [r + 0.014, z], [r + 0.014, z + 0.05], [r + 0.003, z + 0.05]], 40), x, y));
  // nozzles, side outlet, level gauge
  B.add('stainless', cylBetween(V(x - r + 0.05, y, 4.6), V(x - r - 0.25, y, 4.6), 0.07, 12));
  B.add('steelDark', cylBetween(V(x - r - 0.25, y, 4.6), V(x - r - 0.29, y, 4.6), 0.12, 14));
  B.add('pvc', tubePath([V(x - r - 0.29, y, 4.6), V(x - r - 0.6, y, 4.6), V(x - r - 0.6, y, 0.35)], 0.06, 8, 0.2));
  B.add('galv', cylBetween(V(x + 0.3, y - r - 0.04, 1.0), V(x + 0.3, y - r - 0.04, 4.8), 0.015, 6));
  // agitator lantern + bridge + gear motor
  B.add('steelPaint', boxAt(x, y, zt, 0.14, 2 * r + 0.25, 0.14));
  for (const [ox, oy] of [[0.12, 0.12], [0.12, -0.12], [-0.12, 0.12], [-0.12, -0.12]]) B.add('steelPaint', boxAt(x + ox, y + oy, zt + 0.14, 0.04, 0.04, 0.5));
  B.add('steelPaint', boxAt(x, y, zt + 0.64, 0.34, 0.34, 0.03));
  B.add('galv', cylBetween(V(x, y, zt + 0.1), V(x, y, zt + 0.66), 0.035, 8));
  gearMotorV(B, x, y, zt + 0.67, 1.25);
  // square-tube frame around the head (legs from the ground) with top & mid rails + knee braces
  // (kept clear of the ETP-3 rim to the south-west and the pump-line rack on the wall side)
  const fx0 = x - 0.7, fx1 = x + 0.6, fy0 = y - 0.55, fy1 = y + 1.3, tr = 6.25, mr = 5.6;
  for (const [px, py] of [[fx0, fy0], [fx1, fy0], [fx0, fy1], [fx1, fy1]]) {
    B.add('galv', boxAt(px, py, 0, 0.07, 0.07, tr + 0.03));
    B.add('concrete', boxUV(boxAt(px, py, -0.05, 0.3, 0.3, 0.15), 1 / 3));
  }
  const ring = [[fx0, fy0], [fx1, fy0], [fx1, fy1], [fx0, fy1], [fx0, fy0]];
  for (let i = 0; i < 4; i++) {
    const a = ring[i], b = ring[i + 1];
    for (const z of [tr, mr, 3.0]) B.add('galv', beam(V(a[0], a[1], z), V(b[0], b[1], z), 0.05, 0.05, UP));
    const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
    B.add('galv', beam(V(a[0], a[1], tr - 0.6), V(a[0] + dx * 0.6, a[1] + dy * 0.6, tr - 0.02), 0.04, 0.04, UP));
    B.add('galv', beam(V(b[0], b[1], tr - 0.6), V(b[0] - dx * 0.6, b[1] - dy * 0.6, tr - 0.02), 0.04, 0.04, UP));
  }
  // service grating north of the vessel head on two cross-beams, cat ladder up from the ground
  const gy0 = y + r + 0.06;
  for (const yy of [gy0, fy1 - 0.03]) B.add('steelPaint', beam(V(fx0, yy, zt - 0.2), V(fx1, yy, zt - 0.2), 0.06, 0.12, UP));
  B.add('grating', boxAt((fx0 + fx1) / 2, (gy0 + fy1) / 2, zt - 0.14, fx1 - fx0 - 0.08, fy1 - gy0, 0.03));
  ladder(B, 'galv', fx0 + 0.25, fy1 + 0.06, [1, 0], 0, zt + 0.6, 0.44);
}

/** Push a round item (x,y,dia) away from clarifier circles so they don't overlap. */
function clearOf(f, clarifiers, gap) {
  let x = f.x, y = f.y;
  for (let it = 0; it < 4; it++) {
    for (const c of clarifiers) {
      const dx = x - c.x, dy = y - c.y, d = Math.hypot(dx, dy), need = c.dia / 2 + f.dia / 2 + gap;
      if (d < need) { x = c.x + dx / d * need; y = c.y + dy / d * need; }
    }
  }
  // keep inside the east compound wall
  x = Math.min(x, 40 - 0.115 - f.dia / 2 - 0.15);
  return { x, y };
}
