"""Zoom-guard regression suite (webapp/js/core/zoomguard.js).

Every zoom gesture must leave the PAGE at scale 1 and, where sensible, zoom the 3D view; taps, drags and scrolling
of the UI must keep working. Runs headless Chromium on the real GPU (desktop 1440x900 + phone 390x844 touch).

usage:  python tools/zoomtest.py http://127.0.0.1:8765/ zoom_results.json
        (serve webapp/ first, e.g. "Open 3D Model.bat"; the live site URL works too)

Notes: CDP-injected Ctrl+wheel / Ctrl+= never change browser zoom in Playwright, so those cases check
event.defaultPrevented; Input.synthesizePinchGesture does reproduce real pinch-zoom (visualViewport.scale).
"""
import sys, time, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
ARGS = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"]
M = "({w: innerWidth, vv: +visualViewport.scale.toFixed(3), d: +window.__app.camera.position.distanceTo(window.__app.controls.target).toFixed(3), sc: document.querySelector('#panelBody').scrollTop, az: +window.__app.controls.getAzimuthalAngle().toFixed(4), tx: window.__app.controls.target.toArray().map(v => +v.toFixed(2))})"
PT = """(name) => {
  const ok = (e) => { const q = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    const r = { left: Math.max(0, q.left), top: Math.max(0, q.top), right: Math.min(innerWidth, q.right), bottom: Math.min(innerHeight, q.bottom) };
    r.width = r.right - r.left; r.height = r.bottom - r.top;
    return r.width > 8 && r.height > 8 && cs.visibility !== 'hidden' && +cs.opacity > 0.05 ? r : null; };
  const hits = (x, y, sel) => { const el = document.elementFromPoint(x, y); return !!(el && el.closest(sel)); };
  const centre = (sel, hitSel) => { for (const e of document.querySelectorAll(sel)) { const r = ok(e); if (!r) continue;
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + Math.min(r.height / 2, 160)); if (hits(x, y, hitSel || sel)) return [x, y]; } return null; };
  if (name === 'canvas') { for (let y = Math.round(innerHeight * 0.45); y > 60; y -= 20) for (const x of [0.3, 0.45, 0.2, 0.6].map(f => Math.round(innerWidth * f)))
      { const el = document.elementFromPoint(x, y); if (el && el.id === 'gl') return [x, y]; } return null; }
  const sel = { panel: '#panelBody', viewbar: '#viewbar', brand: '#brand', label: '#labels .lbl', roof: '#labels .lbl-roof', compass: '#compass' }[name];
  return centre(sel, (name === 'label' || name === 'roof') ? '.lbl' : sel);
}"""
REC = """(() => { window.__zlog = []; const rec = (e) => { const t = e.target; setTimeout(() => window.__zlog.push({ type: e.type, ctrl: e.ctrlKey || e.metaKey, key: e.key,
  tgt: (t && t.id) || (t && t.className && String(t.className).slice(0, 20)) || (t && t.nodeName), prevented: e.defaultPrevented, trusted: e.isTrusted }), 0); };
  addEventListener('wheel', rec, { capture: true, passive: true }); addEventListener('keydown', rec, { capture: true, passive: true }); return true; })()"""
SAFARI = """([x, y, scales]) => { const el = document.elementFromPoint(x, y); const prevented = [];
  const fire = (type, s) => { const e = new UIEvent(type, { bubbles: true, cancelable: true });
    for (const [k, v] of Object.entries({ scale: s, clientX: x, clientY: y })) Object.defineProperty(e, k, { value: v });
    el.dispatchEvent(e); prevented.push(e.defaultPrevented); };
  fire('gesturestart', 1); for (const s of scales) fire('gesturechange', s); fire('gestureend', scales[scales.length - 1]); return prevented; }"""

results = []


def ready(pg):
    pg.wait_for_function("window.__ready === true", timeout=180000); time.sleep(1.2); pg.evaluate(REC)


