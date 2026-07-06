// Bootstrap for the teamoftraders page. The JSON import below is the
// live-feed seam: swap it for a fetch() when the data goes live (spec §3.1).
import raw from '/assets/teamoftraders/showcase.json';
import { indexShowcase, fmtMoney } from '/lib/teamoftraders/data.js';
import {
  buildAnchors, laneScale, layoutMarket, weekBands, dayX, equityAtDay, isoWeekId,
} from '/lib/teamoftraders/strata.js';
import { createRenderer, laneGeometry } from '/lib/teamoftraders/render.js';
import { mountEquity } from '/lib/teamoftraders/equity.js';
import { initStory } from '/lib/teamoftraders/story.js';
import { initInteract } from '/lib/teamoftraders/interact.js';
import { initStrategy } from '/lib/teamoftraders/strategy.js';
import { buildStops, esc, WEEK_TITLES } from '/lib/teamoftraders/narrative.js';

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
  // Tail room so the end-of-line tallies and the final story cards aren't
  // clipped at max scroll.
  spacer.style.width = `${virtualWidth + 2 * lanes.x0 + (STATIC_MODE ? 0 : 420)}px`;
  const models = { eu: buildLaneModel('eu', lanes), us: buildLaneModel('us', lanes) };
  const laneBounds = market => ({
    yMin: lanes[market].y0 - 10,
    yMax: lanes[market].y0 + lanes[market].height + 22,
  });
  markersRef.eu = layoutMarket(index, 'eu',
    { x0: lanes.x0, width: lanes.width, ...models.eu, ...laneBounds('eu') });
  markersRef.us = layoutMarket(index, 'us',
    { x0: lanes.x0, width: lanes.width, ...models.us, ...laneBounds('us') });
  const bands = weekBands(index, lanes.x0, lanes.width);
  sceneRef.lanes = lanes;
  sceneRef.bands = bands;
  sceneRef.models = models;
  // Caption the unrecorded window so the late-starting solid line reads as
  // intentional, not broken.
  const annotations = [];
  const X = dayX(index, lanes.x0, lanes.width);
  for (const market of ['eu', 'us']) {
    const rows = raw.markets[market].equity;
    const model = models[market];
    if (!rows.length || !model.anchors.length) continue;
    const firstSnapDay = index.dayIndex.get(rows[0].date) ?? 0;
    if (model.anchors[0].day < firstSnapDay) {
      const midDay = (model.anchors[0].day + firstSnapDay) / 2;
      annotations.push({
        x: X(midDay),
        y: model.yScale(equityAtDay(midDay, model.anchors)) - 16,
        text: `no daily record until ${rows[0].date} · estimated path`,
      });
    }
  }
  // The closing score at the end of each lane: closed round trips won / lost.
  const tallies = [];
  for (const market of ['eu', 'us']) {
    const trades = raw.markets[market].trades;
    const model = models[market];
    if (!model.anchors.length) continue;
    const wins = trades.filter(t => t.realized_pnl != null && t.is_win === true).length;
    const losses = trades.filter(t => t.realized_pnl != null && t.is_win === false).length;
    const endY = model.yScale(model.anchors[model.anchors.length - 1].value);
    tallies.push(STATIC_MODE
      ? { x: lanes.x0 + lanes.width - 6, y: endY, wins, losses, align: 'right' }
      : { x: lanes.x0 + lanes.width + 18, y: endY, wins, losses, align: 'left' });
  }
  renderer = createRenderer(canvas, { markersByMarket: markersRef, bands, lanes, annotations, tallies });
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
         <div class="card-title">${esc(WEEK_TITLES[stop.week] || 'the plan')}</div>
         ${stop.eu?.market_thesis ? `<blockquote>EU — ${esc(stop.eu.market_thesis)}</blockquote>` : ''}
         ${stop.us?.market_thesis ? `<blockquote>US — ${esc(stop.us.market_thesis)}</blockquote>` : ''}`
      : `<span class="label agent-tag">${stop.beat.date} · trader</span>
         <div class="card-title">${esc(stop.beat.title)}</div>
         <blockquote>${esc(stop.beat.note)}</blockquote>`;
    cardsEl.appendChild(el);
  }
} else {
  const hint = document.getElementById('scroll-hint');
  let currentWeek = null;
  const tick = t => {
    const panX = scroller.scrollLeft;
    uiState.revealDay = story ? story.update(panX, stage.clientWidth) : Infinity;
    renderer.draw({ revealDay: uiState.revealDay, t, panX,
      highlightId: uiState.highlightId, filter: uiState.filter });
    equityPaths.panGroup.setAttribute('transform', `translate(${-panX} 0)`);
    hint.classList.toggle('hidden', panX > 60);

    // Light the week rail as the viewport centre crosses each week.
    const n = index.dayList.length;
    const centreDay = Math.max(0, Math.min(Math.floor(
      ((panX + stage.clientWidth / 2 - sceneRef.lanes.x0) / sceneRef.lanes.width) * n), n - 1));
    const week = isoWeekId(index.dayList[centreDay]);
    if (week !== currentWeek) {
      currentWeek = week;
      for (const b of document.querySelectorAll('#week-rail button')) {
        b.classList.toggle('current', b.dataset.weekId === week);
        b.classList.toggle('passed', b.dataset.weekId < week);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
window.addEventListener('resize', () => {
  buildScene();
  renderer.draw({ panX: scroller.scrollLeft });
  equityPaths.panGroup.setAttribute('transform', `translate(${-scroller.scrollLeft} 0)`);
});
