# Public data contract

The activity map on this page reads one public dataset. This file records what
the page requires of that dataset, and what it does when the dataset does not
comply. The parser in `src/contract.js` and the fetch layer in `src/snapshot.js`
are the enforcement; this file is their description. If the two disagree, the
code is the truth and this file is a bug.

## Entry point

```
GET https://data.dronereporter.io/manifest.json
```

The page always enters through the manifest. It reads `reports_url` and
`stats_url` from the manifest and follows them. It never builds a snapshot URL
from a template, a snapshot id, or a date. Both URLs may be relative; the page
resolves them against the manifest URL.

One fetch of a snapshot is all-or-nothing. The manifest, `reports.json` and
`stats.json` must all arrive and all parse. If any of the three fails, the whole
fetch fails and the page keeps its previous good snapshot or shows an
unavailable state. It never renders a manifest without its data, or reports
without stats.

## Artifacts

Three JSON documents make up one snapshot. All three carry the same
`schema_version`, `snapshot_id`, `generated_at` and `cutoff_at`.

### manifest.json

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schema_version` | string | yes | Full semver triple. Major must be 1. |
| `snapshot_id` | string | yes | Identity of this publish. The other two files must repeat it. |
| `generated_at` | ISO 8601 UTC | yes | When the bake ran. Drives the freshness cliff and the "updated X ago" line. |
| `cutoff_at` | ISO 8601 UTC | yes | Eligibility boundary. No report after this instant appears in the snapshot. |
| `min_delay_minutes` | number | yes | Finite. The publication delay the producer applies, in minutes. |
| `reports_url` | string | yes | URL of `reports.json`, absolute or relative to the manifest. |
| `stats_url` | string | yes | URL of `stats.json`, absolute or relative to the manifest. |
| `max_age_minutes` | number | no | The producer's freshness promise. See "Freshness" below. |

```json
{
  "schema_version": "1.1.0",
  "snapshot_id": "2026-08-06T14Z-a1b2c3",
  "generated_at": "2026-08-06T14:02:11Z",
  "cutoff_at": "2026-08-06T13:02:00Z",
  "min_delay_minutes": 60,
  "max_age_minutes": 2880,
  "reports_url": "https://data.dronereporter.io/snapshots/2026-08-06T14Z-a1b2c3/reports.json",
  "stats_url": "https://data.dronereporter.io/snapshots/2026-08-06T14Z-a1b2c3/stats.json"
}
```

### reports.json

A GeoJSON `FeatureCollection` in WGS84, coordinates `[longitude, latitude]`.

One feature is one (grid cell, hour bucket) aggregate. Positions are snapped to
a fixed grid of about 1 km and emitted at the cell centroid, times are truncated
to the UTC hour, and `count` is the number of reports in that cell-hour. There
are no report ids, no per-report records, and no reporter-linked fields.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | string | yes | Exactly `"FeatureCollection"`. |
| `schema_version` | string | yes | Same rules as the manifest. |
| `snapshot_id` | string | yes | Must equal the manifest's. |
| `generated_at` | ISO 8601 UTC | yes | Same instant as the manifest's. |
| `cutoff_at` | ISO 8601 UTC | yes | Same instant as the manifest's. |
| `features` | array | yes | May be empty. |

Each feature:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `type` | string | yes | Exactly `"Feature"`. |
| `geometry.type` | string | yes | Exactly `"Point"`. |
| `geometry.coordinates` | array | yes | Exactly two finite numbers, `[lon, lat]`, with `abs(lon) <= 180` and `abs(lat) <= 90`. |
| `properties.hour` | ISO 8601 UTC | yes | The bucket's hour, truncated to the UTC hour. |
| `properties.count` | integer | yes | Reports in the bucket. Non-negative, never a fraction. |
| `properties.dir_x` | number | no | East component of the direction resultant. See "Direction". |
| `properties.dir_y` | number | no | North component of the direction resultant. See "Direction". |

```json
{
  "type": "FeatureCollection",
  "schema_version": "1.1.0",
  "snapshot_id": "2026-08-06T14Z-a1b2c3",
  "generated_at": "2026-08-06T14:02:11Z",
  "cutoff_at": "2026-08-06T13:02:00Z",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [12.575, 55.685] },
      "properties": {
        "hour": "2026-08-06T09:00:00Z",
        "count": 3,
        "dir_x": 1.2,
        "dir_y": -0.4
      }
    }
  ]
}
```

### stats.json

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schema_version` | string | yes | Same rules as the manifest. |
| `snapshot_id` | string | yes | Must equal the manifest's. |
| `generated_at` | ISO 8601 UTC | yes | Same instant as the manifest's. |
| `cutoff_at` | ISO 8601 UTC | yes | Same instant as the manifest's. |
| `total_reports` | integer | yes | Non-negative. Reports, not cells. |
| `reports_24h` | integer | yes | Non-negative. Reports in the 24 hours before `cutoff_at`. |
| `reports_7d` | integer | yes | Non-negative. Reports in the 7 days before `cutoff_at`. |
| `active_cells_7d` | integer | yes | Non-negative. Distinct grid cells with at least one report in the 7 days before `cutoff_at`. |

