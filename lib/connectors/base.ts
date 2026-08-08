/**
 * Shared fetch plumbing for every connector.
 *
 * The contract: these helpers NEVER throw. A dead upstream returns
 * `{ ok: false }`, the ingest pipeline records it as degraded, and the UI shows
 * a banner. A forex dashboard that 500s because one RSS feed is down is worse
 * than useless — the trader needs the other seven sources.
 */

import { fail, ok, type Result } from '@/lib/types';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  storedAt: number;
}

/**
 * Process-local TTL cache. On Vercel this survives within a warm lambda only,
 * which is exactly the window we care about: it stops a single dashboard render
 * from hitting FXStreet five times.
 *
 * Entries are NOT deleted at expiry. They are kept as stale-but-usable so that
 * `fetchJson` can serve the last good payload when an upstream fails. A
 * fifteen-minute-old economic calendar is enormously better than an empty one,
 * and the caller is told it is stale so the UI can say so.
 */
const cache = new Map<string, CacheEntry>();

/** How long a stale entry stays eligible as a failure fallback. */
const STALE_GRACE_SECONDS = 6 * 3600;

function cacheGet<T>(key: string): { value: T; stale: boolean; ageSeconds: number } | null {
  const hit = cache.get(key);
  if (!hit) return null;

  const now = Date.now();
  const ageSeconds = Math.round((now - hit.storedAt) / 1000);

  if (now <= hit.expiresAt) return { value: hit.value as T, stale: false, ageSeconds };

  if (ageSeconds > STALE_GRACE_SECONDS) {
    cache.delete(key);
    return null;
  }
  return { value: hit.value as T, stale: true, ageSeconds };
}

function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  const now = Date.now();
  cache.set(key, { value, expiresAt: now + ttlSeconds * 1000, storedAt: now });
}

export function clearCache() {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Rate-limit cooldowns
// ---------------------------------------------------------------------------

/**
 * Hosts we have been explicitly told to back off from, and until when.
 *
 * Measured during development: FairEconomy returns `429` with `retry-after: 130`
 * once it has seen enough requests. Retrying through that — which the generic
 * backoff would happily do — is what turns a brief throttle into a sustained
 * block. Once a host says wait, we do not touch it again until it says so.
 */
const cooldowns = new Map<string, number>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function inCooldown(url: string): number | null {
  const until = cooldowns.get(hostOf(url));
  if (until === undefined) return null;
  if (Date.now() >= until) {
    cooldowns.delete(hostOf(url));
    return null;
  }
  return Math.ceil((until - Date.now()) / 1000);
}

function setCooldown(url: string, seconds: number) {
  // Cap it: a host asking for an hour should not silently disable a source for
  // the rest of the process lifetime without the UI ever recovering.
  const capped = Math.min(Math.max(seconds, 1), 900);
  cooldowns.set(hostOf(url), Date.now() + capped * 1000);
}

// ---------------------------------------------------------------------------
// Fetch with retry
// ---------------------------------------------------------------------------

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  cacheTtlSeconds?: number;
  cacheKey?: string;
}

const DEFAULTS = { timeoutMs: 15_000, retries: 2, cacheTtlSeconds: 0 };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Status codes worth retrying.
 *
 * 429 is deliberately NOT here. A rate limit is the server telling us to stop;
 * retrying it immediately is how a short throttle becomes a long block. It is
 * handled separately, by honouring `Retry-After` and entering a cooldown.
 */
function isRetryable(status: number) {
  return status === 408 || status >= 500;
}

