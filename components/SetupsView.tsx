'use client';

/**
 * Top Setups shell: header stats, the matrix, and polling.
 *
 * Polls on a five-minute cycle rather than the news dashboard's one minute. The
 * inputs here are a daily calendar and a weekly COT report — polling harder
 * would spend requests on data that cannot have changed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChangeLog } from '@/components/ChangeLog';
import { SetupsMatrix } from '@/components/SetupsMatrix';
import { SourceHealthBar } from '@/components/AlertPanel';
import { Skeleton } from '@/components/ui';
import { MATRIX_SLOTS, SCORING_SLOTS } from '@/config/setups.config';
import type { MirrorOverlay } from '@/lib/scoring/a1-mirror';
import type { ScoreChange } from '@/lib/scoring/history';
import type { SetupsMatrix as Matrix } from '@/lib/scoring/setups';
import type { SourceHealth } from '@/lib/types';

const POLL_INTERVAL_MS = 5 * 60_000;

export function SetupsView({
  initial,
  initialHealth,
  initialChangeLog,
  initialMirror,
  initialError,
}: {
  initial: Matrix | null;
  initialHealth: SourceHealth[];
  initialChangeLog: ScoreChange[];
  /** Built server-side from the newest captured A1 board; null when none is on disk. */
  initialMirror: MirrorOverlay | null;
  initialError: string | null;
}) {
  const [matrix, setMatrix] = useState<Matrix | null>(initial);
  const [health, setHealth] = useState<SourceHealth[]>(initialHealth);
  const [changeLog, setChangeLog] = useState<ScoreChange[]>(initialChangeLog);
  const [mirror, setMirror] = useState<MirrorOverlay | null>(initialMirror);
  const [error, setError] = useState<string | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await fetch('/api/setups', { cache: 'no-store' });
      if (!res.ok) throw new Error(`refresh failed (${res.status})`);
      const data = await res.json();
      setMatrix(data);
      setHealth(data.health ?? []);
      setChangeLog(data.changeLog ?? []);
      setMirror(data.mirror ?? null);
      setError(null);
    } catch (err) {
      // Keep the last good matrix on screen; a failed refresh is no reason to
      // blank a page someone is reading.
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

  const rows = matrix?.rows ?? [];
  const bullish = rows.filter((r) => r.bias.includes('Bullish')).length;
  const bearish = rows.filter((r) => r.bias.includes('Bearish')).length;

  return (
    <div className="px-4 py-4">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <div>
          <h1 className="text-lg font-bold">Top Setups</h1>
          <p className="text-xs text-[var(--color-faint)]">
            {rows.length} symbols scored across {SCORING_SLOTS.length} indicators
            {MATRIX_SLOTS.length > SCORING_SLOTS.length &&
              ` (+${MATRIX_SLOTS.length - SCORING_SLOTS.length} shown as context)`}
            {matrix?.cotReportDate && ` · COT as of ${matrix.cotReportDate}`}
          </p>
        </div>

        {matrix && (
          <div className="flex gap-4 text-xs">
            <span className="text-[var(--color-bull)]">{bullish} bullish</span>
            <span className="text-[var(--color-bear)]">{bearish} bearish</span>
            <span className="text-[var(--color-muted)]">
              {rows.length - bullish - bearish} neutral
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          <SourceHealthBar health={health} />
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
      </header>

      {!matrix ? (
        error ? (
          <div className="rounded-xl border border-[var(--color-bear)]/30 bg-[var(--color-surface)] p-8 text-center">
            <p className="text-sm text-[var(--color-bear)]">Could not build the scorecard</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">{error}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-4 rounded border border-[var(--color-border-bright)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-2)]"
            >
              Try again
            </button>
          </div>
        ) : (
          <Skeleton className="h-[36rem]" />
        )
      ) : (
        <>
          <ChangeLog changes={changeLog} />
          <SetupsMatrix rows={matrix.rows} cotReportDate={matrix.cotReportDate} mirror={mirror} />
        </>
      )}
    </div>
  );
}
