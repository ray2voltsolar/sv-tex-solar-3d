// ============================================================================
//  shading-core.js tests — run:  node webapp/js/analysis/tests/shading-core.test.mjs
//  Pure-math pipeline (sample grid, sun time-sampling, weighting, aggregation, driver, cancel)
//  exercised with ANALYTIC occluders (infinite wall / ray-box slab test) whose answer is known in closed form.
//  The BVH ray caster itself is verified in the browser: webapp/dev/shading-test.html
// ============================================================================
import * as site from '../../site-data.js';
import { getSunPosition, dateFromLocal, sunVectorWorld, clearSkyIrradiance } from '../sun.js';
import {
  prepareModules, planeIrradiance, buildDaySamples, buildYearSamples, runJob, shadeAtDirection, daysInMonth, resolveDate, DEFAULTS,
} from '../shading-core.js';
import { check, near, section, done, RAD } from './testkit.mjs';

const LAT = site.SITE.lat, LNG = site.SITE.lng, TZ = site.SITE.utcOffsetHours;
const layout = site.computeLayout();
const W = site.MODULE.width, L = site.MODULE.length;

// a synthetic flat/tilted module in plan coords (corners (u0,v0) (u1,v0) (u1,v1) (u0,v1))
function synthModule(id, x0, y0, z0, tiltDeg, plane = 'P', facing = 'S') {
  // tilt about the x axis (eave runs along x), up-slope towards +y when facing south... keep generic:
  const t = tiltDeg * RAD;
  const u = [1, 0, 0], v = [0, Math.cos(t), Math.sin(t)];          // v: up-slope towards north (module faces SOUTH ... n below)
  // face south: normal = u x v flipped to point up
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; // = (0, -sin t, cos t)... check sign
  if (n[2] < 0) n = n.map((c) => -c);
  const P = (a, b) => [x0 + u[0] * a + v[0] * b, y0 + u[1] * a + v[1] * b, z0 + u[2] * a + v[2] * b];
  return { id, plane, building: 'T', corners: [P(0, 0), P(W, 0), P(W, L), P(0, L)], n, facing };
}

// ===========================================================================
section('prepareModules: sample grid geometry');
{
  const prep = prepareModules(layout);
  check('N = 234, S = 32', prep.N === 234 && prep.S === 32);
  let maxPlane = 0, maxBounds = 0, maxCentre = 0, maxSpacing = 0, maxNorm = 0;
  for (let i = 0; i < prep.N; i += 1) {
    const m = layout[i], c0 = [m.corners[0][0], m.corners[0][2], -m.corners[0][1]];
    const n = [m.n[0], m.n[2], -m.n[1]];
    maxNorm = Math.max(maxNorm, Math.abs(Math.hypot(prep.normals[i * 3], prep.normals[i * 3 + 1], prep.normals[i * 3 + 2]) - 1));
    // module frame in world
    const toW = (p) => [p[0], p[2], -p[1]];
    const c1 = toW(m.corners[1]), c3 = toW(m.corners[3]);
    const ux = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]], vx = [c3[0] - c0[0], c3[1] - c0[1], c3[2] - c0[2]];
    const lu = Math.hypot(...ux), lv = Math.hypot(...vx);
    const eu = ux.map((c) => c / lu), ev = vx.map((c) => c / lv);
    let mean = [0, 0, 0];
    for (let s = 0; s < prep.S; s++) {
      const q = (i * prep.S + s) * 3;
      const p = [prep.points[q], prep.points[q + 1], prep.points[q + 2]];
      const d = [p[0] - c0[0], p[1] - c0[1], p[2] - c0[2]];
      const hN = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      maxPlane = Math.max(maxPlane, Math.abs(hN - 0.02));                    // 2 cm above glass
      const a = d[0] * eu[0] + d[1] * eu[1] + d[2] * eu[2], b = d[0] * ev[0] + d[1] * ev[1] + d[2] * ev[2];
      if (a < 0 || a > lu || b < 0 || b > lv) maxBounds = Math.max(maxBounds, 1);
      // expected local coords (cell centres)
      const ci = s % 4, cj = Math.floor(s / 4);
      maxSpacing = Math.max(maxSpacing, Math.abs(a - (ci + 0.5) * lu / 4), Math.abs(b - (cj + 0.5) * lv / 8));
      mean = mean.map((c, k) => c + p[k] / prep.S);
    }
    const cen = site.planToWorldArray(...m.center);
    maxCentre = Math.max(maxCentre, Math.hypot(mean[0] - (cen[0] + n[0] * 0.02), mean[1] - (cen[1] + n[1] * 0.02), mean[2] - (cen[2] + n[2] * 0.02)));
  }
  check('normals are unit', maxNorm < 1e-12, maxNorm);
  near('all sample points sit exactly 2 cm above the glass plane', maxPlane, 0, 1e-9);
  check('all sample points inside the module rectangle', maxBounds === 0);
  near('grid is 4 x 8 cell centres (u: W/4, v: L/8)', maxSpacing, 0, 1e-9);
  near('mean of samples = module centre + 2 cm normal', maxCentre, 0, 1e-9);
  // tilt
  near('tilt of A-W module (rad)', prep.tilt[0], site.ROOF_PLANES['A-W'].tiltDeg * RAD, 1e-9);
  check('plane / building / id mapping', prep.planes[0] === layout[0].plane && prep.ids[5] === layout[5].id && prep.buildings[0] === layout[0].building);
  // derived normal when n is missing equals the supplied normal
  const noN = layout.slice(0, 5).map((m) => ({ ...m, n: undefined }));
  const p2 = prepareModules(noN); let dn = 0;
  for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) dn = Math.max(dn, Math.abs(p2.normals[i * 3 + k] - prep.normals[i * 3 + k]));
  near('normal derived from corners = site-data normal', dn, 0, 1e-9);
  // custom grid
  const p3 = prepareModules(layout.slice(0, 2), { nu: 2, nv: 3, offset: 0.05 });
  check('custom grid size', p3.S === 6 && p3.points.length === 2 * 6 * 3);
}

