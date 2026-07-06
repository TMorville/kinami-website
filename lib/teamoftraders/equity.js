// The equity line per lane, rendered as a soft stream of light running behind
// the candles — not a thin rule. Several stacked, round-capped strokes (widest
// and faintest outermost, no hard core) build a broad luminous band along a
// smooth Catmull-Rom curve. Each layer fades in from transparent across the
// unrecorded pre-record window (a gradient in world space), so the estimated
// lead-in emerges from the void instead of arriving as a confident line.
import { dayX } from './strata.js';

/** SVG path d-string (straight M/L chain) from [{x, y}]. Pure — node-testable. */
export function linePath(points) {
  return points
    .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
}

/** Smooth cubic-bezier path through points (Catmull-Rom, clamped ends).
 *  Each segment's endpoints are the original points, so the curve still passes
 *  through every anchor — only the connecting path bends. Pure — node-testable. */
export function smoothPath(points, tension = 0.85) {
  const n = points.length;
  if (n === 0) return '';
  const f = v => v.toFixed(1);
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension;
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** The d-strings for one lane: smooth equity (all anchors), straight benchmark. */
export function lanePaths(index, market, { x0, width, yScale, anchors }) {
  const m = index.raw.markets[market];
  const X = dayX(index, x0, width);
  const pt = (day, value) => ({ x: X(day), y: yScale(value) });
  const dayOf = r => index.dayIndex.get(r.date) ?? 0;
  const eqPts = anchors.map(a => pt(a.day, a.value));
  const benchPts = m.equity.map(r => pt(dayOf(r), r.benchmark_equity));
  return { equity: smoothPath(eqPts), benchmark: linePath(benchPts) };
}

// Stacked strokes forming the stream: widest+faintest first, no crisp core.
const STREAM_LAYERS = [
  { width: '34', alpha: 0.035 },
  { width: '22', alpha: 0.05 },
  { width: '13', alpha: 0.08 },
  { width: '7', alpha: 0.12 },
  { width: '3', alpha: 0.16 },
];

/** Mount the equity stream for both markets into an <svg>, inside one pannable
 *  <g> (world coordinates; the caller syncs its transform with the scroller). */
export function mountEquity(svg, index, geoms) {
  const NS = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';
  const defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);
  const panGroup = document.createElementNS(NS, 'g');
  svg.appendChild(panGroup);
  const paths = { panGroup };

  // A world-space gradient that fades a stroke in from transparent (at the
  // timeline start) to full opacity by the first real snapshot, then holds.
  const fadeGradient = (id, startX, endX, alpha) => {
    const g = document.createElementNS(NS, 'linearGradient');
    g.setAttribute('id', id);
    g.setAttribute('gradientUnits', 'userSpaceOnUse');
    g.setAttribute('x1', startX.toFixed(1)); g.setAttribute('y1', '0');
    g.setAttribute('x2', endX.toFixed(1)); g.setAttribute('y2', '0');
    for (const [offset, op] of [['0', 0], ['1', alpha]]) {
      const s = document.createElementNS(NS, 'stop');
      s.setAttribute('offset', offset);
      s.setAttribute('stop-color', 'rgb(240, 200, 130)');
      s.setAttribute('stop-opacity', String(op));
      g.appendChild(s);
    }
    defs.appendChild(g);
    return `url(#${id})`;
  };

  for (const market of ['eu', 'us']) {
    const geom = geoms[market];
    const { equity } = lanePaths(index, market, geom);
    if (!equity) { paths[market] = { equity: [] }; continue; }
    const m = index.raw.markets[market];
    const X = dayX(index, geom.x0, geom.width);
    const startX = X(0);
    const firstSnapDay = m.equity.length ? (index.dayIndex.get(m.equity[0].date) ?? 0) : 0;
    // Fade completes at the first real snapshot; guard a zero-width ramp.
    const endX = Math.max(X(firstSnapDay), startX + 1);
    const layers = STREAM_LAYERS.map((spec, i) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', equity);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', fadeGradient(`stream-${market}-${i}`, startX, endX, spec.alpha));
      p.setAttribute('stroke-width', spec.width);
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      panGroup.appendChild(p);
      return p;
    });
    paths[market] = { equity: layers };
  }
  return paths;
}
