/**
 * The Top Setups scorecard: which indicators occupy which column, how a raw
 * surprise becomes a -2..+2 cell, and where the bias labels cut.
 *
 * Everything here is data. The matrix builder in lib/scoring/setups.ts contains
 * no indicator knowledge at all — if a column looks wrong, the fix is in this
 * file.
 *
 * The name patterns below were derived from two years of real FXStreet data
 * (19,856 major-currency events), not guessed. Two traps that cost real accuracy
 * if you get them wrong:
 *
 *  1. EUR events span the whole currency union. "Consumer Price Index (YoY)" for
 *     EUR is a MEMBER STATE print (DE, IT, ES...). The aggregate is called
 *     "Harmonized Index of Consumer Prices (YoY)" under country EMU. Filtering
 *     by PRIMARY_COUNTRY first is what stops German CPI being read as euro-area
 *     CPI.
 *  2. Most indicators have several near-identical variants (Retail Sales MoM vs
 *     YoY vs s.a. vs ex-Autos). `match` is an ORDERED preference list; the first
 *     pattern with actual data wins, so the canonical series is chosen
 *     deterministically rather than by whichever printed most recently.
 */

import type { Currency } from '@/lib/types';

// ---------------------------------------------------------------------------
// Country scoping
// ---------------------------------------------------------------------------

/**
 * The country whose releases represent each currency.
 * Verified against the feed: USD->US, GBP->UK, JPY->JP, AUD->AU, NZD->NZ,
 * CAD->CA, CHF->CH are all one-to-one; EUR is the only many-to-one case.
 */
export const PRIMARY_COUNTRY: Record<Currency, string> = {
  USD: 'US',
  EUR: 'EMU',
  GBP: 'UK',
  JPY: 'JP',
  AUD: 'AU',
  NZD: 'NZ',
  CAD: 'CA',
  CHF: 'CH',
};

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export type SlotCategory = 'technical' | 'sentiment' | 'growth' | 'inflation' | 'jobs';

export const SLOT_CATEGORIES: { key: SlotCategory; label: string }[] = [
  { key: 'technical', label: 'Technical' },
  { key: 'sentiment', label: 'Sentiment' },
  { key: 'growth', label: 'Economic Growth & Consumer Strength' },
  { key: 'inflation', label: 'Inflation' },
  { key: 'jobs', label: 'Jobs Market' },
];

export interface SlotDefinition {
  key: string;
  /** Column header. Kept short — the matrix is dense. */
  label: string;
  /** Longer name for the scorecard page and tooltips. */
  title: string;
  category: SlotCategory;
  /**
   * `economic` slots resolve to a calendar release and score off its surprise.
   * `technical` and `sentiment` slots are computed elsewhere and injected.
   */
  kind: 'economic' | 'technical' | 'sentiment';

  /** +1 = a higher reading is bullish for the currency. Economic slots only. */
  polarity?: 1 | -1;

  /**
   * How old the latest print may be before the cell is treated as stale.
   * Stale renders greyed at 0 — a five-month-old GDP number must not look like
   * a confident neutral.
   */
  maxAgeDays?: number;

  /** Ordered preference list of event-name patterns. First with data wins. */
  match?: RegExp[];

  /** Per-currency overrides, for series with country-specific names. */
  matchByCurrency?: Partial<Record<Currency, RegExp[]>>;
}

