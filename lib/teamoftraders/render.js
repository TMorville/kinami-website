// Canvas2D renderer for the timeline. One code path serves both the
// narrative (revealDay scrubbed by scroll) and the explorer (fully revealed,
// filtered/highlighted by interaction). Visual identity: single-hue amber
// markers glowing on the equity path, whisper week stripes on void.

const WIN = a => `rgba(240, 200, 130, ${a})`;
const AMBER = a => `rgba(220, 180, 100, ${a})`;

/** Two stacked lanes sharing a world-space x axis: EU above, US below.
 *  `width` is the WORLD width (virtualWidth); x0 a fixed left margin. */
export function laneGeometry(viewportWidth, height, virtualWidth) {
  return {
    x0: 40,
    width: virtualWidth,
    viewportWidth,
    eu: { y0: height * 0.10, height: height * 0.32 },
    us: { y0: height * 0.56, height: height * 0.32 },
  };
}

export function createRenderer(canvas, { markersByMarket, bands, lanes }) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  function markerColor(m, alphaScale = 1) {
    if (m.win === true) return WIN(0.85 * alphaScale);
    if (m.win === false) return AMBER(0.30 * alphaScale);
    return AMBER(0.55 * alphaScale);
  }

  function draw({ revealDay = Infinity, t = 0, highlightId = null, filter = null, panX = 0 } = {}) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const viewL = panX - 60;          // cull margin
    const viewR = panX + w + 60;

    ctx.save();
    ctx.translate(-panX, 0);

    // Week stripes — whisper vertical dividers + mono labels along the bottom.
    ctx.font = '300 10px "DM Mono", monospace';
    ctx.textAlign = 'center';
    for (const band of bands) {
      if (band.x1 < viewL || band.x0 > viewR) continue;
      ctx.strokeStyle = AMBER(0.06);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(band.x0 + 0.5, lanes.eu.y0 - 14);
      ctx.lineTo(band.x0 + 0.5, lanes.us.y0 + lanes.us.height + 14);
      ctx.stroke();
      ctx.fillStyle = AMBER(0.35);
      ctx.fillText(band.week.replace('2026-', ''),
        (band.x0 + band.x1) / 2, Math.min(lanes.us.y0 + lanes.us.height + 28, h - 6));
    }

    // Markers — additive glow; reveal follows the scrubbed day.
    ctx.globalCompositeOperation = 'lighter';
    for (const market of ['eu', 'us']) {
      for (const m of markersByMarket[market]) {
        if (m.day > revealDay) continue;
        if (m.x < viewL || m.x > viewR) continue;
        const dimmed = filter && !filter(m);
        const alphaScale = dimmed ? 0.15 : 1;
        const y = m.y + Math.sin(t * 0.0003 + m.phase) * 1.2;

        ctx.fillStyle = markerColor(m, 0.25 * alphaScale); // halo
        ctx.beginPath();
        ctx.arc(m.x, y, m.r * 2.2, 0, Math.PI * 2);
        ctx.fill();

        if (m.ring) {
          ctx.strokeStyle = markerColor(m, alphaScale);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(m.x, y, m.r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = markerColor(m, alphaScale);
          ctx.beginPath();
          ctx.arc(m.x, y, m.r, 0, Math.PI * 2);
          ctx.fill();
        }

        if (m.id === highlightId) {
          ctx.strokeStyle = WIN(0.9);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(m.x, y, m.r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // Lane captions — viewport furniture, pinned right while the world pans
    // (right edge stays clear of the filter stack at narrow widths).
    ctx.font = '300 10px "DM Mono", monospace';
    ctx.fillStyle = AMBER(0.55);
    ctx.textAlign = 'right';
    const captionX = (lanes.viewportWidth || w) - 16;
    ctx.fillText('EU · XETRA', captionX, lanes.eu.y0 - 8);
    ctx.fillText('US · NYSE/NASDAQ', captionX, lanes.us.y0 - 8);
  }

  resize();
  return { draw, resize };
}
