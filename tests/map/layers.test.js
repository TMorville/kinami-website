import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELL_SOURCE_OPTIONS,
  HALF_ANGLE_BUCKETS,
  HALO_ICON_ID,
  bucketFor,
  cellCirclePaint,
  clusterCountLayer,
  clusterLayer,
  curatedRingLayer,
  fallbackStyle,
  haloIcon,
  markIconExpression,
  markIcons,
  markLayer,
  recencyColour,
  wedgeIcon,
  wedgeIconId,
} from "../../dronereporter/map/src/layers.js";
import { MAX_HALF_ANGLE_DEG, MIN_HALF_ANGLE_DEG } from "../../dronereporter/map/src/cells.js";

const palette = { amber: "#E8A33D", amberDim: "#4a3a22", background: "#0A0907" };

test("bucket grid covers the clamp range and never widens a wedge", () => {
  assert.equal(HALF_ANGLE_BUCKETS[0], MIN_HALF_ANGLE_DEG);
  assert.equal(HALF_ANGLE_BUCKETS.at(-1), MAX_HALF_ANGLE_DEG);
  assert.equal(bucketFor(13.9), 8);
  assert.equal(bucketFor(14), 14);
  assert.equal(bucketFor(MAX_HALF_ANGLE_DEG), MAX_HALF_ANGLE_DEG);
});

test("ramp stops stay strictly increasing in the paint expression", () => {
  const colour = recencyColour(palette, { fullHours: 1, baseHours: 1 });
  const stops = colour.slice(3); // [input, colour, input, colour, input, colour]
  assert.ok(stops[2] < stops[4], "interpolate inputs must strictly increase");
});

test("icons are RGBA buffers with white colour channels (SDF)", () => {
  for (const { image } of markIcons()) {
    assert.equal(image.data.length, image.width * image.height * 4);
    assert.equal(image.data[0], 255);
  }
  // The halo's centre pixel is deep inside the disc: alpha near max.
  const halo = haloIcon();
  const centre = ((halo.width / 2) * halo.width + halo.width / 2) * 4 + 3;
  assert.ok(halo.data[centre] > 240);
});

test("a narrow wedge covers fewer pixels than a wide one", () => {
  const inked = (image) => {
    let n = 0;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] >= 192) n += 1;
    return n;
  };
  assert.ok(inked(wedgeIcon(8)) < inked(wedgeIcon(44)));
});

test("mark layer filters out 'none' and clusters, never culls overlapping icons", () => {
  const layer = markLayer(palette, { fullHours: 24, baseHours: 168 });
  assert.deepEqual(layer.filter, [
    "all",
    ["!", ["has", "point_count"]],
    ["!=", ["get", "mark"], "none"],
  ]);
  assert.equal(layer.layout["icon-allow-overlap"], true);
  assert.equal(layer.layout["icon-ignore-placement"], true);
  assert.equal(layer.layout["icon-rotation-alignment"], "map");
});

test("mark icon expression names the halo and every wedge bucket", () => {
  const expr = JSON.stringify(markIconExpression());
  assert.ok(expr.includes(HALO_ICON_ID));
  for (const angle of HALF_ANGLE_BUCKETS) assert.ok(expr.includes(wedgeIconId(angle)));
});

test("curated ring is hollow and the fallback style is a bare background", () => {
  const ring = curatedRingLayer(palette);
  assert.equal(ring.paint["circle-color"], "rgba(0, 0, 0, 0)");
  assert.equal(ring.paint["circle-stroke-color"], palette.amber);
  const style = fallbackStyle(palette);
  assert.equal(style.layers.length, 1);
  assert.equal(style.layers[0].type, "background");
});

test("dot radius ramps count 1 to 50 into 4 to 14 px", () => {
  const paint = cellCirclePaint(palette, { fullHours: 24, baseHours: 168 });
  assert.deepEqual(paint["circle-radius"].slice(3), [1, 4, 50, 14]);
});

test("clusters aggregate report counts and freshest age, and never draw marks", () => {
  assert.deepEqual(CELL_SOURCE_OPTIONS.clusterProperties.sum_count, ["+", ["get", "count"]]);
  assert.deepEqual(CELL_SOURCE_OPTIONS.clusterProperties.min_age_h, ["min", ["get", "age_h"]]);
  const cluster = clusterLayer(palette, { fullHours: 24, baseHours: 168 });
  assert.deepEqual(cluster.filter, ["has", "point_count"]);
  const marks = markLayer(palette, { fullHours: 24, baseHours: 168 });
  assert.deepEqual(marks.filter[1], ["!", ["has", "point_count"]]);
  const counts = clusterCountLayer(palette);
  assert.deepEqual(counts.filter, ["has", "point_count"]);
  assert.ok(fallbackStyle(palette).glyphs);
});
