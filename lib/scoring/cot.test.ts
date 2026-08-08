/**
 * COT scoring.
 *
 * These tests protect the distinction between two numbers that both look like
 * "how long is this market":
 *
 *   specLongPct  share of speculator positions that are long. Gold sat at 85.4%
 *                on 2026-08-04, which looks overwhelmingly bullish.
 *   percentile   where the NET position sits within the contract's own 3-year
 *                range. The same gold report was only the 39th percentile,
 *                because gold's 3-year median net long is HIGHER than that
 *                week's 197,634.
 *
 * The SCORE now comes from the long share, matching the reference product. The
 * percentile is still computed and displayed, because it is the more revealing
 * measure — it is what shows a huge-looking net long to be below its own median.
 * Both matter; only one votes.
 */

import { describe, expect, it } from 'vitest';
import { combineLegs, percentileRank, scoreCot, scoreCrowd } from '@/lib/scoring/cot';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';

function makeReport(overrides: Partial<CotReport> = {}): CotReport {
  return {
    contract: 'TEST',
    reportDate: '2026-08-04',
    specLong: 100_000,
    specShort: 50_000,
    specNet: 50_000,
    specLongPct: 66.7,
    commLong: 0,
    commShort: 0,
    commNet: 0,
    retailLong: 10_000,
    retailShort: 10_000,
    retailNet: 0,
    retailLongPct: 50,
    openInterest: 200_000,
    openInterestChange: 0,
    specNetChange: 0,
    ...overrides,
  };
}

/** Builds a series whose net positions ramp linearly, newest first. */
function makeSeries(nets: number[], latest: Partial<CotReport> = {}): CotSeries {
  return {
    contract: 'TEST',
    reports: nets.map((net, i) =>
      makeReport({
        specNet: net,
        reportDate: `2026-08-${String(4 - (i % 4)).padStart(2, '0')}`,
        ...(i === 0 ? latest : {}),
      }),
    ),
  };
}

describe('percentileRank', () => {
  it('places the maximum at the top and the minimum at the bottom', () => {
    const h = [1, 2, 3, 4, 5];
    expect(percentileRank(5, h)).toBe(90); // 4 below + half of 1 equal
    expect(percentileRank(1, h)).toBe(10);
  });

  it('places the median at 50', () => {
    expect(percentileRank(3, [1, 2, 3, 4, 5])).toBe(50);
  });

  it('handles ties with the midpoint convention', () => {
    // Quiet weeks repeat the same net position; ties must not bias the rank.
    expect(percentileRank(2, [1, 2, 2, 2, 3])).toBe(50);
  });

  it('returns a neutral 50 for an empty history rather than dividing by zero', () => {
    expect(percentileRank(100, [])).toBe(50);
  });
});

describe('scoreCot', () => {
  const rising = Array.from({ length: 60 }, (_, i) => i * 1000);

  it('scores from the LONG SHARE, not the percentile', () => {
    // The gold case that drove this change: a big net long sitting BELOW its own
    // 3-year median. Percentile ranking called it bearish; the long share, which
    // is what the reference product uses, calls it bullish.
    const history = Array.from({ length: 60 }, (_, i) => 210_000 + i * 1000);
    const series = makeSeries([197_634, ...history], { specLongPct: 85.4, specNetChange: 15_564 });
    const score = scoreCot(series)!;

    expect(score.percentile).toBeLessThan(50); // still true, still reported
    expect(score.netPositioning).toBe(1); // 85.4% long
    expect(score.latestBuysSells).toBe(1); // adding
    expect(score.cell).toBe(2);
  });

  it('splits the cell into the two sub-scores the reference product shows', () => {
    const flat = makeSeries([100, 200, 300], { specLongPct: 50, specNetChange: 0 });
    const score = scoreCot(flat)!;
    expect(score.netPositioning).toBe(0);
    expect(score.latestBuysSells).toBe(0);
    expect(score.cell).toBe(0);
  });

  it('scores a heavily short book as -2', () => {
    const series = makeSeries([100, 200, 300], { specLongPct: 12, specNetChange: -5000 });
    expect(scoreCot(series)!.cell).toBe(-2);
  });

  it('still reports the percentile as context', () => {
    const series = makeSeries([...rising].reverse(), { specLongPct: 80 });
    const score = scoreCot(series)!;
    expect(score.percentile).toBeGreaterThan(80);
    expect(score.explanation).toMatch(/percentile/);
  });

  it('returns null for a missing or empty series', () => {
    expect(scoreCot(undefined)).toBeNull();
    expect(scoreCot({ contract: 'X', reports: [] })).toBeNull();
  });

  it('always explains itself, citing both the long share and the percentile', () => {
    const score = scoreCot(makeSeries(rising, { specLongPct: 72 }))!;
    expect(score.explanation).toMatch(/speculators are 72.0% long/i);
    expect(score.explanation).toMatch(/net (long|short)/i);
    expect(score.explanation).toMatch(/percentile/i);
  });
});

describe('scoreCrowd', () => {
  const crowd = (retailLongPct: number, extra: Partial<CotReport> = {}) => {
    const total = 100_000;
    const long = Math.round((retailLongPct / 100) * total);
    return scoreCrowd({
      contract: 'TEST',
      reports: [
        makeReport({
          retailLong: long,
          retailShort: total - long,
          retailNet: long - (total - long),
          retailLongPct,
          ...extra,
        }),
      ],
    });
  };

  it('INVERTS the crowd — a long crowd is bearish', () => {
    expect(crowd(80)!.cell).toBe(-1);
    expect(crowd(65)!.cell).toBe(-1);
  });

  it('INVERTS the crowd — a short crowd is bullish', () => {
    expect(crowd(20)!.cell).toBe(1);
    expect(crowd(35)!.cell).toBe(1);
  });

  it('scores a balanced crowd as 0', () => {
    expect(crowd(50)!.cell).toBe(0);
  });

  it('respects the exact bucket boundaries', () => {
    expect(crowd(55)!.cell).toBe(-1);
    expect(crowd(54.9)!.cell).toBe(0);
    expect(crowd(45)!.cell).toBe(1);
    expect(crowd(45.1)!.cell).toBe(0);
  });

  it('flags divergence when retail and large specs sit on opposite sides', () => {
    const opposed = crowd(70, { specNet: -50_000 })!; // retail long, specs short
    expect(opposed.divergence).toBe(true);

    const aligned = crowd(70, { specNet: 50_000 })!;
    expect(aligned.divergence).toBe(false);
  });

  it('refuses to score contracts with negligible retail participation', () => {
    const thin = scoreCrowd({
      contract: 'TEST',
      reports: [makeReport({ retailLong: 100, retailShort: 100, retailLongPct: 50 })],
    });
    expect(thin).toBeNull();
  });
});

describe('combineLegs', () => {
  it('subtracts the quote leg from the base leg', () => {
    expect(combineLegs(2, -1)).toBe(2); // clamped from 3
    expect(combineLegs(1, 1)).toBe(0);
    expect(combineLegs(-1, 1)).toBe(-2);
  });

  it('clamps back into the cell range', () => {
    expect(combineLegs(2, -2)).toBe(2);
    expect(combineLegs(-2, 2)).toBe(-2);
  });

  it('treats a missing leg as neutral rather than discarding the pair', () => {
    expect(combineLegs(2, null)).toBe(2);
    expect(combineLegs(null, 2)).toBe(-2);
  });

  it('returns null only when both legs are missing', () => {
    expect(combineLegs(null, null)).toBeNull();
  });
});
