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

import type { SymbolKind } from '@/config/symbols.config';
import type { Currency } from '@/lib/types';

// ---------------------------------------------------------------------------
// Country scoping
// ---------------------------------------------------------------------------

/**
 * The country whose releases represent each currency.
 * Verified against the feed: USD->US, GBP->UK, JPY->JP, AUD->AU, NZD->NZ,
 * CAD->CA, CHF->CH, ZAR->ZA are all one-to-one; EUR is the only many-to-one
 * case.
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
  ZAR: 'ZA',
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

/**
 * A resolvable calendar series: an ordered preference list of name patterns,
 * with per-currency overrides for country-specific naming.
 *
 * Split out from SlotDefinition because composite slots (PMI) need several of
 * these under one column.
 */
export interface SeriesMatcher {
  /** Ordered preference list of event-name patterns. First with data wins. */
  match?: RegExp[];
  /** Per-currency overrides, for series with country-specific names. */
  matchByCurrency?: Partial<Record<Currency, RegExp[]>>;
}

export interface SlotDefinition extends SeriesMatcher {
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
  kind: 'economic' | 'technical' | 'sentiment' | 'rates';

  /**
   * Whether this slot's cell is added to the symbol's total.
   *
   * A1 publishes a specific column set, and their bias bands (+/-4, +/-7) are
   * ABSOLUTE rather than a fraction of some maximum. Adding a column therefore
   * silently shifts what "Bullish" means. Columns we carry that they do not are
   * marked `scoring: false`: still resolved, still rendered, never summed. That
   * keeps the extra information without breaking comparability with their
   * numbers.
   */
  scoring: boolean;

  /**
   * What the actual is measured against.
   *
   * `forecast` — actual vs consensus. Every column A1 scores uses this; their
   *              PMI page's talk of a previous-print change describes the number
   *              they DISPLAY, not the comparison they score (see the mPMI slot).
   * `previous` — actual vs the prior print. Unused today; kept because the
   *              distinction is real and a future column may need it.
   */
  compare?: 'forecast' | 'previous';

  /** +1 = a higher reading is bullish for the currency. Economic slots only. */
  polarity?: 1 | -1;

  /**
   * Largest absolute value this slot may contribute, per leg.
   *
   * Defaults to 1: every economic category scores +/-1 per currency and reaches
   * +/-2 only once base and quote are differenced. Trend and COT override it.
   */
  maxCell?: number;

  /**
   * How old the latest print may be before the cell is treated as stale.
   * Stale renders greyed at 0 — a five-month-old GDP number must not look like
   * a confident neutral.
   */
  maxAgeDays?: number;

  /**
   * Sub-series making up a composite column.
   *
   * Nothing uses this today — mPMI and sPMI are separate columns, matching A1's
   * table. Retained because the heatmap and the leg builder both handle it, and
   * it is the mechanism any future genuinely-composite column would need.
   */
  components?: (SeriesMatcher & { key: string; label: string })[];
}

