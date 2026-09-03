// tests/map/ping.test.js
// The radar ping on curated incidents under seven days old.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FRESH_MS, hasFresh, incidentsToGeoJSON, isFresh } from "../../dronereporter/map/src/curated.js";
import {
  INCIDENT_PING_LAYER_ID,
  INCIDENT_SOURCE_ID,
  PING_MAX_PX,
  PING_MIN_PX,
  PING_OPACITY,
  pingLayer,
  pingPaint,
} from "../../dronereporter/map/src/layers.js";
import { applyPing, syncMap } from "../../dronereporter/map/src/maprender.js";

const NOW = Date.parse("2026-09-03T12:00:00Z");
const DAY = 86_400_000;
const palette = { amber: "#E8A33D", amberDim: "#8a6b3a", background: "#0A0907" };

const incident = (date) => ({
  id: "x-1",
  label: "Test Airport",
  lat: 55.6,
  lng: 12.5,
  date,
  category: "airport-closure",
});

// ---- freshness ----------------------------------------------------------------

test("FRESH_MS is seven days", () => {
  assert.equal(FRESH_MS, 7 * DAY);
});

test("isFresh: under seven days is fresh, seven days and over is not", () => {
  assert.equal(isFresh("2026-09-02", NOW), true);
  // 2026-08-28T00:00Z is 6.5 days before NOW.
  assert.equal(isFresh("2026-08-28", NOW), true);
  // 2026-08-27T00:00Z is 7.5 days before NOW.
  assert.equal(isFresh("2026-08-27", NOW), false);
  // Exactly seven days.
  assert.equal(isFresh("2026-08-27", Date.parse("2026-09-03T00:00:00Z")), false);
});

test("isFresh: an unparseable date is never fresh", () => {
  assert.equal(isFresh("yesterday", NOW), false);
  assert.equal(isFresh(undefined, NOW), false);
});

test("GeoJSON features carry a fresh flag against the given clock", () => {
  const geo = incidentsToGeoJSON([incident("2026-09-02"), incident("2025-09-24")], NOW);
  assert.equal(geo.features[0].properties.fresh, true);
  assert.equal(geo.features[1].properties.fresh, false);
});

test("hasFresh reports whether any feature is fresh", () => {
  assert.equal(hasFresh(incidentsToGeoJSON([incident("2025-09-24")], NOW)), false);
  assert.equal(hasFresh(incidentsToGeoJSON([incident("2026-09-02")], NOW)), true);
  assert.equal(hasFresh({ type: "FeatureCollection", features: [] }), false);
});

// ---- layer and paint ------------------------------------------------------------

test("pingLayer is a circle layer on the incident source, filtered to fresh rows", () => {
  const layer = pingLayer(palette);
  assert.equal(layer.id, INCIDENT_PING_LAYER_ID);
  assert.equal(layer.type, "circle");
  assert.equal(layer.source, INCIDENT_SOURCE_ID);
  assert.deepEqual(layer.filter, ["==", ["get", "fresh"], true]);
  assert.equal(layer.paint["circle-stroke-color"], palette.amber);
  // A ring, not a disc: the fill is off.
  assert.equal(layer.paint["circle-opacity"], 0);
});

test("pingPaint: phase 0 is the small bright ring, phase 1 the large invisible one", () => {
  const start = pingPaint(0);
  assert.equal(start["circle-radius"], PING_MIN_PX);
  assert.equal(start["circle-stroke-opacity"], PING_OPACITY);
  const end = pingPaint(1);
  assert.equal(end["circle-radius"], PING_MAX_PX);
  assert.equal(end["circle-stroke-opacity"], 0);
  const mid = pingPaint(0.5);
  assert.ok(mid["circle-radius"] > PING_MIN_PX && mid["circle-radius"] < PING_MAX_PX);
  assert.ok(mid["circle-stroke-opacity"] > 0 && mid["circle-stroke-opacity"] < PING_OPACITY);
});

// ---- applyPing against a fake map ------------------------------------------------

function fakeMap() {
  const map = {
    images: new Map(),
    sources: new Map(),
    layers: [],
    paint: {},
    hasImage: (id) => map.images.has(id),
    addImage: (id, image, opts) => map.images.set(id, { image, opts }),
    getSource: (id) => map.sources.get(id),
    addSource: (id, spec) =>
      map.sources.set(id, { ...spec, setData: (d) => (map.sources.get(id).data = d) }),
    getLayer: (id) => map.layers.find((l) => l.id === id),
    addLayer: (layer) => map.layers.push(layer),
    setPaintProperty: (id, key, value) => (map.paint[`${id}/${key}`] = value),
    setLayoutProperty: () => {},
  };
  return map;
}

const empty = { type: "FeatureCollection", features: [] };

test("applyPing writes the phase's radius and stroke opacity to the ping layer", () => {
  const map = fakeMap();
  syncMap(map, { palette, cells: empty, incidents: incidentsToGeoJSON([incident("2026-09-02")], NOW) });
  applyPing(map, 0);
  assert.equal(map.paint[`${INCIDENT_PING_LAYER_ID}/circle-radius`], PING_MIN_PX);
  applyPing(map, 1);
  assert.equal(map.paint[`${INCIDENT_PING_LAYER_ID}/circle-radius`], PING_MAX_PX);
  assert.equal(map.paint[`${INCIDENT_PING_LAYER_ID}/circle-stroke-opacity`], 0);
});

test("applyPing is a no-op before the ping layer exists", () => {
  const map = fakeMap();
  applyPing(map, 0.5);
  assert.deepEqual(map.paint, {});
});
