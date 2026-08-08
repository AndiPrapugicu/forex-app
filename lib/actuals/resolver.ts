/**
 * Merges calendar sources into one event list, and decides which `actual` to
 * believe when they disagree.
 *
 * Precedence: manual > FXStreet > FairEconomy(schedule only) .
 * A manual entry always wins — it is the user watching the print live, and it is
 * the only path that works the instant a number hits the wire.
 *
 * When a feed later disagrees with a manual entry we do NOT overwrite and we do
 * NOT silently discard: the conflict is recorded so the UI can surface it. A
 * dashboard that quietly changes a number under the user is worse than one that
 * admits two sources disagree.
 */

import { fetchFairEconomyCalendar } from '@/lib/connectors/faireconomy';
import { fetchFxStreetCalendar } from '@/lib/connectors/fxstreet';
import { stableId } from '@/lib/connectors/base';
import type { NormalizedEvent, Result, SourceHealth } from '@/lib/types';

export interface ResolvedCalendar {
  events: NormalizedEvent[];
  health: SourceHealth[];
  /** Events whose manual actual disagrees with the feed's. Surfaced in the UI. */
  conflicts: { eventId: string; manual: number; feed: number; feedSource: string }[];
  /** True when FXStreet failed and we are running on schedule-only data. */
  degradedToScheduleOnly: boolean;
}

/**
 * Identity for cross-source matching.
 *
 * FXStreet and FairEconomy assign unrelated ids, so the same release appears
 * twice unless we match on content. Currency + normalized name + the hour of
 * release is stable enough in practice: two distinct releases for one currency
 * in the same hour with the same name do not occur.
 */
function matchKey(e: NormalizedEvent): string {
  const name = e.name
    .toLowerCase()
    .replace(/\s*\((mom|yoy|qoq|m\/m|y\/y|q\/q)\)\s*/gi, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stableId('match', e.currency, name, e.dateUtc.slice(0, 13));
}

function toHealth(res: Result<unknown>): SourceHealth {
  return {
    source: res.source,
    ok: res.ok,
    detail: res.ok ? res.degraded : res.error,
    fetchedAtUtc: res.fetchedAtUtc,
  };
}

/**
 * Builds the merged calendar.
 *
 * @param manualActuals event id -> value the user typed in
 */
export async function resolveCalendar(
  manualActuals: Map<string, number> = new Map(),
  now = new Date(),
): Promise<ResolvedCalendar> {
  // Both in parallel: FairEconomy is cheap and we want it ready as a fallback
  // regardless of whether FXStreet succeeds.
  const [fxs, ff] = await Promise.all([
    fetchFxStreetCalendar(now),
    fetchFairEconomyCalendar(),
  ]);

  const health = [toHealth(fxs), toHealth(ff)];
  const conflicts: ResolvedCalendar['conflicts'] = [];

  const byKey = new Map<string, NormalizedEvent>();

  // FXStreet first — it is the richer source, carrying actuals and deviations.
  if (fxs.ok) {
    for (const e of fxs.data) byKey.set(matchKey(e), e);
  }

  // FairEconomy fills gaps only. It has no actuals, so it can never displace an
  // FXStreet row; it can only add events FXStreet did not return.
  if (ff.ok) {
    for (const e of ff.data) {
      const key = matchKey(e);
      if (!byKey.has(key)) byKey.set(key, e);
    }
  }

  // Manual entries override everything, and are recorded as conflicts when the
  // feed already had a different number.
  const events = [...byKey.values()].map((e) => {
    const manual = manualActuals.get(e.id);
    if (manual === undefined) return e;

    if (e.actual !== null && e.actual !== manual) {
      conflicts.push({
        eventId: e.id,
        manual,
        feed: e.actual,
        feedSource: e.actualSource ?? e.source,
      });
    }

    return {
      ...e,
      actual: manual,
      actualSource: 'manual' as const,
      // The feed's ratioDeviation described the feed's actual, not this one.
      // Keeping it would attach a surprise magnitude to a different number.
      ratioDeviation: e.actual === manual ? e.ratioDeviation : null,
      isBetterThanExpected: e.actual === manual ? e.isBetterThanExpected : null,
    };
  });

  events.sort((a, b) => a.dateUtc.localeCompare(b.dateUtc));

  return {
    events,
    health,
    conflicts,
    degradedToScheduleOnly: !fxs.ok,
  };
}
