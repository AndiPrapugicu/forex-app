/**
 * Connector plumbing tests.
 *
 * These cover the behaviours that keep the app alive when upstreams misbehave —
 * the rate-limit backoff and the stale-cache fallback, both of which were added
 * after live probing caught FairEconomy returning `429 retry-after: 130`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCache,
  extractDomain,
  fetchJson,
  fixturesEnabled,
  parseNumeric,
  resetFixtureWarning,
  stableId,
} from '@/lib/connectors/base';

describe('parseNumeric', () => {
  it('parses plain numbers and numeric strings', () => {
    expect(parseNumeric(3.4)).toBe(3.4);
    expect(parseNumeric('3.4')).toBe(3.4);
    expect(parseNumeric('-23')).toBe(-23);
  });

  it('strips units and separators the feeds actually send', () => {
    expect(parseNumeric('3.4%')).toBe(3.4);
    expect(parseNumeric('1,234')).toBe(1234);
    expect(parseNumeric('$1.5')).toBe(1.5);
    expect(parseNumeric('<0.1')).toBe(0.1);
  });

  it('expands magnitude suffixes', () => {
    expect(parseNumeric('142K')).toBe(142_000);
    expect(parseNumeric('1.5M')).toBe(1_500_000);
    expect(parseNumeric('-1.2B')).toBe(-1_200_000_000);
  });

  it('returns null rather than 0 for unparseable input', () => {
    // Critical: 0 would score as a genuine print of zero and blow up the sigma.
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric(null)).toBeNull();
    expect(parseNumeric('n/a')).toBeNull();
    expect(parseNumeric('~')).toBeNull();
    expect(parseNumeric(Number.NaN)).toBeNull();
  });
});

describe('extractDomain', () => {
  it('strips protocol and www', () => {
    expect(extractDomain('https://www.bbc.co.uk/news/x')).toBe('bbc.co.uk');
  });

  it('degrades to a sentinel on malformed input', () => {
    expect(extractDomain('not a url')).toBe('unknown');
  });
});

describe('stableId', () => {
  it('is deterministic, which is what makes dedupe work across runs', () => {
    expect(stableId('a', 'b', 1)).toBe(stableId('a', 'b', 1));
  });

  it('separates different inputs', () => {
    expect(stableId('a', 'b')).not.toBe(stableId('a', 'c'));
    // Field boundaries must be respected — 'ab' + '' must not collide with 'a' + 'b'.
    expect(stableId('ab', '')).not.toBe(stableId('a', 'b'));
  });
});

describe('fetchJson resilience', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    const status = init.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => init.headers?.[k.toLowerCase()] ?? null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  it('caches within the TTL instead of refetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ v: 1 }));
    globalThis.fetch = fetchMock;

    const a = await fetchJson<{ v: number }>('test', 'https://example.com/a', { cacheTtlSeconds: 60 });
    const b = await fetchJson<{ v: number }>('test', 'https://example.com/a', { cacheTtlSeconds: 60 });

    expect(a.ok && a.data.v).toBe(1);
    expect(b.ok && b.data.v).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a 429 — retrying is what turns a throttle into a block', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({}, { status: 429, headers: { 'retry-after': '130' } }));
    globalThis.fetch = fetchMock;

    const res = await fetchJson('test', 'https://ratelimited.example/a', { retries: 3 });

    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (!res.ok) expect(res.error).toMatch(/429/);
  });

  it('enters a cooldown after a 429 and stops issuing requests to that host', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({}, { status: 429, headers: { 'retry-after': '130' } }));
    globalThis.fetch = fetchMock;

    await fetchJson('test', 'https://cooldown.example/a');
    const second = await fetchJson('test', 'https://cooldown.example/b');

    // Second call short-circuits without touching the network at all.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/rate limited/);
  });

  it('serves stale cached data when the upstream later fails', async () => {
    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) return mockResponse({ v: 'good' });
      return mockResponse({}, { status: 500 });
    });

    // Prime the cache with a 1-second TTL.
    const first = await fetchJson<{ v: string }>('test', 'https://flaky.example/a', { cacheTtlSeconds: 1 });
    expect(first.ok && first.data.v).toBe('good');
    expect(first.ok && first.degraded).toBeUndefined();

    // Advance past the TTL. Fake timers must be enabled for setSystemTime to do
    // anything — without this the entry would still be fresh and the test would
    // pass for the wrong reason, never exercising the stale path at all.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 5000));

    const second = await fetchJson<{ v: string }>('test', 'https://flaky.example/a', {
      cacheTtlSeconds: 1,
      retries: 0,
    });

    // Stale data is still served, and the caller is told it is stale.
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data.v).toBe('good');
      expect(second.degraded).toMatch(/showing data from/);
    }

    vi.useRealTimers();
  });

  /**
   * The stampede that trips the 429 in the first place.
   *
   * One pipeline run writes ~51 daily Yahoo entries within a couple of seconds.
   * Without spread they all expire together and the next poll fires ~100
   * concurrent requests at one undocumented host, which is precisely the moment
   * the rate limit lands — and a rate limit on that host silences every Yahoo
   * call for up to 900s, which is what the board flicker was made of.
   */
  it('spreads cache expiry across keys so a whole batch does not expire at once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ v: 1 }));
    globalThis.fetch = fetchMock;

    const keys = Array.from({ length: 50 }, (_, i) => `https://jitter.example/${i}`);
    for (const key of keys) await fetchJson('test', key, { cacheTtlSeconds: 3600 });
    expect(fetchMock).toHaveBeenCalledTimes(50);

    // Halfway into the jitter window: some keys have expired, some have not.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 3600_000 + 150_000));
    for (const key of keys) await fetchJson('test', key, { cacheTtlSeconds: 3600, retries: 0 });

    const refetched = fetchMock.mock.calls.length - 50;
    expect(refetched).toBeGreaterThan(0);
    expect(refetched).toBeLessThan(50);

    vi.useRealTimers();
  });

  it('serves stale cache while a host cooldown is active rather than nothing', async () => {
    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) return mockResponse({ v: 'good' });
      return mockResponse({}, { status: 429, headers: { 'retry-after': '600' } });
    });

    await fetchJson<{ v: string }>('test', 'https://cool-stale.example/a', { cacheTtlSeconds: 1 });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 5000));

    // A sibling path trips the cooldown; the cooldown is keyed by HOST, so this
    // silences /a too.
    await fetchJson('test', 'https://cool-stale.example/b', { retries: 0 });

    const during = await fetchJson<{ v: string }>('test', 'https://cool-stale.example/a', {
      cacheTtlSeconds: 1,
      retries: 0,
    });

    expect(during.ok).toBe(true);
    if (during.ok) {
      expect(during.data.v).toBe('good');
      expect(during.degraded).toMatch(/rate limited/);
    }

    vi.useRealTimers();
  });

  it('reports a hard failure only when there is nothing cached to fall back to', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse({}, { status: 500 }));

    const res = await fetchJson('test', 'https://dead.example/a', { retries: 0, cacheTtlSeconds: 60 });
    expect(res.ok).toBe(false);
  });

  it('does not retry a 404, which is a permanent misconfiguration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({}, { status: 404 }));
    globalThis.fetch = fetchMock;

    await fetchJson('test', 'https://missing.example/a', { retries: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws, whatever the network does', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    const res = await fetchJson('test', 'https://broken.example/a', { retries: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ECONNRESET/);
  });
});

