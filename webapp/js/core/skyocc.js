// ============================================================================
//  Sky occlusion ("covered-area AO"): a top-down height map of the site is rendered
//  once (and again after layer changes); every lit PBR material then scales its
//  INDIRECT light (hemisphere fill + IBL diffuse/specular) by how much open sky a
//  fragment can see, estimated from the occluder heights in a disc around it.
//  Result: passages under lean-to roofs, eaves soffits and narrow gaps between
//  sheds go properly dark (sunlight still enters through the shadow map), while
//  open ground and roof tops are untouched.
// ============================================================================
import * as THREE from 'three';

const REGION = { x0: -42, x1: 78, y0: -30, y1: 90 }; // plan coords (x E, y N), covers the whole detailed site
const TOP = 60, NEAR = 0.5, FAR = 72;                 // camera height / depth range (world Y −12 … 59.5)
const SKIP_NAME = /sunpath|label|measure|ghost|helper|sky|cloud/i;

function makeTaps(quality) {
  // [x, z, weight] in metres. Centre + rings; the rings are rotated against each other.
  const rings = quality === 'low' ? [[1.4, 3, 0.9], [3.4, 4, 0.6]]
    : [[0.9, 4, 1.0], [2.0, 6, 0.85], [3.6, 8, 0.6], [5.6, 6, 0.35]];
  const taps = [[0, 0, 1.6]];
  rings.forEach(([r, n, w], ri) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ri * 0.61;
      taps.push([Math.cos(a) * r, Math.sin(a) * r, w]);
    }
  });
  return taps;
}

