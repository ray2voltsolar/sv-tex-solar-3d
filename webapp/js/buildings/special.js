// ============================================================================
//  BUILDINGS — offices (RCC flat roof, parapet, coping, chajjas, water tank)
//  and the open "basic roof" lean-to on steel pipe columns.
// ============================================================================
import { frame, fpt, box, cylinder, tube, pipePath, planeFrame, makePlane, pZ, rng } from './lib.js';
import { buildWall, buildPlinth } from './walls.js';
import { buildRoofPlane, buildGutter } from './roofs.js';
import { paintSlab, paintFloorDecal } from './textures.js';

const PLAN = (o) => frame(o, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
/** Top of the office parapet coping (local override of site-data parapetTopZ 3.65). */
export const officeParapetTop = (b) => Math.min(b.roof.parapetTopZ, b.roof.slabTopZ + 0.15);

export function buildOffices(K, Bd, b) {
  const f = b.footprint, t = 0.23;
  // low 150 mm parapet upstand (WA0007: the offices read as a low flat-roofed strip, Block B's blue roof rises behind)
  const mTop = officeParapetTop(b) - 0.06, slab = b.roof.slabTopZ;
  const room = Object.fromEntries(b.rooms.map((r) => [r.id, r]));
  buildPlinth(K, Bd, { x0: f.x0, y0: f.y0 + 0.08, x1: f.x1, y1: f.y1 }, b.plinth, '#8f8b84', { seed: 61 });
  const base = { mTop, t, topDrip: true, dirt: 1.1, dripK: 0.4 };
  const fin = (r) => ({ bucket: r.finish === 'hollow-concrete-block' ? 'block' : 'masonry', color: r.finish === 'hollow-concrete-block' ? '#ffffff' : r.color });
  const N0 = [f.x1, f.y1], N1 = [f.x0, f.y1];
  const sN = (x) => f.x1 - x;
  const ch = 0.45;
  // North facade, one run per room (different finishes)
  const R1 = room.OFF1, R2 = room.OFF2, RB = room.BATH;
  buildWall(K, Bd, { ...base, p0: N0, p1: N1, s0: sN(R1.x1), s1: sN(R1.x0), masonry: fin(R1), seed: 71, cornerStart: false,
    spouts: [13.6], openings: [{ kind: 'door', at: 11.2, w: 1.0, z0: b.plinth, h: 2.1, color: '#5b4636', leafColor: '#6b4f3a', chajja: ch }] });
  buildWall(K, Bd, { ...base, p0: N0, p1: N1, s0: sN(R2.x1), s1: sN(R2.x0), masonry: fin(R2), seed: 72, dirt: 0.8,
    spouts: [8.0], openings: [
      { kind: 'window', at: 7.0, w: 1.2, z0: 1.05, h: 1.2, style: 'glass', color: '#4c5a66', chajja: ch },
      { kind: 'door', at: 9.4, w: 0.9, z0: b.plinth, h: 2.1, color: '#4c5a66', leafColor: '#7d8a92', chajja: ch }] });
  buildWall(K, Bd, { ...base, p0: N0, p1: N1, s0: sN(RB.x1), s1: sN(RB.x0), masonry: fin(RB), seed: 73,
    spouts: [2.9], pipes: [0.6], openings: [
      { kind: 'door', at: 1.7, w: 0.8, z0: b.plinth, h: 2.1, color: '#7f99a8', leafColor: '#9bb0bb', chajja: ch },
      { kind: 'vent', at: 3.4, w: 0.6, z0: 2.0, h: 0.45, style: 'glass', color: '#7f99a8' }] });
  // East wall (Office 1, faces the passage under the basic roof)
  buildWall(K, Bd, { ...base, p0: [f.x1, f.y0], p1: [f.x1, f.y1], s0: 0, s1: f.y1 - f.y0 - t, masonry: fin(R1), seed: 74,
    openings: [
      { kind: 'window', at: 39.2, w: 1.2, z0: 1.0, h: 1.2, style: 'glass', color: '#4c5a66' },
      { kind: 'door', at: 41.1, w: 0.9, z0: b.plinth, h: 2.1, color: '#5b4636', leafColor: '#6b4f3a' }] });
  // West wall (Bathrooms)
  buildWall(K, Bd, { ...base, p0: [f.x0, f.y1], p1: [f.x0, f.y0], s0: t, s1: f.y1 - f.y0, masonry: fin(RB), seed: 75, north: true,
    openings: [{ kind: 'vent', at: 39.6, w: 0.6, z0: 2.0, h: 0.45, style: 'glass', color: '#7f99a8' }] });

  const mb = Bd.md('masonry');
  // RCC slab (top visible from above, grimy)
  const sw = f.x1 - f.x0 - 2 * t, sd = f.y1 - f.y0 - t;
  const srect = K.wallAtlas.request(sw, sd, paintSlab({ seed: 9, spouts: [2.9, 8.0, 13.6].map((x) => x - f.x0 - t) }));
  box(mb, PLAN([f.x0 + t, f.y0, slab - 0.15]), 0, sw, 0, sd, 0, 0.15, K.col('#b9b5ab'), { rect: srect, gfn: (x, y) => [x / sw, y / sd] });
  // slab drip band on the facades
  const band = K.col('#e6e3da');
  box(mb, PLAN([f.x0 - 0.03, f.y1, slab - 0.22]), 0, f.x1 - f.x0 + 0.06, 0, 0.03, 0, 0.2, band);
  box(mb, PLAN([f.x1, f.y0, slab - 0.22]), 0, 0.03, 0, f.y1 - f.y0, 0, 0.2, band);
  box(mb, PLAN([f.x0 - 0.03, f.y0, slab - 0.22]), 0, 0.03, 0, f.y1 - f.y0, 0, 0.2, band);
  // coping
  const cp = K.col('#cdc9bf');
  box(mb, PLAN([f.x0 - 0.03, f.y1 - t - 0.03, mTop]), 0, f.x1 - f.x0 + 0.06, 0, t + 0.06, 0, 0.06, cp);
  box(mb, PLAN([f.x1 - t - 0.03, f.y0, mTop]), 0, t + 0.06, 0, f.y1 - f.y0 - t - 0.03, 0, 0.06, cp);
  box(mb, PLAN([f.x0 - 0.03, f.y0, mTop]), 0, t + 0.06, 0, f.y1 - f.y0 - t - 0.03, 0, 0.06, cp);
  // PVC rain spouts through the north parapet
  const pm = Bd.md('plastic'), pvc = K.col('#a7aaa6');
  for (const x of [2.9, 8.0, 13.6]) tube(pm, [x, f.y1 - 0.12, slab + 0.05], [x, f.y1 + 0.28, slab + 0.02], 0.038, 8, pvc);
  // black 1000 L water tank on the bathroom roof
  const tx = (RB.x0 + RB.x1) / 2 - 0.2, ty = (f.y0 + f.y1) / 2 + 0.4;
  box(mb, PLAN([tx - 0.65, ty - 0.65, slab]), 0, 1.3, 0, 1.3, 0, 0.22, K.col('#a9a59c'));
  const blk = K.col('#1c1e1f'), blk2 = K.col('#242628');
  const Ft = PLAN([tx, ty, slab + 0.22]);
  const r = 0.54, h = 1.15;
  cylinder(pm, Ft, r - 0.03, 0, 0.06, 28, blk, { capTop: false });
  for (let z = 0.06, i = 0; z < h; z += 0.16, i++) {
    cylinder(pm, Ft, r, z, z + 0.1, 28, blk, { capTop: false, capBottom: false });
    cylinder(pm, Ft, r - 0.025, z + 0.1, Math.min(h, z + 0.16), 28, blk2, { capTop: false, capBottom: false });
  }
  cylinder(pm, Ft, r, h, h + 0.1, 28, blk, { r1: 0.25, capBottom: false, capTop: false });
  cylinder(pm, Ft, 0.25, h + 0.1, h + 0.17, 20, blk2, { r1: 0.23 });
  // outlet pipe: tank → over the parapet → down the north wall
  const yN = f.y1 + 0.09;
  pipePath(pm, [[tx + 0.3, ty + 0.45, slab + 0.3], [tx + 0.3, f.y1 - 0.05, slab + 0.3], [tx + 0.3, yN, slab + 0.3], [tx + 0.3, yN, 0.35], [tx + 0.3, yN + 0.25, 0.32]], 0.022, 8, K.col('#e8e6df'), K.col('#d7d4cc'));
  pipePath(pm, [[tx - 0.3, ty, slab + h + 0.12], [tx - 0.3, ty, slab + h + 0.45], [tx - 0.6, ty, slab + h + 0.55]], 0.018, 8, K.col('#e8e6df'));
}

export function buildBasicRoof(K, Bd, b, others) {
  const r = b.roof, f = b.footprint;
  const pl = makePlane({ id: 'BASIC', eaveStart: [r.eastEdgeX, f.y0, r.lowEdgeZ], eaveEnd: [r.eastEdgeX, f.y1, r.lowEdgeZ], highStart: [f.x0, f.y0, r.highEdgeZ] });
  const burner = K.site.FEATURES.burner;
  buildRoofPlane(K, Bd, pl, {
    bucket: 'roofMetal', color: '#a8ae9f', vary: 0.06, replaced: 0.08, replacedColor: '#bfc4b8', rusty: 0.15, seed: 404,
    underColor: '#7f888f', trimBucket: 'galv', trimColor: '#b0b4ac', purlinColor: '#6a6f73',
    edges: { s0: 'verge', s1: 'verge', high: 'apron:-0.065' },
    grime: { dirt: 1.6, dust: 1.1, rust: 0.4, moss: 0.6, soot: { u: burner.y - f.y0, v: (r.eastEdgeX - burner.x) / Math.cos(Math.atan(0.1)), r: 1.6 } },
  });
  // gutter on the low (east) edge, downpipes along the columns
  const c = b.columns;
  const colsY = [];
  for (let y = f.y0 + 0.2; y < f.y1 - 0.3; y += c.everyY) colsY.push(y);
  colsY.push(f.y1 - 0.15);
  buildGutter(K, Bd, pl, { s0: 0, s1: pl.width, bucket: 'galv', color: '#aeb2aa',
    downs: [colsY[1], colsY[4], colsY[7]].filter(Boolean).map((y) => ({ s: y - f.y0 + 0.16, wallOff: r.eastEdgeX - c.x, endZ: 0 })) });
  // steel structure (painted, sooty)
  const tb = Bd.md('trim'), mb = Bd.md('masonry');
  const st = K.col('#4a4d4f'), pc = K.col('#5a5c5c');
  const F = planeFrame(pl);
  const hU = -0.034;
  const zUnder = (x, y) => pZ(pl, x, y) + hU / Math.cos(Math.atan(0.1));
  for (const y of colsY) {
    const zt = zUnder(c.x, y) - 0.15 - 0.12;
    const Fc = PLAN([c.x, y, 0]);
    cylinder(tb, Fc, c.dia / 2, 0.15, zt, 12, pc);
    box(tb, Fc, -0.13, 0.13, -0.13, 0.13, 0.15, 0.165, st);
    box(mb, Fc, -0.19, 0.19, -0.19, 0.19, -0.03, 0.15, K.col('#a19d95'));
    // cap plate + rafter
    box(tb, Fc, -0.08, 0.08, -0.08, 0.08, zt, zt + 0.012, st);
    const s = y - f.y0;
    box(tb, F, s - 0.035, s + 0.035, (r.eastEdgeX - c.x) - 0.12, pl.length - 0.03, hU - 0.15 - 0.12, hU - 0.15, st);
  }
  // eave beam on the columns
  const zb = zUnder(c.x, f.y0) - 0.15;
  box(tb, PLAN([c.x, f.y0 + 0.05, 0]), -0.04, 0.04, 0, f.y1 - f.y0 - 0.1, zb - 0.12 - 0.012, zb - 0.012, st);
  // wall plate along C / B east walls, posts on the office parapet
  const zw = zUnder(f.x0 + 0.08, f.y0) - 0.15;
  const yOff = K.site.BUILDINGS.OFFICES.footprint.y0;
  box(tb, PLAN([f.x0 + 0.065, f.y0 + 0.1, 0]), 0, 0.07, 0, yOff - f.y0 - 0.1, zw - 0.14, zw - 0.012, st);
  box(tb, PLAN([f.x0 - 0.08, yOff, 0]), 0, 0.12, 0, f.y1 - yOff - 0.05, zw - 0.14, zw - 0.012, st);
  for (const y of [yOff + 0.6, f.y1 - 0.2]) cylinder(tb, PLAN([f.x0 - 0.12, y, 0]), 0.04, officeParapetTop(K.site.BUILDINGS.OFFICES), zw - 0.14, 10, pc);
  // low white masonry wall along the open east side (north part, as in WA0003)
  buildWall(K, Bd, { p0: [f.x1, 29.6], p1: [f.x1, f.y1 - 0.6], t: 0.2, mTop: 1.15, masonry: { bucket: 'masonry', color: '#ecebe5' }, seed: 88, dirt: 1.4, topDrip: true });
  box(mb, PLAN([f.x1 - 0.22, 29.6 - 0.02, 1.15]), 0, 0.24, 0, f.y1 - 0.6 - 29.6 + 0.04, 0, 0.05, K.col('#cfcbc2'));
  buildPassageClutter(K, Bd, b, colsY, zUnder);
  void others; void fpt;
  return { plane: pl };
}

/** Sagging cable between two points (plan coords), as a chain of thin tubes. */
function cable(md, a, b, sag, r, col, n = 10) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - sag * 4 * t * (1 - t)]);
  }
  for (let i = 0; i < n; i++) tube(md, pts[i], pts[i + 1], r, 5, col, { capTop: false, capBottom: false });
}

