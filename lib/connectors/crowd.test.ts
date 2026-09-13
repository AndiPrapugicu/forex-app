/**
 * The retail-positioning provider, and the bucket rule it feeds.
 *
 * Nothing here touches the network. The provider's contract is that it fails
 * closed — no credentials, a rejected login, or a malformed payload must all
 * end as "no feed", never as a throw and never as a half-populated map that
 * would score some symbols off a broken response.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  FallbackCrowdProvider,
  MyfxbookProvider,
  OandaPositionBookProvider,
  clearCrowdSession,
  fetchRetailPositioning,
  parseOutlook,
  parsePositionBook,
  sessionParam,
  strictEncode,
  type CrowdProvider,
} from '@/lib/connectors/crowd';
import { resolveCrowd, scoreRetailLongPct, type RetailPositioning, type RetailPositioningFeed } from '@/lib/scoring/crowd';
import { ALL_SYMBOLS } from '@/config/symbols.config';
import { fail, ok } from '@/lib/types';

describe('scoreRetailLongPct', () => {
  /**
   * A1 publish the bands as 40/60 and read them CONTRARIAN, so the sign flip is
   * part of the rule rather than an adjustment applied afterwards. The
   * boundaries are inclusive on both sides: their own copy says "above 60%" and
   * "below 40%" describe the crowd, while the cell changes AT the round number.
   */
  it.each([
    [95, -1, 'crowd heavily long -> bearish'],
    [60, -1, 'exactly 60 is already the bearish band'],
    [59.9, 0, 'just inside neutral on the long side'],
    [50, 0, 'balanced'],
    [40.1, 0, 'just inside neutral on the short side'],
    [40, 1, 'exactly 40 is already the bullish band'],
    [5, 1, 'crowd heavily short -> bullish'],
  ])('%s%% long scores %s (%s)', (longPct, expected) => {
    expect(scoreRetailLongPct(longPct)).toBe(expected);
  });

  /**
   * A1'S OWN CLASSIFICATION, ROW BY ROW.
   *
   * Read off their free Retail Sentiment dashboard on 2026-08-29, which labels
   * every row Bearish / Bullish / Neutral in its accessibility tree. This is the
   * measurement that retired several rounds of doubt about the 40/60 bands: the
   * two rows that had appeared to contradict them (EURCHF, GBPCHF) were FXSSI
   * numbers standing in for A1's, and A1's own values sit well inside the
   * bullish band. See CROWD_LONG_PCT_BUCKETS for the full account.
   *
   * EURGBP at exactly 40 is the load-bearing case: A1 call it Bullish, so the
   * lower bound is inclusive.
   */
  it.each([
    ['GBPAUD', 89, -1], ['EURCAD', 84, -1], ['EURAUD', 80, -1], ['GBPNZD', 75, -1],
    ['GBPCAD', 71, -1], ['EURNZD', 62, -1], ['USDZAR', 60.84, -1], ['USDCHF', 61, -1],
    ['CA-DOLLAR', 58, 0], ['NZDCAD', 54, 0], ['CHFJPY', 53, 0], ['GBPUSD', 50, 0],
    ['NZDUSD', 48, 0], ['EURUSD', 47, 0], ['CADCHF', 44, 0], ['USDCAD', 42, 0],
    ['EURGBP', 40, 1], ['CH-FRANC', 39, 1], ['CADJPY', 38, 1], ['GBPCHF', 33, 1],
    ['EURJPY', 31, 1], ['NZDJPY', 30, 1], ['AUDUSD', 28, 1], ['NZDCHF', 27, 1],
    ['EURCHF', 26, 1], ['AUDJPY', 24, 1], ['AUDNZD', 13, 1], ['AUDCHF', 10, 1],
    ['AUDCAD', 6, 1],
  ])("reproduces A1's own reading for %s at %s%% long", (_symbol, longPct, expected) => {
    expect(scoreRetailLongPct(longPct as number)).toBe(expected);
  });

  /**
   * The two rows that were on file as contradicting the bands, using A1's own
   * historical feed for the day the contradicting cells were captured rather
   * than FXSSI's stand-in. Both score +1, which is what A1 printed.
   */
  it.each([
    ['EURCHF', 32], ['GBPCHF', 36], ['GBPUSD', 31], ['EURUSD', 25],
  ])('scores %s at its A1-published 2026-08-24 long share of %s%% as +1', (_s, longPct) => {
    expect(scoreRetailLongPct(longPct as number)).toBe(1);
  });
});

