// ============================================================================
//  SOLAR — inverter station against the north wall of Office 1 (facing the lane):
//  concrete pad, GI rack + sheet canopy, 2 × 60 kW string inverters (finned
//  heat-sink housings, display, DC connectors, isolators), ACDB panel, cabling.
// ============================================================================
import * as THREE from 'three';
import { GB, beam, rod, W } from './geom.js';
import { makeGalvTexture, makeConcreteTexture, makeInverterFront, makeAcdbFront } from './textures.js';

export function buildInverterStation(ctx) {
  const { site } = ctx;
  const Q = ctx.quality || 'high';
  const S = site.INVERTER_STATION;
  const group = new THREE.Group(); group.name = 'inverter-station';
  const wallY = site.BUILDINGS.OFFICES.footprint.y1;      // 42.19 north face of Office 1

  const galvMat = new THREE.MeshStandardMaterial({ name: 'inv-gi', map: makeGalvTexture(128, 9), metalness: 0.75, roughness: 0.5 });
  const concMat = new THREE.MeshStandardMaterial({ name: 'inv-conc', map: makeConcreteTexture(256, 8), roughness: 0.95 });
  const housingMat = new THREE.MeshStandardMaterial({ name: 'inv-housing', color: 0xe4e6e7, roughness: 0.45, metalness: 0.1 });
  const frontMat = new THREE.MeshStandardMaterial({ name: 'inv-front', map: makeInverterFront(), roughness: 0.4, metalness: 0.05, emissive: 0x000000 });
  const finMat = new THREE.MeshStandardMaterial({ name: 'inv-fins', color: 0x9da2a6, roughness: 0.4, metalness: 0.8 });
  const blackMat = new THREE.MeshStandardMaterial({ name: 'inv-black', color: 0x161616, roughness: 0.65 });
  const acdbMat = new THREE.MeshStandardMaterial({ name: 'acdb', color: 0xc9cbc6, roughness: 0.55, metalness: 0.15 });
  const acdbFront = new THREE.MeshStandardMaterial({ name: 'acdb-front', map: makeAcdbFront(), roughness: 0.55, metalness: 0.15 });
  const sheetMat = new THREE.MeshStandardMaterial({ name: 'inv-canopy', color: 0xb9bdbf, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide });
  const redMat = new THREE.MeshStandardMaterial({ name: 'inv-red', color: 0xb02020, roughness: 0.5 });

  const gG = new GB(), gC = new GB(), gH = new GB(), gF = new GB(), gB = new GB(), gA = new GB(), gS = new GB(), gR = new GB();
  const front = []; // front panels (separate meshes with own UVs)

  // --- concrete pad
  const padY0 = wallY, padY1 = S.y1 + 0.10, padX0 = S.x0 - 0.10, padX1 = S.x1 + 0.10, padTop = 0.12;
  gC.obox(W([(padX0 + padX1) / 2, (padY0 + padY1) / 2, (padTop - 0.05) / 2]), new THREE.Vector3((padX1 - padX0) / 2, 0, 0),
    new THREE.Vector3(0, (padTop + 0.05) / 2, 0), new THREE.Vector3(0, 0, (padY1 - padY0) / 2), 2);

  // --- GI rack: back uprights (75×40 C) on base plates, mounting rails, front canopy posts
  const yRack = 42.62, xs = [S.x0 + 0.08, (S.x0 + S.x1) / 2 - 0.05, S.x1 - 0.08];
  const zTop = S.canopyZ;
  for (const x of xs) {
    gG.obox(W([x, yRack, (padTop + zTop) / 2]), new THREE.Vector3(0.0375, 0, 0), new THREE.Vector3(0, (zTop - padTop) / 2, 0), new THREE.Vector3(0, 0, 0.02));
    gG.obox(W([x, yRack, padTop + 0.004]), new THREE.Vector3(0.08, 0, 0), new THREE.Vector3(0, 0.004, 0), new THREE.Vector3(0, 0, 0.08));
    // wall tie back to the office wall
    gG.obox(W([x, (wallY + yRack) / 2, zTop - 0.25]), new THREE.Vector3(0.02, 0, 0), new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0, (yRack - wallY) / 2));
  }
  for (const z of [0.78, 1.62]) gG.obox(W([(S.x0 + S.x1) / 2, yRack + 0.04, z]), new THREE.Vector3((S.x1 - S.x0) / 2, 0, 0), new THREE.Vector3(0, 0.021, 0), new THREE.Vector3(0, 0, 0.02));
  const yFront = S.y1 - 0.05;
  for (const x of [S.x0 + 0.05, S.x1 - 0.05]) {
    rod(gG, W([x, yFront, padTop]), W([x, yFront, zTop - 0.12]), 0.024, 8);
    gG.obox(W([x, yFront, padTop + 0.004]), new THREE.Vector3(0.07, 0, 0), new THREE.Vector3(0, 0.004, 0), new THREE.Vector3(0, 0, 0.07));
  }
  // canopy frame + sloping profiled sheet (fall towards the lane)
  const zBack = zTop + 0.10, zFr = zTop - 0.10, cy0 = wallY + 0.02, cy1 = S.y1 + 0.25;
  const zAtY = (y) => zBack + (zFr - zBack) * (y - cy0) / (cy1 - cy0);
  beam(gG, W([S.x0 - 0.15, yFront, zAtY(yFront) - 0.06]), W([S.x1 + 0.15, yFront, zAtY(yFront) - 0.06]), 0.05, 0.08, new THREE.Vector3(0, 1, 0));
  beam(gG, W([S.x0 - 0.15, wallY + 0.04, zAtY(wallY + 0.04) - 0.06]), W([S.x1 + 0.15, wallY + 0.04, zAtY(wallY + 0.04) - 0.06]), 0.05, 0.08, new THREE.Vector3(0, 1, 0));
  for (const x of xs) beam(gG, W([x, cy0, zAtY(cy0) - 0.05]), W([x, cy1 - 0.05, zAtY(cy1 - 0.05) - 0.05]), 0.04, 0.06, new THREE.Vector3(0, 1, 0));
  {
    // trapezoidal sheet: ribs every 0.25 m running down the fall (along y)
    const x0 = S.x0 - 0.25, x1 = S.x1 + 0.25, pitch = 0.25, rib = 0.028;
    const prof = [];
    for (let x = x0; x <= x1 + 1e-6; x += pitch) {
      prof.push([x, 0], [x + 0.03, 0], [x + 0.05, rib], [x + 0.09, rib], [x + 0.11, 0]);
    }
    prof.push([x1 + 0.11, 0]);
    for (let i = 0; i < prof.length - 1; i++) {
      const [xa, ha] = prof[i], [xb, hb] = prof[i + 1]; if (xb > x1 + 0.12) break;
      const a = W([xa, cy0, zAtY(cy0) + ha]), b = W([xb, cy0, zAtY(cy0) + hb]);
      const c = W([xb, cy1, zAtY(cy1) + hb]), d = W([xa, cy1, zAtY(cy1) + ha]);
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), d.clone().sub(a)).normalize(); if (n.y < 0) n.negate();
      gS.quad(a, b, c, d, n);
    }
  }

  const yDuct = yRack + 0.16, zDuct = 0.30;
  // --- inverters (≈ 0.70 × 0.60 × 0.30 m), front facing north (+y)
  for (const inv of site.INVERTERS) {
    const [x, , zc] = inv.location; const w = 0.70, h = 0.60, d = 0.28;
    const yb = yRack + 0.085, yf = yb + d, yc = (yb + yf) / 2;
    // mounting bracket
    gG.obox(W([x, yb - 0.012, zc]), new THREE.Vector3(0.30, 0, 0), new THREE.Vector3(0, 0.40, 0), new THREE.Vector3(0, 0, 0.012));
    // main housing (front face separate mesh)
    gH.obox(W([x, yc - 0.01, zc]), new THREE.Vector3(w / 2 - 0.06, 0, 0), new THREE.Vector3(0, h / 2, 0), new THREE.Vector3(0, 0, d / 2 - 0.01));
    gH.obox(W([x, yc, zc + h / 2 + 0.012]), new THREE.Vector3(w / 2 + 0.01, 0, 0), new THREE.Vector3(0, 0.012, 0), new THREE.Vector3(0, 0, d / 2 + 0.02)); // rain hood
    front.push({ x, y: yf - 0.019, z: zc, w: w - 0.12, h });
    // heat-sink fins both sides (vertical)
    for (const sgn of [-1, 1]) {
      for (let k = 0; k < (Q === 'low' ? 4 : 9); k++) {
        const yk = yb + 0.02 + k * ((d - 0.06) / (Q === 'low' ? 3 : 8));
        gF.obox(W([x + sgn * (w / 2 - 0.03), yk, zc]), new THREE.Vector3(0.03, 0, 0), new THREE.Vector3(0, h / 2 - 0.02, 0), new THREE.Vector3(0, 0, 0.003));
      }
      gF.obox(W([x + sgn * (w / 2 - 0.058), yc, zc]), new THREE.Vector3(0.004, 0, 0), new THREE.Vector3(0, h / 2 - 0.01, 0), new THREE.Vector3(0, 0, d / 2 - 0.01));
    }
    // bottom: 12 DC connector pairs (MC4), AC gland, DC isolator knobs
    const zb = zc - h / 2;
    for (let k = 0; k < 12; k++) {
      const xk = x - 0.24 + k * 0.032;
      rod(gB, W([xk, yc + 0.05, zb]), W([xk, yc + 0.05, zb - 0.045]), 0.008, 6);
      rod(gB, W([xk, yc - 0.03, zb]), W([xk, yc - 0.03, zb - 0.045]), 0.008, 6);
    }
    rod(gB, W([x + 0.24, yc, zb]), W([x + 0.24, yc, zb - 0.05]), 0.022, 10);
    for (const s of [-1, 1]) {
      rod(gB, W([x + s * 0.30, yf - 0.06, zb + 0.08]), W([x + s * 0.30, yf + 0.03, zb + 0.08]), 0.028, 10);
      gR.obox(W([x + s * 0.30, yf + 0.045, zb + 0.08]), new THREE.Vector3(0.035, 0, 0), new THREE.Vector3(0, 0.008, 0), new THREE.Vector3(0, 0, 0.012));
    }
    // DC string cables: from the connectors straight down into the GI trunking at the rack foot
    // (tied into 4 neat bundles, each fanning out to 3 connector pairs)
    for (let b = 0; b < 4; b++) {
      const xb = x - 0.208 + b * 0.096, zf = zb - 0.12;
      for (let k = 0; k < 3; k++) {
        const xk = x - 0.24 + (b * 3 + k) * 0.032;
        for (const dy of [0.05, -0.03]) rod(gB, W([xk, yc + dy, zb - 0.045]), W([xb, yc + 0.01, zf]), 0.004, 5, false);
      }
      rod(gB, W([xb, yc + 0.01, zf]), W([xb, yDuct, zDuct + 0.04]), 0.011, 7, false);
      rod(gB, W([xb, yc + 0.01, zf - 0.01]), W([xb, yc + 0.01, zf + 0.012]), 0.0125, 7); // cable tie
    }
    // AC output cable up to the overhead tray
    rod(gB, W([x + 0.24, yc, zb - 0.05]), W([x + 0.24, yc, zb - 0.12]), 0.014, 8);
    rod(gB, W([x + 0.24, yc, zb - 0.12]), W([x + 0.33, yRack + 0.06, zb - 0.12]), 0.014, 8);
    rod(gB, W([x + 0.33, yRack + 0.06, zb - 0.12]), W([x + 0.33, yRack + 0.06, zTop - 0.17]), 0.014, 8);
  }
  // DC trunking along the rack foot, feeding the riser to the cable trench
  beam(gG, W([S.x0 + 0.3, yDuct, zDuct]), W([S.x1 - 0.8, yDuct, zDuct]), 0.10, 0.08, new THREE.Vector3(0, 0, 1));
  // overhead GI cable tray along the rack top + riser into the trench
  beam(gG, W([S.x0 + 0.05, yRack + 0.06, zTop - 0.17]), W([S.x1 - 0.05, yRack + 0.06, zTop - 0.17]), 0.12, 0.06, new THREE.Vector3(0, 1, 0));
  beam(gG, W([14.25, yRack + 0.06, zTop - 0.17]), W([14.25, yRack + 0.06, padTop]), 0.12, 0.06, new THREE.Vector3(0, 0, -1), 0.03);
  beam(gG, W([14.25, yRack + 0.06, padTop + 0.03]), W([14.25, S.y1 + 0.10, padTop + 0.03]), 0.12, 0.06, new THREE.Vector3(0, 0, 1));

  // --- ACDB (0.60 × 0.80 × 0.25) on the rack, east of inverter 2
  {
    const x = S.x1 - 0.42, zc = 1.30, w = 0.6, h = 0.8, d = 0.25, yb = yRack + 0.06, yf = yb + d;
    gA.obox(W([x, (yb + yf) / 2, zc]), new THREE.Vector3(w / 2, 0, 0), new THREE.Vector3(0, h / 2, 0), new THREE.Vector3(0, 0, d / 2 - 0.002));
    gA.obox(W([x, (yb + yf) / 2, zc + h / 2 + 0.01]), new THREE.Vector3(w / 2 + 0.02, 0, 0), new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0, 0, d / 2 + 0.02));
    front.push({ x, y: yf + 0.001, z: zc, w: w - 0.02, h: h - 0.02, acdb: true });
    // cable glands + outgoing armoured cable into the office wall
    rod(gB, W([x, (yb + yf) / 2, zc - h / 2]), W([x, (yb + yf) / 2, zc - h / 2 - 0.08]), 0.025, 8);
    rod(gB, W([x + 0.2, yb + 0.05, zc + h / 2]), W([x + 0.2, yb + 0.05, zTop - 0.2]), 0.02, 6);
  }

  // --- meshes
  const mk = (gb, mat, name, shadow = true) => {
    if (!gb.triCount) return;
    const m = new THREE.Mesh(gb.build(), mat); m.name = name; m.castShadow = shadow; m.receiveShadow = true; group.add(m);
  };
  mk(gG, galvMat, 'inv-gi'); mk(gC, concMat, 'inv-pad', false); mk(gH, housingMat, 'inv-housing'); mk(gF, finMat, 'inv-fins');
  mk(gB, blackMat, 'inv-cables'); mk(gA, acdbMat, 'acdb'); mk(gS, sheetMat, 'inv-canopy'); mk(gR, redMat, 'inv-isolator');
  // front panels (textured planes, slightly proud of the housing)
  const gI = new GB(), gD = new GB();
  for (const f of front) {
    const gb = f.acdb ? gD : gI; const n = new THREE.Vector3(0, 0, -1);
    const a = W([f.x - f.w / 2, f.y, f.z - f.h / 2]), b = W([f.x + f.w / 2, f.y, f.z - f.h / 2]);
    const c = W([f.x + f.w / 2, f.y, f.z + f.h / 2]), d = W([f.x - f.w / 2, f.y, f.z + f.h / 2]);
    gb.quad(a, b, c, d, n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  mk(gI, frontMat, 'inv-front', false); mk(gD, acdbFront, 'acdb-front', false);
  return { group };
}
