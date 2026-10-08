/**
 * Filtering the symbol picker by board bias.
 *
 * "Bullish" includes Very Bullish (total ≥ +4), "Bearish" includes Very
 * Bearish (≤ −4) — the board's own cuts, read off the bias label rather than
 * re-derived here. Within a filter each asset class is sorted strongest first.
 * The current symbol always stays in the list, or the select would display
 * whatever came first while the page is about something else.
 */

export type BiasFilter = 'all' | 'bullish' | 'bearish' | 'neutral';

export interface FilterableOption {
  symbol: string;
  assetClass: string;
  score?: number;
  bias?: string;
}

export function matchesBias(o: FilterableOption, filter: BiasFilter): boolean {
  if (filter === 'all') return true;
  const bias = (o.bias ?? '').toLowerCase();
  if (filter === 'bullish') return bias.includes('bullish');
  if (filter === 'bearish') return bias.includes('bearish');
  return bias === 'neutral';
}

export function filterByBias<T extends FilterableOption>(options: T[], filter: BiasFilter, current: string): T[] {
  const kept = options.filter((o) => o.symbol === current || matchesBias(o, filter));
  if (filter === 'all') return kept;
  const classOrder = [...new Set(options.map((o) => o.assetClass))];
  const strength = (o: T) => {
    const s = o.score ?? 0;
    return filter === 'bearish' ? -s : filter === 'bullish' ? s : -Math.abs(s);
  };
  return [...kept].sort(
    (a, b) => classOrder.indexOf(a.assetClass) - classOrder.indexOf(b.assetClass) || strength(b) - strength(a),
  );
}
