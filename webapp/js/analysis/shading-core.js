// ============================================================================
//  shading-core.js — the PURE part of the shading analysis (no three.js, no DOM).
//  Runs under Node (see tests/shading-core.test.mjs) and in the browser.
//
//  What lives here
//   * module sample grids (nu x nv cell centres on the glass, offset along the normal)
//   * sun time-sampling for a day / for the 21st of each month
//   * plane-of-array irradiance weights (clear-sky beam via cos(incidence) + isotropic diffuse)
//   * the time-sliced driver `runJob` that asks an injected `occluded(...)` callback whether a
//     ray towards the sun is blocked, and aggregates the answers into the Result object.
//  shading.js plugs a three-mesh-bvh ray caster into `occluded`; the tests plug analytic
//  occluders (walls, boxes) into it.
//
//  Coordinates: modules are in PLAN coords (x east, y north, z up) exactly as site-data.js;
//  everything this file hands to the ray caster is in three.js WORLD coords (X east, Y up, Z south)
//  i.e. world = (x, z, -y).
// ============================================================================
import { getSunPosition, getSunTimes, dateFromLocal, sunVectorWorld, clearSkyIrradiance } from './sun.js';

export const DEFAULTS = Object.freeze({
  nu: 4,                 // sample columns across the module width
  nv: 8,                 // sample rows along the module length
  offset: 0.02,          // ray origin offset along the module normal (m)
  dayStepMin: 10,        // runDay time step
  yearStepMin: 30,       // runYear time step
  yearDay: 21,           // runYear representative day of each month
  albedo: 0.2,           // ground reflectance for the (tiny) ground-reflected term
  worstCount: 10,
  sliceMs: 12,           // yield to the browser at least this often
  lat: 13.3127, lng: 79.5703, utcOffsetHours: 5.5,
});

const RAD = Math.PI / 180;
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function daysInMonth(year, month /* 1-12 */) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** Default cooperative yield: MessageChannel in browsers (no 4 ms timer clamping), setTimeout elsewhere. */
export function defaultYield() {
  if (typeof window !== 'undefined' && typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); resolve(); }; ch.port2.postMessage(0); });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Module sample points
// ---------------------------------------------------------------------------
const p2w = (p) => [p[0], p[2], -p[1]];

/**
 * Prepare all modules for ray casting.
 * @param modules  site-data style modules: { corners:[4][x,y,z] plan (top glass), n:[x,y,z] plan normal, id, plane, building }
 *                 corners = (u0,v0) (u1,v0) (u1,v1) (u0,v1)  → width runs c0→c1, length runs c0→c3.
 * @returns {{N,S,nu,nv,offset, points:Float64Array(N*S*3), normals:Float64Array(N*3), tilt:Float64Array(N),
 *            ids:string[], planes:string[], buildings:string[]}}
 *  `points` are WORLD coordinates of the ray origins (grid cell centres, already pushed `offset` m along the normal).
 */
export function prepareModules(modules, opts = {}) {
  const nu = opts.nu ?? DEFAULTS.nu, nv = opts.nv ?? DEFAULTS.nv, offset = opts.offset ?? DEFAULTS.offset;
  const N = modules.length, S = nu * nv;
  const points = new Float64Array(N * S * 3), normals = new Float64Array(N * 3), tilt = new Float64Array(N);
  const ids = new Array(N), planes = new Array(N), buildings = new Array(N);
  for (let m = 0; m < N; m++) {
    const mod = modules[m];
    if (!mod || !mod.corners || mod.corners.length < 4) throw new Error(`shading: module ${m} has no corners`);
    const c0 = p2w(mod.corners[0]), c1 = p2w(mod.corners[1]), c3 = p2w(mod.corners[3]);
    const du = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
    const dv = [c3[0] - c0[0], c3[1] - c0[1], c3[2] - c0[2]];
    let n;
    if (mod.n) n = p2w(mod.n);
    else { // derive from the corners (right-handed u × v); make it point up
      n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
      if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    }
    const nl = Math.hypot(n[0], n[1], n[2]); n = [n[0] / nl, n[1] / nl, n[2] / nl];
    normals[m * 3] = n[0]; normals[m * 3 + 1] = n[1]; normals[m * 3 + 2] = n[2];
    tilt[m] = Math.acos(Math.min(1, Math.max(-1, n[1])));
    let k = m * S * 3;
    for (let j = 0; j < nv; j++) {
      const t = (j + 0.5) / nv;
      for (let i = 0; i < nu; i++) {
        const s = (i + 0.5) / nu;
        points[k++] = c0[0] + du[0] * s + dv[0] * t + n[0] * offset;
        points[k++] = c0[1] + du[1] * s + dv[1] * t + n[1] * offset;
        points[k++] = c0[2] + du[2] * s + dv[2] * t + n[2] * offset;
      }
    }
    ids[m] = mod.id ?? `M${m}`; planes[m] = mod.plane ?? ''; buildings[m] = mod.building ?? '';
  }
  return { N, S, nu, nv, offset, points, normals, tilt, ids, planes, buildings };
}

