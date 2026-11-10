// ============================================================================
//  VEHICLES — generic (no logos), real-world proportions:
//   sedan (compact 4 m saloon), mini truck (0.75 t pickup), steel water-tanker
//   trailer, utility tractor, commuter motorbikes.
//  Built in local space (+X forward, +Y up, +Z right), merged per material
//  across all vehicles (≈ 7 draw calls).
//  Heading: FEATURES.vehicles[].headingDeg is read as the compass bearing the
//  vehicle's nose points to; HEADING_FIX corrects the entries that contradict
//  the photos (sedans in WA0010 face south, the mini truck in WA0011 faces SE).
// ============================================================================
import { GeoBuilder } from './util.js';
import { vehicleList, PROPS } from './layout.js';

const HEADING_FIX = { sedan: 180, 'mini-truck': 180 };

function hex(THREE, c) { const col = new THREE.Color(c); return [col.r, col.g, col.b]; }

class Kit {
  constructor(THREE) {
    this.THREE = THREE;
    this.paintKey = 'paint';
    this.gb = { paint: new GeoBuilder(), paintSolid: new GeoBuilder(), glass: new GeoBuilder(), rubber: new GeoBuilder(), steel: new GeoBuilder(),
      dark: new GeoBuilder(), lights: new GeoBuilder(), chrome: new GeoBuilder() };
    this.M = new THREE.Matrix4(); this.N = new THREE.Matrix3();
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3();
  }
  begin(x, y, headingDeg, roll = 0) {
    const T = this.THREE;
    const phi = (90 - headingDeg) * Math.PI / 180;
    this.M.compose(new T.Vector3(x, 0, -y), new T.Quaternion().setFromEuler(new T.Euler(roll, phi, 0, 'YXZ')), new T.Vector3(1, 1, 1));
    this.N.getNormalMatrix(this.M);
  }
  add(geo, mat, color = [1, 1, 1], local = null) {
    const T = this.THREE;
    const L = local || new T.Matrix4();
    const W = new T.Matrix4().multiplyMatrices(this.M, L);
    const NW = new T.Matrix3().getNormalMatrix(W);
    const v = this._v, n = this._n;
    this.gb[mat === 'paint' ? this.paintKey : mat].addGeometry(geo, (p, nn) => {
      v.set(p[0], p[1], p[2]).applyMatrix4(W); n.set(nn[0], nn[1], nn[2]).applyMatrix3(NW).normalize();
      return [[v.x, v.y, v.z], [n.x, n.y, n.z]];
    }, color);
    geo.dispose();
  }
  box(mat, color, cx, cy, cz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const T = this.THREE;
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(1, 1, 1));
    this.add(new T.BoxGeometry(sx, sy, sz), mat, color, L);
  }
  cyl(mat, color, cx, cy, cz, r0, r1, h, axis = 'z', seg = 16, open = false) {
    const T = this.THREE;
    const q = new T.Quaternion();
    if (axis === 'z') q.setFromEuler(new T.Euler(Math.PI / 2, 0, 0)); else if (axis === 'x') q.setFromEuler(new T.Euler(0, 0, Math.PI / 2));
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), q, new T.Vector3(1, 1, 1));
    this.add(new T.CylinderGeometry(r1, r0, h, seg, 1, open), mat, color, L);
  }
  /** wheel with tyre (torus-ish profile via lathe), rim and hub; axle along Z */
  wheel(cx, cy, cz, r, w, rimColor = [0.52, 0.53, 0.55], seg = 22, solidRim = true) {
    const T = this.THREE;
    const pts = [];
    const ri = r * 0.64;
    for (let k = 0; k <= 8; k++) {
      const a = -Math.PI / 2 + (k / 8) * Math.PI;
      pts.push(new T.Vector2(r - w * 0.18 + Math.cos(a) * w * 0.18, Math.sin(a) * w * 0.5));
    }
    const prof = [new T.Vector2(ri, -w * 0.45), ...pts, new T.Vector2(ri, w * 0.45)];
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), new T.Quaternion().setFromEuler(new T.Euler(Math.PI / 2, 0, 0)), new T.Vector3(1, 1, 1));
    // lathe around Y then rotate Y→Z
    const tyre = new T.LatheGeometry(prof.map((p) => new T.Vector2(p.x, p.y)), seg);
    this.add(tyre, 'rubber', [1, 1, 1], L);
    const side = Math.sign(cz) || 1;
    if (solidRim) this.cyl('steel', rimColor, cx, cy, cz + side * w * 0.12, ri * 1.02, ri * 1.02, w * 0.7, 'z', 16);
    else return;
    this.cyl('dark', [0.25, 0.25, 0.26], cx, cy, cz + side * w * 0.36, ri * 0.35, ri * 0.35, 0.02, 'z', 10);
  }
  /** extruded side profile (shape in XY), width along Z, optional top taper (tumblehome) */
  profile(mat, color, pts, width, { bevel = 0.05, taperY0 = null, taperY1 = null, taper = 1, zc = 0, curve = 6 } = {}) {
    const T = this.THREE;
    const sh = new T.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
    const depth = Math.max(0.01, width - 2 * bevel);
    const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelSize: bevel * 0.8, bevelThickness: bevel, bevelSegments: 3, curveSegments: curve });
    g.translate(0, 0, -depth / 2 + zc);
    if (taperY0 !== null) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i); const t = Math.max(0, Math.min(1, (y - taperY0) / (taperY1 - taperY0)));
        p.setZ(i, zc + (p.getZ(i) - zc) * (1 - (1 - taper) * t));
      }
      g.computeVertexNormals();
    }
    this.add(g, mat, color);
  }
  /** tube between two local points */
  rod(mat, color, a, b, r, seg = 8) {
    const T = this.THREE;
    const A = new T.Vector3(...a), B = new T.Vector3(...b);
    const d = B.clone().sub(A); const len = d.length();
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    const L = new T.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new T.Vector3(1, 1, 1));
    this.add(new T.CylinderGeometry(r, r, len, seg, 1, true), mat, color, L);
  }
  /** torus arc in the XY plane (axle along Z), angles from +X counter-clockwise */
  arc(mat, color, cx, cy, cz, R, r, a0, a1, seg = 16, rseg = 6, sz = 1) {
    const T = this.THREE;
    const g = new T.TorusGeometry(R, r, rseg, seg, a1 - a0);
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), new T.Quaternion().setFromEuler(new T.Euler(0, 0, a0)), new T.Vector3(1, 1, sz));
    this.add(g, mat, color, L);
  }
  /** fender / mudguard shell: partial open cylinder about Z, angles from +X counter-clockwise */
  shell(mat, color, cx, cy, cz, R, w, a0, a1, seg = 18) {
    const T = this.THREE;
    // CylinderGeometry theta: x = sinθ, z = cosθ; after rotating X by -90°: (sinθ, cosθ) in XY → angle = 90° - θ
    const g = new T.CylinderGeometry(R, R, w, seg, 1, true, Math.PI / 2 - a1, a1 - a0);
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)), new T.Vector3(1, 1, 1));
    this.add(g, mat, color, L);
  }
  /** ellipsoid */
  blob(mat, color, cx, cy, cz, sx, sy, sz, rz = 0, ws = 14, hs = 10) {
    const T = this.THREE;
    const L = new T.Matrix4().compose(new T.Vector3(cx, cy, cz), new T.Quaternion().setFromEuler(new T.Euler(0, 0, rz)), new T.Vector3(sx, sy, sz));
    this.add(new T.SphereGeometry(1, ws, hs), mat, color, L);
  }
  arcShape(cx, cy, r, a0, a1, n = 8) { const o = []; for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; }
}

