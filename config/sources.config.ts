/**
 * Every upstream, with the quirks discovered while probing them live.
 *
 * Read the comments before changing a URL — several of these endpoints are
 * undocumented and fail in non-obvious ways (FXStreet 401s without a Referer;
 * GDELT hard-throttles by IP; ForexFactory only ever serves the current week).
 */

import type { Category } from '@/lib/types';

// ---------------------------------------------------------------------------
// Economic calendar
// ---------------------------------------------------------------------------

export const FXSTREET = {
  name: 'FXStreet',
  /** Range endpoint: `${base}/${fromIso}/${toIso}`. Arbitrary ranges work. */
  base: 'https://calendar-api.fxstreet.com/en/api/v1/eventDates',
  /**
   * REQUIRED. The API returns 401 without it — this header is the entire auth
   * mechanism. Verified during planning: same request 200s with it, 401s without.
   */
  headers: {
    Referer: 'https://www.fxstreet.com/',
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
  },
  /** How far back/forward to pull on each ingest, for news and alerts. */
  lookbackHours: 48,
  lookaheadHours: 168,
  cacheTtlSeconds: 300,

  /**
   * Separate, much longer window for the scorecard.
   *
   * The 48-hour ingest window is right for "what just came out", but useless for
   * the Top Setups matrix, which needs the LATEST print of each indicator — and
   * most publish monthly, GDP quarterly. With the short window nearly every
   * fundamental column came back empty.
   *
   * 150 days covers the longest staleness allowance (120 days for GDP and rate
   * decisions) with margin. Measured cost: ~3.9 MB / 6,078 events, against
   * 2.4 MB at 90 days (too short for GDP) and 5.2 MB at 200 (no extra coverage).
   */
  historyLookbackDays: 150,
  /**
   * Historical releases do not change, so this is cached hard. Only the leading
   * edge moves, and the 48-hour ingest window handles that.
   */
  historyCacheTtlSeconds: 3600,
} as const;

export const FAIRECONOMY = {
  name: 'ForexFactory (FairEconomy)',
  /**
   * Schedule-only fallback for when FXStreet is unavailable.
   * Carries NO `actual` field — json, xml and csv variants were all checked.
   * Only `thisweek` exists; today/tomorrow/nextweek all 404.
   */
  url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  headers: { 'User-Agent': 'Mozilla/5.0' },
  /**
   * One hour. This host rate-limits hard — measured returning
   * `429 retry-after: 130` during development — and the payload is a WEEKLY
   * calendar that changes only when a forecast is revised. Polling it every
   * 15 minutes bought nothing and was what triggered the throttle.
   */
  cacheTtlSeconds: 3600,
} as const;

/**
 * TradingView's economic calendar — a CONSENSUS BACKFILL, never a replacement.
 *
 * FXStreet remains the source of record for what was released and when. This
 * exists for one narrow failure it has: a release arriving with an actual but
 * no forecast, which a ternary beat/miss rule cannot score at all. Measured on
 * the live feed, Switzerland is the worst hit — producer prices and the SECO
 * consumer survey both publish an actual against a null consensus, so every
 * franc cross lost those cells outright.
 *
 * Coverage is PARTIAL and that is expected: of the releases carrying an actual,
 * a forecast comes with 69% for the UK, 56% for Switzerland and 18% for New
 * Zealand. It fills what it can and leaves the rest honestly blank.
 *
 * Undocumented, like FXStreet's, and it wants browser-ish headers. Historical
 * forecasts do not change once published, so this is cached hard.
 */
export const TRADINGVIEW = {
  name: 'TradingView calendar',
  base: 'https://economic-calendar.tradingview.com/events',
  headers: {
    Origin: 'https://www.tradingview.com',
    Referer: 'https://www.tradingview.com/',
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
  },
  /**
   * Their country codes against ours. Only two differ, but both matter: every
   * euro-area aggregate and every UK release would otherwise fail to match.
   */
  countryToOurs: { EU: 'EMU', GB: 'UK' } as Record<string, string>,
  /** Matches FXSTREET.historyLookbackDays, so the two pools cover one window. */
  lookbackDays: 150,
  cacheTtlSeconds: 3600,

  /**
   * ONE REQUEST PER COUNTRY. This is not politeness, it is correctness.
   *
   * The endpoint caps a response at 2,000 rows and truncates from the NEWEST
   * end without saying so. Asking for all eight countries across 150 days
   * returned exactly 2,000 rows spanning 21 Mar to 5 Jun — silently discarding
   * the most recent ten weeks, which is the only part the scorecard reads. The
   * bug presented as an alias that would not match: Switzerland's consumer
   * survey had a forecast on 7 Aug and our copy stopped at 8 May.
   *
   * Per country the same window returns 91 rows for Switzerland and reaches
   * 14 Aug. The United States is the largest and still lands far short.
   */
  countries: ['US', 'EU', 'GB', 'JP', 'AU', 'NZ', 'CA', 'CH'] as const,
  /** Observed response cap. A country hitting it is reported as degraded. */
  rowCap: 2000,
  /** Concurrency, matching the discipline the other batched connectors use. */
  batchSize: 4,
} as const;

