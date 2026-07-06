// Bootstrap for the teamoftraders page. The JSON import below is the
// live-feed seam: swap it for a fetch() when the data goes live (spec §3.1).
import raw from '/assets/teamoftraders/showcase.json';
import { indexShowcase, fmtMoney } from '/lib/teamoftraders/data.js';
import { buildAnchors, laneScale, layoutMarket, weekBands } from '/lib/teamoftraders/strata.js';
import { createRenderer, laneGeometry } from '/lib/teamoftraders/render.js';
import { mountEquity } from '/lib/teamoftraders/equity.js';
import { initStory } from '/lib/teamoftraders/story.js';
import { initInteract } from '/lib/teamoftraders/interact.js';
import { initStrategy } from '/lib/teamoftraders/strategy.js';
import { buildStops, esc } from '/lib/teamoftraders/narrative.js';

export const STATIC_MODE =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.innerWidth < 768;

const index = indexShowcase(raw);
const { eu, us } = raw.markets;
document.getElementById('status').textContent =
  `${index.tradesById.size} trades · ${index.dayList.length} trading days · ` +
  `eu ${fmtMoney(eu.equity.at(-1).equity, 'EUR')} · us ${fmtMoney(us.equity.at(-1).equity, 'USD')}`;

if (STATIC_MODE) document.body.classList.add('static'); // before any measuring

const canvas = document.getElementById('strata-canvas');
const stage = document.getElementById('stage');
const scroller = document.getElementById('stage-scroller');
const spacer = document.getElementById('stage-spacer');

// Fixed time scale: one ISO week (5 trading days) fills most of the viewport.
// STATIC_MODE compresses to a single-screen overview instead of panning.
export let PX_PER_DAY = null;
let renderer = null;
export let equityPaths = null;
let story = null;
const markersRef = { eu: [], us: [] };            // stable identity — interact reads through it
const sceneRef = { lanes: null, bands: null };    // ditto for geometry consumers
const uiState = { revealDay: Infinity, highlightId: null, filter: null };

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
  markersRef.eu = layoutMarket(index, 'eu', { x0: lanes.x0, width: lanes.width, ...models.eu });
  markersRef.us = layoutMarket(index, 'us', { x0: lanes.x0, width: lanes.width, ...models.us });
  const bands = weekBands(index, lanes.x0, lanes.width);
  sceneRef.lanes = lanes;
  sceneRef.bands = bands;
  renderer = createRenderer(canvas, { markersByMarket: markersRef, bands, lanes });
  const equitySvg = document.getElementById('equity-svg');
  equitySvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  equitySvg.setAttribute('preserveAspectRatio', 'none');
  equityPaths = mountEquity(equitySvg, index, {
    eu: { x0: lanes.x0, width: lanes.width, ...models.eu },
    us: { x0: lanes.x0, width: lanes.width, ...models.us },
  });
  story = STATIC_MODE
    ? null
    : initStory(index, { cardsEl: document.getElementById('cards'), equityPaths, lanes });
}

buildScene();
const interact = initInteract(index, { scroller, stage, markersRef, uiState, sceneRef });
const requestDraw = () => {
  if (STATIC_MODE) renderer.draw({ revealDay: Infinity, t: 0, panX: 0, filter: uiState.filter });
};
initStrategy(index, { scroller, sceneRef, uiState, interact, requestDraw });

if (STATIC_MODE) {
  renderer.draw({ revealDay: Infinity, t: 0, panX: 0 });   // composed overview, no animation
  // The story flows as plain prose below the overview — the accessibility path.
  const cardsEl = document.getElementById('cards');
  document.getElementById('narrative').appendChild(cardsEl); // out from under the stage
  for (const stop of buildStops(index)) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = stop.kind === 'chapter'
      ? `<span class="label agent-tag">${stop.week} · strategist</span>
         ${stop.eu?.market_thesis ? `<blockquote>EU — ${esc(stop.eu.market_thesis)}</blockquote>` : ''}
         ${stop.us?.market_thesis ? `<blockquote>US — ${esc(stop.us.market_thesis)}</blockquote>` : ''}`
      : `<span class="label agent-tag">${stop.beat.date} · trader</span>
         <div class="card-title">${esc(stop.beat.title)}</div>
         <blockquote>${esc(stop.beat.note)}</blockquote>`;
    cardsEl.appendChild(el);
  }
} else {
  const hint = document.getElementById('scroll-hint');
  const tick = t => {
    const panX = scroller.scrollLeft;
    uiState.revealDay = story ? story.update(panX, stage.clientWidth) : Infinity;
    renderer.draw({ revealDay: uiState.revealDay, t, panX,
      highlightId: uiState.highlightId, filter: uiState.filter });
    equityPaths.panGroup.setAttribute('transform', `translate(${-panX} 0)`);
    hint.classList.toggle('hidden', panX > 60);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
window.addEventListener('resize', () => {
  buildScene();
  renderer.draw({ panX: scroller.scrollLeft });
  equityPaths.panGroup.setAttribute('transform', `translate(${-scroller.scrollLeft} 0)`);
});
