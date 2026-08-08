/**
 * COT scoring.
 *
 * The central distinction these tests protect — and one I got wrong when
 * planning — is between two numbers that both look like "how long is this
 * market":
 *
 *   specLongPct  share of speculator positions that are long. Gold sat at 88.5%
 *                on 2026-08-04, which looks overwhelmingly bullish.
 *   percentile   where the NET position sits within the contract's own 3-year
 *                range. The same gold report was only the 39th percentile,
 *                because gold's 3-year median net long is 203,916 — HIGHER than
 *                that week's 197,634.
 *
 * The COT index uses the percentile, deliberately. Absolute size is not
 * comparable across contracts: gold routinely runs hundreds of thousands of
 * contracts while the Swiss franc trades in tens of thousands.
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

  it('scores a position at the top of its own range as +2', () => {
    // Newest first, so the largest net is the current one.
    const series = makeSeries([...rising].reverse());
    expect(scoreCot(series)!.cell).toBe(2);
  });

  it('scores a position at the bottom of its own range as -2', () => {
    const series = makeSeries(rising);
    expect(scoreCot(series)!.cell).toBe(-2);
  });

  it('scores a mid-range position as 0', () => {
    const nets = [30_000, ...rising];
    const series = makeSeries(nets);
    const score = scoreCot(series)!;
    expect(score.percentile).toBeGreaterThan(40);
    expect(score.percentile).toBeLessThan(60);
    expect(score.cell).toBe(0);
  });

  it('ranks by percentile, NOT by absolute size or long share', () => {
    // The real gold case: a large net long that is nonetheless below its own
    // 3-year median must score bearish, not bullish.
    const history = Array.from({ length: 60 }, (_, i) => 150_000 + i * 2000); // median ~209k
    const series = makeSeries([197_634, ...history], { specLongPct: 88.5 });
    const score = scoreCot(series)!;

    expect(score.net).toBe(197_634);
    expect(score.specLongPct).toBe(88.5); // looks overwhelmingly long
    expect(score.percentile).toBeLessThan(50); // but is not, relative to itself
    expect(score.cell).toBeLessThanOrEqual(0);
  });

  it('refuses to score without enough history to rank against', () => {
    // A percentile off 8 points is arithmetic, not information.
    expect(scoreCot(makeSeries([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });

  it('returns null for a missing or empty series', () => {
    expect(scoreCot(undefined)).toBeNull();
    expect(scoreCot({ contract: 'X', reports: [] })).toBeNull();
  });

  it('always explains itself', () => {
    const score = scoreCot(makeSeries(rising))!;
    expect(score.explanation).toMatch(/speculators are net (long|short)/i);
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

  it('INVERTS the crowd — a heavily long crowd is bearish', () => {
    expect(crowd(80)!.cell).toBe(-2);
    expect(crowd(65)!.cell).toBe(-1);
  });

  it('INVERTS the crowd — a heavily short crowd is bullish', () => {
    expect(crowd(20)!.cell).toBe(2);
    expect(crowd(35)!.cell).toBe(1);
  });

  it('scores a balanced crowd as 0', () => {
    expect(crowd(50)!.cell).toBe(0);
  });

  it('respects the exact bucket boundaries', () => {
    // 59.8% was the real EUR reading — just inside neutral, not bearish.
    expect(crowd(59.8)!.cell).toBe(0);
    expect(crowd(60)!.cell).toBe(-1);
    expect(crowd(40)!.cell).toBe(1);
    expect(crowd(40.2)!.cell).toBe(0);
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
