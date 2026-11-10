// ============================================================================
//  shading.js — ray-cast shading analysis of the PV modules (browser).
//
//    const analyzer = createShadingAnalyzer(ctx, { modules, occluders, moduleMesh? });
//    const res = await analyzer.runDay({ year: 2026, month: 12, day: 21 }, { stepMin: 10 }, (p, info) => ...);
//    const yr  = await analyzer.runYear({ year: 2026 }, (p) => ...);      // 21st of each month, 30-min steps
//    analyzer.cancel();                                                    // running promise resolves to null
//
//  Pipeline: expand every REGISTERED occluder (Mesh / InstancedMesh / Group trees) into ONE merged world-space
//  triangle soup -> three-mesh-bvh `MeshBVH` -> for each module a 4 x 8 grid of rays towards the sun (origin 2 cm
//  above the glass along the module normal, own glass excluded) -> beam-weighted aggregation (clear-sky DNI x
//  cos(incidence)) in shading-core.js. Time-sliced: yields to the browser every ~12 ms.
//
//  Reproducibility rules (so the "bankable" number never depends on what the presenter has on screen):
//   * The occluder set is the REGISTRY (ctx.registerOccluder), NOT what is currently visible. Layer toggles
//     (Vegetation / Vehicles / Modules / ...) only change `.visible`, which the scan ignores
//     (legacy behaviour: options.respectVisibility = true).
//   * What is deliberately included/excluded is a run option, never a side effect:
//       includeVegetation (default true), includeVehicles (true), includeNeighbours (true)
//   * Foliage cards are alpha-tested in the renderer (leaf shadows have holes). The ray caster honours the same
//     alpha mask (options.alphaAware, default true), so a canopy is porous rather than a solid slab.
//   * The result discloses exactly what was counted (`res.disclosure`) and how much of the loss is caused by the
//     trees alone (`res.vegetation`, measured ray by ray against a second BVH built without the vegetation).
//
//  Result (see shading-core.js finalizeResult):
//   { kind:'day'|'year',
//     perModule: Float32Array(N)   beam-weighted shaded fraction 0..1  (use as heatmap values; 0 = never shaded)
//     perModuleLoss: Float32Array  share of total plane-of-array energy (beam + diffuse) lost, 0..1
//     arrayLossPct                 THE headline % (one definition everywhere). Year runs: PVGIS-energy-weighted, so
//                                  annual kWh = unshaded kWh x (1 - arrayLossPct/100) exactly (same as energy.js lossPct).
//                                  Day runs: weighted by clear-sky plane-of-array energy (beam + diffuse). See lossBasis.
//     lossBasis                    'energy' (year) | 'poa' (day) — the weighting of arrayLossPct / perPlaneLossPct / perBuildingLossPct
//     arrayPoaLossPct              % of the clear-sky POA energy (beam + diffuse) lost — "irradiance-weighted" twin of arrayLossPct
//     arrayBeamLossPct             % of the beam component lost
//     perPlaneLossPct {'A-W':..}, perPlanePoaLossPct, perPlaneBeamLossPct, perBuildingLossPct {A:..,C:..,D:..}, perBuildingPoaLossPct
//     worst: [{index,id,plane,pct,lossPct}]   top modules by perModule (pct = perModule*100)
//     hourly: [{hour,label,poaWhm2,lostWhm2,lossPct,beamLossPct,shadedPct}]
//     irradiation: {beamKWhm2,diffuseKWhm2,lostKWhm2}  (mean per module over the analysed period)
//     monthly[12], perPlaneMonthlyLossPct, perModuleMonthlyLoss (year only)
//     date, sunrise, sunset (day only) / year (year only)
//     vegetation: { lossPct, beamLossPct, sharePct, lossWithoutPct, perPlaneLossPct, perBuildingLossPct, perModule }
//                 loss caused solely by the trees (null when trees are excluded / absent)
//     occluders:  { triangles, meshes, skippedByBudget, skippedFlagged, trees, vehicles, neighbours, alphaMeshes,
//                   categories:{ vegetation:{meshes,triangles,units}, ... }, excluded:{...}, includeVegetation, ... }
//     disclosure: { lines:[string], text:string, trees, vehicles, includeVegetation, includeVehicles,
//                   layerIndependent:true, foliagePorous:boolean, treeSharePct, lossWithoutTreesPct }
//     timing: { totalMs, bvhMs, bvhCached, traceMs, rays, raysPerSec, steps, yields, triangles, modules, samplesPerModule }
//   }
// ============================================================================
import * as THREE from 'three';
import {
  DEFAULTS, prepareModules, buildDaySamples, buildYearSamples, runJob, shadeAtDirection, resolveDate, defaultYield,
} from './shading-core.js';
import { getSunPosition, sunVectorWorld } from './sun.js';
import { moduleMonthEnergyWeights } from './energy.js';

