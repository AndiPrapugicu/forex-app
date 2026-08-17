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
