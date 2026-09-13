/**
 * Yahoo option chains: volume and open interest per strike, per underlying.
 *
 * The chain endpoint needs a session: a cookie from fc.yahoo.com and a "crumb"
 * minted against it. Both are cached in memory and re-minted once on a 401.
 *
 * Parsing is split from fetching so the arithmetic — the put-call ratio and the
 * strike walls — is tested against a captured chain, not a live one.
 *
 * Never throws. A dead chain is a failed `Result` and a health line.
 */

import {
  OPTIONS_EXPIRY_HORIZON_DAYS,
  OPTIONS_MAX_EXPIRIES,
  OPTIONS_UNDERLYINGS,
  YAHOO_OPTIONS,
  type OptionsUnderlying,
} from '@/config/options.config';
import { fetchJson } from '@/lib/connectors/base';
import { ok, type Result } from '@/lib/types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const SOURCE = 'Yahoo option chains';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface RawContract {
  strike?: number;
  volume?: number;
  openInterest?: number;
}

export interface ChainPage {
  price: number | null;
  /** Unix seconds, every listed expiry. */
  expirationDates: number[];
  calls: RawContract[];
  puts: RawContract[];
}

/** One page of `/v7/finance/options`, or null when the body is not a chain. */
export function parseChainPage(json: unknown): ChainPage | null {
  const result = (json as { optionChain?: { result?: unknown[] } })?.optionChain?.result?.[0] as
    | {
        expirationDates?: number[];
        quote?: { regularMarketPrice?: number };
        options?: { calls?: RawContract[]; puts?: RawContract[] }[];
      }
    | undefined;
  if (!result) return null;
  const first = result.options?.[0];
  return {
    price: typeof result.quote?.regularMarketPrice === 'number' ? result.quote.regularMarketPrice : null,
    expirationDates: result.expirationDates ?? [],
    calls: first?.calls ?? [],
    puts: first?.puts ?? [],
  };
}

export interface StrikeRow {
  strike: number;
  callVolume: number;
  putVolume: number;
  callOpenInterest: number;
  putOpenInterest: number;
}

export interface ChainSummary {
  symbol: string;
  etf: string;
  price: number | null;
  /** How many expiries were summed. */
  expiries: number;
  callVolume: number;
  putVolume: number;
  callOpenInterest: number;
  putOpenInterest: number;
  /** Put volume over call volume; null when no calls traded. */
  putCallVolume: number | null;
  putCallOpenInterest: number | null;
  /** Every strike, ascending, summed across the expiries read. */
  strikes: StrikeRow[];
  fetchedAtUtc: string;
}

const num = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/** Sums several expiry pages into one chain. A missing volume counts as none traded. */
export function summariseChain(
  underlying: Pick<OptionsUnderlying, 'symbol' | 'etf'>,
  pages: ChainPage[],
  fetchedAtUtc = new Date().toISOString(),
): ChainSummary {
  const byStrike = new Map<number, StrikeRow>();
  const row = (strike: number) => {
    let r = byStrike.get(strike);
    if (!r) {
      r = { strike, callVolume: 0, putVolume: 0, callOpenInterest: 0, putOpenInterest: 0 };
      byStrike.set(strike, r);
    }
    return r;
  };

  for (const page of pages) {
    for (const c of page.calls) {
      if (typeof c.strike !== 'number') continue;
      const r = row(c.strike);
      r.callVolume += num(c.volume);
      r.callOpenInterest += num(c.openInterest);
    }
    for (const p of page.puts) {
      if (typeof p.strike !== 'number') continue;
      const r = row(p.strike);
      r.putVolume += num(p.volume);
      r.putOpenInterest += num(p.openInterest);
    }
  }

  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const total = (k: keyof Omit<StrikeRow, 'strike'>) => strikes.reduce((s, r) => s + r[k], 0);
  const callVolume = total('callVolume');
  const putVolume = total('putVolume');
  const callOpenInterest = total('callOpenInterest');
  const putOpenInterest = total('putOpenInterest');

  return {
    symbol: underlying.symbol,
    etf: underlying.etf,
    price: pages.find((p) => p.price !== null)?.price ?? null,
    expiries: pages.length,
    callVolume,
    putVolume,
    callOpenInterest,
    putOpenInterest,
    putCallVolume: ratio(putVolume, callVolume),
    putCallOpenInterest: ratio(putOpenInterest, callOpenInterest),
    strikes,
    fetchedAtUtc,
  };
}

