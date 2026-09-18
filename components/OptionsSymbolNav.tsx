/**
 * The symbol strip shared by the three options pages.
 *
 * Was copied into two of them and missing from the third, which is how Net
 * Options Volume ended up with no per-symbol view at all. One component, one
 * behaviour: a link per market, the current one outlined.
 */

import Link from 'next/link';

export function OptionsSymbolNav({
  symbols,
  selected,
  href,
  className = 'mb-3 flex flex-wrap gap-1',
}: {
  symbols: readonly string[];
  selected: string;
  /** Builds the destination for one symbol, e.g. `/options/volume?symbol=GOLD`. */
  href: (symbol: string) => string;
  className?: string;
}) {
  return (
    <nav aria-label="Symbol" className={className}>
      {symbols.map((symbol) => (
        <Link
          key={symbol}
          href={href(symbol)}
          aria-current={symbol === selected ? 'page' : undefined}
          className={`flex min-h-9 items-center rounded-[var(--radius-control)] border px-2.5 text-caption ${
            symbol === selected
              ? 'border-[var(--color-bull)] text-[var(--color-bull)]'
              : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          {symbol}
        </Link>
      ))}
    </nav>
  );
}
