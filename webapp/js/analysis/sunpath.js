// ============================================================================
//  sunpath.js — elegant, thin 3D sun-path diagram for the selected day.
//
//    const sp = createSunPath(ctx);          // ctx.THREE not required: imports 'three' from the import map
//    scene.add(sp.group);
//    sp.update(date);                         // Date (UTC instant) — also self-subscribes to ctx.onSunChange
//    sp.setVisible(false);
//
//  Contents (dome radius 90 m centred on SITE.center at ground level):
//   * the selected day's arc, sunrise → sunset: travelled part solid gold, remaining part dashed amber
//   * hour ticks (cross-bars on the arc) with small "7am … 5pm" labels
//   * the current-sun marker (soft glow + core), a faint vertical drop line and a ground azimuth pointer
//   * faint dashed reference arcs: 21 Jun, equinox (20 Mar), 21 Dec, each with a tiny label
//   * a ground compass ring with 5°/10°/30°/90° ticks and N E S W (+ NE SE SW NW) letters
//  Everything is non-pickable, unlit, un-fogged and not tone-mapped so the colours stay as authored.
//  Draw calls ≈ 33 (lines ≈ 9, sprites ≈ 24).
//
//  LABELS ARE LAID OUT IN SCREEN SPACE (see layoutLabels). The dome is a 3-D object, but in plan / low-angle views its
//  arcs project straight across the model, so world-anchored text piles up on the roofs. Every frame (only when the
//  camera, viewport or day changed) the arc labels are therefore
//    * given a constant on-screen size (hour labels 11 px, arc names 10-12 px, soft dark text-shadow, no card),
//    * pushed off their arc along the screen-space arc normal by a fixed pixel gap,
//    * kept out of the screen footprint of the factory (convex hull of its projected footprint + chimney), the UI
//      chrome (side panel, view bar …) and the viewport edge,
//    * greedily de-cluttered against each other (priority: selected day > hours > solstices > equinox), hours are
//      thinned to every 2nd/3rd hour when they would crowd, and a label that finds no free spot is simply hidden.
// ============================================================================
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { getSunPosition, localParts, dateFromLocal } from './sun.js';
import { domePoint, dayTrack, segmentsTravelled, hourLabel, ringPoints, COMPASS } from './sunpath-math.js';

const RAD = Math.PI / 180;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// palette (sRGB hex)
const COL = {
  gold: 0xffc23d, amber: 0xffa21a, casing: 0x5a3200, text: '#fff3d4', ring: 0xf4f7fb,
  jun: 0xff8f52, equinox: 0x57d6a2, dec: 0x5ea6ff, north: '#ff7b64',
};

