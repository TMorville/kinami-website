# Drone Activity Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A no-build interactive map page at `dronereporter/map/` showing curated incidents plus live crowdsourced observations from the R2 snapshot contract.

**Architecture:** Vanilla ES modules served statically. Pure data modules (contract parser, cell math, snapshot state machine) are DOM-free and unit-tested with `node --test`. A thin `app.js` wires them to a vendored MapLibre GL. One idempotent `syncMap` function owns all map mutation so a basemap restyle can never lose data.

**Tech Stack:** MapLibre GL 6.x (vendored UMD), native ES modules, node:test. No React, no Vite in the deploy path.

**Spec:** `history/2026-09-01-live-map-design.md` (read it first; tasks argue from it).

## Global Constraints

- No build step. Nothing under `dronereporter/` may require compilation.
- Every internal path relative (the subtree serves at `/` on dronereporter.io and `/dronereporter/` on kinami.io). Absolute URLs only in canonical/og/twitter meta and cross-domain links.
- All assets inside the subtree; no CDN loads; no `_redirects` or `_headers`.
- Single-hue amber `rgba(220, 180, 100, α)` on `#0A0907`; tokens copied from `dronereporter/index.html` `:root`; fonts `Cormorant Infant` (serif) + `DM Mono` (mono) via the same Google Fonts link the sibling pages use.
- No em dashes in user-facing copy.
- Branch: `feat/dronereporter-live-map`. Commits imperative, subject under 72 chars, no `Co-Authored-By` trailers.
- Test command for every task: `node --test tests/map/`.
- Root `package.json` has `"type": "module"`; write plain `.js` ES modules.

---

### Task 1: Contract parser (`contract.js`)

**Files:**
- Create: `dronereporter/map/src/contract.js`
- Test: `tests/map/contract.test.js`

**Interfaces:**
- Produces: `SUPPORTED_MAJOR` (number), `UnsupportedSchemaError`, `MalformedPayloadError`, `parseManifest(raw)`, `parseStats(raw)`, `parseReports(raw)`. Parsed reports features have `properties: { hour, count, dir_x?, dir_y? }`.

This is the union of two upstream parser versions: the #113-hardened parser plus #94's 1.1.0 direction fields (see spec §4).

- [ ] **Step 1: Write the failing tests**

```js
// tests/map/contract.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MalformedPayloadError,
  UnsupportedSchemaError,
  parseManifest,
  parseReports,
  parseStats,
} from "../../dronereporter/map/src/contract.js";

const manifest = () => ({
  schema_version: "1.1.0",
  snapshot_id: "2026-09-01T10Z-abc123",
  generated_at: "2026-09-01T10:02:11Z",
  cutoff_at: "2026-09-01T09:02:00Z",
  min_delay_minutes: 60,
  reports_url: "snapshots/2026-09-01T10Z-abc123/reports.json",
  stats_url: "snapshots/2026-09-01T10Z-abc123/stats.json",
});

const stats = () => ({
  schema_version: "1.1.0",
  snapshot_id: "2026-09-01T10Z-abc123",
  generated_at: "2026-09-01T10:02:11Z",
  cutoff_at: "2026-09-01T09:02:00Z",
  total_reports: 412,
  reports_24h: 9,
  reports_7d: 61,
  active_cells_7d: 23,
});

const feature = (props = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [12.575, 55.685] },
  properties: { hour: "2026-09-01T08:00:00Z", count: 3, ...props },
});

const reports = (features = [feature()]) => ({
  type: "FeatureCollection",
  schema_version: "1.1.0",
  snapshot_id: "2026-09-01T10Z-abc123",
  generated_at: "2026-09-01T10:02:11Z",
  cutoff_at: "2026-09-01T09:02:00Z",
  features,
});

test("valid artifacts parse and round-trip their fields", () => {
  assert.equal(parseManifest(manifest()).snapshot_id, "2026-09-01T10Z-abc123");
  assert.equal(parseStats(stats()).reports_7d, 61);
  assert.equal(parseReports(reports()).features[0].properties.count, 3);
});

test("schema_version must be a full semver triple with major 1", () => {
  assert.throws(() => parseManifest({ ...manifest(), schema_version: "1garbage" }), MalformedPayloadError);
  assert.throws(() => parseManifest({ ...manifest(), schema_version: "1.0" }), MalformedPayloadError);
  assert.throws(() => parseManifest({ ...manifest(), schema_version: "2.0.0" }), UnsupportedSchemaError);
  assert.equal(parseManifest({ ...manifest(), schema_version: "1.9.3" }).schema_version, "1.9.3");
});

test("unparseable timestamps are rejected everywhere they appear", () => {
  assert.throws(() => parseManifest({ ...manifest(), generated_at: "not a date" }), MalformedPayloadError);
  assert.throws(() => parseStats({ ...stats(), cutoff_at: "yesterday" }), MalformedPayloadError);
  assert.throws(() => parseReports(reports([feature({ hour: "??" })])), MalformedPayloadError);
});

test("counts must be non-negative integers", () => {
  assert.throws(() => parseStats({ ...stats(), total_reports: 4.5 }), MalformedPayloadError);
  assert.throws(() => parseStats({ ...stats(), reports_24h: -1 }), MalformedPayloadError);
  assert.throws(() => parseReports(reports([feature({ count: 2.5 })])), MalformedPayloadError);
});

test("min_delay_minutes must be a finite number", () => {
  assert.throws(() => parseManifest({ ...manifest(), min_delay_minutes: "60" }), MalformedPayloadError);
  assert.throws(() => parseManifest({ ...manifest(), min_delay_minutes: Infinity }), MalformedPayloadError);
});

test("max_age_minutes is optional, validated when present, clamped to 1 h to 7 d", () => {
  assert.equal(parseManifest(manifest()).max_age_minutes, undefined);
  assert.equal(parseManifest({ ...manifest(), max_age_minutes: 2880 }).max_age_minutes, 2880);
  assert.equal(parseManifest({ ...manifest(), max_age_minutes: 5 }).max_age_minutes, 60);
  assert.equal(parseManifest({ ...manifest(), max_age_minutes: 999999 }).max_age_minutes, 10080);
  assert.throws(() => parseManifest({ ...manifest(), max_age_minutes: "2880" }), MalformedPayloadError);
});

test("geometry discriminators and coordinate ranges are enforced", () => {
  const polygon = feature();
  polygon.geometry = { type: "Polygon", coordinates: [12.5, 55.6] };
  assert.throws(() => parseReports(reports([polygon])), MalformedPayloadError);
  const far = feature();
  far.geometry = { type: "Point", coordinates: [181, 55.6] };
  assert.throws(() => parseReports(reports([far])), MalformedPayloadError);
  const short = feature();
  short.geometry = { type: "Point", coordinates: [12.5] };
  assert.throws(() => parseReports(reports([short])), MalformedPayloadError);
});

test("direction: both fields or neither, finite, resultant bounded by count", () => {
  const ok = parseReports(reports([feature({ count: 3, dir_x: 1.2, dir_y: -0.4 })]));
  assert.equal(ok.features[0].properties.dir_x, 1.2);

  const none = parseReports(reports([feature({ count: 1 })]));
  assert.equal(none.features[0].properties.dir_x, undefined);

  assert.throws(() => parseReports(reports([feature({ dir_x: 1 })])), MalformedPayloadError);
  assert.throws(() => parseReports(reports([feature({ dir_x: 1, dir_y: NaN })])), MalformedPayloadError);
  // 3 unit vectors can never sum longer than 3 (plus 1% rounding slack).
  assert.throws(
    () => parseReports(reports([feature({ count: 3, dir_x: 3.1, dir_y: 0.5 })])),
    MalformedPayloadError,
  );
  // Exactly at the slack limit passes.
  parseReports(reports([feature({ count: 3, dir_x: 3.03, dir_y: 0 })]));
});

test("snapshot files must carry matching type discriminators", () => {
  assert.throws(() => parseReports({ ...reports(), type: "Feature" }), MalformedPayloadError);
  assert.throws(() => parseReports({ ...reports(), features: "nope" }), MalformedPayloadError);
  assert.throws(() => parseReports(null), MalformedPayloadError);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/map/contract.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```js
// dronereporter/map/src/contract.js
/** The public data contract this page consumes. See ../CONTRACT.md. */

export const SUPPORTED_MAJOR = 1;

export class UnsupportedSchemaError extends Error {
  constructor(version) {
    super(`Unsupported schema_version "${version}"; this client supports major ${SUPPORTED_MAJOR}`);
    this.name = "UnsupportedSchemaError";
  }
}

export class MalformedPayloadError extends Error {
  constructor(detail) {
    super(`Malformed payload: ${detail}`);
    this.name = "MalformedPayloadError";
  }
}

function asObject(raw, what) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new MalformedPayloadError(`${what} is not an object`);
  }
  return raw;
}

function str(obj, key) {
  const value = obj[key];
  if (typeof value !== "string") throw new MalformedPayloadError(`"${key}" is not a string`);
  return value;
}

function num(obj, key) {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MalformedPayloadError(`"${key}" is not a finite number`);
  }
  return value;
}

/** A count is a number of reports: a non-negative integer, never a fraction. */
function countNum(obj, key) {
  const value = num(obj, key);
  if (!Number.isInteger(value) || value < 0) {
    throw new MalformedPayloadError(`"${key}" is not a non-negative integer`);
  }
  return value;
}

/**
 * Timestamps feed the 24-hour safety cliff and the recency styling, both via
 * Date.parse. An unparseable string yields NaN there, and every NaN
 * comparison is false, so a malformed timestamp would silently disable the
 * too-old gate. Reject it here instead.
 */
function isoDate(obj, key) {
  const value = str(obj, key);
  if (!Number.isFinite(Date.parse(value))) {
    throw new MalformedPayloadError(`"${key}" is not a parseable timestamp: "${value}"`);
  }
  return value;
}

/**
 * The version must be a full semver triple; "1garbage" parses to major 1
 * under parseInt and must not pass as supported.
 */
function checkSchema(obj) {
  const version = str(obj, "schema_version");
  const match = /^(\d+)\.\d+\.\d+$/.exec(version);
  if (!match) throw new MalformedPayloadError(`unparseable schema_version "${version}"`);
  if (Number(match[1]) !== SUPPORTED_MAJOR) throw new UnsupportedSchemaError(version);
  return version;
}

/** Asserts a discriminator rather than assuming it, so a Polygon is never relabelled a Point. */
function literal(obj, key, expected, what) {
  if (obj[key] !== expected) {
    throw new MalformedPayloadError(`${what} has ${key} "${String(obj[key])}", expected "${expected}"`);
  }
}

