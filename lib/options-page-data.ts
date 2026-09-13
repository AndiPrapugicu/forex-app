/**
 * Shared loader for the three options pages: today's chains plus stored history.
 *
 * The chains are cached for half an hour in the connector, so the three pages
 * share one fetch. History is best-effort: without the options_snapshots table
 * every page still renders today's reading and says the average is building.
 */

import { OPTIONS_UNDERLYINGS } from '@/config/options.config';
import { fetchAllOptionChains, type ChainSummary } from '@/lib/connectors/yahoo-options';
import { getStore } from '@/lib/db/client';
import { sessionDate } from '@/lib/scoring/options';
import type { OptionsSnapshot } from '@/lib/types';

export interface OptionsPageData {
  chains: ChainSummary[];
  failed: string[];
  history: OptionsSnapshot[];
  /** Why history is empty, when it is — shown on the page. */
  historyNote: string | null;
  today: string;
  fetchedAtUtc: string;
}

const HISTORY_DAYS = 60;

export async function loadOptionsPageData(now = new Date()): Promise<OptionsPageData> {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [chains, history] = await Promise.all([
    fetchAllOptionChains(now),
    getStore()
      .getOptionsSnapshots(since)
      .then((rows) => ({ rows, note: null as string | null }))
      .catch((err: unknown) => ({
        rows: [] as OptionsSnapshot[],
        note: /options_snapshots|relation|does not exist|schema/i.test(String(err))
          ? 'History is not stored yet: run lib/db/migrations/2026-09-13-options-snapshots.sql in Supabase.'
          : 'History is unavailable right now.',
      })),
  ]);

  const order = new Map(OPTIONS_UNDERLYINGS.map((u, i) => [u.symbol, i]));
  return {
    chains: chains.chains.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0)),
    failed: chains.failed,
    history: history.rows,
    historyNote: history.note ?? (history.rows.length === 0 ? 'No sessions stored yet — the ingest cron writes one after each US close.' : null),
    today: sessionDate(now),
    fetchedAtUtc: chains.fetchedAtUtc,
  };
}
