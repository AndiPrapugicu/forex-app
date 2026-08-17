/**
 * Price quotes for metals, oil and FX.
 *
 * IMPORTANT: prices are CONTEXT ONLY. They are displayed next to scores but are
 * never an input to any score. That is a deliberate containment decision — Yahoo
 * is an undocumented endpoint, and if it starts returning nonsense the worst
 * outcome must be a missing number on screen, never a corrupted signal.
 */

import { ASSET_DEFINITIONS, CONTEXT_SYMBOLS } from '@/config/assets.config';
import { FRANKFURTER, YAHOO } from '@/config/sources.config';
import { fetchJson, fixturesEnabled } from '@/lib/connectors/base';
import { ok, type PriceQuote, type Result } from '@/lib/types';

interface YahooChartResponse {
  chart?: {
    result?: {
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        currency?: string;
      };
      indicators?: {
        quote?: { close?: (number | null)[] }[];
      };
    }[];
    error?: unknown;
  };
}

/**
 * Picks the reference close for a day-over-day change.
 *
 * Do NOT use `meta.chartPreviousClose`: on a 5-day range it is the close BEFORE
 * the window, so using it reports a 5-day move as if it were today's. Observed
 * live on GC=F — 4033.7 (5 days ago) against 4399.7 spot reads as +9.07% when
 * the actual daily move was +1.36%. On a trading dashboard that is not a
 * cosmetic error; it is a number someone might act on.
 *
 * Futures symbols also often omit `meta.previousClose` entirely, so the daily
 * close series is the only dependable source.
 */
function pickPreviousClose(closes: (number | null)[], spot: number): number | null {
  const valid = closes.filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  if (valid.length === 0) return null;

  const last = valid[valid.length - 1];

  // When the session is live, the final bar IS today and must be skipped —
  // comparing spot against today's own partial close would show ~0% forever.
  // A tiny relative difference means they are the same bar.
  const sameBar = Math.abs(last - spot) / Math.max(Math.abs(spot), 1e-9) < 1e-6;
  if (sameBar) return valid.length >= 2 ? valid[valid.length - 2] : null;

  return last;
}

/**
 * Matches the browser poll interval in `useLiveQuotes`. Every tab on every page
 * then costs one upstream batch rather than one per tab, and someone hammering
 * refresh cannot amplify it.
 */
export const SPARK_TTL_SECONDS = 10;

/** One symbol's live reading, as `/api/quotes` serves it to the browser. */
export interface SparkQuote {
  /** Yahoo's ticker, not our display symbol — the caller maps it back. */
  ticker: string;
  price: number;
  previousClose: number | null;
  changePct: number | null;
  /** Yahoo's own stamp, in seconds. Null when they did not send one. */
  time: number | null;
  /**
   * The session's extremes as Yahoo saw them, which is more than our polls did.
   * The chart prefers these when widening the forming bar's wick, so a tick
   * between two polls is not lost.
   */
  dayHigh: number | null;
  dayLow: number | null;
}

interface YahooSparkResponse {
  spark?: {
    result?: {
      symbol?: string;
      response?: {
        meta?: {
          symbol?: string;
          regularMarketPrice?: number;
          regularMarketTime?: number;
          regularMarketDayHigh?: number;
          regularMarketDayLow?: number;
          previousClose?: number;
        };
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }[];
    }[];
  };
}