// ---------------------------------------------------------------------------
// Irradiance weights
// ---------------------------------------------------------------------------
/**
 * Clear-sky plane-of-array components (W/m²) for a surface with unit normal n (world) and the sun at `el` degrees.
 * beam = DNI · max(0, cos θ_incidence);  diffuse = isotropic sky + ground-reflected.
 */
export function planeIrradiance(sun, nx, ny, nz, albedo = DEFAULTS.albedo) {
  const cosInc = nx * sun.dir[0] + ny * sun.dir[1] + nz * sun.dir[2];
  const beam = cosInc > 0 ? sun.dni * cosInc : 0;
  const cosTilt = Math.min(1, Math.max(-1, ny));
  const diffuse = sun.dhi * (1 + cosTilt) / 2 + sun.ghi * albedo * (1 - cosTilt) / 2;
  return { cosInc, beam, diffuse };
}

// ---------------------------------------------------------------------------
// Sun time samples
// ---------------------------------------------------------------------------
/**
 * Mid-point time samples between sunrise and sunset of a local calendar day.
 * Interval edges lie on the local clock grid (multiples of stepMin) so each interval belongs to exactly one
 * clock hour; the first/last intervals are clipped to sunrise/sunset. Each sample carries the interval length
 * (`hours`) as its energy weight.
 */
export function buildDaySamples({ year, month, day }, opts = {}) {
  const stepMin = opts.stepMin ?? DEFAULTS.dayStepMin;
  const lat = opts.lat ?? DEFAULTS.lat, lng = opts.lng ?? DEFAULTS.lng, tz = opts.utcOffsetHours ?? DEFAULTS.utcOffsetHours;
  const dayWeight = opts.dayWeight ?? 1;
  const t = getSunTimes(dateFromLocal(year, month, day, 12, 0, tz), lat, lng, tz);
  const base = dateFromLocal(year, month, day, 0, 0, tz).getTime();
  const riseMin = (t.sunrise.getTime() - base) / 60000, setMin = (t.sunset.getTime() - base) / 60000;
  const edges = [riseMin];
  for (let m = Math.ceil(riseMin / stepMin) * stepMin; m < setMin; m += stepMin) if (m > riseMin + 1e-9) edges.push(m);
  edges.push(setMin);
  const samples = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const a = edges[k], b = edges[k + 1];
    if (b - a < 1e-6) continue;
    const mid = (a + b) / 2;
    const date = new Date(base + mid * 60000);
    const pos = getSunPosition(date, lat, lng);
    if (pos.elevation <= 0) continue;
    const ir = clearSkyIrradiance(pos.elevation);
    samples.push({
      date, minutes: mid, hour: Math.min(23, Math.floor(mid / 60)), hours: (b - a) / 60,
      azimuth: pos.azimuth, elevation: pos.elevation, dir: sunVectorWorld(pos.azimuth, pos.elevation),
      dni: ir.dni, dhi: ir.dhi, ghi: ir.ghi, month, dayWeight,
    });
  }
  return { year, month, day, sunrise: t.sunrise, sunset: t.sunset, solarNoon: t.solarNoon, dayLengthHours: t.dayLengthHours, samples };
}

/** The 21st (or opts.day) of each month, `stepMin` steps, each weighted by the days of its month. */
export function buildYearSamples(year, opts = {}) {
  const stepMin = opts.stepMin ?? DEFAULTS.yearStepMin, day = opts.day ?? DEFAULTS.yearDay;
  const sets = [];
  for (let month = 1; month <= 12; month++) {
    sets.push(buildDaySamples({ year, month, day }, { ...opts, stepMin, dayWeight: daysInMonth(year, month) }));
  }
  return sets;
}

