// ============================================================================
//  GROUND — one big disc (r = 2.5 km), one draw call, custom-blended:
//    detail zone (SITE.detailBounds): painted canvas (yard concrete, laterite
//      lanes with tyre tracks & puddles, weedy fields) + macro roughness/wet mask
//    outside: Esri satellite mosaic (soft blend, never under the buildings)
//    beyond: procedural field colour fading into haze.
//  Fine detail: tiled micro albedo + normal map at real-world scale.
// ============================================================================
import { rng, fbm, makeCanvas, heightToNormal, pointInPoly } from './util.js';
import { ROADS, TRACKS, PUDDLES, WET_PATCHES, HEAPS } from './layout.js';

const Q = {
  high: { ppm: 22, maskPpm: 8, fieldPpm: 4, micro: 512 },
  medium: { ppm: 14, maskPpm: 6, fieldPpm: 3, micro: 512 },
  low: { ppm: 8, maskPpm: 4, fieldPpm: 2, micro: 256 },
};

// ---------------------------------------------------------------------------
// micro textures (tileable)
// ---------------------------------------------------------------------------
function microTextures(THREE, size, aniso) {
  const c = makeCanvas(size, size); const g = c.getContext('2d');
  const img = g.createImageData(size, size); const d = img.data;
  const hC = makeCanvas(size, size); const hg = hC.getContext('2d');
  const himg = hg.createImageData(size, size); const hd = himg.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const a = fbm(u * 16, v * 16, 4, 3, 16);      // fine grain
    const b = fbm(u * 6, v * 6, 4, 11, 6);         // medium mottling
    const cc = fbm(u * 3, v * 3, 3, 29, 3);        // large blotches
    const i = (y * size + x) * 4;
    d[i] = a * 255; d[i + 1] = b * 255; d[i + 2] = cc * 255; d[i + 3] = 255;
    const h = fbm(u * 24, v * 24, 3, 7, 24) * 0.6 + a * 0.4;
    hd[i] = hd[i + 1] = hd[i + 2] = h * 255; hd[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // pebbles / grit in the height map
  hg.putImageData(himg, 0, 0);
  const r = rng(77);
  for (let k = 0; k < size * 1.4; k++) {
    const x = r() * size, y = r() * size, rad = 0.6 + r() * r() * 3.2;
    const gr = hg.createRadialGradient(x, y, 0, x, y, rad);
    const l = r() < 0.5 ? 255 : 0;
    gr.addColorStop(0, `rgba(${l},${l},${l},0.55)`); gr.addColorStop(1, `rgba(${l},${l},${l},0)`);
    hg.fillStyle = gr;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      if (x + ox < -rad || x + ox > size + rad || y + oy < -rad || y + oy > size + rad) continue;
      hg.save(); hg.translate(ox, oy); hg.beginPath(); hg.arc(x, y, rad, 0, Math.PI * 2); hg.fill(); hg.restore();
    }
  }
  const micro = new THREE.CanvasTexture(c);
  micro.wrapS = micro.wrapT = THREE.RepeatWrapping; micro.anisotropy = aniso;
  micro.colorSpace = THREE.NoColorSpace;
  const nrm = new THREE.CanvasTexture(heightToNormal(hC, 2.2));
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping; nrm.anisotropy = aniso; nrm.colorSpace = THREE.NoColorSpace;
  return { micro, nrm };
}

