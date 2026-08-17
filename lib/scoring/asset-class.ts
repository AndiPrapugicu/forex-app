/**
 * How a trader groups the universe, which is not quite how `SymbolKind` does.
 *
 * `SymbolKind` exists to drive scoring rules — which COT rule applies, whether
 * the rate cell is a differential — so it files metals and oil together as
 * `commodity` and files DXY as a `currency` because it scores like one. Neither
 * is how anyone reads a list of assets.
 *
 * Defined once here because two surfaces need the same grouping (the scorecard
 * index and the symbol switcher on each card), and two copies of a grouping is
 * two orders that eventually disagree.
 */

import type { SymbolDefinition, SymbolKind } from '@/config/symbols.config';

export const CLASS_ORDER = [
  'Forex',
  'Currency indices',
  'Metals',
  'Energy',
  'Indices',
  'Crypto',
] as const;

export type AssetClass = (typeof CLASS_ORDER)[number];

/** Only WTI is energy; the other three commodities are metals. */
const ENERGY = new Set(['WTIUSD']);

export function assetClassOf(symbol: string, kind: SymbolKind): AssetClass {
  if (kind === 'crypto') return 'Crypto';
  if (kind === 'index') return 'Indices';
  if (kind === 'commodity') return ENERGY.has(symbol) ? 'Energy' : 'Metals';
  if (kind === 'currency') return 'Currency indices';
  return 'Forex';
}

/** The universe in class order, for a grouped picker. */
export function groupByAssetClass<T extends Pick<SymbolDefinition, 'symbol' | 'kind'>>(
  symbols: T[],
): { assetClass: AssetClass; symbols: T[] }[] {
  const byClass = new Map<AssetClass, T[]>();
  for (const s of symbols) {
    const key = assetClassOf(s.symbol, s.kind);
    const list = byClass.get(key) ?? [];
    list.push(s);
    byClass.set(key, list);
  }

  return CLASS_ORDER.filter((c) => byClass.has(c)).map((assetClass) => ({
    assetClass,
    symbols: byClass.get(assetClass)!,
  }));
}
