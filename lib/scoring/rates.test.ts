/**
 * The Interest Rates column.
 *
 * This column scores from the central bank's OWN published projection and from
 * nothing else, so the only ways it can be wrong are reading a projection that
 * is not there and failing to read one that is. Both are covered below; the
 * second is a bug that shipped.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveNextRateDecision,
  resolveRateProjection,
  scoreRateExpectation,
} from '@/lib/scoring/rates';
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
    // A POPULATED calendar that simply carries nothing forward-looking for this
    // currency. That is the ordinary case for seven of the eight majors, and 0
    // is the honest reading of it.
    const scored = scoreRateExpectation('GBP', yields, projection('USD', 3.9, 3.9), NOW);
    expect(scored.cell).toBe(0);
    expect(scored.basis).toBe('none');
  });

  /**
   * An empty calendar is not a neutral view. This is the one place in the
   * scoring engine where a provider outage could arrive as a confident number,
   * and 0 is a claim: "no change expected". Null is "we could not look".
   */
  it('returns null, not 0, when there is no calendar at all', () => {
    const scored = scoreRateExpectation('GBP', yields, [], NOW);
    expect(scored.cell).toBeNull();
    expect(scored.basis).toBe('none');
    expect(scored.explanation).toMatch(/unknown rather than neutral/i);
  });

  it('scores 0 with basis "projection" where the bank projects no change', () => {
    const scored = scoreRateExpectation('USD', yields, projection('USD', 3.9, 3.9), NOW);
    expect(scored.cell).toBe(0);
    expect(scored.basis).toBe('projection');
  });
});

// ---------------------------------------------------------------------------
// The scheduled-decision fallback, pinned to the row that justifies it
// ---------------------------------------------------------------------------

/**
 * RECONSTRUCTED 2026-08-30 after this file was reverted to HEAD by mistake,
 * destroying the uncommitted originals. The behaviour asserted is unchanged and
 * every case still passes against untouched production code, but the wording is
 * a rewrite rather than the text that was lost.
 */
describe('the next scheduled decision, where no bank projection exists', () => {
  const yields = new Map();
  const AT = new Date('2026-08-25T00:00:00Z');

  /**
   * One scheduled, not-yet-released central bank decision.
   *
   * `actual: null` is the whole point — it is what separates a meeting that has
   * not happened from a print that has landed, both of which can carry a future
   * date in a feed snapshot.
   */
  function scheduled(
    currency: Currency,
    name: string,
    dateUtc: string,
    consensus: number | null,
    previous: number | null,
  ): NormalizedEvent {
    return {
      id: `sched-${dateUtc}`,
      seriesId: null,
      name,
      currency,
      countryCode: currency === 'NZD' ? 'NZ' : currency === 'CAD' ? 'CA' : 'US',
      dateUtc,
      impact: 'HIGH',
      actual: null,
      consensus,
      previous,
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
    };
  }

  /**
   * THE ROW THIS RULE RESTS ON. A1's 2026-08-25 Top Setups NZDX row —
   * checksummed, bounds-clean and structural-zero-clean — prints Interest Rates
   * +1, the only non-zero non-USD rates leg on that board. The RBNZ publishes no
   * dot plot; its 2026-09-02 decision carried a consensus of 2.75% against a
   * standing 2.50%. If a future change makes this 0 again it has to explain that
   * cell first.
   */
  it("reproduces A1's NZDX rates cell from the next RBNZ decision", () => {
    const events = [scheduled('NZD', 'RBNZ Interest Rate Decision', '2026-09-02T02:00:00Z', 2.75, 2.5)];
    const scored = scoreRateExpectation('NZD', yields, events, AT);

    expect(scored.cell).toBe(1);
    expect(scored.basis).toBe('consensus');
  });

  /** The contrapositive: a hold forecast at the standing rate is not a signal. */
  it('scores a forecast hold as 0, not as a move', () => {
    const events = [scheduled('CAD', 'BoC Interest Rate Decision', '2026-09-02T14:00:00Z', 2.25, 2.25)];
    const scored = scoreRateExpectation('CAD', yields, events, AT);

    expect(scored.cell).toBe(0);
    expect(scored.basis).toBe('consensus');
  });

  it('reads the SOONEST scheduled decision, not whichever the feed lists first', () => {
    const events = [
      scheduled('NZD', 'RBNZ Interest Rate Decision', '2026-11-25T02:00:00Z', 2.0, 2.5),
      scheduled('NZD', 'RBNZ Interest Rate Decision', '2026-09-02T02:00:00Z', 2.75, 2.5),
    ];
    const next = resolveNextRateDecision('NZD', events, AT);

    expect(next?.dateUtc).toBe('2026-09-02T02:00:00Z');
    expect(next?.consensus).toBe(2.75);
    // The far meeting projects cuts and the near one a hike, so the sign proves
    // which was read.
    expect(scoreRateExpectation('NZD', yields, events, AT).cell).toBe(1);
  });

  it('takes the standing rate off the scheduled row own previous', () => {
    const events = [scheduled('NZD', 'RBNZ Interest Rate Decision', '2026-09-02T02:00:00Z', 2.75, 2.5)];
    expect(resolveNextRateDecision('NZD', events, AT)?.standing).toBe(2.5);
  });

  it('ignores a decision that has already happened', () => {
    const events = [scheduled('NZD', 'RBNZ Interest Rate Decision', '2026-08-01T02:00:00Z', 2.75, 2.5)];
    expect(resolveNextRateDecision('NZD', events, AT)).toBeNull();
    expect(scoreRateExpectation('NZD', yields, events, AT).basis).toBe('none');
  });

  /**
   * A future-dated row carrying an actual is a print that already landed in the
   * snapshot, not a meeting still to come. Scoring against it would be reading
   * the answer.
   */
  it('ignores a future-dated row that already carries an actual', () => {
    const leaked = {
      ...scheduled('NZD', 'RBNZ Interest Rate Decision', '2026-09-02T02:00:00Z', 2.75, 2.5),
      actual: 2.75,
    };
    expect(scoreRateExpectation('NZD', yields, [leaked], AT).basis).toBe('none');
  });

  it('ignores a scheduled decision with no forecast — there is nothing to compare', () => {
    const events = [scheduled('NZD', 'RBNZ Interest Rate Decision', '2026-09-02T02:00:00Z', null, 2.5)];
    expect(scoreRateExpectation('NZD', yields, events, AT).basis).toBe('none');
  });

  /**
   * PRECEDENCE. The Fed publishes both a dot plot and a schedule; the dots are
   * the number A1's own page names, and the two answer different questions — a
   * year out versus a fortnight out. A consensus must never displace them.
   */
  it('keeps the dot plot ahead of the calendar consensus for the dollar', () => {
    const events = [
      ...projection('USD', 3.9, 3.4),
      scheduled('USD', 'Fed Interest Rate Decision', '2026-09-16T18:00:00Z', 4.0, 3.75),
    ];
    const scored = scoreRateExpectation('USD', yields, events, AT);

    expect(scored.basis).toBe('projection');
    expect(scored.cell).toBe(-1);
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
