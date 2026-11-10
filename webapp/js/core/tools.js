// ============================================================================
//  Interaction tools: picking helpers, distance measurement, 2× screenshot.
// ============================================================================
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { feetInches } from './format.js';

/** Collect pickable meshes under `root` (skips sky, overlays, invisible). */
export function raycastScene(raycaster, roots) {
  const hits = [];
  const list = Array.isArray(roots) ? roots : [roots];
  for (const r of list) {
    if (!r || !r.visible) continue;
    collect(r);
  }
  function collect(o) {
    if (!o.visible || o.userData.noPick) return;
    if ((o.isMesh || o.isInstancedMesh) && o.material) {
      const m = o.material;
      if (!(m.depthTest === false) && !(m.opacity !== undefined && m.transparent && m.opacity < 0.15)) {
        o.raycast(raycaster, hits);
      }
    }
    for (const c of o.children) collect(c);
  }
  hits.sort((a, b) => a.distance - b.distance);
  return hits;
}

export class MeasureTool {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'measure'; this.group.userData.noPick = true;
    scene.add(this.group);
    this.active = false;
    this.pending = null; // first point
    this.items = [];
    this.dotGeo = new THREE.SphereGeometry(0.09, 16, 12);
    this.dotMat = new THREE.MeshBasicMaterial({ color: 0xffc233, depthTest: false, transparent: true, fog: false });
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xffc233, depthTest: false, transparent: true, fog: false });
    this.ghostMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.3, gapSize: 0.2, depthTest: false, transparent: true, opacity: 0.8, fog: false });
    this.ghost = null;
  }

  _dot(p) {
    const d = new THREE.Mesh(this.dotGeo, this.dotMat);
    d.position.copy(p); d.renderOrder = 999; d.userData.noPick = true; d.userData.noAO = true;
    this.group.add(d);
    return d;
  }

  /** Add a picked point. Returns the finished measurement or null. */
  addPoint(p) {
    if (!this.pending) {
      this.pending = { p: p.clone(), dot: this._dot(p) };
      return null;
    }
    const a = this.pending.p, b = p.clone();
    const dot2 = this._dot(b);
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, this.lineMat); line.renderOrder = 998; line.userData.noPick = true;
    this.group.add(line);
    const dist = a.distanceTo(b);
    const dh = Math.abs(b.y - a.y);
    const el = document.createElement('div');
    el.className = 'measure-lbl';
    el.innerHTML = `<b>${dist.toFixed(2)} m</b><span>${feetInches(dist)}${dh > 0.2 ? ` · Δh ${dh.toFixed(2)} m` : ''}</span>`;
    const lbl = new CSS2DObject(el);
    lbl.position.copy(a).add(b).multiplyScalar(0.5);
    this.group.add(lbl);
    this.items.push({ a, b, dist, objs: [this.pending.dot, dot2, line, lbl] });
    this.pending = null;
    this.clearGhost();
    return { a, b, dist };
  }

  updateGhost(p) {
    if (!this.pending || !p) { this.clearGhost(); return; }
    if (!this.ghost) {
      this.ghost = new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.pending.p, p]), this.ghostMat);
      this.ghost.renderOrder = 997; this.ghost.userData.noPick = true;
      this.group.add(this.ghost);
    } else {
      this.ghost.geometry.setFromPoints([this.pending.p, p]);
    }
    this.ghost.computeLineDistances();
  }

  clearGhost() { if (this.ghost) { this.group.remove(this.ghost); this.ghost.geometry.dispose(); this.ghost = null; } }

  cancelPending() {
    if (this.pending) { this.group.remove(this.pending.dot); this.pending = null; }
    this.clearGhost();
  }

  clear() {
    this.cancelPending();
    for (const it of this.items) for (const o of it.objs) {
      this.group.remove(o);
      if (o.isLine) o.geometry.dispose();
      if (o.isCSS2DObject && o.element.parentNode) o.element.parentNode.removeChild(o.element);
    }
    this.items = [];
  }
}

/**
 * Render a high-resolution PNG (2× the CSS size, capped at ≈10 MP) with labels and a branded caption, then trigger
 * a browser download (called from a user click).
 */
