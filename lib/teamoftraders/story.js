// Story layer: week theses and beats embedded IN the timeline as glass cards
// at their week's world-x, lighting up as they pan into view. The equity stream
// runs ambient behind everything; markers reveal just ahead of the pan edge.
// No scroll hijacking — the user drives; the story sits where the data is.
import { buildStops, esc, WEEK_TITLES } from './narrative.js';
import { dayX } from './strata.js';

function chapterHTML(stop) {
  const thesis = (label, w) => w && w.market_thesis
    ? `<blockquote>${label} — ${esc(w.market_thesis.slice(0, 150))}…</blockquote>` : '';
  return `
    <span class="label agent-tag">${stop.week} · strategist</span>
    <div class="card-title">${esc(WEEK_TITLES[stop.week] || 'the plan')}</div>
    ${thesis('EU', stop.eu)}${thesis('US', stop.us)}`;
}

function beatHTML(beat) {
  const who = beat.market ? beat.market.toUpperCase() : 'BOTH BOOKS';
  return `
    <span class="label agent-tag">${beat.date} · ${who} · trader</span>
    <div class="card-title">${esc(beat.title)}</div>
    <blockquote>${esc(beat.note)}</blockquote>`;
}

export function initStory(index, { cardsEl, lanes }) {
  const stops = buildStops(index);
  const X = dayX(index, lanes.x0, lanes.width);
  cardsEl.innerHTML = '';
  // Left-to-right sweep: cards keep their week's x but never overlap or clip.
  const HALF = 200;                                  // ≈ half card width + breath
  let lastRight = lanes.x0;
  const cards = stops.map(stop => {
    const el = document.createElement('div');
    el.className = `card ${stop.kind}`;
    el.innerHTML = stop.kind === 'chapter' ? chapterHTML(stop) : beatHTML(stop.beat);
    // No right-edge clamp — late cards overflow into the spacer's tail room
    // instead of piling up on top of each other at the world end.
    const worldX = Math.max(X(stop.day), lastRight + HALF + 24);
    lastRight = worldX + HALF;
    el.style.left = `${worldX}px`;
    el.style.top = stop.kind === 'chapter' ? '40%' : '48%';
    cardsEl.appendChild(el);
    return { el, worldX };
  });

  // The equity stream runs ambient in the background — always present, fading in
  // from the void at the start — so it is not drawn on with the pan; only the
  // markers reveal just ahead of the pan edge (below).
  const dayCount = index.dayList.length;

  /** Per-frame: pan the cards layer, light visible cards.
   *  Returns the reveal edge in day units (markers appear as the pan reaches them). */
  function update(panX, viewportW) {
    cardsEl.style.transform = `translateX(${-panX}px)`;
    for (const { el, worldX } of cards) {
      const lit = worldX > panX + viewportW * 0.06 && worldX < panX + viewportW * 0.86;
      el.classList.toggle('lit', lit);
    }
    // Denominator is slightly short of full width so the reveal edge reaches the
    // end while the scroller can still travel there.
    const edgeX = panX + viewportW * 0.85;
    const progress = Math.min(Math.max((edgeX - lanes.x0) / (lanes.width * 0.98), 0), 1);
    return progress * dayCount - 0.5;
  }

  return { update };
}