// ---------------------------------------------------------------------------
// colour helpers: lower-body road dust + rust mottling (vertex colours, world-space p)
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash3 = (x, y, z) => { const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return h - Math.floor(h); };
function dusty(col, { dust = [0.42, 0.33, 0.24], top = 0.75, amt = 0.55, rust = 0 } = {}) {
  return (p) => {
    const d = (1 - sstep(0.12, top, p[1])) * amt;
    let c = col.map((v, i) => v * (1 - d) + dust[i] * d);
    if (rust) {
      const n = hash3(Math.floor(p[0] * 6), Math.floor(p[1] * 6), Math.floor(p[2] * 6));
      if (n < rust) { const t = 0.35 + (n / rust) * 0.4; c = c.map((v, i) => v * (1 - t) + [0.33, 0.16, 0.07][i] * t); }
    }
    return c;
  };
}

/** alloy / steel rim face details: dark spoke gaps on the outer face (axle along Z) */
function rimSpokes(k, cx, cy, cz, r, n = 5, color = [1, 1, 1]) {
  const side = Math.sign(cz) || 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    k.box('dark', color, cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, cz, r * 0.42, r * 0.22, 0.012, 0, 0, a);
  }
  k.cyl('chrome', [0.8, 0.8, 0.82], cx, cy, cz + side * 0.004, r * 0.2, r * 0.2, 0.02, 'z', 12);
}

/** agricultural lug tread: chevron bars around the tyre */
function lugs(k, cx, cy, cz, r, w, n) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const s of [-1, 1]) {
      k.box('rubber', [1, 1, 1], cx + Math.cos(a) * (r - 0.015), cy + Math.sin(a) * (r - 0.015), cz + s * w * 0.22,
        0.06, 0.07, w * 0.46, s * 0.5, 0, a + Math.PI / 2);
    }
  }
}

