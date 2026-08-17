/**
 * The single normalized shape every connector must produce.
 *
 * Connectors differ wildly (FXStreet JSON, FairEconomy JSON, RSS XML, Yahoo chart
 * envelopes). They all funnel into these types so the scoring engine never has to
 * know or care where a number came from — only how much to trust it.
 */

// ---------------------------------------------------------------------------
// Currencies & assets
// ---------------------------------------------------------------------------

/**
 * The 8 majors. This list is what `buildFxPairs()` crosses into the 28 pairs,
 * and what the currency-strength and carry tables rank — so it is a
 * SCORING-UNIVERSE list, not merely a list of currency codes.
 */
export const MAJORS = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'] as const;

/**
 * Currencies we score a leg of, but do NOT cross into every pair.
 *
 * ZAR is here for USDZAR, which EdgeFinder carries as a major. Adding it to
 * MAJORS instead would have manufactured eight ZAR crosses nobody asked for —
 * EURZAR, GBPZAR and so on — because the pair table is a full cross product of
 * that list. Keeping the two lists separate is what makes "one more pair" cost
 * one entry instead of eight.
 */
export const MINOR_CURRENCIES = ['ZAR'] as const;

/** Every currency the app can carry a macro or positioning reading for. */
export const CURRENCIES = [...MAJORS, ...MINOR_CURRENCIES] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Non-currency instruments the user trades. Scored via betas, not directly. */
export const ASSETS = ['XAU', 'XAG', 'XPT', 'WTI'] as const;
export type Asset = (typeof ASSETS)[number];

/**
 * Still the 8, deliberately. Callers use this to decide what belongs in a
 * strength ranking or a carry table, and a currency with one pair and almost no
 * calendar coverage does not belong in either.
 */
export function isMajor(code: string | null | undefined): code is (typeof MAJORS)[number] {
  return !!code && (MAJORS as readonly string[]).includes(code);
}

