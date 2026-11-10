// ============================================================================
//  sun.js verification — run:  node webapp/js/analysis/tests/sun.test.mjs
//
//  References (all written independently of sun.js, in this file):
//   * PSA algorithm   — Blanco-Muriel et al., Solar Energy 70(5) 2001, "Computing the
//                        solar vector" (Plataforma Solar de Almeria). ±0.5 arcmin.
//   * Michalsky 1988  — "The Astronomical Almanac's algorithm for approximate solar
//                        position (1950-2050)", Solar Energy 40(3). ±0.01 deg.
//   * NOAA calc.js    — the NOAA Global Monitoring Laboratory solar calculator procedure,
//                        transcribed the way the web page does it (sunrise/sunset solved
//                        with a 2-pass refinement evaluated AT the event, not at noon).
//   * Bisection       — sunrise/sunset/noon found by root-finding on PSA / Michalsky
//                        geometric altitude (-0.833 deg), no hour-angle formula at all.
//   * Analytic anchors — declination at solstices/equinoxes, noon elevation = 90-|lat-dec|.
//  NOTE: the live NOAA web page could not be queried from this sandbox; the "NOAA"
//  reference is therefore a re-implementation of its published procedure.
// ============================================================================
import { getSunPosition, getSunTimes, dateFromLocal, localParts, sunVectorPlan, sunVectorWorld, clearSkyIrradiance } from '../sun.js';
import { check, near, section, done, angDiff, RAD, DEG } from './testkit.mjs';

const LAT = 13.3127, LNG = 79.5703, TZ = 5.5;   // Nagari (AP), IST
const jdOf = (date) => date.getTime() / 86400000 + 2440587.5;
const wrap360 = (a) => ((a % 360) + 360) % 360;

// ---------------------------------------------------------------------------
// Reference 1: PSA algorithm (geometric; no refraction). Returns {az, zenith (true), elev}
// ---------------------------------------------------------------------------
function psa(date, lat, lon) {
  const twopi = 2 * Math.PI, rad = Math.PI / 180;
  const n = jdOf(date) - 2451545.0;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600 + date.getUTCMilliseconds() / 3.6e6;
  const omega = 2.1429 - 0.0010394594 * n;
  const meanLong = 4.8950630 + 0.017202791698 * n;
  const meanAnom = 6.2400600 + 0.0172019699 * n;
  const eclLong = meanLong + 0.03341607 * Math.sin(meanAnom) + 0.00034894 * Math.sin(2 * meanAnom) - 0.0001134 - 0.0000203 * Math.sin(omega);
  const eclObl = 0.4090928 - 6.2140e-9 * n + 0.0000396 * Math.cos(omega);
  const sinL = Math.sin(eclLong);
  let ra = Math.atan2(Math.cos(eclObl) * sinL, Math.cos(eclLong)); if (ra < 0) ra += twopi;
  const dec = Math.asin(Math.sin(eclObl) * sinL);
  const gmst = 6.6974243242 + 0.0657098283 * n + hours;
  const lmst = (gmst * 15 + lon) * rad;
  const ha = lmst - ra;
  const latR = lat * rad, cosLat = Math.cos(latR), sinLat = Math.sin(latR), cosHa = Math.cos(ha);
  let zen = Math.acos(cosLat * cosHa * Math.cos(dec) + Math.sin(dec) * sinLat);
  let az = Math.atan2(-Math.sin(ha), Math.tan(dec) * cosLat - sinLat * cosHa); if (az < 0) az += twopi;
  zen += (6371.01 / 149597890) * Math.sin(zen);                          // parallax
  return { az: az / rad, zenith: zen / rad, elev: 90 - zen / rad, decl: dec / rad };
}

