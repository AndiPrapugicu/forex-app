/**
 * The REACTION reader: "X just moved — what happened?"
 *
 * A fixed panel of instruments read off Yahoo's 5-minute bars, the thresholds
 * that make a move worth naming, and the cross-asset patterns those moves
 * form. Nothing here is fitted; each band is a round number a trader would use,
 * and each pattern is the textbook reading of stocks against yields.
 *
 * Context for the analyst only. Nothing here feeds the board or the narrative.
 */

export type ReactionGroup = 'equities' | 'rates' | 'dollar' | 'havens' | 'commodities' | 'volatility' | 'crypto';

export interface ReactionInstrument {
  ticker: string;
  label: string;
  group: ReactionGroup;
  /**
   * How a move is stated. `yield` tickers quote a yield in percent, so their
   * change is in basis points; `note-futures` quote a PRICE, so a yield change is
   * derived from it (see `duration`); everything else is a percent change.
   */
  unit: 'pct' | 'yield' | 'note-futures';
  /** Modified duration, for turning a note future's price change into an approximate yield change. */
  duration?: number;
}

/**
 * The panel. ZT=F stands in for the 2-year because Yahoo has no intraday 2-year
 * yield; the cash yield indices (^FVX, ^TNX, ^TYX) only print during US hours.
 */
export const REACTION_PANEL: ReactionInstrument[] = [
  { ticker: 'NQ=F', label: 'Nasdaq 100 futures', group: 'equities', unit: 'pct' },
  { ticker: 'ES=F', label: 'S&P 500 futures', group: 'equities', unit: 'pct' },
  { ticker: 'RTY=F', label: 'Russell 2000 futures', group: 'equities', unit: 'pct' },
  // Two-year note futures: duration about 1.9 (CBOT ZT, cheapest-to-deliver).
  { ticker: 'ZT=F', label: 'US 2Y (from ZT futures)', group: 'rates', unit: 'note-futures', duration: 1.9 },
  { ticker: '^FVX', label: 'US 5Y yield', group: 'rates', unit: 'yield' },
  { ticker: '^TNX', label: 'US 10Y yield', group: 'rates', unit: 'yield' },
  { ticker: '^TYX', label: 'US 30Y yield', group: 'rates', unit: 'yield' },
  { ticker: 'DX-Y.NYB', label: 'Dollar index', group: 'dollar', unit: 'pct' },
  { ticker: 'JPY=X', label: 'USD/JPY', group: 'havens', unit: 'pct' },
  { ticker: 'CHF=X', label: 'USD/CHF', group: 'havens', unit: 'pct' },
  { ticker: 'GC=F', label: 'Gold', group: 'havens', unit: 'pct' },
  { ticker: 'CL=F', label: 'WTI crude', group: 'commodities', unit: 'pct' },
  { ticker: 'BZ=F', label: 'Brent crude', group: 'commodities', unit: 'pct' },
  { ticker: 'HG=F', label: 'Copper', group: 'commodities', unit: 'pct' },
  { ticker: '^VIX', label: 'VIX', group: 'volatility', unit: 'pct' },
  { ticker: 'BTC-USD', label: 'Bitcoin', group: 'crypto', unit: 'pct' },
];

/**
 * The symbol's own intraday ticker, where its daily one does not trade around
 * the clock: the cash indices print only in their session, the futures do not
 * stop. Anything not listed reads its own `yahoo` ticker.
 */
export const INTRADAY_TICKER: Record<string, string> = {
  NAS100: 'NQ=F',
  SPX500: 'ES=F',
  US30: 'YM=F',
  RUT2000: 'RTY=F',
};

export const REACTION = {
  /** How far back the 5-minute bars go. Two days covers an overnight move. */
  range: '2d',
  interval: '5m',
  /** The look-back the move finder searches for the largest swing. */
  searchHours: 8,
  /** Fixed windows reported for every instrument, in hours. */
  windows: [1, 2, 4] as const,
  /** Below these a move is "flat" for the pattern. */
  flat: { pct: 0.25, bp: 2.5 },
  /** A move this large is "sharp". */
  sharp: { pct: 1, bp: 8 },
  /** Curve shape: one end must lead the other by this many bp. */
  curveLeadBp: 1.5,
  /** Headlines this long before the move began can still be its cause. */
  catalystLeadMinutes: 90,
  /** Most catalysts listed. */
  catalystsShown: 8,
  /** Cache for the batch call: a reaction question is about the last minutes. */
  cacheTtlSeconds: 60,
};

/**
 * A move verb makes a question about a move that already happened ("dropped",
 * "a scăzut"). "What happened today?" alone is a recap, not a move, and stays BRIEF.
 */
export const REACTION_WORDS =
  /\b(dropp?ed|drops|fell|plunged?|plunging|tanked|tanking|crash(ed|ing)?|sold off|sell-?off|dumped|dumping|spiked?|spiking|jumped|surged?|soared|rallied|ripped|pumped|whipsaw\w*|a (scăzut|scazut|crescut|căzut|cazut|picat|sărit|sarit|explodat)|scade|scad|crește|creste)\b/i;
