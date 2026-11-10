// ============================================================================
//  SITE DATA — the single source of truth for the 3D model.
//  Sri Venkateswara Tex Process, Nagari (AP) — 145.08 kWp rooftop PV proposal
// ----------------------------------------------------------------------------
//  PLAN COORDINATES (used everywhere in this file):
//    x = East (m), y = North (m), z = Up (m)
//    Origin = south-west outer wall corner of Block D, at finished yard level.
//  THREE.JS WORLD:  X = East, Y = Up, Z = South   (North = -Z)
//    → use planToWorld(x, y, z)  ==  new THREE.Vector3(x, z, -y)
//
//  Dimensions come from the customer's hand-measured layout sketch
//  (IMG-20261109-WA0023.jpeg). Relative positions, roof forms and obstacles
//  (turbo ventilators, ETP tanks) come from satellite imagery (Google/Airbus
//  2026, Esri World Imagery). Heights are estimated from site photos.
//  Pure data + pure math: NO three.js import, so this also runs under Node.
// ============================================================================

export const FT = 0.3048;

// ---------------------------------------------------------------------------
// Project / location
// ---------------------------------------------------------------------------
export const PROJECT = {
  customer: 'Sri Venkateswara Tex Process',
  businessType: 'Textile dyeing & processing unit',
  address: '5-7-33/5, Tiruvaluru Rd, Pallipet Rd, Prakash Nagar, Nagari, Andhra Pradesh 517592',
  plusCode: '8H7C+34 Nagari',
  preparedBy: 'Ray2Volt Solar',
  systemLabel: '145.08 kWp Rooftop Solar PV',
};

export const SITE = {
  lat: 13.3127,            // for sun position
  lng: 79.5703,
  utcOffsetHours: 5.5,     // IST
  // Approximate geographic position of the plan origin (±3 m). Used to place
  // satellite imagery under the model.
  originGeo: { lat: 13.3124826, lng: 79.5703276 },
  // Fine alignment of satellite imagery vs model, metres (+x east, +y north).
  imageryOffset: { x: 0, y: 0 },
  // Useful targets
  center: { x: 20, y: 34 },        // middle of the whole site (complex + Block A)
  complexCenter: { x: 19.5, y: 21 },
  // Extent of the detailed ground model. Satellite context extends beyond.
  detailBounds: { minX: -40, maxX: 90, minY: -40, maxY: 110 },
  // Compound (paved / yard) polygon in plan coords, counter-clockwise.
  yardPolygon: [[-1.8, -1.6], [40.0, -1.6], [40.0, 43.8], [44.0, 49.6], [40.6, 50.2], [17.0, 49.6], [-1.8, 43.0]],
};

// ---------------------------------------------------------------------------
// PV module — Vikram Solar HYPERSOL G12R (n-type TOPCon, bifacial, glass-glass)
// ---------------------------------------------------------------------------
export const MODULE = {
  make: 'Vikram Solar',
  model: 'HYPERSOL G12R 620 Wp (N-type TOPCon bifacial)',
  wp: 620,
  length: 2.384,          // m  (long side)
  width: 1.134,           // m
  thickness: 0.030,       // m  (frame depth)
  weightKg: 32.1,
  cells: 132,             // half-cut G12R cells: 6 columns × 22 rows (two halves of 11)
  cellCols: 6,
  cellRows: 22,
  cellSize: { w: 0.182, h: 0.105 },  // m, half-cut 182 × 105 mm (approx.)
  frame: { width: 0.035, color: '#c9ccd0' }, // anodised silver aluminium
  efficiencyPct: 22.93,
  // Approximate electrical data (typical for this power class)
  voc: 47.6, vmp: 39.6, isc: 16.5, imp: 15.66,
};

// Mounting: mini-rails on trapezoidal-sheet crests, mid/end clamps.
export const MOUNTING = {
  gap: 0.020,             // clamp gap between adjacent modules (m)
  walkway: 0.60,          // GI walkway width between row groups (m)
  moduleUnderside: 0.050, // module back surface above the roof-sheet crest (m)
  railLength: 0.40, railWidth: 0.045, railHeight: 0.040,
};

// ---------------------------------------------------------------------------
// Helpers (pure math)
// ---------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / len(a));
export const vec = { sub, add, mul, dot, cross, len, norm };

/** Plan (x east, y north, z up) → three.js world array [X, Y, Z]. */
export function planToWorldArray(x, y, z = 0) { return [x, z, -y]; }

/** Same, but returns a THREE.Vector3 when THREE is passed. */
export function planToWorld(THREE, x, y, z = 0) { return new THREE.Vector3(x, z, -y); }