function sedan(k, paint) {
  const W = 1.735;
  const rw = 0.305, rx = 0.78, fx = 3.23; // 185/65 R15, wheelbase 2.45 m
  const arcR = 0.38;
  const T = k.THREE;
  const smooth = (pts, n) => new T.SplineCurve(pts.map(([x, y]) => new T.Vector2(x, y))).getPoints(n).map((p) => [p.x, p.y]);
  const body = [
    ...smooth([[0.05, 0.34], [0.0, 0.5], [0.0, 0.78], [0.06, 0.96], [0.18, 1.02], [0.75, 1.04], [1.4, 1.02], [2.4, 1.0], [2.95, 0.99],
      [3.45, 0.9], [3.82, 0.8], [3.96, 0.68], [3.99, 0.5], [3.93, 0.34]], 44),
    ...k.arcShape(fx, 0.31, arcR, 0, Math.PI, 10),
    ...k.arcShape(rx, 0.31, arcR, 0, Math.PI, 10),
  ];
  const col = dusty(paint, { top: 0.62, amt: 0.45 });
  k.profile('paint', col, body, W, { bevel: 0.08, taperY0: 0.72, taperY1: 1.04, taper: 0.93, curve: 4 });
  // notchback greenhouse: steep rear glass onto a distinct boot deck, raked windscreen
  const gh = [...smooth([[0.82, 1.01], [1.08, 1.28], [1.42, 1.46], [1.9, 1.5], [2.3, 1.47], [2.62, 1.26], [2.95, 1.0]], 26)];
  k.profile('glass', [1, 1, 1], gh, W - 0.18, { bevel: 0.03, taperY0: 1.0, taperY1: 1.48, taper: 0.8 });
  k.profile('paint', col, [[1.38, 1.44], [2.32, 1.445], [2.34, 1.5], [1.42, 1.505]], (W - 0.18) * 0.8 + 0.05, { bevel: 0.02 });
  for (const s of [-1, 1]) {
    // A/B/C pillars, mirrors, handles, rubbing strip, sill
    k.box('paint', col, 1.92, 1.24, s * (W / 2 - 0.15), 0.1, 0.46, 0.04, s * 0.18, 0, 0);
    k.box('dark', [1, 1, 1], 2.86, 1.04, s * (W / 2 + 0.02), 0.16, 0.09, 0.1);
    k.box('chrome', [1, 1, 1], 1.6, 0.9, s * (W / 2 + 0.004), 0.12, 0.025, 0.02);
    k.box('chrome', [1, 1, 1], 2.5, 0.9, s * (W / 2 + 0.004), 0.12, 0.025, 0.02);
    k.box('dark', [1, 1, 1], 2.0, 0.6, s * (W / 2 + 0.003), 2.0, 0.035, 0.012);
    k.box('dark', [1, 1, 1], 2.0, 0.38, s * (W / 2 - 0.03), 1.75, 0.07, 0.05);
    k.box('chrome', [1, 1, 1], 2.0, 1.005, s * (W / 2 - 0.1), 2.0, 0.012, 0.012);           // window-line chrome
    k.box('lights', [1.0, 0.98, 0.92], 3.9, 0.76, s * 0.6, 0.12, 0.1, 0.36, 0, 0.3 * s, 0);
    k.box('lights', [0.7, 0.05, 0.04], 0.05, 0.88, s * 0.64, 0.1, 0.14, 0.32, 0, -0.25 * s, 0);
  }
  k.box('dark', [1, 1, 1], 3.97, 0.6, 0, 0.06, 0.14, 0.86);         // grille
  k.box('chrome', [1, 1, 1], 3.985, 0.66, 0, 0.02, 0.02, 0.8);
  k.box('dark', [1, 1, 1], 3.95, 0.4, 0, 0.08, 0.1, 1.42);          // lower bumper intake
  k.box('dark', [1, 1, 1], 0.03, 0.42, 0, 0.08, 0.08, 1.45);
  k.box('lights', [0.92, 0.92, 0.88], 4.0, 0.5, 0, 0.012, 0.11, 0.48);
  k.box('lights', [0.92, 0.92, 0.88], -0.0, 0.7, 0, 0.012, 0.11, 0.48);
  for (const x of [rx, fx]) for (const s of [-1, 1]) {
    const z = s * (W / 2 - 0.13);
    k.wheel(x, rw, z, rw, 0.185, [0.74, 0.75, 0.77]);
    rimSpokes(k, x, rw, z + s * 0.095, rw * 0.62, 5, [0.4, 0.4, 0.42]);
  }
  k.box('dark', [1, 1, 1], 2.0, 0.3, 0, 3.4, 0.16, W - 0.3);
}

/** weathered cab paint: grime collecting under edges, vertical rust runs from seams, faded patches */
function weathered(col) {
  return (p) => {
    const colStreak = hash3(Math.floor(p[0] * 14 + p[2] * 9), 1.7, Math.floor(p[2] * 14 - p[0] * 5));
    const run = colStreak < 0.18 ? (0.25 + colStreak * 2.5) * sstep(1.9, 0.6, p[1]) : 0;
    const blot = hash3(Math.floor(p[0] * 4), Math.floor(p[1] * 4), Math.floor(p[2] * 4));
    const dust = (1 - sstep(0.2, 1.1, p[1])) * 0.55;
    let c = col.map((v) => v * (0.9 + blot * 0.14));
    c = c.map((v, i) => v * (1 - dust) + [0.42, 0.33, 0.24][i] * dust);
    c = c.map((v, i) => v * (1 - run) + [0.36, 0.18, 0.08][i] * run);
    if (blot < 0.12) c = c.map((v, i) => v * 0.55 + [0.4, 0.2, 0.09][i] * 0.45);
    return c;
  };
}