def reset(pg, cdp=None):
    if cdp is not None and pg.evaluate("visualViewport.scale") != 1:
        cdp.send("Emulation.resetPageScaleFactor"); time.sleep(0.4)   # Chrome restores pinch zoom across reloads
    if pg.evaluate("visualViewport.scale") != 1 or pg.evaluate("innerWidth") != pg.viewport_size["width"]:
        pg.reload(wait_until="commit"); ready(pg)
    pg.evaluate("window.__app.setView('overview', { instant: true })"); time.sleep(0.5)
    pg.evaluate("document.querySelector('#panelBody').scrollTop = 0; window.__zlog.length = 0"); time.sleep(0.2)


def case(pg, cdp, name, where, action, expect):
    reset(pg, cdp)
    pt = pg.evaluate(PT, where)
    if not pt:
        results.append({"case": name, "where": where, "pass": False, "why": "no visible point"}); print(f"SKIP {name} @{where}: no point"); return
    before = pg.evaluate(M)
    try:
        extra = action(pg, cdp, pt)
    except Exception as ex:
        extra = {"error": str(ex)[:120]}
    time.sleep(0.9)
    after = pg.evaluate(M); log = pg.evaluate("window.__zlog.slice()")
    ok, why = expect(before, after, log, extra)
    ok = bool(ok) and after["vv"] == 1 and after["w"] == before["w"]
    if after["vv"] != 1: why += f"  PAGE ZOOMED vv={after['vv']}"
    results.append({"case": name, "where": where, "pt": pt, "pass": ok, "why": why, "before": before, "after": after,
                    "events": len(log), "prevented": sum(1 for e in log if e["prevented"]), "extra": extra})
    print(("PASS " if ok else "FAIL ") + f"{name:40s} @{where:8s} d {before['d']}->{after['d']} vv {after['vv']} {why}", flush=True)


def pinch(scale, src="mouse"):
    def a(pg, cdp, pt):
        cdp.send("Input.synthesizePinchGesture", {"x": pt[0], "y": pt[1], "scaleFactor": scale, "relativeSpeed": 500, "gestureSourceType": src})
    return a


def ctrl_wheel(dy, n=3):
    def a(pg, cdp, pt):
        pg.mouse.move(*pt); pg.keyboard.down("Control")
        for _ in range(n): pg.mouse.wheel(0, dy); time.sleep(0.08)
        pg.keyboard.up("Control")
    return a


def wheel(dy, n=3):
    def a(pg, cdp, pt):
        pg.mouse.move(*pt)
        for _ in range(n): pg.mouse.wheel(0, dy); time.sleep(0.08)
    return a


def keys(combo, n=2):
    def a(pg, cdp, pt):
        for _ in range(n): pg.keyboard.press(combo); time.sleep(0.15)
    return a


def during_fly(inner):
    def a(pg, cdp, pt):
        pg.evaluate("void window.__app.setView('entrance')"); time.sleep(0.25)
        anim = pg.evaluate("!window.__app.controls.enabled")
        inner(pg, cdp, pt); return {"animating_when_pinched": anim}
    return a


def safari(scales):
    def a(pg, cdp, pt): return {"prevented": pg.evaluate(SAFARI, [pt[0], pt[1], scales])}
    return a


PARTNER = """([x, y]) => { for (const [dx, dy] of [[0, 110], [0, -110], [110, 0], [-110, 0], [80, 80], [-80, 80], [80, -80], [-80, -80], [0, 150], [0, -150]]) {
    const X = x + dx, Y = y + dy; if (X < 20 || Y < 20 || X > innerWidth - 20 || Y > innerHeight - 20) continue;
    const el = document.elementFromPoint(X, Y); if (el && el.id === 'gl') return [X, Y]; } return null; }"""