export function isCurrency(code: string | null | undefined): code is Currency {
  return !!code && (CURRENCIES as readonly string[]).includes(code);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Impact tiers. Maps from FXStreet `volatility` and FairEconomy `impact`. */
export type Impact = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/** Where a number came from. Drives the base confidence score. */
export type SourceKind =
  | 'manual' // user typed it in — trusted above everything
  | 'fxstreet'
  | 'faireconomy'
  | 'dbnomics'
  | 'tradingview' // the Conference Board series, which no other free feed populates
  | 'ai-extracted' // parsed out of a headline by the LLM — always flagged
  | 'fixture'; // offline sample data

/** Classification buckets, shared by macro events and news. */
export type Category =
  | 'inflation'
  | 'labor'
  | 'growth'
  | 'central-bank'
  | 'risk-sentiment'
  | 'geopolitics'
  | 'energy'
  | 'other';

/**
 * A macroeconomic calendar event, normalized.
 *
 * `actual` is nullable because most of the calendar is in the future — an event
 * with `actual === null` is upcoming, one with a value has printed. That
 * transition is what drives the "what just came out" panel and the alert engine.
 */
export interface NormalizedEvent {
  /** Stable across ingests so we can diff and dedupe. */
  id: string;
  /** FXStreet's recurring-series id, if known. Groups NFP-Jan with NFP-Feb. */
  seriesId?: string | null;
  name: string;
  currency: Currency;
  /**
   * Publishing country/region, e.g. "US", "EMU", "DE".
   *
   * Distinct from `currency` and NOT redundant: the euro area publishes under
   * EMU plus every member state (DE, IT, ES...), all tagged EUR. The scorecard
   * must scope to the aggregate, or German CPI gets read as euro-area CPI.
   */
  countryCode?: string | null;
  /** ISO-8601 UTC. */
  dateUtc: string;
  impact: Impact;

  actual: number | null;
  consensus: number | null;
  previous: number | null;
  revised: number | null;
  unit?: string | null;

  /**
   * FXStreet's pre-normalized surprise, roughly in standard deviations.
   * Strongly preferred over our own config-based normalization when present —
   * it is calibrated on that series' own history, which we cannot match.
   */
  ratioDeviation: number | null;

  /**
   * FXStreet's own read on whether the print beat expectations, already
   * polarity-aware (higher unemployment => false). Used ONLY as a cross-check:
   * "better for the economy" is not the same as "bullish for the currency".
   */
  isBetterThanExpected: boolean | null;

  isSpeech: boolean;
  isPreliminary: boolean;

  source: SourceKind;
  /** Where `actual` specifically came from — may differ from `source`. */
  actualSource: SourceKind | null;
  sourceUrl?: string | null;
  /** Feed-provided modification time; used to detect a fresh print. */
  lastUpdated?: number | null;
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  /** Bare domain — corroboration counts distinct domains, never article count. */
  domain: string;
  sourceName: string;
  publishedUtc: string;
  summary?: string | null;
  category: Category;
  /** Keywords that matched the geopolitical/risk scanner. */
  matchedKeywords: string[];
  /** Currencies/assets the headline plausibly touches. */
  affects: (Currency | Asset)[];
}

/**
 * Several headlines about the same underlying story, grouped.
 * Corroboration across distinct domains is what lets an alert be "high confidence".
 */
export interface NewsCluster {
  id: string;
  headline: string;
  items: NewsItem[];
  /** Count of DISTINCT domains — the number that actually gates confidence. */
  domainCount: number;
  category: Category;
  firstSeenUtc: string;
  lastSeenUtc: string;
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/**
 * One step of the scoring arithmetic, kept so the UI can show its work.
 * Rendered as a plain-English trace BEFORE any AI text, so the number always
 * stands on its own.
 */
export interface ScoreTraceStep {
  label: string;
  detail: string;
  value: number;
  /**
   * How to render `value`.
   *
   * Multipliers must not be shown with a leading "+" — "+0.6" next to a list of
   * numbers reads as an additive term, when the regime step actually SCALES the
   * score by 0.6. Rendering it as "×0.6" is the difference between a trace the
   * reader can follow and one that quietly misleads.
   */
  op?: 'signed' | 'multiplier' | 'plain';
}

export type Direction = 'bullish' | 'bearish' | 'neutral' | 'uncertain';

export interface EventScore {
  eventId: string;
  currency: Currency;
  /** -10..+10, positive = bullish for `currency`. */
  score: number;
  /** 0..100. Below CONFIDENCE_FLOOR the UI shows "uncertain", not a direction. */
  confidence: number;
  direction: Direction;
  /** Surprise in standard deviations, signed by the raw beat/miss. */
  surprise: number | null;
  trace: ScoreTraceStep[];
  /** Set when our config polarity disagrees with the feed's own read. */
  polarityConflict: boolean;
  scoredAtUtc: string;
}

export interface CurrencyStrength {
  currency: Currency;
  score: number; // -10..+10
  confidence: number; // 0..100
  direction: Direction;
  /** How many scored events fed this, for "is this thin data?" context. */
  contributors: number;
}

export interface PairScore {
  pair: string; // "EURUSD"
  base: Currency;
  quote: Currency;
  score: number; // -10..+10, positive = base strengthens vs quote
  confidence: number;
  direction: Direction;
}

/** A single labelled term in an asset's score, so gold is always attributable. */
export interface AssetContribution {
  label: string;
  beta: number;
  input: number;
  contribution: number;
}

export interface AssetScore {
  asset: Asset;
  score: number; // -10..+10
  confidence: number;
  direction: Direction;
  contributions: AssetContribution[];
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'info';

export type AlertKind =
  | 'high-impact-upcoming'
  | 'surprise-deviation'
  | 'geopolitical'
  | 'central-bank'
  | 'news-cluster';

export interface Alert {
  id: string;
  /** Content hash — the dedupe key that stops the 10-min cron re-sending. */
  hash: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  body: string;
  affects: (Currency | Asset)[];
  /** Every alert must carry its receipts. */
  sources: { name: string; url: string }[];
  createdUtc: string;
  /** True only when corroborated across enough distinct domains. */
  highConfidence: boolean;
  eventId?: string | null;
}

// ---------------------------------------------------------------------------
// Prices (context only — never an input to any score)
// ---------------------------------------------------------------------------

export interface PriceQuote {
  symbol: string;
  label: string;
  price: number;
  previousClose: number | null;
  changePct: number | null;
  currency: string;
}

// ---------------------------------------------------------------------------
// Connector plumbing
// ---------------------------------------------------------------------------

/**
 * Every connector returns this instead of throwing. A dead upstream must
 * degrade to a banner in the UI, never a 500 or a blank dashboard.
 */
export type Result<T> =
  | { ok: true; data: T; source: string; fetchedAtUtc: string; degraded?: string }
  | { ok: false; error: string; source: string; fetchedAtUtc: string };

export function ok<T>(source: string, data: T, degraded?: string): Result<T> {
  return { ok: true, data, source, fetchedAtUtc: new Date().toISOString(), degraded };
}

export function fail<T>(source: string, error: string): Result<T> {
  return { ok: false, error, source, fetchedAtUtc: new Date().toISOString() };
}

/** Health of one upstream, surfaced in the dashboard's source strip. */
export interface SourceHealth {
  source: string;
  ok: boolean;
  detail?: string;
  fetchedAtUtc: string;
}

/**
 * One symbol's score at one moment.
 *
 * The only thing this app stores that it cannot later recompute: the free feeds
 * expose the CURRENT technicals and the LATEST COT report, with no history, so a
 * snapshot not taken is a data point gone for good.
 */
export interface ScoreSnapshot {
  symbol: string;
  capturedAtUtc: string;
  totalScore: number;
  bias: string;
  populated: number;
  categoryScores: Record<string, number>;
  price: number | null;
  /** slotKey -> cell value, for reconstructing a past card. */
  cells: Record<string, number | null>;
  /**
   * slotKey -> the currency leg that was missing when this was captured.
   *
   * Cannot be derived after the fact: `eur − usd` and `0 − usd` land on the
   * same number often enough that a past cell value says nothing about whether
   * it was built from one leg or two. Without this the change log can report
   * that a score moved but never that an upstream failure moved it.
   *
   * Optional because snapshots written before this existed do not have it.
   */
  partialLegs?: Record<string, string>;
}

/** Everything the dashboard needs, in one payload. */
export interface DashboardData {
  strengths: CurrencyStrength[];
  pairs: PairScore[];
  assets: AssetScore[];
  upcoming: NormalizedEvent[];
  recent: { event: NormalizedEvent; score: EventScore }[];
  alerts: Alert[];
  news: NewsCluster[];
  prices: PriceQuote[];
  health: SourceHealth[];
  marketMood: { score: number; label: string; confidence: number };
  generatedAtUtc: string;
}