/**
 * Build a roof plane from its eave edge (two points) and the point on the
 * high edge (ridge / high eave) above eaveStart. Ensures the normal points up.
 * u = along eave, v = up-slope, n = outward (upward) normal.
 */
function makePlane(def) {
  let { eaveStart, eaveEnd, highStart } = def;
  let u = norm(sub(eaveEnd, eaveStart));
  let v = norm(sub(highStart, eaveStart));
  let n = norm(cross(u, v));
  if (n[2] < 0) {           // flip so normal points upward: swap eave ends
    eaveStart = def.eaveEnd; eaveEnd = def.eaveStart;
    // the high edge is parallel to the eave, so shift highStart by the eave vector
    highStart = add(def.highStart, sub(def.eaveEnd, def.eaveStart));
    u = norm(sub(eaveEnd, eaveStart));
    v = norm(sub(highStart, eaveStart));
    n = norm(cross(u, v));
  }
  const width = len(sub(eaveEnd, eaveStart));
  const length = len(sub(highStart, eaveStart));
  const tiltDeg = Math.acos(n[2]) * 180 / Math.PI;
  // Azimuth the plane FACES (deg from North, clockwise) = horizontal part of n
  const azimuthDeg = ((Math.atan2(n[0], n[1]) * 180 / Math.PI) + 360) % 360;
  const corners = [eaveStart, eaveEnd, add(eaveEnd, sub(highStart, eaveStart)), highStart];
  return { ...def, eaveStart, eaveEnd, highStart, u, v, n, width, length, tiltDeg, azimuthDeg, corners };
}

/** Point on a roof plane: u along eave, v up-slope (both metres), offset along normal. */
export function planePoint(plane, u, v, offset = 0) {
  return add(add(add(plane.eaveStart, mul(plane.u, u)), mul(plane.v, v)), mul(plane.n, offset));
}

/** Inverse: project a plan point onto plane local (u, v). */
export function planeLocal(plane, p) {
  const d = sub(p, plane.eaveStart);
  return { u: dot(d, plane.u), v: dot(d, plane.v), h: dot(d, plane.n) };
}

// ---------------------------------------------------------------------------
// BUILDINGS
//   footprint = outer wall faces. roof = how the roof is formed.
//   "roof surface" = the TOP of the corrugated/trapezoidal sheet crests.
//   Wall tops sit 0.12 m below the roof surface (purlin + sheet depth).
// ---------------------------------------------------------------------------
const PITCH = 0.1; // 1:10 typical PEB slope (5.71°)

