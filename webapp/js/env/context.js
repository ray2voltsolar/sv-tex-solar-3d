// ============================================================================
//  CONTEXT — muted massing of neighbouring low RCC houses/sheds (hand-traced
//  from the Esri imagery near the site + auto-detected roofs further out),
//  canopy points for instanced context trees, distant hill silhouettes.
// ============================================================================
import { rng, makeCanvas } from './util.js';
import { roadDist } from './layout.js';

// [cx, cy, w (E–W), d (N–S), height, roof] — plan coords, traced on the aligned imagery
const HOUSES = [
  [-23.5, -15.0, 10, 13, 3.4, 'rcc'], [7.8, -18.5, 15, 8, 3.2, 'sheet-blue'], [19.0, -31.5, 19, 11, 3.3, 'sheet-blue'],
  [-11.7, -29.0, 8, 8, 3.2, 'rcc'], [-37.5, -31.0, 7, 15, 3.4, 'rcc'], [-26.0, -36.0, 6, 6, 3.0, 'rcc'],
  [-11.0, 108.0, 7, 17, 3.3, 'rcc'], [-19.0, 90.0, 7, 9, 3.2, 'rcc'], [26.5, 112.0, 10, 20, 3.4, 'rcc'],
  [52.4, 103.0, 18, 15, 3.6, 'rcc'], [60.0, 119.0, 7, 12, 3.2, 'rcc'], [79.0, 95.0, 6, 11, 3.2, 'rcc'],
  [85.6, 151.0, 10, 38, 4.5, 'sheet-red'], [116.0, 160.0, 19, 18, 3.6, 'rcc'], [26.0, 142.0, 12, 26, 3.4, 'rcc'],
  // WA0011: white RCC house with a yellow Sintex tank NE of Block A (replaces the long grey shed)
  [56.0, 86.0, 9, 8, 3.4, 'rcc-white'],
];

const ROOF_COLORS = { rcc: [0x9f998d, 0x938d81, 0xaaa498, 0x878074, 0x8f8a7c], 'sheet-blue': [0x4f7296, 0x5d7c9c, 0x7a8a96], 'sheet-red': [0x8a5a48], 'sheet-grey': [0xa7aaa8] };
// village plaster palette: cream, pale yellow, light pink, light green, grey, off-white (muted by grime)
const WALL_COLORS = [0xd6ccb4, 0xd8c88e, 0xd4b4ac, 0xb4c4a4, 0xb0aea6, 0xdcd8cc, 0xc9bc9c, 0xc8d0b8, 0xd0c0b0];

export const SITE_CORE = { minX: -6, maxX: 74, minY: -10, maxY: 92 };

function insideRect(x, y, r, m = 0) { return x > r.minX - m && x < r.maxX + m && y > r.minY - m && y < r.maxY + m; }