function miniTruck(k) {
  // Tata-Ace-like 0.75 t pickup: short sloped nose, cream cab with rust, open wooden drop-side bed
  const W = 1.5, c0 = 2.62, c1 = 3.8;
  const cream = weathered([0.6, 0.56, 0.44]);
  const wood = (p) => { const n = hash3(Math.floor(p[1] * 9), 0.3, Math.floor(p[0] * 2)); const v = 0.8 + n * 0.35; return [0.3 * v, 0.17 * v, 0.09 * v]; };
  k.box('dark', [1, 1, 1], 1.9, 0.46, 0, 3.5, 0.14, 0.8);           // chassis
  k.profile('paint', cream, [[c0, 0.48], [c1 - 0.06, 0.48], [c1, 0.6], [c1, 0.95], [c1 - 0.12, 1.1], [c1 - 0.3, 1.13],
    [c1 - 0.62, 1.74], [c1 - 0.8, 1.82], [c0, 1.82]], W, { bevel: 0.07 });
  const a = 0.48, cxw = c1 - 0.46, cyw = 1.435;                       // windscreen along the sloped face
  k.box('glass', [1, 1, 1], cxw + Math.cos(a) * 0.085, cyw + Math.sin(a) * 0.085, 0, 0.02, 0.6, W - 0.22, 0, 0, a);
  for (const s of [-1, 1]) {
    k.box('glass', [1, 1, 1], c0 + 0.5, 1.45, s * (W / 2 + 0.006), 0.58, 0.44, 0.01);
    k.box('dark', [1, 1, 1], c1 - 0.6, 1.5, s * (W / 2 + 0.16), 0.04, 0.18, 0.1);      // mirrors on stalks
    k.box('dark', [1, 1, 1], c1 - 0.62, 1.42, s * (W / 2 + 0.08), 0.02, 0.02, 0.16);
    k.box('lights', [1, 0.98, 0.9], c1 + 0.005, 0.86, s * 0.56, 0.03, 0.16, 0.22);   // headlamps in the nose
    k.box('lights', [1, 0.55, 0.1], c1 + 0.005, 0.72, s * 0.62, 0.03, 0.06, 0.08);
    k.box('lights', [0.7, 0.05, 0.05], 0.02, 0.8, s * 0.64, 0.04, 0.1, 0.12);
  }
  k.box('dark', [1, 1, 1], c1 + 0.02, 0.72, 0, 0.02, 0.12, 0.62);  // grille slot
  k.box('dark', [1, 1, 1], c1 + 0.05, 0.53, 0, 0.12, 0.17, W + 0.02); // black bumper
  k.box('lights', [0.95, 0.93, 0.85], c1 + 0.12, 0.53, 0, 0.01, 0.1, 0.38);
  // bed floor, headboard, drop sides with plank grooves + steel hinges, tail gate
  k.box('paint', wood, 1.25, 0.7, 0, 2.5, 0.07, W + 0.04);
  k.box('paint', wood, 2.52, 1.0, 0, 0.06, 0.6, W + 0.04);
  for (const s of [-1, 1]) {
    k.box('paint', wood, 1.25, 0.92, s * (W / 2 + 0.01), 2.5, 0.38, 0.05);
    for (const y of [0.82, 0.94, 1.05]) k.box('dark', [0.6, 0.6, 0.6], 1.25, y, s * (W / 2 + 0.037), 2.48, 0.012, 0.006);
    for (const x of [0.3, 1.25, 2.2]) k.box('steel', [0.35, 0.33, 0.3], x, 0.92, s * (W / 2 + 0.04), 0.05, 0.4, 0.012);
  }
  k.box('paint', wood, 0.02, 0.92, 0, 0.05, 0.38, W + 0.04);
  for (const z of [-0.55, 0, 0.55]) k.box('steel', [0.3, 0.28, 0.26], 2.52, 1.48, z, 0.04, 0.36, 0.04);
  k.box('steel', [0.3, 0.28, 0.26], 2.52, 1.66, 0, 0.05, 0.05, W);
  for (const [x, s] of [[0.62, -1], [0.62, 1], [3.22, -1], [3.22, 1]]) {
    const z = s * (W / 2 - 0.12);
    k.wheel(x, 0.27, z, 0.27, 0.16, [0.55, 0.55, 0.56]);
    rimSpokes(k, x, 0.27, z + s * 0.08, 0.27 * 0.6, 4, [0.5, 0.5, 0.5]);
    k.box('dark', [1, 1, 1], x, 0.6, z, 0.66, 0.03, 0.2);            // mudguard
  }
}