/**
 * WA0003 clutter under the lean-to: drooping cables & conduits, PVC pipe over the office,
 * pipes / hose along the low east wall, a coiled garden hose, blue HDPE drum at the office door,
 * dried garlands at the posts, and a wet / sooty floor decal. All merged into the building's
 * plastic / trim buckets (+1 decal mesh).
 */
function buildPassageClutter(K, Bd, b, colsY, zUnder) {
  const f = b.footprint, c = b.columns;
  const pm = Bd.md('plastic'), tb = Bd.md('trim');
  const rnd = rng(907);
  const blk = K.col('#1b1c1d'), grey = K.col('#5d6062'), wht = K.col('#d9d8d2'), pvc = K.col('#c9cac4');
  const zCol = (y) => zUnder(c.x, y) - 0.3;
  const xW = f.x0 + 0.2, zW = (y) => zUnder(xW, y) - 0.22;
  // cables draped along the column line (span to span)
  for (const [dx, sag, col, r] of [[-0.12, 0.22, blk, 0.007], [-0.2, 0.34, grey, 0.006], [-0.16, 0.5, blk, 0.009]]) {
    for (let i = 0; i < colsY.length - 1; i++) {
      const y0 = colsY[i], y1 = colsY[i + 1];
      cable(pm, [c.x + dx, y0, zCol(y0) - 0.02], [c.x + dx, y1, zCol(y1) - 0.02], sag * (0.7 + rnd() * 0.6), r, col, 8);
    }
  }
  // cables along the west wall plate (office end) and loose cross-runs to the columns
  for (const [dx, sag] of [[0.05, 0.28], [0.12, 0.45]]) {
    for (let y = f.y1 - 0.3; y > 24; y -= 4.5) cable(pm, [xW + dx, y, zW(y)], [xW + dx, y - 4.5, zW(y - 4.5)], sag * (0.7 + rnd() * 0.6), 0.007, blk, 8);
  }
  for (const y of [colsY[colsY.length - 2], colsY[6], colsY[4], colsY[2]].filter(Boolean)) {
    cable(pm, [xW + 0.05, y + 0.3, zW(y)], [c.x - 0.1, y + 0.05, zCol(y) - 0.02], 0.5 + rnd() * 0.4, 0.006, rnd() < 0.5 ? blk : wht, 12);
  }
  // grey PVC conduit clipped under the eave beam
  const yA = colsY[1], yB = colsY[colsY.length - 1];
  tube(pm, [c.x - 0.09, yA, zCol(yA) + 0.05], [c.x - 0.09, yB, zCol(yB) + 0.05], 0.016, 8, pvc);
  // thick white PVC pipe along the office top, then rising to the roof (WA0003 right)
  const yO = K.site.BUILDINGS.OFFICES.footprint.y0, zt = 3.25;
  pipePath(pm, [[f.x0 + 0.1, f.y1 + 0.2, zt], [f.x0 + 0.1, yO + 0.6, zt], [f.x0 + 0.9, yO + 0.2, zW(yO) - 0.05]], 0.055, 10, wht, K.col('#c4c3bd'));
  // pipes and a hose along the low east wall (north part)
  const xE = f.x1 - 0.32;
  tube(pm, [xE, 29.8, 0.95], [xE, f.y1 - 0.8, 0.95], 0.03, 8, grey);
  tube(pm, [xE + 0.05, 29.8, 0.82], [xE + 0.05, f.y1 - 0.8, 0.82], 0.022, 8, blk);
  for (let y = 31; y < f.y1 - 1; y += 2.2) box(tb, frame([xE + 0.15, y, 0.75], [1, 0, 0], [0, 1, 0], [0, 0, 1]), -0.02, 0.02, -0.02, 0.02, 0, 0.28, grey);
  // coiled green garden hose on the floor + a trailing length
  const hc = K.col('#2f7a4a'), hx = f.x1 - 0.9, hy = 33.2;
  let prev = null;
  for (let k = 0; k <= 64; k++) {
    const a = k / 64 * Math.PI * 2 * 3.2, rr = 0.32 + 0.025 * Math.sin(k * 0.7) + k * 0.0012;
    const p = [hx + Math.cos(a) * rr, hy + Math.sin(a) * rr, 0.035 + (k % 21) * 0.0018];
    if (prev) tube(pm, prev, p, 0.014, 6, hc, { capTop: false, capBottom: false });
    prev = p;
  }
  cable(pm, prev, [hx - 1.3, hy - 2.2, 0.03], -0.01, 0.014, hc, 6);
  cable(pm, [hx - 1.3, hy - 2.2, 0.03], [f.x1 - 0.3, hy - 3.6, 0.9], 0.3, 0.014, hc, 8);
  // blue HDPE drum by the office door
  const dx = f.x0 + 0.45, dy = yO + 2.9;
  const Fd = frame([dx, dy, 0.0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const bc = K.col('#1f66b8'), bc2 = K.col('#1a5aa3');
  cylinder(pm, Fd, 0.28, 0.0, 0.9, 20, bc);
  for (const z of [0.3, 0.6]) cylinder(pm, Fd, 0.292, z - 0.025, z + 0.025, 20, bc2, { capTop: false, capBottom: false });
  cylinder(pm, Fd, 0.295, 0.86, 0.92, 20, bc2);
  // dried garlands / hanging bundles at the posts
  const gc = K.col('#7a5a34');
  for (const y of [colsY[colsY.length - 1], colsY[colsY.length - 3], colsY[5]].filter(Boolean)) {
    const z0 = zCol(y) - 0.05;
    let p = [c.x - 0.07, y, z0];
    for (let k = 1; k <= 7; k++) { const q = [c.x - 0.07 + Math.sin(k) * 0.03, y + Math.cos(k * 1.3) * 0.03, z0 - k * 0.12]; tube(pm, p, q, 0.022 - k * 0.0015, 5, gc); p = q; }
  }
  // wet, sooty floor under the roof (dark transparent decal, low roughness where wet)
  const { THREE } = K;
  const W = f.x1 - f.x0 - 0.4, H = f.y1 - f.y0 - 0.4;
  const S = K.quality === 'low' ? 256 : 512;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S * 2;
  const burner = K.site.FEATURES.burner;
  paintFloorDecal(cv, { seed: 31, W, H, soot: { x: burner.x - f.x0 - 0.2, y: burner.y - f.y0 - 0.2 + 1.8, r: 1.6 } });
  const ctx2 = cv.getContext('2d'), im = ctx2.getImageData(0, 0, cv.width, cv.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const v = 255 - (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  ctx2.putImageData(im, 0, 0);
  const at = new THREE.CanvasTexture(cv); at.colorSpace = THREE.NoColorSpace; at.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ name: 'bld-floor-decal', color: 0x23262a, roughness: 0.3, metalness: 0, transparent: true, alphaMap: at,
    opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const geo = new THREE.PlaneGeometry(W, H); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(f.x0 + 0.2 + W / 2, 0.02, -(f.y0 + 0.2 + H / 2));
  mesh.name = 'BASIC_ROOF-floorDecal'; mesh.userData = { buildingId: 'BASIC_ROOF', bucket: 'decal' }; mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = 1;
  K.extraMeshes = K.extraMeshes || [];
  K.extraMeshes.push({ id: 'BASIC_ROOF', mesh });
}