/**
 * Bounds on the producer's freshness promise. The clamp keeps the honesty
 * guarantee bounded: a producer bug cannot make year-old data render as
 * current, and cannot make a healthy page flap by promising minutes.
 */
const MIN_MAX_AGE_MINUTES = 60;
const MAX_MAX_AGE_MINUTES = 10_080; // 7 days

export function parseManifest(raw) {
  const obj = asObject(raw, "manifest");
  const parsed = {
    schema_version: checkSchema(obj),
    snapshot_id: str(obj, "snapshot_id"),
    generated_at: isoDate(obj, "generated_at"),
    cutoff_at: isoDate(obj, "cutoff_at"),
    min_delay_minutes: num(obj, "min_delay_minutes"),
    reports_url: str(obj, "reports_url"),
    stats_url: str(obj, "stats_url"),
  };
  // Additive 1.x field: the producer's freshness promise, driving the
  // too-old cliff. The bake publishes 2880 while its cadence is daily.
  if (obj.max_age_minutes !== undefined) {
    parsed.max_age_minutes = Math.min(
      MAX_MAX_AGE_MINUTES,
      Math.max(MIN_MAX_AGE_MINUTES, num(obj, "max_age_minutes")),
    );
  }
  return parsed;
}

export function parseStats(raw) {
  const obj = asObject(raw, "stats");
  return {
    schema_version: checkSchema(obj),
    snapshot_id: str(obj, "snapshot_id"),
    generated_at: isoDate(obj, "generated_at"),
    cutoff_at: isoDate(obj, "cutoff_at"),
    total_reports: countNum(obj, "total_reports"),
    reports_24h: countNum(obj, "reports_24h"),
    reports_7d: countNum(obj, "reports_7d"),
    active_cells_7d: countNum(obj, "active_cells_7d"),
  };
}

/**
 * Direction is optional, added in schema 1.1.0. A feature without it is
 * normal: the bake omits both fields when count == 1. A feature with only one
 * of the two is malformed, because no bake can produce that.
 */
function parseDirection(props, count, index) {
  const hasX = props.dir_x !== undefined;
  const hasY = props.dir_y !== undefined;
  if (!hasX && !hasY) return {};
  if (hasX !== hasY) {
    throw new MalformedPayloadError(
      `feature[${index}].properties has ${hasX ? "dir_x" : "dir_y"} without its pair`,
    );
  }
  const dir_x = num(props, "dir_x");
  const dir_y = num(props, "dir_y");
  // dir_x and dir_y sum `count` unit vectors, so the resultant can never be
  // longer than count. Longer would drive the mean resultant length R above 1
  // and acos(R) would be NaN. The 1% slack absorbs producer rounding only.
  const limit = count * 1.01;
  if (dir_x * dir_x + dir_y * dir_y > limit * limit) {
    throw new MalformedPayloadError(
      `feature[${index}].properties direction resultant exceeds count ${count}`,
    );
  }
  return { dir_x, dir_y };
}

function parseFeature(raw, index) {
  const obj = asObject(raw, `feature[${index}]`);
  literal(obj, "type", "Feature", `feature[${index}]`);

  const geometry = asObject(obj.geometry, `feature[${index}].geometry`);
  literal(geometry, "type", "Point", `feature[${index}].geometry`);

  const coords = geometry.coordinates;
  if (
    !Array.isArray(coords) ||
    coords.length !== 2 ||
    typeof coords[0] !== "number" ||
    typeof coords[1] !== "number" ||
    Math.abs(coords[0]) > 180 ||
    Math.abs(coords[1]) > 90
  ) {
    throw new MalformedPayloadError(`feature[${index}].geometry.coordinates is not a WGS84 [lon, lat]`);
  }
  const props = asObject(obj.properties, `feature[${index}].properties`);
  const hour = isoDate(props, "hour");
  const count = countNum(props, "count");
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [coords[0], coords[1]] },
    properties: { hour, count, ...parseDirection(props, count, index) },
  };
}

export function parseReports(raw) {
  const obj = asObject(raw, "reports");
  // Schema gate first, before any shape check: a future major may not have
  // "features" at all, and the visitor must be told the page needs updating.
  const schemaVersion = checkSchema(obj);
  literal(obj, "type", "FeatureCollection", "reports");
  const features = obj.features;
  if (!Array.isArray(features)) throw new MalformedPayloadError(`"features" is not an array`);
  return {
    type: "FeatureCollection",
    schema_version: schemaVersion,
    snapshot_id: str(obj, "snapshot_id"),
    generated_at: isoDate(obj, "generated_at"),
    cutoff_at: isoDate(obj, "cutoff_at"),
    features: features.map(parseFeature),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/map/contract.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add dronereporter/map/src/contract.js tests/map/contract.test.js
git commit -m "map: add strict snapshot contract parser"
```

---

### Task 2: Cell math (`cells.js`)

**Files:**
- Create: `dronereporter/map/src/cells.js`
- Test: `tests/map/cells.test.js`

**Interfaces:**
- Consumes: parsed `Reports` from Task 1 (shape only, no import needed).
- Produces: `TIME_RANGES`, `DEFAULT_RANGE` ("7d"), `timeWindowOf(range, generatedAtIso, features)` → `{startMs, endMs}`, `featuresInWindow(features, window, markerMs = null)`, `collapseCells(reports)` → `Cell[]` (`{lon, lat, count, newestHour, dirX, dirY, dirCount}`), `directionOf(cell)` → `{mark: "none"|"halo"} | {mark: "wedge", bearing, halfAngle}`, `ageHours(hourIso, refIso)`, `rampStops(window, markerMs = null)` → `{fullHours, baseHours}`, `cellsToGeoJSON(cells, window, markerMs = null)` (features with `properties: {age_h, count, mark, bearing, half_angle}`), constants `C_WEDGE`, `MIN_HALF_ANGLE_DEG` (8), `MAX_HALF_ANGLE_DEG` (44), `MIN_DIRECTIONAL_REPORTS` (2), `RADIUS_MIN_PX` (4), `RADIUS_MAX_PX` (14), `COUNT_AT_MIN_RADIUS` (1), `COUNT_AT_MAX_RADIUS` (50), `FULL_AMBER_FRACTION` (24/168).

The `markerMs` parameters stay (default null) so replay can return without reshaping the modules; no replay driver ships in v1.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/map/cells.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```js
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
  const oldest =
    features.length === 0 ? endMs : Math.min(...features.map((f) => Date.parse(f.properties.hour)));
  return { startMs: Math.min(oldest, endMs), endMs };
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/map/cells.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dronereporter/map/src/cells.js tests/map/cells.test.js
git commit -m "map: add pure cell math (windows, collapse, direction, ramp)"
```

---

### Task 3: Formatting helpers (`format.js`)

**Files:**
- Create: `dronereporter/map/src/format.js`
- Test: `tests/map/format.test.js`

**Interfaces:**
- Produces: `relativeTime(iso, nowMs)` → "just now" / "N min ago" / "N hours ago" / "N days ago"; `formatDelay(minutes)` → "1 hour" / "2 hours" / "45 minutes"; `escapeHtml(text)`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/map/format.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, formatDelay, relativeTime } from "../../dronereporter/map/src/format.js";

const now = Date.parse("2026-09-01T12:00:00Z");

test("relativeTime phrases", () => {
  assert.equal(relativeTime("2026-09-01T11:59:40Z", now), "just now");
  assert.equal(relativeTime("2026-09-01T11:15:00Z", now), "45 min ago");
  assert.equal(relativeTime("2026-09-01T11:00:00Z", now), "1 hour ago");
  assert.equal(relativeTime("2026-09-01T04:00:00Z", now), "8 hours ago");
  assert.equal(relativeTime("2026-08-30T12:00:00Z", now), "2 days ago");
  // A future timestamp never reads as negative.
  assert.equal(relativeTime("2026-09-01T13:00:00Z", now), "just now");
});

test("formatDelay reproduces the pinned disclosure copy at the contract default", () => {
  assert.equal(formatDelay(60), "1 hour");
  assert.equal(formatDelay(120), "2 hours");
  assert.equal(formatDelay(45), "45 minutes");
  assert.equal(formatDelay(1), "1 minute");
});

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml(`<a b="c">&'`), "&lt;a b=&quot;c&quot;&gt;&amp;&#39;");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/map/format.test.js` — FAIL, module not found.

- [ ] **Step 3: Implementation**

```js
// dronereporter/map/src/format.js
/** Human phrasing. No em dashes, per repo copy convention. */

export function relativeTime(iso, nowMs) {
  const deltaMs = Math.max(0, nowMs - Date.parse(iso));
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * Derived rather than hardcoded: min_delay_minutes exists in the contract so
 * the disclosure copy tracks the bake. A hardcoded "1 hour" becomes a false
 * public honesty claim the day D changes.
 */
export function formatDelay(minutes) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/map/format.test.js` — PASS.

- [ ] **Step 5: Commit**

```bash
git add dronereporter/map/src/format.js tests/map/format.test.js
git commit -m "map: add time and delay formatting helpers"
```

---

### Task 4: Snapshot fetch and state machine (`snapshot.js`)

**Files:**
- Create: `dronereporter/map/src/snapshot.js`
- Test: `tests/map/snapshot.test.js`

**Interfaces:**
- Consumes: `parseManifest`, `parseReports`, `parseStats`, `MalformedPayloadError`, `UnsupportedSchemaError` from `./contract.js`.
- Produces: `FETCH_TIMEOUT_MS` (30000), `REFETCH_INTERVAL_MS` (300000), `RETRY_BACKOFF_MS` ([2000, 5000, 15000]), `MAX_SNAPSHOT_AGE_MS` (86400000), `fetchSnapshot(manifestUrl, {signal, fetchImpl, timeoutMs})` → `{manifest, reports, stats}`, `createSnapshotStore(options)` → `{start, load, onVisible, destroy, getState}`. States: `{status:"loading"}`, `{status:"ok"|"stale", snapshot}`, `{status:"unavailable", reason:"never-loaded"|"too-old"|"unsupported-schema"}`.

The store is the explicit-owner version of the React hook (spec §5): every trigger bumps the epoch and aborts its predecessor; one timer of each kind; retries re-enter the ladder from any trigger while nothing ever loaded; `onVisible` re-checks the cliff synchronously; `destroy` clears everything.

- [ ] **Step 1: Write the failing tests**

```js
// tests/map/snapshot.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SNAPSHOT_AGE_MS,
  createSnapshotStore,
  fetchSnapshot,
} from "../../dronereporter/map/src/snapshot.js";

const ID = "2026-09-01T10Z-abc123";
const GEN = "2026-09-01T10:02:11Z";

const artifacts = (overrides = {}) => ({
  "https://data.example/manifest.json": {
    schema_version: "1.1.0",
    snapshot_id: ID,
    generated_at: GEN,
    cutoff_at: "2026-09-01T09:02:00Z",
    min_delay_minutes: 60,
    reports_url: `snapshots/${ID}/reports.json`,
    stats_url: `snapshots/${ID}/stats.json`,
    ...overrides.manifest,
  },
  [`https://data.example/snapshots/${ID}/reports.json`]: {
    type: "FeatureCollection",
    schema_version: "1.1.0",
    snapshot_id: ID,
    generated_at: GEN,
    cutoff_at: "2026-09-01T09:02:00Z",
    features: [],
    ...overrides.reports,
  },
  [`https://data.example/snapshots/${ID}/stats.json`]: {
    schema_version: "1.1.0",
    snapshot_id: ID,
    generated_at: GEN,
    cutoff_at: "2026-09-01T09:02:00Z",
    total_reports: 0,
    reports_24h: 0,
    reports_7d: 0,
    active_cells_7d: 0,
    ...overrides.stats,
  },
});

