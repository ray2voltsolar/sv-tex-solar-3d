// ============================================================================
//  ENV utilities: seeded RNG, value noise, canvas helpers, geometry helpers.
// ============================================================================

/** Mulberry32 seeded RNG → function returning [0,1). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 2D value noise (hash based, tileable when period given) ---------------
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);

export function valueNoise(x, y, seed = 0, period = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = fade(x - x0), fy = fade(y - y0);
  let xa = x0, xb = x0 + 1, ya = y0, yb = y0 + 1;
  if (period) { xa = ((xa % period) + period) % period; xb = ((xb % period) + period) % period; ya = ((ya % period) + period) % period; yb = ((yb % period) + period) % period; }
  const a = hash2(xa, ya, seed), b = hash2(xb, ya, seed), c = hash2(xa, yb, seed), d = hash2(xb, yb, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise in [0,1]. period (in base-frequency cells) makes it tileable. */
export function fbm(x, y, oct = 4, seed = 0, period = 0) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * valueNoise(x * f, y * f, seed + i * 17, period ? period * f : 0);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Height canvas (grey) → tangent-space normal map canvas. */
export function heightToNormal(src, strength = 2.0) {
  const w = src.width, h = src.height;
  const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h); const octx = out.getContext('2d');
  const od = octx.createImageData(w, h); const d = od.data;
  const H = (x, y) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  octx.putImageData(od, 0, 0);
  return out;
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from point to polyline [[x,y],...]. */
export function distToPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const vx = bx - ax, vy = by - ay; const l2 = vx * vx + vy * vy;
    let t = l2 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const dx = ax + vx * t - x, dy = ay + vy * t - y; const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}

/** Shader snippet: alpha boost with mip level so alpha-tested foliage does not thin out at distance. */
export const ALPHA_MIP_FIX = /* glsl */`
  #ifdef USE_MAP
  {
    vec2 _ts = vec2(textureSize(map, 0));
    vec2 _dx = dFdx(vMapUv * _ts), _dy = dFdy(vMapUv * _ts);
    float _mip = max(0.0, 0.5 * log2(max(dot(_dx, _dx), dot(_dy, _dy))));
    diffuseColor.a *= 1.0 + _mip * 0.28;
  }
  #endif
`;

/** Shared wind uniform object; updated by index.js through registerAnimated. */
export const WIND = { uTime: { value: 0 }, uStrength: { value: 1 } };

/**
 * Vertex sway for foliage. Geometry needs attribute `aSway` (vec3):
 *  x = weight (0 at base … 1 at tip), y = phase, z = flutter weight (leaf tips).
 */
export const SWAY_VERT = /* glsl */`
  {
    float _w = aSway.x * uWindStrength;
    float _t = uWindTime;
    float _p = aSway.y;
    #ifdef USE_INSTANCING
      _p += instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
    #endif
    vec2 _bend = vec2(sin(_t * 0.9 + _p) * 0.6 + sin(_t * 1.7 + _p * 1.3) * 0.25,
                      cos(_t * 0.7 + _p * 0.7) * 0.4);
    transformed.xz += _bend * _w * 0.12;
    float _f = aSway.z * uWindStrength;
    transformed.y += sin(_t * 3.1 + _p * 5.0 + position.x * 0.7) * 0.05 * _f;
    transformed.xz += vec2(sin(_t * 2.3 + _p * 3.0), cos(_t * 2.9 + _p * 2.0)) * 0.035 * _f;
  }
`;

/** Patch a material (colour or depth) to add sway + optional alpha mip fix. */
const NORMAL_BEGIN_NOFLIP = /* glsl */`
  float faceDirection = 1.0;
  vec3 normal = normalize( vNormal );
  vec3 nonPerturbedNormal = normal;
`;
export function patchFoliage(mat, { sway = true, alphaFix = false, noFlip = false } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    if (sway) {
      sh.uniforms.uWindTime = WIND.uTime; sh.uniforms.uWindStrength = WIND.uStrength;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aSway;\nuniform float uWindTime;\nuniform float uWindStrength;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_VERT);
    }
    if (alphaFix) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + ALPHA_MIP_FIX);
    }
    if (noFlip) {
      // foliage cards: light back faces like front faces (no black undersides)
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', NORMAL_BEGIN_NOFLIP);
    }
  };
  mat.customProgramCacheKey = () => `env-foliage-${sway ? 1 : 0}${alphaFix ? 1 : 0}${noFlip ? 1 : 0}`;
  return mat;
}

/**
 * Minimal merged-geometry builder with optional colour / sway attributes.
 * add*: positions are pushed in world (or object) space.
 */
export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.s = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(p, n, uv, c = [1, 1, 1], s = [0, 0, 0]) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]);
    this.c.push(c[0], c[1], c[2]); this.s.push(s[0], s[1], s[2]);
    return this.count - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  /** Append a THREE.BufferGeometry (non-indexed or indexed) with a transform function. */
  addGeometry(geo, xf, color = [1, 1, 1], sway = () => [0, 0, 0]) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    const base = this.count;
    for (let k = 0; k < pos.count; k++) {
      const [p, n] = xf([pos.getX(k), pos.getY(k), pos.getZ(k)], nor ? [nor.getX(k), nor.getY(k), nor.getZ(k)] : [0, 1, 0]);
      this.vert(p, n, uv ? [uv.getX(k), uv.getY(k)] : [0, 0], typeof color === 'function' ? color(p) : color, sway(p));
    }
    if (geo.index) for (let k = 0; k < geo.index.count; k++) this.i.push(base + geo.index.getX(k));
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
  }
  build(THREE, { color = false, sway = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (sway) g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.s, 3));
    const idx = this.count > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/**
 * Tapered tube along a polyline of points [[x,y,z],...] with radii [r,...].
 * vScale: metres per texture repeat along the tube.
 */
export function addTube(gb, pts, radii, radial = 8, vScale = 1, color = [1, 1, 1], swayFn = () => [0, 0, 0], capTop = false) {
  const n = pts.length; let len = 0; const rings = [];
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const tl = Math.hypot(...t) || 1; t = t.map((v) => v / tl);
    let ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let s1 = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
    const sl = Math.hypot(...s1); s1 = s1.map((v) => v / sl);
    const s2 = [t[1] * s1[2] - t[2] * s1[1], t[2] * s1[0] - t[0] * s1[2], t[0] * s1[1] - t[1] * s1[0]];
    if (k > 0) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]);
    const ring = [];
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2; const ca = Math.cos(ang), sa = Math.sin(ang);
      const nrm = [s1[0] * ca + s2[0] * sa, s1[1] * ca + s2[1] * sa, s1[2] * ca + s2[2] * sa];
      const r = radii[k];
      const p = [pts[k][0] + nrm[0] * r, pts[k][1] + nrm[1] * r, pts[k][2] + nrm[2] * r];
      ring.push(gb.vert(p, nrm, [j / radial, len / vScale], typeof color === 'function' ? color(k / (n - 1)) : color, swayFn(k / (n - 1), p)));
    }
    rings.push(ring);
  }
  for (let k = 0; k < n - 1; k++) for (let j = 0; j < radial; j++) {
    gb.quad(rings[k][j], rings[k][j + 1], rings[k + 1][j + 1], rings[k + 1][j]);
  }
  if (capTop) {
    const last = pts[n - 1]; const c = gb.vert(last, [0, 1, 0], [0.5, len / vScale], typeof color === 'function' ? color(1) : color, swayFn(1, last));
    for (let j = 0; j < radial; j++) gb.tri(rings[n - 1][j], rings[n - 1][j + 1], c);
  }
}