const nowMs = () => performance.now();

// ---------------------------------------------------------------------------
// Occluder classification (by userData.occluderCategory, else by group / mesh names)
// ---------------------------------------------------------------------------
export const CATEGORY = Object.freeze({
  BUILDINGS: 'buildings', SOLAR: 'solar', STRUCTURES: 'structures', VEGETATION: 'vegetation',
  VEHICLES: 'vehicles', NEIGHBOURS: 'neighbours', OTHER: 'other',
});
const RE_VEHICLE = /(^|[^a-z])(vehicles?|trucks?|tankers?|trailers?|sedans?|tractors?|motorbikes?|bikes?|scooters?|cars?)([^a-z]|$)/;
const RE_VEG = /(^|[^a-z])(vegetation|palms?|broadleaf|trees?|scrub|shrubs?|foliage|fronds?)([^a-z]|$)/;
const RE_CONTEXT = /(^|[^a-z])context([^a-z]|$)/;
const RE_SOLAR = /(^|[^a-z])(solar|pv|bos)([^a-z]|$)/;

/** 'vegetation' | 'vehicles' | 'neighbours' | 'solar' | 'buildings' | 'structures' | 'other' */
export function classifyOccluder(mesh) {
  const names = [];
  for (let o = mesh; o; o = o.parent) {
    const c = o.userData && o.userData.occluderCategory;
    if (c) return c;
    if (o.name) names.push(String(o.name).toLowerCase());
  }
  const s = names.join(' ');
  if (RE_VEHICLE.test(s)) return CATEGORY.VEHICLES;
  if (RE_VEG.test(s)) return CATEGORY.VEGETATION;
  if (RE_CONTEXT.test(s)) return CATEGORY.NEIGHBOURS;
  if (RE_SOLAR.test(s)) return CATEGORY.SOLAR;
  if (/building/.test(s)) return CATEGORY.BUILDINGS;
  if (/structures/.test(s)) return CATEGORY.STRUCTURES;
  return CATEGORY.OTHER;
}

/** How many real-world objects a registered mesh represents (trees / vehicles); 0 for meshes that merely carry them. */
function unitsOf(mesh, cat, site) {
  const u = mesh.userData;
  if (u && Number.isFinite(u.occluderCount)) return u.occluderCount;
  const n = String(mesh.name || '').toLowerCase();
  if (cat === CATEGORY.VEGETATION) {
    const T = site && site.FEATURES && site.FEATURES.trees;
    if (n === 'palm-fronds') return T && T.coconut ? T.coconut.length : 0;       // all palms share one merged mesh
    if (n === 'broadleaf-crowns') return T && T.broadleaf ? T.broadleaf.length : 0;
    if (mesh.isInstancedMesh && /crowns?$/.test(n)) return mesh.count;           // satellite-derived canopy trees
    return 0;
  }
  if (cat === CATEGORY.VEHICLES) return mesh.isInstancedMesh ? mesh.count : 1;
  return 0;
}

const emptyTally = () => ({ meshes: 0, triangles: 0, units: 0 });

// ---------------------------------------------------------------------------
// Occluder geometry collection
// ---------------------------------------------------------------------------
function chainVisible(obj) { for (let o = obj; o; o = o.parent) if (o.visible === false) return false; return true; }

/**
 * Pass 1: walk the registered occluder roots, classify, tally and count triangles. Cheap (no geometry copies).
 * Visibility (`.visible`) is IGNORED unless opts.respectVisibility — layer toggles must not change the analysis.
 */