const fetchFrom = (map) => async (url) => {
  if (!(url in map)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => map[url] };
};

test("fetchSnapshot resolves relative snapshot URLs against the manifest URL", async () => {
  const snapshot = await fetchSnapshot("https://data.example/manifest.json", {
    fetchImpl: fetchFrom(artifacts()),
  });
  assert.equal(snapshot.manifest.snapshot_id, ID);
  assert.equal(snapshot.stats.total_reports, 0);
});

test("fetchSnapshot rejects a snapshot_id disagreement", async () => {
  const bad = artifacts({ stats: { snapshot_id: "other" } });
  await assert.rejects(
    fetchSnapshot("https://data.example/manifest.json", { fetchImpl: fetchFrom(bad) }),
    /snapshot_id/,
  );
});

test("fetchSnapshot rejects a partial fetch (missing stats file)", async () => {
  const partial = artifacts();
  delete partial[`https://data.example/snapshots/${ID}/stats.json`];
  await assert.rejects(
    fetchSnapshot("https://data.example/manifest.json", { fetchImpl: fetchFrom(partial) }),
    /HTTP 404/,
  );
});

test("fetchSnapshot surfaces a hung fetch as TimeoutError, not AbortError", async () => {
  const hang = (url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  await assert.rejects(
    fetchSnapshot("https://data.example/manifest.json", { fetchImpl: hang, timeoutMs: 20 }),
    (error) => error.name === "TimeoutError",
  );
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness({ fetcher, nowIso = "2026-09-01T10:10:00Z", retry = [5, 10, 15], maxAgeMs = MAX_SNAPSHOT_AGE_MS }) {
  const states = [];
  let nowMs = Date.parse(nowIso);
  const store = createSnapshotStore({
    manifestUrl: "https://data.example/manifest.json",
    onState: (s) => states.push(s),
    fetcher,
    now: () => nowMs,
    refetchMs: 60_000,
    retryBackoffMs: retry,
    maxAgeMs,
  });
  return { store, states, setNow: (iso) => (nowMs = Date.parse(iso)) };
}

const goodSnapshot = (manifestOver = {}) => ({
  manifest: { generated_at: GEN, snapshot_id: ID, min_delay_minutes: 60, ...manifestOver },
  reports: { features: [], generated_at: GEN },
  stats: { total_reports: 0, reports_24h: 0, reports_7d: 0, active_cells_7d: 0 },
});

test("store: the cliff honors the snapshot's own max_age_minutes", async (t) => {
  // 30 h old: past the 24 h default, inside a 48 h producer promise.
  const { store, states, setNow } = harness({
    fetcher: async () => goodSnapshot({ max_age_minutes: 2880 }),
  });
  t.after(() => store.destroy());
  setNow(new Date(Date.parse(GEN) + 30 * 3_600_000).toISOString());
  store.start();
  await flush();
  assert.equal(states.at(-1).status, "ok");
});

test("store: success goes ok; failed refetch keeps last good as stale", async (t) => {
  let fail = false;
  const { store, states } = harness({
    fetcher: async () => {
      if (fail) throw new Error("network down");
      return goodSnapshot();
    },
  });
  t.after(() => store.destroy());
  store.start();
  await flush();
  assert.equal(states.at(-1).status, "ok");
  fail = true;
  await store.load("poll");
  assert.equal(states.at(-1).status, "stale");
  assert.equal(states.at(-1).snapshot.manifest.snapshot_id, ID);
});

test("store: a snapshot past the cliff refuses to render, even on the stale path", async (t) => {
  let fail = false;
  const { store, states, setNow } = harness({
    fetcher: async () => {
      if (fail) throw new Error("down");
      return goodSnapshot();
    },
  });
  t.after(() => store.destroy());
  store.start();
  await flush();
  fail = true;
  setNow("2026-09-02T11:00:00Z"); // > 24 h after GEN
  await store.load("poll");
  assert.deepEqual(states.at(-1), { status: "unavailable", reason: "too-old" });
});

test("store: never-loaded failures re-enter the retry ladder from any trigger", async (t) => {
  let calls = 0;
  const { store, states } = harness({
    fetcher: async () => {
      calls += 1;
      throw new Error("down");
    },
    retry: [5, 5, 5],
  });
  t.after(() => store.destroy());
  store.start();
  await flush();
  assert.equal(states.at(-1).reason, "never-loaded");
  const before = calls;
  // A visibility-triggered failure must schedule its own retry.
  store.onVisible();
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(calls > before + 1, `retry ladder dead after visibility failure (calls ${calls})`);
});

test("store: the expiry timer stamps too-old with no fetch settling", async (t) => {
  // Generated 10 ms before the cliff: the timer must fire on its own.
  const { store, states, setNow } = harness({
    fetcher: async () => goodSnapshot(),
    maxAgeMs: 30,
    nowIso: new Date(Date.parse(GEN) + 20).toISOString(),
  });
  t.after(() => store.destroy());
  store.start();
  await flush();
  assert.equal(states.at(-1).status, "ok");
  setNow(new Date(Date.parse(GEN) + 100).toISOString());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(states.at(-1), { status: "unavailable", reason: "too-old" });
});

test("store: a slow older response never overwrites newer state", async (t) => {
  let resolveFirst;
  let call = 0;
  const { store, states } = harness({
    fetcher: () => {
      call += 1;
      if (call === 1) return new Promise((resolve) => (resolveFirst = resolve));
      return Promise.resolve(goodSnapshot());
    },
  });
  t.after(() => store.destroy());
  store.start();
  await flush();
  await store.load("poll"); // second call wins
  assert.equal(states.at(-1).status, "ok");
  const settled = states.length;
  resolveFirst(goodSnapshot()); // stale epoch resolves late
  await flush();
  assert.equal(states.length, settled, "stale epoch mutated state");
});

test("store: destroy clears everything and ignores in-flight results", async (t) => {
  let resolveIt;
  const { store, states } = harness({
    fetcher: () => new Promise((resolve) => (resolveIt = resolve)),
  });
  store.start();
  store.destroy();
  resolveIt(goodSnapshot());
  await flush();
  assert.equal(states.filter((s) => s.status === "ok").length, 0);
  t.after(() => {});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/map/snapshot.test.js` — FAIL, module not found.

- [ ] **Step 3: Implementation**

```js
// dronereporter/map/src/snapshot.js
import {
  UnsupportedSchemaError,
  MalformedPayloadError,
  parseManifest,
  parseReports,
  parseStats,
} from "./contract.js";

/**
 * Upper bound on one whole snapshot fetch. Without it a hung connection never
 * settles and the page could sit on "ok" with a frozen "updated X ago"
 * indefinitely. Aborts with TimeoutError, deliberately NOT AbortError:
 * callers swallow AbortError as supersession, a timeout must surface.
 */
export const FETCH_TIMEOUT_MS = 30_000;

/** Matched to the manifest's 300 s TTL, so a poll is an edge-cache hit. */
export const REFETCH_INTERVAL_MS = 300_000;

/** First-load retry ladder before settling into the steady cadence. */
export const RETRY_BACKOFF_MS = [2_000, 5_000, 15_000];

/** Past this, the surface refuses to render rather than look fresh. */
export const MAX_SNAPSHOT_AGE_MS = 86_400_000; // 24 h

async function getJson(url, signal, fetchImpl) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Fetches one complete snapshot, or throws. Contract rules enforced here and
 * nowhere else: all-or-nothing; follow (never construct) snapshot URLs,
 * resolved against the manifest URL; one publish, not a mixture, so all
 * three artifacts must carry the manifest's snapshot_id.
 */
export async function fetchSnapshot(
  manifestUrl,
  { signal, fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {},
) {
  const ac = new AbortController();
  const onCallerAbort = () => ac.abort(signal?.reason ?? new DOMException("Aborted", "AbortError"));
  if (signal?.aborted) onCallerAbort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(
    () => ac.abort(new DOMException(`Snapshot fetch exceeded ${timeoutMs} ms`, "TimeoutError")),
    timeoutMs,
  );

  try {
    const manifest = parseManifest(await getJson(manifestUrl, ac.signal, fetchImpl));

    const base = new URL(manifestUrl, globalThis.location?.href);
    const reportsUrl = new URL(manifest.reports_url, base).toString();
    const statsUrl = new URL(manifest.stats_url, base).toString();

    const [reportsRaw, statsRaw] = await Promise.all([
      getJson(reportsUrl, ac.signal, fetchImpl),
      getJson(statsUrl, ac.signal, fetchImpl),
    ]);

    const reports = parseReports(reportsRaw);
    const stats = parseStats(statsRaw);

    for (const [name, id] of [
      ["reports", reports.snapshot_id],
      ["stats", stats.snapshot_id],
    ]) {
      if (id !== manifest.snapshot_id) {
        throw new MalformedPayloadError(
          `${name} snapshot_id "${id}" does not match manifest "${manifest.snapshot_id}"`,
        );
      }
    }

    return { manifest, reports, stats };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
    // Promise.all rejects on the first failure but does not cancel the
    // sibling request. Abort the private controller so no request outlives
    // this call; after success the abort is a no-op.
    ac.abort(new DOMException("Snapshot fetch settled", "AbortError"));
  }
}

/**
 * Owns the four states the page's live layer can be in. The invariant:
 * never render blank, never render something that looks fresher than it is.
 *
 * Explicit-owner contract (no React lifecycle to lean on):
 *  - every trigger bumps the epoch and aborts its predecessor; only the
 *    current epoch may mutate state or schedule a retry
 *  - at most one retry timeout, one poll interval, one expiry timer, one
 *    AbortController at any time; any success cancels a scheduled retry
 *  - never-loaded failures re-enter the retry ladder from ANY trigger
 *  - the expiry timer holds the 24 h cliff when no fetch settles, and
 *    re-verifies against current state before stamping too-old
 *  - destroy() aborts, clears every timer, bumps the epoch
 */
export function createSnapshotStore({
  manifestUrl,
  onState,
  fetcher = fetchSnapshot,
  now = () => Date.now(),
  refetchMs = REFETCH_INTERVAL_MS,
  retryBackoffMs = RETRY_BACKOFF_MS,
  maxAgeMs = MAX_SNAPSHOT_AGE_MS,
}) {
  let state = { status: "loading" };
  let lastGood = null;
  let epoch = 0;
  let failures = 0;
  let controller = null;
  let retryTimer = null;
  let pollTimer = null;
  let expiryTimer = null;
  let destroyed = false;

  // The cliff is the snapshot's OWN freshness promise when it carries one
  // (manifest max_age_minutes, already clamped by the parser); the maxAgeMs
  // option is the default for manifests without the field.
  const allowanceMs = (snapshot) =>
    snapshot.manifest.max_age_minutes !== undefined
      ? snapshot.manifest.max_age_minutes * 60_000
      : maxAgeMs;
  const isTooOld = (snapshot) =>
    now() - Date.parse(snapshot.manifest.generated_at) > allowanceMs(snapshot);

  function scheduleExpiry() {
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    if (state.status !== "ok" && state.status !== "stale") return;
    const expiresInMs =
      Date.parse(state.snapshot.manifest.generated_at) + allowanceMs(state.snapshot) - now();
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      // Re-verify against whatever state is current: a callback queued for a
      // previous snapshot must not stamp too-old over data that is not.
      if ((state.status === "ok" || state.status === "stale") && isTooOld(state.snapshot)) {
        setState({ status: "unavailable", reason: "too-old" });
      }
    }, Math.max(0, expiresInMs));
  }

  function setState(next) {
    state = next;
    scheduleExpiry();
    onState(state);
  }

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry() {
    const delay = retryBackoffMs[failures - 1];
    if (lastGood === null && delay !== undefined && retryTimer === null && !destroyed) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void load("retry");
      }, delay);
    }
  }

  async function load(trigger) {
    if (destroyed) return;
    const mine = ++epoch;
    controller?.abort();
    const ac = new AbortController();
    controller = ac;
    clearRetry(); // this attempt owns retrying now

    try {
      const snapshot = await fetcher(manifestUrl, { signal: ac.signal });
      if (mine !== epoch || destroyed) return;
      if (isTooOld(snapshot)) {
        setState({ status: "unavailable", reason: "too-old" });
        return;
      }
      failures = 0;
      lastGood = snapshot;
      setState({ status: "ok", snapshot });
    } catch (error) {
      if (mine !== epoch || destroyed) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof UnsupportedSchemaError) {
        setState({ status: "unavailable", reason: "unsupported-schema" });
        return;
      }
      // A failed refetch must not discard a good snapshot, but the cliff
      // applies to it all the same.
      if (lastGood) {
        setState(
          isTooOld(lastGood)
            ? { status: "unavailable", reason: "too-old" }
            : { status: "stale", snapshot: lastGood },
        );
        return;
      }
      failures += 1;
      setState({ status: "unavailable", reason: "never-loaded" });
      scheduleRetry();
    }
  }

  function start() {
    void load("initial");
    pollTimer = setInterval(() => void load("poll"), refetchMs);
  }

  function onVisible() {
    // Re-check the cliff synchronously before a retained snapshot shows again.
    if ((state.status === "ok" || state.status === "stale") && isTooOld(state.snapshot)) {
      setState({ status: "unavailable", reason: "too-old" });
    }
    void load("visibility");
  }

  function destroy() {
    destroyed = true;
    epoch += 1;
    controller?.abort();
    clearRetry();
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  return { start, load, onVisible, destroy, getState: () => state };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/map/snapshot.test.js` — PASS. Timing-based tests use injected short delays; if one flakes, widen its margins rather than sleeping longer than 50 ms.

- [ ] **Step 5: Commit**

```bash
git add dronereporter/map/src/snapshot.js tests/map/snapshot.test.js
git commit -m "map: add snapshot fetcher and live-layer state machine"
```

---

### Task 5: Map style and SDF icons (`layers.js`)

**Files:**
- Create: `dronereporter/map/src/layers.js`
- Test: `tests/map/layers.test.js`

**Interfaces:**
- Consumes: `RADIUS_MIN_PX`, `RADIUS_MAX_PX`, `COUNT_AT_MIN_RADIUS`, `COUNT_AT_MAX_RADIUS`, `MIN_HALF_ANGLE_DEG`, `MAX_HALF_ANGLE_DEG` from `./cells.js`.
- Produces: `BASEMAP_STYLE_URL`, `EUROPE_BOUNDS`, `CELL_SOURCE_ID` ("cells"), `CELL_LAYER_ID` ("cell-dots"), `MARK_LAYER_ID` ("cell-marks"), `CLUSTER_LAYER_ID` ("cell-clusters"), `CLUSTER_COUNT_LAYER_ID` ("cell-cluster-counts"), `CLUSTER_MAX_ZOOM` (8), `CLUSTER_RADIUS_PX` (40), `CELL_SOURCE_OPTIONS` (the clustered GeoJSON source options minus `data`), `INCIDENT_SOURCE_ID` ("incidents"), `INCIDENT_LAYER_ID` ("incident-rings"), `HIDDEN_BASEMAP_LAYERS`, `MARK_MIN_ZOOM` (7), `readPalette(root)` → `{amber, amberDim, background}`, `recencyColour(palette, stops)`, `clusterRecencyColour(palette, stops)`, `cellCirclePaint(palette, stops)`, `markLayer(palette, stops)`, `clusterLayer(palette, stops)`, `clusterCountLayer(palette)`, `curatedRingLayer(palette)`, `fallbackStyle(palette)`, `markIcons()` → `[{id, image:{width,height,data}}]`, `wedgeIconId(deg)`, `bucketFor(deg)`, `HALF_ANGLE_BUCKETS`, `HALO_ICON_ID`, `wedgeIcon(deg)`, `haloIcon()`.

Port `style.ts` and `markIcons.ts` (the reference source is in the design spec's review trail; the geometry comments are load-bearing, keep them). Palette fallbacks change to the site's tokens: amber `#E8A33D`, amberDim `#4a3a22`, background `#0A0907`, read from CSS custom properties `--map-amber`, `--map-amber-dim`, `--map-bg` (defined in Task 8's index.html).

Key excerpts that differ from the upstream source (the rest ports verbatim minus TypeScript types):

```js
// dronereporter/map/src/layers.js (excerpts; full file ports style.ts +
// markIcons.ts with these deltas)

export const INCIDENT_SOURCE_ID = "incidents";
export const INCIDENT_LAYER_ID = "incident-rings";

export function readPalette(root = document.documentElement) {
  const styles = getComputedStyle(root);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    amber: read("--map-amber", "#E8A33D"),
    amberDim: read("--map-amber-dim", "#4a3a22"),
    background: read("--map-bg", "#0A0907"),
  };
}

/**
 * Clustering: sparse beta data must read as a few clear markers at the
 * Europe frame, not scattered single pixels. Cluster properties aggregate
 * honestly: sum_count sums REPORT counts (never a count of cells) and
 * min_age_h takes the newest member's age so the cluster earns the same
 * recency ramp its freshest report would.
 */
export const CLUSTER_MAX_ZOOM = 8;
export const CLUSTER_RADIUS_PX = 40;
export const CLUSTER_LAYER_ID = "cell-clusters";
export const CLUSTER_COUNT_LAYER_ID = "cell-cluster-counts";

export const CELL_SOURCE_OPTIONS = {
  type: "geojson",
  cluster: true,
  clusterMaxZoom: CLUSTER_MAX_ZOOM,
  clusterRadius: CLUSTER_RADIUS_PX,
  clusterProperties: {
    sum_count: ["+", ["get", "count"]],
    min_age_h: ["min", ["get", "age_h"]],
  },
};

/** The dots' ramp keyed on the cluster's freshest member. */
export function clusterRecencyColour(palette, stops) {
  const baseHours = Math.max(stops.baseHours, stops.fullHours + 1);
  return [
    "interpolate",
    ["linear"],
    ["get", "min_age_h"],
    0,
    palette.amber,
    stops.fullHours,
    palette.amber,
    baseHours,
    palette.amberDim,
  ];
}

export function clusterLayer(palette, stops) {
  return {
    id: CLUSTER_LAYER_ID,
    type: "circle",
    source: CELL_SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "sum_count"], 2, 10, 50, 16, 500, 24],
      "circle-color": clusterRecencyColour(palette, stops),
      "circle-opacity": 0.85,
      "circle-blur": 0.2,
    },
  };
}

export function clusterCountLayer(palette) {
  return {
    id: CLUSTER_COUNT_LAYER_ID,
    type: "symbol",
    source: CELL_SOURCE_ID,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["to-string", ["get", "sum_count"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-allow-overlap": true,
    },
    paint: { "text-color": palette.background },
  };
}

/**
 * The curated incidents: a hollow ring, so a years-old documented incident
 * can never be misread as a live crowd report (a filled, recency-ramped dot).
 */
export function curatedRingLayer(palette) {
  return {
    id: INCIDENT_LAYER_ID,
    type: "circle",
    source: INCIDENT_SOURCE_ID,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 5, 8, 9],
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-color": palette.amber,
      "circle-stroke-width": 1.5,
      "circle-stroke-opacity": 0.85,
    },
  };
}
```

- [ ] **Step 1: Write the failing tests**

```js
// tests/map/layers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HALF_ANGLE_BUCKETS,
  HALO_ICON_ID,
  bucketFor,
  cellCirclePaint,
  curatedRingLayer,
  fallbackStyle,
  haloIcon,
  markIconExpression,
  markIcons,
  markLayer,
  recencyColour,
  wedgeIcon,
  wedgeIconId,
} from "../../dronereporter/map/src/layers.js";
import { MAX_HALF_ANGLE_DEG, MIN_HALF_ANGLE_DEG } from "../../dronereporter/map/src/cells.js";

const palette = { amber: "#E8A33D", amberDim: "#4a3a22", background: "#0A0907" };

test("bucket grid covers the clamp range and never widens a wedge", () => {
  assert.equal(HALF_ANGLE_BUCKETS[0], MIN_HALF_ANGLE_DEG);
  assert.equal(HALF_ANGLE_BUCKETS.at(-1), MAX_HALF_ANGLE_DEG);
  assert.equal(bucketFor(13.9), 8);
  assert.equal(bucketFor(14), 14);
  assert.equal(bucketFor(MAX_HALF_ANGLE_DEG), MAX_HALF_ANGLE_DEG);
});

test("ramp stops stay strictly increasing in the paint expression", () => {
  const colour = recencyColour(palette, { fullHours: 1, baseHours: 1 });
  const stops = colour.slice(3); // [input, colour, input, colour, input, colour]
  assert.ok(stops[2] < stops[4], "interpolate inputs must strictly increase");
});

test("icons are RGBA buffers with white colour channels (SDF)", () => {
  for (const { image } of markIcons()) {
    assert.equal(image.data.length, image.width * image.height * 4);
    assert.equal(image.data[0], 255);
  }
  // The halo's centre pixel is deep inside the disc: alpha near max.
  const halo = haloIcon();
  const centre = (halo.width / 2 * halo.width + halo.width / 2) * 4 + 3;
  assert.ok(halo.data[centre] > 240);
});

test("a narrow wedge covers fewer pixels than a wide one", () => {
  const inked = (image) => {
    let n = 0;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] >= 192) n += 1;
    return n;
  };
  assert.ok(inked(wedgeIcon(8)) < inked(wedgeIcon(44)));
});

test("mark layer filters out 'none' and never culls overlapping icons", () => {
  const layer = markLayer(palette, { fullHours: 24, baseHours: 168 });
  assert.deepEqual(layer.filter, ["!=", ["get", "mark"], "none"]);
  assert.equal(layer.layout["icon-allow-overlap"], true);
  assert.equal(layer.layout["icon-ignore-placement"], true);
  assert.equal(layer.layout["icon-rotation-alignment"], "map");
});

test("mark icon expression names the halo and every wedge bucket", () => {
  const expr = JSON.stringify(markIconExpression());
  assert.ok(expr.includes(HALO_ICON_ID));
  for (const angle of HALF_ANGLE_BUCKETS) assert.ok(expr.includes(wedgeIconId(angle)));
});

test("curated ring is hollow and the fallback style is a bare background", () => {
  const ring = curatedRingLayer(palette);
  assert.equal(ring.paint["circle-color"], "rgba(0, 0, 0, 0)");
  assert.equal(ring.paint["circle-stroke-color"], palette.amber);
  const style = fallbackStyle(palette);
  assert.equal(style.layers.length, 1);
  assert.equal(style.layers[0].type, "background");
});

test("dot radius ramps count 1 to 50 into 4 to 14 px", () => {
  const paint = cellCirclePaint(palette, { fullHours: 24, baseHours: 168 });
  assert.deepEqual(paint["circle-radius"].slice(3), [1, 4, 50, 14]);
});
```

- [ ] **Step 2: Run to verify failure** — `node --test tests/map/layers.test.js`, FAIL.

- [ ] **Step 3: Write the implementation.** Port `style.ts` (constants `BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark"`, `EUROPE_BOUNDS = [[-12, 34], [33, 63]]`, the 25-entry `HIDDEN_BASEMAP_LAYERS` list verbatim, `recencyColour`, `cellCirclePaint` (opacity 0.85, blur 0.2), `WEDGE_OPACITY` 0.22, `HALO_OPACITY` 0.16, `markIconExpression`, `MARK_MIN_ZOOM` 7, `markIconSize`, `markLayer`, `fallbackStyle`) and `markIcons.ts` (constants `WEDGE_LENGTH_PX` 24, `HALO_RADIUS_PX` 19, `HALO_GAP_PX` 5, `PAD_PX` 4, `SDF_SPREAD_PX` 8, `SDF_EDGE_BYTE` 192, `HALF_ANGLE_STEP_DEG` 6, `HALF_ANGLE_BUCKETS`, `wedgeIconId`, `bucketFor`, `encode`, `rasterize` with pixel-centre sampling and flipped y, `wedgeIcon` sector SDF, `haloIcon` disc SDF, `markIcons`). Strip the TypeScript types, keep the geometry comments, import the angle/radius constants from `./cells.js`, and add the `readPalette`, cluster, and `curatedRingLayer` deltas shown above.

  Clustering adjustments to the ported pieces:
  - `markLayer`'s filter becomes `["all", ["!", ["has", "point_count"]], ["!=", ["get", "mark"], "none"]]` so a cluster never draws a mark.
  - `fallbackStyle` gains `glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"` so cluster count labels can render over the bare background (if that host is down too, labels drop and the map lives).
  - This module stays pure: no `document` access except inside `readPalette`, which takes the root as a parameter for tests.

  Additional test cases to append to `tests/map/layers.test.js`:

```js
test("clusters aggregate report counts and freshest age, and never draw marks", () => {
  assert.deepEqual(CELL_SOURCE_OPTIONS.clusterProperties.sum_count, ["+", ["get", "count"]]);
  assert.deepEqual(CELL_SOURCE_OPTIONS.clusterProperties.min_age_h, ["min", ["get", "age_h"]]);
  const cluster = clusterLayer(palette, { fullHours: 24, baseHours: 168 });
  assert.deepEqual(cluster.filter, ["has", "point_count"]);
  const marks = markLayer(palette, { fullHours: 24, baseHours: 168 });
  assert.deepEqual(marks.filter[1], ["!", ["has", "point_count"]]);
  const counts = clusterCountLayer(palette);
  assert.deepEqual(counts.filter, ["has", "point_count"]);
  assert.ok(fallbackStyle(palette).glyphs);
});
```
  (import `CELL_SOURCE_OPTIONS`, `clusterLayer`, `clusterCountLayer` in the test header.)

- [ ] **Step 4: Run to verify pass** — `node --test tests/map/layers.test.js`, PASS.

- [ ] **Step 5: Commit**

```bash
git add dronereporter/map/src/layers.js tests/map/layers.test.js
git commit -m "map: add MapLibre style builders and SDF mark icons"
```

---

### Task 6: Idempotent map sync (`maprender.js`)

**Files:**
- Create: `dronereporter/map/src/maprender.js`
- Test: `tests/map/maprender.test.js`

**Interfaces:**
- Consumes: everything layer-related from `./layers.js`.
- Produces: `syncMap(map, renderState)` where `renderState = { palette, stops, cells, incidents }` (`cells`/`incidents` are GeoJSON FeatureCollections). Idempotent: brings any map (fresh style, restyled fallback, already-synced) to the render state.

This function is the spec's restyle-rehydration fix: because it always pushes CURRENT data and is the only writer, a `setStyle` that wiped sources cannot leave the map empty.

- [ ] **Step 1: Write the failing test (fake map)**

```js
// tests/map/maprender.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncMap } from "../../dronereporter/map/src/maprender.js";
import {
  CELL_LAYER_ID,
  CELL_SOURCE_ID,
  CLUSTER_COUNT_LAYER_ID,
  CLUSTER_LAYER_ID,
  INCIDENT_LAYER_ID,
  INCIDENT_SOURCE_ID,
  MARK_LAYER_ID,
} from "../../dronereporter/map/src/layers.js";

/** Records what a real maplibre Map would hold. */
function fakeMap() {
  const map = {
    images: new Map(),
    sources: new Map(),
    layers: [],
    paint: {},
    layout: {},
    hasImage: (id) => map.images.has(id),
    addImage: (id, image, opts) => map.images.set(id, { image, opts }),
    getSource: (id) => map.sources.get(id),
    addSource: (id, spec) => map.sources.set(id, { ...spec, setData: (d) => (map.sources.get(id).data = d) }),
    getLayer: (id) => map.layers.find((l) => l.id === id),
    addLayer: (layer) => map.layers.push(layer),
    setPaintProperty: (id, key, value) => (map.paint[`${id}/${key}`] = value),
    setLayoutProperty: (id, key, value) => (map.layout[`${id}/${key}`] = value),
    // Simulates setStyle: MapLibre drops all custom sources and layers but
    // keeps images.
    wipeStyle: () => {
      map.sources.clear();
      map.layers.length = 0;
    },
  };
  return map;
}

const geo = (n) => ({
  type: "FeatureCollection",
  features: Array.from({ length: n }, (_unused, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [i, i] },
    properties: { age_h: 1, count: 1, mark: "none", bearing: 0, half_angle: 0 },
  })),
});

const rs = (cells, incidents) => ({
  palette: { amber: "#E8A33D", amberDim: "#4a3a22", background: "#0A0907" },
  stops: { fullHours: 24, baseHours: 168 },
  cells,
  incidents,
});

test("first sync creates icons, both sources with data, and layers in order", () => {
  const map = fakeMap();
  syncMap(map, rs(geo(2), geo(3)));
  assert.ok(map.images.size > 0);
  assert.equal(map.sources.get(CELL_SOURCE_ID).data.features.length, 2);
  assert.equal(map.sources.get(INCIDENT_SOURCE_ID).data.features.length, 3);
  // Rings, clusters, cluster counts, marks, dots.
  assert.deepEqual(
    map.layers.map((l) => l.id),
    [INCIDENT_LAYER_ID, CLUSTER_LAYER_ID, CLUSTER_COUNT_LAYER_ID, MARK_LAYER_ID, CELL_LAYER_ID],
  );
  // The cells source carries the cluster options.
  assert.equal(map.sources.get(CELL_SOURCE_ID).cluster, true);
});

test("a restyle that wiped sources gets CURRENT data back, not empty seeds", () => {
  const map = fakeMap();
  syncMap(map, rs(geo(1), geo(1)));
  const grown = rs(geo(5), geo(4));
  syncMap(map, grown); // data grew while the old style was up
  map.wipeStyle(); // basemap fallback: setStyle dropped everything
  syncMap(map, grown); // styledata fires -> sync again
  assert.equal(map.sources.get(CELL_SOURCE_ID).data.features.length, 5);
  assert.equal(map.sources.get(INCIDENT_SOURCE_ID).data.features.length, 4);
  assert.equal(map.layers.length, 5);
});

test("repeat syncs update data and paint without duplicating layers", () => {
  const map = fakeMap();
  syncMap(map, rs(geo(1), geo(1)));
  syncMap(map, rs(geo(2), geo(1)));
  assert.equal(map.layers.length, 5);
  assert.equal(map.sources.get(CELL_SOURCE_ID).data.features.length, 2);
  assert.ok(map.paint[`${CELL_LAYER_ID}/circle-color`]);
  assert.ok(map.paint[`${MARK_LAYER_ID}/icon-color`]);
});
```

- [ ] **Step 2: Run to verify failure** — FAIL, module not found.

- [ ] **Step 3: Implementation**

```js
// dronereporter/map/src/maprender.js
import {
  CELL_LAYER_ID,
  CELL_SOURCE_ID,
  CELL_SOURCE_OPTIONS,
  CLUSTER_COUNT_LAYER_ID,
  CLUSTER_LAYER_ID,
  HIDDEN_BASEMAP_LAYERS,
  INCIDENT_LAYER_ID,
  INCIDENT_SOURCE_ID,
  MARK_LAYER_ID,
  cellCirclePaint,
  clusterCountLayer,
  clusterLayer,
  clusterRecencyColour,
  curatedRingLayer,
  markIcons,
  markLayer,
  recencyColour,
} from "./layers.js";

function ensureSource(map, id, options, data) {
  const source = map.getSource(id);
  if (source) {
    // setData returns a promise in maplibre 6; a floating one is an
    // unhandled rejection.
    const result = source.setData(data);
    if (result && typeof result.catch === "function") {
      result.catch((error) => console.warn(`Failed to update source ${id}.`, error));
    }
    return;
  }
  map.addSource(id, { ...options, data });
}

/**
 * The one writer of map state. Idempotent: called on styledata (initial
 * style AND any fallback restyle), on every data change, and on every paint
 * change, it brings whatever the map currently holds to the render state.
 * Always pushing CURRENT data is what makes a restyle unable to lose it.
 */
export function syncMap(map, renderState) {
  const { palette, stops, cells, incidents } = renderState;

  // Hiding rather than filtering the style document: a future OpenFreeMap
  // revision renaming a layer must be a no-op here, not a throw.
  for (const id of HIDDEN_BASEMAP_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }

  // Icons must exist before the layer that names them, or MapLibre logs a
  // missing-image warning per feature and draws nothing.
  for (const { id, image } of markIcons()) {
    if (!map.hasImage(id)) map.addImage(id, image, { sdf: true });
  }

  ensureSource(map, INCIDENT_SOURCE_ID, { type: "geojson" }, incidents);
  ensureSource(map, CELL_SOURCE_ID, CELL_SOURCE_OPTIONS, cells);

  // Rings, then clusters with their counts, then marks, then dots; marks
  // before dots so a dot draws over its own wedge apex.
  if (!map.getLayer(INCIDENT_LAYER_ID)) map.addLayer(curatedRingLayer(palette));
  if (!map.getLayer(CLUSTER_LAYER_ID)) map.addLayer(clusterLayer(palette, stops));
  if (!map.getLayer(CLUSTER_COUNT_LAYER_ID)) map.addLayer(clusterCountLayer(palette));
  if (!map.getLayer(MARK_LAYER_ID)) map.addLayer(markLayer(palette, stops));
  if (!map.getLayer(CELL_LAYER_ID)) {
    map.addLayer({
      id: CELL_LAYER_ID,
      type: "circle",
      source: CELL_SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      paint: cellCirclePaint(palette, stops),
    });
  }

  // Paint refresh: the ramp is rescaled to the active window, so it changes
  // without the layers changing.
  const colour = recencyColour(palette, stops);
  map.setPaintProperty(CELL_LAYER_ID, "circle-color", colour);
  map.setPaintProperty(MARK_LAYER_ID, "icon-color", colour);
  map.setPaintProperty(CLUSTER_LAYER_ID, "circle-color", clusterRecencyColour(palette, stops));
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add dronereporter/map/src/maprender.js tests/map/maprender.test.js
git commit -m "map: add idempotent map sync surviving basemap restyles"
```

---

### Task 7: Curated incidents module (`curated.js`)

**Files:**
- Create: `dronereporter/map/src/curated.js`
- Test: `tests/map/curated.test.js`

**Interfaces:**
- Consumes: `escapeHtml` from `./format.js`. Data shape of `dronereporter/assets/threat-data.json`: `{updated, stats, incidents: [{id, label, country, site, lat, lng, date, category, description, source}]}`.
- Produces: `parseIncidents(raw)` → `{incidents, dropped}` (invalid entries dropped, never thrown: the curated file is first-party but a bad row must not take the layer down); `incidentsToGeoJSON(incidents)`; `popupHtml(incident)` → escaped HTML string; `oldestYear(incidents)` → number for the legend copy.

- [ ] **Step 1: Write the failing tests**

```js
// tests/map/curated.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  incidentsToGeoJSON,
  oldestYear,
  parseIncidents,
  popupHtml,
} from "../../dronereporter/map/src/curated.js";

const incident = (over = {}) => ({
  id: "x-1",
  label: "Test Airport",
  country: "Testland",
  site: "Runway",
  lat: 55.6,
  lng: 12.5,
  date: "2025-09-24",
  category: "airport-closure",
  description: "A thing happened.",
  source: "https://example.org/a",
  ...over,
});

test("valid incidents pass through; broken rows are dropped, not thrown", () => {
  const { incidents, dropped } = parseIncidents({
    incidents: [incident(), incident({ lat: "north" }), incident({ label: "" }), incident({ lng: 200 })],
  });
  assert.equal(incidents.length, 1);
  assert.equal(dropped, 3);
});

test("the real threat-data.json parses with zero drops", async () => {
  const raw = JSON.parse(await readFile("dronereporter/assets/threat-data.json", "utf8"));
  const { incidents, dropped } = parseIncidents(raw);
  assert.equal(dropped, 0);
  assert.ok(incidents.length >= 40);
});

test("GeoJSON projection carries the popup fields", () => {
  const geo = incidentsToGeoJSON([incident()]);
  assert.deepEqual(geo.features[0].geometry.coordinates, [12.5, 55.6]);
  assert.equal(geo.features[0].properties.label, "Test Airport");
  assert.equal(geo.features[0].properties.date, "2025-09-24");
});

test("popup HTML is escaped and links the source", () => {
  const html = popupHtml(incident({ label: `<b>Sneak</b>`, description: `a & b` }));
  assert.ok(html.includes("&lt;b&gt;Sneak&lt;/b&gt;"));
  assert.ok(html.includes("a &amp; b"));
  assert.ok(html.includes('href="https://example.org/a"'));
  assert.ok(html.includes('rel="noopener"'));
});

test("popup omits the source link when the URL is not http(s)", () => {
  const html = popupHtml(incident({ source: "javascript:alert(1)" }));
  assert.ok(!html.includes("javascript:"));
});

test("oldestYear reads the earliest incident date", () => {
  assert.equal(oldestYear([incident({ date: "2018-12-19" }), incident()]), 2018);
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implementation**

```js
// dronereporter/map/src/curated.js
import { escapeHtml } from "./format.js";

/**
 * The curated incidents are first-party data, but one malformed row must
 * degrade to a dropped row with a console warning, never to a dead layer.
 */
export function parseIncidents(raw) {
  const rows = Array.isArray(raw?.incidents) ? raw.incidents : [];
  const incidents = [];
  let dropped = 0;
  for (const row of rows) {
    const ok =
      row !== null &&
      typeof row === "object" &&
      typeof row.label === "string" &&
      row.label.length > 0 &&
      typeof row.lat === "number" &&
      Number.isFinite(row.lat) &&
      Math.abs(row.lat) <= 90 &&
      typeof row.lng === "number" &&
      Number.isFinite(row.lng) &&
      Math.abs(row.lng) <= 180 &&
      typeof row.date === "string" &&
      Number.isFinite(Date.parse(row.date));
    if (!ok) {
      dropped += 1;
      continue;
    }
    incidents.push(row);
  }
  if (dropped > 0) console.warn(`threat-data.json: dropped ${dropped} malformed incident rows.`);
  return { incidents, dropped };
}

export function incidentsToGeoJSON(incidents) {
  return {
    type: "FeatureCollection",
    features: incidents.map((incident) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [incident.lng, incident.lat] },
      properties: {
        label: incident.label,
        country: incident.country ?? "",
        site: incident.site ?? "",
        date: incident.date,
        description: incident.description ?? "",
        source: incident.source ?? "",
      },
    })),
  };
}