def touch_pinch(spread, label_first=True, partner_on_label=False):
    """two-finger pinch with CDP touch events: finger A on the point (a label), finger B on the scene nearby."""
    def a(pg, cdp, pt):
        other = pg.evaluate(PARTNER, pt) if not partner_on_label else None
        if not other: return {"skip": "no partner point"}
        A, B = (pt, other) if label_first else (other, pt)
        tp = lambda P, Q: [{"x": P[0], "y": P[1], "id": 1}, {"x": Q[0], "y": Q[1], "id": 2}]
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": A[0], "y": A[1], "id": 1}]}); time.sleep(0.05)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": tp(A, B)}); time.sleep(0.05)
        mx, my = (A[0] + B[0]) / 2, (A[1] + B[1]) / 2
        for i in range(1, 11):
            f = 1 + (spread - 1) * i / 10
            P = (mx + (A[0] - mx) * f, my + (A[1] - my) * f); Q = (mx + (B[0] - mx) * f, my + (B[1] - my) * f)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": tp(P, Q)}); time.sleep(0.03)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        return {"A": A, "B": B, "first_on": "label" if label_first else "scene"}
    return a


def touch_tap(pg, cdp, pt):
    pg.touchscreen.tap(*pt); time.sleep(2.2)


def mouse_drag(pg, cdp, pt):
    pg.mouse.move(*pt); pg.mouse.down()
    for i in range(1, 11): pg.mouse.move(pt[0] + 9 * i, pt[1] + 2 * i); time.sleep(0.02)
    pg.mouse.up()


def mouse_click(pg, cdp, pt):
    pg.mouse.click(*pt); time.sleep(2.2)


rotated = lambda b, a, l, x: (abs(a["az"] - b["az"]) > 0.02, f"azimuth {b['az']}->{a['az']}")
flew = lambda b, a, l, x: (a["tx"] != b["tx"] or abs(a["d"] - b["d"]) > 1, f"target {b['tx']}->{a['tx']}")
not_rotated = lambda b, a, l, x: (abs(a["az"] - b["az"]) < 0.005, f"azimuth {b['az']}->{a['az']}")


def with_info(inner):
    def e(b, a, l, x):
        ok, why = inner(b, a, l, x)
        if isinstance(x, dict) and x.get("skip"): return False, "SKIPPED " + x["skip"]
        return ok, why + " " + str(x or "")
    return e


CMREC = """(() => { window.__cm = []; addEventListener('contextmenu', (e) => setTimeout(() => window.__cm.push({ tgt: e.target.id || e.target.className, prevented: e.defaultPrevented }), 0), true); return true; })()"""


def right_drag(pg, cdp, pt):
    pg.evaluate(CMREC)
    pg.mouse.move(*pt); pg.mouse.down(button="right")
    for i in range(1, 11): pg.mouse.move(pt[0] + 9 * i, pt[1] + 1 * i); time.sleep(0.02)
    pg.mouse.up(button="right"); time.sleep(0.3)
    return {"contextmenu": pg.evaluate("window.__cm")}


def panned_no_menu(b, a, l, x):
    cm = (x or {}).get("contextmenu", [])
    return (a["tx"] != b["tx"] and all(c["prevented"] for c in cm), f"target {b['tx']}->{a['tx']} contextmenu={cm}")


def lost_release(pg, cdp, pt):
    """mousedown on a label whose mouseup never arrives (macOS context menu), then button-less hover moves."""
    az = lambda: pg.evaluate("[+window.__app.controls.getAzimuthalAngle().toFixed(4), window.__app.controls.target.toArray().map(v => +v.toFixed(2))]")
    out = {}
    time.sleep(1.0)   # let any damping from the previous case settle
    for btn, bmask in (("right", 2), ("left", 1)):
        a0 = az()
        cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": pt[0], "y": pt[1], "button": btn, "buttons": bmask, "clickCount": 1})
        for i in range(1, 12):
            cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": pt[0] + 12 * i, "y": pt[1] + 8 * i, "button": "none", "buttons": 0}); time.sleep(0.02)
        time.sleep(0.3); a1 = az()
        out[btn] = [a0, a1]
        cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": pt[0] + 132, "y": pt[1] + 88, "button": btn, "buttons": 0, "clickCount": 1}); time.sleep(0.3)
        pg.evaluate("window.__app.setView('overview', { instant: true })"); time.sleep(0.4)
    return out


