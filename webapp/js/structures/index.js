// ============================================================================
//  STRUCTURES — entry point.
//  buildStructures(ctx) → { group }
//  Chimney + lattice tower, burner / thermic-fluid heater + flue, firewood,
//  ETP (clarifiers, platform, filters, dosing tanks, room, pipes), compound walls
//  with green PPGI screen, blue gate & fence, electric poles with wires & floodlight.
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Batch, boxAt } from './kit.js';
import { makeMaterials } from './materials.js';
import { buildChimney } from './chimney.js';
import { buildBurner } from './burner.js';
import { buildETP } from './etp.js';
import { buildWalls } from './walls.js';
import { buildPoles } from './poles.js';
import { logs as logsTexture } from './textures.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function buildStructures(ctx) {
  const group = new THREE.Group();
  group.name = 'structures';
  const { M, uTime, S } = makeMaterials(ctx);
  await tick();
  const B = new Batch();

  const chim = buildChimney(ctx, B);
  const wood = buildBurner(ctx, B, chim);
  await tick();
  const etp = buildETP(ctx, B);
  await tick();
  buildWalls(ctx, B);
  const wireLines = buildPoles(ctx, B);

  // firewood: dark core boxes (batched) + instanced logs
  for (const f of wood.fills) B.add('woodFill', boxAt(f.x, f.y, 0.0, f.w, f.d, f.h));
  const meshes = B.build(M, group, ctx);
  await tick();

  const logMat = new THREE.MeshStandardMaterial({ map: logsTexture(S, Math.min(8, ctx.maxAnisotropy || 4)), roughness: 0.95, metalness: 0 });
  logMat.name = 'structures-logs';
  const logs = new THREE.InstancedMesh(wood.logGeom, logMat, wood.logMatrices.length);
  wood.logMatrices.forEach((m, i) => { logs.setMatrixAt(i, m); logs.setColorAt(i, wood.logColors[i]); });
  logs.instanceMatrix.needsUpdate = true; if (logs.instanceColor) logs.instanceColor.needsUpdate = true;
  logs.castShadow = true; logs.receiveShadow = true; logs.name = 'structures:firewood';
  logs.computeBoundingSphere();
  group.add(logs);

  // clarifier water (one mesh, animated ripples in the shader)
  const water = new THREE.Mesh(mergeGeometries(etp.waterGeoms, false), M.water.material);
  etp.waterGeoms.forEach((g) => g.dispose());
  water.name = 'structures:etp-water'; water.receiveShadow = true; water.castShadow = false;
  group.add(water);
  if (wireLines) group.add(wireLines);

  // ---- animation: water ripples, blinking aviation lamps, night floodlight
  const lampMat = M.lamp.material, floodMat = M.flood.material;
  let night = isNight(ctx.sunState);
  const applySun = (s) => { night = isNight(s); floodMat.emissiveIntensity = night ? 3.0 : 0.0; };
  applySun(ctx.sunState);
  if (ctx.onSunChange) ctx.onSunChange(applySun);
  ctx.registerAnimated((dt, t) => {
    uTime.value = t;
    const phase = t % 1.5; // ~40 flashes per minute
    const on = phase < 0.55;
    lampMat.emissiveIntensity = on ? (night ? 6.0 : 3.0) : 0.08;
  });

  group.userData.meshes = meshes;
  return { group };
}

function isNight(s) { return !!(s && typeof s.elevation === 'number' && s.elevation < -1); }
