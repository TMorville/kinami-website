// tests/threat-data/threat-data.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SYNC_FILES,
  addIncidents,
  localDateIso,
  nearDuplicates,
  sync,
  validateData,
  validateIncident,
  writeJsonAtomic,
} from "../../scripts/threat-data.mjs";

const SITE = "dronereporter/assets";
const DECK = "dronereporter/deck/assets";

const row = (over = {}) => ({
  id: "testland-runway-2026-08",
  label: "Test Airport",
  country: "Testland",
  site: "Runway",
  lat: 55.6,
  lng: 12.5,
  date: "2026-08-20",
  category: "airport-closure",
  description: "A thing happened.",
  source: "https://example.org/a",
  ...over,
});

const data = (incidents, updated = "2026-08-31") => ({ updated, stats: [], incidents });

const TODAY = "2026-09-03";

test("the real threat-data.json has zero violations", async () => {
  const raw = JSON.parse(await readFile(`${SITE}/threat-data.json`, "utf8"));
  assert.deepEqual(validateData(raw, { today: TODAY }), []);
});

test("validateIncident accepts a well-formed row", () => {
  assert.deepEqual(validateIncident(row(), { today: TODAY }), []);
});

test("validateIncident names each broken field", () => {
  const errors = validateIncident(
    row({
      id: "Bad Id",
      date: "2026-9-3",
      category: "ufo",
      source: "http://example.org",
      lat: 10,
      lng: 100,
      label: "",
    }),
    { today: TODAY },
  );
  for (const field of ["id", "date", "category", "source", "lat", "lng", "label"]) {
    assert.ok(errors.some((e) => e.startsWith(`${field}:`)), `expected an error for ${field}, got ${errors}`);
  }
});

test("validateIncident rejects a future date", () => {
  const errors = validateIncident(row({ date: "2026-09-04" }), { today: TODAY });
  assert.ok(errors.some((e) => e.startsWith("date:")));
});

test("validateData rejects duplicate ids and unsorted rows", () => {
  const dup = validateData(data([row(), row()]), { today: TODAY });
  assert.ok(dup.some((e) => e.includes("duplicate id")));
  const unsorted = validateData(
    data([row({ id: "a-b-2026-08", date: "2026-08-21" }), row({ id: "c-d-2026-08", date: "2026-08-20" })]),
    { today: TODAY },
  );
  assert.ok(unsorted.some((e) => e.includes("sorted")));
});

test("nearDuplicates finds a row 10 km and 1 day away, not one 100 km away", () => {
  const existing = [row()];
  // ~10 km north of the fixture, one day later.
  const near = row({ id: "x-y-2026-08", lat: 55.69, date: "2026-08-21" });
  // ~100 km north.
  const far = row({ id: "x-z-2026-08", lat: 56.5, date: "2026-08-21" });
  assert.equal(nearDuplicates(near, existing).length, 1);
  assert.equal(nearDuplicates(far, existing).length, 0);
  // Same place, four days later: a different event.
  const later = row({ id: "x-w-2026-08", date: "2026-08-24" });
  assert.equal(nearDuplicates(later, existing).length, 0);
});

test("addIncidents refuses a near duplicate unless allowed", () => {
  const near = row({ id: "x-y-2026-08", lat: 55.69, date: "2026-08-21" });
  const refused = addIncidents(data([row()]), [near], { today: TODAY });
  assert.equal(refused.added.length, 0);
  assert.ok(refused.errors.some((e) => e.includes("near")));
  const allowed = addIncidents(data([row()]), [near], { today: TODAY, allowNear: true });
  assert.equal(allowed.added.length, 1);
  assert.deepEqual(allowed.errors, []);
});

test("addIncidents refuses an id that already exists", () => {
  const result = addIncidents(data([row()]), [row({ lat: 60, lng: 20 })], { today: TODAY });
  assert.equal(result.added.length, 0);
  assert.ok(result.errors.some((e) => e.includes("id")));
});