export const BUILDINGS = {
  A: {
    id: 'A', name: 'Block A', use: 'Production shed',
    dims: "71' × 59'", footprint: { x0: 18.88, y0: 50.31, x1: 40.52, y1: 68.29 },
    plinth: 0.45,
    roof: { type: 'gable', ridgeAxis: 'NS', ridgeX: 29.70, pitch: PITCH,
            wallLineZ: 6.62, ridgeZ: 6.62 + 10.82 * PITCH,
            overhang: { eaves: 1.0, gables: 0.30 },
            material: 'galvalume', note: 'Bare zincalume trapezoidal sheet, translucent skylight strips across slope (seen on satellite).'},
    eaveWallTopZ: 6.50,
    walls: { style: 'masonry+ppgi-stripes', masonryTopZ: 3.20,
             masonry: '#eeeeea', claddingStripes: ['#2f7fd0', '#e8eaec'], stripeWidth: 1.05,
             note: 'Lower part white-painted brick masonry with blue-grey steel windows/doors; upper part vertical PPGI cladding in alternating blue / off-white bands (see IMG-20261109-WA0005 & WA0011).' },
  },
  B: {
    id: 'B', name: 'Block B', use: 'Winding / yarn machines',
    dims: "57' × 20'", footprint: { x0: 0, y0: 31.09, x1: 17.37, y1: 37.19 },
    plinth: 0.30,
    roof: { type: 'gable', ridgeAxis: 'EW', ridgeY: 34.14, pitch: 0.2,
            wallLineZ: 4.72, ridgeZ: 4.72 + 3.05 * 0.2,
            overhang: { north: 0.5, south: 0.0, verges: 0.3 },
            material: 'ppgi-blue', note: 'Blue PPGI roof, south eave tucks against Block C north wall.' },
    eaveWallTopZ: 4.60,
    walls: { style: 'masonry+sheet', masonryTopZ: 2.4, masonry: '#d9d6cf', cladding: '#5d7fa6' },
  },
  C: {
    id: 'C', name: 'Block C', use: 'Processing hall',
    dims: "57' × 61'", footprint: { x0: 0, y0: 12.50, x1: 17.37, y1: 31.09 },
    plinth: 0.45,
    roof: { type: 'gable', ridgeAxis: 'NS', ridgeX: 8.685, pitch: PITCH,
            wallLineZ: 6.12, ridgeZ: 6.12 + 8.685 * PITCH,
            overhang: { eaves: 1.0, gables: 0.15 },
            material: 'galvalume-weathered', note: 'Weathered zincalume roof with 6 turbo ventilators.' },
    eaveWallTopZ: 6.00,
    walls: { style: 'masonry+sheet', masonryTopZ: 2.6, masonry: '#e4e0d6', cladding: '#9aa3ab' },
  },
  D: {
    id: 'D', name: 'Block D', use: 'Processing hall',
    dims: "61' × 39'", footprint: { x0: 0, y0: 0, x1: 18.59, y1: 11.89 },
    plinth: 0.45,
    roof: { type: 'mono', downhill: 'S', pitch: PITCH,
            // roof surface z at the north wall line and at the south wall line
            northWallLineZ: 6.42, southWallLineZ: 6.42 - 11.89 * PITCH,
            overhang: { south: 0.6, north: 0.15, verges: 0.45 },
            material: 'ppgi-green', note: 'Green PPGI single-slope roof falling to the south, 4 turbo ventilators near the high (north) edge.' },
    eaveWallTopZ: { north: 6.30, south: 6.42 - 11.89 * PITCH - 0.12 },
    walls: { style: 'masonry+sheet', masonryTopZ: 3.0, masonry: '#ebe8e1', cladding: '#8fa0ad' },
  },
  OFFICES: {
    id: 'OFFICES', name: 'Office & amenities', use: 'Office 1, Office 2, Bathrooms',
    footprint: { x0: 0, y0: 37.19, x1: 17.37, y1: 42.19 },
    plinth: 0.30, roof: { type: 'flat', slabTopZ: 3.35, parapetTopZ: 3.65, material: 'rcc' },
    rooms: [
      { id: 'BATH', name: 'Bathrooms', x0: 0.0, x1: 4.2, finish: 'plaster-cream', color: '#ece6d6' },
      { id: 'OFF2', name: 'Office 2', x0: 4.2, x1: 10.4, finish: 'hollow-concrete-block', color: '#9c9a94' },
      { id: 'OFF1', name: 'Office 1', x0: 10.4, x1: 17.37, finish: 'plaster-white', color: '#f2f2ee' },
    ],
    note: 'Doors and windows face NORTH onto the lane (see IMG-20261109-WA0007).',
  },
  BASIC_ROOF: {
    id: 'BASIC_ROOF', name: 'Burner shed & passage (basic roof)', use: 'Wood-fired burner, passage',
    footprint: { x0: 17.37, y0: 12.35, x1: 23.87, y1: 42.19 },
    roof: { type: 'mono', downhill: 'E', highEdgeZ: 4.70 /* at x=17.37 */, lowEdgeZ: 4.70 - 6.8 * PITCH /* at x=24.17 */,
            eastEdgeX: 24.17, material: 'galvalume-dusty' },
    columns: { x: 23.75, everyY: 4.0, dia: 0.11 },
    note: 'Open-sided lean-to roof on steel pipe columns, resting against Block C/B east walls (see IMG-20261109-WA0003).',
  },
  DYEING_SHED: {
    id: 'DYEING_SHED', name: 'Dyeing point', use: 'Dyeing machines',
    footprint: { x0: 27.6, y0: -0.5, x1: 39.5, y1: 25.5 },
    plinth: 0.30,
    roof: { type: 'gable', ridgeAxis: 'NS', ridgeX: 33.55, pitch: PITCH,
            wallLineZ: 5.32, ridgeZ: 5.32 + 5.95 * PITCH, overhang: { eaves: 0.6, gables: 0.3 }, material: 'ppgi-blue' },
    eaveWallTopZ: 5.20,
    walls: { style: 'masonry+sheet', masonryTopZ: 2.4, masonry: '#d8d4ca', cladding: '#4f78a8' },
  },
};

