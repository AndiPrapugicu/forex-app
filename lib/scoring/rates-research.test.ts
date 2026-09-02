/**
 * Locks in the two things `scoreHistorical2YRate` must never drift on: the
 * window arithmetic (which 21 observations, relative to which date) and the
 * sign (falling yield -> -1, rising -> +1 — see the file header for why that
 * is the DXY-asset sign and not the raw risk-asset one `scoreYield2y` returns).
 */

import { describe, expect, it } from 'vitest';
import { scoreHistorical2YRate, type HistoricalYieldSeries } from '@/lib/scoring/rates-research';

function series(values: number[], startDate = '2026-06-01'): HistoricalYieldSeries {
  const start = new Date(`${startDate}T00:00:00Z`);
  const observations = values.map((value, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), value };
  });
  return {
    currency: 'USD',
    source: 'test',
    seriesId: 'test',
    url: 'test://',
    fetchedAtUtc: '2026-08-25T00:00:00Z',
    observations,
  };
}

describe('scoreHistorical2YRate', () => {
  it('returns null with fewer than 21 prior observations (excl-current)', () => {
    const s = series(Array(20).fill(4).concat([4.5])); // 21 points, only 20 prior
    expect(scoreHistorical2YRate(s, s.observations.at(-1)!.date, 'excl-current')).toBeNull();
  });

  it('scores a rising yield +1 once 21 prior observations exist', () => {
    const s = series(Array(21).fill(4).concat([4.5])); // 22 points: 21 prior + current
    const result = scoreHistorical2YRate(s, s.observations.at(-1)!.date, 'excl-current');
    expect(result).not.toBeNull();
    expect(result!.sma).toBeCloseTo(4, 3);
    expect(result!.currentYield).toBe(4.5);
    expect(result!.candidateLeg).toBe(1); // rising -> +1, the DXY-asset sign
  });

  it('scores a falling yield -1', () => {
    const s = series(Array(21).fill(4).concat([3.5]));
    const result = scoreHistorical2YRate(s, s.observations.at(-1)!.date, 'excl-current');
    expect(result!.candidateLeg).toBe(-1);
  });

  it('scores within the flat band as 0', () => {
    const s = series(Array(21).fill(4).concat([4.01])); // 0.25% relative move, band is 0.5%
    const result = scoreHistorical2YRate(s, s.observations.at(-1)!.date, 'excl-current');
    expect(result!.flat).toBe(true);
    expect(result!.candidateLeg).toBe(0);
  });

  it('excl-current and incl-current can disagree on the window mean', () => {
    // 21 observations at 4.0, then a jump to 5.0 as the 22nd (current) point.
    const s = series(Array(21).fill(4).concat([5.0]));
    const excl = scoreHistorical2YRate(s, s.observations.at(-1)!.date, 'excl-current');
    const incl = scoreHistorical2YRate(s, s.observations.at(-1)!.date, 'incl-current');
    // excl-current: window is the 21 prior 4.0s -> sma 4.0, current 5.0 -> rising.
    expect(excl!.sma).toBeCloseTo(4, 3);
    // incl-current: window is the last 21 observations, which INCLUDES the 5.0
    // and drops the oldest 4.0 -> sma pulled up toward 4.048.
    expect(incl!.sma).toBeGreaterThan(excl!.sma);
    expect(incl!.windowObservationCount).toBe(21);
  });

  it('selects the most recent observation at or before asOfDate, not exactly on it', () => {
    const s = series(Array(22).fill(4)); // flat series, dates are consecutive days
    const lastDate = s.observations.at(-1)!.date;
    const farFuture = '2027-01-01';
    const result = scoreHistorical2YRate(s, farFuture, 'excl-current');
    expect(result!.currentDate).toBe(lastDate);
    expect(result!.staleDays).toBeGreaterThan(100);
  });

  it('returns null with no observations at or before asOfDate', () => {
    const s = series(Array(25).fill(4), '2026-08-01');
    expect(scoreHistorical2YRate(s, '2026-01-01', 'excl-current')).toBeNull();
  });
});
