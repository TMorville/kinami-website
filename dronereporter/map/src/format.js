// dronereporter/map/src/format.js
/** Human phrasing. No em dashes, per repo copy convention. */

export function relativeTime(iso, nowMs) {
  const deltaMs = Math.max(0, nowMs - Date.parse(iso));
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * Derived rather than hardcoded: min_delay_minutes exists in the contract so
 * the disclosure copy tracks the bake. A hardcoded "1 hour" becomes a false
 * public honesty claim the day D changes.
 */
export function formatDelay(minutes) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
