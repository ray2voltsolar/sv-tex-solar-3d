# 3D Solar Proposal Webapp — Sri Venkateswara Tex Process, Nagari (AP)

A photoreal, interactive three.js web app showing the customer's textile-dyeing factory with a
**145.08 kWp rooftop PV system (234 × Vikram Solar HYPERSOL G12R 620 Wp)**. It is used by Ray2Volt Solar's
sales team to present the proposal to the customer: they must be able to zoom, orbit, pan, switch
perspective/orthographic, jump to preset views, scrub date/time to watch real shadows, and run a
shading analysis. **It must look as realistic as possible** — architectural-visualisation quality,
dusty/weathered Indian industrial character, accurate to the photos and the measured sketch.

Project root: `C:\Users\harsh\OneDrive\Desktop\Venkateswara text process 3d`
Web root (served): `webapp/` → **http://127.0.0.1:8765/** (a static server is ALREADY running; never start/stop it)

## 0. Ground rules (all agents)
- **No build step.** Plain ES modules + the import map below. three.js **0.170.0** from jsdelivr, exact URLs:
  ```json
  { "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/",
      "three-mesh-bvh": "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.8.3/build/index.module.js" } }
  ```
- **No downloaded assets** (no GLTF/HDRI/image files from the internet). All textures are generated
  procedurally at runtime (CanvasTexture / DataTexture / shaders). The only runtime network fetches allowed are the
  CDN modules above and Esri World Imagery tiles (environment agent).
- **Only edit files you own** (see §4). `webapp/js/site-data.js` and `webapp/js/analysis/sun.js` are shared,
  read-only contracts (the analysis agent may fix bugs in `sun.js`). If you believe site-data is wrong, say so in
  your final report instead of editing it.
- All geometry comes from `webapp/js/site-data.js` (read it fully first). **Coordinates:** site-data uses PLAN
  coords `x = East, y = North, z = Up` (metres, origin = SW wall corner of Block D). three.js world is
  `X = East, Y = Up, Z = South`, i.e. **world = (x, z, -y)**. Use `planToWorld(THREE, x, y, z)` / `planToWorldArray`.
- Builders must NOT add scene lights, sky, fog, tone mapping or post-processing — the core app owns lighting.
  (Small emissive accents, e.g. an aviation lamp, are fine; at most 1–2 non-shadow PointLights per module.)
