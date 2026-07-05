// Pure strata layout: trades → grains in a market column; day rows tile weeks.
// Deterministic (hash01 jitter) so narrative and explorer render identically.
import { hash01 } from './data.js';

export const GRAIN_MIN_R = 1.5;
export const GRAIN_MAX_R = 9;

/** Lay out one market's trades as grains inside a column. */
export function layoutMarket(index, market, { x0, width, rowH }) {
  const trades = index.raw.markets[market].trades;
  const maxNotional = Math.max(...trades.map(t => t.notional), 1);
  return trades.map(t => {
    const day = index.dayIndex.get(t.date.slice(0, 10)) ?? 0;
    return {
      id: t.id,
      day,
      x: x0 + (0.1 + 0.8 * hash01(t.id)) * width,
      y: (day + 0.5) * rowH,
      r: GRAIN_MIN_R + Math.sqrt(t.notional / maxNotional) * (GRAIN_MAX_R - GRAIN_MIN_R),
      ring: t.action === 'sell', // sells carve — rendered as rings, buys deposit as dots
      win: t.is_win,             // true | false | null (open / unmatched)
      phase: hash01(t.id + 'p') * Math.PI * 2,
    };
  });
}

/** Contiguous ISO-week bands over the shared day axis. */
export function weekBands(index, rowH) {
  const bands = [];
  let current = null;
  index.dayList.forEach((d, i) => {
    const week = isoWeekId(d);
    if (!current || current.week !== week) {
      current = { week, y0: i * rowH, y1: (i + 1) * rowH };
      bands.push(current);
    } else {
      current.y1 = (i + 1) * rowH;
    }
  });
  return bands;
}

/** ISO-8601 week id for a YYYY-MM-DD string (UTC math, no locale). */
export function isoWeekId(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;         // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3);      // nearest Thursday decides the year
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