```json
{
  "schema_version": "1.1.0",
  "snapshot_id": "2026-08-06T14Z-a1b2c3",
  "generated_at": "2026-08-06T14:02:11Z",
  "cutoff_at": "2026-08-06T13:02:00Z",
  "total_reports": 412,
  "reports_24h": 9,
  "reports_7d": 61,
  "active_cells_7d": 23
}
```

## What the client rejects

A rejection is not a rendering glitch. The page drops the whole snapshot and
falls back to its last good data or to an unavailable state.

Schema version:

- `schema_version` that is not a string.
- `schema_version` that is not a full semver triple. `"1.0"` is rejected, and so
  is `"1garbage"`, which would otherwise parse to major 1 under `parseInt`.
- `schema_version` with a major other than 1, for example `"2.0.0"`. This is the
  one rejection with its own error type, `UnsupportedSchemaError`, and its own
  page state: the visitor is told the page needs updating, rather than shown a
  generic failure. `"1.9.3"` is accepted; the page ignores fields it does not
  know.

Payload shape:

- Any of the three documents that is not a JSON object. `null`, an array and a
  scalar are all rejected.
- `reports.type` that is not exactly `"FeatureCollection"`.
- `reports.features` that is not an array.
- A feature whose `type` is not exactly `"Feature"`.
- A feature whose `geometry` is not an object, or whose `geometry.type` is not
  exactly `"Point"`. A Polygon is never relabelled a Point.
- A feature whose `properties` is not an object.
- Any required string field that is not a string, including `snapshot_id`,
  `reports_url` and `stats_url`.

Numbers:

- `min_delay_minutes` that is not a finite number. The string `"60"` is
  rejected, and so is `Infinity`.
- `max_age_minutes` present and not a finite number.
- Any count that is not a non-negative integer: `total_reports`, `reports_24h`,
  `reports_7d`, `active_cells_7d` and a feature's `count`. `4.5` and `-1` are
  both rejected.

Coordinates:

- `geometry.coordinates` that is not an array, or does not have exactly two
  elements.
- A coordinate that is not finite. The test is `Number.isFinite`, not `typeof`,
  because `NaN` is a number and every comparison against it is false, so
  `[NaN, 55.6]` would pass a typeof-and-bounds check.
- A longitude outside -180 to 180, or a latitude outside -90 to 90.

Timestamps, everywhere they appear (`generated_at`, `cutoff_at`, a feature's
`hour`):

