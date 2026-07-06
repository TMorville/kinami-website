// Run with: node lib/teamoftraders/tests/strata.test.js
import {
  buildAnchors, equityAtDay, laneScale, layoutMarket, weekBands, isoWeekId,
  dayX, BAR_MIN_H, BAR_MAX_H, SLOT_SPREAD,
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
          notional: 13240.0, is_win: false, realized_pnl: -100.0, week_id: '2026-W19' },
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
assert('marker carries its ticker', markers[0].ticker === 'DTE' && markers[1].ticker === 'ENR');
assert('marker x follows its day', markers[0].x === X(0) && markers[1].x === X(2));
// eu-0001: buy → hollow segment stacking down from the curve
assert('buys are hollow', markers[0].filled === false);
assert('buys hang down from the curve', markers[0].dir === 1 && markers[0].yTop === markers[0].y);
// eu-0002: sell with realized_pnl -100 → solid loss segment, down, max length
assert('sells are solid', markers[1].filled === true);
assert('loss sells stack down', markers[1].dir === 1);
assert('biggest realized move gets max segment length', Math.abs(markers[1].h - BAR_MAX_H) < 1e-9);
assert('segment length floors at BAR_MIN_H', markers[0].h >= BAR_MIN_H);
assert('hit centre sits mid-segment', markers[1].cy === markers[1].yTop + markers[1].h / 2);
assert('win passes through', markers[0].win === true && markers[1].win === false);
assert('layout is deterministic',
  JSON.stringify(layoutMarket(index, 'eu', { x0: 50, width: 100, yScale, anchors }))
  === JSON.stringify(markers));

// Same-day trades sit side by side, SLOT_SPREAD apart, both on the curve.
const rawSide = JSON.parse(JSON.stringify(raw));
rawSide.markets.eu.trades.push({ id: 'eu-0003', date: '2026-04-08T15:00:00', ticker: 'SAP',
  action: 'buy', notional: 500, is_win: null, week_id: '2026-W15' });
const idxSide = indexShowcase(rawSide);
const side = layoutMarket(idxSide, 'eu', { x0: 50, width: 100, yScale, anchors });
assert('same-day bars sit SLOT_SPREAD apart', Math.abs(side[0].x - side[2].x) === SLOT_SPREAD);
assert('same-day bars both anchor on the curve', side[0].yTop === side[0].y && side[2].yTop === side[2].y);

// Bars clamp into their lane instead of overflowing it.
const clamped = layoutMarket(index, 'eu', { x0: 50, width: 100, yScale, anchors, yMax: yScale(9500) + 40 });
assert('down bars clamp to lane room', clamped[1].h <= 40 - 28 + 1e-9);

// A winning sell stacks UP from the curve.
const rawWin = JSON.parse(JSON.stringify(raw));
rawWin.markets.eu.trades[1].realized_pnl = 250.0;
rawWin.markets.eu.trades[1].is_win = true;
const idxWin = indexShowcase(rawWin);
const winMarkers = layoutMarket(idxWin, 'eu', { x0: 50, width: 100, yScale, anchors });
assert('winning sells grow up', winMarkers[1].dir === -1 && winMarkers[1].yTop === winMarkers[1].y - winMarkers[1].h);
assert('win hit centre sits above the curve', winMarkers[1].cy < winMarkers[1].y);

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