function tractor(k) {
  // Indian utility tractor (generic, no logos): muted red-orange tin-work, black lugged tyres
  // (front ≈ 55 % of rear diameter), grey pressed rims, rounded bonnet with mesh grille,
  // curved rear fenders, pan seat, steering wheel on a raked column, vertical silencer.
  const T = k.THREE;
  const red = dusty([0.46, 0.07, 0.035], { top: 1.0, amt: 0.4, rust: 0.05 });
  const D = [1, 1, 1];
  const Rr = 0.68, Rf = 0.37, xf = 1.95, trR = 0.8, trF = 0.66;
  const rimRear = [0.4, 0.27, 0.12], rimFront = [0.4, 0.27, 0.12];   // painted rims (dusty orange)
  for (const s of [-1, 1]) {
    // ---- rear wheel: tyre + chevron lugs + dished rim with centre hub
    k.wheel(0, Rr, s * trR, Rr, 0.38, rimRear, 28);
    lugs(k, 0, Rr, s * trR, Rr + 0.005, 0.38, 24);
    rimSpokes(k, 0, Rr, s * (trR + 0.13), Rr * 0.6, 8, [0.35, 0.33, 0.3]);
    k.cyl('steel', [0.4, 0.4, 0.4], 0, Rr, s * (trR + 0.17), 0.09, 0.11, 0.1, 'z', 10);
    // ---- front wheel
    k.wheel(xf, Rf, s * trF, Rf, 0.17, rimFront, 22);
    lugs(k, xf, Rf, s * trF, Rf + 0.004, 0.17, 18);
    k.cyl('steel', [0.4, 0.4, 0.4], xf, Rf, s * (trF + 0.09), 0.06, 0.08, 0.08, 'z', 10);
    // ---- curved rear fender over the top-front/top-rear of the tyre, with flat platform + side lip
    k.shell('paintSolid', red, 0, Rr, s * trR, Rr + 0.09, 0.46, Math.PI * 0.2, Math.PI * 0.98, 20);
    k.arc('paintSolid', red, 0, Rr, s * (trR + 0.23), Rr + 0.09, 0.018, Math.PI * 0.2, Math.PI * 0.98, 18, 5);
    k.box('paintSolid', red, -0.12, Rr + 0.78, s * (trR - 0.32), 0.9, 0.035, 0.2);          // fender deck
    k.box('dark', D, -0.05, 0.62, s * 0.46, 0.75, 0.03, 0.34);                               // footplate
    // ---- front tyre has no fender (typical), front axle beam + kingpin
    k.rod('dark', D, [xf, Rf + 0.06, s * (trF - 0.1)], [xf, Rf + 0.18, 0], 0.045, 8);
    k.cyl('dark', D, xf, Rf, s * (trF - 0.13), 0.05, 0.05, 0.12, 'z', 8);
    // headlamps on the bonnet sides, round with chrome bezel
    k.cyl('chrome', [0.75, 0.75, 0.77], 2.38, 1.22, s * 0.33, 0.085, 0.085, 0.08, 'x', 14);
    k.cyl('lights', [1, 0.98, 0.9], 2.42, 1.22, s * 0.33, 0.07, 0.07, 0.02, 'x', 14);
    // bonnet side louvres
    for (let i = 0; i < 6; i++) k.box('dark', D, 1.5 + i * 0.11, 1.13, s * 0.37, 0.035, 0.18, 0.012);
    // brake/clutch pedals, step, rear lamp
    k.box('dark', D, 0.55, 0.78, s * 0.3, 0.04, 0.2, 0.08, 0, 0, 0.5);
    k.box('lights', [0.7, 0.05, 0.04], -0.5, 1.4, s * (trR - 0.32), 0.03, 0.07, 0.1);
  }
  // ---- drivetrain: transmission housing (rounded), engine block, sump
  k.blob('dark', D, 0.45, 0.78, 0, 0.62, 0.32, 0.36, 0, 16, 10);
  k.cyl('dark', D, 0, Rr, 0, 0.16, 0.16, 1.25, 'z', 14);                // rear axle housing
  k.box('dark', D, 1.45, 0.72, 0, 1.25, 0.36, 0.46);
  k.box('steel', [0.3, 0.3, 0.3], 1.45, 0.88, 0, 1.2, 0.16, 0.5);
  // ---- bonnet: side profile with rounded nose, tapered top (tumblehome) and big bevel
  const smooth = (pts, n) => new T.SplineCurve(pts.map(([x, y]) => new T.Vector2(x, y))).getPoints(n).map((p) => [p.x, p.y]);
  const bon = [[0.98, 0.94], [2.45, 0.94], ...smooth([[2.52, 0.98], [2.6, 1.12], [2.6, 1.3], [2.52, 1.42], [2.35, 1.47], [1.6, 1.49], [1.0, 1.5]], 20), [0.98, 1.48]];
  k.profile('paintSolid', red, bon, 0.74, { bevel: 0.09, taperY0: 1.15, taperY1: 1.52, taper: 0.78, curve: 6 });
  // grille: recessed dark mesh on the nose, framed
  k.box('dark', D, 2.62, 1.15, 0, 0.04, 0.34, 0.46);
  for (let i = 0; i < 7; i++) k.box('steel', [0.35, 0.35, 0.36], 2.645, 1.0 + i * 0.05, 0, 0.012, 0.012, 0.44);
  for (let i = -3; i <= 3; i++) k.box('steel', [0.35, 0.35, 0.36], 2.645, 1.15, i * 0.065, 0.012, 0.32, 0.01);
  // front weight frame + bumper bar
  k.box('steel', [0.32, 0.32, 0.33], 2.72, 0.66, 0, 0.16, 0.24, 0.62);
  for (let i = -2; i <= 2; i++) k.box('dark', D, 2.82, 0.66, i * 0.11, 0.06, 0.22, 0.09);
  // fuel tank (rounded) between bonnet and dash, dash + steering column + wheel
  k.blob('paintSolid', red, 0.88, 1.36, 0, 0.22, 0.17, 0.3, 0, 14, 8);
  k.box('dark', D, 0.72, 1.24, 0, 0.12, 0.34, 0.5);
  k.rod('dark', D, [0.78, 1.3, 0], [0.5, 1.82, 0], 0.025, 8);
  // steering wheel: torus tilted towards the driver
  {
    const g = new T.TorusGeometry(0.19, 0.017, 6, 22);
    const L = new T.Matrix4().compose(new T.Vector3(0.5, 1.83, 0), new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0.45, 'ZYX')), new T.Vector3(1, 1, 1));
    k.add(g, 'dark', D, L);
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3 + Math.PI / 2;
      const Ls = L.clone().multiply(new T.Matrix4().compose(new T.Vector3(Math.cos(a) * 0.095, Math.sin(a) * 0.095, 0), new T.Quaternion().setFromEuler(new T.Euler(0, 0, a - Math.PI / 2)), new T.Vector3(1, 1, 1)));
      k.add(new T.CylinderGeometry(0.01, 0.01, 0.19, 5), 'dark', D, Ls);
    }
  }
  // pan seat on a spring post, seat back
  k.rod('dark', D, [-0.2, 1.0, 0], [-0.2, 1.3, 0], 0.035, 8);
  k.blob('dark', [0.6, 0.6, 0.6], -0.2, 1.36, 0, 0.24, 0.07, 0.24, 0, 14, 8);
  k.blob('dark', [0.6, 0.6, 0.6], -0.42, 1.55, 0, 0.06, 0.2, 0.22, 0.25, 12, 8);
  // vertical silencer with heat guard + rain cap, air cleaner bowl
  k.cyl('dark', D, 2.05, 1.95, 0.26, 0.05, 0.05, 0.95, 'y', 10);
  k.cyl('chrome', [0.42, 0.4, 0.38], 2.05, 1.72, 0.26, 0.068, 0.068, 0.42, 'y', 12);
  k.box('dark', D, 2.09, 2.43, 0.26, 0.12, 0.012, 0.1, 0, 0, 0.5);
  k.cyl('dark', D, 2.0, 1.66, -0.24, 0.085, 0.075, 0.36, 'y', 12);
  k.blob('dark', D, 2.0, 1.86, -0.24, 0.09, 0.05, 0.09, 0, 10, 6);
  // drawbar / hitch, top link, lift arms
  k.box('steel', [0.38, 0.38, 0.38], -0.62, 0.55, 0, 0.3, 0.06, 0.14);
  k.rod('steel', [0.38, 0.38, 0.38], [-0.35, 0.95, 0], [-0.75, 0.9, 0], 0.03, 6);
  for (const s of [-1, 1]) k.rod('steel', [0.38, 0.38, 0.38], [-0.3, 0.55, s * 0.3], [-0.8, 0.42, s * 0.36], 0.025, 6);
}

