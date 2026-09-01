// dronereporter/map/src/cells.js
/**
 * Pure cell math: time windows, cell collapsing, direction statistics,
 * recency ramp inputs. No map library, no DOM, no timers.
 * markerMs parameters are the replay hook; no replay driver ships in v1.
 */

const HOUR_MS = 3_600_000;

export const TIME_RANGES = [
  { key: "24h", label: "24 h", hours: 24 },
  { key: "3d", label: "3 d", hours: 72 },
  { key: "7d", label: "7 d", hours: 168 },
  { key: "all", label: "All", hours: null },
];

/** All, per Tobias 2026-09-01: the fleet is in beta, every observation shows. */
export const DEFAULT_RANGE = "all";

/**
 * Ends at generated_at, never at the client clock, so the window is a
 * statement about the data rather than about the reader's machine.
 */
export function timeWindowOf(range, generatedAtIso, features) {
  const endMs = Date.parse(generatedAtIso);
  const hours = TIME_RANGES.find((r) => r.key === range)?.hours ?? null;
  if (hours !== null) return { startMs: endMs - hours * HOUR_MS, endMs };
  // A loop, not Math.min(...spread): spreading every feature as a function
  // argument overflows the engine's argument limit on large snapshots.
  let oldest = endMs;
  for (const f of features) {
    const t = Date.parse(f.properties.hour);
    if (t < oldest) oldest = t;
  }
  return { startMs: oldest, endMs };
}

/** Features outside the window are excluded, not dimmed. */
export function featuresInWindow(features, window, markerMs = null) {
  const upper = markerMs === null ? window.endMs : Math.min(markerMs, window.endMs);
  return features.filter((f) => {
    const t = Date.parse(f.properties.hour);
    return t >= window.startMs && t <= upper;
  });
}

/**
 * Collapses (cell, hour) aggregates into one entry per cell. Centroids are
 * deterministic per the contract, so the coordinate pair is a safe key.
 * Direction accumulates as components: summed unit vectors add exactly,
 * a mean bearing across buckets does not.
 */
export function collapseCells(reports) {
  const byCell = new Map();
  for (const feature of reports.features) {
    const [lon, lat] = feature.geometry.coordinates;
    const key = `${lon},${lat}`;
    const { hour, count, dir_x, dir_y } = feature.properties;
    let cell = byCell.get(key);
    if (!cell) {
      cell = { lon, lat, count: 0, newestHour: hour, dirX: 0, dirY: 0, dirCount: 0 };
      byCell.set(key, cell);
    }
    cell.count += count;
    if (Date.parse(hour) > Date.parse(cell.newestHour)) cell.newestHour = hour;
    if (dir_x !== undefined && dir_y !== undefined) {
      cell.dirX += dir_x;
      cell.dirY += dir_y;
      cell.dirCount += count;
    }
  }
  return [...byCell.values()];
}

/**
 * The bar between a wedge and a halo, applied to Rayleigh's statistic.
 * A TUNING CONSTANT, NOT A CONFIDENCE LEVEL (alpha would be 0.32).
 */
export const C_WEDGE = 1.14;

/**
 * Bounds on the drawn half-angle. acos(R) is a chosen bounded mapping, not
 * the circular standard deviation (which diverges as R approaches 0).
 */
export const MIN_HALF_ANGLE_DEG = 8;
export const MAX_HALF_ANGLE_DEG = 44;

/** Below two directional reports there is no direction to speak of. */
export const MIN_DIRECTIONAL_REPORTS = 2;

const R2D = 180 / Math.PI;

export function directionOf(cell) {
  const { dirX, dirY, dirCount: n } = cell;
  if (n < MIN_DIRECTIONAL_REPORTS) return { mark: "none" };
  // Rayleigh's statistic n * R^2 reduces to (dx^2 + dy^2) / n: no square
  // root, no division by R, so a cancelled resultant is safe.
  if ((dirX * dirX + dirY * dirY) / n < C_WEDGE) return { mark: "halo" };
  // Clamped: floating point can put R a hair above 1, and acos of that is
  // NaN, which would silently delete the mark.
  const r = Math.min(1, Math.hypot(dirX, dirY) / n);
  const halfAngle = Math.min(MAX_HALF_ANGLE_DEG, Math.max(MIN_HALF_ANGLE_DEG, Math.acos(r) * R2D));
  // atan2(x, y), not atan2(y, x): x east, y north gives a compass bearing.
  const bearing = (Math.atan2(dirX, dirY) * R2D + 360) % 360;
  return { mark: "wedge", bearing, halfAngle };
}

/** Recency and size stops. Tuned visually once real data lands. */
export const FULL_AMBER_HOURS = 24;
export const BASE_TONE_HOURS = 168;
export const RADIUS_MIN_PX = 4;
export const RADIUS_MAX_PX = 14;
export const COUNT_AT_MIN_RADIUS = 1;
export const COUNT_AT_MAX_RADIUS = 50;

/** Ramp shape as a fraction of the window, so the stops cannot drift. */
export const FULL_AMBER_FRACTION = FULL_AMBER_HOURS / BASE_TONE_HOURS;

/** Age of an hour bucket relative to a reference time, floored at zero. */
export function ageHours(hourIso, refIso) {
  return Math.max(0, (Date.parse(refIso) - Date.parse(hourIso)) / HOUR_MS);
}

/**
 * The ramp stops rescaled to the active window. A fixed 0 to 168 h ramp is
 * wrong inside a narrow window: every dot in a 24 h window is under 24 h old
 * and would paint the same amber. The cost is that a colour denotes no fixed
 * age, which is why the legend must name the active range.
 * The one hour floor keeps a degenerate window from a zero-width ramp.
 */
export function rampStops(window, markerMs = null) {
  const recentEdge = markerMs === null ? window.endMs : markerMs;
  const spanHours = Math.max(1, (recentEdge - window.startMs) / HOUR_MS);
  return { fullHours: spanHours * FULL_AMBER_FRACTION, baseHours: spanHours };
}

/**
 * Projects cells into the GeoJSON MapLibre consumes, paint inputs
 * precomputed. `bearing` and `half_angle` are always present and `mark`
 * says whether they mean anything; the layer filter keys on `mark`.
 */
export function cellsToGeoJSON(cells, window, markerMs = null) {
  const recentEdgeIso = new Date(markerMs === null ? window.endMs : markerMs).toISOString();
  return {
    type: "FeatureCollection",
    features: cells.map((cell) => {
      const direction = directionOf(cell);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [cell.lon, cell.lat] },
        properties: {
          age_h: ageHours(cell.newestHour, recentEdgeIso),
          count: cell.count,
          mark: direction.mark,
          bearing: direction.mark === "wedge" ? direction.bearing : 0,
          half_angle: direction.mark === "wedge" ? direction.halfAngle : 0,
        },
      };
    }),
  };
}
