#!/usr/bin/env node
// scripts/threat-data.mjs
//
// The one writer of dronereporter/assets/threat-data.json. Hand edits let the
// deck copy drift for two months in 2026; this script validates every row
// against the conventions the file already follows, refuses near-duplicates,
// keeps the rows sorted, and copies the result into the deck's own document
// root, which cannot reach ../assets/.
//
//   node scripts/threat-data.mjs validate
//   node scripts/threat-data.mjs add <candidates.json> [--allow-near]
//   node scripts/threat-data.mjs sync
//
// Pure functions are exported for tests/threat-data/.

import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SITE_DIR = "dronereporter/assets";
export const DECK_DIR = "dronereporter/deck/assets";
export const DATA_FILE = "threat-data.json";
/** Files the deck holds its own copy of. threat-map.js serves both roots unchanged. */
export const SYNC_FILES = [DATA_FILE, "threat-map.js"];

export const CATEGORIES = ["airport-closure", "infrastructure", "military-site", "sighting"];
/** Generous box: Iceland to the Urals, Cyprus to Svalbard's south coast. */
export const EUROPE = { west: -25, east: 45, south: 34, north: 72 };
/** A candidate this close in space and time to an existing row is probably the same event. */
export const NEAR_KM = 25;
export const NEAR_DAYS = 3;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

function validDate(iso) {
  return DATE_RE.test(iso) && Number.isFinite(Date.parse(iso));
}

/** Errors as "field: message". An empty array means the row is acceptable. */
export function validateIncident(row, { today }) {
  const errors = [];
  if (row === null || typeof row !== "object") return ["row: not an object"];

  if (!isNonEmptyString(row.id) || !ID_RE.test(row.id)) {
    errors.push(`id: expected <country>-<place>-<yyyy>-<mm> in lowercase, got ${JSON.stringify(row.id)}`);
  }
  for (const field of ["label", "country", "description"]) {
    if (!isNonEmptyString(row[field])) errors.push(`${field}: required, non-empty string`);
  }
  if (!validDate(row.date)) {
    errors.push(`date: expected YYYY-MM-DD, got ${JSON.stringify(row.date)}`);
  } else if (Date.parse(row.date) > Date.parse(today)) {
    errors.push(`date: ${row.date} is after today (${today})`);
  }
  if (!CATEGORIES.includes(row.category)) {
    errors.push(`category: expected one of ${CATEGORIES.join(", ")}, got ${JSON.stringify(row.category)}`);
  }
  if (typeof row.source !== "string" || !/^https:\/\/\S+$/.test(row.source)) {
    errors.push(`source: expected an https:// URL, got ${JSON.stringify(row.source)}`);
  }
  if (!Number.isFinite(row.lat) || row.lat < EUROPE.south || row.lat > EUROPE.north) {
    errors.push(`lat: expected ${EUROPE.south}..${EUROPE.north}, got ${JSON.stringify(row.lat)}`);
  }
  if (!Number.isFinite(row.lng) || row.lng < EUROPE.west || row.lng > EUROPE.east) {
    errors.push(`lng: expected ${EUROPE.west}..${EUROPE.east}, got ${JSON.stringify(row.lng)}`);
  }
  return errors;
}

/** Whole-file checks: every row, unique ids, sort order, the updated stamp. */
export function validateData(data, { today }) {
  const errors = [];
  if (data === null || typeof data !== "object") return ["file: not an object"];
  if (!validDate(data.updated)) errors.push(`updated: expected YYYY-MM-DD, got ${JSON.stringify(data.updated)}`);
  if (!Array.isArray(data.stats)) errors.push("stats: expected an array");
  if (!Array.isArray(data.incidents)) return [...errors, "incidents: expected an array"];

  const seen = new Set();
  data.incidents.forEach((row, i) => {
    const prefix = `incidents[${i}]${row && row.id ? ` (${row.id})` : ""}`;
    for (const e of validateIncident(row, { today })) errors.push(`${prefix} ${e}`);
    if (row && typeof row.id === "string") {
      if (seen.has(row.id)) errors.push(`${prefix} duplicate id`);
      seen.add(row.id);
    }
  });

  const sorted = sortIncidents(data.incidents);
  if (data.incidents.some((row, i) => row !== sorted[i])) {
    errors.push("incidents: rows must be sorted by date, then id");
  }
  return errors;
}

