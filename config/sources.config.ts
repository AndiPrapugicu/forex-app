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
   * How far FORWARD the same window reaches, in days.
   *
   * Named rather than the magic 7 it used to be inline, because this is the knob
   * the Interest Rates column's coverage hangs on: `resolveNextRateDecision` can
   * only see a central bank meeting inside this window.
   *
   * WIDENING IT WAS TRIED AND MEASURED AND IS NOT WORTH IT — recorded here so
   * the next round does not repeat the experiment. A1's own published horizon is
   * a full QUARTER: their free "Interest Rate Projections" dashboard
   * (a1trading.com/interest-rates-data/) plots "market consensus estimates on
   * future projected interest rates" by calendar quarter. So 100 days was set to
   * match, and it worked in the sense that every G10 meeting became visible —
   * the event pool went 4,297 -> 6,481 and the next ECB, Fed, BoE, BoJ, SNB and
   * RBA decisions all appeared.
   *
   * NOT ONE OF THEM CARRIED A CONSENSUS. FXStreet publishes a forecast for a
   * rate decision only in the days before it: on 2026-08-29 the two meetings 4
   * days out (RBNZ, BoC) had one and every meeting 12 days or further out —
   * ECB 10 Sep, Fed 16 Sep, BoE 17 Sep, BoJ 18 Sep, SNB 24 Sep, RBA 29 Sep —
   * had `consensus: null`. So the wider window moved no cell, and cost a third
   * more payload on every run. The horizon that matters is the FORECASTER's,
   * not the fetch's.
   */
  historyLookaheadDays: 7,
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
 * TradingView's economic calendar — a CONSENSUS BACKFILL, with one named
 * exception listed in `actualSeries` below.
 *
 * FXStreet remains the source of record for what was released and when. This
 * exists for one narrow failure it has: a release arriving with an actual but
 * no forecast, which a ternary beat/miss rule cannot score at all. Measured on
 * the live feed, Switzerland is the worst hit — producer prices and the SECO
 * consumer survey both publish an actual against a null consensus, so every
 * franc cross lost those cells outright.
 *
 * The exception exists because "never a replacement" answers the wrong question
 * for a series FXStreet does not carry AT ALL: there is nothing to replace and
 * nothing to disagree with, only a column that stays blank forever. That is a
 * different situation from two feeds reporting the same release differently,
 * and it is confined to an explicit allowlist so it can never quietly become
 * the general case.
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

  /**
   * THE NAMED EXCEPTION to "never a second source of truth" above.
   *
   * Every entry here is a series FXStreet does not publish AT ALL, so there is
   * no row for the ordinary forecast backfill to attach to and no disagreement
   * for this to resolve wrongly — the choice is this or an empty column.
   *
   * An allowlist rather than a fallback, and that distinction is the whole
   * safety property: a fallback would silently adopt TradingView for any series
   * that happened to be missing on a given fetch, which turns a transient
   * FXStreet outage into a quiet source switch. Adding a row here is a
   * deliberate act, reviewed once, and the emitted event carries
   * `actualSource: 'tradingview'` so the card can say where the number came from.
   *
   * AUD retail sales is the case that forced it. The ABS retired monthly Retail
   * Trade in favour of the Household Spending Indicator, and FXStreet carries
   * neither — checked across all 217 Australian rows in a 120-day window, there
   * is no Retail Sales (MoM), no Retail Sales (QoQ) and no Household Spending.
   * TradingView carries Household Spending with both an actual and a forecast,
   * so the column is recoverable; without this it is blank forever.
   */
  actualSeries: [
    {
      currency: 'AUD',
      countryCode: 'AU',
      /** Their title, already normalized — see `normalizeSeriesName`. */
      tvName: 'household spending mom',
      /** What we publish it as. The slot's matcher targets THIS name. */
      publishAs: 'Household Spending (MoM)',
      unit: '%',
    },
    /**
     * Switzerland's UNADJUSTED registered unemployment rate.
     *
     * "FXStreet does not publish it AT ALL" is true here in the way that
     * matters, and the way it is true is worth stating precisely: SECO releases
     * TWO rates on the same morning, adjusted and unadjusted, and FXStreet
     * carries only `Unemployment Rate s.a (MoM)`. Same publisher, same day, same
     * statistic — a DIFFERENT SERIES. Checked across all 88 Swiss rows in the
     * window: there is exactly one unemployment row and it is the adjusted one.
     *
     * The two are not interchangeable, and the seasonal shape is what proves it:
     *
     *   unadjusted   3.2 3.1 3.0 3.0 2.9 3.0     Feb..Jul 2026, winter high, summer low
     *   adjusted     3.0 3.0 3.0 3.1 3.1 3.1     flat, by construction
     *
     * The July print therefore ROSE on one series (2.9 -> 3.0) and was FLAT on
     * the other (3.1 -> 3.1). One release, two opposite cells.
     */
    {
      currency: 'CHF',
      countryCode: 'CH',
      tvName: 'unemployment rate',
      /**
       * Deliberately NOT the FXStreet name. Publishing it as
       * `Unemployment Rate s.a (MoM)` would put two different series under one
       * string and let whichever arrived first win the slot.
       */
      publishAs: 'Unemployment Rate',
      unit: '%',
    },
  ] as const,
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
 * Forex desks and central banks only, re-chosen 2026-09-13.
 *
 * The first set was general world news (BBC World, Al Jazeera, CNBC, WSJ), which
 * filled the alert feed with wildfires and island seizures that move no
 * currency. Every feed below was fetched on that date and returned a dated item
 * on every entry. ForexFactory has no usable news feed — its site is behind a
 * Cloudflare challenge — so its calendar JSON stays the only FF source.
 *
 * Still spread across organisations: corroboration counts distinct domains, and
 * three "sources" that are one newsroom syndicating itself prove nothing.
 */