function scanOccluders(roots, opts, site) {
  const jobs = [], seen = new Set();
  const present = {}, used = {};                         // category -> tally (everything registered / everything counted)
  let tris = 0, verts = 0, skippedByBudget = 0, skippedFlag = 0;
  const maxTriangles = opts.maxTriangles ?? 3_000_000;
  const respectVisibility = !!opts.respectVisibility;
  const include = {
    [CATEGORY.VEGETATION]: opts.includeVegetation !== false,
    [CATEGORY.VEHICLES]: opts.includeVehicles !== false,
    [CATEGORY.NEIGHBOURS]: opts.includeNeighbours !== false,
  };
  const vehicleParents = new Set();
  const walk = (obj) => {
    if (!obj) return;
    if (respectVisibility && obj.visible === false) return;
    if (obj.isMesh && !seen.has(obj)) {
      seen.add(obj);
      const mat = obj.material;
      const hidden = (Array.isArray(mat) ? mat.every((m) => m && m.visible === false) : mat && mat.visible === false);
      if (obj.userData && obj.userData.noOcclusion) skippedFlag++;
      else if (hidden || (opts.filter && opts.filter(obj) === false)) skippedFlag++;
      else {
        const geo = obj.geometry, pos = geo && geo.attributes && geo.attributes.position;
        if (pos && pos.count >= 3) {
          const total = geo.index ? geo.index.count : pos.count;
          const start = geo.drawRange.start || 0;
          const count = Math.min(Number.isFinite(geo.drawRange.count) ? geo.drawRange.count : total, total - start);
          const triCount = Math.floor(count / 3);
          const inst = obj.isInstancedMesh ? obj.count : 1;
          if (triCount > 0 && inst > 0) {
            const cat = classifyOccluder(obj);
            let units = unitsOf(obj, cat, site);
            if (cat === CATEGORY.VEHICLES && !obj.isInstancedMesh && !(obj.userData && Number.isFinite(obj.userData.occluderCount))) {
              // a vehicle is several meshes (body / glass / wheels): count distinct parents instead
              const pid = obj.parent ? obj.parent.id : obj.id;
              units = vehicleParents.has(pid) ? 0 : 1; vehicleParents.add(pid);
            }
            const P = present[cat] || (present[cat] = emptyTally());
            P.meshes++; P.triangles += triCount * inst; P.units += units;
            if (include[cat] === false) { /* excluded by option: counted in `present` only */ }
            else if (tris + triCount * inst > maxTriangles) skippedByBudget++;
            else {
              jobs.push({ mesh: obj, start, triCount, inst, cat });
              tris += triCount * inst; verts += pos.count * inst;
              const U = used[cat] || (used[cat] = emptyTally());
              U.meshes++; U.triangles += triCount * inst; U.units += units;
            }
          }
        }
      }
    }
    const ch = obj.children;
    for (let i = 0; i < ch.length; i++) walk(ch[i]);
  };
  for (const r of roots) {
    if (!r) continue;
    if (respectVisibility && !chainVisible(r.parent)) continue;
    walk(r);
  }
  // the vegetation goes LAST in the merged soup: the "scene without trees" BVH is then a prefix of the index buffer
  jobs.sort((a, b) => (a.cat === CATEGORY.VEGETATION ? 1 : 0) - (b.cat === CATEGORY.VEGETATION ? 1 : 0));
  let baseTris = 0, vegTris = 0;
  for (const j of jobs) { if (j.cat === CATEGORY.VEGETATION) vegTris += j.triCount * j.inst; else baseTris += j.triCount * j.inst; }
  const sig = jobs.map((j) => `${j.mesh.id}:${j.inst}:${j.triCount}`).join('|') + (opts.alphaAware === false ? '|noalpha' : '');
  return { jobs, tris, verts, sig, baseTris, vegTris, skippedByBudget, skippedFlag, present, used };
}

// ---------------------------------------------------------------------------
// Alpha masks (leaf cards): the renderer alpha-tests these textures, so shading rays must too
// ---------------------------------------------------------------------------
function makeAlphaMask(tex, cutoff) {
  try {
    const img = tex && tex.image;
    const w = img && (img.width || img.videoWidth), h = img && (img.height || img.videoHeight);
    if (!w || !h || w * h > 16_000_000 || typeof document === 'undefined') return null;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, w, h).data;
    const data = new Uint8Array(w * h), thr = Math.max(1, Math.round(cutoff * 255));
    let opaque = 0;
    for (let i = 0, n = w * h; i < n; i++) if (px[i * 4 + 3] >= thr) { data[i] = 1; opaque++; }
    let m = null;
    if (tex.matrixAutoUpdate) tex.updateMatrix();
    const e = tex.matrix.elements;
    if (!(e[0] === 1 && e[4] === 1 && e[1] === 0 && e[3] === 0 && e[6] === 0 && e[7] === 0)) m = Array.from(e);
    return { w, h, data, flipY: tex.flipY !== false, m, wrapS: tex.wrapS, wrapT: tex.wrapT, coverage: opaque / (w * h) };
  } catch { return null; }
}

function wrapUV(t, mode) {
  if (mode === THREE.RepeatWrapping) return t - Math.floor(t);
  if (mode === THREE.MirroredRepeatWrapping) { const f = t - 2 * Math.floor(t / 2); return f > 1 ? 2 - f : f; }
  return t < 0 ? 0 : (t > 1 ? 1 : t);
}
/** true when the leaf card is opaque at (u,v) — same test the renderer's alphaTest performs */
function maskOpaque(mk, u, v) {
  if (mk.m) { const e = mk.m, uu = e[0] * u + e[3] * v + e[6], vv = e[1] * u + e[4] * v + e[7]; u = uu; v = vv; }
  u = wrapUV(u, mk.wrapS); v = wrapUV(v, mk.wrapT);
  let x = (u * mk.w) | 0, y = ((mk.flipY ? 1 - v : v) * mk.h) | 0;
  if (x >= mk.w) x = mk.w - 1; if (y >= mk.h) y = mk.h - 1; if (x < 0) x = 0; if (y < 0) y = 0;
  return mk.data[y * mk.w + x] !== 0;
}