/** Escaped popup markup; the source link only for http(s) URLs. */
export function popupHtml(props) {
  const date = escapeHtml(props.date);
  const label = escapeHtml(props.label);
  const description = escapeHtml(props.description ?? "");
  let sourceLine = "";
  if (typeof props.source === "string" && /^https?:\/\//.test(props.source)) {
    sourceLine = `<a class="popup-source" href="${escapeHtml(props.source)}" target="_blank" rel="noopener">Source</a>`;
  }
  return [
    `<div class="popup-date">${date}</div>`,
    `<div class="popup-label">${label}</div>`,
    description ? `<p class="popup-desc">${description}</p>` : "",
    sourceLine,
  ].join("");
}

export function oldestYear(incidents) {
  const years = incidents.map((i) => new Date(i.date).getUTCFullYear());
  return years.length === 0 ? new Date().getUTCFullYear() : Math.min(...years);
}
```

- [ ] **Step 4: Run to verify pass** — PASS. Note the second test reads the real `threat-data.json`, pinning the file's shape.

- [ ] **Step 5: Commit**

```bash
git add dronereporter/map/src/curated.js tests/map/curated.test.js
git commit -m "map: add curated incident layer data module"
```

---

### Task 8: Vendor MapLibre, page shell, and app wiring

**Files:**
- Create: `dronereporter/map/vendor/maplibre-gl-<exact-version>.js`, `dronereporter/map/vendor/maplibre-gl-<exact-version>.css`, `dronereporter/map/vendor/MAPLIBRE-LICENSE.txt`
- Create: `dronereporter/map/index.html`
- Create: `dronereporter/map/src/app.js`
- Create: `tests/map/fixtures/manifest.json`, `tests/map/fixtures/snapshots/dev-1/reports.json`, `tests/map/fixtures/snapshots/dev-1/stats.json`

**Interfaces:**
- Consumes: every module from Tasks 1 to 7 plus the vendored `window.maplibregl`.
- Produces: the page.

- [ ] **Step 1: Vendor MapLibre**

```bash
cd /private/tmp/claude-501/-Users-tomo-kinami-website/27405f79-aefd-42be-8226-a08c9145934d/scratchpad
npm pack maplibre-gl@6
tar xzf maplibre-gl-*.tgz
```

Copy `package/dist/maplibre-gl.js` and `package/dist/maplibre-gl.css` into `dronereporter/map/vendor/`, renamed with the exact version from `package/package.json` (e.g. `maplibre-gl-6.4.0.js`). Copy `package/LICENSE.txt` to `vendor/MAPLIBRE-LICENSE.txt`. Record the version; index.html references the exact filenames.

- [ ] **Step 2: Write the dev fixture** (used for manual browser verification; hour values relative to a `generated_at` you set to today so the cliff does not reject it when testing)

`tests/map/fixtures/manifest.json`:
```json
{
  "schema_version": "1.1.0",
  "snapshot_id": "dev-1",
  "generated_at": "SET-TO-NOW",
  "cutoff_at": "SET-TO-NOW-MINUS-1H",
  "min_delay_minutes": 60,
  "reports_url": "snapshots/dev-1/reports.json",
  "stats_url": "snapshots/dev-1/stats.json"
}
```

`snapshots/dev-1/reports.json`: a FeatureCollection (same envelope fields, `snapshot_id` "dev-1") with 8 to 12 features spread over Denmark/Germany/Poland covering: a count-1 dot with no direction, a multi-bucket cell whose summed direction earns a wedge (e.g. three buckets in one cell, `dir_x`/`dir_y` aligned), a disagreeing cell that earns a halo (components cancelling), hours spread across the last 6 days so the recency ramp shows. `stats.json`: matching envelope plus plausible counts. Write actual timestamps when creating the files (compute from the current date); the test suite never reads these fixtures (unit tests build their own), they exist for the browser.

- [ ] **Step 3: Write `dronereporter/map/index.html`**

Structure (full file; inline CSS follows the product page's token block and the design-system rules — hairline borders, glass panels, mono labels, serif prose):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Activity Map – Drone Reporter</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Infant:ital,wght@0,300;0,400;1,300&family=DM+Mono:wght@300;400&display=swap" rel="stylesheet">
  <link rel="icon" type="image/x-icon" href="../assets/logo/favicon.ico">
  <link rel="apple-touch-icon" sizes="180x180" href="../assets/logo/apple-touch-icon.png">
  <link rel="canonical" href="https://dronereporter.io/map/">
  <meta property="og:title" content="Drone Activity Map">
  <meta property="og:description" content="Documented drone incidents across Europe, and live crowd reports from the Drone Reporter network.">
  <meta property="og:image" content="https://dronereporter.io/assets/logo/og.png">
  <meta property="og:url" content="https://dronereporter.io/map/">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="https://dronereporter.io/assets/logo/og.png">
  <meta name="theme-color" content="#0A0907">
  <link rel="stylesheet" href="vendor/maplibre-gl-VERSION.css">
  <style>
    /* Tokens: copied from ../index.html :root, plus the three the map reads. */
    * { margin:0; padding:0; box-sizing:border-box; }
    :root {
      --void:#0A0907; --panel:#12100B;
      --text:#EDE7DA; --text-dim:#9A9180; --text-faint:rgba(237,231,218,0.40);
      --line:rgba(220,180,100,0.10); --line-strong:rgba(220,180,100,0.24);
      --signal:#E8A33D;
      --serif:'Cormorant Infant', serif; --mono:'DM Mono', monospace;
      --map-amber:#E8A33D; --map-amber-dim:#4a3a22; --map-bg:#0A0907;
    }
    body { background:var(--void); color:var(--text); font-family:var(--serif); min-height:100svh; }
    /* Header: wordmark back-link + page label. */
    /* Layout: desktop grid, map ~2/3 left filling the viewport height minus
       header, aside 1/3 right scrollable; below 900px stacked with the map
       at 62svh. */
    /* Components: .live-notice overlay (absolute inside .map-stage, glass
       surface, mono), .range-control as styled native radios, .legend groups
       with mono uppercase group titles, .legend-ramp as a CSS gradient from
       var(--map-amber) to var(--map-amber-dim), .stats-strip, .store-badges
       (styles copied from ../index.html), .disclosure (mono, faint),
       .maplibregl-popup overrides to the glass surface, .incident-list for
       the no-WebGL fallback. Border radius 0 except popups 0. No box-shadow.
    */
  </style>
</head>
<body>
  <header class="top">
    <a class="back" href="../">Drone Reporter</a>
    <h1 class="page-label">Drone activity map</h1>
  </header>
  <main class="layout">
    <section class="map-stage">
      <div id="map" aria-label="Map of documented drone incidents and live crowd reports across Europe"></div>
      <p id="live-notice" class="live-notice" role="status" hidden></p>
      <div id="map-fallback" class="map-fallback" hidden>
        <p class="notice">The interactive map could not start in this browser. The documented incidents are listed below.</p>
        <ol id="incident-list" class="incident-list"></ol>
      </div>
    </section>
    <aside class="side">
      <section class="group" id="live-group" aria-labelledby="live-title">
        <h2 class="group-title" id="live-title">Live crowd reports <span id="live-range-label"></span></h2>
        <div id="stats-strip" class="stats-strip" hidden></div>
        <fieldset class="range-control" id="range-control">
          <legend class="visually-hidden">Time range for live reports</legend>
          <!-- app.js fills: <label><input type="radio" name="range" value="24h">24 h</label> ... -->
        </fieldset>
        <ul class="legend-marks">
          <li><span class="swatch swatch-dot"></span><b>Dot</b> A single report, which carries no direction.</li>
          <li><span class="swatch swatch-wedge"></span><b>Wedge</b> Reports in this cell agree on a direction.</li>
          <li><span class="swatch swatch-halo"></span><b>Halo</b> Reports disagree, so no direction is shown.</li>
        </ul>
        <div class="legend-scale">
          <div class="legend-scale-head"><span>Recency</span><span id="legend-range">over 7 d</span></div>
          <div class="legend-ramp" aria-hidden="true"></div>
          <div class="legend-scale-ends"><span>newest</span><span>oldest in range</span></div>
        </div>
        <p class="legend-note">The dot grows with the number of reports, not with certainty. It shows where reports came from, never where a drone was.</p>
      </section>
      <section class="group" id="curated-group" aria-labelledby="curated-title">
        <h2 class="group-title" id="curated-title">Documented incidents</h2>
        <p class="group-sub"><span class="swatch swatch-ring"></span>Curated record <span id="curated-since">since 2018</span>. Not filtered by the time range. Tap a ring for the story and source.</p>
      </section>
      <section class="group cta-group">
        <h2 class="group-title">Seen a drone? Report it</h2>
        <p class="group-sub">Drone Reporter is a volunteer network in beta. It is growing, and it is not an official or verified source.</p>
        <div class="store-badges"><!-- copied verbatim from ../index.html #beta badges, both entries --></div>
      </section>
      <p class="disclosure" id="disclosure">Unverified crowd reports · positions approximate to ~1 km · delayed at least 1 hour.</p>
      <footer class="foot">
        <a href="../">Drone Reporter</a>
        <a href="../privacy/">Privacy</a>
        <a href="https://kinami.io/">kinami.io</a>
      </footer>
    </aside>
  </main>
  <script src="vendor/maplibre-gl-VERSION.js"></script>
  <script type="module" src="src/app.js"></script>
</body>
</html>
```

