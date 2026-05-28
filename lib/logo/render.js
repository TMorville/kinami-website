// Canvas rendering for the Kinami mark
// /Users/tomo/kinami/history/2026-05-27-kinami-logo-design.md §3

import { generatePoints } from './attractor.js';
import {
  MASTER_RES, BOOST, BASE_ALPHA, DOT_SIZE, PADDING,
  VARIANTS, RENDER_CONSTANTS,
} from './constants.js';

// Re-export so callers can `import { VARIANTS } from './render.js'` if they prefer.
export { VARIANTS, RENDER_CONSTANTS };

const MASTER_CACHE = {};

/**
 * Build (or fetch from cache) the 1024×1024 canvas master for a variant.
 *
 * The returned canvas is CACHED and SHARED across all callers. Treat it as
 * read-only: never call any drawing method on it. Use {@link renderScaled} to
 * paint it onto a target canvas.
 *
 * @param {'primary'|'inverted'|'mono'} variant
 * @returns {HTMLCanvasElement}
 * @throws if the variant is unknown
 */
export function buildMaster(variant = 'primary') {
  if (MASTER_CACHE[variant]) return MASTER_CACHE[variant];

  const v = VARIANTS[variant];
  if (!v) throw new Error(`Unknown variant: ${variant}`);

  const off = document.createElement('canvas');
  off.width = MASTER_RES;
  off.height = MASTER_RES;
  const ctx = off.getContext('2d');

  ctx.fillStyle = v.bg;
  ctx.fillRect(0, 0, MASTER_RES, MASTER_RES);

  const points = generatePoints();
  const scale = (MASTER_RES / 2) * PADDING;
  const cx = MASTER_RES / 2;
  const cy = MASTER_RES / 2;
  const alpha = BASE_ALPHA * BOOST;

  ctx.fillStyle = `rgba(${v.color}, ${alpha})`;
  for (let i = 0, n = points.length / 2; i < n; i++) {
    ctx.fillRect(cx + points[i * 2] * scale, cy + points[i * 2 + 1] * scale, DOT_SIZE, DOT_SIZE);
  }

  MASTER_CACHE[variant] = off;
  return off;
}

/**
 * Paint the cached master onto a target canvas, downsampled with bilinear smoothing.
 *
 * The master is square (1024×1024). If `targetCanvas` is non-square, the mark
 * will be stretched to fill — pass a square canvas to avoid distortion. For
 * non-square layouts (e.g. OG cards), composite a square mark sub-region yourself.
 *
 * @param {HTMLCanvasElement} targetCanvas
 * @param {'primary'|'inverted'|'mono'} variant
 * @throws if the variant is unknown
 */
export function renderScaled(targetCanvas, variant = 'primary') {
  const v = VARIANTS[variant];
  if (!v) throw new Error(`Unknown variant: ${variant}`);

  const ctx = targetCanvas.getContext('2d');
  const W = targetCanvas.width;
  const H = targetCanvas.height;

  ctx.fillStyle = v.bg;
  ctx.fillRect(0, 0, W, H);

  const src = buildMaster(variant);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, W, H);
}
