/**
 * Seasonality bucketing.
 *
 * The failure mode this guards against is not a crash — it is a confident
 * average built from returns that never happened. Three ways that occurs, all
 * observed in real Yahoo data or in the arithmetic:
 *
 *   - a duplicated period, which double-counts one month's return;
 *   - a MISSING period, where naive pairing bridges the hole and reports a
 *     two-month move as one month's seasonal tendency;
 *   - week numbering that drifts year to year, so "week 34" is not the same
 *     week of the calendar as it was a decade ago.
 */

import { describe, expect, it } from 'vitest';
import { SEASONALITY_MIN_YEARS } from '@/config/setups.config';
import type { DailyBars } from '@/lib/connectors/technicals';
import {
  buildProfile,
  currentBucket,
  isoWeek,
  isoWeekYear,
  rankByBucket,
} from '@/lib/scoring/seasonality';

/** Bars from [ISO date, close] pairs. OHLC is irrelevant here; closes are not. */
function bars(rows: [string, number][]): DailyBars {
  const timestamps = rows.map(([d]) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000));
  const closes = rows.map(([, c]) => c);
  return { timestamps, opens: closes, highs: closes, lows: closes, closes };
}

/** One bar on the last day of each month, walking a given close path. */
function monthEnds(startYear: number, closes: number[]): DailyBars {
  const rows: [string, number][] = closes.map((close, i) => {
    const year = startYear + Math.floor(i / 12);
    const month = (i % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return [`${year}-${String(month).padStart(2, '0')}-${lastDay}`, close];
  });
  return bars(rows);
}

const NOW = new Date('2026-08-11T00:00:00Z');

describe('isoWeek', () => {
  it('pins week 1 to the week containing the first Thursday', () => {
    // 2026-01-01 is a Thursday, so it is week 1 of 2026.
    expect(isoWeek(new Date('2026-01-01T00:00:00Z'))).toBe(1);
    // 2021-01-01 is a Friday: it belongs to week 53 of 2020, not week 1.
    expect(isoWeek(new Date('2021-01-01T00:00:00Z'))).toBe(53);
    expect(isoWeekYear(new Date('2021-01-01T00:00:00Z'))).toBe(2020);
  });

  it('keeps every week inside 1..53 and never emits a zero', () => {
    // A zero-indexed week would collide with "no bucket" everywhere downstream.
    for (let d = Date.UTC(2019, 0, 1); d <= Date.UTC(2027, 0, 1); d += 86_400_000) {
      const w = isoWeek(new Date(d));
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(53);
    }
  });
});

describe('buildProfile — months', () => {
  it('averages the month-over-month return per calendar month', () => {
    // Two years. Every January +10%, every July -10%, everything else flat.
    const closes: number[] = [];
    let px = 100;
    for (let i = 0; i < 24; i++) {
      const month = (i % 12) + 1;
      if (month === 1) px *= 1.1;
      else if (month === 7) px *= 0.9;
      closes.push(px);
    }

    const p = buildProfile(monthEnds(2025, closes), 'month', 10, NOW);

    expect(p.buckets.get(1)?.meanPct).toBeCloseTo(10, 5);
    expect(p.buckets.get(7)?.meanPct).toBeCloseTo(-10, 5);
    expect(p.buckets.get(3)?.meanPct).toBeCloseTo(0, 5);
    expect(p.buckets.get(1)?.winRatePct).toBe(100);
    expect(p.buckets.get(7)?.winRatePct).toBe(0);
  });

  it('deduplicates two bars stamped in the same month', () => {
    /**
     * Yahoo returned March twice for EURUSD=X. Counting both would give March
     * a return of zero from a bar against itself, halving its real average.
     */
    const b = bars([
      ['2026-01-30', 100],
      ['2026-02-27', 110],
      ['2026-03-13', 120],
      ['2026-03-31', 132], // same month again — this one is the close
      ['2026-04-30', 132],
    ]);

    const p = buildProfile(b, 'month', 10, NOW);

    expect(p.buckets.get(3)?.samples).toBe(1);
    // 132 from February's 110, not 120 from 110 and then 132 from 120.
    expect(p.buckets.get(3)?.meanPct).toBeCloseTo(20, 5);
  });

  it('skips a gap rather than bridging it into a two-month return', () => {
    // October is missing, exactly as Yahoo omitted it.
    const b = bars([
      ['2026-08-31', 100],
      ['2026-09-30', 110],
      // no October
      ['2026-11-30', 121],
      ['2026-12-31', 121],
    ]);

    const p = buildProfile(b, 'month', 10, NOW);

    expect(p.buckets.has(10)).toBe(false);
    // November must NOT be credited with September->November's +10%.
    expect(p.buckets.has(11)).toBe(false);
    expect(p.buckets.get(9)?.meanPct).toBeCloseTo(10, 5);
  });

  it('reports median and extremes alongside the mean', () => {
    /**
     * A mean alone hides an outlier carrying the whole tendency. Three Januaries
     * of 0%, 0% and +30% average +10% — the median says otherwise.
     */
    const b = bars([
      ['2024-12-31', 100],
      ['2025-01-31', 100],
      ['2025-12-31', 100],
      ['2026-01-30', 100],
      ['2026-12-31', 100],
      ['2027-01-29', 130],
    ]);

    const p = buildProfile(b, 'month', 10, new Date('2027-06-01T00:00:00Z'));
    const jan = p.buckets.get(1);

    expect(jan?.samples).toBe(3);
    expect(jan?.meanPct).toBeCloseTo(10, 5);
    expect(jan?.medianPct).toBeCloseTo(0, 5);
    expect(jan?.bestPct).toBeCloseTo(30, 5);
    expect(jan?.worstPct).toBeCloseTo(0, 5);
  });
});

describe('buildProfile — lookback window', () => {
  it('counts only observations inside the window', () => {
    // 12 years of month-ends, every February +5%.
    const closes: number[] = [];
    let px = 100;
    for (let i = 0; i < 12 * 12; i++) {
      px *= (i % 12) + 1 === 2 ? 1.05 : 1;
      closes.push(px);
    }
    const b = monthEnds(2015, closes);

    const ten = buildProfile(b, 'month', 10, NOW);
    const one = buildProfile(b, 'month', 1, NOW);

    expect(ten.buckets.get(2)!.samples).toBeGreaterThan(one.buckets.get(2)!.samples);
    expect(one.buckets.get(2)!.samples).toBe(1);
    // The tendency itself is identical; only the confidence in it differs.
    expect(one.buckets.get(2)!.meanPct).toBeCloseTo(ten.buckets.get(2)!.meanPct, 5);
  });

  it('reports the real sample for a short-history symbol rather than borrowing one', () => {
    /**
     * BTC has ~11 years of daily bars. A 10-year window on a 3-year series must
     * say "3", not quietly present three observations as a decade of evidence.
     */
    const closes = Array.from({ length: 36 }, (_, i) => 100 * 1.01 ** i);
    const p = buildProfile(monthEnds(2024, closes), 'month', 10, new Date('2027-06-01T00:00:00Z'));

    expect(p.yearsCovered).toBeLessThanOrEqual(3);
    for (const bucket of p.buckets.values()) expect(bucket.samples).toBeLessThanOrEqual(3);
  });

  it('marks a bucket unreliable below the sample floor but still returns it', () => {
    const closes = Array.from({ length: 24 }, (_, i) => 100 + i);
    const p = buildProfile(monthEnds(2025, closes), 'month', 10, NOW);

    const bucket = p.buckets.get(5)!;
    expect(bucket.samples).toBeLessThan(SEASONALITY_MIN_YEARS);
    // Present, so the UI can grey it. Dropping it would claim no history at all.
    expect(bucket.reliable).toBe(false);
  });
});

describe('buildProfile — weeks and weekdays', () => {
  it('buckets weekly returns by ISO week, not by day-of-year arithmetic', () => {
    const rows: [string, number][] = [];
    let px = 100;
    // Every Friday for two years.
    for (let d = Date.UTC(2025, 0, 3); d <= Date.UTC(2026, 11, 25); d += 7 * 86_400_000) {
      px *= 1.001;
      rows.push([new Date(d).toISOString().slice(0, 10), px]);
    }

    const p = buildProfile(bars(rows), 'week', 10, new Date('2027-01-05T00:00:00Z'));

    // Every bucket is a real ISO week and none exceeds the calendar's maximum.
    for (const key of p.buckets.keys()) {
      expect(key).toBeGreaterThanOrEqual(1);
      expect(key).toBeLessThanOrEqual(53);
    }
    expect(p.buckets.size).toBeGreaterThan(45);
  });

  it('keeps the return that straddles a year boundary', () => {
    /**
     * REGRESSION. The first implementation ordered weeks as
     * `isoWeekYear * 53 + week`, which makes adjacent weeks differ by 1 only in
     * a 53-week year. 2025 has 52, so the step from its week 52 to week 1 of
     * 2026 was 2 and the return was thrown away as a gap — losing one
     * observation per symbol per year, always the same one, always at the
     * turn of the year when seasonality claims are loudest.
     */
    const b = bars([
      ['2025-12-19', 100],
      ['2025-12-26', 100], // week 52 of 2025
      ['2026-01-02', 105], // week 1 of 2026
    ]);

    const p = buildProfile(b, 'week', 10, new Date('2026-06-01T00:00:00Z'));

    expect(p.buckets.get(1)?.samples).toBe(1);
    expect(p.buckets.get(1)?.meanPct).toBeCloseTo(5, 5);
  });

  it('still drops a genuinely missing week', () => {
    const b = bars([
      ['2026-03-06', 100],
      // 2026-03-13 missing entirely
      ['2026-03-20', 121],
    ]);

    const p = buildProfile(b, 'week', 10, NOW);

    // Two weeks of move must not be filed as one week's tendency.
    expect(p.buckets.size).toBe(0);
  });

  it('never produces a weekend weekday bucket', () => {
    const rows: [string, number][] = [];
    let px = 100;
    for (let d = Date.UTC(2026, 0, 1); d <= Date.UTC(2026, 5, 30); d += 86_400_000) {
      px *= 1.001;
      rows.push([new Date(d).toISOString().slice(0, 10), px]);
    }

    const p = buildProfile(bars(rows), 'weekday', 10, NOW);

    expect(p.buckets.has(0)).toBe(false); // Sunday
    expect(p.buckets.has(6)).toBe(false); // Saturday
    expect([...p.buckets.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('lets Monday follow Friday, since a weekday gap is not a data hole', () => {
    /**
     * The consecutiveness guard is right for months and weeks and wrong for
     * weekdays: a three-day order gap between Friday and Monday is the market
     * being closed, not Yahoo losing a bar. Dropping those would delete every
     * Monday observation there is.
     */
    const b = bars([
      ['2026-08-07', 100], // Friday
      ['2026-08-10', 110], // Monday
    ]);

    const p = buildProfile(b, 'weekday', 10, NOW);

    expect(p.buckets.get(1)?.samples).toBe(1);
    expect(p.buckets.get(1)?.meanPct).toBeCloseTo(10, 5);
  });
});

describe('rankByBucket', () => {
  const profileFor = (janPct: number) => {
    const closes: number[] = [];
    let px = 100;
    for (let i = 0; i < 24; i++) {
      px *= (i % 12) + 1 === 1 ? 1 + janPct / 100 : 1;
      closes.push(px);
    }
    return buildProfile(monthEnds(2025, closes), 'month', 10, NOW);
  };

  it('sorts strongest tendency first', () => {
    const rows = rankByBucket(
      [
        { symbol: 'MID', label: 'Mid', profile: profileFor(1) },
        { symbol: 'HIGH', label: 'High', profile: profileFor(5) },
        { symbol: 'LOW', label: 'Low', profile: profileFor(-3) },
      ],
      1,
    );

    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'MID', 'LOW']);
  });

  it('keeps a symbol with no history, at the bottom', () => {
    const rows = rankByBucket(
      [
        { symbol: 'NONE', label: 'None', profile: null },
        { symbol: 'HIGH', label: 'High', profile: profileFor(5) },
      ],
      1,
    );

    // Present but last: "no history here" is information, a missing row is not.
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'NONE']);
    expect(rows[1].bucket).toBeNull();
  });
});

describe('currentBucket', () => {
  it('names the bucket "now" falls in for each granularity', () => {
    expect(currentBucket('month', NOW)).toBe(8);
    expect(currentBucket('week', NOW)).toBe(isoWeek(NOW));
    expect(currentBucket('weekday', NOW)).toBe(2); // 2026-08-11 is a Tuesday
  });
});
