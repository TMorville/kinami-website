// Halvorsen attractor — locked parameters per spec
// /Users/tomo/kinami/history/2026-05-27-kinami-logo-design.md §2

const PARAMS = {
  a: 1.4,
  dt: 0.005,
  burnIn: 1000,
  n: 80000,
  init: [-1.48, -1.51, 2.04],
};

function step(x, y, z) {
  const { a, dt } = PARAMS;
  return [
    x + (-a * x - 4 * y - 4 * z - y * y) * dt,
    y + (-a * y - 4 * z - 4 * x - z * z) * dt,
    z + (-a * z - 4 * x - 4 * y - x * x) * dt,
  ];
}

let cached = null;

export function generatePoints() {
  if (cached) return cached;

  let [x, y, z] = PARAMS.init;
  for (let i = 0; i < PARAMS.burnIn; i++) [x, y, z] = step(x, y, z);

  const raw = new Float32Array(PARAMS.n * 2);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < PARAMS.n; i++) {
    [x, y, z] = step(x, y, z);
    raw[i * 2] = x; raw[i * 2 + 1] = y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }

  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const halfSpan = Math.max((maxX - minX) / 2, (maxY - minY) / 2);
  const out = new Float32Array(PARAMS.n * 2);
  for (let i = 0; i < PARAMS.n; i++) {
    out[i * 2]     = (raw[i * 2]     - cx) / halfSpan;
    out[i * 2 + 1] = (raw[i * 2 + 1] - cy) / halfSpan;
  }

  cached = out;
  return out;
}

export const ATTRACTOR_PARAMS = Object.freeze({ ...PARAMS });
