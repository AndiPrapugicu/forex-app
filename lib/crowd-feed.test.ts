/**
 * The stored crowd feed: one writer (ingest), many readers (pages). No network —
 * the provider and the store are both stubs.
 */

import { describe, expect, it } from 'vitest';

import type { CrowdProvider } from '@/lib/connectors/crowd';
import {
  CROWD_FEED_KEY,
  loadRetailPositioning,
  loadStoredCrowdFeed,
  parseStoredFeed,
  refreshStoredCrowdFeed,
} from '@/lib/crowd-feed';
import type { Store } from '@/lib/db/client';
import type { RetailPositioningFeed } from '@/lib/scoring/crowd';
import { fail, ok } from '@/lib/types';

function fakeStore(durable = true) {
  const rows = new Map<string, unknown>();
  const store = {
    durable,
    kind: durable ? 'supabase' : 'memory',
    getAiCache: async (hash: string) => rows.get(hash) ?? null,
    setAiCache: async (hash: string, _kind: string, _model: string, output: unknown) => {
      rows.set(hash, JSON.parse(JSON.stringify(output)));
    },
  } as unknown as Store;
  return { store, rows };
}

function countingProvider(result: () => ReturnType<CrowdProvider['fetchPositioning']>) {
  const calls = { n: 0 };
  const provider: CrowdProvider = {
    name: 'stub',
    isConfigured: () => true,
    fetchPositioning: async () => {
      calls.n++;
      return result();
    },
  };
  return { provider, calls };
}

const feedOf = (entries: [string, number][]): RetailPositioningFeed =>
  new Map(entries.map(([symbol, longPct]) => [symbol, { symbol, longPct, source: 'stub', observedAt: '2026-09-13' }]));

const t0 = new Date('2026-09-13T15:00:00Z');
const minutes = (m: number) => new Date(t0.getTime() + m * 60_000);

describe('refreshStoredCrowdFeed', () => {
  it('stores what the provider returns, and pages read it back without calling the provider', async () => {
    const { store } = fakeStore();
    const { provider, calls } = countingProvider(async () => ok('Myfxbook', feedOf([['AUDNZD', 13], ['EURUSD', 47]])));

    expect(await refreshStoredCrowdFeed(store, t0, provider)).toEqual({ saved: 2, error: undefined });
    const read = await loadStoredCrowdFeed(store, minutes(5));
    expect(read.ok && read.data.get('AUDNZD')?.longPct).toBe(13);
    expect(calls.n).toBe(1);
  });

  /** The whole point: ten ingest runs an hour must not be ten logins. */
  it('refreshes at most once per window, successful or not', async () => {
    const { store } = fakeStore();
    const { provider, calls } = countingProvider(async () => fail('Myfxbook', 'login rejected'));

    await refreshStoredCrowdFeed(store, t0, provider);
    const again = await refreshStoredCrowdFeed(store, minutes(10), provider);
    expect(calls.n).toBe(1);
    expect(again.skipped).toContain('min ago');

    await refreshStoredCrowdFeed(store, minutes(61), provider);
    expect(calls.n).toBe(2);
  });

  it('keeps the last good entries when a refresh fails', async () => {
    const { store } = fakeStore();
    await refreshStoredCrowdFeed(store, t0, countingProvider(async () => ok('Myfxbook', feedOf([['GBPNZD', 75]]))).provider);
    await refreshStoredCrowdFeed(store, minutes(61), countingProvider(async () => fail('Myfxbook', 'down')).provider);

    const read = await loadStoredCrowdFeed(store, minutes(62));
    expect(read.ok && read.data.get('GBPNZD')?.longPct).toBe(75);
    expect(read.ok && read.degraded).toContain('down');
  });

  it('skips cleanly when no provider is configured', async () => {
    const { store } = fakeStore();
    const provider: CrowdProvider = { name: 'off', isConfigured: () => false, fetchPositioning: async () => ok('off', new Map()) };
    expect((await refreshStoredCrowdFeed(store, t0, provider)).skipped).toContain('no crowd provider');
  });
});

describe('loadStoredCrowdFeed', () => {
  it('reports an empty store as a failure, so the column falls back to CFTC', async () => {
    const { store } = fakeStore();
    const read = await loadStoredCrowdFeed(store, t0);
    expect(read.ok).toBe(false);
  });

  it('refuses a feed older than the maximum age', async () => {
    const { store } = fakeStore();
    await refreshStoredCrowdFeed(store, t0, countingProvider(async () => ok('Myfxbook', feedOf([['EURUSD', 50]]))).provider);
    const read = await loadStoredCrowdFeed(store, minutes(27 * 60));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error).toContain('old');
  });
});

describe('loadRetailPositioning', () => {
  it('reads the stored copy on a durable store and never calls a provider', async () => {
    const { store, rows } = fakeStore(true);
    rows.set(CROWD_FEED_KEY, {
      fetchedAtUtc: t0.toISOString(), attemptedAtUtc: t0.toISOString(), source: 'Myfxbook',
      entries: [{ symbol: 'AUDCAD', longPct: 6, source: 'Myfxbook', observedAt: '2026-09-13' }],
    });
    const read = await loadRetailPositioning(minutes(1), store);
    expect(read.ok && read.data.get('AUDCAD')?.longPct).toBe(6);
  });
});

describe('parseStoredFeed', () => {
  it('treats malformed documents and entries as absent', () => {
    expect(parseStoredFeed(null)).toBeNull();
    expect(parseStoredFeed({ entries: [] })).toBeNull();
    const doc = parseStoredFeed({ attemptedAtUtc: 'x', entries: [{ symbol: 'EURUSD', longPct: 'n/a' }, { symbol: 'GBPUSD', longPct: 50 }] });
    expect(doc?.entries.map((e) => e.symbol)).toEqual(['GBPUSD']);
  });
});
