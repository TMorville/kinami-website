// tests/map/cells.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  C_WEDGE,
  DEFAULT_RANGE,
  MAX_HALF_ANGLE_DEG,
  MIN_HALF_ANGLE_DEG,
  ageHours,
  cellsToGeoJSON,
  collapseCells,
  directionOf,
  featuresInWindow,
  rampStops,
  timeWindowOf,
} from "../../dronereporter/map/src/cells.js";

const HOUR_MS = 3_600_000;
const gen = "2026-09-01T10:00:00Z";

const f = (hour, count, dir = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [12.575, 55.685] },
  properties: { hour, count, ...dir },
});

const reportsOf = (features) => ({
  type: "FeatureCollection",
  schema_version: "1.1.0",
  snapshot_id: "s",
  generated_at: gen,
  cutoff_at: "2026-09-01T09:00:00Z",
  features,
});

test("default range is all (beta fleet: every observation shows)", () => {
  assert.equal(DEFAULT_RANGE, "all");
});

test("window ends at generated_at, never the client clock", () => {
  const w = timeWindowOf("24h", gen, []);
  assert.equal(w.endMs, Date.parse(gen));
  assert.equal(w.endMs - w.startMs, 24 * HOUR_MS);
});

test("'all' starts at the oldest report and collapses safely when empty", () => {
  const old = "2026-08-01T00:00:00Z";
  const w = timeWindowOf("all", gen, [f(old, 1), f("2026-09-01T09:00:00Z", 1)]);
  assert.equal(w.startMs, Date.parse(old));
  const empty = timeWindowOf("all", gen, []);
  assert.equal(empty.startMs, empty.endMs);
});

test("features outside the window are excluded, not dimmed", () => {
  const inside = f("2026-09-01T09:00:00Z", 1);
  const outside = f("2026-08-20T09:00:00Z", 1);
  const w = timeWindowOf("24h", gen, []);
  assert.deepEqual(featuresInWindow([inside, outside], w), [inside]);
});

test("collapseCells sums counts, keeps newest hour, accumulates direction components", () => {
  const cells = collapseCells(
    reportsOf([
      f("2026-09-01T08:00:00Z", 2, { dir_x: 1.8, dir_y: 0.2 }),
      f("2026-09-01T09:00:00Z", 3),
      f("2026-09-01T07:00:00Z", 4, { dir_x: 0.5, dir_y: 3.2 }),
    ]),
  );
  assert.equal(cells.length, 1);
  const cell = cells[0];
  assert.equal(cell.count, 9);
  assert.equal(cell.newestHour, "2026-09-01T09:00:00Z");
  assert.ok(Math.abs(cell.dirX - 2.3) < 1e-9);
  assert.ok(Math.abs(cell.dirY - 3.4) < 1e-9);
  // Only the buckets that carried direction credit dirCount: 2 + 4, not 9.
  assert.equal(cell.dirCount, 6);
});

test("directionOf: none below 2 directional reports, halo below the Rayleigh bar", () => {
  assert.deepEqual(directionOf({ dirX: 1, dirY: 0, dirCount: 1 }), { mark: "none" });
  // Cancelled resultant: n=4, statistic 0 < C_WEDGE.
  assert.deepEqual(directionOf({ dirX: 0, dirY: 0, dirCount: 4 }), { mark: "halo" });
});

test("directionOf: wedge bearing is a compass bearing and half-angle is clamped", () => {
  // Perfect agreement due east: R = 1, acos(1) = 0, floored to MIN.
  const east = directionOf({ dirX: 4, dirY: 0, dirCount: 4 });
  assert.equal(east.mark, "wedge");
  assert.equal(east.bearing, 90);
  assert.equal(east.halfAngle, MIN_HALF_ANGLE_DEG);
  // Statistic just over the bar with weak agreement clamps at MAX.
  const weak = directionOf({ dirX: Math.sqrt(C_WEDGE * 100) + 0.01, dirY: 0, dirCount: 100 });
  assert.equal(weak.mark, "wedge");
  assert.equal(weak.halfAngle, MAX_HALF_ANGLE_DEG);
});

test("rampStops rescale to the window with a one hour floor", () => {
  const w7 = timeWindowOf("7d", gen, []);
  assert.deepEqual(rampStops(w7), { fullHours: 24, baseHours: 168 });
  const tiny = { startMs: Date.parse(gen) - HOUR_MS / 2, endMs: Date.parse(gen) };
  assert.equal(rampStops(tiny).baseHours, 1);
});

test("ageHours is relative to the reference time and floored at zero", () => {
  assert.equal(ageHours("2026-09-01T08:00:00Z", gen), 2);
  assert.equal(ageHours("2026-09-01T11:00:00Z", gen), 0);
});

test("cellsToGeoJSON precomputes paint inputs with mark discrimination", () => {
  const w = timeWindowOf("24h", gen, []);
  const geo = cellsToGeoJSON(
    [
      { lon: 12.575, lat: 55.685, count: 9, newestHour: "2026-09-01T08:00:00Z", dirX: 6, dirY: 0, dirCount: 6 },
      { lon: 10.005, lat: 56.005, count: 1, newestHour: "2026-09-01T09:00:00Z", dirX: 0, dirY: 0, dirCount: 0 },
    ],
    w,
  );
  assert.equal(geo.type, "FeatureCollection");
  assert.equal(geo.features[0].properties.mark, "wedge");
  assert.equal(geo.features[0].properties.bearing, 90);
  assert.equal(geo.features[0].properties.age_h, 2);
  assert.equal(geo.features[1].properties.mark, "none");
  assert.equal(geo.features[1].properties.bearing, 0);
});
