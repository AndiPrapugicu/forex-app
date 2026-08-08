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
import { fetchJson, useFixtures } from '@/lib/connectors/base';
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
  if (useFixtures()) {
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