/** The strikes with the most call and put open interest — the "walls". */
export function findWalls(summary: ChainSummary): { callWall: StrikeRow | null; putWall: StrikeRow | null } {
  let callWall: StrikeRow | null = null;
  let putWall: StrikeRow | null = null;
  for (const r of summary.strikes) {
    if (r.callOpenInterest > 0 && (!callWall || r.callOpenInterest > callWall.callOpenInterest)) callWall = r;
    if (r.putOpenInterest > 0 && (!putWall || r.putOpenInterest > putWall.putOpenInterest)) putWall = r;
  }
  return { callWall, putWall };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

let session: { cookie: string; crumb: string } | null = null;

async function mintSession(): Promise<{ cookie: string; crumb: string } | null> {
  try {
    const cookieRes = await fetch(YAHOO_OPTIONS.cookieUrl, {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const setCookies =
      typeof cookieRes.headers.getSetCookie === 'function'
        ? cookieRes.headers.getSetCookie()
        : [cookieRes.headers.get('set-cookie') ?? ''];
    const cookie = setCookies
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');
    if (!cookie) return null;

    const crumbRes = await fetch(YAHOO_OPTIONS.crumbUrl, {
      headers: { 'User-Agent': UA, Cookie: cookie },
      signal: AbortSignal.timeout(10_000),
    });
    const crumb = (await crumbRes.text()).trim();
    if (!crumbRes.ok || !crumb || crumb.length > 40 || crumb.includes('<')) return null;
    return { cookie, crumb };
  } catch {
    return null;
  }
}

async function fetchPage(etf: string, date: number | null, retry = true): Promise<ChainPage | null> {
  session ??= await mintSession();
  if (!session) return null;

  const url =
    `${YAHOO_OPTIONS.chainBase}/${encodeURIComponent(etf)}?crumb=${encodeURIComponent(session.crumb)}` +
    (date === null ? '' : `&date=${date}`);
  const res = await fetchJson<unknown>(SOURCE, url, {
    headers: { 'User-Agent': UA, Cookie: session.cookie },
    cacheKey: `yahoo-options:${etf}:${date ?? 'front'}`,
    cacheTtlSeconds: YAHOO_OPTIONS.cacheTtlSeconds,
    timeoutMs: 12_000,
    retries: 1,
  });

  if (!res.ok) {
    // An expired crumb answers 401. Re-mint once, then give up.
    if (retry && /401|unauthor|crumb/i.test(res.error)) {
      session = null;
      return fetchPage(etf, date, false);
    }
    return null;
  }
  return parseChainPage(res.data);
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export async function fetchOptionChain(underlying: OptionsUnderlying, now = new Date()): Promise<Result<ChainSummary>> {
  const fail = (error: string): Result<ChainSummary> => ({
    ok: false,
    error,
    source: SOURCE,
    fetchedAtUtc: new Date().toISOString(),
  });

  const front = await fetchPage(underlying.etf, null);
  if (!front) return fail(`${underlying.etf}: no chain (session or endpoint refused)`);

  const horizon = now.getTime() / 1000 + OPTIONS_EXPIRY_HORIZON_DAYS * 86_400;
  // Capped by count as well as date: SPY lists an expiry every weekday, and 45
  // days of those would be thirty requests for one symbol.
  const dates = front.expirationDates.filter((d) => d <= horizon).slice(0, OPTIONS_MAX_EXPIRIES);
  const pages: ChainPage[] = [front];
  // The front page already carries the nearest expiry.
  for (const d of dates.slice(1)) {
    const page = await fetchPage(underlying.etf, d);
    if (page) pages.push(page);
  }

  return ok(SOURCE, summariseChain(underlying, pages));
}

/** Every configured underlying, a few at a time. Failures are listed, not thrown. */
export async function fetchAllOptionChains(
  now = new Date(),
): Promise<{ chains: ChainSummary[]; failed: string[]; fetchedAtUtc: string }> {
  const chains: ChainSummary[] = [];
  const failed: string[] = [];
  for (let i = 0; i < OPTIONS_UNDERLYINGS.length; i += YAHOO_OPTIONS.batch) {
    const batch = OPTIONS_UNDERLYINGS.slice(i, i + YAHOO_OPTIONS.batch);
    const results = await Promise.all(batch.map((u) => fetchOptionChain(u, now)));
    results.forEach((r, k) => (r.ok ? chains.push(r.data) : failed.push(batch[k].symbol)));
  }
  return { chains, failed, fetchedAtUtc: new Date().toISOString() };
}