// ---------------------------------------------------------------------------
// Accumulation & result
// ---------------------------------------------------------------------------
function makeAccumulator(N) {
  return {
    // per (month, module): Wh/m² of beam, diffuse and beam lost to shading   (index m*N + i)
    beam: new Float64Array(12 * N), diff: new Float64Array(12 * N), lost: new Float64Array(12 * N),
    // per clock hour: sums over all modules
    hBeam: new Float64Array(24), hDiff: new Float64Array(24), hLost: new Float64Array(24),
    hRays: new Float64Array(24), hShaded: new Float64Array(24),
    // beam energy lost ONLY because of the "removable" occluders (vegetation): rays that are blocked in the full scene
    // but would reach the module if those occluders were absent.  Allocated by runJob when `occludedBase` is given.
    lostVeg: null, hLostVeg: null,
    rays: 0,
  };
}

const sumRange = (arr, from, to) => { let s = 0; for (let i = from; i < to; i++) s += arr[i]; return s; };
const pct = (num, den) => (den > 0 ? (100 * num) / den : 0);

/**
 * Turn the accumulator into the public Result (see SPEC §4.6 + extras documented in shading.js).
 *
 * LOSS BASIS. Two ways of averaging the same shadows exist and they differ in the second decimal:
 *   POA    — weights = the clear-sky plane-of-array energy (beam + diffuse) of each module-month. Physical, but it is NOT
 *            what the kWh figure uses.
 *   energy — weights = the module's PVGIS kWh of that month (what energy.js multiplies by (1 - loss)).
 * A year result with `meta.energyWeights` (Float64Array(12*N), un-shaded kWh per module-month) reports the headline
 * `arrayLossPct`, `perPlaneLossPct`, `perBuildingLossPct`, `monthly[].lossPct` and `vegetation.*` on the ENERGY basis, so
 * "annual kWh = PVGIS kWh x (1 - arrayLossPct)" holds exactly and every table in the UI agrees. The POA-weighted twins are kept as
 * `arrayPoaLossPct`, `perPlanePoaLossPct`, `perBuildingPoaLossPct`, `monthly[].poaLossPct` (`lossBasis` says which one is the headline).
 * Day runs (and runs without weights) stay on the POA basis: a single day has no PVGIS month to weight by.
 */
