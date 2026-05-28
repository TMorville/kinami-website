// Locked render constants shared by browser renderer (render.js) and Node exporter (export.js).
// /Users/tomo/kinami/history/2026-05-27-kinami-logo-design.md §3
//
// These values are CANONICAL — changing any of them breaks the visual identity.

export const MASTER_RES = 1024;
export const BOOST = 2.4;
export const BASE_ALPHA = 0.07;     // before boost
export const DOT_SIZE = 2.5;        // at master resolution
export const PADDING = 0.85;        // fraction of half-canvas radius

export const VARIANTS = Object.freeze({
  primary:  { bg: '#0c0a04',                       color: '220, 180, 100' },
  inverted: { bg: 'rgba(220, 180, 100, 0.92)',     color: '12, 10, 4' },
  mono:     { bg: '#0c0a04',                       color: '255, 255, 255' },
});

export const RENDER_CONSTANTS = Object.freeze({
  MASTER_RES, BOOST, BASE_ALPHA, DOT_SIZE, PADDING,
});