async function fetchRaw(
  url: string,
  opts: FetchOptions,
  parse: 'json' | 'text',
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const retries = opts.retries ?? DEFAULTS.retries;

  // Respect an active cooldown without spending a request to rediscover it.
  const waiting = inCooldown(url);
  if (waiting !== null) {
    return { ok: false, error: `rate limited, retrying in ${waiting}s` };
  }

  let lastError = 'unknown error';

  for (let attempt = 0; attempt <= retries; attempt++) {
    // A fresh controller per attempt — an aborted one cannot be reused.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers: opts.headers,
        signal: controller.signal,
        cache: 'no-store',
      });

      if (res.status === 429) {
        // Honour the server's own number when it gives one.
        const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
        const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 120;
        setCooldown(url, seconds);
        clearTimeout(timer);
        return { ok: false, error: `rate limited (429), backing off ${seconds}s` };
      }

      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (!isRetryable(res.status)) return { ok: false, error: lastError };
        // fall through to backoff
      } else {
        const data = parse === 'json' ? await res.json() : await res.text();
        return { ok: true, data };
      }
    } catch (err) {
      lastError =
        err instanceof Error
          ? err.name === 'AbortError'
            ? `timeout after ${timeoutMs}ms`
            : err.message
          : String(err);
    } finally {
      clearTimeout(timer);
    }

    // Exponential backoff with jitter, skipped after the final attempt.
    if (attempt < retries) {
      await sleep(500 * 2 ** attempt + Math.random() * 250);
    }
  }

  return { ok: false, error: lastError };
}

/** Human-readable age, for the "serving stale data" banner. */
function describeAge(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/**
 * Fetch, cache, retry, and fall back to stale data — returning a Result rather
 * than throwing.
 *
 * The stale path is the important one. When an upstream is rate-limited or down,
 * serving the last good payload with a `degraded` note keeps the dashboard
 * useful and honest at the same time. Only when there is nothing cached at all
 * does this report a hard failure.
 */
export async function fetchJson<T>(
  source: string,
  url: string,
  opts: FetchOptions = {},
): Promise<Result<T>> {
  const key = opts.cacheKey ?? url;
  const ttl = opts.cacheTtlSeconds ?? DEFAULTS.cacheTtlSeconds;

  const cached = ttl > 0 ? cacheGet<T>(key) : null;
  if (cached && !cached.stale) return ok(source, cached.value);

  const res = await fetchRaw(url, opts, 'json');

  if (!res.ok) {
    if (cached) {
      return ok(source, cached.value, `${res.error} — showing data from ${describeAge(cached.ageSeconds)} ago`);
    }
    return fail<T>(source, res.error);
  }

  if (ttl > 0) cacheSet(key, res.data, ttl);
  return ok(source, res.data as T);
}

/** Same, for XML/RSS endpoints. */
export async function fetchText(
  source: string,
  url: string,
  opts: FetchOptions = {},
): Promise<Result<string>> {
  const key = opts.cacheKey ?? url;
  const ttl = opts.cacheTtlSeconds ?? DEFAULTS.cacheTtlSeconds;

  const cached = ttl > 0 ? cacheGet<string>(key) : null;
  if (cached && !cached.stale) return ok(source, cached.value);

  const res = await fetchRaw(url, opts, 'text');

  if (!res.ok) {
    if (cached) {
      return ok(source, cached.value, `${res.error} — showing data from ${describeAge(cached.ageSeconds)} ago`);
    }
    return fail<string>(source, res.error);
  }

  if (ttl > 0) cacheSet(key, res.data, ttl);
  return ok(source, res.data as string);
}

// ---------------------------------------------------------------------------
// Helpers shared by connectors
// ---------------------------------------------------------------------------

/**
 * Parses a numeric field out of feed data.
 *
 * Feeds are inconsistent: FXStreet sends real numbers, FairEconomy sends
 * strings like "3.4%", "142K", "-1.2B", "<0.1" or "". Everything unparseable
 * becomes null, which the scoring engine treats as "no data" rather than zero —
 * a zero here would read as a genuine print of 0 and score wildly.
 */
export function parseNumeric(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  const cleaned = raw.trim().replace(/[%,$€£¥]/g, '').replace(/,/g, '').replace(/^[<>~]/, '');
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*([KMBT])?$/i);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;

  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() ?? ''] ?? 1;
  return value * mult;
}

/** Bare registrable domain, used as the corroboration identity. */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Deterministic short id. Used for event and news ids so the same upstream item
 * keeps its identity across ingests — that stability is what makes dedupe,
 * change-detection and alert suppression work at all.
 */
export function stableId(...parts: (string | number | null | undefined)[]): string {
  const input = parts.map((p) => String(p ?? '')).join('|');
  // FNV-1a: no crypto import, no async, stable across processes and platforms.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 16);
}

/** True when the app should read fixtures instead of the network. */
export function useFixtures(): boolean {
  return process.env.USE_FIXTURES === 'true';
}