/**
 * The fixture switch, which is the one env var that can make the whole product
 * confidently wrong without failing.
 *
 * A fixture-backed deploy serves captured prices, a captured calendar and a
 * captured COT report as though they were today's. Nothing errors, no banner
 * appears, and every score downstream is wrong. `USE_FIXTURES` left set after a
 * debugging session is a realistic way to get there, so production ignores it
 * unless a second, deliberately-named variable says otherwise.
 */
describe('fixturesEnabled', () => {
  const original = { ...process.env };

  beforeEach(() => {
    resetFixtureWarning();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is off unless explicitly asked for', () => {
    delete process.env.USE_FIXTURES;
    expect(fixturesEnabled()).toBe(false);
    process.env.USE_FIXTURES = 'false';
    expect(fixturesEnabled()).toBe(false);
    // Only the exact string. 'TRUE' or '1' left over from another tool must not
    // silently arm it.
    process.env.USE_FIXTURES = '1';
    expect(fixturesEnabled()).toBe(false);
  });

  it('honours the offline workflow outside production', () => {
    process.env.USE_FIXTURES = 'true';
    vi.stubEnv('NODE_ENV', 'development');
    expect(fixturesEnabled()).toBe(true);
  });

  it('refuses in production, and says so once rather than per call', () => {
    process.env.USE_FIXTURES = 'true';
    vi.stubEnv('NODE_ENV', 'production');
    expect(fixturesEnabled()).toBe(false);
    expect(fixturesEnabled()).toBe(false);
    expect(fixturesEnabled()).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('allows a deliberate fixture-backed deployment', () => {
    process.env.USE_FIXTURES = 'true';
    vi.stubEnv('NODE_ENV', 'production');
    process.env.ALLOW_FIXTURES_IN_PRODUCTION = 'true';
    expect(fixturesEnabled()).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

/**
 * Cache-hit provenance.
 *
 * The failure this protects against is silent and specifically about
 * OBSERVABILITY rather than correctness: a cached payload served with a
 * freshly-stamped `fetchedAtUtc` makes the health table report an hour-old
 * calendar as just-fetched. Every score built on it is still whatever the data
 * says — but the question 'am I looking at current data?' becomes
 * unanswerable from the dashboard, which is exactly when it gets asked.
 */
describe('fetchedAtUtc dates the DATA, not the lookup', () => {
  beforeEach(() => clearCache());

  it('reports the original fetch time when serving from cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ v: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchJson('test', 'https://example.test/x', { cacheTtlSeconds: 600 });
    expect(first.ok).toBe(true);
    const firstStamp = first.fetchedAtUtc;

    // Enough wall time that a re-stamp would be visibly different.
    await new Promise((r) => setTimeout(r, 25));

    const second = await fetchJson('test', 'https://example.test/x', { cacheTtlSeconds: 600 });
    expect(second.ok).toBe(true);
    // Served from cache: one network call, and the SAME timestamp.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.fetchedAtUtc).toBe(firstStamp);
  });

  it('dates a stale fallback by its store time too, and says it is stale', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ v: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
      .mockRejectedValue(new Error('upstream down'));
    vi.stubGlobal('fetch', fetchMock);

    // TTL of zero seconds means the next read is past expiry but inside grace.
    const first = await fetchJson('test', 'https://example.test/y', { cacheTtlSeconds: 1 });
    const firstStamp = first.fetchedAtUtc;
    await new Promise((r) => setTimeout(r, 1100));

    const second = await fetchJson('test', 'https://example.test/y', {
      cacheTtlSeconds: 1,
      retries: 0,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.degraded).toMatch(/showing data from/);
      expect(second.fetchedAtUtc).toBe(firstStamp);
    }
  });
});
