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
  FX_DAY_ANCHOR_OFFSET,
  FX_DAY_CLOSE_HOUR_UTC,
  ONE_DAY,
  ONE_WEEK,
  WEEK_ANCHOR_OFFSET,
  fetchTechnicals,
  redateSpotFridays,
  resampleBars,
  seriesAsOf,
  smaSeries,
  spliceFxSessions,
  yield2yAsOf,
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
   * The leg that used to fail with no trace at all. The 2-year daily series is
   * fine, so the symbol scores; only the long-run history fails, so
   * `seasonality` is `{}` and a ±1 cell quietly disappears. Nothing was appended
   * to `failed[]`, so no `degraded` note ever mentioned it.
   *
   * THE URL THIS MOCKS CHANGED, and the reason matters. Seasonality used to come
   * from `range=11y&interval=1mo`, a series Yahoo returns corrupt — two March
   * bars every year and closes stamped with the wrong month, which put the WRONG
   * SIGN on EURUSD's cell. It now comes from the long-run DAILY series, which is
   * requested with explicit epoch bounds, so `period1=` is what identifies it —
   * and distinguishes it from the 2-year daily fetch, which uses `range=`.
   */
  it('reports a missing long-run history instead of silently unscoring seasonality', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('period1=')) return response({}, 500);
      return response(chart());
    });

    const res = await fetchTechnicals([{ symbol: 'GOOD', yahoo: 'GOOD=X' }]);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.get('GOOD')?.seasonality).toEqual({});
    expect(res.degraded).toMatch(/seasonality unscored/);
  });
});

/**
 * The price cutoff behind a rewound board.
 *
 * WHAT THIS PROTECTS. `runSetupsPipeline` has always taken a `now` and handed it
 * to the calendar connectors, but never to this one, so the moving averages —
 * and the TREND cell over them — were the tail of the series no matter which
 * date was being reproduced. `scripts/parity.ts` printed "rewound to end of that
 * day" over a comparison in which one column was not rewound at all.
 *
 * Measured 2026-08-30 against A1's eight checksummed trend cells: computed live
 * ours matched six, cut off at each capture's own timestamp it matched eight.
 * EURCHF went +2 -> -1 and CHFX -2 -> +2, landing exactly on A1's printed cells.
 * `scoreTrend` was not touched — only the window it reads.
 *
 * The identity case below is the one that matters most: it is what keeps the
 * LIVE board byte-identical, including reading Yahoo's quote rather than the
 * last close.
 */
