/**
 * The MapLibre style: basemap choice, source and layer builders, and the
 * wedge/halo mark icons as signed distance fields.
 *
 * Pure apart from `readPalette`, which is the one function that reads the DOM
 * and takes its root as an argument so tests never need one. Everything else
 * builds plain objects and pixel buffers, so the geometry stays unit-testable
 * without a canvas or a map.
 */
import {
  COUNT_AT_MAX_RADIUS,
  COUNT_AT_MIN_RADIUS,
  MAX_HALF_ANGLE_DEG,
  MIN_HALF_ANGLE_DEG,
  RADIUS_MAX_PX,
  RADIUS_MIN_PX,
} from "./cells.js";

/* ------------------------------------------------------------------ */
/* Mark icons                                                          */
/* ------------------------------------------------------------------ */

/**
 * WHY SDF AND NOT A PLAIN RGBA SPRITE. MapLibre tints an SDF icon with
 * `icon-color`, so the marks take the recency ramp from the same expression the
 * dots use. A plain sprite would carry its own baked colour and would fall out
 * of step with the ramp the moment the window changed.
 */

/**
 * How far the wedge reaches from the cell, in SCREEN pixels.
 *
 * Screen pixels, not metres, is the whole point. A polygon in map coordinates
 * would grow and shrink with zoom and would therefore assert a distance to the
 * drone, which the data does not contain. An icon cannot do that.
 */
export const WEDGE_LENGTH_PX = 24;

/**
 * Radius of the halo disc as drawn into the icon, in screen pixels.
 *
 * This is the icon's own size, at `icon-size` 1. It is the halo for the LARGEST
 * dot the radius ramp can draw; smaller dots scale the icon down so the halo
 * keeps a constant gap around its dot. See HALO_GAP_PX.
 */
export const HALO_RADIUS_PX = 19;

/**
 * The gap between a dot's edge and its halo, in screen pixels.
 *
 * A CONSTANT GAP, NOT A CONSTANT RADIUS. A fixed 19 px halo on a 4 px dot is
 * five times the dot's area of ink for a mark that only means "no direction",
 * and at the Europe frame the halos of neighbouring cells merged into one
 * blob. Scaling with the dot keeps the halo attached to what it qualifies.
 *
 * This is not a second magnitude scale: the halo carries no reading of its own,
 * it just follows the dot the reader is already sizing by eye.
 */
export const HALO_GAP_PX = 5;

/** Pixels of margin around the shape, so the distance field has room to fall off. */
const PAD_PX = 4;

/**
 * Pixels of signed distance the 8-bit alpha channel spans.
 *
 * MapLibre's SDF shader thresholds the alpha channel at 192/255 and applies a
 * smoothstep of roughly one pixel around it, so the edge must land on 192 and
 * one pixel of distance must be worth 255/SDF_SPREAD_PX alpha levels. Getting
 * this wrong does not error; it renders a blurred smear or a hard jagged edge.
 */
const SDF_SPREAD_PX = 8;
const SDF_EDGE_BYTE = 192;

/** The quantization step of the drawn half-angle, in degrees. */
export const HALF_ANGLE_STEP_DEG = 6;

export const HALO_ICON_ID = "mark-halo";

/**
 * The half-angles that get their own icon.
 *
 * A symbol layer picks one image per feature; it cannot interpolate a shape.
 * So the continuous half-angle from `directionOf` is quantized, and 6 degrees
 * is below what a reader can tell apart on a 24 px wedge.
 */
export const HALF_ANGLE_BUCKETS = (() => {
  const buckets = [];
  for (let a = MIN_HALF_ANGLE_DEG; a <= MAX_HALF_ANGLE_DEG; a += HALF_ANGLE_STEP_DEG) {
    buckets.push(a);
  }
  // The clamp ceiling is not on the step grid, and a wedge that reached it
  // would otherwise be drawn narrower than it is.
  if (buckets[buckets.length - 1] !== MAX_HALF_ANGLE_DEG) buckets.push(MAX_HALF_ANGLE_DEG);
  return buckets;
})();

export function wedgeIconId(halfAngleDeg) {
  return `mark-wedge-${bucketFor(halfAngleDeg)}`;
}

/** The nearest bucket at or below the angle, so a wedge is never drawn wider than measured. */
export function bucketFor(halfAngleDeg) {
  let chosen = HALF_ANGLE_BUCKETS[0];
  for (const bucket of HALF_ANGLE_BUCKETS) if (bucket <= halfAngleDeg) chosen = bucket;
  return chosen;
}

