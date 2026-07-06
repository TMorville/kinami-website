// Run with: node lib/teamoftraders/tests/equity.test.js
import { linePath, lanePaths } from '../equity.js';
import { buildAnchors, laneScale } from '../strata.js';
import { indexShowcase } from '../data.js';

let failed = 0;
function assert(label, cond) {
  if (cond) console.log(`  ok  ${label}`);
  else { console.error(`  FAIL ${label}`); failed++; }
}

assert('linePath builds M/L chain',
  linePath([{ x: 1, y: 2 }, { x: 3.14159, y: 4 }]) === 'M1.0 2.0 L3.1 4.0');
assert('linePath empty → empty string', linePath([]) === '');

const raw = {
  markets: {
    eu: {
      starting_capital: 10000,
      trades: [{ id: 'eu-0001', date: '2026-04-08T14:00:00', ticker: 'DTE', action: 'buy',
                 notional: 100, is_win: null, week_id: '2026-W15' }],
      equity: [
        { date: '2026-05-08', equity: 9000, benchmark_equity: 9000 },
        { date: '2026-05-09', equity: 9500, benchmark_equity: 9100 },
      ],
      weeks: [],
    },
    us: { starting_capital: 10000, trades: [], equity: [], weeks: [] },
  },
  beats: [],
};
const index = indexShowcase(raw);
// dayList: ['2026-04-08', '2026-05-08', '2026-05-09'] → 3 day-cells
const anchors = buildAnchors(index, 'eu');
const yScale = laneScale(raw.markets.eu.equity, 10000, 100, 200);
const geom = { x0: 0, width: 100, yScale, anchors };

// dayX is CELL-CENTER mapping: with 3 days over width 100 from x0 0,
// day centers sit at x = 16.7, 50.0, 83.3.
const { pre, equity, benchmark } = lanePaths(index, 'eu', geom);
assert('equity path starts at the first snapshot',
  equity.startsWith(`M50.0 ${yScale(9000).toFixed(1)}`));
assert('equity path ends at the last snapshot',
  equity.endsWith(`L83.3 ${yScale(9500).toFixed(1)}`));
assert('benchmark path uses benchmark values',
  benchmark.endsWith(`L83.3 ${yScale(9100).toFixed(1)}`));
assert('pre bridge runs from the synthetic anchor to the first snapshot',
  pre === `M16.7 ${yScale(10000).toFixed(1)} L50.0 ${yScale(9000).toFixed(1)}`);

// No gap → no pre bridge: give trades a date on/after the first snapshot.
const raw2 = JSON.parse(JSON.stringify(raw));
raw2.markets.eu.trades[0].date = '2026-05-08T10:00:00';
const index2 = indexShowcase(raw2);
const anchors2 = buildAnchors(index2, 'eu');
const paths2 = lanePaths(index2, 'eu', { x0: 0, width: 100, yScale, anchors: anchors2 });
assert('no pre-record gap → pre is empty', paths2.pre === '');

// Empty market → all paths empty, no crash.
const pathsUs = lanePaths(index, 'us', { x0: 0, width: 100, yScale, anchors: buildAnchors(index, 'us') });
assert('empty market → empty paths', pathsUs.equity === '' && pathsUs.pre === '');

process.exit(failed ? 1 : 0);