// ===========================================================================
section('Irradiance weights');
{
  const sun = { dir: sunVectorWorld(180, 90), ...clearSkyIrradiance(90) };
  const flat = planeIrradiance(sun, 0, 1, 0);
  near('flat plane, sun at zenith: beam = DNI', flat.beam, sun.dni, 1e-9);
  near('flat plane: diffuse = DHI', flat.diffuse, sun.dhi, 1e-9);
  const el = 30, s2 = { dir: sunVectorWorld(180, el), ...clearSkyIrradiance(el) };
  const south = [0, Math.cos(60 * RAD), Math.sin(60 * RAD)];     // plane tilted 60 deg facing south (world: Z south)
  const t = planeIrradiance(s2, ...south);
  near('60 deg south tilt, sun el 30 due south: cos(inc) = 1', t.cosInc, 1, 1e-9);
  near('beam = DNI * cos', t.beam, s2.dni, 1e-9);
  const vert = planeIrradiance(s2, 0, 0, 1);                      // vertical, facing south
  near('vertical plane diffuse = DHI/2 + 0.2*GHI/2', vert.diffuse, s2.dhi / 2 + 0.2 * s2.ghi / 2, 1e-9);
  const back = planeIrradiance(s2, 0, 0, -1);
  check('plane facing away gets no beam', back.beam === 0 && back.cosInc < 0);
}