/**
 * TradingView's quote endpoint, for the 2-year government yields no keyless
 * daily source covered.
 *
 * The rate column asks whether the market prices a bank to hike or cut, which is
 * the 2-year against the standing policy rate. Only the Fed publishes its own
 * projection, so without a yield for the other seven that column is a hard 0 —
 * and therefore 0 on every non-USD cross, by construction.
 *
 * Returns `{"close": 4.3815, "update_mode": "streaming"}`. No key, one symbol per
 * request. USD and EUR are listed for completeness but FRED and the ECB remain
 * primary for those: they are the issuers' own series.
 */
export const TRADINGVIEW_QUOTE = {
  name: 'TradingView quotes',
  base: 'https://scanner.tradingview.com/symbol',
  headers: {
    Origin: 'https://www.tradingview.com',
    Referer: 'https://www.tradingview.com/',
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
  },
  /** TradingView's own tickers for each 2-year benchmark. */
  yield2y: {
    USD: 'TVC:US02Y',
    EUR: 'TVC:EU02Y',
    GBP: 'TVC:GB02Y',
    JPY: 'TVC:JP02Y',
    AUD: 'TVC:AU02Y',
    NZD: 'TVC:NZ02Y',
    CAD: 'TVC:CA02Y',
    CHF: 'TVC:CH02Y',
  } as Record<string, string>,
  /** A yield moves slowly enough that polling harder buys nothing. */
  cacheTtlSeconds: 6 * 3600,
  /** Concurrency, matching the other batched connectors. */
  batchSize: 4,
} as const;

// ---------------------------------------------------------------------------
// News — the corroboration set
// ---------------------------------------------------------------------------

export interface NewsFeed {
  name: string;
  url: string;
  /** Bare domain. Corroboration counts distinct domains, so this must be right. */
  domain: string;
  /** Hint used when the keyword scanner finds nothing specific. */
  defaultCategory: Category;
  /** Central-bank primary sources are authoritative, never just "a headline". */
  official?: boolean;
}

/**
 * All verified reachable during planning. Deliberately spread across
 * organisations — corroboration is meaningless if three "sources" are one
 * newsroom syndicating itself.
 */
export const NEWS_FEEDS: NewsFeed[] = [
  {
    name: 'BBC World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    domain: 'bbc.co.uk',
    defaultCategory: 'geopolitics',
  },
  {
    name: 'CNBC Markets',
    url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    domain: 'cnbc.com',
    defaultCategory: 'risk-sentiment',
  },
  {
    name: 'WSJ Markets',
    url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
    domain: 'wsj.com',
    defaultCategory: 'risk-sentiment',
  },
  {
    name: 'Federal Reserve',
    url: 'https://www.federalreserve.gov/feeds/press_all.xml',
    domain: 'federalreserve.gov',
    defaultCategory: 'central-bank',
    official: true,
  },
  {
    name: 'ECB Press',
    url: 'https://www.ecb.europa.eu/rss/press.html',
    domain: 'ecb.europa.eu',
    defaultCategory: 'central-bank',
    official: true,
  },
  {
    name: 'Al Jazeera',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    domain: 'aljazeera.com',
    defaultCategory: 'geopolitics',
  },
  {
    name: 'Reuters World (Google News)',
    url: 'https://news.google.com/rss/search?q=when:24h+allinurl:reuters.com&hl=en-US&gl=US&ceid=US:en',
    domain: 'reuters.com',
    defaultCategory: 'geopolitics',
  },
  {
    name: 'Bank of England',
    url: 'https://www.bankofengland.co.uk/rss/news',
    domain: 'bankofengland.co.uk',
    defaultCategory: 'central-bank',
    official: true,
  },
];

export const RSS_CACHE_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Prices — context only, never an input to a score
// ---------------------------------------------------------------------------

