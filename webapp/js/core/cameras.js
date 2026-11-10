// ============================================================================
//  Camera rig: perspective + orthographic cameras sharing one OrbitControls,
//  framing-preserving projection toggle, animated preset views, drone orbit.
//  View state = { target: Vector3, theta, phi, dist, fov } where `dist` is the
//  perspective-equivalent distance (ortho half-height = dist·tan(fov/2)).
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ORTHO_H0 = 50;        // base half-height of the ortho frustum (zoom 1)
const ORTHO_STANDOFF = 700; // ortho camera distance from the target
const ORTHO_FAR = 4000;
// elevations: only ≈ 140 m of depth behind the section line — in ortho every far context tree is drawn full size and
// thousands of them merged into a flat green-grey wall behind the site (and differed per direction)
const ELEV_DEPTH = 140;
const DEG = Math.PI / 180;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const P = (a) => new THREE.Vector3(a[0], a[2], -a[1]); // plan → world

/** Preset views (plan coords). Keys 1–9 map to `key`. */
export const VIEWS = {
  // overview (r2): from just west of due south, so the stack projects NNE into the yard gap and onto the dyeing roof —
  // never across the Block C arrays / basic roof (a camera east of the stack's meridian leans it over them)
  overview:  { label: 'Overview', key: '1', cam: [10, -66, 66], target: [18, 30, 3], fov: 40, group: 'main' },
  top:       { label: 'Plan', key: '2', ortho: true, plan: true, target: [20, 33, 0], halfH: 44, group: 'main' },
  blockA:    { label: 'Block A', key: '3', cam: [55, 33, 30], target: [29.7, 58.5, 6.5], fov: 40, group: 'roof' },
  blockC:    { label: 'Block C', key: '4', cam: [35, 36, 23], target: [9.2, 22, 6.2], fov: 40, group: 'roof' },
  blockD:    { label: 'Block D', key: '5', cam: [24, -20, 19], target: [9.3, 5.6, 5.4], fov: 40, group: 'roof' },
  entrance:  { label: 'Entrance', key: '6', cam: [38.6, 46.5, 1.6], target: [18, 46.2, 2.6], fov: 55, group: 'street' },
  // re-solved r2: wall ends at 10 %/83 %, chimney at 35 % ⇒ cam ≈ (79.7, 23.3); phone ≈ 76° horizontal ⇒ 52° vertical at 16:10;
  // pitched ≈ 11° up so the horizon sits at ≈ 70 % and the chimney cap ≈ 15 % from the top (as in the photo)
  photoEast: { label: 'East field', key: '7', cam: [79.7, 23.3, 1.6], target: [30, 23.3, 11.3], fov: 52, group: 'street', note: 'Photo match ≈ WA0010' },
  // re-solved r2 from 5 photo points (Block A corners, mini truck, tanker): cam (68, 47.5) on the dirt lane, heading
  // ≈ 152° (WNW), ≈ 70° horizontal ⇒ 47° vertical at 16:10, pitched ≈ 10° up so the horizon sits at ≈ 70 %
  photoA:    { label: 'Block A street', key: '8', cam: [68, 47.5, 1.6], target: [41.4, 61.35, 6.85], fov: 47, group: 'street', note: 'Photo match ≈ WA0011' },
  // passage (no button; __app.setView('passage')): WA0003 framing from the lane, looking S under the basic roof at the stack
  passage:   { label: 'Burner passage', cam: [20.6, 49.3, 1.6], target: [21, 20, 10], fov: 62, group: 'street', note: 'Photo match ≈ WA0003' },
  drone:     { label: 'Drone orbit', key: '9', cam: [82, -48, 52], target: [20, 33, 3], fov: 40, group: 'main', drone: true },
  // elevations: `span` = [width, height] in metres of what must fit the VISIBLE area (window minus panel/sheet);
  // the ground line is placed `ground` (fraction of the visible height) above the bottom edge (clear of the view bar)
  elevN:     { label: 'N', ortho: true, dir: [0, 1, 0], target: [22, 34, 14], halfH: 19, span: [52, 32], ground: 0.15, clip: 36, group: 'elev', title: 'North elevation' },
  elevS:     { label: 'S', ortho: true, dir: [0, -1, 0], target: [22, 34, 14], halfH: 19, span: [52, 32], ground: 0.15, clip: 38, group: 'elev', title: 'South elevation' },
  // E/W: the whole compound depth (y −2 … 71 incl. Block A) plus the 31 m chimney
  elevE:     { label: 'E', ortho: true, dir: [1, 0, 0], target: [20, 34.6, 13], halfH: 24, span: [78, 32], ground: 0.15, clip: 23, group: 'elev', title: 'East elevation' },
  elevW:     { label: 'W', ortho: true, dir: [-1, 0, 0], target: [20, 34.6, 13], halfH: 24, span: [78, 32], ground: 0.15, clip: 24, group: 'elev', title: 'West elevation' },
};

