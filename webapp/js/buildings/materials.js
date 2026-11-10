// ============================================================================
//  BUILDINGS — shared PBR materials. Colour comes from vertex colours (per
//  sheet / per element variation) × tiling detail map × grime atlas.
// ============================================================================

/**
 * Adds the grime-atlas multiply (custom `grimeUv` attribute) to a standard material.
 * lift > 1: the atlas is painted on a grey base (1 / lift); texels brighter than
 * the base become "chalking" (UV-faded paint → lighter and desaturated).
 */
function withGrime(m, uniform, roughGain = 0.45, lift = 1, ribFade = false) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.grimeMap = uniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 grimeUv;\nvarying vec2 vGrimeUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvGrimeUv = grimeUv;');
    const lifted = lift !== 1
      ? `\tfloat chalkS = clamp( ( dot( grimeS, vec3( 0.333 ) ) - 1.0 ) * 4.0, 0.0, 1.0 );
\tgrimeS = min( grimeS, vec3( 1.0 ) );
\tdiffuseColor.rgb *= grimeS;
\tdiffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) ) * 1.2 + 0.04, chalkS * 0.55 );`
      : '\tdiffuseColor.rgb *= grimeS;';
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grimeMap;\nvarying vec2 vGrimeUv;')
      .replace('#include <map_fragment>', `#include <map_fragment>\n\tvec3 grimeS = texture2D( grimeMap, vGrimeUv ).rgb * ${lift.toFixed(3)};\n${lifted}`)
      .replace('#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n\troughnessFactor = clamp( roughnessFactor + ( 1.0 - dot( grimeS, vec3( 0.333 ) ) ) * ${roughGain.toFixed(3)}, 0.04, 1.0 );`)
      .replace('#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>\n\tmetalnessFactor *= clamp( 1.0 - ( 1.0 - dot( grimeS, vec3( 0.333 ) ) ) * 1.6, 0.0, 1.0 );`);
    // Roofs: the 25 mm geometric ribs alias into moire bands at aerial distance. Fade the faceted
    // flank / crest normals towards world-up (roof pitches are 6-11 deg) with view distance; the
    // mip-mapped rib albedo keeps the banding legible.
    if (ribFade) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
\t{ vec3 rfUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
\t  float rfK = smoothstep( 22.0, 75.0, length( vViewPosition ) ) * 0.85;
\t  if ( dot( normal, rfUp ) > 0.2 ) normal = normalize( mix( normal, rfUp, rfK ) ); }`);
  };
  m.customProgramCacheKey = () => 'r2v-grime-' + roughGain.toFixed(3) + '-' + lift.toFixed(3) + (ribFade ? '-rf' : '');
  return m;
}

/** Roof atlas is painted on this grey base so that chalking can lighten. */
export const ROOF_ATLAS_BASE = 204;

export function createMaterials(THREE, tex, atlases) {
  const wallU = { value: null }, roofU = { value: null }, underU = { value: null };
  atlases.wallUniform = wallU; atlases.roofUniform = roofU; atlases.underUniform = underU;
  const S = THREE.MeshStandardMaterial;
  const rep = (t, x, y) => { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; };
  const lift = 255 / ROOF_ATLAS_BASE;

  const pl = tex.plaster, bl = tex.blocks, sh = tex.sheet;
  const mats = {
    // painted plaster / brick masonry, concrete trim (vertex colour carries the paint colour)
    masonry: withGrime(new S({ name: 'bld-masonry', vertexColors: true, roughness: 0.9, metalness: 0,
      map: rep(pl.map, 1 / pl.tile, 1 / pl.tile), normalMap: rep(pl.normal, 1 / pl.tile, 1 / pl.tile), normalScale: new THREE.Vector2(0.8, 0.8) }), wallU, 0.1),
    // exposed hollow concrete blocks
    block: withGrime(new S({ name: 'bld-block', vertexColors: true, roughness: 0.95, metalness: 0,
      map: rep(bl.map, 1 / bl.tileW, 1 / bl.tileH), normalMap: rep(bl.normal, 1 / bl.tileW, 1 / bl.tileH), normalScale: new THREE.Vector2(1, 1) }), wallU, 0.05),
    // PPGI wall cladding (painted steel) — rib cavity / crest map keeps the profile legible at distance
    clad: withGrime(new S({ name: 'bld-clad', vertexColors: true, roughness: 0.55, metalness: 0.2, map: sh.rib,
      normalMap: sh.normal, roughnessMap: sh.rough, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.8 }), wallU, 0.4),
    // inside face of cladding / roof sheets (corrugation banding + underside grime atlas: purlin dust, rust, soot)
    back: withGrime(new S({ name: 'bld-back', vertexColors: true, roughness: 0.7, metalness: 0.25, map: sh.rib,
      normalMap: sh.normal, normalScale: new THREE.Vector2(0.6, 0.6) }), underU, 0.2),
    // bare zincalume roofs (A, C, basic roof)
    roofMetal: withGrime(new S({ name: 'bld-roof-metal', vertexColors: true, roughness: 0.5, metalness: 0.5, map: sh.rib,
      normalMap: sh.normal, roughnessMap: sh.rough, normalScale: new THREE.Vector2(1.2, 1.2) }), roofU, 0.55, lift, true),
    // pre-painted roofs (D green, B / dyeing blue)
    // dusty colour-coated sheet: matt-ish (no plastic sheen), little metallic response
    roofPaint: withGrime(new S({ name: 'bld-roof-paint', vertexColors: true, roughness: 0.64, metalness: 0.08, map: sh.rib,
      normalMap: sh.normal, roughnessMap: sh.rough, normalScale: new THREE.Vector2(1.0, 1.0), envMapIntensity: 0.75 }), roofU, 0.4, lift, true),
    // polycarbonate skylight sheets
    // aged polycarbonate / FRP: milky, dusty, about as rough as the sheet around it; the faint emissive
    // stands in for daylight scattered up through it (kept low so it sits in the roof's exposure)
    skylight: withGrime(new S({ name: 'bld-skylight', vertexColors: true, roughness: 0.46, metalness: 0.0, map: sh.rib,
      emissive: new THREE.Color(0x070806), normalMap: sh.normal, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.7 }), roofU, 0.35, lift, true),
    // painted steel trims, gutters, frames, doors, purlins
    trim: new S({ name: 'bld-trim', vertexColors: true, roughness: 0.55, metalness: 0.3 }),
    // galvanised / zincalume trims & turbo vents
    galv: new S({ name: 'bld-galv', vertexColors: true, roughness: 0.32, metalness: 0.85 }),
    // PVC pipes, plastic tank, cables, drum (dielectric)
    plastic: new S({ name: 'bld-plastic', vertexColors: true, roughness: 0.55, metalness: 0.0 }),
    glass: new S({ name: 'bld-glass', color: 0x2a3238, roughness: 0.06, metalness: 0.9, envMapIntensity: 1.2 }),
    screw: new S({ name: 'bld-screw', color: 0xffffff, roughness: 0.55, metalness: 0.35 }),
    vent: new S({ name: 'bld-vent', vertexColors: true, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide }),
  };
  return mats;
}