describe('parseOutlook', () => {
  it('reads long percentage per symbol', () => {
    const feed = parseOutlook(
      { symbols: [{ name: 'EURUSD', longPercentage: 63.4, shortPercentage: 36.6 }] },
      'test',
    );
    expect(feed.get('EURUSD')?.longPct).toBeCloseTo(63.4);
  });

  it('accepts crosses, which is the entire point of using this source', () => {
    const feed = parseOutlook(
      {
        symbols: [
          { name: 'EURCHF', longPercentage: 22 },
          { name: 'GBPJPY', longPercentage: 71 },
          { name: 'AUDNZD', longPercentage: 48 },
        ],
      },
      'test',
    );
    expect([...feed.keys()].sort()).toEqual(['AUDNZD', 'EURCHF', 'GBPJPY']);
    expect(scoreRetailLongPct(feed.get('EURCHF')!.longPct)).toBe(1);
    expect(scoreRetailLongPct(feed.get('GBPJPY')!.longPct)).toBe(-1);
    expect(scoreRetailLongPct(feed.get('AUDNZD')!.longPct)).toBe(0);
  });

  it('derives the long share when only the short share is published', () => {
    const feed = parseOutlook({ symbols: [{ name: 'USDJPY', shortPercentage: 30 }] }, 'test');
    expect(feed.get('USDJPY')?.longPct).toBe(70);
  });

  /**
   * METALS ARE EXCLUDED ON PURPOSE, and this is the test that stops a future
   * change from "improving" coverage by admitting them.
   *
   * Gold and silver are the only two non-FX rows with a checksum-verified A1
   * crowd cell, and the CFTC contract read reproduces BOTH exactly. Letting a
   * retail feed answer for XAUUSD would override a correct value with an
   * untested one, because A1's non-FX sentiment is a different input entirely.
   */
  it('drops metals so the contract read that already matches A1 keeps them', () => {
    const feed = parseOutlook(
      { symbols: [{ name: 'XAUUSD', longPercentage: 85 }, { name: 'EURUSD', longPercentage: 50 }] },
      'test',
    );
    expect(feed.has('XAUUSD')).toBe(false);
    expect(feed.has('EURUSD')).toBe(true);
  });

  it.each([
    ['a missing name', { longPercentage: 50 }],
    ['a non-pair name', { name: 'SPX500', longPercentage: 50 }],
    ['no percentages at all', { name: 'EURUSD' }],
    ['an out-of-range percentage', { name: 'EURUSD', longPercentage: 140 }],
    ['a non-numeric percentage', { name: 'EURUSD', longPercentage: 'n/a' }],
  ])('skips a row with %s rather than inventing one', (_label, row) => {
    expect(parseOutlook({ symbols: [row] }, 'test').size).toBe(0);
  });

  it('survives an empty or absent symbols array', () => {
    expect(parseOutlook({}, 'test').size).toBe(0);
    expect(parseOutlook({ symbols: [] }, 'test').size).toBe(0);
  });
});

