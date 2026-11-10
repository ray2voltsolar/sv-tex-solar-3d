// ============================================================================
//  BUILDINGS — entry point.  buildBuildings(ctx) → { group, byBuilding, ... }
//  Builds every entry of site.BUILDINGS from site-data (plan coords), merging
//  geometry into one mesh per (building, material). Roof-sheet CRESTS of A, C, D
//  lie exactly on site.ROOF_PLANES (pans below), so PV modules (+5 cm) fit.
// ============================================================================
import { MeshData, makePlane, pZ } from './lib.js';
import { createDetailTextures, Atlas } from './textures.js';
import { createMaterials, ROOF_ATLAS_BASE } from './materials.js';
import { buildWall, buildPlinth } from './walls.js';
import { buildRoofPlane, buildRidge, buildGutter } from './roofs.js';
import { buildOffices, buildBasicRoof, officeParapetTop } from './special.js';
import { buildVentBase, buildVentHeads } from './vents.js';

const WALL_BUCKETS = new Set(['masonry', 'block', 'clad']);
const ROOF_BUCKETS = new Set(['roofMetal', 'roofPaint', 'skylight']);
const OCCLUDER_BUCKETS = new Set(['masonry', 'block', 'clad', 'roofMetal', 'roofPaint', 'skylight', 'galv', 'plastic', 'trim']);

class Bld {
  constructor(id, K) { this.id = id; this.K = K; this.buckets = {}; }
  md(name) {
    if (!this.buckets[name]) {
      const atlas = WALL_BUCKETS.has(name) ? this.K.wallAtlas : ROOF_BUCKETS.has(name) ? this.K.roofAtlas : name === 'back' ? this.K.underAtlas : null;
      this.buckets[name] = new MeshData(name, atlas);
    }
    return this.buckets[name];
  }
}

/** Four walls around a rectangular footprint (CCW: S, E, N, W). cfg.sides[S|E|N|W] overrides. */
function rectWalls(K, Bd, f, cfg) {
  const t = 0.23;
  const defs = {
    S: { p0: [f.x0, f.y0], p1: [f.x1, f.y0], s0: 0, s1: f.x1 - f.x0 },
    E: { p0: [f.x1, f.y0], p1: [f.x1, f.y1], s0: t, s1: f.y1 - f.y0 - t },
    N: { p0: [f.x1, f.y1], p1: [f.x0, f.y1], s0: 0, s1: f.x1 - f.x0 },
    W: { p0: [f.x0, f.y1], p1: [f.x0, f.y0], s0: t, s1: f.y1 - f.y0 - t },
  };
  let seed = cfg.seed || 1;
  for (const k of ['S', 'E', 'N', 'W']) {
    const sd = cfg.sides[k];
    if (sd === null) continue;
    const c = cfg.clad ? { ...cfg.clad, ...(sd.clad || {}), breaks: sd.breaks || [] } : null;
    buildWall(K, Bd, { ...defs[k], t, mTop: cfg.mTop, masonry: cfg.masonry, clad: c, dirt: cfg.dirt, north: k === 'N', seed: seed++ * 13, ...sd, clad: sd.noClad ? null : c });
  }
}

const gableTop = (pa, pb) => (x, y) => Math.min(pZ(pa, x, y), pZ(pb, x, y));
const every = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));

