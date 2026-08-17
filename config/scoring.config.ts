/**
 * The tuning surface for the entire scoring system.
 *
 * Everything here is data, not logic. If a score looks wrong, the fix belongs in
 * this file — `lib/scoring/` should not need to change. That separation is what
 * makes the output explainable: every number the UI shows traces back to a named
 * constant here plus the arithmetic in the engine.
 */

import type { Category, Currency, Impact } from '@/lib/types';

// ---------------------------------------------------------------------------
// Event type matching
// ---------------------------------------------------------------------------

export interface EventRule {
  /** Stable key, shown in the UI trace. */
  key: string;
  /** Matched case-insensitively against the event name. First match wins. */
  match: RegExp;
  category: Category;
  /**
   * +1 = a HIGHER reading is bullish for the currency (growth, inflation, jobs).
   * -1 = a HIGHER reading is bearish (unemployment, jobless claims, job cuts).
   *
   * Note this is "bullish for the currency", NOT "good for the economy". Hot
   * inflation is bad news and a bullish currency signal at the same time, which
   * is exactly why we cannot just trust the feed's `isBetterThanExpected`.
   */
  polarity: 1 | -1;
  /**
   * Fallback normalizer, in the event's own units, used ONLY when FXStreet
   * gives us no `ratioDeviation`. Represents a "typical" miss for that series.
   */
  typicalDeviation: number;
  /**
   * Does the hiking/cutting regime change how this reads? True for anything
   * that moves rate expectations through the inflation channel.
   */
  inflationSensitive?: boolean;
  /** Scales the final score. For series that are noisy or second-tier. */
  weight?: number;
}

/**
 * Ordered most-specific first — `Initial Jobless Claims` must be tested before a
 * generic /claims/ rule, and `ISM * Prices Paid` before a generic PMI rule.
 * Patterns are written against event names actually observed in the FXStreet
 * feed (see fixtures/sample-fxstreet.json).
 */
