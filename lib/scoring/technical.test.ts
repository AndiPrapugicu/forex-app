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

describe('scoreTrend', () => {
  it('scores price above both short-term averages as +2', () => {
    expect(scoreTrend(makeTech({ price: 1.2, sma20: 1.1, sma50: 1.15 }))!.cell).toBe(2);
  });

  it('scores price below both as -2', () => {
    expect(scoreTrend(makeTech({ price: 1.0, sma20: 1.1, sma50: 1.15 }))!.cell).toBe(-2);
  });

  it('scores a split as 0', () => {
    expect(scoreTrend(makeTech({ price: 1.12, sma20: 1.1, sma50: 1.15 }))!.cell).toBe(0);
  });

  it('IGNORES the 100- and 200-day averages', () => {
    // The gold case: above the short pair, below the long pair. Counting all
    // four gave 0 where the reference product reads +2.
    const gold = makeTech({ price: 4399.7, sma20: 4084.76, sma50: 4169.27, sma100: 4408.08, sma200: 4478.67 });
    expect(scoreTrend(gold)!.cell).toBe(2);
  });

  it('returns null when the short averages are unavailable', () => {
    expect(scoreTrend(makeTech({ sma20: null }))).toBeNull();
    expect(scoreTrend(undefined)).toBeNull();
  });
});

describe('scoreSeasonality', () => {
  const august = new Date('2026-08-08T00:00:00Z');

  const withMonth = (stats: { meanPct: number; winRatePct: number; years: number }) =>
    scoreSeasonality(makeTech({ seasonality: { 8: stats } }), august);

  it('caps at +1 even for a strong, consistent month', () => {
    // Seasonality is the weaker half of the technical pair; a 10-year average
    // must not carry the same weight as the live trend.
    expect(withMonth({ meanPct: 1.2, winRatePct: 70, years: 10 })!.cell).toBe(1);
  });

  it('caps at -1 for a strong, consistently negative month', () => {
    expect(withMonth({ meanPct: -1.2, winRatePct: 30, years: 10 })!.cell).toBe(-1);
  });

  it('scores a flat month as 0', () => {
    expect(withMonth({ meanPct: 0.05, winRatePct: 50, years: 10 })!.cell).toBe(0);
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
