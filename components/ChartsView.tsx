'use client';

/**
 * Indicator history page shell: currency picker and the chart grid.
 *
 * The currency lives in the URL rather than component state so a particular
 * view is linkable and survives a refresh.
 */

import Link from 'next/link';
import type { IndicatorSeries } from '@/lib/scoring/indicator-history';
import { IndicatorChart } from '@/components/IndicatorChart';
import { EmptyState, Panel } from '@/components/ui';
import { MAJORS, type Currency } from '@/lib/types';

export function ChartsView({
  currency,
  series,
}: {
  currency: Currency;
  series: IndicatorSeries[];
}) {
  return (
    <div className="px-4 py-4">
      <header className="mb-4 flex flex-wrap items-baseline gap-3">
        <div>
          <h1 className="text-lg font-bold">Indicator History</h1>
          <p className="text-xs text-[var(--color-faint)]">
            Actual vs forecast over the last 150 days · {series.length} series available
          </p>
        </div>

        <nav className="ml-auto flex flex-wrap gap-1" aria-label="Currency">
          {MAJORS.map((c) => (
            <Link
              key={c}
              href={`/charts?currency=${c}`}
              aria-current={c === currency ? 'page' : undefined}
              className={`rounded px-2.5 py-1 font-mono text-[11px] transition-colors ${
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
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {series.map((s) => (
            <IndicatorChart key={s.slotKey} series={s} />
          ))}
        </div>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-[var(--color-faint)]">
        Series are resolved with the same rules the scorecard uses, so a chart here always refers to the
        same release the Top Setups matrix scored. The window is 150 days — roughly five monthly prints.
        Longer history needs the calendar backfilled into Postgres, which is worth doing once Supabase
        is set up.
      </p>
    </div>
  );
}
