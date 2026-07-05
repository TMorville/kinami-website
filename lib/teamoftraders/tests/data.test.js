// Run with: node lib/teamoftraders/tests/data.test.js
import { indexShowcase, fmtMoney, hash01 } from '../data.js';

let failed = 0;
function assert(label, cond) {
  if (cond) console.log(`  ok  ${label}`);
  else { console.error(`  FAIL ${label}`); failed++; }
}

const raw = {
  markets: {
    eu: {
      currency: 'EUR',
      trades: [{ id: 'eu-0001', date: '2026-04-08T14:11:28', ticker: 'DTE', week_id: '2026-W15' }],
      equity: [{ date: '2026-05-08', equity: 8814.41 }],
      weeks: [{ week_id: '2026-W15', market_thesis: 't' }],
    },
    us: {
      currency: 'USD',
      trades: [{ id: 'us-0001', date: '2026-04-09T17:13:20', ticker: 'CRDO', week_id: '2026-W15' }],
      equity: [{ date: '2026-05-09', equity: 11767.18 }],
      weeks: [],
    },
  },
  beats: [],
};

const index = indexShowcase(raw);
assert('tradesById holds both trades', index.tradesById.size === 2);
assert('trade tagged with its market', index.tradesById.get('eu-0001').market === 'eu');
assert('dayList is the sorted union of trade + equity days',
  JSON.stringify(index.dayList) === JSON.stringify(['2026-04-08', '2026-04-09', '2026-05-08', '2026-05-09']));
assert('dayIndex maps date → row', index.dayIndex.get('2026-04-09') === 1);
assert('weeksByKey keyed by market:week', index.weeksByKey.get('eu:2026-W15').market_thesis === 't');
assert('tradesByWeek groups trades', index.tradesByWeek.get('us:2026-W15').length === 1);

assert('fmtMoney EUR', fmtMoney(8814.41, 'EUR').includes('€'));
assert('fmtMoney USD rounds to whole dollars', fmtMoney(11767.18, 'USD') === '$11,767');

assert('hash01 deterministic', hash01('eu-0001') === hash01('eu-0001'));
assert('hash01 in [0,1)', hash01('x') >= 0 && hash01('x') < 1);
assert('hash01 spreads', hash01('eu-0001') !== hash01('eu-0002'));

process.exit(failed ? 1 : 0);
