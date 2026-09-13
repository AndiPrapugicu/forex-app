'use client';

/**
 * The live pages built on /api/dashboard: Economic Calendar and News & Alerts.
 *
 * One shell, two layouts. They were one page, and it read as three unrelated
 * columns squeezed side by side; split, each page is one question — "what is
 * scheduled and what just printed" versus "what is happening and how is the
 * market taking it". Polling lives here once, so the two cannot drift apart.
 *
 * Polls while the tab is visible and pauses when hidden — a background tab
 * hammering five upstreams for hours is exactly the kind of quiet waste that
 * gets a free tier rate-limited.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardData } from '@/lib/types';
import { AlertPanel, MarketMood, NewsPanel, SourceHealthBar } from '@/components/AlertPanel';
import { AssetPanel } from '@/components/AssetPanel';
import { CurrencyStrengthPanel, PairMatrix, TrackedPairsPanel } from '@/components/CurrencyHeatmap';
import { RecentEventRow, UpcomingEventRow } from '@/components/EventCard';
import { PageHeader } from '@/components/primitives';
import { EmptyState, Panel, Skeleton } from '@/components/ui';

const POLL_INTERVAL_MS = 60_000;

export type DashboardMode = 'calendar' | 'news';

const TITLES: Record<DashboardMode, { title: string; description: string }> = {
  calendar: {
    title: 'Economic Calendar',
    description: 'Medium and high impact releases: what is coming, and what just printed',
  },
  news: {
    title: 'News & Alerts',
    description: 'Alerts and headlines from forex desks and central banks, with the market read beside them',
  },
};

/** Day heading for the upcoming list, in UTC like every time on the page. */
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function DashboardView({
  initial,
  initialError,
  mode = 'news',
}: {
  initial: DashboardData | null;
  initialError: string | null;
  mode?: DashboardMode;
}) {
  const [data, setData] = useState<DashboardData | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);

  // Rendered client-side only to avoid a hydration mismatch on relative times.
  const [now, setNow] = useState<number>(() => Date.parse(initial?.generatedAtUtc ?? '') || Date.now());

  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    // The pipeline can take a few seconds; stacking requests multiplies upstream load.
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
      // Keep the last good payload; a failed refresh is no reason to blank the page.
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

  const { title, description } = TITLES[mode];

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title={title}
        description={description}
        updated={data ? `Updated ${data.generatedAtUtc.slice(11, 16)} UTC · refreshes every minute` : undefined}
        actions={
          <>
            {error && <span className="text-caption text-[var(--color-bear)]">{error}</span>}
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border-bright)] px-4 text-small text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-50 md:min-h-9"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {data && (
        <div className="mb-4">
          <SourceHealthBar health={data.health} />
        </div>
      )}

      {!data ? (
        <LoadingOrError error={error} onRetry={refresh} />
      ) : mode === 'calendar' ? (
        <CalendarLayout data={data} now={now} />
      ) : (
        <NewsLayout data={data} now={now} />
      )}
    </div>
  );
}

function CalendarLayout({ data, now }: { data: DashboardData; now: number }) {
  // Chronological within each day; the pipeline hands them over impact-first.
  const upcoming = [...data.upcoming].sort((a, b) => a.dateUtc.localeCompare(b.dateUtc));
  const days = [...new Set(upcoming.map((e) => e.dateUtc.slice(0, 10)))];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel
        title="Upcoming"
        subtitle="Next 72 hours, medium and high impact"
        action={<span className="tnum text-caption text-[var(--color-faint)]">{upcoming.length}</span>}
      >
        {upcoming.length === 0 ? (
          <EmptyState message="Nothing medium or high impact in the next 72 hours" />
        ) : (
          days.map((day) => (
            <section key={day}>
              <h3 className="table-head sticky top-0 px-4 py-1.5 text-caption font-semibold">
                {dayLabel(`${day}T12:00:00Z`)}
              </h3>
              <div className="divide-y divide-[var(--color-border)]">
                {upcoming
                  .filter((e) => e.dateUtc.startsWith(day))
                  .map((e) => (
                    <UpcomingEventRow key={e.id} event={e} now={now} />
                  ))}
              </div>
            </section>
          ))
        )}
      </Panel>

      <Panel title="Recent surprises" subtitle="Last 48 hours, medium and high impact, biggest deviation first">
        {data.recent.length === 0 ? (
          <EmptyState message="No scored releases yet" hint="Prints appear here once an actual value lands" />
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {data.recent.map(({ event, score }) => (
              <RecentEventRow key={event.id} event={event} score={score} now={now} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function NewsLayout({ data, now }: { data: DashboardData; now: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
        <AlertPanel alerts={data.alerts} now={now} />
        <NewsPanel clusters={data.news} now={now} />
      </div>
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
        <MarketMood mood={data.marketMood} generatedAtUtc={data.generatedAtUtc} />
        <CurrencyStrengthPanel strengths={data.strengths} />
        <TrackedPairsPanel pairs={data.pairs} />
        <AssetPanel assets={data.assets} prices={data.prices} />
        <PairMatrix strengths={data.strengths} />
      </div>
    </div>
  );
}

function LoadingOrError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-bear)]/30 bg-[var(--color-surface)] p-8 text-center">
        <p className="text-body text-[var(--color-bear)]">Could not load the live data</p>
        <p className="mt-1 text-caption text-[var(--color-muted)]">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border-bright)] px-4 text-small hover:bg-[var(--color-surface-2)]"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Skeleton className="h-96" />
      <Skeleton className="h-96" />
    </div>
  );
}
