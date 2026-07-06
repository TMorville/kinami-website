// Run with: node lib/teamoftraders/tests/strata.test.js
import {
  buildAnchors, equityAtDay, laneScale, layoutMarket, weekBands, isoWeekId,
  dayX, MARK_MIN_R, MARK_MAX_R,
} from '../strata.js';
import { indexShowcase } from '../data.js';

let failed = 0;
function assert(label, cond) {
  if (cond) console.log(`  ok  ${label}`);
  else { console.error(`  FAIL ${label}`); failed++; }
}

const raw = {
  markets: {
    eu: {
      starting_capital: 10000,
      trades: [
        { id: 'eu-0001', date: '2026-04-08T14:00:00', ticker: 'DTE', action: 'buy',
          notional: 311.3, is_win: true, week_id: '2026-W15' },
        { id: 'eu-0002', date: '2026-05-09T14:00:00', ticker: 'ENR', action: 'sell',
          notional: 13240.0, is_win: false, week_id: '2026-W19' },
      ],
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
// dayList = ['2026-04-08', '2026-05-08', '2026-05-09'] → dayCount for x = 2

const anchors = buildAnchors(index, 'eu');
assert('synthetic start anchor prepended at first trade day',
  anchors[0].day === 0 && anchors[0].value === 10000);
assert('real snapshots follow', anchors[1].value === 9000 && anchors[2].value === 9500);

assert('equityAtDay before start clamps', equityAtDay(-1, anchors) === 10000);
assert('equityAtDay interpolates the pre-record segment',
  equityAtDay(0.5, anchors) === 9500);          // halfway 10000→9000
assert('equityAtDay hits snapshots exactly', equityAtDay(1, anchors) === 9000);
assert('equityAtDay after end clamps', equityAtDay(99, anchors) === 9500);

const yScale = laneScale(raw.markets.eu.equity, 10000, 100, 200);
assert('higher value maps higher (smaller y)', yScale(10000) < yScale(9000));
assert('scale stays inside padded lane',
  yScale(10000) >= 100 && yScale(9000) <= 300);

const X = dayX(index, 50, 100);
assert('dayX maps day 0 to its cell center', Math.abs(X(0) - (50 + (0.5 / 3) * 100)) < 1e-9);
assert('dayX maps the last day to its cell center', Math.abs(X(2) - (50 + (2.5 / 3) * 100)) < 1e-9);

const markers = layoutMarket(index, 'eu', { x0: 50, width: 100, yScale, anchors });
assert('one marker per trade', markers.length === 2);
assert('marker x follows its day', markers[0].x === X(0) && markers[1].x === X(2));
assert('marker y sits near the curve (jitter ≤ 9px)',
  Math.abs(markers[1].y - yScale(9500)) <= 9);
assert('biggest notional gets max radius', Math.abs(markers[1].r - MARK_MAX_R) < 1e-9);
assert('radius floors at MARK_MIN_R', markers[0].r >= MARK_MIN_R);
assert('sells are rings', markers[1].ring === true && markers[0].ring === false);
assert('win passes through', markers[0].win === true && markers[1].win === false);
assert('layout is deterministic',
  JSON.stringify(layoutMarket(index, 'eu', { x0: 50, width: 100, yScale, anchors }))
  === JSON.stringify(markers));

const bands = weekBands(index, 50, 100);
assert('two ISO weeks → two stripes', bands.length === 2);
assert('stripes start at x0 and end at x0+width', bands[0].x0 === 50 && bands[bands.length - 1].x1 === 150);
assert('stripes tile with no gap', bands[1].x0 === bands[0].x1);
assert('stripe carries the ISO week', bands[0].week === '2026-W15' && bands[1].week === '2026-W19');

// Regression: a lone last day starting a new ISO week still gets a visible stripe.
const rawLone = { markets: {
  eu: { starting_capital: 1, trades: [], equity: [
    { date: '2026-06-29', equity: 1, benchmark_equity: 1 },
    { date: '2026-06-30', equity: 1, benchmark_equity: 1 },
    { date: '2026-07-06', equity: 1, benchmark_equity: 1 },
  ], weeks: [] },
  us: { starting_capital: 1, trades: [], equity: [], weeks: [] },
}, beats: [] };
const idxLone = indexShowcase(rawLone);
const lone = weekBands(idxLone, 0, 300);
assert('lone new-week last day gets a visible stripe',
  lone[lone.length - 1].x1 - lone[lone.length - 1].x0 > 1);
assert('stripes still tile to the axis end', lone[lone.length - 1].x1 === 300);

assert('isoWeekId matches trade data', isoWeekId('2026-04-08') === '2026-W15');
assert('isoWeekId year boundary', isoWeekId('2026-01-01') === '2026-W01');

process.exit(failed ? 1 : 0);
