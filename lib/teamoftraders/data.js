// Pure data layer for the teamoftraders viz: indexing, formatting, hashing.
// No DOM, no fetch — node-testable. The raw payload is loaded by main.js.

/** Index the showcase payload for O(1) lookups and a shared day axis. */
export function indexShowcase(raw) {
  const tradesById = new Map();
  const weeksByKey = new Map();
  const tradesByWeek = new Map();
  const days = new Set();
  for (const market of ['eu', 'us']) {
    const m = raw.markets[market];
    for (const trade of m.trades) {
      trade.market = market;
      tradesById.set(trade.id, trade);
      days.add(trade.date.slice(0, 10));
      const wk = `${market}:${trade.week_id}`;
      if (!tradesByWeek.has(wk)) tradesByWeek.set(wk, []);
      tradesByWeek.get(wk).push(trade);
    }
    for (const row of m.equity) days.add(row.date);
    for (const week of m.weeks) weeksByKey.set(`${market}:${week.week_id}`, week);
  }
  const dayList = [...days].sort();
  const dayIndex = new Map(dayList.map((d, i) => [d, i]));
  return { raw, tradesById, weeksByKey, tradesByWeek, dayList, dayIndex };
}

/** Raw-currency formatter — € / $ headline numbers (spec: raw money, not index points). */
export function fmtMoney(value, currency) {
  return new Intl.NumberFormat(currency === 'EUR' ? 'de-DE' : 'en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(value);
}

/** FNV-1a → [0,1). Deterministic layout jitter — no Math.random anywhere. */
export function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Plan-vs-execution join for one market-week: what the strategy intended
 *  vs what actually traded, with realized P&L per planned ticker. */
export function weekExecution(week, trades) {
  const rows = week.watchlist.map(wi => {
    const hits = trades.filter(t => t.ticker === wi.ticker);
    return {
      ticker: wi.ticker,
      direction: wi.direction,
      tradeCount: hits.length,
      realizedPnl: hits.reduce((sum, t) => sum + (t.realized_pnl || 0), 0),
    };
  });
  const planned = new Set(week.watchlist.map(wi => wi.ticker));
  const offPlan = [...new Set(trades.filter(t => !planned.has(t.ticker)).map(t => t.ticker))];
  return { rows, offPlan };
}