describe('seriesAsOf', () => {
  const day = 86_400;
  const start = Math.floor(Date.UTC(2026, 7, 20) / 1000);
  const series = () => ({
    timestamps: [0, 1, 2, 3, 4].map((i) => start + i * day),
    opens: [1, 2, 3, 4, 5],
    highs: [1, 2, 3, 4, 5],
    lows: [1, 2, 3, 4, 5],
    closes: [10, 20, 30, 40, 50],
    volumes: [1, 2, 3, 4, 5],
    price: 99,
  });

  it('returns the very same object when nothing is after the cutoff', () => {
    // Identity, not just equality: the live path must not pay to copy five
    // arrays per symbol, and must not swap the live quote for the last close.
    const s = series();
    const at = new Date((start + 10 * day) * 1000);
    expect(seriesAsOf(s, at)).toBe(s);
    expect(seriesAsOf(s, at).price).toBe(99);
  });

  it('drops the bars after the cutoff and keeps every array aligned', () => {
    const cut = seriesAsOf(series(), new Date((start + 2 * day) * 1000));
    expect(cut.closes).toEqual([10, 20, 30]);
    expect(cut.timestamps).toHaveLength(3);
    expect(cut.opens).toHaveLength(3);
    expect(cut.highs).toHaveLength(3);
    expect(cut.lows).toHaveLength(3);
    expect(cut.volumes).toHaveLength(3);
  });

  it('replaces the live quote with the last close inside the window', () => {
    // `price` is compared against the rewound averages to build `aboveCount`.
    // Leaving today's quote there would compare a price from after the cutoff
    // against averages from before it.
    expect(seriesAsOf(series(), new Date((start + 2 * day) * 1000)).price).toBe(30);
  });

  it('leaves bars that carry no price alone', () => {
    // The seasonal history is `DailyBars`, which has no `price` field at all.
    const bars: DailyBars = {
      timestamps: [start, start + day],
      opens: [1, 2],
      highs: [1, 2],
      lows: [1, 2],
      closes: [10, 20],
    };
    const cut = seriesAsOf(bars, new Date(start * 1000));
    expect(cut.closes).toEqual([10]);
    expect('price' in cut).toBe(false);
  });

  it('empties the series when the cutoff precedes every bar', () => {
    // Deliberately NOT a fallback to the full series. `computeForTicker` checks
    // `closes.length < 20` and declines to score, which is the honest answer for
    // a rewind further back than the history reaches.
    const cut = seriesAsOf(series(), new Date((start - day) * 1000));
    expect(cut.closes).toEqual([]);
    expect(cut.timestamps).toEqual([]);
  });

  it('is what lets a past date score a different trend from today', () => {
    // The whole point, on a synthetic series that rises then falls. Computed at
    // the peak the 3-day average leads the 14-day; computed after the fall it
    // trails. Same formula, two windows, two cells.
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    const falling = Array.from({ length: 6 }, (_, i) => 119 - (i + 1) * 4);
    const closes = [...rising, ...falling];
    const full = {
      timestamps: closes.map((_, i) => start + i * day),
      opens: closes, highs: closes, lows: closes, closes,
      price: closes[closes.length - 1],
    };

    const peak = seriesAsOf(full, new Date((start + 19 * day) * 1000));
    expect(peak.closes[peak.closes.length - 1]).toBe(119);

    const sma = (v: number[], n: number) => v.slice(-n).reduce((a, b) => a + b, 0) / n;
    expect(sma(peak.closes, 3)).toBeGreaterThan(sma(peak.closes, 14));
    expect(sma(full.closes, 3)).toBeLessThan(sma(full.closes, 14));
  });
});

/**
 * The 2-year reading, which is the input to every non-FX rate cell.
 *
 * WHAT THIS PROTECTS IS A SOURCE CHOICE, not arithmetic. The column read
 * Yahoo's `2YY=F` for four rounds; A1's Asset Scorecard names "US02Yield (21
 * day SMA)", which is FRED DGS2, and the futures quote was 24bp away from it
 * on the day the two were finally compared. Nothing here can catch that on its
 * own — but the cutoff below is what makes the series replayable at all, and
 * an un-replayable series is how the discrepancy stayed invisible.
 */
describe('yield2yAsOf', () => {
  /** 25 sessions, so a 21-observation window has room to move under a cut. */
  const series = Array.from({ length: 25 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    value: 4 + i * 0.01,
  }));

  it('reads the last observation and averages the trailing window', () => {
    const live = yield2yAsOf(series)!;
    expect(live.observedOn).toBe('2026-08-25');
    expect(live.current).toBeCloseTo(4.24, 10);
    // Mean of the last 21 values, which start at 4.04.
    expect(live.sma).toBeCloseTo(4.14, 10);
  });

  /**
   * THE POINT OF THE WHOLE CHANGE. A replayed board must not see a yield that
   * had not printed yet, and the observation date has to say which one it saw.
   */
  it('cuts on the observation date, inclusive', () => {
    const cut = yield2yAsOf(series, new Date('2026-08-24T23:59:59Z'))!;
    expect(cut.observedOn).toBe('2026-08-24');
    expect(cut.current).toBeCloseTo(4.23, 10);
    // The window slid back one observation with it, rather than staying put.
    expect(cut.sma).toBeCloseTo(4.13, 10);
  });

  it('ignores observations after the cutoff entirely', () => {
    const cut = yield2yAsOf(series, new Date('2026-08-21T00:00:00Z'))!;
    expect(cut.observedOn).toBe('2026-08-21');
  });

  /**
   * A short window is a different statistic, not a rougher one. Averaging six
   * observations and calling the result a 21-day average is the failure this
   * refuses.
   */
  it('returns null rather than shortening the average', () => {
    expect(yield2yAsOf(series, new Date('2026-08-06T00:00:00Z'))).toBeNull();
    expect(yield2yAsOf(series.slice(0, 20))).toBeNull();
    // Exactly enough is enough.
    expect(yield2yAsOf(series.slice(0, 21))).not.toBeNull();
  });
});