export function finalizeResult(acc, prep, meta) {
  const { N } = prep;
  const ew = meta.kind === 'year' && meta.energyWeights && meta.energyWeights.length === 12 * N ? meta.energyWeights : null;
  // energy-basis aggregates: w = un-shaded kWh, l = kWh lost, v = kWh lost to the removable occluders (trees)
  const E = ew ? { tot: { w: 0, l: 0, v: 0 }, plane: {}, building: {}, month: Array.from({ length: 12 }, () => ({ w: 0, l: 0, v: 0 })) } : null;
  const addE = (a, w, l, v) => { a.w += w; a.l += l; a.v += v; };
  const perModule = new Float32Array(N), perModuleLoss = new Float32Array(N);
  const perModuleMonthly = meta.kind === 'year' ? new Float32Array(12 * N) : null;
  let totBeam = 0, totDiff = 0, totLost = 0;
  const planeAgg = {}, buildingAgg = {};
  const lv = acc.lostVeg || null;                                  // vegetation-only loss (optional attribution)
  const perModuleVeg = lv ? new Float32Array(N) : null;
  let totLostVeg = 0;
  const planeVeg = {}, buildingVeg = {};
  const monthAgg = Array.from({ length: 12 }, () => ({ beam: 0, diff: 0, lost: 0 }));
  const planeMonth = {};
  for (let i = 0; i < N; i++) {
    let b = 0, d = 0, l = 0;
    for (let m = 0; m < 12; m++) {
      const bi = acc.beam[m * N + i], di = acc.diff[m * N + i], li = acc.lost[m * N + i];
      // days weighting is already inside the accumulated values (dayWeight), so annual = plain sum over months
      b += bi; d += di; l += li;
      monthAgg[m].beam += bi; monthAgg[m].diff += di; monthAgg[m].lost += li;
      if (perModuleMonthly) perModuleMonthly[m * N + i] = (bi + di) > 0 ? li / (bi + di) : 0;
      if (E && (bi + di) > 0) {
        const w = ew[m * N + i], f = li / (bi + di), fv = lv ? lv[m * N + i] / (bi + di) : 0;
        addE(E.tot, w, w * f, w * fv);
        addE(E.plane[prep.planes[i]] || (E.plane[prep.planes[i]] = { w: 0, l: 0, v: 0 }), w, w * f, w * fv);
        addE(E.building[prep.buildings[i]] || (E.building[prep.buildings[i]] = { w: 0, l: 0, v: 0 }), w, w * f, w * fv);
        addE(E.month[m], w, w * f, w * fv);
      }
      const pm = (planeMonth[prep.planes[i]] ||= Array.from({ length: 12 }, () => ({ beam: 0, diff: 0, lost: 0 })));
      pm[m].beam += bi; pm[m].diff += di; pm[m].lost += li;
    }
    perModule[i] = b > 0 ? l / b : 0;
    perModuleLoss[i] = (b + d) > 0 ? l / (b + d) : 0;
    totBeam += b; totDiff += d; totLost += l;
    if (lv) {
      let v = 0; for (let m = 0; m < 12; m++) v += lv[m * N + i];
      perModuleVeg[i] = b > 0 ? v / b : 0; totLostVeg += v;
      planeVeg[prep.planes[i]] = (planeVeg[prep.planes[i]] || 0) + v;
      buildingVeg[prep.buildings[i]] = (buildingVeg[prep.buildings[i]] || 0) + v;
    }
    const pa = (planeAgg[prep.planes[i]] ||= { beam: 0, diff: 0, lost: 0, n: 0 });
    pa.beam += b; pa.diff += d; pa.lost += l; pa.n++;
    const ba = (buildingAgg[prep.buildings[i]] ||= { beam: 0, diff: 0, lost: 0, n: 0 });
    ba.beam += b; ba.diff += d; ba.lost += l; ba.n++;
  }
  const perPlaneLossPct = {}, perPlaneBeamLossPct = {}, perBuildingLossPct = {}, perPlaneMonthlyLossPct = {};
  for (const [k, v] of Object.entries(planeAgg)) { perPlaneLossPct[k] = pct(v.lost, v.beam + v.diff); perPlaneBeamLossPct[k] = pct(v.lost, v.beam); }
  for (const [k, v] of Object.entries(buildingAgg)) perBuildingLossPct[k] = pct(v.lost, v.beam + v.diff);
  for (const [k, arr] of Object.entries(planeMonth)) perPlaneMonthlyLossPct[k] = arr.map((v) => pct(v.lost, v.beam + v.diff));
  // POA-basis twins (kept under *Poa* names when the headline moves to the energy basis)
  const arrayPoaLoss = pct(totLost, totBeam + totDiff);
  const perPlanePoaLossPct = { ...perPlaneLossPct }, perBuildingPoaLossPct = { ...perBuildingLossPct };
  if (E) {
    for (const [k, v] of Object.entries(E.plane)) perPlaneLossPct[k] = pct(v.l, v.w);
    for (const [k, v] of Object.entries(E.building)) perBuildingLossPct[k] = pct(v.l, v.w);
  }

  // worst modules (by the same beam-weighted shaded fraction that colours the heatmap)
  const order = Array.from({ length: N }, (_, i) => i).filter((i) => perModule[i] > 0).sort((a, b) => perModule[b] - perModule[a]);
  const worst = order.slice(0, meta.worstCount ?? DEFAULTS.worstCount).map((i) => ({
    index: i, id: prep.ids[i], plane: prep.planes[i], pct: 100 * perModule[i], lossPct: 100 * perModuleLoss[i],
  }));

  const hourly = [];
  for (let h = 0; h < 24; h++) {
    const poa = acc.hBeam[h] + acc.hDiff[h];
    if (poa <= 0) continue;
    hourly.push({
      hour: h, label: `${String(h).padStart(2, '0')}:00`,
      poaWhm2: poa / N, lostWhm2: acc.hLost[h] / N,
      lossPct: pct(acc.hLost[h], poa), beamLossPct: pct(acc.hLost[h], acc.hBeam[h]),
      shadedPct: pct(acc.hShaded[h], acc.hRays[h]),
    });
  }

  const result = {
    kind: meta.kind,
    perModule,                                        // beam-weighted shaded fraction 0..1 (heatmap values)
    perModuleLoss,                                    // share of total plane-of-array energy lost 0..1
    // HEADLINE: energy-weighted for year runs (== energy.js lossPct, so kWh = PVGIS x (1 - this)); POA-weighted otherwise
    arrayLossPct: E ? pct(E.tot.l, E.tot.w) : arrayPoaLoss,
    lossBasis: E ? 'energy' : 'poa',                  // which weighting arrayLossPct / perPlaneLossPct / perBuildingLossPct use
    arrayPoaLossPct: arrayPoaLoss,                    // % of total (beam + diffuse) clear-sky POA energy lost
    arrayBeamLossPct: pct(totLost, totBeam),          // % of beam energy lost
    perPlaneLossPct, perPlanePoaLossPct, perPlaneBeamLossPct, perBuildingLossPct, perBuildingPoaLossPct,
    worst, hourly,
    irradiation: {                                    // mean over modules, kWh/m² over the analysed period
      beamKWhm2: totBeam / N / 1000, diffuseKWhm2: totDiff / N / 1000, lostKWhm2: totLost / N / 1000,
    },
    samplesPerModule: prep.S, modules: N,
    ...meta.extra,
  };
  if (lv) {
    // Marginal effect of the removable occluders (trees): "loss with" minus "loss without", measured ray by ray.
    // (same basis as the headline: energy-weighted for year runs, POA-weighted otherwise)
    const tot = totBeam + totDiff;
    const vegPlane = {}, vegBuilding = {};
    let vegLoss, vegShare, vegWithout;
    if (E) {
      for (const [k, v] of Object.entries(E.plane)) vegPlane[k] = pct(v.v, v.w);
      for (const [k, v] of Object.entries(E.building)) vegBuilding[k] = pct(v.v, v.w);
      vegLoss = pct(E.tot.v, E.tot.w); vegShare = pct(E.tot.v, E.tot.l); vegWithout = pct(E.tot.l - E.tot.v, E.tot.w);
    } else {
      for (const [k, v] of Object.entries(planeAgg)) vegPlane[k] = pct(planeVeg[k] || 0, v.beam + v.diff);
      for (const [k, v] of Object.entries(buildingAgg)) vegBuilding[k] = pct(buildingVeg[k] || 0, v.beam + v.diff);
      vegLoss = pct(totLostVeg, tot); vegShare = pct(totLostVeg, totLost); vegWithout = pct(totLost - totLostVeg, tot);
    }
    result.vegetation = {
      lossPct: vegLoss,                                            // loss caused solely by the vegetation (percentage points)
      beamLossPct: pct(totLostVeg, totBeam),
      sharePct: vegShare,                                          // share of the headline loss that disappears without it
      lossWithoutPct: vegWithout,                                  // headline loss if the vegetation were absent
      perPlaneLossPct: vegPlane, perBuildingLossPct: vegBuilding,
      perModule: perModuleVeg,                                     // beam-weighted fraction shaded ONLY by vegetation 0..1
      basis: result.lossBasis,
    };
  }
  if (meta.kind === 'year') {
    result.monthly = monthAgg.map((v, m) => ({
      month: m + 1, name: MONTH_NAMES[m],
      lossPct: E ? pct(E.month[m].l, E.month[m].w) : pct(v.lost, v.beam + v.diff),   // same basis as the headline
      poaLossPct: pct(v.lost, v.beam + v.diff), beamLossPct: pct(v.lost, v.beam),
      poaKWhm2: (v.beam + v.diff) / N / 1000,         // mean per-module irradiation of the whole month
    }));
    result.perPlaneMonthlyLossPct = perPlaneMonthlyLossPct;
    result.perModuleMonthlyLoss = perModuleMonthly;   // Float32Array(12*N), index month0*N + i : fraction of POA lost
  }
  return result;
}