test("addIncidents appends sorted by date and sets updated to today", () => {
  const older = row({ id: "old-place-2026-07", date: "2026-07-01", lat: 60, lng: 20 });
  const result = addIncidents(data([row()]), [older], { today: TODAY });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    result.data.incidents.map((r) => r.id),
    ["old-place-2026-07", "testland-runway-2026-08"],
  );
  assert.equal(result.data.updated, TODAY);
  // The input is not mutated.
  assert.equal(result.data.incidents.length, 2);
});

test("addIncidents rejects the whole batch when any candidate is invalid", () => {
  const good = row({ id: "good-place-2026-08", lat: 60, lng: 20 });
  const bad = row({ id: "bad-place-2026-08", lat: 61, lng: 21, category: "ufo" });
  const result = addIncidents(data([row()]), [good, bad], { today: TODAY });
  assert.equal(result.added.length, 0);
  assert.equal(result.data.incidents.length, 1);
});

test("sync copies each listed file from the site tree to the deck tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "threat-sync-"));
  await mkdir(join(root, SITE), { recursive: true });
  await mkdir(join(root, DECK), { recursive: true });
  for (const name of SYNC_FILES) {
    await writeFile(join(root, SITE, name), `site ${name}`);
    await writeFile(join(root, DECK, name), `deck ${name}`);
  }
  const copied = await sync(root);
  assert.deepEqual(copied, SYNC_FILES);
  for (const name of SYNC_FILES) {
    assert.equal(await readFile(join(root, DECK, name), "utf8"), `site ${name}`);
  }
});

// ---- Codex review round, 2026-09-03 -------------------------------------------------

test("validateIncident rejects calendar-invalid dates that Date.parse would normalise", () => {
  for (const date of ["2026-02-30", "2026-04-31", "2025-02-29"]) {
    const errors = validateIncident(row({ date }), { today: TODAY });
    assert.ok(errors.some((e) => e.startsWith("date:")), `${date} should be rejected`);
  }
  assert.deepEqual(validateIncident(row({ id: "testland-runway-2024-02", date: "2024-02-29" }), { today: TODAY }), []);
});

test("validateIncident requires the id's yyyy-mm suffix to match the date", () => {
  const errors = validateIncident(row({ id: "testland-runway-2026-07", date: "2026-08-20" }), { today: TODAY });
  assert.ok(errors.some((e) => e.startsWith("id:") && e.includes("2026-08")));
});

test("addIncidents refuses two candidates that are near each other within the batch", () => {
  const a = row({ id: "x-a-2026-08", lat: 60.0, lng: 20.0, date: "2026-08-10" });
  const b = row({ id: "x-b-2026-08", lat: 60.05, lng: 20.0, date: "2026-08-11" });
  const result = addIncidents(data([row()]), [a, b], { today: TODAY });
  assert.equal(result.added.length, 0);
  assert.ok(result.errors.some((e) => e.includes("near") && e.includes("x-a-2026-08")));
});

test("validateData reports a null row instead of throwing in the sort", () => {
  let errors;
  assert.doesNotThrow(() => {
    errors = validateData(data([row(), null]), { today: TODAY });
  });
  assert.ok(errors.some((e) => e.includes("incidents[1]")));
});

test("localDateIso uses the operator's local calendar date, not UTC", () => {
  // 00:30 local on 3 September; in any zone east of UTC toISOString() says 2 September.
  assert.equal(localDateIso(new Date(2026, 8, 3, 0, 30)), "2026-09-03");
  assert.equal(localDateIso(new Date(2026, 0, 9, 23, 59)), "2026-01-09");
});

test("writeJsonAtomic writes pretty JSON with a trailing newline and leaves no temp file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "threat-atomic-"));
  const path = join(dir, "threat-data.json");
  await writeJsonAtomic(path, { a: 1 });
  assert.equal(await readFile(path, "utf8"), '{\n  "a": 1\n}\n');
  assert.deepEqual(await readdir(dir), ["threat-data.json"]);
});

test("the deck copies are byte-identical to the site copies", async () => {
  for (const name of SYNC_FILES) {
    const site = await readFile(`${SITE}/${name}`);
    const deck = await readFile(`${DECK}/${name}`);
    assert.ok(site.equals(deck), `${name} differs between site and deck; run: node scripts/threat-data.mjs sync`);
  }
});