// ---------------------------------------------------------------------------
// Reference 2: Michalsky (1988). Geometric elevation + his refraction (not compared to NOAA's).
// ---------------------------------------------------------------------------
function michalsky(date, lat, lon) {
  const time = jdOf(date) - 2451545.0;
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600 + date.getUTCMilliseconds() / 3.6e6;
  const mnlong = wrap360(280.460 + 0.9856474 * time);
  const mnanom = wrap360(357.528 + 0.9856003 * time) * RAD;
  const eclong = wrap360(mnlong + 1.915 * Math.sin(mnanom) + 0.020 * Math.sin(2 * mnanom)) * RAD;
  const oblqec = (23.439 - 0.0000004 * time) * RAD;
  let ra = Math.atan2(Math.cos(oblqec) * Math.sin(eclong), Math.cos(eclong));
  const dec = Math.asin(Math.sin(oblqec) * Math.sin(eclong));
  const gmst = ((6.697375 + 0.0657098242 * time + hour) % 24 + 24) % 24;
  const lmst = (((gmst + lon / 15) % 24) + 24) % 24;
  let ha = lmst * 15 * RAD - ra; if (ha < -Math.PI) ha += 2 * Math.PI; if (ha > Math.PI) ha -= 2 * Math.PI;
  const latR = lat * RAD;
  const el = Math.asin(Math.sin(dec) * Math.sin(latR) + Math.cos(dec) * Math.cos(latR) * Math.cos(ha));
  const az = wrap360(Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(latR) - Math.sin(latR) * Math.cos(ha)) * DEG);
  return { az, elev: el * DEG, decl: dec * DEG };
}

// ---------------------------------------------------------------------------
// Reference 3: NOAA calc.js procedure (east-positive longitude here)
// ---------------------------------------------------------------------------
const noaa = {
  centuries: (jd) => (jd - 2451545.0) / 36525.0,
  L0: (t) => wrap360(280.46646 + t * (36000.76983 + t * 0.0003032)),
  M: (t) => 357.52911 + t * (35999.05029 - 0.0001537 * t),
  e: (t) => 0.016708634 - t * (0.000042037 + 0.0000001267 * t),
  center(t) {
    const m = noaa.M(t) * RAD;
    return Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m) * (0.019993 - 0.000101 * t) + Math.sin(3 * m) * 0.000289;
  },
  apparentLong(t) { const o = noaa.L0(t) + noaa.center(t); const om = 125.04 - 1934.136 * t; return o - 0.00569 - 0.00478 * Math.sin(om * RAD); },
  obliq(t) {
    const sec = 21.448 - t * (46.8150 + t * (0.00059 - t * 0.001813));
    const e0 = 23.0 + (26.0 + sec / 60.0) / 60.0; const om = 125.04 - 1934.136 * t;
    return e0 + 0.00256 * Math.cos(om * RAD);
  },
  decl(t) { return Math.asin(Math.sin(noaa.obliq(t) * RAD) * Math.sin(noaa.apparentLong(t) * RAD)) * DEG; },
  eqTime(t) {
    const eps = noaa.obliq(t), l0 = noaa.L0(t) * RAD, e = noaa.e(t), m = noaa.M(t) * RAD;
    let y = Math.tan(eps * RAD / 2); y *= y;
    return 4 * DEG * (y * Math.sin(2 * l0) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l0) - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * m));
  },
  /** event minutes UTC (rise or set) for the UTC date whose 00:00 JD is jd0 — 2 pass, like the web page */
  eventUTC(rise, jd0, lat, lon) {
    let minutes = 720 - 4 * lon;                                   // first guess: solar noon, no EoT
    for (let pass = 0; pass < 3; pass++) {
      const t = noaa.centuries(jd0 + minutes / 1440.0);
      const eq = noaa.eqTime(t), dec = noaa.decl(t) * RAD, latR = lat * RAD;
      const arg = Math.cos(90.833 * RAD) / (Math.cos(latR) * Math.cos(dec)) - Math.tan(latR) * Math.tan(dec);
      const H = Math.acos(arg) * DEG;
      minutes = 720 - 4 * (lon + (rise ? H : -H)) - eq;
    }
    return minutes;
  },
  noonUTC(jd0, lon) {
    let minutes = 720 - 4 * lon;
    for (let pass = 0; pass < 3; pass++) minutes = 720 - 4 * lon - noaa.eqTime(noaa.centuries(jd0 + minutes / 1440.0));
    return minutes;
  },
  /** full NOAA position incl. refraction */
  position(date, lat, lon) {
    const t = noaa.centuries(jdOf(date)), eq = noaa.eqTime(t), dec = noaa.decl(t);
    const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 6e4;
    const tst = ((utcMin + eq + 4 * lon) % 1440 + 1440) % 1440;
    let ha = tst / 4 - 180; if (ha < -180) ha += 360;
    const latR = lat * RAD, dR = dec * RAD, hR = ha * RAD;
    const cz = Math.sin(latR) * Math.sin(dR) + Math.cos(latR) * Math.cos(dR) * Math.cos(hR);
    const zen = Math.acos(cz) * DEG; const el = 90 - zen;
    const az = wrap360(Math.atan2(-Math.sin(hR), Math.tan(dR) * Math.cos(latR) - Math.sin(latR) * Math.cos(hR)) * DEG);
    return { az, elev: el, decl: dec, eqTime: eq };
  },
};

