// ============================================================================
//  STRUCTURES — PSC electric poles, cross-arms, insulators, sagging conductors,
//  floodlight & meter box on the pole by Block A (WA0005)
// ============================================================================
import * as THREE from 'three';
import { V, D, UP, boxAt, boxUV, beam, cylBetween, revolve, placeAt, catenary, wireTube, orientedBox } from './kit.js';

const INSUL = [[0, 0], [0.035, 0], [0.04, 0.025], [0.085, 0.045], [0.05, 0.07], [0.07, 0.09], [0.042, 0.115], [0.055, 0.13], [0.03, 0.16], [0.02, 0.175], [0, 0.178]];

export function buildPoles(ctx, B) {
  const F = ctx.site.FEATURES;
  const poles = F.poles, wires = F.wires;
  const low = ctx.quality === 'low';
  // integrator: every conductor is also drawn as a 1-px GL line so it never breaks up into dashes at distance
  const linePts = [];
  // black PVC-insulated service cable (Ø ≈ 12 mm), also mirrored as a GL line for distance views
  const cable = (pts, r = 0.006) => { B.add('rubber', wireTube(pts, r, 4)); for (let k = 0; k < pts.length - 1; k++) linePts.push(pts[k], pts[k + 1]); };
  const wire = (pts, r) => { B.add('wire', wireTube(pts, r, 4)); for (let k = 0; k < pts.length - 1; k++) linePts.push(pts[k], pts[k + 1]); };
  // line direction at each pole (average of connected spans)
  const dirs = poles.map(() => [0, 0]);
  for (const [i, j] of wires) {
    const dx = poles[j].x - poles[i].x, dy = poles[j].y - poles[i].y, l = Math.hypot(dx, dy);
    for (const k of [i, j]) { const s = (dirs[k][0] * dx + dirs[k][1] * dy) < 0 ? -1 : 1; dirs[k][0] += s * dx / l; dirs[k][1] += s * dy / l; }
  }
  const attach = []; // per pole: { top, left, right, cross:[cx,cy] }
  poles.forEach((p, i) => {
    let [lx, ly] = dirs[i]; const l = Math.hypot(lx, ly) || 1; lx /= l; ly /= l;
    if (!Math.hypot(...dirs[i])) { lx = 0; ly = 1; }
    const cxd = -ly, cyd = lx; // cross-arm direction
    const rot = Math.atan2(ly, lx);
    const H = p.h;
    // Polish r2 (WA0005): old PSC poles are never plumb — 1-2° lean in a per-pole direction, applied
    // as a shear about the ground to every part of the pole (fittings, floodlight, meter box too)
    const hr = (k) => { const v = Math.sin((p.x * 12.9898 + p.y * 78.233 + k * 37.719) * 0.731) * 43758.5453; return v - Math.floor(v); };
    const la = hr(1) * Math.PI * 2, lean = Math.tan((1.0 + hr(2) * 1.0) * Math.PI / 180);
    const lv = [Math.cos(la) * lean, Math.sin(la) * lean];
    const shear = (v) => v.set(v.x + lv[0] * Math.max(0, v.y), v.y, v.z - lv[1] * Math.max(0, v.y));
    const PB = { add: (k, gg) => { const ps = gg.attributes.position, t = new THREE.Vector3();
      for (let q = 0; q < ps.count; q++) { shear(t.fromBufferAttribute(ps, q)); ps.setXYZ(q, t.x, t.y, t.z); }
      return B.add(k, gg); } };
    // the cross-arm on the floodlight pole has slipped badly (WA0005); the others sit a few degrees off level
    const tilt = p.floodlight ? 0.2 : (hr(3) - 0.5) * 0.08;
    // tapered rectangular PSC pole (base 0.22×0.16 → top 0.12×0.10)
    const g = new THREE.BoxGeometry(1, 1, 1, 1, 6, 1);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const t = pos.getY(k) + 0.5; // 0 bottom .. 1 top
      pos.setX(k, pos.getX(k) * (0.22 + (0.12 - 0.22) * t));
      pos.setZ(k, pos.getZ(k) * (0.16 + (0.10 - 0.16) * t));
      pos.setY(k, -0.4 + t * (H + 0.4));
    }
    g.computeVertexNormals();
    g.rotateY(rot); g.translate(p.x, 0, -p.y);
    PB.add('concrete', boxUV(g, 1 / 3, 1 / 3));
    PB.add('concrete', boxUV(boxAt(p.x, p.y, -0.1, 0.42, 0.42, 0.32, rot), 1 / 3));
    // pole-top bracket + top insulator
    const zt = H;
    PB.add('steelDark', boxAt(p.x, p.y, zt - 0.25, 0.16, 0.14, 0.26, rot));
    PB.add('galv', cylBetween(V(p.x, p.y, zt), V(p.x, p.y, zt + 0.06), 0.013, 6));
    PB.add('porcelain', placeAt(revolve(INSUL, low ? 8 : 12), p.x, p.y, zt + 0.04));
    // cross-arm (MS channel) with braces & two pin insulators
    const za = zt - 0.38, arm = 0.8;
    const A = (s, z) => V(p.x + cxd * s, p.y + cyd * s, z + s * tilt);
    PB.add('steelDark', beam(A(-arm, za), A(arm, za), 0.075, 0.1, UP));
    for (const s of [-1, 1]) PB.add('steelDark', beam(A(s * 0.5, za - 0.04), A(s * 0.06, za - 0.55), 0.045, 0.006, D(lx, ly)));
    const pins = [-0.68, 0.68];
    for (const s of pins) {
      PB.add('galv', cylBetween(A(s, za + 0.05), A(s, za + 0.11), 0.012, 6));
      PB.add('porcelain', placeAt(revolve(INSUL, low ? 8 : 12), p.x + cxd * s, p.y + cyd * s, za + 0.09 + s * tilt));
    }
    attach.push({
      top: shear(V(p.x, p.y, zt + 0.04 + 0.17)),
      side: pins.map((s) => ({ s, pt: shear(A(s, za + 0.09 + 0.17)) })),
      shear, low: (z) => shear(V(p.x, p.y, z)),
      cross: [cxd, cyd],
    });
    // danger plate + earthing strip
    PB.add('steelPaint', boxAt(p.x + Math.cos(rot) * 0.115, p.y + Math.sin(rot) * 0.115, 2.3, 0.01, 0.2, 0.15, rot));
    PB.add('galv', beam(V(p.x - Math.cos(rot) * 0.118, p.y - Math.sin(rot) * 0.118, 0.0), V(p.x - Math.cos(rot) * 0.068, p.y - Math.sin(rot) * 0.068, zt - 0.3), 0.025, 0.004, D(Math.cos(rot), Math.sin(rot))));

    if (p.floodlight) addFloodlight(PB, p, rot, ctx);
  });

  // ---- conductors (3 per span, parabolic sag)
  for (const [i, j] of wires) {
    const a = attach[i], b = attach[j];
    const L = a.top.distanceTo(b.top);
    // LT aluminium conductors strung slack: ≈2 % of span, each conductor a little different so the
    // three never run as parallel ruled lines (WA0005 / WA0010)
    const sag0 = 0.019 * L + 0.1;
    const span = new THREE.Vector3().subVectors(b.top, a.top); span.y = 0; span.normalize();
    const perp = new THREE.Vector3(-span.z, 0, span.x); // horizontal ⟂
    const pick = (att, sign) => att.side.reduce((best, c) => (sign * c.pt.clone().sub(att.top).dot(perp) > sign * best.pt.clone().sub(att.top).dot(perp) ? c : best)).pt;
    const pairs = [[a.top, b.top], [pick(a, 1), pick(b, 1)], [pick(a, -1), pick(b, -1)]];
    pairs.forEach(([p, q], k) => wire(catenary(p, q, sag0 * (0.9 + 0.11 * k + 0.05 * ((i * 7 + j * 3) % 3)), 26), 0.0075));
  }
  // service drop from the floodlight pole to the Block A east wall
  const fp = poles.findIndex((p) => p.floodlight);
  if (fp >= 0) {
    const A = ctx.site.BUILDINGS.A.footprint;
    const end = V(A.x1 + 0.08, Math.max(A.y0 + 0.7, Math.min(A.y1, poles[fp].y + 0.4)), 5.6);
    B.add('steelDark', beam(V(A.x1, end.z * -1, 5.6), end, 0.03, 0.03, UP));
    serviceDrops(ctx, attach[fp], poles[fp], end, A, cable);
  }
  // stay (guy) wires at the line ends
  const deg = poles.map(() => 0); for (const [i, j] of wires) { deg[i]++; deg[j]++; }
  poles.forEach((p, i) => {
    if (deg[i] !== 1) return;
    const [dx, dy] = dirs[i]; const l = Math.hypot(dx, dy) || 1;
    const w = wires.find(([a, b]) => a === i || b === i); const o = poles[w[0] === i ? w[1] : w[0]];
    const sx = Math.sign((p.x - o.x) * dx + (p.y - o.y) * dy) || 1;
    const gx = p.x + sx * dx / l * 3.2, gy = p.y + sx * dy / l * 3.2;
    const top = attach[i].low(p.h - 0.6);
    B.add('galv', cylBetween(top, V(gx, gy, 0.0), 0.006, 4));
    B.add('concrete', boxUV(boxAt(gx, gy, -0.05, 0.3, 0.3, 0.12), 1 / 3));
    const mid = top.clone().lerp(V(gx, gy, 0), 0.55);
    B.add('porcelain', cylBetween(mid.clone().add(new THREE.Vector3(0, -0.05, 0)), mid.clone().add(new THREE.Vector3(0, 0.05, 0)), 0.03, 8));
  });
  if (!linePts.length) return null;
  const lg = new THREE.BufferGeometry().setFromPoints(linePts);
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1c1d1f, transparent: true, opacity: 0.8, depthWrite: false }));
  lines.name = 'structures:wire-lines'; lines.userData.noPick = true; lines.userData.noAO = true; lines.raycast = () => {};
  return lines;
}

