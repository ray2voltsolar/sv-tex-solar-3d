// ============================================================================
//  Solar position — NOAA General Solar Position algorithm (Meeus-based).
//  Accuracy ≈ ±0.01° for years 1800–2100. Pure math, no three.js (Node OK).
//  Azimuth: degrees clockwise from true North. Elevation: degrees above horizon
//  (with atmospheric refraction correction).
// ============================================================================

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Build a JS Date (UTC instant) from a local civil time at utcOffsetHours (IST = 5.5). */
export function dateFromLocal(year, month /* 1-12 */, day, hour = 12, minute = 0, utcOffsetHours = 5.5) {
  const ms = Date.UTC(year, month - 1, day, hour, minute) - utcOffsetHours * 3600e3;
  return new Date(ms);
}

/** Local civil time parts of a Date at a fixed UTC offset. */
export function localParts(date, utcOffsetHours = 5.5) {
  const d = new Date(date.getTime() + utcOffsetHours * 3600e3);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
           hour: d.getUTCHours(), minute: d.getUTCMinutes(), dayOfYear: dayOfYear(d) };
}

function dayOfYear(d) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400e3) + 1;
}

function solarTerms(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const l0 = ((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360 + 360) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const c = Math.sin(m * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
          + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * jc)
          + Math.sin(3 * m * RAD) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(appLong * RAD)) * DEG;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 * DEG * (y * Math.sin(2 * l0 * RAD) - 2 * e * Math.sin(m * RAD)
      + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD)
      - 0.5 * y * y * Math.sin(4 * l0 * RAD) - 1.25 * e * e * Math.sin(2 * m * RAD)); // minutes
  const sunRadVector = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos((m + c) * RAD)); // AU
  return { jd, jc, decl, eqTime, sunRadVector };
}

/**
 * Sun position for a UTC instant at (lat, lng) — lng positive east.
 * @returns {{azimuth:number, elevation:number, zenith:number, trueElevation:number,
 *            declination:number, eqTime:number, hourAngle:number, distanceAU:number}}
 */
export function getSunPosition(date, lat, lng) {
  const t = solarTerms(date);
  const utcMin = ((date.getTime() / 60000) % 1440 + 1440) % 1440;
  let tst = (utcMin + t.eqTime + 4 * lng) % 1440; if (tst < 0) tst += 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const latR = lat * RAD, decR = t.decl * RAD;
  let cosZ = Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(ha * RAD);
  cosZ = Math.min(1, Math.max(-1, cosZ));
  const zen = Math.acos(cosZ) * DEG;
  const trueElev = 90 - zen;
  // refraction (NOAA)
  let refr = 0;
  if (trueElev <= 85) {
    const te = Math.tan(trueElev * RAD);
    if (trueElev > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (trueElev > -0.575) refr = 1735 + trueElev * (-518.2 + trueElev * (103.4 + trueElev * (-12.79 + trueElev * 0.711)));
    else refr = -20.772 / te;
    refr /= 3600;
  }
  const elev = trueElev + refr;
  let az;
  const denom = Math.cos(latR) * Math.sin(zen * RAD);
  if (Math.abs(denom) < 1e-9) az = 180;
  else {
    let a = (Math.sin(latR) * Math.cos(zen * RAD) - Math.sin(decR)) / denom;
    a = Math.min(1, Math.max(-1, a));
    const acosA = Math.acos(a) * DEG;
    az = ha > 0 ? (acosA + 180) % 360 : (540 - acosA) % 360;
  }
  return { azimuth: az, elevation: elev, zenith: 90 - elev, trueElevation: trueElev,
           declination: t.decl, eqTime: t.eqTime, hourAngle: ha, distanceAU: t.sunRadVector };
}

/**
 * Sunrise, solar noon and sunset (as Date instants) for the local calendar day
 * containing `date` at utcOffsetHours.
 */
export function getSunTimes(date, lat, lng, utcOffsetHours = 5.5) {
  const p = localParts(date, utcOffsetHours);
  // iterate twice for accuracy (terms evaluated near noon)
  let noonLocalMin = 720;
  let t;
  for (let i = 0; i < 2; i++) {
    const d = dateFromLocal(p.year, p.month, p.day, 0, 0, utcOffsetHours);
    t = solarTerms(new Date(d.getTime() + noonLocalMin * 60000));
    noonLocalMin = 720 - 4 * lng - t.eqTime + utcOffsetHours * 60;
  }
  const latR = lat * RAD, decR = t.decl * RAD;
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(latR) * Math.cos(decR)) - Math.tan(latR) * Math.tan(decR);
  const H = Math.acos(Math.min(1, Math.max(-1, cosH))) * DEG; // degrees
  const base = dateFromLocal(p.year, p.month, p.day, 0, 0, utcOffsetHours).getTime();
  return {
    sunrise: new Date(base + (noonLocalMin - 4 * H) * 60000),
    solarNoon: new Date(base + noonLocalMin * 60000),
    sunset: new Date(base + (noonLocalMin + 4 * H) * 60000),
    dayLengthHours: (8 * H) / 60,
  };
}

/** Unit vector pointing TO the sun in PLAN coords [x east, y north, z up]. */
export function sunVectorPlan(azimuthDeg, elevationDeg) {
  const a = azimuthDeg * RAD, e = elevationDeg * RAD;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/** Unit vector pointing TO the sun in three.js WORLD coords [X east, Y up, Z south]. */
export function sunVectorWorld(azimuthDeg, elevationDeg) {
  const [x, y, z] = sunVectorPlan(azimuthDeg, elevationDeg);
  return [x, z, -y];
}

/**
 * Simple clear-sky irradiance (W/m²) — Meinel DNI with Kasten-Young air mass,
 * diffuse ≈ 10 % of DNI·cos(zenith) + small floor. Good enough to weight
 * shading analysis; NOT a bankable energy model (use PVGIS numbers for that).
 */
export function clearSkyIrradiance(elevationDeg) {
  if (elevationDeg <= 0) return { dni: 0, dhi: 0, ghi: 0, airMass: Infinity };
  const z = 90 - elevationDeg;
  const am = 1 / (Math.cos(z * RAD) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
  const dni = 1353 * Math.pow(0.7, Math.pow(am, 0.678));
  const dhi = 0.1 * dni * Math.cos(z * RAD) + 20 * Math.sin(elevationDeg * RAD);
  const ghi = dni * Math.cos(z * RAD) + dhi;
  return { dni, dhi, ghi, airMass: am };
}
