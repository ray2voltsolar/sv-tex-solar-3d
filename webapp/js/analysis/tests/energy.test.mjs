// energy.js tests — run:  node webapp/js/analysis/tests/energy.test.mjs
import * as site from '../../site-data.js';
import {
  formatIN, formatINR, indianUnits, indianWords, formatKWh, formatKWhWithWords, formatPct,
  unshadedEnergy, shadingAdjustedEnergy, monthlySeries, describeAdjusted, moduleMonthEnergyWeights,
} from '../energy.js';
import { prepareModules, buildYearSamples, buildDaySamples, runJob } from '../shading-core.js';
import { check, near, section, done } from './testkit.mjs';

section('formatIN — Indian digit grouping');
{
  const cases = [
    [0, '0'], [7, '7'], [999, '999'], [1000, '1,000'], [12345, '12,345'], [99999, '99,999'], [100000, '1,00,000'],
    [205800, '2,05,800'], [1234567, '12,34,567'], [12345678, '1,23,45,678'], [100000000, '10,00,00,000'], [1000000000, '1,00,00,00,000'],
    [-205800, '-2,05,800'], [-999, '-999'], [-1000, '-1,000'], [205800.4, '2,05,800'], [205800.5, '2,05,801'], [99999.6, '1,00,000'],
  ];
  for (const [n, s] of cases) check(`formatIN(${n}) = ${s}`, formatIN(n) === s, formatIN(n));
  check('formatIN decimals', formatIN(1234567.891, 2) === '12,34,567.89' && formatIN(205800, 2) === '2,05,800.00' && formatIN(0.5, 1) === '0.5');
  check('formatIN rounding carry (99999.999, 2)', formatIN(99999.999, 2) === '1,00,000.00', formatIN(99999.999, 2));
  check('formatIN(-0.4) is "0" not "-0"', formatIN(-0.4) === '0', formatIN(-0.4));
  check('formatIN non-finite', formatIN(NaN) === '—' && formatIN(Infinity) === '—' && formatIN(undefined) === '—' && formatIN('12') === '—');
  check('formatIN(205800) is exactly "2,05,800"', formatIN(205800) === '2,05,800');
  check('formatINR', formatINR(205800) === '₹2,05,800' && formatINR(-5000) === '-₹5,000' && formatINR(1234.5, 2) === '₹1,234.50');
  check('formatKWh', formatKWh(205800) === '2,05,800 kWh');
  check('formatPct', formatPct(3.456) === '3.5 %' && formatPct(NaN) === '—');
}

section('Lakh / crore words');
{
  check('indianUnits lakh', indianUnits(205800).unit === 'lakh' && Math.abs(indianUnits(205800).value - 2.058) < 1e-12);
  check('indianUnits crore', indianUnits(2.5e7).unit === 'crore' && indianUnits(2.5e7).value === 2.5);
  check('indianUnits plain', indianUnits(99999).unit === '' && indianUnits(99999).value === 99999);
  const cases = [
    [205800, '2.06 lakh'], [100000, '1 lakh'], [150000, '1.5 lakh'], [99999, '99,999'], [85000, '85,000'], [0, '0'],
    [10000000, '1 crore'], [15000000, '1.5 crore'], [123456789, '12.35 crore'], [9999999, '1 crore'], [9990000, '99.9 lakh'],
    [-250000, '-2.5 lakh'],
  ];
  for (const [n, s] of cases) check(`indianWords(${n}) = ${s}`, indianWords(n) === s, indianWords(n));
  check('indianWords decimals/capital', indianWords(205800, { decimals: 1 }) === '2.1 lakh' && indianWords(205800, { capital: true }) === '2.06 Lakh');
  check('formatKWhWithWords', formatKWhWithWords(205800) === '2,05,800 kWh (2.06 lakh units)' && formatKWhWithWords(5000) === '5,000 kWh', formatKWhWithWords(205800));
  check('indianWords non-finite', indianWords(NaN) === '—');
}

