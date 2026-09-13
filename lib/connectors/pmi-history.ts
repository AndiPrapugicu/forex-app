/**
 * PMI history: a committed seed, plus everything we have observed since.
 *
 * THE PROBLEM THIS SOLVES, measured rather than assumed. FXStreet's calendar
 * carries every non-USD PMI release with `actual: null` once the print stops
 * being current. Not just the flash — the whole history. Reading the live pool
 * rewound to 2026-09-02 finds, for services PMI:
 *
 *   EUR  six rows matched, every one `actual: null`
 *   GBP  six rows matched, every one `actual: null`
 *   JPY  six rows matched, every one `actual: null`
 *   AUD  six rows matched, every one `actual: null`
 *
 * `resolveSeries` filters on `e.actual !== null`, so those four economies have
 * no services PMI at all on any past date, and the column is scoreable only in
 * the hours after a release. That is why sPMI is the largest fixable column on
 * the board and why the fix is a data fix rather than a rule change.
 *
 * TWO MECHANISMS, AND THE SEED IS ONLY THE BOOTSTRAP.
 *
 *   SEED         `fixtures/derived/pmi-seed-2026-09-03.json`, built by
 *                `scripts/build-pmi-seed.ts` from A1's own captured charts and
 *                heatmap. Frozen: A1's access window closed on 2026-09-07 and
 *                it can never be extended.
 *   ACCUMULATE   every pipeline run writes the PMI actuals it sees live into
 *                the `events` table, and this connector reads them back. That is
 *                what makes the hole close permanently rather than once: a print
 *                observed live today is still readable in a year, whatever the
 *                calendar's rolling window does with it.
 *
 * THE SEED IS A BACKFILL AND NEVER AN OVERRIDE. `mergePmiHistory` drops any
 * seed row dated on or before the newest LIVE actual for the same series, so a
 * capture can never outrank a direct observation. That rule also closes the one
 * ranking hazard here: `resolveSeries` prefers the newest print carrying a
 * reference over a fresher one without, so a seed row carrying A1's forecast
 * column could otherwise beat a live flash that carries none and walk the
 * column backwards in time. It cannot, because by then it is gone.
 *
 * PROVENANCE IS THE POINT. Every seeded event carries `actualSource:
 * 'a1-capture'`, and `lib/scoring/provenance.ts` uses that to keep the clean
 * parity headline honest — a cell scored off A1's own number is not evidence
 * that we reproduce A1. The accumulator refuses to persist those rows
 * (`laundering guard` below), so a seeded value can never come back wearing a
 * live source's name.
 */

import seedFile from '@/fixtures/derived/pmi-seed-2026-09-03.json';
import { PMI_SERIES, pmiSeriesFor } from '@/config/pmi-series.config';
import { FXSTREET } from '@/config/sources.config';
import { stableId } from '@/lib/connectors/base';
import type { Store } from '@/lib/db/client';
import { getStore } from '@/lib/db/client';
import { dropSupersededSeed } from '@/lib/scoring/pmi-seed-precedence';
import { A1_SOURCED } from '@/lib/scoring/provenance';
import { ok, type Currency, type NormalizedEvent, type Result } from '@/lib/types';

const SOURCE_NAME = 'A1 capture + accumulated PMI history';

type OkResult<T> = Extract<Result<T>, { ok: true }>;

/** `ok()` typed as the success variant, because this connector never fails hard. */
function okResult(data: NormalizedEvent[], degraded?: string): OkResult<NormalizedEvent[]> {
  return ok(SOURCE_NAME, data, degraded) as OkResult<NormalizedEvent[]>;
}

interface SeedRow {
  currency: string;
  slotKey: string;
  day: string;
  actual: number;
  consensus: number | null;
  previous: number | null;
  anchor: string;
}

/** `${currency}|${slotKey}|${day}` — the identity of one PMI observation. */
function seriesDay(currency: string, slotKey: string, day: string): string {
  return `${currency}|${slotKey}|${day}`;
}

/** The day part of an ISO timestamp. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * The seed file as calendar events.
 *
 * Pure, so the test needs neither a store nor a network. Two shaping decisions
 * are load-bearing and are not stylistic:
 *
 *   `dateUtc` is midnight. A live row for the same day carries a real
 *   publication time and is therefore strictly newer under `resolveSeries`'
 *   `newest()`, which compares with a strict `>` and would otherwise resolve an
 *   exact tie by array order — making correctness a function of merge ordering.
 *
 *   `name` comes from `PMI_SERIES.publishAs` and nowhere else. An event
 *   published under a name the slot's matcher does not prefer is invisible:
 *   no error, no warning, and no benefit. `pmi-history.test.ts` runs every
 *   definition through `resolveSeries` for exactly this reason.
 */