// ---------------------------------------------------------------------------
// detail painter
// ---------------------------------------------------------------------------
function paintDetail(site, q) {
  const B = site.SITE.detailBounds;
  const Wm = B.maxX - B.minX, Hm = B.maxY - B.minY;
  const ppm = q.ppm;
  const W = Math.round(Wm * ppm), H = Math.round(Hm * ppm);
  const X = (x) => (x - B.minX) * ppm, Y = (y) => (B.maxY - y) * ppm;
  const r = rng(2026);
  const c = makeCanvas(W, H); const g = c.getContext('2d');

  // ---- 1. field base (per-pixel at low res, upscaled smoothly) ----
  const fp = q.fieldPpm; const fw = Math.round(Wm * fp), fh = Math.round(Hm * fp);
  const fc = makeCanvas(fw, fh); const fg = fc.getContext('2d');
  const fi = fg.createImageData(fw, fh); const fd = fi.data;
  const lerp = (a, b, t) => a + (b - a) * t;
  const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  for (let py = 0; py < fh; py++) for (let px = 0; px < fw; px++) {
    const x = B.minX + (px + 0.5) / fp, y = B.maxY - (py + 0.5) / fp;
    const n1 = fbm(x / 14, y / 14, 5, 5);
    const n2 = fbm(x / 4, y / 4, 4, 9);
    const n3 = fbm(x / 40, y / 40, 3, 13);
    // soil exposure: bare red earth in patches, more near roads
    let soil = sm(0.47, 0.68, n1 * 0.75 + n2 * 0.35 - 0.05);   // ≈35 % bare laterite / dust
    const dry = sm(0.35, 0.75, n3);
    // grass colours (sRGB 0..255)
    let gr = lerp(78, 122, dry), gg = lerp(96, 112, dry), gb = lerp(44, 62, dry);   // olive → khaki (WA0010 ≈ 104,109,69)
    const dark = sm(0.35, 0.65, n2);
    gr *= lerp(0.78, 1.06, dark); gg *= lerp(0.80, 1.05, dark); gb *= lerp(0.8, 1.0, dark);
    const sr = lerp(150, 128, n2), sg = lerp(102, 92, n2), sb = lerp(72, 66, n2);
    const R = lerp(gr, sr, soil), G = lerp(gg, sg, soil), Bc = lerp(gb, sb, soil);
    const i = (py * fw + px) * 4;
    fd[i] = R; fd[i + 1] = G; fd[i + 2] = Bc; fd[i + 3] = 255;
  }
  fg.putImageData(fi, 0, 0);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(fc, 0, 0, W, H);

  // weed clumps & dry grass speckle
  const nSpeck = Math.round(Wm * Hm * 0.6);
  for (let k = 0; k < nSpeck; k++) {
    const x = B.minX + r() * Wm, y = B.minY + r() * Hm;
    const cl = fbm(x / 11 + 3.1, y / 11 - 1.7, 3, 77);
    const rad = (0.08 + r() * 0.3) * ppm;
    const t = r() * 0.6 + cl * 0.5;
    g.fillStyle = t > 0.62 ? `rgba(${70 + r() * 24},${96 + r() * 24},${40 + r() * 12},0.28)`
      : t > 0.35 ? `rgba(${140 + r() * 24},${134 + r() * 16},${88 + r() * 16},0.22)`
      : `rgba(${138 + r() * 20},${102 + r() * 14},${74 + r() * 10},0.2)`;
    g.beginPath(); g.ellipse(X(x), Y(y), rad, rad * (0.5 + r() * 0.5), r() * 3.14, 0, Math.PI * 2); g.fill();
  }

  // red laterite spill around the spoil heaps (soft, no hard rim)
  for (const [x, y, rad] of HEAPS) {
    for (let k = 0; k < 10; k++) {
      const a = r() * 6.28, d = r() * rad * 0.6, R2 = rad * (1.1 + r() * 0.9) * ppm;
      const cx = X(x + Math.cos(a) * d), cy = Y(y + Math.sin(a) * d);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R2);
      gr.addColorStop(0, 'rgba(150,98,70,0.30)'); gr.addColorStop(0.6, 'rgba(146,104,76,0.14)'); gr.addColorStop(1, 'rgba(146,104,76,0)');
      g.fillStyle = gr; g.fillRect(cx - R2, cy - R2, R2 * 2, R2 * 2);
    }
  }

  // ---- 2. laterite roads ----
  const strokePath = (pts, wM, style, alpha = 1, jitter = 0) => {
    g.save(); g.globalAlpha = alpha; g.strokeStyle = style; g.lineWidth = wM * ppm;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => { const jx = jitter ? (r() - 0.5) * jitter : 0, jy = jitter ? (r() - 0.5) * jitter : 0; i ? g.lineTo(X(x + jx), Y(y + jy)) : g.moveTo(X(x + jx), Y(y + jy)); });
    g.stroke(); g.restore();
  };
  const densify = (pts, step = 2) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
    }
    out.push(pts[pts.length - 1]); return out;
  };
  for (const rd of ROADS) {
    const dp = densify(rd.pts, 1.5);
    // soft ragged verge: several jittered strokes
    for (let k = 0; k < 4; k++) strokePath(dp, rd.w + 1.6 - k * 0.4, `rgb(${148 - k * 4},${112 - k * 3},${84 - k * 2})`, 0.26, 0.9);
    strokePath(dp, rd.w, 'rgb(158,112,84)', 0.92, 0.35);
    strokePath(dp, rd.w * 0.7, 'rgb(168,122,92)', 0.4, 0.6);
  }
  // mottling on roads (compacted / loose patches, gravel)
  for (const rd of ROADS) {
    const dp = densify(rd.pts, 0.6);
    for (const [x, y] of dp) {
      for (let k = 0; k < 3; k++) {
        const ox = (r() - 0.5) * rd.w, oy = (r() - 0.5) * rd.w;
        const rad = (0.2 + r() * 0.8) * ppm; const l = r();
        g.fillStyle = l < 0.5 ? `rgba(120,80,56,${0.10 + r() * 0.12})` : `rgba(196,150,112,${0.08 + r() * 0.12})`;
        g.beginPath(); g.ellipse(X(x + ox), Y(y + oy), rad, rad * 0.6, r() * 3, 0, Math.PI * 2); g.fill();
      }
    }
  }
  // tyre tracks: two darker compacted bands, lighter grassy hump between
  const offsetLine = (pts, off) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    return [p[0] - ty * off, p[1] + tx * off];
  });
  for (const t of TRACKS) {
    const dp = densify(t.pts, 1.0);
    strokePath(dp, 0.9, 'rgb(150,112,78)', 0.35, 0.15); // centre hump, slightly lighter/greenish
    for (const s of [-1, 1]) {
      const ln = offsetLine(dp, s * t.half);
      strokePath(ln, 0.42, 'rgb(124,92,70)', 0.30, 0.12);
      strokePath(ln, 0.2, 'rgb(106,78,58)', 0.22, 0.08);
    }
  }
  // gravel + stone specks, darker compacted/damp rut patches, and a noisy grass fringe eating into the
  // road edge so the laterite never ends on a hard line (WA0010 / WA0011)
  for (const rd of ROADS) {
    const dp = densify(rd.pts, 0.35);
    for (let i = 1; i < dp.length; i++) {
      const [x, y] = dp[i], [px, py] = dp[i - 1];
      let tx = x - px, ty = y - py; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const nx = -ty, ny = tx;
      // gravel: 5-9 specks per step, light quartz / dark ironstone
      const nG = 5 + (r() * 5 | 0);
      for (let k = 0; k < nG; k++) {
        const o = (r() - 0.5) * rd.w * 0.95, a2 = r() * 0.35;
        const gx = x + nx * o + tx * a2, gy = y + ny * o + ty * a2;
        const rad = (0.012 + r() * r() * 0.05) * ppm;
        g.fillStyle = r() < 0.55 ? `rgba(${196 + r() * 40 | 0},${170 + r() * 30 | 0},${138 + r() * 30 | 0},0.85)` : `rgba(${70 + r() * 30 | 0},${48 + r() * 20 | 0},${36 + r() * 14 | 0},0.8)`;
        g.beginPath(); g.ellipse(X(gx), Y(gy), Math.max(0.6, rad), Math.max(0.5, rad * 0.7), r() * 3, 0, Math.PI * 2); g.fill();
      }
      // damp dark patches inside the wheel ruts (intermittent)
      const wet = fbm(x / 6, y / 6, 2, 404);
      if (wet > 0.58 && r() < 0.5) {
        for (const s2 of [-1, 1]) {
          const ox = x + nx * s2 * 0.85, oy = y + ny * s2 * 0.85;
          const R2 = (0.25 + r() * 0.35) * ppm;
          const gr = g.createRadialGradient(X(ox), Y(oy), 0, X(ox), Y(oy), R2);
          gr.addColorStop(0, `rgba(92,62,44,${0.18 + (wet - 0.58) * 0.8})`); gr.addColorStop(1, 'rgba(92,62,44,0)');
          g.fillStyle = gr; g.fillRect(X(ox) - R2, Y(oy) - R2, R2 * 2, R2 * 2);
        }
      }
      // ragged grass fringe: olive tufts that creep 0-0.9 m onto the road along both edges
      for (const s2 of [-1, 1]) {
        const en = fbm(x / 2.2 + s2 * 7, y / 2.2, 3, 505);
        const creep = Math.max(0, en - 0.35) * 2.0;
        const nT = 2 + (creep * 6 | 0);
        for (let k = 0; k < nT; k++) {
          const o = s2 * (rd.w / 2 - r() * creep * 0.9 + (r() - 0.3) * 0.3);
          const gx = x + nx * o + tx * r() * 0.35, gy = y + ny * o + ty * r() * 0.35;
          const rad = (0.06 + r() * 0.16) * ppm;
          g.fillStyle = `rgba(${84 + r() * 30 | 0},${92 + r() * 22 | 0},${48 + r() * 14 | 0},${0.35 + r() * 0.3})`;
          g.beginPath(); g.ellipse(X(gx), Y(gy), rad, rad * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2); g.fill();
        }
      }
    }
  }
  // tread marks: fine cross hatches inside track bands
  g.save(); g.strokeStyle = 'rgba(80,52,36,0.18)'; g.lineWidth = Math.max(1, 0.03 * ppm);
  for (const t of TRACKS) {
    const dp = densify(t.pts, 0.25);
    for (const s of [-1, 1]) {
      const ln = offsetLine(dp, s * t.half);
      for (let i = 1; i < ln.length; i += 1) {
        const [x, y] = ln[i], [px, py] = ln[i - 1];
        let tx = x - px, ty = y - py; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        const nx = -ty * 0.16, ny = tx * 0.16;
        g.beginPath(); g.moveTo(X(x - nx), Y(y - ny)); g.lineTo(X(x + nx + tx * 0.06), Y(y + ny + ty * 0.06)); g.stroke();
      }
    }
  }
  g.restore();

  // ---- 3. concrete yard ----
  const yard = site.SITE.yardPolygon;
  const yardPath = () => { g.beginPath(); yard.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); };
  g.save(); yardPath(); g.clip();
  g.fillStyle = 'rgb(132,127,118)'; g.fillRect(0, 0, W, H);
  // large-scale tonal variation (dust, old repairs)
  for (let k = 0; k < 420; k++) {
    const x = -2 + r() * 47, y = -2 + r() * 53; const rad = (0.8 + r() * 3.5) * ppm;
    const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), rad);
    const l = r();
    const col = l < 0.4 ? '98,94,86' : l < 0.75 ? '160,154,142' : '128,110,90';
    gr.addColorStop(0, `rgba(${col},${0.12 + r() * 0.16})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(X(x) - rad, Y(y) - rad, rad * 2, rad * 2);
  }
  // panel joints (~3 m bays) + cracks
  g.lineWidth = Math.max(1, 0.016 * ppm);
  for (let x = -1.8; x < 44; x += 3.05) for (let y = -2; y < 51; y += 1.5) { if (r() < 0.12) continue; g.strokeStyle = `rgba(66,62,56,${0.18 + r() * 0.22})`; g.beginPath(); g.moveTo(X(x + (r() - 0.5) * 0.03), Y(y)); g.lineTo(X(x + (r() - 0.5) * 0.03), Y(y + 1.5)); g.stroke(); }
  for (let y = -1.6; y < 51; y += 3.05) for (let x = -2; x < 45; x += 1.5) { if (r() < 0.12) continue; g.strokeStyle = `rgba(66,62,56,${0.18 + r() * 0.22})`; g.beginPath(); g.moveTo(X(x), Y(y + (r() - 0.5) * 0.03)); g.lineTo(X(x + 1.5), Y(y + (r() - 0.5) * 0.03)); g.stroke(); }
  g.strokeStyle = 'rgba(60,56,50,0.5)';
  for (let k = 0; k < 140; k++) {
    let x = -1.8 + r() * 46, y = -1.6 + r() * 51; let a = r() * 6.28;
    g.lineWidth = Math.max(1, (0.006 + r() * 0.012) * ppm);
    g.beginPath(); g.moveTo(X(x), Y(y));
    const n = 4 + (r() * 14) | 0;
    for (let i = 0; i < n; i++) { a += (r() - 0.5) * 1.2; x += Math.cos(a) * 0.25; y += Math.sin(a) * 0.25; g.lineTo(X(x), Y(y)); }
    g.stroke();
  }
  // wet dark patches
  for (const [x, y, rr] of WET_PATCHES) {
    // organic wet stain: many small irregular blobs + a few drying rims
    for (let k = 0; k < 46; k++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * rr * 1.1;
      const bx = x + Math.cos(a) * d * 1.3, by = y + Math.sin(a) * d * 0.8;
      g.fillStyle = `rgba(${66 + r() * 12 | 0},${64 + r() * 10 | 0},${60 + r() * 8 | 0},${0.10 + r() * 0.12})`;
      g.save(); g.translate(X(bx), Y(by)); g.rotate(r() * 3); blob(g, 0, 0, (0.25 + r() * 0.7) * ppm, (0.15 + r() * 0.45) * ppm, r); g.fill(); g.restore();
    }
  }
  // dye stains near the dyeing shed / ETP (indigo, maroon, rust)
  const stain = (x, y, rad, col, a) => {
    const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), rad * ppm);
    gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.beginPath(); g.ellipse(X(x), Y(y), rad * ppm, rad * ppm * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2); g.fill();
  };
  for (let k = 0; k < 40; k++) stain(25 + r() * 15, -1 + r() * 30, 0.3 + r() * 1.2, r() < 0.5 ? '52,60,110' : '110,48,62', 0.12 + r() * 0.16);
  for (let k = 0; k < 30; k++) stain(24 + r() * 16, 26 + r() * 18, 0.3 + r() * 1.0, r() < 0.6 ? '86,96,80' : '60,70,104', 0.10 + r() * 0.14);
  for (let k = 0; k < 30; k++) stain(18 + r() * 24, 43 + r() * 6, 0.2 + r() * 0.6, '40,36,32', 0.18 + r() * 0.2); // oil drips on the lane
  for (let k = 0; k < 25; k++) stain(18 + r() * 6, 12 + r() * 30, 0.4 + r() * 1.0, '60,54,46', 0.15 + r() * 0.15); // soot/ash by the burner
  // grime along wall bases (perimeter)
  g.lineJoin = 'round';
  for (let k = 0; k < 3; k++) {
    g.strokeStyle = `rgba(70,74,58,${0.10 + k * 0.06})`; g.lineWidth = (0.9 - k * 0.28) * ppm;
    yardPath(); g.stroke();
  }
  // building plinth grime
  for (const b of Object.values(site.BUILDINGS)) {
    const f = b.footprint;
    g.strokeStyle = 'rgba(66,64,56,0.22)'; g.lineWidth = 0.5 * ppm;
    g.strokeRect(X(f.x0), Y(f.y1), (f.x1 - f.x0) * ppm, (f.y1 - f.y0) * ppm);
  }
  // drains: covered RCC channel with grating along the east wall and the lane's north edge
  const drain = (pts) => {
    const dp = densify(pts, 0.5);
    strokePath(dp, 0.46, 'rgb(118,114,106)', 1);
    strokePath(dp, 0.30, 'rgb(36,34,32)', 1);
    // grating bars
    g.strokeStyle = 'rgba(92,90,86,0.95)'; g.lineWidth = Math.max(1, 0.025 * ppm);
    const fine = densify(pts, 0.06);
    for (let i = 1; i < fine.length; i++) {
      const [x, y] = fine[i], [px, py] = fine[i - 1];
      let tx = x - px, ty = y - py; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const nx = -ty * 0.15, ny = tx * 0.15;
      g.beginPath(); g.moveTo(X(x - nx), Y(y - ny)); g.lineTo(X(x + nx), Y(y + ny)); g.stroke();
    }
    // slabs every 1.2 m
    g.strokeStyle = 'rgba(150,146,138,1)'; g.lineWidth = 0.08 * ppm;
    const sl = densify(pts, 1.2);
    for (let i = 1; i < sl.length; i++) {
      const [x, y] = sl[i], [px, py] = sl[i - 1];
      let tx = x - px, ty = y - py; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const nx = -ty * 0.2, ny = tx * 0.2;
      g.beginPath(); g.moveTo(X(x - nx), Y(y - ny)); g.lineTo(X(x + nx), Y(y + ny)); g.stroke();
    }
  };
  drain([[39.45, 0.2], [39.45, 43.2]]);
  drain([[18.0, 49.05], [39.4, 49.55]]);
  drain([[-1.25, 0.0], [-1.25, 42.6]]);
  g.restore();
  // yard edge: worn transition into dirt
  g.save(); g.strokeStyle = 'rgba(130,96,70,0.35)'; g.lineWidth = 0.3 * ppm; yardPath(); g.stroke(); g.restore();

  // ---- 4. puddles (drawn last; water colour darkens the soil) ----
  // wet, churned mud on the gate apron (WA0005 / WA0011): broad darkening, no discrete ellipses
  for (let k = 0; k < 160; k++) {
    const t = r(); const x = 40.5 + t * 22, y = 46.6 + (r() - 0.5) * 6.0 * (1 - t * 0.4);
    const R2 = (0.6 + r() * 1.6) * ppm;
    const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), R2);
    gr.addColorStop(0, `rgba(92,68,50,${0.10 + r() * 0.12 * (1 - t)})`); gr.addColorStop(1, 'rgba(92,68,50,0)');
    g.fillStyle = gr; g.fillRect(X(x) - R2, Y(y) - R2, R2 * 2, R2 * 2);
  }
  for (const [x, y, rx, ry, rot] of PUDDLES) {
    const blobs = puddleBlobs(x, y, rx, ry, rot);
    // soft damp halo
    for (const [bx, by, br] of blobs) {
      const R2 = (br + 0.55) * ppm;
      const gr = g.createRadialGradient(X(bx), Y(by), br * 0.4 * ppm, X(bx), Y(by), R2);
      gr.addColorStop(0, 'rgba(70,52,38,0.55)'); gr.addColorStop(1, 'rgba(70,52,38,0)');
      g.fillStyle = gr; g.fillRect(X(bx) - R2, Y(by) - R2, R2 * 2, R2 * 2);
    }
    // standing muddy water: warm mid-brown, semi-transparent with a soft 0.3 m feather (sky comes from the env map)
    for (const [bx, by, br] of blobs) {
      const R2 = (br + 0.15) * ppm;
      const gr = g.createRadialGradient(X(bx), Y(by), Math.max(0, br - 0.15) * ppm, X(bx), Y(by), R2);
      gr.addColorStop(0, 'rgba(66,50,36,0.6)'); gr.addColorStop(1, 'rgba(66,50,36,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(X(bx), Y(by), R2, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(62,46,34,0.45)'; g.beginPath(); g.arc(X(bx), Y(by), Math.max(0.05, br - 0.15) * ppm, 0, Math.PI * 2); g.fill();
    }
  }
  return { canvas: c, W, H };
}

/** Irregular puddle = union of overlapping discs along a wobbly axis (deterministic). */
function puddleBlobs(x, y, rx, ry, rot) {
  const r = rng(Math.round(x * 131 + y * 71));
  const out = []; const n = 5 + Math.round(rx * 4);
  const ca = Math.cos(rot), sa = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 2 - 1;
    const u = t * rx * 0.75 + (r() - 0.5) * rx * 0.25, v = (r() - 0.5) * ry * 0.9;
    const br = ry * (0.45 + r() * 0.5) * (1 - Math.abs(t) * 0.45);
    out.push([x + u * ca - v * sa, y + u * sa + v * ca, br]);
  }
  return out;
}

function blob(g, cx, cy, rx, ry, r) {
  const n = 14; g.beginPath();
  const k = []; for (let i = 0; i < n; i++) k.push(0.75 + r() * 0.4);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, s = k[i % n];
    const x = cx + Math.cos(a) * rx * s, y = cy + Math.sin(a) * ry * s;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
}

// ---------------------------------------------------------------------------
// mask: R = detail weight (1 inside, soft to 0 at the bounds), G = roughness, B = puddle (flat water)
// ---------------------------------------------------------------------------
function paintMask(site, q) {
  const B = site.SITE.detailBounds; const ppm = q.maskPpm;
  const Wm = B.maxX - B.minX, Hm = B.maxY - B.minY;
  const W = Math.round(Wm * ppm), H = Math.round(Hm * ppm);
  const X = (x) => (x - B.minX) * ppm, Y = (y) => (B.maxY - y) * ppm;
  const r = rng(99);
  const layer = () => { const c = makeCanvas(W, H); return [c, c.getContext('2d')]; };
  // R: detail weight
  const [cR, gR] = layer();
  gR.fillStyle = '#000'; gR.fillRect(0, 0, W, H);
  // fully detailed around the site + photo fields, soft hand-over (≈6 m sigma) to the imagery
  gR.filter = `blur(${Math.round(10 * ppm)}px)`;
  gR.fillStyle = '#fff'; gR.fillRect(X(-20), Y(94), 98 * ppm, 112 * ppm);
  gR.filter = 'none';
  // G: roughness (0..255 → 0..1)
  const [cG, gG] = layer();
  gG.fillStyle = 'rgb(245,245,245)'; gG.fillRect(0, 0, W, H);
  gG.lineJoin = 'round'; gG.lineCap = 'round';
  for (const rd of ROADS) {
    gG.strokeStyle = 'rgb(225,225,225)'; gG.lineWidth = rd.w * ppm; gG.beginPath();
    rd.pts.forEach(([x, y], i) => (i ? gG.lineTo(X(x), Y(y)) : gG.moveTo(X(x), Y(y)))); gG.stroke();
  }
  const yard = site.SITE.yardPolygon;
  gG.fillStyle = 'rgb(205,205,205)'; gG.beginPath(); yard.forEach(([x, y], i) => (i ? gG.lineTo(X(x), Y(y)) : gG.moveTo(X(x), Y(y)))); gG.closePath(); gG.fill();
  for (const [x, y, rr] of WET_PATCHES) {
    const gr = gG.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), rr * 1.1 * ppm);
    gr.addColorStop(0, 'rgba(95,95,95,0.9)'); gr.addColorStop(1, 'rgba(95,95,95,0)');
    gG.fillStyle = gr; gG.fillRect(X(x) - rr * 1.2 * ppm, Y(y) - rr * 1.2 * ppm, rr * 2.4 * ppm, rr * 2.4 * ppm);
  }
  // B: puddles
  const [cB, gB] = layer();
  gB.fillStyle = '#000'; gB.fillRect(0, 0, W, H);
  const rp = rng(2026 + 1);
  // gate apron: damp, semi-glossy churned mud
  for (let k = 0; k < 60; k++) {
    const t = r(); const x = 40.5 + t * 20, y = 46.6 + (r() - 0.5) * 5.0;
    const R2 = (0.8 + r() * 1.5) * ppm;
    const gr = gG.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), R2);
    gr.addColorStop(0, `rgba(150,150,150,${0.25 + 0.3 * (1 - t)})`); gr.addColorStop(1, 'rgba(150,150,150,0)');
    gG.fillStyle = gr; gG.fillRect(X(x) - R2, Y(y) - R2, R2 * 2, R2 * 2);
  }
  for (const [x, y, rx, ry, rot] of PUDDLES) {
    const blobs = puddleBlobs(x, y, rx, ry, rot);
    for (const [bx, by, br] of blobs) {
      const R2 = (br + 0.5) * ppm;
      const gr = gG.createRadialGradient(X(bx), Y(by), br * ppm * 0.5, X(bx), Y(by), R2);
      gr.addColorStop(0, 'rgba(120,120,120,0.9)'); gr.addColorStop(1, 'rgba(120,120,120,0)');
      gG.fillStyle = gr; gG.fillRect(X(bx) - R2, Y(by) - R2, R2 * 2, R2 * 2);
    }
    gG.fillStyle = 'rgb(105,105,105)'; gB.fillStyle = '#fff';   // roughness ≈ 0.41 → muddy water, soft subtle sky reflection
    for (const [bx, by, br] of blobs) for (const gg of [gG, gB]) { gg.beginPath(); gg.arc(X(bx), Y(by), br * ppm * 0.9, 0, Math.PI * 2); gg.fill(); }
  }
  void rp; void r;
  // combine
  const out = makeCanvas(W, H); const og = out.getContext('2d');
  const dR = gR.getImageData(0, 0, W, H).data, dG = gG.getImageData(0, 0, W, H).data, dB = gB.getImageData(0, 0, W, H).data;
  const id = og.createImageData(W, H); const d = id.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = dR[i]; d[i + 1] = dG[i]; d[i + 2] = dB[i]; d[i + 3] = 255; }
  og.putImageData(id, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------
export function buildGround(ctx) {
  const { THREE, site } = ctx;
  const q = Q[ctx.quality] || Q.high;
  const aniso = ctx.maxAnisotropy || 4;
  const B = site.SITE.detailBounds;

  const { canvas } = paintDetail(site, q);
  const detailTex = new THREE.CanvasTexture(canvas);
  detailTex.colorSpace = THREE.SRGBColorSpace; detailTex.anisotropy = aniso;
  detailTex.wrapS = detailTex.wrapT = THREE.ClampToEdgeWrapping;
  const maskTex = new THREE.CanvasTexture(paintMask(site, q));
  maskTex.colorSpace = THREE.NoColorSpace; maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
  const { micro, nrm } = microTextures(THREE, q.micro, aniso);

  // placeholder satellite (1×1) until tiles arrive
  const satTex = new THREE.DataTexture(new Uint8Array([111, 106, 80, 255]), 1, 1);
  satTex.colorSpace = THREE.SRGBColorSpace; satTex.needsUpdate = true;

  const U = {
    uDetail: { value: detailTex }, uMask: { value: maskTex }, uMicro: { value: micro },
    uDetailB: { value: new THREE.Vector4(B.minX, B.minY, B.maxX - B.minX, B.maxY - B.minY) },
    uSat: { value: satTex }, uSatB: { value: new THREE.Vector4(-1e5, -1e5, 1, 1) }, uSatOn: { value: 0 },
    uSatFull: { value: 0 },
    uCenter: { value: new THREE.Vector2(site.SITE.center.x, site.SITE.center.y) },
    uHaze: { value: new THREE.Color(0.62, 0.66, 0.68) },
  };

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, normalMap: nrm, normalScale: new THREE.Vector2(0.55, 0.55) });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPlan;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPlan = (modelMatrix * vec4(transformed, 1.0)).xz * vec2(1.0, -1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vPlan;
        uniform sampler2D uDetail; uniform sampler2D uMask; uniform sampler2D uMicro; uniform sampler2D uSat;
        uniform vec4 uDetailB; uniform vec4 uSatB; uniform float uSatOn; uniform float uSatFull;
        uniform vec2 uCenter; uniform vec3 uHaze;`)
      .replace('#include <map_fragment>', `
        vec2 pl = vPlan;
        vec2 duv = (pl - uDetailB.xy) / uDetailB.zw;
        float inD = step(0.0, duv.x) * step(duv.x, 1.0) * step(0.0, duv.y) * step(duv.y, 1.0);
        vec2 cuv = clamp(duv, 0.0005, 0.9995);
        vec3 gm = texture2D(uMask, cuv).rgb;
        // noise-masked feather (≈30–50 m) between the painted detail zone and the imagery
        float fN = texture2D(uMicro, vPlan / 61.0 + 0.23).b;
        float dW = smoothstep(0.08, 0.92, gm.r + (fN - 0.5) * 0.7 * (1.0 - gm.r) * 2.0 * gm.r * 2.0) * inD * (1.0 - uSatFull);
        float gPuddle = gm.b * dW;
        float gRough = mix(0.97, gm.g, dW);
        vec3 m1 = texture2D(uMicro, pl / 3.7).rgb;
        vec3 m2 = texture2D(uMicro, pl / 0.83 + 0.37).rgb;
        vec3 m3 = texture2D(uMicro, pl / 41.0 + 0.11).rgb;
        vec3 m4 = texture2D(uMicro, pl / 330.0).rgb;
        float micro = (m1.r - 0.5) * 0.55 + (m2.g - 0.5) * 0.45 + (m1.b - 0.5) * 0.35;
        // far procedural fields (beyond the satellite mosaic)
        float fn = m4.g * 0.6 + m3.b * 0.4;
        vec3 farCol = mix(vec3(0.115, 0.15, 0.06), vec3(0.2, 0.17, 0.09), smoothstep(0.35, 0.7, fn));
        farCol = mix(farCol, vec3(0.06, 0.09, 0.04), smoothstep(0.6, 0.85, m4.r) * 0.6);
        // satellite
        vec2 suv = (pl - uSatB.xy) / uSatB.zw;
        float se = min(min(suv.x, 1.0 - suv.x), min(suv.y, 1.0 - suv.y)) * uSatB.z;
        float sW = uSatOn * smoothstep(0.0, 110.0, se);
        vec4 satTx = texture2D(uSat, clamp(suv, 0.0, 1.0));
        vec3 satCol = satTx.rgb / max(satTx.a, 0.001);
        sW *= smoothstep(0.3, 0.9, satTx.a);
        // grade the imagery towards the near-field ground: a bit darker, more contrast & saturation
        float sL = dot(satCol, vec3(0.299, 0.587, 0.114));
        satCol = mix(vec3(sL), satCol, 1.18);
        satCol = clamp(pow(satCol, vec3(1.12)) * 0.9, 0.0, 1.0);
        vec3 baseCol = mix(farCol, satCol, sW);
        vec3 detCol = texture2D(uDetail, cuv).rgb;
        vec3 gcol = mix(baseCol, detCol, dW);
        gcol *= 1.0 + micro * mix(0.22, 0.5, dW) * (1.0 - gPuddle * 0.8);
        gcol *= 1.0 - gPuddle * 0.4;
        gcol *= mix(1.0, 0.9 + m3.r * 0.2, 1.0 - dW);
        float dist = length(pl - uCenter);
        gcol = mix(gcol, uHaze * 0.55, smoothstep(700.0, 2400.0, dist) * 0.8);
        diffuseColor.rgb *= gcol;
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(gRough * (0.9 + m2.b * 0.2), 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, clamp(gPuddle * 1.2 + (1.0 - dW) * 0.5, 0.0, 1.0)));`);
  };
  mat.customProgramCacheKey = () => 'env-ground-v1';

  const R = 2500;
  const geo = new THREE.CircleGeometry(R, 96);
  geo.rotateX(-Math.PI / 2);
  geo.translate(site.SITE.center.x, 0, -site.SITE.center.y);
  // uv = plan metres / 2 (normal map tile = 2 m)
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2, -pos.getZ(i) / 2);
  uv.needsUpdate = true;
  // add an inner ring of vertices so the near field has enough tessellation for fog/shadow interpolation
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'env-ground';
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.renderOrder = -1;

  function applySatellite(sat) {
    const t = new THREE.CanvasTexture(sat.canvas);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    const b = sat.layout.bounds;
    U.uSat.value = t;
    U.uSatB.value.set(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    U.uSatOn.value = 1;
  }
  return { mesh, uniforms: U, applySatellite };
}

export { pointInPoly };
