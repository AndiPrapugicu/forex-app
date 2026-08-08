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
  kind: 'economic' | 'technical' | 'sentiment' | 'yield';

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
  {
    /**
     * Wages. Every major except Switzerland publishes something here, which is
     * what makes crosses like AUDCAD scoreable in the jobs block at all — PCE,
     * claims, ADP and JOLTS are genuinely US-only, so without wages and
     * participation a non-USD cross had almost nothing in this category.
     */
    key: 'wages',
    label: 'Wages',
    title: 'Wage growth',
    category: 'jobs',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 120, // several are quarterly (AUD, NZD, EUR)
    match: [/^Average Hourly Earnings \(YoY\)$/i, /^Average Hourly Earnings \(MoM\)$/i],
    matchByCurrency: {
      AUD: [/^Wage Price Index \(YoY\)$/i, /^Wage Price Index \(QoQ\)$/i],
      CAD: [/^Average Hourly Wages \(YoY\)$/i],
      GBP: [/^Average Earnings Excluding Bonus \(3Mo\/Yr\)$/i, /^Average Earnings Including Bonus \(3Mo\/Yr\)$/i],
      JPY: [/^Labor Cash Earnings \(YoY\)$/i],
      NZD: [/^Labour Cost Index \(QoQ\)$/i, /^Labour Cost Index \(YoY\)$/i],
      EUR: [/^Negotiated Wage Rates \(QoQ\)$/i, /^Labor Cost Index$/i],
    },
  },
  {
    key: 'participation',
    label: 'Particip.',
    title: 'Labour force participation rate',
    category: 'jobs',
    kind: 'economic',
    polarity: 1,
    maxAgeDays: 60,
    // USD, AUD, NZD and CAD only; others leave the cell blank.
    match: [/^Participation Rate$/i, /^Labor Force Participation Rate$/i],
  },
  {
    /**
     * 2-year yield direction. EdgeFinder carries this and we did not.
     *
     * Not a calendar release — it is scored from the price series in
     * lib/connectors/technicals.ts against its own 21-day average. A rising
     * short yield is hawkish: bullish for the dollar, bearish for gold.
     */
    key: 'yield2y',
    label: '2Y Yield',
    title: '2-year Treasury yield vs its 21-day average',
    category: 'inflation',
    kind: 'yield',
  },
];

/** Default staleness window when a slot does not set one. */
export const DEFAULT_MAX_AGE_DAYS = 60;

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

/**
 * Fundamentals are TERNARY: a release either beat, missed, or landed on forecast.
 *
 * This deliberately discards magnitude, and that is EdgeFinder's model rather
 * than an approximation of it — reconstructing their published GOLD scorecard
 * only reproduces their four stated sub-totals (3 / 1 / 4 / 8) if every
 * fundamental contributes exactly +/-1.
 *
 * The previous approach bucketed by sigma with a +/-0.25 deadband, which quietly
 * swallowed real misses: JOLTS at 7.359 against a 7.4 forecast is -0.15 sigma
 * and scored 0, when it is plainly a miss.
 *
 * The trade-off is real and accepted: a 0.15 sigma miss and a 3 sigma miss now
 * score the same. Sigma is still computed, kept on the SlotResult, and rendered
 * in the detail column, so magnitude is one hover away.
 *
 * EPSILON absorbs float noise between values that are equal at the feed's own
 * precision (3.3 vs 3.3 must be 0). It is NOT a deadband.
 */
export const TERNARY_EPSILON = 1e-9;

export const CELL_MIN = -2;
export const CELL_MAX = 2;

/**
 * COT scores from the LONG SHARE, in two parts that sum to +/-2 — mirroring the
 * two rows EdgeFinder shows ("COT - Net Positioning" and "COT - Latest
 * Buys/Sells"). Gold at 85.4% long with a +0.78% weekly change gives +1 and +1,
 * which is what reproduces their stated Sentiment+COT subtotal of 1 once the
 * contrarian crowd reading of -1 is added.
 *
 * We previously scored this from the 3-year percentile instead. That is arguably
 * the better analytical measure — it is what reveals gold's large net long as
 * actually BELOW its own median — so it is still computed and displayed. It just
 * no longer drives the cell.
 */
export const COT_LONG_PCT_BUCKETS = {
  bullish: 55,
  bearish: 45,
} as const;

/**
 * Percentile bands, retained for DISPLAY only. See COT_LONG_PCT_BUCKETS above
 * for why this no longer feeds the score.
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
  bearish: 55, // crowd leaning long -> -1 (contrarian)
  bullish: 45, // crowd leaning short -> +1
} as const;

/**
 * Trend is read SHORT-TERM, from the 20- and 50-day averages only.
 *
 * Counting all four put gold at 0 (above 20/50, below 100/200) where EdgeFinder
 * reads +2 — their "4H / Daily Chart Trend" is a near-term measure. The 100- and
 * 200-day averages stay on the scorecard as context; they just do not vote.
 */
export const TREND_BUCKETS: Record<number, number> = {
  2: 2, // above both short averages
  1: 0, // mixed
  0: -2, // below both
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

/** Seasonality contributes at most +/-1, matching EdgeFinder's technical split. */
export const SEASONALITY_CELL_MAX = 1;

/**
 * A rising 2-year yield is hawkish. Compared against its own 21-day average so
 * the reading is direction, not level.
 */
export const YIELD_SMA_DAYS = 21;

/** Years of monthly history used for the seasonal average. */
export const SEASONALITY_YEARS = 10;

// ---------------------------------------------------------------------------
// Bias labels
// ---------------------------------------------------------------------------

export type Bias = 'Very Bullish' | 'Bullish' | 'Neutral' | 'Bearish' | 'Very Bearish';

/**
 * Total score -> label.
 *
 * Calibrated against the labels EdgeFinder publishes beside its own scores
 * rather than guessed from the theoretical range:
 *
 *   8 Very Bullish · 7 Very Bullish · 6 Bullish · 5 Bullish · 4 Bullish
 *  -4 Bearish      · -5 Bearish
 *
 * which puts the cuts at +/-7 and +/-4. The theoretical range is +/-20 for a
 * single-leg symbol and +/-34 for a pair, but real totals cluster inside +/-15
 * because no symbol populates every slot and the cells rarely all agree.
 */
export const BIAS_THRESHOLDS: { min: number; bias: Bias }[] = [
  { min: 7, bias: 'Very Bullish' },
  { min: 4, bias: 'Bullish' },
  { min: -3, bias: 'Neutral' },
  { min: -6, bias: 'Bearish' },
  { min: -Infinity, bias: 'Very Bearish' },
];

export function biasFromScore(score: number): Bias {
  return BIAS_THRESHOLDS.find((t) => score >= t.min)?.bias ?? 'Neutral';
}