describe('MyfxbookProvider', () => {
  const saved = { email: process.env.MYFXBOOK_EMAIL, password: process.env.MYFXBOOK_PASSWORD };

  beforeEach(() => {
    delete process.env.MYFXBOOK_EMAIL;
    delete process.env.MYFXBOOK_PASSWORD;
    clearCrowdSession();
  });

  afterEach(() => {
    if (saved.email) process.env.MYFXBOOK_EMAIL = saved.email;
    else delete process.env.MYFXBOOK_EMAIL;
    if (saved.password) process.env.MYFXBOOK_PASSWORD = saved.password;
    else delete process.env.MYFXBOOK_PASSWORD;
    clearCrowdSession();
  });

  /**
   * THE DEFAULT PATH, and the one that must never make a request. Shipping this
   * connector must not change a single cell for anyone who has not opted in, so
   * "unconfigured" is checked before anything touches the network.
   */
  it('reports unconfigured without attempting a request', async () => {
    const res = await new MyfxbookProvider().fetchPositioning();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('not configured');
  });

  /**
   * A rejected login must not be retried on the next refresh. Myfxbook answers
   * throttling with "Wrong email/password.", so a retry loop locks the account
   * out for every other caller. Network stubbed; no request leaves the process.
   */
  it('pauses logins after a rejection instead of retrying every refresh', async () => {
    const realFetch = globalThis.fetch;
    let logins = 0;
    globalThis.fetch = (async () => {
      logins++;
      return new Response(JSON.stringify({ error: true, message: 'Wrong email/password.' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      process.env.MYFXBOOK_EMAIL = 'someone@example.com';
      process.env.MYFXBOOK_PASSWORD = 'x';
      const provider = new MyfxbookProvider();
      const first = await provider.fetchPositioning();
      const second = await provider.fetchPositioning();
      expect(logins).toBe(1);
      expect(!first.ok && first.error).toContain('Wrong email/password');
      expect(!second.ok && second.error).toContain('login paused');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('is configured only when BOTH credentials are present', () => {
    const provider = new MyfxbookProvider();
    expect(provider.isConfigured()).toBe(false);
    process.env.MYFXBOOK_EMAIL = 'someone@example.com';
    expect(provider.isConfigured()).toBe(false);
    process.env.MYFXBOOK_PASSWORD = 'x';
    expect(provider.isConfigured()).toBe(true);
  });
});

describe('strictEncode', () => {
  it('percent-encodes the characters encodeURIComponent leaves raw', () => {
    expect(strictEncode("a*b!c'd(e)f~g")).toBe('a%2Ab%21c%27d%28e%29f%7Eg');
  });

  it('matches encodeURIComponent everywhere else', () => {
    expect(strictEncode('user+tag@example.com & x=1')).toBe(encodeURIComponent('user+tag@example.com & x=1'));
  });
});

describe('sessionParam', () => {
  /**
   * THE BUG THAT LOOKED LIKE A SERVER FAULT. Myfxbook's login returns the
   * session already percent-encoded; encoding it again sent `%252F` and the
   * outlook call answered "Invalid session." (shape of a real 2026-09-13 session,
   * not the value).
   */
  it('does not double-encode a session Myfxbook already encoded', () => {
    expect(sessionParam('Ab%2F%2FCd%2BEf%3D%3D')).toBe('Ab%2F%2FCd%2BEf%3D%3D');
  });

  it('encodes a raw base64 session once', () => {
    expect(sessionParam('Ab//Cd+Ef==')).toBe('Ab%2F%2FCd%2BEf%3D%3D');
  });

  it('survives a malformed escape', () => {
    expect(sessionParam('Ab%zz')).toBe(encodeURIComponent('Ab%zz'));
  });
});

describe('parsePositionBook', () => {
  const book = {
    positionBook: {
      instrument: 'AUD_USD',
      time: '2026-09-11T20:00:00Z',
      buckets: [
        { price: '0.7150', longCountPercent: '10.0', shortCountPercent: '5.0' },
        { price: '0.7160', longCountPercent: '20.0', shortCountPercent: '15.0' },
        { price: '0.7170', longCountPercent: '0.0', shortCountPercent: '50.0' },
      ],
    },
  };

  it('reads the long share as long mass over total mass', () => {
    const entry = parsePositionBook(book, 'AUDUSD', 'OANDA');
    expect(entry).toMatchObject({ symbol: 'AUDUSD', longPct: 30, shortPct: 70, observedAt: '2026-09-11' });
    expect(scoreRetailLongPct(entry!.longPct)).toBe(1);
  });

  it('returns null for an empty or malformed book rather than inventing 0%', () => {
    expect(parsePositionBook({}, 'AUDUSD', 'OANDA')).toBeNull();
    expect(parsePositionBook({ positionBook: { buckets: [{ longCountPercent: 'n/a' }] } }, 'AUDUSD', 'OANDA')).toBeNull();
  });
});

describe('OandaPositionBookProvider', () => {
  const saved = process.env.OANDA_API_TOKEN;
  beforeEach(() => { delete process.env.OANDA_API_TOKEN; });
  afterEach(() => {
    if (saved) process.env.OANDA_API_TOKEN = saved;
    else delete process.env.OANDA_API_TOKEN;
  });

  it('reports unconfigured without attempting a request', async () => {
    const provider = new OandaPositionBookProvider();
    expect(provider.isConfigured()).toBe(false);
    const res = await provider.fetchPositioning();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('not configured');
  });
});

describe('FallbackCrowdProvider', () => {
  const entry = (symbol: string, longPct: number, source: string): RetailPositioning =>
    ({ symbol, longPct, source, observedAt: '2026-09-11' });
  const stub = (name: string, configured: boolean, result: () => ReturnType<CrowdProvider['fetchPositioning']>): CrowdProvider =>
    ({ name, isConfigured: () => configured, fetchPositioning: result });

  it('lets the first provider win a symbol both cover, and fills the rest from the second', async () => {
    const first = stub('first', true, async () => ok('first', new Map([['EURUSD', entry('EURUSD', 70, 'first')]])));
    const second = stub('second', true, async () =>
      ok('second', new Map([['EURUSD', entry('EURUSD', 30, 'second')], ['AUDNZD', entry('AUDNZD', 20, 'second')]])));
    const res = await new FallbackCrowdProvider([first, second]).fetchPositioning();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.get('EURUSD')?.source).toBe('first');
      expect(res.data.get('AUDNZD')?.source).toBe('second');
    }
  });

  it('degrades, not fails, when one provider fails and another answers', async () => {
    const broken = stub('myfxbook', true, async () => fail('myfxbook', 'login rejected'));
    const working = stub('oanda', true, async () => ok('oanda', new Map([['AUDUSD', entry('AUDUSD', 28, 'oanda')]])));
    const res = await new FallbackCrowdProvider([broken, working]).fetchPositioning();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe('oanda');
      expect(res.degraded).toContain('login rejected');
    }
  });

  it('skips unconfigured providers and says so when none is configured', async () => {
    let called = false;
    const off = stub('off', false, async () => { called = true; return ok('off', new Map()); });
    const res = await new FallbackCrowdProvider([off]).fetchPositioning();
    expect(called).toBe(false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('not configured');
  });

  it('fails when every configured provider fails', async () => {
    const a = stub('a', true, async () => fail('a', 'down'));
    const b = stub('b', true, async () => { throw new Error('socket hang up'); });
    const res = await new FallbackCrowdProvider([a, b]).fetchPositioning();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('socket hang up');
  });
});

describe('fetchRetailPositioning', () => {
  it('passes a working provider through', async () => {
    const feed: RetailPositioningFeed = new Map([
      ['EURCHF', { symbol: 'EURCHF', longPct: 25, source: 'stub', observedAt: '2026-08-24' }],
    ]);
    const provider: CrowdProvider = {
      name: 'stub',
      isConfigured: () => true,
      fetchPositioning: async () => ok('stub', feed),
    };
    const res = await fetchRetailPositioning(provider);
    expect(res.ok && res.data.get('EURCHF')?.longPct).toBe(25);
  });

  it('reports a provider failure as a Result rather than raising', async () => {
    const provider: CrowdProvider = {
      name: 'stub',
      isConfigured: () => true,
      fetchPositioning: async () => fail('stub', 'upstream down'),
    };
    const res = await fetchRetailPositioning(provider);
    expect(res.ok).toBe(false);
  });

  /**
   * A crowd outage costs one column on crosses — which is where that column
   * already stands. It must not be able to take down a board that was fine
   * without it, so even a thrown provider degrades to a Result.
   */
  it('catches a throwing provider instead of failing the whole pipeline', async () => {
    const provider: CrowdProvider = {
      name: 'stub',
      isConfigured: () => true,
      fetchPositioning: async () => {
        throw new Error('socket hang up');
      },
    };
    const res = await fetchRetailPositioning(provider);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('socket hang up');
  });
});

// ---------------------------------------------------------------------------
// Currency-index rows, read off their own dollar pair
// ---------------------------------------------------------------------------

/**
 * A1's free Retail Sentiment dashboard, "Currencies" and "Major Currency Pairs"
 * categories, 2026-08-29. Every index row on that screen was exactly its own
 * dollar pair, the right way up or upside down — see `indexFromDollarPair`.
 */
const A1_2026_08_29: Record<string, number> = {
  GBPUSD: 50, NZDUSD: 48, EURUSD: 47, AUDUSD: 28,
  USDCAD: 42, USDJPY: 44, USDCHF: 61,
};

function feedOf(longPcts: Record<string, number>): RetailPositioningFeed {
  const feed: RetailPositioningFeed = new Map();
  for (const [symbol, longPct] of Object.entries(longPcts)) {
    const entry: RetailPositioning = { symbol, longPct, source: 'test', observedAt: '2026-08-29' };
    feed.set(symbol, entry);
  }
  return feed;
}

const defOf = (symbol: string) => ALL_SYMBOLS.find((d) => d.symbol === symbol)!;

describe('a currency index reads its own dollar pair', () => {
  const feed = feedOf(A1_2026_08_29);
  const noCot = new Map();

  /**
   * The four identities and three complements measured on A1's own screen, with
   * the long share each one implies and the cell it scores. GB-POUND read 50 on
   * the same screen as GBPUSD 50; CH-FRANC read 39 against USDCHF 61.
   */
  it.each([
    ['GBPX', 50, 0], ['NZDX', 48, 0], ['EURX', 47, 0], ['AUDX', 28, 1],
    ['CADX', 58, 0], ['JPYX', 56, 0], ['CHFX', 39, 1],
  ])('%s reads %s%% long and scores %s', (symbol, _longPct, expected) => {
    const cell = resolveCrowd(defOf(symbol as string), noCot, feed);
    expect(cell.basis).toBe('retail-feed');
    expect(cell.cell).toBe(expected);
  });

  it('inverts, rather than copies, when the currency is the quote', () => {
    // USDCHF 61% long means only 39% of retail is long the franc.
    const cell = resolveCrowd(defOf('CHFX'), noCot, feed);
    expect(cell.explanation).toContain('39.0% of retail is long CHF');
    expect(cell.explanation).toContain('inverted');
  });

  /**
   * US-DOLLAR is NOT derived. It read 92.51% on the same screen — a two-decimal
   * value no dollar pair produces — so the dollar index has its own book, and
   * deriving it from a pair would invent a number.
   */
  it('never derives DXY from a dollar pair', () => {
    const cell = resolveCrowd(defOf('DXY'), noCot, feed);
    expect(cell.basis).not.toBe('retail-feed');
  });

  it('leaves every index row exactly as it was when no feed is configured', () => {
    for (const symbol of ['GBPX', 'NZDX', 'EURX', 'AUDX', 'CADX', 'JPYX', 'CHFX']) {
      expect(resolveCrowd(defOf(symbol), noCot, undefined).basis).not.toBe('retail-feed');
    }
  });

  it('still prefers a direct per-symbol entry over the derivation', () => {
    const withDirect = feedOf({ ...A1_2026_08_29, GBPX: 95 });
    expect(resolveCrowd(defOf('GBPX'), noCot, withDirect).cell).toBe(-1);
  });
});
