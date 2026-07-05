// Run with: node lib/teamoftraders/tests/strata.test.js
import { layoutMarket, weekBands, isoWeekId, GRAIN_MIN_R, GRAIN_MAX_R } from '../strata.js';
import { indexShowcase } from '../data.js';

let failed = 0;
function assert(label, cond) {
  if (cond) console.log(`  ok  ${label}`);
  else { console.error(`  FAIL ${label}`); failed++; }
}

const raw = {
  markets: {
    eu: {
      trades: [
        { id: 'eu-0001', date: '2026-04-08T14:00:00', ticker: 'DTE', action: 'buy',
          notional: 311.3, is_win: true, week_id: '2026-W15' },
        { id: 'eu-0002', date: '2026-04-13T14:00:00', ticker: 'ENR', action: 'sell',
          notional: 13240.0, is_win: false, week_id: '2026-W16' },
      ],
      equity: [], weeks: [],
    },
    us: { trades: [], equity: [], weeks: [] },
  },
  beats: [],
};
const index = indexShowcase(raw);
const geom = { x0: 100, width: 400, rowH: 12 };
const grains = layoutMarket(index, 'eu', geom);

assert('one grain per trade', grains.length === 2);
assert('grain x stays inside its column',
  grains.every(g => g.x >= 100 + 0.1 * 400 && g.x <= 100 + 0.9 * 400));
assert('y follows the day row', grains[0].y === 0.5 * 12 && grains[1].y === 1.5 * 12);
assert('biggest notional gets max radius', Math.abs(grains[1].r - GRAIN_MAX_R) < 1e-9);
assert('radius floors at GRAIN_MIN_R', grains[0].r >= GRAIN_MIN_R);
assert('sells are rings', grains[1].ring === true && grains[0].ring === false);
assert('win passes through', grains[0].win === true && grains[1].win === false);
assert('layout is deterministic',
  JSON.stringify(layoutMarket(index, 'eu', geom)) === JSON.stringify(grains));

const bands = weekBands(index, 12);
assert('two weeks → two bands', bands.length === 2);
assert('bands tile the day axis', bands[0].y0 === 0 && bands[0].y1 === 12 && bands[1].y1 === 24);
assert('band carries the ISO week', bands[0].week === '2026-W15' && bands[1].week === '2026-W16');

assert('isoWeekId matches the trade data', isoWeekId('2026-04-08') === '2026-W15');
assert('isoWeekId year boundary', isoWeekId('2026-01-01') === '2026-W01');

process.exit(failed ? 1 : 0);