// ===========================================================================
section('Day / year sun sampling');
{
  const ds = buildDaySamples({ year: 2026, month: 12, day: 21 });
  const sumH = ds.samples.reduce((a, s) => a + s.hours, 0);
  // the very first minutes after sunrise can have an apparent (refracted) centre elevation < 0 and are skipped: < 1 min of energy-free time
  check('sum of interval hours = day length within 1 min (sunrise/sunset slivers skipped)', sumH <= ds.dayLengthHours + 1e-9 && ds.dayLengthHours - sumH < 1 / 60, `${sumH} vs ${ds.dayLengthHours}`);
  check('10-min grid: ~68-70 samples on 21 Dec', ds.samples.length >= 67 && ds.samples.length <= 70, ds.samples.length);
  check('all samples above the horizon, unit vectors', ds.samples.every((s) => s.elevation > 0 && Math.abs(Math.hypot(...s.dir) - 1) < 1e-12));
  check('hour field matches the clock', ds.samples.every((s) => Math.floor(s.minutes / 60) === s.hour));
  // interior intervals are exactly 10 min
  const interior = ds.samples.slice(1, -1);
  check('interior intervals are 10 min (1/6 h)', interior.every((s) => Math.abs(s.hours - 1 / 6) < 1e-9));
  // first/last are clipped to sunrise/sunset
  check('first interval ends on the clock grid', ds.samples[0].hours <= 1 / 6 + 1e-9);
  const noon = ds.samples.reduce((a, s) => (s.elevation > a.elevation ? s : a));
  near('highest sample is within 10 min of solar noon', (noon.date - ds.solarNoon) / 60000, 0, 6);
  // matches sun.js at the sample time
  const s0 = ds.samples[20], p0 = getSunPosition(s0.date, LAT, LNG);
  near('sample azimuth = sun.js', s0.azimuth, p0.azimuth, 1e-9); near('sample elevation = sun.js', s0.elevation, p0.elevation, 1e-9);
  // different step
  const d30 = buildDaySamples({ year: 2026, month: 12, day: 21 }, { stepMin: 30 });
  check('30-min step has ~23 samples', d30.samples.length >= 22 && d30.samples.length <= 24, d30.samples.length);
  near('30-min step covers the same time span', d30.samples.reduce((a, s) => a + s.hours, 0), sumH, 1 / 60);
  // year
  const ys = buildYearSamples(2026);
  check('12 months', ys.length === 12);
  check('dayWeight = days in month (Feb 2026 = 28, Feb 2028 = 29)', ys[1].samples[0].dayWeight === 28 && daysInMonth(2028, 2) === 29);
  near('sum of day weights = 365', ys.reduce((a, s) => a + s.samples[0].dayWeight, 0), 365, 0);
  check('every month on the 21st', ys.every((s, i) => s.day === 21 && s.month === i + 1));
  check('year samples ~ 22-26 per month at 30 min', ys.every((s) => s.samples.length >= 22 && s.samples.length <= 27), ys.map((s) => s.samples.length).join(','));
  // resolveDate
  const rd = resolveDate(dateFromLocal(2026, 12, 21, 23, 30)); check('resolveDate(Date) uses IST calendar day', rd.year === 2026 && rd.month === 12 && rd.day === 21);
  const rd2 = resolveDate({ year: 2026, month: 3, day: 20 }); check('resolveDate(object)', rd2.month === 3 && rd2.day === 20);
}

// ---------------------------------------------------------------------------
// helpers for the analytic tests
// ---------------------------------------------------------------------------
/** analytic infinite N-S wall at world X = xw spanning heights [0, H]; blocks rays heading towards -X (sun in the west) */
const westWall = (xw, H) => (ox, oy, oz, dx, dy, dz) => {
  if (dx >= 0) return false;
  const t = (xw - ox) / dx;
  if (t <= 0) return false;
  const h = oy + t * dy;
  return h >= 0 && h <= H;
};
/** analytic axis-aligned box ray test (slab method) */
const boxOccluder = (min, max) => (ox, oy, oz, dx, dy, dz) => {
  let t0 = 0, t1 = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-14) { if (o[a] < min[a] || o[a] > max[a]) return false; continue; }
    let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
};

/** Independent 1-minute integration of beam & diffuse for ONE module (n in world), blocked(frac) supplied by the test */
function bruteForce(nW, fracFn, { stepMin = 1, date = { year: 2026, month: 12, day: 21 } } = {}) {
  const base = dateFromLocal(date.year, date.month, date.day, 0, 0, TZ).getTime();
  let beam = 0, diff = 0, lost = 0;
  for (let m = 0; m < 1440; m += stepMin) {
    const d = new Date(base + (m + stepMin / 2) * 60000);
    const p = getSunPosition(d, LAT, LNG);
    if (p.elevation <= 0) continue;
    const ir = clearSkyIrradiance(p.elevation);
    const dir = sunVectorWorld(p.azimuth, p.elevation);
    const cos = nW[0] * dir[0] + nW[1] * dir[1] + nW[2] * dir[2];
    const b = cos > 0 ? ir.dni * cos : 0;
    const ct = nW[1];
    const df = ir.dhi * (1 + ct) / 2 + ir.ghi * 0.2 * (1 - ct) / 2;
    const f = b > 0 ? fracFn(dir, p) : 0;
    beam += b * stepMin / 60; diff += df * stepMin / 60; lost += b * f * stepMin / 60;
  }
  return { beam, diff, lost };
}

