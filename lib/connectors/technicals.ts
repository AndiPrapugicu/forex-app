/**
 * Price-derived inputs: moving averages, trend, seasonality, volatility.
 *
 * Two separate Yahoo series per symbol, with very different cache lives:
 *   - 2 years of DAILY bars for moving averages and volatility (1 hour TTL)
 *   - 10 years of MONTHLY bars for seasonality (7 day TTL — a decade of history
 *     does not meaningfully change week to week)
 *
 * Note this is the one place price data influences a score. Elsewhere in the app
 * prices are context only. The containment still holds where it matters: these
 * are technical columns on a technical row, and a Yahoo outage drops those cells
 * to null rather than corrupting the fundamental ones.
 */

import { SEASONALITY_YEARS } from '@/config/setups.config';
import { YAHOO } from '@/config/sources.config';
import { fetchJson, useFixtures } from '@/lib/connectors/base';
import { ok, type Result } from '@/lib/types';

interface YahooChart {
  chart?: {
    result?: {
      timestamp?: number[];
      meta?: { regularMarketPrice?: number };
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

export interface Technicals {
  symbol: string;
  price: number;

  /** Simple moving averages. Null when there is not enough history. */
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  /** How many of the four the price is above, 0..4. Null if none computed. */
  aboveCount: number | null;
  smaCount: number;

  /** Annualised standard deviation of daily returns over 30 sessions, %. */
  realizedVolPct: number | null;
  /** Mean absolute daily move, %. */
  avgDailyMove7Pct: number | null;
  avgDailyMove90Pct: number | null;

  /** Per-calendar-month seasonal statistics, keyed 1-12. */
  seasonality: Record<number, { meanPct: number; winRatePct: number; years: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const window = closes.slice(-n);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

async function fetchSeries(
  ticker: string,
  range: string,
  interval: string,
  ttlSeconds: number,
): Promise<{ timestamps: number[]; closes: number[]; price: number } | null> {
  const url = `${YAHOO.chartBase}/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`;

  const res = await fetchJson<YahooChart>(YAHOO.name, url, {
    headers: { ...YAHOO.headers },
    cacheTtlSeconds: ttlSeconds,
    cacheKey: `yahoo:${ticker}:${range}:${interval}`,
    timeoutMs: 15_000,
    retries: 1,
  });

  if (!res.ok) return null;

  const result = res.data.chart?.result?.[0];
  const rawCloses = result?.indicators?.quote?.[0]?.close ?? [];
  const rawStamps = result?.timestamp ?? [];
  const price = result?.meta?.regularMarketPrice;

  if (typeof price !== 'number' || !Number.isFinite(price)) return null;

  // Yahoo pads gaps with nulls; drop those points and their timestamps together
  // so the two arrays stay aligned.
  const timestamps: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = rawCloses[i];
    if (typeof c === 'number' && Number.isFinite(c)) {
      closes.push(c);
      timestamps.push(rawStamps[i] ?? 0);
    }
  }

  return { timestamps, closes, price };
}

/**
 * Per-month seasonal statistics from monthly bars.
 *
 * DEDUPES BY YEAR-MONTH FIRST. Yahoo's 10-year monthly series is not clean —
 * measured on EURUSD=X it returned March twice and omitted October entirely.
 * Aggregating naively double-counts one month's return and silently drops
 * another, which is exactly the kind of error that produces a confident-looking
 * seasonal edge that does not exist.
 */
export function computeSeasonality(
  timestamps: number[],
  closes: number[],
): Record<number, { meanPct: number; winRatePct: number; years: number }> {
  // Keep the last observation for each calendar month.
  const byYearMonth = new Map<string, { month: number; close: number; order: number }>();
  for (let i = 0; i < closes.length; i++) {
    const d = new Date(timestamps[i] * 1000);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    byYearMonth.set(`${year}-${String(month).padStart(2, '0')}`, {
      month,
      close: closes[i],
      order: year * 12 + month,
    });
  }

  const ordered = [...byYearMonth.values()].sort((a, b) => a.order - b.order);

  const buckets = new Map<number, number[]>();
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];

    // Only consecutive months form a valid month-over-month return. A gap
    // (October missing) must not be bridged into a two-month return.
    if (cur.order - prev.order !== 1) continue;
    if (prev.close === 0) continue;

    const ret = (cur.close / prev.close - 1) * 100;
    const list = buckets.get(cur.month) ?? [];
    list.push(ret);
    buckets.set(cur.month, list);
  }

  const out: Record<number, { meanPct: number; winRatePct: number; years: number }> = {};
  for (const [month, rets] of buckets) {
    if (rets.length === 0) continue;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const wins = rets.filter((r) => r > 0).length;
    out[month] = {
      meanPct: Math.round(mean * 100) / 100,
      winRatePct: Math.round((wins / rets.length) * 100),
      years: rets.length,
    };
  }
  return out;
}

async function computeForTicker(symbol: string, ticker: string): Promise<Technicals | null> {
  const daily = await fetchSeries(ticker, '2y', '1d', 3600);
  if (!daily || daily.closes.length < 20) return null;

  const { closes, price } = daily;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma100 = sma(closes, 100);
  const sma200 = sma(closes, 200);

  const smas = [sma20, sma50, sma100, sma200].filter((s): s is number => s !== null);
  const aboveCount = smas.length > 0 ? smas.filter((s) => price > s).length : null;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] !== 0) returns.push(closes[i] / closes[i - 1] - 1);
  }

  const meanAbs = (arr: number[]) =>
    arr.length ? (arr.reduce((a, b) => a + Math.abs(b), 0) / arr.length) * 100 : null;

  // Monthly series is much slower-moving, so it gets a 7-day cache.
  const monthly = await fetchSeries(ticker, `${SEASONALITY_YEARS}y`, '1mo', 7 * 86400);

  return {
    symbol,
    price,
    sma20,
    sma50,
    sma100,
    sma200,
    aboveCount,
    smaCount: smas.length,
    realizedVolPct:
      returns.length >= 30 ? Math.round(stdev(returns.slice(-30)) * Math.sqrt(252) * 1000) / 10 : null,
    avgDailyMove7Pct: returns.length >= 7 ? Math.round((meanAbs(returns.slice(-7)) ?? 0) * 100) / 100 : null,
    avgDailyMove90Pct:
      returns.length >= 90 ? Math.round((meanAbs(returns.slice(-90)) ?? 0) * 100) / 100 : null,
    seasonality: monthly ? computeSeasonality(monthly.timestamps, monthly.closes) : {},
  };
}

