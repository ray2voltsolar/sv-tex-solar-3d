"""Fast multi-step capture helper for the FULL APP (webapp/index.html) — preferred over shot.py.

  "C:/Users/harsh/AppData/Local/Programs/Python/Python313/python" tools/cap.py \
      --url "http://127.0.0.1:8765/index.html?clean=1" --steps tools/views/review.json [--prefix webapp/_screens/r1_] [--mobile]
  --steps is a JSON file OR an inline JSON string: [{"eval": "...js (async, use return)...", "out": "name.png",
          "mode": "canvas"|"page", "settle": ms}, ...]
  mode "canvas" (default for speed): freezes the loop, renders one frame and reads the WebGL canvas back
          (3D only, no HTML UI/labels) — ~2-10 s per shot on SwiftShader.
  mode "page": real page screenshot incl. UI overlays — slower (30-80 s); use for UI checks.
  --prefix is prepended to every "out" that is not an absolute path.
Useful evals:  return await __app.setView('photoA',{instant:true})
               return await __app.lookAt([camX,camY,camZ],[tgtX,tgtY,tgtZ], 45)   (PLAN coords)
               return await __app.setTime('2026-12-21T10:30')
               __app.setLayer('strings', true)   __app.setMode('ortho')   return __app.stats()
Prints console errors/warnings and window.__errors at the end.
"""
import argparse, json, os, sys, time, base64
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--url', required=True)
ap.add_argument('--w', type=int, default=1280)
ap.add_argument('--h', type=int, default=800)
ap.add_argument('--timeout', type=int, default=300)
ap.add_argument('--steps', required=True, help='JSON file with steps, or inline JSON')
ap.add_argument('--prefix', default='')
ap.add_argument('--mobile', action='store_true')
a = ap.parse_args()
steps = json.loads(a.steps) if a.steps.strip().startswith('[') else json.load(open(a.steps, encoding='utf-8'))

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                                "--ignore-gpu-blocklist", "--enable-webgl"])
    kw = dict(viewport={'width': a.w, 'height': a.h})
    if a.mobile:
        kw.update(is_mobile=True, has_touch=True, device_scale_factor=1,
                  user_agent='Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36')
    ctx = b.new_context(**kw)
    pg = ctx.new_page()
    pg.set_default_timeout(a.timeout * 1000)
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    t0 = time.time()
    pg.goto(a.url, wait_until='domcontentloaded', timeout=a.timeout * 1000)
    try:
        pg.wait_for_function('window.__ready === true', timeout=a.timeout * 1000, polling=500)
    except Exception as e:
        logs.append(f'[cap] TIMEOUT waiting for __ready: {e}')
    print(f'[cap] ready {time.time() - t0:.1f}s', flush=True)
    for s in steps:
        t1 = time.time()
        if s.get('eval'):
            try:
                pg.evaluate('window.__app && window.__app.freeze && window.__app.freeze(false)')
                r = pg.evaluate(f'(async () => {{ {s["eval"]} }})()')
                if r is not None:
                    print('[eval]', json.dumps(r)[:6000], flush=True)
            except Exception as e:
                logs.append(f'[cap] eval error: {e}')
                print('[cap] eval error', str(e)[:500], flush=True)
        if s.get('settle'):
            pg.wait_for_timeout(int(s['settle']))
        out = s.get('out')
        if out:
            if not os.path.isabs(out):
                out = a.prefix + out
            try:
                if s.get('mode', 'canvas') == 'canvas':
                    data = pg.evaluate('''(async () => { const A = window.__app; A.freeze(false); A.invalidate(800);
                        await new Promise(r => setTimeout(r, 700)); A.freeze(true);
                        A.post.render(0); return A.renderer.domElement.toDataURL('image/png'); })()''')
                    open(out, 'wb').write(base64.b64decode(data.split(',', 1)[1]))
                else:
                    pg.evaluate('(async () => { const A = window.__app; if (A) { A.freeze(false); A.invalidate(1500); await new Promise(r=>setTimeout(r,1800)); A.freeze(true); } })()')
                    pg.screenshot(path=out, timeout=a.timeout * 1000, animations='disabled')
                print('saved', out, f'{time.time() - t1:.1f}s', flush=True)
            except Exception as e:
                print('[cap] shot error', out, str(e)[:300], flush=True)
    try:
        errs = pg.evaluate('window.__errors || []')
    except Exception:
        errs = []
    print(f'[cap] total {time.time() - t0:.1f}s')
    for l in logs[:80]:
        print(l)
    for e in errs[:30]:
        print('[__errors]', str(e)[:1500])
    b.close()