/**
 * The observed shape, pinned so a change in Yahoo's dating is a test failure
 * rather than a silent shift in every FX trend cell.
 *
 * Values are the real ones measured 2026-09-01: spot EURUSD=X against 6E=F
 * futures, which carry clean Mon-Fri bars for the same underlying.
 */
describe('redateSpotFridays', () => {
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
  const dow = (ts: number) => new Date(ts * 1000).getUTCDay();

  /** Mon-Thu correctly dated, Friday stamped the following Sunday. */
  const observed = {
    timestamps: [
      day('2026-08-24'), day('2026-08-25'), day('2026-08-26'),
      day('2026-08-27'), day('2026-08-30'),
    ],
    closes: [1.16683, 1.16747, 1.16549, 1.16564, 1.15890],
  };

  it('moves a Sunday bar back to the Friday it actually traded', () => {
    const out = redateSpotFridays(observed);
    // 2026-08-30 is a Sunday; the session it holds is Friday 2026-08-28, whose
    // futures close was 1.15875 against this 1.15890.
    expect(out.timestamps[4]).toBe(day('2026-08-28'));
    expect(dow(out.timestamps[4])).toBe(5);
  });

  it('leaves correctly dated weekdays exactly where they are', () => {
    const out = redateSpotFridays(observed);
    expect(out.timestamps.slice(0, 4)).toEqual(observed.timestamps.slice(0, 4));
  });

  it('preserves order and length, so no moving average changes', () => {
    const out = redateSpotFridays(observed);
    expect(out.timestamps).toHaveLength(observed.timestamps.length);
    expect([...out.timestamps].sort((a, b) => a - b)).toEqual(out.timestamps);
    // The whole point: re-dating is a correctness fix for date CUTS, not a
    // change to what the live board scores.
    expect(out.closes).toEqual(observed.closes);
  });

  it('makes a Friday-close rewind include that Friday', () => {
    // The bug this exists to fix. Cut at Friday 2026-08-28 end of day: the
    // mis-stamped series loses the session entirely, the re-dated one keeps it.
    const cut = new Date('2026-08-28T23:59:59Z');
    const bars = (t: { timestamps: number[]; closes: number[] }): DailyBars => ({
      timestamps: t.timestamps,
      opens: t.closes,
      highs: t.closes,
      lows: t.closes,
      closes: t.closes,
    });
    expect(seriesAsOf(bars(observed), cut).closes).not.toContain(1.15890);
    expect(seriesAsOf(bars(redateSpotFridays(observed)), cut).closes).toContain(1.15890);
  });

  it('refuses to overwrite a Friday that is already there', () => {
    // No such collision exists in the observed feed. If one appears the feed
    // has changed shape and the assumption needs re-measuring, so the bar is
    // left alone rather than clobbering a real session.
    const collides = { timestamps: [day('2026-08-28'), day('2026-08-30')], closes: [1.1, 1.2] };
    expect(redateSpotFridays(collides).timestamps).toEqual(collides.timestamps);
  });

  it('returns the input untouched when there is nothing to move', () => {
    const clean = { timestamps: [day('2026-08-27'), day('2026-08-28')], closes: [1, 2] };
    expect(redateSpotFridays(clean)).toBe(clean);
  });
});

/**
 * Rebuilding the recent spot-FX daily series from hourly bars.
 *
 * The fault this repairs is not visible in a chart and not visible in a rule
 * fit: Yahoo's `=X` daily series drops whole sessions and never carries the
 * session in progress at a rewound cut, so a 3-day average — which is what
 * Trend reads — is computed on the wrong three days. These tests pin the
 * boundary, the seam, and the two ways splicing could quietly lose history.
 */
