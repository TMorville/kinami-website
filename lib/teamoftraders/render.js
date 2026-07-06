// Canvas2D renderer for the timeline. One code path serves both the
// narrative (revealDay scrubbed by scroll) and the explorer (fully revealed,
// filtered/highlighted by interaction). Visual identity: single-hue amber
// markers glowing on the equity path, whisper week stripes on void.

const WIN = a => `rgba(240, 200, 130, ${a})`;
const AMBER = a => `rgba(220, 180, 100, ${a})`;

/** Two stacked lanes sharing an x axis: EU above, US below. */
export function laneGeometry(width, height) {
  return {
    x0: width * 0.06,
    width: width * 0.88,
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

  function draw({ revealDay = Infinity, t = 0, highlightId = null, filter = null } = {}) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    const h = canvas.height / dpr;

    // Week stripes — whisper vertical dividers + mono labels along the bottom.
    ctx.font = '300 10px "DM Mono", monospace';
    ctx.textAlign = 'center';
    for (const band of bands) {
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

    // Lane captions.
    ctx.font = '300 10px "DM Mono", monospace';
    ctx.fillStyle = AMBER(0.55);
    ctx.textAlign = 'left';
    ctx.fillText('EU · XETRA', lanes.x0, lanes.eu.y0 - 8);
    ctx.fillText('US · NYSE/NASDAQ', lanes.x0, lanes.us.y0 - 8);
  }

  resize();
  return { draw, resize };
}
