'use client';

/**
 * Every symbol in one grouped `<select>`, navigating on change.
 *
 * Lifted out of the scorecard header so the AI Analysis page switches symbol the
 * same way. A plain select on purpose: fifty-one options grouped by asset class
 * is exactly what a native select is good at, it is keyboard- and touch-native,
 * and it costs no bundle.
 *
 * `hrefTemplate` carries `{symbol}` rather than taking a function, because a
 * server component cannot pass a function to a client one.
 */

import { useRouter } from 'next/navigation';

export interface SwitcherOption {
  symbol: string;
  label: string;
  assetClass: string;
  /** The board total and bias, printed in the option when present. */
  score?: number;
  bias?: string;
}

/** "EURUSD · EUR/USD   −3 Neutral". A native option holds text only, so the score is words, not colour. */
export function optionText(o: SwitcherOption): string {
  const base = `${o.symbol} · ${o.label}`;
  if (o.score === undefined) return base;
  const sign = o.score > 0 ? '+' : o.score < 0 ? '−' : '';
  return `${base}   ${sign}${Math.abs(o.score)} ${o.bias ?? ''}`.trimEnd();
}

export function SymbolSelect({
  symbol,
  options,
  hrefTemplate,
  className = '',
}: {
  symbol: string;
  options: SwitcherOption[];
  /** e.g. "/scorecard/{symbol}" or "/ai?symbol={symbol}". */
  hrefTemplate: string;
  className?: string;
}) {
  const router = useRouter();

  /** Preserve the order the caller sent, grouped, without re-sorting. */
  const groups: [string, SwitcherOption[]][] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last[0] === option.assetClass) last[1].push(option);
    else groups.push([option.assetClass, [option]]);
  }

  return (
    <select
      value={symbol}
      onChange={(e) => router.push(hrefTemplate.replace('{symbol}', encodeURIComponent(e.target.value)))}
      aria-label="Switch symbol"
      className={`rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-micro outline-none hover:border-[var(--color-border-bright)] ${className}`}
    >
      {groups.map(([assetClass, list]) => (
        <optgroup key={assetClass} label={assetClass}>
          {list.map((o) => (
            <option key={o.symbol} value={o.symbol}>
              {optionText(o)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