def no_ghost_drag(b, a, l, x):
    # a ghost drag moves the target by metres / the azimuth by >0.1 rad; allow cm-level damping settle
    moved = lambda p, q: abs(p[0] - q[0]) > 0.01 or max(abs(u - v) for u, v in zip(p[1], q[1])) > 0.3
    bad = [k for k, (a0, a1) in (x or {}).items() if moved(a0, a1)]
    return (not bad and bool(x), f"camera before/after hover per button: {x}")


HOREC = """(() => { window.__ho = 0; document.querySelector('#gl').addEventListener('pointerdown', (e) => { if (!e.isTrusted) window.__ho++; }, true); return true; })()"""


def touch_drag(px):
    def a(pg, cdp, pt):
        pg.evaluate(HOREC)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": pt[0], "y": pt[1], "id": 1}]})
        for i in range(1, 6):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": pt[0] + px * i / 5, "y": pt[1], "id": 1}]}); time.sleep(0.03)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); time.sleep(2.2)
        return {"handovers": pg.evaluate("window.__ho")}
    return a


tap_no_orbit = lambda b, a, l, x: ((a["tx"] != b["tx"]) and (x or {}).get("handovers") == 0, f"flew target {b['tx']}->{a['tx']} {x}")
orbit_no_tap = lambda b, a, l, x: (a["tx"] == b["tx"] and abs(a["az"] - b["az"]) > 0.02, f"azimuth {b['az']}->{a['az']} target {b['tx']}->{a['tx']}")


def viewbar_tap(pg, cdp, pt):
    sel = pg.evaluate("""(() => { const b = [...document.querySelectorAll('#viewbar [data-view]')].find(x => !x.classList.contains('on') && x.getBoundingClientRect().right < innerWidth - 4 && x.getBoundingClientRect().left > 4);
        if (!b) return null; const r = b.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), b.dataset.view]; })()""")
    if not sel: return {"skip": "no viewbar button"}
    pg.touchscreen.tap(sel[0], sel[1]); time.sleep(2.2)
    return {"view": sel[2]}


def panel_plus_viewbar(pg, cdp, pt):
    """finger A rests on the open sheet, finger B drags on the view bar: must not orbit/zoom the scene."""
    A = pg.evaluate("(() => { const r = document.querySelector('#panelBody').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(Math.min(r.bottom - 20, r.top + 120))]; })()")
    tp = lambda Q: [{"x": A[0], "y": A[1], "id": 1}, {"x": Q[0], "y": Q[1], "id": 2}]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": A[0], "y": A[1], "id": 1}]}); time.sleep(0.05)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": tp(pt)}); time.sleep(0.05)
    for i in range(1, 9):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": tp((pt[0], pt[1] - 14 * i))}); time.sleep(0.03)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); time.sleep(0.4)
    return {"A": A}


def viewbar_swipe(pg, cdp, pt):
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": pt[0], "y": pt[1], "id": 1}]})
    for i in range(1, 9):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": pt[0] - 12 * i, "y": pt[1], "id": 1}]}); time.sleep(0.03)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); time.sleep(0.4)


closer = lambda b, a, l, x: (a["d"] < b["d"] * 0.97, "")
farther = lambda b, a, l, x: (a["d"] > b["d"] * 1.03, "")
still = lambda b, a, l, x: (abs(a["d"] - b["d"]) < 1e-3, "")
anything = lambda b, a, l, x: (True, str(x or ""))


def all_prevented(inner):
    def e(b, a, l, x):
        ok, why = inner(b, a, l, x); wl = [v for v in l if v["type"] in ("wheel", "keydown") and v["ctrl"] and v["key"] != "Control"]
        np = sum(1 for v in wl if not v["prevented"])
        return ok and len(wl) > 0 and np == 0, why + (f" {np}/{len(wl)} ctrl events NOT prevented" if np else f" {len(wl)} ctrl events all prevented")
    return e


