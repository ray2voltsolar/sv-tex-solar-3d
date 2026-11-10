// ============================================================================
//  energy.js — energy numbers for the proposal + Indian number formatting.
//  Pure math (Node-testable). Combines site.PVGIS (kWh per kWp, per roof facing) with a shading
//  result from shading.js to give shading-adjusted monthly / annual kWh.
//
//  Model: kWh(module, month) = kWp_module × PVGIS[facing].monthly[month] × (1 − shadingLoss(module, month))
//   * PVGIS figures already include the generic 14 % system losses (soiling, cable, inverter …); shading is
//     applied on top as an additional near-shading factor (linear / area-proportional model — real string
//     mismatch can be a little worse or better, this is an indicative proposal-stage number).
//   * shadingLoss is the fraction of the clear-sky plane-of-array energy (beam + diffuse) lost to shadows (per module and
//     month); the headline loss that a year run reports (shading.js `arrayLossPct`) is the PVGIS-ENERGY-weighted mean of
//     these, i.e. exactly `lossPct` below — so annual kWh = unshaded kWh × (1 − arrayLossPct). Taken from
//       - year results: perModuleMonthlyLoss (per module and month)
//       - day  results: the day's per-module loss applied to every month (flagged `estimated`, because one
//                       winter-solstice day is not the year — run the full-year analysis for the real figure).
// ============================================================================
import * as site from '../site-data.js';

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------
// Indian number formatting
// ---------------------------------------------------------------------------
/**
 * Indian digit grouping (3, then 2, 2, …):  205800 → "2,05,800";  12345678.9 → "1,23,45,679" (decimals=0)
 * @param n         number
 * @param decimals  fraction digits (default 0)
 */
export function formatIN(n, decimals = 0) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);                 // rounding (and carry) handled by toFixed
  let [int, frac] = fixed.split('.');
  if (int.length > 3) {
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    int = `${rest},${last3}`;
  }
  const out = frac !== undefined ? `${int}.${frac}` : int;
  return neg && Number(fixed) !== 0 ? `-${out}` : out;
}

/** Rupee amount with grouping: formatINR(205800) → "₹2,05,800" */
export function formatINR(n, decimals = 0) {
  const s = formatIN(n, decimals);
  return s === '—' ? s : (s.startsWith('-') ? `-₹${s.slice(1)}` : `₹${s}`);
}

/**
 * Split a number into the Indian unit it is best expressed in.
 * 205800 → { value: 2.058, unit: 'lakh' };  1.5e7 → { value: 1.5, unit: 'crore' };  85000 → { value: 85000, unit: '' }
 */
export function indianUnits(n) {
  const a = Math.abs(n);
  if (a >= 1e7) return { value: n / 1e7, unit: 'crore' };
  if (a >= 1e5) return { value: n / 1e5, unit: 'lakh' };
  return { value: n, unit: '' };
}

/**
 * Words form: indianWords(205800) → "2.06 lakh";  indianWords(15000000) → "1.5 crore";  indianWords(85000) → "85,000".
 * @param opts.decimals  max fraction digits for lakh/crore (default 2, trailing zeros trimmed)
 * @param opts.capital   "Lakh" / "Crore" instead of "lakh" / "crore"
 */
export function indianWords(n, opts = {}) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const { decimals = 2, capital = false } = opts;
  const { value, unit } = indianUnits(n);
  if (!unit) return formatIN(n, 0);
  let num = Number(value.toFixed(decimals));
  let u = unit;
  if (u === 'lakh' && Math.abs(num) >= 100) { num = Number((num / 100).toFixed(decimals)); u = 'crore'; } // 99.999 lakh → 1 crore
  const text = String(num);
  return `${text} ${capital ? u[0].toUpperCase() + u.slice(1) : u}`;
}

/** "2,05,800 kWh" */
export const formatKWh = (kwh, decimals = 0) => `${formatIN(kwh, decimals)} kWh`;
/** "2,05,800 kWh (2.06 lakh units)" — "units" is how electricity bills in India talk about kWh. */
export const formatKWhWithWords = (kwh) => `${formatIN(kwh)} kWh${Math.abs(kwh) >= 1e5 ? ` (${indianWords(kwh)} units)` : ''}`;
export const formatPct = (v, decimals = 1) => (Number.isFinite(v) ? `${v.toFixed(decimals)} %` : '—');

// ---------------------------------------------------------------------------
// Energy model
// ---------------------------------------------------------------------------
const kwpOf = (m) => (m.wp ?? site.MODULE.wp) / 1000;