/**
 * Slack service drops on the floodlight pole (WA0005): two aerial cables to the Block A wall with
 * drip loops at the pole, a loose spare-cable loop hanging off the tilted cross-arm, the meter-box
 * feed looping down into the PVC conduit, the floodlight feed and the meter tail to the wall.
 */
function serviceDrops(ctx, att, p, end, A, cable) {
  const W = (x, y, z) => att.shear(V(x, y, z));
  const Vd = (v, dx, dy, dz) => v.clone().add(new THREE.Vector3(dx, dz, -dy)); // plan offsets on a world point
  const smoothPath = (pts, n = 40) => new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(n);
  const toWall = new THREE.Vector3().subVectors(end, att.top); toWall.y = 0; toWall.normalize();
  const tw = [toWall.x, -toWall.z];
  // (1) two aerial drops pin → drip loop → slack span to the wall bracket
  att.side.forEach((sd, k) => {
    const P0 = sd.pt, e = end.clone().add(new THREE.Vector3(0, -0.12 * k, 0.1 * k));
    const dl = 0.55 + 0.25 * k;
    const loop = [P0, Vd(P0, tw[0] * 0.12, tw[1] * 0.12, -dl * 0.6), Vd(P0, tw[0] * 0.3, tw[1] * 0.3, -dl), Vd(P0, tw[0] * 0.5, tw[1] * 0.5, -dl * 0.55)];
    const L3 = loop[3], span = [];
    const sg = 0.45 + 0.2 * k;
    for (let i = 1; i <= 14; i++) { const t = i / 14; const v = L3.clone().lerp(e, t); v.y -= sg * 4 * t * (1 - t); span.push(v); }
    cable(smoothPath([...loop, ...span], 48), 0.0055);
  });
  // (2) spare-cable coil hanging off the low end of the cross-arm
  const pin = att.side[0].pt;
  const coil = [pin, Vd(pin, 0.1, -0.05, -0.5), Vd(pin, 0.35, 0.1, -1.05), Vd(pin, 0.55, 0.3, -0.7), Vd(pin, 0.4, 0.4, -0.25), Vd(pin, 0.12, 0.25, -0.35), Vd(pin, 0.05, 0.1, -0.9), att.low(p.h - 1.2)];
  cable(smoothPath(coil, 40), 0.005);
  // (3) meter-box feed: pin → slack bulge → conduit top on the pole
  const o = att.cross; // the meter box & conduit sit on the -cross side of the pole (addFloodlight)
  const ct = W(p.x - o[0] * 0.13, p.y - o[1] * 0.13, p.h - 0.45);
  const pin2 = att.side[1].pt;
  cable(smoothPath([pin2, Vd(pin2, 0.15, -0.2, -0.45), Vd(ct, 0.35, -0.3, 0.35), Vd(ct, 0.12, -0.08, 0.02), ct], 30), 0.006);
  // (4) floodlight feed: from the pole at ≈6.1 m, sagging down past the lamp bracket
  const fl = W(p.x, p.y, 6.1), lampBack = W(p.x - 0.12, p.y - 0.25, 5.45);
  cable(smoothPath([fl, Vd(fl, -0.15, -0.1, -0.5), Vd(lampBack, 0.05, 0.05, -0.2), lampBack], 20), 0.005);
  // (5) meter tail: meter box → slack run to the Block A wall at ≈2.7 m
  const mb = W(p.x - o[0] * 0.25 + tw[0] * 0.2, p.y - o[1] * 0.25 + tw[1] * 0.2, 2.0), wl = V(A.x1 + 0.02, Math.max(A.y0 + 0.6, p.y + 0.2), 2.7);
  const tail = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14; const v = mb.clone().lerp(wl, t); v.y -= 0.32 * 4 * t * (1 - t); tail.push(v); }
  cable(smoothPath([mb.clone().add(new THREE.Vector3(0, -0.15, 0)), ...tail], 24), 0.007);
}

