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