export const SLOTS: SlotDefinition[] = [
  // --- Technical ----------------------------------------------------------
  {
    key: 'trend',
    label: 'Trend',
    title: 'Price vs 20/50/100/200-day moving averages',
    category: 'technical',
    kind: 'technical',
  },
  {
    key: 'seasonality',
    label: 'Seasonality',
    title: "This calendar month's 10-year average return and win rate",
    category: 'technical',
    kind: 'technical',
  },

  // --- Sentiment ----------------------------------------------------------
  {
    key: 'cot',
    label: 'COT',
    title: 'Large speculator net positioning vs its own 3-year range',
    category: 'sentiment',
    kind: 'sentiment',
  },
  {
    key: 'crowd',
    label: 'Crowd Sentiment',
    title: 'Small-trader positioning, read contrarian',
    category: 'sentiment',
    kind: 'sentiment',
  },

  // --- Growth & consumer --------------------------------------------------
  {
    key: 'gdp',
    label: 'GDP',
    title: 'Gross Domestic Product',
    category: 'growth',
    kind: 'economic',
    polarity: 1,
    // Quarterly, and often revised weeks later, so a long window is correct.
    maxAgeDays: 120,
    match: [
      /^Gross Domestic Product \(QoQ\)$/i,
      /^Gross Domestic Product s\.a\. \(QoQ\)$/i,
      /^Gross Domestic Product Annualized/i,
      /^Gross Domestic Product \(YoY\)$/i,
    ],
  },
  {
    key: 'mpmi',
    label: 'mPMI',
    title: 'Manufacturing PMI',
    category: 'growth',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 60,
    match: [/^ISM Manufacturing PMI$/i, /Manufacturing PMI$/i],
    matchByCurrency: {
      NZD: [/^Business NZ PMI$/i],
    },
  },
  {
    key: 'spmi',
    label: 'sPMI',
    title: 'Services PMI',
    category: 'growth',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 60,
    match: [/^ISM Services PMI$/i, /Services PMI$/i],
    matchByCurrency: {
      // Canada has no services PMI in this feed; Ivey is the closest activity read.
      CAD: [/^Ivey Purchasing Managers Index s\.a$/i, /^Ivey Purchasing Managers Index$/i],
      NZD: [/^Business NZ PSI$/i],
    },
  },
  {
    key: 'retail-sales',
    label: 'Retail Sales',
    title: 'Retail sales',
    category: 'growth',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 75,
    match: [/^Retail Sales \(MoM\)$/i, /^Retail Sales s\.a\. \(MoM\)$/i, /^Retail Sales \(YoY\)$/i],
    matchByCurrency: {
      JPY: [/^Retail Trade \(YoY\)$/i, /^Retail Trade s\.a \(MoM\)$/i],
      NZD: [/^Electronic Card Retail Sales {1,2}\(MoM\)$/i, /^Retail Sales \(QoQ\)$/i],
      CHF: [/^Real Retail Sales \(YoY\)$/i],
    },
  },
  {
    key: 'consumer-confidence',
    label: 'Cnsmr Conf',
    title: 'Consumer confidence / sentiment',
    category: 'growth',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 60,
    match: [/^Consumer Confidence$/i, /^Consumer Confidence Index$/i, /^Michigan Consumer Sentiment Index$/i],
    matchByCurrency: {
      AUD: [/^Westpac Consumer Confidence$/i, /^Consumer Confidence$/i],
      // Switzerland publishes no consumer confidence here; KOF is the standard
      // forward-looking sentiment proxy.
      CHF: [/^KOF Leading Indicator$/i],
    },
  },

  // --- Inflation ----------------------------------------------------------
  {
    key: 'cpi',
    label: 'CPI YoY',
    title: 'Consumer price inflation, year on year',
    category: 'inflation',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 60,
    match: [/^Consumer Price Index \(YoY\)$/i],
    matchByCurrency: {
      // The euro-area aggregate, not a member state.
      EUR: [/^Harmonized Index of Consumer Prices \(YoY\)$/i],
      // National CPI, not the Tokyo advance print.
      JPY: [/^National Consumer Price Index \(YoY\)$/i],
    },
  },
  {
    key: 'ppi',
    label: 'PPI YoY',
    title: 'Producer price inflation, year on year',
    category: 'inflation',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 60,
    match: [/^Producer Price Index \(YoY\)$/i, /^Producer Price Index \(MoM\)$/i],
  },
  {
    key: 'pce',
    label: 'PCE YoY',
    title: "Core PCE price index — the Fed's preferred inflation gauge",
    category: 'inflation',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 60,
    // US-only by construction. Other currencies leave this blank.
    match: [/^Core Personal Consumption Expenditures - Price Index \(YoY\)$/i],
  },
  {
    key: 'rates',
    label: 'Interest Rates',
    title: 'Policy rate decision',
    category: 'inflation',
    kind: 'economic',
    polarity: 1,
    // Decisions are 6-8 weeks apart, and the standing rate stays relevant between
    // them, so this window is deliberately generous.
    maxAgeDays: 120,
    match: [/Interest Rate Decision$/i, /^Official Cash Rate/i, /^Bank Rate$/i],
    matchByCurrency: {
      // The deposit facility is the effective policy rate, not the MRO.
      EUR: [/^ECB Rate On Deposit Facility$/i, /^ECB Main Refinancing Operations Rate$/i],
    },
  },

  // --- Jobs ---------------------------------------------------------------
  {
    key: 'nfp',
    label: 'NFP',
    title: 'Headline employment change',
    category: 'jobs',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 60,
    // Anchored so "Nonfarm Payrolls (QoQ)" and the benchmark revision are excluded.
    match: [/^Nonfarm Payrolls$/i, /^Net Change in Employment$/i, /^Employment Change/i],
    matchByCurrency: {
      // Japan reports no monthly payrolls; the jobs-to-applicants ratio is the
      // standard labour-tightness read.
      JPY: [/^Jobs \/ Applicants Ratio$/i],
      CHF: [/^Employment Level \(QoQ\)$/i],
    },
  },
  {
    key: 'unemployment',
    label: 'Unemploy. Rate',
    title: 'Unemployment rate',
    category: 'jobs',
    kind: 'economic',
    polarity: -1, // higher unemployment is bearish for the currency
    maxAgeDays: 60,
    match: [/^Unemployment Rate$/i, /^Unemployment Rate s\.a\.$/i],
    matchByCurrency: {
      GBP: [/^ILO Unemployment Rate \(3M\)$/i],
      // Named "(MoM)" in the feed but it is a rate, not a change.
      CHF: [/^Unemployment Rate s\.a \(MoM\)$/i],
    },
  },
  {
    key: 'claims',
    label: 'Unemploy. Claims',
    title: 'Initial jobless claims',
    category: 'jobs',
    kind: 'economic',
    polarity: -1,
    maxAgeDays: 21, // weekly series
    match: [/^Initial Jobless Claims$/i],
  },
  {
    key: 'adp',
    label: 'ADP',
    title: 'ADP private payrolls',
    category: 'jobs',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 60,
    match: [/^ADP Employment Change$/i],
  },
  {
    key: 'jolts',
    label: 'JOLTS',
    title: 'JOLTS job openings',
    category: 'jobs',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 75, // published with a long lag
    match: [/^JOLTS Job Openings$/i],
  },
];