/**
 * Computes technicals for a set of symbols.
 *
 * Batched rather than fully parallel: 33 symbols x 2 series is 66 requests to an
 * undocumented endpoint, and firing those at once is a good way to get blocked.
 */
export async function fetchTechnicals(
  symbols: { symbol: string; yahoo: string }[],
): Promise<Result<Map<string, Technicals>>> {
  if (useFixtures()) {
    const fixture = (await import('@/fixtures/sample-technicals.json')).default as Technicals[];
    return ok('technicals:fixture', new Map(fixture.map((t) => [t.symbol, t])));
  }

  const out = new Map<string, Technicals>();
  const failed: string[] = [];

  const BATCH = 6;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((s) => computeForTicker(s.symbol, s.yahoo)));
    results.forEach((t, idx) => {
      if (t) out.set(t.symbol, t);
      else failed.push(batch[idx].symbol);
    });
  }

  if (out.size === 0) {
    return {
      ok: false,
      error: 'no technicals could be computed',
      source: YAHOO.name,
      fetchedAtUtc: new Date().toISOString(),
    };
  }

  return ok(
    YAHOO.name,
    out,
    failed.length > 0 ? `${failed.length} symbol(s) unavailable: ${failed.slice(0, 5).join(', ')}` : undefined,
  );
}
