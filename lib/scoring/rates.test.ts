/**
 * The Interest Rates column.
 *
 * This column scores from the central bank's OWN published projection and from
 * nothing else, so the only ways it can be wrong are reading a projection that
 * is not there and failing to read one that is. Both are covered below; the
 * second is a bug that shipped.
 */

import { describe, expect, it } from 'vitest';
import { resolveRateProjection, scoreRateExpectation } from '@/lib/scoring/rates';
import type { Currency, NormalizedEvent } from '@/lib/types';

const NOW = new Date('2026-08-11T12:00:00Z');

function projection(currency: Currency, current: number, nextYear: number): NormalizedEvent[] {
  const base = {
    currency,
    countryCode: currency === 'USD' ? 'US' : 'JP',
    dateUtc: '2026-06-18T18:00:00Z',
    impact: 'HIGH' as const,
    consensus: null,
    previous: null,
    revised: null,
    unit: null,
    ratioDeviation: null,
    isBetterThanExpected: null,
    isSpeech: false,
    isPreliminary: false,
    source: 'fxstreet' as const,
    actualSource: 'fxstreet' as const,
    sourceUrl: null,
    lastUpdated: null,
  };

  return [
    { ...base, id: 'proj-current', name: 'Interest Rate Projections - Current', actual: current },
    { ...base, id: 'proj-next', name: 'Interest Rate Projections - 1st year', actual: nextYear },
  ];
}

describe('resolveRateProjection', () => {
  it('reads a published projection', () => {
    const resolved = resolveRateProjection('USD', projection('USD', 3.9, 3.4), NOW);
    expect(resolved).not.toBeNull();
    expect(resolved?.current).toBe(3.9);
    expect(resolved?.nextYear).toBe(3.4);
  });

  /**
   * The bug. `if (!current?.actual || !nextYear?.actual)` is a FALSY check, so a
   * projected rate of exactly 0.00% — which the BoJ and the SNB have both
   * published — read as "no projection at all" and dropped the column to a
   * silent 0 for a bank that had told us exactly where it was going.
   */
  it('reads a projection of exactly zero rather than treating it as missing', () => {
    const resolved = resolveRateProjection('JPY', projection('JPY', 0, 0.5), NOW);
    expect(resolved).not.toBeNull();
    expect(resolved?.current).toBe(0);
    expect(resolved?.nextYear).toBe(0.5);
  });

  it('reads a projection that ends at zero', () => {
    const resolved = resolveRateProjection('JPY', projection('JPY', 0.5, 0), NOW);
    expect(resolved?.nextYear).toBe(0);
  });

  it('returns null when the projection is genuinely absent', () => {
    expect(resolveRateProjection('GBP', [], NOW)).toBeNull();
  });

  it('returns null once the projection ages out', () => {
    const stale = new Date('2027-06-18T12:00:00Z');
    expect(resolveRateProjection('USD', projection('USD', 3.9, 3.4), stale)).toBeNull();
  });
});

describe('scoreRateExpectation', () => {
  const yields = new Map();

  it('scores cuts negative and hikes positive', () => {
    expect(scoreRateExpectation('USD', yields, projection('USD', 3.9, 3.4), NOW).cell).toBe(-1);
    expect(scoreRateExpectation('USD', yields, projection('USD', 3.4, 3.9), NOW).cell).toBe(1);
  });

  it('scores a projected hike off a zero rate, which the falsy check used to lose', () => {
    const scored = scoreRateExpectation('JPY', yields, projection('JPY', 0, 0.5), NOW);
    expect(scored.cell).toBe(1);
    expect(scored.basis).toBe('projection');
  });

  /**
   * A 0 here means "no published forecast", which is true for seven of the eight
   * majors and is the only honest reading. It must stay distinguishable from a
   * bank that published a projection of no change.
   */
  it('scores 0 with basis "none" where no bank projection exists', () => {
    const scored = scoreRateExpectation('GBP', yields, [], NOW);
    expect(scored.cell).toBe(0);
    expect(scored.basis).toBe('none');
  });

  it('scores 0 with basis "projection" where the bank projects no change', () => {
    const scored = scoreRateExpectation('USD', yields, projection('USD', 3.9, 3.9), NOW);
    expect(scored.cell).toBe(0);
    expect(scored.basis).toBe('projection');
  });
});