// ---------------------------------------------------------------------------
// ROOF PLANES (roof-sheet crest surface). Generated from BUILDINGS.
// ---------------------------------------------------------------------------
function gableNS(b) {
  const f = b.footprint, r = b.roof, oh = r.overhang;
  const zEave = r.wallLineZ - oh.eaves * r.pitch;
  const y0 = f.y0 - oh.gables, y1 = f.y1 + oh.gables;
  const xW = f.x0 - oh.eaves, xE = f.x1 + oh.eaves;
  return [
    makePlane({ id: `${b.id}-W`, building: b.id, facing: 'W',
      eaveStart: [xW, y1, zEave], eaveEnd: [xW, y0, zEave], highStart: [r.ridgeX, y1, r.ridgeZ] }),
    makePlane({ id: `${b.id}-E`, building: b.id, facing: 'E',
      eaveStart: [xE, y0, zEave], eaveEnd: [xE, y1, zEave], highStart: [r.ridgeX, y0, r.ridgeZ] }),
  ];
}

export const ROOF_PLANES = (() => {
  const A = BUILDINGS.A, C = BUILDINGS.C, D = BUILDINGS.D;
  const planes = [...gableNS(A), ...gableNS(C)];
  // Block D: single slope falling to the south
  {
    const f = D.footprint, r = D.roof, oh = r.overhang;
    const zAt = (y) => r.northWallLineZ - (f.y1 - y) * r.pitch;
    const yS = f.y0 - oh.south, yN = f.y1 + oh.north;
    const xW = f.x0 - oh.verges, xE = f.x1 + oh.verges;
    planes.push(makePlane({ id: 'D-S', building: 'D', facing: 'S',
      eaveStart: [xW, yS, zAt(yS)], eaveEnd: [xE, yS, zAt(yS)], highStart: [xW, yN, zAt(yN)] }));
  }
  const byId = {};
  for (const p of planes) byId[p.id] = p;
  return byId;
})();

// ---------------------------------------------------------------------------
// ROOF OBSTACLES — turbo ventilators (positions read off satellite imagery)
//   x, y in plan; the z is computed on the roof plane. headDia/height in m.
// ---------------------------------------------------------------------------
export const TURBO_VENT = { throatDia: 0.60, headDia: 0.75, height: 0.62, baseSize: 0.95, keepOut: 0.80 };

export const ROOF_OBSTACLES = [
  // Block C (6)
  { id: 'TV-C1', type: 'turbo', plane: 'C-W', x: 3.49, y: 25.44 },
  { id: 'TV-C2', type: 'turbo', plane: 'C-W', x: 3.49, y: 21.80 },
  { id: 'TV-C3', type: 'turbo', plane: 'C-W', x: 6.64, y: 19.68 },
  { id: 'TV-C4', type: 'turbo', plane: 'C-W', x: 3.11, y: 14.60 },
  { id: 'TV-C5', type: 'turbo', plane: 'C-W', x: 6.83, y: 14.79 },
  { id: 'TV-C6', type: 'turbo', plane: 'C-E', x: 12.77, y: 15.08 },
  // Block D (4) — a row ~2.4 m below the high north edge
  { id: 'TV-D1', type: 'turbo', plane: 'D-S', x: 3.0, y: 9.65 },
  { id: 'TV-D2', type: 'turbo', plane: 'D-S', x: 7.2, y: 9.65 },
  { id: 'TV-D3', type: 'turbo', plane: 'D-S', x: 11.4, y: 9.65 },
  { id: 'TV-D4', type: 'turbo', plane: 'D-S', x: 15.6, y: 9.65 },
].map((o) => {
  const pl = ROOF_PLANES[o.plane];
  // z on the plane: solve n·(p - eaveStart) = 0 for z
  const n = pl.n, e = pl.eaveStart;
  const z = e[2] - (n[0] * (o.x - e[0]) + n[1] * (o.y - e[1])) / n[2];
  const loc = planeLocal(pl, [o.x, o.y, z]);
  return { ...o, z, u: loc.u, v: loc.v };
});

/** Roof-surface height of plane at plan (x, y). */
export function planeZAt(plane, x, y) {
  const n = plane.n, e = plane.eaveStart;
  return e[2] - (n[0] * (x - e[0]) + n[1] * (y - e[1])) / n[2];
}

// ---------------------------------------------------------------------------
// PV LAYOUT
//   Per plane: portrait modules (long side up-slope), columns along the eave.
//   rowGroups e.g. [2, 2] = two rows, walkway, two rows.
//   setbacks measured on the roof plane from the sheet edges (m).
//   exclude: list of "r{row}c{col}" slots removed to hit the string plan.
// ---------------------------------------------------------------------------
export const LAYOUT_RULES = {
  'A-W': { cols: 15, rowGroups: [2, 2], setback: { eave: 0.75, high: 0.45, sides: 0.50 }, target: 60 },
  'A-E': { cols: 15, rowGroups: [2, 2], setback: { eave: 0.75, high: 0.45, sides: 0.50 }, target: 60 },
  'C-W': { cols: 15, rowGroups: [2, 1], setback: { eave: 0.75, high: 0.45, sides: 0.50 }, target: 26 },
  'C-E': { cols: 15, rowGroups: [2, 1], setback: { eave: 0.75, high: 0.45, sides: 0.50 }, target: 40 },
  // Block D rows are anchored at the eave so they stay clear of the turbo-vent line near the high edge
  'D-S': { cols: 16, rowGroups: [2, 1], setback: { eave: 0.75, high: 0.45, sides: 0.50 }, target: 48, anchor: 'eave' },
};