/** Default staleness window when a slot does not set one. */
export const DEFAULT_MAX_AGE_DAYS = 60;

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

/**
 * Surprise (in sigma) -> discrete cell.
 *
 * Thresholds are symmetric and deliberately wide in the middle: most releases
 * land near forecast, and a matrix where everything is +/-1 carries no signal.
 */
export const SIGMA_BUCKETS = {
  strong: 1.0, // |sigma| >= 1.0  -> +/-2
  mild: 0.25, // |sigma| >= 0.25 -> +/-1
} as const;

export const CELL_MIN = -2;
export const CELL_MAX = 2;

/**
 * COT index: where the current net position sits within its own trailing range.
 * Percentile, not absolute size — 200k net long means nothing without knowing
 * whether that is high or low for this contract.
 */
export const COT_PERCENTILE_BUCKETS = {
  veryBullish: 80,
  bullish: 60,
  bearish: 40,
  veryBearish: 20,
} as const;

/** How much history the percentile is measured against. */
export const COT_LOOKBACK_WEEKS = 156; // ~3 years

/**
 * Crowd sentiment, read CONTRARIAN — a crowded long is a bearish signal, which
 * is why these map to negative cells.
 */
export const CROWD_LONG_PCT_BUCKETS = {
  veryBearish: 70, // >70% of small traders long -> -2
  bearish: 60,
  bullish: 40,
  veryBullish: 30, // <30% long -> +2
} as const;

/** Price above N of the four moving averages -> cell value. */
export const TREND_BUCKETS: Record<number, number> = {
  4: 2,
  3: 1,
  2: 0,
  1: -1,
  0: -2,
};

/**
 * Seasonality needs BOTH a meaningful average move and a consistent win rate.
 * A +2% average driven by one outlier year is not a seasonal tendency.
 */
export const SEASONALITY_BUCKETS = {
  strongPct: 0.5, // mean monthly return, %
  strongWinRate: 60, // %
  mildPct: 0.15,
} as const;

/** Years of monthly history used for the seasonal average. */
export const SEASONALITY_YEARS = 10;

// ---------------------------------------------------------------------------
// Bias labels
// ---------------------------------------------------------------------------

export type Bias = 'Very Bullish' | 'Bullish' | 'Neutral' | 'Bearish' | 'Very Bearish';

/**
 * Total score -> label. Thresholds are on the SUM of all populated cells.
 *
 * With 18 slots the theoretical range is +/-36, but real totals cluster within
 * roughly +/-15 because no symbol has every slot populated and the cells rarely
 * all agree. These cuts are set for that real distribution, not the theoretical
 * one — calibrate them against live output rather than arithmetic.
 */
export const BIAS_THRESHOLDS: { min: number; bias: Bias }[] = [
  { min: 9, bias: 'Very Bullish' },
  { min: 4, bias: 'Bullish' },
  { min: -3, bias: 'Neutral' },
  { min: -8, bias: 'Bearish' },
  { min: -Infinity, bias: 'Very Bearish' },
];

export function biasFromScore(score: number): Bias {
  return BIAS_THRESHOLDS.find((t) => score >= t.min)?.bias ?? 'Neutral';
}