function wallTexture(THREE) {
  // plaster: stains at the base, rain streaks, a dark door/window band
  const c = makeCanvas(256, 128); const g = c.getContext('2d'); const r = rng(3);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 128);
  for (let k = 0; k < 60; k++) {
    const x = r() * 256, w = 2 + r() * 8, h = 20 + r() * 80;
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(110,105,90,0.18)'); gr.addColorStop(1, 'rgba(110,105,90,0)');
    g.fillStyle = gr; g.fillRect(x, 0, w, h);
  }
  const gb = g.createLinearGradient(0, 128, 0, 96); gb.addColorStop(0, 'rgba(90,80,64,0.5)'); gb.addColorStop(1, 'rgba(90,80,64,0)');
  g.fillStyle = gb; g.fillRect(0, 96, 256, 32);
  // openings (one window / door rhythm per texture repeat ≈ 4 m)
  // window with grille + sunshade (chajja), door with frame
  g.fillStyle = 'rgba(40,44,50,0.9)'; g.fillRect(40, 44, 34, 30);
  g.strokeStyle = 'rgba(190,190,180,0.8)'; g.lineWidth = 1.5;
  for (let xx = 44; xx < 74; xx += 5) { g.beginPath(); g.moveTo(xx, 44); g.lineTo(xx, 74); g.stroke(); }
  g.beginPath(); g.moveTo(40, 59); g.lineTo(74, 59); g.stroke();
  g.fillStyle = 'rgba(70,66,58,0.45)'; g.fillRect(36, 40, 42, 4); g.fillRect(36, 44, 42, 5);
  g.fillStyle = r() < 0.5 ? 'rgba(92,60,40,0.92)' : 'rgba(60,84,110,0.92)'; g.fillRect(150, 36, 30, 78);
  g.strokeStyle = 'rgba(40,30,24,0.6)'; g.lineWidth = 2; g.strokeRect(151, 37, 28, 76); g.beginPath(); g.moveTo(165, 37); g.lineTo(165, 113); g.stroke();
  g.fillStyle = 'rgba(70,66,58,0.45)'; g.fillRect(146, 30, 38, 5);
  // second, smaller window
  g.fillStyle = 'rgba(40,44,50,0.9)'; g.fillRect(212, 48, 22, 24);
  for (let xx = 215; xx < 234; xx += 5) { g.strokeStyle = 'rgba(190,190,180,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(xx, 48); g.lineTo(xx, 72); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4;
  return t;
}

/** Append a house box (walls + roof slab + parapet + optional tank) to geometry arrays. */
function houseGeos(THREE, x, y, w, d, h, roof, r, wallsOut, roofsOut, tanksOut) {
  // walls: box with UVs scaled so the texture repeats every 4 m horizontally
  const wall = new THREE.BoxGeometry(w, h, d);
  const uv = wall.attributes.uv, nrm = wall.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), nz = Math.abs(nrm.getZ(i));
    const span = nx > 0.5 ? d : nz > 0.5 ? w : 0.01;
    uv.setX(i, uv.getX(i) * span / 4);
    if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, 0.0, 0.98); // tops: plain plaster
  }
  wall.translate(x, h / 2 - 0.05, -y);
  const white = roof === 'rcc-white'; if (white) roof = 'rcc';
  const wc = new THREE.Color(white ? 0xe4e2dc : WALL_COLORS[Math.floor(r() * WALL_COLORS.length)]);
  addColor(wall, wc);
  wallsOut.push(wall);
  const rc = new THREE.Color((ROOF_COLORS[roof] || ROOF_COLORS.rcc)[Math.floor(r() * (ROOF_COLORS[roof] || ROOF_COLORS.rcc).length)]);
  if (roof === 'rcc') {
    const slab = new THREE.BoxGeometry(w + 0.3, 0.15, d + 0.3); slab.translate(x, h + 0.02, -y); addColor(slab, rc); roofsOut.push(slab);
    // parapet ring
    for (const [px, pz, sx, sz] of [[x, -y - d / 2, w + 0.3, 0.15], [x, -y + d / 2, w + 0.3, 0.15], [x - w / 2, -y, 0.15, d + 0.3], [x + w / 2, -y, 0.15, d + 0.3]]) {
      const p = new THREE.BoxGeometry(sx, 0.6, sz); p.translate(px, h + 0.37, pz); addColor(p, wc.clone().multiplyScalar(0.97)); wallsOut.push(fixTopUV(p));
    }
    const hasStair = white || r() < 0.55;
    if (white || r() < 0.55) { // black or yellow Sintex water tank (on the stair head when there is one)
      const t = new THREE.CylinderGeometry(0.55, 0.6, 1.2, 14);
      const onStair = hasStair && r() < 0.6;
      if (onStair) t.translate(x - w / 2 + 1.6, h + 2.4 + 0.65, -y + d / 2 - 1.8);
      else t.translate(x + (r() - 0.5) * w * 0.5, h + 0.7, -y + (r() - 0.5) * d * 0.5);
      addColor(t, new THREE.Color(white || r() < 0.4 ? 0xd9a21c : 0x1c1d1f)); tanksOut.push(t);
      const lid = new THREE.CylinderGeometry(0.28, 0.4, 0.18, 12); lid.translate(t.boundingSphere ? 0 : 0, 0, 0);
      t.computeBoundingBox(); const bb = t.boundingBox; lid.translate((bb.min.x + bb.max.x) / 2, bb.max.y + 0.08, (bb.min.z + bb.max.z) / 2);
      addColor(lid, new THREE.Color(0x2a2a2a)); tanksOut.push(lid);
    }
    if (hasStair) { // stair headroom
      const sh = new THREE.BoxGeometry(2.4, 2.4, 3); sh.translate(x - w / 2 + 1.6, h + 1.2, -y + d / 2 - 1.8); addColor(sh, wc); wallsOut.push(fixTopUV(sh));
    }
  } else {
    // low-pitch sheet roof (gable along the long side)
    const long = d >= w; const span = long ? w : d, len = long ? d : w;
    const rise = span * 0.12;
    const shape = new THREE.Shape([new THREE.Vector2(-span / 2 - 0.3, 0), new THREE.Vector2(0, rise), new THREE.Vector2(span / 2 + 0.3, 0), new THREE.Vector2(span / 2 + 0.3, -0.06), new THREE.Vector2(0, rise - 0.06), new THREE.Vector2(-span / 2 - 0.3, -0.06)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: len + 0.4, bevelEnabled: false });
    g.translate(0, 0, -(len + 0.4) / 2);
    if (long) { /* ridge N–S: extrusion along Z already */ } else g.rotateY(Math.PI / 2);
    g.translate(x, h + 0.04, -y);
    addColor(g, rc); roofsOut.push(g);
  }
}
function fixTopUV(g) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.0, 0.98); return g; }
function addColor(g, c) {
  const n = g.attributes.position.count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new g.attributes.position.constructor(a, 3));
}

