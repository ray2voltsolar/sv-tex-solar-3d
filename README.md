# Sri Venkateswara Tex Process — 145.08 kWp Rooftop Solar, 3D model

An interactive three.js 3D model of the factory in Nagari, AP, with the proposed rooftop PV system. It is meant for presenting the proposal to the customer.

**Live model:** https://ray2voltsolar.github.io/sv-tex-solar-3d/ (works in Chrome / Edge / Safari, no install).

## How to open it
**Online:** open the link above. GitHub Pages hosts it, so you can share the link with the customer.

**Offline / from this folder:**
1. Double-click **`Open 3D Model.bat`**. It starts a small local web server and opens the model in your browser at `http://127.0.0.1:8765/`.
   Keep the black window open while you present.
2. The first load needs internet. three.js and the satellite imagery are downloaded from the web, and then the browser caches them.
3. Use Chrome or Edge on a laptop with a reasonable GPU. On phones the app switches to a simplified layout and the "Low" quality preset.

### Performance
The app is built to stay light on ordinary laptops:
- It only draws while something changes. When you leave the view alone, the GPU goes idle.
- Shadows are recalculated only when the sun or the scene changes.
- While you orbit, a slower GPU draws the moving picture at reduced resolution. The full-quality picture comes back as soon as the camera stops.
- Laptops with integrated graphics start on **Medium** quality, and gaming or workstation GPUs start on **High**. Switch under **Tools → Quality**; the browser remembers your choice.
- Add `?quality=high` to the link to force High, for example for screenshots.

Manual start: `cd webapp` then `python -m http.server 8765`, then open http://127.0.0.1:8765/

## What to show the customer (suggested flow)
| Step | Where | What it shows |
|---|---|---|
| 1 | **Overview** (key 1) | The whole factory with all 234 modules. Hover a module for its string, inverter, roof, tilt and azimuth. |
| 2 | **Summary** tab | 145.08 kWp, 2,05,800 kWh/yr, 1,418.5 kWh/kWp, about 146 t CO₂/yr, the per-roof table and the monthly generation chart. |
| 3 | **Roofs A / C / D** | Close-ups of the arrays, walkways, lightning arresters and turbo-vent clearances. |
| 4 | **Field / Street / Entrance** | Eye-level views that match the site photos. |
| 5 | **Sun** tab | Pick a date (21 Jun / 21 Dec quick buttons) and drag the time slider or press **Play** to watch the real shadows move. |
| 6 | **Shade analysis** | "Analyse this day" or "Analyse full year" draws a shading heat map on the modules and reports the loss %. |
| 7 | **Layers** | Turn on **String colours** to show the electrical layout: 13 strings, 2 × 60 kW inverters. Also toggles satellite, vegetation, vehicles, sun path and labels. |
| 8 | **Tools** | Measure (click two points), Screenshot (high-res PNG), Fullscreen, Quality, Plan/ortho view. |

Keyboard: `1`–`9` views · `O` perspective/orthographic · `Space` play the day · `M` measure · `L` labels · `F` fullscreen · `R` reset · `P` screenshot · `H` hide the panel · `Esc` cancel.
Mouse: left-drag orbits, right-drag pans, wheel zooms (towards the cursor).
Touchpad pinch, `Ctrl` + wheel and `Ctrl` `+` / `−` zoom the 3D view only; the panel and buttons always stay the same size. On phones, pinch with two fingers to zoom and drag with one to orbit.
If the browser page was zoomed before this was added, press `Ctrl` + `0` once to reset it.

## System modelled
| Item | Value |
|---|---|
| Modules | 234 × Vikram Solar HYPERSOL G12R 620 Wp, N-type TOPCon, bifacial glass-glass, 132 half-cut cells, 2384 × 1134 × 30 mm |
| Block A (gable, E/W slopes) | 120 modules · 74.40 kWp |
| Block C (gable, E/W slopes, around 6 turbo vents) | 66 modules · 40.92 kWp |
| Block D (mono-slope facing south, around 4 turbo vents) | 48 modules · 29.76 kWp |
| DC/AC | 13 strings · 2 × 60 kW inverters on the Office 1 north wall · DC/AC 1.21 |
| Mounting | Short mini-rails flush on the trapezoidal sheets (tilt = roof pitch, about 5.7°). 0.6 m GI walkways between row groups. |
| Energy | PVGIS 5.3 (PVGIS-ERA5), 14 % system loss, per roof orientation → ≈ 2,05,800 kWh in year 1 |

## Accuracy notes and assumptions (please read before presenting)
- **Plan dimensions** come from the hand-drawn layout sketch and were cross-checked with satellite imagery.
  - Everything agrees except **Block D**: the sketch says 61 ft (18.6 m) north–south, but the satellite suggests about 22.6 m. The model follows the sketch.
  - If Block D is really longer, there may be room for about one more row of modules. Please re-measure on site.
- **Heights and roof shapes** were estimated from the photos and the satellite view; the sketch has no heights.
  - Block A: ridge north–south.
  - Block C: north–south gable.
  - Block D: mono-slope falling to the south.
  - Eave heights are 4.6–6.6 m. Verify on site before the detailed design.
- **Trees, neighbouring houses and vehicles** are approximate context taken from the satellite view and photos.
- **Shade analysis** is an indicative clear-sky beam-shading simulation.
  - It treats tree crowns as solid, so tree shading on the west edge of Block A is probably overestimated.
  - A full-year run gives roughly 3 % array loss.
  - The bankable energy figure is the PVGIS number in the Summary tab.
- **Satellite imagery** is © Esri, Maxar, Earthstar Geographics, shown with attribution in the app.
- **Module data** is from Vikram Solar's published HYPERSOL G12R datasheet. The PVGIS data is from the EU JRC PVGIS 5.3 tool.

## Project layout (for developers)
- `webapp/index.html`, `webapp/js/main.js`: app entry. `js/core/` holds the renderer, lighting, cameras, UI, labels and tools.
- `webapp/js/site-data.js`: the **single source of truth**: building dimensions, roof planes, PV layout, strings, PVGIS data and site features.
- Scene modules:
  - `js/buildings/`, `js/solar/`, `js/structures/`, `js/env/`: the 3D builders.
  - `js/analysis/`: sun position (NOAA), shading (three-mesh-bvh ray casting), sun path and energy.
- `SPEC.md`: the full technical brief, including §7 on render scheduling. `tools/cap.py`: headless screenshot tool. `webapp/_screens/` holds local review screenshots and is not in git.
- Deployment: `.github/workflows/pages.yml` publishes `webapp/` (only `index.html`, `css/` and `js/`) to GitHub Pages on every push to `main`.
- The site photos and the layout sketch used as references are kept out of the repository on purpose.
- No build step: plain ES modules plus a CDN import map (three.js 0.170.0, three-mesh-bvh 0.8.3).