/** Saemundsson refraction (arcmin→deg) for TRUE altitude (deg), 1010 hPa, 10 C — same standard atmosphere NOAA assumes */
const saemundsson = (h) => (1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD)) / 60;

// ---------------------------------------------------------------------------
// Reference 4: bisection root finding on a geometric altitude function
// ---------------------------------------------------------------------------
function bisect(f, lo, hi, iters = 60) { // f(lo) and f(hi) have opposite signs
  let flo = f(lo);
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}

// ===========================================================================
section('Position: sun.js vs PSA vs Michalsky vs NOAA (az/el within 0.05 deg)');
{
  const dates = [[2026, 3, 20], [2026, 6, 21], [2026, 9, 22], [2026, 12, 21], [2026, 1, 15], [2026, 4, 23],
                 [2026, 8, 20], [2025, 11, 9], [2027, 2, 4], [2030, 7, 1], [2024, 10, 12], [2026, 5, 5]];
  let maxPM = 0, maxAzAt = '', n = 0, nAz = 0, maxPsaEl = 0, maxPsaAz = 0, maxMiEl = 0, maxMiAz = 0, maxNoaaEl = 0, maxNoaaAz = 0, maxRef = 0;
  for (const [Y, M, D] of dates) {
    for (let h = 5; h <= 19; h += 0.5) {
      const date = dateFromLocal(Y, M, D, Math.floor(h), (h % 1) * 60, TZ);
      const s = getSunPosition(date, LAT, LNG);
      const p = psa(date, LAT, LNG), m = michalsky(date, LAT, LNG), a = noaa.position(date, LAT, LNG);
      // geometric (true) elevation is what the references provide
      const dPsaEl = Math.abs(s.trueElevation - p.elev), dMiEl = Math.abs(s.trueElevation - m.elev), dNoEl = Math.abs(s.trueElevation - a.elev);
      maxPsaEl = Math.max(maxPsaEl, dPsaEl); maxMiEl = Math.max(maxMiEl, dMiEl); maxNoaaEl = Math.max(maxNoaaEl, dNoEl);
      n++;
      // refracted elevation vs true + Saemundsson refraction (only meaningful above the horizon)
      if (s.trueElevation > -0.5) {
        const ref = p.elev + saemundsson(p.elev);
        maxRef = Math.max(maxRef, Math.abs(s.elevation - ref));
      }
      // azimuth is ill-conditioned close to the zenith: skip > 85 deg
      if (s.trueElevation < 85 && s.trueElevation > -10) {
        nAz++;
        { const d = Math.abs(angDiff(s.azimuth, p.az)); if (d > maxPsaAz) { maxPsaAz = d; maxAzAt = `${Y}-${M}-${D} ${h}h el ${s.trueElevation.toFixed(1)}`; } }
        maxPM = Math.max(maxPM, Math.abs(angDiff(p.az, m.az)));
        maxMiAz = Math.max(maxMiAz, Math.abs(angDiff(s.azimuth, m.az)));
        maxNoaaAz = Math.max(maxNoaaAz, Math.abs(angDiff(s.azimuth, a.az)));
      }
    }
  }
  console.log(`  ${n} instants (${nAz} for azimuth). max |Δ|: PSA el ${maxPsaEl.toFixed(4)} az ${maxPsaAz.toFixed(4)} | Michalsky el ${maxMiEl.toFixed(4)} az ${maxMiAz.toFixed(4)} | NOAA el ${maxNoaaEl.toFixed(5)} az ${maxNoaaAz.toFixed(5)} | refraction ${maxRef.toFixed(4)}  (PSA vs Michalsky az ${maxPM.toFixed(4)}; worst sun.js-vs-PSA az at ${maxAzAt})`);
  check('PSA elevation <= 0.05', maxPsaEl <= 0.05, maxPsaEl); check('PSA azimuth <= 0.05', maxPsaAz <= 0.05, maxPsaAz);
  check('Michalsky elevation <= 0.05', maxMiEl <= 0.05, maxMiEl); check('Michalsky azimuth <= 0.05', maxMiAz <= 0.05, maxMiAz);
  check('NOAA-procedure elevation <= 0.001', maxNoaaEl <= 0.001, maxNoaaEl); check('NOAA-procedure azimuth <= 0.001', maxNoaaAz <= 0.001, maxNoaaAz);
  check('refraction (apparent elev) within 0.03 of Saemundsson', maxRef <= 0.03, maxRef);
}

