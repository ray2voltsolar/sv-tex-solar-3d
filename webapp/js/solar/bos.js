// ============================================================================
//  SOLAR — balance of system on the roofs: GI walkway gratings, covered GI cable
//  trays (roof → wall → cable trench → inverter station), ESE lightning arresters
//  with down conductors, earthing pits, precast cable-trench covers.
// ============================================================================
import * as THREE from 'three';
import { GB, beam, rod, W, WD } from './geom.js';
import { makeGalvTexture, makeGratingTextures, makeConcreteTexture } from './textures.js';

export const TRAY = { w: 0.10, h: 0.06, roofLift: 0.05 };
export const TRENCH = { w: 0.42, top: 0.045, bottom: -0.05, slab: 0.6 };

export function buildBOS(ctx, modules) {
  const { site } = ctx;
  const Q = ctx.quality || 'high';
  const group = new THREE.Group(); group.name = 'solar-bos';
  const P = site.ROOF_PLANES;
  const aniso = Math.min(ctx.maxAnisotropy || 1, 16);

  // ------------------------------------------------------------- materials
  const galvMap = makeGalvTexture(Q === 'low' ? 128 : 256, 3, [196, 200, 199]);   // albedo ≈ 0.55-0.6 linear
  const galvMat = new THREE.MeshStandardMaterial({ name: 'gi', map: galvMap, color: 0xffffff, metalness: 0.6, roughness: 0.45, envMapIntensity: 1.0 });
  const grat = makeGratingTextures(Q === 'high' ? 512 : 256, aniso);
  const gratMat = new THREE.MeshStandardMaterial({ name: 'gi-grating', map: grat.map, normalMap: grat.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0.6, roughness: 0.55 });
  const concMap = makeConcreteTexture(256, 5);
  const concMat = new THREE.MeshStandardMaterial({ name: 'bos-concrete', map: concMap, roughness: 0.95, metalness: 0 });
  const ironMat = new THREE.MeshStandardMaterial({ name: 'bos-iron', color: 0x2e2c2a, roughness: 0.7, metalness: 0.5 });
  const ssMat = new THREE.MeshStandardMaterial({ name: 'ese-ss', color: 0xe3e5e7, roughness: 0.18, metalness: 1.0 });
  const plasticMat = new THREE.MeshStandardMaterial({ name: 'bos-plastic', color: 0x1c1c1c, roughness: 0.7 });

  const gGalv = new GB(), gGrat = new GB(), gConc = new GB(), gIron = new GB(), gSS = new GB(), gPl = new GB();
  const planeUV = (pl, u, v, h) => W(site.planePoint(pl, u, v, h));
  const obstaclesOn = (pid) => site.ROOF_OBSTACLES.filter((o) => o.plane === pid);
  const report = { gratingPanels: 0, skippedPanels: 0, traySegments: 0 };

  // ------------------------------------------------------------- walkways (gratings)
  const walk = {};
  for (const pid of Object.keys(site.LAYOUT_RULES)) {
    const pl = P[pid]; const { walkwaysV } = site.computePlaneSlots(pid);
    walk[pid] = walkwaysV;
    const U = WD(pl.u), N = WD(pl.n), V = WD(pl.v);
    for (const [w0] of walkwaysV) {
      const gv0 = w0 + 0.03, gv1 = w0 + 0.44;
      const segLen = 1.0, uA = 0.30, uB = pl.width - 0.30;
      const nSeg = Math.floor((uB - uA) / segLen);
      const off = uA + ((uB - uA) - nSeg * segLen) / 2;
      for (let k = 0; k < nSeg; k++) {
        const u0 = off + k * segLen + 0.006, u1 = off + (k + 1) * segLen - 0.006;
        // keep clear of turbo vents (base flashing + margin)
        const clash = obstaclesOn(pid).some((o) => {
          const cu = Math.max(u0, Math.min(o.u, u1)), cv = Math.max(gv0, Math.min(o.v, gv1));
          return Math.hypot(o.u - cu, o.v - cv) < site.TURBO_VENT.baseSize * 0.5 * 1.42 + 0.05;
        });
        if (clash) { report.skippedPanels++; continue; }
        report.gratingPanels++;
        const hb = 0.035, ht = 0.065;
        const c = (u, v, h) => planeUV(pl, u, v, h);
        const T = 0.30; // texture tile (m)
        const uvq = (a0, a1, b0, b1) => [[a0 / T, b0 / T], [a1 / T, b0 / T], [a1 / T, b1 / T], [a0 / T, b1 / T]];
        // top & bottom faces (bearing bars along u)
        gGrat.quad(c(u0, gv0, ht), c(u1, gv0, ht), c(u1, gv1, ht), c(u0, gv1, ht), N, uvq(u0, u1, gv0, gv1));
        gGrat.quad(c(u0, gv0, hb), c(u1, gv0, hb), c(u1, gv1, hb), c(u0, gv1, hb), N.clone().negate(), uvq(u0, u1, gv0, gv1));
        // binding bars (solid sides) — sample a bar texel
        const bar = [[0.0, 0.05], [0.0, 0.05], [0.0, 0.05], [0.0, 0.05]];
        gGrat.quad(c(u0, gv0, hb), c(u1, gv0, hb), c(u1, gv0, ht), c(u0, gv0, ht), V.clone().negate(), bar);
        gGrat.quad(c(u0, gv1, hb), c(u1, gv1, hb), c(u1, gv1, ht), c(u0, gv1, ht), V, bar);
        gGrat.quad(c(u0, gv0, hb), c(u0, gv1, hb), c(u0, gv1, ht), c(u0, gv0, ht), U.clone().negate(), bar);
        gGrat.quad(c(u1, gv0, hb), c(u1, gv1, hb), c(u1, gv1, ht), c(u1, gv0, ht), U, bar);
        // GI angle bearers under both ends (sit on the crest)
        for (const ub of [u0 + 0.06, u1 - 0.06]) {
          gGalv.obox(c(ub, (gv0 + gv1) / 2, hb / 2), U.clone().multiplyScalar(0.02), N.clone().multiplyScalar(hb / 2), V.clone().multiplyScalar((gv1 - gv0) / 2 + 0.02));
        }
      }
    }
  }

  // ------------------------------------------------------------- cable trays
  const trayLift = TRAY.roofLift + TRAY.h / 2;           // centreline above crest
  const vT = (pid) => walk[pid][0][0] + 0.52;            // tray runs on the upper side of each walkway
  const pp = (pid, u, v, h = trayLift) => site.planePoint(P[pid], u, v, h);
  const zAt = (pid, x, y) => site.planeZAt(P[pid], x, y);
  const UP = [0, 0, 1];
  const segs = [];  // [planA, planB, upPlan]
  const path = (pts, ups) => { for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1], ups[Math.min(i, ups.length - 1)]]); };
  const nOf = (pid) => P[pid].n;

  // --- Block A: both walkways → south verge → over the gable edge → down the south wall → trench
  {
    const A = site.BUILDINGS.A, rz = A.roof.ridgeZ, rx = A.roof.ridgeX;
    const wEnd = pp('A-W', P['A-W'].width - 0.10, vT('A-W'));      // y ≈ 50.11
    const xDrop = wEnd[0], yV = wEnd[1];
    path([pp('A-W', 0.35, vT('A-W')), wEnd], [nOf('A-W')]);
    const eEnd = pp('A-E', 0.10, vT('A-E'));
    path([pp('A-E', P['A-E'].width - 0.35, vT('A-E')), eEnd], [nOf('A-E')]);
    path([eEnd, [rx + 0.6, yV, zAt('A-E', rx + 0.6, yV) + trayLift], [rx, yV, rz + 0.17],
      [rx - 0.6, yV, zAt('A-W', rx - 0.6, yV) + trayLift], wEnd], [nOf('A-E'), UP, UP, nOf('A-W')]);
    const yOut = A.footprint.y0 - A.roof.overhang.gables - 0.13, yWall = A.footprint.y0 - 0.07;
    const z0 = wEnd[2];
    path([wEnd, [xDrop, yOut, z0], [xDrop, yOut, z0 - 0.45], [xDrop, yWall, z0 - 0.45], [xDrop, yWall, 0.30], [xDrop, 49.95, 0.30], [xDrop, 49.95, 0.06]],
      [nOf('A-W'), [0, 1, 0], UP, [0, 1, 0], UP, [0, 1, 0]]);
  }
  // --- Block C: both walkways → north verge → down the west slope → over the eave → down the west wall → trench
  {
    const C = site.BUILDINGS.C, rz = C.roof.ridgeZ, rx = C.roof.ridgeX;
    const wEnd = pp('C-W', 0.13, vT('C-W')); const yV = wEnd[1];
    path([pp('C-W', P['C-W'].width - 0.35, vT('C-W')), wEnd], [nOf('C-W')]);
    const eEnd = pp('C-E', P['C-E'].width - 0.13, vT('C-E'));
    path([pp('C-E', 0.35, vT('C-E')), eEnd], [nOf('C-E')]);
    path([eEnd, [rx + 0.6, yV, zAt('C-E', rx + 0.6, yV) + trayLift], [rx, yV, rz + 0.17],
      [rx - 0.6, yV, zAt('C-W', rx - 0.6, yV) + trayLift], wEnd], [nOf('C-E'), UP, UP, nOf('C-W')]);
    const edge = pp('C-W', 0.13, -0.30);             // 0.30 m beyond the eave line (clears the gutter)
    const z0 = edge[2], xW = -0.08;
    path([wEnd, edge, [edge[0], yV, z0 - 0.45], [xW, yV, z0 - 0.45], [xW, yV, 0.30], [-1.1, yV, 0.30], [-1.1, yV, 0.06]],
      [nOf('C-W'), [1, 0, 0], UP, [1, 0, 0], UP, [1, 0, 0]]);
  }
  // --- Block D: walkway → west verge → down the west wall → trench
  {
    const wEnd = pp('D-S', 0.12, vT('D-S')); const yV = wEnd[1];
    path([pp('D-S', P['D-S'].width - 0.35, vT('D-S')), wEnd], [nOf('D-S')]);
    const edge = pp('D-S', -0.15, vT('D-S')); const z0 = edge[2], xW = -0.08;
    path([wEnd, edge, [edge[0], yV, z0 - 0.45], [xW, yV, z0 - 0.45], [xW, yV, 0.30], [-1.1, yV, 0.30], [-1.1, yV, 0.06]],
      [nOf('D-S'), [1, 0, 0], UP, [1, 0, 0], UP, [1, 0, 0]]);
    report.trenchStartY = yV;
  }
  for (const [a, b, up] of segs) {
    beam(gGalv, W(a), W(b), TRAY.w, TRAY.h, WD(up).normalize(), TRAY.w / 2, 1);
    report.traySegments++;
  }
  // tray support feet on the roof every ~1.2 m (small GI saddles under roof runs)
  for (const [a, b, up] of segs) {
    if (up === UP || up[2] < 0.9) continue;
    const A3 = W(a), B3 = W(b), n = WD(up).normalize(); const L = A3.distanceTo(B3); const cnt = Math.floor(L / 1.2);
    for (let i = 1; i <= cnt; i++) {
      const p = A3.clone().lerp(B3, i / (cnt + 1)).addScaledVector(n, -(TRAY.h / 2 + TRAY.roofLift / 2));
      const f = B3.clone().sub(A3).normalize(); const s = new THREE.Vector3().crossVectors(f, n);
      gGalv.obox(p, s.multiplyScalar(0.07), n.clone().multiplyScalar(TRAY.roofLift / 2), f.multiplyScalar(0.02));
    }
  }
  // wall stand-off brackets on vertical runs
  for (const [a, b, up] of segs) {
    if (Math.abs(a[2] - b[2]) < 1.0 || a[0] !== b[0] || a[1] !== b[1]) continue;
    const hor = WD(up).normalize();
    for (let z = Math.min(a[2], b[2]) + 0.4; z < Math.max(a[2], b[2]) - 0.2; z += 1.2) {
      const p = W([a[0], a[1], z]).addScaledVector(hor, 0.045);
      gGalv.obox(p, hor.clone().multiplyScalar(0.02), new THREE.Vector3(0, 0.012, 0), new THREE.Vector3().crossVectors(hor, new THREE.Vector3(0, 1, 0)).multiplyScalar(0.07));
    }
  }

  // ------------------------------------------------------------- cable trench (precast covers)
  const trenchY = 43.75;
  const aDropX = (() => { const e = pp('A-W', P['A-W'].width - 0.10, vT('A-W')); return e[0]; })();
  const trench = [
    [[-1.1, report.trenchStartY], [-1.1, trenchY]],
    [[-1.1, trenchY], [aDropX, trenchY]],
    [[aDropX, trenchY], [aDropX, 49.95]],
    [[14.25, trenchY], [14.25, 43.45]],
  ];
  for (const [a, b] of trench) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const n = Math.max(1, Math.round(L / TRENCH.slab)); const ux = dx / L, uy = dy / L;
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * L - (i === 0 ? TRENCH.w / 2 : 0), t1 = ((i + 1) / n) * L + (i === n - 1 ? TRENCH.w / 2 : 0);
      const c = [a[0] + ux * (t0 + t1) / 2, a[1] + uy * (t0 + t1) / 2, (TRENCH.top + TRENCH.bottom) / 2];
      const along = WD([ux, uy, 0]).multiplyScalar((t1 - t0) / 2 - 0.004);
      const side = WD([-uy, ux, 0]).multiplyScalar(TRENCH.w / 2);
      gConc.obox(W(c), side, new THREE.Vector3(0, (TRENCH.top - TRENCH.bottom) / 2, 0), along);
      // lifting-hook recesses (dark dots)
      if (Q !== 'low') {
        for (const s of [-0.12, 0.12]) {
          const pc = [c[0] + -uy * s, c[1] + ux * s, TRENCH.top + 0.001];
          gIron.obox(W(pc), side.clone().normalize().multiplyScalar(0.02), new THREE.Vector3(0, 0.001, 0), along.clone().normalize().multiplyScalar(0.012));
        }
      }
    }
  }

  // ------------------------------------------------------------- earthing pits
  const pits = [[11.55, 42.62], [11.55, 43.22], [16.95, 42.75], [29.3, 68.85], [-0.45, 30.62]];
  for (const [x, y] of pits) pit(x, y);
  function pit(x, y) {
    const s = 0.21, t = 0.05, h0 = -0.03, h1 = 0.085;
    const hy = new THREE.Vector3(0, (h1 - h0) / 2, 0), zc = (h0 + h1) / 2;
    gConc.obox(W([x, y + s - t / 2, zc]), new THREE.Vector3(s, 0, 0), hy, new THREE.Vector3(0, 0, t / 2));
    gConc.obox(W([x, y - s + t / 2, zc]), new THREE.Vector3(s, 0, 0), hy, new THREE.Vector3(0, 0, t / 2));
    gConc.obox(W([x + s - t / 2, y, zc]), new THREE.Vector3(t / 2, 0, 0), hy, new THREE.Vector3(0, 0, s - t));
    gConc.obox(W([x - s + t / 2, y, zc]), new THREE.Vector3(t / 2, 0, 0), hy, new THREE.Vector3(0, 0, s - t));
    // cast-iron lid with chequer ribs + lifting handle
    gIron.obox(W([x, y, h1 - 0.012]), new THREE.Vector3(s - t, 0, 0), new THREE.Vector3(0, 0.008, 0), new THREE.Vector3(0, 0, s - t));
    for (let k = -2; k <= 2; k++) gIron.obox(W([x + k * 0.05, y, h1 - 0.002]), new THREE.Vector3(0.006, 0, 0), new THREE.Vector3(0, 0.003, 0), new THREE.Vector3(0, 0, s - t - 0.02));
    rod(gIron, W([x - 0.04, y + 0.1, h1 + 0.002]), W([x + 0.04, y + 0.1, h1 + 0.002]), 0.005, 5);
  }

  // ------------------------------------------------------------- ESE lightning arresters
  const masts = [];
  {
    const A = site.BUILDINGS.A, C = site.BUILDINGS.C;
    masts.push({ x: A.roof.ridgeX, y: 59.3, rz: A.roof.ridgeZ, west: 'A-W', east: 'A-E',
      // down conductor: along the west slope near the ridge to the north gable, down the north wall to pit
      route: (foot) => [foot, [foot[0], A.footprint.y1 + A.roof.overhang.gables + 0.10, null], 'drop',
        [foot[0], A.footprint.y1 + 0.03, 'wall'], [29.3, 68.85, 'pit']] });
    masts.push({ x: C.roof.ridgeX, y: 21.8, rz: C.roof.ridgeZ, west: 'C-W', east: 'C-E',
      route: (foot) => [foot, [foot[0], 30.98, null], [-1.12, 30.98, null], 'drop', [-0.03, 30.98, 'wall'], [-0.45, 30.62, 'pit']] });
  }
  const gStrip = gGalv;
  for (const m of masts) {
    const top = m.rz + 3.5;
    const baseZ = m.rz + 0.20, collarZ = m.rz + 0.75;
    // mast: two telescopic GI sections
    rod(gGalv, W([m.x, m.y, baseZ]), W([m.x, m.y, m.rz + 2.2]), 0.030, 10);
    rod(gGalv, W([m.x, m.y, m.rz + 2.2]), W([m.x, m.y, top]), 0.022, 10);
    rod(gGalv, W([m.x, m.y, m.rz + 2.15]), W([m.x, m.y, m.rz + 2.3]), 0.036, 10);  // coupler
    rod(gGalv, W([m.x, m.y, collarZ - 0.06]), W([m.x, m.y, collarZ + 0.06]), 0.040, 10); // leg collar
    // four splayed legs to foot plates on the sheet crests either side of the ridge
    const feet = [];
    for (const [dx, dy] of [[-0.55, -0.45], [-0.55, 0.45], [0.55, -0.45], [0.55, 0.45]]) {
      const pid = dx < 0 ? m.west : m.east; const fx = m.x + dx, fy = m.y + dy;
      const fz = site.planeZAt(P[pid], fx, fy);
      const nW = WD(P[pid].n);
      gGalv.obox(W([fx, fy, fz]).addScaledVector(nW, 0.004), new THREE.Vector3(0.05, 0, 0), nW.clone().multiplyScalar(0.004), new THREE.Vector3(0, 0, 0.05));
      rod(gGalv, W([fx, fy, fz + 0.01]), W([m.x + dx * 0.06, m.y + dy * 0.06, collarZ]), 0.012, 6);
      feet.push([fx, fy, fz]);
    }
    // ESE head: stainless body with ionising fins + finial
    const h0 = top;
    rod(gSS, W([m.x, m.y, h0]), W([m.x, m.y, h0 + 0.05]), 0.028, 12);
    rod(gSS, W([m.x, m.y, h0 + 0.05]), W([m.x, m.y, h0 + 0.24]), 0.045, 14);
    for (let k = 0; k < 3; k++) rod(gSS, W([m.x, m.y, h0 + 0.08 + k * 0.05]), W([m.x, m.y, h0 + 0.095 + k * 0.05]), 0.062, 14);
    rod(gSS, W([m.x, m.y, h0 + 0.24]), W([m.x, m.y, h0 + 0.42]), 0.008, 8);
    gSS.add(new THREE.SphereGeometry(0.014, 10, 6), new THREE.Matrix4().makeTranslation(...W([m.x, m.y, h0 + 0.425]).toArray()));
    // down conductor (25 × 3 GI strip) from the mast base to the west-side foot, then along the route
    const foot = feet[1]; // west, north
    const strip = (a, b, up) => beam(gStrip, W(a), W(b), 0.025, 0.004, up, 0.006);
    strip([m.x, m.y, baseZ + 0.3], [m.x - 0.05, m.y + 0.03, m.rz + 0.12], new THREE.Vector3(1, 0, 0));
    strip([m.x - 0.05, m.y + 0.03, m.rz + 0.12], [foot[0], foot[1], foot[2] + 0.04], WD(P[m.west].n));
    const route = m.route([foot[0], foot[1], null]);
    let cur = [foot[0], foot[1], foot[2] + 0.04];

    for (let i = 1; i < route.length; i++) {
      const r = route[i];
      if (r === 'drop') { const down = [cur[0], cur[1], cur[2] - 0.40]; strip(cur, down, new THREE.Vector3(0, 0, 1)); cur = down; continue; }
      if (r[2] === null) {
        // on the roof (west plane), 40 mm holders every 1 m
        const pid = m.west; const pl = P[pid];
        const inside = site.planeLocal(pl, [r[0], r[1], site.planeZAt(pl, r[0], r[1])]);
        const tgt = (inside.v < 0 || inside.u < 0 || inside.u > pl.width)
          ? [r[0], r[1], site.planeZAt(pl, Math.max(r[0], pl.eaveStart[0]), r[1]) + 0.04]
          : [r[0], r[1], site.planeZAt(pl, r[0], r[1]) + 0.04];
        strip(cur, tgt, WD(pl.n));
        const A3 = W(cur), B3 = W(tgt), L = A3.distanceTo(B3);
        for (let s = 0.5; s < L; s += 1.0) {
          const p = A3.clone().lerp(B3, s / L).addScaledVector(WD(pl.n), -0.02);
          gPl.obox(p, new THREE.Vector3(0.018, 0, 0), WD(pl.n).multiplyScalar(0.02), new THREE.Vector3(0, 0, 0.018));
        }
        cur = tgt;
      } else if (r[2] === 'wall') {
        const p = [r[0], r[1], cur[2]]; strip(cur, p, new THREE.Vector3(0, 1, 0));
        const g = [r[0], r[1], 0.05]; strip(p, g, WD([cur[0] === r[0] ? 0 : 1, cur[0] === r[0] ? 1 : 0, 0]));
        cur = g;
      } else if (r[2] === 'pit') {
        strip(cur, [r[0], r[1], 0.07], new THREE.Vector3(0, 1, 0)); cur = [r[0], r[1], 0.07];
      }
    }
  }

  // ------------------------------------------------------------- meshes
  const mk = (gb, mat, name, shadow = true, occl = false) => {
    if (!gb.triCount) return null;
    const mesh = new THREE.Mesh(gb.build(), mat); mesh.name = name;
    mesh.castShadow = shadow; mesh.receiveShadow = true; group.add(mesh);
    if (occl && ctx.registerOccluder) ctx.registerOccluder(mesh);
    return mesh;
  };
  mk(gGalv, galvMat, 'bos-gi', true, true);   // trays + LA masts (mast shadows matter for the shading study)
  mk(gGrat, gratMat, 'bos-walkway-grating');
  mk(gConc, concMat, 'bos-concrete', false);
  mk(gIron, ironMat, 'bos-iron', false);
  mk(gSS, ssMat, 'bos-ese-head', true, true);
  mk(gPl, plasticMat, 'bos-holders', false);
  return { group, report, segs };
}
