// ============================================================================
//  STRUCTURES — shared PBR materials (one merged mesh per key)
// ============================================================================
import * as THREE from 'three';
import * as T from './textures.js';

export const CLARIFIER_LAYOUT = { outer: 2.1, top: 0.2, inner: 0.75 };

export function makeMaterials(ctx) {
  const site = ctx.site;
  const S = ctx.quality === 'high' ? 1 : ctx.quality === 'medium' ? 0.5 : 0.25;
  const an = Math.min(8, ctx.maxAnisotropy || 4);
  const F = site.FEATURES;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const rep = (t, u, v = u) => { const c = t.clone(); c.repeat.set(u, v); c.needsUpdate = true; return c; };

  const grain = T.grainNormal(S, an);
  const conc = T.concrete(S, an);
  const plaster = T.plasterWall(S, an);
  const galvT = T.galv(S, an);
  const ch = F.chimney;

  const anS = Math.min(16, ctx.maxAnisotropy || 4);
  const greenSheetT = T.sheet(S, anS, { color: F.compoundWalls.greenScreen.color, mode: 'H', tileU: 12, tileV: 1.25, sheetLen: 3.0, screwsU: 1.0, seed: 3, pitch: 0.24, fade: 0.22, tintVar: 26, ribs: { phase: 0.03, pan: 0.173, slope: 0.016, crest: 0.035 } });
  const blueSheetT = T.sheet(S, an, { color: F.gate.color, mode: 'V', tileU: 3.0, tileV: 2.4, sheetLen: 1.0, screwRowsV: [0.12, 1.2, 2.28], seed: 8, pitch: 0.2, fade: 0.18 });
  const backT = T.sheetBack(S, an);
  const brick = T.brick(S, an);
  const alum = T.alumCladding(S, an);
  const wat = T.water(S, an);

  const M = {};
  const def = (key, material, o = {}) => { material.name = 'structures-' + key; M[key] = { material, occluder: o.occluder !== false, cast: o.cast !== false, receive: o.receive !== false }; return material; };

  // --- masonry / concrete
  // plaster UVs span 8 m × wall height per tile; the 1 m grain normal must repeat to match or it
  // smears into horizontal wavy grain along the long wall runs
  const grainP = grain.clone(); grainP.repeat.set(8, F.compoundWalls.height); grainP.needsUpdate = true;
  def('plaster', std({ map: plaster, color: 0xc4c3bb, normalMap: grainP, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.93, metalness: 0 }));
  def('concrete', std({ map: conc, normalMap: grain, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95, metalness: 0 }));
  def('clarifier', std({ map: T.clarifierWall(S, an, CLARIFIER_LAYOUT), color: 0xc9c7bf, normalMap: grain, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.92 }));
  def('brick', std({ map: brick.map, normalMap: brick.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95 }));
  // --- steel
  def('galv', std({ map: galvT, color: 0xc2c7cb, roughness: 0.55, metalness: 0.5 }));
  def('steelPaint', std({ map: T.paintedSteel(S, an, '#8a96a0', 0.45, 4), roughness: 0.62, metalness: 0.25 }));
  def('steelDark', std({ map: T.paintedSteel(S, an, '#4a4e50', 0.8, 9), roughness: 0.72, metalness: 0.3 }));
  def('rust', std({ map: T.paintedSteel(S, an, '#6e4630', 1.0, 15), color: 0x9a8678, roughness: 0.88, metalness: 0.2 }));
  def('chequer', std({ map: galvT, color: 0xa6a39c, normalMap: T.chequerNormal(S, an), normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.55, metalness: 0.6 }));
  const grat = T.gratingAlpha(S, an);
  def('grating', std({ map: galvT, color: 0xa8adb1, alphaMap: grat, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.55 }));
  def('stack', std({
    map: T.stackBands(S, an, { z0: 0.5, zTop: ch.height, span: 32, bandH: ch.bands.bandHeight, dark: ch.bands.colors[0], light: ch.bands.colors[1], innerFrom: ch.height + 0.005 }),
    roughness: 0.62, metalness: 0.15,
  }));
  // --- sheets
  def('greenSheet', std({ map: greenSheetT, color: 0xb8c4bf, roughness: 0.62, metalness: 0.08 }));
  def('blueSheet', std({ map: blueSheetT, color: 0xc4ccd8, roughness: 0.52, metalness: 0.15 }));
  def('sheetBack', std({ map: backT, roughness: 0.7, metalness: 0.1 }));
  // --- equipment
  def('motorBlue', std({ color: 0x1f5fb0, roughness: 0.38, metalness: 0.25 }));
  def('machGrey', std({ map: T.paintedSteel(S, an, '#7d858a', 0.3, 12), roughness: 0.5, metalness: 0.3 }));
  def('alum', std({ map: alum.map, normalMap: alum.normal, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.42, metalness: 0.85 }));
  def('alumSoot', std({ map: alum.map, normalMap: alum.normal, normalScale: new THREE.Vector2(0.4, 0.4), color: 0x8d8a84, roughness: 0.6, metalness: 0.7 }));
  def('glow', std({ color: 0x2a1408, emissive: 0xff6a1c, emissiveIntensity: 2.2, roughness: 0.6 }), { occluder: false, cast: false });
  def('stainless', std({ map: galvT, color: 0xc6c9ca, roughness: 0.36, metalness: 0.7 }));
  def('frpBlue', std({ color: 0x24569a, roughness: 0.42, metalness: 0.05 }));
  def('hdpe', std({ map: T.hdpe(S, an), roughness: 0.6, metalness: 0 }));
  def('pvc', std({ color: 0x8f9396, roughness: 0.5, metalness: 0 }));
  def('porcelain', std({ color: 0xd8d6cf, roughness: 0.22, metalness: 0 }), { occluder: false });
  def('wire', std({ color: 0x3c3e40, roughness: 0.55, metalness: 0.6 }), { occluder: false });
  def('net', std({ color: 0x141614, roughness: 0.95, metalness: 0 }), { occluder: false });
  def('rubber', std({ color: 0x1c1c1c, roughness: 0.8, metalness: 0 }), { occluder: false });
  def('glassDark', std({ color: 0x1d2a33, roughness: 0.1, metalness: 0.3 }), { occluder: false });
  def('woodFill', std({ color: 0x3a2a1c, roughness: 1 }), { occluder: false });
  def('flood', std({ color: 0xf2f0e8, emissive: 0xfff2d6, emissiveIntensity: 0.0, roughness: 0.2, metalness: 0 }), { occluder: false, cast: false });
  def('lamp', std({ color: 0x8a0d0d, emissive: 0xff1a10, emissiveIntensity: 2.5, roughness: 0.25 }), { occluder: false, cast: false });

  // world-scaled repeats are applied via UVs (metres × 1/tile); texture repeat stays 1
  // water (special: animated double-sampled ripple normal)
  const waterMat = std({ map: wat.color, normalMap: wat.normal, normalScale: new THREE.Vector2(0.28, 0.28), vertexColors: true, roughness: 0.16, metalness: 0.0, envMapIntensity: 0.9 });
  waterMat.name = 'structures-water';
  const uTime = { value: 0 };
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.fragmentShader = 'uniform float uTime;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>',
      THREE.ShaderChunk.normal_fragment_maps.replace(/texture2D\(\s*normalMap\s*,\s*vNormalMapUv\s*\)/g,
        '(0.5 * (texture2D(normalMap, vNormalMapUv + vec2(uTime * 0.011, uTime * 0.006)) + texture2D(normalMap, vNormalMapUv * 1.63 + vec2(-uTime * 0.008, uTime * 0.013))))'));
  };
  waterMat.customProgramCacheKey = () => 'structures-water-v1';
  M.water = { material: waterMat, occluder: false, cast: false, receive: true };

  return { M, uTime, rep, S };
}
