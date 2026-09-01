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
  safeSync();
  renderChrome(snapshot);
}

/**
 * All syncs route through here. During a setStyle transition, addSource and
 * addLayer against the half-replaced style throw; mapReady is dropped around
 * the transition and, as a second line of defense, a mid-transition failure
 * is swallowed because the styledata that ends the transition re-syncs the
 * same idempotent state.
 */
function safeSync() {
  if (!map || !mapReady) return;
  try {
    syncMap(map, renderState);
  } catch (error) {
    console.warn("Map sync deferred to the next styledata.", error);
  }
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
/** MapLibre 6 needs WebGL2; probing is deterministic where the constructor's
    failure path is not (some context failures surface async). */
function webgl2Available() {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

function startMap() {
  const maplibregl = globalThis.maplibregl;
  const container = el("map");
  if (!maplibregl || !webgl2Available()) return mapRuntimeUnavailable();
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
    safeSync();
  });

  // Spec: basemap failure is not data failure. Only a failure of the style
  // DOCUMENT is a basemap outage; tile and sprite errors fire routinely.
  let usedFallback = false;
  map.on("error", (event) => {
    const url = event?.error?.url;
    if (usedFallback || url !== BASEMAP_STYLE_URL) return;
    usedFallback = true;
    console.warn("Basemap unavailable, falling back to a bare background.", event.error);
    // Drop readiness for the transition; the fallback's styledata restores it.
    mapReady = false;
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
    safeSync();
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
