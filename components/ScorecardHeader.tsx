'use client';

/**
 * The scorecard's header: which asset, what it costs right now, and a way to
 * get to another one without going back to a list.
 *
 * The switcher is what turns this page from a drill-down into a tab. It is a
 * plain `<select>` rather than a combobox on purpose — fifty-one options grouped
 * by asset class is exactly what a native select is good at, it is keyboard- and
 * touch-native, and it costs no bundle.
 */

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { freshnessOf, useLiveQuote } from '@/lib/hooks/useLiveQuotes';
import { changeColor, formatChangePct, formatPrice } from '@/components/ui';

export interface SwitcherOption {
  symbol: string;
  label: string;
  assetClass: string;
}

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
  const router = useRouter();
  const quote = useLiveQuote(symbol, true);

  const price = quote?.price ?? fallbackPrice;
  const change = quote?.changePct ?? fallbackChangePct;
  const freshness = freshnessOf(quote);

  /** Preserve the order the caller sent, grouped, without re-sorting. */
  const groups: [string, SwitcherOption[]][] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last[0] === option.assetClass) last[1].push(option);
    else groups.push([option.assetClass, [option]]);
  }

  return (
    <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <Link href="/scorecard" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]">
        ← All assets
      </Link>

      <h1 className="text-xl font-bold">{label}</h1>

      <select
        value={symbol}
        onChange={(e) => router.push(`/scorecard/${e.target.value}`)}
        aria-label="Switch symbol"
        className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[11px] outline-none hover:border-[var(--color-border-bright)]"
      >
        {groups.map(([assetClass, list]) => (
          <optgroup key={assetClass} label={assetClass}>
            {list.map((o) => (
              <option key={o.symbol} value={o.symbol}>
                {o.symbol} · {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

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
            <span className="self-center text-[10px] text-[var(--color-uncertain)]">
              {freshness.label}
            </span>
          )}
        </span>
      )}
    </header>
  );
}
