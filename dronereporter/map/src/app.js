// dronereporter/map/src/app.js
import { createSnapshotStore } from "./snapshot.js";
import { cellsToGeoJSON, collapseCells } from "./cells.js";
import {
  BASEMAP_STYLE_URL,
  EUROPE_BOUNDS,
  INCIDENT_GLOW_LAYER_ID,
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
  cells: EMPTY,
  incidents: EMPTY,
};

let map = null;
let mapReady = false;
let snapshotState = { status: "loading" };
let incidents = [];

// ---- live layer derivation -------------------------------------------------
function recompute() {
  const snapshot =
    snapshotState.status === "ok" || snapshotState.status === "stale" ? snapshotState.snapshot : null;
  if (!snapshot) {
    // No snapshot, no live layer, no message about it. The curated record
    // carries the map; the live dots appear the day the pipeline publishes.
    renderState.cells = EMPTY;
  } else {
    renderState.cells = cellsToGeoJSON(
      collapseCells(snapshot.reports),
      snapshot.manifest.generated_at,
    );
  }
  safeSync();
  renderBar(snapshot);
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

// ---- bottom bar and drawer ---------------------------------------------------
function renderBar(snapshot) {
  // The stats line is the live layer's entire on-map chrome. Without a
  // snapshot it is absent, not apologising: an empty live layer makes no
  // claim, so it needs no notice.
  const stats = el("live-stats");
  if (snapshot) {
    const s = snapshot.stats;
    stats.hidden = false;
    stats.textContent =
      `${s.reports_24h.toLocaleString("en")} reports last 24 h · ` +
      `${s.reports_7d.toLocaleString("en")} last 7 d · ` +
      `${s.total_reports.toLocaleString("en")} all time · ` +
      `updated ${relativeTime(snapshot.manifest.generated_at, Date.now())}`;
  } else {
    stats.hidden = true;
    stats.textContent = "";
  }

  // The disclosure describes the live layer that is on screen. With no
  // snapshot there is no delay to promise, so the line stays hidden rather
  // than asserting a figure from the markup.
  const disclosure = el("disclosure");
  if (snapshot) {
    disclosure.hidden = false;
    disclosure.textContent =
      `Unverified crowd reports · positions approximate to ~1 km · delayed at least ${formatDelay(
        snapshot.manifest.min_delay_minutes,
      )}.`;
  } else {
    disclosure.hidden = true;
    disclosure.textContent = "";
  }
}

function setupDrawer() {
  const drawer = el("drawer");
  const toggle = el("drawer-toggle");
  const close = el("drawer-close");

  const open = () => {
    drawer.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    close.focus();
  };
  const shut = () => {
    drawer.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  };

  toggle.addEventListener("click", () => (drawer.hidden ? open() : shut()));
  close.addEventListener("click", shut);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.hidden) shut();
  });
}

// ---- curated incident list ---------------------------------------------------
/**
 * Two lists carry the same rows: the one inside the drawer, always present
 * under a collapsed disclosure, and the one in the fallback panel that
 * replaces the map when the runtime is gone. The drawer copy is the reason
 * the record is reachable without WebGL, a pointer, or sighted map reading.
 */
function incidentLists() {
  return document.querySelectorAll(".incident-list");
}

function renderIncidentList() {
  const sorted = [...incidents].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  for (const list of incidentLists()) {
    list.innerHTML = "";
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
}

/** An empty list under an "All documented incidents" summary reads as "none". */
function renderIncidentListFailure() {
  for (const list of incidentLists()) {
    list.innerHTML = "";
    const item = document.createElement("li");
    item.textContent = "The documented incidents could not be loaded.";
    list.append(item);
  }
}

function mapRuntimeUnavailable() {
  el("map").hidden = true;
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

  // Curated popups. Handlers sit on the glow layer as well as the core: the
  // core is 3 to 4 px and too small a target on its own; the glow gives the
  // same dot the threat map's forgiving hit area. ONE reused popup, because
  // a click on the core fires both layers' handlers and two fresh popups
  // would stack.
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" });
  for (const layerId of [INCIDENT_LAYER_ID, INCIDENT_GLOW_LAYER_ID]) {
    map.on("click", layerId, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      popup
        .setLngLat(feature.geometry.coordinates)
        .setHTML(popupHtml(feature.properties))
        .addTo(map);
    });
    map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
  }
}

// ---- boot -------------------------------------------------------------------
setupDrawer();
startMap();

fetch("../assets/threat-data.json")
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
  .then((raw) => {
    incidents = parseIncidents(raw).incidents;
    renderState.incidents = incidentsToGeoJSON(incidents);
    el("curated-since").textContent = `since ${oldestYear(incidents)}`;
    safeSync();
    renderIncidentList();
  })
  .catch((error) => {
    console.warn("Curated incidents failed to load.", error);
    renderIncidentListFailure();
  });

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
