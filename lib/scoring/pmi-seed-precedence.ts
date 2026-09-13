/**
 * The seed never outranks an observation — applied at the moment of scoring.
 *
 * WHY THIS IS NOT SIMPLY PART OF THE PIPELINE MERGE. Every parity script rewinds
 * the board by filtering the payload's events to a capture date with `asOf`.
 * If the seed were dropped in the pipeline against TODAY's calendar, a live
 * 2026-09-03 euro-area print would remove the 2026-08-21 seed row before the
 * rewind ever ran, and the rewound board would be exactly as blank as before
 * the seed existed. So the pipeline keeps the full pool, and this rule runs on
 * whatever pool is actually about to be scored: once in the pipeline for the
 * live board, and again inside `asOf` for every rewound one.
 *
 * THE RULE. An A1-sourced PMI row is dropped when the same series has an
 * observed (non-A1) actual on the same day or later. That keeps the seed a pure
 * backfill, and it closes the one ranking hazard: `resolveSeries` prefers the
 * newest print CARRYING A REFERENCE ahead of a fresher print without one, so a
 * seed row with A1's forecast column attached would otherwise beat a live flash
 * that has none and walk the column backwards in time.
 *
 * Pure and idempotent, and a no-op on a pool with no A1-sourced rows.
 */

import { pmiSeriesFor } from '@/config/pmi-series.config';
import { A1_SOURCED } from '@/lib/scoring/provenance';
import type { NormalizedEvent } from '@/lib/types';

function isA1Sourced(e: NormalizedEvent): boolean {
  return e.actualSource !== null && e.actualSource !== undefined && A1_SOURCED.has(e.actualSource);
}

export function dropSupersededSeed(events: NormalizedEvent[]): NormalizedEvent[] {
  if (!events.some(isA1Sourced)) return events;

  /** `${currency}|${slotKey}` -> the newest day an observed actual exists. */
  const observedThrough = new Map<string, string>();
  for (const e of events) {
    if (e.actual === null || isA1Sourced(e)) continue;
    const def = pmiSeriesFor(e);
    if (!def) continue;
    const key = `${def.currency}|${def.slotKey}`;
    const day = e.dateUtc.slice(0, 10);
    const seen = observedThrough.get(key);
    if (seen === undefined || day > seen) observedThrough.set(key, day);
  }

  return events.filter((e) => {
    if (!isA1Sourced(e)) return true;
    const def = pmiSeriesFor(e);
    if (!def) return true;
    const floor = observedThrough.get(`${def.currency}|${def.slotKey}`);
    return floor === undefined || e.dateUtc.slice(0, 10) > floor;
  });
}
