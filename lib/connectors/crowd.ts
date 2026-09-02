/**
 * Retail positioning providers — the input to the Crowd Sentiment column.
 *
 * `lib/scoring/crowd.ts` decides what a long share MEANS. This decides where the
 * long share comes from. They are split because the scoring question was settled
 * by A1's own published cells months before a legitimate source for the input
 * existed, and the two should be able to move independently.
 *
 * WHAT THIS REPLACES, AND WHY IT IS NOT A TUNING CHANGE. The Crowd column is
 * currently fed by CFTC small-trader share, which is a WEEKLY, US-FUTURES,
 * reportable-account population. A1's is a DAILY, SPOT, retail-broker
 * population. Those are different measures of different traders, and no
 * threshold change converts one into the other — which is why the previous round
 * stopped tuning the CFTC rule and went looking for the source instead.
 *
 * CFTC IS NOT REMOVED. It stays as the fallback for the symbols where it is
 * demonstrably RIGHT rather than merely available: gold and silver reproduce
 * A1's crowd cell exactly from their own contracts, in the only two rows where
 * we have a checksum-verified value for a non-FX asset. A provider that covered
 * metals would be changing something already correct, so `MyfxbookProvider`
 * answers for FX only and the resolution order in `lib/scoring/crowd.ts` falls
 * through to the contract read for everything else.
 *
 * DISABLED UNTIL CREDENTIALS EXIST. With no `MYFXBOOK_EMAIL` / `MYFXBOOK_PASSWORD`
 * in the environment this returns an empty feed and a health note, and every
 * symbol resolves exactly as it does today. Wiring it up is an env change, not a
 * code change — but the numbers it produces have never been compared against
 * A1's, so treat the first run as a measurement and not as a parity improvement.
 */

import { MYFXBOOK } from '@/config/sources.config';
import { fetchJson } from '@/lib/connectors/base';
import type { RetailPositioning, RetailPositioningFeed } from '@/lib/scoring/crowd';
import { fail, ok, type Result } from '@/lib/types';

/**
 * A source of per-instrument retail long/short shares.
 *
 * BATCH, NOT PER-SYMBOL, and that is a constraint of the domain rather than a
 * convenience. Every provider surveyed publishes one snapshot covering every
 * instrument it tracks; none accepts a symbol filter, and the one with a free
 * tier caps requests per DAY. An interface shaped `get(symbol)` would invite a
 * loop over 29 symbols and exhaust that quota in under two hours.
 *
 * Per-symbol access is `feed.get(symbol)` on the result, which is the same
 * lookup without the fetch.
 */
export interface CrowdProvider {
  readonly name: string;
  /** True when the provider has what it needs to run at all. */
  isConfigured(): boolean;
  /** One snapshot, every symbol the provider covers. */
  fetchPositioning(): Promise<Result<RetailPositioningFeed>>;
}

interface MyfxbookSymbol {
  name?: string;
  longPercentage?: number | string;
  shortPercentage?: number | string;
}

interface MyfxbookOutlook {
  error?: boolean;
  message?: string;
  symbols?: MyfxbookSymbol[];
}

interface MyfxbookLogin {
  error?: boolean;
  message?: string;
  session?: string;
}

/**
 * Their symbol strings are already our FX strings — `EURUSD`, `GBPJPY`.
 *
 * Kept as an explicit filter rather than accepting whatever arrives, for two
 * reasons. Their feed also carries metals and indices under names that collide
 * with ours (`XAUUSD`), and admitting those would silently override the contract
 * read that currently reproduces A1's gold and silver cells exactly. And an
 * unrecognised name should be dropped loudly at the edge rather than land in the
 * matrix as a symbol nothing else knows about.
 */
function isFxPairName(name: string): boolean {
  return /^[A-Z]{6}$/.test(name) && !name.startsWith('XA') && !name.startsWith('XP');
}

