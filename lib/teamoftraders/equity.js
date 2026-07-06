// Horizontal equity + benchmark lines per lane. The equity line runs the
// anchors end to end — synthetic starting-capital anchor included — as one
// continuous quiet stroke; the unrecorded window is captioned on the canvas
// instead of styled differently. Story animates it via stroke-dashoffset.
import { dayX } from './strata.js';

/** SVG path d-string from [{x, y}] points. Pure — node-testable. */
export function linePath(points) {
  return points
    .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
}

/** The two d-strings for one lane: continuous equity (all anchors), benchmark. */
export function lanePaths(index, market, { x0, width, yScale, anchors }) {
  const m = index.raw.markets[market];
  const X = dayX(index, x0, width);
  const pt = (day, value) => ({ x: X(day), y: yScale(value) });
  const dayOf = r => index.dayIndex.get(r.date) ?? 0;
  const eqPts = anchors.map(a => pt(a.day, a.value));
  const benchPts = m.equity.map(r => pt(dayOf(r), r.benchmark_equity));
  return { equity: linePath(eqPts), benchmark: linePath(benchPts) };
}

/** Mount all lane paths for both markets into an <svg>, inside one pannable
 *  <g> (world coordinates; the caller syncs its transform with the scroller). */
export function mountEquity(svg, index, geoms) {
  const NS = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';
  const panGroup = document.createElementNS(NS, 'g');
  svg.appendChild(panGroup);
  const paths = { panGroup };
  for (const market of ['eu', 'us']) {
    const { equity, benchmark } = lanePaths(index, market, geoms[market]);
    const mount = (d, stroke, strokeWidth, dash) => {
      if (!d) return null;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', strokeWidth);
      if (dash) p.setAttribute('stroke-dasharray', dash);
      panGroup.appendChild(p);
      return p;
    };
    paths[market] = {
      benchmark: mount(benchmark, 'rgba(220, 180, 100, 0.25)', '1', '2 4'),
      equity: mount(equity, 'rgba(240, 200, 130, 0.35)', '1.5'),
    };
  }
  return paths;
}