/**
 * PVGIS monthly kWh/kWp per facing, rescaled so the 12 months add up to PVGIS's published annual figure
 * (the printed monthly values are rounded, they differ from the annual by up to ~0.1 kWh/kWp). This keeps the
 * unshaded annual here identical to site.systemSummary() — "2,05,800" everywhere in the UI.
 */
export function normalisedMonthly(pvgis) {
  const out = {};
  for (const f of Object.keys(pvgis)) {
    const d = pvgis[f]; if (!d || !d.monthly) continue;
    const sum = d.monthly.reduce((a, b) => a + b, 0), k = d.annual / sum;
    out[f] = d.monthly.map((v) => v * k);
  }
  return out;
}
const MONTHLY = normalisedMonthly(site.PVGIS);

/**
 * Un-shaded kWh of every module in every month (Float64Array(12*N), index month0*N + i) — the weights that turn per-module
 * shading losses into an ENERGY-weighted loss. shading-core.finalizeResult uses them for year runs so the headline
 * "array shading loss" is exactly the loss that shadingAdjustedEnergy() subtracts from the PVGIS kWh.
 * @param modules    module list (same order as the shading result); each needs .plane (and optionally .wp)
 * @param roofPlanes site.ROOF_PLANES-like { [planeId]: { facing } }  (default: site-data)
 * @param pvgis      site.PVGIS-like { [facing]: { monthly[12], annual } }  (default: site-data)
 * @param moduleWp   default module rating in Wp (default: site-data)
 */
export function moduleMonthEnergyWeights(modules, roofPlanes = site.ROOF_PLANES, pvgis = site.PVGIS, moduleWp = site.MODULE.wp) {
  const monthly = pvgis === site.PVGIS ? MONTHLY : normalisedMonthly(pvgis), N = modules.length, w = new Float64Array(12 * N);
  for (let i = 0; i < N; i++) {
    const m = modules[i], p = roofPlanes[m.plane];
    if (!p) throw new Error(`energy: unknown roof plane "${m.plane}"`);
    const k = (m.wp ?? moduleWp) / 1000, pv = monthly[p.facing];
    for (let mo = 0; mo < 12; mo++) w[mo * N + i] = k * pv[mo];
  }
  return w;
}

function facingOf(m) {
  const p = site.ROOF_PLANES[m.plane];
  if (!p) throw new Error(`energy: unknown roof plane "${m.plane}"`);
  return p.facing;
}

/**
 * Energy with no shading (PVGIS as published). Identical to site.systemSummary() numbers.
 * @returns {{kwp, annualKwh, monthlyKwh:number[12], perPlane:{[id]:{modules,kwp,facing,annualKwh,monthlyKwh}}}}
 */
export function unshadedEnergy(modules = site.computeLayout()) {
  const monthlyKwh = new Array(12).fill(0), perPlane = {};
  let kwp = 0;
  for (const m of modules) {
    const f = facingOf(m), k = kwpOf(m);
    const pp = (perPlane[m.plane] ||= { modules: 0, kwp: 0, facing: f, annualKwh: 0, monthlyKwh: new Array(12).fill(0) });
    pp.modules++; pp.kwp += k; kwp += k;
    MONTHLY[f].forEach((v, i) => { pp.monthlyKwh[i] += k * v; monthlyKwh[i] += k * v; });
  }
  for (const pp of Object.values(perPlane)) pp.annualKwh = pp.monthlyKwh.reduce((a, b) => a + b, 0);
  return { kwp, annualKwh: monthlyKwh.reduce((a, b) => a + b, 0), monthlyKwh, perPlane };
}

/**
 * Shading-adjusted energy.
 * @param modules  the 234-module list (same order as the shading result's perModule)
 * @param shading  result of runYear()/runDay() — or null/undefined for "no shading" (returns the unshaded numbers)
 * @returns {{
 *   basis: 'none'|'year'|'day', estimated: boolean, note: string,
 *   kwp, annualKwh, unshadedAnnualKwh, lossKwh, lossPct,
 *   monthlyKwh:number[12], unshadedMonthlyKwh:number[12], monthlyLossPct:number[12],
 *   perPlane:{[id]:{modules,kwp,facing,annualKwh,unshadedKwh,lossKwh,lossPct}},
 *   specificYield, unshadedSpecificYield, co2TonnesPerYear, unshadedCo2TonnesPerYear }}
 */
