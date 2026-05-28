// Vertical lockup: mark above, wordmark below
// /Users/tomo/kinami/history/2026-05-27-kinami-logo-design.md §4

import { renderScaled } from './render.js';

const MARK_RATIO = 5;     // mark_canvas_size : wordmark_font_size
const GAP_RATIO = 0.25;   // gap : wordmark_font_size

/**
 * Create a vertical lockup DOM element.
 *
 * Caller must ensure 'Cormorant Infant' (weight 300) is loaded — ideally awaited
 * via `document.fonts.ready` before invoking. The component does not load fonts.
 *
 * @param {object} opts
 * @param {number} opts.wordmarkFontSize - positive number, in pixels
 * @param {'primary'|'inverted'|'mono'} [opts.variant='primary']
 * @param {string} [opts.wordmarkColor] - override (defaults derived from variant)
 * @param {number} [opts.dpr=window.devicePixelRatio] - render at higher resolution for crispness
 * @returns {HTMLElement} the lockup container, ready to insert into the DOM
 * @throws if `wordmarkFontSize` is not a positive finite number
 */
export function createLockup({
  wordmarkFontSize,
  variant = 'primary',
  wordmarkColor,
  dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1,
}) {
  if (!Number.isFinite(wordmarkFontSize) || wordmarkFontSize <= 0) {
    throw new Error(`wordmarkFontSize must be a positive finite number, got: ${wordmarkFontSize}`);
  }

  const markPx = wordmarkFontSize * MARK_RATIO;
  const gapPx = wordmarkFontSize * GAP_RATIO;

  const defaultColor = variant === 'inverted' ? '#0c0a04'
    : variant === 'mono' ? 'rgba(255, 255, 255, 0.92)'
    : 'rgba(220, 180, 100, 0.5)';

  const container = document.createElement('div');
  container.className = 'kinami-lockup';
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${gapPx}px;
    line-height: 1;
  `;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(markPx * dpr);
  canvas.height = Math.round(markPx * dpr);
  canvas.style.width = `${markPx}px`;
  canvas.style.height = `${markPx}px`;
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const word = document.createElement('span');
  word.className = 'kinami-lockup-word';
  word.textContent = 'kinami';
  word.style.cssText = `
    font-family: 'Cormorant Infant', serif;
    font-weight: 300;
    font-size: ${wordmarkFontSize}px;
    letter-spacing: 0.05em;
    color: ${wordmarkColor || defaultColor};
    line-height: 1;
  `;
  container.appendChild(word);

  renderScaled(canvas, variant);

  return container;
}
