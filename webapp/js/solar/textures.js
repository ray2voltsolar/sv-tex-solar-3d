// ============================================================================
//  SOLAR — procedural textures (canvas). All generated at runtime.
// ============================================================================
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
// deterministic PRNG
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function tex(c, srgb, aniso, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso || 1;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

/**
 * Module front texture: glass rect 1130 × 2380 mm (module minus 2 mm each side).
 * 6 × 22 half-cut cells (11 + 11 rows, mid-length split), 16 BB, light gaps.
 * uv.y = 0 at the lower (eave-side) edge.
 */
export const GLASS_MM = { w: 1130, h: 2380 };
export function cellLayoutMM() {
  const cw = 180.5, ch = 103.4, gx = 2.0, gy = 1.8, mid = 8;
  const totalW = 6 * cw + 5 * gx, totalH = 22 * ch + 20 * gy + mid;
  const x0 = (GLASS_MM.w - totalW) / 2, y0 = (GLASS_MM.h - totalH) / 2;
  const cols = [], rows = [];
  for (let c = 0; c < 6; c++) cols.push(x0 + c * (cw + gx));
  let y = y0;
  for (let r = 0; r < 22; r++) { rows.push(y); y += ch + (r === 10 ? mid : gy); }
  return { cw, ch, cols, rows, x0, y0, totalW, totalH };
}

export function makeCellTexture(H, aniso) {
  const Wpx = H / 2;                         // 1:2 power-of-two canvas, stretched onto 1130 × 2380
  const [c, g] = canvas(Wpx, H);
  const sx = Wpx / GLASS_MM.w, sy = H / GLASS_MM.h;
  const R = rng(7);
  const L = cellLayoutMM();
  // glass-glass background: light, slightly bluish grey (EVA + roof seen through)
  g.fillStyle = '#4f555d'; g.fillRect(0, 0, Wpx, H);
  // end bus-ribbons (silver) in the end margins + near the mid split
  const ribbon = (ymm, hmm) => { g.fillStyle = '#c4c8cc'; g.fillRect(L.x0 * sx, ymm * sy, L.totalW * sx, Math.max(1, hmm * sy)); };
  ribbon(L.y0 - 11, 5); ribbon(L.y0 + L.totalH + 6, 5);
  // cells
  for (let r = 0; r < 22; r++) for (let col = 0; col < 6; col++) {
    const x = L.cols[col] * sx, y = L.rows[r] * sy, w = L.cw * sx, h = L.ch * sy;
    const k = (R() - 0.5) * 6;  // per-cell tone variation
    const base = [15 + k, 22 + k, 41 + k * 1.5];   // deep navy TOPCon (AR-coated)
    const gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, `rgb(${base[0] + 4},${base[1] + 5},${base[2] + 8})`);
    gr.addColorStop(0.55, `rgb(${base[0]},${base[1]},${base[2]})`);
    gr.addColorStop(1, `rgb(${base[0] - 3},${base[1] - 3},${base[2] - 2})`);
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    // faint edge passivation line
    g.strokeStyle = 'rgba(70,80,100,0.35)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  // fingers: very faint horizontal hatch (sub-pixel → just a slight sheen)
  g.fillStyle = 'rgba(120,130,150,0.025)';
  for (let y = 0; y < H; y += 2) g.fillRect(0, y, Wpx, 1);
  // 16 busbars per cell column, running the full half-length (wires continue across gaps)
  const halves = [[L.rows[0], L.rows[10] + L.ch], [L.rows[11], L.rows[21] + L.ch]];
  for (let col = 0; col < 6; col++) {
    for (let b = 0; b < 16; b++) {
      const xmm = L.cols[col] + (b + 0.5) * (L.cw / 16);
      for (const [ya, yb] of halves) {
        g.fillStyle = 'rgba(150,158,172,0.30)';
        g.fillRect(Math.round(xmm * sx), (ya - 3) * sy, 1, (yb - ya + 6) * sy);
      }
    }
  }
  // mid split: thin bus ribbons each side of the split
  g.fillStyle = 'rgba(190,195,200,0.8)';
  g.fillRect(L.x0 * sx, (L.rows[10] + L.ch + 2) * sy, L.totalW * sx, Math.max(1, 1.5 * sy));
  g.fillRect(L.x0 * sx, (L.rows[11] - 3.5) * sy, L.totalW * sx, Math.max(1, 1.5 * sy));
  // tiny grain noise
  const id = g.getImageData(0, 0, Wpx, H), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 5; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(id, 0, 0);
  // canvas y=0 is the top of the texture = uv.y 1 = upper (ridge-side) edge — layout is symmetric anyway
  return tex(c, true, aniso);
}

/** Back side of the bifacial module: darker cells seen through back glass. */
export function makeBackTexture(H, aniso) {
  const Wpx = H / 2; const [c, g] = canvas(Wpx, H);
  const sx = Wpx / GLASS_MM.w, sy = H / GLASS_MM.h; const L = cellLayoutMM();
  g.fillStyle = '#8f949a'; g.fillRect(0, 0, Wpx, H);
  for (let r = 0; r < 22; r++) for (let col = 0; col < 6; col++) {
    g.fillStyle = '#2b3036'; g.fillRect(L.cols[col] * sx, L.rows[r] * sy, L.cw * sx, L.ch * sy);
    g.fillStyle = 'rgba(160,165,170,0.25)';
    for (let b = 0; b < 16; b += 3) g.fillRect((L.cols[col] + (b + 0.5) * L.cw / 16) * sx, L.rows[r] * sy, 1, L.ch * sy);
  }
  return tex(c, true, aniso);
}

/** Galvanised steel (hot-dip spangle + dust), tileable. */
export function makeGalvTexture(size = 256, seed = 3, base = [168, 172, 172]) {
  const [c, g] = canvas(size, size); const R = rng(seed);
  g.fillStyle = `rgb(${base.join(',')})`; g.fillRect(0, 0, size, size);
  // spangle flakes
  for (let i = 0; i < size * 1.2; i++) {
    const x = R() * size, y = R() * size, r = 3 + R() * size / 14, v = (R() - 0.5) * 26;
    g.fillStyle = `rgba(${base[0] + v},${base[1] + v},${base[2] + v + 2},0.35)`;
    g.beginPath();
    const n = 5 + (R() * 3 | 0); for (let k = 0; k < n; k++) { const a = k / n * 6.283 + R() * 0.6, rr = r * (0.6 + R() * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  }
  // dust / white-rust blotches
  for (let i = 0; i < 40; i++) {
    const x = R() * size, y = R() * size, r = 6 + R() * size / 6;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${150 + R() * 30},${140 + R() * 25},${118},0.18)`); gr.addColorStop(1, 'rgba(150,140,118,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return tex(c, true, 1, true);
}

/**
 * GI bar grating, one tile = 0.30 m × 0.30 m. Bearing bars along U (texture x),
 * 30 mm pitch; twisted cross bars every 100 mm. Opaque: holes show the shaded sheet below.
 * Returns { map, normalMap }.
 */
export function makeGratingTextures(size, aniso) {
  const [c, g] = canvas(size, size); const R = rng(11);
  const px = size / 300;                     // px per mm
  const H = new Float32Array(size * size);
  // holes
  g.fillStyle = '#4b4d4a'; g.fillRect(0, 0, size, size);   // sheet below, mostly in the grating's own shade
  for (let i = 0; i < 30; i++) { // subtle light leaking / roof crest seen through
    g.fillStyle = `rgba(120,123,118,${0.12 + R() * 0.12})`; g.fillRect(0, R() * size, size, 3 * px);
  }
  const bar = (x, y, w, h, col, hv) => {
    g.fillStyle = col; g.fillRect(x, y, w, h);
    for (let yy = Math.max(0, y | 0); yy < Math.min(size, y + h); yy++) for (let xx = Math.max(0, x | 0); xx < Math.min(size, x + w); xx++) H[yy * size + xx] = Math.max(H[yy * size + xx], hv);
  };
  // bearing bars (run along x → horizontal lines in texture), 5 mm thick at 30 mm pitch
  for (let k = 0; k < 10; k++) bar(0, (k * 30 + 12.5) * px, size, 5 * px, '#b3b7b6', 1);
  // cross bars (twisted square), 4 mm, every 100 mm
  for (let k = 0; k < 3; k++) bar((k * 100 + 48) * px, 0, 4 * px, size, '#a7abaa', 0.85);
  // galvanised mottling + dust
  const id = g.getImageData(0, 0, size, size), d = id.data;
  for (let i = 0; i < size * size; i++) {
    if (H[i] > 0) { const n = (R() - 0.5) * 18 + Math.sin(i * 0.013) * 4; d[i * 4] += n + 6; d[i * 4 + 1] += n + 3; d[i * 4 + 2] += n - 2; }
  }
  g.putImageData(id, 0, 0);
  const map = tex(c, true, aniso, true);
  // normal map from height
  const [cn, gn] = canvas(size, size); const nd = gn.createImageData(size, size);
  const h = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * 2.0, dy = (h(x, y + 1) - h(x, y - 1)) * 2.0;
    const l = Math.hypot(dx, dy, 1); const o = (y * size + x) * 4;
    nd.data[o] = (-dx / l * 0.5 + 0.5) * 255; nd.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; nd.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; nd.data[o + 3] = 255;
  }
  gn.putImageData(nd, 0, 0);
  const normalMap = tex(cn, false, aniso, true);
  return { map, normalMap };
}

/** Weathered concrete (trench covers, pads, chambers). */
export function makeConcreteTexture(size = 256, seed = 5) {
  const [c, g] = canvas(size, size); const R = rng(seed);
  g.fillStyle = '#a19c92'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2500; i++) {
    const v = 120 + R() * 70; g.fillStyle = `rgba(${v},${v - 4},${v - 12},0.25)`;
    const s = 1 + R() * 3; g.fillRect(R() * size, R() * size, s, s);
  }
  for (let i = 0; i < 18; i++) {
    const x = R() * size, y = R() * size, r = 10 + R() * 50;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${90 + R() * 30},${80 + R() * 25},62,0.12)`); gr.addColorStop(1, "rgba(90,80,62,0)");
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return tex(c, true, 1, true);
}

/** Inverter front panel (no brand): light housing, display window, LEDs. */
export function makeInverterFront() {
  const [c, g] = canvas(256, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#eef0f1'); gr.addColorStop(1, '#d9dcde');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  // lower dark-grey band
  g.fillStyle = '#4a4f55'; g.fillRect(0, 206, 256, 50);
  // display window
  g.fillStyle = '#20262c'; roundRect(g, 88, 70, 80, 40, 6); g.fill();
  g.fillStyle = '#3d7fb0'; g.fillRect(96, 78, 64, 24);
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(100, 84, 30, 3); g.fillRect(100, 92, 44, 3);
  // LED strip
  const leds = ['#39d353', '#39d353', '#f2c335'];
  leds.forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.arc(104 + i * 24, 132, 4, 0, 7); g.fill(); });
  // embossed lines
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2; g.strokeRect(10, 10, 236, 190);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(28, 30, 60, 6);   // logo plate placeholder (blank)
  // rating label
  g.fillStyle = '#f7f7f4'; g.fillRect(176, 150, 52, 40); g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 6; i++) g.fillRect(180, 155 + i * 6, 40 - (i % 2) * 10, 2);
  return tex(c, true, 4);
}