/** Signed distance in pixels, positive inside, encoded into one alpha byte. */
function encode(distancePx) {
  const byte = Math.round(SDF_EDGE_BYTE + (distancePx * 255) / SDF_SPREAD_PX);
  return Math.max(0, Math.min(255, byte));
}

/**
 * Builds an image by sampling a signed-distance function at pixel centres.
 *
 * The buffer is RGBA because that is what `addImage` expects. For an SDF image
 * MapLibre reads the alpha channel only, so the colour channels are left white
 * and `icon-color` supplies the actual colour.
 */
function rasterize(size, signedDistance) {
  const data = new Uint8ClampedArray(size * size * 4);
  const centre = size / 2;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      // Pixel centres, and y flipped so positive y is north. Both matter:
      // sampling at corners biases the shape half a pixel, and an unflipped y
      // would point every wedge due south.
      const x = col + 0.5 - centre;
      const y = centre - (row + 0.5);
      const offset = (row * size + col) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = encode(signedDistance(x, y));
    }
  }

  return { width: size, height: size, data };
}

/**
 * A filled circular sector with its apex at the icon's centre, opening north.
 *
 * The apex sits at the centre rather than at the bottom edge so that
 * `icon-rotate` turns the wedge about the cell it belongs to. Anchored at the
 * bottom instead, rotation would swing the whole mark around the dot like a
 * clock hand.
 *
 * The distance function is the standard analytic sector distance: the shape is
 * the intersection of a disc and a symmetric angular sector, so the distance is
 * the larger of the two, negated here to make inside positive.
 */
export function wedgeIcon(halfAngleDeg, lengthPx = WEDGE_LENGTH_PX) {
  const size = 2 * (lengthPx + PAD_PX);
  const half = (halfAngleDeg * Math.PI) / 180;
  const sinHalf = Math.sin(half);
  const cosHalf = Math.cos(half);

  return rasterize(size, (x, y) => {
    // Mirrored about the axis, so only one edge has to be considered.
    const px = Math.abs(x);
    const outsideArc = Math.hypot(px, y) - lengthPx;

    // Distance to the straight edge, as the distance to the segment from the
    // apex along the edge direction, clamped to the wedge's length.
    const along = Math.max(0, Math.min(lengthPx, px * sinHalf + y * cosHalf));
    const edgeDistance = Math.hypot(px - sinHalf * along, y - cosHalf * along);
    // Sign flips across the edge: negative when the point is inside the sector.
    const side = Math.sign(cosHalf * px - sinHalf * y);
    const outsideEdge = edgeDistance * side;

    return -Math.max(outsideArc, outsideEdge);
  });
}

/**
 * A filled disc, drawn beneath the dot at low opacity.
 *
 * A disc rather than a ring: the halo means "reports disagree about direction",
 * which is an absence of a heading, and a shape with no orientation is the only
 * honest way to say that.
 */
export function haloIcon(radiusPx = HALO_RADIUS_PX) {
  const size = 2 * (radiusPx + PAD_PX);
  return rasterize(size, (x, y) => radiusPx - Math.hypot(x, y));
}

export const INCIDENT_ICON_ID = "incident-diamond";

/**
 * Half-diagonal of the incident diamond at icon-size 1, in screen pixels.
 * Sized so a scraped event never reads as a live observation: live reports
 * are circles, documented incidents are diamonds, on both of the site's
 * maps.
 */
export const INCIDENT_DIAMOND_PX = 6;

/**
 * A filled diamond: the L1 ball, so the signed distance is
 * (|x| + |y| - r) / sqrt(2), negated to make inside positive.
 */
export function diamondIcon(halfDiagPx = INCIDENT_DIAMOND_PX) {
  const size = 2 * (halfDiagPx + PAD_PX);
  return rasterize(size, (x, y) => (halfDiagPx - (Math.abs(x) + Math.abs(y))) * Math.SQRT1_2);
}

/** Every icon a symbol layer can name, ready for `addImage`. */
export function markIcons() {
  return [
    { id: HALO_ICON_ID, image: haloIcon() },
    { id: INCIDENT_ICON_ID, image: diamondIcon() },
    ...HALF_ANGLE_BUCKETS.map((angle) => ({
      id: wedgeIconId(angle),
      image: wedgeIcon(angle),
    })),
  ];
}

/* ------------------------------------------------------------------ */
/* Style                                                               */
/* ------------------------------------------------------------------ */

/**
 * Free, keyless, commercially usable dark vector basemap. If OpenFreeMap ever
 * degrades, the replacement is a Protomaps pmtiles extract on R2 and this
 * constant is the only line that changes.
 */
