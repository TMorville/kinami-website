import { test } from "node:test";
import assert from "node:assert/strict";
import { syncMap } from "../../dronereporter/map/src/maprender.js";
import {
  CELL_LAYER_ID,
  CELL_SOURCE_ID,
  CLUSTER_COUNT_LAYER_ID,
  CLUSTER_LAYER_ID,
  INCIDENT_GLOW_LAYER_ID,
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
    addSource: (id, spec) =>
      map.sources.set(id, { ...spec, setData: (d) => (map.sources.get(id).data = d) }),
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
  palette: { amber: "#E8A33D", amberDim: "#8a6b3a", background: "#0A0907" },
  cells,
  incidents,
});

test("first sync creates icons, both sources with data, and layers in order", () => {
  const map = fakeMap();
  syncMap(map, rs(geo(2), geo(3)));
  assert.ok(map.images.size > 0);
  assert.equal(map.sources.get(CELL_SOURCE_ID).data.features.length, 2);
  assert.equal(map.sources.get(INCIDENT_SOURCE_ID).data.features.length, 3);
  // Live layers first, curated incidents on top (glow under core): the
  // interactive diamonds must never be painted over by a cluster.
  assert.deepEqual(
    map.layers.map((l) => l.id),
    [
      CLUSTER_LAYER_ID,
      CLUSTER_COUNT_LAYER_ID,
      MARK_LAYER_ID,
      CELL_LAYER_ID,
      INCIDENT_GLOW_LAYER_ID,
      INCIDENT_LAYER_ID,
    ],
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
  assert.equal(map.layers.length, 6);
});

test("a rejecting setData is caught, never an unhandled rejection", async () => {
  const map = fakeMap();
  syncMap(map, rs(geo(1), geo(1)));
  map.sources.get(CELL_SOURCE_ID).setData = () => Promise.reject(new Error("boom"));
  assert.doesNotThrow(() => syncMap(map, rs(geo(2), geo(2))));
  // node:test fails the run on an unhandled rejection; give it a tick.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("repeat syncs update data without duplicating layers, and paint rides addLayer", () => {
  const map = fakeMap();
  syncMap(map, rs(geo(1), geo(1)));
  syncMap(map, rs(geo(2), geo(1)));
  assert.equal(map.layers.length, 6);
  assert.equal(map.sources.get(CELL_SOURCE_ID).data.features.length, 2);
  // Two-tone paint is static: it arrives with the layer, never via
  // setPaintProperty, so a restyle re-adding the layers restores it too.
  const dots = map.layers.find((l) => l.id === CELL_LAYER_ID);
  assert.equal(dots.paint["circle-color"][0], "step");
  assert.equal(Object.keys(map.paint).length, 0);
});