function mergeAll(THREE, geos) {
  // simple merge (all geometries are indexed or non-indexed → convert to non-indexed)
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    pos.set(p.attributes.position.array, o * 3);
    if (!p.attributes.normal) p.computeVertexNormals();
    nor.set(p.attributes.normal.array, o * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array, o * 2);
    if (p.attributes.color) col.set(p.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + c) * 3);
    o += c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

function hills(THREE, quality) {
  const r = rng(11);
  // [bearing deg, distance m, width m, height m]
  const defs = [[318, 2350, 900, 170], [300, 2250, 600, 110], [338, 2400, 700, 130], [270, 2400, 500, 70],
    [20, 2400, 800, 85], [60, 2420, 600, 60], [235, 2400, 700, 75], [160, 2420, 900, 55]];
  const geos = [];
  const seg = quality === 'low' ? 18 : 28;
  for (const [b, dist, w, h] of defs) {
    const g = new THREE.SphereGeometry(1, seg, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position; const s = r() * 100;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.22 * Math.sin(x * 5 + s) * Math.cos(z * 4 + s) + 0.12 * Math.sin(x * 13 + z * 9 + s);
      p.setXYZ(i, x * w * 0.5, Math.pow(y, 1.4) * h * n, z * w * 0.28);
    }
    g.computeVertexNormals();
    const a = b * Math.PI / 180;
    g.rotateY(-a);
    g.translate(20 + Math.sin(a) * dist, -2, -(34 + Math.cos(a) * dist));
    geos.push(g);
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f7a6c, roughness: 1, metalness: 0 });
  const m = new THREE.Mesh(mergeAll(THREE, geos), mat);
  m.name = 'env-hills'; m.castShadow = false; m.receiveShadow = false;
  return m;
}