export function createSunPath(ctx, options = {}) {
  const site = ctx.site || {};
  const SITE = site.SITE || { lat: 13.3127, lng: 79.5703, utcOffsetHours: 5.5, center: { x: 20, y: 34 } };
  const lat = SITE.lat, lng = SITE.lng, tz = SITE.utcOffsetHours ?? 5.5;
  const R = options.radius ?? 90;
  const C = [SITE.center.x, 0, -SITE.center.y];                    // dome centre, world coords
  const GROUND_Y = options.groundY ?? 0.35;                         // ring height above the ground plane (avoids z-fighting)
  const maxAniso = ctx.maxAnisotropy || 4;

  const group = new THREE.Group();
  group.name = 'SunPath';
  group.renderOrder = 20;
  const disposables = new Set();                                    // geometries / materials / textures to free
  const lineMats = [];                                              // LineMaterials needing the viewport size

  // ---------------------------------------------------------------- helpers
  const v2 = new THREE.Vector2();
  function track(o) { o.raycast = () => {}; o.frustumCulled = false; return o; }

  function lineMaterial(color, linewidth, opacity, extra = {}) {
    const m = new LineMaterial({ color, linewidth, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false, ...extra });
    m.resolution.set(1280, 800);
    lineMats.push(m); disposables.add(m);
    return m;
  }
  function removeLine(l) {
    group.remove(l); l.geometry.dispose(); l.material.dispose();
    disposables.delete(l.geometry); disposables.delete(l.material);
    const i = lineMats.indexOf(l.material); if (i >= 0) lineMats.splice(i, 1);
  }
  function onBeforeRender(renderer) {                                // keep px-width lines correct for any canvas size / DPR
    renderer.getSize(v2);
    for (const m of lineMats) m.resolution.set(v2.x, v2.y);
  }
  function addLine(points, color, lw, opacity, { dashed = false, dashSize = 2, gapSize = 1.6, order = 21 } = {}) {
    const g = new LineGeometry(); g.setPositions(points);
    const m = lineMaterial(color, lw, opacity, dashed ? { dashed: true, dashSize, gapSize } : {});
    const l = new Line2(g, m); if (dashed) l.computeLineDistances();
    l.renderOrder = order; l.onBeforeRender = onBeforeRender; track(l); group.add(l); disposables.add(g);
    return l;
  }
  function addSegments(flat, color, lw, opacity, order = 21) {
    const g = new LineSegmentsGeometry(); g.setPositions(flat);
    const m = lineMaterial(color, lw, opacity);
    const l = new LineSegments2(g, m); l.renderOrder = order; l.onBeforeRender = onBeforeRender; track(l); group.add(l); disposables.add(g);
    return l;
  }

  /** Canvas text → sprite. Returns { sprite, setText(text) }. `h` = world height of the text box (m). */
  function makeLabel(text, { h = 3, color = COL.text, weight = 600, opacity = 1, stroke = 'rgba(8,16,30,0.78)', order = 24 } = {}) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity, sizeAttenuation: true }));
    sprite.renderOrder = order; track(sprite);
    let tex = null;
    function setText(t) {
      const PX = 64, pad = 14;                                       // text pixel height / padding
      const c = document.createElement('canvas'), g = c.getContext('2d');
      const font = `${weight} ${PX}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      g.font = font; const w = Math.ceil(g.measureText(t).width) + pad * 2, hh = PX + pad * 2;
      c.width = w; c.height = hh;
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.lineWidth = 9; g.strokeStyle = stroke; g.strokeText(t, w / 2, hh / 2 + 3);
      g.fillStyle = color; g.fillText(t, w / 2, hh / 2 + 3);
      if (tex) tex.dispose();
      tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
      sprite.material.map = tex; sprite.material.needsUpdate = true;
      sprite.scale.set((w / hh) * h * (hh / PX), h * (hh / PX), 1);   // text glyph height ≈ h
    }
    setText(text);
    disposables.add(sprite.material); disposables.add({ dispose: () => tex && tex.dispose() });
    return { sprite, setText };
  }

  /**
   * Screen-space label: a sprite whose on-screen size is fixed in CSS px (`fs` = font size) and whose position is set by
   * layoutLabels(). Soft dark text-shadow instead of a card. `bw`/`bh` = glyph box in CSS px (used for collision tests).
   */
  function makeScreenLabel(text, { fs = 11, color = COL.text, weight = 600, opacity = 1, order = 24, shadow = 'rgba(3,9,20,0.95)', gap = 9 } = {}) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity, sizeAttenuation: true }));
    sprite.renderOrder = order; sprite.visible = false; track(sprite);
    const L = { sprite, fs, gap, bw: 1, bh: 1, tw: 1, th: 1, text: null, setText: null, rect: null };
    let tex = null;
    // canvas em-size ≈ 1.5 × the on-screen size in device px: near 1:1 sampling keeps 10-12 px text crisp (no mip-map mush)
    const dpr = Math.min(3, (ctx.renderer && ctx.renderer.getPixelRatio && ctx.renderer.getPixelRatio()) || (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1) || 1);
    const PX = Math.max(20, Math.round(fs * dpr * 1.5)), pad = Math.round(PX * 0.42);
    L.setText = (t) => {
      if (t === L.text) return; L.text = t;
      const c = document.createElement('canvas'), g = c.getContext('2d');
      const font = `${weight} ${PX}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      g.font = font;
      const tw = Math.ceil(g.measureText(t).width), w = tw + pad * 2, h = PX + pad * 2;
      c.width = w; c.height = h;
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const cy = h / 2 + PX * 0.04;
      // "text-shadow" look: wide soft dark halo (3 passes build its density), a thin dark keyline, then the crisp fill
      g.fillStyle = color; g.shadowColor = shadow; g.shadowBlur = PX * 0.2; g.shadowOffsetY = PX * 0.03;
      for (let i = 0; i < 3; i++) g.fillText(t, w / 2, cy);
      g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.lineWidth = Math.max(2, PX * 0.12); g.strokeStyle = 'rgba(3,9,20,0.55)'; g.strokeText(t, w / 2, cy);
      g.fillText(t, w / 2, cy);
      if (tex) tex.dispose();
      tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
      sprite.material.map = tex; sprite.material.needsUpdate = true;
      L.tw = w; L.th = h; L.bw = (tw / PX) * L.fs; L.bh = L.fs * 1.12;
    };
    L.pxScale = (wpp) => { sprite.scale.set((L.tw / PX) * L.fs * wpp, (L.th / PX) * L.fs * wpp, 1); };
    L.setText(text);
    disposables.add(sprite.material); disposables.add({ dispose: () => tex && tex.dispose() });
    return L;
  }

  // sun marker texture: glow + core + hairline ring
  function sunTexture() {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,214,110,0.95)'); grd.addColorStop(0.22, 'rgba(255,190,70,0.55)'); grd.addColorStop(0.55, 'rgba(255,170,50,0.14)'); grd.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    const core = g.createRadialGradient(S / 2 - 6, S / 2 - 6, 2, S / 2, S / 2, S * 0.115);
    core.addColorStop(0, '#fffbe6'); core.addColorStop(0.6, '#ffe08a'); core.addColorStop(1, '#ffb83a');
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.115, 0, Math.PI * 2); g.fillStyle = core; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(120,70,0,0.55)'; g.stroke();
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.2, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = 'rgba(255,240,200,0.8)'; g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; disposables.add(t);
    return t;
  }

  // ---------------------------------------------------------------- static parts: ground compass
  {
    addLine(ringPoints(R, GROUND_Y, C, 240), COL.ring, 1.5, 0.55);
    addLine(ringPoints(R - 6, GROUND_Y, C, 180), COL.ring, 0.8, 0.22);           // faint inner ring
    const flat = [];
    const at = (azDeg, r) => [C[0] + Math.sin(azDeg * RAD) * r, GROUND_Y, C[2] - Math.cos(azDeg * RAD) * r];
    for (let a = 0; a < 360; a += 5) {
      const len = a % 90 === 0 ? 6 : a % 30 === 0 ? 3.6 : a % 10 === 0 ? 2 : 1.1;
      flat.push(...at(a, R), ...at(a, R - len));
    }
    addSegments(flat, COL.ring, 1.0, 0.5);
    for (const cd of COMPASS) {
      const isN = cd.text === 'N';
      const lb = makeLabel(cd.text, { h: cd.major ? 8 : 4.6, color: isN ? COL.north : '#f4f8ff', weight: cd.major ? 700 : 600, opacity: cd.major ? 1 : 0.85 });
      const p = at(cd.az, R + (cd.major ? 11 : 7)); lb.sprite.position.set(p[0], 3 + GROUND_Y, p[2]);
      group.add(lb.sprite);
    }
  }


  let disposed = false;
  // ---------------------------------------------------------------- arcs: dome polylines kept for the label layout
  /** A dome polyline (`tr.points`) plus buffers for its per-frame screen projection. */
  function arcOf(tr, decl, stepMin) {
    const n = tr.points.length, P = new Float64Array(n * 3);
    for (let k = 0; k < n; k++) { const p = domePoint(tr.points[k].az, tr.points[k].el, R, C); P[k * 3] = p[0]; P[k * 3 + 1] = p[1]; P[k * 3 + 2] = p[2]; }
    return { n, P, decl, stepMin, sx: new Float64Array(n), sy: new Float64Array(n), sw: new Float64Array(n), ok: new Uint8Array(n) };
  }
  function outwardDir(P, decl) {                                    // direction on the dome, ⟂ to the arc, pointing away from the pole
    const phi = lat * RAD, pole = [0, Math.sin(phi), -Math.cos(phi)];
    const c = pole.map((x) => x * R * Math.sin(decl * RAD));
    const rel = [P[0] - C[0] - c[0], P[1] - C[1] - c[1], P[2] - C[2] - c[2]];
    const l = Math.hypot(...rel) || 1; return rel.map((x) => x / l);
  }

  // ---------------------------------------------------------------- reference arcs (solstices + equinox)
  const refs = [], refArcs = [null, null, null], refShow = [true, true, true];
  let refYear = null;
  const refSpec = [
    { name: 'Jun 21', month: 6, day: 21, color: COL.jun, label: '21 Jun', text: '#ffc9a6', frac: 0.72 },
    { name: 'Equinox', month: 3, day: 20, color: COL.equinox, label: 'Equinox', text: '#a9f0d3', frac: 0.62 },
    { name: 'Dec 21', month: 12, day: 21, color: COL.dec, label: '21 Dec', text: '#b9d6ff', frac: 0.72 },
  ];
  const refDecl = [0, 0, 0];
  const refLabels = refSpec.map((r) => { const l = makeScreenLabel(r.label, { fs: 10.5, color: r.text, weight: 650, opacity: 1, order: 23, gap: 7 }); group.add(l.sprite); return l; });

  // selected-day state (declared before buildRefs, which reads it)
  const day = { key: null, decl: 0, track: null, casing: null, future: null, past: null, ticks: null, arc: null, hours: [], hourPts: [] };
  const lay = { W: 1, H: 1, key: new Float64Array(20), dirty: true, vp: new THREE.Matrix4(), obst: [], obstSig: '', obstAt: -1e9, placed: [], hull: null, info: [] };

  /** a reference arc that coincides with the selected day's own arc is hidden (line + label) */
  function applyRefVisibility() {
    refSpec.forEach((s, i) => { const apart = !day.track || Math.abs(refDecl[i] - day.decl) > 1.3; refShow[i] = apart; if (refs[i]) refs[i].visible = apart; });
    lay.dirty = true;
  }

  function buildRefs(year) {
    for (const r of refs) removeLine(r);
    refs.length = 0;
    refSpec.forEach((spec, i) => {
      const tr = dayTrack({ year, month: spec.month, day: spec.day }, { stepMin: 6, lat, lng, utcOffsetHours: tz });
      const pts = []; for (const p of tr.points) pts.push(...domePoint(p.az, p.el, R, C));
      refs.push(addLine(pts, spec.color, 1.3, 0.62, { dashed: true, dashSize: 1.8, gapSize: 1.5, order: 20 }));
      const decl = getSunPosition(tr.solarNoon, lat, lng).declination; refDecl[i] = decl;
      refArcs[i] = arcOf(tr, decl, 6);
    });
    refYear = year;
    applyRefVisibility();
  }

  // ---------------------------------------------------------------- selected-day parts (rebuilt when the day changes)
  const hourLabels = [];
  const dayLabel = makeScreenLabel('', { fs: 12.5, color: '#ffe29a', weight: 700, order: 25, gap: 9 }); group.add(dayLabel.sprite);

  function hourLabelAt(i) {
    if (!hourLabels[i]) { const l = makeScreenLabel('12pm', { fs: 11, color: COL.text, weight: 650, gap: 8 }); hourLabels[i] = l; group.add(l.sprite); }
    return hourLabels[i];
  }

  function buildDay(lp) {
    for (const k of ['casing', 'future', 'past', 'ticks']) if (day[k]) { removeLine(day[k]); day[k] = null; }
    const tr = dayTrack({ year: lp.year, month: lp.month, day: lp.day }, { stepMin: 2, lat, lng, utcOffsetHours: tz });
    day.track = tr;
    const pts = []; for (const p of tr.points) pts.push(...domePoint(p.az, p.el, R, C));
    day.casing = addLine(pts, COL.casing, 4.4, 0.22, { order: 21 });
    day.future = addLine(pts, COL.amber, 2.0, 0.95, { dashed: true, dashSize: 1.6, gapSize: 1.2, order: 22 });
    day.past = addLine(pts, COL.gold, 2.8, 1.0, { order: 23 });
    const decl = getSunPosition(tr.solarNoon, lat, lng).declination; day.decl = decl;
    day.arc = arcOf(tr, decl, 2);
    day.hours = tr.hours;
    day.hourPts = tr.hours.map((h) => domePoint(h.az, h.el, R, C));
    // hour crossbars (3-D); their labels are placed by layoutLabels()
    const flat = [];
    tr.hours.forEach((h, i) => {
      const P = day.hourPts[i], o = outwardDir(P, decl);
      flat.push(P[0] - o[0] * 1.3, P[1] - o[1] * 1.3, P[2] - o[2] * 1.3, P[0] + o[0] * 1.3, P[1] + o[1] * 1.3, P[2] + o[2] * 1.3);
      hourLabelAt(i).setText(hourLabel(h.hour));
    });
    if (flat.length) day.ticks = addSegments(flat, COL.gold, 1.6, 0.95, 24);
    dayLabel.setText(`${lp.day} ${MONTH[lp.month - 1]}`);
    day.key = `${lp.year}-${lp.month}-${lp.day}`;
    applyRefVisibility();
  }

  // ---------------------------------------------------------------- screen-space label layout
  const pj = { x: 0, y: 0, w: 0, ok: false };
  /** world point → CSS-px screen position (y down) using the current camera; `w` = clip w (view depth for perspective, 1 for ortho) */
  function project(x, y, z, o = pj) {
    const e = lay.vp.elements;
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (!(cw > 1e-5)) { o.ok = false; return o; }
    const cx = e[0] * x + e[4] * y + e[8] * z + e[12], cy = e[1] * x + e[5] * y + e[9] * z + e[13];
    o.x = (cx / cw * 0.5 + 0.5) * lay.W; o.y = (0.5 - cy / cw * 0.5) * lay.H; o.w = cw; o.ok = true;
    return o;
  }
  function projectArc(arc) {
    for (let k = 0; k < arc.n; k++) { project(arc.P[k * 3], arc.P[k * 3 + 1], arc.P[k * 3 + 2]); arc.sx[k] = pj.x; arc.sy[k] = pj.y; arc.sw[k] = pj.w; arc.ok[k] = pj.ok ? 1 : 0; }
  }

  // the factory's 3-D footprint (building rectangles at ground + roof height, the yard, the chimney) → convex hull on screen
  const FOOT = (() => {
    const pts = [], add = (x, y, z) => pts.push([x, z, -y]), ROOF_Z = 11.5;
    for (const b of Object.values(site.BUILDINGS || {})) {
      const f = b && b.footprint; if (!f) continue;
      for (const z of [0, ROOF_Z]) { add(f.x0, f.y0, z); add(f.x1, f.y0, z); add(f.x1, f.y1, z); add(f.x0, f.y1, z); }
    }
    for (const p of (SITE.yardPolygon || [])) add(p[0], p[1], 0);
    const ch = site.FEATURES && site.FEATURES.chimney; if (ch) { add(ch.x, ch.y, 0); add(ch.x, ch.y, (ch.height || 30) + 1); }
    if (!pts.length) for (const [dx, dy] of [[-22, -34], [22, -34], [22, 34], [-22, 34]]) for (const z of [0, ROOF_Z]) add(SITE.center.x + dx, SITE.center.y + dy, z);
    return pts;
  })();
  function convexHull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop(); return lo.concat(up);
  }
  /** screen hull of the factory, or null when it cannot (a point is behind the camera) or should not (it fills the screen) constrain labels */
  function footprintHull() {
    const pts = [];
    for (const q of FOOT) { project(q[0], q[1], q[2]); if (!pj.ok) return null; pts.push([pj.x, pj.y]); }
    const h = convexHull(pts);
    if (h.length < 3) return null;
    let a = 0; for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return Math.abs(a) / 2 > 0.55 * lay.W * lay.H ? null : h;
  }
  /** separating-axis test: does the (inflated) rectangle touch the convex polygon? */
  function rectHitsPoly(r, poly, m) {
    const x0 = r.x0 - m, x1 = r.x1 + m, y0 = r.y0 - m, y1 = r.y1 + m, n = poly.length;
    let mn = Infinity, mx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const p of poly) { if (p[0] < mn) mn = p[0]; if (p[0] > mx) mx = p[0]; if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]; }
    if (mx < x0 || mn > x1 || mxy < y0 || mny > y1) return false;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], nx = a[1] - b[1], ny = b[0] - a[0];
      let pmin = Infinity, pmax = -Infinity;
      for (const p of poly) { const d = nx * p[0] + ny * p[1]; if (d < pmin) pmin = d; if (d > pmax) pmax = d; }
      const c0 = nx * x0 + ny * y0, c1 = nx * x1 + ny * y0, c2 = nx * x1 + ny * y1, c3 = nx * x0 + ny * y1;
      if (Math.max(c0, c1, c2, c3) < pmin || Math.min(c0, c1, c2, c3) > pmax) return false;
    }
    return true;
  }

  // UI chrome (side panel, view bar, brand card, compass …) occupies screen space: keep labels out from under it
  const OBST_SEL = ['#panel', '#viewbar', '#brand', '#compass', '#legendFloat', '#scalebar', '#sunChip'];
  function pollObstacles(now, force) {
    if (!force && now - lay.obstAt < 400) return;
    lay.obstAt = now;
    if (typeof document === 'undefined') return;
    const cv = ctx.renderer && ctx.renderer.domElement, cr = cv && cv.getBoundingClientRect ? cv.getBoundingClientRect() : { left: 0, top: 0 };
    const out = []; let sig = '';
    for (const sel of OBST_SEL) {
      const e = document.querySelector(sel); if (!e) continue;
      const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      const o = { x0: r.left - cr.left - 4, x1: r.right - cr.left + 4, y0: r.top - cr.top - 4, y1: r.bottom - cr.top + 4 };
      out.push(o); sig += `${o.x0 | 0},${o.y0 | 0},${o.x1 | 0},${o.y1 | 0};`;
    }
    lay.obst = out;
    if (sig !== lay.obstSig) { lay.obstSig = sig; lay.dirty = true; }
  }

  function isFree(r, hull) {
    const M = 8;
    if (r.x0 < M || r.y0 < M || r.x1 > lay.W - M || r.y1 > lay.H - M) return false;
    for (const o of lay.obst) if (r.x1 > o.x0 && r.x0 < o.x1 && r.y1 > o.y0 && r.y0 < o.y1) return false;
    for (const q of lay.placed) if (r.x1 + 3 > q.x0 && r.x0 - 3 < q.x1 && r.y1 + 2 > q.y0 && r.y0 - 2 < q.y1) return false;
    if (hull && rectHitsPoly(r, hull, 7)) return false;
    return true;
  }

  const cam = { right: new THREE.Vector3(), up: new THREE.Vector3(), p5: 1 };
  /** try to put label `L` next to the screen anchor (ax,ay): pushed off the arc along its normal by L.gap px (+ half the glyph box) */
  function tryAnchor(L, ax, ay, aw, P, tx, ty, ox, oy, sides, hull) {
    let nx = -ty, ny = tx;
    const om = Math.hypot(ox, oy);
    if (om > 1.5 ? (nx * ox + ny * oy < 0) : ny > 0) { nx = -nx; ny = -ny; }   // n → "outward" (degenerate in plan view: then "up the screen")
    const d = L.gap + Math.abs(nx) * L.bw / 2 + Math.abs(ny) * L.bh / 2;
    for (const s of sides) {
      const cx = ax + s * nx * d, cy = ay + s * ny * d;
      const r = { x0: cx - L.bw / 2, x1: cx + L.bw / 2, y0: cy - L.bh / 2, y1: cy + L.bh / 2, text: L.text };
      if (!isFree(r, hull)) continue;
      const wpp = 2 * aw / (cam.p5 * lay.H);                                   // world units per CSS px at the anchor's depth
      const k = wpp, ex = (cx - ax) * k, ey = (cy - ay) * k;
      L.sprite.position.set(P[0] + cam.right.x * ex - cam.up.x * ey, P[1] + cam.right.y * ex - cam.up.y * ey, P[2] + cam.right.z * ex - cam.up.z * ey);
      L.pxScale(wpp); L.sprite.visible = true; L.rect = r;
      lay.placed.push(r);
      return true;
    }
    return false;
  }

  /** scan an arc from the preferred fraction outwards until `L` finds a free spot */
  const tmpP = [0, 0, 0], tmpQ = [0, 0, 0];
  function placeOnArc(L, arc, frac, sides, hull) {
    const n = arc.n, m = Math.max(1, Math.round(10 / arc.stepMin)), stride = Math.max(1, Math.round(6 / arc.stepMin)), k0 = Math.round(frac * (n - 1));
    for (let d = 0; d < n; d += stride) {
      for (let q = 0; q < (d ? 2 : 1); q++) {
        const k = k0 + (q ? -d : d);
        if (k < m || k > n - 1 - m || !arc.ok[k] || !arc.ok[k - m] || !arc.ok[k + m]) continue;
        let tx = arc.sx[k + m] - arc.sx[k - m], ty = arc.sy[k + m] - arc.sy[k - m];
        const tl = Math.hypot(tx, ty); if (tl < 2) continue;
        tx /= tl; ty /= tl;
        tmpP[0] = arc.P[k * 3]; tmpP[1] = arc.P[k * 3 + 1]; tmpP[2] = arc.P[k * 3 + 2];
        const o3 = outwardDir(tmpP, arc.decl);
        project(tmpP[0] + o3[0] * 4, tmpP[1] + o3[1] * 4, tmpP[2] + o3[2] * 4);
        const ox = pj.ok ? pj.x - arc.sx[k] : 0, oy = pj.ok ? pj.y - arc.sy[k] : 0;
        if (tryAnchor(L, arc.sx[k], arc.sy[k], arc.sw[k], tmpP, tx, ty, ox, oy, sides, hull)) return true;
      }
    }
    return false;
  }

  function layoutLabels(force) {
    if (!group.visible || !day.track) return;
    const camera = ctx.camera, rd = ctx.renderer;
    if (!camera || !rd) return;
    rd.getSize(v2);
    const W = v2.x, H = v2.y; if (W < 8 || H < 8) return;
    camera.updateMatrixWorld();
    const key = lay.key, me = camera.matrixWorld.elements, pe = camera.projectionMatrix.elements;
    let changed = force || lay.dirty || W !== lay.W || H !== lay.H;
    const cur = [pe[0], pe[5], pe[8], pe[9]];
    for (let i = 0; i < 16; i++) if (key[i] !== me[i]) { changed = true; key[i] = me[i]; }
    for (let i = 0; i < 4; i++) if (key[16 + i] !== cur[i]) { changed = true; key[16 + i] = cur[i]; }
    if (!changed) return;
    lay.dirty = false; lay.W = W; lay.H = H;
    lay.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cam.right.set(me[0], me[1], me[2]); cam.up.set(me[4], me[5], me[6]); cam.p5 = pe[5];
    lay.placed.length = 0;
    for (const L of hourLabels) L.sprite.visible = false;
    dayLabel.sprite.visible = false; refLabels.forEach((l) => { l.sprite.visible = false; });
    const hull = footprintHull(); lay.hull = hull;

    // 1) the selected day's name, on the inner side of its arc (the hour labels take the outer side)
    projectArc(day.arc);
    placeOnArc(dayLabel, day.arc, 0.3, [-1, 1], hull);

    // 2) hour labels, thinned when the hour spacing on screen is tight (every 2nd / 3rd hour)
    const A = day.arc, hp = day.hourPts, hs = day.hours, nh = hs.length;
    const hx = new Array(nh), hy = new Array(nh), hok = new Array(nh), hw = new Array(nh);
    const gaps = [];
    for (let i = 0; i < nh; i++) {
      project(hp[i][0], hp[i][1], hp[i][2]); hx[i] = pj.x; hy[i] = pj.y; hw[i] = pj.w; hok[i] = pj.ok;
      if (i && hok[i] && hok[i - 1] && hx[i] > 0 && hx[i] < W && hy[i] > 0 && hy[i] < H) gaps.push(Math.hypot(hx[i] - hx[i - 1], hy[i] - hy[i - 1]));
    }
    gaps.sort((a, b) => a - b);
    const med = gaps.length ? gaps[gaps.length >> 1] : 1e9;
    const step = med < 20 ? 3 : med < 40 ? 2 : 1;
    for (let i = 0; i < nh; i++) {
      const L = hourLabelAt(i);
      if (!hok[i] || hs[i].hour % step !== 0) continue;
      const idx = hs[i].index, m = 5, a = Math.max(0, idx - m), b = Math.min(A.n - 1, idx + m + 1);
      if (!A.ok[a] || !A.ok[b]) continue;
      let tx = A.sx[b] - A.sx[a], ty = A.sy[b] - A.sy[a];
      const tl = Math.hypot(tx, ty); if (tl < 2) continue;
      tx /= tl; ty /= tl;
      const o3 = outwardDir(hp[i], day.decl);
      project(hp[i][0] + o3[0] * 4, hp[i][1] + o3[1] * 4, hp[i][2] + o3[2] * 4);
      const ox = pj.ok ? pj.x - hx[i] : 0, oy = pj.ok ? pj.y - hy[i] : 0;
      tryAnchor(L, hx[i], hy[i], hw[i], hp[i], tx, ty, ox, oy, [1, -1], hull);
    }

    // 3) reference arcs: the two solstices first, the equinox only if there is room
    for (const i of [0, 2, 1]) {
      if (!refShow[i] || !refArcs[i]) continue;
      projectArc(refArcs[i]);
      placeOnArc(refLabels[i], refArcs[i], refSpec[i].frac, [1, -1], hull);
    }
    lay.info = [dayLabel, ...refLabels, ...hourLabels].filter((l) => l.sprite.visible).map((l) => ({ text: l.text, x0: Math.round(l.rect.x0), y0: Math.round(l.rect.y0), x1: Math.round(l.rect.x1), y1: Math.round(l.rect.y1) }));
  }

  if (typeof ctx.registerAnimated === 'function') {
    ctx.registerAnimated(() => {
      if (disposed || !group.visible) return;
      pollObstacles(typeof performance !== 'undefined' ? performance.now() : Date.now());
      layoutLabels();
    });
  }


  // ---------------------------------------------------------------- current sun
  const sunTex = sunTexture();
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, toneMapped: false, fog: false, sizeAttenuation: true }));
  marker.scale.set(9.5, 9.5, 1); marker.renderOrder = 26; track(marker); group.add(marker); disposables.add(marker.material);
  // drop line (unit height, scaled) and ground azimuth pointer (unit radius along -Z, rotated)
  const dropGeo = new LineGeometry(); dropGeo.setPositions([0, 0, 0, 0, 1, 0]); disposables.add(dropGeo);
  const drop = new Line2(dropGeo, lineMaterial(COL.gold, 1.1, 0.4)); drop.renderOrder = 22; drop.onBeforeRender = onBeforeRender; track(drop); group.add(drop);
  const ptrGeo = new LineGeometry(); ptrGeo.setPositions([0, 0, 0, 0, 0, -R]); disposables.add(ptrGeo);
  const ptr = new Line2(ptrGeo, lineMaterial(COL.gold, 1.3, 0.55, { dashed: true, dashSize: 2.2, gapSize: 1.6 }));
  ptr.computeLineDistances(); ptr.renderOrder = 22; ptr.onBeforeRender = onBeforeRender; track(ptr); ptr.position.set(C[0], GROUND_Y, C[2]); group.add(ptr);
  const ptrDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 0.9 }));
  ptrDot.scale.set(4, 4, 1); ptrDot.renderOrder = 25; track(ptrDot); group.add(ptrDot); disposables.add(ptrDot.material);

  // ---------------------------------------------------------------- update
  let lastKey = '', lastAz = -1, lastEl = -1;
  const state = { visible: true, azimuth: 0, elevation: 0, aboveHorizon: false };

  function update(dateLike) {
    const d = dateLike instanceof Date ? dateLike : (dateLike != null ? new Date(dateLike) : (ctx.sunState && ctx.sunState.date));
    if (!d || Number.isNaN(d.getTime())) return;
    const lp = localParts(d, tz);
    if (refYear !== lp.year) buildRefs(lp.year);
    const key = `${lp.year}-${lp.month}-${lp.day}`;
    if (key !== day.key) buildDay(lp);
    const pos = getSunPosition(d, lat, lng);
    const up = pos.elevation > 0;
    state.azimuth = pos.azimuth; state.elevation = pos.elevation; state.aboveHorizon = up;
    // travelled part of the arc (instanced line: draw only the first k segments)
    const k = segmentsTravelled(day.track, d.getTime());
    day.past.visible = day.casing.visible = k > 0; day.past.geometry.instanceCount = day.casing.geometry.instanceCount = Math.max(1, k);
    marker.visible = ptr.visible = drop.visible = ptrDot.visible = up;
    if (up) {
      const P = domePoint(pos.azimuth, pos.elevation, R, C);
      marker.position.set(P[0], P[1], P[2]);
      drop.position.set(P[0], GROUND_Y, P[2]); drop.scale.set(1, Math.max(0.01, P[1] - GROUND_Y), 1);
      ptr.rotation.y = -pos.azimuth * RAD;
      const g = [C[0] + Math.sin(pos.azimuth * RAD) * R, GROUND_Y + 0.05, C[2] - Math.cos(pos.azimuth * RAD) * R];
      ptrDot.position.set(g[0], g[1], g[2]);
    }
    lastKey = key; lastAz = pos.azimuth; lastEl = pos.elevation;
  }

  function setVisible(v) { state.visible = !!v; group.visible = state.visible; lay.dirty = true; }
  function dispose() {
    disposed = true;
    for (const d of disposables) { try { d.dispose && d.dispose(); } catch { /* ignore */ } }
    if (group.parent) group.parent.remove(group);
  }

  // self-subscribe so the path follows the core's sun state even if the core forgets to call update()
  if (typeof ctx.onSunChange === 'function') ctx.onSunChange((s) => update(s && s.date ? s.date : undefined));
  if (ctx.sunState && ctx.sunState.date) update(ctx.sunState.date);
  else update(dateFromLocal(2026, 12, 21, 10, 30, tz));

  void lastKey; void lastAz; void lastEl;
  return {
    group, update, setVisible, dispose,
    get visible() { return state.visible; },
    get state() { return { ...state }; },
    radius: R, center: C.slice(),
    layout: (force = true) => { lay.dirty = true; layoutLabels(force); return lay.info.slice(); },   // debug: force a label layout, returns the placed label rects (CSS px)
    get labelRects() { return lay.info.slice(); },
  };
}

export default createSunPath;