export async function takeScreenshot({ renderer, post, rig, labelObjs, caption, filename }) {
  const w = post.width, h = post.height, pr0 = post.pixelRatio;
  // Target 2× the CSS size, but cap the total: the post chain (GTAO, bloom mips, SMAA, half-float
  // targets) needs ~100 B/px, so a 33 Mpx retina request would need >3 GB of GPU memory.
  const maxDim = Math.min(renderer.capabilities.maxTextureSize || 8192, 6144);
  const MAX_PX = 10.5e6; // ≈ 4320×2430
  let pr = Math.max(1, Math.min(2, maxDim / Math.max(w, h), Math.sqrt(MAX_PX / (w * h))));
  const out = document.createElement('canvas');
  let g = null, W = 0, H = 0;
  const grab = (ratio) => {
    post.setSize(w, h, ratio);
    rig.updateProjection();
    post.render(0);
    const gl = renderer.getContext();
    if (gl.isContextLost && gl.isContextLost()) throw new Error('WebGL context lost');
    const src = renderer.domElement;
    W = src.width; H = src.height;
    out.width = W; out.height = H;
    g = out.getContext('2d');
    g.drawImage(src, 0, 0);
  };
  try { grab(pr); } catch (e) {
    console.warn('[screenshot] high-res render failed, retrying at screen resolution', e);
    pr = pr0;
    try { grab(pr); } catch (e2) { post.setSize(w, h, pr0); rig.updateProjection(); throw e2; }
  } finally {
    // restore
    post.setSize(w, h, pr0);
    rig.updateProjection();
  }
  const k = W / w; // css px → output px

  // labels
  const cam = rig.camera;
  const v = new THREE.Vector3();
  g.textBaseline = 'middle';
  for (const o of labelObjs) {
    if (!o.visible || !o.parent || !o.parent.visible) continue;
    o.getWorldPosition(v); v.project(cam);
    if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
    const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    const txt = o.element.querySelector('.lbl-txt');
    if (!txt) continue;
    const main = txt.childNodes[0] ? txt.childNodes[0].textContent : '';
    const sub = txt.querySelector('.lbl-sub') ? txt.querySelector('.lbl-sub').textContent : '';
    g.font = `600 ${Math.round(13 * k)}px "Segoe UI", system-ui, sans-serif`;
    const w1 = g.measureText(main).width;
    g.font = `${Math.round(11 * k)}px "Segoe UI", system-ui, sans-serif`;
    const w2 = sub ? g.measureText(sub).width : 0;
    const bw = Math.max(w1, w2) + 22 * k, bh = (sub ? 38 : 24) * k;
    const bx = x - bw / 2, by = y - bh - 8 * k;
    g.fillStyle = 'rgba(14,20,28,0.78)';
    roundRect(g, bx, by, bw, bh, 7 * k); g.fill();
    g.fillStyle = '#ffc233';
    g.beginPath(); g.arc(x, y - 4 * k, 3 * k, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.font = `600 ${Math.round(13 * k)}px "Segoe UI", system-ui, sans-serif`;
    g.fillText(main, bx + 11 * k, by + (sub ? 13 : 12) * k);
    if (sub) { g.fillStyle = '#ffd77a'; g.font = `${Math.round(11 * k)}px "Segoe UI", system-ui, sans-serif`; g.fillText(sub, bx + 11 * k, by + 28 * k); }
  }

  // caption bar
  const ch = 44 * k;
  const grd = g.createLinearGradient(0, H - ch * 1.6, 0, H);
  grd.addColorStop(0, 'rgba(10,14,20,0)'); grd.addColorStop(1, 'rgba(10,14,20,0.78)');
  g.fillStyle = grd; g.fillRect(0, H - ch * 1.6, W, ch * 1.6);
  g.fillStyle = '#fff';
  g.font = `600 ${Math.round(15 * k)}px "Segoe UI", system-ui, sans-serif`;
  g.fillText(caption.left, 18 * k, H - ch / 2);
  g.textAlign = 'right';
  g.font = `${Math.round(13 * k)}px "Segoe UI", system-ui, sans-serif`;
  g.fillStyle = '#ffd77a';
  g.fillText(caption.right, W - 18 * k, H - ch / 2);
  g.textAlign = 'left';

  let blob = await new Promise((res) => out.toBlob(res, 'image/png'));
  if (!blob) { // encoder ran out of memory → fall back to half size
    const half = document.createElement('canvas');
    half.width = Math.round(W / 2); half.height = Math.round(H / 2);
    half.getContext('2d').drawImage(out, 0, 0, half.width, half.height);
    blob = await new Promise((res) => half.toBlob(res, 'image/png'));
    W = half.width; H = half.height;
  }
  if (!blob) throw new Error('Could not encode PNG');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { width: W, height: H };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
