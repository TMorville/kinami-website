// Threat map — bespoke dark Europe map with sourced drone incidents.
// Vanilla; renders country polygons + incident markers to a <canvas>.
// Exposes nothing global beyond init(), run on DOMContentLoaded.

(function () {
  'use strict';

  // --- Projection (Web Mercator), per spec --------------------------------
  const D2R = Math.PI / 180;
  const mercX = (lon) => lon * D2R;
  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));

  const LON0 = -10, LON1 = 31, LATtop = 66, LATbot = 42;
  // LON1 is part of the region spec; X is fit by height-scale + pan, so it is
  // not used directly in the math but documents the intended right edge.
  void LON1;

  // Colours (mirror the CSS design tokens; canvas can't read CSS vars cheaply)
  const LAND_FILL = 'rgba(220,180,100,0.05)';
  const LAND_STROKE = 'rgba(220,180,100,0.18)';
  const SIGNAL = '#E8A33D';

  let canvas, ctx, tooltip;
  let geojson = null;
  let data = null;
  // Marker screen positions cached for hit-testing: {x, y, r, incident}
  let markers = [];
  let cssW = 0, cssH = 0;
  let proj = null; // current projection closure
  // Country polygons drawn once per resize into an offscreen canvas, so the
  // ping loop below composites a bitmap per frame instead of refilling Europe.
  let land = null;

  // --- Radar ping for fresh incidents ---------------------------------------
  // Mirrors map/src/curated.js: an incident is fresh for seven days after its
  // event date, measured on the reader's clock. This file is a classic script
  // shared with the gated deck, so it carries its own copy of the rule.
  const FRESH_MS = 7 * 86400000;
  const PING_PERIOD_MS = 2400;
  const PING_MAX_FACTOR = 6; // the ring grows to six half-diagonals
  const PING_OPACITY = 0.6;
  let fresh = []; // incidents under seven days old
  let pingT0 = 0;

  function isFresh(dateIso, nowMs) {
    const t = Date.parse(dateIso);
    return isFinite(t) && nowMs - t < FRESH_MS;
  }

  function reducedMotion() {
    return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Phase in [0, 1) of the ping cycle. Reduced motion holds one mid-cycle ring.
  function currentPhase() {
    if (fresh.length === 0) return 0;
    if (reducedMotion()) return 0.5;
    return ((performance.now() - pingT0) % PING_PERIOD_MS) / PING_PERIOD_MS;
  }

  function buildProjection(canvasCssWidth, canvasCssHeight) {
    const s = canvasCssHeight / (mercY(LATtop) - mercY(LATbot));
    const panX = 0.60 * canvasCssWidth - (mercX(12) - mercX(LON0)) * s;
    return function project(lon, lat) {
      return {
        x: (mercX(lon) - mercX(LON0)) * s + panX,
        y: (mercY(LATtop) - mercY(lat)) * s,
      };
    };
  }

  function drawRing(g, ring, project) {
    if (!ring || ring.length === 0) return;
    for (let i = 0; i < ring.length; i++) {
      const p = project(ring[i][0], ring[i][1]);
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.closePath();
  }

  function drawPolygon(g, rings, project) {
    // rings: [outer, hole, hole, ...]; canvas even-odd handles holes.
    g.beginPath();
    for (let r = 0; r < rings.length; r++) drawRing(g, rings[r], project);
    g.fill('evenodd');
    g.stroke();
  }

  function drawLand(g, project) {
    if (!geojson) return;
    g.fillStyle = LAND_FILL;
    g.strokeStyle = LAND_STROKE;
    g.lineWidth = 0.75;
    g.lineJoin = 'round';
    const feats = geojson.features || [];
    for (let f = 0; f < feats.length; f++) {
      const geom = feats[f].geometry;
      if (!geom) continue;
      if (geom.type === 'Polygon') {
        drawPolygon(g, geom.coordinates, project);
      } else if (geom.type === 'MultiPolygon') {
        for (let m = 0; m < geom.coordinates.length; m++) {
          drawPolygon(g, geom.coordinates[m], project);
        }
      }
    }
  }

  // Render the land once per resize at device resolution.
  function paintLand(project) {
    const dpr = window.devicePixelRatio || 1;
    land = document.createElement('canvas');
    land.width = Math.max(1, Math.round(cssW * dpr));
    land.height = Math.max(1, Math.round(cssH * dpr));
    const g = land.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLand(g, project);
  }

  // One expanding, fading ring per fresh incident, drawn under the diamonds.
  // A stroke, not a disc, so it never reads as a bigger, brighter incident.
  function drawPings(project, phase) {
    if (fresh.length === 0) return;
    const p = Math.min(1, Math.max(0, phase));
    const eased = 1 - (1 - p) * (1 - p);
    const alpha = PING_OPACITY * (1 - p);
    if (alpha <= 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(232,163,61,' + alpha.toFixed(3) + ')';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < fresh.length; i++) {
      const inc = fresh[i];
      const pt = project(inc.lng, inc.lat);
      const r0 = inc.category === 'airport-closure' ? 5 : 4;
      const radius = r0 + (PING_MAX_FACTOR - 1) * r0 * eased;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMarkers(project) {
    if (!data || !data.incidents) return;
    markers = [];
    const incidents = data.incidents;
    for (let i = 0; i < incidents.length; i++) {
      const inc = incidents[i];
      const p = project(inc.lng, inc.lat);
      // A diamond, not a dot: documented incidents keep their own form so
      // they can never be confused with the live map's circular crowd
      // reports. Half-diagonal 5 px for an airport closure, 4 px otherwise.
      const r = inc.category === 'airport-closure' ? 5 : 4;

      function diamondPath() {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r);
        ctx.lineTo(p.x + r, p.y);
        ctx.lineTo(p.x, p.y + r);
        ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
      }

      // Soft amber glow
      ctx.save();
      ctx.shadowColor = 'rgba(232,163,61,0.9)';
      ctx.shadowBlur = 10;
      diamondPath();
      ctx.fillStyle = SIGNAL;
      ctx.fill();
      ctx.restore();

      // Solid core (no shadow, crisp)
      diamondPath();
      ctx.fillStyle = SIGNAL;
      ctx.fill();

      markers.push({ x: p.x, y: p.y, r: r, incident: inc });
    }
  }

  function render(phase) {
    if (!ctx) return;
    ctx.clearRect(0, 0, cssW, cssH);
    proj = buildProjection(cssW, cssH);
    if (land) ctx.drawImage(land, 0, 0, cssW, cssH);
    drawPings(proj, phase || 0);
    drawMarkers(proj);
  }

  function resize() {
    const box = document.querySelector('.threat-box');
    if (box) box.classList.toggle('is-clipped', box.scrollHeight > box.clientHeight + 1);
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    cssW = rect.width;
    cssH = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px
    paintLand(buildProjection(cssW, cssH));
    render(currentPhase());
  }

  // The loop exists only while a fresh incident exists and motion is allowed;
  // otherwise resize() has already drawn the one static frame. Frames are
  // skipped while the canvas is scrolled out of view.
  function startPing() {
    if (fresh.length === 0 || reducedMotion()) return;
    pingT0 = performance.now();
    let visible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
      }).observe(canvas);
    }
    function frame() {
      if (visible) render(currentPhase());
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // --- Hover tooltip -------------------------------------------------------
  function ensureTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.className = 'threat-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function fmtDate(iso) {
    // "2025-09-22" -> "22 Sep 2025"
    if (!iso) return '';
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const m = months[parseInt(parts[1], 10) - 1] || parts[1];
    return parts[2].replace(/^0/, '') + ' ' + m + ' ' + parts[0];
  }

  function clampText(str, max) {
    if (!str) return '';
    if (str.length <= max) return str;
    return str.slice(0, max - 1).trimEnd() + '…';
  }

  function hitTest(mx, my) {
    let best = null;
    let bestDist = 9; // px threshold
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const d = Math.hypot(mx - m.x, my - m.y);
      if (d <= bestDist) { bestDist = d; best = m; }
    }
    return best;
  }

  function showTooltip(m, clientX, clientY) {
    const tt = ensureTooltip();
    const inc = m.incident;
    tt.innerHTML =
      '<div class="tt-label">' + escapeHtml(inc.label) + '</div>' +
      '<div class="tt-date">' + escapeHtml(fmtDate(inc.date)) +
        (inc.country ? ' · ' + escapeHtml(inc.country) : '') + '</div>' +
      '<div class="tt-desc">' + escapeHtml(clampText(inc.description, 46 * 3)) + '</div>';
    tt.style.display = 'block';
    positionTooltip(clientX, clientY);
  }

  function positionTooltip(clientX, clientY) {
    if (!tooltip) return;
    const pad = 14;
    const w = tooltip.offsetWidth;
    const h = tooltip.offsetHeight;
    let x = clientX + pad;
    let y = clientY + pad;
    if (x + w > window.innerWidth - 8) x = clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = clientY - h - pad;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function onMove(ev) {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (hit) {
      canvas.style.cursor = 'pointer';
      showTooltip(hit, ev.clientX, ev.clientY);
    } else {
      canvas.style.cursor = 'default';
      hideTooltip();
    }
  }

  function onTouch(ev) {
    if (!ev.touches || ev.touches.length === 0) return;
    const t = ev.touches[0];
    const rect = canvas.getBoundingClientRect();
    const mx = t.clientX - rect.left;
    const my = t.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (hit) showTooltip(hit, t.clientX, t.clientY);
    else hideTooltip();
  }

  // --- Explainer-box dynamic content --------------------------------------
  function fillStats() {
    const host = document.getElementById('threat-stats');
    if (!host || !data || !data.stats) return;
    host.innerHTML = '';
    for (let i = 0; i < data.stats.length; i++) {
      const st = data.stats[i];
      const row = document.createElement('a');
      row.className = 'threat-stat';
      row.href = st.source;
      row.target = '_blank';
      row.rel = 'noopener';
      const v = document.createElement('span');
      v.className = 'threat-stat-value';
      v.textContent = st.value;
      const l = document.createElement('span');
      l.className = 'threat-stat-label';
      l.textContent = st.label;
      row.appendChild(v);
      row.appendChild(l);
      host.appendChild(row);
    }
  }

  // The gated deck's copy of the explainer has a footline; the product page
  // does not. One script serves both roots, so this is a no-op without it.
  function fillFootline() {
    const el = document.getElementById('threat-footline');
    if (!el || !data || !data.incidents) return;
    const n = data.incidents.length;
    const countries = new Set();
    for (let i = 0; i < data.incidents.length; i++) {
      if (data.incidents[i].country) countries.add(data.incidents[i].country);
    }
    el.textContent = n + ' reported incidents · ' + countries.size +
      ' countries · every marker sourced';
  }

  // --- Init ----------------------------------------------------------------
  function init() {
    canvas = document.getElementById('threat-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    Promise.all([
      fetch('assets/europe.min.geojson').then((r) => r.json()),
      fetch('assets/threat-data.json?v=' + Date.now()).then((r) => r.json()),
    ])
      .then(function (res) {
        geojson = res[0];
        data = res[1];
        const now = Date.now();
        fresh = (data.incidents || []).filter(function (inc) { return isFresh(inc.date, now); });
        fillStats();
        fillFootline();
        resize();
        startPing();
      })
      .catch(function (err) {
        // Map is decorative-with-data; a fetch failure shouldn't break the page.
        console.error('threat-map: failed to load data', err);
      });

    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', hideTooltip);
    canvas.addEventListener('touchstart', onTouch, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
