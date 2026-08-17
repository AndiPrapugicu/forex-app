/**
 * Live prices for many symbols at once.
 *
 * The batch sibling of `/api/quote`, which stays as it is because the chart
 * polls exactly one instrument and does not need the extra shape. Everything
 * else on the app — the scorecard index, the setups matrix, the macro page —
 * wants fifty prices at a time, and fifty single-symbol calls is how you get
 * rate-limited off an undocumented endpoint.
 *
 * Same containment rule as every other price path in this app: a live price is
 * displayed, never scored. Nothing downstream of this route feeds a cell, an
 * SMA, a level or a trade idea — those all come from closed bars, server-side.
 */

import { NextResponse } from 'next/server';
import { ALL_SYMBOLS, findSymbol } from '@/config/symbols.config';
import { SPARK_TTL_SECONDS, fetchSparkQuotes } from '@/lib/connectors/prices';

export const dynamic = 'force-dynamic';

export interface QuotesResponse {
  available: boolean;
  reason?: string;
  /** Keyed by OUR symbol, not Yahoo's ticker. */
  quotes: Record<string, LiveQuotePayload>;
}

export interface LiveQuotePayload {
  price: number;
  previousClose: number | null;
  changePct: number | null;
  time: number | null;
  dayHigh: number | null;
  dayLow: number | null;
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get('symbols');

  /**
   * Resolve through the symbol table rather than passing user input upstream:
   * this route can only ever fetch tickers the app already knows about. An
   * unknown symbol is dropped silently rather than 404-ing the whole batch —
   * one stale bookmark must not blank out the other forty-nine prices.
   */
  const defs = requested
    ? requested
        .split(',')
        .map((s) => findSymbol(s.trim()))
        .filter((d): d is NonNullable<typeof d> => d !== undefined)
    : ALL_SYMBOLS;

  if (defs.length === 0) {
    return NextResponse.json<QuotesResponse>(
      { available: false, reason: 'no known symbols requested', quotes: {} },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const bySpark = await fetchSparkQuotes(defs.map((d) => d.yahoo));

  const quotes: QuotesResponse['quotes'] = {};
  for (const def of defs) {
    const q = bySpark.get(def.yahoo);
    if (!q) continue;
    quotes[def.symbol] = {
      price: q.price,
      previousClose: q.previousClose,
      changePct: q.changePct,
      time: q.time,
      dayHigh: q.dayHigh,
      dayLow: q.dayLow,
    };
  }

  const count = Object.keys(quotes).length;

  /**
   * A dead upstream is a 200 with `available: false`, matching `/api/quote`.
   * The poll loop in the browser treats a non-200 as a failure to retry and an
   * `available: false` as "not live" — the second is what we want when Yahoo is
   * down, because retrying into a 429 is how a background tab gets the whole
   * app throttled.
   */
  return NextResponse.json<QuotesResponse>(
    {
      available: count > 0,
      reason: count === 0 ? 'no prices in response' : undefined,
      quotes,
    },
    { headers: { 'Cache-Control': `no-store, max-age=${SPARK_TTL_SECONDS}` } },
  );
}
