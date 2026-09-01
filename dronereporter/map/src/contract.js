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
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isoDate(obj, key) {
  const value = str(obj, key);
  // Shape first: Date.parse accepts non-ISO forms and offset-less local
  // times, which would make the same artifact mean different instants in
  // different browsers. Then parseability, which the cliff and ramp need.
  if (!ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new MalformedPayloadError(`"${key}" is not an ISO 8601 UTC timestamp: "${value}"`);
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
    // Number.isFinite, not typeof: NaN is a number and every NaN comparison
    // below is false, so [NaN, 55] would pass a typeof-and-bounds check.
    !Number.isFinite(coords[0]) ||
    !Number.isFinite(coords[1]) ||
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
