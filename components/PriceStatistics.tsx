'use client';

/**
 * Price statistics, with the above/below reading taken against the LIVE price.
 *
 * The averages themselves never move. They are computed server-side from closed
 * bars, and a moving average that drifted with every tick would be a different
 * indicator from the one the trend cell scored. What does move is which side of
 * them the price is on, and that is the whole reason to look at this panel
 * intraday — a symbol that reclaimed its 50-day an hour ago should not read
 * "below" until the next page load.
 */

import { useLiveQuote } from '@/lib/hooks/useLiveQuotes';
import { Panel, formatPrice } from '@/components/ui';

export interface SmaRow {
  label: string;
  value: number | null;
  /** True for the two averages the trend cell actually reads. */
  scored: boolean;
}

export function PriceStatistics({
  symbol,
  smaRows,
  fallbackPrice,
  realizedVolPct,
  avgDailyMove7Pct,
  avgDailyMove90Pct,
}: {
  symbol: string;
  smaRows: SmaRow[];
  fallbackPrice: number | null;
  realizedVolPct: number | null;
  avgDailyMove7Pct: number | null;
  avgDailyMove90Pct: number | null;
}) {
  const quote = useLiveQuote(symbol, true);
  const price = quote?.price ?? fallbackPrice;

  return (
    <Panel
      title="Price statistics"
      subtitle={quote ? 'Above/below measured against the live price' : undefined}
    >
      <dl className="divide-y divide-[var(--color-border)]">
        {smaRows.map((s) => (
          <div key={s.label} className="flex items-center justify-between px-4 py-1.5">
            <dt
              className={`text-[11px] ${
                s.scored ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
              }`}
            >
              {s.label} SMA
              {s.scored && (
                <span className="ml-1.5 text-[9px] text-[var(--color-faint)]">scores trend</span>
              )}
            </dt>
            <dd className="flex items-center gap-2">
              <span className="tnum text-xs text-[var(--color-faint)]">
                {s.value === null ? '—' : formatPrice(s.value)}
              </span>
              {s.value !== null && price !== null && (
                <span
                  className={`text-[10px] font-medium ${
                    price > s.value ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'
                  }`}
                >
                  {price > s.value ? 'above' : 'below'}
                </span>
              )}
            </dd>
          </div>
        ))}

        {[
          { label: 'Realized vol (annual)', value: realizedVolPct },
          { label: 'Avg daily move (7d)', value: avgDailyMove7Pct },
          { label: 'Avg daily move (90d)', value: avgDailyMove90Pct },
        ].map((r) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-1.5">
            <dt className="text-[11px] text-[var(--color-muted)]">{r.label}</dt>
            <dd className="tnum text-xs">{r.value === null ? '—' : `${r.value}%`}</dd>
          </div>
        ))}
      </dl>

      <p className="border-t border-[var(--color-border)] px-4 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
        The averages come from closed bars and do not move with the tick — only which side of them
        the price is on.
      </p>
    </Panel>
  );
}