export const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/** [[west, south], [east, north]] */
export const EUROPE_BOUNDS = [
  [-12, 34],
  [33, 63],
];

export const CELL_SOURCE_ID = "cells";
export const CELL_LAYER_ID = "cell-dots";
export const MARK_LAYER_ID = "cell-marks";

export const INCIDENT_SOURCE_ID = "incidents";
export const INCIDENT_LAYER_ID = "incident-dots";
export const INCIDENT_GLOW_LAYER_ID = "incident-glow";

/**
 * Basemap layers hidden beneath the data, applied with
 * `setLayoutProperty(id, "visibility", "none")`.
 *
 * 25 of the style's 46 non-background layers; 21 remain. Settled in the
 * basemap bench against real tiles, design spec section 5.3a.
 *
 * Three of these are deliberate rather than obvious. ROAD NAMES GO BUT ROADS
 * STAY, so streets read as texture and never as labels competing with amber.
 * AIRPORTS STAY IN FULL, because an airport is the setting for the incursions
 * this map exists to show. BORDERS GO ENTIRELY, YET COUNTRIES STAY NAMED: the
 * kept country layers cap at zoom 8, so the Europe-framed view is anchored by
 * coastline and country names with no drawn boundary.
 *
 * `place_country_other` is the country class carrying no `iso_a2` code, that
 * is, unrecognised and disputed territories. This surface does not name them.
 */
export const HIDDEN_BASEMAP_LAYERS = [
  // Administrative boundaries, all of them.
  "boundary_state",
  "boundary_country_z0-4",
  "boundary_country_z5-",
  // Rivers, canals, and the names of water bodies. The bodies themselves stay.
  "waterway",
  "water_name",
  // Place labels below city level, plus unrecognised territories.
  "place_other",
  "place_suburb",
  "place_village",
  "place_town",
  "place_state",
  "place_country_other",
  // Road names. The roads themselves stay.
  "highway_name_other",
  "highway_name_motorway",
  // Railways, all of them.
  "railway_transit",
  "railway_transit_dashline",
  "railway_minor",
  "railway_minor_dashline",
  "railway",
  "railway_dashline",
  // Buildings and land cover.
  "building",
  "landcover_ice_shelf",
  "landcover_glacier",
  "landuse_residential",
  "landcover_wood",
  "landuse_park",
];

/**
 * Reads the palette from the page's CSS custom properties, which are the
 * single origin for every colour on this surface.
 *
 * Colours are passed IN to the layer builders rather than imported, so the
 * rest of this module stays pure and testable while the stylesheet remains the
 * only place a hex literal lives.
 */
export function readPalette(root = document.documentElement) {
  const styles = getComputedStyle(root);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;

  // Fallbacks matter: a stylesheet that has not loaded yet would otherwise
  // yield empty strings and an invalid paint expression.
  return {
    amber: read("--map-amber", "#E8A33D"),
    amberDim: read("--map-amber-dim", "#8a6b3a"),
    background: read("--map-bg", "#0A0907"),
  };
}

/**
 * Clustering: sparse beta data must read as a few clear markers at the
 * Europe frame, not scattered single pixels. Cluster properties aggregate
 * honestly: sum_count sums REPORT counts (never a count of cells) and
 * min_age_h takes the newest member's age so the cluster earns the same
 * recency ramp its freshest report would.
 */
export const CLUSTER_MAX_ZOOM = 8;
export const CLUSTER_RADIUS_PX = 40;
export const CLUSTER_LAYER_ID = "cell-clusters";
export const CLUSTER_COUNT_LAYER_ID = "cell-cluster-counts";

export const CELL_SOURCE_OPTIONS = {
  type: "geojson",
  cluster: true,
  clusterMaxZoom: CLUSTER_MAX_ZOOM,
  clusterRadius: CLUSTER_RADIUS_PX,
  clusterProperties: {
    sum_count: ["+", ["get", "count"]],
    min_age_h: ["min", ["get", "age_h"]],
  },
};

/**
 * Recency is two tones, not a ramp: bright amber under RECENT_HOURS, dim
 * past it. A step reads at a glance and needs no on-screen scale; the
 * continuous window-rescaled ramp it replaced needed a legend to be honest.
 * Age is measured against the snapshot's own generated_at, so the boundary
 * is a statement about the data, not the reader's clock.
 */
export const RECENT_HOURS = 24;

export function recencyColour(palette) {
  return ["step", ["get", "age_h"], palette.amber, RECENT_HOURS, palette.amberDim];
}

