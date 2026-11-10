// ============================================================================
//  CSS2D labels (site.LABELS), compass rose and ortho scale bar.
// ============================================================================
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export function createLabelRenderer(container) {
  const lr = new CSS2DRenderer();
  lr.domElement.id = 'labels';
  container.appendChild(lr.domElement);
  return lr;
}

/** Build site labels. onClick(labelId). Returns { group, setVisible, items } */
export function createSiteLabels(site, summary, onClick) {
  const group = new THREE.Group(); group.name = 'labels';
  const items = [];
  const roofInfo = {};
  for (const [b, n] of Object.entries(summary.perBuilding)) roofInfo[b] = { n, kwp: n * site.MODULE.wp / 1000 };
  for (const L of site.LABELS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'lbl' + (roofInfo[L.id] ? ' lbl-roof' : '') + (L.id === 'CHIM' ? ' lbl-minor' : '');
    const sub = roofInfo[L.id] ? `<span class="lbl-sub">${roofInfo[L.id].n} modules · ${roofInfo[L.id].kwp.toFixed(2)} kWp</span>` : '';
    el.innerHTML = `<span class="lbl-dot"></span><span class="lbl-txt">${L.text}${sub}</span>`;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick && onClick(L.id); });
    const obj = new CSS2DObject(el);
    obj.position.set(L.x, L.z, -L.y);
    obj.center.set(0.5, 1.0);
    obj.userData.labelId = L.id;
    group.add(obj);
    items.push(obj);
  }
  // declutter priority: roof labels (with kWp) first, then the order of site.LABELS
  const ranked = items.slice().sort((a, b) => (roofInfo[b.userData.labelId] ? 1 : 0) - (roofInfo[a.userData.labelId] ? 1 : 0));
  return {
    group, items,
    setVisible(v) { group.visible = v; for (const o of items) o.element.style.display = v ? '' : 'none'; },
    /** Hide labels that overlap a higher-priority one on screen (call after the label render). */
    declutter() {
      if (!group.visible) return;
      // UI chrome (side panel / phone sheet, view bar, brand card, compass) counts as occupied:
      // labels under it are hidden instead of peeking out half-clipped
      const kept = [];
      const obstacles = [];
      for (const sel of ['#panel', '#viewbar', '#brand', '#compass', '#legendFloat']) {
        const e = document.querySelector(sel);
        if (!e) continue;
        const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight) obstacles.push(r);
      }
      for (const o of ranked) {
        const el = o.element;
        if (el.style.display === 'none') { el.classList.remove('lbl-hidden'); continue; }
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const hit = kept.some((k) => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 2 && r.bottom > k.top - 2)
          || obstacles.some((k) => r.left < k.right && r.right > k.left && r.top < k.bottom && r.bottom > k.top)
          || r.right > innerWidth - 2 || r.left < 2;
        el.classList.toggle('lbl-hidden', hit);
        if (!hit) kept.push(r);
      }
    },
  };
}

/** Compass: rotates so the N needle points to geographic north on screen. */
export function createCompass(el, onClick) {
  el.innerHTML = `
  <svg viewBox="-50 -50 100 100" aria-label="Compass">
    <circle r="46" class="cp-ring"/>
    <g class="cp-rose">
      <g class="cp-ticks">${Array.from({ length: 24 }, (_, i) => {
        if (i % 6 === 0) return '';
        const a = i * 15 * Math.PI / 180, r1 = i % 3 === 0 ? 36 : 39, r2 = 43;
        return `<line x1="${(Math.sin(a) * r1).toFixed(2)}" y1="${(-Math.cos(a) * r1).toFixed(2)}" x2="${(Math.sin(a) * r2).toFixed(2)}" y2="${(-Math.cos(a) * r2).toFixed(2)}"/>`;
      }).join('')}</g>
      <path d="M0,-26 L6,0 L0,4 L-6,0 Z" class="cp-n"/>
      <path d="M0,26 L6,0 L0,-4 L-6,0 Z" class="cp-s"/>
      <circle r="2.2" class="cp-hub"/>
      <text x="0" y="-36" class="cp-lbl cp-lbl-n">N</text>
      <text x="36" y="0" class="cp-lbl">E</text>
      <text x="0" y="36" class="cp-lbl">S</text>
      <text x="-36" y="0" class="cp-lbl">W</text>
    </g>
  </svg>`;
  const rose = el.querySelector('.cp-rose');
  // keep letters upright
  const letters = [...el.querySelectorAll('.cp-lbl')];
  el.title = 'Compass — click for plan view (north up)';
  el.addEventListener('click', () => onClick && onClick());
  let last = null;
  return {
    update(headingDeg) {
      const r = Math.round(-headingDeg * 10) / 10;
      if (r === last) return; last = r;
      rose.setAttribute('transform', `rotate(${r})`);
      for (const t of letters) {
        const x = +t.getAttribute('x'), y = +t.getAttribute('y');
        t.setAttribute('transform', `rotate(${-r} ${x} ${y})`);
      }
    },
  };
}

const NICE = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
export function createScaleBar(el) {
  el.innerHTML = '<div class="sb-bar"><i></i><i></i></div><div class="sb-txt"></div>';
  const bar = el.querySelector('.sb-bar'), txt = el.querySelector('.sb-txt');
  let lastKey = '';
  return {
    update(metresPerPx, visible) {
      el.classList.toggle('show', !!visible);
      if (!visible || !(metresPerPx > 0)) return;
      const maxPx = 150;
      let L = NICE[0];
      for (const n of NICE) if (n / metresPerPx <= maxPx) L = n;
      const px = Math.round(L / metresPerPx);
      const key = `${L}|${px}`;
      if (key === lastKey) return; lastKey = key;
      bar.style.width = `${px}px`;
      txt.textContent = `${L} m  ·  ${(L / 0.3048).toFixed(L < 5 ? 1 : 0)} ft`;
    },
  };
}
