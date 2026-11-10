// ============================================================================
//  Formatting helpers (Indian number grouping, dates/times in IST).
// ============================================================================

/** Indian digit grouping: 205800 → "2,05,800"; 12345678.9 (1 digit) → "1,23,45,678.9". */
export function formatIN(n, digits = 0) {
  if (!Number.isFinite(n)) return '–';
  const neg = n < 0;
  const [intPart, frac] = Math.abs(n).toFixed(digits).split('.');
  let s = intPart;
  if (s.length > 3) {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    s = `${rest},${last3}`;
  }
  return (neg ? '−' : '') + s + (frac ? `.${frac}` : '');
}

/** "2.06 lakh", "1.2 crore" */
export function lakhWords(n) {
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} crore`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} lakh`;
  return formatIN(n);
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const pad2 = (v) => String(v).padStart(2, '0');

/** Local clock "HH:MM" for a Date at a fixed UTC offset. */
export function fmtClock(date, utcOffsetHours = 5.5) {
  const d = new Date(date.getTime() + utcOffsetHours * 3600e3);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function fmtMinutes(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

export function fmtDateLong(y, m, d) { return `${d} ${MONTHS[m - 1]} ${y}`; }

/** Metres → feet-inches string, e.g. 12.34 → 40′ 6″ */
export function feetInches(m) {
  const totalIn = m / 0.0254;
  let ft = Math.floor(totalIn / 12);
  let inch = Math.round(totalIn - ft * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return `${ft}′ ${inch}″`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