export function toPmiSeedEvents(file: { rows: SeedRow[] } = seedFile as { rows: SeedRow[] }): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];

  for (const row of file.rows) {
    const def = PMI_SERIES.find((d) => d.currency === row.currency && d.slotKey === row.slotKey);
    // A seed row with no definition cannot be published under a name any
    // matcher prefers, so emitting it would be busywork. The builder cannot
    // produce one; this guards the file being edited by hand.
    if (!def) continue;

    events.push({
      id: stableId('a1-pmi', def.currency, def.slotKey, row.day),
      seriesId: `a1-pmi:${def.currency}:${def.slotKey}`,
      name: def.publishAs,
      currency: def.currency,
      countryCode: def.countryCode,
      dateUtc: `${row.day}T00:00:00.000Z`,
      impact: 'MEDIUM',
      actual: row.actual,
      consensus: row.consensus,
      previous: row.previous,
      revised: null,
      unit: null,
      ratioDeviation: null,
      isBetterThanExpected: null,
      isSpeech: false,
      isPreliminary: true,
      source: 'a1-capture',
      actualSource: 'a1-capture',
      sourceUrl: 'fixtures/derived/pmi-seed-2026-09-03.json',
      lastUpdated: null,
    });
  }

  return events;
}

/**
 * Which live events belong in the PMI store.
 *
 * The fourth clause is the LAUNDERING GUARD and it is the important one.
 * Without it a seeded row round-trips through the store and comes back carrying
 * whatever source the store reports, the clean parity headline silently stops
 * excluding anything, and seeding a number from A1 would once again be able to
 * make our parity against A1 look better. That is the exact failure this
 * repository's parity discipline exists to prevent.
 */
export function pmiEventsToPersist(events: NormalizedEvent[], now: Date): NormalizedEvent[] {
  const nowIso = now.toISOString();
  return events.filter(
    (e) =>
      pmiSeriesFor(e) !== null &&
      e.actual !== null &&
      e.dateUtc <= nowIso &&
      e.actualSource !== null &&
      e.actualSource !== undefined &&
      !A1_SOURCED.has(e.actualSource),
  );
}

/**
 * Ids this process has already written, so a warm serverless instance does not
 * re-send the same rows on every render. Deliberately module-level and
 * unbounded: it holds at most a few dozen ids for the lifetime of a process.
 */
const writtenThisProcess = new Set<string>();

/**
 * Persist the PMI actuals seen on this run. Never throws, never blocks a render.
 *
 * Idempotent three times over: ids are deterministic so `upsertEvents` is an
 * update of identical values, the process-local set stops repeat writes within
 * one instance, and only rows absent from this run's read are sent at all —
 * which takes steady-state traffic to roughly zero.
 */
export async function accumulatePmiActuals(
  events: NormalizedEvent[],
  now: Date = new Date(),
  store?: Store,
): Promise<{ written: number; alreadyHeld: number; durable: boolean }> {
  const db = store ?? getStore();
  const candidates = pmiEventsToPersist(events, now);
  const fresh = candidates.filter((e) => !writtenThisProcess.has(e.id));

  if (fresh.length === 0 || !db.durable) {
    return { written: 0, alreadyHeld: candidates.length, durable: db.durable };
  }

  try {
    await db.upsertEvents(fresh);
    for (const e of fresh) writtenThisProcess.add(e.id);
    return { written: fresh.length, alreadyHeld: candidates.length - fresh.length, durable: true };
  } catch {
    // One supplementary source must not be able to take the board down.
    return { written: 0, alreadyHeld: candidates.length, durable: true };
  }
}

/**
 * The seed unioned with everything the store has accumulated.
 *
 * STORED ROWS WIN on a collision. A stored row was observed live and carries
 * `actualSource: 'fxstreet'` or better — stronger provenance and a number that
 * did not travel through somebody else's presentation layer. That is also what
 * makes the seed DECAY: every print observed live permanently supersedes its
 * seeded twin, so the clean parity headline closes on the dirty one over time
 * without anybody editing anything.
 *
 * Returns `ok()` on every path. A degraded note is how this reports trouble,
 * because a scorecard that will not render is worse than a column that will not
 * score — the contract `conference-board.ts` already sets.
 */
