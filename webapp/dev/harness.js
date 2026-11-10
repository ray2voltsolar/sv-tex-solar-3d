// ============================================================================
//  DEV HARNESS — preview ONE builder module (or several) in isolation.
//  URL:  dev/preview.html?mods=buildings,solar&cam=60,-20,40&target=20,30,4&t=2026-12-21T09:30
//    mods   : comma list of keys in REGISTRY (default: buildings)
//    cam    : camera position in PLAN coords x(east),y(north),z(up)
//    target : orbit target in PLAN coords
//    t      : local IST time for the sun (ISO-like, no zone)
//    fov    : camera fov (default 45)
//    ortho  : 1 = top-down orthographic
//  Exposes window.__ready = true after the first frames render,
//  window.__errors = [] collected errors, window.__harness = { THREE, scene, camera, renderer, results, setCam }.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import * as site from '../js/site-data.js';
import { getSunPosition, dateFromLocal, sunVectorWorld } from '../js/analysis/sun.js';

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && (e.reason.stack || e.reason))));

const REGISTRY = {
  buildings:   { path: '../js/buildings/index.js', fn: 'buildBuildings' },
  solar:       { path: '../js/solar/index.js', fn: 'buildSolar' },
  environment: { path: '../js/env/index.js', fn: 'buildEnvironment' },
  structures:  { path: '../js/structures/index.js', fn: 'buildStructures' },
  sunpath:     { path: '../js/analysis/sunpath.js', fn: 'createSunPath' },
};

const q = new URLSearchParams(location.search);
const info = document.getElementById('info');
const P = (s, d) => (s ? s.split(',').map(Number) : d);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const ortho = q.get('ortho') === '1';
const aspect = innerWidth / innerHeight;
const camera = ortho
  ? new THREE.OrthographicCamera(-60 * aspect, 60 * aspect, 60, -60, 0.1, 2000)
  : new THREE.PerspectiveCamera(+(q.get('fov') || 45), aspect, 0.1, 3000);
const camP = P(q.get('cam'), ortho ? [20, 34, 200] : [70, -25, 45]);
const tgtP = P(q.get('target'), [20, 30, 3]);
function setCam(c, t) {
  camera.position.set(c[0], c[2], -c[1]);
  controls.target.set(t[0], t[2], -t[1]);
  if (ortho) camera.up.set(0, 0, -1);
  controls.update();
}
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
setCam(camP, tgtP);

// --- simple sky + sun (the real app does this better; enough for previews)
const sky = new Sky(); sky.scale.setScalar(4000); scene.add(sky);
const su = sky.material.uniforms;
su.turbidity.value = 6; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
const tStr = q.get('t') || '2026-12-21T10:30';
const [dPart, tPart] = tStr.split('T');
const [Y, M, D] = dPart.split('-').map(Number); const [h, mi] = (tPart || '10:30').split(':').map(Number);
const sp = getSunPosition(dateFromLocal(Y, M, D, h, mi), site.SITE.lat, site.SITE.lng);
const sv = new THREE.Vector3(...sunVectorWorld(sp.azimuth, Math.max(sp.elevation, 2)));
su.sunPosition.value.copy(sv);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(sky).texture; // sky-only env for reflections

const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.position.copy(sv).multiplyScalar(150).add(new THREE.Vector3(20, 0, -30));
sun.target.position.set(20, 0, -30);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 400 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x8a7a62, 0.6));

// fallback ground only if no environment module is loaded
const mods = (q.get('mods') || 'buildings').split(',').filter(Boolean);
if (!mods.includes('environment')) {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x9c8f7a, roughness: 1 }));
  g.rotation.x = -Math.PI / 2; g.position.set(20, -0.01, -30); g.receiveShadow = true; scene.add(g);
  const grid = new THREE.GridHelper(200, 20, 0x444444, 0x666666); grid.position.set(20, 0.005, -30); scene.add(grid);
  const axes = new THREE.AxesHelper(5); scene.add(axes); // red=+X east, blue=+Z south
}

const animated = [];
const occluders = [];
const ctx = {
  THREE, scene, renderer, camera, site,
  quality: q.get('quality') || 'high',
  maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  registerOccluder: (m) => occluders.push(m),
  registerAnimated: (fn) => animated.push(fn),
  sunState: { azimuth: sp.azimuth, elevation: sp.elevation, dirWorld: sv.clone(), date: dateFromLocal(Y, M, D, h, mi) },
  onSunChange: (fn) => sunSubs.push(fn), // harness sun is static; subscribers are called once after build
};
const sunSubs = [];

const results = {};
(async () => {
  for (const key of mods) {
    const r = REGISTRY[key];
    if (!r) { window.__errors.push('unknown mod ' + key); continue; }
    try {
      const t0 = performance.now();
      const mod = await import(r.path);
      const res = await mod[r.fn](ctx);
      if (res && res.group) scene.add(res.group);
      results[key] = res;
      console.log(`[harness] ${key} built in ${(performance.now() - t0).toFixed(0)} ms`);
    } catch (e) {
      console.error(e); window.__errors.push(`${key}: ${e.stack || e}`);
    }
  }
  if (results.sunpath && results.sunpath.update) results.sunpath.update(ctx.sunState.date);
  for (const fn of sunSubs) { try { fn(ctx.sunState); } catch (e) { window.__errors.push('onSunChange: ' + (e.stack || e)); } }
  let tris = 0; scene.traverse((o) => { if (o.isMesh && o.geometry.index) tris += o.geometry.index.count / 3 * (o.isInstancedMesh ? o.count : 1); });
  info.textContent = `mods: ${mods.join(', ')}\nsun az ${sp.azimuth.toFixed(1)}° el ${sp.elevation.toFixed(1)}°  (${tStr} IST)\n~${(tris / 1e6).toFixed(2)} M tris, occluders ${occluders.length}` +
    (window.__errors.length ? `\nERRORS:\n${window.__errors.join('\n')}` : '');
  if (q.get('noinfo') === '1') info.style.display = 'none';
  let frames = 0;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    for (const fn of animated) fn(dt, clock.elapsedTime);
    controls.update();
    renderer.render(scene, camera);
    if (++frames === 4) window.__ready = true;
  });
})();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  if (camera.isPerspectiveCamera) { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
});
window.__harness = { THREE, scene, camera, renderer, results, setCam, controls, ctx };