// ---------------------------------------------------------------------------
// The time-sliced driver
// ---------------------------------------------------------------------------
/**
 * @param prep         from prepareModules()
 * @param daySets      array of buildDaySamples() results (1 for a day, 12 for a year)
 * @param occluded     (ox,oy,oz, dx,dy,dz, ownerModuleIndex) => boolean   (world coords; direction is a unit vector to the sun)
 * @param o            { kind, sliceMs, yieldFn, onProgress(fraction, info), isCancelled(), worstCount, extra,
 *                       energyWeights?: Float64Array(12*N) un-shaded kWh per module-month (year runs: energy-weighted headline) }
 * @returns Promise<Result|null>  (null when cancelled)
 */
export async function runJob(prep, daySets, occluded, o = {}) {
  const { N, S, points, normals } = prep;
  const sliceMs = o.sliceMs ?? DEFAULTS.sliceMs, yieldFn = o.yieldFn ?? defaultYield;
  const isCancelled = o.isCancelled ?? (() => false);
  const steps = [];
  for (const ds of daySets) for (const s of ds.samples) steps.push(s);
  const total = steps.length * N;
  const acc = makeAccumulator(N);
  // optional: same ray tested against the scene WITHOUT the removable occluders (trees) -> marginal tree loss
  const occludedBase = typeof o.occludedBase === 'function' ? o.occludedBase : null;
  if (occludedBase) { acc.lostVeg = new Float64Array(12 * N); acc.hLostVeg = new Float64Array(24); }
  const albedo = o.albedo ?? DEFAULTS.albedo;
  let done = 0, sliceStart = now(), yields = 0;
  const t0 = now();
  const report = (info) => { if (o.onProgress) o.onProgress(total ? done / total : 1, info); };

  for (let k = 0; k < steps.length; k++) {
    const sun = steps[k];
    const dx = sun.dir[0], dy = sun.dir[1], dz = sun.dir[2];
    const mi = sun.month - 1, h = sun.hour, w = sun.hours * sun.dayWeight;
    for (let i = 0; i < N; i++) {
      const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
      const ir = planeIrradiance(sun, nx, ny, nz, albedo);
      const slot = mi * N + i;
      const diffWh = ir.diffuse * w;
      acc.diff[slot] += diffWh; acc.hDiff[h] += diffWh;
      if (ir.beam > 0) {
        let shaded = 0, vegOnly = 0;
        const base = i * S * 3;
        for (let s = 0; s < S; s++) {
          const q = base + s * 3;
          if (occluded(points[q], points[q + 1], points[q + 2], dx, dy, dz, i)) {
            shaded++;
            if (occludedBase && !occludedBase(points[q], points[q + 1], points[q + 2], dx, dy, dz, i)) vegOnly++;
          }
        }
        acc.rays += S;
        const beamWh = ir.beam * w, frac = shaded / S;
        if (vegOnly) { const lw = beamWh * vegOnly / S; acc.lostVeg[slot] += lw; acc.hLostVeg[h] += lw; }
        acc.beam[slot] += beamWh; acc.lost[slot] += beamWh * frac;
        acc.hBeam[h] += beamWh; acc.hLost[h] += beamWh * frac;
        acc.hRays[h] += S; acc.hShaded[h] += shaded;
      }
      done++;
      if (now() - sliceStart >= sliceMs) {
        report({ phase: 'trace', step: k, steps: steps.length });
        await yieldFn(); yields++;
        if (isCancelled()) return null;
        sliceStart = now();
      }
    }
  }
  if (isCancelled()) return null;
  const traceMs = now() - t0;
  const result = finalizeResult(acc, prep, { kind: o.kind ?? (daySets.length > 1 ? 'year' : 'day'), worstCount: o.worstCount, extra: o.extra, energyWeights: o.energyWeights });
  result.timing = { traceMs, rays: acc.rays, raysPerSec: acc.rays / Math.max(traceMs / 1000, 1e-9), steps: steps.length, yields, sliceMs };
  report({ phase: 'done' });
  return result;
}

