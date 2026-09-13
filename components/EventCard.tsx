'use client';

/**
 * Event rows for the upcoming and recent-surprise panels.
 *
 * Recent prints always show actual / forecast / previous together — a bare
 * "142K" means nothing without what was expected, and showing the number alone
 * invites the reader to supply their own (usually wrong) baseline.
 */

import Link from 'next/link';
import type { EventScore, NormalizedEvent } from '@/lib/types';
import { ScoreBar } from '@/components/Gauge';
import {
  CurrencyChip,
  ImpactBadge,
  SourceBadge,
  formatScore,
  formatValue,
  scoreColor,
  timeAgo,
  utcTime,
} from '@/components/ui';

export function UpcomingEventRow({ event, now }: { event: NormalizedEvent; now: number }) {
  return (
    <Link
      href={`/event/${event.id}`}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-2)]"
    >
      <div className="flex w-16 shrink-0 flex-col">
        <span className="tnum text-xs font-semibold text-[var(--color-text)]">
          {utcTime(event.dateUtc)}
        </span>
        <span className="tnum text-micro text-[var(--color-faint)]">
          {timeAgo(event.dateUtc, now)}
        </span>
      </div>

      <ImpactBadge impact={event.impact} />
      <CurrencyChip currency={event.currency} />

      <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]">{event.name}</span>

      <div className="hidden shrink-0 items-center gap-3 text-right sm:flex">
        <div className="flex flex-col">
          <span className="text-micro tracking-wide text-[var(--color-faint)] uppercase">Fcst</span>
          <span className="tnum text-xs text-[var(--color-muted)]">
            {formatValue(event.consensus, event.unit)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-micro tracking-wide text-[var(--color-faint)] uppercase">Prev</span>
          <span className="tnum text-xs text-[var(--color-faint)]">
            {formatValue(event.previous, event.unit)}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function RecentEventRow({
  event,
  score,
  now,
}: {
  event: NormalizedEvent;
  score: EventScore;
  now: number;
}) {
  const beat = event.consensus !== null && event.actual !== null && event.actual > event.consensus;
  const miss = event.consensus !== null && event.actual !== null && event.actual < event.consensus;

  return (
    <Link
      href={`/event/${event.id}`}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-2)]"
    >
      <div className="flex w-14 shrink-0 flex-col">
        <span className="tnum text-micro text-[var(--color-muted)]">{timeAgo(event.dateUtc, now)}</span>
      </div>

      <ImpactBadge impact={event.impact} />
      <CurrencyChip currency={event.currency} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm text-[var(--color-text)]">{event.name}</span>
          {event.actualSource && event.actualSource !== 'fxstreet' && (
            <SourceBadge source={event.actualSource} />
          )}
        </div>

        <div className="tnum mt-0.5 flex items-center gap-2 text-micro">
          {/* Actual is coloured by beat/miss, which is a factual comparison —
              distinct from the bullish/bearish verdict on the right. */}
          <span
            className={
              beat
                ? 'font-semibold text-[var(--color-bull)]'
                : miss
                  ? 'font-semibold text-[var(--color-bear)]'
                  : 'font-semibold text-[var(--color-text)]'
            }
          >
            {formatValue(event.actual, event.unit)}
          </span>
          <span className="text-[var(--color-faint)]">
            vs {formatValue(event.consensus, event.unit)} fcst
          </span>
          <span className="text-[var(--color-faint)]">
            · prev {formatValue(event.previous, event.unit)}
          </span>
          {score.surprise !== null && (
            <span className="text-[var(--color-muted)]">
              {score.surprise > 0 ? '+' : ''}
              {score.surprise}σ
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ScoreBar score={score.score} direction={score.direction} confidence={score.confidence} width={70} height={6} />
        <span className={`tnum w-10 text-right text-sm font-bold ${scoreColor(score.score, score.direction)}`}>
          {score.direction === 'uncertain' ? '?' : formatScore(score.score)}
        </span>
      </div>
    </Link>
  );
}