// Fixed regression table for Nagari. Values were generated once from sun.js and cross-checked at that
// time against the NOAA procedure (1e-5 deg), PSA and Michalsky (<0.04 deg); they are written out so that
// an accidental change to sun.js is caught even if the references above were edited in the same way.
section('Position: fixed reference table, Nagari 13.3127 N 79.5703 E (IST)');
{
  const table = [ // [Y, M, D, hh, mm, azimuth, apparent elevation, true elevation]
    [2026, 12, 21, 10, 30, 146.260, 45.921, 45.905],
    [2026, 6, 21, 12, 0, 17.037, 79.385, 79.382],
    [2026, 3, 20, 8, 0, 96.392, 24.446, 24.410],
    [2026, 9, 22, 16, 30, 264.475, 23.038, 23.000],
    [2026, 12, 21, 7, 0, 115.815, 6.068, 5.927],
    [2026, 6, 21, 17, 30, 291.073, 15.141, 15.082],
    [2026, 3, 20, 12, 0, 160.127, 75.739, 75.735],
  ];
  for (const [Y, M, D, hh, mm, az, el, tel] of table) {
    const date = dateFromLocal(Y, M, D, hh, mm, TZ);
    const s = getSunPosition(date, LAT, LNG), p = psa(date, LAT, LNG), m = michalsky(date, LAT, LNG), a = noaa.position(date, LAT, LNG);
    const tag = `${Y}-${M}-${D} ${hh}:${String(mm).padStart(2, '0')}`;
    near(`table az ${tag}`, s.azimuth, az, 0.002); near(`table el ${tag}`, s.elevation, el, 0.002); near(`table true el ${tag}`, s.trueElevation, tel, 0.002);
    near(`NOAA-proc az ${tag}`, az, a.az, 0.002); near(`NOAA-proc true el ${tag}`, tel, a.elev, 0.002);
    near(`PSA az ${tag}`, az, p.az, 0.05); near(`PSA true el ${tag}`, tel, p.elev, 0.05);
    near(`Michalsky az ${tag}`, az, m.az, 0.05); near(`Michalsky true el ${tag}`, tel, m.elev, 0.05);
  }
}