section('Energy model');
{
  const modules = site.computeLayout();
  const sum = site.systemSummary(modules);
  const base = unshadedEnergy(modules);
  near('unshaded annual = systemSummary().annualKwh', base.annualKwh, sum.annualKwh, 1e-6);
  near('unshaded kWp', base.kwp, 145.08, 1e-9);
  check('unshaded monthly follows summary monthly (rescaled to the PVGIS annual, within 0.1 %)', base.monthlyKwh.every((v, i) => Math.abs(v / sum.monthlyKwh[i] - 1) < 1e-3));
  check('annual prints as "2,05,800"', formatIN(base.annualKwh) === '2,05,800', formatIN(base.annualKwh));
  near('annual ~ 2,05,800 kWh (±0.3 %)', base.annualKwh / 205800, 1, 0.003);
  near('monthly sums to annual', base.monthlyKwh.reduce((a, b) => a + b, 0), base.annualKwh, 1e-6);
  check('per-plane module counts', base.perPlane['A-W'].modules === 60 && base.perPlane['C-W'].modules === 26 && base.perPlane['D-S'].modules === 48);
  console.log(`  unshaded annual ${formatIN(base.annualKwh)} kWh, specific yield ${(base.annualKwh / base.kwp).toFixed(1)} kWh/kWp`);

  // no shading result → identical numbers
  const none = shadingAdjustedEnergy(modules, null);
  check('basis none, no loss', none.basis === 'none' && none.estimated && Math.abs(none.annualKwh - base.annualKwh) < 1e-9 && none.lossPct === 0);
  near('specific yield = annual/kWp', none.specificYield, base.annualKwh / base.kwp, 1e-9);
  near('CO2 = annual × EF', none.co2TonnesPerYear, base.annualKwh * site.GRID_EMISSION_FACTOR / 1000, 1e-9);

  // year result with a fully shaded D-S plane (beam only): D-S loses its monthly beam share
  const prep = prepareModules(modules);
  const yr = await runJob(prep, buildYearSamples(2026), (ox, oy, oz, dx, dy, dz, i) => prep.planes[i] === 'D-S', { kind: 'year', sliceMs: 1e9 });
  const adj = shadingAdjustedEnergy(modules, yr);
  check('year basis, not estimated', adj.basis === 'year' && !adj.estimated);
  const dsLoss = yr.perPlaneMonthlyLossPct['D-S'];
  let expectedDS = 0; { const S = site.PVGIS.S, k = S.annual / S.monthly.reduce((a, b) => a + b, 0); S.monthly.forEach((v, m) => { expectedDS += 48 * 0.62 * v * k * (1 - dsLoss[m] / 100); }); }
  near('D-S adjusted annual = Σ n·kWp·PVGIS·(1-loss_month)', adj.perPlane['D-S'].annualKwh, expectedDS, 1e-2);
  near('A-W untouched', adj.perPlane['A-W'].annualKwh, base.perPlane['A-W'].annualKwh, 1e-9);
  near('loss kWh = unshaded − adjusted', adj.lossKwh, base.annualKwh - adj.annualKwh, 1e-9);
  check('monthly loss % consistent', adj.monthlyLossPct.every((v, i) => Math.abs(v - (100 * (1 - adj.monthlyKwh[i] / base.monthlyKwh[i]))) < 1e-9));
  check('monthly adjusted sums to annual', Math.abs(adj.monthlyKwh.reduce((a, b) => a + b, 0) - adj.annualKwh) < 1e-6);
  console.log(`  D-S fully shaded: ${describeAdjusted(adj)}`);
  // per-plane fallback gives the same answer as per-module monthly
  const yr2 = { ...yr, perModuleMonthlyLoss: undefined };
  const adj2 = shadingAdjustedEnergy(modules, yr2);
  near('per-plane monthly fallback ≈ per-module monthly', adj2.annualKwh, adj.annualKwh, 1e-2);

  // ONE loss definition: a year run given energy weights reports the headline % on the same basis as the kWh it multiplies
  {
    const ew = moduleMonthEnergyWeights(modules);
    check('energy weights: 12·N values, total = unshaded annual', ew.length === 12 * modules.length && Math.abs(ew.reduce((x, y) => x + y, 0) - base.annualKwh) < 1e-6);
    // season/time dependent shadows (low sun blocked for A-W, afternoon-east sun for D-S), so POA and PVGIS-energy weights disagree
    const occ = (ox, oy, oz, dx, dy, dz, i) => (prep.planes[i] === 'A-W' && dy < 0.72) || (prep.planes[i] === 'D-S' && dx > 0.15) || (prep.planes[i] === 'C-E' && i % 2 === 0 && dy < 0.5);
    const yrP = await runJob(prep, buildYearSamples(2026), occ, { kind: 'year', sliceMs: 1e9 });
    const yrE = await runJob(prep, buildYearSamples(2026), occ, { kind: 'year', sliceMs: 1e9, energyWeights: ew });
    const adjE = shadingAdjustedEnergy(modules, yrE);
    check('no weights → POA basis', yrP.lossBasis === 'poa' && yrP.arrayLossPct === yrP.arrayPoaLossPct);
    check('with weights → energy basis, POA twin kept', yrE.lossBasis === 'energy' && Math.abs(yrE.arrayPoaLossPct - yrP.arrayLossPct) < 1e-9);
    check('the two bases really differ (else this test proves nothing)', Math.abs(yrE.arrayLossPct - yrE.arrayPoaLossPct) > 0.01, `${yrE.arrayLossPct.toFixed(3)} vs ${yrE.arrayPoaLossPct.toFixed(3)}`);
    near('headline arrayLossPct = energy.js lossPct', yrE.arrayLossPct, adjE.lossPct, 1e-5);       // energy.js reads the Float32 per-module-month losses
    near('annual kWh = unshaded × (1 − headline)', adjE.annualKwh, base.annualKwh * (1 - yrE.arrayLossPct / 100), 0.05);
    for (const p of Object.keys(adjE.perPlane)) near(`per-roof loss ${p} = energy.js perPlane lossPct`, yrE.perPlaneLossPct[p], adjE.perPlane[p].lossPct, 1e-5);
    const kwhB = {}, unB = {}; for (const [p, v] of Object.entries(adjE.perPlane)) { const b = site.ROOF_PLANES[p].building; kwhB[b] = (kwhB[b] || 0) + v.lossKwh; unB[b] = (unB[b] || 0) + v.unshadedKwh; }
    for (const b of Object.keys(kwhB)) near(`per-building loss ${b} = its kWh lost / unshaded kWh`, yrE.perBuildingLossPct[b], 100 * kwhB[b] / unB[b], 1e-5);
    check('monthly lossPct = energy.js monthlyLossPct', yrE.monthly.every((m, i) => Math.abs(m.lossPct - adjE.monthlyLossPct[i]) < 1e-5));
    near('annual: unshaded × (1 − loss) rounds the same as the UI kWh', Math.round(base.annualKwh * (1 - yrE.arrayLossPct / 100) / 100) * 100, Math.round(adjE.annualKwh / 100) * 100, 0);
    console.log(`  headline (energy basis) ${yrE.arrayLossPct.toFixed(3)} % vs POA-weighted ${yrE.arrayPoaLossPct.toFixed(3)} %  ->  ${formatIN(adjE.annualKwh)} kWh`);
    // day runs keep the POA basis
    const dayP = await runJob(prep, [buildDaySamples({ year: 2026, month: 12, day: 21 })], occ, { kind: 'day', sliceMs: 1e9, energyWeights: ew });
    check('day run ignores energy weights (POA basis)', dayP.lossBasis === 'poa' && dayP.arrayLossPct === dayP.arrayPoaLossPct);
  }

  // day result → indicative, flagged
  const day = await runJob(prep, [buildDaySamples({ year: 2026, month: 12, day: 21 })], (ox, oy, oz, dx, dy, dz, i) => prep.planes[i] === 'D-S', { kind: 'day', sliceMs: 1e9 });
  const adjD = shadingAdjustedEnergy(modules, day);
  check('day basis flagged as estimated', adjD.basis === 'day' && adjD.estimated && /Indicative/.test(adjD.note));
  check('day loss applied to all months equally for D-S', adjD.perPlane['D-S'].lossPct > 20 && adjD.perPlane['A-W'].lossPct === 0);
  near('day-based D-S annual = unshaded × (1 − dayLoss)', adjD.perPlane['D-S'].annualKwh / adjD.perPlane['D-S'].unshadedKwh, 1 - day.perPlaneLossPct['D-S'] / 100, 1e-6);
  check('describeAdjusted mentions indicative for day basis', /indicative/.test(describeAdjusted(adjD)));

  // uniform synthetic loss (5 %) → exactly 5 %
  const uniform = { kind: 'year', perModuleMonthlyLoss: new Float32Array(12 * modules.length).fill(0.05) };
  const adjU = shadingAdjustedEnergy(modules, uniform);
  near('uniform 5 % loss → 5 % lower annual', adjU.lossPct, 5, 1e-4);
  near('uniform 5 % loss → annual', adjU.annualKwh, base.annualKwh * 0.95, 1e-2);
  // clamps
  const bad = { kind: 'year', perModuleMonthlyLoss: new Float32Array(12 * modules.length).fill(1.5) };
  near('losses clamp to 100 %', shadingAdjustedEnergy(modules, bad).annualKwh, 0, 1e-9);
  // monthly series
  const ser = monthlySeries(adj);
  check('monthlySeries 12 rows', ser.length === 12 && ser[0].month === 'Jan' && ser[11].month === 'Dec' && ser.every((r) => r.shaded <= r.unshaded + 1e-9));
  // unknown plane
  let threw = false; try { unshadedEnergy([{ plane: 'X-1' }]); } catch { threw = true; }
  check('unknown plane throws', threw);
}

done('energy.test.mjs');
