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

export function createRenderer(canvas, { markersByMarket, bands, lanes, annotations = [], tallies = [] }) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  function markerColor(m, alphaScale = 1) {
    if (!m.filled) return AMBER(0.55 * alphaScale);     // buys: neutral cost bars
    if (m.win === true) return WIN(0.9 * alphaScale);
    if (m.win === false) return AMBER(0.4 * alphaScale);
    return AMBER(0.6 * alphaScale);
  }

  function draw({ revealDay = Infinity, t = 0, highlightId = null, filter = null, panX = 0 } = {}) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    const w = canvas.width / dpr;
    const viewL = panX - 60;          // cull margin
    const viewR = panX + w + 60;

    ctx.save();
    ctx.translate(-panX, 0);

    // Week stripes — whisper vertical dividers (the rail below names them).
    for (const band of bands) {
      if (band.x1 < viewL || band.x0 > viewR) continue;
      ctx.strokeStyle = AMBER(0.06);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(band.x0 + 0.5, lanes.eu.y0 - 14);
      ctx.lineTo(band.x0 + 0.5, lanes.us.y0 + lanes.us.height + 14);
      ctx.stroke();
    }

    // Annotations — small in-world captions (e.g. the no-daily-record window).
    ctx.font = '300 10px "DM Mono", monospace';
    ctx.fillStyle = AMBER(0.3);
    ctx.textAlign = 'center';
    for (const a of annotations) {
      if (a.x < viewL || a.x > viewR) continue;
      ctx.fillText(a.text, a.x, a.y);
    }

    // Tallies — the closing score at the end of each lane's line.
    ctx.font = '300 13px "DM Mono", monospace';
    for (const tally of tallies) {
      if (tally.x < viewL || tally.x > viewR) continue;
      ctx.textAlign = tally.align;
      ctx.fillStyle = WIN(0.9);
      ctx.fillText(`${tally.wins} wins`, tally.x, tally.y - 7);
      ctx.fillStyle = AMBER(0.45);
      ctx.fillText(`${tally.losses} losses`, tally.x, tally.y + 13);
    }

    // Candle bars — buys hollow below the curve (length = cost), sells solid
    // (up bright = win, down dim = loss); soft glow; reveal follows the scrub.
    ctx.globalCompositeOperation = 'lighter';
    for (const market of ['eu', 'us']) {
      for (const m of markersByMarket[market]) {
        if (m.day > revealDay) continue;
        if (m.x < viewL || m.x > viewR) continue;
        const dimmed = filter && !filter(m);
        const alphaScale = dimmed ? 0.15 : 1;
        const drift = Math.sin(t * 0.0003 + m.phase) * 1.2;
        const yTop = m.yTop + drift;
        const color = markerColor(m, alphaScale);

        ctx.fillStyle = markerColor(m, 0.14 * alphaScale); // glow sheath
        ctx.fillRect(m.x - 9, yTop - 5, 18, m.h + 10);

        if (m.filled) {
          ctx.fillStyle = color;
          ctx.fillRect(m.x - 3.5, yTop, 7, m.h);
        } else {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(m.x - 3.5, yTop, 7, m.h);
        }
        ctx.fillStyle = color;                              // cap tick at the outer end
        const capY = m.dir === -1 ? yTop : yTop + m.h;
        ctx.fillRect(m.x - 5.5, capY - 1, 11, 2);

        // Ticker — beside its own segment, at the segment's height. Stacking
        // separates segments vertically, so names cannot collide.
        ctx.font = '300 11px "DM Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = markerColor(m, 0.7 * alphaScale);
        ctx.fillText(m.ticker, m.x + 13, m.cy + drift + 4);

        if (m.id === highlightId) {
          ctx.strokeStyle = WIN(0.9);
          ctx.lineWidth = 1;
          ctx.strokeRect(m.x - 9.5, yTop - 6, 19, m.h + 12);
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
