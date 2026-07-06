// Run with: node lib/teamoftraders/tests/interact.test.js
import { hitTest } from '../interact.js';

let failed = 0;
function assert(label, cond) {
  if (cond) console.log(`  ok  ${label}`);
  else { console.error(`  FAIL ${label}`); failed++; }
}

// Bars hit-test against their centre (cy) with radius hr.
const markersByMarket = {
  eu: [{ id: 'eu-0001', x: 100, cy: 110, hr: 10 }],
  us: [{ id: 'us-0001', x: 300, cy: 100, hr: 8 }],
};
assert('direct hit', hitTest(markersByMarket, 101, 111).id === 'eu-0001');
assert('slack radius hits', hitTest(markersByMarket, 100, 125).id === 'eu-0001');
assert('miss returns null', hitTest(markersByMarket, 200, 200) === null);
assert('nearest wins', hitTest(markersByMarket, 295, 100).id === 'us-0001');

process.exit(failed ? 1 : 0);
