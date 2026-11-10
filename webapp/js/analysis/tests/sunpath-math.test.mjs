// sunpath-math.js tests — run:  node webapp/js/analysis/tests/sunpath-math.test.mjs
import { domePoint, dayTrack, segmentsTravelled, hourLabel, ringPoints, COMPASS } from '../sunpath-math.js';
import { getSunPosition, dateFromLocal, localParts } from '../sun.js';
import { check, near, section, done, angDiff, DEG } from './testkit.mjs';

const LAT = 13.3127, LNG = 79.5703, C = [20, 0, -34], R = 90;

section('domePoint');
{
  const n = domePoint(0, 0, R, C), e = domePoint(90, 0, R, C), s = domePoint(180, 0, R, C), w = domePoint(270, 0, R, C), z = domePoint(0, 90, R, C);
  near('north on the dome is -Z', n[2], C[2] - R, 1e-9); near('east is +X', e[0], C[0] + R, 1e-9);
  near('south is +Z', s[2], C[2] + R, 1e-9); near('west is -X', w[0], C[0] - R, 1e-9); near('zenith height', z[1], R, 1e-9);
  const p = domePoint(146.26, 45.92, R, C);
  near('point lies on the sphere', Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]), R, 1e-9);
}

section('dayTrack: 21 Dec / 21 Jun / equinox');
for (const [Y, M, D, name] of [[2026, 12, 21, 'Dec21'], [2026, 6, 21, 'Jun21'], [2026, 3, 20, 'Mar20']]) {
  const t = dayTrack({ year: Y, month: M, day: D });
  const P = t.points;
  near(`${name}: first point is on the horizon`, getSunPosition(new Date(P[0].t), LAT, LNG).elevation, 0, 2e-4);
  near(`${name}: last point is on the horizon`, getSunPosition(new Date(P[P.length - 1].t), LAT, LNG).elevation, 0, 2e-4);
  check(`${name}: times strictly increasing`, P.every((p, i) => i === 0 || p.t > P[i - 1].t));
  check(`${name}: elevations non-negative and unimodal (rise then fall)`, (() => { let peak = P.reduce((a, p, i) => (p.el > P[a].el ? i : a), 0); return P.every((p, i) => p.el >= 0 && (i === 0 || i > peak || p.el >= P[i - 1].el - 1e-9) && (i <= peak || p.el <= P[i - 1].el + 1e-9)); })());
  check(`${name}: ~2-min spacing`, P.slice(1, -1).every((p, i) => Math.abs(p.t - P[i].t - 120000) < 1e-3));
  check(`${name}: point count 330-380`, P.length > 330 && P.length < 400, P.length);
  const peak = P.reduce((a, p) => (p.el > a.el ? p : a), P[0]);
  near(`${name}: peak elevation = noon elevation`, peak.el, t.noon.el, 0.02);
  // noon elevation analytic: 90 - |lat - dec|
  const dec = getSunPosition(t.solarNoon, LAT, LNG).declination;
  near(`${name}: noon elevation = 90-|lat-dec| (apparent, +refraction < 0.02)`, t.noon.el, 90 - Math.abs(LAT - dec), 0.02);
  // sunrise azimuth east of north on the right side
  const riseAz = P[0].az, setAz = P[P.length - 1].az;
  near(`${name}: sunrise/sunset azimuths mirror about south`, angDiff(riseAz, 180) + angDiff(setAz, 180), 0, 1.5);
  // hours
  check(`${name}: hour marks on whole IST hours`, t.hours.every((h) => { const lp = localParts(new Date(h.t)); return lp.minute === 0; }));
  check(`${name}: hour marks strictly inside the arc, consecutive`, t.hours.every((h, i) => h.t > P[0].t && h.t < P[P.length - 1].t && (i === 0 || h.hour === t.hours[i - 1].hour + 1)));
  check(`${name}: hour mark index brackets the instant`, t.hours.every((h) => P[h.index].t <= h.t && (h.index + 1 >= P.length || P[h.index + 1].t > h.t)));
  check(`${name}: sample positions agree with sun.js`, (() => { const p = P[100], s = getSunPosition(new Date(p.t), LAT, LNG); return Math.abs(p.az - s.azimuth) < 1e-9 && Math.abs(p.el - s.elevation) < 1e-9; })());
  console.log(`  ${name}: sunrise az ${riseAz.toFixed(1)}  peak el ${peak.el.toFixed(1)} at az ${peak.az.toFixed(0)}  sunset az ${setAz.toFixed(1)}; hour marks ${t.hours[0].hour}..${t.hours[t.hours.length - 1].hour}`);
}
{
  const t = dayTrack({ year: 2026, month: 12, day: 21 });
  check('Dec 21: hours 7..17 (sunrise 06:29, sunset 17:49 → first whole hour 7, last 17)', t.hours[0].hour === 7 && t.hours[t.hours.length - 1].hour === 17, t.hours.map((h) => h.hour).join(','));
  const j = dayTrack({ year: 2026, month: 6, day: 21 });
  check('Jun 21: hours 6..18', j.hours[0].hour === 6 && j.hours[j.hours.length - 1].hour === 18, j.hours.map((h) => h.hour).join(','));
}

section('segmentsTravelled');
{
  const t = dayTrack({ year: 2026, month: 12, day: 21 });
  const P = t.points;
  check('before sunrise → 0', segmentsTravelled(t, P[0].t - 1e6) === 0);
  check('after sunset → all segments', segmentsTravelled(t, P[P.length - 1].t + 1e6) === P.length - 1);
  const mid = dateFromLocal(2026, 12, 21, 12, 0).getTime(), k = segmentsTravelled(t, mid);
  check('noon lies inside segment k', P[k].t <= mid && P[k + 1].t > mid);
  check('monotonic in t', (() => { let last = 0; for (let m = 6 * 60; m < 18 * 60; m += 7) { const v = segmentsTravelled(t, dateFromLocal(2026, 12, 21, 0, m).getTime()); if (v < last) return false; last = v; } return true; })());
}

section('labels / ring');
{
  check('hourLabel', hourLabel(6) === '6am' && hourLabel(11) === '11am' && hourLabel(12) === '12pm' && hourLabel(13) === '1pm' && hourLabel(17) === '5pm' && hourLabel(0) === '12am');
  const r = ringPoints(90, 0.4, C, 180);
  check('ring closed, 181 points', r.length === 181 * 3 && Math.abs(r[0] - r[r.length - 3]) < 1e-9 && Math.abs(r[2] - r[r.length - 1]) < 1e-9);
  near('ring starts at north (-Z)', r[2], C[2] - 90, 1e-9);
  near('quarter turn is east (+X)', r[45 * 3], C[0] + 90, 1e-9);
  check('compass has 8 entries with N/E/S/W major', COMPASS.length === 8 && COMPASS.filter((c) => c.major).map((c) => c.text).join('') === 'NESW');
}
void DEG;
done('sunpath-math.test.mjs');
