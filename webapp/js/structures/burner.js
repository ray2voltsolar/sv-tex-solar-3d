// ============================================================================
//  STRUCTURES — wood-fired thermic-fluid heater, flue duct, firewood stacks
// ============================================================================
import * as THREE from 'three';
import { V, D, UP, boxAt, boxUV, beam, cylBetween, revolve, placeAt, tubePath, rng } from './kit.js';
import { motor } from './equipment.js';

export function buildBurner(ctx, B, chim) {
  const F = ctx.site.FEATURES, b = F.burner;
  const fx = b.x, fy = b.y, fw = b.furnace.w, fd = b.furnace.d, fh = b.furnace.h;

  // ---- brick furnace on a concrete plinth, cast-iron fuel & ash doors (north side)
  B.add('concrete', boxUV(boxAt(fx, fy, -0.05, fw + 0.3, fd + 0.3, 0.17), 1 / 3));
  B.add('brick', boxUV(boxAt(fx, fy, 0.12, fw, fd, fh - 0.12), 1 / 0.94, 1 / 0.6));
  B.add('concrete', boxUV(boxAt(fx, fy, fh, fw + 0.12, fd + 0.12, 0.1), 1 / 3));
  const yN = fy + fd / 2;
  B.add('steelDark', boxAt(fx, yN + 0.02, 0.32, 0.82, 0.06, 0.7));
  B.add('rubber', boxAt(fx, yN + 0.05, 0.4, 0.62, 0.04, 0.54));
  B.add('steelDark', boxAt(fx + 0.22, yN + 0.09, 0.62, 0.05, 0.05, 0.12));
  B.add('steelDark', boxAt(fx, yN + 0.02, 0.13, 0.56, 0.05, 0.16));
  B.add('steelDark', boxAt(fx, yN + 0.04, 0.03, 1.2, 0.14, 0.03)); // ash plate
  // buckstays (steel channels holding the brickwork)
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) B.add('steelDark', boxAt(fx + sx * (fw / 2 - 0.02), fy + sy * (fd / 2 - 0.02), 0.12, 0.1, 0.1, fh - 0.1));

  // ---- horizontal thermic-fluid heater with aluminium-clad insulation
  const r = b.heaterDia / 2, L = b.heaterHeight, zc = fh + 0.1 + 0.18 + r;
  const hl = L / 2;
  // dished rear head (south), flat burner front (north, facing the passage)
  const prof = [[0, -hl - 0.12], [r * 0.5, -hl - 0.1], [r * 0.83, -hl - 0.05], [r * 0.98, -hl + 0.02], [r, -hl + 0.08], [r, hl - 0.02], [r * 0.97, hl], [0, hl]];
  const heater = revolve(prof, 36, { uRep: Math.round(Math.PI * 2 * r), vScale: 1 });
  heater.rotateX(-Math.PI / 2); heater.translate(fx, zc, -fy);
  B.add('alumSoot', heater);
  // front plate, burner door (dark opening, glowing peep hole), hinges, refractory collar
  const yF = fy + hl;
  B.add('machGrey', cylBetween(V(fx, yF - 0.01, zc), V(fx, yF + 0.05, zc), r + 0.05, 36));
  B.add('machGrey', cylBetween(V(fx, yF + 0.05, zc), V(fx, yF + 0.08, zc), r * 0.92, 36));
  B.add('rubber', cylBetween(V(fx, yF + 0.08, zc - 0.12), V(fx, yF + 0.1, zc - 0.12), r * 0.42, 24));
  B.add('steelDark', cylBetween(V(fx, yF + 0.1, zc - 0.12), V(fx, yF + 0.15, zc - 0.12), r * 0.36, 24));
  B.add('glow', cylBetween(V(fx, yF + 0.15, zc - 0.04), V(fx, yF + 0.155, zc - 0.04), 0.045, 12));
  B.add('glow', boxAt(fx, yF + 0.11, zc - 0.12 - r * 0.42 - 0.005, r * 0.5, 0.012, 0.015));
  for (const dz of [0.12, -0.36]) B.add('steelDark', cylBetween(V(fx - r * 0.44, yF + 0.12, zc + dz - 0.06), V(fx - r * 0.44, yF + 0.12, zc + dz + 0.06), 0.03, 8));
  B.add('steelDark', boxAt(fx + r * 0.3, yF + 0.16, zc - 0.14, 0.18, 0.04, 0.04)); // latch handle
  // front support frame: two channel legs from the floor to the shell centreline + belt
  for (const s of [-1, 1]) {
    const lx = fx + s * (r + 0.12);
    B.add('steelDark', boxAt(lx, yF - 0.15, 0, 0.12, 0.1, zc + 0.15));
    B.add('steelDark', boxAt(lx, yF - 0.15, 0, 0.26, 0.24, 0.015));
    B.add('steelDark', beam(V(lx, yF - 0.15, zc - r * 0.7), V(fx + s * r * 0.72, yF - 0.15, zc - r * 0.7), 0.08, 0.08, UP));
  }
  B.add('steelDark', beam(V(fx - r - 0.12, yF - 0.15, zc + 0.15), V(fx + r + 0.12, yF - 0.15, zc + 0.15), 0.1, 0.1, UP));
  for (const yy of [-hl + 0.35, -0.5, 0.5, hl - 0.35]) {
    const band = revolve([[r, yy - 0.025], [r + 0.006, yy - 0.025], [r + 0.006, yy + 0.025], [r, yy + 0.025]], 36);
    band.rotateX(-Math.PI / 2); band.translate(fx, zc, -fy); B.add('steelDark', band);
  }
  // saddles
  for (const sy of [-0.85, 0.85]) {
    B.add('steelDark', boxAt(fx, fy + sy, fh + 0.1, 1.5, 0.22, 0.05));
    B.add('steelDark', boxAt(fx, fy + sy, fh + 0.15, 0.04, 0.2, r * 0.6));
    for (const sx of [-0.6, 0.6]) B.add('steelDark', boxAt(fx + sx, fy + sy, fh + 0.15, 0.03, 0.2, 0.35));
  }
  // nozzles + flanges on top
  const topZ = zc + r;
  for (const [ox, oy] of [[0.25, hl - 0.4], [-0.25, hl - 0.4], [0, 0.2]]) {
    B.add('machGrey', cylBetween(V(fx + ox, fy + oy, topZ - 0.1), V(fx + ox, fy + oy, topZ + 0.12), 0.06, 10));
    B.add('machGrey', cylBetween(V(fx + ox, fy + oy, topZ + 0.1), V(fx + ox, fy + oy, topZ + 0.14), 0.1, 12));
  }
  // safety valve & gauge
  B.add('machGrey', cylBetween(V(fx, fy + 0.2, topZ + 0.14), V(fx, fy + 0.2, topZ + 0.38), 0.04, 8));

  // ---- flue duct to the chimney (insulated, aluminium clad)
  const dz = 3.55, dr = 0.34;
  const cxC = chim.cx, cyC = chim.cy, Rs = chim.R;
  const yOut = fy - hl + 0.45;
  const duct = [V(fx, yOut, zc + r * 0.6), V(fx, yOut, dz), V(fx, cyC, dz), V(cxC - Rs + 0.06, cyC, dz)];
  const dg = tubePath(duct, dr, 20, 0.7, 0.15);
  remapTubeUV(dg, dr);
  B.add('alum', dg);
  // flanges, expansion bellows and the breeching collar at the stack
  for (const x of [fx + 1.2, fx + 2.8]) B.add('steelDark', cylBetween(V(x, cyC, dz), V(x + 0.05, cyC, dz), dr + 0.03, 20));
  for (let i = 0; i < 5; i++) { const x = cxC - 1.75 + i * 0.07; B.add('steelDark', cylBetween(V(x, cyC, dz), V(x + 0.035, cyC, dz), dr + 0.035, 20)); }
  B.add('steelDark', cylBetween(V(cxC - Rs - 0.07, cyC, dz), V(cxC - Rs + 0.01, cyC, dz), dr + 0.09, 20));
  B.add('steelDark', cylBetween(V(fx, fy - 0.2 - (hl - 0.45) - 0.05, dz), V(fx, fy - 0.2 - (hl - 0.45) + 0.0, dz), dr + 0.03, 20));
  // duct support portals
  const portal = (px, py, alongX) => {
    const top = dz - dr - 0.02;
    for (const s of [-0.5, 0.5]) {
      const x = alongX ? px : px + s, y = alongX ? py + s : py;
      B.add('steelPaint', boxAt(x, y, 0, 0.1, 0.1, top));
      B.add('steelDark', boxAt(x, y, 0, 0.25, 0.25, 0.02));
      B.add('concrete', boxUV(boxAt(x, y, -0.1, 0.35, 0.35, 0.18), 1 / 3));
    }
    B.add('steelPaint', alongX ? boxAt(px, py, top - 0.12, 0.12, 1.15, 0.12) : boxAt(px, py, top - 0.12, 1.15, 0.12, 0.12));
    B.add('steelPaint', alongX ? boxAt(px, py, top - 0.02, 0.2, 0.5, 0.04) : boxAt(px, py, top - 0.02, 0.5, 0.2, 0.04));
  };
  portal(fx, (yOut + cyC) / 2 - 0.4, false);
  portal((fx + cxC) / 2 + 0.2, cyC, true);

  // ---- thermic-fluid flow/return lines to the dyeing shed + circulation pumps
  const shedX = ctx.site.BUILDINGS.DYEING_SHED.footprint.x0;
  const pz = 3.5, yP = fy + hl - 0.4;
  for (const [ox, k] of [[0.25, 0], [-0.25, 1]]) {
    const y = yP + k * 0.32;
    const pts = [V(fx + ox, fy + hl - 0.4, topZ + 0.12), V(fx + ox, fy + hl - 0.4, pz + k * 0.22), V(fx + ox, y, pz + k * 0.22), V(shedX + 0.05, y, pz + k * 0.22)];
    const g = tubePath(pts, 0.075, 10, 0.25, 0.25); remapTubeUV(g, 0.075); B.add('alum', g);
  }
  const sup = (x) => {
    B.add('steelPaint', boxAt(x, yP + 0.16, 0, 0.08, 0.08, pz - 0.08));
    B.add('steelPaint', boxAt(x, yP + 0.16, pz - 0.137, 0.08, 0.7, 0.06));
    B.add('steelPaint', boxAt(x, yP + 0.16, pz + 0.22 - 0.127, 0.08, 0.7, 0.05));
  };
  sup(25.4); sup(23.3);
  // pumps on a plinth
  const pX = 22.6, pY = fy + 1.85;
  B.add('concrete', boxUV(boxAt(pX, pY, 0, 1.6, 0.9, 0.2), 1 / 3));
  for (const dx of [-0.38, 0.38]) {
    motor(B, V(pX + dx, pY - 0.18, 0.42), D(0, 1), 0.13, 0.42);
    B.add('machGrey', cylBetween(V(pX + dx, pY + 0.22, 0.42), V(pX + dx, pY + 0.38, 0.42), 0.16, 14));
    B.add('steelDark', boxAt(pX + dx, pY, 0.2, 0.36, 0.8, 0.06));
    const g = tubePath([V(pX + dx, pY + 0.3, 0.6), V(pX + dx, pY + 0.3, 2.95), V(pX + dx, yP + 0.32, 2.95), V(pX + dx, yP + 0.32, pz + 0.22 - 0.07)], 0.05, 8, 0.2); B.add('machGrey', g);
  }
  // control panel against the Block C wall
  const cX = ctx.site.BUILDINGS.C.footprint.x1 + 0.22;
  B.add('machGrey', boxAt(cX, fy - 0.9, 0.12, 0.35, 0.8, 1.55));
  B.add('concrete', boxUV(boxAt(cX, fy - 0.9, 0, 0.45, 0.9, 0.12), 1 / 3));
  B.add('glassDark', boxAt(cX + 0.18, fy - 0.9, 1.15, 0.01, 0.3, 0.2));

  // ---- firewood stacks (instanced logs)
  return buildFirewood(ctx);
}

