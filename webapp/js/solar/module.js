// ============================================================================
//  SOLAR — PV module geometry (local frame: X = u (width), Y = normal, Z = -v
//  i.e. +Z points DOWN-slope; origin = centre of the top glass surface).
// ============================================================================
import * as THREE from 'three';
import { GB, sweepRect, extrudeProfile, rod } from './geom.js';

/**
 * Anodised frame cross-section (s = inset from outer edge, y = local up), metres.
 * Top lip 12.5 mm over the glass (2 mm proud), 3.5 mm outer wall, 32 mm bottom return flange.
 * Ordered so that normal = (dy, -ds) is outward.
 */
export const FRAME_PROFILE = [
  [0, 0.002], [0, -0.030], [0.032, -0.030], [0.032, -0.0282], [0.0035, -0.0282],
  [0.0035, -0.0095], [0.013, -0.0095], [0.013, -0.0065], [0.013, 0.0], [0.0125, 0.0008], [0.0112, 0.002],
];
export const GLASS_INSET = 0.002;
export const GLASS_THICK = 0.0065;

/** laminate: group 0 = front glass (cells), group 1 = back glass */
export function laminateGeometry(MOD) {
  const hw = MOD.width / 2 - GLASS_INSET, hl = MOD.length / 2 - GLASS_INSET;
  const gb = new GB();
  const up = new THREE.Vector3(0, 1, 0), dn = new THREE.Vector3(0, -1, 0);
  // uv.y = 0 at +Z (down-slope edge)
  gb.group(0).quad(new THREE.Vector3(-hw, 0, hl), new THREE.Vector3(hw, 0, hl), new THREE.Vector3(hw, 0, -hl), new THREE.Vector3(-hw, 0, -hl), up,
    [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const bw = MOD.width / 2 - 0.010, bl = MOD.length / 2 - 0.010, y = -GLASS_THICK;
  gb.group(1).quad(new THREE.Vector3(-bw, y, bl), new THREE.Vector3(bw, y, bl), new THREE.Vector3(bw, y, -bl), new THREE.Vector3(-bw, y, -bl), dn,
    [[0, 0], [1, 0], [1, 1], [0, 1]]);
  return gb.build();
}

export function frameGeometry(MOD) {
  const gb = new GB();
  sweepRect(gb, FRAME_PROFILE, MOD.width / 2, MOD.length / 2);
  // drain / mounting holes hint: nothing (sub-pixel). Return.
  return gb.build();
}

/** back details: 3 split junction boxes at mid-length + cables + MC4 connectors (group 0 = black plastic) */
export function backDetailGeometry(MOD, quality) {
  const gb = new GB();
  const y0 = -GLASS_THICK;
  const seg = quality === 'high' ? 8 : 5;
  for (const x of [-0.34, 0, 0.34]) {
    gb.obox(new THREE.Vector3(x, y0 - 0.009, 0), new THREE.Vector3(0.05, 0, 0), new THREE.Vector3(0, 0.009, 0), new THREE.Vector3(0, 0, 0.034));
  }
  // cables from outer boxes running along the frame towards the ends, MC4 plugs
  for (const [x, dir] of [[-0.34, 1], [0.34, -1]]) {
    const yC = y0 - 0.012;
    const p0 = new THREE.Vector3(x, yC, dir * 0.036), p1 = new THREE.Vector3(x, yC - 0.004, dir * 0.55);
    rod(gb, p0, p1, 0.003, seg, false);
    const p2 = new THREE.Vector3(x, yC - 0.004, dir * 0.62);
    rod(gb, p1, p2, 0.0065, 6, true);
  }
  return gb.build();
}

/**
 * Mini-rail (along local Z = up-slope axis of the plane), sitting on the sheet crest.
 * Local origin on the crest; EPDM pad 0..10 mm (group 1), aluminium rail 10..50 mm (group 0), screws (group 2).
 */
export function railGeometry(MNT, quality) {
  const gb = new GB();
  const L = MNT.railLength, hw = MNT.railWidth / 2, y0 = 0.010, y1 = 0.010 + MNT.railHeight;
  const prof = [[-hw, y0], [hw, y0], [hw, y0 + 0.003], [0.0205, y0 + 0.006], [0.019, y1], [-0.019, y1], [-0.0205, y0 + 0.006], [-hw, y0 + 0.003]];
  gb.group(0); extrudeProfile(gb, prof, -L / 2, L / 2, true);
  gb.group(1).obox(new THREE.Vector3(0, 0.005, 0), new THREE.Vector3(hw + 0.002, 0, 0), new THREE.Vector3(0, 0.005, 0), new THREE.Vector3(0, 0, L / 2 - 0.01));
  if (quality !== 'low') {
    gb.group(2);
    // self-drilling screws through the rail top into the sheet crest (visible in the module gap)
    for (const z of [-L / 2 + 0.04, -L / 2 + 0.11, L / 2 - 0.11, L / 2 - 0.04]) {
      const g = new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 6);
      gb.add(g, new THREE.Matrix4().makeTranslation(0, y1 + 0.002, z));
    }
  }
  return gb.build();
}

/** Mid clamp centred on the inter-module gap (local origin on the crest). group 0 alu, group 1 bolt */
export function midClampGeometry() {
  const gb = new GB();
  const top = 0.05 + 0.030 + 0.002; // frame lip top
  gb.group(0);
  gb.obox(new THREE.Vector3(0, top + 0.004, 0), new THREE.Vector3(0.022, 0, 0), new THREE.Vector3(0, 0.004, 0), new THREE.Vector3(0, 0, 0.025));
  gb.obox(new THREE.Vector3(0, (0.05 + top) / 2, 0), new THREE.Vector3(0.006, 0, 0), new THREE.Vector3(0, (top - 0.05) / 2, 0), new THREE.Vector3(0, 0, 0.018));
  gb.group(1);
  gb.add(new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 6), new THREE.Matrix4().makeTranslation(0, top + 0.011, 0));
  gb.add(new THREE.CylinderGeometry(0.010, 0.010, 0.0012, 10), new THREE.Matrix4().makeTranslation(0, top + 0.0085, 0));
  return gb.build();
}

/** End clamp: origin at the module's outer frame edge on the crest; +X = outward. */
export function endClampGeometry() {
  const gb = new GB();
  const top = 0.05 + 0.030 + 0.002;
  gb.group(0);
  // plate over the frame lip + block leg standing on the rail top beside the frame (rail centred on the edge)
  gb.obox(new THREE.Vector3(0.0, top + 0.004, 0), new THREE.Vector3(0.0125, 0, 0), new THREE.Vector3(0, 0.004, 0), new THREE.Vector3(0, 0, 0.025));
  gb.obox(new THREE.Vector3(0.0072, (0.05 + top + 0.008) / 2, 0), new THREE.Vector3(0.0048, 0, 0), new THREE.Vector3(0, (top + 0.008 - 0.05) / 2, 0), new THREE.Vector3(0, 0, 0.025));
  gb.group(1);
  gb.add(new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 6), new THREE.Matrix4().makeTranslation(0.0072, top + 0.011, 0));
  return gb.build();
}
