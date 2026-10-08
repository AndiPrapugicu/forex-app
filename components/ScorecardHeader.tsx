'use client';

/**
 * The scorecard's header: which asset, what it costs right now, and a way to
 * get to another one without going back to a list.
 *
 * The switcher is what turns this page from a drill-down into a tab. It lives
 * in `SymbolSelect`, shared with AI Analysis, which says why it is a plain
 * `<select>`.
 */

import Link from 'next/link';
import { freshnessOf, useLiveQuote } from '@/lib/hooks/useLiveQuotes';
import { SymbolSelect, type SwitcherOption } from '@/components/SymbolSelect';
import { changeColor, formatChangePct, formatPrice } from '@/components/ui';

export type { SwitcherOption };

export function ScorecardHeader({
  symbol,
  label,
  options,
  /** Server-rendered price, shown until the first live tick lands. */
  fallbackPrice,
  fallbackChangePct,
}: {
  symbol: string;
  label: string;
  options: SwitcherOption[];
  fallbackPrice: number | null;
  fallbackChangePct: number | null;
}) {
  const quote = useLiveQuote(symbol, true);

  const price = quote?.price ?? fallbackPrice;
  const change = quote?.changePct ?? fallbackChangePct;
  const freshness = freshnessOf(quote);

  return (
    <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <Link href="/scorecard" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">
        ← All assets
      </Link>

      <h1 className="text-xl font-bold">{label}</h1>

      <SymbolSelect symbol={symbol} options={options} hrefTemplate="/scorecard/{symbol}" />

      {price !== null && (
        <span className="tnum flex items-baseline gap-1.5 text-sm text-[var(--color-muted)]">
          {/*
            formatPrice, NOT toLocaleString. The default locale format caps at
            three fraction digits, which rendered EURUSD's 1.15550 as "1.156" —
            a pip and a half of invented imprecision on the first number anyone
            looks at.
          */}
          <span className="text-[var(--color-text)]">{formatPrice(price)}</span>
          <span className={changeColor(change)}>{formatChangePct(change)}</span>
          {/*
            Two claims, and only the first was ever checked: that we are polling,
            and that what comes back is current. A futures-priced symbol arrives
            exactly ten minutes late, so the dot now reflects the quote's own
            stamp rather than merely the fact that a request succeeded.
          */}
          <span
            className={`inline-block h-1.5 w-1.5 self-center rounded-full ${
              freshness.kind === 'live'
                ? 'animate-pulse bg-[var(--color-bull)]'
                : 'bg-[var(--color-uncertain)]'
            }`}
            title={`${freshness.detail} Nothing else on this page is live.`}
          />
          {freshness.kind !== 'live' && (
            <span className="self-center text-micro text-[var(--color-uncertain)]">
              {freshness.label}
            </span>
          )}
        </span>
      )}
    </header>
  );
}