// ===========================================================================
section('Analytic: unobstructed and fully obstructed modules (weights + aggregation)');
{
  const mods = [synthModule('F', 0, 0, 0, 0), synthModule('T', 10, 0, 0, 13)];     // flat + 13 deg
  const prep = prepareModules(mods);
  const day = buildDaySamples({ year: 2026, month: 12, day: 21 });
  const free = await runJob(prep, [day], () => false, { kind: 'day' });
  check('free: perModule all zero', free.perModule.every((v) => v === 0));
  near('free: arrayLossPct', free.arrayLossPct, 0, 1e-12);
  check('free: worst list empty', free.worst.length === 0);
  check('free: hourly lost = 0', free.hourly.every((h) => h.lossPct === 0));
  check('result types', free.perModule instanceof Float32Array && Array.isArray(free.hourly) && free.timing && typeof free.timing.traceMs === 'number');
  // independent integration of beam/diffuse for the two modules
  const bfF = bruteForce([0, 1, 0], () => 0), bfT = bruteForce([...mods[1].n].length ? [mods[1].n[0], mods[1].n[2], -mods[1].n[1]] : null, () => 0);
  const kWhm2 = (free.irradiation.beamKWhm2 + free.irradiation.diffuseKWhm2) * 1000 * 2;      // Wh/m2 summed over both modules
  near('beam+diffuse over the day vs 1-minute brute force (0.3 %)', kWhm2 / (bfF.beam + bfF.diff + bfT.beam + bfT.diff), 1, 0.003);
  near('beam irradiation vs brute force (0.3 %)', free.irradiation.beamKWhm2 * 2000 / (bfF.beam + bfT.beam), 1, 0.003);

  const full = await runJob(prep, [day], () => true, { kind: 'day' });
  check('full shade: perModule = 1', full.perModule.every((v) => Math.abs(v - 1) < 1e-6));
  const expLoss = 100 * (bfF.beam + bfT.beam) / (bfF.beam + bfF.diff + bfT.beam + bfT.diff);
  near('full shade: arrayLossPct = beam share of POA', full.arrayLossPct, expLoss, 0.3);
  near('full shade: arrayBeamLossPct = 100', full.arrayBeamLossPct, 100, 1e-9);
  check('full shade: worst has both modules, sorted', full.worst.length === 2 && full.worst[0].pct >= full.worst[1].pct && full.worst[0].index !== undefined && typeof full.worst[0].id === 'string');
  // hourly loss rises towards midday (diffuse share falls); sum of hourly lost = array lost
  const lostSum = full.hourly.reduce((a, h) => a + h.lostWhm2, 0);
  near('hourly lost sums to array lost', lostSum / (full.irradiation.lostKWhm2 * 1000), 1, 1e-9);
  check('hourly covers 06..17 on 21 Dec', full.hourly[0].hour === 6 && full.hourly[full.hourly.length - 1].hour === 17, JSON.stringify(full.hourly.map((h) => h.hour)));
  check('hourly shaded% = 100 with a blocking occluder (when module sees the sun)', full.hourly.every((h) => Math.abs(h.shadedPct - 100) < 1e-9));
}