export class CameraRig {
  constructor(domElement) {
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.3, 9000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, ORTHO_FAR);
    this.persp.position.set(80, 50, 30);
    this.camera = this.persp;
    this.mode = 'persp';
    this.fov = 40; // fov used for ortho-equivalent distance
    this.w = 1; this.h = 1; this.offsetPx = 0;
    this.listeners = new Set();

    const c = new OrbitControls(this.persp, domElement);
    c.enableDamping = true; c.dampingFactor = 0.085;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.minDistance = 2.5; c.maxDistance = 1400;
    c.minZoom = 0.25; c.maxZoom = 60;
    c.maxPolarAngle = Math.PI / 2 + 0.28; // street views look slightly up; ground clamp prevents going under
    c.rotateSpeed = 0.7; c.panSpeed = 0.9; c.zoomSpeed = 1.0;
    c.autoRotateSpeed = 0.9;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls = c;
    this.anim = null;
    this.currentView = null;
    c.addEventListener('start', () => {
      this.cancelAnim();
      if (c.autoRotate) { c.autoRotate = false; this._emit('drone', false); }
      if (this.ortho.near !== 1 || this.ortho.far !== ORTHO_FAR) { this.ortho.near = 1; this.ortho.far = ORTHO_FAR; this.ortho.updateProjectionMatrix(); }
      this.currentView = null; this._emit('view', null);
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(type, v) { for (const fn of this.listeners) fn(type, v); }

  /** offsetPx: width covered by the side panel (right); offsetY: height covered by the phone sheet (bottom). */
  setSize(w, h, offsetPx = this.offsetPx, offsetY = this.offsetY || 0) {
    this.w = w; this.h = h; this.offsetPx = offsetPx; this.offsetY = offsetY;
    this.updateProjection();
  }

  /** Virtual full frame: the visible area (w-off)×(h-offY) is centred in a (w+off)×(h+offY) frustum. */
  updateProjection() {
    const w = this.w, h = this.h, off = Math.max(0, Math.round(this.offsetPx)), offY = Math.max(0, Math.round(this.offsetY || 0));
    const fullW = w + off, fullH = h + offY;
    const aspect = fullW / fullH;
    const p = this.persp;
    p.aspect = aspect;
    if (off > 0 || offY > 0) p.setViewOffset(fullW, fullH, off, offY, w, h); else p.clearViewOffset();
    p.updateProjectionMatrix();
    const o = this.ortho;
    o.left = -ORTHO_H0 * aspect; o.right = ORTHO_H0 * aspect; o.top = ORTHO_H0; o.bottom = -ORTHO_H0;
    if (off > 0 || offY > 0) o.setViewOffset(fullW, fullH, off, offY, w, h); else o.clearViewOffset();
    o.updateProjectionMatrix();
  }

  /**
   * How much farther a preset must stand back so its content (composed for a 16:10 window) still
   * fits the visible area (window minus side panel / bottom sheet). 1 on a normal desktop.
   */
  fitFactor(street = false) {
    const off = Math.max(0, this.offsetPx || 0), offY = Math.max(0, this.offsetY || 0);
    const fullH = this.h + offY;
    const visW = Math.max(1, this.w - off), visH = Math.max(1, this.h - offY);
    // content spans ≈1.2 frame-heights wide and ≈0.8 high (in units of the full-frustum height)
    const f = Math.max(1, 1.2 * fullH / visW, 0.8 * fullH / visH);
    return street ? Math.min(1.6, Math.sqrt(f)) : Math.min(3.4, f);
  }

  /** Metres per CSS pixel at the target (ortho exact; persp at target distance). */
  metresPerPixel() {
    if (this.mode === 'ortho') return (2 * ORTHO_H0 / this.ortho.zoom) / this.h;
    const d = this.camera.position.distanceTo(this.controls.target);
    return (2 * d * Math.tan(this.persp.fov * DEG / 2)) / this.h;
  }

  getState() {
    const t = this.controls.target.clone();
    const off = this.camera.position.clone().sub(t);
    const s = new THREE.Spherical().setFromVector3(off);
    const fov = this.mode === 'persp' ? this.persp.fov : this.fov;
    const dist = this.mode === 'persp' ? s.radius : (ORTHO_H0 / this.ortho.zoom) / Math.tan(fov * DEG / 2);
    return { target: t, theta: s.theta, phi: s.phi, dist, fov };
  }

  applyState(st) {
    const cam = this.camera;
    const dir = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, Math.max(1e-4, st.phi), st.theta));
    this.controls.target.copy(st.target);
    if (this.mode === 'persp') {
      if (Math.abs(this.persp.fov - st.fov) > 1e-3) { this.persp.fov = st.fov; this.persp.updateProjectionMatrix(); }
      cam.position.copy(st.target).addScaledVector(dir, st.dist);
    } else {
      this.fov = st.fov;
      cam.position.copy(st.target).addScaledVector(dir, ORTHO_STANDOFF);
      this.ortho.zoom = ORTHO_H0 / (st.dist * Math.tan(st.fov * DEG / 2));
      this.ortho.updateProjectionMatrix();
    }
    cam.lookAt(st.target);
  }

