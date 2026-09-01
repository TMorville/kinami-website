// tests/map/curated.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  incidentsToGeoJSON,
  oldestYear,
  parseIncidents,
  popupHtml,
} from "../../dronereporter/map/src/curated.js";

const incident = (over = {}) => ({
  id: "x-1",
  label: "Test Airport",
  country: "Testland",
  site: "Runway",
  lat: 55.6,
  lng: 12.5,
  date: "2025-09-24",
  category: "airport-closure",
  description: "A thing happened.",
  source: "https://example.org/a",
  ...over,
});

test("valid incidents pass through; broken rows are dropped, not thrown", () => {
  const { incidents, dropped } = parseIncidents({
    incidents: [incident(), incident({ lat: "north" }), incident({ label: "" }), incident({ lng: 200 })],
  });
  assert.equal(incidents.length, 1);
  assert.equal(dropped, 3);
});

test("the real threat-data.json parses with zero drops", async () => {
  const raw = JSON.parse(await readFile("dronereporter/assets/threat-data.json", "utf8"));
  const { incidents, dropped } = parseIncidents(raw);
  assert.equal(dropped, 0);
  assert.ok(incidents.length >= 40);
});

test("GeoJSON projection carries the popup fields", () => {
  const geo = incidentsToGeoJSON([incident()]);
  assert.deepEqual(geo.features[0].geometry.coordinates, [12.5, 55.6]);
  assert.equal(geo.features[0].properties.label, "Test Airport");
  assert.equal(geo.features[0].properties.date, "2025-09-24");
});

test("popup HTML is escaped and links the source", () => {
  const html = popupHtml(incident({ label: `<b>Sneak</b>`, description: `a & b` }));
  assert.ok(html.includes("&lt;b&gt;Sneak&lt;/b&gt;"));
  assert.ok(html.includes("a &amp; b"));
  assert.ok(html.includes('href="https://example.org/a"'));
  assert.ok(html.includes('rel="noopener"'));
});

test("popup omits the source link when the URL is not http(s)", () => {
  const html = popupHtml(incident({ source: "javascript:alert(1)" }));
  assert.ok(!html.includes("javascript:"));
});

test("oldestYear reads the earliest incident date", () => {
  assert.equal(oldestYear([incident({ date: "2018-12-19" }), incident()]), 2018);
});
