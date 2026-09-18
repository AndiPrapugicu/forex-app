/**
 * Reading the change log out of storage.
 *
 * The comparison itself is pure and lives in `lib/scoring/history.ts`. This is
 * only the part that needs a database, kept separate so the pipeline stays
 * network-only and the diff stays testable without one.
 *
 * NEVER THROWS. A board that fails to render because the history table is
 * unreachable would be a worse outcome than the flicker this exists to explain.
 */

import { getStore } from '@/lib/db/client';
import {
  buildChangeLog,
  dayDeltas,
  latestPerSymbol,
  nearestCaptureMoment,
  truncateToMinute,
  type ScoreChange,
} from '@/lib/scoring/history';
import type { SetupsMatrix } from '@/lib/scoring/setups';

/**
 * How far back to look for a prior reading.
 *
 * The cron writes every 10 minutes, so two hours survives a handful of missed
 * runs while keeping the query to roughly 600 rows. Beyond that the comparison
 * stops being "what changed since last time" and starts being a history chart,
 * which the app already has.
 */
export const CHANGE_LOG_WINDOW_MS = 2 * 3600_000;

export async function loadChangeLog(matrix: SetupsMatrix): Promise<ScoreChange[]> {
  try {
    /**
     * Not gated on `store.durable`. The in-memory store holds snapshots for the
     * life of a dev process, and the page and the cron share that process — so
     * the log works offline too, which is where it gets exercised most.
     */
    const store = getStore();

    const since = new Date(new Date(matrix.generatedAtUtc).getTime() - CHANGE_LOG_WINDOW_MS);
    const snapshots = await store.getAllSnapshots(since.toISOString());

    /**
     * Strictly before THIS run's capture minute.
     *
     * `/api/ingest` writes the current run's snapshots on the same schedule that
     * renders them, so without the cut-off a row would routinely be compared
     * against itself and the log would read as "nothing changed" precisely when
     * something had.
     */
    const previous = latestPerSymbol(snapshots, truncateToMinute(matrix.generatedAtUtc));
    return buildChangeLog(matrix.rows, previous);
  } catch {
    return [];
  }
}

/** Look back a day plus the tolerance, so the query stays one day of rows. */
const DAY_MS = 24 * 3600_000;

/**
 * 1D Δ for every row: score now against the capture nearest 24 hours ago.
 *
 * `comparedWithUtc` is the capture it actually used, so the column can say
 * which moment it is a day away from — the writer's cadence is at the mercy of
 * GitHub's scheduler, and a comparison against a 21-hour-old board must not
 * present itself as exactly a day. Never throws; with no history every row is
 * null and `comparedWithUtc` is null.
 */
/**
 * A capture must be at least this old to be a "then" worth showing.
 *
 * Below it the comparison is against a board from the same session's data and
 * would read 0 everywhere, which is indistinguishable from a quiet day.
 */
export const DAY_DELTA_MIN_AGE_MS = 2 * 3600_000;

export async function loadDayDeltas(
  matrix: SetupsMatrix,
  /** Injectable so the fallback can be tested without a database. */
  store: Pick<ReturnType<typeof getStore>, 'getAllSnapshots'> = getStore(),
): Promise<{ deltas: Record<string, number | null>; comparedWithUtc: string | null }> {
  try {
    const now = new Date(matrix.generatedAtUtc).getTime();
    const target = new Date(now - DAY_MS).toISOString();
    /**
     * Two days of rows, not one.
     *
     * The history is only as old as the first successful ingest, and when it is
     * younger than a day the honest fallback is the OLDEST board on file rather
     * than nothing — the column then reports a shorter change and names the
     * board it used. Reading two days keeps that fallback available without
     * turning the query into a history chart.
     */
    const since = new Date(now - 2 * DAY_MS).toISOString();
    const snapshots = await store.getAllSnapshots(since);
    const old = snapshots.filter(
      (s) => new Date(s.capturedAtUtc).getTime() <= now - DAY_DELTA_MIN_AGE_MS,
    );

    const comparedWithUtc =
      nearestCaptureMoment(old, target) ??
      // Nothing near a day ago: the oldest board we hold, which is still a real
      // comparison as long as the UI says which board it is.
      old.map((s) => s.capturedAtUtc).sort()[0] ??
      null;
    if (comparedWithUtc === null) {
      return { deltas: dayDeltas(matrix.rows, new Map()), comparedWithUtc: null };
    }

    const then = new Map(
      old.filter((s) => s.capturedAtUtc === comparedWithUtc).map((s) => [s.symbol, s.totalScore]),
    );
    return { deltas: dayDeltas(matrix.rows, then), comparedWithUtc };
  } catch {
    return { deltas: dayDeltas(matrix.rows, new Map()), comparedWithUtc: null };
  }
}