/** The dots' two tones keyed on the cluster's freshest member. */
export function clusterRecencyColour(palette) {
  return ["step", ["get", "min_age_h"], palette.amber, RECENT_HOURS, palette.amberDim];
}

export function cellCirclePaint(palette) {
  return {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["get", "count"],
      COUNT_AT_MIN_RADIUS,
      RADIUS_MIN_PX,
      COUNT_AT_MAX_RADIUS,
      RADIUS_MAX_PX,
    ],
    "circle-color": recencyColour(palette),
    "circle-opacity": 0.85,
    "circle-blur": 0.2,
    // Visibility floor: a hairline amber rim keeps old (dim-filled) dots
    // findable against the near-black basemap without reheating their fill.
    "circle-stroke-width": 1,
    "circle-stroke-color": palette.amber,
    "circle-stroke-opacity": 0.35,
  };
}

export function clusterLayer(palette) {
  return {
    id: CLUSTER_LAYER_ID,
    type: "circle",
    source: CELL_SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "sum_count"], 2, 10, 50, 16, 500, 24],
      "circle-color": clusterRecencyColour(palette),
      "circle-opacity": 0.85,
      "circle-blur": 0.2,
      "circle-stroke-width": 1,
      "circle-stroke-color": palette.amber,
      "circle-stroke-opacity": 0.35,
    },
  };
}

