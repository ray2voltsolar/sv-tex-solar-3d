// ============================================================================
//  STRUCTURES — compound walls, green PPGI screen, blue gate & fence
// ============================================================================
import * as THREE from 'three';
import { V, D, UP, boxAt, boxUV, beam, cylBetween, sweep, trapProfile, orientedBox } from './kit.js';

export function buildWalls(ctx, B) {
  const F = ctx.site.FEATURES, CW = F.compoundWalls;
  const H = CW.height, T = CW.thickness;
  const gate = F.gate;
  const gateKeys = new Set([key(gate.from), key(gate.to)]);
  const done = new Set();

  // ---- wall runs
  for (const run of CW.runs) {
    const [x0, y0] = run.from, [x1, y1] = run.to;
    const L = Math.hypot(x1 - x0, y1 - y0), rot = Math.atan2(y1 - y0, x1 - x0);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // one plaster panel per pillar bay, each sampling a different stretch of the weathering
    // texture (tile 8 m in u) so neighbouring bays don't repeat; seams hide inside the pillars
    const nb = Math.max(1, Math.round(L / CW.pillarEvery));
    for (let i = 0; i < nb; i++) {
      const t0 = i / nb, t1 = (i + 1) / nb, tm = (t0 + t1) / 2;
      const bx = x0 + (x1 - x0) * tm, by = y0 + (y1 - y0) * tm;
      const ou = ((Math.sin((bx * 12.9898 + by * 78.233) * 0.37) * 43758.5453) % 1 + 1) % 1;
      B.add('plaster', boxUV(boxAt(bx, by, -0.1, L / nb + (i === 0 || i === nb - 1 ? 0.0 : 0.02), T, H + 0.1, rot), 1 / 8, 1 / H, { ou }));
    }
    B.add('concrete', boxUV(boxAt(cx, cy, H, L + 0.02, T + 0.06, 0.055, rot), 1 / 3));
    B.add('concrete', boxUV(boxAt(cx, cy, -0.06, L + 0.1, T + 0.14, 0.14, rot), 1 / 3));
    const n = Math.max(1, Math.round(L / CW.pillarEvery));
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t, k = key([px, py]);
      if (done.has(k) || gateKeys.has(k)) continue;
      done.add(k);
      B.add('plaster', boxUV(boxAt(px, py, -0.1, 0.35, 0.35, H + 0.25, rot), 1 / 8, 1 / H));
      B.add('concrete', boxUV(boxAt(px, py, H + 0.15, 0.43, 0.43, 0.07, rot), 1 / 3));
      B.add('concrete', boxUV(boxAt(px, py, -0.06, 0.45, 0.45, 0.16, rot), 1 / 3));
    }
  }

  // ---- gate pillars + two-leaf blue PPGI sheet gate (leaves standing open, swung inward)
  const gx = gate.from[0];
  for (const p of [gate.from, gate.to]) {
    B.add('plaster', boxUV(boxAt(p[0], p[1], -0.1, 0.46, 0.46, gate.height + 0.35), 1 / 8, 1 / H));
    B.add('concrete', boxUV(boxAt(p[0], p[1], gate.height + 0.25, 0.56, 0.56, 0.08), 1 / 3));
    B.add('concrete', boxUV(boxAt(p[0], p[1], gate.height + 0.33, 0.3, 0.3, 0.12), 1 / 3));
  }
  const yA = Math.min(gate.from[1], gate.to[1]) + 0.25, yB = Math.max(gate.from[1], gate.to[1]) - 0.25;
  const leafW = (yB - yA) / 2 - 0.015;
  gateLeaf(B, [gx - 0.05, yA], [0, 1], [1, 0], leafW, gate.height, 78 * Math.PI / 180);
  gateLeaf(B, [gx - 0.05, yB], [0, -1], [1, 0], leafW, gate.height, -72 * Math.PI / 180);
  // gate track / threshold strip
  B.add('concrete', boxUV(boxAt(gx, (yA + yB) / 2, -0.04, 0.5, yB - yA, 0.06), 1 / 3));

  // ---- blue fence near Block A (ends at the inner face of the E2 wall run)
  const bf = F.blueFenceNearA;
  const e2 = CW.runs.find((r) => r.id === 'E2');
  let fx1 = bf.to[0];
  if (e2 && e2.from[0] === e2.to[0] && fx1 > e2.from[0] - T / 2) fx1 = e2.from[0] - T / 2 - 0.01; // avoid crossing the wall
  fence(B, [bf.from[0], bf.from[1]], [fx1, bf.to[1]], bf.height, [0, -1]);

  // ---- green PPGI screen above the walls (two horizontal-ribbed bands on posts & runners)
  const GS = CW.greenScreen;
  // Local override (polish r1): WA0009/WA0010 show a clear ~0.35 m see-through slot between the two
  // bands with the rusty support rail in it (site-data has 0.15 m; change requested).
  // Polish r2: the dyeing-shed east eave + blue gutter (x≈40.01..40.17, z≈5.10..5.24) overhang the
  // E wall line, so a screen sitting on the wall top showed a continuous blue strip above it from the
  // east field (WA0010 shows only a dark sliver of roof). The screen is therefore hung on the OUTER
  // face of the wall (posts anchored to the wall face, sheets ≈0.22 m out of the wall centre line,
  // clear of the gutter) and its top band rises to 5.30 m so the gutter hides behind it.
  const bands = GS.bands.length === 2 && GS.bands[1][0] - GS.bands[0][1] < 0.3
    ? [[GS.bands[0][0], 3.60], [3.90, 5.30]] : GS.bands;
  const zTop = bands[bands.length - 1][1] + 0.04;
  const OP = T / 2 + 0.025, OR = OP + 0.05, OS = OR + 0.028; // post / runner / sheet offsets (outward)
  const shed = ctx.site.BUILDINGS.DYEING_SHED?.footprint;
  for (const run of GS.runs) {
    const [x0, y0] = run.from, [x1, y1] = run.to;
    const L = Math.hypot(x1 - x0, y1 - y0); const dx = (x1 - x0) / L, dy = (y1 - y0) / L;
    const out = [dy, -dx]; // outward (yard on the left)
    const dir = D(dx, dy), ax = D(out[0], out[1]);
    const rr = Math.atan2(dy, dx);
    // the two runs meet at the SE corner: extend each past it by the outward offset so the sheets close
    const atCorner = (p) => GS.runs.some((o) => o !== run && (key(o.from) === key(p) || key(o.to) === key(p)));
    // ...and stop short at the gate pillar (0.46 m) so the offset sheets don't poke through its face
    const extAt = (p) => (atCorner(p) ? OS + 0.026 : gateKeys.has(key(p)) ? -0.235 : 0.07);
    const e0 = extAt(run.from), e1 = extAt(run.to);
    // posts (RHS 50×50) bolted to the outer wall face with two anchor cleats, rising to the screen top
    const n = Math.max(1, Math.round(L / 3.0));
    const zPost0 = H - 0.75;
    for (let i = 0; i <= n; i++) {
      const t = i / n, px = x0 + (x1 - x0) * t + out[0] * OP, py = y0 + (y1 - y0) * t + out[1] * OP;
      B.add('steelDark', boxAt(px, py, zPost0, 0.05, 0.05, zTop - zPost0, rr));
      for (const z of [zPost0 + 0.12, H - 0.25]) B.add('steelDark', boxAt(px - out[0] * 0.028, py - out[1] * 0.028, z, 0.14, 0.008, 0.12, rr));
      B.add('steelDark', boxAt(px, py, zTop, 0.07, 0.07, 0.01, rr));
      // diagonal stay back to the wall top on the yard side every second post
      if (i % 2 === 0 && i > 0 && i < n) {
        const a = V(px - out[0] * 0.03, py - out[1] * 0.03, zTop - 0.7), b = V(px - out[0] * (OP + 0.6), py - out[1] * (OP + 0.6), H + 0.06);
        B.add('steelDark', beam(a, b, 0.04, 0.04, UP));
        B.add('steelDark', boxAt(b.x, -b.z, H + 0.055, 0.14, 0.14, 0.012, rr));
      }
    }
    const S0 = (o, z) => V(x0 - dx * e0 + out[0] * o, y0 - dy * e0 + out[1] * o, z);
    const S1 = (o, z) => V(x1 + dx * e1 + out[0] * o, y1 + dy * e1 + out[1] * o, z);
    // runners (behind the sheets; the gap runner is visible between the bands as in WA0009)
    const runZ = [];
    for (const [z0, z1] of bands) runZ.push(z0 + 0.07, (z0 + z1) / 2, z1 - 0.07);
    for (const z of runZ) B.add('steelDark', beam(S0(OR, z), S1(OR, z), 0.05, 0.075, UP));
    // rusty angle rail exposed in each slot between bands (WA0009)
    for (let k = 0; k < bands.length - 1; k++) {
      const z = (bands[k][1] + bands[k + 1][0]) / 2 - 0.03;
      const a = S0(OR - 0.005, z), b = S1(OR - 0.005, z);
      B.add('rust', beam(a, b, 0.05, 0.05, UP));
      B.add('rust', beam(a.clone().addScaledVector(ax, 0.022).setY(z + 0.025), b.clone().addScaledVector(ax, 0.022).setY(z + 0.025), 0.006, 0.05, UP));
      // black HDPE shade-net strip tied behind the slot along the dyeing-shed stretch only: from the
      // east field the slot reads as the dark band of WA0010 instead of showing the shed's blue cladding.
      // (Elsewhere — the ETP stretch, WA0009 — the slot stays see-through.)
      if (shed) {
        const along = (p) => (p[0] - x0) * dx + (p[1] - y0) * dy;
        const sa = [along([shed.x0, shed.y0]), along([shed.x1, shed.y0]), along([shed.x0, shed.y1]), along([shed.x1, shed.y1])];
        const s0 = Math.max(0, Math.min(...sa) - 0.6), s1 = Math.min(L, Math.max(...sa) + 0.6);
        const offs = Math.abs(dx) > 0.5 ? Math.abs(y0 - shed.y0) : Math.abs(x0 - shed.x1);
        if (s1 - s0 > 1 && offs < 1.5) {
          const zb = bands[k][1] - 0.05, zt2 = bands[k + 1][0] + 0.05;
          const m = (s0 + s1) / 2;
          B.add('net', boxAt(x0 + dx * m + out[0] * (OP + 0.03), y0 + dy * m + out[1] * (OP + 0.03), zb, s1 - s0, 0.004, zt2 - zb, rr));
        }
      }
    }
    // sheets: real trapezoidal profile swept along the run (both faces)
    const ext0 = e0, ext1 = e1;
    const start = V(x0 - dx * ext0 + out[0] * OS, y0 - dy * ext0 + out[1] * OS, 0);
    const len = L + ext0 + ext1;
    for (const [z0, z1] of bands) {
      const prof = trapProfile(z0, z1, 0.24, 0.035, 0.016, 0.026, z0 + 0.03);
      B.add('greenSheet', sweep(prof, start, dir, len, ax, UP, { uScale: 12, vScale: 1.25, vOfs: -z0, uOfs: (x0 + y0) % 12, soften: 0.85 }));
      const back = prof.map(([a, b]) => [a - 0.0015, b]);
      B.add('sheetBack', sweep(back, start, dir, len, ax, UP, { uScale: 4, vScale: 4, flip: true }));
      // top/bottom edge trims
      for (const z of [z0, z1]) {
        const a = start.clone().setY(z), b = start.clone().addScaledVector(dir, len).setY(z);
        B.add('greenSheet', beam(a.clone().addScaledVector(ax, 0.013), b.clone().addScaledVector(ax, 0.013), 0.034, 0.012, UP));
      }
    }
  }
  // corner flashing at the SE corner of the screen
  const r0 = GS.runs[0].to;
  for (const [z0, z1] of bands) {
    const cx = r0[0] + OS + 0.032, cy = r0[1] - OS - 0.032; // outside the crossing sheets
    B.add('greenSheet', boxAt(cx, cy + 0.075, z0, 0.012, 0.16, z1 - z0));
    B.add('greenSheet', boxAt(cx - 0.075, cy, z0, 0.16, 0.012, z1 - z0));
  }
}