// Slots dropped (beyond obstacle clashes) so each plane matches its string plan.
// Chosen to keep arrays rectangular-looking. Filled after inspection.
export const LAYOUT_EXCLUDE = {
  'A-W': [], 'A-E': [], 'D-S': [],
  'C-W': ['r2c11', 'r1c12', 'r0c12'],   // isolated slots between turbo vents
  'C-E': ['r0c0', 'r2c0'],              // south-end column beside vent TV-C6
};

function slotClashesObstacle(plane, u0, u1, v0, v1) {
  for (const o of ROOF_OBSTACLES) {
    if (o.plane !== plane.id) continue;
    const k = TURBO_VENT.keepOut;
    // circle (o.u, o.v, k) vs rectangle
    const cu = Math.max(u0, Math.min(o.u, u1));
    const cv = Math.max(v0, Math.min(o.v, v1));
    if (Math.hypot(o.u - cu, o.v - cv) < k) return o.id;
  }
  return null;
}

/**
 * Compute every candidate slot on a plane (before target trimming).
 * Returns { slots: [{row, col, key, u0,u1,v0,v1, uc, vc, blockedBy}], rowsV: [...], walkwaysV: [...] }
 */
export function computePlaneSlots(planeId) {
  const plane = ROOF_PLANES[planeId], rule = LAYOUT_RULES[planeId];
  const L = MODULE.length, W = MODULE.width, g = MOUNTING.gap, wk = MOUNTING.walkway;
  const nRows = rule.rowGroups.reduce((a, b) => a + b, 0);
  const arrayV = nRows * L + (nRows - rule.rowGroups.length) * g + (rule.rowGroups.length - 1) * wk;
  const arrayU = rule.cols * W + (rule.cols - 1) * g;
  const availV = plane.length - rule.setback.eave - rule.setback.high;
  const availU = plane.width - 2 * rule.setback.sides;
  if (arrayV > availV + 1e-6 || arrayU > availU + 1e-6) {
    throw new Error(`Layout ${planeId} does not fit: need ${arrayU.toFixed(3)}×${arrayV.toFixed(3)} have ${availU.toFixed(3)}×${availV.toFixed(3)}`);
  }
  const vStart = rule.anchor === 'eave' ? rule.setback.eave
    : rule.anchor === 'high' ? plane.length - rule.setback.high - arrayV
    : rule.setback.eave + (availV - arrayV) / 2;
  const uStart = (plane.width - arrayU) / 2;
  const rowsV = []; const walkwaysV = [];
  let v = vStart;
  rule.rowGroups.forEach((n, gi) => {
    for (let i = 0; i < n; i++) { rowsV.push([v, v + L]); v += L + (i < n - 1 ? g : 0); }
    if (gi < rule.rowGroups.length - 1) { walkwaysV.push([v, v + wk]); v += wk; }
  });
  const slots = [];
  rowsV.forEach(([v0, v1], row) => {
    for (let col = 0; col < rule.cols; col++) {
      const u0 = uStart + col * (W + g), u1 = u0 + W;
      slots.push({ row, col, key: `r${row}c${col}`, u0, u1, v0, v1, uc: (u0 + u1) / 2, vc: (v0 + v1) / 2,
        blockedBy: slotClashesObstacle(plane, u0, u1, v0, v1) });
    }
  });
  return { plane, rule, slots, rowsV, walkwaysV, arrayU, arrayV, uStart, vStart };
}

/**
 * Final module list. Each module:
 *  { id, plane, building, row, col, uc, vc,
 *    center: [x,y,z] plan (centre of module top glass), corners: 4×[x,y,z] (top glass),
 *    u, v, n: plane axes, string, inverter, azimuthDeg, tiltDeg }
 */
