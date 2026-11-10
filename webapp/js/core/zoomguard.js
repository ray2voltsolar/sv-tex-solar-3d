// ============================================================================
//  ZOOM GUARD — zoom gestures only ever zoom the 3D view, never the web page.
//
//  Why: a touchpad pinch arrives as `wheel` + ctrlKey (Chrome/Edge/Firefox), as GestureEvents (Safari), or the user
//  presses Ctrl/Cmd + / −. OrbitControls only sees (and preventDefaults) wheels that land on the canvas while it is
//  enabled, so pinching over the panel, header, view bar, a 3D label or during a fly-to animation zoomed the whole page
//  (UI chrome included).
//
//  Rules:
//   • pinch / Ctrl+wheel: page zoom is always blocked. Over the 3D view or a floating overlay it is forwarded to the
//     canvas (→ 3D zoom towards the cursor); over the side panel / bottom sheet (or the loader) it does nothing.
//   • plain wheel over non-card overlays sitting on the scene (3D labels, compass, scale bar) → forwarded to the 3D view.
//     Plain wheel over UI cards keeps its normal behaviour (panel scrolls, etc.).
//   • Ctrl/Cmd + "+" / "−" → one 3D zoom step at the centre of the unobstructed view. Ctrl+0 is left to the browser so
//     an already-zoomed page can still be reset.
//   • Safari GestureEvents: always preventDefault; trackpad pinches (no touch pointers down) become 3D zoom.
//     Touch pinches on phones are handled by OrbitControls' pointer events (page pinch is blocked by
//     `touch-action: none` + the viewport meta).
//   • 3D labels are buttons floating over the scene. A tap still clicks the label, but a drag that starts on one, or
//     a pinch with a finger on one, is handed to the 3D view (the canvas captures the pointer and OrbitControls gets a
//     pointerdown for it). Without this a phone pinch with one finger on a roof label orbited instead of zooming.
//     A finger resting on the floating chrome (header card, view bar, compass …) joins a pinch the same way, but a
//     single touch there keeps its normal behaviour (buttons, view-bar swipe).
// ============================================================================

const CARDS = '#panel, #viewbar, #brand, #infocard, #legendFloat, #panelOpen, #toasts, #measureHint';
const NO_ZOOM = '#panel, #loader';
const LABEL = '#labels .lbl';
const OVERLAY_TOUCH = '#brand, #viewbar, #compass, #legendFloat, #scalebar, #attrib, #infocard, #measureHint, #panelOpen';
const DRAG_PX = 6;                     // mouse: same tap/drag threshold as the canvas click handler in main.js
const DRAG_PX_TOUCH = 16;              // touch/pen: beyond the browser's tap slop, so a slightly wobbly tap is still a tap

/**
 * @param {object} o
 * @param {HTMLElement} o.target   element OrbitControls listens on (the WebGL canvas)
 * @param {() => void} [o.onZoom]  called after a forwarded zoom (e.g. to request a render)
 */