// ---------------------------------------------------------------------------
// Why the 2-year spread is shown but not scored
// ---------------------------------------------------------------------------

describe('the 2-year spread is context, not a score', () => {
  /** A standing policy rate, which the spread is measured against. */
  function decision(currency: Currency, rate: number): NormalizedEvent[] {
    return [
      {
        id: 'decision',
        seriesId: null,
        name: currency === 'GBP' ? 'Bank Rate' : `${currency} Interest Rate Decision`,
        currency,
        countryCode: currency === 'GBP' ? 'UK' : 'CH',
        dateUtc: '2026-07-30T11:00:00Z',
        impact: 'HIGH',
        actual: rate,
        consensus: rate,
        previous: rate,
        revised: null,
        unit: '%',
        ratioDeviation: null,
        isBetterThanExpected: null,
        isSpeech: false,
        isPreliminary: false,
        source: 'fxstreet',
        actualSource: 'fxstreet',
        sourceUrl: null,
        lastUpdated: null,
      },
    ];
  }

  const yieldOf = (currency: Currency, value: number) =>
    new Map([[currency, { currency, value, observedOn: '2026-08-11', source: 'TradingView quotes' }]]);

  it('computes the spread and reports it without letting it score', () => {
    const scored = scoreRateExpectation('GBP', yieldOf('GBP', 4.38), decision('GBP', 3.75), NOW);

    expect(scored.spread).toBeCloseTo(0.63, 2);
    expect(scored.explanation).toMatch(/for context/i);
    expect(scored.basis).toBe('none');
    expect(scored.cell).toBe(0);
  });

  /**
   * THE MEASUREMENT THAT SETTLED IT, kept as a test so the idea is not retried
   * a third time without meeting the evidence.
   *
   * Sovereign 2-years are now available for all eight majors, so scoring the
   * spread is mechanically possible. It just says nothing: every curve slopes
   * up, so every leg would score +1 and every non-USD CROSS would cancel to 0 —
   * the exact cell the change was meant to fix. The term premium is common to
   * all of them and swamps the policy expectation the column is asking about.
   *
   * Live spreads on the day this was measured, all positive.
   */
  it('would score every major identically, which is why it cannot inform a cross', () => {
    const spreads: Record<string, number> = {
      USD: 0.42, EUR: 0.48, GBP: 0.63, JPY: 0.69,
      AUD: 0.27, NZD: 1.09, CAD: 0.73, CHF: 0.1,
    };

    const wouldScore = Object.values(spreads).map((s) => (Math.abs(s) < 0.1 ? 0 : s > 0 ? 1 : -1));
    expect(new Set(wouldScore).size).toBe(1); // one value across all eight
    expect(wouldScore[0]).toBe(1);

    // And so every cross built from two of them differences to nothing.
    expect(wouldScore[2] - wouldScore[3]).toBe(0); // GBP - JPY
    expect(wouldScore[2] - wouldScore[7]).toBe(0); // GBP - CHF
  });

  it('keeps the bank OWN projection ahead of anything market-derived', () => {
    /**
     * The case that rejected the market proxy the first time: the US 2-year sat
     * above the policy rate implying hikes while the Fed's dots projected cuts.
     */
    const events = [...projection('USD', 3.9, 3.4), ...decision('USD', 3.63)];
    const scored = scoreRateExpectation('USD', yieldOf('USD', 4.19), events, NOW);

    expect(scored.basis).toBe('projection');
    expect(scored.cell).toBe(-1); // cuts, per the dots — not the market's hikes
  });
});