// ===========================================================================
section('Tree attribution (occludedBase): loss with / without the removable occluders, ray by ray');
{
  const mods = [synthModule('F', 0, 0, 0, 0), synthModule('T', 10, 0, 0, 13)];
  const prep = prepareModules(mods);
  const day = buildDaySamples({ year: 2026, month: 12, day: 21 });
  // wall = "structure" (always counted); tree = removable. Both slabs, analytic.
  const slab = (min, max) => (ox, oy, oz, dx, dy, dz) => {
    let t0 = 1e-9, t1 = Infinity;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-14) { if (o[a] < min[a] || o[a] > max[a]) return false; continue; }
      let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a]; if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
    }
    return true;
  };
  const wall = slab([-1.2, 0, -31], [-1.0, 3, 29]);            // west wall 3 m high
  const tree = slab([-3.2, 0, -31], [-3.0, 9, 29]);            // taller, further west: some rays blocked by both
  const both = (...a) => wall(...a) || tree(...a);
  const withAll = await runJob(prep, [day], both, { kind: 'day', occludedBase: wall });
  const noTree = await runJob(prep, [day], wall, { kind: 'day' });
  const none = await runJob(prep, [day], () => false, { kind: 'day', occludedBase: () => false });
  check('attribution present', withAll.vegetation && withAll.vegetation.perModule instanceof Float32Array && none.vegetation.lossPct === 0);
  near('lossWithoutPct = loss of a run that only has the structures', withAll.vegetation.lossWithoutPct, noTree.arrayLossPct, 1e-9);
  near('with = without + tree-only', withAll.arrayLossPct, withAll.vegetation.lossWithoutPct + withAll.vegetation.lossPct, 1e-9);
  check('trees add loss, share in (0,100)', withAll.vegetation.lossPct > 0.05 && withAll.vegetation.sharePct > 0 && withAll.vegetation.sharePct < 100, JSON.stringify({ ...withAll.vegetation, perModule: 0, perPlaneLossPct: 0, perBuildingLossPct: 0 }));
  check('no occludedBase → no vegetation block (API unchanged)', noTree.vegetation === undefined);
  check('per-plane/building tree loss reported', Object.keys(withAll.vegetation.perPlaneLossPct).length >= 1 && withAll.vegetation.perBuildingLossPct.T >= 0);
}

// ===========================================================================
section('Analytic: west wall shading a flat module (closed-form shaded count at fixed sun positions)');
{
  const mod = synthModule('F', 0, 0, 0, 0);                    // flat module x∈[0,1.134] (world X), y 0..2.384 (plan) → world Z -2.384..0
  const prep = prepareModules([mod], { offset: 0.02 });
  const xw = -1.0, H = 1.0;                                      // wall 1 m west of the module, 1 m high
  const occ = westWall(xw, H);
  const xi = [0, 1, 2, 3].map((i) => (i + 0.5) / 4 * W);
  for (const [az, el] of [[270, 30], [270, 45], [270, 20], [250, 30], [280, 60], [90, 30], [180, 30]]) {
    const dir = sunVectorWorld(az, el);
    const got = shadeAtDirection(prep, dir, occ)[0];
    // closed form: ray from (x, 0.02, z) with direction dir hits plane X = xw at t = (xw - x)/dir.x, height 0.02 + t*dir.y
    let cnt = 0;
    for (const x of xi) { if (dir[0] < 0) { const t = (xw - x) / dir[0]; const h = 0.02 + t * dir[1]; if (h >= 0 && h <= H) cnt++; } }
    near(`instant shaded fraction az${az} el${el}`, got, cnt / 4, 1e-12);
  }
  // sun due west at 30 deg: shadow edge at x = xw + H/tan(30) = 0.732 m → area fraction 0.6455, samples give 3/4
  const g = shadeAtDirection(prep, sunVectorWorld(270, 30), occ)[0];
  const areaFrac = Math.min(1, Math.max(0, (xw + (H - 0.02) / Math.tan(30 * RAD)) / W));
  // shadow edge at x = xw + (H - 0.02)/tan(30) = 0.697 m (origin is 2 cm above the glass) → samples at 0.142, 0.425 shaded; 0.709, 0.992 lit
  near('sample count 2/4 for the 30 deg west sun', g, 0.5, 1e-12);
  check('sample estimate within 1/(2·nu) of the continuous area fraction', Math.abs(g - areaFrac) <= 0.125 + 1e-9, `${g} vs ${areaFrac}`);
  // backface: sun below the module plane → 1 (no beam) / 0 optional
  const gb = shadeAtDirection(prep, sunVectorWorld(270, -10), occ)[0];
  near('module facing away from the sun reports 1 (no beam)', gb, 1, 0);
  near('...or 0 with backfaceAsShaded:false', shadeAtDirection(prep, sunVectorWorld(270, -10), occ, { backfaceAsShaded: false })[0], 0, 0);

  // Whole-day run vs independent 1-minute integration
  const day = buildDaySamples({ year: 2026, month: 12, day: 21 });
  const res = await runJob(prep, [day], occ, { kind: 'day' });
  const bf = bruteForce([0, 1, 0], (dir) => { let c = 0; for (const x of xi) if (occ(x, 0.02, 0, dir[0], dir[1], dir[2])) c++; return c / 4; });
  near('day perModule (beam-weighted shaded fraction) vs 1-minute brute force', res.perModule[0], bf.lost / bf.beam, 0.01);
  near('day arrayLossPct vs brute force', res.arrayLossPct, 100 * bf.lost / (bf.beam + bf.diff), 0.2);
  check('the wall only shades the morning/evening (sun west of the module = afternoon)', res.hourly.length > 0 && res.hourly[0].lossPct === 0 && res.hourly[res.hourly.length - 1].lossPct > 0);
  console.log(`  flat module behind a 1 m wall, 21 Dec: perModule ${(res.perModule[0] * 100).toFixed(2)} % (brute ${(100 * bf.lost / bf.beam).toFixed(2)} %), array loss ${res.arrayLossPct.toFixed(2)} % (brute ${(100 * bf.lost / (bf.beam + bf.diff)).toFixed(2)} %)`);
}

