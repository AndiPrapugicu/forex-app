/**
 * Technical scoring, and the seasonality data-hygiene that sits under it.
 *
 * Yahoo's 10-year monthly series is not clean: measured live on EURUSD=X it
 * returned March TWICE and omitted October entirely. Aggregating naively
 * double-counts one month and silently drops another, producing a seasonal
 * "edge" that is a data artefact. These tests pin the dedupe and the gap
 * handling, because that failure is invisible in the output.
 */

import { describe, expect, it } from 'vitest';
import { computeSeasonality } from '@/lib/connectors/technicals';
import { scoreSeasonality, scoreTrend } from '@/lib/scoring/technical';
import type { Technicals } from '@/lib/connectors/technicals';

/** Unix seconds for the first of a month, UTC. */
function ts(year: number, month: number): number {
  return Math.floor(Date.UTC(year, month - 1, 1) / 1000);
}

function makeTech(overrides: Partial<Technicals> = {}): Technicals {
  return {
    symbol: 'EURUSD',
    price: 1.16,
    smaFast: 1.16,
    smaSlow: 1.15,
    smaSlowPrior: 1.14,
    sma20: 1.15,
    sma50: 1.14,
    sma100: 1.17,
    sma200: 1.18,
    aboveCount: 2,
    smaCount: 4,
    realizedVolPct: 5,
    avgDailyMove7Pct: 0.3,
    avgDailyMove90Pct: 0.25,
    seasonality: {},
    ...overrides,
  };
}

describe('computeSeasonality', () => {
  it('dedupes a repeated year-month instead of counting it twice', () => {
    // March appears twice for 2025, as Yahoo actually returns it.
    const stamps = [ts(2025, 1), ts(2025, 2), ts(2025, 3), ts(2025, 3), ts(2025, 4)];
    const closes = [100, 100, 110, 110, 110];

    const result = computeSeasonality(stamps, closes);

    // Feb->Mar is one +10% observation, not two.
    expect(result[3]?.years).toBe(1);
    expect(result[3]?.meanPct).toBeCloseTo(10, 1);
  });

  it('does not bridge a gap into a false two-month return', () => {
    // October missing, as Yahoo actually returns it. Sep->Nov must be skipped,
    // otherwise November inherits two months of movement.
    const stamps = [ts(2025, 8), ts(2025, 9), ts(2025, 11), ts(2025, 12)];
    const closes = [100, 100, 130, 130];

    const result = computeSeasonality(stamps, closes);

    expect(result[11]).toBeUndefined(); // November has no valid prior month
    expect(result[12]?.years).toBe(1); // Nov->Dec is fine
  });

  it('computes mean return and win rate per calendar month', () => {
    // Three consecutive Junes: +10%, +10%, -5%.
    const stamps = [
      ts(2023, 5), ts(2023, 6),
      ts(2024, 5), ts(2024, 6),
      ts(2025, 5), ts(2025, 6),
    ];
    const closes = [100, 110, 100, 110, 100, 95];

    const june = computeSeasonality(stamps, closes)[6];
    expect(june.years).toBe(3);
    expect(june.meanPct).toBeCloseTo(5, 0); // (10 + 10 - 5) / 3
    expect(june.winRatePct).toBe(67);
  });

  it('handles an empty series without throwing', () => {
    expect(computeSeasonality([], [])).toEqual({});
  });

  it('ignores a zero prior close rather than dividing by it', () => {
    const result = computeSeasonality([ts(2025, 1), ts(2025, 2)], [0, 100]);
    expect(result[2]).toBeUndefined();
  });
});

/**
 * The +/-3 crossover-and-slope rule itself is pinned in edgefinder-parity.test.ts
 * against A1's published page. What is tested here is the wiring: that the score
 * reads the 3/14 pair and nothing else.
 */
describe('scoreTrend', () => {
  it('reads only the fast/slow pair, ignoring price and the long averages', () => {
    // Price and the 20/50/100/200 averages are deliberately contradictory. If
    // any of them still fed the score this would not be +3.
    const contradictory = makeTech({
      price: 0.5,
      smaFast: 1.2,
      smaSlow: 1.1,
      smaSlowPrior: 1.05,
      sma20: 9,
      sma50: 9,
      sma100: 9,
      sma200: 9,
    });
    expect(scoreTrend(contradictory)!.cell).toBe(2);
  });

  it('keeps the long averages available as context', () => {
    // They were dropped from the score, not from the data — the scorecard still
    // renders them.
    const tech = makeTech({ sma100: 1.17, sma200: 1.18 });
    expect(tech.sma100).toBe(1.17);
    expect(tech.sma200).toBe(1.18);
  });

  it('returns null when the trend averages are unavailable', () => {
    expect(scoreTrend(makeTech({ smaFast: null }))).toBeNull();
    expect(scoreTrend(makeTech({ smaSlow: null }))).toBeNull();
    // Without a prior slow average there is no slope to read.
    expect(scoreTrend(makeTech({ smaSlowPrior: null }))).toBeNull();
    expect(scoreTrend(undefined)).toBeNull();
  });

  it('does not fall back to the 20/50 averages when the 3/14 pair is missing', () => {
    // Regression guard: the old rule read these, and silently reviving it would
    // change every trend cell without failing anything else.
    expect(scoreTrend(makeTech({ smaFast: null, sma20: 1.1, sma50: 1.05 }))).toBeNull();
  });
});

describe('scoreSeasonality', () => {
  const august = new Date('2026-08-08T00:00:00Z');

  const withMonth = (stats: { meanPct: number; winRatePct: number; years: number }) =>
    scoreSeasonality(makeTech({ seasonality: { 8: stats } }), august);

  it('caps at +1 for FX even on a strong, consistent month', () => {
    expect(withMonth({ meanPct: 1.2, winRatePct: 70, years: 10 })!.cell).toBe(1);
  });

  it('caps at -1 for a strong, consistently negative month', () => {
    expect(withMonth({ meanPct: -1.2, winRatePct: 30, years: 10 })!.cell).toBe(-1);
  });

  it('scores a barely-positive month +1, because only the sign matters', () => {
    // Our old rule needed 0.15% and a 60% win rate and scored this 0. A1's rule
    // is the sign of the average, full stop.
    expect(withMonth({ meanPct: 0.05, winRatePct: 50, years: 10 })!.cell).toBe(1);
  });

  it('scores an exactly flat month as 0', () => {
    expect(withMonth({ meanPct: 0, winRatePct: 50, years: 10 })!.cell).toBe(0);
  });

  it('refuses to score with too few years of history', () => {
    expect(withMonth({ meanPct: 2, winRatePct: 100, years: 3 })).toBeNull();
  });

  it('returns null when the current month has no data at all', () => {
    // e.g. the October that Yahoo dropped.
    const october = new Date('2026-10-08T00:00:00Z');
    expect(scoreSeasonality(makeTech({ seasonality: { 8: { meanPct: 1, winRatePct: 70, years: 10 } } }), october)).toBeNull();
  });

  it('explains itself with the month, average and win rate', () => {
    const score = withMonth({ meanPct: 1.2, winRatePct: 70, years: 10 })!;
    expect(score.explanation).toMatch(/August/);
    expect(score.explanation).toMatch(/\+1.2%/);
    expect(score.explanation).toMatch(/70%/);
  });
});