export function computeLayout() {
  const modules = [];
  for (const planeId of Object.keys(LAYOUT_RULES)) {
    const { plane, rule, slots } = computePlaneSlots(planeId);
    const excl = new Set(LAYOUT_EXCLUDE[planeId] || []);
    const usable = slots.filter((s) => !s.blockedBy && !excl.has(s.key));
    if (usable.length !== rule.target) {
      throw new Error(`Plane ${planeId}: ${usable.length} usable slots, target ${rule.target}`);
    }
    const top = MOUNTING.moduleUnderside + MODULE.thickness;
    for (const s of usable) {
      const corners = [
        planePoint(plane, s.u0, s.v0, top), planePoint(plane, s.u1, s.v0, top),
        planePoint(plane, s.u1, s.v1, top), planePoint(plane, s.u0, s.v1, top),
      ];
      modules.push({
        id: `${planeId}-${s.key}`, plane: planeId, building: plane.building, row: s.row, col: s.col,
        uc: s.uc, vc: s.vc, u0: s.u0, u1: s.u1, v0: s.v0, v1: s.v1,
        center: planePoint(plane, s.uc, s.vc, top), corners,
        u: plane.u, v: plane.v, n: plane.n, azimuthDeg: plane.azimuthDeg, tiltDeg: plane.tiltDeg,
        string: null, inverter: null,
      });
    }
  }
  assignStrings(modules);
  return modules;
}

// ---------------------------------------------------------------------------
// STRINGING & INVERTERS
//   13 strings, 2 × 60 kWac string inverters (DC/AC ≈ 1.21)
// ---------------------------------------------------------------------------
export const INVERTERS = [
  { id: 'INV-1', name: 'Inverter 1', acKw: 60, mppts: 6, location: [13.0, 42.85, 1.2], facing: 'N' },
  { id: 'INV-2', name: 'Inverter 2', acKw: 60, mppts: 6, location: [15.2, 42.85, 1.2], facing: 'N' },
];
export const INVERTER_STATION = { x0: 12.0, x1: 16.5, y0: 42.35, y1: 43.35, canopyZ: 2.6,
  note: 'GI frame with small sheet canopy against the north wall of Office 1, with ACDB panel.' };

export const STRING_PLAN = [
  // plane, number of strings, modules per string, inverter
  { plane: 'A-E', strings: 3, perString: 20, inverter: 'INV-1' },
  { plane: 'A-W', strings: 3, perString: 20, inverter: 'INV-1' },
  { plane: 'D-S', strings: 3, perString: 16, inverter: 'INV-2' },
  { plane: 'C-E', strings: 2, perString: 20, inverter: 'INV-2' },
  { plane: 'C-W', strings: 2, perString: 13, inverter: 'INV-2' },
];

// 13 distinct, colour-blind-friendly-ish colours for string visualisation
export const STRING_COLORS = ['#e6194b', '#ffe119', '#f58231', '#d6249f', '#ffb000', '#8c2d04', '#1f6fff', '#46e6f0', '#2fb84a', '#8a3ffc',
  '#b5f20c', '#00a091', '#2b3fb0']; // S01–S06 warm = INV-1 (Block A) · S07–S13 cool = INV-2 (Blocks D, C)

function assignStrings(modules) {
  let sIdx = 0;
  for (const sp of STRING_PLAN) {
    // serpentine order: by column, alternate row direction → physically adjacent modules share strings
    const ms = modules.filter((m) => m.plane === sp.plane)
      .sort((a, b) => (a.col - b.col) || ((a.col % 2 ? -1 : 1) * (a.row - b.row)));
    if (ms.length !== sp.strings * sp.perString) throw new Error(`String plan mismatch on ${sp.plane}: ${ms.length} modules`);
    for (let s = 0; s < sp.strings; s++) {
      const id = `S${String(sIdx + 1).padStart(2, '0')}`;
      for (let i = 0; i < sp.perString; i++) {
        const m = ms[s * sp.perString + i];
        m.string = id; m.stringIndex = sIdx; m.inverter = sp.inverter;
      }
      sIdx++;
    }
  }
}

// ---------------------------------------------------------------------------
// ENERGY — PVGIS 5.3 (PVGIS-ERA5), 1 kWp, 14 % system loss, tilt 5.71°
//   Fetched 2026-11-09 for lat 13.3127, lon 79.5703.
//   kWh per kWp, Jan..Dec and annual. Aspect: E=-90, W=90, S=0.
// ---------------------------------------------------------------------------
export const PVGIS = {
  source: 'PVGIS 5.3 (EU JRC), PVGIS-ERA5, 14% system losses, tilt 5.71°',
  E: { annual: 1415.93, monthly: [116.1, 123.4, 145.6, 143.3, 142.5, 118.8, 108.2, 112.2, 113.1, 109.5, 88.7, 94.6] },
  W: { annual: 1410.34, monthly: [116.4, 124.1, 146.2, 143.5, 140.8, 117.1, 107.2, 111.1, 112.0, 108.8, 88.5, 94.5] },
  S: { annual: 1438.60, monthly: [124.2, 129.5, 149.1, 143.2, 138.9, 115.3, 106.0, 111.0, 113.8, 112.9, 93.5, 101.2] },
};
export const GRID_EMISSION_FACTOR = 0.71; // kg CO2 per kWh (approx., Indian grid)