export const SLOTS: SlotDefinition[] = [
  // --- Technical ----------------------------------------------------------
  {
    /**
     * A1's rule from a1trading.com/edgefinder/trend/: a 3-day and a 14-day SMA,
     * where the CROSSOVER is the score (+/-2) and the 14-day slope only docks a
     * point when it disagrees. Range +/-2, values {-2, -1, +1, +2}.
     *
     * Reading their "+1 / -1" slope line as an addend gave +/-3 and produced a
     * Trend of +3, which their model cannot output. See scoreTrend.
     */
    key: 'trend',
    label: 'Trend',
    title: '3-day vs 14-day moving average, with the 14-day slope',
    category: 'technical',
    kind: 'technical',
    scoring: true,
    maxCell: 2,
  },
  {
    key: 'seasonality',
    label: 'Seasonality',
    title: "This calendar month's 10-year average return",
    category: 'technical',
    kind: 'technical',
    scoring: true,
    maxCell: 1,
  },

  // --- Sentiment ----------------------------------------------------------
  {
    key: 'cot',
    label: 'COT',
    title: 'Large speculator positioning from the weekly CFTC report',
    category: 'sentiment',
    kind: 'sentiment',
    scoring: true,
    maxCell: 2,
  },
  {
    key: 'crowd',
    label: 'Crowd Sentiment',
    title: 'Small-trader positioning, read contrarian',
    category: 'sentiment',
    kind: 'sentiment',
    scoring: true,
    // A1 scores retail +/-1 for the whole symbol, not per leg.
    maxCell: 1,
  },

  // --- Growth & consumer --------------------------------------------------
  {
    key: 'gdp',
    label: 'GDP',
    title: 'Gross Domestic Product',
    category: 'growth',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    // Quarterly, and often revised weeks later, so a long window is correct.
    maxAgeDays: 120,
    match: [
      /^Gross Domestic Product \(QoQ\)$/i,
      /^Gross Domestic Product s\.a\. \(QoQ\)$/i,
      /^Gross Domestic Product Annualized/i,
      /^Gross Domestic Product \(YoY\)$/i,
    ],
    matchByCurrency: {
      /**
       * Canada is the one major that publishes GDP MONTHLY, and that release is
       * its headline growth read — the quarterly lands eleven weeks later.
       * Taking the quarterly gave every CAD pair an 80-day-old print carrying no
       * forecast, so the column could not be scored at all; the monthly is 17
       * days old and forecast by both calendars.
       */
      CAD: [
        /^Gross Domestic Product \(MoM\)$/i,
        /^Gross Domestic Product \(QoQ\)$/i,
        /^Gross Domestic Product Annualized$/i,
      ],
    },
  },
  {
    /**
     * TWO INDEPENDENT COLUMNS, scored against FORECAST.
     *
     * Their table carries mPMI and sPMI side by side, each reaching +/-2 for a
     * pair — their EURUSD reads mPMI -2 and sPMI +2 on the same day. Merging
     * them into one composite collapsed that to a single -1 and halved the
     * growth block.
     *
     * Their PMI page says "change from previous data to latest data", which
     * reads like a previous-print comparison. It is not what the product does.
     * On the same day's live figures, scoring against FORECAST reproduces all
     * four of their published PMI cells (EURUSD -2/+2, GOLD -1/+1); scoring
     * against PREVIOUS reproduces only two. The sentence describes the change
     * they DISPLAY, not the comparison they SCORE.
     */
    key: 'mpmi',
    label: 'mPMI',
    title: 'Manufacturing PMI, change from the previous print',
    category: 'growth',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    maxAgeDays: 60,
    match: [/^ISM Manufacturing PMI$/i, /Manufacturing PMI$/i],
    matchByCurrency: {
      NZD: [/^Business NZ PMI$/i],
      // Australia has only the S&P Global print in this feed.
      AUD: [/^S&P Global Manufacturing PMI$/i, /Manufacturing PMI$/i],
      /**
       * Switzerland's manufacturing PMI is the SVME/procure.ch survey, and its
       * feed name contains neither "Manufacturing" nor "PMI" — so the generic
       * pattern above never matched and the CHF leg was silently absent.
       *
       * That blank is what made every franc cross read a single-leg number: on
       * GBPCHF the cell was GBP alone at -1 where A1 shows +2, because they have
       * the Swiss side at -1 and difference it.
       */
      CHF: [/^SVME - Purchasing Managers' Index$/i, /^procure\.ch PMI$/i],
    },
  },
  {
    key: 'spmi',
    label: 'sPMI',
    title: 'Services PMI, change from the previous print',
    category: 'growth',
    kind: 'economic',
    scoring: true,
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
    scoring: true,
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
    // Context only — A1 carries no consumer confidence column.
    key: 'consumer-confidence',
    label: 'Cnsmr Conf',
    title: 'Consumer confidence / sentiment',
    category: 'growth',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    maxAgeDays: 60,
    match: [/^Consumer Confidence$/i, /^Consumer Confidence Index$/i, /^Michigan Consumer Sentiment Index$/i],
    matchByCurrency: {
      AUD: [/^Westpac Consumer Confidence$/i, /^Consumer Confidence$/i],
      // The UK's series is GfK's, and nothing else here matches "Consumer
      // Confidence" for GBP — without this the leg silently scored 0.
      GBP: [/^GfK Consumer Confidence$/i],
      /**
       * SECO's Consumer Climate IS Switzerland's consumer confidence survey, and
       * it is in the feed — the previous note here claimed otherwise and fell
       * back to KOF, which is a composite leading indicator measuring something
       * else. KOF stays as the fallback, since it is the better proxy of the two
       * if SECO ever drops out.
       */
      CHF: [/^SECO Consumer Climate \(3m\)$/i, /^KOF Leading Indicator$/i],
      // New Zealand's is ANZ/Roy Morgan; nothing here says "Consumer Confidence"
      // on its own, so the leg was resolving to nothing.
      NZD: [/^ANZ – Roy Morgan Consumer Confidence$/i, /^ANZ - Roy Morgan Consumer Confidence$/i],
    },
  },

  // --- Inflation ----------------------------------------------------------
  {
    key: 'cpi',
    label: 'CPI YoY',
    title: 'Consumer price inflation, year on year',
    category: 'inflation',
    kind: 'economic',
    scoring: true,
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
    /**
     * A1 lists PPI and PCE as columns but publishes no rule for either, unlike
     * every other category. Treated as ordinary actual-vs-forecast reads, which
     * is what the rest of their macro block does — but it is an inference, not a
     * documented rule.
     */
    key: 'ppi',
    label: 'PPI YoY',
    title: 'Producer price inflation, year on year',
    category: 'inflation',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    /**
     * 90 DAYS, because the SCOREABLE print lags further than the series does.
     *
     * `resolveSeries` deliberately reaches past a release that carries no
     * consensus, since a print with no forecast cannot produce a beat or a miss.
     * UK core PPI's recent entries are exactly that, so the newest usable print
     * sits two publication cycles back — measured at 61 days against a 60-day
     * window, which dropped the GBP leg on every sterling pair and left GBPUSD
     * reading +1 where A1 reads +2.
     *
     * The two rules were each right and were cancelling each other out. Widening
     * here is the narrow fix; the real one is a consensus source for UK PPI, at
     * which point the newest print scores directly and this window stops
     * mattering.
     */
    maxAgeDays: 90,
    match: [/^Producer Price Index \(YoY\)$/i, /^Producer Price Index \(MoM\)$/i],
    matchByCurrency: {
      /**
       * CORE output prices, not headline output or input.
       *
       * Only the core series reproduces their GBPUSD cell: on the same day
       * headline output (0.0 vs 0.4) and input (-2.0 vs 0.2) both missed, which
       * would give GBPUSD 0, while core output (0.8 vs 0.4) beat and gives the
       * +2 they show. Core also matches what the other currencies use here,
       * since input prices are a raw-materials series that swings far harder.
       */
      GBP: [/^PPI Core Output \(MoM\) n\.s\.a$/i, /^Producer Price Index - Output \(MoM\) n\.s\.a$/i],
      /**
       * Each country names its producer-price series differently, and none of
       * the three below contains the words "Producer Price Index" in the order
       * the generic patterns expect. All three were resolving to nothing while
       * sitting in the feed:
       *
       *   CHF  Producer and Import Prices        released 4 days ago
       *   CAD  Industrial Product Price          released 24 days ago
       *   NZD  Producer Price Index - Output     quarterly, so often stale
       */
      /**
       * MoM FIRST for Switzerland, against the YoY-first order everywhere else.
       *
       * `resolveSeries` commits to the first pattern that has any released data,
       * so a leading YoY pattern wins the slot and then cannot be scored:
       * neither calendar forecasts the Swiss YoY series. The MoM variant is
       * forecast by both. Mixing MoM against another leg's YoY is fine here
       * because the cell is ternary — it reads the direction of the surprise,
       * not the level.
       */
      CHF: [/^Producer and Import Prices \(MoM\)$/i, /^Producer and Import Prices \(YoY\)$/i],
      CAD: [/^Industrial Product Price \(MoM\)$/i],
      NZD: [/^Producer Price Index - Output \(QoQ\)$/i],
      /**
       * Australia publishes producer prices QUARTERLY, and only the QoQ variant
       * is forecast — the YoY carries an actual and nothing to score it against,
       * which is what the generic YoY-first order kept selecting.
       */
      AUD: [/^Producer Price Index \(QoQ\)$/i, /^Producer Price Index \(YoY\)$/i],
    },
  },
  {
    // Rule inferred, same as PPI above.
    key: 'pce',
    label: 'PCE YoY',
    title: "Core PCE price index — the Fed's preferred inflation gauge",
    category: 'inflation',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    maxAgeDays: 60,
    // US-only by construction. Other currencies leave this blank.
    match: [/^Core Personal Consumption Expenditures - Price Index \(YoY\)$/i],
  },
  {
    /**
     * Rate EXPECTATIONS, not the last decision.
     *
     * A1 compares each currency's current policy rate against their own house
     * forecast for next quarter (a1trading.com/edgefinder/interest-rates/).
     *
     * The bank's OWN published projection is the only thing that scores here.
     * The Fed publishes one — the dot plot's Summary of Economic Projections —
     * and nobody else does, so seven of the eight majors score a permanent 0 on
     * this column and say so in the tooltip.
     *
     * A 2-year-yield proxy was tried and rejected: it is the MARKET's forecast
     * rather than the bank's, and the two disagreed outright — the US 2-year sat
     * above the policy rate implying hikes while the dots projected cuts. The
     * spread is still computed and shown for contrast; it does not vote.
     *
     * Scored in lib/scoring/rates.ts, not from the calendar.
     */
    key: 'rates',
    label: 'Interest Rates',
    title:
      "The central bank's own projected rate path. Only the Fed publishes numbers, " +
      'so every other currency scores 0 here rather than a guess.',
    category: 'inflation',
    kind: 'rates',
    scoring: true,
  },

  // --- Jobs ---------------------------------------------------------------
  {
    /**
     * US NON-FARM PAYROLLS ONLY.
     *
     * Their column is headed "NFP", and it only ever contributes +/-1 to a pair
     * — the US leg, inverted when USD is the quote. We also matched other
     * currencies' employment series, which gave AUDUSD a 2 where they read 1.
     *
     * PCE, claims, ADP and JOLTS are US-only for the same reason: they are US
     * series, and A1's columns name them as such.
     */
    key: 'employment',
    label: 'NFP',
    title: 'US non-farm payrolls',
    category: 'jobs',
    kind: 'economic',
    scoring: true,
    polarity: 1,
    maxAgeDays: 60,
    // Anchored so "Nonfarm Payrolls (QoQ)" and the benchmark revision are excluded.
    match: [/^Nonfarm Payrolls$/i],
  },
  {
    key: 'unemployment',
    label: 'Unemploy. Rate',
    title: 'Unemployment rate',
    category: 'jobs',
    kind: 'economic',
    scoring: true,
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
    // Context from here down: real jobs-market information, but not columns A1
    // scores, so they must not move the total.
    key: 'claims',
    label: 'Unemploy. Claims',
    title: 'Initial jobless claims',
    category: 'jobs',
    kind: 'economic',
    scoring: true,
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
    scoring: true,
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
    scoring: true,
    polarity: 1,
    maxAgeDays: 75, // published with a long lag
    match: [/^JOLTS Job Openings$/i],
  },
];

/** The columns that move the total. Everything else is displayed context. */
export const SCORING_SLOTS = SLOTS.filter((s) => s.scoring);

/** Default staleness window when a slot does not set one. */
export const DEFAULT_MAX_AGE_DAYS = 60;

/**
 * How close two prints of one series must be for the newer to count as a
 * REVISION of the older rather than the next period's release.
 *
 * Used by `resolveSeries` to decide whether it may reach past a confirming
 * revision to the flash that carried the actual surprise. A euro-area GDP
 * revision follows its flash by about a fortnight; consecutive months of any
 * monthly series are at least four weeks apart, so three weeks separates the two
 * cases without needing a per-slot cadence.
 */
export const REVISION_WINDOW_DAYS = 21;

/**
 * Where the standing policy rate is read from, per currency.
 *
 * No longer a scored column — `rates` scores expectations instead — but the
 * level itself is still needed for the carry scanner, for real yields, and as
 * the baseline the 2-year yield is compared against.
 */
export const POLICY_RATE_MATCH: SeriesMatcher = {
  match: [/Interest Rate Decision$/i, /^Official Cash Rate/i, /^Bank Rate$/i],
  matchByCurrency: {
    // The deposit facility is the effective policy rate, not the MRO.
    EUR: [/^ECB Rate On Deposit Facility$/i, /^ECB Main Refinancing Operations Rate$/i],
  },
};

/** How stale a policy rate may be before we stop trusting it. */
export const POLICY_RATE_MAX_AGE_DAYS = 120;

/**
 * The central bank's OWN forecast of its policy rate — the Fed's dot plot.
 *
 * This is what A1's interest-rate column actually compares: "current and next
 * quarter's forecasted interest rate ... Data from the Central Bank Forecast
 * Page". The FOMC publishes exactly that, and FXStreet carries it.
 *
 * ONLY THE FED PUBLISHES ONE. The ECB, BoE, RBA and the rest give guidance in
 * prose, not numbers, so every other currency scores 0 on this column — see
 * scoreRateExpectation for why 0 beats a guess here.
 *
 * Released quarterly with the FOMC's Summary of Economic Projections, so the
 * staleness window spans a full quarter with margin.
 */
export const RATE_PROJECTION_MATCH: { current: SeriesMatcher; nextYear: SeriesMatcher } = {
  current: { match: [/^Interest Rate Projections - Current$/i] },
  nextYear: { match: [/^Interest Rate Projections - 1st year$/i] },
};

export const RATE_PROJECTION_MAX_AGE_DAYS = 200;

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

/**
 * Fundamentals are TERNARY: a release either beat, missed, or landed on
 * forecast. Magnitude is discarded, and that is A1's model rather than an
 * approximation of it — every macro category on their card contributes exactly
 * +/-1 per currency however large the surprise.
 *
 * The trade-off is real and accepted: a 0.15 sigma miss and a 3 sigma miss score
 * the same. Sigma is still computed, kept on the SlotResult, and rendered in the
 * detail column, so magnitude is one hover away.
 *
 * EPSILON absorbs float noise between values that are equal at the feed's own
 * precision (3.3 vs 3.3 must be 0). It is NOT a deadband — an earlier +/-0.25
 * sigma deadband quietly swallowed genuine misses.
 */
export const TERNARY_EPSILON = 1e-9;

/**
 * Default per-leg cell bounds. Individual slots widen this via `maxCell`
 * (trend +/-3) or narrow it (crowd +/-1).
 */
export const CELL_MIN = -1;
export const CELL_MAX = 1;

/** Bounds for a combined pair cell, before any slot-specific override. */
export const PAIR_CELL_MIN = -2;
export const PAIR_CELL_MAX = 2;

/**
 * Long-share bands for COT net positioning.
 *
 * Applies to standalone symbols — indices, commodities, crypto and the currency
 * indices. A1 scores the LEGS OF A PAIR purely on the weekly change
 * (a1trading.com/edgefinder/cot-data/); net positioning is the second component
 * only where a symbol reads one contract directly.
 *
 * 60/40, NOT the 55/45 we had. Two of their published cards pin this, and only
 * this band satisfies both at once:
 *
 *   USD INDEX  74.4% long, +0.95% change -> +1 +1 = +2, and their Sentiment+COT
 *              subtotal of +1 reconciles only as (+1 +1 -1).
 *   EURO FX    43.7% long, +1.22% change -> their cell reads +1. At 55/45 the
 *              long share scores -1 and the cell collapses to 0; at 60/40 it
 *              lands inside the neutral band and the change carries it alone.
 *
 * It is also the band they publish verbatim for retail sentiment below, which is
 * a reason to think one number governs both rather than a coincidence.
 */
export const COT_LONG_PCT_BUCKETS = {
  bullish: 60,
  bearish: 40,
} as const;

/**
 * Percentile bands, retained for DISPLAY only.
 *
 * Ranking a position against its own 3-year range is the more revealing measure
 * — it is what shows a huge gold net long sitting below its own median — but it
 * is not what A1 scores, so it informs the reader without moving the number.
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
 *
 * A1's published thresholds, verbatim: ">= 60% long -> -1 score", "<= 40% long
 * -> +1". The 40-60% band is deliberately wide; most of the time the crowd is
 * not saying anything.
 */
export const CROWD_LONG_PCT_BUCKETS = {
  bearish: 60, // crowd leaning long -> -1 (contrarian)
  bullish: 40, // crowd leaning short -> +1
} as const;

/**
 * Trend: a fast and a slow SMA, per a1trading.com/edgefinder/trend/.
 *
 * "3-day SMA: Captures short-term price trends. 14-day SMA: Captures longer-term
 * price trends." Crossover scores +/-2, the 14-day slope +/-1, and a
 * disagreement between them costs 1 — see scoreTrend for the composition.
 */
export const TREND_SMA = { fast: 3, slow: 14 } as const;

/** How far back the slow SMA's slope is measured. */
export const TREND_SLOPE_LOOKBACK_DAYS = 1;

/**
 * Seasonality is the SIGN of the 10-year average for the current calendar month,
 * nothing more: "If the current month's 10 year historical average performance
 * is positive, the EdgeFinder assigns a +2 [or +1]".
 *
 * We previously gated it behind a mean-return and win-rate threshold. That is
 * defensible analysis — a +2% average driven by one outlier year is not a
 * tendency — but it is not their rule, so both figures are still returned and
 * displayed while only the sign votes.
 */
export const SEASONALITY_MIN_YEARS = 5;

/**
 * +/-1 for EVERY asset class.
 *
 * Their seasonality page says indices and commodities get +/-2 "because seasonal
 * tendencies are very pronounced" there. Their live product does not do that:
 * GOLD and SILVER both show seasonality 1, and GOLD's published total of 8 only
 * reconciles with seasonality at 1 — at 2 it would be 9. No row anywhere in
 * their table shows +/-2 in this column.
 *
 * Where the documentation and the running product disagree, the product wins.
 * Kept as a per-kind map rather than a constant so the split is one edit away if
 * they ever ship what the page describes.
 */
export const SEASONALITY_CELL_MAX_BY_KIND = {
  fx: 1,
  currency: 1,
  index: 1,
  commodity: 1,
  crypto: 1,
} as const;

/**
 * Non-FX assets read interest rates off the US 2-year against its own average:
 * "If price is above the moving average, -1. If price is below the moving
 * average, +1" — a rising short yield tightens financial conditions, which is
 * bearish for indices, gold and crypto alike.
 *
 * 21 DAYS, not the 7 their interest-rates page implies. Their Asset Scorecard
 * labels this row verbatim "2 Yr Yield (21 day SMA)", and a product label naming
 * its own window beats a prose page describing it.
 */
export const YIELD_SMA_DAYS = 21;

/** Below this the 2-year is treated as flat against its average. */
export const YIELD_FLAT_BAND = 0.005;

/** Years of monthly history used for the seasonal average. */
export const SEASONALITY_YEARS = 10;


// ---------------------------------------------------------------------------
// Price structure
// ---------------------------------------------------------------------------

/**
 * Tunables for `lib/scoring/structure.ts`.
 *
 * These feed levels the user will place orders against, so every value below is
 * a stated judgement rather than a fitted parameter. None of them affect a
 * score: structure is display-only, because A1's bias bands are absolute and
 * adding an input would silently redefine "Bullish".
 *
 * Distances are expressed in ATR throughout, never in percent. A 0.3% band is
 * unreachable in a market whose daily range is 0.1% and trivially satisfied in
 * one that ranges 2%, so a percentage tolerance means something different for
 * every symbol on the board. ATR is the only unit under which "close together"
 * means the same thing for gold and for the franc.
 */

/** Bars either side of a candidate pivot. 3 gives the standard 7-bar fractal. */
export const SWING_LOOKBACK = 3;

/** Periods in the average true range. Wilder's original, and still the default. */
export const ATR_PERIOD = 14;

/**
 * Minimum distance from the previous kept swing, in ATR, for a pivot to count.
 *
 * Raw fractals fire constantly — on any real series most of them are noise. At
 * 1.5 the retained swings are the ones a person would mark by hand, which is the
 * bar this has to clear: the level has to be findable on the user's own chart.
 */
export const MIN_SWING_ATR = 1.5;

/** How close price must come, in ATR, to count as having retested a level. */
export const RETEST_ATR = 0.5;

/**
 * How far past a level a close must sit to count as a break.
 *
 * A close one tick beyond a swing high is not a break in any sense a trader
 * would recognise, and at five decimal places it is often just rounding. Small
 * on purpose: a large buffer turns break-of-structure into a momentum filter and
 * pushes the signal past the retest, which is where the entry is.
 */
export const BREAK_BUFFER_ATR = 0.1;

/**
 * Bars after which a break stops describing the current market.
 *
 * ~6 months of daily bars. Past that the market has usually re-ranged and the
 * level the break defined is one price has since traded through in both
 * directions. Reporting it as "where price broke structure" hands the user a
 * level the market has visibly stopped respecting.
 */
export const STALE_BREAK_BARS = 120;

/** Window used to state range edges when there is no live break. */
export const RANGE_LOOKBACK_BARS = 60;

/**
 * Round-number grid spacing, in ATR.
 *
 * Sized to enforce one invariant: `step / 2 > CONFLUENCE_ATR`, so a round number
 * can never be automatically within tolerance of the current price. With a fixed
 * grid this breaks — a 0.005 grid on EURUSD puts a round number within 25 pips
 * of any price, which on a 60-pip ATR is inside the tolerance always, so the
 * round-number vote becomes free and every confluence score inflates by one.
 */
export const ROUND_STEP_ATR = 2;

/** One source is not confluence. */
export const MIN_CONFLUENCE_SOURCES = 2;

/**
 * Furthest a zone can sit from price and still be worth listing, in ATR.
 *
 * Observed on EURUSD: a two-year-old untested low showed up 24 ATR below spot —
 * arithmetically a level, operationally irrelevant, and it crowded out the ones
 * price could actually reach this month. Ten ATR is roughly two weeks of range.
 */
export const MAX_ZONE_ATR = 10;

/** Zones listed at most. Sorted nearest-first, so the cut drops the furthest. */
export const MAX_ZONES = 8;

/**
 * Merge distance for confluence, in ATR.
 *
 * 0.35 is about a third of a day's range: near enough that price cannot
 * meaningfully distinguish the two levels within a session, which is the only
 * defensible meaning of "these line up".
 */
export const CONFLUENCE_ATR = 0.35;

/** Retracement ratios drawn. 0.618 is the one the UI emphasises. */
export const FIB_RATIOS = [0.382, 0.5, 0.618, 0.786] as const;

/** How near 0.618 price must sit to be called "in the golden zone". */
export const FIB_ZONE_TOLERANCE = 0.05;

/**
 * Shortest impulse leg worth retracing, in ATR.
 *
 * Derived, not guessed. The closest pair of ratios drawn is 0.5 and 0.618, which
 * sit `0.118 x leg` apart. For those two to be distinguishable — at least one
 * confluence tolerance apart — the leg must satisfy `0.118 x leg >= 0.35`, i.e.
 * `leg >= 2.97` ATR. Below that the grid renders four lines a trader could not
 * place separate orders at, which is noise wearing the costume of precision.
 */
export const MIN_LEG_ATR = 3;

/** Fewest bars before any structure is computed at all. */
export const STRUCTURE_MIN_BARS = 60;


/**
 * Percentile bands for how big a week's COT flow was.
 *
 * Measured against the contract's OWN 156 weekly changes, never an absolute
 * contract count — 5,000 contracts is a huge week in NZD and noise in gold, so
 * a fixed threshold would rank the largest markets top every single week.
 */
export const COT_FLOW_BANDS = {
  extreme: 95,
  heavy: 80,
  notable: 50,
} as const;


// ---------------------------------------------------------------------------
// Bias labels
// ---------------------------------------------------------------------------

export type Bias = 'Very Bullish' | 'Bullish' | 'Neutral' | 'Bearish' | 'Very Bearish';

/**
 * Total score -> label. Published verbatim at
 * a1trading.com/edgefinder/top-setups/: "'Bullish' if the total score is greater
 * or equal to +4, and 'Very Bullish' if the total score is greater or equal
 * to +7", mirrored for the downside.
 *
 * THESE CUTS ARE ABSOLUTE, NOT A FRACTION OF THE MAXIMUM. A1 never moved them as
 * they added columns, which is why a EURUSD can print 14 and still just be "Very
 * Bullish" — 14 is twice the threshold, not near a cap.
 *
 * The direct consequence: adding a scoring column silently redefines what
 * "Bullish" means. That is the entire reason SlotDefinition carries a `scoring`
 * flag, and why MAX_PAIR_SCORE below is asserted in the test suite.
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

/**
 * Largest total a symbol of this kind can reach.
 *
 * THIS DIFFERS BY ASSET CLASS. An FX pair DIFFERENCES two economies, so each
 * macro cell spans +/-2; gold, an index or a crypto reads ONE economy, so the
 * same cell spans only +/-1. A single-economy asset can never reach an FX pair's
 * total, and drawing it on an FX dial permanently understates it — that is what
 * made Gold read "+5 out of 25".
 *
 * Both numbers are large relative to the +/-7 "Very Bullish" cut, and that is
 * A1's design rather than a flaw in ours: their bands are absolute and never
 * moved as they added columns, so their own EURUSD prints 9 and their GBPUSD 11
 * on the same 18-column table.
 *
 * Computed from the slot list rather than written down, so it tracks changes,
 * and asserted in the test suite so adding a column has to be deliberate.
 */
export function maxScoreForKind(kind: SymbolKind): number {
  return SCORING_SLOTS.reduce((total, slot) => total + maxCellFor(slot.key, kind), 0);
}

/**
 * Largest value ONE cell of this slot can reach, for this asset class.
 *
 * Extracted from `maxScoreForKind` rather than duplicated, because the UI needs
 * exactly this number to say whether "+2" is a strong reading or a maximal one,
 * and the total is defined as the sum of these. Two copies of the rule would
 * eventually let a cell be labelled "Very Bullish" on a scale the total does not
 * agree exists.
 */
export function maxCellFor(slotKey: string, kind: SymbolKind): number {
  const slot = SLOTS.find((s) => s.key === slotKey);

  if (slotKey === 'seasonality') return SEASONALITY_CELL_MAX_BY_KIND[kind];
  if (slotKey === 'trend') return slot?.maxCell ?? CELL_MAX;
  if (slotKey === 'cot') return slot?.maxCell ?? PAIR_CELL_MAX;
  if (slotKey === 'crowd') return slot?.maxCell ?? CELL_MAX;

  // Everything else is an economic cell: only a pair differences two legs, so
  // it spans +/-2 where a single-economy asset spans +/-1.
  return kind === 'fx' ? PAIR_CELL_MAX : CELL_MAX;
}

/** Convenience for the FX case, which is what most callers mean. */
export function maxPairScore(): number {
  return maxScoreForKind('fx');
}
