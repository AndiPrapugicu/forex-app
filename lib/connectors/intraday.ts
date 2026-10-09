/**
 * Five-minute bars for a panel of tickers, in one request.
 *
 * Yahoo's spark endpoint takes up to 20 symbols and returns the same
 * timestamp + close arrays the chart endpoint does; verified 2026-10-08 for
 * NQ=F, ZT=F and ^TNX at `interval=5m`. Closes only: the reaction reader needs
 * where each instrument was at each moment, not its candles.
 */

import { REACTION } from '@/config/reaction.config';
import { YAHOO } from '@/config/sources.config';
import { fetchJson, fixturesEnabled } from '@/lib/connectors/base';

export interface IntradaySeries {
  ticker: string;
  /** Epoch milliseconds, oldest first, one per bar with a close. */
  t: number[];
  c: number[];
}

interface SparkPayload {
  spark?: {
    result?: {
      symbol?: string;
      response?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[];
    }[];
  };
}

/** Pulls clean series out of a spark payload; a ticker with no bars is left out. */
export function parseSpark(payload: unknown): Map<string, IntradaySeries> {
  const out = new Map<string, IntradaySeries>();
  for (const r of (payload as SparkPayload)?.spark?.result ?? []) {
    const res = r.response?.[0];
    const stamps = res?.timestamp ?? [];
    const closes = res?.indicators?.quote?.[0]?.close ?? [];
    if (!r.symbol) continue;
    const t: number[] = [];
    const c: number[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const v = closes[i];
      if (typeof v === 'number' && Number.isFinite(v)) {
        t.push(stamps[i] * 1000);
        c.push(v);
      }
    }
    if (t.length > 1) out.set(r.symbol, { ticker: r.symbol, t, c });
  }
  return out;
}

/** Every ticker's bars; missing tickers are simply absent, never an error. */
export async function fetchIntraday(tickers: string[]): Promise<Map<string, IntradaySeries>> {
  const out = new Map<string, IntradaySeries>();
  if (fixturesEnabled()) return out;
  const unique = [...new Set(tickers)];
  for (let i = 0; i < unique.length; i += YAHOO.sparkMaxSymbols) {
    const chunk = unique.slice(i, i + YAHOO.sparkMaxSymbols);
    const url = `${YAHOO.sparkBase}?symbols=${chunk.map(encodeURIComponent).join(',')}&range=${REACTION.range}&interval=${REACTION.interval}`;
    const res = await fetchJson<SparkPayload>(YAHOO.name, url, {
      headers: { ...YAHOO.headers },
      cacheTtlSeconds: REACTION.cacheTtlSeconds,
      cacheKey: `yahoo:spark:${REACTION.interval}:${chunk.join(',')}`,
      timeoutMs: 12_000,
      retries: 1,
    });
    if (!res.ok) continue;
    for (const [k, v] of parseSpark(res.data)) out.set(k, v);
  }
  return out;
}
