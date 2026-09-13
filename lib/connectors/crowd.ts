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

import { MYFXBOOK, OANDA_POSITION_BOOK } from '@/config/sources.config';
import { ALL_SYMBOLS } from '@/config/symbols.config';
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

/**
 * RFC 3986 query encoding. `encodeURIComponent` leaves `! ' ( ) * ~` raw, and a
 * password containing one of them reaches a strict server as a different
 * string. Percent-encoding them is always valid, so there is no case where
 * this is worse.
 */
export function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*~]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The session as a query value, encoded EXACTLY once.
 *
 * Myfxbook's login returns the session ALREADY percent-encoded
 * (`Hf6j...%2F%2F...%3D%3D`). Passing that through `encodeURIComponent` turned
 * every `%2F` into `%252F`, so the outlook call received a different string and
 * answered "Invalid session." — which was recorded for weeks as a server-side
 * fault. Decoding first makes this correct whether or not a session arrives
 * encoded: base64 never contains `%`, so a raw session decodes to itself.
 */
export function sessionParam(session: string): string {
  let raw = session;
  try {
    raw = decodeURIComponent(session);
  } catch {
    // A malformed escape: send what we were given, encoded once.
  }
  return encodeURIComponent(raw);
}

/** Cached session id, so a 20-minute refresh does not re-login 72 times a day. */
let cachedSession: { id: string; expiresAt: number } | null = null;

/**
 * After a rejected login, no new login until this time.
 *
 * MEASURED 2026-09-13: with the right credentials, `login.json` passed once and
 * then answered "Wrong email/password." to the next attempt, while a deployment
 * running the pre-fix code was re-logging in on every refresh. Myfxbook reports
 * throttling with the same message as a bad password, so a failing caller that
 * keeps retrying locks out every other caller on the account. One attempt per
 * window is the most a broken configuration is allowed to cost.
 */
let loginBlockedUntil = 0;
export const MYFXBOOK_LOGIN_BACKOFF_MS = 30 * 60_000;

/** Test seam: drop the memoised session and backoff so a case can start clean. */
export function clearCrowdSession() {
  cachedSession = null;
  loginBlockedUntil = 0;
}

export class MyfxbookProvider implements CrowdProvider {
  readonly name = MYFXBOOK.name;

  /**
   * `logoutAfterFetch`: end the session as soon as the outlook is read. For a
   * serverless caller, where the next invocation may leave from a different IP
   * and so could never reuse the session anyway.
   */
  constructor(private readonly options: { logoutAfterFetch?: boolean } = {}) {}

  private async logout(session: string): Promise<void> {
    cachedSession = null;
    await fetchJson<unknown>(this.name, `${MYFXBOOK.logout}?session=${sessionParam(session)}`, {
      timeoutMs: 5_000,
      retries: 0,
    }).catch(() => undefined);
  }

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

    if (Date.now() < loginBlockedUntil) {
      return fail(
        this.name,
        `login paused after a rejection, retrying after ${new Date(loginBlockedUntil).toISOString().slice(11, 16)} UTC`,
      );
    }

    const email = process.env.MYFXBOOK_EMAIL ?? '';
    const password = process.env.MYFXBOOK_PASSWORD ?? '';
    const url = `${MYFXBOOK.login}?email=${strictEncode(email)}&password=${strictEncode(password)}`;

    // Never cached: the response carries a credential.
    const res = await fetchJson<MyfxbookLogin>(this.name, url, { timeoutMs: 10_000, retries: 1 });
    if (!res.ok) return fail(this.name, `login failed: ${res.error}`);
    if (res.data.error || !res.data.session) {
      loginBlockedUntil = Date.now() + MYFXBOOK_LOGIN_BACKOFF_MS;
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
      `${MYFXBOOK.outlook}?session=${sessionParam(session.data)}`,
      { cacheTtlSeconds: MYFXBOOK.cacheTtlSeconds, cacheKey: 'myfxbook:outlook', retries: 1 },
    );
    if (this.options.logoutAfterFetch) await this.logout(session.data);
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

interface OandaBucket {
  price?: string;
  longCountPercent?: string | number;
  shortCountPercent?: string | number;
}

interface OandaPositionBook {
  positionBook?: { instrument?: string; time?: string; buckets?: OandaBucket[] };
}

/**
 * One OANDA position book -> one symbol's long share.
 *
 * The book is a histogram: each price bucket holds the percentage of OANDA
 * clients long and short there. The whole-instrument long share is the long
 * mass over the total mass. Exported for tests: this shape is what drifts.
 */
export function parsePositionBook(
  payload: OandaPositionBook,
  symbol: string,
  source: string,
): RetailPositioning | null {
  let long = 0;
  let short = 0;
  for (const bucket of payload.positionBook?.buckets ?? []) {
    const l = Number(bucket.longCountPercent);
    const s = Number(bucket.shortCountPercent);
    if (Number.isFinite(l) && l >= 0) long += l;
    if (Number.isFinite(s) && s >= 0) short += s;
  }
  const total = long + short;
  if (!(total > 0)) return null;

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const time = payload.positionBook?.time;
  return {
    symbol,
    longPct: round1((long / total) * 100),
    shortPct: round1((short / total) * 100),
    source,
    observedAt: (time && !Number.isNaN(Date.parse(time)) ? new Date(time) : new Date()).toISOString().slice(0, 10),
  };
}

/** `EURUSD` -> `EUR_USD`, OANDA's instrument name. */
const toOandaInstrument = (symbol: string) => `${symbol.slice(0, 3)}_${symbol.slice(3)}`;

/**
 * OANDA's per-instrument position book, read with the user's own API token.
 *
 * FX only, through the same `isFxPairName` filter as Myfxbook, so the metals
 * keep the CFTC read that reproduces A1 exactly. An instrument OANDA publishes
 * no book for answers 404 and is simply absent from the feed.
 */
export class OandaPositionBookProvider implements CrowdProvider {
  readonly name = OANDA_POSITION_BOOK.name;

