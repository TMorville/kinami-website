// Interaction layer on the timeline: hover a marker for the tooltip, click
// for the full trade dossier — the reasoning is the point. Listeners attach
// once; marker geometry is read through a stable ref that buildScene swaps.
import { fmtMoney } from './data.js';
import { esc } from './narrative.js';

/** Nearest marker within its radius + slack. Pure — node-testable. */
export function hitTest(markersByMarket, x, y, slack = 6) {
  let best = null;
  let bestD = Infinity;
  for (const market of ['eu', 'us']) {
    for (const m of markersByMarket[market]) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < m.r + slack && d < bestD) { best = m; bestD = d; }
    }
  }
  return best;
}

export function initInteract(index, { scroller, stage, markersRef, uiState, sceneRef }) {
  const tooltip = document.getElementById('tooltip');
  const tradePanel = document.getElementById('trade-panel');
  const readout = document.getElementById('crosshair-readout');
  const equityByDate = { eu: new Map(), us: new Map() };
  for (const market of ['eu', 'us']) {
    for (const row of index.raw.markets[market].equity) equityByDate[market].set(row.date, row);
  }

  function worldPoint(ev) {
    const rect = stage.getBoundingClientRect();
    return [ev.clientX - rect.left + scroller.scrollLeft, ev.clientY - rect.top];
  }
  function findAt(ev) {
    const [x, y] = worldPoint(ev);
    const m = hitTest(markersRef, x, y);
    return m && m.day <= uiState.revealDay ? m : null;
  }

  scroller.addEventListener('pointermove', ev => {
    const m = findAt(ev);
    if (m) {
      const trade = index.tradesById.get(m.id);
      const market = index.raw.markets[trade.market];
      const pnl = trade.realized_pnl != null
        ? ` · ${fmtMoney(trade.realized_pnl, market.currency)}` : '';
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(ev.clientX + 14, window.innerWidth - 240)}px`;
      tooltip.style.top = `${ev.clientY + 14}px`;
      tooltip.textContent = `${trade.ticker} · ${trade.action} · ${trade.date.slice(0, 10)}${pnl}`;
      scroller.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none';
      scroller.style.cursor = '';
    }
    uiState.highlightId = m ? m.id : null;

    // Crosshair readout: the date under the pointer + both books' raw money.
    if (sceneRef.lanes) {
      const [x] = worldPoint(ev);
      const n = index.dayList.length;
      const day = Math.max(0, Math.min(
        Math.floor(((x - sceneRef.lanes.x0) / sceneRef.lanes.width) * n), n - 1));
      const date = index.dayList[day];
      const parts = [date];
      for (const market of ['eu', 'us']) {
        const row = equityByDate[market].get(date);
        if (row) {
          const cur = index.raw.markets[market].currency;
          parts.push(`${market} ${fmtMoney(row.equity, cur)} vs ${fmtMoney(row.benchmark_equity, cur)}`);
        }
      }
      if (parts.length === 1) parts.push('no daily record');
      readout.textContent = parts.join(' · ');
    }
  });
  scroller.addEventListener('pointerleave', () => {
    tooltip.style.display = 'none';
    uiState.highlightId = null;
    readout.textContent = '';
  });
  scroller.addEventListener('click', ev => {
    const m = findAt(ev);
    if (m) openTradePanel(index.tradesById.get(m.id));
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      document.querySelectorAll('.panel.open').forEach(p => p.classList.remove('open'));
    }
  });

  function openTradePanel(trade) {
    const market = index.raw.markets[trade.market];
    const outcome = trade.is_win === null ? 'open / unmatched'
      : trade.is_win ? 'win' : 'loss';
    const pnlRow = trade.realized_pnl != null
      ? `<tr><td>realized</td><td>${fmtMoney(trade.realized_pnl, market.currency)}
           (${trade.realized_pnl_pct > 0 ? '+' : ''}${trade.realized_pnl_pct.toFixed(1)}%)</td></tr>`
      : '';
    tradePanel.innerHTML = `
      <button class="close" aria-label="close">×</button>
      <h2>${esc(trade.ticker)} <span class="label">${trade.market} · ${trade.week_id}</span></h2>
      <div class="section"><span class="label">the trade</span>
        <table>
          <tr><td>date</td><td>${trade.date.slice(0, 10)}</td></tr>
          <tr><td>action</td><td>${esc(trade.action)} ${trade.shares} @ ${trade.price}</td></tr>
          <tr><td>notional</td><td>${fmtMoney(trade.notional, market.currency)}</td></tr>
          ${pnlRow}
          <tr><td>outcome</td><td>${outcome}</td></tr>
        </table></div>
      <div class="section"><span class="label">the team's reasoning · ${esc(trade.agent)}</span>
        <blockquote>${esc(trade.reasoning)}</blockquote></div>
      <div class="section">
        <button class="pill" data-week="${trade.market}:${trade.week_id}">
          week ${trade.week_id} strategy →</button></div>`;
    tradePanel.classList.add('open');
    tradePanel.querySelector('.close').onclick = () => tradePanel.classList.remove('open');
  }

  const api = { openStrategyPanel: () => {} }; // implemented by the strategy layer
  tradePanel.addEventListener('click', ev => {
    const week = ev.target?.dataset?.week;
    if (week) api.openStrategyPanel(week);
  });
  return api;
}