function drum(k, lying) {
  const T = k.THREE; const blue = dusty([0.03, 0.14, 0.42], { top: 0.4, amt: 0.35 });
  const L = new T.Matrix4();
  if (lying) L.compose(new T.Vector3(0, 0.29, 0), new T.Quaternion().setFromEuler(new T.Euler(Math.PI / 2, 0, 0)), new T.Vector3(1, 1, 1));
  else L.makeTranslation(0, 0.46, 0);
  const g = new T.CylinderGeometry(0.29, 0.29, 0.92, 18, 1);
  k.add(g, 'paintSolid', blue, L);
  for (const y of [-0.15, 0.15]) {
    const r = new T.CylinderGeometry(0.3, 0.3, 0.04, 18, 1, true);
    const Lr = L.clone().multiply(new T.Matrix4().makeTranslation(0, y, 0));
    k.add(r, 'paintSolid', blue, Lr);
  }
}

function tyreStack(k, n) {
  const T = k.THREE;
  for (let i = 0; i < n; i++) {
    const g = new T.TorusGeometry(0.29, 0.1, 8, 18);
    const L = new T.Matrix4().compose(new T.Vector3((i % 2) * 0.03, 0.1 + i * 0.2, ((i * 7) % 3) * 0.02), new T.Quaternion().setFromEuler(new T.Euler(Math.PI / 2, 0, 0)), new T.Vector3(1, 1, 1.0));
    k.add(g, 'rubber', [1, 1, 1], L);
  }
}

function waterTanker(k, steelTint) {
  const L = 3.1, R = 0.62, cy = 1.32;
  k.cyl('steel', steelTint, 0, cy, 0, R, R, L, 'x', 28);
  // dished ends
  const T = k.THREE;
  for (const s of [-1, 1]) {
    const g = new T.SphereGeometry(R, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const Lm = new T.Matrix4().compose(new T.Vector3(s * L / 2, cy, 0), new T.Quaternion().setFromEuler(new T.Euler(0, 0, -s * Math.PI / 2)), new T.Vector3(1, 0.28, 1));
    k.add(g, 'steel', steelTint, Lm);
  }
  // bands, manhole, valve
  for (const x of [-1.1, 0, 1.1]) k.cyl('steel', steelTint.map((v) => v * 0.8), x, cy, 0, R + 0.012, R + 0.012, 0.06, 'x', 28);
  k.cyl('steel', steelTint, 0.2, cy + R + 0.06, 0, 0.24, 0.24, 0.14, 'y', 18);
  k.cyl('dark', [1, 1, 1], -L / 2 - 0.25, cy - 0.35, 0, 0.05, 0.05, 0.3, 'x', 8);
  // chassis, saddles, axle, mudguards
  for (const s of [-1, 1]) k.box('dark', [1, 1, 1], 0, 0.66, s * 0.42, L + 0.3, 0.12, 0.08);
  for (const x of [-1.0, 1.0]) k.box('dark', [1, 1, 1], x, 0.78, 0, 0.14, 0.18, 1.0);
  k.cyl('dark', [1, 1, 1], -0.2, 0.46, 0, 0.05, 0.05, 1.7, 'z', 8);
  for (const s of [-1, 1]) {
    k.wheel(-0.2, 0.46, s * 0.78, 0.46, 0.24, [0.6, 0.6, 0.62]);
    k.box('dark', [1, 1, 1], -0.2, 0.98, s * 0.78, 1.1, 0.03, 0.32);
  }
  // A-frame drawbar to hitch eye
  const hitch = [L / 2 + 1.5, 0.55];
  for (const s of [-1, 1]) {
    const dx = hitch[0] - L / 2 + 0.3, dz = 0.42;
    const len = Math.hypot(dx, dz); const ang = Math.atan2(dz, dx);
    k.box('dark', [1, 1, 1], L / 2 - 0.3 + dx / 2, 0.6, s * dz / 2, len, 0.08, 0.07, 0, s * ang, 0);
  }
  k.cyl('dark', [1, 1, 1], hitch[0], hitch[1], 0, 0.07, 0.07, 0.04, 'y', 10);
  k.cyl('dark', [1, 1, 1], hitch[0] - 0.35, 0.28, 0, 0.03, 0.03, 0.56, 'y', 6); // jack stand
}

/** spoked wire wheel for motorbikes (axle along Z): tyre, chrome rim band, drum hub, crossed spokes */
function spokeWheel(k, cx, cy, R, w) {
  k.wheel(cx, cy, 0, R, w, [0.62, 0.63, 0.65], 22, false);
  const T = k.THREE;
  const ri = R * 0.64;
  k.cyl('chrome', [0.85, 0.85, 0.87], cx, cy, 0, ri * 0.98, ri * 0.98, w * 0.5, 'z', 22, true);
  k.cyl('steel', [0.55, 0.55, 0.56], cx, cy, 0, 0.065, 0.065, w * 0.9, 'z', 14);      // drum-brake hub
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, s = i % 2 ? 1 : -1;
    const b = a + 0.35 * s;
    k.rod('chrome', [0.8, 0.8, 0.82], [cx + Math.cos(b) * 0.05, cy + Math.sin(b) * 0.05, s * 0.035], [cx + Math.cos(a) * ri * 0.96, cy + Math.sin(a) * ri * 0.96, 0], 0.005, 3);
  }
  void T;
}