  /** Switch projection, keeping the view direction & framing. */
  setMode(mode) {
    if (mode === this.mode) return;
    const st = this.getState();
    this.mode = mode;
    this.camera = mode === 'ortho' ? this.ortho : this.persp;
    if (mode === 'persp') {
      // From a straight-down plan view, tilt a touch so orbiting feels natural
      st.fov = this.fov;
    }
    if (mode === 'ortho') { this.ortho.near = 1; this.ortho.far = ORTHO_FAR; this.ortho.updateProjectionMatrix(); }
    this.controls.object = this.camera;
    this.applyState(st);
    this.controls.update();
    this._emit('mode', mode);
  }

  viewState(name) {
    const v = VIEWS[name]; if (!v) return null;
    const target = P(v.target);
    const fov = v.fov || 40;
    let dir, dist;
    if (v.ortho) {
      if (v.plan) dir = new THREE.Vector3(0, 1, 0.0001).normalize();
      else dir = P(v.dir).normalize();
      if (v.span) {
        // fit [width, height] into the visible area exactly (ortho half-height is of the full frustum)
        const off = Math.max(0, this.offsetPx || 0), offY = Math.max(0, this.offsetY || 0);
        const fullH = this.h + offY;
        const visW = Math.max(1, this.w - off), visH = Math.max(1, this.h - offY);
        const g = v.ground || 0.15;
        const halfH = Math.max(1.06 * v.span[0] * fullH / (2 * visW), (v.span[1] * 1.08 / (1 - g)) * fullH / (2 * visH));
        dist = halfH / Math.tan(fov * DEG / 2);
        // vertical: ground line g·visibleHeight above the bottom of the visible area
        const hv = halfH * visH / fullH;
        target.y = hv * (1 - 2 * g);
      } else {
        dist = v.halfH / Math.tan(fov * DEG / 2);
        // the halfH is for a 16:10 screen; narrower visible areas (portrait, panel open) widen
        dist *= this.fitFactor(false);
      }
    } else {
      const off = P(v.cam).sub(target);
      dist = off.length(); dir = off.normalize();
      dist *= this.fitFactor(v.group === 'street');
    }
    const s = new THREE.Spherical().setFromVector3(dir);
    return { target, theta: s.theta, phi: Math.max(1e-4, s.phi), dist, fov, ortho: !!v.ortho, clip: v.clip || 0, drone: !!v.drone };
  }

  cancelAnim() {
    if (this.anim) { const a = this.anim; this.anim = null; this.controls.enabled = true; a.resolve && a.resolve(false); }
  }