export const NEWS_FEEDS: NewsFeed[] = [
  {
    name: 'FXStreet',
    url: 'https://www.fxstreet.com/rss/news',
    domain: 'fxstreet.com',
    defaultCategory: 'risk-sentiment',
  },
  {
    name: 'investingLive',
    url: 'https://investinglive.com/feed/',
    domain: 'investinglive.com',
    defaultCategory: 'risk-sentiment',
  },
  {
    name: 'Investing.com Forex',
    url: 'https://www.investing.com/rss/news_1.rss',
    domain: 'investing.com',
    defaultCategory: 'risk-sentiment',
  },
  {
    name: 'FXEmpire',
    url: 'https://www.fxempire.com/api/v1/en/articles/rss/news',
    domain: 'fxempire.com',
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
    name: 'Reuters Business (Google News)',
    url: 'https://news.google.com/rss/search?q=when:24h+allinurl:reuters.com/business&hl=en-US&gl=US&ceid=US:en',
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
// Retail positioning (the Crowd Sentiment column)
// ---------------------------------------------------------------------------

/**
 * Myfxbook Community Outlook — the retail long/short share, per instrument.
 *
 * WHY THIS PROVIDER AND NOT FXSSI. A1's crowd cell matches FXSSI's broker
 * aggregate closely enough to be the same population, so FXSSI was the first
 * choice and had to be rejected on licensing, not on fit: FXSSI publish that
 * they provide no data-output service and that their agreements with the
 * contributing brokers forbid redistribution to third parties. The only way to
 * get their numbers is to scrape the page, which is exactly the dependency this
 * repo will not take.
 *
 * Myfxbook is the closest LEGITIMATE substitute, and not by accident — `MFB` is
 * one of the nine broker feeds FXSSI itself aggregates. So this is one of A1's
 * own constituent populations rather than an unrelated proxy: the same measure
 * over a narrower sample. Expect agreement on direction and occasional
 * disagreement near the 40/60 boundaries.
 *
 * COVERAGE IS THE OPEN QUESTION, and it is the reason this ships disabled. The
 * endpoint returns every symbol it tracks in ONE response, so what it covers
 * cannot be checked without an account. Turn it on and `npm run crowd-coverage`
 * prints exactly which of our 29 FX symbols it answers for.
 *
 * ONE CALL PER REFRESH, DELIBERATELY. The free tier allows 100 requests per 24
 * hours and there is no per-symbol query — asking for 29 symbols individually is
 * both impossible and a way to burn the quota in an hour. A 20-minute TTL is 72
 * calls a day, inside the free limit with room for restarts.
 */
export const MYFXBOOK = {
  name: 'Myfxbook Community Outlook',
  login: 'https://www.myfxbook.com/api/login.json',
  outlook: 'https://www.myfxbook.com/api/get-community-outlook.json',
  /** "Invalidates the current session." Called after every ingest fetch. */
  logout: 'https://www.myfxbook.com/api/logout.json',
  /**
   * How often the ingest job may refresh the STORED feed. Sessions are bound to
   * the login IP and Vercel's egress IP changes between invocations, so a
   * deployment cannot hold a session: each refresh is login + outlook + logout in
   * one invocation. Hourly is 72 calls a day, under the free 100.
   */
  refreshMinutes: 60,
  /** A stored feed older than this is not scored; the column falls back to CFTC. */
  storedFeedMaxAgeHours: 26,
  /** 72 calls/day against a 100/day free quota. */
  cacheTtlSeconds: 1200,
  /** Sessions are IP-bound and live a month; re-login well before that. */
  sessionTtlSeconds: 86_400,
} as const;

/**
 * OANDA position book — the second retail-positioning provider.
 *
 * WHY IT PASSES THE GATE THE OTHERS FAILED. It is a documented endpoint of
 * OANDA's public v20 REST API, read with a token from the user's OWN account
 * (a free practice account works), so it is "documented and permitted" in the
 * sense `crowd:no-public-cross-feed-passes-the-gate` required. It is one
 * broker's book rather than a multi-broker aggregate like A1's, so treat its
 * agreement with A1 as a measurement, not a given.
 *
 * ONE REQUEST PER INSTRUMENT. There is no bulk call, and the book exists only
 * for a subset of pairs — an instrument without one answers 404 and is simply
 * not covered. `npm run check:oanda` prints which of ours it answers for.
 *
 * Env: OANDA_API_TOKEN (required), OANDA_ENV = practice | live (default practice).
 */
export const OANDA_POSITION_BOOK = {
  name: 'OANDA Position Book',
  practiceBase: 'https://api-fxpractice.oanda.com/v3/instruments',
  liveBase: 'https://api-fxtrade.oanda.com/v3/instruments',
  /** OANDA refreshes the book every 20 minutes; asking more often gets the same book. */
  cacheTtlSeconds: 1200,
  /** Concurrent requests per wave, well inside OANDA's per-second limit. */
  batch: 6,
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
