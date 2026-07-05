// Bootstrap for the teamoftraders page. The JSON import below is the
// live-feed seam: swap it for a fetch() when the data goes live (spec §3.1).
import raw from '/assets/teamoftraders/showcase.json';

const { eu, us } = raw.markets;
const tradeCount = eu.trades.length + us.trades.length;
const days = new Set();
for (const m of [eu, us]) {
  for (const t of m.trades) days.add(t.date.slice(0, 10));
  for (const r of m.equity) days.add(r.date);
}
const fmt = (v, c) => new Intl.NumberFormat(c === 'EUR' ? 'de-DE' : 'en-US',
  { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(v);
document.getElementById('status').textContent =
  `${tradeCount} trades · ${days.size} trading days · ` +
  `eu ${fmt(eu.equity.at(-1).equity, 'EUR')} · us ${fmt(us.equity.at(-1).equity, 'USD')}`;
