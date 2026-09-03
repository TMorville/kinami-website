// dronereporter/map/src/curated.js
import { escapeHtml } from "./format.js";

/**
 * The curated incidents are first-party data, but one malformed row must
 * degrade to a dropped row with a console warning, never to a dead layer.
 */
export function parseIncidents(raw) {
  const rows = Array.isArray(raw?.incidents) ? raw.incidents : [];
  const incidents = [];
  let dropped = 0;
  for (const row of rows) {
    const ok =
      row !== null &&
      typeof row === "object" &&
      typeof row.label === "string" &&
      row.label.length > 0 &&
      typeof row.lat === "number" &&
      Number.isFinite(row.lat) &&
      Math.abs(row.lat) <= 90 &&
      typeof row.lng === "number" &&
      Number.isFinite(row.lng) &&
      Math.abs(row.lng) <= 180 &&
      typeof row.date === "string" &&
      Number.isFinite(Date.parse(row.date));
    if (!ok) {
      dropped += 1;
      continue;
    }
    incidents.push(row);
  }
  if (dropped > 0) console.warn(`threat-data.json: dropped ${dropped} malformed incident rows.`);
  return { incidents, dropped };
}

/**
 * A curated incident is FRESH for seven days after its event date, and a
 * fresh incident pings on both of the site's maps. Seven days is sized to the
 * intake cadence (daily, see .claude/skills/threat-intake/): a window much
 * longer than the gap between event and row would ping on old news.
 *
 * Measured against the reader's clock, unlike the live layer's recency, which
 * is measured against the snapshot. The curated rows are first-party and
 * carry no generated_at, and a ping is a statement about now.
 */
export const FRESH_MS = 7 * 86_400_000;

export function isFresh(dateIso, nowMs = Date.now()) {
  const t = Date.parse(dateIso);
  return Number.isFinite(t) && nowMs - t < FRESH_MS;
}

export function hasFresh(geojson) {
  return (geojson?.features ?? []).some((f) => f.properties?.fresh === true);
}

export function incidentsToGeoJSON(incidents, nowMs = Date.now()) {
  return {
    type: "FeatureCollection",
    features: incidents.map((incident) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [incident.lng, incident.lat] },
      properties: {
        fresh: isFresh(incident.date, nowMs),
        label: incident.label,
        country: incident.country ?? "",
        site: incident.site ?? "",
        date: incident.date,
        // The dot layers size a core by category, mirroring the threat map.
        category: incident.category ?? "",
        description: incident.description ?? "",
        source: incident.source ?? "",
      },
    })),
  };
}

/** Escaped popup markup; the source link only for http(s) URLs. */
export function popupHtml(props) {
  const date = escapeHtml(props.date);
  const label = escapeHtml(props.label);
  const description = escapeHtml(props.description ?? "");
  let sourceLine = "";
  if (typeof props.source === "string" && /^https?:\/\//.test(props.source)) {
    sourceLine = `<a class="popup-source" href="${escapeHtml(props.source)}" target="_blank" rel="noopener">Source</a>`;
  }
  return [
    `<div class="popup-date">${date}</div>`,
    `<div class="popup-label">${label}</div>`,
    description ? `<p class="popup-desc">${description}</p>` : "",
    sourceLine,
  ].join("");
}

export function oldestYear(incidents) {
  const years = incidents.map((i) => new Date(i.date).getUTCFullYear());
  return years.length === 0 ? new Date().getUTCFullYear() : Math.min(...years);
}
