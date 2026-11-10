// ============================================================================
//  Esri World Imagery context: fetch z=18 tiles around the site, stitch on a
//  canvas and georeference it in PLAN coordinates (x east, y north, metres).
//  Web-Mercator maths, local scale at the site latitude (error < 0.1 % over
//  the ~1.2 km covered).  Fails gracefully: resolves with ok=false offline.
// ============================================================================

const URL_T = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics';
const R = 6378137;
// Fine alignment measured on an ortho overlay of the site-data footprints (Block A roof edges,
// ETP clarifiers, compound outline): the imagery sits ~4.5 m west / 0.5 m north of the
// sketch-based model. Applied on top of SITE.imageryOffset (which is 0,0 in site-data).
export const IMAGERY_FIX = { x: 4.5, y: -0.5 };

function lngLatToPixel(lng, lat, z) {
  const n = 256 * 2 ** z;
  const s = Math.sin(lat * Math.PI / 180);
  return {
    x: (lng + 180) / 360 * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  };
}

/** Pure geometry of the tile mosaic (no network). Exported for testing. */
export function mosaicLayout(SITE, tiles = 8, z = 18) {
  const o = SITE.originGeo, off0 = SITE.imageryOffset || { x: 0, y: 0 };
  const off = { x: off0.x + IMAGERY_FIX.x, y: off0.y + IMAGERY_FIX.y };
  const p0 = lngLatToPixel(o.lng, o.lat, z);
  // metres per global pixel at this latitude (Mercator scale factor = 1/cos(lat))
  const mpp = (2 * Math.PI * R * Math.cos(o.lat * Math.PI / 180)) / (256 * 2 ** z);
  const c = SITE.center || { x: 0, y: 0 };
  const pcx = p0.x + c.x / mpp, pcy = p0.y - c.y / mpp;
  const tx0 = Math.round(pcx / 256 - tiles / 2), ty0 = Math.round(pcy / 256 - tiles / 2);
  // plan coordinates of the mosaic edges (imagery shifted by imageryOffset)
  const minX = (tx0 * 256 - p0.x) * mpp + off.x;
  const maxX = ((tx0 + tiles) * 256 - p0.x) * mpp + off.x;
  const maxY = -(ty0 * 256 - p0.y) * mpp + off.y;
  const minY = -((ty0 + tiles) * 256 - p0.y) * mpp + off.y;
  return { z, tiles, tx0, ty0, mpp, bounds: { minX, maxX, minY, maxY } };
}

function loadTile(url, timeoutMs) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let done = false;
    const fin = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => { img.src = ''; fin(null); }, timeoutMs);
    img.onload = () => fin(img);
    img.onerror = () => fin(null);
    img.src = url;
  });
}

/**
 * Fetch & stitch. Returns { ok, canvas, layout, loaded, failed }.
 * Tiles that fail stay transparent (alpha = 0).
 */
export async function loadSatellite(SITE, { tiles = 8, timeoutMs = 12000, concurrency = 8 } = {}) {
  const layout = mosaicLayout(SITE, tiles);
  const size = tiles * 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d', { willReadFrequently: false });
  g.fillStyle = '#6f6a50'; g.fillRect(0, 0, size, size);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, canvas, layout, loaded: 0, failed: tiles * tiles };
  // fetch with limited concurrency (be polite to the tile server; avoids throttling)
  const list = [];
  for (let j = 0; j < tiles; j++) for (let i = 0; i < tiles; i++) {
    // centre tiles first so the most relevant imagery arrives first
    list.push({ i, j, d: Math.hypot(i - tiles / 2 + 0.5, j - tiles / 2 + 0.5) });
  }
  list.sort((a, b) => a.d - b.d);
  const res = []; let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const { i, j } = list[next++];
      const url = URL_T.replace('{z}', layout.z).replace('{y}', layout.ty0 + j).replace('{x}', layout.tx0 + i);
      let img = await loadTile(url, timeoutMs);
      if (!img) img = await loadTile(url + '?retry=1', timeoutMs);
      res.push({ img, i, j });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  let loaded = 0; const missing = [];
  // missing tiles stay transparent (alpha 0) → the ground shader falls back to procedural fields there
  g.clearRect(0, 0, size, size);
  for (const { img, i, j } of res) {
    if (img) {
      try { g.drawImage(img, i * 256, j * 256); loaded++; } catch (e) { missing.push([i, j]); }
    } else missing.push([i, j]);
  }
  if (!loaded) return { ok: false, canvas, layout, loaded: 0, failed: missing.length };
  return { ok: true, canvas, layout, loaded, failed: missing.length };
}