// ===========================================================================
section('Analytic: tilted module + box occluder, 3D slab test');
{
  const mod = synthModule('T', 5, 5, 3, 25);                    // tilted 25 deg
  const prep = prepareModules([mod]);
  // box 6 m east-south-east of the module, taller than it
  const min = [8, 0, -12], max = [9.5, 12, 0];                    // world coords
  const occ = boxOccluder(min, max);
  // closed-form check at a few suns: independent re-computation of sample points from the module definition
  const pts = [];
  const c = mod.corners.map((p) => [p[0], p[2], -p[1]]);
  const n = [mod.n[0], mod.n[2], -mod.n[1]];
  for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) {
    const s = (i + 0.5) / 4, t = (j + 0.5) / 8;
    pts.push([0, 1, 2].map((k) => c[0][k] + (c[1][k] - c[0][k]) * s + (c[3][k] - c[0][k]) * t + n[k] * 0.02));
  }
  let mismatches = 0, nShadedSomewhere = 0, nChecks = 0;
  for (let az = 60; az <= 150; az += 10) for (let el = 10; el <= 70; el += 10) {
    const dir = sunVectorWorld(az, el);
    const cos = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2];
    const got = shadeAtDirection(prep, dir, occ)[0];
    if (cos <= 0) { if (got !== 1) mismatches++; continue; }
    let cnt = 0; for (const p of pts) if (occ(p[0], p[1], p[2], dir[0], dir[1], dir[2])) cnt++;
    nChecks++; if (cnt > 0 && cnt < 32) nShadedSomewhere++;
    if (Math.abs(got - cnt / 32) > 1e-12) mismatches++;
  }
  check('shadeAtDirection matches an independent per-sample slab test (all suns)', mismatches === 0, `${mismatches} mismatches of ${nChecks}`);
  check('the scan contains partially shaded cases (not a trivial test)', nShadedSomewhere >= 3, nShadedSomewhere);
}

