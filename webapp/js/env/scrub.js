// ============================================================================
//  SCRUB — shrubs, weed/grass tufts, red-soil heaps and rubble in the fields
//  (photos WA0010 / WA0011 / WA0005). All instanced; alpha-tested cards.
// ============================================================================
import { rng, makeCanvas, GeoBuilder, patchFoliage, distToPolyline, fbm } from './util.js';
import { classify, blockers, roadDist, HEAPS } from './layout.js';
import { leafClusterTexture, addCrown, foliageMaterials } from './trees.js';

const QS = { high: { tufts: 21000, shrubs: 400, tex: 512 }, medium: { tufts: 12000, shrubs: 180, tex: 256 }, low: { tufts: 3500, shrubs: 70, tex: 128 } };

// Tapered grass/weed blade atlas: green bases (never dark), dry straw tips,
// ragged top silhouette (blades of very different height), a few broadleaf weeds.
function grassTexture(THREE, S) {
  const c = makeCanvas(S, S); const g = c.getContext('2d'); const r = rng(5);
  const blades = [];
  for (let k = 0; k < 120; k++) {
    const h = S * (0.22 + Math.pow(r(), 0.8) * 0.74);
    blades.push({ x0: S * (0.08 + r() * 0.84), h, lean: (r() - 0.5) * S * 0.42, w: S * (0.008 + r() * 0.012), t: r(), dry: r() });
  }
  blades.sort((a, b) => b.h - a.h); // tall (back) first, short ones in front
  for (const b of blades) {
    const base = b.t < 0.6 ? [78 + r() * 20, 94 + r() * 18, 44 + r() * 12] : [108 + r() * 18, 106 + r() * 14, 58 + r() * 12];
    const tip = b.dry < 0.32 ? [170 + r() * 24, 152 + r() * 18, 98 + r() * 16] : [112 + r() * 22, 124 + r() * 20, 62 + r() * 12];
    const gr = g.createLinearGradient(0, S, 0, S - b.h);
    gr.addColorStop(0, `rgb(${base.map((v) => v * 0.9 | 0)})`);
    gr.addColorStop(0.5, `rgb(${base.map((v, i) => (v + tip[i]) / 2 | 0)})`);
    gr.addColorStop(1, `rgb(${tip.map((v) => v | 0)})`);
    g.fillStyle = gr;
    const tx = b.x0 + b.lean, ty = S - b.h;
    g.beginPath(); g.moveTo(b.x0 - b.w, S);
    g.quadraticCurveTo(b.x0 - b.w * 0.6 + b.lean * 0.25, S - b.h * 0.55, tx, ty);
    g.quadraticCurveTo(b.x0 + b.w * 0.6 + b.lean * 0.25, S - b.h * 0.55, b.x0 + b.w, S);
    g.closePath(); g.fill();
    // faint midrib highlight
    g.strokeStyle = 'rgba(220,225,170,0.18)'; g.lineWidth = Math.max(1, b.w * 0.35);
    g.beginPath(); g.moveTo(b.x0, S); g.quadraticCurveTo(b.x0 + b.lean * 0.25, S - b.h * 0.55, tx, ty); g.stroke();
  }
  // broadleaf weeds (parthenium / tridax-like) in the lower half
  for (let k = 0; k < 16; k++) {
    const x = S * (0.15 + r() * 0.7), y = S * (0.55 + r() * 0.4);
    const L = S * (0.035 + r() * 0.04);
    const col = [74 + r() * 30, 96 + r() * 26, 46 + r() * 14];
    g.save(); g.translate(x, y); g.rotate((r() - 0.5) * 2.2);
    g.fillStyle = `rgb(${col.map((v) => v | 0)})`;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.45, -L * 0.5, 0, -L * 1.2); g.quadraticCurveTo(-L * 0.45, -L * 0.5, 0, 0); g.fill();
    g.strokeStyle = `rgba(${col[0] + 50 | 0},${col[1] + 50 | 0},${col[2] + 30 | 0},0.45)`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L * 1.1); g.stroke();
    g.restore();
  }
  // tiny white/yellow flower heads (common in these fields)
  for (let k = 0; k < 14; k++) {
    g.fillStyle = r() < 0.6 ? 'rgba(236,234,214,0.95)' : 'rgba(222,196,80,0.95)';
    g.beginPath(); g.arc(S * (0.15 + r() * 0.7), S * (0.25 + r() * 0.5), S * (0.006 + r() * 0.006), 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// 4 crossed, bent cards (fan shaped: narrow base, wide top, bowed outward).
function tuftGeometry(THREE) {
  const gb = new GeoBuilder();
  const N = 4;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI + 0.2 * (k % 2);
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = -sa, pz = ca; // card normal direction (for the outward bow)
    const rows = [[0, 0.30, 0], [0.5, 0.48, 0.10], [1, 0.62, 0.16]]; // [v, halfWidth, bow]
    const ids = [];
    for (const [v, hw, bow] of rows) {
      const shade = 0.88 + v * 0.14;
      const n = [px * 0.35, 1, pz * 0.35];
      const s = [v * v, k * 1.3, v];
      for (const side of [-1, 1]) {
        const off = side * hw;
        const dir = k % 2 ? 1 : -1;
        ids.push(gb.vert([ca * off + px * bow * dir, v, sa * off + pz * bow * dir], n, [(side + 1) / 2, v], [shade, shade, shade], s));
      }
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const a0 = ids[i * 2], b0 = ids[i * 2 + 1], a1 = ids[i * 2 + 2], b1 = ids[i * 2 + 3];
      gb.quad(a0, b0, b1, a1);
    }
  }
  return gb.build(THREE, { color: true, sway: true });
}

function soilTexture(THREE) {
  const c = makeCanvas(128, 128); const g = c.getContext('2d'); const img = g.createImageData(128, 128); const r = rng(9);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const n = fbm(x / 16, y / 16, 4, 21, 8); const i = (y * 128 + x) * 4; const l = 0.68 + n * 0.6 + (r() - 0.5) * 0.3;
    img.data[i] = 255 * Math.min(1, l * 0.95); img.data[i + 1] = 255 * Math.min(1, l * 0.88); img.data[i + 2] = 255 * Math.min(1, l * 0.82); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  return t;
}

// Soft laterite spoil heap: gaussian dome with lumpy noise, edge flush with the ground.
function moundGeometry(THREE, seed) {
  const R = 18, A = 28; const r = rng(seed);
  const pos = [], idx = [], uv = [], col = [];
  const k = []; for (let i = 0; i < 6; i++) k.push(r() * 6.28);
  for (let i = 0; i <= R; i++) {
    const t = i / R;
    for (let j = 0; j <= A; j++) {
      const a = (j / A) * Math.PI * 2;
      const wob = 1 + 0.12 * Math.sin(a * 2 + k[0]) + 0.08 * Math.sin(a * 3 + k[1]) + 0.05 * Math.sin(a * 5 + k[2]);
      const rr = t * wob;
      // rounded tipped-load dome (flat-ish crown, steep-ish flanks, soft toe) + lumps of loose earth
      let h = Math.pow(Math.max(0, 1 - t * t), 1.35);
      h *= 1 + (0.16 * Math.sin(a * 4 + k[3] + t * 5) + 0.09 * Math.sin(a * 7 + k[4] + t * 3) + 0.05 * Math.sin(a * 11 + k[5])) * Math.sin(t * Math.PI);
      h += (fbm(Math.cos(a) * rr * 3 + seed, Math.sin(a) * rr * 3, 3, 40 + seed) - 0.5) * 0.12 * (1 - t * 0.6);
      h = Math.max(-0.06, h - 0.05 * t * t);                             // toe sinks below grade (no visible rim)
      pos.push(Math.cos(a) * rr, h, Math.sin(a) * rr);
      // dry pale crust on top, damp darker toe, clods of darker earth
      const clod = fbm(Math.cos(a) * rr * 7, Math.sin(a) * rr * 7, 2, 90 + seed);
      // crevices: darker where the lumpy surface dips below the smooth dome; grass-tinted / dark toe
      const base = Math.pow(Math.max(0, 1 - t * t), 1.35);
      const crev = Math.max(0, Math.min(1, (base - h) * 3.2));
      const speck = fbm(Math.cos(a) * rr * 19 + 7, Math.sin(a) * rr * 19, 1, 130 + seed);
      let lv = (0.66 + 0.32 * Math.max(0, h)) * (0.78 + clod * 0.4) * (1 - crev * 0.45) * (1 - 0.22 * t * t);
      if (speck > 0.68) lv *= 1.25;                                      // pale gravel/stone flecks
      const grass = t > 0.72 ? (t - 0.72) * 1.4 * fbm(Math.cos(a) * 5, Math.sin(a) * 5, 2, 150 + seed) : 0;
      col.push(lv * (1 - grass * 0.35), lv * (0.97 - 0.06 * t + grass * 0.25), lv * (0.98 - 0.08 * t - grass * 0.1));
      uv.push(Math.cos(a) * rr * 0.5 + 0.5, Math.sin(a) * rr * 0.5 + 0.5);
    }
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < A; j++) {
    const p0 = i * (A + 1) + j, p1 = p0 + 1, p2 = p0 + A + 1, p3 = p2 + 1;
    idx.push(p0, p2, p1, p1, p2, p3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function buildScrub(ctx, parent) {
  const { THREE, site } = ctx;
  const q = QS[ctx.quality] || QS.high;
  const r = rng(31337);
  const blk = blockers(site);
  const walls = site.FEATURES.compoundWalls.runs.map((w) => [w.from, w.to]);
  const wallDist = (x, y) => Math.min(...walls.map((w) => distToPolyline(x, y, w)));
  const A = site.BUILDINGS.A.footprint;
  const nearA = (x, y) => { const dx = Math.max(A.x0 - x, 0, x - A.x1), dy = Math.max(A.y0 - y, 0, y - A.y1); return Math.hypot(dx, dy); };

  // density field for scrub (0..1)
  const density = (x, y) => {
    const cl = classify(site, x, y, blk);
    if (cl !== 'field') return 0;
    const rd = roadDist(x, y);
    let d = 0.3;
    if (x > 40 && x < 64 && y > -2 && y < 92) d = 0.7;             // the photo fields east of the site
    if (x > 10 && x < 45 && y > 66 && y < 85) d = 0.6;               // behind Block A
    const wd = wallDist(x, y);
    if (wd < 3.5) d += 0.6 * (1 - wd / 3.5);             // bushes hugging the compound wall
    const da = nearA(x, y); if (da < 2.5) d += 0.5 * (1 - da / 2.5); // weeds at Block A's base
    if (rd < 2.0) d *= 0.35 + rd * 0.3;                    // trampled verges
    if (x > 44 && x < 64 && y > 18 && y < 36) d *= 0.55;   // parking patch in the field (WA0010)
    // far from the site → let the satellite + context trees speak
    if (x < -20 || x > 80 || y < -20 || y > 95) d *= 0.3;
    return Math.min(1, d);
  };
  // low-frequency clustering: lush weedy patches next to bare / dusty ground (WA0010, WA0011)
  const cluster = (x, y) => {
    const n = fbm(x / 11 + 3.1, y / 11 - 1.7, 3, 77) * 0.75 + fbm(x / 3.5, y / 3.5, 2, 78) * 0.25;
    return Math.min(1, Math.max(0, (n - 0.42) / 0.26));   // ≈35 % of the field reads as bare laterite / dust
  };
  // photo cameras (plan x, y): no single tuft may fill the frame right in front of the lens
  const CAMS = [[84, 25], [64, 35], [47, 45], [38.6, 46.5]];
  const camCap = (x, y) => { let m = 1; for (const [cx, cy] of CAMS) { const d = Math.hypot(x - cx, y - cy); if (d < 7) m = Math.min(m, 0.35 + 0.65 * d / 7); } return m; };

  // ---------------- grass / weed tufts ----------------
  const grassTex = grassTexture(THREE, q.tex);
  const tuftMats = foliageMaterials(THREE, grassTex, { roughness: 0.88, alphaTest: 0.35 });
  const tuftGeo = tuftGeometry(THREE);
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMats.mat, q.tufts);
  const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);
  let n = 0, guard = 0;
  while (n < q.tufts && guard++ < q.tufts * 12) {
    const x = -24 + r() * 106, y = -24 + r() * 122;
    const cl = cluster(x, y);
    let onHeap = false; for (const hp of HEAPS) if (Math.hypot(x - hp[0], y - hp[1]) < hp[2] * 1.45) { onHeap = true; break; }
    if (onHeap) continue;
    const d = density(x, y) * (0.12 + 0.88 * cl) * 1.25; if (r() > d) continue;
    // slight wind lean (prevailing SW monsoon wind → lean NE) + random tilt
    qn.setFromEuler(new THREE.Euler((r() - 0.5) * 0.22 - 0.06, r() * 6.28, (r() - 0.5) * 0.22 + 0.05, 'YXZ'));
    const hgt = (0.18 + Math.pow(r(), 2.2) * 0.62) * (0.7 + cl * 0.35) * camCap(x, y);
    const wid = hgt * (0.7 + r() * 0.9);
    sc.set(wid, hgt, wid * (0.8 + r() * 0.4)); ps.set(x, -0.03, -y);
    m4.compose(ps, qn, sc); tufts.setMatrixAt(n, m4);
    // green in the lush patches, drier/straw on the sparse fringes; low contrast
    // olive/khaki monsoon-wasteland tones: darker + less saturated, per-tuft hue jitter towards yellow-brown
    const dry = Math.min(1, r() * 0.7 + (1 - cl) * 0.55);
    const l = 0.72 + r() * 0.22;
    col.setRGB(l * (0.86 + dry * 0.3), l * (0.84 + dry * 0.1), l * (0.72 + dry * 0.02)); tufts.setColorAt(n, col);
    n++;
  }
  tufts.count = n; tufts.name = 'env-tufts';
  tufts.castShadow = false; tufts.receiveShadow = true; tufts.customDepthMaterial = tuftMats.depth;
  tufts.computeBoundingSphere();
  parent.add(tufts);

  // ---------------- shrubs ----------------
  const leafTex = leafClusterTexture(THREE, q.tex * 2, 19, 'light');
  const shrubMats = foliageMaterials(THREE, leafTex, { roughness: 0.82, alphaTest: 0.5 });
  const variants = 3; const per = Math.ceil(q.shrubs / variants);
  const shrubPts = [];
  guard = 0;
  while (shrubPts.length < q.shrubs && guard++ < q.shrubs * 60) {
    const x = -24 + r() * 106, y = -24 + r() * 122;
    const pf = x > 40 && x < 64 && y > -2 && y < 92 ? 1.6 : 1;
    const d = Math.min(1, density(x, y) * pf * (0.45 + 0.55 * cluster(x, y)) * (0.25 + 1.5 * Math.max(0, fbm(x / 9, y / 9, 3, 51) - 0.35))); if (r() > d * d) continue;
    // keep the photo-match sight lines readable: fewer tall shrubs right in front of the wall
    const photoField = x > 40 && x < 64 && y > -2 && y < 92;
    shrubPts.push([x, y, ((photoField ? 0.35 : 0.5) + r() * r() * (photoField ? 1.1 : 1.6)) * Math.max(0.55, camCap(x, y))]);
  }
  for (let v = 0; v < variants; v++) {
    const gb = new GeoBuilder();
    // low ragged weedy clump (WA0011): 3 uneven lumps, flattened, dusty olive tints — not a round ball
    const lr = rng(77 + v * 13);
    const lumps = [[0, 0.42, 0, 0.62, 0.40, 15, [1.04, 0.97, 0.86]], [0.45 + lr() * 0.2, 0.28, 0.25 - lr() * 0.5, 0.46, 0.30, 11, [1.10, 1.0, 0.80]],
      [-0.4 - lr() * 0.2, 0.22 + lr() * 0.12, -0.2 + lr() * 0.4, 0.40, 0.30, 9, [0.98, 0.95, 0.88]]];
    lumps.forEach(([lx, ly, lz, rx, ry, n, tint], k) => addCrown(gb, lx, ly, lz, rx, ry, n, 0.55 + k * 0.04, 900 + v * 7 + k * 31, v * 2.1 + k, 0.25, tint));
    const geo = gb.build(THREE, { color: true, sway: true });
    const pts = shrubPts.filter((_, i) => i % variants === v).slice(0, per);
    if (!pts.length) continue;
    const m = new THREE.InstancedMesh(geo, shrubMats.mat, pts.length);
    pts.forEach(([x, y, s], i) => {
      qn.setFromAxisAngle(Y, r() * 6.28);
      sc.set(s * (0.85 + r() * 0.5), s * (0.6 + r() * 0.45), s * (0.85 + r() * 0.5)); ps.set(x, -0.1, -y);
      m4.compose(ps, qn, sc); m.setMatrixAt(i, m4);
      const yl = r();
      const l = 0.78 + r() * 0.2;
      col.setRGB(l * (1.12 + yl * 0.3), l * (0.97 + yl * 0.08), l * (0.92 + yl * 0.1)); m.setColorAt(i, col);
    });
    m.customDepthMaterial = shrubMats.depth;
    m.castShadow = true; m.receiveShadow = true; m.name = 'env-shrubs'; m.computeBoundingSphere();
    parent.add(m);
  }

  // ---------------- red soil heaps + rubble (east field, WA0010) ----------------
  // orange laterite (WA0010 ≈ #b0704a), vertex-colour crust/toe variation, two shape variants
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x9a6c56, roughness: 1.0, map: soilTexture(THREE), vertexColors: true });
  const heaps = HEAPS;
  for (let v = 0; v < 2; v++) {
    const list = heaps.filter((_, i) => i % 2 === v);
    const heapMesh = new THREE.InstancedMesh(moundGeometry(THREE, 3 + v * 4), soilMat, list.length);
    list.forEach(([x, y, rad, h], i) => {
      const R2 = rad * 1.2, H2 = Math.max(h, rad * 0.42) * 1.15;          // height/radius ≈ 0.4: a real dome at eye height
      qn.setFromAxisAngle(Y, i * 1.7 + v); sc.set(R2, H2, R2 * (0.78 + (i % 3) * 0.1)); ps.set(x, 0, -y);
      m4.compose(ps, qn, sc); heapMesh.setMatrixAt(i, m4);
    });
    // low mounds: shading comes from their normals; casting into the 4k map produced thin peter-panned slivers
    heapMesh.castShadow = false; heapMesh.receiveShadow = true; heapMesh.name = 'env-soil-heaps';
    parent.add(heapMesh);
  }

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9d968a, roughness: 0.9 });
  const stoneGeo = new THREE.DodecahedronGeometry(0.12, 0);
  const nStones = 160;
  const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, nStones);
  let sN = 0;
  const piles = [[41.6, 22.0], [41.2, 35.0], [42.0, 8.0], [8.0, 75.0], [3.0, 70.0]];
  for (let k = 0; k < nStones; k++) {
    const p = piles[k % piles.length];
    const a = r() * 6.28, rr = Math.sqrt(r()) * 1.4;
    const x = p[0] + Math.cos(a) * rr, y = p[1] + Math.sin(a) * rr;
    if (classify(site, x, y, blk) !== 'field') continue;
    qn.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    const s = 0.6 + r() * 1.6; sc.set(s * (0.8 + r() * 0.6), s * (0.5 + r() * 0.4), s);
    ps.set(x, 0.03 * s, -y); m4.compose(ps, qn, sc); stones.setMatrixAt(sN, m4);
    const g0 = 0.85 + r() * 0.3; col.setRGB(g0, g0 * 0.97, g0 * 0.92); stones.setColorAt(sN, col); sN++;
  }
  stones.count = sN; stones.castShadow = true; stones.receiveShadow = true; stones.name = 'env-rubble';
  parent.add(stones);
  void patchFoliage;
  return { tufts };
}
