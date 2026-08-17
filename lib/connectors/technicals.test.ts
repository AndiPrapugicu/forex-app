/**
 * Bar shaping.
 *
 * These two functions sit between the network and every level the Chart page
 * draws, so their failure mode is not a crash — it is a chart that looks right
 * and is wrong by one bar. The tests below pin the two ways that happens:
 * misaligned arrays after a null, and phantom buckets across a gap.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache } from '@/lib/connectors/base';
import {
  FOUR_HOURS,
  ONE_WEEK,
  WEEK_ANCHOR_OFFSET,
  fetchTechnicals,
  resampleBars,
  smaSeries,
  type DailyBars,
} from '@/lib/connectors/technicals';

const H = 3600;
/** 2026-01-01T00:00:00Z, which is exactly on a 4h boundary. */
const T0 = Math.floor(Date.UTC(2026, 0, 1) / 1000);

function hourly(
  start: number,
  rows: [open: number, high: number, low: number, close: number][],
): DailyBars {
  return {
    timestamps: rows.map((_, i) => start + i * H),
    opens: rows.map((r) => r[0]),
    highs: rows.map((r) => r[1]),
    lows: rows.map((r) => r[2]),
    closes: rows.map((r) => r[3]),
  };
}

describe('resampleBars', () => {
  it('aggregates four hourly bars into one 4h bar', () => {
    const bars = hourly(T0, [
      [10, 12, 9, 11],
      [11, 15, 10, 14],
      [14, 14, 6, 8],
      [8, 9, 7, 9],
    ]);

    const out = resampleBars(bars, FOUR_HOURS);

    expect(out.timestamps).toEqual([T0]);
    expect(out.opens).toEqual([10]); // first open
    expect(out.highs).toEqual([15]); // highest high
    expect(out.lows).toEqual([6]); //  lowest low
    expect(out.closes).toEqual([9]); // last close
  });

  it('anchors buckets to the epoch, not to the first bar', () => {
    /**
     * The series starts at 02:00, mid-bucket. Those two bars belong to the
     * 00:00 bucket, and the 04:00 bar opens a new one. Anchoring to the first
     * bar instead would put the boundary at 06:00 and shift every level in the
     * chart whenever the series gained or lost a leading bar.
     */
    const bars = hourly(T0 + 2 * H, [
      [1, 1, 1, 1], // 02:00
      [2, 2, 2, 2], // 03:00
      [3, 3, 3, 3], // 04:00  <- new bucket
    ]);

    const out = resampleBars(bars, FOUR_HOURS);

    expect(out.timestamps).toEqual([T0, T0 + FOUR_HOURS]);
    expect(out.opens).toEqual([1, 3]);
  });

  it('produces NO bucket across a gap rather than a flat phantom bar', () => {
    /**
     * Weekends leave holes in the hourly series. Emitting an empty bucket would
     * create a flat bar that swing detection reads as a pivot — an invented
     * level, which is the one thing this module must never produce.
     */
    const bars: DailyBars = {
      timestamps: [T0, T0 + 3 * FOUR_HOURS],
      opens: [1, 5],
      highs: [1, 5],
      lows: [1, 5],
      closes: [1, 5],
    };

    const out = resampleBars(bars, FOUR_HOURS);

    expect(out.timestamps).toEqual([T0, T0 + 3 * FOUR_HOURS]);
    expect(out.closes).toHaveLength(2);
  });

  it('keeps a partial trailing bucket, because that is the live candle', () => {
    const bars = hourly(T0, [
      [1, 4, 1, 3],
      [3, 5, 2, 4],
    ]);

    const out = resampleBars(bars, FOUR_HOURS);

    expect(out.timestamps).toEqual([T0]);
    expect(out.highs).toEqual([5]);
    expect(out.closes).toEqual([4]);
  });

  it('returns an empty series for an empty input rather than throwing', () => {
    const out = resampleBars(
      { timestamps: [], opens: [], highs: [], lows: [], closes: [] },
      FOUR_HOURS,
    );
    expect(out.timestamps).toEqual([]);
  });

  it('keeps all five arrays the same length', () => {
    const bars = hourly(
      T0,
      Array.from({ length: 37 }, (_, i) => [i, i + 2, i - 1, i + 1] as [number, number, number, number]),
    );

    const out = resampleBars(bars, FOUR_HOURS);
    const n = out.timestamps.length;

    expect(out.opens).toHaveLength(n);
    expect(out.highs).toHaveLength(n);
    expect(out.lows).toHaveLength(n);
    expect(out.closes).toHaveLength(n);
  });

  /**
   * Volume is the one leg that aggregates by SUM rather than by first/max/min/
   * last, so it is the one leg a copy-paste of the price handling gets wrong —
   * silently, and in a way that still renders a plausible histogram.
   */
  it('sums volume across a bucket instead of taking one bar of it', () => {
    const bars = hourly(T0, [
      [10, 12, 9, 11],
      [11, 15, 10, 14],
      [14, 14, 6, 8],
      [8, 9, 7, 9],
    ]);
    bars.volumes = [100, 250, 50, 400];

    const out = resampleBars(bars, FOUR_HOURS);

    expect(out.volumes).toEqual([800]);
  });

  it('carries no volume column when the input had none', () => {
    const bars = hourly(T0, [
      [10, 12, 9, 11],
      [11, 15, 10, 14],
    ]);

    // Absent, not an array of zeroes — spot FX reports no volume, and a zero
    // histogram claims nobody traded.
    expect(resampleBars(bars, FOUR_HOURS).volumes).toBeUndefined();
  });

  /**
   * The epoch is a Thursday. Without the anchor offset every weekly candle runs
   * Thursday to Wednesday, which no market reads and no other chart agrees with
   * — and it is invisible unless something asserts the day of the week.
   */
  it('anchors weekly buckets to Monday, not to the Thursday epoch', () => {
    // 2026-01-01 is a Thursday; the Monday of that week is 2025-12-29.
    const bars = hourly(
      T0,
      Array.from({ length: 24 }, () => [1, 2, 0, 1] as [number, number, number, number]),
    );

    const unanchored = resampleBars(bars, ONE_WEEK);
    const anchored = resampleBars(bars, ONE_WEEK, WEEK_ANCHOR_OFFSET);

    expect(new Date(unanchored.timestamps[0] * 1000).getUTCDay()).toBe(4); // Thursday
    expect(new Date(anchored.timestamps[0] * 1000).getUTCDay()).toBe(1); // Monday
    expect(new Date(anchored.timestamps[0] * 1000).toISOString().slice(0, 10)).toBe('2025-12-29');
  });

  it('splits bars either side of a Monday boundary into separate weeks', () => {
    // Sunday 2026-01-04 23:00Z and Monday 2026-01-05 01:00Z: adjacent hours,
    // different weeks.
    const sunday = Math.floor(Date.UTC(2026, 0, 4, 23) / 1000);
    const bars: DailyBars = {
      timestamps: [sunday, sunday + 2 * H],
      opens: [1, 5],
      highs: [2, 6],
      lows: [0, 4],
      closes: [1, 5],
    };

    const out = resampleBars(bars, ONE_WEEK, WEEK_ANCHOR_OFFSET);

    expect(out.timestamps).toHaveLength(2);
    expect(out.closes).toEqual([1, 5]);
  });
});