function key(p) { return `${p[0].toFixed(2)},${p[1].toFixed(2)}`; }

/** One gate leaf: hinge at plan h, closed along 'al' and facing 'out'; opened by angle a (CCW +). */
function gateLeaf(B, h, al, out, W, Ht, a) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const rot = ([x, y]) => [x * ca - y * sa, x * sa + y * ca];
  const A = rot(al), O = rot(out);
  const P = (s, o, z) => V(h[0] + A[0] * s + O[0] * o, h[1] + A[1] * s + O[1] * o, z);
  const zb = 0.08, zt = zb + Ht;
  // frame (square tube)
  for (const s of [0.03, W - 0.03]) B.add('steelPaint', beam(P(s, 0, zb), P(s, 0, zt), 0.05, 0.05, D(A[0], A[1])));
  for (const z of [zb + 0.03, zb + Ht * 0.5, zt - 0.03]) B.add('steelPaint', beam(P(0.03, 0, z), P(W - 0.03, 0, z), 0.05, 0.05, UP));
  B.add('steelPaint', beam(P(0.06, 0, zb + 0.08), P(W - 0.06, 0, zb + Ht * 0.5 - 0.05), 0.04, 0.04, UP));
  B.add('steelPaint', beam(P(0.06, 0, zb + Ht * 0.5 + 0.05), P(W - 0.06, 0, zt - 0.08), 0.04, 0.04, UP));
  // vertical-ribbed sheet (outer face) + primer back
  const prof = trapProfile(0.02, W - 0.02, 0.2, 0.03, 0.012, 0.02, 0.01);
  const org = P(0, 0.03, zb + 0.04);
  const ax = D(O[0], O[1]), bx = D(A[0], A[1]);
  B.add('blueSheet', sweep(prof, org, UP, Ht - 0.08, ax, bx, { uScale: 2.4, vScale: 3.0, swap: true }));
  const back = prof.map(([p, q]) => [p - 0.0015, q]);
  B.add('sheetBack', sweep(back, org, UP, Ht - 0.08, ax, bx, { uScale: 3, vScale: 3, flip: true }));
  // hinges, drop bolt, castor
  for (const z of [zb + 0.3, zt - 0.3]) B.add('steelDark', cylBetween(P(0, -0.02, z - 0.08), P(0, -0.02, z + 0.08), 0.025, 8));
  B.add('galv', cylBetween(P(W - 0.12, -0.04, 0.0), P(W - 0.12, -0.04, 0.6), 0.01, 6));
  B.add('rubber', cylBetween(P(W - 0.25, -0.03, 0.065), P(W - 0.25, 0.0, 0.065), 0.06, 12));
  B.add('steelDark', cylBetween(P(W - 0.55, -0.05, zb + Ht * 0.5), P(W - 0.35, -0.05, zb + Ht * 0.5), 0.02, 6));
}