function motorbike(k, paint) {
  // 100–125 cc commuter motorcycle (generic): spoked wheels, teardrop tank with knee recesses,
  // rounded side covers, long flat seat, round headlamp with visor, telescopic fork,
  // chrome silencer with heat shield, front/rear fenders, grab rail, side stand.
  const T = k.THREE;
  const R = 0.3, xf = 1.27, D = [1, 1, 1];
  const smooth = (pts, n) => new T.SplineCurve(pts.map(([x, y]) => new T.Vector2(x, y))).getPoints(n).map((p) => [p.x, p.y]);
  const col = dusty(paint, { top: 0.5, amt: 0.3 });
  spokeWheel(k, 0, R, R, 0.1);
  spokeWheel(k, xf, R, R, 0.085);
  // ---- fenders (painted on rear, chrome-ish front)
  k.shell('paintSolid', col, 0, R, 0, R + 0.05, 0.13, Math.PI * 0.35, Math.PI * 1.05, 14);
  k.shell('paintSolid', col, xf, R, 0, R + 0.045, 0.11, -Math.PI * 0.02 + Math.PI * 0.2, Math.PI * 0.8, 14);
  // ---- frame: down tube, backbone, swing arm, rear shocks
  k.rod('dark', D, [1.08, 0.98, 0], [0.82, 0.42, 0], 0.024, 8);
  k.rod('dark', D, [1.08, 0.98, 0], [0.42, 0.82, 0], 0.022, 8);
  k.rod('dark', D, [0.42, 0.82, 0], [-0.12, 0.72, 0], 0.02, 6);
  for (const s of [-1, 1]) {
    k.rod('dark', D, [0.5, 0.42, s * 0.07], [0, R, s * 0.07], 0.02, 6);
    k.rod('chrome', [0.85, 0.85, 0.87], [0.02, R + 0.04, s * 0.09], [0.08, 0.76, s * 0.11], 0.016, 8);
    k.rod('dark', D, [0.045, R + 0.18, s * 0.09], [0.07, 0.66, s * 0.11], 0.026, 8);     // spring
    // front telescopic fork: chrome stanchion + painted lower leg
    k.rod('chrome', [0.9, 0.9, 0.92], [xf - 0.02, R + 0.18, s * 0.075], [1.1, 1.02, s * 0.075], 0.017, 8);
    k.rod('steel', [0.55, 0.55, 0.56], [xf, R, s * 0.075], [xf - 0.07, R + 0.3, s * 0.075], 0.024, 8);
    // footrests
    k.rod('dark', D, [0.5, 0.33, s * 0.1], [0.5, 0.33, s * 0.24], 0.012, 6);
  }
  // ---- engine: crankcase with round side covers, finned cylinder angled forward, carb
  k.blob('steel', [0.55, 0.55, 0.57], 0.56, 0.4, 0, 0.2, 0.13, 0.12, 0, 14, 10);
  k.cyl('steel', [0.68, 0.68, 0.7], 0.53, 0.38, 0.12, 0.1, 0.1, 0.03, 'z', 16);
  k.cyl('steel', [0.68, 0.68, 0.7], 0.6, 0.42, -0.12, 0.085, 0.085, 0.03, 'z', 16);
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    k.box('dark', [0.5, 0.5, 0.5], 0.73 + t * 0.09, 0.48 + t * 0.15, 0, 0.12, 0.012, 0.15, 0, 0, -0.55);
  }
  k.cyl('dark', D, 0.5, 0.58, 0.05, 0.035, 0.035, 0.08, 'z', 8);
  // ---- exhaust: header pipe + chrome silencer + black heat shield
  k.rod('chrome', [0.8, 0.8, 0.82], [0.86, 0.5, 0.06], [0.82, 0.28, 0.12], 0.018, 8);
  k.rod('chrome', [0.8, 0.8, 0.82], [0.82, 0.28, 0.12], [0.45, 0.27, 0.15], 0.018, 8);
  k.rod('chrome', [0.88, 0.88, 0.9], [0.45, 0.27, 0.15], [-0.25, 0.36, 0.16], 0.045, 12);
  k.cyl('dark', D, -0.26, 0.36, 0.16, 0.035, 0.035, 0.02, 'x', 10);
  k.rod('dark', D, [0.3, 0.3, 0.2], [0.0, 0.33, 0.2], 0.03, 8);
  // ---- fuel tank: side profile extruded with tumblehome + big bevel = teardrop with knee recess
  const tank = smooth([[0.62, 0.84], [0.7, 0.98], [0.86, 1.04], [1.02, 1.01], [1.09, 0.93], [1.04, 0.84], [0.85, 0.81], [0.62, 0.84]], 24);
  k.profile('paintSolid', col, tank, 0.26, { bevel: 0.06, taperY0: 0.88, taperY1: 1.06, taper: 0.62, curve: 4 });
  k.cyl('chrome', [0.8, 0.8, 0.82], 0.88, 1.065, 0, 0.03, 0.03, 0.012, 'y', 10);    // filler cap
  // ---- side covers (rounded triangles) under the seat
  const sc = smooth([[0.25, 0.58], [0.46, 0.58], [0.56, 0.74], [0.3, 0.8], [0.22, 0.7], [0.25, 0.58]], 14);
  k.profile('paintSolid', col, sc, 0.24, { bevel: 0.035, curve: 4 });
  // ---- seat: long, rounded, black vinyl
  const seat = smooth([[-0.12, 0.78], [0.62, 0.8], [0.66, 0.86], [0.5, 0.91], [0.1, 0.92], [-0.13, 0.88], [-0.12, 0.78]], 18);
  k.profile('dark', [0.45, 0.45, 0.45], seat, 0.25, { bevel: 0.05, taperY0: 0.85, taperY1: 0.93, taper: 0.8, curve: 4 });
  // grab rail, tail lamp, number plate
  k.arc('chrome', [0.7, 0.7, 0.72], -0.1, 0.84, 0, 0.13, 0.012, Math.PI * 0.5, Math.PI * 1.5, 10, 5, 1);
  k.blob('lights', [0.75, 0.06, 0.05], -0.2, 0.76, 0, 0.06, 0.035, 0.07, 0, 10, 6);
  k.box('lights', [0.92, 0.9, 0.82], -0.24, 0.62, 0, 0.012, 0.12, 0.18, 0, 0, 0.3);
  // ---- front: headlamp (round, chrome bezel), visor, speedo, handlebar, levers, mirrors, indicators
  k.cyl('chrome', [0.85, 0.85, 0.87], 1.17, 0.98, 0, 0.085, 0.075, 0.09, 'x', 18);
  k.cyl('lights', [1, 0.98, 0.9], 1.22, 0.98, 0, 0.074, 0.074, 0.012, 'x', 18);
  k.blob('paintSolid', col, 1.12, 1.07, 0, 0.1, 0.06, 0.12, 0.3, 12, 8);
  k.cyl('dark', D, 1.06, 1.12, 0, 0.05, 0.05, 0.05, 'y', 12);
  k.rod('chrome', [0.85, 0.85, 0.87], [1.03, 1.1, -0.33], [1.03, 1.1, 0.33], 0.011, 6);
  for (const s of [-1, 1]) {
    k.rod('chrome', [0.85, 0.85, 0.87], [1.03, 1.1, s * 0.33], [0.98, 1.13, s * 0.36], 0.011, 6);
    k.cyl('dark', D, 0.98, 1.135, s * 0.4, 0.016, 0.016, 0.1, 'z', 8);                   // grips
    k.rod('chrome', [0.8, 0.8, 0.82], [1.03, 1.11, s * 0.2], [1.0, 1.27, s * 0.27], 0.007, 4);
    k.cyl('dark', D, 1.0, 1.29, s * 0.27, 0.045, 0.045, 0.012, 'x', 12);                   // round mirror
    k.cyl('chrome', [0.6, 0.6, 0.62], 0.992, 1.29, s * 0.27, 0.04, 0.04, 0.004, 'x', 12);
    k.blob('lights', [1, 0.5, 0.08], 1.14, 0.98, s * 0.16, 0.035, 0.022, 0.022, 0, 8, 6);
    k.blob('lights', [1, 0.5, 0.08], -0.17, 0.8, s * 0.14, 0.03, 0.02, 0.02, 0, 8, 6);
  }
  // side stand (left side, -Z when leaning)
  k.rod('dark', D, [0.42, 0.36, -0.1], [0.36, 0.02, -0.3], 0.012, 6);
}