describe('spliceFxSessions', () => {
  /** 2026-09-01T22:00:00Z — an FX day boundary, so buckets start here. */
  const SEAM = Math.floor(Date.UTC(2026, 8, 1, FX_DAY_CLOSE_HOUR_UTC) / 1000);

  const bars = (timestamps: number[], closes: number[]): DailyBars => ({
    timestamps,
    opens: closes,
    highs: closes,
    lows: closes,
    closes,
  });

  /** Hourly bars every hour from `start`, `n` of them, closing at `close(i)`. */
  const hours = (start: number, n: number, close: (i: number) => number): DailyBars =>
    bars(
      Array.from({ length: n }, (_, i) => start + i * H),
      Array.from({ length: n }, (_, i) => close(i)),
    );

  it('puts the FX day boundary at 22:00 UTC, not midnight', () => {
    // 21:00 belongs to the session ending at 22:00; 23:00 opens the next one.
    const before = SEAM - H;
    const out = resampleBars(hours(before, 3, (i) => 10 + i), ONE_DAY, FX_DAY_ANCHOR_OFFSET);
    expect(out.timestamps).toEqual([SEAM - ONE_DAY, SEAM]);
    // The 21:00 bar closes its own session; 22:00 and 23:00 open the next.
    expect(out.closes).toEqual([10, 12]);
  });

  it('replaces the daily tail with rebuilt sessions and keeps the older history', () => {
    const daily = bars(
      [SEAM - 3 * ONE_DAY, SEAM - 2 * ONE_DAY, SEAM - ONE_DAY, SEAM - ONE_DAY + H],
      [1, 2, 3, 4],
    );
    // Hourly covers only the last two sessions.
    const spliced = spliceFxSessions(daily, hours(SEAM - ONE_DAY, 26, (i) => 100 + i));

    // Everything before the first rebuilt bucket survives untouched...
    expect(spliced.closes.slice(0, 2)).toEqual([1, 2]);
    // ...and the daily bars the rebuild covers are gone, not duplicated.
    expect(spliced.closes).not.toContain(3);
    expect(spliced.closes).not.toContain(4);
    expect(spliced.timestamps).toEqual([SEAM - 3 * ONE_DAY, SEAM - 2 * ONE_DAY, SEAM - ONE_DAY, SEAM]);
  });

  it('carries the session in progress, which the daily series never has', () => {
    // The whole point. Yahoo's daily series stops at the last COMPLETED session;
    // A1's board is reading the one that is running.
    const daily = bars([SEAM - 2 * ONE_DAY, SEAM - ONE_DAY], [1, 2]);
    const spliced = spliceFxSessions(daily, hours(SEAM - ONE_DAY, 30, (i) => 100 + i));

    expect(spliced.timestamps[spliced.timestamps.length - 1]).toBe(SEAM);
    // Four hours into the new session, its close is the latest hourly close.
    expect(spliced.closes[spliced.closes.length - 1]).toBe(129);
  });

  it('leaves the series alone when there are no hourly bars', () => {
    const daily = bars([SEAM - ONE_DAY, SEAM], [1, 2]);
    expect(spliceFxSessions(daily, bars([], []))).toBe(daily);
  });

  it('refuses to splice when the rebuild would truncate the history', () => {
    // Two years of daily bars against a handful of hourly ones means the daily
    // fetch came back short, not that the rebuild is better. Splicing here
    // would throw away every bar the 200-day average needs.
    const daily = bars(
      Array.from({ length: 300 }, (_, i) => SEAM - (300 - i) * ONE_DAY),
      Array.from({ length: 300 }, (_, i) => i),
    );
    const stale = hours(SEAM - 400 * ONE_DAY, 3, () => 1);
    expect(spliceFxSessions(daily, stale)).toBe(daily);
  });

  it('drops volume rather than splicing old numbers onto new nothing', () => {
    const daily: DailyBars = { ...bars([SEAM - ONE_DAY], [1]), volumes: [42] };
    const spliced = spliceFxSessions(daily, hours(SEAM, 2, () => 5));
    expect(spliced.volumes).toBeUndefined();
  });

  it('keeps `price` where it is — repointing it is the caller of a rewind', () => {
    const daily = { ...bars([SEAM - ONE_DAY], [1]), price: 99 };
    expect(spliceFxSessions(daily, hours(SEAM, 2, () => 5)).price).toBe(99);
  });
});
