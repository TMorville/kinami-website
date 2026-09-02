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

test("min_delay_minutes must be a non-negative integer", () => {
  assert.throws(() => parseManifest({ ...manifest(), min_delay_minutes: "60" }), MalformedPayloadError);
  assert.throws(() => parseManifest({ ...manifest(), min_delay_minutes: Infinity }), MalformedPayloadError);
  // A negative delay would read as data published before it was collected.
  assert.throws(() => parseManifest({ ...manifest(), min_delay_minutes: -90 }), MalformedPayloadError);
  // formatDelay only phrases whole minutes and whole hours.
  assert.throws(() => parseManifest({ ...manifest(), min_delay_minutes: 60.5 }), MalformedPayloadError);
  // Zero is a legitimate promise: no publication delay at all.
  assert.equal(parseManifest({ ...manifest(), min_delay_minutes: 0 }).min_delay_minutes, 0);
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
  const nan = feature();
  nan.geometry = { type: "Point", coordinates: [NaN, 55.6] };
  assert.throws(() => parseReports(reports([nan])), MalformedPayloadError);
});

test("timestamps must be ISO 8601 with an explicit UTC or offset designator", () => {
  // Date.parse accepts these, the contract does not.
  assert.throws(() => parseManifest({ ...manifest(), generated_at: "Sep 1, 2026" }), MalformedPayloadError);
  assert.throws(
    () => parseManifest({ ...manifest(), generated_at: "2026-09-01T10:02:11" }),
    MalformedPayloadError,
  );
  parseManifest({ ...manifest(), generated_at: "2026-09-01T10:02:11.500+02:00" });
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
