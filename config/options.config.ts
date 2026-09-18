/**
 * Options pages: which chains we read, and A1's published put-call rule.
 *
 * A1's Put-Call page is per symbol (GOLD, SPX500, ...). No free exchange feed
 * serves per-symbol chains — Cboe's delayed-quote terms forbid automated
 * extraction — so each A1 symbol is read through the most liquid US ETF that
 * tracks it, from Yahoo's option chains. That is the same unofficial Yahoo host
 * every price in this app already comes from. Ledger
 * `options:no-public-per-symbol-chain-passes-the-gate` has the history.
 */

export type OptionsGroup = 'Indices' | 'Commodities' | 'Currencies';

export interface OptionsUnderlying {
  /** The A1 / board symbol this chain stands in for. */
  symbol: string;
  label: string;
  /** The listed ETF whose chain is read. */
  etf: string;
  group: OptionsGroup;
}

export const OPTIONS_UNDERLYINGS: readonly OptionsUnderlying[] = [
  { symbol: 'SPX500', label: 'S&P 500', etf: 'SPY', group: 'Indices' },
  { symbol: 'NASDAQ', label: 'Nasdaq 100', etf: 'QQQ', group: 'Indices' },
  { symbol: 'RUSSELL', label: 'Russell 2000', etf: 'IWM', group: 'Indices' },
  { symbol: 'DOW', label: 'Dow Jones', etf: 'DIA', group: 'Indices' },
  { symbol: 'GOLD', label: 'Gold', etf: 'GLD', group: 'Commodities' },
  { symbol: 'SILVER', label: 'Silver', etf: 'SLV', group: 'Commodities' },
  { symbol: 'USOIL', label: 'WTI crude', etf: 'USO', group: 'Commodities' },
  { symbol: 'NATGAS', label: 'Natural gas', etf: 'UNG', group: 'Commodities' },
  { symbol: 'USD', label: 'US dollar', etf: 'UUP', group: 'Currencies' },
  { symbol: 'EUR', label: 'Euro', etf: 'FXE', group: 'Currencies' },
  { symbol: 'GBP', label: 'British pound', etf: 'FXB', group: 'Currencies' },
  { symbol: 'JPY', label: 'Japanese yen', etf: 'FXY', group: 'Currencies' },
  { symbol: 'AUD', label: 'Australian dollar', etf: 'FXA', group: 'Currencies' },
  { symbol: 'CAD', label: 'Canadian dollar', etf: 'FXC', group: 'Currencies' },
  { symbol: 'CHF', label: 'Swiss franc', etf: 'FXF', group: 'Currencies' },
];

/**
 * A1's rule, read off their Put-Call Ratio page (fixtures/a1-full-access/INDEX.md):
 * a 5-day moving average of the ratio, with reference lines at 1.07 "High Call
 * Volume" and 1.20 "High Put Volume". Not tuned here — these are their numbers.
 */
export const PUT_CALL_MA_DAYS = 5;
export const PUT_CALL_BANDS = { highCallVolume: 1.07, highPutVolume: 1.2 } as const;

/**
 * The chart's FIXED y-axis, as A1 draws it (0 to 1.6).
 *
 * A ratio read against two thresholds must be drawn against those thresholds.
 * Auto-scaling to the stored sessions put GOLD's 1.48 at the top of the plot
 * with both bands crushed below it, which read as a broken chart rather than as
 * a high reading.
 */
export const PUT_CALL_CHART_DOMAIN = [0, 1.6] as const;

/** Expiries further out than this are left out: near-dated flow is the signal. */
export const OPTIONS_EXPIRY_HORIZON_DAYS = 45;
/** And no more than this many expiries per underlying, nearest first. */
export const OPTIONS_MAX_EXPIRIES = 6;

export const YAHOO_OPTIONS = {
  cookieUrl: 'https://fc.yahoo.com/',
  crumbUrl: 'https://query2.finance.yahoo.com/v1/test/getcrumb',
  chainBase: 'https://query2.finance.yahoo.com/v7/finance/options',
  /** Volume only changes during the US session; half an hour is plenty. */
  cacheTtlSeconds: 1800,
  /** Chains are fetched this many underlyings at a time. */
  batch: 3,
} as const;