function addFloodlight(B, p, rot, ctx) {
  // aim toward the lane / gate (SSW), tilted down
  const A = ctx.site.BUILDINGS.A.footprint;
  void A;
  const aim = new THREE.Vector3(-0.45, 0, 1).normalize(); // world: west-ish & south (+Z)
  const tilt = 28 * Math.PI / 180;
  const fwd = new THREE.Vector3(aim.x * Math.cos(tilt), -Math.sin(tilt), aim.z * Math.cos(tilt)).normalize();
  const side = new THREE.Vector3().crossVectors(UP, fwd).normalize();
  const up = new THREE.Vector3().crossVectors(fwd, side).normalize();
  const z = 5.4;
  const base = V(p.x, p.y, z);
  const c = base.clone().addScaledVector(aim, 0.34);
  // bracket arm
  B.add('steelDark', beam(base.clone().addScaledVector(aim, 0.06), base.clone().addScaledVector(aim, 0.3), 0.04, 0.04, UP));
  B.add('steelDark', beam(base.clone().addScaledVector(aim, 0.06).add(new THREE.Vector3(0, 0.25, 0)), base.clone().addScaledVector(aim, 0.26), 0.03, 0.03, UP));
  // housing (die-cast, finned back) + U-yoke
  B.add('rubber', orientedBox(c, side, up, fwd, 0.36, 0.28, 0.07));
  for (let i = -2; i <= 2; i++) B.add('rubber', orientedBox(c.clone().addScaledVector(side, i * 0.065).addScaledVector(fwd, -0.055), side, up, fwd, 0.008, 0.24, 0.045));
  for (const s of [-1, 1]) B.add('steelDark', orientedBox(c.clone().addScaledVector(side, s * 0.2), side, up, fwd, 0.012, 0.05, 0.06));
  B.add('flood', orientedBox(c.clone().addScaledVector(fwd, 0.036), side, up, fwd, 0.31, 0.23, 0.004));
  // meter / DP box on the pole + conduit
  const bx = p.x - Math.cos(rot) * 0.0 - 0.0, by = p.y;
  const out = D(-Math.sin(rot), Math.cos(rot));
  const o = [-Math.sin(rot), Math.cos(rot)];
  const bc = V(bx - o[0] * 0.25, by - o[1] * 0.25, 1.9);
  B.add('machGrey', orientedBox(bc, D(Math.cos(rot), Math.sin(rot)), UP, out, 0.36, 0.46, 0.2));
  B.add('pvc', cylBetween(V(bx - o[0] * 0.13, by - o[1] * 0.13, 2.13), V(bx - o[0] * 0.13, by - o[1] * 0.13, p.h - 0.45), 0.02, 6));
  B.add('pvc', cylBetween(V(bx - o[0] * 0.13, by - o[1] * 0.13, 0.0), V(bx - o[0] * 0.13, by - o[1] * 0.13, 1.67), 0.022, 6));
}
