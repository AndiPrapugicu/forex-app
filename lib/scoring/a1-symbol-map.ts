/**
 * A1's board/dropdown names, mapped onto this repo's symbols — shared by every
 * script that reads a captured fixture (`fixtures/a1-board.json`,
 * `fixtures/a1-top-setups-*.json`) and needs to match a row against our matrix.
 *
 * EXTRACTED BECAUSE THE TWO COPIES HAD ALREADY DRIFTED. `scripts/cross-day.ts`
 * carried PLATINUM and ETHEREUM; `scripts/top-setups-parity.ts` did not — not a
 * deliberate difference, just two edits to the same table made in different
 * scripts. A third script (`scripts/component-parity.ts`) needing the same table
 * a third time is what makes that drift worth closing rather than repeating.
 */

import { ALL_SYMBOLS } from '@/config/symbols.config';

/** A1's dropdown/board names -> this repo's symbols, carried over from prior rounds. */
export const NAME_MAP: Record<string, string> = {
  /**
   * ALL EIGHT INDEX ROWS, including AU-DOLLAR.
   *
   * AUDX was missing here until 2026-09-01, and the omission was invisible: an
   * unmapped A1 row is reported as "could not map" and skipped, so every parity
   * run this repo has ever produced quietly measured seven currencies and called
   * it eight. It was the row that most needed looking at — its total matches A1
   * exactly at +2 while three of its cells are wrong (Crowd -1/+1,
   * RetailSales +1/0, CnsmrConf +1/0), the cancelling-error pattern a total can
   * never show. See [[checksum-is-blind-to-cancelling-pairs]].
   */
  'US-DOLLAR': 'DXY', EURO: 'EURX', 'GB-POUND': 'GBPX', 'JP-YEN': 'JPYX',
  'NZ-DOLLAR': 'NZDX', 'CA-DOLLAR': 'CADX', 'CH-FRANC': 'CHFX',
  'AU-DOLLAR': 'AUDX',
  GOLD: 'XAUUSD', SILVER: 'XAGUSD', NIKKEI: 'JP225', COPPER: 'XCUUSD',
  RUSSELL: 'RUT2000', DOW: 'US30', USOIL: 'WTIUSD',
  PLATINUM: 'XPTUSD', ETHEREUM: 'ETHUSD',
  // Also absent until the 54-row 2026-08-31 capture named them.
  DAX: 'GER40', NASDAQ: 'NAS100', BITCOIN: 'BTCUSD',
};

/**
 * A1 columns this repo does not model as a scored symbol at all.
 *
 * The distinction from an unmapped name matters: these are DELIBERATE
 * omissions, and listing them here is what stops a parity report presenting
 * them as coverage we lost. NATGAS and CHINA50 are on A1's board and not on
 * ours; US10T is a yield, which the board scores as a price and we do not.
 */
export const NOT_MODELED = new Set(['US10T', 'NATGAS', 'CHINA50']);

/** A coarse asset-type label per our symbol, for grouping a parity report. */
export const ASSET_TYPE: Record<string, string> = {};
for (const def of ALL_SYMBOLS) {
  if (def.kind === 'currency') ASSET_TYPE[def.symbol] = 'Currency index';
  else if (def.kind === 'index') ASSET_TYPE[def.symbol] = 'Equity index';
  else if (def.kind === 'commodity') ASSET_TYPE[def.symbol] = 'Metal/Commodity';
  else if (def.base && def.quote) {
    ASSET_TYPE[def.symbol] = def.quote === 'USD' || def.base === 'USD' ? 'FX pair (dollar)' : 'FX pair (cross)';
  }
}


/**
 * A1's heatmap ROW NUMBER -> the Top Setups column it feeds.
 *
 * The row number is the real column identity; the board header is a label laid
 * over the top of it, and the two disagree. Slot 8 is the clearest case — the
 * board calls it "Cnsmr Conf" and the United States fills it with Wage Growth
 * YoY, while slot 7 is "PCE YoY" for the US and Household Spending for Japan.
 * A1's slots are POSITIONAL and per-country; ours are named. That difference is
 * the source of several apparent disagreements that are not disagreements.
 *
 * Verified by scripts/a1-surfaces.ts at 104/104 against their index rows.
 */
export const HEATMAP_ROW_TO_COLUMN: Record<number, string> = {
  1: 'GDP', 2: 'mPMI', 3: 'sPMI', 4: 'RetailSales', 5: 'CPI', 6: 'PPI',
  7: 'PCE', 8: 'CnsmrConf', 9: 'UnempRate', 10: 'NFP', 11: 'ADP',
  12: 'JOLTS', 13: 'UnempClaims',
};

/** A1's heatmap country codes against our currencies. */
export const HEATMAP_COUNTRY: Record<string, string> = {
  US: 'USD', EU: 'EUR', UK: 'GBP', JP: 'JPY',
  CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF',
};

/** Their heatmap country code, keyed by the board's index-row name. */
export const INDEX_ROW_COUNTRY: Record<string, string> = {
  'US-DOLLAR': 'US', EURO: 'EU', 'GB-POUND': 'UK', 'JP-YEN': 'JP',
  'CA-DOLLAR': 'CA', 'AU-DOLLAR': 'AU', 'NZ-DOLLAR': 'NZ', 'CH-FRANC': 'CH',
};

/**
 * A1's board column headers -> our slot keys.
 *
 * Lived as a private copy in `scripts/leg-parity.ts` and again in
 * `scripts/delta-parity.ts` before a third caller needed it. Same reason the
 * name table above is here: two copies of a mapping drift, and the drift is
 * silent because an unmapped column is simply not compared.
 *
 * `NFP` is their label for the employment slot on EVERY economy — only the US
 * series is actually called non-farm payrolls.
 */
export const A1_COLUMN_TO_SLOT: Record<string, string> = {
  Trend: 'trend', Seasonality: 'seasonality', COT: 'cot', Crowd: 'crowd',
  GDP: 'gdp', mPMI: 'mpmi', sPMI: 'spmi', RetailSales: 'retail-sales',
  CnsmrConf: 'consumer-confidence', CPI: 'cpi', PPI: 'ppi', PCE: 'pce',
  Rates: 'rates', NFP: 'employment', UnempRate: 'unemployment',
  UnempClaims: 'claims', ADP: 'adp', JOLTS: 'jolts',
};

/** The inverse, for reporting a slot under the header A1 prints. */
export const SLOT_TO_A1_COLUMN: Record<string, string> = Object.fromEntries(
  Object.entries(A1_COLUMN_TO_SLOT).map(([col, slot]) => [slot, col]),
);

/** A1's eight single-currency rows, in the order their board lists them. */
export const A1_INDEX_ROWS = [
  'US-DOLLAR', 'EURO', 'GB-POUND', 'JP-YEN',
  'AU-DOLLAR', 'NZ-DOLLAR', 'CA-DOLLAR', 'CH-FRANC',
] as const;

/** Board index-row name, keyed by currency — the inverse of `NAME_MAP` for the eight. */
export const CURRENCY_INDEX_ROW: Record<string, string> = {
  USD: 'US-DOLLAR', EUR: 'EURO', GBP: 'GB-POUND', JPY: 'JP-YEN',
  AUD: 'AU-DOLLAR', NZD: 'NZ-DOLLAR', CAD: 'CA-DOLLAR', CHF: 'CH-FRANC',
};
