// ============================================================================
//  ENVIRONMENT builder (SPEC §4.5)
//  buildEnvironment(ctx) → { group, ground, setSatelliteVisible, setVegetationVisible,
//                            setVehiclesVisible, setContextVisible, attribution, satellite }
//  Files: ground.js (ground disc + shader blend), satellite.js (Esri mosaic),
//         layout.js (roads/puddles/zones), trees.js, scrub.js, vehicles.js, context.js
// ============================================================================
import { buildGround } from './ground.js';
import { loadSatellite, ATTRIBUTION } from './satellite.js';
import { buildTrees } from './trees.js';
import { buildScrub } from './scrub.js';
import { buildVehicles } from './vehicles.js';
import { buildContext } from './context.js';
import { WIND } from './util.js';

const SAT_TILES = { high: 8, medium: 6, low: 4 };
const CONTEXT_TREES = { high: 360, medium: 200, low: 80 };

export async function buildEnvironment(ctx) {
  const { THREE, site } = ctx;
  const quality = ctx.quality || 'high';
  const group = new THREE.Group(); group.name = 'environment';

  // ---- satellite request starts first (network in parallel with canvas painting) ----
  const satRaw = loadSatellite(site.SITE, { tiles: SAT_TILES[quality] || 8 })
    .catch((e) => ({ ok: false, error: e }));

  // ---- ground ----
  const ground = buildGround(ctx);
  group.add(ground.mesh);

  const vegetation = new THREE.Group(); vegetation.name = 'env-vegetation';
  const vehicles = new THREE.Group(); vehicles.name = 'env-vehicles';
  const context = new THREE.Group(); context.name = 'env-context';
  const satTrees = new THREE.Group(); satTrees.name = 'env-context-trees';
  vegetation.add(satTrees);
  group.add(vegetation, vehicles, context);

  const safe = (name, fn) => { try { return fn(); } catch (e) { console.error(`[env] ${name} failed`, e); return null; } };
  const trees = safe('trees', () => buildTrees(ctx, vegetation));
  safe('scrub', () => buildScrub(ctx, vegetation));
  safe('vehicles', () => buildVehicles(ctx, vehicles));
  const ctxBuild = safe('context', () => buildContext(ctx, context));

  // ---- satellite: apply + derive context (houses / canopy trees) ----
  let satVisible = true;
  const satPromise = satRaw.then((sat) => {
    if (!sat.ok) {
      console.warn('[env] satellite imagery unavailable — using procedural context ground');
      return { ok: false };
    }
    ground.applySatellite(sat);
    ground.uniforms.uSatOn.value = satVisible ? 1 : 0;
    let info = { trees: 0, houses: 0 };
    try {
      if (ctxBuild) {
        const res = ctxBuild.fromSatellite(sat, { maxTrees: CONTEXT_TREES[quality] ?? 200 });
        info.houses = res.houses;
        if (ground.uniforms.uSat.value) ground.uniforms.uSat.value.needsUpdate = true; // imagery roofs under 3D houses were painted out
        if (trees && res.trees.length) trees.buildContextTrees(res.trees, satTrees);
        info.trees = res.trees.length;
      }
    } catch (e) { console.error('[env] satellite context failed', e); }
    return { ok: true, loaded: sat.loaded, failed: sat.failed, bounds: sat.layout.bounds, ...info };
  });
  // (the core app waits briefly for satPromise before revealing the scene, so the tiles download
  //  while the other builders run instead of blocking here)

  // ---- runtime quality → instance/LOD budget (Tools ▸ Quality mutates ctx.quality without a rebuild) ----
  // share of the instances kept per preset; relative to the preset the scene was built with.
  const LOD = {
    'env-tufts': { high: 1, medium: 0.45, low: 0.12 },
    'env-shrubs': { high: 1, medium: 0.6, low: 0.3 },
    'env-rubble': { high: 1, medium: 0.5, low: 0 },
    'context-tree-trunks': { high: 1, medium: 0.6, low: 0.35 },
    'context-tree-crowns': { high: 1, medium: 0.6, low: 0.35 },
    '*': { high: 1, medium: 0.7, low: 0.45 },
  };
  const builtQ = quality;
  let appliedQ = builtQ;
  const applyLod = (q) => {
    vegetation.traverse((o) => {
      if (!o.isInstancedMesh) return;
      if (o.userData.lodBase === undefined) o.userData.lodBase = o.count;
      if (o.name === 'env-soil-heaps') return;
      const f = LOD[o.name] || LOD['*'];
      const k = Math.min(1, (f[q] ?? 1) / (f[builtQ] || 1));
      o.count = Math.max(0, Math.min(o.userData.lodBase, Math.round(o.userData.lodBase * k)));
      o.visible = o.count > 0;
    });
    // small props (motorbikes, drums, tyres share merged meshes) stay; vehicles are cheap merged meshes
    appliedQ = q;
  };
  ctx.registerAnimated((dt, t) => {
    WIND.uTime.value = t;
    if (ctx.quality && ctx.quality !== appliedQ) { try { applyLod(ctx.quality); } catch (e) { console.warn('[env] lod', e); } }
  });
  satPromise.then(() => { if (appliedQ !== builtQ) applyLod(appliedQ); });  // context trees arrive late

  return {
    group,
    ground: ground.mesh,
    attribution: ATTRIBUTION,
    satellite: satPromise,
    setSatelliteVisible(v) { satVisible = !!v; ground.uniforms.uSatOn.value = v && ground.uniforms.uSatB.value.z > 1 ? 1 : 0; },
    setVegetationVisible(v) { vegetation.visible = !!v; },
    setVehiclesVisible(v) { vehicles.visible = !!v; },
    setContextVisible(v) { context.visible = !!v; satTrees.visible = !!v; },
    setWind(strength) { WIND.uStrength.value = strength; },
    /** apply the instance budget for a quality preset now (also happens automatically when ctx.quality changes) */
    setQuality(q) { applyLod(q); },
    /** dev only: show raw satellite everywhere (georeferencing check) */
    _debugSatelliteEverywhere(v) { ground.uniforms.uSatFull.value = v ? 1 : 0; },
  };
}