export function shadingAdjustedEnergy(modules, shading) {
  const N = modules.length;
  const base = unshadedEnergy(modules);
  let basis = 'none', note = 'No shading analysis has been run — figures are the unshaded PVGIS estimate.';
  let lossOf = () => 0;
  if (shading && shading.kind === 'year' && shading.perModuleMonthlyLoss && shading.perModuleMonthlyLoss.length === 12 * N) {
    basis = 'year'; note = 'Shading losses from the full-year analysis (21st of each month, 30-min steps), applied month by month.';
    const a = shading.perModuleMonthlyLoss;
    lossOf = (i, m) => a[m * N + i];
  } else if (shading && shading.kind === 'year' && shading.perPlaneMonthlyLossPct) {
    basis = 'year'; note = 'Shading losses from the full-year analysis (per roof plane, month by month).';
    lossOf = (i, m) => (shading.perPlaneMonthlyLossPct[modules[i].plane]?.[m] ?? 0) / 100;
  } else if (shading && shading.perModuleLoss && shading.perModuleLoss.length === N) {
    basis = 'day'; note = 'Indicative: the single analysed day\'s shading loss is applied to every month. Run the full-year analysis for the proposal figure.';
    const a = shading.perModuleLoss;
    lossOf = (i) => a[i];
  } else if (shading && shading.perPlaneLossPct) {
    basis = 'day'; note = 'Indicative: the single analysed day\'s per-roof loss is applied to every month. Run the full-year analysis for the proposal figure.';
    lossOf = (i) => (shading.perPlaneLossPct[modules[i].plane] ?? 0) / 100;
  }
  const monthlyKwh = new Array(12).fill(0), perPlane = {};
  for (let i = 0; i < N; i++) {
    const m = modules[i], f = facingOf(m), k = kwpOf(m);
    const pp = (perPlane[m.plane] ||= { modules: 0, kwp: 0, facing: f, annualKwh: 0, unshadedKwh: 0, lossKwh: 0, lossPct: 0 });
    pp.modules++; pp.kwp += k;
    const pv = MONTHLY[f];
    for (let mo = 0; mo < 12; mo++) {
      const un = k * pv[mo], l = Math.min(1, Math.max(0, lossOf(i, mo)));
      monthlyKwh[mo] += un * (1 - l); pp.annualKwh += un * (1 - l); pp.unshadedKwh += un;
    }
  }
  for (const pp of Object.values(perPlane)) { pp.lossKwh = pp.unshadedKwh - pp.annualKwh; pp.lossPct = pp.unshadedKwh > 0 ? 100 * pp.lossKwh / pp.unshadedKwh : 0; }
  const annualKwh = monthlyKwh.reduce((a, b) => a + b, 0);
  const lossKwh = base.annualKwh - annualKwh;
  return {
    basis, estimated: basis !== 'year', note,
    kwp: base.kwp, annualKwh, unshadedAnnualKwh: base.annualKwh, lossKwh, lossPct: base.annualKwh > 0 ? 100 * lossKwh / base.annualKwh : 0,
    monthlyKwh, unshadedMonthlyKwh: base.monthlyKwh,
    monthlyLossPct: monthlyKwh.map((v, i) => (base.monthlyKwh[i] > 0 ? 100 * (1 - v / base.monthlyKwh[i]) : 0)),
    perPlane,
    specificYield: annualKwh / base.kwp, unshadedSpecificYield: base.annualKwh / base.kwp,
    co2TonnesPerYear: annualKwh * site.GRID_EMISSION_FACTOR / 1000, unshadedCo2TonnesPerYear: base.annualKwh * site.GRID_EMISSION_FACTOR / 1000,
  };
}

/** Rows for a monthly bar chart: [{month:'Jan', unshaded, shaded, lossPct}] */
export function monthlySeries(adjusted) {
  return MONTH_NAMES.map((name, i) => ({
    month: name, unshaded: adjusted.unshadedMonthlyKwh[i], shaded: adjusted.monthlyKwh[i], lossPct: adjusted.monthlyLossPct[i],
  }));
}

/** One-line human summary for the UI, e.g. "1,98,512 kWh/yr after shading (−3.5 % vs 2,05,800 kWh unshaded)". */
export function describeAdjusted(adjusted) {
  const sign = adjusted.lossKwh > 0.5 ? `−${adjusted.lossPct.toFixed(1)} %` : 'no loss';
  return `${formatIN(adjusted.annualKwh)} kWh/yr after shading (${sign} vs ${formatIN(adjusted.unshadedAnnualKwh)} kWh unshaded)${adjusted.estimated && adjusted.basis !== 'none' ? ' — indicative, from a single day' : ''}`;
}