// ===========================================================================
section('Analytic anchors');
{
  // Solstices: |declination| = obliquity of date (23.436 deg in 2026) within 0.01
  const jun = getSunPosition(new Date(Date.UTC(2026, 5, 21, 8, 24)), LAT, LNG);
  const dec = getSunPosition(new Date(Date.UTC(2026, 11, 21, 20, 50)), LAT, LNG);
  near('declination @ 2026-06-21 solstice', jun.declination, 23.436, 0.01);
  near('declination @ 2026-12-21 solstice', dec.declination, -23.436, 0.01);
  // Equinoxes: declination ~ 0
  near('declination @ 2026 March equinox (Mar 20 14:46 UTC)', getSunPosition(new Date(Date.UTC(2026, 2, 20, 14, 46)), LAT, LNG).declination, 0, 0.02);
  near('declination @ 2026 Sept equinox (Sep 23 00:05 UTC)', getSunPosition(new Date(Date.UTC(2026, 8, 23, 0, 5)), LAT, LNG).declination, 0, 0.02);
  // Declination matches PSA/Michalsky across the year within 0.02
  let maxD = 0;
  for (let d = 0; d < 365; d += 5) {
    const date = new Date(Date.UTC(2026, 0, 1 + d, 6, 30));
    maxD = Math.max(maxD, Math.abs(getSunPosition(date, LAT, LNG).declination - psa(date, LAT, LNG).decl), Math.abs(getSunPosition(date, LAT, LNG).declination - michalsky(date, LAT, LNG).decl));
  }
  console.log(`  max declination Δ vs PSA/Michalsky over 2026: ${maxD.toFixed(4)} deg`);
  check('declination across the year within 0.02 deg', maxD < 0.02, maxD);

  // Solar noon: elevation = 90 - |lat - dec| and the sun is exactly due north/south.
  for (const [Y, M, D] of [[2026, 6, 21], [2026, 12, 21], [2026, 3, 20], [2026, 2, 10], [2026, 10, 3]]) {
    const t = getSunTimes(dateFromLocal(Y, M, D, 12, 0), LAT, LNG, TZ);
    const s = getSunPosition(t.solarNoon, LAT, LNG);
    near(`noon true elevation ${Y}-${M}-${D}`, s.trueElevation, 90 - Math.abs(LAT - s.declination), 0.003);
    const az = s.declination > LAT ? 0 : 180;
    near(`noon azimuth ${Y}-${M}-${D}`, Math.abs(angDiff(s.azimuth, az)), 0, 0.2);
  }
  // Solar noon IST: 12:00 + 4 min * (82.5 - 79.5703) - EoT  (lng 79.5703 is west of the IST meridian)
  const tn = getSunTimes(dateFromLocal(2026, 12, 21, 12, 0), LAT, LNG, TZ);
  const noonMin = (tn.solarNoon.getTime() - dateFromLocal(2026, 12, 21, 0, 0).getTime()) / 60000;
  const eq = noaa.eqTime(noaa.centuries(jdOf(tn.solarNoon)));
  near('solar noon (min after IST midnight), 21 Dec', noonMin, 720 + 4 * (82.5 - LNG) - eq, 0.05);
}

