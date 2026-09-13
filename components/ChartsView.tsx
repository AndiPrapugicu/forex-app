'use client';

/**
 * Indicator history page: a scannable grid of compact cards, one per series,
 * expanding to the full chart on demand.
 *
 * THE PROBLEM THIS SOLVES. The page used to render every series as a 260px
 * chart stacked one per row — thirteen of them for USD, so answering "how has
 * this economy been printing lately" meant scrolling through half a screen of
 * axis per indicator and holding the answers in your head. The charts were fine;
 * there were just far too many of them at full size at once.
 *
 * The fix is a summary layer, not a smaller chart. Each card leads with the
 * three numbers actually being looked for — latest actual, the forecast it beat
 * or missed, and the run of recent prints as a sparkline — and the full chart is
 * one click away for the one series that turns out to be interesting. Grouping
 * by growth / inflation / jobs mirrors the scorecard, so the same mental model
 * carries across pages.
 *
 * The currency stays in the URL rather than component state, so a particular
 * view is linkable and survives a refresh. The expanded series is deliberately
 * NOT in the URL — it is a transient "look closer", not a place.
 */

import Link from 'next/link';
import { useState } from 'react';
import type { SlotCategory } from '@/config/setups.config';
import type { IndicatorPoint, IndicatorSeries } from '@/lib/scoring/indicator-history';
import { IndicatorChart } from '@/components/IndicatorChart';
import { EmptyState, Panel } from '@/components/ui';
import { MAJORS, type Currency } from '@/lib/types';

/** Section order, matching the scorecard's category order. */
const GROUPS: { category: SlotCategory; label: string; hint: string }[] = [
  { category: 'growth', label: 'Growth', hint: 'Output, activity and demand' },
  { category: 'inflation', label: 'Inflation', hint: 'Prices and cost pressure' },
  { category: 'jobs', label: 'Jobs', hint: 'Labour market' },
];

const BULL = 'rgba(58,122,224,0.85)';
const BEAR = 'rgba(242,80,110,0.8)';
const FLAT = 'rgba(107,119,148,0.7)';

/** Beat, missed, or matched — the only comparison this page makes. */
function outcome(p: IndicatorPoint | undefined): 'beat' | 'miss' | 'flat' {
  if (!p || p.surprise === null) return 'flat';
  if (p.surprise > 0) return 'beat';
  if (p.surprise < 0) return 'miss';
  return 'flat';
}

function outcomeColor(o: ReturnType<typeof outcome>): string {
  return o === 'beat' ? BULL : o === 'miss' ? BEAR : FLAT;
}

function outcomeClass(o: ReturnType<typeof outcome>): string {
  return o === 'beat'
    ? 'text-[var(--color-bull)]'
    : o === 'miss'
      ? 'text-[var(--color-bear)]'
      : 'text-[var(--color-faint)]';
}

/** Trims float noise without pretending to a precision the release lacks. */
function num(v: number): string {
  return `${Math.round(v * 1000) / 1000}`;
}

/**
 * The last dozen prints as bars, coloured beat/miss.
 *
 * Scaled between the series min and max rather than from zero, because these
 * live inside a 34px strip where a zero baseline would flatten every PMI in the
 * set to an identical block. The floor is 12% rather than 0 so the lowest print
 * still reads as a low bar instead of as missing data — the same trap the full
 * chart's baseline comment describes.
 */
function Sparkline({ points, unit }: { points: IndicatorPoint[]; unit: string | null }) {
  const shown = points.slice(-12);
  const values = shown.map((p) => p.actual);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;

  return (
    <div className="flex h-[34px] items-end gap-[3px]" aria-hidden>
      {shown.map((p) => {
        const pct = span === 0 ? 60 : 12 + ((p.actual - lo) / span) * 88;
        return (
          <div
            key={p.dateUtc}
            className="min-w-0 flex-1 rounded-[1px]"
            style={{ height: `${pct}%`, backgroundColor: outcomeColor(outcome(p)) }}
            title={`${p.dateUtc.slice(0, 10)} · ${num(p.actual)}${unit ?? ''}`}
          />
        );
      })}
    </div>
  );
}

/**
 * One series at a glance.
 *
 * Rendered as a button because clicking it does something; a div with an
 * onClick would leave the page unusable from a keyboard.
 */
