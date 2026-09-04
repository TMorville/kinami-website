---
name: threat-intake
description: Daily search for new European drone incidents and structured addition to the dronereporter threat map (dronereporter/assets/threat-data.json). Use when asked to find, check for, or add drone incidents, observations, incursions or airport closures to the threat map.
---

# Threat intake

Find drone incidents that happened since the map was last updated, draft them as
rows, get Tobias's yes, and add them through the script. Never edit
`dronereporter/assets/threat-data.json` by hand. Run daily.

The map pings incidents whose event date is under 7 days old. That ping is only
honest when this procedure runs often, so a missed day matters.

## 1. Read the current state

```
node scripts/threat-data.mjs validate
python3 -c "import json;d=json.load(open('dronereporter/assets/threat-data.json'));print(d['updated']);[print(r['date'],r['id']) for r in d['incidents'][-10:]]"
cat scripts/threat-intake/rejected.json
```

Note `updated` (the search window starts there) and the newest ids. Anything in
`rejected.json` is not proposed again unless new facts changed the picture.

## 2. Search

Fixed sources first, then general search. Time-bound every query to the window
from `updated` to today.

1. grosswald.org, "Russian drone and missile incursions into NATO territory"
   tracker: `https://www.grosswald.org/russian-drone-and-missile-incursions-nato-territory/`
2. Wikipedia year pages and incident timelines, for example
   `2026 in aviation`, `List of drone incidents in Europe`, and any
   `<year> <airport> drone incident` article that appeared in the window.
3. WebSearch, one query per region, each with the window's month and year:
   - Nordics: Denmark, Norway, Sweden, Finland
   - Baltics and Poland
   - Germany, Netherlands, Belgium
   - Romania, Bulgaria, Moldova border
   - UK, Ireland, France
   - Southern flank: Italy, Spain, Greece
   Query shape: `drone airport closed <country> <Month YYYY>`,
   `drone sighting military base <country> <Month YYYY>`,
   `drone incursion NATO <Month YYYY>`.
4. Repeat the regional pass in the local language. English-language search
   surfaces an incident only once a wire service picks it up, which is often a
   day late and sometimes never. The national broadcaster and the defence
   ministry publish first, in their own language, and that is where the
   coordinate, the timeline and the official quote live. Run at least the
   country whose border the war is nearest, and any country the English pass
   hinted at without detail.

   | Country | Query language | Words that work |
   |---|---|---|
   | Finland | Finnish | `drooni`, `alueloukkaus`, `Puolustusvoimat`, `Rajavartiolaitos` |
   | Sweden | Swedish | `drönare`, `flygplats stängd`, `Försvarsmakten` |
   | Norway | Norwegian | `drone`, `flyplass stengt`, `Forsvaret` |
   | Denmark | Danish | `drone`, `lufthavn lukket`, `Forsvaret` |
   | Estonia | Estonian | `droon`, `õhuruum`, `Kaitsevägi` |
   | Latvia | Latvian | `drons`, `gaisa telpa`, `NBS` |
   | Lithuania | Lithuanian | `dronas`, `oro erdvė`, `kariuomenė` |
   | Poland | Polish | `dron`, `przestrzeń powietrzna`, `wojsko` |
   | Romania | Romanian | `dronă`, `spațiul aerian`, `MApN` |
   | Bulgaria | Bulgarian | `дрон`, `въздушно пространство` |
   | Moldova | Romanian or Russian | `dronă`, `беспилотник`, `Ministerul Apărării` |
   | Germany | German | `Drohne`, `Flughafen gesperrt`, `Bundeswehr` |
   | Netherlands | Dutch | `drone`, `luchthaven gesloten`, `vliegbasis` |
   | France | French | `drone`, `aéroport fermé`, `survol base militaire` |

   Add the month and year in the local form too. A hit in the local language
   still needs an English or official source for the `source` field where one
   exists, but the local report is usually the better `source` when it is the
   national broadcaster or the ministry.

Read the primary report where the search hit is a summary. Prefer national
outlets, wire services, the operator or ministry statement, and Wikipedia
articles that cite them.

Some official sites reject automated fetches with 403 (globalsecurity.org,
lsm.lv's Latvian edition, balkaninsight.com). Reach the same story through the
outlet's English edition, the government's own release page, or another outlet
carrying the statement, rather than dropping a real incident for a fetch error.

## 3. Inclusion bar

A candidate needs all three:

1. A named site (an airport, base, plant, field, port, town) that gives a
   coordinate to within a few kilometres.
2. A reputable outlet or an official statement as the `source` URL (`https://`).
3. An official body confirmed the event or acted on it: police, military,
   airport operator, aviation authority, or a ministry. A single unconfirmed
   sighting with no official response does not qualify, even as `sighting`.

Category rule: `airport-closure` when traffic stopped or diverted;
`military-site` for bases and exercises; `infrastructure` for energy, ports,
water, telecoms and government sites; `sighting` for a confirmed observation
with no closure and no site of the other three kinds.

## 4. Draft the candidates

Write `<scratchpad>/threat-candidates-YYYY-MM-DD.json` as an array of rows:

```json
[
  {
    "id": "<country>-<place>-<yyyy>-<mm>",
    "label": "Short site name, as a headline",
    "country": "Country",
    "site": "Where exactly, one line",
    "lat": 55.618,
    "lng": 12.656,
    "date": "YYYY-MM-DD",
    "category": "airport-closure | infrastructure | military-site | sighting",
    "description": "Two plain sentences. What happened, who confirmed it, what it disrupted. No jargon, no speculation about origin unless an official body stated it.",
    "source": "https://..."
  }
]
```

Conventions the script enforces: lowercase hyphenated `id` ending in
`-yyyy-mm`; `date` is the event date, not the report date, and not in the
future; `lat`/`lng` inside Europe; every text field non-empty. A candidate
within 25 km and 3 days of an existing row is refused as a probable duplicate
unless `--allow-near` is passed. Descriptions follow the existing rows: plain
language, no em dashes, no "reportedly" chains.

Present the candidates in chat as a table: date, id, category, one-line
rationale, source. Ask for a yes per row or for the batch.

## 5. Apply the decision

Approved rows:

```
node scripts/threat-data.mjs add <scratchpad>/threat-candidates-YYYY-MM-DD.json
node --test 'tests/**/*.test.js'
```

`add` validates, appends sorted, sets `updated` to today, and copies
`threat-data.json` and `threat-map.js` into `dronereporter/deck/assets/`. Then
commit both copies together. Commit message: `threat map: add <id>, <id>`.

Declined rows: append to `scripts/threat-intake/rejected.json` with `id`,
`date`, `source`, `reason`, and `rejected` (today). Commit with the same PR
if there is one, otherwise on its own.

## 6. Flag stale stats

Read `stats` in `threat-data.json`. If a new row makes a stat wrong or
incomplete (a count of shootdowns, a "since" date, a latest-incident figure),
say so in chat with the proposed new value and source. Do not edit `stats`;
that is a hand edit Tobias makes.

## 7. Nothing new

If the window holds no qualifying incident, say so in one line with the window
and the sources checked. Do not bump `updated`; it records the last data
change, not the last search.
