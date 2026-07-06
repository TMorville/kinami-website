// Weekly-strategy layer: filter pills, the week rail, and the strategy panel —
// the plan (thesis, watchlist intents) vs what actually traded, cross-linked
// with the trade dossiers. Plan → execution → outcome is the piece's spine.
import { fmtMoney, weekExecution } from './data.js';
import { esc, WEEK_TITLES } from './narrative.js';

export function initStrategy(index, { scroller, sceneRef, uiState, interact, requestDraw }) {
  const filtersEl = document.getElementById('filters');
  const rail = document.getElementById('week-rail');
  const panel = document.getElementById('strategy-panel');

  // ---- filters -------------------------------------------------------
  const filterState = { market: 'all', outcome: 'all', ticker: null };
  function applyFilter() {
    const { market, outcome, ticker } = filterState;
    uiState.filter = (market === 'all' && outcome === 'all' && !ticker) ? null : m => {
      const trade = index.tradesById.get(m.id);
      if (market !== 'all' && trade.market !== market) return false;
      if (ticker && trade.ticker !== ticker) return false;
      if (outcome === 'wins') return trade.is_win === true;
      if (outcome === 'losses') return trade.is_win === false;
      if (outcome === 'open') return trade.is_win === null;
      return true;
    };
    renderFilterBar();
    requestDraw();
  }
  function renderFilterBar() {
    const pill = (group, value, label) => `
      <button class="pill" data-group="${group}" data-value="${value}"
        aria-pressed="${String(filterState[group]) === value}">${label}</button>`;
    filtersEl.innerHTML =
      pill('market', 'all', 'both books') + pill('market', 'eu', 'eu') + pill('market', 'us', 'us') +
      pill('outcome', 'all', 'all trades') + pill('outcome', 'wins', 'wins') +
      pill('outcome', 'losses', 'losses') + pill('outcome', 'open', 'open') +
      (filterState.ticker
        ? `<button class="pill" data-group="ticker" data-value="" aria-pressed="true">
             ${esc(filterState.ticker)} ×</button>` : '');
  }
  filtersEl.addEventListener('click', ev => {
    const btn = ev.target.closest('.pill');
    if (!btn) return;
    const { group, value } = btn.dataset;
    filterState[group] = group === 'ticker' ? null : value;
    applyFilter();
  });
  renderFilterBar();

  // ---- week rail -----------------------------------------------------
  const weekIds = [...new Set([...index.weeksByKey.keys()].map(k => k.split(':')[1]))].sort();
  rail.innerHTML = weekIds.map(w =>
    `<button role="tab" data-week-id="${w}">${w.replace('2026-', '')}</button>`).join('');
  rail.addEventListener('click', ev => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    const w = btn.dataset.weekId;
    const band = sceneRef.bands?.find(b => b.week === w);
    if (band && sceneRef.lanes) {
      scroller.scrollTo({ left: Math.max(band.x0 - sceneRef.lanes.x0 - 40, 0), behavior: 'smooth' });
    }
    openStrategyPanel(`${index.weeksByKey.has(`eu:${w}`) ? 'eu' : 'us'}:${w}`);
  });

  // ---- strategy panel ------------------------------------------------
  function openStrategyPanel(key) {
    const [market, weekId] = key.split(':');
    const week = index.weeksByKey.get(key);
    if (!week) return;
    const m = index.raw.markets[market];
    const trades = index.tradesByWeek.get(key) || [];
    const { rows, offPlan } = weekExecution(week, trades);
    const other = market === 'eu' ? 'us' : 'eu';
    const otherKey = `${other}:${weekId}`;
    const execRows = rows.map(r => `
      <tr data-ticker="${esc(r.ticker)}"><td>${esc(r.ticker)}</td><td>${r.direction ?? '—'}</td>
        <td>${r.tradeCount
          ? `${r.tradeCount} trade${r.tradeCount > 1 ? 's' : ''}${r.realizedPnl
              ? ` · ${fmtMoney(r.realizedPnl, m.currency)} realized` : ''}`
          : 'untouched'}</td></tr>`).join('');
    panel.innerHTML = `
      <button class="close" aria-label="close">×</button>
      <h2>${esc(WEEK_TITLES[weekId] || 'the plan')}
        <span class="label">${weekId} · ${market} · ${esc(week.risk_posture || '')}</span></h2>
      ${index.weeksByKey.has(otherKey)
        ? `<button class="pill" data-switch="${otherKey}">view ${other} week →</button>` : ''}
      <div class="section"><span class="label">market thesis · strategist</span>
        <blockquote>${esc(week.market_thesis)}</blockquote></div>
      <div class="section"><span class="label">plan vs execution · click a row to filter</span>
        <table><tr><th>ticker</th><th>intent</th><th>what happened</th></tr>${execRows}</table>
        ${offPlan.length
          ? `<p class="label">off-plan trades: ${offPlan.map(esc).join(', ')}</p>` : ''}</div>
      ${week.key_events.length ? `
        <div class="section"><span class="label">key events</span>
          <table>${week.key_events.map(k => `
            <tr><td>${esc(k.date)}</td><td>${esc(k.ticker)}</td><td>${esc(k.description)}</td></tr>`).join('')}
          </table></div>` : ''}`;
    panel.classList.add('open');
    panel.querySelector('.close').onclick = () => panel.classList.remove('open');
    panel.querySelectorAll('tr[data-ticker]').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.onclick = () => {
        filterState.ticker = tr.dataset.ticker;
        applyFilter();
        panel.classList.remove('open');
      };
    });
    const switchBtn = panel.querySelector('[data-switch]');
    if (switchBtn) switchBtn.onclick = () => openStrategyPanel(switchBtn.dataset.switch);
  }

  interact.openStrategyPanel = openStrategyPanel;   // trade dossier → its week's plan
  return { openStrategyPanel };
}
