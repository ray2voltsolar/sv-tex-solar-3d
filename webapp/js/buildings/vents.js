// ============================================================================
//  BUILDINGS — turbo ventilators (site.ROOF_OBSTACLES, TURBO_VENT sizes).
//  Static part (base flashing following the roof slope, conical skirt, throat,
//  collar) goes into the building's galvanised mesh; the spinning heads are one
//  InstancedMesh whose matrices are rotated every frame.
// ============================================================================
import { MeshData, frame, fpt, box, cylinder, appendGeometry, planeFrame, norm, sub, cross, rng } from './lib.js';

const HEAD_BASE = 0.18;   // head bottom above the roof point

/** Static base for one vent into md (galv bucket). */
export function buildVentBase(K, md, o, pl, TV) {
  const F = planeFrame(pl);
  const c = K.col('#b9bdbe', 0.03, rng(o.x * 100 | 0));
  const b = TV.baseSize / 2;
  box(md, F, o.u - b, o.u + b, o.v - b, o.v + b, 0.003, 0.008, c);
  // conical skirt from the plate (on slope) to the vertical throat
  const rT = TV.throatDia / 2, rS = rT + 0.11, zTop = o.z + 0.1, seg = 24;
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    const A = fpt(F, o.u + rS * Math.cos(a0), o.v + rS * Math.sin(a0), 0.008);
    const B = fpt(F, o.u + rS * Math.cos(a1), o.v + rS * Math.sin(a1), 0.008);
    // throat ring is horizontal (plan circle around the vent axis)
    const ringPt = (a) => { const d = ringDir(pl, a); return [o.x + rT * d[0], o.y + rT * d[1], zTop]; };
    md.quad(A, B, ringPt(a1), ringPt(a0), null, [[0, 0], [1, 0], [1, 1], [0, 1]], c);
  }
  const Fv = frame([o.x, o.y, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  cylinder(md, Fv, rT, o.z - 0.06, o.z + HEAD_BASE - 0.005, 24, c, { capTop: false, capBottom: false });
  cylinder(md, Fv, rT + 0.012, o.z + HEAD_BASE - 0.03, o.z + HEAD_BASE - 0.005, 24, K.col('#a9adae'), { capTop: false, capBottom: false });
  // spindle cross-bars
  box(md, frame([o.x, o.y, o.z + HEAD_BASE - 0.02], [1, 0, 0], [0, 1, 0]), -rT, rT, -0.015, 0.015, -0.004, 0.004, c);
  box(md, frame([o.x, o.y, o.z + HEAD_BASE - 0.02], [0, 1, 0], [-1, 0, 0]), -rT, rT, -0.015, 0.015, -0.004, 0.004, c);
}
// direction in plan of the skirt point at plane-angle a (projected horizontally)
function ringDir(pl, a) {
  const d = [pl.u[0] * Math.cos(a) + pl.v[0] * Math.sin(a), pl.u[1] * Math.cos(a) + pl.v[1] * Math.sin(a)];
  const l = Math.hypot(d[0], d[1]); return [d[0] / l, d[1] / l];
}

/** Head geometry (local, plan-z up = world Y up after conversion), origin at head bottom centre. */
export function buildHeadGeometry(K, TV) {
  const { THREE } = K;
  const md = new MeshData('ventHead');
  const n = K.quality === 'high' ? 30 : K.quality === 'medium' ? 24 : 16;
  const nh = K.quality === 'low' ? 5 : 9;
  const R = TV.headDia / 2, H = TV.height - HEAD_BASE; // 0.44
  const zv0 = 0.035, zv1 = H - 0.085;
  const F0 = frame([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const galv = K.col('#c9cdcf'), dirty = K.col('#9a9d9c');
  cylinder(md, F0, R - 0.06, 0, zv0 + 0.01, 30, dirty, { capTop: false, capBottom: false });
  const dphi = Math.PI * 2 / n * 1.25;
  for (let k = 0; k < n; k++) {
    const phi0 = k / n * Math.PI * 2;
    const pt = (t, c) => {
      const rOut = (R - 0.06) + 0.06 * Math.sin(Math.PI * t) + 0.0 - 0.05 * t;
      const r = rOut * (1 - 0.13 * c) * (1 + 0.035 * Math.sin(Math.PI * c));
      const ph = phi0 + 0.55 * t + c * dphi;
      return [r * Math.cos(ph), r * Math.sin(ph), zv0 + (zv1 - zv0) * t];
    };
    for (let i = 0; i < nh; i++) {
      const t0 = i / nh, t1 = (i + 1) / nh;
      const col = t0 < 0.25 ? dirty : galv;
      for (const [c0, c1] of [[0, 0.5], [0.5, 1]]) {
        md.quad(pt(t0, c0), pt(t0, c1), pt(t1, c1), pt(t1, c0), null, [[c0, t0], [c1, t0], [c1, t1], [c0, t1]], col);
      }
    }
  }
  // upper ring + dome cap + hub
  const rTop = (R - 0.06) - 0.05;
  cylinder(md, F0, rTop + 0.004, zv1 - 0.01, zv1 + 0.012, 30, galv, { capTop: false, capBottom: false });
  const pts = [];
  for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.0005, (rTop + 0.004) * Math.cos(a)), zv1 + 0.012 + (H - zv1 - 0.03) * Math.sin(a))); }
  pts.reverse();
  const dome = new THREE.LatheGeometry(pts, 30);
  appendGeometry(md, dome, frame([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0]), galv);
  dome.dispose();
  cylinder(md, F0, 0.035, H - 0.022, H, 12, dirty);
  return md.toGeometry(THREE);
}

/** Creates the InstancedMesh of heads for all obstacles + registers the spin. */
export function buildVentHeads(K, mats, obstacles, TV) {
  const { THREE } = K;
  const geo = buildHeadGeometry(K, TV);
  const im = new THREE.InstancedMesh(geo, mats.vent, obstacles.length);
  im.name = 'turboVentHeads';
  im.castShadow = true; im.receiveShadow = true;
  const st = obstacles.map((o, i) => ({ pos: new THREE.Vector3(o.x, o.z + HEAD_BASE, -o.y), a: i * 1.37, w: 1.6 + (i * 0.618 % 1) * 1.6 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
  const update = (dt) => {
    for (let i = 0; i < st.length; i++) {
      const v = st[i]; v.a += v.w * Math.min(dt, 0.1);
      q.setFromAxisAngle(Y, v.a); m.compose(v.pos, q, s); im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  update(0);
  im.computeBoundingSphere();
  return { mesh: im, update };
}
