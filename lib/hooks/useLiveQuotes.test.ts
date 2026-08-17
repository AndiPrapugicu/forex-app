/**
 * The Live badge, and the poll rate behind it.
 *
 * Measured against wall clock during planning: FX pairs and crypto came back
 * 1–8 seconds old, every futures-priced symbol — gold, silver, platinum,
 * copper, WTI, DXY — came back EXACTLY 600 seconds old, and the European cash
 * indices 900. All of them rendered under the same pulsing green "Live" dot.
 *
 * These tests pin the two consequences: the badge must not claim a delayed feed
 * is live, and the poller must not spend forty requests per data point on one.
 */

import { describe, expect, it } from 'vitest';
import {
  DELAYED_POLL_MS,
  POLL_MS,
  freshnessOf,
  pollIntervalFor,
  type LiveQuote,
} from '@/lib/hooks/useLiveQuotes';

/** A quote received now, stamped `ageSeconds` ago by the exchange. */
function quote(ageSeconds: number | null, symbol = 'EURUSD'): LiveQuote {
  return {
    source: 'poll',
    symbol,
    price: 1.16,
    previousClose: 1.15,
    changePct: 0.5,
    time: ageSeconds === null ? null : Math.floor(Date.now() / 1000) - ageSeconds,
    dayHigh: null,
    dayLow: null,
    receivedAt: Date.now(),
    ageSeconds,
  };
}

describe('freshnessOf', () => {
  it('calls a seconds-old FX quote live', () => {
    expect(freshnessOf(quote(3)).kind).toBe('live');
    expect(freshnessOf(quote(3)).label).toBe('Live');
  });

  it('calls the measured 600s futures delay delayed, not live', () => {
    const read = freshnessOf(quote(600, 'XAUUSD'));
    expect(read.kind).toBe('delayed');
    expect(read.label).toBe('Delayed 10m');
  });

  it('calls the measured 900s index delay delayed', () => {
    expect(freshnessOf(quote(900, 'FTSE')).label).toBe('Delayed 15m');
  });

  it('reads a market that has not traded for hours as closed, not delayed', () => {
    const read = freshnessOf(quote(6 * 3600, 'SPX'));
    expect(read.kind).toBe('closed');
    expect(read.label).toBe('6h old');
  });

  /**
   * Never guesses upward. "We cannot tell how current this is" and "this is
   * current" are different statements, and only one of them is defensible.
   */
  it('does not claim live for an unstamped quote', () => {
    expect(freshnessOf(quote(null)).kind).toBe('unstamped');
  });

  it('does not claim live before the first tick', () => {
    expect(freshnessOf(null).kind).toBe('unstamped');
    expect(freshnessOf(null).label).toBe('Connecting…');
  });

  it('treats a small clock skew as live rather than negative', () => {
    expect(freshnessOf(quote(0)).kind).toBe('live');
  });
});

describe('pollIntervalFor', () => {
  it('polls a live feed at the normal rate', () => {
    expect(pollIntervalFor([quote(4)])).toBe(POLL_MS);
  });

  /**
   * The waste the plan measured: a 10-minute-delayed symbol yields one data
   * point per 600 seconds, so a 15s poll spends forty requests to learn one
   * number — against a host whose 429 cooldown is shared with every other Yahoo
   * call the app makes.
   */
  it('backs a wholly delayed feed off to the slow rate', () => {
    expect(pollIntervalFor([quote(600, 'XAUUSD')])).toBe(DELAYED_POLL_MS);
  });

  it('keeps the fast rate when any member of the set is genuinely live', () => {
    // The scorecard index is one request for the whole board, and that board
    // mixes seconds-old FX with ten-minute-old metals.
    expect(pollIntervalFor([quote(600, 'XAUUSD'), quote(3, 'EURUSD')])).toBe(POLL_MS);
  });

  it('does not slow a feed it knows nothing about', () => {
    expect(pollIntervalFor([quote(null)])).toBe(POLL_MS);
    expect(pollIntervalFor([])).toBe(POLL_MS);
  });
});
