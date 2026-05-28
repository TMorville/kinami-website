// One-off Node script to generate all static raster deliverables.
// Run with: node lib/logo/export.js
// /Users/tomo/kinami/history/2026-05-27-kinami-logo-design.md §8

import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import { generatePoints } from './attractor.js';
import {
  MASTER_RES, BOOST, BASE_ALPHA, DOT_SIZE, PADDING, VARIANTS,
} from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '..', 'assets', 'logo');

const GAP_RATIO = 0.25;   // matches lockup.js (only used for the OG layout below)

function buildMaster(variant) {
  const v = VARIANTS[variant];
  if (!v) throw new Error(`Unknown variant: ${variant}`);
  const c = createCanvas(MASTER_RES, MASTER_RES);
  const ctx = c.getContext('2d');
  ctx.fillStyle = v.bg;
  ctx.fillRect(0, 0, MASTER_RES, MASTER_RES);

  const points = generatePoints();
  const scale = (MASTER_RES / 2) * PADDING;
  const cx = MASTER_RES / 2, cy = MASTER_RES / 2;
  const alpha = BASE_ALPHA * BOOST;

  ctx.fillStyle = `rgba(${v.color}, ${alpha})`;
  for (let i = 0, n = points.length / 2; i < n; i++) {
    ctx.fillRect(cx + points[i*2] * scale, cy + points[i*2+1] * scale, DOT_SIZE, DOT_SIZE);
  }
  return c;
}

function renderScaled(master, W, H, bg) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.quality = 'best';            // node-canvas equivalent of imageSmoothingQuality
  ctx.patternQuality = 'best';
  ctx.drawImage(master, 0, 0, W, H);
  return c;
}

function save(canvas, name) {
  const path = join(OUT_DIR, name);
  writeFileSync(path, canvas.toBuffer('image/png'));
  console.log('  wrote', name);
}

async function main() {
  console.log('Building masters...');
  const masters = {
    primary:  buildMaster('primary'),
    inverted: buildMaster('inverted'),
    mono:     buildMaster('mono'),
  };

  save(masters.primary, 'mark-master.png');

  const sizes = [16, 32, 64, 128, 256, 512];
  for (const s of sizes) {
    save(renderScaled(masters.primary, s, s, '#0c0a04'), `mark-${s}.png`);
  }

  save(renderScaled(masters.primary, 180, 180, '#0c0a04'), 'apple-touch-icon.png');

  console.log('Building OG card...');
  const og = createCanvas(1200, 630);
  const ogCtx = og.getContext('2d');
  ogCtx.fillStyle = '#0c0a04';
  ogCtx.fillRect(0, 0, 1200, 630);
  const markPx = 280;
  const wordPx = 56;
  const gapPx = wordPx * GAP_RATIO;
  const totalH = markPx + gapPx + wordPx;
  const startY = (630 - totalH) / 2;
  ogCtx.quality = 'best';
  ogCtx.drawImage(masters.primary, (1200 - markPx) / 2, startY, markPx, markPx);
  ogCtx.fillStyle = 'rgba(220, 180, 100, 0.5)';
  ogCtx.font = '300 56px "Cormorant Infant"';
  ogCtx.textAlign = 'center';
  ogCtx.textBaseline = 'top';
  ogCtx.fillText('kinami', 600, startY + markPx + gapPx);
  save(og, 'og.png');

  console.log('Building favicon.ico...');
  const fav48 = renderScaled(masters.primary, 48, 48, '#0c0a04');
  const fav32 = renderScaled(masters.primary, 32, 32, '#0c0a04');
  const fav16 = renderScaled(masters.primary, 16, 16, '#0c0a04');
  const icoBuffer = await pngToIco([
    fav16.toBuffer('image/png'),
    fav32.toBuffer('image/png'),
    fav48.toBuffer('image/png'),
  ]);
  writeFileSync(join(OUT_DIR, 'favicon.ico'), icoBuffer);
  console.log('  wrote favicon.ico');

  console.log('\nDone. Assets in', OUT_DIR);
}

main().catch(e => { console.error(e); process.exit(1); });