// ---------------------------------------------------------------------------
export function buildVehicles(ctx, parent) {
  const { THREE, site } = ctx;
  const k = new Kit(THREE);
  for (const v of vehicleList(site)) {
    const head = v.headingDeg + (HEADING_FIX[v.type] || 0);
    const paint = hex(THREE, v.color);
    // vehicles are built nose at +X; centre them on their footprint
    const len = { sedan: 3.99, 'mini-truck': 3.8, 'water-tanker': 5.2, tractor: 3.3, motorbike: 1.9 }[v.type] || 3;
    const off = { sedan: -2.0, 'mini-truck': -1.9, 'water-tanker': -1.2, tractor: -0.9, motorbike: -0.65 }[v.type] || -len / 2;
    const roll = v.type === 'motorbike' ? -0.13 : 0;   // leaning on its side stand
    k.begin(v.x, v.y, head, roll);
    k.paintKey = v.type === 'sedan' ? 'paint' : 'paintSolid';
    const T = THREE; const shift = new T.Matrix4().makeTranslation(off, 0, 0);
    k.M.multiply(shift);
    switch (v.type) {
      case 'sedan': sedan(k, paint); break;
      case 'mini-truck': miniTruck(k); break;
      case 'water-tanker': waterTanker(k, paint); break;
      case 'tractor': tractor(k); break;
      case 'motorbike': motorbike(k, paint); break;
      default: k.box('paint', paint, 0, 0.8, 0, len, 1.4, 1.6);
    }
  }
  // yard clutter: blue HDPE drums, old tyre stacks, more motorbikes (WA0005 / WA0009)
  const bikeCols = [[0.02, 0.02, 0.02], [0.35, 0.02, 0.02], [0.05, 0.08, 0.2], [0.25, 0.26, 0.28]];
  PROPS.forEach(([type, x, y, h], i) => {
    k.paintKey = 'paintSolid';
    if (type === 'motorbike') {
      k.begin(x, y, h, -0.13); k.M.multiply(new THREE.Matrix4().makeTranslation(-0.65, 0, 0));
      motorbike(k, bikeCols[i % bikeCols.length]);
    } else if (type === 'tyres') { k.begin(x, y, i * 37); tyreStack(k, h); }
    else { k.begin(x, y, h * 57.3); drum(k, type === 'drumLying'); }
  });
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0xb8b8b8, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 }),
    paintSolid: new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.0, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x10171c, metalness: 0.35, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1e1d1c, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.42 }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x262728, roughness: 0.75, metalness: 0.2 }),
    lights: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1, emissive: 0x111111 }),
    chrome: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.18 }),
  };
  for (const [key, gb] of Object.entries(k.gb)) {
    if (!gb.count) continue;
    const m = new THREE.Mesh(gb.build(THREE, { color: true }), mats[key]);
    m.castShadow = key !== 'lights'; m.receiveShadow = true; m.name = 'vehicles-' + key;
    parent.add(m);
  }
}