/**
 * The averages drawn on the chart.
 *
 * The scorecard's `sma` and the chart's `smaSeries` compute the same statistic
 * by different means — a slice-and-reduce against a running sum — and a running
 * sum is exactly where an off-by-one hides. If the last point of the line ever
 * stops matching the cell, the chart and the score are telling the reader two
 * different things about the same average.
 */
describe('smaSeries', () => {
  it('is null until the window is full, then the mean of that window', () => {
    const out = smaSeries([1, 2, 3, 4, 5], 3);

    expect(out).toEqual([null, null, 2, 3, 4]);
  });

  it('does not average a partial window into a confident wrong number', () => {
    expect(smaSeries([1, 2], 5)).toEqual([null, null]);
  });

  it('slides the window rather than accumulating everything seen', () => {
    // A running sum that forgets to subtract the bar leaving the window climbs
    // forever; these values fall, so the bug cannot pass.
    const out = smaSeries([10, 10, 10, 1, 1, 1], 3);

    expect(out).toEqual([null, null, 10, 7, 4, 1]);
  });

  it('agrees at the last bar with the scorecard, which averages the tail directly', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 5);
    const window = closes.slice(-20);
    const direct = window.reduce((a, b) => a + b, 0) / window.length;

    expect(smaSeries(closes, 20).at(-1)!).toBeCloseTo(direct, 10);
  });

  it('returns an all-null column rather than throwing on an empty series', () => {
    expect(smaSeries([], 20)).toEqual([]);
  });
});