function asPercent(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

/** Cached session id, so a 20-minute refresh does not re-login 72 times a day. */
let cachedSession: { id: string; expiresAt: number } | null = null;

/** Test seam: drop the memoised session so a case can start from a clean state. */
export function clearCrowdSession() {
  cachedSession = null;
}

export class MyfxbookProvider implements CrowdProvider {
  readonly name = MYFXBOOK.name;

  isConfigured(): boolean {
    return Boolean(process.env.MYFXBOOK_EMAIL && process.env.MYFXBOOK_PASSWORD);
  }

  /**
   * Log in and memoise the session.
   *
   * The credentials are read from the environment and passed straight to their
   * login endpoint; nothing here logs, caches or returns them. Sessions are
   * IP-bound and expire after a month, so a day-long memo is conservative and
   * costs one request per day out of the hundred.
   */
  private async session(): Promise<Result<string>> {
    if (cachedSession && cachedSession.expiresAt > Date.now()) {
      return ok(this.name, cachedSession.id);
    }

    const email = process.env.MYFXBOOK_EMAIL ?? '';
    const password = process.env.MYFXBOOK_PASSWORD ?? '';
    const url = `${MYFXBOOK.login}?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;

    // Never cached: the response carries a credential.
    const res = await fetchJson<MyfxbookLogin>(this.name, url, { timeoutMs: 10_000, retries: 1 });
    if (!res.ok) return fail(this.name, `login failed: ${res.error}`);
    if (res.data.error || !res.data.session) {
      return fail(this.name, `login rejected: ${res.data.message ?? 'no session returned'}`);
    }

    cachedSession = {
      id: res.data.session,
      expiresAt: Date.now() + MYFXBOOK.sessionTtlSeconds * 1000,
    };
    return ok(this.name, res.data.session);
  }

  async fetchPositioning(): Promise<Result<RetailPositioningFeed>> {
    if (!this.isConfigured()) {
      return fail(
        this.name,
        'not configured — set MYFXBOOK_EMAIL and MYFXBOOK_PASSWORD to score the Crowd column ' +
          'on crosses. Without it, crosses stay blank and dollar pairs fall back to CFTC.',
      );
    }

    const session = await this.session();
    if (!session.ok) return fail(this.name, session.error);

    const res = await fetchJson<MyfxbookOutlook>(
      this.name,
      `${MYFXBOOK.outlook}?session=${encodeURIComponent(session.data)}`,
      { cacheTtlSeconds: MYFXBOOK.cacheTtlSeconds, cacheKey: 'myfxbook:outlook', retries: 1 },
    );
    if (!res.ok) return fail(this.name, res.error);

    if (res.data.error) {
      // A stale session reads as an application-level error, not an HTTP one.
      cachedSession = null;
      return fail(this.name, `outlook rejected: ${res.data.message ?? 'unknown error'}`);
    }

    return ok(this.name, parseOutlook(res.data, this.name), res.degraded);
  }
}

/** Exported for tests: the response shape is the part most likely to drift. */
export function parseOutlook(payload: MyfxbookOutlook, source: string): RetailPositioningFeed {
  const feed: RetailPositioningFeed = new Map();
  const observedAt = new Date().toISOString().slice(0, 10);

  for (const row of payload.symbols ?? []) {
    const name = (row.name ?? '').trim().toUpperCase();
    if (!name || !isFxPairName(name)) continue;

    const reportedShort = asPercent(row.shortPercentage);
    let longPct = asPercent(row.longPercentage);
    // Some rows carry only the short share; the two are complements by definition.
    if (longPct === null) {
      if (reportedShort === null) continue;
      longPct = 100 - reportedShort;
    }

    const entry: RetailPositioning = { symbol: name, longPct, source, observedAt };
    // Only when the provider stated it. A complement computed here and stored
    // back would look like corroboration of a number it was derived from.
    if (reportedShort !== null) entry.shortPct = reportedShort;
    feed.set(name, entry);
  }

  return feed;
}

/** The provider the pipeline uses. One today; the interface is the seam. */
export const CROWD_PROVIDER: CrowdProvider = new MyfxbookProvider();

/**
 * Fetch retail positioning, degrading to an empty feed.
 *
 * NEVER REJECTS. An absent crowd feed costs one column on crosses, which is
 * where that column already stands — so a provider outage must not be able to
 * take down a board that was fine without it in the first place.
 */
export async function fetchRetailPositioning(
  provider: CrowdProvider = CROWD_PROVIDER,
): Promise<Result<RetailPositioningFeed>> {
  try {
    return await provider.fetchPositioning();
  } catch (err) {
    return fail(provider.name, err instanceof Error ? err.message : String(err));
  }
}