// ===========================================================================
section('Real layout: 234 modules, trivial occluders, performance of the core loop');
{
  const prep = prepareModules(layout);
  const day = buildDaySamples({ year: 2026, month: 12, day: 21 });
  let calls = 0;
  const t0 = performance.now();
  const free = await runJob(prep, [day], () => { calls++; return false; }, { kind: 'day', sliceMs: 1e9 });
  const ms = performance.now() - t0;
  console.log(`  ${calls} occlusion calls in ${ms.toFixed(0)} ms (${(calls / ms / 1000).toFixed(1)} M calls/s) — core overhead only`);
  check('21 Dec: rays = modules facing the sun × 32 per step (< all)', free.timing.rays === calls && calls < prep.N * day.samples.length * 32 && calls > 0);
  near('free array loss', free.arrayLossPct, 0, 0);
  // irradiation sanity: 21 Dec POA on a 5.7 deg roof ~ 4.5-6 kWh/m2/day clear sky
  const poa = free.irradiation.beamKWhm2 + free.irradiation.diffuseKWhm2;
  check('clear-sky POA on 21 Dec in 4.5..6.5 kWh/m2', poa > 4.5 && poa < 6.5, poa);
  console.log(`  clear-sky POA 21 Dec (mean of 234 modules): ${poa.toFixed(2)} kWh/m2 (beam ${free.irradiation.beamKWhm2.toFixed(2)}, diffuse ${free.irradiation.diffuseKWhm2.toFixed(2)})`);

  // owner-based occluder: shade every ray of the A-W modules only
  const planes = prep.planes;
  const aw = await runJob(prep, [day], (ox, oy, oz, dx, dy, dz, i) => planes[i] === 'A-W', { kind: 'day', sliceMs: 1e9 });
  const sumPlane = (r, p) => { let s = 0, n = 0; for (let i = 0; i < prep.N; i++) if (planes[i] === p) { s += r.perModule[i]; n++; } return s / n; };
  near('A-W modules fully shaded', sumPlane(aw, 'A-W'), 1, 1e-6);
  near('A-E modules unshaded', sumPlane(aw, 'A-E'), 0, 0);
  near('per-plane loss A-E = 0', aw.perPlaneLossPct['A-E'], 0, 0);
  check('per-plane loss A-W > 0', aw.perPlaneLossPct['A-W'] > 50);
  check('all five planes reported', ['A-W', 'A-E', 'C-W', 'C-E', 'D-S'].every((p) => p in aw.perPlaneLossPct));
  // array loss = module-count weighted mix of the plane losses (same POA per plane isn't exact; check within 15 % relative)
  const weighted = Object.entries(aw.perPlaneLossPct).reduce((a, [p, v]) => a + v * planes.filter((x) => x === p).length, 0) / prep.N;
  near('array loss ≈ module-weighted plane losses', aw.arrayLossPct / weighted, 1, 0.05);
  check('per-building loss: A shaded 50 %, others 0', Math.abs(aw.perBuildingLossPct.A - aw.arrayLossPct * 2 * 1) < 20 && aw.perBuildingLossPct.C === 0 && aw.perBuildingLossPct.D === 0, JSON.stringify(aw.perBuildingLossPct));
  check('worst list: 10 entries, all A-W, sorted', aw.worst.length === 10 && aw.worst.every((w) => w.plane === 'A-W') && aw.worst.every((w, k, a) => k === 0 || a[k - 1].pct >= w.pct));
  check('worst[].index maps to the module id', aw.worst.every((w) => layout[w.index].id === w.id));

  // heatmap value ranges
  check('perModule within 0..1', Array.from(aw.perModule).every((v) => v >= 0 && v <= 1 + 1e-6));
}