- Anything that does not match
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`. Shape is
  checked before parseability, because `Date.parse` accepts non-ISO forms such
  as `"Sep 1, 2026"`, and accepts offset-less local times such as
  `"2026-09-01T10:02:11"` that would mean different instants in different
  browsers. A fractional-second offset form such as
  `"2026-09-01T10:02:11.500+02:00"` is accepted.
- Anything the shape check passes but `Date.parse` cannot turn into a finite
  number. An unparseable timestamp yields `NaN`, and every `NaN` comparison is
  false, so it would silently disable the too-old gate rather than trip it.

Direction:

- A feature carrying `dir_x` without `dir_y`, or `dir_y` without `dir_x`. No
  bake can produce that. Neither field is normal, both fields is normal, one is
  malformed.
- `dir_x` or `dir_y` that is not a finite number.
- A resultant longer than the bucket's `count`, with 1% slack. See "Direction".

Cross-artifact, enforced at fetch time:

- `reports.snapshot_id` or `stats.snapshot_id` that differs from the manifest's
  `snapshot_id`. The page renders one publish, never a mixture of two.
- A partial fetch. If the manifest arrives but `reports.json` or `stats.json`
  does not, or returns a non-2xx status, the whole snapshot fails.

## Direction

`dir_x` and `dir_y` describe where the drones in a bucket were heading. They are
the sum of one unit vector per report, taken over **all** reports counted in the
bucket, not over a subset. `x` points east, `y` points north.

The page derives a bearing with `atan2(dir_x, dir_y)`, in degrees, clockwise
from north. The arguments are in that order, not the usual `atan2(y, x)`,
because x-east and y-north in that order gives a compass bearing directly. The
resultant's length relative to `count` gives the spread: reports that agree
produce a long resultant and a narrow wedge, reports that disagree produce a
short one and a wide wedge.

The producer omits **both** fields in two cases:

- the bucket holds a single report, so there is no direction to aggregate, and
- any report counted in the bucket lacks a heading, so a resultant over the
  remainder would not describe the `count` the page displays.

Because the fields sum `count` unit vectors, the resultant can never be longer
than `count`. The client rejects a feature where
`dir_x^2 + dir_y^2 > (count * 1.01)^2`. The 1% slack absorbs producer rounding
and nothing else. Without the bound, a mean resultant length above 1 would make
`acos` return `NaN` in the spread calculation.

## Freshness

`max_age_minutes` is an optional additive field on the manifest, added in the
1.x line. It is the producer's promise: data older than this should not be
presented as current. It drives the client's too-old cliff, the point past which
the page refuses to render a snapshot at all rather than show stale data as
fresh.

The client clamps whatever the producer publishes to between 60 and 10080
minutes, that is 1 hour to 7 days. The clamp keeps the promise bounded in both
directions: a producer bug cannot make year-old data render as current, and
cannot make a healthy page flap by promising minutes. When the field is absent,
the client uses a default of 1440 minutes, 24 hours.

The bake publishes 2880 minutes, 48 hours, while its cadence is daily. That
leaves room for one missed run before the page goes dark.

## Producer invariants the client does not check

The client trusts these. They are the producer's responsibility, and a violation
produces a wrong page rather than a rejected one.

- A feature's `hour` is at or before `cutoff_at`. The client validates that
  `hour` is a well-formed UTC timestamp, and nothing about its relation to the
  snapshot's cutoff.
- The stats windows are computed against `cutoff_at`, not against wall-clock
  time at bake. `reports_24h`, `reports_7d` and `active_cells_7d` all count the
  same delayed, geofence-passing population the map shows, over windows ending
  at `cutoff_at`.
- **Centroids are deterministic and byte-stable.** The grid is a fixed WGS84
  0.01 degree by 0.01 degree grid anchored at (0, 0):
  `cell_lon = floor(lon / 0.01)` and `cell_lat = floor(lat / 0.01)`. A feature's
  geometry is that cell's centroid,
  `[cell_lon * 0.01 + 0.005, cell_lat * 0.01 + 0.005]`, emitted with exactly
  3 decimal places, and identical across snapshots for the same cell. The client
  uses the coordinate pair itself as cell identity: it collapses hour buckets
  into cells by the exact `${lon},${lat}` string. A bake that jitters a
  centroid, or emits a different number of decimal places, splits one cell into
  several. Counts scatter across the fragments, direction stops aggregating, and
  nothing is rejected, because every fragment is individually valid.

## Transport

- `Access-Control-Allow-Origin: *` on the manifest, on both snapshot files, and
  on error responses. Without the header on errors, a failing request surfaces
  in the browser as an opaque CORS failure instead of the status the page can
  report.
- `Cache-Control: public, max-age=300` on the manifest. The page's poll interval
  matches that TTL, so a poll is an edge-cache hit.
- `Cache-Control: public, max-age=31536000, immutable` on both snapshot files.
  Their URLs carry the snapshot id, so their content never changes.
- `Content-Type: application/json; charset=utf-8`. GeoJSON served as JSON is
  correct.
- A Cloudflare Cache Rule on the data hostname is required. R2 custom domains do
  not edge-cache JSON by default, and `Cache-Control` metadata alone does not
  change that. Configure a Cache Rule that marks the responses cache eligible
  and respects the origin `Cache-Control`. Without it, a traffic spike hits R2
  directly as billable read operations.

## Consumers and producers

This page is the consumer. The bake job in `TMorville/dronetracker` is the
producer.