Fill in the elided CSS concretely while implementing (grid, glass surfaces `rgba(12,10,4,0.75)` + `backdrop-filter:blur(6px)`, mono 10 to 11 px uppercase labels with letter-spacing, serif body, `.visually-hidden` utility, popup overrides via `.maplibregl-popup-content { background:var(--panel); color:var(--text); border:1px solid var(--line-strong); border-radius:0; font-family:var(--serif); }` and matching tip color). The store badges block is copied verbatim from `../index.html`'s #beta section, including both SVGs and the TestFlight URL.

- [ ] **Step 4: Write `dronereporter/map/src/app.js`**

```js
// dronereporter/map/src/app.js
import { createSnapshotStore } from "./snapshot.js";
import {
  DEFAULT_RANGE,
  TIME_RANGES,
  cellsToGeoJSON,
  collapseCells,
  featuresInWindow,
  rampStops,
  timeWindowOf,
} from "./cells.js";
import {
  BASEMAP_STYLE_URL,
  EUROPE_BOUNDS,
  INCIDENT_LAYER_ID,
  fallbackStyle,
  readPalette,
} from "./layers.js";
import { syncMap } from "./maprender.js";
import { incidentsToGeoJSON, oldestYear, parseIncidents, popupHtml } from "./curated.js";
import { formatDelay, relativeTime } from "./format.js";

/** The only line that changes when the data host moves. */
const MANIFEST_URL = "https://data.dronereporter.io/manifest.json";

const EMPTY = { type: "FeatureCollection", features: [] };

const el = (id) => document.getElementById(id);

// ---- central render state; syncMap is its only consumer -------------------
const renderState = {
  palette: readPalette(),
  stops: rampStops({ startMs: 0, endMs: 3_600_000 }),
  cells: EMPTY,
  incidents: EMPTY,
};

let map = null;
let mapReady = false;
let range = DEFAULT_RANGE;
let snapshotState = { status: "loading" };
let incidents = [];

// ---- live layer derivation -------------------------------------------------
function recompute() {
  const snapshot =
    snapshotState.status === "ok" || snapshotState.status === "stale" ? snapshotState.snapshot : null;
  if (!snapshot) {
    renderState.cells = EMPTY;
  } else {
    const features = snapshot.reports.features;
    const window = timeWindowOf(range, snapshot.manifest.generated_at, features);
    renderState.stops = rampStops(window);
    const visible = featuresInWindow(features, window);
    renderState.cells = cellsToGeoJSON(collapseCells({ ...snapshot.reports, features: visible }), window);
  }
  if (map && mapReady) syncMap(map, renderState);
  renderChrome(snapshot);
}

// ---- chrome ---------------------------------------------------------------
const NOTICE = {
  loading: "Loading live reports.",
  "never-loaded": "Live reports are not available right now. Documented incidents are shown.",
  "too-old": "Live data is out of date and is not being shown. Documented incidents remain.",
  "unsupported-schema": "This page needs updating before it can show live data. Please refresh.",
};

function renderChrome(snapshot) {
  const notice = el("live-notice");
  if (snapshotState.status === "ok") {
    notice.hidden = true;
  } else if (snapshotState.status === "stale") {
    notice.hidden = false;
    notice.textContent = `Showing the last live data we could load, from ${relativeTime(
      snapshot.manifest.generated_at,
      Date.now(),
    )}.`;
  } else {
    notice.hidden = false;
    notice.textContent = NOTICE[snapshotState.reason ?? "loading"] ?? NOTICE.loading;
  }

  const strip = el("stats-strip");
  if (snapshot) {
    const s = snapshot.stats;
    strip.hidden = false;
    strip.innerHTML = "";
    for (const [value, label] of [
      [s.reports_24h.toLocaleString("en"), "Last 24 hours"],
      [s.reports_7d.toLocaleString("en"), "Last 7 days"],
      [s.total_reports.toLocaleString("en"), "Reports all time"],
      [relativeTime(snapshot.manifest.generated_at, Date.now()), "Updated"],
    ]) {
      const cell = document.createElement("div");
      cell.className = "stat";
      const v = document.createElement("span");
      v.className = "stat-value";
      v.textContent = value;
      const l = document.createElement("span");
      l.className = "stat-label";
      l.textContent = label;
      cell.append(v, l);
      strip.append(cell);
    }
    el("disclosure").textContent =
      `Unverified crowd reports · positions approximate to ~1 km · delayed at least ${formatDelay(
        snapshot.manifest.min_delay_minutes,
      )}.`;
  } else {
    strip.hidden = true;
  }

  const active = TIME_RANGES.find((r) => r.key === range);
  // "over All" reads wrong; the widest range names itself in time terms.
  const rangeText = active.key === "all" ? "all time" : active.label;
  el("legend-range").textContent = `over ${rangeText}`;
  el("live-range-label").textContent =
    snapshotState.status === "ok" || snapshotState.status === "stale" ? `· ${rangeText}` : "· unavailable";
}

// ---- controls ---------------------------------------------------------------
function buildRangeControl() {
  const holder = el("range-control");
  for (const { key, label } of TIME_RANGES) {
    const wrap = document.createElement("label");
    wrap.className = "range-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "range";
    input.value = key;
    input.checked = key === range;
    input.addEventListener("change", () => {
      range = key;
      recompute();
    });
    wrap.append(input, document.createTextNode(label));
    holder.append(wrap);
  }
}

// ---- curated fallback list (map runtime unavailable) ------------------------
function renderIncidentList() {
  const list = el("incident-list");
  list.innerHTML = "";
  const sorted = [...incidents].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  for (const incident of sorted) {
    const item = document.createElement("li");
    item.innerHTML = popupHtml({
      label: incident.label,
      date: incident.date,
      description: incident.description,
      source: incident.source,
    });
    list.append(item);
  }
}

function mapRuntimeUnavailable() {
  el("map").hidden = true;
  el("live-notice").hidden = true;
  el("map-fallback").hidden = false;
  renderIncidentList();
}

// ---- map bring-up -----------------------------------------------------------
function startMap() {
  const maplibregl = globalThis.maplibregl;
  const container = el("map");
  if (!maplibregl) return mapRuntimeUnavailable();
  try {
    map = new maplibregl.Map({
      container,
      style: BASEMAP_STYLE_URL,
      bounds: EUROPE_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });
  } catch (error) {
    console.warn("Map could not start.", error);
    return mapRuntimeUnavailable();
  }
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  // styledata fires for the initial style AND after any setStyle, so the
  // data re-attaches to whichever style is current. "load" alone never fires
  // when the basemap request fails, the exact case the fallback serves.
  map.on("styledata", () => {
    mapReady = true;
    syncMap(map, renderState);
  });

  // Spec: basemap failure is not data failure. Only a failure of the style
  // DOCUMENT is a basemap outage; tile and sprite errors fire routinely.
  let usedFallback = false;
  map.on("error", (event) => {
    const url = event?.error?.url;
    if (usedFallback || url !== BASEMAP_STYLE_URL) return;
    usedFallback = true;
    console.warn("Basemap unavailable, falling back to a bare background.", event.error);
    map.setStyle(fallbackStyle(renderState.palette));
  });

  // Frame Europe once the container has a size. The bounds option is not
  // enough: a 0x0 container yields a meaningless camera. Fit ONCE; refitting
  // on resize would yank the view from wherever the visitor panned.
  let framed = false;
  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry?.contentRect ?? { width: 0, height: 0 };
    if (framed || width === 0 || height === 0) return;
    framed = true;
    map.resize();
    map.fitBounds(EUROPE_BOUNDS, { padding: 24, animate: false });
  });
  observer.observe(container);

  // Curated popups.
  map.on("click", INCIDENT_LAYER_ID, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    new maplibregl.Popup({ closeButton: true, maxWidth: "320px" })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(popupHtml(feature.properties))
      .addTo(map);
  });
  map.on("mouseenter", INCIDENT_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", INCIDENT_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
}

// ---- boot -------------------------------------------------------------------
buildRangeControl();
startMap();

fetch("../assets/threat-data.json")
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
  .then((raw) => {
    incidents = parseIncidents(raw).incidents;
    renderState.incidents = incidentsToGeoJSON(incidents);
    el("curated-since").textContent = `since ${oldestYear(incidents)}`;
    if (map && mapReady) syncMap(map, renderState);
    if (!el("map-fallback").hidden) renderIncidentList();
  })
  .catch((error) => console.warn("Curated incidents failed to load.", error));

const store = createSnapshotStore({
  manifestUrl: MANIFEST_URL,
  onState: (state) => {
    snapshotState = state;
    recompute();
  },
});
store.start();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") store.onVisible();
});

recompute();
```