export async function buildBuildings(ctx) {
  const { THREE, site } = ctx;
  const quality = ctx.quality || 'high';
  const aniso = Math.min(ctx.maxAnisotropy || 1, quality === 'high' ? 8 : 4);
  const t0 = performance.now();
  const tex = createDetailTextures(THREE, quality, aniso);
  const aSize = quality === 'low' ? 1024 : 2048;
  const K = {
    THREE, site, quality, wallAtlas: new Atlas(aSize), roofAtlas: new Atlas(aSize, 64, ROOF_ATLAS_BASE), underAtlas: new Atlas(quality === 'low' ? 512 : 1024, 16), screws: [],
    col(hex, jit = 0, rnd = Math.random) {
      const c = new THREE.Color(hex);
      if (jit) { const k = 1 + (rnd() * 2 - 1) * jit; c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k * (1 + (rnd() - 0.5) * jit * 0.3)); c.b = Math.min(1, c.b * k); }
      return c;
    },
  };
  const atl = {};
  const mats = createMaterials(THREE, tex, atl);
  K.mats = mats;
  const B = site.BUILDINGS, RP = site.ROOF_PLANES, TV = site.TURBO_VENT;
  const BL = {};
  for (const id of Object.keys(B)) BL[id] = new Bld(id, K);
  const obstaclesOn = (pid) => site.ROOF_OBSTACLES.filter((o) => o.plane === pid).map((o) => ({ u: o.u, v: o.v }));

  // ======================= BLOCK A =======================
  {
    const b = B.A, f = b.footprint, Bd = BL.A, r = b.roof;
    const pW = RP['A-W'], pE = RP['A-E'];
    const top = gableTop(pW, pE);
    // Photo-matched PPGI tones (WA0005 / WA0011): muted cerulean + warm light-grey
    // "off-white" (site-data '#2f7fd0' / '#e8eaec' render as a toy-like saturated blue / pure white).
    const blue = '#5a8fc2', white = '#c9ccc7';
    void b.walls.claddingStripes;
    const sw = b.walls.stripeWidth;
    buildPlinth(K, Bd, f, b.plinth, '#7f7b74', { seed: 11 });
    const win = (at) => ({ kind: 'window', at, w: 1.1, z0: 1.05, h: 1.4, style: 'steel', color: '#6f88a6' });
    const winS = (at) => ({ kind: 'window', at, w: 1.0, z0: 1.3, h: 1.2, style: 'steel', color: '#6f88a6' });
    const louv = (at, z0 = 5.0) => ({ kind: 'louvre', at, w: 0.95, z0, h: 0.5, color: '#9aa0a4' });
    rectWalls(K, Bd, f, {
      mTop: b.walls.masonryTopZ, masonry: { bucket: 'masonry', color: '#d8d7d0' }, dirt: 1.5, seed: 3,
      clad: { colorAt: (i) => (i % 2 ? white : blue), P: sw / 4, sheetW: sw, top, trim: '#c9ccca', dirt: 1.1, rust: 0.25, vary: 0.08,
        // deeper trapezoid (38 mm rib); crest / flank keep the 0.13 / 0.10 pitch fractions of the rib albedo map
        depth: 0.038, crest: 0.13 * sw / 4, flank: 0.1 * sw / 4 },
      sides: {
        S: { breaks: [r.ridgeX - f.x0], openings: [
          winS(20.3), { kind: 'shutter', at: 23.6, w: 3.2, z0: b.plinth, h: 3.1, color: '#a5abad', ramp: 1.3 },
          winS(26.9), { kind: 'door', at: 30.2, w: 1.5, z0: b.plinth, h: 2.25, style: 'double', color: '#6c7f93', leafColor: '#7b8ea1', ramp: 1.0 },
          winS(33.3), winS(35.8), winS(38.6), louv(26.9, 4.6), louv(35.8, 4.6)] },
        E: { openings: [win(52.3), win(54.9), louv(54.9), win(57.5), win(60.1), win(62.7), louv(62.7), win(65.0),
          { kind: 'door', at: 67.0, w: 1.2, z0: b.plinth, h: 2.3, style: 'double', color: '#6c7f93', leafColor: '#7b8ea1', ramp: 0.9 }] },
        N: { breaks: [f.x1 - r.ridgeX], openings: [win(21.4), win(24.8), louv(24.8, 5.3), win(28.2), win(31.4), win(34.8), louv(34.8, 5.3), win(38.3)] },
        W: { openings: [win(52.6), win(55.4), win(58.2), louv(58.2), win(61.0), win(63.8), win(66.4)] },
      },
    });
    const roofO = (pl, seed) => ({
      bucket: 'roofMetal', color: '#9da2a3', vary: 0.04, replaced: 0.1, replacedColor: '#aab0b0', seed, purlinInset: r.overhang.gables + 0.05,
      skylight: { every: 4, phase: 1, t0: 1.5, t1: 1.3 }, trimBucket: 'galv', trimColor: '#aeb2b3', underColor: '#6f777c',
      // WA0005: plain sheet ends at the eave, no cantilever brackets / fascia
      tWall: r.overhang.eaves / Math.cos(Math.atan(r.pitch)), brackets: null, laps: [],
      screwTone: 0.72, edges: { s0: 'verge:0.09', s1: 'verge:0.09' }, grime: { dirt: 1.1, dust: 0.85, rust: 0.08, chalk: 0.12, droppings: 0.4 },
    });
    buildRoofPlane(K, Bd, pW, roofO(pW, 101));
    buildRoofPlane(K, Bd, pE, roofO(pE, 102));
    buildRidge(K, Bd.md('galv'), { axis: 'NS', at: r.ridgeX, z: r.ridgeZ, from: f.y0 - r.overhang.gables, to: f.y1 + r.overhang.gables, pitch: r.pitch }, K.col('#b4b8b9'));
    // (no eave gutters / downpipes on Block A — none in WA0005 / WA0011)
  }

  // ======================= BLOCK C =======================
  {
    const b = B.C, f = b.footprint, Bd = BL.C, r = b.roof;
    const pW = RP['C-W'], pE = RP['C-E'];
    const top = gableTop(pW, pE);
    buildPlinth(K, Bd, f, b.plinth, '#8a867f', { seed: 21 });
    const win = (at, z0 = 1.0) => ({ kind: 'window', at, w: 1.2, z0, h: 1.2, style: 'glass', color: '#5f6f7a' });
    const louv = (at, z0 = 4.0) => ({ kind: 'louvre', at, w: 1.2, z0, h: 0.6, color: '#8a9196' });
    rectWalls(K, Bd, f, {
      mTop: b.walls.masonryTopZ, masonry: { bucket: 'masonry', color: b.walls.masonry }, dirt: 1.35, seed: 5,
      clad: { colorAt: () => b.walls.cladding, P: 0.25, sheetW: 1.0, top, trim: '#8e979e', dirt: 1.2, rust: 0.55, vary: 0.06 },
      sides: {
        S: { breaks: [r.ridgeX - f.x0], openings: [win(3.0, 1.2), win(8.7, 1.2), win(14.3, 1.2)] },
        E: { cornerEnd: false, openings: [
          { kind: 'door', at: 13.7, w: 1.2, z0: b.plinth, h: 2.2, style: 'double', color: '#56606a', leafColor: '#65717c', ramp: 0.8 },
          win(18.6, 1.4), win(23.4, 1.4),
          { kind: 'shutter', at: 27.8, w: 3.0, z0: b.plinth, h: 3.0, color: '#9ea4a6', ramp: 1.2 }, louv(20.5, 3.4)] },
        N: { breaks: [f.x1 - r.ridgeX], cornerStart: false, cornerEnd: false, openings: [] },
        W: { cornerStart: false, openings: [win(14.6), win(17.8), louv(16.2), win(21.0), win(24.2), louv(22.6), win(27.4), win(30.0), louv(28.7)] },
      },
    });
    const obs = { 'C-W': obstaclesOn('C-W'), 'C-E': obstaclesOn('C-E') };
    const roofO = (pl, seed) => ({
      bucket: 'roofMetal', color: '#a4a8a6', vary: 0.07, replaced: 0.12, replacedColor: '#c6cbcb', rusty: 0.25, seed,
      // translucent FRP daylight sheets (WA0002 interior), yellowed with age
      skylight: { every: 5, phase: 2, t0: 2.2, t1: 2.6 }, skyColor: '#c2bfa2',
      trimBucket: 'galv', trimColor: '#a9adab', underColor: '#7d807e', obstacles: obs[pl.id],
      tWall: r.overhang.eaves / Math.cos(Math.atan(r.pitch)), brackets: every(r.overhang.gables, pl.width - r.overhang.gables, 5),
      edges: { s0: 'verge', s1: 'verge' }, grime: { dirt: 1.4, dust: 0.8, rust: 0.7, moss: 0.25 },
    });
    buildRoofPlane(K, Bd, pW, roofO(pW, 201));
    buildRoofPlane(K, Bd, pE, roofO(pE, 202));
    buildRidge(K, Bd.md('galv'), { axis: 'NS', at: r.ridgeX, z: r.ridgeZ, from: f.y0 - r.overhang.gables, to: f.y1 + r.overhang.gables, pitch: r.pitch }, K.col('#a9adab'));
    const oh = r.overhang.eaves;
    const zBasic = B.BASIC_ROOF.roof.highEdgeZ;
    buildGutter(K, Bd, pW, { s0: 0, s1: pW.width, bucket: 'galv', color: '#a7aba9', downs: [{ s: 1.4, wallOff: oh }, { s: pW.width - 1.6, wallOff: oh }] });
    buildGutter(K, Bd, pE, { s0: 0, s1: pE.width, bucket: 'galv', color: '#a7aba9', downs: [{ s: 4.5, wallOff: oh, endZ: zBasic }, { s: pE.width - 3.5, wallOff: oh, endZ: zBasic }] });
  }

  // ======================= BLOCK D =======================
  {
    const b = B.D, f = b.footprint, Bd = BL.D, r = b.roof;
    const pl = RP['D-S'];
    const top = (x, y) => pZ(pl, x, y);
    buildPlinth(K, Bd, f, b.plinth, '#8c8881', { seed: 31 });
    const win = (at, z0 = 1.1) => ({ kind: 'window', at, w: 1.2, z0, h: 1.2, style: 'glass', color: '#56707f' });
    const louv = (at, z0 = 3.6) => ({ kind: 'louvre', at, w: 1.2, z0, h: 0.6, color: '#8f9aa2' });
    rectWalls(K, Bd, f, {
      mTop: b.walls.masonryTopZ, masonry: { bucket: 'masonry', color: b.walls.masonry }, dirt: 1.2, seed: 7,
      clad: { colorAt: () => b.walls.cladding, P: 0.25, sheetW: 1.0, top, trim: '#8a99a5', dirt: 1.0, rust: 0.35, vary: 0.05 },
      sides: {
        S: { openings: [win(2.5), louv(4.3), win(6.2), win(9.9), louv(11.7), win(13.6), win(17.0)] },
        E: { openings: [win(2.0), { kind: 'shutter', at: 6.2, w: 3.0, z0: b.plinth, h: 2.9, color: '#a0a6a8', ramp: 1.2 }, win(10.2), louv(10.2, 4.0)] },
        N: { openings: [win(3.5, 1.5), win(9.3, 1.5), win(15.0, 1.5), louv(6.4, 4.4), louv(12.2, 4.4)] },
        W: { openings: [win(2.5), win(6.0), louv(6.0), win(9.5)] },
      },
    });
    buildRoofPlane(K, Bd, pl, {
      bucket: 'roofPaint', color: '#3f7856', vary: 0.05, replaced: 0.07, replacedColor: '#4c8a64', seed: 301,
      skylight: { every: 6, phase: 3, t0: 3.2, t1: 2.8 }, skyColor: '#c6c4a8',
      trimColor: '#3a6e50', underColor: '#c7c8c1', obstacles: obstaclesOn('D-S'),
      tWall: r.overhang.south / Math.cos(Math.atan(r.pitch)), brackets: every(r.overhang.verges, pl.width - r.overhang.verges, 5),
      edges: { s0: 'verge', s1: 'verge', high: 'flash' }, grime: { dirt: 1.1, dust: 0.7, rust: 0.15, moss: 0.3, chalk: 0.6 },
    });
    buildGutter(K, Bd, pl, { s0: 0, s1: pl.width, color: '#3a6e50', downs: [{ s: 1.3, wallOff: r.overhang.south }, { s: pl.width - 1.3, wallOff: r.overhang.south }] });
  }

  // ======================= BLOCK B =======================
  {
    const b = B.B, f = b.footprint, Bd = BL.B, r = b.roof;
    const zE = r.wallLineZ - r.overhang.north * r.pitch;
    const pN = makePlane({ id: 'B-N', eaveStart: [f.x0 - r.overhang.verges, f.y1 + r.overhang.north, zE], eaveEnd: [f.x1, f.y1 + r.overhang.north, zE], highStart: [f.x0 - r.overhang.verges, r.ridgeY, r.ridgeZ] });
    const pS = makePlane({ id: 'B-S', eaveStart: [f.x0 - r.overhang.verges, f.y0, r.wallLineZ], eaveEnd: [f.x1, f.y0, r.wallLineZ], highStart: [f.x0 - r.overhang.verges, r.ridgeY, r.ridgeZ] });
    const top = gableTop(pN, pS);
    buildPlinth(K, Bd, { x0: f.x0, y0: f.y0 + 0.08, x1: f.x1, y1: f.y1 }, b.plinth, '#8c8881', { seed: 41 });
    rectWalls(K, Bd, f, {
      mTop: b.walls.masonryTopZ, masonry: { bucket: 'masonry', color: b.walls.masonry }, dirt: 1.2, seed: 9,
      clad: { colorAt: () => b.walls.cladding, P: 0.25, sheetW: 1.0, top, trim: '#557599', dirt: 1.0, rust: 0.3, vary: 0.05 },
      sides: {
        S: null, // Block C's north wall
        E: { s0: 0, cornerStart: false, breaks: [r.ridgeY - f.y0], openings: [
          { kind: 'door', at: 34.3, w: 1.8, z0: b.plinth, h: 2.05, style: 'double', color: '#50677f', leafColor: '#5d7690' },
          { kind: 'window', at: 32.1, w: 0.9, z0: 1.2, h: 0.9, style: 'glass', color: '#50677f' }] },
        N: { mTop: officeParapetTop(B.OFFICES), openings: [] },
        W: { s1: f.y1 - f.y0, cornerEnd: false, breaks: [f.y1 - r.ridgeY], openings: [{ kind: 'window', at: 34.1, w: 1.2, z0: 1.0, h: 1.2, style: 'glass', color: '#50677f' }] },
      },
    });
    // s0 of each plane: which end is west?
    const edgesFor = (pl) => (pl.eaveStart[0] < 5 ? { s0: 'verge', s1: null } : { s0: null, s1: 'verge' });
    buildRoofPlane(K, Bd, pN, { bucket: 'roofPaint', color: '#3d6ea8', vary: 0.05, replaced: 0.06, replacedColor: '#4a7cb8', seed: 401,
      trimColor: '#3a68a0', underColor: '#c9cac4', tWall: r.overhang.north / Math.cos(Math.atan(r.pitch)), brackets: every(0.3, pN.width - 0.1, 4),
      edges: { ...edgesFor(pN) }, grime: { dirt: 1.2, dust: 0.8, rust: 0.2, chalk: 0.7 } });
    buildRoofPlane(K, Bd, pS, { bucket: 'roofPaint', color: '#3d6ea8', vary: 0.05, replaced: 0.06, replacedColor: '#4a7cb8', seed: 402,
      trimColor: '#3a68a0', underColor: '#c9cac4', edges: { ...edgesFor(pS), low: 'apron:-0.065' }, grime: { dirt: 1.3, dust: 0.9, rust: 0.2, moss: 0.3, chalk: 0.7 } });
    buildRidge(K, Bd.md('trim'), { axis: 'EW', at: r.ridgeY, z: r.ridgeZ, from: f.x0 - r.overhang.verges, to: f.x1, pitch: r.pitch }, K.col('#3a68a0'));
    const yW = (pN.eaveStart[0] < 5);
    buildGutter(K, Bd, pN, { s0: 0, s1: pN.width, color: '#3a68a0',
      downs: [{ s: yW ? 2.0 : pN.width - 2.0, wallOff: r.overhang.north, endZ: B.OFFICES.roof.slabTopZ }, { s: yW ? 12.5 : pN.width - 12.5, wallOff: r.overhang.north, endZ: B.OFFICES.roof.slabTopZ }] });
  }

  // ======================= OFFICES =======================
  buildOffices(K, BL.OFFICES, B.OFFICES);

  // ======================= BASIC ROOF =======================
  buildBasicRoof(K, BL.BASIC_ROOF, B.BASIC_ROOF, B);

  // ======================= DYEING SHED =======================
  {
    const b = B.DYEING_SHED, f = b.footprint, Bd = BL.DYEING_SHED, r = b.roof, oh = r.overhang;
    const zEave = r.wallLineZ - oh.eaves * r.pitch;
    const y0 = f.y0 - oh.gables, y1 = f.y1 + oh.gables, xW = f.x0 - oh.eaves, xE = f.x1 + oh.eaves;
    const pW = makePlane({ id: 'DY-W', eaveStart: [xW, y1, zEave], eaveEnd: [xW, y0, zEave], highStart: [r.ridgeX, y1, r.ridgeZ] });
    const pE = makePlane({ id: 'DY-E', eaveStart: [xE, y0, zEave], eaveEnd: [xE, y1, zEave], highStart: [r.ridgeX, y0, r.ridgeZ] });
    const top = gableTop(pW, pE);
    buildPlinth(K, Bd, f, b.plinth, '#8c8881', { seed: 51 });
    const win = (at, z0 = 1.0, w = 1.4) => ({ kind: 'window', at, w, z0, h: 1.1, style: 'glass', color: '#4f6d86' });
    const louv = (at, z0 = 3.4) => ({ kind: 'louvre', at, w: 1.4, z0, h: 0.7, color: '#7f8f9c' });
    const sh = (at) => ({ kind: 'shutter', at, w: 3.0, z0: b.plinth, h: 2.9, color: '#9ea4a6', ramp: 1.0 });
    rectWalls(K, Bd, f, {
      mTop: b.walls.masonryTopZ, masonry: { bucket: 'masonry', color: b.walls.masonry }, dirt: 1.4, seed: 11,
      clad: { colorAt: () => b.walls.cladding, P: 0.25, sheetW: 1.0, top, trim: '#46709f', dirt: 1.1, rust: 0.3, vary: 0.05 },
      sides: {
        S: { breaks: [r.ridgeX - f.x0], openings: [win(30.0), win(33.5), win(37.0), louv(33.5, 3.6)] },
        E: { openings: [win(3.0, 1.4, 1.2), win(8.0, 1.4, 1.2), win(13.0, 1.4, 1.2), win(18.0, 1.4, 1.2), win(23.0, 1.4, 1.2), louv(5.5), louv(15.5)] },
        N: { breaks: [f.x1 - r.ridgeX], openings: [win(29.6), sh(33.5), win(37.4), louv(33.5, 4.3)] },
        W: { openings: [win(1.8), sh(4.4), win(7.4), louv(10.0), win(13.0), sh(16.4), win(20.0), louv(22.3), win(23.8)] },
      },
    });
    // weathered blue PPGI (WA0010 / satellite): dusty, chalked upper slopes, down-slope streaks, laps every ~3.3 m
    const roofO = (pl, seed) => ({ bucket: 'roofPaint', color: '#3c6798', vary: 0.045, replaced: 0.07, replacedColor: '#4a78ac', seed,
      trimColor: '#5d7fa6', underColor: '#a9aea9', tWall: oh.eaves / Math.cos(Math.atan(r.pitch)), brackets: every(oh.gables, pl.width - oh.gables, 7),
      laps: [pl.length * 0.5], edges: { s0: 'verge', s1: 'verge' }, grime: { dirt: 1.5, dust: 1.2, rust: 0.3, chalk: 1.0, droppings: 1.0 } });
    buildRoofPlane(K, Bd, pW, roofO(pW, 501));
    buildRoofPlane(K, Bd, pE, roofO(pE, 502));
    buildRidge(K, Bd.md('galv'), { axis: 'NS', at: r.ridgeX, z: r.ridgeZ, from: y0, to: y1, pitch: r.pitch, wide: 1.5 }, K.col('#9ea6ab'));
    buildGutter(K, Bd, pW, { s0: 0, s1: pW.width, color: '#3a679c', downs: [1.5, pW.width / 2, pW.width - 1.5].map((s) => ({ s, wallOff: oh.eaves })) });
    buildGutter(K, Bd, pE, { s0: 0, s1: pE.width, color: '#3a679c', downs: [1.5, pE.width / 2, pE.width - 1.5].map((s) => ({ s, wallOff: oh.eaves })) });
  }

  // ======================= TURBO VENTS (bases) =======================
  for (const o of site.ROOF_OBSTACLES) {
    if (o.type !== 'turbo') continue;
    buildVentBase(K, BL[RP[o.plane].building].md('galv'), o, RP[o.plane], TV);
  }

  // ======================= finalise =======================
  const wt = K.wallAtlas.finalize(THREE, aniso), rt = K.roofAtlas.finalize(THREE, aniso);
  atl.wallUniform.value = wt; atl.roofUniform.value = rt;
  atl.underUniform.value = K.underAtlas.finalize(THREE, Math.min(aniso, 4));

  const group = new THREE.Group(); group.name = 'buildings';
  const byBuilding = {}, roofMeshes = {}, occluders = [];
  let tris = 0, draws = 0;
  for (const [id, Bd] of Object.entries(BL)) {
    const g = new THREE.Group(); g.name = `building-${id}`; g.userData = { buildingId: id, name: B[id].name, use: B[id].use, dims: B[id].dims };
    roofMeshes[id] = [];
    for (const [bucket, mdat] of Object.entries(Bd.buckets)) {
      if (!mdat.vertexCount) continue;
      const mesh = new THREE.Mesh(mdat.toGeometry(THREE), mats[bucket]);
      mesh.name = `${id}-${bucket}`;
      mesh.castShadow = bucket !== 'glass'; mesh.receiveShadow = true;
      mesh.userData = { buildingId: id, bucket };
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      g.add(mesh);
      tris += mdat.vertexCount / 3; draws++;
      if (OCCLUDER_BUCKETS.has(bucket)) occluders.push(mesh);
      if (ROOF_BUCKETS.has(bucket)) roofMeshes[id].push(mesh);
    }
    group.add(g); byBuilding[id] = g;
  }

  // decals etc. (own materials)
  for (const { id, mesh } of K.extraMeshes || []) {
    mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
    (byBuilding[id] || group).add(mesh); draws++; tris += 2;
  }

  // fasteners (one InstancedMesh for every roof)
  if (K.screws.length) {
    const sg = new THREE.CylinderGeometry(0.0075, 0.0075, 0.008, 6); sg.translate(0, 0.004, 0);
    const im = new THREE.InstancedMesh(sg, mats.screw, K.screws.length);
    im.name = 'roofFasteners'; im.castShadow = false; im.receiveShadow = true;
    const m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    K.screws.forEach((s, i) => {
      X.set(s.u[0], s.u[2], -s.u[1]); Y.set(s.n[0], s.n[2], -s.n[1]); Z.crossVectors(X, Y);
      m.makeBasis(X, Y, Z).setPosition(s.p[0], s.p[2], -s.p[1]); im.setMatrixAt(i, m);
      if (s.c) im.setColorAt(i, s.c);
    });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im); draws++; tris += 12 * K.screws.length;
  }

  // turbo vent heads
  const vents = buildVentHeads(K, mats, site.ROOF_OBSTACLES.filter((o) => o.type === 'turbo'), TV);
  group.add(vents.mesh); draws++;
  tris += vents.mesh.geometry.attributes.position.count / 3 * vents.mesh.count;
  ctx.registerAnimated && ctx.registerAnimated((dt) => vents.update(dt));
  occluders.push(vents.mesh);
  for (const o of occluders) ctx.registerOccluder && ctx.registerOccluder(o);

  const stats = { triangles: Math.round(tris), drawCalls: draws, buildMs: Math.round(performance.now() - t0), wallAtlasPxPerM: +K.wallAtlas.density.toFixed(1), roofAtlasPxPerM: +K.roofAtlas.density.toFixed(1) };
  console.log('[buildings]', JSON.stringify(stats));
  return { group, byBuilding, roofMeshes, ventHeads: vents.mesh, occluders, stats };
}