export class SkyOcclusion {
  constructor(renderer, scene, quality = 'high') {
    this.renderer = renderer; this.scene = scene;
    const size = quality === 'low' ? 512 : 1024;
    const dt = new THREE.DepthTexture(size, size);
    dt.type = THREE.UnsignedIntType;
    dt.minFilter = dt.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, depthTexture: dt, type: THREE.UnsignedByteType });
    this.rt.texture.generateMipmaps = false;
    const w = (REGION.x1 - REGION.x0) / 2, h = (REGION.y1 - REGION.y0) / 2;
    const cam = new THREE.OrthographicCamera(-w, w, h, -h, NEAR, FAR);
    cam.up.set(0, 0, -1); // north-up
    cam.position.set((REGION.x0 + REGION.x1) / 2, TOP, -(REGION.y0 + REGION.y1) / 2);
    cam.lookAt(cam.position.x, 0, cam.position.z);
    cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    this.cam = cam;
    this.override = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.taps = makeTaps(quality);
    this.uniforms = {
      uSkyDepth: { value: dt },
      uSkyVP: { value: vp },
      uSkyRange: { value: new THREE.Vector3(TOP, NEAR, FAR) },
      uSkyMin: { value: new THREE.Vector2(0.09, 0.06) },   // indirect diffuse / specular floor when fully covered
      uSkyOn: { value: 0 },
      uSkyTaps: { value: this.taps.map((t) => new THREE.Vector3(t[0], t[1], t[2])) },
    };
    this.patched = new WeakSet();
    this.ready = false;
  }

  /** Render the top-down occluder height map. Call after the scene is built and after layer changes. */
  update() {
    const r = this.renderer, scene = this.scene;
    const hidden = [];
    scene.traverse((o) => {
      if (!o.visible) return;
      if (o.isLine || o.isPoints || o.isSprite) { hidden.push(o); return; }
      if (!o.isMesh) { if (SKIP_NAME.test(o.name || '') && o !== scene) hidden.push(o); return; }
      const ud = o.userData || {};
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const lit = m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);
      if (!lit || ud.noAO || ud.noOcclusion || ud.noSkyOcc || m.transparent || m.alphaTest > 0 || m.depthTest === false
          || SKIP_NAME.test(o.name || '')) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    const prev = { rt: r.getRenderTarget(), ov: scene.overrideMaterial, bg: scene.background, fog: scene.fog, au: r.shadowMap.autoUpdate, nu: r.shadowMap.needsUpdate };
    scene.overrideMaterial = this.override; scene.background = null; scene.fog = null;
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false; // never bake the shadow map with objects hidden
    try {
      r.setRenderTarget(this.rt);
      r.clear(true, true, false);
      r.render(scene, this.cam);
    } finally {
      r.setRenderTarget(prev.rt);
      scene.overrideMaterial = prev.ov; scene.background = prev.bg; scene.fog = prev.fog;
      r.shadowMap.autoUpdate = prev.au; r.shadowMap.needsUpdate = prev.nu;
      for (const o of hidden) o.visible = true;
    }
    this.uniforms.uSkyOn.value = 1;
    this.ready = true;
  }

  /** Inject the occlusion into every lit material in the scene (idempotent). */
  patchScene(root = this.scene) {
    let n = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (this.patchMaterial(m)) n++;
    });
    return n;
  }

  patchMaterial(m) {
    if (!m || this.patched.has(m)) return false;
    if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return false;
    if (m.userData && m.userData.noSkyOcc) return false;
    this.patched.add(m);
    const U = this.uniforms, nTaps = this.taps.length;
    const prevCompile = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = function (sh, r) {
      if (prevCompile) prevCompile.call(this, sh, r);
      if (!sh.fragmentShader.includes('#include <aomap_fragment>') || !sh.vertexShader.includes('#include <project_vertex>')) return;
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'varying vec3 vSkyW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 skyW = vec4( transformed, 1.0 );
          #ifdef USE_BATCHING
            skyW = batchingMatrix * skyW;
          #endif
          #ifdef USE_INSTANCING
            skyW = instanceMatrix * skyW;
          #endif
          vSkyW = ( modelMatrix * skyW ).xyz;
        }`);
      sh.fragmentShader = `varying vec3 vSkyW;
        uniform sampler2D uSkyDepth; uniform mat4 uSkyVP; uniform vec3 uSkyRange; uniform vec2 uSkyMin;
        uniform float uSkyOn; uniform vec3 uSkyTaps[${nTaps}];
        float skyVisibility( vec3 wp, vec3 nW ) {
          float down = max( -nW.y, 0.0 );
          // step out of the surface (walls sample the open side), and treat down-facing soffits as lower
          vec3 p = wp + vec3( nW.x, 0.0, nW.z ) * 0.3;
          float h = wp.y + 0.14 * nW.y - 0.12 - 0.9 * down;
          float occ = 0.0, wsum = 0.0;
          for ( int i = 0; i < ${nTaps}; i ++ ) {
            vec3 t = uSkyTaps[ i ];
            vec4 c = uSkyVP * vec4( p.x + t.x, 0.0, p.z + t.y, 1.0 );
            vec2 uv = c.xy * 0.5 + 0.5;
            if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) { wsum += t.z; continue; }
            float d = texture2D( uSkyDepth, uv ).r;
            float H = uSkyRange.x - ( uSkyRange.y + d * ( uSkyRange.z - uSkyRange.y ) );
            float dist = max( length( t.xy ), 0.75 );
            // elevation angle of the occluder top seen from the fragment (0 … 1 = 0 … 90°)
            float ang = atan( max( H - h, 0.0 ), dist ) * 0.63662;
            occ += t.z * clamp( ang * 1.7 - 0.08, 0.0, 1.0 );
            wsum += t.z;
          }
          return 1.0 - occ / max( wsum, 1e-3 );
        }
        ` + sh.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        if ( uSkyOn > 0.5 ) {
          vec3 skyN = normalize( inverseTransformDirection( normal, viewMatrix ) );
          float vis = skyVisibility( vSkyW, skyN );
          vis = vis * vis * ( 3.0 - 2.0 * vis );
          reflectedLight.indirectDiffuse *= mix( uSkyMin.x, 1.0, vis );
          reflectedLight.indirectSpecular *= mix( uSkyMin.y, 1.0, vis );
        }`);
    };
    m.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|skyocc' + nTaps; };
    m.needsUpdate = true;
    return true;
  }

  setEnabled(on) { this.uniforms.uSkyOn.value = on && this.ready ? 1 : 0; }

  dispose() { this.rt.dispose(); this.override.dispose(); }
}
