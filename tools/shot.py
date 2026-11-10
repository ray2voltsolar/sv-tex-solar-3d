"""Headless screenshot helper for the 3D webapp (Playwright + SwiftShader WebGL).

Usage (use the Python 3.13 install that has Playwright):
  "C:/Users/harsh/AppData/Local/Programs/Python/Python313/python" tools/shot.py \
      --url "http://127.0.0.1:8765/dev/preview.html?mods=buildings&cam=60,-20,40&target=20,30,4" \
      --out webapp/_screens/buildings_se.png [--w 1600 --h 1000] [--eval "js code"] [--timeout 180]

Waits until window.__ready === true (set by the dev harness and by the main app),
then optionally runs --eval JS (may return a Promise), waits --settle ms, saves the PNG,
and prints console errors + window.__errors so you can fix them.
Several shots of the same page: pass --multi with a JSON list of {"eval": "...", "out": "..."}.
"""
import argparse, json, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--url', required=True)
ap.add_argument('--out', default=None)
ap.add_argument('--w', type=int, default=1600)
ap.add_argument('--h', type=int, default=1000)
ap.add_argument('--eval', default=None)
ap.add_argument('--settle', type=int, default=1500)
ap.add_argument('--timeout', type=int, default=240)
ap.add_argument('--multi', default=None, help='JSON list of {"eval":..., "out":..., "settle":ms}')
a = ap.parse_args()

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                                "--ignore-gpu-blocklist", "--enable-webgl"])
    pg = b.new_page(viewport={'width': a.w, 'height': a.h})
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    t0 = time.time()
    pg.goto(a.url, wait_until='domcontentloaded', timeout=a.timeout * 1000)
    try:
        pg.wait_for_function('window.__ready === true', timeout=a.timeout * 1000, polling=500)
    except Exception as e:
        logs.append(f'[shot] TIMEOUT waiting for window.__ready: {e}')
    shots = json.loads(a.multi) if a.multi else [{'eval': a.eval, 'out': a.out, 'settle': a.settle}]
    for s in shots:
        if s.get('eval'):
            try:
                r = pg.evaluate(f'(async () => {{ {s["eval"]} }})()')
                if r is not None:
                    print('[eval result]', json.dumps(r)[:4000])
            except Exception as e:
                logs.append(f'[shot] eval error: {e}')
        pg.wait_for_timeout(int(s.get('settle', a.settle)))
        if s.get('out'):
            pg.screenshot(path=s['out'])
            print('saved', s['out'])
    try:
        errs = pg.evaluate('window.__errors || []')
    except Exception:
        errs = []
    print(f'[shot] {time.time() - t0:.1f}s')
    for l in logs[:60]:
        print(l)
    for e in errs[:30]:
        print('[__errors]', e)
    b.close()