function finiteOrNull(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Live prices for many tickers at once.
 *
 * `range=5d` rather than `1d`, for the same reason `fetchYahooQuote` uses it:
 * a 1-day range has nothing to compare against over a weekend or a holiday, and
 * `meta.chartPreviousClose` is a trap — on GC=F it was four sessions old. Spark
 * returns the daily close series, so `pickPreviousClose` does the work here
 * exactly as it does for the single-symbol path, and there is one rule for
 * "yesterday's close" in this file rather than two.
 *
 * Partial results are the norm and are returned as such: a ticker Yahoo has
 * nothing for is absent from the map, never present with a zero.
 */
export async function fetchSparkQuotes(tickers: string[]): Promise<Map<string, SparkQuote>> {
  const out = new Map<string, SparkQuote>();
  if (tickers.length === 0) return out;

  /**
   * Offline mode has no live price by definition, and the honest answer is an
   * empty map. Every caller already falls back to the server-rendered price and
   * labels itself "not live", which is exactly right here — replaying a captured
   * tick would put a pulsing live dot next to a number from last week.
   */
  if (fixturesEnabled()) return out;

  const batches = await Promise.all(
    chunk([...new Set(tickers)], YAHOO.sparkMaxSymbols).map(async (batch) => {
      const url =
        `${YAHOO.sparkBase}?symbols=${encodeURIComponent(batch.join(','))}` +
        '&range=5d&interval=1d';

      return fetchJson<YahooSparkResponse>(YAHOO.name, url, {
        headers: { ...YAHOO.headers },
        cacheTtlSeconds: SPARK_TTL_SECONDS,
        // Batches share a host cache with the rest of the app, so the key has
        // to name the batch — otherwise two different batches collide.
        cacheKey: `yahoo:spark:${batch.join(',')}`,
        timeoutMs: 8000,
        retries: 0,
      });
    }),
  );

  for (const res of batches) {
    if (!res.ok) continue;

    for (const entry of res.data.spark?.result ?? []) {
      const resp = entry.response?.[0];
      const meta = resp?.meta;
      const ticker = entry.symbol ?? meta?.symbol;
      const price = meta?.regularMarketPrice;

      if (!ticker || typeof price !== 'number' || !Number.isFinite(price)) continue;

      const closes = resp?.indicators?.quote?.[0]?.close ?? [];
      const prev =
        typeof meta?.previousClose === 'number' && Number.isFinite(meta.previousClose)
          ? meta.previousClose
          : pickPreviousClose(closes, price);

      out.set(ticker, {
        ticker,
        price,
        previousClose: prev,
        changePct: prev !== null && prev !== 0 ? ((price - prev) / prev) * 100 : null,
        time: finiteOrNull(meta?.regularMarketTime),
        dayHigh: finiteOrNull(meta?.regularMarketDayHigh),
        dayLow: finiteOrNull(meta?.regularMarketDayLow),
      });
    }
  }

  return out;
}

const SYMBOLS: { symbol: string; label: string }[] = [
  ...ASSET_DEFINITIONS.map((a) => ({ symbol: a.symbol, label: a.label })),
  ...CONTEXT_SYMBOLS,
];

async function fetchYahooQuote(symbol: string, label: string): Promise<PriceQuote | null> {
  // range=5d gives us a usable previousClose even across weekends and holidays,
  // when a 1d range can come back with nothing to compare against.
  const url = `${YAHOO.chartBase}/${encodeURIComponent(symbol)}?range=5d&interval=1d`;

  const res = await fetchJson<YahooChartResponse>(YAHOO.name, url, {
    headers: { ...YAHOO.headers },
    cacheTtlSeconds: YAHOO.cacheTtlSeconds,
    timeoutMs: 8000,
    retries: 1,
  });

  if (!res.ok) return null;

  const result = res.data.chart?.result?.[0];
  const meta = result?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;

  // Prefer meta.previousClose when present (equities, FX), else derive it from
  // the daily close series (futures). See pickPreviousClose for why
  // chartPreviousClose is deliberately not used.
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const prev =
    typeof meta?.previousClose === 'number' && Number.isFinite(meta.previousClose)
      ? meta.previousClose
      : pickPreviousClose(closes, price);

  const changePct = prev !== null && prev !== 0 ? ((price - prev) / prev) * 100 : null;

  return {
    symbol,
    label,
    price,
    previousClose: typeof prev === 'number' ? prev : null,
    changePct,
    currency: meta?.currency ?? 'USD',
  };
}

/**
 * FX-only fallback if Yahoo refuses us.
 * Cannot serve metals or oil — those simply go missing, which the UI handles.
 */
async function fetchFrankfurterFx(): Promise<PriceQuote[]> {
  const res = await fetchJson<{ rates?: Record<string, number> }>(
    FRANKFURTER.name,
    `${FRANKFURTER.url}?base=EUR&symbols=USD`,
    { cacheTtlSeconds: FRANKFURTER.cacheTtlSeconds, timeoutMs: 8000, retries: 1 },
  );

  if (!res.ok) return [];
  const usd = res.data.rates?.USD;
  if (typeof usd !== 'number') return [];

  return [
    {
      symbol: 'EURUSD=X',
      label: 'EUR/USD',
      price: usd,
      previousClose: null,
      changePct: null,
      currency: 'USD',
    },
  ];
}

export async function fetchPrices(): Promise<Result<PriceQuote[]>> {
  if (fixturesEnabled()) {
    const fixture = (await import('@/fixtures/sample-prices.json')).default;
    return ok('prices:fixture', fixture as PriceQuote[]);
  }

  const quotes = (await Promise.all(SYMBOLS.map((s) => fetchYahooQuote(s.symbol, s.label)))).filter(
    (q): q is PriceQuote => q !== null,
  );

  if (quotes.length > 0) {
    const missing = SYMBOLS.length - quotes.length;
    return ok(
      YAHOO.name,
      quotes,
      missing > 0 ? `${missing} of ${SYMBOLS.length} symbols unavailable` : undefined,
    );
  }

  // Yahoo is fully down — salvage what we can so the UI is not blank.
  const fallback = await fetchFrankfurterFx();
  if (fallback.length > 0) {
    return ok(FRANKFURTER.name, fallback, 'Yahoo unavailable — FX only, no metals or oil');
  }

  return {
    ok: false,
    error: 'Yahoo and Frankfurter both unavailable',
    source: 'prices',
    fetchedAtUtc: new Date().toISOString(),
  };
}
