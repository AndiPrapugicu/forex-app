/**
 * Score history for one symbol.
 *
 * The honest failure mode matters more than the chart here. History only
 * accumulates if two things are true: Supabase is configured, and the ingest
 * cron has been running. When either is false the page says which one, because
 * an empty chart otherwise reads as "this symbol has been flat", which is a
 * completely different claim from "we have not been recording".
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { maxScoreForKind } from '@/config/setups.config';
import { findSymbol } from '@/config/symbols.config';
import { getStore } from '@/lib/db/client';
import { diffSnapshots } from '@/lib/scoring/history';
import { ScoreHistoryChart } from '@/components/ScoreHistoryChart';
import { Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

const RANGES = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
] as const;

/**
 * Reads the window of snapshots.
 *
 * The clock read lives here rather than in the component body: `Date.now()`
 * during render is impure, and the React Compiler rejects it. Failures are
 * returned rather than thrown so the page can explain WHICH thing is broken —
 * a missing table and an empty table need different fixes.
 */
async function loadHistory(symbol: string, days: number) {
  const store = getStore();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    return { history: await store.getSnapshots(symbol, since), loadError: null };
  } catch (err) {
    return { history: [], loadError: err instanceof Error ? err.message : String(err) };
  }
}

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { symbol } = await params;
  const { range: rangeKey } = await searchParams;

  const def = findSymbol(symbol);
  if (!def) notFound();

  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];

  const store = getStore();
  const storage = await store.verify();
  const { history, loadError } = await loadHistory(def.symbol, range.days);

  const change = diffSnapshots(history);

  /**
   * Why the chart might be empty, in the order the user can act on. Distinguishing
   * these is the whole point — "no storage" and "storage works but no runs yet"
   * need different fixes.
   */
  const emptyReason =
    loadError !== null
      ? `Could not read history: ${loadError}`
      : !storage.ok
        ? `Storage is not working: ${storage.detail ?? 'unknown error'}. Run lib/db/schema.sql.`
        : !store.durable
          ? 'Storage is in-memory, so nothing survives between requests. Set SUPABASE_URL and SUPABASE_SERVICE_KEY to keep history.'
          : `No snapshots recorded in the last ${range.days} days yet — history starts accumulating once /api/ingest has run.`;

  return (
    <div className="px-4 py-3">
      <header className="mb-3 flex flex-wrap items-baseline gap-3">
        <Link href={`/scorecard/${def.symbol}`} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">
          ← {def.label} scorecard
        </Link>
        <h1 className="text-xl font-bold">Score history</h1>
        <span className="font-mono text-xs text-[var(--color-faint)]">{def.symbol}</span>

        <nav className="ml-auto flex gap-1">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/history/${def.symbol}?range=${r.key}`}
              className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                r.key === range.key
                  ? 'border-[var(--color-border-bright)] bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </header>

      {history.length >= 2 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <div className="lg:col-span-3">
            <Panel title={`Score vs price · ${history.length} snapshots`}>
              <div className="p-3">
                <ScoreHistoryChart history={history} range={maxScoreForKind(def.kind)} />
              </div>
            </Panel>
          </div>

          <div className="flex flex-col gap-3">
            {change && (
              <Panel title={`Change over ${range.label}`}>
                <dl className="divide-y divide-[var(--color-border)]">
                  <div className="flex items-center justify-between px-4 py-2">
                    <dt className="text-[11px] text-[var(--color-muted)]">Score</dt>
                    <dd className="tnum text-sm font-semibold">
                      {change.from > 0 ? '+' : ''}
                      {change.from} → {change.to > 0 ? '+' : ''}
                      {change.to}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2">
                    <dt className="text-[11px] text-[var(--color-muted)]">Move</dt>
                    <dd
                      className={`tnum text-sm font-semibold ${
                        change.delta > 0
                          ? 'text-[var(--color-bull)]'
                          : change.delta < 0
                            ? 'text-[var(--color-bear)]'
                            : 'text-[var(--color-muted)]'
                      }`}
                    >
                      {change.delta > 0 ? '+' : ''}
                      {change.delta}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2">
                    <dt className="text-[11px] text-[var(--color-muted)]">Bias</dt>
                    <dd className="text-xs">
                      {change.fromBias} → <span className="font-semibold">{change.toBias}</span>
                    </dd>
                  </div>
                </dl>

                {change.flipped && (
                  <p className="border-t border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--color-bear)]">
                    Bias flipped sign during this window.
                  </p>
                )}
              </Panel>
            )}

            <Panel title="Reading this">
              <p className="px-4 py-3 text-[11px] leading-relaxed text-[var(--color-muted)]">
                Shaded bands are the bias thresholds: ±4 for Bullish, ±7 for Very Bullish.
                They are absolute cuts, not a share of the ±{maxScoreForKind(def.kind)} maximum, so a
                score deep into the shading is genuinely far past the threshold.
              </p>
            </Panel>
          </div>
        </div>
      ) : (
        <Panel>
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-[var(--color-muted)]">
              {history.length === 1 ? 'Only one snapshot so far' : 'No history yet'}
            </p>
            <p className="mx-auto mt-2 max-w-lg text-xs text-[var(--color-faint)]">{emptyReason}</p>
          </div>
        </Panel>
      )}
    </div>
  );
}