function remapTubeUV(g, r) {
  // TubeGeometry uv: x = along (0..1), y = around. Re-map to metres: u around, v along.
  g.computeBoundingBox();
  const uv = g.attributes.uv; const n = uv.count;
  const params = g.parameters; const L = params.path.getLength();
  const circ = Math.max(1, Math.round(Math.PI * 2 * r));
  for (let i = 0; i < n; i++) { const a = uv.getX(i), b = uv.getY(i); uv.setXY(i, b * circ, a * L); }
  uv.needsUpdate = true;
}
export { remapTubeUV };

function buildFirewood(ctx) {
  // Firewood stacked crosswise in ~1 m "cells": logs lie N–S so their pale cut ends face the
  // passage (readable from 20 m), cells are offset/uneven in height, the top course is ragged with
  // loose logs lying across it, and the dark core boxes sit well below the top course.
  const F = ctx.site.FEATURES;
  const q = ctx.quality;
  const R = rng(1234);
  const base = new THREE.CylinderGeometry(1, 1, 1, q === 'low' ? 5 : 7, 1, false);
  // side uv → left half, caps → right half of the log texture
  const uv = base.attributes.uv; const idx = base.index.array;
  const capV = new Set();
  for (const gr of base.groups) if (gr.materialIndex !== 0) for (let i = gr.start; i < gr.start + gr.count; i++) capV.add(idx[i]);
  for (let i = 0; i < uv.count; i++) {
    if (capV.has(i)) uv.setX(i, 0.5 + uv.getX(i) * 0.5); else uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 2);
  }
  base.clearGroups();
  const mats = []; const cols = [];
  const m4 = new THREE.Matrix4(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const AX_Y = new THREE.Vector3(0, 1, 0), AX_X = new THREE.Vector3(1, 0, 0), AX_Z = new THREE.Vector3(0, 0, 1);
  const fills = [];
  const coarse = q === 'low' ? 1.35 : 1;
  const barkCol = () => { // per-log bark tint: greyish casuarina / brown eucalyptus / fresh reddish
    const t = R(), k = R();
    if (k < 0.3) return new THREE.Color().setRGB(0.78 + t * 0.3, 0.74 + t * 0.28, 0.7 + t * 0.26);
    if (k < 0.8) return new THREE.Color().setRGB(0.6 + t * 0.35, 0.52 + t * 0.3, 0.44 + t * 0.26);
    return new THREE.Color().setRGB(0.82 + t * 0.25, 0.6 + t * 0.2, 0.46 + t * 0.15);
  };
  /** push one log: centre (plan x,y,z), axis 'x' | 'y' in plan, radius, length, extra yaw/pitch */
  const log = (x, y, z, axis, r, len, yaw = 0, pitch = 0) => {
    ps.set(x, z, -y);
    qa.setFromAxisAngle(AX_Y, R() * Math.PI * 2); // roll about own axis
    if (axis === 'x') qb.setFromAxisAngle(AX_Z, Math.PI / 2 + pitch); else qb.setFromAxisAngle(AX_X, Math.PI / 2 + pitch);
    qc.setFromAxisAngle(AX_Y, yaw);
    sc.set(r * (0.9 + R() * 0.2), len, r);
    m4.compose(ps, qc.clone().multiply(qb).multiply(qa), sc); mats.push(m4.clone());
    cols.push(barkCol());
  };
  for (const st of F.firewood) {
    const W = st.x1 - st.x0, aisle = 0.55, depth = (W - aisle - 0.3) / 4;
    const xs = [st.x0, st.x0 + depth + 0.1, st.x0 + 2 * depth + 0.2 + aisle, st.x0 + 3 * depth + 0.3 + aisle];
    const hs = [st.h, st.h * 0.82, st.h * 0.92, st.h * 0.7];
    xs.forEach((x0, si) => {
      const xa = x0 + 0.04, xb = x0 + depth - 0.04, y0 = st.y0 + 0.1, y1 = st.y1 - 0.1, h0 = hs[si];
      // split the row into cells of one log length (0.85–1.1 m); logs in a cell run along y
      const nCells = Math.max(1, Math.round((y1 - y0) / 0.98));
      const cellL = (y1 - y0 - 0.015 * (nCells - 1)) / nCells;
      let yc0 = y0, cell = 0;
      let minTop = h0;
      while (cell < nCells) {
        const cl = cellL;
        const ymid = yc0 + cl / 2;
        const hCell = h0 * (0.72 + R() * 0.32) * (cell === 0 ? 0.92 : 1);
        // ragged top: each layer's allowed height varies along x
        const topAt = (x) => hCell * (0.9 + 0.08 * Math.sin(x * 7.1 + cell * 2.3 + si) + 0.06 * Math.sin(x * 17.3 + cell));
        let z = 0, layer = 0, lastZ = 0;
        while (z < hCell) {
          let x = xa + (layer % 2) * 0.045;
          while (x < xb) {
            const r = (0.045 + R() * 0.055) * coarse;
            const xc = x + r;
            if (xc + r > xb + 0.02) break;
            if (z + r < topAt(xc)) {
              const len = cl * (0.84 + R() * 0.2);
              const yo = (R() - 0.5) * (cl - len) * 1.6 + (R() < 0.12 ? (R() - 0.5) * 0.25 : 0); // some stick out
              log(xc, ymid + yo, z + r, 'y', r, len, (R() - 0.5) * 0.1, (R() - 0.5) * 0.06);
              lastZ = Math.max(lastZ, z + 2 * r);
            }
            x += 2 * r * 0.97;
          }
          z += 0.098 * coarse;
          layer++;
        }
        minTop = Math.min(minTop, hCell * 0.8);
        // a few loose logs thrown across the top of this cell
        const nLoose = R() < 0.6 ? 1 + (R() * 3 | 0) : 0;
        for (let k = 0; k < nLoose; k++) {
          const r = 0.05 + R() * 0.05;
          log(x0 + depth * (0.2 + R() * 0.6), ymid + (R() - 0.5) * cl * 0.7, lastZ + r * 0.8, R() < 0.5 ? 'x' : 'y', r, 0.6 + R() * 0.5, (R() - 0.5) * 1.2, (R() - 0.5) * 0.25);
        }
        yc0 += cl + 0.015; cell++;
      }
      // dark core (only fills the see-through gaps deep inside; sits ≥0.3 m below the lowest top course)
      fills.push({ x: x0 + depth / 2, y: (y0 + y1) / 2, w: depth - 0.36, d: y1 - y0 - 0.6, h: Math.max(0.2, minTop - 0.35) });
    });
    // loose logs and offcuts on the floor around the stacks (mostly on the passage side)
    for (let i = 0; i < 9; i++) {
      const r = 0.04 + R() * 0.05, len = 0.5 + R() * 0.6;
      const side = R();
      const px = side < 0.6 ? st.x0 + 0.3 + R() * (W - 0.6) : (R() < 0.5 ? st.x0 - 0.15 - R() * 0.3 : st.x1 + 0.15 + R() * 0.3);
      const py = side < 0.6 ? st.y1 + 0.15 + R() * 0.6 : st.y0 + R() * (st.y1 - st.y0);
      log(px, py, r, R() < 0.5 ? 'x' : 'y', r, len, R() * 6.28, 0);
    }
    // short chunks / bark chips scattered on the floor
    for (let i = 0; i < 26; i++) {
      const r = 0.025 + R() * 0.03, len = 0.06 + R() * 0.18;
      log(st.x0 + R() * W, st.y1 + 0.05 + R() * R() * 1.2, r * 0.6, R() < 0.5 ? 'x' : 'y', r, len, R() * 6.28, 0);
    }
  }
  return { logGeom: base, logMatrices: mats, logColors: cols, fills };
}