/** Summary numbers for UI. */
export function systemSummary(modules = computeLayout()) {
  const perPlane = {};
  for (const m of modules) perPlane[m.plane] = (perPlane[m.plane] || 0) + 1;
  const perBuilding = {};
  for (const m of modules) perBuilding[m.building] = (perBuilding[m.building] || 0) + 1;
  const kwp = (n) => n * MODULE.wp / 1000;
  let annual = 0; const monthly = new Array(12).fill(0);
  for (const [pid, n] of Object.entries(perPlane)) {
    const f = ROOF_PLANES[pid].facing; const d = PVGIS[f];
    annual += kwp(n) * d.annual;
    d.monthly.forEach((v, i) => { monthly[i] += kwp(n) * v; });
  }
  const totalKwp = kwp(modules.length);
  return {
    modules: modules.length, kwp: totalKwp, perPlane, perBuilding,
    annualKwh: annual, monthlyKwh: monthly, specificYield: annual / totalKwp,
    co2TonnesPerYear: annual * GRID_EMISSION_FACTOR / 1000,
    strings: STRING_PLAN.reduce((a, s) => a + s.strings, 0),
    dcAcRatio: totalKwp / INVERTERS.reduce((a, i) => a + i.acKw, 0),
    moduleAreaM2: modules.length * MODULE.length * MODULE.width,
  };
}