/** index into `masks` for a mesh whose material alpha-tests a map, else -1 (registers new masks on demand) */
function alphaMaskIndex(mesh, masks, byKey) {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!mat || !(mat.alphaTest > 0) || !mat.map || !mesh.geometry.attributes.uv) return -1;
  const key = `${mat.map.uuid}:${mat.alphaTest}`;
  if (byKey.has(key)) return byKey.get(key);
  const mk = makeAlphaMask(mat.map, mat.alphaTest);
  const id = mk ? masks.push(mk) - 1 : -1;
  byKey.set(key, id);
  return id;
}

/** Pass 2: build merged world-space position/index (+ module-owner tags and leaf-alpha data). */
function buildMergedGeometry(scan, moduleMesh, alphaAware) {
  const masks = [], byKey = new Map();
  if (alphaAware) for (const j of scan.jobs) j.mask = alphaMaskIndex(j.mesh, masks, byKey); else for (const j of scan.jobs) j.mask = -1;
  const anyAlpha = scan.jobs.some((j) => j.mask >= 0);
  const positions = new Float32Array(scan.verts * 3);
  const index = new Uint32Array(scan.tris * 3);
  const owner = moduleMesh ? new Int32Array(scan.verts).fill(-1) : null;
  const uv = anyAlpha ? new Float32Array(scan.verts * 2) : null;
  const alphaId = anyAlpha ? new Int16Array(scan.verts).fill(-1) : null;
  const mw = new THREE.Matrix4(), inst = new THREE.Matrix4(), m = new THREE.Matrix4();
  let vOff = 0, iOff = 0;
  for (const { mesh, start, triCount, inst: instCount, mask } of scan.jobs) {
    mesh.updateWorldMatrix(true, false);
    mw.copy(mesh.matrixWorld);
    const geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index;
    const vc = pos.count;
    // local positions once
    const lp = new Float32Array(vc * 3);
    for (let v = 0; v < vc; v++) { lp[v * 3] = pos.getX(v); lp[v * 3 + 1] = pos.getY(v); lp[v * 3 + 2] = pos.getZ(v); }
    let luv = null;
    if (mask >= 0) { const a = geo.attributes.uv; luv = new Float32Array(vc * 2); for (let v = 0; v < vc; v++) { luv[v * 2] = a.getX(v); luv[v * 2 + 1] = a.getY(v); } }
    const isOwnerMesh = owner && mesh === moduleMesh;
    for (let k = 0; k < instCount; k++) {
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(k, inst); m.multiplyMatrices(mw, inst); } else m.copy(mw);
      const e = m.elements;
      const e0 = e[0], e1 = e[1], e2 = e[2], e4 = e[4], e5 = e[5], e6 = e[6], e8 = e[8], e9 = e[9], e10 = e[10], e12 = e[12], e13 = e[13], e14 = e[14];
      let o = vOff * 3;
      for (let v = 0; v < vc; v++) {
        const x = lp[v * 3], y = lp[v * 3 + 1], z = lp[v * 3 + 2];
        positions[o++] = e0 * x + e4 * y + e8 * z + e12;
        positions[o++] = e1 * x + e5 * y + e9 * z + e13;
        positions[o++] = e2 * x + e6 * y + e10 * z + e14;
      }
      if (isOwnerMesh) owner.fill(k, vOff, vOff + vc);
      if (luv) { uv.set(luv, vOff * 2); alphaId.fill(mask, vOff, vOff + vc); }
      const n = triCount * 3;
      if (idx) for (let t = 0; t < n; t++) index[iOff++] = vOff + idx.getX(start + t);
      else for (let t = 0; t < n; t++) index[iOff++] = vOff + start + t;
      vOff += vc;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (uv) geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return { geometry, owner, alphaId, masks };
}

// ---------------------------------------------------------------------------
// What was counted: plain-language disclosure for the result panel
// ---------------------------------------------------------------------------
const plural = (n, s, p = s + 's') => `${n.toLocaleString('en-IN')} ${n === 1 ? s : p}`;
const fix2 = (v) => (+v).toFixed(2);

function summariseScan(scan, alphaMeshes) {
  const cat = (c) => ({ ...(scan.used[c] || emptyTally()) });
  const categories = {};
  for (const c of Object.values(CATEGORY)) if (scan.used[c]) categories[c] = cat(c);
  const excluded = {};
  for (const c of [CATEGORY.VEGETATION, CATEGORY.VEHICLES, CATEGORY.NEIGHBOURS]) {
    const P = scan.present[c], U = scan.used[c];
    if (P && (!U || U.triangles < P.triangles)) excluded[c] = { meshes: P.meshes - (U ? U.meshes : 0), triangles: P.triangles - (U ? U.triangles : 0), units: P.units - (U ? U.units : 0) };
  }
  const trees = scan.used.vegetation ? scan.used.vegetation.units : 0;
  const vehicles = scan.used.vehicles ? scan.used.vehicles.units : 0;
  return {
    triangles: scan.tris, meshes: scan.jobs.length, skippedByBudget: scan.skippedByBudget, skippedFlagged: scan.skippedFlag,
    trees, vehicles, neighbours: !!scan.used.neighbours, alphaMeshes, categories, excluded,
    treesPresent: scan.present.vegetation ? scan.present.vegetation.units : 0,
    vehiclesPresent: scan.present.vehicles ? scan.present.vehicles.units : 0,
  };
}

function buildDisclosure(sum, opts, veg) {
  const lines = [];
  const parts = ['buildings & roofs', 'chimney, tanks and plant'];
  if (sum.neighbours) parts.push('neighbouring houses');
  if (sum.trees) parts.push(plural(sum.trees, 'tree'));
  if (sum.vehicles) parts.push(plural(sum.vehicles, 'vehicle'));
  const lead = opts.respectVisibility ? 'Counted (visible objects only)' : 'Counted whether or not their layer is visible';
  lines.push(`${lead}: ${parts.join(', ')}.`);
  if (veg) {
    lines.push(`Trees alone account for ${veg.sharePct.toFixed(0)} % of this loss (${fix2(veg.lossWithoutPct + veg.lossPct)} % with trees, ${fix2(veg.lossWithoutPct)} % without).`);
  }
  const ex = [];
  if (sum.excluded.vegetation && sum.excluded.vegetation.units) ex.push(plural(sum.excluded.vegetation.units, 'tree'));
  if (sum.excluded.vehicles && sum.excluded.vehicles.units) ex.push(plural(sum.excluded.vehicles.units, 'vehicle'));
  if (sum.excluded.neighbours) ex.push('neighbouring houses');
  if (ex.length) lines.push(`Left out of this run by option: ${ex.join(', ')}.`);
  if (sum.alphaMeshes) lines.push('Tree canopies are porous (leaf-level transparency, as in the rendered leaf shadows), not solid slabs.');
  return {
    lines, text: lines.join(' '),
    trees: sum.trees, vehicles: sum.vehicles, neighbours: sum.neighbours,
    includeVegetation: opts.includeVegetation !== false, includeVehicles: opts.includeVehicles !== false, includeNeighbours: opts.includeNeighbours !== false,
    layerIndependent: !opts.respectVisibility, foliagePorous: !!sum.alphaMeshes,
    treeSharePct: veg ? veg.sharePct : null, lossWithoutTreesPct: veg ? veg.lossWithoutPct : null,
  };
}

// ---------------------------------------------------------------------------
// The analyzer
// ---------------------------------------------------------------------------
const OCC_OPTION_KEYS = ['includeVegetation', 'includeVehicles', 'includeNeighbours', 'respectVisibility', 'alphaAware'];

export function createShadingAnalyzer(ctx, options = {}) {
  const site = ctx.site || {};
  const SITE = site.SITE || {};
  const geo = { lat: SITE.lat ?? DEFAULTS.lat, lng: SITE.lng ?? DEFAULTS.lng, utcOffsetHours: SITE.utcOffsetHours ?? DEFAULTS.utcOffsetHours };
  const getModules = () => options.modules || (site.computeLayout ? site.computeLayout() : []);
  const getOccluders = () => (typeof options.occluders === 'function' ? options.occluders() : (options.occluders || []));
  const moduleMesh = options.moduleMesh || null;

  let modules = null, prepKey = '', prep = null;
  let cache = null;                       // { sig, bvh, owner, alphaId, masks, baseBvh, triangles, buildMs, geometry, scan, summary }
  let token = 0;                          // run id; cancel() bumps it
  let active = 0;
  let MB = null;                          // three-mesh-bvh module (lazy)

  /** scan options = analyzer options overridden by the per-run ones (occluder-related keys only) */
  const scanOptions = (o = {}) => {
    const s = { ...options };
    for (const k of OCC_OPTION_KEYS) if (o[k] !== undefined) s[k] = o[k];
    if (o.maxTriangles !== undefined) s.maxTriangles = o.maxTriangles;
    return s;
  };

  function getPrep(o = {}) {
    modules = getModules();
    const nu = o.nu ?? DEFAULTS.nu, nv = o.nv ?? DEFAULTS.nv, offset = o.offset ?? DEFAULTS.offset;
    const key = `${modules.length}:${nu}:${nv}:${offset}`;
    if (!prep || prepKey !== key || prep._src !== modules) { prep = prepareModules(modules, { nu, nv, offset }); prep._src = modules; prepKey = key; }
    return prep;
  }

  function disposeCache() {
    if (!cache) return;
    for (const g of [cache.geometry, cache.baseGeometry]) { if (g) { try { g.dispose(); } catch { /* ignore */ } } }
  }

  async function ensureBVH(o = {}) {
    if (!MB) MB = await import('three-mesh-bvh');
    const sopt = scanOptions(o);
    const scan = scanOccluders(getOccluders(), sopt, site);
    if (!o.rebuild && cache && cache.sig === scan.sig) { cache.scan = scan; cache.summary = summariseScan(scan, cache.masks.length ? cache.alphaMeshes : 0); cache.sopt = sopt; return { cache, cached: true, scan }; }
    const t0 = nowMs();
    disposeCache();
    if (scan.tris === 0) {
      cache = { sig: scan.sig, bvh: null, owner: null, alphaId: null, masks: [], triangles: 0, buildMs: nowMs() - t0, geometry: null, baseBvh: null, baseGeometry: null, scan, sopt, alphaMeshes: 0, summary: summariseScan(scan, 0) };
      return { cache, cached: false, scan };
    }
    const alphaAware = sopt.alphaAware !== false;
    const { geometry, owner, alphaId, masks } = buildMergedGeometry(scan, moduleMesh, alphaAware);
    const alphaMeshes = scan.jobs.filter((j) => j.mask >= 0).length;
    // "scene without the trees" = prefix of the index buffer (vegetation is last). Copy BEFORE the BVH reorders the index in place.
    const wantBase = scan.vegTris > 0;
    const baseIndex = wantBase && scan.baseTris > 0 ? geometry.index.array.slice(0, scan.baseTris * 3) : null;
    const strategy = scan.tris > 600_000 ? MB.CENTER : MB.SAH;
    const bvh = new MB.MeshBVH(geometry, { strategy, maxLeafTris: 8 });
    let baseBvh = null, baseGeometry = null;
    if (baseIndex) {
      baseGeometry = new THREE.BufferGeometry();
      baseGeometry.setAttribute('position', geometry.getAttribute('position'));      // vertex data is shared, only the index differs
      if (geometry.getAttribute('uv')) baseGeometry.setAttribute('uv', geometry.getAttribute('uv'));
      baseGeometry.setIndex(new THREE.BufferAttribute(baseIndex, 1));
      baseBvh = new MB.MeshBVH(baseGeometry, { strategy: scan.baseTris > 600_000 ? MB.CENTER : MB.SAH, maxLeafTris: 8 });
    }
    cache = { sig: scan.sig, bvh, owner, alphaId, masks, baseBvh, baseGeometry, triangles: scan.tris, buildMs: nowMs() - t0, geometry, scan, sopt, alphaMeshes, summary: summariseScan(scan, alphaMeshes) };
    return { cache, cached: false, scan };
  }

  /** (ox,oy,oz,dx,dy,dz,ownerModule) → boolean, backed by a BVH over `geometry`; honours leaf alpha and skips the module's own glass. */
  function makeOccluded(bvh, geometry, c) {
    if (!bvh || !geometry) return () => false;
    const index = geometry.index.array, owner = c.owner, alphaId = c.alphaId, masks = c.masks;
    const posArr = geometry.attributes.position.array, uvAttr = geometry.getAttribute('uv'), uvArr = uvAttr ? uvAttr.array : null;
    const ray = new THREE.Ray(), o = ray.origin, d = ray.direction;
    const SIDE = THREE.DoubleSide, EPS = 1e-4;
    const bary = { u: 0, v: 0 };
    /** (u,v) of the hit: three-mesh-bvh supplies it when the geometry has a uv attribute; barycentric fallback otherwise */
    const hitUV = (hit) => {
      if (hit.uv) { bary.u = hit.uv.x; bary.v = hit.uv.y; return bary; }
      const f = hit.faceIndex * 3, a = index[f], b = index[f + 1], c2 = index[f + 2], p = hit.point;
      const ax = posArr[a * 3], ay = posArr[a * 3 + 1], az = posArr[a * 3 + 2];
      const v0x = posArr[b * 3] - ax, v0y = posArr[b * 3 + 1] - ay, v0z = posArr[b * 3 + 2] - az;
      const v1x = posArr[c2 * 3] - ax, v1y = posArr[c2 * 3 + 1] - ay, v1z = posArr[c2 * 3 + 2] - az;
      const v2x = p.x - ax, v2y = p.y - ay, v2z = p.z - az;
      const d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z, d11 = v1x * v1x + v1y * v1y + v1z * v1z;
      const d20 = v2x * v0x + v2y * v0y + v2z * v0z, d21 = v2x * v1x + v2y * v1y + v2z * v1z;
      const den = d00 * d11 - d01 * d01 || 1e-30;
      const wb = (d11 * d20 - d01 * d21) / den, wc = (d00 * d21 - d01 * d20) / den, wa = 1 - wb - wc;
      bary.u = wa * uvArr[a * 2] + wb * uvArr[b * 2] + wc * uvArr[c2 * 2];
      bary.v = wa * uvArr[a * 2 + 1] + wb * uvArr[b * 2 + 1] + wc * uvArr[c2 * 2 + 1];
      return bary;
    };
    return (ox, oy, oz, dx, dy, dz, own) => {
      o.set(ox, oy, oz); d.set(dx, dy, dz);
      for (let guard = 0; guard < 48; guard++) {
        const hit = bvh.raycastFirst(ray, SIDE, 0, Infinity);
        if (!hit) return false;
        const vi = index[hit.faceIndex * 3];
        let pass = false;
        // never let a module shade itself: continue past its own glass
        if (owner && own >= 0 && owner[vi] === own) pass = true;
        else if (alphaId) {
          const mi = alphaId[vi];
          if (mi >= 0) { const uv = hitUV(hit); pass = !maskOpaque(masks[mi], uv.u, uv.v); }   // leaf card with a hole here → light gets through
        }
        if (!pass) return true;
        o.set(hit.point.x + dx * EPS, hit.point.y + dy * EPS, hit.point.z + dz * EPS);
      }
      return true;                                  // pathological stack of cards: treat as blocked
    };
  }

  async function run(kind, daySetsFn, opts, onProgress, extraFn) {
    const myToken = ++token; active++;
    const T0 = nowMs();
    const isCancelled = () => myToken !== token;
    try {
      const p = getPrep(opts);
      if (onProgress) onProgress(0, { phase: 'prepare', message: 'Building occluder index' });
      await defaultYield();                         // let the UI paint "preparing…" before the synchronous BVH build
      if (isCancelled()) return null;
      const { cache: c, cached } = await ensureBVH(opts);
      if (isCancelled()) return null;
      if (onProgress) onProgress(0, { phase: 'trace', message: cached ? 'Tracing rays' : `Occluder index built (${c.triangles.toLocaleString('en-IN')} triangles)` });
      const daySets = daySetsFn();
      const occluded = makeOccluded(c.bvh, c.geometry, c);
      // marginal tree loss: re-test only the BLOCKED rays against the scene without the vegetation
      const attribute = c.scan.vegTris > 0;
      const occludedBase = attribute ? makeOccluded(c.baseBvh, c.baseGeometry, c) : null;
      // year runs: weight the headline loss by each module-month's PVGIS kWh, so "kWh = PVGIS x (1 - loss)" holds exactly
      let energyWeights;
      if (kind === 'year' && site.ROOF_PLANES && site.PVGIS && site.MODULE) {
        try { energyWeights = moduleMonthEnergyWeights(modules, site.ROOF_PLANES, site.PVGIS, site.MODULE.wp); } catch { energyWeights = undefined; }
      }
      const res = await runJob(p, daySets, occluded, {
        kind, sliceMs: opts.sliceMs ?? DEFAULTS.sliceMs, isCancelled, onProgress, worstCount: opts.worstCount, albedo: opts.albedo,
        extra: extraFn(daySets), occludedBase, energyWeights,
      });
      if (!res) return null;
      res.timing = {
        ...res.timing, totalMs: nowMs() - T0, bvhMs: cached ? 0 : c.buildMs, bvhCached: cached,
        triangles: c.triangles, modules: p.N, samplesPerModule: p.S,
      };
      const sum = c.summary;
      res.occluders = { ...sum, includeVegetation: c.sopt.includeVegetation !== false, includeVehicles: c.sopt.includeVehicles !== false,
        includeNeighbours: c.sopt.includeNeighbours !== false, respectVisibility: !!c.sopt.respectVisibility, alphaAware: c.sopt.alphaAware !== false };
      res.vegetation = res.vegetation || null;
      res.disclosure = buildDisclosure(sum, c.sopt, res.vegetation);
      return res;
    } finally { active--; }
  }

  const localYear = () => {
    const d = ctx.sunState && ctx.sunState.date;
    return d ? resolveDate(d, geo.utcOffsetHours).year : 2026;
  };

  const api = {
    /**
     * Analyse one local calendar day (sunrise → sunset, `opts.stepMin` = 10 min clock-aligned mid-point steps).
     * @param date {year,month,day} (IST calendar day) or a Date
     * @param opts { stepMin=10, worstCount=10, nu=4, nv=8, offset=0.02, sliceMs=12, rebuild=false,
     *               includeVegetation=true, includeVehicles=true, includeNeighbours=true, respectVisibility=false, alphaAware=true }
     * @param onProgress (fraction 0..1, {phase:'prepare'|'trace'|'done', ...})
     * @returns Promise<Result|null>   null = cancelled
     */
    runDay(date, opts = {}, onProgress) {
      const d = resolveDate(date, geo.utcOffsetHours);
      return run('day', () => [buildDaySamples(d, { stepMin: opts.stepMin ?? DEFAULTS.dayStepMin, ...geo })], opts, onProgress,
        ([ds]) => ({ date: d, sunrise: ds.sunrise, sunset: ds.sunset, solarNoon: ds.solarNoon, dayLengthHours: ds.dayLengthHours, stepMin: opts.stepMin ?? DEFAULTS.dayStepMin }));
    },
    /**
     * Analyse a typical year: the 21st (opts.day) of each month, 30-min steps (opts.stepMin), months weighted by their days.
     * @param opts { year, stepMin=30, day=21, ... same as runDay }
     */
    runYear(opts = {}, onProgress) {
      const year = opts.year ?? localYear();
      return run('year', () => buildYearSamples(year, { stepMin: opts.stepMin ?? DEFAULTS.yearStepMin, day: opts.day ?? DEFAULTS.yearDay, ...geo }), opts, onProgress,
        () => ({ year, stepMin: opts.stepMin ?? DEFAULTS.yearStepMin, day: opts.day ?? DEFAULTS.yearDay }));
    },
    /** Cancel whatever is running; its promise resolves to null. */
    cancel() { token++; },
    get running() { return active > 0; },
    /**
     * Instantaneous shading at one moment (no time integration): Float32Array(N) of shaded fractions 0..1
     * (modules facing away from the sun report 1). `when` = Date, or { azimuth, elevation } in degrees.
     * Builds the BVH on first use (synchronous). Handy for "is this module in shade right now?" overlays and tests.
     */
    async shadeAt(when, opts = {}) {
      const p = getPrep(opts);
      const { cache: c } = await ensureBVH(opts);
      let az, el;
      if (when instanceof Date) { const s = getSunPosition(when, geo.lat, geo.lng); az = s.azimuth; el = s.elevation; }
      else { az = when.azimuth; el = when.elevation; }
      if (el <= 0) return new Float32Array(p.N).fill(1);
      return shadeAtDirection(p, sunVectorWorld(az, el), makeOccluded(c.bvh, c.geometry, c), opts);
    },
    /** Change the default occluder options (includeVegetation, includeVehicles, includeNeighbours, respectVisibility, alphaAware). */
    setOptions(patch = {}) { for (const k of OCC_OPTION_KEYS) if (patch[k] !== undefined) options[k] = patch[k]; return api.getOptions(); },
    getOptions() { const r = {}; for (const k of OCC_OPTION_KEYS) r[k] = options[k]; r.includeVegetation = options.includeVegetation !== false; r.includeVehicles = options.includeVehicles !== false; r.includeNeighbours = options.includeNeighbours !== false; r.alphaAware = options.alphaAware !== false; r.respectVisibility = !!options.respectVisibility; return r; },
    /**
     * Cheap synchronous preview of what the next run will count (no BVH): same shape as `res.occluders` + `disclosure`.
     * Use it for a "Includes 363 trees · 0 vehicles" caption before the analysis is started.
     */
    describeOccluders(opts = {}) {
      const sopt = scanOptions(opts), scan = scanOccluders(getOccluders(), sopt, site);
      const alphaMeshes = scan.jobs.filter((j) => { const m = Array.isArray(j.mesh.material) ? j.mesh.material[0] : j.mesh.material; return m && m.alphaTest > 0 && m.map; }).length;
      const sum = summariseScan(scan, sopt.alphaAware === false ? 0 : alphaMeshes);
      return { ...sum, disclosure: buildDisclosure(sum, sopt, null) };
    },
    /** Force the occluder BVH to be rebuilt on the next run (call after the scene changed). */
    invalidate() { if (cache) cache.sig = '\u0000stale'; },
    /** { triangles, meshes, bvhBuilt, bvhMs, modules, samplesPerModule, trees, vehicles, categories } */
    getInfo() {
      return { triangles: cache ? cache.triangles : 0, meshes: cache ? cache.scan.jobs.length : 0, bvhBuilt: !!(cache && cache.bvh), bvhMs: cache ? cache.buildMs : 0,
        modules: prep ? prep.N : getModules().length, samplesPerModule: prep ? prep.S : DEFAULTS.nu * DEFAULTS.nv,
        trees: cache ? cache.summary.trees : 0, vehicles: cache ? cache.summary.vehicles : 0, categories: cache ? cache.summary.categories : {},
        alphaMeshes: cache ? cache.alphaMeshes : 0, baseBvhBuilt: !!(cache && cache.baseBvh) };
    },
    dispose() { token++; disposeCache(); cache = null; },
  };
  return api;
}

export default createShadingAnalyzer;
