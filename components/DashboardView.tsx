'use client';

/**
 * Dashboard shell and polling.
 *
 * Polls /api/dashboard while the tab is visible. Pauses when hidden — a
 * background tab hammering five upstreams for hours is exactly the kind of quiet
 * waste that gets a free tier rate-limited.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardData } from '@/lib/types';
import { AlertPanel, MarketMood, NewsPanel, SourceHealthBar } from '@/components/AlertPanel';
import { AssetPanel } from '@/components/AssetPanel';
import { CurrencyStrengthPanel, PairMatrix, TrackedPairsPanel } from '@/components/CurrencyHeatmap';
import { RecentEventRow, UpcomingEventRow } from '@/components/EventCard';
import { EmptyState, Panel, Skeleton } from '@/components/ui';

const POLL_INTERVAL_MS = 60_000;

export function DashboardView({
  initial,
  initialError,
}: {
  initial: DashboardData | null;
  initialError: string | null;
}) {
  const [data, setData] = useState<DashboardData | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);

  // Rendered client-side only to avoid a hydration mismatch on relative times.
  const [now, setNow] = useState<number>(() => Date.parse(initial?.generatedAtUtc ?? '') || Date.now());

  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    // Guard against overlapping requests: the pipeline can take a few seconds,
    // and stacking them would multiply upstream load for no benefit.
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);

    try {
      const res = await fetch('/api/dashboard', { cache: 'no-store' });
      if (!res.ok) throw new Error(`refresh failed (${res.status})`);
      const next = (await res.json()) as DashboardData;
      setData(next);
      setNow(Date.now());
      setError(null);
    } catch (err) {
      // Keep showing the last good payload; a failed refresh is not a reason to
      // blank a dashboard someone is reading.
      setError(err instanceof Error ? err.message : 'refresh failed');
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const id = setInterval(tick, POLL_INTERVAL_MS);

    // Refresh immediately when the tab regains focus, so returning to it never
    // shows stale numbers.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  // Keep relative timestamps honest between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid-bg min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <h1 className="text-sm font-bold tracking-wide text-[var(--color-text)]">
            FX<span className="text-[var(--color-bull)]">INTEL</span>
          </h1>

          {data && <SourceHealthBar health={data.health} />}

          <div className="ml-auto flex items-center gap-3">
            {error && <span className="text-[10px] text-[var(--color-bear)]">{error}</span>}
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-bright)] hover:text-[var(--color-text)] disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-4">
        {!data ? (
          <LoadingOrError error={error} onRetry={refresh} />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            {/* Left column: the signal */}
            <div className="flex flex-col gap-4 xl:col-span-5">
              <MarketMood mood={data.marketMood} generatedAtUtc={data.generatedAtUtc} />
              <CurrencyStrengthPanel strengths={data.strengths} />
              <AssetPanel assets={data.assets} prices={data.prices} />
              <PairMatrix strengths={data.strengths} />
            </div>

            {/* Middle column: the calendar */}
            <div className="flex flex-col gap-4 xl:col-span-4">
              <Panel
                title="Upcoming"
                subtitle="Next 72 hours, highest impact first"
                action={
                  <span className="tnum text-[10px] text-[var(--color-faint)]">
                    {data.upcoming.length}
                  </span>
                }
              >
                {data.upcoming.length === 0 ? (
                  <EmptyState message="Nothing scheduled in the next 72 hours" />
                ) : (
                  <div className="max-h-[30rem] divide-y divide-[var(--color-border)] overflow-y-auto">
                    {data.upcoming.map((e) => (
                      <UpcomingEventRow key={e.id} event={e} now={now} />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Recent surprises" subtitle="Last 48 hours, biggest deviation first">
                {data.recent.length === 0 ? (
                  <EmptyState
                    message="No scored releases yet"
                    hint="Prints appear here once an actual value lands"
                  />
                ) : (
                  <div className="max-h-[30rem] divide-y divide-[var(--color-border)] overflow-y-auto">
                    {data.recent.map(({ event, score }) => (
                      <RecentEventRow key={event.id} event={event} score={score} now={now} />
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            {/* Right column: what is happening now */}
            <div className="flex flex-col gap-4 xl:col-span-3">
              <AlertPanel alerts={data.alerts} now={now} />
              <TrackedPairsPanel pairs={data.pairs} />
              <NewsPanel clusters={data.news} now={now} />
            </div>
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 pt-2 pb-8">
        <p className="text-[10px] leading-relaxed text-[var(--color-faint)]">
          Scores are rule-based and reproducible from <code>config/scoring.config.ts</code>. Confidence
          below 40 renders as uncertain rather than a direction. News is grouped by story and counted
          by distinct publisher — a single outlet never counts as corroboration. Not financial advice.
        </p>
      </footer>
    </div>
  );
}

function LoadingOrError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <div className="rounded-xl border border-[var(--color-bear)]/30 bg-[var(--color-surface)] p-8 text-center">
        <p className="text-sm text-[var(--color-bear)]">Could not load dashboard data</p>
        <p className="mt-1 text-xs text-[var(--color-muted)]">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded border border-[var(--color-border-bright)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="flex flex-col gap-4 xl:col-span-5">
        <Skeleton className="h-24" />
        <Skeleton className="h-72" />
        <Skeleton className="h-56" />
      </div>
      <div className="flex flex-col gap-4 xl:col-span-4">
        <Skeleton className="h-96" />
        <Skeleton className="h-72" />
      </div>
      <div className="flex flex-col gap-4 xl:col-span-3">
        <Skeleton className="h-80" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
