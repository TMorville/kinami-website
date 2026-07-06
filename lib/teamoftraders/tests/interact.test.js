// Run with: node lib/teamoftraders/tests/interact.test.js
import { hitTest } from '../interact.js';

let failed = 0;
function assert(label, cond) {
  if (cond) console.log(`  ok  ${label}`);
  else { console.error(`  FAIL ${label}`); failed++; }
}

const markersByMarket = {
  eu: [{ id: 'eu-0001', x: 100, y: 100, r: 4 }],
  us: [{ id: 'us-0001', x: 300, y: 100, r: 8 }],
};
assert('direct hit', hitTest(markersByMarket, 101, 101).id === 'eu-0001');
assert('slack radius hits', hitTest(markersByMarket, 100, 109).id === 'eu-0001');
assert('miss returns null', hitTest(markersByMarket, 200, 200) === null);
assert('nearest wins', hitTest(markersByMarket, 295, 100).id === 'us-0001');

process.exit(failed ? 1 : 0);
