// Minimal dependency-free test kit for the Node tests (node file.mjs).
let passed = 0, failed = 0;
const failures = [];
export function check(name, cond, detail = '') {
  if (cond) { passed++; }
  else { failed++; failures.push(`${name}${detail ? '  -> ' + detail : ''}`); console.error(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}
export function near(name, actual, expected, tol) {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  check(name, ok, `got ${actual}, expected ${expected} ± ${tol} (Δ=${(actual - expected).toExponential(3)})`);
  return ok;
}
export function section(title) { console.log(`\n# ${title}`); }
export function done(label) {
  console.log(`\n${label}: ${passed} passed, ${failed} failed`);
  if (failed) { console.error(failures.join('\n')); process.exit(1); }
}
export function angDiff(a, b) { // smallest signed difference in degrees
  let d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d;
}
export const RAD = Math.PI / 180, DEG = 180 / Math.PI;