function IndicatorCard({
  series,
  open,
  onToggle,
}: {
  series: IndicatorSeries;
  open: boolean;
  onToggle: () => void;
}) {
  const latest = series.points[series.points.length - 1];
  const o = outcome(latest);
  const unit = series.unit ?? '';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`flex flex-col gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        open
          ? 'border-[var(--color-bull)]/60 bg-[var(--color-surface-2)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-muted)]/50 hover:bg-[var(--color-surface-2)]/60'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-micro font-semibold tracking-wide">{series.label}</span>
        <span className="tnum ml-auto shrink-0 text-micro text-[var(--color-faint)]">
          {latest.dateUtc.slice(0, 10)}
        </span>
      </div>

      <p className="-mt-1.5 truncate text-micro text-[var(--color-faint)]" title={series.eventName}>
        {series.eventName}
      </p>

      <div className="flex items-baseline gap-1.5">
        <span className="tnum text-lg leading-none font-semibold">
          {num(latest.actual)}
          <span className="text-xs font-normal text-[var(--color-muted)]">{unit}</span>
        </span>
        {latest.consensus !== null && (
          <span className={`tnum text-micro font-medium ${outcomeClass(o)}`}>
            {(latest.surprise ?? 0) > 0 ? '+' : ''}
            {num(latest.surprise ?? 0)}
          </span>
        )}
      </div>

      <div className="-mt-1 text-micro text-[var(--color-faint)]">
        {latest.consensus === null ? (
          'no forecast published'
        ) : (
          <>
            vs{' '}
            <span className="tnum">
              {num(latest.consensus)}
              {unit}
            </span>{' '}
            forecast
          </>
        )}
      </div>

      <Sparkline points={series.points} unit={series.unit} />

      <div className="flex items-center gap-2 text-micro text-[var(--color-faint)]">
        <span>
          {series.beatRatePct === null ? 'no forecasts' : `beat ${series.beatRatePct}% of the time`}
        </span>
        <span className="ml-auto text-[var(--color-muted)]">{open ? 'hide chart' : 'chart'}</span>
      </div>
    </button>
  );
}

export function ChartsView({
  currency,
  series,
}: {
  currency: Currency;
  series: IndicatorSeries[];
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  /**
   * How the most recent round of prints actually went.
   *
   * The single most useful number on the page and the one the old layout made
   * hardest to get: it needed scrolling past thirteen charts and counting bar
   * colours by hand.
   */
  const latestOutcomes = series.map((s) => outcome(s.points[s.points.length - 1]));
  const beats = latestOutcomes.filter((o) => o === 'beat').length;
  const misses = latestOutcomes.filter((o) => o === 'miss').length;

  const grouped = GROUPS.map((g) => ({
    ...g,
    items: series.filter((s) => s.category === g.category),
  })).filter((g) => g.items.length > 0);

  /** Anything in a category the groups above do not name still gets shown. */
  const ungrouped = series.filter((s) => !GROUPS.some((g) => g.category === s.category));

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      {/*
        Sticky, because the currency switcher is the page's main control and
        scrolling to a series only to have to scroll back up to change economy
        was half the friction.
      */}
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg leading-tight font-bold">Indicator History</h1>
          <p className="text-xs text-[var(--color-faint)]">
            Actual vs forecast, last 150 days · {series.length} series
          </p>
        </div>

        {series.length > 0 && (
          <div className="flex items-baseline gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-micro">
            <span className="text-micro tracking-wider text-[var(--color-faint)] uppercase">
              Latest print
            </span>
            <span className="tnum font-semibold text-[var(--color-bull)]">{beats} beat</span>
            <span className="tnum font-semibold text-[var(--color-bear)]">{misses} missed</span>
          </div>
        )}

        <nav className="ml-auto flex flex-wrap gap-1" aria-label="Currency">
          {MAJORS.map((c) => (
            <Link
              key={c}
              href={`/charts?currency=${c}`}
              aria-current={c === currency ? 'page' : undefined}
              className={`rounded px-2.5 py-1 font-mono text-micro transition-colors ${
                c === currency
                  ? 'bg-[var(--color-bull)]/15 font-semibold text-[var(--color-bull)]'
                  : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
              }`}
            >
              {c}
            </Link>
          ))}
        </nav>
      </header>

      {series.length === 0 ? (
        <Panel title={`${currency} indicators`}>
          <EmptyState
            message={`No series with enough history for ${currency}`}
            hint="A series needs at least two released prints inside the 150-day window"
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-6">
          {[...grouped, ...(ungrouped.length > 0 ? [{ category: 'other' as const, label: 'Other', hint: '', items: ungrouped }] : [])].map(
            (group) => (
              <section key={group.category}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-micro font-semibold tracking-wider text-[var(--color-muted)] uppercase">
                    {group.label}
                  </h2>
                  <span className="text-micro text-[var(--color-faint)]">{group.hint}</span>
                  <span className="tnum ml-auto text-micro text-[var(--color-faint)]">
                    {group.items.length}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {group.items.map((s) => (
                    <IndicatorCard
                      key={s.slotKey}
                      series={s}
                      open={openKey === s.slotKey}
                      onToggle={() => setOpenKey(openKey === s.slotKey ? null : s.slotKey)}
                    />
                  ))}

                  {/*
                    The expanded chart sits at the end of its own group rather
                    than immediately under the card that opened it. Inserting it
                    mid-grid would need the column count, which is a media query
                    and not knowable here — and a chart that lands in a different
                    place depending on viewport width is worse than one that
                    always lands at the foot of its section.
                  */}
                  {group.items.some((s) => s.slotKey === openKey) && (
                    <div className="col-span-full">
                      <IndicatorChart series={group.items.find((s) => s.slotKey === openKey)!} />
                    </div>
                  )}
                </div>
              </section>
            ),
          )}
        </div>
      )}

      <p className="mt-6 text-micro leading-relaxed text-[var(--color-faint)]">
        Blue is a print above forecast, red below — the comparison, not the verdict: a hot
        unemployment number beats its forecast and is still bad news. Series resolve with the same
        rules the scorecard uses, so a chart here always refers to the release the Top Setups matrix
        scored. The 150-day window is roughly five monthly prints; longer history needs the calendar
        backfilled into Postgres.
      </p>
    </div>
  );
}
