# dronereporter.io/map/ — live map design spec

Date: 2026-09-01. Status: draft, pre-implementation.

## 1. Purpose

A public, view-only, interactive map at `https://dronereporter.io/map/` showing
two layers: the manually curated European drone incidents (the same data the
page-2 threat map renders) and live crowdsourced observations from the Drone
Reporter network. It is a reimplementation of the behavior of Marcos's
`publicmap/` app (dronetracker PRs #94/#96, hardened by #113) in this repo's
idiom: static files, no build step, vanilla ES modules, the site's design
system. Those PRs will be closed with a pointer here; git history does not
carry over by decision.

## 2. Constraints (inherited from this repo)

- Served by the existing Cloudflare Pages project (`dronereporter/` subtree as
  document root). Build command stays empty. No `_redirects`, no `_headers`.
- The subtree serves at two roots at once (dronereporter.io `/` and
  kinami.io `/dronereporter/`), so every internal path is relative. Absolute
  URLs only in crawler metadata (canonical, og:*) and cross-domain links.
- All assets live inside the subtree. MapLibre GL is vendored, not CDN-loaded.
- Design tokens from `.interface-design/system.md`: single-hue amber
  `rgba(220, 180, 100, α)` on `#0c0a04`, hairline borders, mono eyebrows,
  serif headings. Marcos's tokens.css is not used.
- No em dashes in user-facing copy.

## 3. Files

```
dronereporter/map/
├── index.html          page shell, inline CSS, loads vendor + app module
├── CONTRACT.md         the public data contract this page's parser enforces
├── vendor/
│   ├── maplibre-gl.js  pinned 6.x UMD build, self-hosted
│   └── maplibre-gl.css
└── src/
    ├── app.js          wiring: state machine → DOM + map updates
    ├── contract.js     parse/validate manifest, reports.json, stats.json
    ├── snapshot.js     fetchSnapshot + snapshot state machine
    ├── cells.js        collapseCells, direction (Rayleigh gate), time window
    ├── layers.js       MapLibre style constants, paint expressions, SDF icons
    ├── curated.js      curated-incidents layer + popups
    └── format.js       relativeTime, formatDelay, marker clock
tests/map/              node:test unit tests for the pure modules
```

`dronereporter/index.html` gains one CTA in the page-2 glass box:
"Open the live map" → `map/` (relative).

## 4. Data contract (live layer)

Entry point `https://data.dronereporter.io/manifest.json` (named constant in
app.js). Contract as pinned in dronetracker
`history/plans/2026-08-06-public-map-design.md` §4, plus Marcos's additive
extension:

- Manifest: `schema_version` (semver triple, supported major = 1),
  `snapshot_id`, `generated_at`, `cutoff_at`, `min_delay_minutes`,
  `reports_url`, `stats_url`, and optionally `max_age_minutes` (additive
  1.x field, agreed with the bake session 2026-09-01): the producer's own
  freshness promise. The bake runs daily during alpha, so a fixed 24 h
  cliff would flag a healthy pipeline as unavailable. The client keys the
  too-old cliff to this field, clamped to [60, 10080] minutes (1 h to 7 d)
  so a producer bug cannot extend the honesty guarantee indefinitely;
  default 1440 (24 h) when absent. The bake publishes 2880 (48 h) while
  the cadence is daily. Snapshot URLs are followed, never constructed;
  resolved against the manifest URL.
- reports.json: GeoJSON FeatureCollection of (0.01° grid cell, UTC hour)
  aggregates. Properties: `hour` (ISO), `count` (non-negative integer), and
  optionally `dir_x`/`dir_y` (summed unit vectors of report headings; both
  present or both absent; absent when the bucket holds one report).
- stats.json: `total_reports`, `reports_24h`, `reports_7d`,
  `active_cells_7d`, all counts, windows defined against `cutoff_at`.
- `contract.js` is the UNION of two parser versions that never merged
  upstream: the #113-hardened parser (which lacks direction) and #94's 1.1.0
  direction-aware parser (which regressed some hardening). Both test suites
  get ported. Full rejection list: non-semver-triple schema versions,
  unsupported major (distinct error → "page needs updating" state),
  unparseable timestamps, non-integer or negative counts, non-finite
  `min_delay_minutes`, coordinates outside WGS84 range or not a 2-element
  numeric array, wrong GeoJSON discriminators, snapshot_id mismatch between
  any two of the three artifacts, `dir_x` without `dir_y` or vice versa,
  non-finite direction components, and a direction resultant exceeding
  `count × 1.01` (unit-vector sums cannot be longer than count; 1% is
  rounding slack).
- CORS is a deployment requirement on the data host, not a nicety: the page
  fetches cross-origin from `https://dronereporter.io`, `https://kinami.io`,
  and Cloudflare Pages preview origins. `Access-Control-Allow-Origin: *` per
  #79 §4.5, applied to the manifest, both snapshot files, and error
  responses. Recorded in CONTRACT.md and in the bake-job handoff.

## 5. Live-layer behavior (ported semantics)

State machine states: `loading`, `ok`, `stale`, `unavailable` with reasons
`never-loaded` / `too-old` / `unsupported-schema`. In vanilla JS there is no
React lifecycle to lean on, so the fetch side is one owner object with an
explicit contract: `start()`, `load(trigger)`, `destroy()`. Rules:

- Every trigger (initial, retry, interval, visibility) increments the epoch
  and aborts its predecessor; only the current epoch may mutate state or
  schedule a retry.
- At most one retry timeout, one poll interval, one expiry timer, and one
  AbortController exist at any time. Any success cancels a scheduled retry.
- A visibility-triggered load that fails while nothing has ever loaded
  re-enters the retry ladder (the React original could drop it).
- `destroy()` aborts, clears every timer, removes listeners, bumps the epoch.
- On visibilitychange, the 24 h cliff is re-checked synchronously before any
  retained snapshot is shown again.

Invariants:

- All-or-nothing fetch: manifest plus both files, one failure = failure.
- 30 s timeout on the whole snapshot fetch, surfacing as TimeoutError, which
  is deliberately not AbortError (callers swallow AbortError as supersession).
  Sibling in-flight request aborted when one fails.
- Freshness cliff on `generated_at`: the snapshot's own `max_age_minutes`
  (clamped, default 24 h). Enforced three ways: on successful load, on
  failed refetch over a retained snapshot, and by a dedicated expiry timer so
  the limit holds when no fetch settles. Timer re-verifies against current
  state before stamping too-old (the #113 race fix).
- Refetch every 300 s (matches manifest TTL); refetch on visibilitychange;
  first-load retry ladder 2 s / 5 s / 15 s; monotonic epoch guard so a slow
  older response never overwrites newer state.
- A failed refetch keeps the last good snapshot as `stale`; recency freezes in
  the stale state (accepted, bounded by the cliff, stale notice carries the
  snapshot age).

Rendering:

- One GeoJSON source; updates via `setData` only.
- Dots: radius interpolates count 1→50 into 4→14 px; recency ramp full amber
  to dim amber, rescaled to the active window (ramp stops = window span ×
  24/168 fraction, floor 1 h, strictly increasing stops). `age_h` measured
  from the window's recent edge (or the replay marker), not the client clock.
- Clustering (user decision 2026-09-01): the cells source is a MapLibre
  clustered GeoJSON source (radius 40 px, clusterMaxZoom 8) so sparse beta
  data reads as a few clear markers at the Europe frame. Cluster properties
  aggregate honestly: `sum_count` sums report counts (never cell counts) and
  `min_age_h` takes the newest member's age, driving the same recency ramp.
  A text layer labels each cluster with `sum_count`. Zoomed past 8, the
  individual cells with their dots and direction marks take over. The
  fallback style carries a `glyphs` URL so cluster labels can render over
  the bare background too (if that host is down as well, labels drop, the
  map lives).
- Direction marks: one symbol layer of SDF icons, never polygons (screen-px
  sized so they cannot read as metric). Wedge when Rayleigh statistic
  (dx²+dy²)/n ≥ 1.14 (tuning constant, not a confidence level), halo when
  directional reports ≥ 2 but below the bar, nothing otherwise. Half-angle =
  clamp(acos(R), 8°, 44°), quantized to icon buckets. Bearing = atan2(x, y)
  compass. Marks hidden below zoom 7. icon-allow-overlap +
  icon-ignore-placement. Marks colored by the same ramp (SDF).
- Basemap: OpenFreeMap dark style, with the #94 hidden-layer list (borders
  and road names off, roads and airports on, country names on). Basemap
  failure is not data failure: style-document error → bare background
  fallback style, data layers re-attach on styledata. Only a failure of the
  style document counts (tile/sprite errors ignored).
- Every `styledata` (initial style AND any fallback restyle) rehydrates the
  full data state from one central render-state object: SDF icons, curated
  and live sources with their CURRENT data, layers in order, current ramp
  paint stops. The React original re-created the source empty and relied on
  effect re-runs; the vanilla port must not lose pushed data across a
  restyle. A unit test forces the fallback after both layers hold data.
- Map-runtime failure is its own state, separate from data unavailability:
  if the vendored library is missing, the Map constructor throws, or WebGL2
  is unavailable (MapLibre 6 requires it), the page shows a plain message
  and renders the curated incidents as an accessible list instead of a
  canvas. The curated layer must not depend on MapLibre working.
- MapLibre 6's `setData` returns a promise; every call catches and logs.
- Europe frame [[-12, 34], [33, 63]], fitted once on first non-empty
  container size (ResizeObserver), never re-fitted on resize.

Controls (live layer only):

- Time range 24 h / 3 d / 7 d / All, default All (user decision 2026-09-01:
  the fleet is in beta, every observation should show; this supersedes the
  original's 7 d default). Implemented as NATIVE radio inputs styled
  by the design system, so keyboard arrow behavior is free rather than
  hand-rolled roving tabindex. Window ends at `generated_at`, never the
  client clock. "All" starts at the oldest report. Features outside the
  window are excluded, not dimmed.
- Replay: CUT from v1 (Codex scope review; no launch data to sweep, and it
  is the largest timer/UI surface). The pure window/marker math in cells.js
  keeps the marker parameter so replay can return without reshaping the
  modules. If reinstated: never autoplays, always-visible UTC clock, 2 h
  steps at 260 ms, marker resets whenever either window endpoint changes
  (which includes a new snapshot), stops on unavailable and on destroy.
- Legend names the active range beside the recency scale (load-bearing: the
  ramp is rescaled per window, so a color denotes no fixed age without it),
  and keeps the original honesty note verbatim in meaning: the dot grows
  with the number of reports, not certainty; it shows where reports came
  from, never where a drone was.
- Stats strip: last 24 h, last 7 d, all time, updated-ago. Rendered inside
  the live group (see §6) so its numbers cannot read as describing the
  curated incidents.
- Disclosure line: "Unverified crowd reports · positions approximate to ~1 km
  · delayed at least {formatDelay(min_delay_minutes)}."

Until the bake job publishes, the live layer sits in `unavailable
(never-loaded)`. The notice is scoped to the live layer; the page and the
curated layer render normally.

## 6. Curated layer

- Source: `../assets/threat-data.json` (the same file the page-2 threat map
  reads; one copy, no drift). 43 incidents with id, label, country, site,
  lat/lng, date, category, description, source.
- Mark: hollow ring in the amber hue, visually distinct from the filled live
  dots. Not affected by the time-range control (historical record).
- Interaction: click (tap) opens a popup with label, date, one-paragraph
  description, and source link. No separate hover tooltip; one accessible
  popup path is enough for 43 incidents.
- The two layers are named as GROUPS on screen, not just as swatches. The
  legend and controls are split into two labeled sections: "Documented
  incidents · curated record since 2018 · not filtered by time range" and
  "Live crowd reports · {active range}" (or "· unavailable" in that state).
  A ring swatch alone does not carry the years-old-versus-live distinction.

## 7. Page shell and copy

Page heading: "Drone activity map", not "Live map". With no live data at
launch, a "live" heading over a curated record overpromises; the live layer
is labeled live where it actually is. The page-2 button copy stays
Tobias's call.

Header: DRONE REPORTER wordmark (site lockup pattern), one-line tagline.
Aside/panel: stats strip, legend, store badges (the same badges the product
page uses; no QR code, no /go/ios), disclosure line. Footer back-link to
`../` and `https://kinami.io/`. Meta: canonical
`https://dronereporter.io/map/`, og/twitter absolute, page `<title>`
"Live Map – Drone Reporter" pattern consistent with sibling pages.
Assumed audience (unvalidated, no audience card exists): desktop-first,
English, Europe-framed journalists and officials during an incident news
cycle.

## 8. Testing and verification

- Pure modules get node:test suites ported from Marcos's test cases
  (parser rejections, collapse/direction math, window/replay rules, ramp
  stops). Run with `node --test tests/map/`.
- Visual: Playwright at 1440×900, 768×1024, 390×844; console clean; /ux pass
  before ship.
- Deploy verification by content (served `<title>`), with a negative control
  against a known-absent path.
- Manual state checks: manifest URL 404 → curated-only with live-layer
  notice; fixture manifest via local override → full live rendering.
  A `?manifest=` query override is NOT included (public surface; the constant
  is edited locally for testing instead).

Loading order in index.html: the vendored MapLibre as a blocking classic
script FIRST (so `window.maplibregl` exists), then `<script type="module"
src="src/app.js">`. The vendor file is pinned to an exact patch version in
its filename (e.g. `maplibre-gl-6.4.0.js`) with its license header retained.

## 9. Out of scope

- The bake job (separate session in dronetracker; prompt handed off).
- Replay (cut for v1, see §5; the pure math stays replay-ready).
- /go/ios redirect, QR code (dropped with rationale in §7).
- Per-report popups on the live layer (contract has no per-report data).
- A layer toggle UI; both layers always render in v1.
- k-suppression/count banding (bake-side concern).

## 10. Open decisions taken

- Vendored MapLibre GL 6.x over CDN (subtree asset rule, availability).
- Site tokens over Marcos's tokens.css.
- Time filter applies to live layer only.
- Curated data stays in `assets/threat-data.json`; the map reads it
  relatively; the deck's copy remains a separate concern.

## 11. Review trail

Codex pass 2026-09-01 (10 min, gpt-5.6-sol). Accepted: CORS as a pinned
deployment requirement; a map-runtime-unavailable state with a curated
fallback list (curated must not depend on MapLibre/WebGL2); contract.js as
the explicit union of the two upstream parser versions incl. the direction
resultant bound; styledata rehydration from central render state with a
forced-fallback test; the explicit fetch-scheduler contract; replay reset
on any window-endpoint change (had replay shipped); native radio inputs
over ARIA radiogroup; default range 7 d restored; grouped two-layer legend
language; "Drone activity map" heading; classic-script-before-module load
order with exact-version filename; catching setData's promise; replay cut
from v1; curated hover tooltip dropped in favor of the click popup.
Rejected with rationale: deferring direction wedges/halos. They are
zoom-gated, honestly labeled, already fully specified, and they are the
distinctive part of the ported design; deferring them buys little since the
same launch-data absence argument applies to the whole live layer.
