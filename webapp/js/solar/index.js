// ============================================================================
//  SOLAR SYSTEM builder — 234 × Vikram Solar HYPERSOL G12R 620 Wp on Blocks A, C, D
//  Entry: buildSolar(ctx) → { group, modules, moduleMesh, setColorMode, setVisible,
//                             highlight, pick, info }
//  Everything instanced / merged; all textures procedural.
// ============================================================================
import { laminateGeometry, frameGeometry, backDetailGeometry, railGeometry, midClampGeometry, endClampGeometry } from './module.js';
import { makeCellTexture, makeBackTexture, rng } from './textures.js';
import { W, WD, planeMatrix } from './geom.js';
import { buildBOS } from './bos.js';
import { buildInverterStation } from './inverter.js';

export async function buildSolar(ctx) {
  const { THREE, site } = ctx;
  const Q = ctx.quality || 'high';
  const MOD = site.MODULE, MNT = site.MOUNTING;
  const modules = site.computeLayout();
  const N = modules.length;
  const group = new THREE.Group(); group.name = 'solar';
  const aniso = Math.min(ctx.maxAnisotropy || 1, 16);

  // ---------------------------------------------------------------- materials
  const texH = Q === 'high' ? 2048 : Q === 'medium' ? 1024 : 512;
  const cellMap = makeCellTexture(texH, aniso);
  const backMap = makeBackTexture(Math.max(256, texH / 4), aniso);

  const glassMat = new THREE.MeshPhysicalMaterial({
    name: 'pv-glass', map: cellMap, color: 0xffffff, roughness: 0.32, metalness: 0.0,
    // base layer = AR-coated front glass (soft sheen of the sky), clearcoat = the glass reflection.
    // clearcoatRoughness 0.07 (not mirror-sharp): real 3.2 mm tempered/AR glass + slight bow gives a graded
    // sun glint spread over several modules instead of single saturated "silver tiles".
    clearcoat: 1.0, clearcoatRoughness: 0.07, envMapIntensity: 1.8, specularIntensity: 0.8,
    ior: 1.5,
  });
  const uEmis = { value: 0 };
  // uFar: far-field sky sheen boost (0 in colour modes so string / heat colours stay saturated)
  const uFar = { value: 1 };
  glassMat.onBeforeCompile = (sh) => {
    sh.uniforms.uEmis = uEmis; sh.uniforms.uFar = uFar;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aTint;
attribute vec4 aVar;
varying vec4 vTint;
varying vec2 vVar;
varying vec3 vPvU;
varying vec3 vPvV;`)
      // per-module mounting tolerance: ±0.2° tilt scatter → module-to-module reflection variation (as in drone photos)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = normalize(objectNormal + vec3(aVar.z, 0.0, aVar.w) * objectNormal.y);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTint = aTint; vVar = aVar.xy;
        // module in-plane axes in view space (for the glass-bow normal perturbation in the fragment shader)
        vPvU = normalize((modelViewMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vPvV = normalize((modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vTint;
varying vec2 vVar;
varying vec3 vPvU;
varying vec3 vPvV;
uniform float uEmis;
uniform float uFar;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // cell mask (1 on the dark cells, 0 on the light inter-cell gaps / ribbons) from the albedo
        float pvCell = 1.0 - smoothstep(0.03, 0.09, dot(diffuseColor.rgb, vec3(0.3333)));
        // distance → far-field factor (overview / drone distances)
        float pvDist = length(vViewPosition);
        float pvFarK = smoothstep(30.0, 110.0, pvDist);
        // soiling: light dust film + heavier band along the lower (eave-side) frame edge
        float pvEdge = smoothstep(0.035, 0.008, vMapUv.y) + 0.3 * smoothstep(0.02, 0.005, min(vMapUv.x, 1.0 - vMapUv.x));
        float pvDust = clamp(vVar.x * (0.12 + 0.8 * pvEdge), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.21, 0.15), pvDust * 0.38);
        diffuseColor.rgb *= vVar.y;
        // far field: mipmapped cells average out very dark; real arrays seen from a drone read as a mid navy
        // (cell AR-coating blue + EVA + light scatter), so lift towards that as the texture detail disappears
        diffuseColor.rgb = mix(diffuseColor.rgb, max(diffuseColor.rgb, vec3(0.020, 0.034, 0.075)), pvFarK * uFar);
        // frame-line LOD: the 12.5 mm silver lip + 20 mm gap become sub-pixel at distance and vanish from the
        // rasterised frame mesh; add their analytic pixel coverage at the glass border so the grid survives
        vec2 pvFw = max(fwidth(vMapUv), vec2(1e-6));
        vec2 pvD = min(vMapUv, 1.0 - vMapUv);
        vec2 pvBw = vec2(0.022 / 1.130, 0.022 / 2.380);                 // effective lip + glint width (m / glass size)
        vec2 pvCov = clamp(pvBw / pvFw, 0.0, 1.0) * (1.0 - smoothstep(0.5, 1.5, pvD / pvFw)) * smoothstep(0.4, 1.6, pvFw / pvBw);
        float pvFrame = max(pvCov.x, pvCov.y) * uFar;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.52, 0.54), pvFrame * 0.9);
        float pvLum = dot(diffuseColor.rgb, vec3(0.3333));
        diffuseColor.rgb = mix(diffuseColor.rgb, vTint.rgb * (0.80 + 1.2 * pvLum), vTint.w);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.85, pvDust * 0.6);`)
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
        // glass-glass laminate bow (~±0.35° at the edges) + mild cell-level waviness: the reflection of the sky /
        // sun sweeps across a module instead of lighting the whole module uniformly
        {
          vec2 pvC = vMapUv - 0.5;
          clearcoatNormal = normalize(clearcoatNormal + (vPvU * pvC.x * 2.0 + vPvV * pvC.y * 2.0) * 0.006
            + (vPvU * sin(vMapUv.y * 138.0) + vPvV * sin(vMapUv.x * 37.7)) * 0.0012);
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        // reflection modulated by the cell structure (texture shows through the glint), reduced on dust and frame
        material.clearcoat *= (1.0 - 0.4 * pvDust) * (1.0 - 0.3 * pvCell * (1.0 - pvFarK)) * (1.0 - 0.6 * pvFrame) * mix(1.0, 0.35, vTint.w);
        material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.35, pvDust * 0.5);`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        #if defined( USE_CLEARCOAT ) && defined( USE_ENVMAP )
          // far field: Fresnel sky sheen (drone photos show arrays as blue-grey sky mirrors, not black slabs)
          clearcoatRadiance *= 1.0 + 1.4 * pvFarK * uFar;
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vTint.rgb * vTint.w * uEmis;`);
  };
  glassMat.customProgramCacheKey = () => 'pv-glass-v3';
  const backMat = new THREE.MeshStandardMaterial({ name: 'pv-back', map: backMap, roughness: 0.35, metalness: 0.0 });
  const frameMat = new THREE.MeshStandardMaterial({ name: 'pv-frame', color: new THREE.Color(MOD.frame.color), metalness: 0.8, roughness: 0.38, envMapIntensity: 0.85 });
  const blackMat = new THREE.MeshStandardMaterial({ name: 'pv-black', color: 0x141414, roughness: 0.6, metalness: 0.0 });
  const railMat = new THREE.MeshStandardMaterial({ name: 'pv-rail', color: 0xb6b9bb, metalness: 0.8, roughness: 0.45 });
  const rubberMat = new THREE.MeshStandardMaterial({ name: 'pv-epdm', color: 0x2a2a2a, roughness: 0.9 });
  const steelMat = new THREE.MeshStandardMaterial({ name: 'pv-ss', color: 0xc4c6c8, metalness: 0.75, roughness: 0.5 });

  // ---------------------------------------------------------------- modules
  const lamGeo = laminateGeometry(MOD);
  const aTint = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  const R = rng(42);
  const varArr = new Float32Array(N * 4);
  const tilt = 0.0035; // rad (≈0.2°)
  for (let i = 0; i < N; i++) {
    varArr[i * 4] = 0.35 + R() * 0.45; varArr[i * 4 + 1] = 0.93 + R() * 0.12;
    varArr[i * 4 + 2] = (R() - 0.5) * 2 * tilt; varArr[i * 4 + 3] = (R() - 0.5) * 2 * tilt;
  }
  const aVar = new THREE.InstancedBufferAttribute(varArr, 4);
  lamGeo.setAttribute('aTint', aTint); lamGeo.setAttribute('aVar', aVar);

  const moduleMesh = new THREE.InstancedMesh(lamGeo, [glassMat, backMat], N);
  moduleMesh.name = 'pv-modules';
  const frameMesh = new THREE.InstancedMesh(frameGeometry(MOD), frameMat, N); frameMesh.name = 'pv-frames';
  const backMesh = Q === 'low' ? null : new THREE.InstancedMesh(backDetailGeometry(MOD, Q), blackMat, N);

  const mtx = new THREE.Matrix4();
  modules.forEach((m, i) => {
    const U = WD(m.u), Nn = WD(m.n), V = WD(m.v).negate();
    mtx.makeBasis(U, Nn, V).setPosition(W(m.center));
    moduleMesh.setMatrixAt(i, mtx); frameMesh.setMatrixAt(i, mtx); if (backMesh) backMesh.setMatrixAt(i, mtx);
    m.index = i;
  });
  for (const im of [moduleMesh, frameMesh, backMesh]) {
    if (!im) continue;
    im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingBox(); im.computeBoundingSphere();
    group.add(im);
  }
  if (backMesh) { backMesh.castShadow = false; backMesh.name = 'pv-junction-boxes'; }
  ctx.registerOccluder && ctx.registerOccluder(moduleMesh);

  // ---------------------------------------------------------------- contact shadow / AO under the arrays
  // The 80 mm stand-off is far below shadow-map resolution, so the sheet under and just around each module
  // gets a soft multiply-blended AO decal (one instanced quad per module, extending AO_E beyond the frame).
  // Overlaps in the 20 mm gaps compound → gaps read dark like real arrays; perimeters fade out over AO_E.
  const AO_E = 0.22;
  const aoMesh = (() => {
    const tw = 64, th = 128, cw = MOD.width + 2 * AO_E, cl = MOD.length + 2 * AO_E;
    const data = new Uint8Array(tw * th * 4);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const pu = ((x + 0.5) / tw - 0.5) * cw, pv = ((y + 0.5) / th - 0.5) * cl;
      const du = Math.max(0, Math.abs(pu) - MOD.width / 2), dv = Math.max(0, Math.abs(pv) - MOD.length / 2);
      const d = Math.min(1, Math.hypot(du, dv) / AO_E);
      const inner = Math.min(1, Math.min(MOD.width / 2 - Math.abs(pu), MOD.length / 2 - Math.abs(pv)) / 0.12);
      const t = Math.pow(d, 0.8);                               // soft penumbra, darkest at the frame
      const core = 0.18 + 0.10 * Math.max(0, inner);            // deepest just under the frame edge
      const val = Math.round(255 * (core + (1 - core) * t));
      const o = (y * tw + x) * 4; data[o] = data[o + 1] = data[o + 2] = val; data[o + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, tw, th); tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true; tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      name: 'pv-contact-ao', map: tex, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true,
      depthWrite: false, toneMapped: false, fog: false,
    });
    // Depth bias in view space instead of glPolygonOffset: the offset's slope term (factor × depth slope per pixel)
    // grows with distance and view obliquity, and at overview range it pulled this sheet in front of the modules'
    // glass (~75 mm above it) on real GPUs with 24-bit depth → arrays rendered as flat black slabs. Pull by ~2 depth
    // steps (24-bit step ≈ 2e-7·z² m with near = 0.3 m), capped well below the glass; fade out beyond ~250 m.
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vAoFade;')
        .replace('#include <project_vertex>', `#include <project_vertex>
        {
          float aoZ = max(-mvPosition.z, 0.0);
          mvPosition.z += clamp(4e-7 * aoZ * aoZ, 0.004, 0.03);
          gl_Position = projectionMatrix * mvPosition;
          vAoFade = 1.0 - smoothstep(220.0, 320.0, aoZ);
        }`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAoFade;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(vec3(1.0), diffuseColor.rgb, vAoFade);');
    };
    mat.customProgramCacheKey = () => 'pv-contact-ao-v2';
    const geo = new THREE.PlaneGeometry(cw, cl).rotateX(-Math.PI / 2);   // local XZ, +Y = plane normal
    const im = new THREE.InstancedMesh(geo, mat, N); im.name = 'pv-contact-ao';
    modules.forEach((m, i) => im.setMatrixAt(i, planeMatrix(site, site.ROOF_PLANES[m.plane], m.uc, m.vc, 0.006)));
    im.instanceMatrix.needsUpdate = true; im.castShadow = false; im.receiveShadow = false; im.renderOrder = -1;
    im.computeBoundingSphere(); im.raycast = () => {};
    group.add(im); return im;
  })();

  // ---------------------------------------------------------------- mini-rails + clamps
  const rails = [], mids = [], ends = [];
  const byPlane = {};
  for (const m of modules) (byPlane[m.plane] ||= new Map()).set(`${m.row},${m.col}`, m);
  for (const [pid, map] of Object.entries(byPlane)) {
    const plane = site.ROOF_PLANES[pid];
    for (const m of map.values()) {
      const vs = [m.v0 + MOD.length * 0.25, m.v0 + MOD.length * 0.75];
      const left = map.get(`${m.row},${m.col - 1}`), right = map.get(`${m.row},${m.col + 1}`);
      for (const v of vs) {
        if (left) { const u = (left.u1 + m.u0) / 2; rails.push(planeMatrix(site, plane, u, v, 0)); mids.push(planeMatrix(site, plane, u, v, 0)); }
        else { rails.push(planeMatrix(site, plane, m.u0 - 0.012, v, 0)); ends.push(planeMatrix(site, plane, m.u0, v, 0, true)); }
        if (!right) { rails.push(planeMatrix(site, plane, m.u1 + 0.012, v, 0)); ends.push(planeMatrix(site, plane, m.u1, v, 0)); }
      }
    }
  }
  const mkInst = (geo, mat, list, name, shadow = true) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length); im.name = name;
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceMatrix.needsUpdate = true; im.castShadow = shadow; im.receiveShadow = true;
    im.computeBoundingSphere(); group.add(im); return im;
  };
  mkInst(railGeometry(MNT, Q), [railMat, rubberMat, steelMat], rails, 'pv-minirails');
  mkInst(midClampGeometry(), [railMat, steelMat], mids, 'pv-midclamps', Q === 'high');
  mkInst(endClampGeometry(), [railMat, steelMat], ends, 'pv-endclamps', Q === 'high');

  // ---------------------------------------------------------------- balance of system
  const bos = buildBOS(ctx, modules);
  group.add(bos.group);
  const inv = buildInverterStation(ctx);
  group.add(inv.group);

  // ---------------------------------------------------------------- strings overlay (outline + IDs)
  // Two hue families so the inverter grouping reads at a glance: INV-1 (S01–S06, Block A) warm, INV-2 (S07–S13,
  // Blocks D + C) cool; neighbouring strings on one slope differ by ≥ 25 ΔE. The legend (core/ui.js) reads
  // site.STRING_COLORS — requested to be updated to this same list; until then this local palette is used.
  const STR_PAL_LOCAL = ['#e6194b', '#ffe119', '#f58231', '#d6249f', '#ffb000', '#8c2d04',
    '#1f6fff', '#46e6f0', '#2fb84a', '#8a3ffc', '#b5f20c', '#00a091', '#2b3fb0'];
  const STR_PAL = (site.STRING_COLORS && site.STRING_COLORS.length >= 13 && site.STRING_COLORS[3] === '#d6249f') ? site.STRING_COLORS : STR_PAL_LOCAL;
  const LBL_K = 0.018, LBL_MIN = 0.8, LBL_MAX = 2.6;   // label half-width = clamp(depth·K, MIN, MAX) metres
  const stringsOverlay = buildStringsOverlay();
  function buildStringsOverlay() {
    const g = new THREE.Group(); g.name = 'pv-strings-overlay'; g.visible = false;
    const top = MNT.moduleUnderside + MOD.thickness + 0.006;
    const pos = [];
    const nb = (m, dr, dc) => {
      const o = byPlane[m.plane].get(`${m.row + dr},${m.col + dc}`);
      if (!o || o.stringIndex !== m.stringIndex) return false;
      return dr ? Math.abs(dr > 0 ? o.v0 - m.v1 : m.v0 - o.v1) < 0.05 : true;
    };
    const ins = 0.035, lw = 0.05;     // outline inset from the frame edge, line width (m)
    for (const m of modules) {
      const pl = site.ROOF_PLANES[m.plane];
      const P = (u, v) => W(site.planePoint(pl, u, v, top));
      const quad = (u0, v0, u1, v1) => { const a = P(u0, v0), b = P(u1, v0), c = P(u1, v1), d = P(u0, v1); pos.push(a, b, c, a, c, d); };
      const U0 = m.u0 + ins, U1 = m.u1 - ins, V0 = m.v0 + ins, V1 = m.v1 - ins;
      const L = nb(m, 0, -1), R_ = nb(m, 0, 1), D = nb(m, -1, 0), Up = nb(m, 1, 0);
      // extend lines across gaps to neighbours of the same string so the outline is continuous
      const e0u = L ? m.u0 - 0.03 : U0, e1u = R_ ? m.u1 + 0.03 : U1, e0v = D ? m.v0 - 0.03 : V0, e1v = Up ? m.v1 + 0.03 : V1;
      if (!L) quad(U0, e0v, U0 + lw, e1v);
      if (!R_) quad(U1 - lw, e0v, U1, e1v);
      if (!D) quad(e0u, V0, e1u, V0 + lw);
      if (!Up) quad(e0u, V1 - lw, e1u, V1);
    }
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(pos.length * 3); pos.forEach((p, i) => p.toArray(arr, i * 3));
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3)); geo.computeBoundingSphere();
    const lineMat = new THREE.MeshBasicMaterial({ name: 'pv-string-outline', color: 0xffffff, side: THREE.DoubleSide, toneMapped: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const lines = new THREE.Mesh(geo, lineMat); lines.name = 'pv-string-outlines'; lines.raycast = () => {};
    g.add(lines);

    // labels: one atlas + one billboard mesh (single draw call), size grows with distance (clamped)
    const ids = [...new Set(modules.map((m) => m.stringIndex))].sort((a, b) => a - b);
    const cols = 4, cw = 256, ch = 128, rows = Math.ceil(ids.length / cols);
    const cv = document.createElement('canvas'); cv.width = cols * cw; cv.height = rows * ch;
    const c2 = cv.getContext('2d');
    ids.forEach((s, k) => {
      const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
      const colr = STR_PAL[s % STR_PAL.length];
      c2.fillStyle = 'rgba(16,20,26,0.82)'; rr(c2, x + 8, y + 14, cw - 16, ch - 28, 26); c2.fill();
      c2.lineWidth = 7; c2.strokeStyle = colr; rr(c2, x + 8, y + 14, cw - 16, ch - 28, 26); c2.stroke();
      c2.fillStyle = '#ffffff'; c2.font = 'bold 60px Arial, Helvetica, sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillText(`S${String(s + 1).padStart(2, '0')}`, x + cw / 2, y + ch / 2 - 9);
      const inv = (modules.find((m) => m.stringIndex === s) || {}).inverter || '';
      c2.fillStyle = 'rgba(255,255,255,0.78)'; c2.font = 'bold 24px Arial, Helvetica, sans-serif';
      c2.fillText(inv, x + cw / 2, y + ch / 2 + 32);
    });
    function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
    const atlas = new THREE.CanvasTexture(cv); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = aniso;
    const cen = [], crn = [], uvs = [], anchors = [];
    ids.forEach((s, k) => {
      const ms = modules.filter((m) => m.stringIndex === s);
      const c = new THREE.Vector3(); ms.forEach((m) => c.add(W(m.center))); c.divideScalar(ms.length);
      c.addScaledVector(WD(ms[0].n), 0.35);
      const u0 = (k % cols) / cols, u1 = u0 + 1 / cols, v1 = 1 - Math.floor(k / cols) / rows, v0 = v1 - 1 / rows;
      const C4 = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, -1, u0, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
      for (const [x, y, u, v] of C4) { cen.push(c.x, c.y, c.z); crn.push(x, y * 0.5); uvs.push(u, v); }
      anchors.push(c.clone());
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(cen, 3));
    lg.setAttribute('corner', new THREE.Float32BufferAttribute(crn, 2));
    const offAttr = new THREE.Float32BufferAttribute(new Float32Array(crn.length), 2); offAttr.setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('offs', offAttr);
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(...W([25, 40, 6]).toArray()), 80);
    const lm = new THREE.ShaderMaterial({
      name: 'pv-string-labels', transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
      uniforms: { map: { value: atlas } },
      // offs = screen-space de-collision offset (view-space metres) computed on the CPU in onBeforeRender
      vertexShader: `attribute vec2 corner; attribute vec2 offs; varying vec2 vUv;
        void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float s = clamp(-mv.z * ${LBL_K.toFixed(4)}, ${LBL_MIN.toFixed(2)}, ${LBL_MAX.toFixed(2)}); mv.xy += corner * s + offs; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv;
        void main() { vec4 c = texture2D(map, vUv); if (c.a < 0.02) discard; gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
    });
    const labels = new THREE.Mesh(lg, lm); labels.name = 'pv-string-labels'; labels.renderOrder = 10; labels.frustumCulled = false; labels.raycast = () => {};
    // simple label de-collision: project the anchors, push overlapping label boxes apart (a few relaxation
    // passes, mostly vertically since labels are wide), write the result back as view-space offsets
    const nL = anchors.length, mvP = new THREE.Vector3(), sc = new Float32Array(nL * 4), dl = new Float32Array(nL * 2);
    labels.onBeforeRender = (renderer, scene, camera) => {
      if (!g.visible) return;
      const ortho = !!camera.isOrthographicCamera;
      for (let k = 0; k < nL; k++) {
        mvP.copy(anchors[k]).applyMatrix4(labels.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        const dz = Math.max(0.1, -mvP.z), s = Math.min(LBL_MAX, Math.max(LBL_MIN, dz * LBL_K)), f = ortho ? 1 : 1 / dz;
        sc[k * 4] = mvP.x * f; sc[k * 4 + 1] = mvP.y * f; sc[k * 4 + 2] = s * f; sc[k * 4 + 3] = f;   // centre, half-width, scale
        dl[k * 2] = 0; dl[k * 2 + 1] = 0;
      }
      for (let it = 0; it < 12; it++) {
        let moved = false;
        for (let a = 0; a < nL; a++) for (let b = a + 1; b < nL; b++) {
          const ax = sc[a * 4] + dl[a * 2], ay = sc[a * 4 + 1] + dl[a * 2 + 1], bx = sc[b * 4] + dl[b * 2], by = sc[b * 4 + 1] + dl[b * 2 + 1];
          const hw = (sc[a * 4 + 2] + sc[b * 4 + 2]) * 1.02, hh = (sc[a * 4 + 2] + sc[b * 4 + 2]) * 0.52;
          const ox = hw - Math.abs(ax - bx), oy = hh - Math.abs(ay - by);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (oy <= ox * 1.6) { const d = oy * 0.5 * (ay >= by ? 1 : -1); dl[a * 2 + 1] += d; dl[b * 2 + 1] -= d; }
          else { const d = ox * 0.5 * (ax >= bx ? 1 : -1); dl[a * 2] += d; dl[b * 2] -= d; }
        }
        if (!moved) break;
      }
      const o = offAttr.array;
      for (let k = 0; k < nL; k++) {
        const f = sc[k * 4 + 3], x = dl[k * 2] / f, y = dl[k * 2 + 1] / f;
        for (let v = 0; v < 6; v++) { o[(k * 6 + v) * 2] = x; o[(k * 6 + v) * 2 + 1] = y; }
      }
      offAttr.needsUpdate = true;
    };
    g.add(labels);
    group.add(g);
    return g;
  }

  // ---------------------------------------------------------------- colour modes
  const baseTint = new Float32Array(N * 4);
  let hl = null;
  const col = new THREE.Color();
  const writeTint = () => {
    const a = aTint.array; a.set(baseTint);
    if (hl !== null && hl >= 0 && hl < N) {
      const o = hl * 4; a[o] = 0.35; a[o + 1] = 0.85; a[o + 2] = 1.0; a[o + 3] = 0.7;
      if (uEmis.value < 0.35) uEmis.value = Math.max(uEmis.value, 0.35);
    }
    aTint.needsUpdate = true;
  };
  // ---------------------------------------------------------------- heat map helpers
  const HEAT_STEPS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.75, 1.0];
  let heatScale = 1, worstList = [];
  // 5-stop ramp (sRGB): 0 green · 0.25 yellow-green · 0.5 yellow · 0.75 orange · 1 red
  const HEAT_RAMP = [[0.13, 0.66, 0.29], [0.62, 0.80, 0.16], [1.0, 0.84, 0.10], [1.0, 0.50, 0.06], [0.88, 0.10, 0.12]];
  function heatColor(t, out) {
    const x = Math.max(0, Math.min(1, t)) * 4, k = Math.min(3, Math.floor(x)), f = x - k;
    const a = HEAT_RAMP[k], b = HEAT_RAMP[k + 1];
    return out.setRGB(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, THREE.SRGBColorSpace);
  }
  // worst-module markers: bright outline rings around the N most-shaded modules (one pre-allocated mesh)
  const WORST_N = 8;
  const worstRings = (() => {
    const top = MNT.moduleUnderside + MOD.thickness + 0.008;
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(WORST_N * 4 * 6 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({ name: 'pv-worst-ring', color: 0xffffff, side: THREE.DoubleSide, toneMapped: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'pv-worst-rings'; mesh.visible = false; mesh.frustumCulled = false; mesh.raycast = () => {};
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 2;
    group.add(mesh);
    mesh.userData.write = (list) => {
      let n = 0; const v = new THREE.Vector3();
      const put = (p) => { p.toArray(arr, n * 3); n++; };
      for (const i of list) {
        const m = modules[i], pl = site.ROOF_PLANES[m.plane];
        const P = (u, vv) => W(site.planePoint(pl, u, vv, top));
        const e = 0.02, w = 0.09;     // ring sits just over the frame, 90 mm wide
        const quad = (u0, v0, u1, v1) => { const a = P(u0, v0), b = P(u1, v0), c = P(u1, v1), d = P(u0, v1); put(a); put(b); put(c); put(a); put(c); put(d); };
        quad(m.u0 - e, m.v0 - e, m.u0 - e + w, m.v1 + e); quad(m.u1 + e - w, m.v0 - e, m.u1 + e, m.v1 + e);
        quad(m.u0 - e, m.v0 - e, m.u1 + e, m.v0 - e + w); quad(m.u0 - e, m.v1 + e - w, m.u1 + e, m.v1 + e);
      }
      void v;
      geo.attributes.position.needsUpdate = true; geo.setDrawRange(0, n);
      geo.computeBoundingSphere();
    };
    return mesh;
  })();
  function updateWorstRings(values, vmax) {
    worstList = [];
    if (values && vmax > 0.005) {
      const idx = [...Array(N).keys()].filter((i) => (+values[i] || 0) >= Math.max(0.005, vmax * 0.5));
      idx.sort((a, b) => (+values[b] || 0) - (+values[a] || 0));
      worstList = idx.slice(0, WORST_N);
    }
    worstRings.userData.write(worstList);
    worstRings.visible = worstList.length > 0;
  }

  let mode = 'normal';
  function setColorMode(m, values) {
    mode = m || 'normal';
    uFar.value = mode === 'normal' ? 1 : 0;
    stringsOverlay.visible = mode === 'strings';
    if (mode !== 'heatmap') worstRings.visible = false;
    baseTint.fill(0);
    if (mode === 'strings') {
      for (let i = 0; i < N; i++) {
        col.set(STR_PAL[modules[i].stringIndex % STR_PAL.length]);
        // lift the dark hues (blue/purple/teal/brown) so they separate from untinted cells; hue is kept for the legend
        // (Color.set(hex) already converts sRGB → linear working space; the old extra convertSRGBToLinear()
        //  double-darkened every string colour)
        const hsl = col.getHSL({}, THREE.SRGBColorSpace);
        if (hsl.l < 0.5) col.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), hsl.l + (0.5 - hsl.l) * 0.45, THREE.SRGBColorSpace);
        baseTint.set([col.r, col.g, col.b, 0.86], i * 4);
      }
      uEmis.value = 0.45;
    } else if (mode === 'heatmap') {
      // auto-range: the colour scale spans 0 … a "nice" ceiling of this run's worst module (5 %, 10 %, 15 %, 20 %,
      // 25 %, 30 %, 40 %, 50 %, 75 %, 100 %), so a run whose worst module is 20 % uses the whole green→red ramp
      let vmax = 0;
      for (let i = 0; i < N; i++) { const v = values ? +values[i] || 0 : 0; if (v > vmax) vmax = v; }
      heatScale = HEAT_STEPS.find((s) => s >= vmax - 1e-6) || 1;
      for (let i = 0; i < N; i++) {
        const t = Math.max(0, Math.min(1, (values ? +values[i] || 0 : 0) / heatScale));
        heatColor(t, col);
        baseTint.set([col.r, col.g, col.b, 0.84], i * 4);
      }
      uEmis.value = 0.55;
      updateWorstRings(values, vmax);
      try {
        window.dispatchEvent(new CustomEvent('pv-heatscale', { detail: { max: heatScale, ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => f * heatScale), worst: worstList } }));
      } catch (e) { /* no window (tests) */ }
    } else {
      uEmis.value = 0;
    }
    writeTint();
  }
  function highlight(index) {
    hl = (index === null || index === undefined || index < 0) ? null : index;
    if (hl === null) uEmis.value = mode === 'strings' ? 0.45 : mode === 'heatmap' ? 0.55 : 0;
    writeTint();
  }
  function pick(raycaster) {
    if (!group.visible) return null;
    const hits = raycaster.intersectObject(moduleMesh, false);
    return hits.length && hits[0].instanceId !== undefined ? hits[0].instanceId : null;
  }
  const PLANE_NAMES = { 'A-W': 'Block A – west slope', 'A-E': 'Block A – east slope', 'C-W': 'Block C – west slope', 'C-E': 'Block C – east slope', 'D-S': 'Block D – south slope' };
  function info(index) {
    const m = modules[index]; if (!m) return null;
    return {
      id: m.id, string: m.string, inverter: m.inverter, plane: m.plane, building: m.building,
      roof: PLANE_NAMES[m.plane] || m.plane, row: m.row, col: m.col,
      azimuthDeg: Math.round(m.azimuthDeg * 10) / 10, tiltDeg: Math.round(m.tiltDeg * 100) / 100, wp: MOD.wp,
    };
  }
  function setVisible(v) { group.visible = !!v; }
  setColorMode('normal');

  group.userData.solarApi = { setColorMode, highlight, worstModules: () => worstList.slice(), get heatScale() { return heatScale; } };
  return {
    group, modules, moduleMesh, setColorMode, setVisible, highlight, pick, info, parts: { frameMesh, bos, inverter: inv },
    // heat-map scale for the legend: colour ramp spans 0 … heatScale (fraction shaded); legend ticks = heatTicks()
    get heatScale() { return heatScale; },
    heatTicks: () => [0, 0.25, 0.5, 0.75, 1].map((f) => f * heatScale),
    heatColorCss: (t) => '#' + heatColor(t, new THREE.Color()).getHexString(THREE.SRGBColorSpace),
    worstModules: () => worstList.slice(),
    stringColors: () => STR_PAL.slice(),
  };
}
