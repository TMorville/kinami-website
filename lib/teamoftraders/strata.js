// Pure timeline layout: time flows left→right; trades become candle bars
// growing from their market's equity path; ISO weeks tile the x axis.
// Deterministic (hash01 phase) so narrative and explorer render identically.
import { hash01 } from './data.js';

export const BAR_MIN_H = 14;
export const BAR_MAX_H = 72;
export const STACK_GAP = 3;

/** Shared x-scale: each of the N days owns a width/N cell; a (fractional)
 *  day index maps to its cell center. */
export function dayX(index, x0, width) {
  const n = Math.max(index.dayList.length, 1);
  return day => x0 + ((day + 0.5) / n) * width;
}

/** Equity path anchors in day-index space. If trading predates the first
 *  snapshot, prepend a synthetic anchor at starting capital — the book
 *  verifiably started there; the unrecorded stretch is drawn dotted. */
export function buildAnchors(index, market) {
  const m = index.raw.markets[market];
  const anchors = m.equity.map(r => ({
    day: index.dayIndex.get(r.date) ?? 0,
    value: r.equity,
  }));
  const tradeDays = m.trades.map(t => index.dayIndex.get(t.date.slice(0, 10)) ?? 0);
  if (tradeDays.length) {
    const firstTradeDay = Math.min(...tradeDays);
    if (!anchors.length || firstTradeDay < anchors[0].day) {
      anchors.unshift({ day: firstTradeDay, value: m.starting_capital });
    }
  }
  return anchors;
}

/** Piecewise-linear equity value at a fractional day index (clamped ends). */
export function equityAtDay(day, anchors) {
  if (!anchors.length) return null;
  if (day <= anchors[0].day) return anchors[0].value;
  for (let i = 1; i < anchors.length; i++) {
    if (day <= anchors[i].day) {
      const a = anchors[i - 1];
      const b = anchors[i];
      const t = (day - a.day) / (b.day - a.day || 1);
      return a.value + t * (b.value - a.value);
    }
  }
  return anchors[anchors.length - 1].value;
}

/** Per-lane y-scale over equity + benchmark + starting capital, 8% padding. */
export function laneScale(rows, startingCapital, y0, height) {
  const values = [startingCapital];
  for (const r of rows) values.push(r.equity, r.benchmark_equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || 1) * 0.08;
  const lo = min - pad;
  const hi = max + pad;
  return value => y0 + ((hi - value) / (hi - lo)) * height;
}

/** Lay out one market's trades as candle segments stacked per day.
 *
 *  Encoding: buys are HOLLOW segments, length = cost (sqrt of notional vs
 *  the market's biggest position). Sells are SOLID, length = |realized P&L|
 *  vs the market's biggest realized move. Wins stack UPWARD from the curve;
 *  buys, losses, and unmatched sells stack DOWNWARD. One x per day — each
 *  day reads as a single composite candle, and every segment's ticker sits
 *  beside it at the segment's own height, so labels cannot collide. */
export function layoutMarket(index, market,
  { x0, width, yScale, anchors, yMin = -Infinity, yMax = Infinity }) {
  const trades = index.raw.markets[market].trades;
  const maxNotional = Math.max(...trades.map(t => t.notional), 1);
  const maxPnl = Math.max(...trades.map(t => Math.abs(t.realized_pnl || 0)), 1);
  const X = dayX(index, x0, width);
  const barH = mag => BAR_MIN_H + Math.sqrt(mag) * (BAR_MAX_H - BAR_MIN_H);

  // Pass 1 — natural segment sizes, grouped per day and direction.
  const sized = trades.map(t => {
    const day = index.dayIndex.get(t.date.slice(0, 10)) ?? 0;
    const sell = t.action === 'sell';
    const pnl = t.realized_pnl;
    const h = sell
      ? (pnl != null ? barH(Math.abs(pnl) / maxPnl) : BAR_MIN_H)
      : barH(t.notional / maxNotional);
    const dir = sell && pnl != null && pnl > 0 ? -1 : 1; // -1 = up (win), +1 = down
    return { t, day, sell, h, dir, y: yScale(equityAtDay(day, anchors)) };
  });

  // Pass 2 — a day-stack must fit between the curve and its lane edge; when
  // it can't, every segment in that day+direction scales down together.
  const totals = new Map();
  for (const s of sized) {
    const key = `${s.day}:${s.dir}`;
    totals.set(key, (totals.get(key) || 0) + s.h + STACK_GAP);
  }
  const scales = new Map();
  for (const s of sized) {
    const key = `${s.day}:${s.dir}`;
    if (scales.has(key)) continue;
    const room = s.dir === -1 ? s.y - yMin : yMax - s.y;
    scales.set(key, Math.min(1, Math.max(room, BAR_MIN_H) / totals.get(key)));
  }

  const up = new Map();    // day → height already stacked above the curve
  const down = new Map();  // day → height already stacked below
  return sized.map(({ t, day, sell, h, dir, y }) => {
    const scale = scales.get(`${day}:${dir}`);
    h = h * scale;
    const gap = STACK_GAP * scale;
    let yTop;
    if (dir === -1) {
      const stacked = up.get(day) || 0;
      yTop = y - stacked - h;
      up.set(day, stacked + h + gap);
    } else {
      const stacked = down.get(day) || 0;
      yTop = y + stacked;
      down.set(day, stacked + h + gap);
    }
    return {
      id: t.id,
      ticker: t.ticker,
      day,
      x: X(day),
      y,                          // the curve anchor
      yTop,                       // segment's top edge (stacked)
      h,
      dir,
      filled: sell,               // sells solid, buys hollow
      win: t.is_win,              // true | false | null (open / unmatched)
      cy: yTop + h / 2,           // hit-test centre + label anchor
      hr: Math.max(h / 2, 8),     // hit-test radius
      phase: hash01(t.id + 'p') * Math.PI * 2,
    };
  });
}

/** Contiguous ISO-week stripes tiling whole day-cells across the axis. */
export function weekBands(index, x0, width) {
  const n = Math.max(index.dayList.length, 1);
  const cellLeft = i => x0 + (i / n) * width;
  const bands = [];
  let current = null;
  index.dayList.forEach((d, i) => {
    const week = isoWeekId(d);
    if (!current || current.week !== week) {
      current = { week, x0: cellLeft(i), x1: cellLeft(i + 1) };
      bands.push(current);
    } else {
      current.x1 = cellLeft(i + 1);
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