/** ACDB enclosure door (RAL 7035 powder coat, handle, warning label). */
export function makeAcdbFront() {
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#c9cbc6'; g.fillRect(0, 0, 256, 512);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; g.strokeRect(10, 10, 236, 492);
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1; g.strokeRect(14, 14, 228, 484);
  // inspection window
  g.fillStyle = '#5e6a72'; g.fillRect(60, 90, 136, 110); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(64, 94, 60, 102);
  // danger label
  g.fillStyle = '#f2c230'; g.beginPath(); g.moveTo(128, 250); g.lineTo(168, 318); g.lineTo(88, 318); g.closePath(); g.fill();
  g.fillStyle = '#111'; g.fillRect(124, 270, 8, 30); g.fillRect(124, 305, 8, 8);
  g.fillStyle = '#d42b20'; g.fillRect(70, 330, 116, 22);
  // handle
  g.fillStyle = '#2b2b2b'; g.fillRect(212, 220, 14, 70);
  // dust at the bottom
  const gr = g.createLinearGradient(0, 380, 0, 512); gr.addColorStop(0, 'rgba(120,105,80,0)'); gr.addColorStop(1, 'rgba(120,105,80,0.35)');
  g.fillStyle = gr; g.fillRect(0, 380, 256, 132);
  return tex(c, true, 4);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