export function installZoomGuard({ target, onZoom } = {}) {
  if (!target) return () => {};
  const FWD = Symbol('zoomguard');
  let lastCtrlWheel = -1e9;
  const touches = new Set();             // touch pointers currently down anywhere on the page
  const sceneTouches = new Set();        // … of which went down on the 3D view itself
  // pointerId → { src, x0, y0, x, y, drag } for pointers that went down on a 3D label (drag: hand over on a drag too)
  // or, for touch, on the floating chrome (multi-touch only)
  const pending = new Map();

  const closest = (el, sel) => (el && el.closest ? el.closest(sel) : null);
  const inTarget = (el) => el === target || !!(el && target.contains && target.contains(el));

  function forward(src, { deltaY = src.deltaY, ctrlKey = src.ctrlKey, x = src.clientX, y = src.clientY } = {}) {
    const ev = new WheelEvent('wheel', {
      deltaX: src.deltaX || 0, deltaY, deltaZ: 0, deltaMode: src.deltaMode || 0,
      clientX: x, clientY: y, screenX: src.screenX || x, screenY: src.screenY || y,
      ctrlKey, shiftKey: !!src.shiftKey, altKey: !!src.altKey, metaKey: false,
      bubbles: true, cancelable: true,
    });
    ev[FWD] = true;
    target.dispatchEvent(ev);
    if (onZoom) onZoom();
  }

  // ------------------------------------------------------------------ wheel (incl. touchpad pinch = ctrl+wheel)
  function onWheel(e) {
    if (e[FWD]) return;                                     // our own forwarded event
    const pinch = e.ctrlKey || e.metaKey;
    if (pinch) { e.preventDefault(); lastCtrlWheel = performance.now(); }
    const t = e.target;
    if (inTarget(t)) {
      // OrbitControls handles it; make sure the page never zooms even when the controls are disabled (fly-to)
      if (pinch) e.preventDefault();
      return;
    }
    if (pinch) {
      if (!closest(t, NO_ZOOM)) forward(e);
      return;
    }
    // plain wheel: overlays that sit on the scene (labels, compass, scale bar) behave like the scene
    if (!closest(t, CARDS) && !closest(t, NO_ZOOM)) { e.preventDefault(); forward(e); }
  }

  // ------------------------------------------------------------------ keyboard: Ctrl/Cmd + / −
  function viewCentre() {
    let cx = innerWidth / 2, cy = innerHeight / 2;
    const panel = document.querySelector('#panel');
    if (panel && !panel.classList.contains('collapsed')) {
      const r = panel.getBoundingClientRect();
      if (r.width > 0 && r.left > innerWidth * 0.5) cx = r.left / 2;          // desktop side panel on the right
      else if (r.height > 0 && r.top > innerHeight * 0.3) cy = r.top / 2;     // phone bottom sheet
    }
    return { cx, cy };
  }
  function onKey(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key, c = e.code;
    const zin = k === '+' || k === '=' || c === 'NumpadAdd' || c === 'Equal';
    const zout = k === '-' || k === '_' || c === 'NumpadSubtract' || c === 'Minus';
    if (!zin && !zout) return;
    e.preventDefault();
    if (document.querySelector('#loader:not(.done)')) return;
    const { cx, cy } = viewCentre();
    // ctrlKey:false so OrbitControls does not apply its ×10 pinch factor; 250 → ≈ 12 % dolly per press
    forward({ deltaX: 0, deltaMode: 0, screenX: cx, screenY: cy }, { deltaY: zin ? -250 : 250, ctrlKey: false, x: cx, y: cy });
  }

  // ------------------------------------------------------------------ drags / pinches that start on a 3D label or overlay
  function pointer(type, src, x, y) {
    const ev = new PointerEvent(type, {
      pointerId: src.pointerId, pointerType: src.pointerType, isPrimary: src.isPrimary,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: type === 'pointerdown' ? src.button : -1, buttons: src.buttons || 1,
      width: src.width || 1, height: src.height || 1, pressure: src.pressure || 0.5,
      ctrlKey: !!src.ctrlKey, shiftKey: !!src.shiftKey, altKey: !!src.altKey, metaKey: !!src.metaKey,
      bubbles: true, cancelable: true, composed: true,
    });
    ev[FWD] = true;
    return ev;
  }
  function handOver(id, replay) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    try { target.setPointerCapture(id); } catch (err) { return; }   // pointer already gone
    if (p.src.pointerType === 'touch') sceneTouches.add(id);        // it now drives the 3D view
    // drag hand-over (replay): start where the finger/cursor went down so the orbit includes the first few pixels and
    // main.js never mistakes the release for a tap on the scene. Joining a pinch: start where the finger is now —
    // replaying a long slide over an overlay would jerk the camera.
    target.dispatchEvent(pointer('pointerdown', p.src, replay ? p.x0 : p.x, replay ? p.y0 : p.y));
    if (replay && (p.x !== p.x0 || p.y !== p.y0)) target.dispatchEvent(pointer('pointermove', p.src, p.x, p.y));
  }
  const handOverTouches = () => { for (const [id, p] of [...pending]) if (p.src.pointerType === 'touch') handOver(id, false); };

  function onPointerDown(e) {
    if (e[FWD]) return;
    pending.delete(e.pointerId);                       // stale entries whose release never arrived
    sceneTouches.delete(e.pointerId);
    const touch = e.pointerType === 'touch';
    if (touch) touches.add(e.pointerId);
    const onLabel = !!closest(e.target, LABEL);
    if (onLabel || (touch && closest(e.target, OVERLAY_TOUCH))) {
      pending.set(e.pointerId, { src: e, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, drag: onLabel });
      // this finger joins a pinch: the other finger is on the scene, or also on a label / overlay
      // (a finger resting on the side panel / sheet does not count)
      if (touch && (sceneTouches.size > 0 || [...pending.values()].filter((p) => p.src.pointerType === 'touch').length > 1)) handOverTouches();
    } else if (touch && inTarget(e.target)) {
      sceneTouches.add(e.pointerId);
      if (pending.size) handOverTouches();   // 1st finger on a label/overlay, 2nd on the scene: hand the 1st over first
    }
  }
  function onPointerMove(e) {
    if (e[FWD]) return;
    const p = pending.get(e.pointerId);
    if (!p) return;
    // no button held → the release was swallowed (e.g. a context menu opened on mousedown, as on macOS)
    if (e.pointerType !== 'touch' && !e.buttons) { pending.delete(e.pointerId); return; }
    p.x = e.clientX; p.y = e.clientY;
    const slop = e.pointerType === 'mouse' ? DRAG_PX : DRAG_PX_TOUCH;
    if (p.drag && Math.hypot(p.x - p.x0, p.y - p.y0) > slop) handOver(e.pointerId, true);
  }
  function onPointerUp(e) {
    if (e[FWD]) return;
    touches.delete(e.pointerId);
    sceneTouches.delete(e.pointerId);
    pending.delete(e.pointerId);
  }
  // labels never need the browser's context menu (OrbitControls does the same on the canvas); without this a
  // right-drag pan that starts on a label ended with the menu popping up over the presentation
  function onContextMenu(e) { if (closest(e.target, LABEL)) e.preventDefault(); }
  function onBlur() { pending.clear(); touches.clear(); sceneTouches.clear(); }

  // ------------------------------------------------------------------ Safari GestureEvents
  let gScale = 1;
  function onGestureStart(e) { e.preventDefault(); gScale = 1; }
  function onGestureChange(e) {
    e.preventDefault();
    const s = e.scale || 1, ds = s / gScale; gScale = s;
    // touch pinches are OrbitControls' job; browsers that also send ctrl+wheel for the pinch must not zoom twice
    if (touches.size > 0 || performance.now() - lastCtrlWheel < 300 || !isFinite(ds) || ds <= 0) return;
    if (closest(e.target, NO_ZOOM)) return;
    // OrbitControls: pinch wheel scale = 0.95^(|deltaY|·0.1) → deltaY = −ln(ds)/(−ln 0.95)·10 ≈ −195·ln(ds)
    const x = e.clientX != null ? e.clientX : innerWidth / 2, y = e.clientY != null ? e.clientY : innerHeight / 2;
    forward({ deltaX: 0, deltaMode: 0, screenX: x, screenY: y }, { deltaY: -195 * Math.log(ds), ctrlKey: true, x, y });
  }
  const onGestureEnd = (e) => { e.preventDefault(); gScale = 1; };

  const opts = { passive: false, capture: true };
  addEventListener('wheel', onWheel, opts);
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onPointerDown, true);
  addEventListener('pointermove', onPointerMove, true);
  addEventListener('pointerup', onPointerUp, true);
  addEventListener('pointercancel', onPointerUp, true);
  addEventListener('contextmenu', onContextMenu, true);
  addEventListener('blur', onBlur);
  document.addEventListener('gesturestart', onGestureStart, opts);
  document.addEventListener('gesturechange', onGestureChange, opts);
  document.addEventListener('gestureend', onGestureEnd, opts);

  return () => {
    removeEventListener('wheel', onWheel, opts);
    removeEventListener('keydown', onKey, true);
    removeEventListener('pointerdown', onPointerDown, true);
    removeEventListener('pointermove', onPointerMove, true);
    removeEventListener('pointerup', onPointerUp, true);
    removeEventListener('pointercancel', onPointerUp, true);
    removeEventListener('contextmenu', onContextMenu, true);
    removeEventListener('blur', onBlur);
    document.removeEventListener('gesturestart', onGestureStart, opts);
    document.removeEventListener('gesturechange', onGestureChange, opts);
    document.removeEventListener('gestureend', onGestureEnd, opts);
  };
}
