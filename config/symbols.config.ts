/**
 * The 33 symbols on the scorecard, each mapped to its price ticker, its COT
 * contract, and its currency legs.
 *
 * All 28 pair tickers were verified against Yahoo before being written here, and
 * every CFTC contract name was read from the live report rather than guessed —
 * they are irregular ("NZ DOLLAR", not "NEW ZEALAND DOLLAR"; "WTI-PHYSICAL",
 * not "CRUDE OIL") and a typo produces a silently empty COT column rather than
 * an error.
 */

import type { Asset, Currency } from '@/lib/types';

export type SymbolKind = 'fx' | 'commodity' | 'index';

export interface SymbolDefinition {
  /** Display symbol, and the URL segment for /scorecard/[symbol]. */
  symbol: string;
  label: string;
  kind: SymbolKind;
  /** Yahoo Finance ticker for price history. */
  yahoo: string;

  /**
   * Currency legs. Fundamentals for a pair are base-minus-quote, so both matter.
   * Commodities have a base asset and no quote leg.
   */
  base?: Currency;
  quote?: Currency;
  asset?: Asset;

  /**
   * Exact CFTC `contract_market_name`. Absent means no COT column for this
   * symbol — crosses like EURGBP have no single contract, so their COT cell is
   * derived from the two legs' own contracts instead.
   */
  cotContract?: string;
}

/**
 * CFTC contracts per currency, verified present in the 2026-08-04 report.
 * Used both for the FX majors directly and for deriving cross-pair COT.
 */
export const CURRENCY_COT_CONTRACT: Record<Currency, string> = {
  USD: 'USD INDEX',
  EUR: 'EURO FX',
  GBP: 'BRITISH POUND',
  JPY: 'JAPANESE YEN',
  AUD: 'AUSTRALIAN DOLLAR',
  NZD: 'NZ DOLLAR',
  CAD: 'CANADIAN DOLLAR',
  CHF: 'SWISS FRANC',
};

const MAJORS: Currency[] = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

/**
 * All 28 unique combinations of the 8 majors.
 *
 * Order follows market convention rather than being alphabetised: EUR outranks
 * GBP outranks AUD/NZD outranks USD outranks CAD/CHF/JPY. Quoting EURUSD (not
 * USDEUR) matters because every score's sign is expressed relative to the base.
 */
function buildFxPairs(): SymbolDefinition[] {
  const out: SymbolDefinition[] = [];
  for (let i = 0; i < MAJORS.length; i++) {
    for (let j = i + 1; j < MAJORS.length; j++) {
      const base = MAJORS[i];
      const quote = MAJORS[j];
      const symbol = `${base}${quote}`;
      out.push({
        symbol,
        label: `${base}/${quote}`,
        kind: 'fx',
        yahoo: `${symbol}=X`,
        base,
        quote,
      });
    }
  }
  return out;
}

export const FX_SYMBOLS = buildFxPairs();

export const COMMODITY_SYMBOLS: SymbolDefinition[] = [
  { symbol: 'XAUUSD', label: 'Gold', kind: 'commodity', yahoo: 'GC=F', asset: 'XAU', quote: 'USD', cotContract: 'GOLD' },
  { symbol: 'XAGUSD', label: 'Silver', kind: 'commodity', yahoo: 'SI=F', asset: 'XAG', quote: 'USD', cotContract: 'SILVER' },
  { symbol: 'XPTUSD', label: 'Platinum', kind: 'commodity', yahoo: 'PL=F', asset: 'XPT', quote: 'USD', cotContract: 'PLATINUM' },
  { symbol: 'WTIUSD', label: 'WTI Crude', kind: 'commodity', yahoo: 'CL=F', asset: 'WTI', quote: 'USD', cotContract: 'WTI-PHYSICAL' },
];

export const INDEX_SYMBOLS: SymbolDefinition[] = [
  {
    symbol: 'DXY',
    label: 'Dollar Index',
    kind: 'index',
    yahoo: 'DX-Y.NYB',
    base: 'USD',
    cotContract: 'USD INDEX',
  },
];

export const ALL_SYMBOLS: SymbolDefinition[] = [
  ...FX_SYMBOLS,
  ...COMMODITY_SYMBOLS,
  ...INDEX_SYMBOLS,
];

export function findSymbol(symbol: string): SymbolDefinition | undefined {
  const target = symbol.toUpperCase();
  return ALL_SYMBOLS.find((s) => s.symbol === target);
}

/** Every distinct CFTC contract we need to fetch, deduped. */
export const REQUIRED_COT_CONTRACTS: string[] = [
  ...new Set([
    ...Object.values(CURRENCY_COT_CONTRACT),
    ...ALL_SYMBOLS.map((s) => s.cotContract).filter((c): c is string => !!c),
  ]),
];

/** Yahoo tickers needed for technicals, deduped. */
export const REQUIRED_YAHOO_TICKERS: string[] = [...new Set(ALL_SYMBOLS.map((s) => s.yahoo))];
