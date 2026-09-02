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

export function incidentsToGeoJSON(incidents) {
  return {
    type: "FeatureCollection",
    features: incidents.map((incident) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [incident.lng, incident.lat] },
      properties: {
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
