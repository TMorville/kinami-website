# Threat intake and radar ping — design

Date: 2026-09-03. Status: approved in chat, implemented in the same PR.

## 1. Purpose

Two things. First, a structured daily procedure for finding new European drone
incidents and adding them to `dronereporter/assets/threat-data.json`, replacing
hand edits that have already let the deck copy drift. Second, a radar ping on
both site maps for incidents whose event date is under 7 days old.

The ping is only honest if the intake runs often. Tobias runs the intake daily,
so a 7-day window matches the cadence.

## 2. Data contract

The row schema is unchanged. The script enforces the conventions the file already
follows informally:

- `id` is `<country>-<place>-<yyyy>-<mm>`, lowercase, unique.
- `date` is `YYYY-MM-DD`, not in the future.
- `category` is one of `airport-closure`, `infrastructure`, `military-site`, `sighting`.
- `source` is an `https://` URL.
- `lat`/`lng` fall inside a generous Europe box (lon -25..45, lat 34..72).
- `label`, `country`, `description` are non-empty strings.
- Rows are sorted by `date`, then `id`.
- `updated` is `YYYY-MM-DD` and is set to the run date on every add.
- `stats` are not touched by intake. The skill may flag a stale stat; a human edits it.

## 3. Script: `scripts/threat-data.mjs`

Pure functions exported for tests, plus a CLI:

- `validate` loads the site copy and prints every violation, exit 1 on any.
- `add <candidates.json> [--allow-near]` validates candidates, rejects any within
  25 km and 3 days of an existing row unless `--allow-near`, appends, sorts,
  sets `updated`, writes the site copy, then runs `sync`.
- `sync` copies `threat-data.json` and `threat-map.js` from
  `dronereporter/assets/` to `dronereporter/deck/assets/`.

`scripts/threat-intake/rejected.json` records candidates Tobias declined
(`id`, `date`, `source`, `reason`) so a daily run does not re-propose them.
It sits outside `dronereporter/` so neither host serves it.

## 4. Skill: `.claude/skills/threat-intake/SKILL.md`

Repo-local, not global. Steps:

1. Read `updated` and the newest rows; read `rejected.json`.
2. Check fixed sources first (grosswald.org incursion tracker, the Wikipedia
   year pages), then WebSearch per region for the window since `updated`.
3. Inclusion bar: a named site, a reputable outlet, and an official body
   (police, military, airport operator, ministry) confirmed or acted.
4. Draft candidates as JSON in the scratchpad with a one-line rationale each.
   Present them in chat.
5. On yes: `node scripts/threat-data.mjs add <file>`, run the tests, commit with
   the ids in the message. On no: append to `rejected.json` with the reason.
6. Flag any `stats` entry the new rows make stale. Do not edit it.

## 5. Radar ping

Fresh means `now - Date.parse(date) < 7 days`, wall clock at load. One pure
function `isFresh(dateIso, nowMs)` in `map/src/curated.js`, tested. The static
map is a classic-script IIFE, so it carries a copy of the same lines.

- Static canvas (`threat-map.js`): when at least one fresh incident exists, a
  `requestAnimationFrame` loop draws one expanding ring per fresh diamond
  (radius from the diamond's half-diagonal to about six times that, alpha fading
  to zero, period 2.4 s), then the land and diamonds redraw. With no fresh
  incident there is no loop; the page stays static.
- Live map: `incidentsToGeoJSON` gains a `fresh` boolean per feature. A new
  `incident-ping` circle layer filtered on `fresh` sits under the glow layer.
  `pingPaint(phase)` maps a phase in [0, 1) to `circle-radius` and
  `circle-opacity`; `applyPing(map, phase)` writes both. The rAF loop in
  `app.js` runs only while a fresh incident exists and the map is ready.
- `prefers-reduced-motion: reduce`: both maps draw one static ring at phase 0.5.
- Colour is the existing signal amber at low alpha. No new hue.

## 6. Deck copy

The deck is a staticrypt payload whose decrypted HTML loads
`assets/threat-map.js` and has a `#threat-footline` element. The site copy of
`threat-map.js` re-gains `fillFootline` (a no-op when the element is absent), so
one file serves both roots and `sync` copies it byte for byte. The deck gets the
current data, the diamonds, and the ping in the same PR.

## 7. Tests

- `tests/threat-data/`: the real file validates; each convention rejects a bad
  row; near-duplicate rejection; sorted append and `updated` bump; `sync` copies
  into a temp tree; site and deck copies are byte-identical (fails before the
  first `sync`, passes after).
- `tests/map/curated.test.js`: `isFresh` boundaries; `fresh` in the GeoJSON.
- `tests/map/layers.test.js` and `maprender.test.js`: ping layer shape, layer
  order, `pingPaint` endpoints, `applyPing` writes.
- Visual: both maps at 1440×900, 768×1024, 390×844 with a fixture dated
  yesterday, screenshots read back.

## 8. Out of scope

A visual difference for the `sighting` category. A reminder mechanism for the
daily run. Collapsing the three copies to one, which needs a change to how the
deck is served. The stale vault copy at
`20-projects/dronereporter/threat/threat-data.json` moves to `archive/` with a
pointer to the repo file.
