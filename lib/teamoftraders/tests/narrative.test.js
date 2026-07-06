// Run with: node lib/teamoftraders/tests/narrative.test.js
import { buildStops, esc } from '../narrative.js';
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
      trades: [{ id: 'eu-0001', date: '2026-04-08T14:00:00', ticker: 'DTE', week_id: '2026-W15' }],
      equity: [], weeks: [{ week_id: '2026-W15', market_thesis: 'eu thesis' }],
    },
    us: {
      starting_capital: 10000,
      trades: [{ id: 'us-0001', date: '2026-04-14T14:00:00', ticker: 'CRDO', week_id: '2026-W16' }],
      equity: [], weeks: [{ week_id: '2026-W16', market_thesis: 'us thesis' }],
    },
  },
  beats: [{ id: 'genesis', kind: 'genesis', market: 'eu', trade_id: 'eu-0001',
            date: '2026-04-08', title: 'First position', note: 'BUY 10 DTE' }],
};
const stops = buildStops(indexShowcase(raw));

assert('chapter for each week with a strategy', stops.filter(s => s.kind === 'chapter').length === 2);
assert('beat included', stops.some(s => s.kind === 'beat' && s.beat.id === 'genesis'));
assert('sorted by day', stops.every((s, i) => i === 0 || stops[i - 1].day <= s.day));
assert('chapter precedes beat on the same day',
  stops.findIndex(s => s.kind === 'chapter' && s.week === '2026-W15') <
  stops.findIndex(s => s.kind === 'beat'));
assert('esc neutralizes html', esc('<b>&"x"</b>') === '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;');

process.exit(failed ? 1 : 0);
