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
import { PageHeader } from '@/components/primitives';
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
  initialView = 'full',
  initialDayDeltas = {},
  initialDayDeltaComparedWithUtc = null,
}: {
  /** Score change over 24h per symbol, from stored snapshots. */
  initialDayDeltas?: Record<string, number | null>;
  /** The capture those deltas are measured from — never assumed to be exactly a day. */
  initialDayDeltaComparedWithUtc?: string | null;
  /** From `/?view=`; the matrix keeps the URL in step when the view changes. */
  initialView?: 'full' | 'simple' | 'macro';
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
  const [dayDeltas, setDayDeltas] = useState<Record<string, number | null>>(initialDayDeltas);
  const [dayDeltaSince, setDayDeltaSince] = useState<string | null>(initialDayDeltaComparedWithUtc);
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
      setDayDeltas(data.dayDeltas ?? {});
      setDayDeltaSince(data.dayDeltaComparedWithUtc ?? null);
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
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Top Setups"
        description={
          `${rows.length} symbols scored across ${SCORING_SLOTS.length} indicators` +
          (MATRIX_SLOTS.length > SCORING_SLOTS.length
            ? ` (+${MATRIX_SLOTS.length - SCORING_SLOTS.length} shown as context)`
            : '') +
          (matrix?.cotReportDate ? ` · COT as of ${matrix.cotReportDate}` : '')
        }
        info={
          <>
            Each row sums {SCORING_SLOTS.length} indicators, each scored from -2 to +2. A total of +7 or
            more is Very Bullish, +4 Bullish, -4 Bearish and -7 or less Very Bearish; anything between
            is Neutral. Tap a symbol for the full scorecard.
          </>
        }
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

      {matrix && (
        <div className="mb-4 grid grid-cols-3 gap-2 md:max-w-md">
          <Stat label="Bullish" value={bullish} tone="text-[var(--color-bull)]" />
          <Stat label="Bearish" value={bearish} tone="text-[var(--color-bear)]" />
          <Stat label="Neutral" value={rows.length - bullish - bearish} tone="text-[var(--color-muted)]" />
        </div>
      )}

      <div className="mb-4">
        <SourceHealthBar health={health} />
      </div>

      {!matrix ? (
        error ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-bear)]/30 bg-[var(--color-surface)] p-8 text-center">
            <p className="text-body text-[var(--color-bear)]">Could not build the scorecard</p>
            <p className="mt-1 text-caption text-[var(--color-muted)]">{error}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-4 min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border-bright)] px-4 text-small hover:bg-[var(--color-surface-2)]"
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
          <SetupsMatrix rows={matrix.rows} cotReportDate={matrix.cotReportDate} mirror={mirror} initialView={initialView} dayDeltas={dayDeltas} dayDeltaSince={dayDeltaSince} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <div className={`tnum text-title font-semibold ${tone}`}>{value}</div>
      <div className="text-micro tracking-wider text-[var(--color-faint)] uppercase">{label}</div>
    </div>
  );
}
