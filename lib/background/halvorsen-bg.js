// Animated splash background — live Halvorsen trace.
// The mark in the lockup is the same attractor's 80k-point static cloud, drawn
// once as fillRect dots. This background uses the SAME rendering technique
// (small alpha dots, additive overdraw) but feeds the integrator step-by-step
// so the field fills in over time and stays sensitive to cursor input.

import { halvorsenStep, ATTRACTOR_PARAMS } from '../logo/attractor.js';

const { init } = ATTRACTOR_PARAMS;

const DEFAULTS = Object.freeze({
  // Multiple trajectories converging onto the attractor — fills the lobes
  // sooner and gives the cursor warp something rich to perturb.
  desktopTrajectories: 6,
  mobileTrajectories: 3,
  // Euler steps integrated per animation frame, per trajectory.
  // 80 × 6 × 60 fps ≈ 29k dots/sec — comparable cost to the old 1200-particle
  // flow field, but each dot lands on the attractor, not noise.
  stepsPerFrame: 80,
  burnIn: 1000,
  // Phase-space jitter for per-trajectory seed. Decorrelates the lines while
  // each one still converges onto the canonical attractor.
  seedJitter: 0.4,
  // Dot alpha, dot size, fade — chosen so accumulated strokes are visible for
  // ~30 seconds before decaying, plenty of time for the trefoil shape to form.
  dotAlpha: 0.06,
  dotSize: 1.4,
  fadeAlpha: 0.0025,
  // Attractor's [-1, 1] half-span maps to (short side / 2) × scaleFactor screen
  // px. 0.75 keeps the full cubic-symmetric trefoil inside the shorter viewport
  // dimension with breathing room.
  scaleFactor: 0.75,
  // Cursor interactivity — screen-space lens (post-projection), so the
  // underlying integrator keeps producing the canonical attractor while the
  // painting layer bends near the cursor.
  warpRadius: 220,
  warpStrength: 0.65,
  // Colors
  amber: '220, 180, 100',
  bg: '12, 10, 4',
});

const MOBILE_BREAKPOINT = 768;

/**
 * Start an animated Halvorsen trace background on `canvas`.
 *
 * Sizes the canvas to the viewport, listens for resize, mousemove/leave, and
 * touchmove/end. Returns a stop function that cancels the rAF loop and removes
 * the listeners.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @returns {() => void} stop
 */
export function startHalvorsenBackground(canvas, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const ctx = canvas.getContext('2d');
  const mouse = { x: null, y: null };
  let width = 0, height = 0;
  let trajectories = [];
  let rafId = null;
  let resizeTimer = null;

  const N = window.innerWidth < MOBILE_BREAKPOINT
    ? o.mobileTrajectories
    : o.desktopTrajectories;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function scale() {
    return (Math.min(width, height) / 2) * o.scaleFactor;
  }

  function initTrajectories() {
    trajectories = [];
    for (let i = 0; i < N; i++) {
      let x = init[0] + (Math.random() - 0.5) * o.seedJitter;
      let y = init[1] + (Math.random() - 0.5) * o.seedJitter;
      let z = init[2] + (Math.random() - 0.5) * o.seedJitter;
      for (let j = 0; j < o.burnIn; j++) [x, y, z] = halvorsenStep(x, y, z);
      trajectories.push({ x, y, z });
    }
  }

  function tick() {
    // Slow fade — old dots decay toward bg, never instantly cleared.
    ctx.fillStyle = `rgba(${o.bg}, ${o.fadeAlpha})`;
    ctx.fillRect(0, 0, width, height);

    const s = scale();
    const cx = width / 2;
    const cy = height / 2;
    const hasMouse = mouse.x !== null;
    const mx = mouse.x;
    const my = mouse.y;
    const wr = o.warpRadius;
    const ws = o.warpStrength;
    const ds = o.dotSize;

    ctx.fillStyle = `rgba(${o.amber}, ${o.dotAlpha})`;

    for (const t of trajectories) {
      for (let i = 0; i < o.stepsPerFrame; i++) {
        const next = halvorsenStep(t.x, t.y, t.z);
        t.x = next[0]; t.y = next[1]; t.z = next[2];

        let sx = cx + t.x * s;
        let sy = cy + t.y * s;

        // Screen-space "lens" warp: bend fresh dots around the cursor without
        // touching the phase-space integrator. The attractor shape stays
        // mathematically intact underneath; the painting layer distorts it.
        if (hasMouse) {
          const dx = mx - sx;
          const dy = my - sy;
          const dist = Math.hypot(dx, dy);
          if (dist > 0 && dist < wr) {
            const pull = (1 - dist / wr) * ws;
            sx += dx * pull;
            sy += dy * pull;
          }
        }

        ctx.fillRect(sx, sy, ds, ds);
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  const onMouseMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; };
  const onMouseLeave = () => { mouse.x = null; mouse.y = null; };
  const onTouchMove = (e) => {
    if (e.touches.length > 0) {
      mouse.x = e.touches[0].clientX;
      mouse.y = e.touches[0].clientY;
    }
  };
  const onTouchEnd = () => { mouse.x = null; mouse.y = null; };
  const onResize = () => {
    clearTimeout(resizeTimer);
    // Debounce — resizing the canvas clears the trail, so coalesce rapid
    // resizes (mobile rotation, devtools toggle) into one repaint.
    resizeTimer = setTimeout(resize, 150);
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseleave', onMouseLeave);
  window.addEventListener('touchmove', onTouchMove);
  window.addEventListener('touchend', onTouchEnd);
  window.addEventListener('resize', onResize);

  resize();
  initTrajectories();
  tick();

  return function stop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    clearTimeout(resizeTimer);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseleave', onMouseLeave);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('resize', onResize);
  };
}