- Every mesh: `castShadow = true; receiveShadow = true` (except tiny details/glass where it hurts).
  Register shading-relevant meshes with `ctx.registerOccluder(mesh)` (roofs, walls, chimney, tanks, trees' crowns, modules…).
- Performance budget for the whole scene: **≤ 1.5 M triangles, ≤ 250 draw calls** on "high". Merge static
  geometry per material (`BufferGeometryUtils.mergeGeometries`), use `InstancedMesh` for repeats, share materials.
  Support `ctx.quality` = `'high' | 'medium' | 'low'` (reduce texture sizes / detail on lower settings).
- Materials: `MeshStandardMaterial` / `MeshPhysicalMaterial` (PBR). Textures with colour data must use
  `colorSpace = THREE.SRGBColorSpace`; normal/roughness maps linear. Set anisotropy to `ctx.maxAnisotropy` on
  ground/roof textures. Use real-world texture scales (e.g. trapezoidal rib pitch ≈ 0.25 m, brick 0.23 × 0.075 m).
- Realism checklist: correct proportions & scale; bevels / thickness on edges (no paper-thin planes visible);
  weathering (dust, rain streaks, rust spots, stains at wall bases); colour variation between sheets; nothing floats
  or intersects badly; no z-fighting (offset coplanar layers by ≥ 5 mm or use polygonOffset).
- **Zero console errors.** Don't leave debug helpers in the scene.

## 1. Reference material (look at these images with the Read tool)
| File (project root) | Shows |
|---|---|
| `IMG-20261109-WA0023.jpeg` | **Measured layout sketch**. Page-up = WEST, page-right = NORTH. Block D 61'×39', Block C 61'×57', Block A 71'×59', Block B + bathrooms/office 2/office 1 strip north of C, "basic roof" with wood burner east of C, dyeing point east, entrance east side between dyeing point and Block A. All encoded in site-data. |
| `IMG-20261109-WA0005.jpg.jpeg`, `IMG-20261109-WA0011.jpg.jpeg` | **Block A** exterior: white masonry lower walls with blue-grey steel windows/doors, upper PPGI cladding in alternating blue / off-white vertical bands, low-pitch zincalume roof, concrete electric pole with floodlight & meter box at the corner, blue sheet fence, coconut palms behind, weedy field, Tata-Ace-like mini truck and a steel water-tanker trailer. |
| `IMG-20261109-WA0002.jpg.jpeg` | Block C interior: steel lattice trusses, purlins, weathered zincalume/translucent roof sheets. |
| `IMG-20261109-WA0006.jpg.jpeg` | Block B interior: dark weathered roof sheets on painted steel purlins, blue corrugated wall sheets, winding machines. |
| `IMG-20261109-WA0003.jpg.jpeg` | Looking south down the "basic roof" passage: low sheet lean-to roof, office (white wall) on the right, burner (wood) and Block B entrance ahead, **chimney** (black/white banded stack inside a lattice tower) behind. Wet concrete floor. |
| `IMG-20261109-WA0007.jpg.jpeg` | Office (white plaster, door) and Office 2 (grey hollow concrete blocks, window) facing the lane; blue roof of Block B above; blue sheet gate/fence. |
| `IMG-20261109-WA0009.jpg.jpeg` | From outside the white compound wall with green PPGI sheet screen above it (two horizontal bands): ETP/dyeing equipment platform with handrails, a vertical vessel with a blue gear motor on top, chimney behind. Motorbikes parked outside. |
| `IMG-20261109-WA0010.jpg.jpeg` | From the open field EAST of the site looking west: long compound wall + green sheet screen, chimney (~30 m) left, dyeing roof, equipment with railings right, entrance gate at right, Block A at far right, silver sedans parked in the field, palm trees. |

Satellite (Google 2026, Esri): Block A roof has a **N–S ridge** with skylight bands across the slopes; Block C grey
roof with 6 turbo ventilators; Block D green roof with 4 turbo ventilators in a row near its north edge; a
yellow-green lean-to strip east of C; 3 circular ETP clarifiers in the NE corner; the site sits among scattered
low RCC houses (S & W), trees (E, N), and a dirt road on the east. Location: 13.3127 N, 79.5703 E.

## 2. The PV system (already computed in site-data — do not change)
- `computeLayout()` → 234 modules: A-W 60, A-E 60 (Block A, E/W slopes), C-E 40, C-W 26 (Block C, avoiding turbo
  vents), D-S 48 (Block D, south-facing). Portrait, 20 mm clamp gaps, 0.6 m GI walkway between row groups
  (`computePlaneSlots(planeId).walkwaysV`). Each module has `corners` (top-glass corners, plan coords),
  `center`, plane axes `u` (along eave), `v` (up-slope), `n` (normal), `string` (S01–S13), `inverter`.
- 13 strings, 2 × 60 kWac inverters at `INVERTER_STATION` (north wall of Office 1, facing the lane).
- `systemSummary()` → 145.08 kWp, ≈ 2,05,800 kWh/yr (PVGIS-ERA5), specific yield ≈ 1418, CO₂ ≈ 146 t/yr.
- Module: 2384 × 1134 × 30 mm, 132 half-cut G12R cells (6 × 22, split into two halves of 11 rows at mid-length),
  silver anodised frame, glass-glass bifacial (gaps between cells look light/see-through), 16 BB fine busbars.

## 3. Runtime contract
`main.js` creates the renderer/scene and calls each builder with one shared `ctx`:
```js
ctx = {
  THREE,                       // three namespace
  scene, renderer, camera,     // camera may be swapped by core; don't cache it for logic
  site,                        // import * as site from './site-data.js'
  quality: 'high'|'medium'|'low',
  maxAnisotropy,
  registerOccluder(mesh),      // mesh (or InstancedMesh) to include in shading analysis
  registerAnimated(fn),        // fn(dtSeconds, elapsedSeconds) every frame
  sunState,                    // { azimuth, elevation, dirWorld: THREE.Vector3 (to the sun), date } — kept current by core
  onSunChange(fn),             // subscribe: fn(sunState) when date/time changes
}
```
Builder entry points (async, return objects; add nothing to the scene yourself — return `group`):
| Module (owner) | Entry | Returns |
|---|---|---|
| `js/buildings/index.js` | `buildBuildings(ctx)` | `{ group, byBuilding: {A, B, C, D, OFFICES, BASIC_ROOF, DYEING_SHED} (Groups) }` |
| `js/solar/index.js` | `buildSolar(ctx)` | `{ group, modules, moduleMesh, setColorMode(mode, values?), setVisible(bool), highlight(index|null), pick(raycaster) → index|null, info(index) → {id, string, inverter, plane, azimuthDeg, tiltDeg, wp} }` — modes `'normal' | 'strings' | 'heatmap'` (values: Float array 0..1 per module index; 0 = unshaded) |
| `js/structures/index.js` | `buildStructures(ctx)` | `{ group }` |
| `js/env/index.js` | `buildEnvironment(ctx)` | `{ group, setSatelliteVisible(bool), setVegetationVisible(bool), setVehiclesVisible(bool), attribution }` |
| `js/analysis/sunpath.js` | `createSunPath(ctx)` | `{ group, update(date), setVisible(bool) }` |
| `js/analysis/shading.js` | `createShadingAnalyzer(ctx, { modules, occluders })` | `{ runDay({year,month,day}, opts, onProgress) → Promise<Result>, runYear(opts, onProgress) → Promise<Result>, cancel() }` |

`main.js` sets `window.__ready = true` after the first rendered frames and exposes
`window.__app = { THREE, scene, renderer, controls, get camera(), setView(name), setTime(isoLocal), setQuality(q), setLayer(name, bool), results }`.

## 4. Ownership & detailed requirements

### 4.1 CORE app — owns `webapp/index.html`, `webapp/css/*`, `webapp/js/main.js`, `webapp/js/core/*`
- Renderer: `WebGLRenderer` (powerPreference high-performance), sRGB output, **AgX or ACESFilmic** tone mapping
  (tune exposure for a sunny Indian day; avoid washed-out), `PCFSoftShadowMap` (or VSM) with shadow map 4096 (high) /
  2048 (medium) / 1024 (low) fitted tightly to the site (≈ x −15…60, y −10…80; tighten bias/normalBias so low-pitch
  roofs have no acne and modules cast crisp contact shadows).
- Sky: `three/addons/objects/Sky.js` driven by the real sun (`js/analysis/sun.js`, site lat/lng, IST); PMREM env map
  regenerated from the sky when the sun moves > ~1° (throttled). Sun `DirectionalLight` colour/intensity vary with
  elevation (warm & weak near the horizon; night = sun below horizon → dim moonlight-blue ambient, dark sky).
  Hemisphere fill. Light haze (`FogExp2`) matched to the horizon colour.
- Post-processing (EffectComposer): RenderPass → GTAOPass (high only) → subtle UnrealBloom (glints, optional) →
  OutputPass → SMAA (or FXAA on low). Quality presets High / Medium / Low with auto-pick (Low/Medium on mobile).
- Cameras & controls: Perspective (fov ~40) **and** Orthographic, toggle keeps the same view direction & framing.
  OrbitControls: damping, zoom-to-cursor, pan (right-drag / two-finger), min/max distance, no going below ground.
  Smooth animated transitions (~1.2 s, ease-in-out) between preset views:
  Overview (aerial from SE), Top/Plan (ortho, north up), Elevations N/S/E/W (ortho), Roof close-ups for Block A, C, D,
  Entrance street view (eye height 1.6 m at the gate looking west into the lane), Photo-match views
  (≈ WA0010: from the east field ~(62, 20, 1.6) looking west; ≈ WA0011: ~(58, 46, 1.6) looking NW at Block A),
  Drone orbit (auto-rotate around the site).
- UI (polished, professional, glass-panel style; brand line "Prepared by Ray2Volt Solar" from `PROJECT.preparedBy`):
  * Header: customer name, location, "145.08 kWp Rooftop Solar PV".
  * **Summary card**: 234 × Vikram Solar HYPERSOL 620 Wp, 145.08 kWp, per-roof table (Block A 120 / 74.40 kWp,
    Block C 66 / 40.92 kWp, Block D 48 / 29.76 kWp), 13 strings, 2 × 60 kW inverters, DC/AC 1.21, annual generation
    (Indian format: 2,05,800 kWh), specific yield, CO₂ avoided, a monthly generation bar chart (inline SVG) — all from
    `systemSummary()`.
  * **Layers**: Solar modules, String colours, Labels, Satellite context, Vegetation, Vehicles, Sun path, Shadows, Compass.
  * **Sun & shadows**: date picker, time slider (05:30–19:00 IST, 5-min steps), play/pause day animation with speed,
    quick dates (20 Mar, 21 Jun, 22 Sep, 21 Dec), live readout (sun azimuth/elevation, sunrise/sunset).
    **Shade analysis**: buttons "Analyse this day" / "Analyse full year" → progress bar → heatmap on modules +
    legend + results (array shading loss %, worst modules, per-roof) + "shading-adjusted annual kWh". Clear button.
  * **Views**: preset buttons + Perspective/Orthographic toggle.
  * **Tools**: Screenshot (PNG at 2× resolution, downloaded by the browser when the user clicks), Measure distance
    (click two points on any surface → line + label in metres & feet), Fullscreen, Reset view, Quality selector.
  * Hover a module → tooltip (id, string, inverter, roof, azimuth/tilt, 620 Wp). Click a building → info card
    (name, use, dimensions from site-data).
  * CSS2D labels from `site.LABELS` (roof labels include module count & kWp), compass rose (rotates with the camera),
    scale bar in ortho mode, loading screen with progress, small attribution footer for imagery.
  * Responsive (collapsible side panel; bottom sheet on phones), keyboard shortcuts (1–9 views, O ortho, Space play).
- Load builders with **dynamic `import()` each wrapped in try/catch** so one failing module shows a toast instead of
  breaking the app. Keep everything working when a module is missing.

### 4.2 BUILDINGS — owns `webapp/js/buildings/*`
- Build every entry in `site.BUILDINGS` with walls, plinths, roofs, openings and trim. **Roof-sheet crest surface must
  coincide with `site.ROOF_PLANES` (±1 cm)** for A, C, D (modules sit on it); sheet body/ribs go *below* the crest plane.
  For B, offices, basic roof and dyeing shed derive roofs from their `roof` data the same way.
- Roofs: trapezoidal profiled sheets, ribs running up-slope; real geometry at visible edges (corrugated eave/verge
  profile, sheet thickness) + procedural normal/roughness maps; ridge capping, verge/barge flashing, gutters with
  downpipes, fascia; sheet-to-sheet colour variation & weathering. Block A: zincalume with translucent skylight strips
  (several bands across each slope). C: weathered zincalume. D: green PPGI. B & dyeing shed: blue PPGI.
  Basic roof: dusty light grey-green lean-to on steel pipe columns (open sides).
- Turbo ventilators at `site.ROOF_OBSTACLES` (`TURBO_VENT` sizes): curved-vane turbine heads with base flashing,
  slowly spinning (`registerAnimated`).
- Walls: Block A exactly like the photos (white masonry lower part to `masonryTopZ` with blue-grey steel windows and
  doors, upper PPGI vertical cladding in alternating blue/off-white bands, gable triangles clad). B/C/D/dyeing shed:
  masonry base + profiled sheet cladding in the given colours, with rolling shutters / doors where sensible (C/B
  entrances facing the basic-roof passage, A doors on the south/lane side), windows, louvres. Offices: RCC flat roof
  with parapet & coping, plaster / exposed grey hollow blocks per room, doors+windows facing north with chajjas
  (sunshades), a black 1000 L water tank on the bathroom roof. Weathering everywhere (stains, streaks, damp bases).
- Steel trusses/purlins only where visible (open basic-roof shed, roof overhang undersides).

### 4.3 SOLAR — owns `webapp/js/solar/*`
- Photoreal module: mitred silver anodised frame (real L-profile, 35 mm face, 30 mm deep), glass with clearcoat &
  sky reflections, cell texture (canvas, ≥ 2048 px on the long side on high): 6 × 22 half-cut dark blue-black TOPCon
  cells, 16 fine busbars + thin fingers hint, light inter-cell gaps (glass-glass), mid-length split; back side with
  3 split junction boxes + cables. Distance-appropriate (mipmaps/anisotropy; no moiré).
- Mounting: aluminium mini-rails under inter-module gaps at ¼ and ¾ of module length, mid & end clamps; GI grating
  walkways on the walkway strips; perforated GI cable trays along walkways to the roof edge and down the wall to the
  inverter station; ESE lightning-arrester masts (~3.5 m above ridge) on Block A and C ridges with down conductors.
- Inverter station at `INVERTER_STATION`: 2 string inverters (finned heat-sink housings, display, connectors), ACDB
  panel, GI frame, small sheet canopy, earthing pits (small chambers) nearby.
- `InstancedMesh` for modules/frames/rails/clamps. `setColorMode('strings')` tints modules by `STRING_COLORS`
  (still readable as panels); `'heatmap'` colours by value (0 green → 0.5 yellow → 1 red) with emissive boost so it
  reads under any lighting; `'normal'` restores the photoreal look. Register module glass as occluder.

### 4.4 STRUCTURES — owns `webapp/js/structures/*`
- **Chimney** (`FEATURES.chimney`, a key landmark): 0.75 m steel stack, dark-navy/white bands (top band dark), inside a
  square tapering lattice tower (angle legs, horizontal + X bracing every 2.5 m), cat ladder with hoops, top platform
  with railing, red aviation lamp (blinking emissive), concrete pedestal; insulated flue duct from the burner.
- Burner (`FEATURES.burner`): cylindrical thermic-fluid heater with aluminium-clad insulation on a brick furnace with
  fuel door, piping; firewood stacks (`FEATURES.firewood`, instanced logs).
- ETP (`FEATURES.etp`): concrete circular clarifiers with murky water (animated subtle ripples), radial bridge with
  handrail, central drive with blue motor; raised platform with stairs & handrails carrying vessels with blue gear
  motors (photo WA0009); blue FRP filter vessels; HDPE dosing tanks; small RCC room; pipes.
- Compound walls (`FEATURES.compoundWalls`) with pillars, coping, weathering; green PPGI screen bands above (photos
  WA0009/WA0010); blue two-leaf sheet gate; blue fence near Block A; concrete electric poles (cross-arms, insulators,
  sagging catenary wires per `FEATURES.wires`), floodlight on the pole by Block A.

### 4.5 ENVIRONMENT — owns `webapp/js/env/*`
- Ground: large ground (≥ 1.5 km) fading into haze. Detailed zone (`SITE.detailBounds`): concrete yard inside
  `SITE.yardPolygon` (wet dark patches, stains, drains), reddish-brown laterite dirt lane/road with tyre tracks and
  puddles, weedy grass/scrub fields (east field & around Block A like the photos).
- Satellite context: fetch **Esri World Imagery** z=18 tiles
  (`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`, CORS OK) around
  `SITE.originGeo`, stitch on a canvas, georeference with Web-Mercator maths + `SITE.imageryOffset`, and use it as the
  ground colour OUTSIDE the detailed site area (soft blend; never show the stale roofs under our 3D buildings).
  Fail gracefully offline. Expose `attribution` ("Imagery © Esri, Maxar, Earthstar Geographics").
- Trees: coconut palms (`FEATURES.trees.coconut` = [x, y, height]) — curved ringed trunks, 18–24 pinnate fronds
  (alpha-tested canvas leaf texture), coconut clusters; broadleaf trees (`broadleaf` = [x, y, height, crownRadius]) with
  layered leaf-card crowns. Proper leaf shadows (alphaTest + customDepthMaterial), gentle wind sway. Shrubs/weeds.
- Vehicles (`FEATURES.vehicles`): generic but well-proportioned sedan, mini truck, water-tanker trailer, tractor,
  motorbikes (clearcoat paint, glass, tyres). No brand logos.
- Context: simple muted massing for nearby low RCC houses where the satellite shows them (S & W), so the site doesn't
  float in emptiness; optional distant hill silhouettes on the horizon.

### 4.6 ANALYSIS — owns `webapp/js/analysis/*` (sun.js exists; verify & fix if needed)
- Verify `sun.js` against independent references (NOAA solar calculator values / another algorithm) with Node tests
  in `webapp/js/analysis/tests/*.mjs` (`node file.mjs`). Azimuth/elevation within 0.05°, sunrise/sunset within 1 min.
- `shading.js`: BVH (three-mesh-bvh) over merged occluder geometry in world space (expand InstancedMeshes), sample a
  4 × 8 grid per module, ray origin offset 2 cm along normal, exclude self; clear-sky beam weighting
  (`clearSkyIrradiance`, cos incidence on the module plane); `runDay`: 10-min steps sunrise→sunset; `runYear`: 21st of
  each month, 30-min steps. Result `{ perModule: Float32Array (beam-weighted shaded fraction 0..1), arrayLossPct,
  perPlaneLossPct, worst: [{index, id, pct}], hourly: [...], timing }`. Time-sliced (yield every ~12 ms), progress
  callback 0..1, cancellable. Node-testable core (pure functions) + a browser test page `webapp/dev/shading-test.html`.
- `sunpath.js`: elegant 3D sun-path for the selected day (arc on a ~90 m dome centred on `SITE.center`), hour ticks with
  small labels, current-sun marker, faint solstice/equinox reference arcs, ground compass ring N/E/S/W. Thin, subtle.
- `energy.js`: helpers combining `site.PVGIS` + shading results → shading-adjusted monthly/annual kWh; Indian number
  formatting (`formatIN(205800) → "2,05,800"`, lakh/crore words).

## 5. How to test your work (MANDATORY, iterate ≥ 3 visual passes)
1. Preview in isolation: `http://127.0.0.1:8765/dev/preview.html?mods=<key>[,<key2>]&cam=x,y,z&target=x,y,z&t=2026-12-21T10:30`
   (keys: `buildings, solar, structures, environment, sunpath`; cam/target are PLAN coords; `ortho=1` for top view;
   `noinfo=1` hides the overlay). Combine keys to check fit (e.g. `mods=buildings,solar`).
2. Screenshot headlessly:
   `"C:/Users/harsh/AppData/Local/Programs/Python/Python313/python" tools/shot.py --url "<url>" --out webapp/_screens/<you>_<view>.png --w 1280 --h 800`
   (run from the project root; it waits for `window.__ready`, prints console errors and `window.__errors`). SwiftShader is
   slow (10–60 s per shot) — be economical, and pass `--timeout 240` for heavy scenes. Then **Read the PNG** and critique it
   against the reference photos. Fix, re-shoot. Check close-ups AND distance views.
3. No console errors. Keep final screenshots in `webapp/_screens/` prefixed with your module name.
4. Final report: files created, exported API, verification done (with screenshot paths), known gaps.

## 6. Polish phase (the app is integrated — test the FULL app now)
- **Preferred capture tool:** `tools/cap.py` (see its docstring) against `http://127.0.0.1:8765/index.html?clean=1&quality=high`.
  Canvas mode (default) reads back one rendered frame (fast, 3D only); `"mode":"page"` takes a real page screenshot incl. UI (slow).
  Steps are a JSON file or inline JSON; standard review set: `tools/views/review.json`.
  Free camera: `return await __app.lookAt([camX,camY,camZ],[tgtX,tgtY,tgtZ],fov)` (PLAN coords). Also `__app.setView(name,{instant:true})`,
  `__app.setTime('YYYY-MM-DDTHH:MM')`, `__app.setLayer(name,bool)`, `__app.setMode('ortho'|'persp')`, `__app.stats()`, `__app.runShade('day')`.
  Headless Chromium = SwiftShader → the app auto-picks quality "low" unless `quality=high` is in the URL; always judge realism at high.
- Budget: **≤ 320 draw calls (incl. shadow pass) and ≤ 1.8 M triangles** on high in the overview. Check `__app.stats()` after
  your change. Integrated laptop GPUs (e.g. Adreno X1-45) are fill-rate bound: foliage overdraw and the ground shader dominate.

## 7. Render scheduling (lightweight mode — keep these contracts)
- **On-demand rendering.** `main.js` draws a frame only while something changes (camera, sun, UI, panel easing, `demandRender()`),
  plus the ambient animation (`registerAnimated`) at 24 fps for 12 s after the last input — skipped on GPUs where a full-res
  frame is expensive. `?idle=0` forces continuous rendering. Animated callbacks receive the real time since the previous frame.
- **Static shadow map.** `renderer.shadowMap.autoUpdate = false`; the map is re-rendered only after `applySun`, layer/quality
  changes, the satellite context arriving, UI clicks/changes and `__app.invalidate()`. A builder that moves/shows/hides
  shadow casters on its own must call `ctx.renderer.shadowMap.needsUpdate = true`.
- **Adaptive resolution.** While the view moves on a slow GPU the frame is drawn at a reduced pixel ratio (learned to reach
  ≥ 40 fps, floor 0.6 px/CSS px); still frames are always full resolution. Not active on software renderers or with `idle=0`.
- **Quality default.** High only on discrete / high-end GPUs; integrated GPUs get Medium; an auto-picked High steps down to
  Medium once if moving stays sluggish. The user's explicit choice (Tools ▸ Quality, `?quality=`) is kept.
- **Loading.** Builder modules are fetched in parallel; shaders are pre-compiled with the post chain's render target bound
  (so the variants match); shading/BVH loads in the background after the first frame; the satellite tiles download while the
  other builders run. `performance.getEntriesByType('mark')` shows the load timeline (`boot`, `built:<key>`, `compiled`, `ready`).
- **Decals / depth bias.** Do not use `polygonOffsetFactor` on decals that lie under other geometry (e.g. the contact-AO
  sheet under the modules): its slope term grows with distance and obliquity and, on real GPUs (24-bit depth), pushed the
  sheet through the glass at overview range so the arrays rendered black. Use a capped view-space pull (see `solar/index.js`).
  Software-renderer captures (`tools/cap.py`) do not show this class of bug — check far views on a real GPU.
- Ownership during fix rounds: buildings → `webapp/js/buildings/*`; solar → `webapp/js/solar/*`; structures → `webapp/js/structures/*`;
  env → `webapp/js/env/*`; core → `webapp/index.html`, `webapp/css/*`, `webapp/js/main.js`, `webapp/js/core/*`; analysis → `webapp/js/analysis/*`,
  `webapp/dev/shading-test.html`. **Nobody edits `webapp/js/site-data.js` during a fix round** — put requested changes in your report
  (or apply a local override inside your own module) and the orchestrator applies them between rounds.