// ===========================================================================
section('Sunrise / sunset / solar noon vs NOAA procedure and vs bisection (within 1 min)');
{
  let maxRise = 0, maxSet = 0, maxNoon = 0, maxRiseB = 0, maxSetB = 0, n = 0;
  const dates = [];
  for (let m = 1; m <= 12; m++) { dates.push([2026, m, 1], [2026, m, 21]); }
  dates.push([2025, 11, 9], [2028, 2, 29], [2030, 6, 21]);
  for (const [Y, M, D] of dates) {
    const sun = getSunTimes(dateFromLocal(Y, M, D, 12, 0), LAT, LNG, TZ);
    const base = dateFromLocal(Y, M, D, 0, 0, TZ).getTime();            // local midnight (UTC instant)
    const jd0 = jdOf(new Date(Date.UTC(Y, M - 1, D)));                  // 00:00 UTC of the (same) calendar day
    const dayUtc0 = Date.UTC(Y, M - 1, D);
    const rN = new Date(dayUtc0 + noaa.eventUTC(true, jd0, LAT, LNG) * 60000);
    const sN = new Date(dayUtc0 + noaa.eventUTC(false, jd0, LAT, LNG) * 60000);
    const nN = new Date(dayUtc0 + noaa.noonUTC(jd0, LNG) * 60000);
    // bisection on geometric altitude = -0.833 deg
    const f = (ms) => psa(new Date(ms), LAT, LNG).elev + 0.8333;
    const fM = (ms) => michalsky(new Date(ms), LAT, LNG).elev + 0.8333;
    const noonMs = sun.solarNoon.getTime();
    const riseB = bisect(f, noonMs - 9 * 3600e3, noonMs), setB = bisect((x) => -f(x), noonMs, noonMs + 9 * 3600e3);
    const riseM = bisect(fM, noonMs - 9 * 3600e3, noonMs), setM = bisect((x) => -fM(x), noonMs, noonMs + 9 * 3600e3);
    const dRise = Math.abs(sun.sunrise - rN) / 60000, dSet = Math.abs(sun.sunset - sN) / 60000, dNoon = Math.abs(sun.solarNoon - nN) / 60000;
    const dRiseB = Math.max(Math.abs(sun.sunrise - riseB), Math.abs(sun.sunrise - riseM)) / 60000;
    const dSetB = Math.max(Math.abs(sun.sunset - setB), Math.abs(sun.sunset - setM)) / 60000;
    maxRise = Math.max(maxRise, dRise); maxSet = Math.max(maxSet, dSet); maxNoon = Math.max(maxNoon, dNoon);
    maxRiseB = Math.max(maxRiseB, dRiseB); maxSetB = Math.max(maxSetB, dSetB); n++;
    check(`sunrise < noon < sunset ${Y}-${M}-${D}`, sun.sunrise < sun.solarNoon && sun.solarNoon < sun.sunset);
    check(`dayLength consistent ${Y}-${M}-${D}`, Math.abs((sun.sunset - sun.sunrise) / 3600e3 - sun.dayLengthHours) < 1e-6);
    void base;
  }
  console.log(`  ${n} dates. max |Δ| vs NOAA procedure: sunrise ${maxRise.toFixed(3)} min, sunset ${maxSet.toFixed(3)} min, noon ${maxNoon.toFixed(3)} min;  vs bisection(PSA/Michalsky): sunrise ${maxRiseB.toFixed(3)} min, sunset ${maxSetB.toFixed(3)} min`);
  check('sunrise vs NOAA <= 1 min', maxRise <= 1, maxRise); check('sunset vs NOAA <= 1 min', maxSet <= 1, maxSet);
  check('solar noon vs NOAA <= 1 min', maxNoon <= 1, maxNoon);
  check('sunrise vs bisection <= 1 min', maxRiseB <= 1, maxRiseB); check('sunset vs bisection <= 1 min', maxSetB <= 1, maxSetB);

  // pretty table for the report
  const fmt = (d) => { const p = localParts(d, TZ); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
  for (const [Y, M, D] of [[2026, 3, 20], [2026, 6, 21], [2026, 9, 22], [2026, 12, 21]]) {
    const s = getSunTimes(dateFromLocal(Y, M, D, 12, 0), LAT, LNG, TZ);
    console.log(`  ${Y}-${String(M).padStart(2, '0')}-${D}: sunrise ${fmt(s.sunrise)}  noon ${fmt(s.solarNoon)}  sunset ${fmt(s.sunset)}  day ${s.dayLengthHours.toFixed(2)} h`);
  }
  // the sun is at -0.833 geometric altitude at the returned sunrise (PSA, independent)
  const s21 = getSunTimes(dateFromLocal(2026, 12, 21, 12, 0), LAT, LNG, TZ);
  near('geometric altitude at sunrise = -0.833 (PSA)', psa(s21.sunrise, LAT, LNG).elev, -0.8333, 0.05); // 0.05 deg = 12 s of sun motion at the horizon
  near('geometric altitude at sunset  = -0.833 (PSA)', psa(s21.sunset, LAT, LNG).elev, -0.8333, 0.05);
  // The argument can be any instant of the local day, including local early morning that is the previous UTC day
  const a = getSunTimes(dateFromLocal(2026, 12, 21, 0, 10), LAT, LNG, TZ), b = getSunTimes(dateFromLocal(2026, 12, 21, 23, 50), LAT, LNG, TZ);
  check('getSunTimes: same local day from 00:10 and 23:50', a.sunrise.getTime() === b.sunrise.getTime() && a.sunset.getTime() === b.sunset.getTime());
  const c = getSunTimes(dateFromLocal(2026, 12, 21, 5, 0), LAT, LNG, TZ);
  check('getSunTimes: 05:00 IST (= 23:30 UTC previous day) still returns 21 Dec', localParts(c.sunrise, TZ).day === 21);
}

// ===========================================================================
section('Helpers: vectors, date <-> local time, clear-sky irradiance');
{
  const eps = 1e-12;
  const cases = [[0, 0], [90, 0], [180, 0], [270, 0], [0, 90], [37, 25], [146.26, 45.92], [312.5, 8.3]];
  for (const [az, el] of cases) {
    const [x, y, z] = sunVectorPlan(az, el);
    near(`plan vector unit az${az} el${el}`, Math.hypot(x, y, z), 1, eps);
    const [X, Y, Z] = sunVectorWorld(az, el);
    near(`world vector unit az${az} el${el}`, Math.hypot(X, Y, Z), 1, eps);
    // world = (x, z, -y)
    near(`world X = plan x`, X, x, eps); near(`world Y = plan z`, Y, z, eps); near(`world Z = -plan y`, Z, -y, eps);
    // round trip: elevation = asin(Y), azimuth = atan2(X, -Z)
    near(`elevation round trip az${az} el${el}`, Math.asin(Y) * DEG, el, 1e-9);
    if (el < 89) near(`azimuth round trip az${az} el${el}`, wrap360(Math.atan2(X, -Z) * DEG), wrap360(az), 1e-9);
  }
  const N = sunVectorWorld(0, 0), E = sunVectorWorld(90, 0), S = sunVectorWorld(180, 0), W = sunVectorWorld(270, 0), U = sunVectorWorld(0, 90);
  check('north is -Z in world', Math.abs(N[2] + 1) < 1e-12 && Math.abs(N[0]) < 1e-12);
  check('east is +X in world', Math.abs(E[0] - 1) < 1e-12);
  check('south is +Z in world', Math.abs(S[2] - 1) < 1e-12);
  check('west is -X in world', Math.abs(W[0] + 1) < 1e-12);
  check('zenith is +Y in world', Math.abs(U[1] - 1) < 1e-12);
  // The real sun at 21 Dec 10:30 IST is south-east and 46 deg up: world X>0, Z>0, Y>0
  const s = getSunPosition(dateFromLocal(2026, 12, 21, 10, 30), LAT, LNG);
  const v = sunVectorWorld(s.azimuth, s.elevation);
  check('21 Dec 10:30 sun is SE-up in world axes', v[0] > 0 && v[1] > 0 && v[2] > 0, JSON.stringify(v));

  // dateFromLocal / localParts
  const d = dateFromLocal(2026, 12, 21, 10, 30, 5.5);
  check('dateFromLocal(2026-12-21 10:30 IST) = 05:00 UTC', d.toISOString() === '2026-12-21T05:00:00.000Z', d.toISOString());
  const lp = localParts(d, 5.5);
  check('localParts round trip', lp.year === 2026 && lp.month === 12 && lp.day === 21 && lp.hour === 10 && lp.minute === 30 && lp.dayOfYear === 355, JSON.stringify(lp));
  const lp2 = localParts(new Date(Date.UTC(2026, 11, 20, 20, 0)), 5.5);   // 20 Dec 20:00 UTC = 21 Dec 01:30 IST
  check('localParts crosses midnight', lp2.day === 21 && lp2.hour === 1 && lp2.minute === 30, JSON.stringify(lp2));
  check('dayOfYear leap year (2028-03-01 = 61)', localParts(dateFromLocal(2028, 3, 1, 12, 0), 5.5).dayOfYear === 61);
  check('default utcOffset is IST', dateFromLocal(2026, 1, 1, 5, 30).toISOString() === '2026-01-01T00:00:00.000Z');

  // clear-sky irradiance
  const c0 = clearSkyIrradiance(0), cm = clearSkyIrradiance(-5);
  check('irradiance zero at/below horizon', c0.dni === 0 && c0.ghi === 0 && cm.dni === 0);
  let prev = 0, mono = true;
  for (let e = 1; e <= 90; e += 1) { const c = clearSkyIrradiance(e); if (c.dni < prev) mono = false; prev = c.dni; }
  check('DNI increases monotonically with elevation', mono);
  const z90 = clearSkyIrradiance(90), z30 = clearSkyIrradiance(30), z10 = clearSkyIrradiance(10);
  near('DNI at zenith ~ 947 W/m2 (Meinel, AM=1)', z90.dni, 947, 5);
  check('DNI @30 deg in 700..850', z30.dni > 700 && z30.dni < 850, z30.dni);
  check('DNI @10 deg in 300..550', z10.dni > 300 && z10.dni < 550, z10.dni);
  check('GHI = DNI*sin(el) + DHI', Math.abs(z30.ghi - (z30.dni * Math.sin(30 * RAD) + z30.dhi)) < 1e-9);
  check('air mass @90 = 1 and @30 ~ 2', Math.abs(z90.airMass - 1) < 1e-3 && Math.abs(z30.airMass - 2) < 0.01, `${z90.airMass} ${z30.airMass}`);
  check('diffuse fraction sensible (<25% of GHI @60 deg)', clearSkyIrradiance(60).dhi / clearSkyIrradiance(60).ghi < 0.25);
}

// ===========================================================================
section('Continuity / monotonic sanity');
{
  // azimuth increases monotonically through the day (northern-hemisphere sun in the tropics, away from the zenith): check on 21 Dec
  let prev = -1, ok = true;
  for (let m = 6 * 60 + 30; m <= 17 * 60 + 30; m += 5) {
    const s = getSunPosition(dateFromLocal(2026, 12, 21, Math.floor(m / 60), m % 60), LAT, LNG);
    if (s.azimuth < prev) ok = false; prev = s.azimuth;
  }
  check('21 Dec azimuth increases through the day', ok);
  // Smoothness: no jump > 1 deg between 1-minute steps, even across noon on a near-zenith day
  let maxJump = 0, last = null;
  for (let m = 6 * 60; m <= 18 * 60; m++) {
    const s = getSunPosition(dateFromLocal(2026, 12, 21, Math.floor(m / 60), m % 60), LAT, LNG);
    if (last) maxJump = Math.max(maxJump, Math.abs(angDiff(s.azimuth, last.azimuth)), Math.abs(s.elevation - last.elevation));
    last = s;
  }
  check('no discontinuities in 21 Dec track (1-min steps)', maxJump < 0.5, maxJump);
}

done('sun.test.mjs');