def scrolled(b, a, l, x): return (a["sc"] > b["sc"] and abs(a["d"] - b["d"]) < 1e-3, f"scrollTop {b['sc']}->{a['sc']}")


def safari_ok(inner):
    def e(b, a, l, x):
        ok, why = inner(b, a, l, x); pv = (x or {}).get("prevented", [])
        return ok and pv and all(pv), why + f" gesture prevented={pv}"
    return e


def ctrl0(b, a, l, x):
    kd = [v for v in l if v["type"] == "keydown" and v["key"] == "0"]
    return (len(kd) > 0 and not any(v["prevented"] for v in kd), "Ctrl+0 left to the browser" if kd and not kd[0]["prevented"] else "Ctrl+0 blocked/missing")


with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=ARGS)
    # ---------------- desktop
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    cdp = pg.context.new_cdp_session(pg)
    pg.goto(url, wait_until="commit"); ready(pg)
    for w in ["panel", "viewbar", "brand", "label", "compass"]:
        case(pg, cdp, "touchpad pinch-in x1.6", w, pinch(1.6), still if w == "panel" else closer)
    case(pg, cdp, "touchpad pinch-in x1.6", "canvas", pinch(1.6), closer)
    case(pg, cdp, "touchpad pinch-out x0.6", "canvas", pinch(0.6), farther)
    case(pg, cdp, "touchpad pinch-out x0.6", "viewbar", pinch(0.6), farther)
    case(pg, cdp, "touchpad pinch during fly-to", "canvas", during_fly(pinch(1.6)), anything)
    case(pg, cdp, "touchpad pinch during fly-to", "panel", during_fly(pinch(1.6)), anything)
    case(pg, cdp, "Ctrl+mouse wheel up", "panel", ctrl_wheel(-120), all_prevented(still))
    case(pg, cdp, "Ctrl+mouse wheel up", "viewbar", ctrl_wheel(-120), all_prevented(closer))
    case(pg, cdp, "Ctrl+mouse wheel up", "label", ctrl_wheel(-120), all_prevented(closer))
    case(pg, cdp, "Ctrl+mouse wheel up", "canvas", ctrl_wheel(-120), all_prevented(closer))
    case(pg, cdp, "Ctrl+mouse wheel down", "brand", ctrl_wheel(120), all_prevented(farther))
    case(pg, cdp, "Ctrl+mouse wheel during fly-to", "canvas", during_fly(ctrl_wheel(-120)), all_prevented(anything))
    case(pg, cdp, "Ctrl+= (x2)", "canvas", keys("Control+Equal"), all_prevented(closer))
    case(pg, cdp, "Ctrl+- (x2)", "canvas", keys("Control+Minus"), all_prevented(farther))
    case(pg, cdp, "Ctrl+NumpadAdd (x2)", "canvas", keys("Control+NumpadAdd"), all_prevented(closer))
    case(pg, cdp, "Ctrl+0", "canvas", keys("Control+0", 1), ctrl0)
    case(pg, cdp, "plain wheel scrolls panel", "panel", wheel(120), scrolled)
    case(pg, cdp, "plain wheel over 3D label zooms 3D", "label", wheel(-120), closer)
    case(pg, cdp, "plain wheel over canvas zooms 3D", "canvas", wheel(-120), closer)
    case(pg, cdp, "Safari trackpad gesture x1.3", "canvas", safari([1.1, 1.2, 1.3]), safari_ok(closer))
    case(pg, cdp, "Safari trackpad gesture x1.3", "viewbar", safari([1.1, 1.2, 1.3]), safari_ok(closer))
    case(pg, cdp, "Safari trackpad gesture x1.3", "panel", safari([1.1, 1.2, 1.3]), safari_ok(still))
    case(pg, cdp, "mouse drag starting on a 3D label orbits", "label", mouse_drag, rotated)
    case(pg, cdp, "mouse click on a roof label still works", "roof", mouse_click, flew)
    case(pg, cdp, "right-drag from a label pans, no browser menu", "label", right_drag, panned_no_menu)
    case(pg, cdp, "lost mouseup on a label: hover does not orbit", "roof", lost_release, no_ghost_drag)
    errs_d = pg.evaluate("window.__errors || []")
    pg.close()
    # ---------------- phone (touch)
    pg = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    cdp = pg.context.new_cdp_session(pg)
    pg.goto(url, wait_until="commit"); ready(pg)
    case(pg, cdp, "phone touch pinch-in x1.6", "brand", pinch(1.6, "touch"), anything)
    case(pg, cdp, "phone touch pinch-in x1.6", "viewbar", pinch(1.6, "touch"), anything)
    case(pg, cdp, "phone touch pinch-in x1.6", "canvas", pinch(1.6, "touch"), closer)
    case(pg, cdp, "phone touch pinch-out x0.6", "canvas", pinch(0.6, "touch"), farther)
    case(pg, cdp, "phone pinch-apart, 1st finger on label", "label", touch_pinch(1.8, True), with_info(closer))
    case(pg, cdp, "phone pinch-apart, 2nd finger on label", "label", touch_pinch(1.8, False), with_info(closer))
    case(pg, cdp, "phone pinch-together, 1st finger on label", "label", touch_pinch(0.55, True), with_info(farther))
    case(pg, cdp, "phone pinch-apart, both fingers on scene", "canvas", touch_pinch(1.8, True), with_info(closer))
    case(pg, cdp, "phone tap on a roof label still works", "roof", touch_tap, flew)
    case(pg, cdp, "phone 10px wobbly tap on roof label = tap", "roof", touch_drag(10), tap_no_orbit)
    case(pg, cdp, "phone 40px drag from roof label = orbit", "roof", touch_drag(40), orbit_no_tap)
    case(pg, cdp, "phone pinch, 1st finger on view bar", "viewbar", touch_pinch(1.8, True), with_info(closer))
    case(pg, cdp, "phone pinch, 2nd finger on view bar", "viewbar", touch_pinch(1.8, False), with_info(closer))
    case(pg, cdp, "phone pinch, 1st finger on header card", "brand", touch_pinch(1.8, True), with_info(closer))
    case(pg, cdp, "phone pinch-together, finger on compass", "compass", touch_pinch(0.55, True), with_info(farther))
    case(pg, cdp, "phone 1-finger swipe on view bar: no orbit", "viewbar", viewbar_swipe, lambda b, a, l, x: (abs(a["az"] - b["az"]) < 0.005 and a["tx"] == b["tx"], f"az {b['az']}->{a['az']}"))
    case(pg, cdp, "phone tap on a view-bar button still works", "viewbar", viewbar_tap, with_info(flew))
    pg.evaluate("document.querySelector('#sheetGrip').click()"); time.sleep(1.0)
    print("sheet expanded:", pg.evaluate("Math.round(document.querySelector('#panelBody').getBoundingClientRect().top)"))
    case(pg, cdp, "phone touch pinch-in x1.6 (sheet open)", "panel", pinch(1.6, "touch"), still)
    case(pg, cdp, "phone touch pinch-out x0.6 (sheet open)", "panel", pinch(0.6, "touch"), still)
    case(pg, cdp, "phone pinch-apart on scene (sheet open)", "canvas", touch_pinch(1.6, True), with_info(closer))
    case(pg, cdp, "phone finger on sheet + drag on view bar: no 3D", "viewbar", panel_plus_viewbar,
         lambda b, a, l, x: (abs(a["az"] - b["az"]) < 0.005 and a["tx"] == b["tx"] and abs(a["d"] - b["d"]) < 1e-3, f"az {b['az']}->{a['az']} d {b['d']}->{a['d']} {x}"))
    errs_m = pg.evaluate("window.__errors || []")
    b.close()
json.dump({"url": url, "results": results, "errors": {"desktop": errs_d, "phone": errs_m}}, open(out, "w"), indent=1)
print(f"\n{sum(r['pass'] for r in results)}/{len(results)} passed; page errors desktop={len(errs_d)} phone={len(errs_m)}")