export interface PmiHistoryCounts {
  seeded: number;
  accumulated: number;
  /** Seed points a live read has already replaced — the seed decaying. */
  superseded: number;
}

/** Counts from the most recent `fetchPmiHistory`, for the health note. */
export function pmiHistoryNote(c: PmiHistoryCounts): string {
  return `${c.seeded} seeded, ${c.accumulated} accumulated, ${c.superseded} seed points superseded by a live read`;
}

export async function fetchPmiHistory(
  now: Date = new Date(),
  store?: Store,
): Promise<OkResult<NormalizedEvent[]> & { counts: PmiHistoryCounts }> {
  const seed = toPmiSeedEvents();
  const db = store ?? getStore();

  // The in-memory fallback can only ever return what this process just wrote,
  // so reading it is pure cost. Say so rather than reporting a healthy source
  // that accumulates nothing.
  if (!db.durable) {
    return {
      ...okResult(seed, 'store is in-memory; PMI history is seed-only and nothing accumulates between runs'),
      counts: { seeded: seed.length, accumulated: 0, superseded: 0 },
    };
  }

  let stored: NormalizedEvent[] = [];
  try {
    const from = new Date(now.getTime() - FXSTREET.historyLookbackDays * 86_400_000);
    const all = await db.getEvents(from.toISOString(), now.toISOString());
    // The filter is not optional. `lib/pipeline.ts` writes the whole news
    // calendar into this same table, and an unfiltered read would inject
    // hundreds of unrelated releases into the scorecard's event pool.
    stored = all.filter((e) => pmiSeriesFor(e) !== null && e.actual !== null);
  } catch (error) {
    return {
      ...okResult(
        seed,
        `store unreadable — PMI history is seed-only (${error instanceof Error ? error.message : String(error)})`,
      ),
      counts: { seeded: seed.length, accumulated: 0, superseded: 0 },
    };
  }

  const byKey = new Map<string, NormalizedEvent>();
  for (const e of seed) byKey.set(seriesDay(e.currency, seriesSlot(e), dayOf(e.dateUtc)), e);

  let superseded = 0;
  for (const e of stored) {
    const key = seriesDay(e.currency, seriesSlot(e), dayOf(e.dateUtc));
    if (byKey.has(key)) superseded++;
    byKey.set(key, e);
  }

  return {
    ...okResult([...byKey.values()]),
    counts: { seeded: seed.length, accumulated: stored.length, superseded },
  };
}

/** The slot a PMI event belongs to. Only ever called on events we published. */
function seriesSlot(e: NormalizedEvent): string {
  return pmiSeriesFor(e)?.slotKey ?? 'unknown';
}

/**
 * Append PMI history to the live calendar, without applying precedence.
 *
 * Only exact duplicates are removed: a history row for a series and day the
 * live calendar already carries WITH AN ACTUAL. Everything else is kept, so a
 * later rewind (`asOf`) still has the seed to work with — see
 * `lib/scoring/pmi-seed-precedence.ts` for why precedence cannot be settled
 * here against today's calendar.
 */
export function unionPmiHistory(live: NormalizedEvent[], history: NormalizedEvent[]): NormalizedEvent[] {
  if (history.length === 0) return live;

  const liveExact = new Set<string>();
  for (const e of live) {
    const def = pmiSeriesFor(e);
    if (!def || e.actual === null) continue;
    liveExact.add(seriesDay(def.currency, def.slotKey, dayOf(e.dateUtc)));
  }

  const kept = history.filter((e) => {
    const def = pmiSeriesFor(e);
    return def !== null && !liveExact.has(seriesDay(def.currency, def.slotKey, dayOf(e.dateUtc)));
  });

  return kept.length === 0 ? live : [...live, ...kept];
}

/**
 * The pool the live board scores: history appended, then the seed dropped
 * wherever an observation supersedes it. A backfill, never an override.
 */
export function mergePmiHistory(live: NormalizedEvent[], history: NormalizedEvent[]): NormalizedEvent[] {
  if (history.length === 0) return live;
  return dropSupersededSeed(unionPmiHistory(live, history));
}

/** Currencies the seed can score, for the health note and the docs. */
export function seededCurrencies(): Currency[] {
  return [...new Set(toPmiSeedEvents().map((e) => e.currency))].sort() as Currency[];
}
