// Bootstrap for the teamoftraders page. The JSON import below is the
// live-feed seam: swap it for a fetch() when the data goes live (spec §3.1).
import raw from '/assets/teamoftraders/showcase.json';
import { indexShowcase, fmtMoney } from '/lib/teamoftraders/data.js';

const index = indexShowcase(raw);
const { eu, us } = raw.markets;
document.getElementById('status').textContent =
  `${index.tradesById.size} trades · ${index.dayList.length} trading days · ` +
  `eu ${fmtMoney(eu.equity.at(-1).equity, 'EUR')} · us ${fmtMoney(us.equity.at(-1).equity, 'USD')}`;