/** Sheet fence on posts: sheets on the 'out' side. */
function fence(B, a, b, Ht, out) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
  const n = Math.max(1, Math.round(L / 1.6));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t - out[0] * 0.04, y = a[1] + (b[1] - a[1]) * t - out[1] * 0.04;
    B.add('steelPaint', boxAt(x, y, -0.3, 0.06, 0.06, Ht + 0.35));
    B.add('concrete', boxUV(boxAt(x, y, -0.1, 0.3, 0.3, 0.16), 1 / 3));
  }
  for (const z of [0.2, Ht * 0.5, Ht - 0.08]) {
    B.add('steelPaint', beam(V(a[0] - out[0] * 0.04, a[1] - out[1] * 0.04, z), V(b[0] - out[0] * 0.04, b[1] - out[1] * 0.04, z), 0.04, 0.04, UP));
  }
  const prof = trapProfile(0, L, 0.2, 0.03, 0.012, 0.02, 0.0);
  const org = V(a[0] + out[0] * 0.0, a[1] + out[1] * 0.0, 0.06);
  const ax = D(out[0], out[1]), bx = D(dx, dy);
  B.add('blueSheet', sweep(prof, org, UP, Ht - 0.06, ax, bx, { uScale: 2.4, vScale: 3.0, swap: true, uOfs: 0 }));
  const back = prof.map(([p, q]) => [p - 0.0015, q]);
  B.add('sheetBack', sweep(back, org, UP, Ht - 0.06, ax, bx, { uScale: 3, vScale: 3, flip: true }));
}