  constructor(
    private readonly symbols: readonly string[] = ALL_SYMBOLS
      .filter((d) => d.kind === 'fx')
      .map((d) => d.symbol)
      .filter(isFxPairName),
  ) {}

  isConfigured(): boolean {
    return Boolean(process.env.OANDA_API_TOKEN);
  }

  async fetchPositioning(): Promise<Result<RetailPositioningFeed>> {
    if (!this.isConfigured()) {
      return fail(this.name, 'not configured — set OANDA_API_TOKEN to read OANDA client positioning.');
    }

    const base = process.env.OANDA_ENV === 'live' ? OANDA_POSITION_BOOK.liveBase : OANDA_POSITION_BOOK.practiceBase;
    // The token travels in a header only; it is never part of a URL or a cache key.
    const headers = { Authorization: `Bearer ${process.env.OANDA_API_TOKEN}` };
    const feed: RetailPositioningFeed = new Map();
    const missing: string[] = [];

    for (let i = 0; i < this.symbols.length; i += OANDA_POSITION_BOOK.batch) {
      const batch = this.symbols.slice(i, i + OANDA_POSITION_BOOK.batch);
      await Promise.all(
        batch.map(async (symbol) => {
          const instrument = toOandaInstrument(symbol);
          const res = await fetchJson<OandaPositionBook>(this.name, `${base}/${instrument}/positionBook`, {
            headers,
            timeoutMs: 10_000,
            retries: 0,
            cacheTtlSeconds: OANDA_POSITION_BOOK.cacheTtlSeconds,
            cacheKey: `oanda:positionBook:${instrument}`,
          });
          if (!res.ok) {
            missing.push(`${instrument}: ${res.error}`);
            return;
          }
          const entry = parsePositionBook(res.data, symbol, this.name);
          if (entry) feed.set(symbol, entry);
          else missing.push(`${instrument}: empty book`);
        }),
      );
    }

    if (feed.size === 0) {
      return fail(
        this.name,
        `no position book returned${missing.length > 0 ? ` (${missing[0]}${missing.length > 1 ? `, and ${missing.length - 1} more` : ''})` : ''}`,
      );
    }
    return ok(this.name, feed, missing.length > 0 ? `${missing.length} instrument(s) without a book` : undefined);
  }
}

/**
 * Every configured provider, merged; the first listed wins a symbol both cover.
 *
 * Myfxbook goes first because it aggregates many brokers, which is closer to
 * A1's population than one broker's book; OANDA fills what Myfxbook does not
 * answer, or all of it while Myfxbook is failing. One provider failing is a
 * degraded note, not a failure, as long as another answered.
 */
export class FallbackCrowdProvider implements CrowdProvider {
  readonly name: string;

  constructor(private readonly providers: readonly CrowdProvider[]) {
    this.name = providers.map((p) => p.name).join(' + ');
  }

  isConfigured(): boolean {
    return this.providers.some((p) => p.isConfigured());
  }

  async fetchPositioning(): Promise<Result<RetailPositioningFeed>> {
    const configured = this.providers.filter((p) => p.isConfigured());
    if (configured.length === 0) {
      return fail(
        this.name,
        'not configured — set MYFXBOOK_EMAIL and MYFXBOOK_PASSWORD, or OANDA_API_TOKEN, to score the Crowd ' +
          'column on crosses. Without one, crosses stay blank and dollar pairs fall back to CFTC.',
      );
    }

    const results = await Promise.all(
      configured.map((p) =>
        p.fetchPositioning().catch((err: unknown) =>
          fail<RetailPositioningFeed>(p.name, err instanceof Error ? err.message : String(err)),
        ),
      ),
    );

    const feed: RetailPositioningFeed = new Map();
    const answered: string[] = [];
    const notes: string[] = [];
    for (const res of results) {
      if (!res.ok) {
        notes.push(`${res.source}: ${res.error}`);
        continue;
      }
      answered.push(res.source);
      if (res.degraded) notes.push(`${res.source}: ${res.degraded}`);
      for (const [symbol, entry] of res.data) {
        if (!feed.has(symbol)) feed.set(symbol, entry);
      }
    }

    // Named after the providers that were actually tried, so an unconfigured
    // one is never reported as "down" in the source strip.
    if (answered.length === 0) return fail(configured.map((p) => p.name).join(' + '), notes.join('; '));
    return ok(answered.join(' + '), feed, notes.length > 0 ? notes.join('; ') : undefined);
  }
}

/** The provider the pipeline uses: Myfxbook, then OANDA. */
export const CROWD_PROVIDER: CrowdProvider = new FallbackCrowdProvider([
  new MyfxbookProvider(),
  new OandaPositionBookProvider(),
]);

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
