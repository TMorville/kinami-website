// Pure narrative structure: merge weekly-strategy chapters and curated beats
// into an ordered list of timeline stops. No DOM — node-testable.
import { isoWeekId } from './strata.js';

/** HTML-escape untrusted showcase prose before innerHTML. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Chapters (weeks that have a strategy in either market) + beats, by day. */
export function buildStops(index) {
  const stops = [];
  const seen = new Set();
  index.dayList.forEach((d, dayIdx) => {
    const week = isoWeekId(d);
    if (seen.has(week)) return;
    seen.add(week);
    const eu = index.weeksByKey.get(`eu:${week}`);
    const us = index.weeksByKey.get(`us:${week}`);
    // A chapter needs something to say — legacy weeks carry empty theses.
    if ((eu && eu.market_thesis) || (us && us.market_thesis)) {
      stops.push({ kind: 'chapter', week, day: dayIdx, eu, us });
    }
  });
  for (const beat of index.raw.beats) {
    const day = index.dayIndex.get(beat.date) ?? index.dayList.length - 1;
    stops.push({ kind: 'beat', beat, day });
  }
  stops.sort((a, b) => a.day - b.day || (a.kind === 'chapter' ? -1 : 1));
  return stops;
}
