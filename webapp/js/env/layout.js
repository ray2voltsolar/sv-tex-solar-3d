// ============================================================================
//  Ground-cover layout (plan coords): dirt roads, aprons, field zones.
//  Shared by the ground painter and the vegetation scatterer so weeds never
//  grow on roads, the yard or under buildings.
// ============================================================================
import { pointInPoly, distToPolyline } from './util.js';

// Laterite dirt roads / tracks: polyline + width (m). Traced from the Esri imagery
// (after the +4.5 m E / -0.5 m N alignment, see satellite.js IMAGERY_FIX).
export const ROADS = [
  // N–S dirt road ~25 m east of the compound (WA0010 is shot from it)
  { id: 'eastRoad', w: 6.0, pts: [[80, -60], [73, -20], [69.5, -5], [66.2, 10], [65.6, 28], [64.8, 48], [65.5, 70], [68, 95], [69.5, 112], [75, 178]] },
  // branch east towards the neighbouring units
  { id: 'eastBranch', w: 5.0, pts: [[65.6, 26], [92, 30], [119, 35], [155, 45.7], [201, 60], [255, 81]] },
  // apron in front of the entrance gate (x = 40, y 43.8–49.2) out to the road
  { id: 'gateApron', w: 7.0, pts: [[40.0, 46.6], [52, 46.4], [64.8, 47.2]] },
  // lane along the south compound wall (motorbike parking, WA0009)
  { id: 'southRoad', w: 5.5, pts: [[70, -5.2], [48, -4.2], [20, -4.6], [-2, -4.4], [-34, -8], [-66, -15], [-120, -22]] },
  // village road to the north
  { id: 'northRoad', w: 5.0, pts: [[-120, 96], [-34, 95.7], [20, 95.5], [68, 95.7]] },
];

// Tyre-track lines drawn on roads (offset ±half from these centre lines)
export const TRACKS = [
  { pts: ROADS[0].pts, half: 0.85 },
  { pts: ROADS[2].pts, half: 0.85 },
  { pts: [[40.0, 46.0], [44.0, 47.2], [46.0, 50.5], [46.6, 60.0]], half: 0.8 },          // to the truck / tanker
  { pts: [[64.0, 40.0], [58.0, 35.5], [53.5, 31.5], [52.4, 22.0]], half: 0.8 },           // sedans parked in the field
  { pts: ROADS[3].pts, half: 0.75 },
  { pts: ROADS[4].pts, half: 0.75 },
];

// Puddles: [x, y, rx, ry, rotationRad]
export const PUDDLES = [
  [42.6, 46.2, 1.6, 0.8, 0.2], [48.5, 46.0, 1.2, 0.55, -0.2], [56.0, 46.9, 1.4, 0.6, 0.1], [44.2, 48.6, 0.7, 0.35, 0.6],
  // main east road: only two, sitting in the wheel ruts (centre-line ± 0.85 m)
  [65.25, 20.0, 1.2, 0.42, 1.52], [64.6, 60.0, 0.8, 0.36, 1.58],
  [30.0, -3.8, 0.9, 0.3, 0.05], [10.0, -5.15, 1.1, 0.34, -0.02], [46.3, 55.0, 0.8, 0.35, 1.4], [61.0, 47.3, 0.9, 0.4, 0.3],
];

// Red laterite spoil heaps in the east field (WA0010): [x, y, radius, height]
export const HEAPS = [[47.5, 14.0, 1.3, 0.45], [50.5, 9.0, 1.0, 0.35], [53.5, 15.5, 1.5, 0.5], [45.8, 31.5, 0.9, 0.3],
  [56.5, 11.0, 1.1, 0.4], [49.0, 38.0, 1.2, 0.42], [58.0, 38.5, 0.9, 0.3], [44.5, 5.0, 1.0, 0.35]];

// Wet patches on the yard concrete: [x, y, r]
export const WET_PATCHES = [
  [36.0, 46.0, 2.6], [30.0, 45.5, 2.0], [22.5, 44.8, 1.8], [38.6, 47.8, 1.6], [24.5, 30.0, 2.2], [21.0, 38.0, 1.8],
  [26.0, 20.0, 1.6], [24.6, 4.0, 1.5], [20.5, 8.0, 1.7], [33.0, 44.2, 1.4], [27.0, 47.2, 1.5], [39.0, 30.0, 1.3],
];

// Local placement overrides for FEATURES.vehicles (photos WA0005 / WA0011: the tractor stands in
// the open ground east of Block A beside the tanker, angled, clear of the gate lane). Matched by type; see siteDataRequests in the round report.
export const VEHICLE_OVERRIDES = { tractor: { x: 43.4, y: 60.6, headingDeg: 205 } };
// sedans: parked half on the east dirt road's west verge (WA0010), not out on the grass
const SEDAN_SPOTS = [{ x: 62.35, y: 27.6 }, { x: 62.2, y: 33.4 }];
export function vehicleList(site) {
  let si = 0;
  return site.FEATURES.vehicles.map((v) => ({ ...v, ...(VEHICLE_OVERRIDES[v.type] || {}), ...(v.type === 'sedan' ? SEDAN_SPOTS[si++] || {} : {}) }));
}
// Yard clutter at the gate / east wall (WA0005, WA0009): [type, x, y, rotOrHeading]
export const PROPS = [
  // blue HDPE drums + old tyres against Block A's south wall, west of the blue sheet fence (WA0005)
  ['drum', 36.25, 49.15, 0], ['drum', 35.65, 49.2, 0.4], ['drum', 35.05, 49.15, 1.1], ['drum', 35.95, 48.6, 0.2], ['drum', 34.45, 49.2, 0.8], ['drumLying', 34.7, 48.45, 1.4],
  ['tyres', 37.15, 49.0, 4], ['tyres', 33.7, 49.1, 3],
  ['motorbike', 32.6, 48.5, 95], ['motorbike', 40.75, 38.4, 180], ['motorbike', 40.75, 36.9, 0],
];

export function roadDist(x, y) {
  let best = Infinity;
  for (const r of ROADS) best = Math.min(best, distToPolyline(x, y, r.pts) - r.w / 2);
  return best; // < 0 inside a road
}

/** Footprints (plan rects) where nothing may be scattered: buildings + features. */
export function blockers(site) {
  const out = [];
  for (const b of Object.values(site.BUILDINGS)) {
    const f = b.footprint; out.push([f.x0 - 0.3, f.y0 - 0.3, f.x1 + 0.3, f.y1 + 0.3]);
  }
  for (const p of PROPS) out.push([p[1] - 0.8, p[2] - 0.8, p[1] + 0.8, p[2] + 0.8]);
  for (const v of vehicleList(site)) {
    const r = v.type === 'motorbike' ? 1.4 : v.type === 'sedan' ? 3.0 : 3.8;
    out.push([v.x - r, v.y - r, v.x + r, v.y + r]);
  }
  return out;
}

export function inYard(site, x, y) { return pointInPoly(x, y, site.SITE.yardPolygon); }

/** Classify a plan point for scattering: 'yard' | 'road' | 'blocked' | 'field'. */
export function classify(site, x, y, blk) {
  if (inYard(site, x, y)) return 'yard';
  if (roadDist(x, y) < 0.4) return 'road';
  for (const r of blk) if (x > r[0] && x < r[2] && y > r[1] && y < r[3]) return 'blocked';
  return 'field';
}