// ===========================================================================
section('Year run: monthly aggregation');
{
  const prep = prepareModules(layout);
  const ys = buildYearSamples(2026);
  const planes = prep.planes;
  const yr = await runJob(prep, ys, (ox, oy, oz, dx, dy, dz, i) => planes[i] === 'D-S', { kind: 'year', sliceMs: 1e9 });
  check('kind = year, 12 monthly entries', yr.kind === 'year' && yr.monthly.length === 12 && yr.monthly[0].month === 1 && yr.monthly[11].name === 'Dec');
  check('perModuleMonthlyLoss is Float32Array(12*N)', yr.perModuleMonthlyLoss instanceof Float32Array && yr.perModuleMonthlyLoss.length === 12 * prep.N);
  check('perPlaneMonthlyLossPct has 12 values per plane', Object.values(yr.perPlaneMonthlyLossPct).every((a) => a.length === 12));
  // D-S fully shaded in beam: its monthly loss equals the beam share; others 0
  check('other planes have zero monthly loss', ['A-W', 'A-E', 'C-W', 'C-E'].every((p) => yr.perPlaneMonthlyLossPct[p].every((v) => v === 0)));
  check('D-S monthly loss 30..95 % each month', yr.perPlaneMonthlyLossPct['D-S'].every((v) => v > 30 && v < 95), yr.perPlaneMonthlyLossPct['D-S'].map((v) => v.toFixed(0)).join(','));
  // annual loss = POA-weighted mean of monthly losses
  const wsum = yr.monthly.reduce((a, m) => a + m.lossPct * m.poaKWhm2, 0) / yr.monthly.reduce((a, m) => a + m.poaKWhm2, 0);
  near('annual array loss = POA-weighted monthly mean', yr.arrayLossPct, wsum, 1e-9);
  // annual clear-sky POA on a 5.7 deg roof: 1900-2300 kWh/m2/yr for a clear-sky model at 13 N
  const annualPoa = yr.monthly.reduce((a, m) => a + m.poaKWhm2, 0);
  check('annual clear-sky POA plausible (2200..2700 kWh/m2; true clear sky is an upper bound of the ~1900 measured)', annualPoa > 2200 && annualPoa < 2700, annualPoa);
  console.log(`  annual clear-sky POA ${annualPoa.toFixed(0)} kWh/m2; D-S (48 of 234 modules) fully shaded → array loss ${yr.arrayLossPct.toFixed(2)} % (= ${(48 / 234 * 100).toFixed(1)} % × beam share)`);
  // monthly per-module values reproduce the plane monthly numbers
  let dsIdx = planes.findIndex((p) => p === 'D-S');
  near('perModuleMonthlyLoss (Jun, a D-S module) = plane loss', 100 * yr.perModuleMonthlyLoss[5 * prep.N + dsIdx], yr.perPlaneMonthlyLossPct['D-S'][5], 1e-4);
  // 12 sun sets with ~24 steps → rays count
  check('year rays plausible (> 1 M)', yr.timing.rays > 1e6, yr.timing.rays);
}

// ===========================================================================
section('Driver: time slicing, progress, cancel');
{
  const prep = prepareModules(layout.slice(0, 60));
  const day = buildDaySamples({ year: 2026, month: 6, day: 21 });
  // slice 0 ms → yields at every module; progress monotonic 0..1
  const prog = []; let yields = 0;
  const res = await runJob(prep, [day], () => false, {
    kind: 'day', sliceMs: 0, yieldFn: async () => { yields++; }, onProgress: (p, info) => prog.push([p, info.phase]),
  });
  check('yields happen (sliceMs 0)', yields > 1000, yields);
  check('progress monotonic', prog.every((v, i) => i === 0 || v[0] >= prog[i - 1][0]));
  check('progress ends at exactly 1 with phase done', prog[prog.length - 1][0] === 1 && prog[prog.length - 1][1] === 'done');
  check('progress starts < 0.1', prog[0][0] < 0.1);
  check('result.timing.yields recorded', res.timing.yields === yields);

  // cancel after ~30 % progress
  let cancelled = false, last = 0;
  const r2 = await runJob(prep, [day], () => false, {
    kind: 'day', sliceMs: 0, yieldFn: async () => {}, isCancelled: () => cancelled,
    onProgress: (p) => { last = p; if (p > 0.3) cancelled = true; },
  });
  check('cancelled run resolves null', r2 === null);
  check('cancelled before finishing', last > 0.3 && last < 0.6, last);

  // real yieldFn (setTimeout) with the default slice: still completes and returns a result
  let slices = 0;
  const r3 = await runJob(prepareModules(layout), [buildDaySamples({ year: 2026, month: 12, day: 21 })], boxOccluder([-1e9, -1e9, -1e9], [-1e9 + 1, -1e9 + 1, -1e9 + 1]), {
    kind: 'day', sliceMs: DEFAULTS.sliceMs, onProgress: () => { slices++; },
  });
  check('default yield path completes', r3 && r3.arrayLossPct === 0 && slices >= 1, slices);
}

done('shading-core.test.mjs');