/**
 * Instant (single sun direction) shaded fraction per module: fraction of its sample points whose ray to the sun is
 * blocked, 0..1. `dir` is a world unit vector. Modules facing away from the sun return 1 (they receive no beam) unless
 * opts.backfaceAsShaded === false, then 0.
 */
export function shadeAtDirection(prep, dir, occluded, opts = {}) {
  const { N, S, points, normals } = prep;
  const out = new Float32Array(N);
  const away = opts.backfaceAsShaded === false ? 0 : 1;
  for (let i = 0; i < N; i++) {
    const cos = normals[i * 3] * dir[0] + normals[i * 3 + 1] * dir[1] + normals[i * 3 + 2] * dir[2];
    if (cos <= 0) { out[i] = away; continue; }
    let shaded = 0; const base = i * S * 3;
    for (let s = 0; s < S; s++) {
      const q = base + s * 3;
      if (occluded(points[q], points[q + 1], points[q + 2], dir[0], dir[1], dir[2], i)) shaded++;
    }
    out[i] = shaded / S;
  }
  return out;
}

/** Convenience used by shading.js and the tests. */
export function resolveDate(d, tz = DEFAULTS.utcOffsetHours) {
  if (d instanceof Date) {
    const x = new Date(d.getTime() + tz * 3600e3);
    return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() };
  }
  if (d && typeof d === 'object') return { year: d.year, month: d.month, day: d.day };
  throw new Error('shading: expected {year,month,day} or a Date');
}