/** Sorted copy: by date, then id, so a re-run writes the same bytes. */
export function sortIncidents(rows) {
  return [...rows].sort((a, b) => {
    const byDate = String(a.date).localeCompare(String(b.date));
    return byDate !== 0 ? byDate : String(a.id).localeCompare(String(b.id));
  });
}

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Existing rows within NEAR_KM and NEAR_DAYS of the candidate. */
export function nearDuplicates(candidate, existing, { km = NEAR_KM, days = NEAR_DAYS } = {}) {
  const t = Date.parse(candidate.date);
  return existing.filter((row) => {
    const dt = Math.abs(Date.parse(row.date) - t);
    return dt <= days * DAY_MS && haversineKm(candidate, row) <= km;
  });
}

/**
 * Pure append. Either every candidate lands or none does: a batch with one
 * bad row returns the input data unchanged, so a half-applied add cannot
 * reach the file.
 */
export function addIncidents(data, candidates, { today, allowNear = false }) {
  const errors = [];
  const existingIds = new Set(data.incidents.map((r) => r.id));
  const batchIds = new Set();

  candidates.forEach((row, i) => {
    const prefix = `candidates[${i}]${row && row.id ? ` (${row.id})` : ""}`;
    for (const e of validateIncident(row, { today })) errors.push(`${prefix} ${e}`);
    if (!row || typeof row.id !== "string") return;
    if (existingIds.has(row.id)) errors.push(`${prefix} id already exists`);
    if (batchIds.has(row.id)) errors.push(`${prefix} id repeated in the batch`);
    batchIds.add(row.id);
    if (!allowNear && Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
      const near = nearDuplicates(row, data.incidents);
      if (near.length > 0) {
        errors.push(
          `${prefix} near existing ${near.map((n) => n.id).join(", ")} ` +
            `(within ${NEAR_KM} km and ${NEAR_DAYS} days); pass --allow-near if it is a distinct event`,
        );
      }
    }
  });

  if (errors.length > 0) return { data, added: [], errors };
  return {
    data: { ...data, updated: today, incidents: sortIncidents([...data.incidents, ...candidates]) },
    added: candidates.map((r) => r.id),
    errors: [],
  };
}

/** Copy the site copies over the deck copies. Returns the file names copied. */
export async function sync(root) {
  for (const name of SYNC_FILES) {
    await copyFile(join(root, SITE_DIR, name), join(root, DECK_DIR, name));
  }
  return [...SYNC_FILES];
}

// ---- CLI ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function readData(root) {
  return JSON.parse(await readFile(join(root, SITE_DIR, DATA_FILE), "utf8"));
}

async function writeData(root, data) {
  await writeFile(join(root, SITE_DIR, DATA_FILE), `${JSON.stringify(data, null, 2)}\n`);
}

function fail(lines) {
  for (const line of lines) console.error(`  ${line}`);
  process.exit(1);
}

async function main(argv) {
  const [command, ...rest] = argv;
  const today = todayIso();

  if (command === "validate") {
    const errors = validateData(await readData(REPO_ROOT), { today });
    if (errors.length > 0) {
      console.error(`${DATA_FILE}: ${errors.length} violation(s)`);
      fail(errors);
    }
    console.log(`${DATA_FILE}: ok`);
    return;
  }

  if (command === "add") {
    const file = rest.find((a) => !a.startsWith("--"));
    if (!file) fail(["usage: add <candidates.json> [--allow-near]"]);
    const allowNear = rest.includes("--allow-near");
    const raw = JSON.parse(await readFile(resolve(file), "utf8"));
    const candidates = Array.isArray(raw) ? raw : Array.isArray(raw?.incidents) ? raw.incidents : null;
    if (!candidates) fail([`${file}: expected an array of rows or { incidents: [...] }`]);

    const data = await readData(REPO_ROOT);
    const before = validateData(data, { today });
    if (before.length > 0) {
      console.error(`${DATA_FILE} is already invalid; fix it before adding:`);
      fail(before);
    }
    const result = addIncidents(data, candidates, { today, allowNear });
    if (result.errors.length > 0) {
      console.error("nothing written:");
      fail(result.errors);
    }
    await writeData(REPO_ROOT, result.data);
    const copied = await sync(REPO_ROOT);
    console.log(`added ${result.added.length}: ${result.added.join(", ")}`);
    console.log(`updated -> ${today}; synced ${copied.join(", ")} to ${DECK_DIR}`);
    return;
  }

  if (command === "sync") {
    const copied = await sync(REPO_ROOT);
    console.log(`synced ${copied.join(", ")} to ${DECK_DIR}`);
    return;
  }

  fail(["usage: threat-data.mjs validate | add <candidates.json> [--allow-near] | sync"]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => fail([error.message]));
}