/**
 * The retry pass.
 *
 * The board flicker was a transient upstream failure scored as a neutral
 * reading, and `scoreTrend` is where that costs the most: it can never return
 * 0, so a symbol whose daily series lost one race moved its row by 1 to 3
 * points until the next cron. A dropped batch member used to be dropped for the
 * whole run — the only retry lived inside a single `fetchJson`.
 */
describe('fetchTechnicals retry', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => clearCache());

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /** A Yahoo chart payload with enough closes to compute averages from. */
  function chart(bars = 60) {
    const series = Array.from({ length: bars }, (_, i) => 100 + i);
    return {
      chart: {
        result: [
          {
            timestamp: series.map((_, i) => 1_700_000_000 + i * 86_400),
            meta: { regularMarketPrice: series[series.length - 1] },
            indicators: {
              quote: [{ open: series, high: series, low: series, close: series }],
            },
          },
        ],
      },
    };
  }

  function response(body: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  it('recovers a symbol whose first attempt failed, and says it did', async () => {
    /**
     * FLAKY=X's daily series fails for the whole of the first pass and recovers
     * on the second.
     *
     * `fetchChart` already asks `fetchJson` for one internal retry, so failing a
     * single attempt would be recovered a layer down and would never reach the
     * code under test. Failing both attempts of the first pass is what actually
     * exercises the batch-level retry.
     */
    let attempts = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('FLAKY') && url.includes('interval=1d')) {
        attempts++;
        if (attempts <= 2) return response({}, 500);
      }
      return response(chart());
    });

    const res = await fetchTechnicals([
      { symbol: 'GOOD', yahoo: 'GOOD=X' },
      { symbol: 'FLAKY', yahoo: 'FLAKY=X' },
    ]);

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Both symbols present — without the retry pass FLAKY would be absent and
    // its trend cell would silently vanish from the score.
    expect(res.data.has('FLAKY')).toBe(true);
    expect(res.data.has('GOOD')).toBe(true);
    expect(res.degraded).toMatch(/recovered on retry/);
  });

  it('reports a symbol that fails both passes rather than dropping it silently', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('DEAD')) return response({}, 500);
      return response(chart());
    });

    const res = await fetchTechnicals([
      { symbol: 'GOOD', yahoo: 'GOOD=X' },
      { symbol: 'DEAD', yahoo: 'DEAD=X' },
    ]);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.has('DEAD')).toBe(false);
    expect(res.degraded).toMatch(/DEAD/);
  });

  /**
   * The leg that used to fail with no trace at all. The daily series is fine, so
   * the symbol scores; only the monthly request fails, so `seasonality` is `{}`
   * and a ±1 cell quietly disappears. Nothing was appended to `failed[]`, so no
   * `degraded` note ever mentioned it.
   */
  it('reports a missing monthly series instead of silently unscoring seasonality', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('interval=1mo')) return response({}, 500);
      return response(chart());
    });

    const res = await fetchTechnicals([{ symbol: 'GOOD', yahoo: 'GOOD=X' }]);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.get('GOOD')?.seasonality).toEqual({});
    expect(res.degraded).toMatch(/seasonality unscored/);
  });
});
