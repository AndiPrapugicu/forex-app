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
import { buildChangeLog, latestPerSymbol, truncateToMinute, type ScoreChange } from '@/lib/scoring/history';
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