- [ ] **Step 5: Verify in the browser**

Run `npm run dev`, open `http://localhost:5199/dronereporter/map/` (Vite default port if 5199 is not configured; use whatever the dev server prints).
- Curated rings render over Europe; clicking one opens a styled popup with a working source link.
- The live notice reads the never-loaded copy (the prod manifest URL does not resolve yet, and if it does, CORS fails; both land in never-loaded).
- Temporarily set `MANIFEST_URL` to `/tests/map/fixtures/manifest.json` (update the fixture's `generated_at` to now first): dots, one wedge, one halo render; range control changes the ramp; stats strip fills. Revert the constant before committing.
- Console shows no errors beyond the expected manifest fetch failure when pointing at prod.

- [ ] **Step 6: Run the whole suite** — `node --test tests/map/` — PASS.

- [ ] **Step 7: Commit**

```bash
git add dronereporter/map/ tests/map/fixtures/
git commit -m "map: add activity map page, app wiring, vendored MapLibre"
```

---

### Task 9: CONTRACT.md

**Files:**
- Create: `dronereporter/map/CONTRACT.md`

Write the contract the parser enforces, structured as: entry point (`https://data.dronereporter.io/manifest.json`), the three artifacts with field tables and one example each (copy the JSON examples from dronetracker `history/plans/2026-08-06-public-map-design.md` §4.1 to §4.3, updated to `schema_version` "1.1.0" and one feature carrying `dir_x`/`dir_y`), the full rejection list from Task 1 (verbatim from the test names), the direction semantics (unit-vector sums over ALL reports in the bucket; omit both fields when the bucket holds one report or when any counted report lacks a heading; resultant bound count × 1.01), the freshness field (`max_age_minutes`, optional additive: the producer's promise driving the client's too-old cliff, clamped by the client to 60 to 10080 minutes, default 1440 when absent; the bake publishes 2880 while its cadence is daily), producer invariants the client does not check (hour ≤ cutoff_at; stats windows against cutoff_at), and the transport requirements (CORS `*` on all three artifacts and error responses; `Cache-Control` max-age=300 manifest / immutable 1 year snapshots; the Cloudflare Cache Rule note). End with a "Consumers and producers" line: this page is the consumer; the bake job in TMorville/dronetracker is the producer.

- [ ] **Step 1: Write the file as specified**
- [ ] **Step 2: Proofread against contract.js: every rejection in code appears in the doc and vice versa**
- [ ] **Step 3: Commit**

```bash
git add dronereporter/map/CONTRACT.md
git commit -m "map: document the public data contract the page enforces"
```

---

### Task 10: Page-2 CTA on the product page

**Files:**
- Modify: `dronereporter/index.html` (the `#threat .threat-box` block, after `.threat-footline`)

- [ ] **Step 1: Add the button**

```html
<a class="cta" href="map/">Open the live map</a>
```

Add `#threat .cta { margin-top:22px; }` beside the other `#threat` rules. The `.cta` class already exists (mono uppercase, amber border, fill on hover).

- [ ] **Step 2: Verify in the browser** — the button renders inside the glass box on view 2 at 1440×900 and 390×844, does not overflow the box's scroll mask, and navigates to the map page. The `is-clipped` mask logic in `threat-map.js` keys on box overflow; confirm the added element does not break the clipped-state fade.

- [ ] **Step 3: Commit**

```bash
git add dronereporter/index.html
git commit -m "dronereporter: link the threat view to the activity map"
```

---

### Task 11: Full verification pass

- [ ] **Step 1: Unit suite** — `node --test tests/map/` all green.
- [ ] **Step 2: Playwright visual pass** at 1440×900, 768×1024, 390×844 on `http://localhost:<port>/dronereporter/map/`: screenshot each, read them back, check console for errors (the prod-manifest fetch failure is expected), verify the layout holds (no horizontal scroll, aside stacks under the map on mobile, popup opens inside the viewport).
- [ ] **Step 3: /ux skill pass** over the screenshots plus accessibility tree; act on findings.
- [ ] **Step 4: Relative-path audit** — `grep -n 'href="/\|src="/' dronereporter/map/index.html` returns nothing (no root-absolute paths); canonical/og URLs are the only absolute ones and point at `https://dronereporter.io/map/`.
- [ ] **Step 5: kinami.io root check** — the page must also work served at `/dronereporter/map/` (Vite dev already serves it at that path, which is the kinami.io shape; this is why every path is relative).
- [ ] **Step 6: Commit any fixes, then hand to /ship-pr** for the PR. After Tobias merges: verify the deployed page by content (served `<title>` contains "Activity Map") with a negative control (`curl -s https://dronereporter.io/map/definitely-not-a-page/ | grep -c "Activity Map"` must be 0 given 404.html exists), then close dronetracker #94, #96, #113 via `gh pr close -R TMorville/dronetracker <n> --comment "..."` pointing at the kinami-website home, and notify the bake-job session that CONTRACT.md is live.
