/**
 * The retail-positioning feed, fetched by ONE caller and read by everyone else.
 *
 * WHY THIS EXISTS. Myfxbook sessions are bound to the login IP and the free
 * tier allows 100 requests a day. A Vercel deployment leaves from a different IP
 * on different invocations, so every page render that fetched the feed itself
 * logged in again — the 10-minute ingest alone is 144 logins a day — and
 * Myfxbook answers that with "Wrong email/password." for every caller on the
 * account, including a local script with the right password.
 *
 * So on a deployment (a durable store), only `refreshStoredCrowdFeed`, called
 * from the ingest job, talks to the provider: at most once per
 * `MYFXBOOK.refreshMinutes`, login + outlook + logout in one invocation. Pages
 * call `loadRetailPositioning`, which reads the stored copy and never logs in.
 * Without a durable store (plain local dev) there is nothing to share, so the
 * live fetch is kept.
 */

import { MYFXBOOK } from '@/config/sources.config';
import {
  FallbackCrowdProvider,
  MyfxbookProvider,
  OandaPositionBookProvider,
  fetchRetailPositioning,
  type CrowdProvider,
} from '@/lib/connectors/crowd';
import { getStore, type Store } from '@/lib/db/client';
import type { RetailPositioning, RetailPositioningFeed } from '@/lib/scoring/crowd';
import { fail, ok, type Result } from '@/lib/types';

/** Key in the store's generic JSON cache table; no migration needed. */
export const CROWD_FEED_KEY = 'crowd:retail-positioning:latest';
const SOURCE = 'Retail positioning (stored)';

export interface StoredCrowdFeed {
  /** When the entries were fetched. Null until the first successful refresh. */
  fetchedAtUtc: string | null;
  /** When a refresh was last ATTEMPTED, successful or not. Gates the next one. */
  attemptedAtUtc: string;
  source: string | null;
  entries: RetailPositioning[];
  lastError?: string;
}

/** Validates what came back from the store; anything malformed reads as absent. */
export function parseStoredFeed(raw: unknown): StoredCrowdFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Partial<StoredCrowdFeed>;
  if (typeof doc.attemptedAtUtc !== 'string' || !Array.isArray(doc.entries)) return null;
  const entries = doc.entries.filter(
    (e): e is RetailPositioning =>
      Boolean(e) && typeof e.symbol === 'string' && typeof e.longPct === 'number' && Number.isFinite(e.longPct),
  );
  return {
    fetchedAtUtc: typeof doc.fetchedAtUtc === 'string' ? doc.fetchedAtUtc : null,
    attemptedAtUtc: doc.attemptedAtUtc,
    source: typeof doc.source === 'string' ? doc.source : null,
    entries,
    lastError: typeof doc.lastError === 'string' ? doc.lastError : undefined,
  };
}

/** The stored feed as the pipeline consumes it. Never touches the provider. */
export async function loadStoredCrowdFeed(store: Store, now = new Date()): Promise<Result<RetailPositioningFeed>> {
  const doc = parseStoredFeed(await store.getAiCache(CROWD_FEED_KEY).catch(() => null));
  if (!doc || !doc.fetchedAtUtc || doc.entries.length === 0) {
    return fail(
      SOURCE,
      doc?.lastError
        ? `no stored feed yet (last refresh: ${doc.lastError})`
        : 'no stored feed yet; the ingest job refreshes it hourly',
    );
  }

  const ageHours = (now.getTime() - Date.parse(doc.fetchedAtUtc)) / 3_600_000;
  if (!(ageHours <= MYFXBOOK.storedFeedMaxAgeHours)) {
    return fail(
      SOURCE,
      `stored feed is ${Math.round(ageHours)}h old${doc.lastError ? `; last refresh: ${doc.lastError}` : ''}`,
    );
  }

  const feed: RetailPositioningFeed = new Map(doc.entries.map((e) => [e.symbol, e]));
  return ok(
    doc.source ?? SOURCE,
    feed,
    doc.lastError ? `last refresh failed: ${doc.lastError}` : undefined,
    doc.fetchedAtUtc,
  );
}

/** What the pipeline calls. A deployment reads the stored copy; plain local dev fetches. */
export async function loadRetailPositioning(
  now = new Date(),
  store: Store = getStore(),
): Promise<Result<RetailPositioningFeed>> {
  if (store.durable) return loadStoredCrowdFeed(store, now);
  return fetchRetailPositioning();
}

/** The ingest job's provider: Myfxbook logs out after every read, OANDA fills gaps. */
const INGEST_PROVIDER: CrowdProvider = new FallbackCrowdProvider([
  new MyfxbookProvider({ logoutAfterFetch: true }),
  new OandaPositionBookProvider(),
]);

/**
 * Refresh the stored feed, at most once per `MYFXBOOK.refreshMinutes`.
 *
 * The attempt is recorded BEFORE the login, so an overlapping ingest run sees it
 * and skips rather than logging in a second time. A failure keeps the previous
 * entries, which `loadStoredCrowdFeed` serves until they age out. Never throws.
 */
export async function refreshStoredCrowdFeed(
  store: Store,
  now = new Date(),
  provider: CrowdProvider = INGEST_PROVIDER,
): Promise<{ saved: number; skipped?: string; error?: string }> {
  try {
    if (!provider.isConfigured()) return { saved: 0, skipped: 'no crowd provider configured' };

    const previous = parseStoredFeed(await store.getAiCache(CROWD_FEED_KEY).catch(() => null));
    if (previous) {
      const minutesSince = (now.getTime() - Date.parse(previous.attemptedAtUtc)) / 60_000;
      if (minutesSince < MYFXBOOK.refreshMinutes) {
        return { saved: 0, skipped: `last refresh attempt ${Math.max(0, Math.round(minutesSince))} min ago` };
      }
    }

    const kept = {
      fetchedAtUtc: previous?.fetchedAtUtc ?? null,
      source: previous?.source ?? null,
      entries: previous?.entries ?? [],
    };
    const attemptedAtUtc = now.toISOString();
    await store.setAiCache(CROWD_FEED_KEY, 'crowd-feed', 'retail-positioning', { ...kept, attemptedAtUtc });

    const res = await fetchRetailPositioning(provider);
    if (!res.ok) {
      await store.setAiCache(CROWD_FEED_KEY, 'crowd-feed', 'retail-positioning', {
        ...kept,
        attemptedAtUtc,
        lastError: res.error,
      });
      return { saved: 0, error: res.error };
    }

    const entries = [...res.data.values()];
    const doc: StoredCrowdFeed = {
      fetchedAtUtc: attemptedAtUtc,
      attemptedAtUtc,
      source: res.source,
      entries,
      lastError: res.degraded,
    };
    await store.setAiCache(CROWD_FEED_KEY, 'crowd-feed', 'retail-positioning', doc);
    return { saved: entries.length, error: res.degraded };
  } catch (err) {
    return { saved: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
