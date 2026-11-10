// ============================================================================
//  Sky, sun, moonlight, hemisphere fill, haze and the PMREM environment map.
//  Driven by the real sun position (js/analysis/sun.js) for the site.
// ============================================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

// Shadow-caster box (plan coords) — the whole detailed site incl. chimney & palms.
const SHADOW_BOX = { x0: -30, x1: 66, y0: -22, y1: 82, z0: -0.5, z1: 32 };

export class Lighting {
  constructor({ renderer, scene, quality }) {
    this.renderer = renderer; this.scene = scene;
    this.center = new THREE.Vector3(18, 0, -30);

    // --- Sky dome (visible background)
    const sky = new Sky();
    sky.scale.setScalar(4500);
    sky.name = 'sky';
    sky.userData.noPick = true;
    sky.frustumCulled = false;
    const u = sky.material.uniforms;
    u.turbidity.value = 5.5;
    u.rayleigh.value = 1.45;
    u.mieCoefficient.value = 0.0055;
    u.mieDirectionalG.value = 0.82;
    scene.add(sky);
    this.sky = sky;

    // --- Cloud layer (procedural fbm on a high plane; WA0010/WA0011 show a bright, broken cumulus sky)
    this.clouds = makeClouds(quality);
    scene.add(this.clouds);

    // --- Env scene for PMREM: sky + a ground disc that provides warm ground bounce
    this.envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(sky.geometry, sky.material);
    envSky.scale.setScalar(800);
    this.envScene.add(envSky);
    this.envGroundMat = new THREE.MeshBasicMaterial({ color: 0x40382e, side: THREE.DoubleSide, toneMapped: false });
    const envGround = new THREE.Mesh(new THREE.CircleGeometry(400, 48), this.envGroundMat);
    envGround.rotation.x = -Math.PI / 2; envGround.position.y = -2;
    this.envScene.add(envGround);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this._lastEnvDir = new THREE.Vector3(0, -1, 0);
    this._lastEnvTime = -1e9;
    this._envPending = false;

    // Tiny render target to read the true sky colour at the horizon (→ fog colour)
    this.horizonRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType, depthBuffer: false });
    this.horizonCam = new THREE.PerspectiveCamera(20, 1, 0.1, 2000);
    this._px = new Float32Array(4);

    // --- Sun (also used as moonlight at night)
    const sun = new THREE.DirectionalLight(0xffffff, 4);
    sun.castShadow = true;
    sun.shadow.camera.up.set(0, 0, -1); // north-up: avoids lookAt degeneracy with the sun at the zenith
    sun.shadow.bias = -0.00012;
    sun.shadow.normalBias = 0.022;
    sun.target.position.copy(this.center);
    scene.add(sun, sun.target);
    this.sun = sun;
    this.setShadowMapSize(quality === 'high' ? 4096 : quality === 'medium' ? 2048 : 1024);

    // --- Hemisphere fill
    this.hemi = new THREE.HemisphereLight(0xbfd6f2, 0x8a7559, 0.6);
    scene.add(this.hemi);

    // --- Haze
    this.fogDensity = 0.0016;
    scene.fog = new THREE.FogExp2(0xc4d0dc, this.fogDensity);

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.elevation = 45; this.azimuth = 180;
    this.exposureDay = 0.5;
    this.night = 0; this.dusk = 0; this.lightsOn = 0; this._fogDim = 1;
    this._addPracticals();
  }

  /** Core-owned practical lights (non-shadow): pole floodlight spot, burner glow, aviation lamp. */
  _addPracticals() {
    const P = (x, y, z) => new THREE.Vector3(x, z, -y);
    const g = new THREE.Group(); g.name = 'practical-lights';
    // pole floodlight by Block A (site-data FEATURES.poles[0]): aimed SSW, 28° down (structures/poles.js)
    const spot = new THREE.SpotLight(0xffe7c2, 0, 42, 0.78, 0.55, 1.6);
    spot.position.copy(P(41.6 - 0.15, 50.9 - 0.32, 5.3));
    const aim = new THREE.Vector3(-0.45, 0, 1).normalize(), tilt = 28 * DEG;
    spot.target.position.copy(spot.position).add(new THREE.Vector3(aim.x * Math.cos(tilt), -Math.sin(tilt), aim.z * Math.cos(tilt)).multiplyScalar(10));
    spot.castShadow = false;
    // wood burner / thermic-fluid heater under the basic roof: warm flicker-free glow
    const burner = new THREE.PointLight(0xff9a4a, 0, 14, 1.8);
    burner.position.copy(P(20.6, 15.8 - 1.6, 1.4));
    // aviation obstruction lamp at the chimney top
    const avi = new THREE.PointLight(0xff2a14, 0, 10, 2);
    avi.position.copy(P(25.8, 10.5, 30.6));
    g.add(spot, spot.target, burner, avi);
    this.scene.add(g);
    this.practicals = { group: g, spot, burner, avi };
  }

  _updatePracticals() {
    const k = this.lightsOn, P = this.practicals;
    if (!P) return;
    P.spot.intensity = 260 * k;
    P.burner.intensity = 22 * k;
    P.avi.intensity = 6 * k;
  }

  /** Called by the app after builders finished: drive their emissive accents from lightsOn. */
  bindEmissives(scene) {
    const mats = { flood: [], glass: [], lamp: [] };
    scene.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        if (!m || !m.name || !m.emissive) continue;
        if (m.name === 'structures-flood' && !mats.flood.includes(m)) mats.flood.push(m);
        else if (m.name === 'bld-glass' && !mats.glass.includes(m)) mats.glass.push(m);
      }
    });
    this._emissives = mats;
    this.applyEmissives();
  }

  applyEmissives() {
    const E = this._emissives; if (!E) return;
    const k = this.lightsOn;
    for (const m of E.flood) m.emissiveIntensity = 3.2 * k;
    // windows: warm interior tube-light glow behind the steel-framed glass (night shift in the dye house)
    for (const m of E.glass) { m.emissive.setRGB(1.0, 0.78, 0.5); m.emissiveIntensity = 0.55 * k; }
  }

  setShadowMapSize(n) {
    const s = this.sun.shadow;
    if (s.mapSize.x === n) return;
    s.mapSize.set(n, n);
    if (s.map) { s.map.dispose(); s.map = null; }
  }

  setShadowsEnabled(on) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    // force material recompilation of shadow chunks
    this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  }

  /** Update everything for a new sun position. azimuth/elevation in degrees. */
  setSun(azimuthDeg, elevationDeg) {
    this.azimuth = azimuthDeg; this.elevation = elevationDeg;
    const a = azimuthDeg * DEG, e = elevationDeg * DEG;
    // world: X east, Y up, Z south
    this.sunDir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
    const el = elevationDeg;

    // Sky shader sun position (keep slightly below horizon at night for a dark sky)
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    // Phases: day 0 night … 1 day; golden = low-sun warmth; dusk = civil twilight bell (peaks at el ≈ 0)
    const day = smooth(-5, 3, el);
    const golden = 1 - smooth(2, 24, el);
    const dusk = smooth(-9, -1.5, el) * (1 - smooth(1.5, 9, el));
    const deep = 1 - smooth(-12, -4, el);          // real night (exposure lift only here)
    this.night = 1 - day;
    this.dusk = dusk; this.golden = golden;
    // practical lights (pole floodlight, windows, aviation lamp) switch on around sunset
    this.lightsOn = 1 - smooth(-1.5, 4.5, el);

    // Sky shader: hazier, redder and more forward-scattering towards sunset
    const su = this.sky.material.uniforms;
    su.turbidity.value = 5.5 + 4.0 * golden;
    su.rayleigh.value = 1.45 + 1.6 * golden * golden;
    su.mieCoefficient.value = 0.0055 + 0.0035 * golden;
    su.mieDirectionalG.value = 0.82 + 0.1 * golden;

    // Sun colour: neutral white high up → amber at golden hour → deep orange-red at the horizon
    const cDay = new THREE.Color(1.0, 0.965, 0.92);
    const cWarm = new THREE.Color(1.0, 0.62, 0.34);
    const cSet = new THREE.Color(1.0, 0.40, 0.16);
    const sunCol = cDay.clone().lerp(cWarm, golden).lerp(cSet, 1 - smooth(-1, 6, el));
    // keep a raking, low-intensity disc light right down to the horizon (it is what makes dusk read)
    const sunI = Math.max(4.6 * smooth(-0.8, 10, el) * (0.82 + 0.18 * smooth(10, 60, el)), 2.1 * smooth(-1.8, 1.2, el));

    const moonDir = new THREE.Vector3(-0.35, 0.82, 0.45).normalize(); // high in the SW-ish
    const useMoon = el < -1.8;
    const lightDir = useMoon ? moonDir : this.sunDir.clone().setY(Math.max(this.sunDir.y, Math.sin(1.6 * DEG))).normalize();
    this.sun.color.copy(useMoon ? new THREE.Color(0.62, 0.72, 1.0) : sunCol);
    this.sun.intensity = useMoon ? 0.22 * this.night * smooth(2, 6, -el) : sunI;
    this.sun.position.copy(this.center).addScaledVector(lightDir, 260);
    this.sun.target.position.copy(this.center);
    this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();
    this._fitShadow(lightDir);

    // Hemisphere fill: daylight blue → warm golden-hour → lavender/rose twilight → blue night
    const skyDay = new THREE.Color(0xbcd2ec), skyNight = new THREE.Color(0x24324f), skyGold = new THREE.Color(0xf0c9a0);
    const skyDusk = new THREE.Color(0xb39aae), skyBlue = new THREE.Color(0x7487b8);
    const grDay = new THREE.Color(0x87705a), grNight = new THREE.Color(0x0d0f14), grDusk = new THREE.Color(0x5a4234);
    this.hemi.color.copy(skyNight).lerp(skyDay, day).lerp(skyGold, golden * day * 0.45).lerp(el > 0 ? skyDusk : skyBlue.clone().lerp(skyDusk, smooth(-6, 0, el)), dusk * 0.8);
    this.hemi.groundColor.copy(grNight).lerp(grDay, day).lerp(grDusk, dusk * 0.6);
    this.hemi.intensity = 0.35 + 0.33 * day + 0.42 * dusk;

    // Clouds: lit by the sun colour (pink/orange undersides at sunset), shaded by the sky; dark at night
    const cu = this.clouds.material.uniforms;
    cu.uSunDir.value.copy(this.sunDir);
    cu.uSunCol.value.copy(sunCol).multiplyScalar(0.95 * smooth(-4, 8, el) + 0.02 + 0.9 * dusk);
    cu.uDay.value = Math.max(day, 0.55 * dusk);

    // Exposure: slight lift at golden hour / twilight; real night lift only once el < -4
    // r2: dusk lifted ≈ +0.4 EV more (the aerial dusk shot was crushed below 15 % luminance)
    this.renderer.toneMappingExposure = this.exposureDay * (1 + 0.22 * golden * day) * (1 + 0.95 * dusk) * (1 + 0.9 * deep);
    // twilight: the sky dome (warm horizon, rose/lavender zenith) is the main light → let the IBL carry it (sunset mirrored in glass & sheets)
    this.scene.environmentIntensity = 0.12 + 0.78 * day + 0.5 * dusk;
    this._fogDim = 1 - 0.45 * dusk - 0.2 * this.night;
    this._updatePracticals();

    this.requestEnv();
  }

  _fitShadow(lightDir) {
    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    cam.lookAt(this.sun.target.position);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const b = SHADOW_BOX; const p = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
      p.set(x, z, -y).applyMatrix4(inv);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    cam.left = minX - 1; cam.right = maxX + 1; cam.bottom = minY - 1; cam.top = maxY + 1;
    cam.near = Math.max(0.5, -maxZ - 5); cam.far = -minZ + 5;
    cam.updateProjectionMatrix();
  }

  requestEnv() { this._envPending = true; }

  /** Call every frame; regenerates the env map when the sun moved > 1° (throttled to 4 Hz). */
  update(now, force = false) {
    if (!this._envPending && !force) return false;
    const moved = this._lastEnvDir.angleTo(this.sunDir) / DEG;
    if (!force && moved < 1.0) { this._envPending = false; return false; }
    if (!force && now - this._lastEnvTime < (this.envInterval || 250)) return false;
    // the horizon read-back is a synchronous GPU→CPU stall: while the day is playing only redo it
    // when the sun moved noticeably (fog colour changes slowly)
    const readH = force || !this._lastHorizonDir || this._lastHorizonDir.angleTo(this.sunDir) / DEG > (this.envInterval > 400 ? 4 : 1);
    this._regenEnv(readH);
    this._lastEnvTime = now; this._lastEnvDir.copy(this.sunDir); this._envPending = false;
    return true;
  }

  _regenEnv(readHorizon = true) {
    const r = this.renderer;
    // 1) horizon colour (linear HDR, pre-tonemap) → fog colour, ground-bounce colour
    const fogCol = readHorizon ? this._readHorizon() : null;
    if (fogCol) this._lastHorizonDir = (this._lastHorizonDir || new THREE.Vector3()).copy(this.sunDir);
    else if (this._lastFog) this.scene.fog.color.copy(this._lastFog).multiplyScalar(this._fogDim);
    if (fogCol) {
      // twilight haze is dimmer than the bright sky band right at the horizon (otherwise distant
      // satellite ground looks pasted-on and brighter than the site)
      this._lastFog = fogCol.clone();
      this.scene.fog.color.copy(fogCol).multiplyScalar(this._fogDim);
      this.clouds.material.uniforms.uAmb.value.copy(fogCol);
      const lum = 0.2126 * fogCol.r + 0.7152 * fogCol.g + 0.0722 * fogCol.b;
      // ground bounce ≈ albedo × (sun + sky) — scaled from sky brightness
      const g = new THREE.Color(0.42, 0.34, 0.25).multiplyScalar(Math.min(lum * 0.55 + 0.25 * this.sun.intensity * Math.max(0, this.sunDir.y) * (1 - this.night), 3));
      this.envGroundMat.color.copy(g);
    }
    // 2) PMREM
    const prevTM = r.toneMapping;
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    r.toneMapping = prevTM;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }

  _readHorizon() {
    const r = this.renderer;
    try {
      const prevRT = r.getRenderTarget();
      const sum = new THREE.Color(0, 0, 0);
      const cam = this.horizonCam;
      const az0 = this.azimuth * DEG;
      const offsets = [Math.PI * 0.5, Math.PI, Math.PI * 1.5, 0.35 * Math.PI];
      let n = 0;
      const prevFog = this.scene.fog;
      for (const off of offsets) {
        const a = az0 + off;
        cam.position.set(0, 0, 0);
        cam.lookAt(Math.sin(a), Math.sin(2.5 * DEG), -Math.cos(a));
        cam.updateMatrixWorld();
        r.setRenderTarget(this.horizonRT);
        r.render(this.envScene, cam);
        r.readRenderTargetPixels(this.horizonRT, 1, 1, 1, 1, this._px);
        const c = new THREE.Color(this._px[0], this._px[1], this._px[2]);
        if (Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b)) { sum.add(c); n++; }
      }
      this.scene.fog = prevFog;
      r.setRenderTarget(prevRT);
      if (!n) return null;
      sum.multiplyScalar(1 / n);
      // sky shader output is linear; keep within a sane range
      sum.r = clamp(sum.r, 0.002, 20); sum.g = clamp(sum.g, 0.002, 20); sum.b = clamp(sum.b, 0.002, 20);
      return sum;
    } catch (e) {
      return null;
    }
  }
}

