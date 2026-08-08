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
