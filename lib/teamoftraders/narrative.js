// Pure narrative structure: merge weekly-strategy chapters and curated beats
// into an ordered list of timeline stops. No DOM — node-testable.
import { isoWeekId } from './strata.js';

/** Editorial titles per strategy week, written from that week's theses.
 *  Fallback for unmapped weeks: "the plan". */
export const WEEK_TITLES = {
  '2026-W16': 'ceasefire relief',
  '2026-W17': 'the ceasefire breaks',
  '2026-W18': 'earnings gauntlet',
  '2026-W19': 'ai demand confirmed',
  '2026-W20': 'the tariff truce',
  '2026-W21': 'waiting on nvidia',
  '2026-W22': 'consolidating the highs',
  '2026-W23': 'under-participating',
  '2026-W24': 'the hike and the whipsaw',
  '2026-W25': 'the peace dividend',
  '2026-W26': 'risk-on broadens',
  '2026-W27': 'the dovish turn',
};

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