export function clusterCountLayer(palette) {
  return {
    id: CLUSTER_COUNT_LAYER_ID,
    type: "symbol",
    source: CELL_SOURCE_ID,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["to-string", ["get", "sum_count"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-allow-overlap": true,
    },
    paint: { "text-color": palette.background },
  };
}

/**
 * The curated incidents: DIAMONDS, so a scraped event can never be misread
 * as a live observation from the backend, which is always a circle (dot or
 * cluster). User decision 2026-09-02, superseding the mirrored dots from
 * earlier the same day; the product page's threat map draws the same
 * diamond. The soft glow underneath stays circular: it is light, and light
 * spreads round. An airport closure draws a touch larger than the rest,
 * carrying over the threat map's 4:3 size split.
 */
const INCIDENT_ICON_SIZE = ["case", ["==", ["get", "category"], "airport-closure"], 1, 0.8];

export function curatedGlowLayer(palette) {
  return {
    id: INCIDENT_GLOW_LAYER_ID,
    type: "circle",
    source: INCIDENT_SOURCE_ID,
    paint: {
      "circle-radius": ["case", ["==", ["get", "category"], "airport-closure"], 9, 8],
      "circle-color": palette.amber,
      "circle-blur": 1,
      "circle-opacity": 0.55,
    },
  };
}

export function curatedDotLayer(palette) {
  return {
    id: INCIDENT_LAYER_ID,
    type: "symbol",
    source: INCIDENT_SOURCE_ID,
    layout: {
      "icon-image": INCIDENT_ICON_ID,
      "icon-size": INCIDENT_ICON_SIZE,
      // Symbol layers cull colliding icons by default; a dense incident
      // corridor must not silently lose events.
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": palette.amber,
      "icon-opacity": 1,
    },
  };
}

/**
 * The radar ping: one expanding, fading ring under each incident whose
 * `fresh` flag is set (event date under seven days old, curated.js). A ring
 * rather than a disc so it never reads as a bigger, brighter incident; a
 * stroke at falling opacity is the same figure a radar scope draws.
 *
 * This is the ONE layer whose paint moves after addLayer. app.js drives it
 * through applyPing on a requestAnimationFrame loop that runs only while a
 * fresh incident exists; every other layer's paint is static.
 */
export const INCIDENT_PING_LAYER_ID = "incident-ping";
/** Starts at the diamond's half-diagonal and grows to six times it. */
export const PING_MIN_PX = INCIDENT_DIAMOND_PX;
export const PING_MAX_PX = 6 * INCIDENT_DIAMOND_PX;
export const PING_OPACITY = 0.6;
export const PING_PERIOD_MS = 2400;

/** Paint for a phase in [0, 1]: radius eases out, opacity falls to zero. */
export function pingPaint(phase) {
  const p = Math.min(1, Math.max(0, phase));
  const eased = 1 - (1 - p) * (1 - p);
  return {
    "circle-radius": PING_MIN_PX + (PING_MAX_PX - PING_MIN_PX) * eased,
    "circle-stroke-opacity": PING_OPACITY * (1 - p),
  };
}

export function pingLayer(palette) {
  return {
    id: INCIDENT_PING_LAYER_ID,
    type: "circle",
    source: INCIDENT_SOURCE_ID,
    filter: ["==", ["get", "fresh"], true],
    paint: {
      ...pingPaint(0),
      "circle-color": palette.amber,
      "circle-opacity": 0,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": palette.amber,
    },
  };
}

/** Opacity of the marks. Low: they qualify the dot, they do not compete with it. */
export const WEDGE_OPACITY = 0.22;
export const HALO_OPACITY = 0.16;

/**
 * Which icon each feature draws.
 *
 * A `step` expression over the quantized half-angle, because a symbol layer
 * picks one image per feature and cannot interpolate a shape. Halos take the
 * one unrotated image.
 */
export function markIconExpression() {
  const steps = ["step", ["get", "half_angle"], wedgeIconId(HALF_ANGLE_BUCKETS[0])];
  for (const angle of HALF_ANGLE_BUCKETS.slice(1)) steps.push(angle, wedgeIconId(angle));

  return ["case", ["==", ["get", "mark"], "halo"], HALO_ICON_ID, steps];
}

/**
 * Below this zoom the marks are not drawn at all.
 *
 * At the Europe frame the cells sit a few pixels apart while a mark is tens of
 * pixels wide, so every mark overlaps its neighbours and the cluster reads as
 * one blob. That is worse than no mark: it hides the dots, which are the part
 * that is actually true at this scale.
 *
 * So the map answers one question per zoom. Wide: where reports come from.
 * Closer: which way people were looking.
 */
export const MARK_MIN_ZOOM = 7;

/**
 * Halo size, scaled so the disc keeps a constant gap around its dot.
 *
 * The icon is drawn for the largest dot the ramp produces, and this shrinks it
 * for smaller ones. Wedges are never scaled: their length is fixed in screen
 * pixels, and scaling it by count would make a wedge's REACH look like a
 * measurement of distance.
 */
export function markIconSize() {
  return [
    "case",
    ["==", ["get", "mark"], "halo"],
    [
      "interpolate",
      ["linear"],
      ["get", "count"],
      COUNT_AT_MIN_RADIUS,
      (RADIUS_MIN_PX + HALO_GAP_PX) / HALO_RADIUS_PX,
      COUNT_AT_MAX_RADIUS,
      (RADIUS_MAX_PX + HALO_GAP_PX) / HALO_RADIUS_PX,
    ],
    1,
  ];
}

/**
 * The direction marks: ONE SYMBOL LAYER, NEVER POLYGONS.
 *
 * This is structural, not a style preference. A polygon is drawn in map
 * coordinates and is therefore metric: it would grow with zoom and assert a
 * distance to the drone that the data does not contain. A symbol icon is sized
 * in screen pixels, so no later change can quietly make the mark metric.
 *
 * `icon-allow-overlap` and `icon-ignore-placement` are both required. Symbol
 * layers cull colliding labels by default, which would silently delete marks
 * from exactly the dense areas the map exists to show.
 */
export function markLayer(palette) {
  return {
    id: MARK_LAYER_ID,
    type: "symbol",
    source: CELL_SOURCE_ID,
    minzoom: MARK_MIN_ZOOM,
    // Cells with no direction carry no mark at all. There is no third glyph
    // for "unknown": an absent mark already says it, and 40% of features are
    // single-report, so a glyph would cover the map in noise. Clusters are
    // excluded too: an aggregate has no bearing of its own.
    filter: ["all", ["!", ["has", "point_count"]], ["!=", ["get", "mark"], "none"]],
    layout: {
      "icon-image": markIconExpression(),
      "icon-size": markIconSize(),
      "icon-rotate": ["get", "bearing"],
      // Bearings are compass degrees clockwise from north, which is what the
      // map rotates by. "viewport" would leave the mark pointing at the screen.
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      // Same two tones as the dots, which is the reason the icons are SDF.
      "icon-color": recencyColour(palette),
      "icon-opacity": ["case", ["==", ["get", "mark"], "halo"], HALO_OPACITY, WEDGE_OPACITY],
    },
  };
}

/**
 * Minimal style used when the basemap cannot be reached.
 *
 * Spec section 5.4: basemap failure is not data failure. The basemap is
 * decoration, the footprint is the product, so a style error swaps in a bare
 * background and the dots still render on top.
 *
 * The glyph endpoint stays so cluster count labels can render over the bare
 * background. If that host is down too, the labels drop and the map lives.
 */
export function fallbackStyle(palette) {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": palette.background } }],
  };
}
