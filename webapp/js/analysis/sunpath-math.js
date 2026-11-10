// ============================================================================
//  sunpath-math.js — pure geometry for the 3D sun path (no three.js). Node-testable.
//  World coordinates: X east, Y up, Z south (north = -Z), see sun.js.
// ============================================================================
import { getSunPosition, getSunTimes, dateFromLocal, sunVectorWorld } from './sun.js';

/** Point on the dome of radius R around `center` ([x,y,z] world) for a sun azimuth/elevation (deg). */
export function domePoint(azimuthDeg, elevationDeg, R, center = [0, 0, 0]) {
  const d = sunVectorWorld(azimuthDeg, elevationDeg);
  return [center[0] + d[0] * R, center[1] + d[1] * R, center[2] + d[2] * R];
}

/** Instant (ms) where the apparent (refracted) elevation crosses 0, bracketed by tA and tB (opposite signs). */
function horizonCrossing(tA, tB, lat, lng) {
  const el = (t) => getSunPosition(new Date(t), lat, lng).elevation;
  let a = tA, b = tB;
  const below = el(a) < 0;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if ((el(m) < 0) === below) a = m; else b = m;
  }
  return (a + b) / 2;
}

/**
 * The sun's track for one local calendar day.
 * @returns {{
 *   year,month,day, sunrise:Date, sunset:Date, solarNoon:Date,
 *   tRise:number, tSet:number,            // ms — instants where the apparent elevation is exactly 0
 *   points:[{t:number, az:number, el:number}],   // from horizon to horizon, step minutes apart (+ both exact end points)
 *   hours:[{hour:number, t:number, az:number, el:number, index:number}],  // each whole local clock hour inside the arc; index = points[] index at/just before
 *   noon:{az:number, el:number} }}
 */
export function dayTrack({ year, month, day }, opts = {}) {
  const lat = opts.lat ?? 13.3127, lng = opts.lng ?? 79.5703, tz = opts.utcOffsetHours ?? 5.5, stepMin = opts.stepMin ?? 2;
  const st = getSunTimes(dateFromLocal(year, month, day, 12, 0, tz), lat, lng, tz);
  const noonMs = st.solarNoon.getTime();
  const tRise = horizonCrossing(st.sunrise.getTime() - 20 * 60000, noonMs, lat, lng);
  const tSet = horizonCrossing(st.sunset.getTime() + 20 * 60000, noonMs, lat, lng);
  const points = [];
  const push = (t) => { const p = getSunPosition(new Date(t), lat, lng); points.push({ t, az: p.azimuth, el: Math.max(0, p.elevation) }); };
  push(tRise);
  const step = stepMin * 60000;
  for (let t = tRise + step; t < tSet - step * 0.25; t += step) push(t);
  push(tSet);
  const base = dateFromLocal(year, month, day, 0, 0, tz).getTime();
  const hours = [];
  for (let h = Math.ceil((tRise - base) / 3600000); h <= Math.floor((tSet - base) / 3600000); h++) {
    const t = base + h * 3600000;
    if (t <= tRise || t >= tSet) continue;
    const p = getSunPosition(new Date(t), lat, lng);
    let index = 0; while (index + 1 < points.length && points[index + 1].t <= t) index++;
    hours.push({ hour: h, t, az: p.azimuth, el: p.elevation, index });
  }
  const pn = getSunPosition(st.solarNoon, lat, lng);
  return { year, month, day, sunrise: st.sunrise, sunset: st.sunset, solarNoon: st.solarNoon, tRise, tSet, points, hours, noon: { az: pn.azimuth, el: pn.elevation } };
}

/** Number of line segments of `track.points` that the sun has already travelled at instant `t` (ms). 0..points.length-1 */
export function segmentsTravelled(track, t) {
  const p = track.points;
  if (t <= p[0].t) return 0;
  if (t >= p[p.length - 1].t) return p.length - 1;
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].t <= t) lo = mid; else hi = mid; }
  return lo;                                        // segment [lo, lo+1] is the one containing t (partially travelled)
}

/** 12-hour clock label, e.g. 7 → "7am", 12 → "12pm", 13 → "1pm". */
export function hourLabel(h) {
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ap}`;
}

export const COMPASS = [
  { text: 'N', az: 0, major: true }, { text: 'E', az: 90, major: true }, { text: 'S', az: 180, major: true }, { text: 'W', az: 270, major: true },
  { text: 'NE', az: 45, major: false }, { text: 'SE', az: 135, major: false }, { text: 'SW', az: 225, major: false }, { text: 'NW', az: 315, major: false },
];

/** Closed ring of `n` points at radius R, height y, around center ([x,y,z]); returned as flat xyz array (n+1 points, closed). */
export function ringPoints(R, y, center, n = 180) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; out.push(center[0] + Math.sin(a) * R, y, center[2] - Math.cos(a) * R); }
  return out;                                       // starts at north (−Z), runs clockwise seen from above (N → E → S → W)
}
