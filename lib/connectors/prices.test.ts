/**
 * The batch quote path.
 *
 * Two things here are load-bearing rather than incidental, and both were found
 * by probing Yahoo rather than by reading anything:
 *
 *  - 21 symbols in one spark call is an HTTP 400, not a truncated list. Without
 *    chunking, adding one symbol to the config silently blanks every price on
 *    the app.
 *  - `meta.chartPreviousClose` is NOT yesterday's close. On GC=F it was four
 *    sessions old, which renders a +1.4% day as +9%. The close series is the
 *    only dependable reference, so these tests pin that we read it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YAHOO } from '@/config/sources.config';
import { clearCache } from '@/lib/connectors/base';
import { fetchSparkQuotes } from '@/lib/connectors/prices';

const originalFetch = globalThis.fetch;

/** One spark entry, shaped exactly as Yahoo returns it. */
function entry(
  symbol: string,
  meta: Record<string, unknown>,
  closes: (number | null)[] = [],
) {
  return {
    symbol,
    response: [{ meta: { symbol, ...meta }, indicators: { quote: [{ close: closes }] } }],
  };
}

function sparkResponse(entries: unknown[]) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ spark: { result: entries } }),
    text: async () => '',
  } as unknown as Response;
}

/** The `symbols=` list a mocked call was made with. */
function requestedSymbols(url: string): string[] {
  return decodeURIComponent(new URL(url).searchParams.get('symbols') ?? '').split(',');
}

describe('fetchSparkQuotes', () => {
  beforeEach(() => clearCache());

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('never puts more than the endpoint limit in one request', async () => {
    const tickers = Array.from({ length: 47 }, (_, i) => `T${i}=X`);

    const fetchMock = vi.fn(async (url: string) =>
      sparkResponse(requestedSymbols(url).map((s) => entry(s, { regularMarketPrice: 1 }, [1, 1]))),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await fetchSparkQuotes(tickers);

    // 47 at 20 per call is three requests, none of them over the limit.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(requestedSymbols(call[0] as string).length).toBeLessThanOrEqual(
        YAHOO.sparkMaxSymbols,
      );
    }
    expect(out.size).toBe(47);
  });

  it('deduplicates tickers before chunking', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      sparkResponse(requestedSymbols(url).map((s) => entry(s, { regularMarketPrice: 1 }, [1, 1]))),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await fetchSparkQuotes(['EURUSD=X', 'EURUSD=X', 'GC=F']);

    expect(requestedSymbols(fetchMock.mock.calls[0][0] as string)).toEqual(['EURUSD=X', 'GC=F']);
  });

  it('reads yesterday from the close series, not chartPreviousClose', async () => {
    /**
     * The GC=F case verbatim: spot equals the final bar because the session is
     * live, and `chartPreviousClose` points four sessions back. Reading it would
     * report +5.0% for a day that actually moved +2.1%.
     */
    globalThis.fetch = vi.fn(async () =>
      sparkResponse([
        entry(
          'GC=F',
          { regularMarketPrice: 4453.9, chartPreviousClose: 4242.0, regularMarketTime: 1_786_420_800 },
          [4242.0, 4340.7, 4361.8, 4453.9],
        ),
      ]),
    ) as unknown as typeof fetch;

    const q = (await fetchSparkQuotes(['GC=F'])).get('GC=F');

    expect(q?.previousClose).toBe(4361.8);
    expect(q?.changePct).toBeCloseTo(2.11, 2);
  });

  it('prefers meta.previousClose when the feed sends one', async () => {
    globalThis.fetch = vi.fn(async () =>
      sparkResponse([
        entry('AAPL', { regularMarketPrice: 110, previousClose: 100 }, [95, 97, 99]),
      ]),
    ) as unknown as typeof fetch;

    const q = (await fetchSparkQuotes(['AAPL'])).get('AAPL');

    expect(q?.previousClose).toBe(100);
    expect(q?.changePct).toBeCloseTo(10, 6);
  });

  it('omits a symbol with no usable price rather than reporting zero', async () => {
    globalThis.fetch = vi.fn(async () =>
      sparkResponse([
        entry('EURUSD=X', { regularMarketPrice: 1.1555 }, [1.1532, 1.1555]),
        entry('DEAD=X', { regularMarketPrice: null as unknown as number }),
      ]),
    ) as unknown as typeof fetch;

    const out = await fetchSparkQuotes(['EURUSD=X', 'DEAD=X']);

    expect(out.has('EURUSD=X')).toBe(true);
    // A price of 0 next to a live one is worse than a gap: it reads as a crash.
    expect(out.has('DEAD=X')).toBe(false);
  });

  it('returns what it can when one batch fails outright', async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async (url: string) => {
      call += 1;
      if (call === 2) throw new Error('network down');
      return sparkResponse(
        requestedSymbols(url).map((s) => entry(s, { regularMarketPrice: 2 }, [1, 2])),
      );
    }) as unknown as typeof fetch;

    const out = await fetchSparkQuotes(Array.from({ length: 30 }, (_, i) => `T${i}=X`));

    // First batch of 20 survives; the failed one contributes nothing. One dead
    // request must not blank the whole board.
    expect(out.size).toBe(20);
  });

  it('makes no request at all for an empty list', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect((await fetchSparkQuotes([])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
