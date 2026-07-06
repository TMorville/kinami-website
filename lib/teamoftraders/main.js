// Bootstrap for the teamoftraders page. The JSON import below is the
// live-feed seam: swap it for a fetch() when the data goes live (spec §3.1).
import raw from '/assets/teamoftraders/showcase.json';
import { indexShowcase, fmtMoney } from '/lib/teamoftraders/data.js';
import { buildAnchors, laneScale, layoutMarket, weekBands } from '/lib/teamoftraders/strata.js';
import { createRenderer, laneGeometry } from '/lib/teamoftraders/render.js';
import { mountEquity } from '/lib/teamoftraders/equity.js';

export const STATIC_MODE =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < 768;

const index = indexShowcase(raw);
const { eu, us } = raw.markets;
document.getElementById('status').textContent =
  `${index.tradesById.size} trades · ${index.dayList.length} trading days · ` +
  `eu ${fmtMoney(eu.equity.at(-1).equity, 'EUR')} · us ${fmtMoney(us.equity.at(-1).equity, 'USD')}`;

const canvas = document.getElementById('strata-canvas');
const stage = document.getElementById('stage');
const scroller = document.getElementById('stage-scroller');
const spacer = document.getElementById('stage-spacer');

// Fixed time scale: one ISO week (5 trading days) fills most of the viewport.
// STATIC_MODE compresses to a single-screen overview instead of panning.
export let PX_PER_DAY = null;
let renderer = null;
export let equityPaths = null;

export function buildLaneModel(market, lanes) {
  const m = raw.markets[market];
  const anchors = buildAnchors(index, market);
  const yScale = laneScale(m.equity, m.starting_capital, lanes[market].y0, lanes[market].height);
  return { anchors, yScale };
}

/** (Re)build all viewport-dependent state — called at load and on resize. */
function buildScene() {
  const { width, height } = stage.getBoundingClientRect();
  const contentWidth = Math.min(Math.max(width * 0.78, 640), 1100);
  PX_PER_DAY = STATIC_MODE ? null : contentWidth / 5;
  const dayCount = index.dayList.length;
  const virtualWidth = STATIC_MODE
    ? width - 80
    : Math.max(dayCount * PX_PER_DAY, width - 80);
  const lanes = laneGeometry(width, height, virtualWidth);
  spacer.style.width = `${virtualWidth + 2 * lanes.x0}px`;
  const models = { eu: buildLaneModel('eu', lanes), us: buildLaneModel('us', lanes) };
  const markersByMarket = {
    eu: layoutMarket(index, 'eu', { x0: lanes.x0, width: lanes.width, ...models.eu }),
    us: layoutMarket(index, 'us', { x0: lanes.x0, width: lanes.width, ...models.us }),
  };
  const bands = weekBands(index, lanes.x0, lanes.width);
  renderer = createRenderer(canvas, { markersByMarket, bands, lanes });
  const equitySvg = document.getElementById('equity-svg');
  equitySvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  equitySvg.setAttribute('preserveAspectRatio', 'none');
  equityPaths = mountEquity(equitySvg, index, {
    eu: { x0: lanes.x0, width: lanes.width, ...models.eu },
    us: { x0: lanes.x0, width: lanes.width, ...models.us },
  });
}

buildScene();

if (STATIC_MODE) {
  renderer.draw({ revealDay: Infinity, t: 0, panX: 0 });   // composed overview, no animation
} else {
  const tick = t => {
    renderer.draw({ revealDay: Infinity, t, panX: scroller.scrollLeft });
    equityPaths.panGroup.setAttribute('transform', `translate(${-scroller.scrollLeft} 0)`);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
window.addEventListener('resize', () => {
  buildScene();
  renderer.draw({ panX: scroller.scrollLeft });
  equityPaths.panGroup.setAttribute('transform', `translate(${-scroller.scrollLeft} 0)`);
});
