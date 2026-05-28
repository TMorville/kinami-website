// Live-drawn Kinami mark.
//
// The static mark (render.js dot variants) draws all 80k canonical points in
// one pass. This animator draws the SAME 80k-point trajectory — same locked
// (a, dt) and seed from attractor.js — but progressively, one frame at a time,
// stroking connected line segments. The canvas starts blank; the attractor
// fills in over ~15-20 seconds; then the head continues tracing the closed
// orbit, painting subtle motion onto the saturated shape.

import { halvorsenStep, ATTRACTOR_PARAMS, getNormalization } from './attractor.js';
import { PADDING } from './constants.js';

const { init } = ATTRACTOR_PARAMS;

const DEFAULTS = Object.freeze({
  // Euler steps per animation frame. 60 × 60 fps = 3600 steps/sec — head
  // visibly traces individual lobes for the first couple seconds; dense
  // steady-state around ~10 sec.
  stepsPerFrame: 60,
  // Stroke alpha per segment. Bumped from the slower-build version so the
  // freshly-drawn strokes read as bright "alive" lines during the animation
  // rather than barely-visible faint marks. Steady-state visual weight ends
  // up similar to the static mark either way (overdraw saturates).
  strokeAlpha: 0.06,
  // Stroke width is multiplied by DPR so the on-screen thickness stays at
  // ~1.2 CSS pixel regardless of display density — slightly thicker than
  // 1px so each stroke has more presence as it's drawn.
  lineWidthCss: 1.2,
  color: '220, 180, 100',
  // Phase-space jitter applied to the canonical seed. The trajectory still
  // converges to the same attractor (same `a`, same `dt`, same math), so the
  // steady-state shape is identical and brand-consistent — but the buildup
  // traces a different path through phase space each session, giving the
  // splash visual variation on every visit.
  seedJitter: 2.0,
});

/**
 * Start the mark animator on a square canvas. The canvas is treated as the
 * mark surface (same PADDING as the static master). Returns a stop function
 * that cancels the animation loop.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @returns {() => void} stop
 */
export function startMarkAnimator(canvas, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const scale = (Math.min(W, H) / 2) * PADDING;
  const canvasCx = W / 2;
  const canvasCy = H / 2;

  // Project raw integrator coordinates into [-1, 1] using the same affine
  // normalization the static master uses — so the live trace and the static
  // mark occupy identical screen space.
  const { cx: normCx, cy: normCy, halfSpan } = getNormalization();
  const project = (rx, ry) => [
    canvasCx + ((rx - normCx) / halfSpan) * scale,
    canvasCy + ((ry - normCy) / halfSpan) * scale,
  ];

  // Derive DPR from the CSS-styled width so stroke thickness reads at the
  // intended CSS px on retina displays.
  const cssW = parseFloat(canvas.style.width) || W;
  const dpr = W / cssW || 1;

  const j = o.seedJitter;
  let x = init[0] + (Math.random() - 0.5) * 2 * j;
  let y = init[1] + (Math.random() - 0.5) * 2 * j;
  let z = init[2] + (Math.random() - 0.5) * 2 * j;
  let [prevX, prevY] = project(x, y);
  let rafId = null;

  ctx.strokeStyle = `rgba(${o.color}, ${o.strokeAlpha})`;
  ctx.lineWidth = o.lineWidthCss * dpr;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function tick() {
    ctx.beginPath();
    for (let i = 0; i < o.stepsPerFrame; i++) {
      [x, y, z] = halvorsenStep(x, y, z);
      const [sx, sy] = project(x, y);
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(sx, sy);
      prevX = sx;
      prevY = sy;
    }
    ctx.stroke();
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return function stop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}