// ---------------------------------------------------------------------------
export function buildContext(ctx, parent) {
  const { THREE } = ctx;
  const r = rng(808);
  const wallTex = wallTexture(THREE);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, vertexColors: true, roughness: 0.92 });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
  const tankMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  const houseRects = [];
  const meshes = [];

  function addHouses(list) {
    const walls = [], roofs = [], tanks = [];
    for (const [x, y, w, d, h, roof] of list) {
      houseGeos(THREE, x, y, w, d, h, roof, r, walls, roofs, tanks);
      houseRects.push({ minX: x - w / 2, maxX: x + w / 2, minY: y - d / 2, maxY: y + d / 2 });
    }
    for (const [geos, mat, name] of [[walls, wallMat, 'context-walls'], [roofs, roofMat, 'context-roofs'], [tanks, tankMat, 'context-tanks']]) {
      if (!geos.length) continue;
      const m = new THREE.Mesh(mergeAll(THREE, geos), mat);
      m.name = name; m.castShadow = true; m.receiveShadow = true;
      parent.add(m); ctx.registerOccluder(m); meshes.push(m);
    }
  }
  addHouses(HOUSES);
  // exposed (unplastered) brick compound wall NE of Block A (WA0011): dull brown-grey
  // weathered brick, 0.23×0.075 m bricks + 10 mm mortar, pillars, ragged top course, dirt at the base
  {
    const MW = 0.24, MH = 0.085, TW = MW * 8, TH = MH * 30;      // texture spans 1.92 m × 2.55 m
    const c = makeCanvas(512, 512); const g = c.getContext('2d'); const rb = rng(17);
    const sx = 512 / TW, sy = 512 / TH;
    g.fillStyle = '#8c877d'; g.fillRect(0, 0, 512, 512);                   // grey cement mortar
    for (let row = 0; row < 30; row++) for (let col = -1; col < 9; col++) {
      const x = (col * MW + (row % 2) * MW / 2) * sx, y = row * MH * sy;
      const t = rb(), s = rb();
      const R = 106 + t * 30 + (s > 0.85 ? 16 : 0), G = 90 + t * 22, B = 80 + t * 16 + (s < 0.12 ? 14 : 0);
      g.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
      g.fillRect(x + 0.01 * sx, y + 0.01 * sy, 0.23 * sx, 0.075 * sy);
      // pitting / speckle per brick
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(${rb() < 0.5 ? '60,50,44' : '170,160,148'},${0.15 + rb() * 0.2})`;
        g.fillRect(x + rb() * 0.22 * sx, y + 0.01 * sy + rb() * 0.065 * sy, 1 + rb() * 3, 1 + rb() * 2);
      }
    }
    // rain streaks from the top + rising damp / soil splash toward the base
    for (let k = 0; k < 40; k++) {
      const x = rb() * 512, w = 2 + rb() * 10, h = 60 + rb() * 220;
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(70,66,60,0.22)'); gr.addColorStop(1, 'rgba(70,66,60,0)');
      g.fillStyle = gr; g.fillRect(x, 0, w, h);
    }
    const gb = g.createLinearGradient(0, 512, 0, 512 - 0.7 * sy);
    gb.addColorStop(0, 'rgba(78,68,56,0.75)'); gb.addColorStop(0.4, 'rgba(84,74,62,0.35)'); gb.addColorStop(1, 'rgba(84,74,62,0)');
    g.fillStyle = gb; g.fillRect(0, 512 - 0.7 * sy, 512, 0.7 * sy);
    for (let k = 0; k < 50; k++) {                                         // blotchy damp patches near ground
      g.fillStyle = `rgba(66,58,48,${0.08 + rb() * 0.15})`;
      g.beginPath(); g.ellipse(rb() * 512, 512 - rb() * 0.5 * sy, 6 + rb() * 30, 4 + rb() * 14, 0, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8;
    const L = 9, Hh = 2.4, T = 0.23;
    const parts = [];
    // planar UVs from local position (x along wall, y up, z across) so bricks are true size on every piece
    function box(w, h, d, x, y, z) {
      const bg = new THREE.BoxGeometry(w, h, d); bg.translate(x, y, z);
      const p = bg.attributes.position, n = bg.attributes.normal, uv = bg.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
        const hor = ax > 0.5 ? p.getZ(i) : p.getX(i);
        const ver = ay > 0.5 ? p.getZ(i) * 3 + 0.4 : p.getY(i);
        uv.setXY(i, hor / TW, ver / TH);
      }
      parts.push(bg);
    }
    box(L, Hh, T, 0, Hh / 2 - 0.05, 0);                                    // main panel (9-inch wall)
    const nP = 4;
    for (let i = 0; i < nP; i++) {                                         // brick pillars every 3 m
      const x = -L / 2 + 0.2 + i * (L - 0.4) / (nP - 1), ph = Hh + 0.12 + rb() * 0.1;
      box(0.36, ph, 0.36, x, ph / 2 - 0.05, 0);
    }
    for (let x = -L / 2 + 0.3; x < L / 2 - 0.3;) {                          // ragged top: broken/stepped courses
      const w = 0.25 + rb() * 0.9, h = rb() < 0.35 ? 0 : MH * (1 + (rb() * 2 | 0));
      if (h > 0) box(Math.min(w, L / 2 - 0.3 - x), h, T, x + Math.min(w, L / 2 - 0.3 - x) / 2, Hh - 0.05 + h / 2, 0);
      x += w;
    }
    const wallGeo = mergeAll(THREE, parts);
    const wallM = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0 }));
    wallM.position.set(46.5, 0, -77.0); wallM.rotation.y = -0.18;
    wallM.castShadow = true; wallM.receiveShadow = true; wallM.name = 'context-brickwall';
    parent.add(wallM); ctx.registerOccluder(wallM);
  }
  parent.add(hills(THREE, ctx.quality));

  /**
   * Analyse the satellite mosaic: auto-detect roofs (bright, low-saturation or bluish compact blobs)
   * and canopy (dark green) outside the site core. Returns canopy tree points [[x,y,h,cr],...].
   */
  function fromSatellite(sat, { maxTrees = 450, radius = 320 } = {}) {
    let data;
    const cv = sat.canvas, L = sat.layout, b = L.bounds;
    try { data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; } catch (e) { return { trees: [], houses: 0 }; }
    const W = cv.width, H = cv.height;
    const px = (x, y) => {
      const u = (x - b.minX) / (b.maxX - b.minX), v = (b.maxY - y) / (b.maxY - b.minY);
      const i = (Math.min(H - 1, Math.max(0, Math.floor(v * H))) * W + Math.min(W - 1, Math.max(0, Math.floor(u * W)))) * 4;
      return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
    };
    const cx = 20, cy = 34;
    // ---- roofs on a 2 m grid ----
    const step = 2; const G = Math.ceil((radius * 2) / step);
    const roofCell = new Uint8Array(G * G);
    const inHouse = (x, y, m = 0) => houseRects.some((h) => insideRect(x, y, h, m));
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = cx - radius + (i + 0.5) * step, y = cy - radius + (j + 0.5) * step;
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      if (insideRect(x, y, SITE_CORE, 6) || inHouse(x, y, 3)) continue;
      const [R, Gc, B] = px(x, y);
      const mx = Math.max(R, Gc, B), mn = Math.min(R, Gc, B); const lum = 0.3 * R + 0.59 * Gc + 0.11 * B;
      const sat = mx ? (mx - mn) / mx : 0;
      const white = lum > 0.7 && sat < 0.16;
      const blue = B > R + 0.06 && B > Gc + 0.02 && lum > 0.4;
      if (white || blue) roofCell[j * G + i] = 1;
    }
    // connected components → rectangles
    const seen = new Uint8Array(G * G); const found = [];
    for (let s = 0; s < G * G; s++) {
      if (!roofCell[s] || seen[s]) continue;
      const stack = [s]; seen[s] = 1; let n = 0, i0 = 1e9, i1 = -1, j0 = 1e9, j1 = -1;
      while (stack.length) {
        const c = stack.pop(); n++; const i = c % G, j = (c / G) | 0;
        i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
          const q = jj * G + ii; if (roofCell[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      const w = (i1 - i0 + 1) * step, d = (j1 - j0 + 1) * step; const area = n * step * step;
      if (area < 24 || area > 420 || area / (w * d) < 0.55 || w > 32 || d > 32) continue;
      const x = cx - radius + (i0 + i1 + 1) / 2 * step, y = cy - radius + (j0 + j1 + 1) / 2 * step;
      if (roadDist(x, y) < Math.min(w, d) / 2 + 0.5) continue;
      const [R, , B] = px(x, y);
      found.push([x, y, Math.max(4, w - 0.6), Math.max(4, d - 0.6), 3.0 + r() * 0.8 + (area > 150 && r() < 0.3 ? 3.0 : 0), B > R + 0.05 ? 'sheet-blue' : 'rcc']);
    }
    addHouses(found);
    // hide the imagery's own roofs under (and beside) the 3D boxes so houses never appear twice
    try {
      const g2 = cv.getContext('2d');
      const sx = W / (b.maxX - b.minX), sy = H / (b.maxY - b.minY);
      g2.save(); g2.filter = `blur(${Math.max(1, Math.round(1.2 * sx))}px)`;
      for (const h of houseRects) {
        const m = 1.6;
        const cxp = ((h.minX + h.maxX) / 2 - b.minX) * sx, cyp = (b.maxY - (h.minY + h.maxY) / 2) * sy;
        const [R, Gc, B] = px(h.maxX + 4, (h.minY + h.maxY) / 2);
        const lum = 0.3 * R + 0.59 * Gc + 0.11 * B; const k2 = lum > 0.55 ? 0.55 / lum : 1; // never paint bright roof tone back
        g2.fillStyle = `rgba(${R * k2 * 230 | 0},${Gc * k2 * 225 | 0},${B * k2 * 210 | 0},0.92)`;
        g2.fillRect(cxp - ((h.maxX - h.minX) / 2 + m) * sx, cyp - ((h.maxY - h.minY) / 2 + m) * sy, ((h.maxX - h.minX) + 2 * m) * sx, ((h.maxY - h.minY) + 2 * m) * sy);
      }
      g2.restore();
    } catch (e) { /* tainted canvas: skip */ }
    // ---- canopy points ----
    const pts = []; const tstep = 6.5; const rr = rng(4242);
    for (let y = cy - radius; y < cy + radius; y += tstep) for (let x = cx - radius; x < cx + radius; x += tstep) {
      const jx = x + (rr() - 0.5) * tstep * 0.8, jy = y + (rr() - 0.5) * tstep * 0.8;
      if (Math.hypot(jx - cx, jy - cy) > radius) continue;
      if (insideRect(jx, jy, SITE_CORE, 2) || inHouse(jx, jy, 2.5) || roadDist(jx, jy) < 3) continue;
      const [R, Gc, B] = px(jx, jy); const lum = 0.3 * R + 0.59 * Gc + 0.11 * B;
      const canopy = Gc > R * 1.04 && Gc > B * 1.12 && lum < 0.42 && lum > 0.08;
      if (!canopy) continue;
      // darker = denser/taller canopy
      const h = 6.5 + (0.42 - lum) * 18 + rr() * 2.5;
      pts.push([jx, jy, Math.min(14, h), 3.0 + rr() * 2.2]);
    }
    // keep the nearest ones if over budget
    pts.sort((a, b2) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b2[0] - cx, b2[1] - cy));
    return { trees: pts.slice(0, maxTrees), houses: found.length };
  }

  return { fromSatellite, houseRects, meshes };
}
