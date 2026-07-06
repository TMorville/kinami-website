// Horizontal equity + benchmark lines per lane, plus a dotted faint bridge
// across the pre-snapshot window ("no daily record" — the book verifiably
// started at starting capital; only the in-between path is unrecorded).
// The narrative task animates the solid equity path via stroke-dashoffset.
import { dayX } from './strata.js';

/** SVG path d-string from [{x, y}] points. Pure — node-testable. */
export function linePath(points) {
  return points
    .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
}

/** The three d-strings for one lane: pre-record bridge, equity, benchmark. */
export function lanePaths(index, market, { x0, width, yScale, anchors }) {
  const m = index.raw.markets[market];
  const X = dayX(index, x0, width);
  const pt = (day, value) => ({ x: X(day), y: yScale(value) });
  const dayOf = r => index.dayIndex.get(r.date) ?? 0;
  const eqPts = m.equity.map(r => pt(dayOf(r), r.equity));
  const benchPts = m.equity.map(r => pt(dayOf(r), r.benchmark_equity));
  let pre = '';
  if (m.equity.length && anchors.length && anchors[0].day < dayOf(m.equity[0])) {
    pre = linePath([pt(anchors[0].day, anchors[0].value), eqPts[0]]);
  }
  return { pre, equity: linePath(eqPts), benchmark: linePath(benchPts) };
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
    const { pre, equity, benchmark } = lanePaths(index, market, geoms[market]);
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
      pre: mount(pre, 'rgba(220, 180, 100, 0.2)', '1', '1 5'),
      benchmark: mount(benchmark, 'rgba(220, 180, 100, 0.25)', '1', '2 4'),
      equity: mount(equity, 'rgba(240, 200, 130, 0.7)', '1.5'),
    };
  }
  return paths;
}