// ---------------------------------------------------------------------------
// SITE FEATURES (non-building). Plan coords.
// ---------------------------------------------------------------------------
export const FEATURES = {
  chimney: { x: 25.8, y: 10.5, height: 30.0, stackDia: 0.75,
    lattice: { baseWidth: 2.4, topWidth: 1.2, bracingEvery: 2.5 },
    bands: { colors: ['#1d2430', '#f1f1ee'], bandHeight: 3.5, topColor: '#1d2430' },
    note: 'Steel stack braced inside a square lattice tower, painted dark navy/black and white bands (IMG-20261109-WA0003, WA0010).' },
  burner: { x: 20.6, y: 15.8, heaterDia: 1.8, heaterHeight: 3.0, furnace: { w: 2.6, d: 2.6, h: 1.2 },
    flueTo: 'chimney', note: 'Wood-fired thermic-fluid heater under the basic roof; flue duct to chimney.' },
  firewood: [{ x0: 18.0, y0: 20.0, x1: 23.2, y1: 25.5, h: 1.6 }],
  etp: {
    clarifiers: [
      { id: 'ETP-1', x: 35.2, y: 37.7, dia: 6.2, wallHeight: 2.0 },
      { id: 'ETP-2', x: 29.0, y: 31.5, dia: 5.7, wallHeight: 2.0 },
      { id: 'ETP-3', x: 35.5, y: 31.2, dia: 5.7, wallHeight: 2.0 },
    ],
    platform: { x0: 25.0, y0: 35.0, x1: 31.5, y1: 41.8, deckZ: 3.0,
      vessels: [ { x: 26.8, y: 38.4, dia: 1.4, h: 2.2 }, { x: 29.4, y: 38.4, dia: 1.4, h: 2.2 } ],
      note: 'Raised steel platform with handrails carrying flash-mixer / flocculator vessels with blue gear motors on top (IMG-20261109-WA0009).' },
    filters: [ { x: 38.0, y: 27.6, dia: 1.2, h: 2.4 }, { x: 38.0, y: 29.4, dia: 1.2, h: 2.4 } ],
    dosingTanks: [ { x: 25.2, y: 27.0 }, { x: 26.4, y: 27.0 }, { x: 27.6, y: 27.0 } ],
    room: { x0: 36.6, y0: 41.0, x1: 39.5, y1: 43.4, h: 3.0 },
  },
  compoundWalls: {
    height: 2.1, thickness: 0.23, pillarEvery: 3.0, color: '#ecebe6',
    runs: [
      { id: 'S', from: [-1.8, -1.6], to: [40.0, -1.6] },
      { id: 'E', from: [40.0, -1.6], to: [40.0, 43.8] },
      { id: 'E2', from: [40.0, 49.2], to: [40.0, 50.2] },
      { id: 'W', from: [-1.8, -1.6], to: [-1.8, 43.0] },
    ],
    // Green PPGI sheet screen above the wall around the dyeing area
    greenScreen: { color: '#2f5f4f', bands: [[2.35, 3.55], [3.70, 4.95]],
      runs: [ { from: [19.0, -1.6], to: [40.0, -1.6] }, { from: [40.0, -1.6], to: [40.0, 43.8] } ] },
  },
  gate: { from: [40.0, 43.8], to: [40.0, 49.2], height: 2.4, color: '#2f6fb8', type: 'two-leaf blue PPGI sheet gate' },
  blueFenceNearA: { from: [36.8, 49.6], to: [40.6, 49.6], height: 2.4, color: '#2f6fb8' },
  lane: { note: 'Concrete/dirt lane between complex (y≈42) and Block A (y≈50) from the east gate.' },
  poles: [
    { x: 41.6, y: 50.9, h: 8.5, floodlight: true },
    { x: 44.5, y: 44.0, h: 8.5 }, { x: 44.5, y: 12.0, h: 8.5 }, { x: 44.5, y: -20.0, h: 8.5 },
    { x: 41.6, y: 75.0, h: 8.5 },
  ],
  wires: [[0, 1], [1, 2], [2, 3], [0, 4]],
  trees: {
    coconut: [
      [12.0, 58.0, 13.5], [10.0, 64.0, 15.0], [14.5, 66.5, 12.0], [8.0, 54.0, 14.0], [15.5, 71.5, 13.0],
      [5.0, 61.0, 11.5], [26.0, 76.0, 14.5], [34.0, 74.5, 12.5], [47.0, 41.0, 13.0], [49.0, 36.5, 11.0],
      [-8.0, 47.0, 12.0], [44.0, 70.0, 14.0],
    ],
    broadleaf: [
      // integrator: (55,20), (60,30), (62,45) removed — photos WA0010 / WA0011 show open field there
      [57.0, 8.0, 8.0, 5.5],
      [-18.0, 30.0, 9.0, 6.0], [-22.0, 12.0, 8.0, 5.0], [6.0, -14.0, 7.5, 5.0], [24.0, -16.0, 8.5, 5.5],
      [-6.0, 72.0, 8.0, 5.5], [52.0, 78.0, 9.0, 6.0], [-28.0, 55.0, 10.0, 7.0],
    ], // [x, y, height, crownRadius]
  },
  vehicles: [
    // integrator: sedans parked at the dirt-road edge in the east field (photo WA0010)
    { type: 'sedan', color: '#c8ccd0', x: 62.0, y: 29.4, headingDeg: 0 },
    { type: 'sedan', color: '#9aa0a6', x: 59.8, y: 32.8, headingDeg: 0 },
    { type: 'mini-truck', color: '#e8e4da', x: 47.0, y: 57.0, headingDeg: 300 },
    { type: 'water-tanker', color: '#aab0b4', x: 47.5, y: 63.5, headingDeg: 290 },
    { type: 'tractor', color: '#b3262a', x: 44.0, y: 52.5, headingDeg: 180 },
    { type: 'motorbike', color: '#222222', x: 23.0, y: -3.2, headingDeg: 90 },
    { type: 'motorbike', color: '#7a1010', x: 24.6, y: -3.2, headingDeg: 90 },
    { type: 'motorbike', color: '#202a44', x: 26.2, y: -3.2, headingDeg: 90 },
  ],
};

// Camera targets / labels (plan coords) for UI
export const LABELS = [
  { id: 'A', text: 'Block A', x: 29.7, y: 59.3, z: 9.5 },
  { id: 'B', text: 'Block B', x: 8.7, y: 34.1, z: 7.0 },
  { id: 'C', text: 'Block C', x: 8.7, y: 21.8, z: 9.0 },
  { id: 'D', text: 'Block D', x: 9.3, y: 5.9, z: 8.5 },
  { id: 'OFF', text: 'Office / Bathrooms', x: 8.7, y: 39.7, z: 5.0 },
  { id: 'BURN', text: 'Burner (wood)', x: 20.6, y: 17.0, z: 6.5 },
  { id: 'DYE', text: 'Dyeing point', x: 33.5, y: 12.5, z: 8.5 },
  { id: 'ETP', text: 'ETP', x: 32.0, y: 34.5, z: 6.5 },
  { id: 'CHIM', text: 'Chimney', x: 25.8, y: 10.5, z: 31.5 },
  { id: 'GATE', text: 'Entrance', x: 41.5, y: 46.5, z: 4.0 },
  { id: 'INV', text: 'Inverters', x: 14.2, y: 43.2, z: 3.6 },
];