  /** Animate to a preset view. Returns a Promise resolved when arrived. */
  flyTo(name, { duration = 1.2, instant = false } = {}) {
    const v = VIEWS[name];
    const to = this.viewState(name);
    if (!to) return Promise.resolve(false);
    this.cancelAnim();
    if (this.controls.autoRotate && !to.drone) { this.controls.autoRotate = false; this._emit('drone', false); }
    this.setMode(to.ortho ? 'ortho' : 'persp');
    this.currentView = name; this._emit('view', name);
    const from = this.getState();
    if (this.mode === 'ortho') {
      this.ortho.near = to.clip ? Math.max(1, ORTHO_STANDOFF - to.clip) : 1;
      this.ortho.far = to.clip ? ORTHO_STANDOFF + ELEV_DEPTH : ORTHO_FAR;
      this.ortho.updateProjectionMatrix();
    }
    // shortest theta path
    let dTheta = to.theta - from.theta;
    while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    while (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    // plan view: theta is irrelevant at phi≈0 — force north-up (theta 0)
    if (v.plan) dTheta = -from.theta + Math.round(from.theta / (2 * Math.PI)) * 2 * Math.PI;
    return new Promise((resolve) => {
      const a = { from, to, dTheta, t: 0, duration: instant ? 0 : duration, resolve, drone: to.drone };
      this.anim = a;
      this.controls.enabled = false;
      if (instant) this._step(1e9);
    });
  }

  _step(dt) {
    const a = this.anim; if (!a) return;
    a.t = a.duration > 0 ? Math.min(1, a.t + dt / a.duration) : 1;
    const k = easeInOut(a.t);
    const f = a.from, t = a.to;
    // arc the camera up a little during long moves for a nicer "flight"
    const st = {
      target: f.target.clone().lerp(t.target, k),
      theta: f.theta + a.dTheta * k,
      phi: f.phi + (t.phi - f.phi) * k,
      dist: Math.exp(Math.log(f.dist) + (Math.log(t.dist) - Math.log(f.dist)) * k),
      fov: f.fov + (t.fov - f.fov) * k,
    };
    this.applyState(st);
    if (a.t >= 1) {
      this.anim = null;
      this.controls.enabled = true;
      this.controls.update();
      if (a.drone) { this.controls.autoRotate = true; this._emit('drone', true); }
      a.resolve(true);
    }
  }

  stopDrone() { if (this.controls.autoRotate) { this.controls.autoRotate = false; this._emit('drone', false); } }

  /** Fly to an arbitrary point (e.g. a module), looking from the current direction. */
  focusOn(worldPoint, dist = 14, { duration = 1.0 } = {}) {
    this.cancelAnim();
    this.stopDrone();
    if (this.mode === 'ortho' && this.camera.position.clone().sub(this.controls.target).normalize().y < 0.95) this.setMode('persp');
    const from = this.getState();
    const to = { ...from, target: worldPoint.clone(), dist, phi: Math.min(from.phi, 1.05) };
    this.currentView = null; this._emit('view', null);
    return new Promise((resolve) => {
      this.anim = { from, to, dTheta: 0, t: 0, duration, resolve };
      this.controls.enabled = false;
    });
  }

  /** Returns true while the camera is moving. */
  update(dt) {
    let moving = false;
    if (this.anim) { this._step(dt); moving = true; } else moving = this.controls.update(dt);
    // never go below ground
    const cam = this.camera;
    if (cam.position.y < 0.45) { cam.position.y = 0.45; cam.lookAt(this.controls.target); }
    if (this.controls.target.y < -2) this.controls.target.y = -2;
    // keep the target near the site
    const t = this.controls.target;
    const R = 600;
    if (Math.abs(t.x - 20) > R || Math.abs(t.z + 30) > R) { t.x = THREE.MathUtils.clamp(t.x, 20 - R, 20 + R); t.z = THREE.MathUtils.clamp(t.z, -30 - R, -30 + R); }
    return moving || this.controls.autoRotate;
  }

  /** Heading of the view (deg clockwise from north) for the compass. */
  heading() {
    const e = this.camera.matrixWorld.elements;
    const fwd = new THREE.Vector3(-e[8], -e[9], -e[10]);
    const up = new THREE.Vector3(e[4], e[5], e[6]);
    const g = Math.abs(fwd.y) < 0.97 ? fwd : up;
    return Math.atan2(g.x, -g.z) / DEG;
  }
}
