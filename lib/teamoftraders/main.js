// Bootstrap for the teamoftraders page. The JSON import below is the
// live-feed seam: swap it for a fetch() when the data goes live (spec §3.1).
import raw from '/assets/teamoftraders/showcase.json';
import { indexShowcase, fmtMoney } from '/lib/teamoftraders/data.js';
import { buildAnchors, laneScale, layoutMarket, weekBands } from '/lib/teamoftraders/strata.js';
import { createRenderer, laneGeometry } from '/lib/teamoftraders/render.js';

export const STATIC_MODE =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < 768;

const index = indexShowcase(raw);
const { eu, us } = raw.markets;
document.getElementById('status').textContent =
  `${index.tradesById.size} trades · ${index.dayList.length} trading days · ` +
  `eu ${fmtMoney(eu.equity.at(-1).equity, 'EUR')} · us ${fmtMoney(us.equity.at(-1).equity, 'USD')}`;

const canvas = document.getElementById('strata-canvas');
const stage = document.getElementById('stage');
const { width, height } = stage.getBoundingClientRect();
const lanes = laneGeometry(width, height);

export function buildLaneModel(market) {
  const m = raw.markets[market];
  const anchors = buildAnchors(index, market);
  const yScale = laneScale(m.equity, m.starting_capital, lanes[market].y0, lanes[market].height);
  return { anchors, yScale };
}
const models = { eu: buildLaneModel('eu'), us: buildLaneModel('us') };
const markersByMarket = {
  eu: layoutMarket(index, 'eu', { x0: lanes.x0, width: lanes.width, ...models.eu }),
  us: layoutMarket(index, 'us', { x0: lanes.x0, width: lanes.width, ...models.us }),
};
const bands = weekBands(index, lanes.x0, lanes.width);
const renderer = createRenderer(canvas, { markersByMarket, bands, lanes });

if (STATIC_MODE) {
  renderer.draw({ revealDay: Infinity, t: 0 });   // composed still — no animation
} else {
  const tick = t => { renderer.draw({ revealDay: Infinity, t }); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
window.addEventListener('resize', () => { renderer.resize(); renderer.draw({}); });