export const EVENT_RULES: EventRule[] = [
  // --- Central bank decisions: the heaviest hitters -------------------------
  {
    key: 'rate-decision',
    // The ECB variants are named after the facility rather than "rate decision"
    // ("ECB Rate On Deposit Facility", "ECB Main Refinancing Operations Rate"),
    // so they need explicit patterns or euro policy moves score as unclassified.
    match: /(interest rate decision|rate statement|policy rate|official cash rate|bank rate|fed interest rate|monetary policy statement|deposit facility|refinancing operations rate)/i,
    category: 'central-bank',
    polarity: 1,
    typicalDeviation: 0.25,
    inflationSensitive: true,
    weight: 1.2,
  },
  {
    key: 'cb-minutes',
    match: /(monetary policy meeting minutes|fomc minutes|meeting minutes|monetary policy report|economic bulletin|loan officer survey)/i,
    category: 'central-bank',
    polarity: 1,
    typicalDeviation: 1,
    inflationSensitive: true,
    weight: 0.5,
  },
  {
    key: 'cb-speech',
    match: /(speech|testimony|press conference|remarks)/i,
    category: 'central-bank',
    polarity: 1,
    typicalDeviation: 1,
    inflationSensitive: true,
    weight: 0.35,
  },

  // --- Inflation -----------------------------------------------------------
  {
    key: 'cpi',
    match: /(consumer price index|^cpi|core cpi|harmonized index of consumer prices|hicp|inflation rate)/i,
    category: 'inflation',
    polarity: 1,
    typicalDeviation: 0.2,
    inflationSensitive: true,
    weight: 1.15,
  },
  {
    key: 'ppi',
    match: /(producer price index|^ppi|wholesale price)/i,
    category: 'inflation',
    polarity: 1,
    typicalDeviation: 0.3,
    inflationSensitive: true,
    weight: 0.8,
  },
  {
    // The Fed's preferred inflation gauge, so it outweighs PPI. Tested before
    // the generic inflation-gauge rule below.
    key: 'pce',
    match: /(personal consumption expenditures)/i,
    category: 'inflation',
    polarity: 1,
    typicalDeviation: 0.15,
    inflationSensitive: true,
    weight: 1.1,
  },
  {
    key: 'inflation-gauge',
    match: /(inflation gauge|inflation expectations|prices paid|price index.*paid|kof leading indicator)/i,
    category: 'inflation',
    polarity: 1,
    typicalDeviation: 1.5,
    inflationSensitive: true,
    weight: 0.6,
  },
  {
    key: 'wages',
    match: /(average hourly earnings|average hourly wages|labor cash earnings|labour cost index|unit labor costs|wage price index|employment cost index)/i,
    category: 'inflation',
    polarity: 1,
    typicalDeviation: 0.15,
    inflationSensitive: true,
    weight: 1.0,
  },

  // --- Labour --------------------------------------------------------------
  {
    // MUST be tested before `nfp`: "ADP Employment Change" contains the words
    // "employment change", so the broader nfp pattern would otherwise swallow it
    // and the private-payrolls print would be scored as though it were NFP.
    key: 'adp',
    match: /(adp employment|adp national employment)/i,
    category: 'labor',
    polarity: 1,
    typicalDeviation: 40,
    weight: 0.7,
  },
  {
    key: 'nfp',
    match: /(nonfarm payrolls|non-farm payrolls|net change in employment|employment change|employment level)/i,
    category: 'labor',
    polarity: 1,
    typicalDeviation: 50,
    weight: 1.25,
  },
  {
    // Japan publishes no monthly payrolls; this ratio is the standard
    // labour-tightness read and is what the scorecard uses for JPY.
    key: 'jobs-applicants-ratio',
    match: /(jobs ?\/ ?applicants ratio|job-to-applicant)/i,
    category: 'labor',
    polarity: 1,
    typicalDeviation: 0.03,
    weight: 0.7,
  },
  {
    key: 'unemployment-rate',
    // Higher unemployment is bearish. Also catches U6 underemployment.
    match: /(unemployment rate|underemployment rate|jobless rate)/i,
    category: 'labor',
    polarity: -1,
    typicalDeviation: 0.15,
    weight: 1.1,
  },
  {
    key: 'jobless-claims',
    match: /(initial jobless claims|continuing jobless claims|jobless claims|unemployment claims)/i,
    category: 'labor',
    polarity: -1,
    typicalDeviation: 15,
    weight: 0.6,
  },
  {
    key: 'job-cuts',
    match: /(challenger job cuts|layoffs)/i,
    category: 'labor',
    polarity: -1,
    typicalDeviation: 20,
    weight: 0.4,
  },
  {
    key: 'job-openings',
    match: /(jolts|job openings|job vacancies)/i,
    category: 'labor',
    polarity: 1,
    typicalDeviation: 300,
    weight: 0.6,
  },
  {
    key: 'participation',
    match: /(participation rate)/i,
    category: 'labor',
    polarity: 1,
    typicalDeviation: 0.2,
    weight: 0.35,
  },

  // --- Growth / activity ---------------------------------------------------
  {
    key: 'gdp',
    match: /(gross domestic product|^gdp|gdp growth)/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 0.3,
    weight: 1.2,
  },
  // Manufacturing and services PMI are split so the scorecard can give them
  // separate columns. Order matters: both must be tested before the generic
  // /pmi/ catch-all below, or every PMI would match the generic rule first.
  {
    key: 'mpmi',
    match: /(manufacturing pmi|ism manufacturing|manufacturing purchasing managers|business nz pmi)/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 1.5,
    weight: 1.0,
  },
  {
    key: 'spmi',
    match: /(services pmi|ism services|services purchasing managers|business nz psi|non-manufacturing pmi)/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 1.5,
    weight: 1.0,
  },
  {
    key: 'pmi',
    match: /(pmi|purchasing managers|ivey)/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 1.5,
    weight: 1.0,
  },
  {
    key: 'retail-sales',
    match: /(retail sales|retail trade)/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 0.5,
    weight: 1.0,
  },
  {
    key: 'industrial-production',
    match: /(industrial production|manufacturing production|factory orders|durable goods)/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 1.0,
    weight: 0.7,
  },
  {
    key: 'productivity',
    match: /(nonfarm productivity|productivity)/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 0.8,
    weight: 0.4,
  },
  {
    key: 'trade-balance',
    match: /(trade balance|current account)/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 1000,
    weight: 0.6,
  },
  {
    key: 'exports',
    match: /(^exports|exports \()/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 2,
    weight: 0.4,
  },
  {
    key: 'imports',
    // Higher imports widen the deficit; treated as mildly negative, low weight
    // because it is genuinely ambiguous (also a demand signal).
    match: /(^imports|imports \()/i,
    category: 'growth',
    polarity: -1,
    typicalDeviation: 2,
    weight: 0.25,
  },
  {
    key: 'confidence-survey',
    match: /(consumer confidence|consumer sentiment|business confidence|economic sentiment|zew|ifo|sentix|aig industry)/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 2.5,
    weight: 0.7,
  },
  {
    key: 'housing',
    match: /(housing starts|building permits|building consents|home sales|house price)/i,
    category: 'growth',
    polarity: 1,
    typicalDeviation: 2,
    weight: 0.5,
  },

  // --- Energy (drives WTI and CAD) -----------------------------------------
  {
    key: 'oil-inventories',
    // Higher crude stock builds are bearish for oil.
    match: /(crude oil inventories|eia crude|api weekly crude|oil stocks change)/i,
    category: 'energy',
    polarity: -1,
    typicalDeviation: 2,
    weight: 0.8,
  },
];

/** Fallback when nothing matches: scored weakly, and confidence takes a hit. */
export const DEFAULT_EVENT_RULE: EventRule = {
  key: 'unclassified',
  match: /.^/,
  category: 'other',
  polarity: 1,
  typicalDeviation: 1,
  weight: 0.3,
};

export function matchEventRule(name: string): EventRule {
  return EVENT_RULES.find((r) => r.match.test(name)) ?? DEFAULT_EVENT_RULE;
}

// ---------------------------------------------------------------------------
// Weights and scaling
// ---------------------------------------------------------------------------

/** How much a release's headline importance scales its score. */
export const IMPACT_WEIGHT: Record<Impact, number> = {
  HIGH: 1.0,
  MEDIUM: 0.6,
  LOW: 0.3,
  NONE: 0.15,
};

/** Surprise is clamped to this many sigma before scaling — caps outlier blowups. */
export const MAX_SIGMA = 3;

/**
 * Converts sigma into the -10..+10 display scale.
 * 3 sigma * 1.0 impact * 1.0 weight * 3.3 => ~10, i.e. a maximal print pins the gauge.
 */
export const SCORE_SCALE = 3.3;

export const SCORE_MIN = -10;
export const SCORE_MAX = 10;

// ---------------------------------------------------------------------------
// Policy regime — the "context" that flips how inflation reads
// ---------------------------------------------------------------------------

export type Regime = 'hiking' | 'cutting' | 'neutral';

/**
 * Current policy stance per central bank. THIS IS THE MAIN DIAL TO KEEP CURRENT.
 *
 * It is the difference between "hot CPI is bullish because hikes are coming" and
 * "hot CPI merely delays the next cut". Nothing else in the app needs manual
 * upkeep — this does, because no free feed publishes "what stance is the ECB in".
 *
 * ---------------------------------------------------------------------------
 * LAST REVIEWED: 2026-08-08, against each central bank's most recent decision.
 *
 * Backdrop: the Middle East conflict pushed energy prices up and flipped much of
 * the developed world hawkish through mid-2026. That is why so many of these are
 * hiking or on hold rather than cutting.
 *
 *   USD  Fed   3.63%  Cut 4.33% -> 3.63% into Jan 2026, then FLAT for 7 months.
 *                     The cutting cycle is over; this is a hold.        -> neutral
 *   EUR  ECB   2.25%  HIKED +25bp in June 2026 on energy-driven
 *                     inflation, held 23 July.                          -> hiking
 *   GBP  BoE   3.75%  Held since Feb, but the dissent flipped direction:
 *                     Feb was 5-4 with four wanting CUTS, July was 6-3
 *                     with three wanting a HIKE to 4%. On hold with a
 *                     hawkish drift.                                    -> neutral
 *   JPY  BoJ   1.00%  Hiked to 1.00% in June 2026, held July, signalling
 *                     another hike as soon as September.                -> hiking
 *   AUD  RBA   4.35%  Three consecutive hikes Feb/Mar/May 2026 took the
 *                     cash rate 3.60% -> 4.35%. Hold expected August.   -> hiking
 *   NZD  RBNZ  2.50%  Cut to 2.50% on 8 July, further easing signalled.  -> cutting
 *   CAD  BoC   2.25%  Held April and July, Governing Council explicitly
 *                     calling the risks balanced.                       -> neutral
 *   CHF  SNB   0.00%  Held at zero, 2026 inflation forecast nudged UP
 *                     0.5% -> 0.6%, FX intervention readiness raised.   -> neutral
 *   ZAR  SARB  7.00%  Hiked 6.75% -> 7.00% on 28 May 2026, then HELD on
 *                     23 July against a 7.25% consensus. A cycle that
 *                     stopped short of what the market priced is not
 *                     still hiking, and one hold is not easing.         -> neutral
 *
 * To re-check: each bank publishes its decision statement, and the app's own
 * upcoming-events panel lists the next rate decisions. Update this block and the
 * dashboard rescores immediately — no other code changes.
 * ---------------------------------------------------------------------------
 */
export const CURRENCY_REGIME: Record<Currency, Regime> = {
  USD: 'neutral',
  EUR: 'hiking',
  GBP: 'neutral',
  JPY: 'hiking',
  AUD: 'hiking',
  NZD: 'cutting',
  CAD: 'neutral',
  CHF: 'neutral',
  ZAR: 'neutral',
};

/**
 * Applied only to inflation-sensitive events.
 *
 * Under `cutting`, an inflation upside surprise is still bullish — it pushes
 * cuts further out — but it carries less force than it would in a hiking cycle
 * where the same print pulls a *hike* forward.
 */
export const REGIME_MULTIPLIER: Record<Regime, number> = {
  hiking: 1.0,
  neutral: 0.85,
  cutting: 0.6,
};

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/** Base confidence by where the `actual` came from. */
export const SOURCE_CONFIDENCE = {
  manual: 95,
  fxstreet: 90,
  // A calendar aggregator: a real published number carrying the same consensus
  // ForexFactory shows, but one hop further from the issuing agency than
  // FXStreet's own feed.
  tradingview: 85,
  dbnomics: 80,
  faireconomy: 70,
  'ai-extracted': 55,
  fixture: 60,
} as const;

export const CONFIDENCE_PENALTY = {
  /** No consensus means no surprise — we are reading direction off `previous`. */
  noConsensus: 30,
  /** Our polarity and the feed's `isBetterThanExpected` disagree. */
  polarityConflict: 25,
  /** LLM pulled the number out of a headline and nothing has confirmed it. */
  aiUncorroborated: 20,
  /** Event name matched no rule, so polarity is a guess. */
  unclassified: 20,
  /** Per hour of age. */
  stalenessPerHour: 1,
} as const;

/** Corroboration bonus for news, granted at >= CORROBORATION_DOMAINS domains. */
export const CONFIDENCE_BONUS = { corroborated: 15 } as const;

/**
 * Below this, the UI must render "UNCERTAIN" rather than a direction.
 * Showing a weak bullish/bearish call is worse than admitting we do not know.
 */
export const CONFIDENCE_FLOOR = 40;

/** Distinct DOMAINS (not articles) needed before a story counts as corroborated. */
export const CORROBORATION_DOMAINS = 3;

// ---------------------------------------------------------------------------
// Time decay
// ---------------------------------------------------------------------------

/**
 * Half-life in hours when aggregating events into currency strength.
 * News fades fast; a macro print colours the tape for the rest of the session.
 */
export const HALF_LIFE_HOURS = {
  news: 8,
  macro: 24,
} as const;

/** Nothing older than this contributes to currency strength at all. */
export const AGGREGATION_WINDOW_HOURS = 72;

// ---------------------------------------------------------------------------
// Pairs
// ---------------------------------------------------------------------------

/** Pairs shown on the dashboard, in conventional quoting order. */
export const TRACKED_PAIRS: [Currency, Currency][] = [
  ['EUR', 'USD'],
  ['GBP', 'USD'],
  ['USD', 'JPY'],
  ['USD', 'CHF'],
  ['AUD', 'USD'],
  ['NZD', 'USD'],
  ['USD', 'CAD'],
  ['EUR', 'GBP'],
  ['EUR', 'JPY'],
  ['GBP', 'JPY'],
  ['AUD', 'NZD'],
  ['EUR', 'CHF'],
];

/**
 * A pair score is base minus quote, so its range is naturally -20..+20.
 * Halving returns it to the -10..+10 scale used everywhere else.
 */
export const PAIR_SCALE = 0.5;
