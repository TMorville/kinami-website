// Run with: node lib/logo/tests/attractor.test.js
import { generatePoints, ATTRACTOR_PARAMS } from '../attractor.js';

let failed = 0;

function assert(label, cond) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failed++;
  }
}

const pts = generatePoints();
assert('returns Float32Array', pts instanceof Float32Array);
assert('returns 160000 numbers (= 2 × 80000)', pts.length === 160000);
assert('first point in normalized range [-1, 1]',
  pts[0] >= -1 && pts[0] <= 1 && pts[1] >= -1 && pts[1] <= 1);
assert('locked parameter a = 1.4', ATTRACTOR_PARAMS.a === 1.4);
assert('locked parameter dt = 0.005', ATTRACTOR_PARAMS.dt === 0.005);
assert('locked burn-in = 1000', ATTRACTOR_PARAMS.burnIn === 1000);
assert('locked n = 80000', ATTRACTOR_PARAMS.n === 80000);

// Regression: lock specific point coordinates so any numerical drift is caught.
// Values captured 2026-05-27 from the canonical implementation.
function near(a, b, tol = 1e-5) { return Math.abs(a - b) < tol; }

assert('regression: first point',
  near(pts[0], 0.989591) && near(pts[1], -0.450130));
assert('regression: index 1000 point',
  near(pts[2000], -0.257796) && near(pts[2001], 0.904991));
assert('regression: index 40000 point',
  near(pts[80000], 0.363975) && near(pts[80001], 0.288321));
assert('regression: last point',
  near(pts[159998], -0.191438) && near(pts[159999], 0.553004));

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll structural tests passed');
}
