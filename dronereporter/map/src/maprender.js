import {
  CELL_LAYER_ID,
  CELL_SOURCE_ID,
  CELL_SOURCE_OPTIONS,
  CLUSTER_COUNT_LAYER_ID,
  CLUSTER_LAYER_ID,
  HIDDEN_BASEMAP_LAYERS,
  INCIDENT_GLOW_LAYER_ID,
  INCIDENT_LAYER_ID,
  INCIDENT_SOURCE_ID,
  MARK_LAYER_ID,
  cellCirclePaint,
  clusterCountLayer,
  clusterLayer,
  curatedDotLayer,
  curatedGlowLayer,
  markIcons,
  markLayer,
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
  const { palette, cells, incidents } = renderState;

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

  // Incident glow under its core, then clusters with their counts, then
  // marks, then live dots; marks before dots so a dot draws over its own
  // wedge apex.
  if (!map.getLayer(INCIDENT_GLOW_LAYER_ID)) map.addLayer(curatedGlowLayer(palette));
  if (!map.getLayer(INCIDENT_LAYER_ID)) map.addLayer(curatedDotLayer(palette));
  if (!map.getLayer(CLUSTER_LAYER_ID)) map.addLayer(clusterLayer(palette));
  if (!map.getLayer(CLUSTER_COUNT_LAYER_ID)) map.addLayer(clusterCountLayer(palette));
  if (!map.getLayer(MARK_LAYER_ID)) map.addLayer(markLayer(palette));
  if (!map.getLayer(CELL_LAYER_ID)) {
    map.addLayer({
      id: CELL_LAYER_ID,
      type: "circle",
      source: CELL_SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      paint: cellCirclePaint(palette),
    });
  }
  // Paint is static since the two-tone step (2026-09-02): the layers carry
  // their colour at addLayer time, and a restyle re-adds them through the
  // branch above. No per-sync paint refresh remains.
}