export const YAHOO = {
  name: 'Yahoo Finance',
  /** Undocumented but stable; verified for GC=F, SI=F, PL=F, CL=F, FX and DXY. */
  chartBase: 'https://query1.finance.yahoo.com/v8/finance/chart',
  /**
   * The one BATCH quote endpoint Yahoo still answers without credentials.
   *
   * `v7/finance/quote` now returns `{"code":"Unauthorized"}` and `v6` is a 404,
   * so a per-symbol chart call was the only option and 50 symbols meant 50
   * requests. Spark takes a comma-separated list and returns the same
   * `meta` + `indicators.quote[0].close` shape the chart endpoint does, which
   * means `pickPreviousClose` works on it unchanged.
   *
   * HARD LIMIT OF 20 SYMBOLS PER CALL — 21 is an HTTP 400, not a truncated
   * list, so the chunking in `fetchSparkQuotes` is load-bearing.
   */
  sparkBase: 'https://query1.finance.yahoo.com/v7/finance/spark',
  sparkMaxSymbols: 20,
  headers: { 'User-Agent': 'Mozilla/5.0' },
  cacheTtlSeconds: 120,
} as const;

/** FX-only fallback if Yahoo starts refusing us. Cannot serve metals or oil. */
export const FRANKFURTER = {
  name: 'Frankfurter',
  url: 'https://api.frankfurter.dev/v1/latest',
  cacheTtlSeconds: 600,
} as const;

// ---------------------------------------------------------------------------
// Actuals cross-check
// ---------------------------------------------------------------------------

export const DBNOMICS = {
  name: 'DBnomics',
  base: 'https://api.db.nomics.world/v22/series',
  cacheTtlSeconds: 3600,
} as const;

// ---------------------------------------------------------------------------
// Keyword scanner for breaking news / geopolitical alerts
// ---------------------------------------------------------------------------

export interface KeywordRule {
  category: Category;
  /** Contribution to the risk-off / escalation factors, 0..1. */
  severity: number;
  patterns: RegExp[];
  /** Marks this as an oil supply-risk signal, feeding the WTI score. */
  supplyRisk?: boolean;
}

export const KEYWORD_RULES: KeywordRule[] = [
  {
    category: 'geopolitics',
    severity: 1.0,
    patterns: [
      /\binvasion\b/i,
      /\binvades?\b/i,
      /\bdeclares? war\b/i,
      /\bnuclear\b/i,
      /\bmartial law\b/i,
    ],
  },
  {
    category: 'geopolitics',
    severity: 0.8,
    patterns: [/\bmissiles?\b/i, /\bairstrikes?\b/i, /\bstrikes? on\b/i, /\bdrone attack\b/i, /\bshelling\b/i],
    supplyRisk: true,
  },
  {
    category: 'geopolitics',
    severity: 0.65,
    patterns: [/\bsanctions?\b/i, /\bembargo\b/i, /\bexport ban\b/i, /\btariffs?\b/i],
    supplyRisk: true,
  },
  {
    category: 'geopolitics',
    severity: 0.7,
    patterns: [/\bstrait of hormuz\b/i, /\bred sea\b/i, /\bpipeline\b/i, /\brefinery\b/i, /\bopec\b/i],
    supplyRisk: true,
  },
  {
    category: 'risk-sentiment',
    severity: 0.6,
    patterns: [/\bemergency\b/i, /\bcrisis\b/i, /\bcollapse\b/i, /\bdefault\b/i, /\bbailout\b/i, /\bcontagion\b/i],
  },
  {
    category: 'central-bank',
    severity: 0.7,
    patterns: [
      /\brate (hike|cut|rise|decision)\b/i,
      /\bemergency meeting\b/i,
      /\bintervention\b/i,
      /\bunscheduled\b/i,
      /\bhawkish\b/i,
      /\bdovish\b/i,
    ],
  },
  {
    category: 'inflation',
    severity: 0.6,
    patterns: [/\binflation shock\b/i, /\bprice surge\b/i, /\bhyperinflation\b/i, /\bcost.of.living\b/i],
  },
];

/** Maps country/region words in a headline onto the currency they move. */
export const REGION_CURRENCY: { pattern: RegExp; currency: string }[] = [
  { pattern: /\b(united states|u\.s\.|us |america|washington|federal reserve|fed)\b/i, currency: 'USD' },
  { pattern: /\b(euro zone|eurozone|europe|ecb|germany|france|italy|spain|brussels)\b/i, currency: 'EUR' },
  { pattern: /\b(britain|uk|united kingdom|london|bank of england|boe)\b/i, currency: 'GBP' },
  { pattern: /\b(japan|tokyo|bank of japan|boj)\b/i, currency: 'JPY' },
  { pattern: /\b(australia|sydney|rba)\b/i, currency: 'AUD' },
  { pattern: /\b(new zealand|rbnz)\b/i, currency: 'NZD' },
  { pattern: /\b(canada|ottawa|bank of canada|boc)\b/i, currency: 'CAD' },
  { pattern: /\b(switzerland|swiss|snb)\b/i, currency: 'CHF' },
];