/**
 * Procedural cumulus layer: a large dome around the origin; each pixel projects its view ray onto a
 * plane ~1.6 km up and evaluates domain-warped fbm noise there (real parallax when the camera moves).
 * Drawn after the opaque scene (transparent), depth-tested, no fog, not pickable.
 */
function makeClouds(quality) {
  const oct = quality === 'low' ? 4 : 6;
  const mat = new THREE.ShaderMaterial({
    name: 'clouds',
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      uAmb: { value: new THREE.Color(0.7, 0.75, 0.82) },
      uDay: { value: 1 },
      uCover: { value: 0.47 },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w * 0.99999; // just in front of the far plane, like a skybox
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform float uDay; uniform float uCover;
      varying vec3 vWorld;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int k = 0; k < ${oct}; k++) { v += a * noise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vWorld - cameraPosition);
        if (d.y < 0.012) discard;
        float t = (1600.0 - cameraPosition.y) / d.y;
        vec2 p = (cameraPosition.xz + d.xz * t) / 2600.0;
        vec2 w = vec2(fbm(p * 1.7 + 3.1), fbm(p * 1.7 - 5.7));
        float n = fbm(p * 2.2 + w * 0.9);
        float dens = smoothstep(uCover, uCover + 0.26, n);
        float horizon = smoothstep(0.012, 0.16, d.y);
        float a = dens * horizon * 0.94;
        if (a < 0.003) discard;
        // self-shadowing: denser cores darker underneath; bright sun-facing tops & silver lining
        float core = smoothstep(uCover + 0.05, uCover + 0.5, n);
        float fwd = pow(max(dot(d, uSunDir), 0.0), 6.0);
        vec3 col = uAmb * (1.05 - 0.38 * core) + uSunCol * (0.55 - 0.3 * core + 0.6 * fwd * (1.0 - core));
        col = mix(col, uAmb, 1.0 - horizon * 0.8) * mix(0.18, 1.0, uDay);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.5), mat);
  mesh.name = 'clouds';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.userData.noPick = true; mesh.userData.noAO = true; mesh.userData.noOcclusion = true;
  mesh.raycast = () => {};
  return mesh;
}
