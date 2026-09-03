/**
 * Price-derived inputs: moving averages, trend, seasonality, volatility.
 *
 * Two separate Yahoo series per symbol, with very different cache lives:
 *   - 2 years of DAILY bars for moving averages and volatility (1 hour TTL)
 *   - 10 years of MONTHLY bars for seasonality (7 day TTL — a decade of history
 *     does not meaningfully change week to week)
 *
 * Note this is the one place price data influences a score. Elsewhere in the app
 * prices are context only. The containment still holds where it matters: these
 * are technical columns on a technical row, and a Yahoo outage drops those cells
 * to null rather than corrupting the fundamental ones.
 */

import {
  SEASONALITY_YEARS,
  TREND_SLOPE_LOOKBACK_DAYS,
  TREND_SMA,
  YIELD_SMA_DAYS,
} from '@/config/setups.config';
import { YAHOO } from '@/config/sources.config';
import { fetchJson, fixturesEnabled } from '@/lib/connectors/base';
import { fetchFredSeries, type DatedObservation } from '@/lib/connectors/yields';
import { fail, ok, type Result } from '@/lib/types';

interface YahooChart {
  chart?: {
    result?: {
      timestamp?: number[];
      meta?: { regularMarketPrice?: number };
      indicators?: {
        quote?: {
          /**
           * Open, high and low are declared even though the moving averages only
           * read closes. Yahoo sends all four in the same payload; not declaring
           * them threw away the highs and lows at the typing boundary, and swing
           * detection cannot work without them — a pivot found from closes is a
           * level that does not appear on the user's chart.
           */
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          /**
           * Discarded here until now for the same reason the highs once were.
           * Sent on every request at no extra cost, null or zero throughout for
           * spot FX, and real for futures, indices and crypto.
           */
          volume?: (number | null)[];
        }[];
      };
    }[];
  };
}

export interface Technicals {
  symbol: string;
  price: number;

  /**
   * The two averages the trend score actually uses (3- and 14-day by default),
   * plus yesterday's slow average so the slope has something to measure against.
   * Null when there is not enough history.
   */
  smaFast: number | null;
  smaSlow: number | null;
  smaSlowPrior: number | null;

  /**
   * Longer averages. CONTEXT ONLY — they are rendered on the scorecard but do
   * not feed the trend score, which reads the 3/14 pair above.
   */
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  /** How many of the four the price is above, 0..4. Null if none computed. */
  aboveCount: number | null;
  smaCount: number;

  /** Annualised standard deviation of daily returns over 30 sessions, %. */
  realizedVolPct: number | null;
  /** Mean absolute daily move, %. */
  avgDailyMove7Pct: number | null;
  avgDailyMove90Pct: number | null;

  /** Per-calendar-month seasonal statistics, keyed 1-12. */
  seasonality: Record<number, { meanPct: number; winRatePct: number; years: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const window = closes.slice(-n);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

/**
 * The same average, at every bar rather than only the last one.
 *
 * `sma` above answers "where is the 50-day average now", which is what a
 * scorecard cell needs. A line on a chart needs the whole path, and the two must
 * not disagree — so this walks a running sum and the final entry is exactly what
 * `sma` returns for the same input.
 *
 * The first `n - 1` entries are `null`, not zero and not the partial average: a
 * 200-period line has no value at bar 3, and drawing the mean of three bars
 * there would show a wildly wrong average confidently. Lightweight Charts
 * renders a whitespace point for those, which is precisely the intent.
 */
export function smaSeries(closes: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (n <= 0 || closes.length < n) return out;

  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * A price series. Five arrays rather than an array of objects, because every
 * consumer walks them by index and the flat form keeps that cheap.
 *
 * ALL FIVE ARE ALWAYS THE SAME LENGTH and always populated. Open, high and low
 * are not optional: making them so would push a `?? closes[i]` guess into the
 * structure code, and a swing high invented from a close is a level that exists
 * nowhere except in this app.
 */
export interface DailyBars {
  /** Seconds, not milliseconds — this is Yahoo's own unit, kept as-is. */
  timestamps: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  /**
   * OPTIONAL, AND ABSENT IS NOT ZERO.
   *
   * The four price legs are mandatory for the reason above. Volume cannot join
   * them on the same terms: spot FX has no central exchange and therefore no
   * volume to report, and Yahoo returns nulls or a column of zeroes for every
   * `=X` ticker. Typing it as required would force those callers to invent a
   * number, and a chart drawing a flat zero histogram under EURUSD is claiming
   * "nobody traded", which is a considerably worse lie than an empty pane.
   *
   * So: present only when the source actually reported non-zero volume, and
   * index-aligned with the other four when it is. A consumer that cannot show
   * "unknown" must not show volume at all.
   */
  volumes?: number[];
}

/**
 * Raw daily bars, for callers that need to compute something AS OF a past date
 * rather than today.
 *
 * `fetchTechnicals` collapses two years of bars into one snapshot, which is all
 * the live scorecard wants and useless to a backtest — you cannot recover
 * yesterday's 14-day average from today's. This returns the series itself.
 */
export async function fetchDailyBars(
  ticker: string,
  /**
   * The moment being reproduced. Pass it rather than calling `seriesAsOf` on the
   * result: for spot FX the trailing session is REBUILT from hourly bars, and
   * cutting after the rebuild leaves prices from after `at` inside it. Defaults
   * to now, which cuts nothing.
   */
  at?: Date,
): Promise<DailyBars | null> {
  const series = await fetchSeries(ticker, '2y', '1d', 3600);
  if (!series) return null;

  const isSpotFx = ticker.endsWith(SPOT_FX_SUFFIX);
  const redated = isSpotFx ? redateSpotFridays(series) : series;
  const cut = at ? seriesAsOf(redated, at) : redated;
  if (!isSpotFx) return toBars(cut);

  const hourly = await fetchSeries(ticker, HOURLY_RANGE, '1h', 3600);
  if (!hourly) return toBars(cut);
  return toBars(spliceFxSessions(cut, at ? seriesAsOf(hourly, at) : hourly));
}

/**
 * Hourly bars, for the intraday view.
 *
 * Yahoo has no 4h interval, so the 4-hourly series the UI shows is resampled
 * from this with `resampleBars`.
 *
 * 180 days rather than the 730 the endpoint allows. Measured on EURUSD=X, 730d
 * returns 17,509 hourly bars — roughly 700KB of JSON per symbol, held in the
 * connector's in-process cache, to draw a few hundred candles. 180 days is ~1080
 * four-hour bars, which is already far more structure than any swing trade
 * consults, at a twentieth of the weight.
 */
export const HOURLY_RANGE = '180d';

export async function fetchHourlyBars(ticker: string): Promise<DailyBars | null> {
  const series = await fetchSeries(ticker, HOURLY_RANGE, '1h', 3600);
  return series ? toBars(series) : null;
}

/**
 * Long-run daily bars, for the seasonality scanners.
 *
 * EXPLICIT EPOCH BOUNDS, NOT `range=`. The two are not equivalent: `range` above
 * a few years silently downgrades the interval, so `range=max&interval=1d` on
 * EURUSD=X comes back as 274 MONTHLY bars while still claiming to be daily.
 * Measured against the `period1/period2` form, which returns the real thing:
 * EURUSD 5,919 daily bars from 2003-12, GC=F 6,591 from 2000-08, BTC-USD from
 * 2014-09, ^GSPC 14,269 from 1970.
 *
 * WINDOWED TO THE DEEPEST LOOKBACK PLUS ONE, not to all of history. The page
 * offers 1 / 5 / 10 years, so bars from 1970 are weight with no reader. The
 * extra year exists because the first return in a window needs the close BEFORE
 * it; without that the oldest bucket silently loses an observation.
 *
 * Daily is the only series fetched. Month, week and weekday buckets are all
 * derived from it — cheaper than three requests, and more correct: Yahoo's own
 * monthly series has holes (it returned March twice and omitted October for
 * EURUSD), and a bucket built from dailies cannot inherit them.
 *
 * SEVEN-DAY TTL, matching the monthly series. Closed history does not change,
 * and putting fifty symbols' worth of it on the 1-hour cache the live series
 * uses would re-download it every hour to learn nothing.
 */
export const SEASONAL_HISTORY_TTL_SECONDS = 7 * 86400;
export const SEASONAL_HISTORY_YEARS = SEASONALITY_YEARS + 1;

export async function fetchSeasonalHistory(ticker: string): Promise<DailyBars | null> {
  /**
   * NOT CAPTURED AS A FIXTURE, deliberately. Offline mode exists so the UI can
   * be worked on and demoed with no network, and it pays for that with a
   * captured payload per source. This source is ~2,800 daily bars for each of
   * 51 symbols — tens of megabytes committed to the repo to render bar charts
   * that are already the least critical thing on the screen.
   *
   * So offline returns null, the pages say the tab needs the network, and the
   * promise that `USE_FIXTURES=true` makes NO outbound request stays true.
   * Silently fetching here would have broken that quietly, which is worse than
   * an empty panel that explains itself.
   */
  if (fixturesEnabled()) return null;

  const series = await fetchSeriesFromEpoch(
    ticker,
    '1d',
    SEASONAL_HISTORY_YEARS,
    SEASONAL_HISTORY_TTL_SECONDS,
  );
  if (!series) return null;
  /**
   * Re-dated here too, because seasonality buckets by CALENDAR MONTH and a
   * Friday stamped two days late crosses the boundary whenever a month ends on
   * one — 31 July's session would be counted as August.
   */
  return toBars(ticker.endsWith(SPOT_FX_SUFFIX) ? redateSpotFridays(series) : series);
}

/**
 * The same batching discipline `fetchTechnicals` uses, for the same reason:
 * fifty requests at once to an undocumented endpoint is how you get blocked.
 * Cheap after the first call of the week, because of the TTL above.
 */
export async function fetchSeasonalHistories(
  targets: { symbol: string; yahoo: string }[],
  // Four rather than the six `fetchTechnicals` uses. These payloads are an
  // order of magnitude bigger, and a cold run measured on all 51 symbols lost
  // the last seven to throttling at six-wide. The 7-day TTL means the slower
  // cold path costs nothing after the first load of the week.
  batchSize = 4,
): Promise<Map<string, DailyBars>> {
  const out = new Map<string, DailyBars>();

  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    const bars = await Promise.all(batch.map((t) => fetchSeasonalHistory(t.yahoo)));
    batch.forEach((t, j) => {
      const b = bars[j];
      if (b && b.closes.length > 0) out.set(t.symbol, b);
    });
  }

  return out;
}

function toBars(s: Series): DailyBars {
  return {
    timestamps: s.timestamps,
    opens: s.opens,
    highs: s.highs,
    lows: s.lows,
    closes: s.closes,
    ...(s.volumes ? { volumes: s.volumes } : {}),
  };
}

/**
 * SPOT FX SUNDAY BARS ARE FRIDAY'S SESSION, MIS-STAMPED. They are re-dated, not
 * dropped, and the difference between those two is the whole point.
 *
 * Yahoo's `=X` daily series returns SUNDAY, MONDAY, TUESDAY, WEDNESDAY,
 * THURSDAY and never a Friday. Measured 2026-09-01 across all eight dollar
 * majors plus EURGBP over three months, the weekday histogram is identical on
 * every one of them: `{Sun 14, Mon 13, Tue 14, Wed 13, Thu 13}`. A feed that
 * genuinely traded Sunday and not Friday, in perfect lockstep across nine
 * unrelated symbols, is not a market — it is a labelling bug.
 *
 * Cross-checked against 6E=F euro futures, which carry clean Mon-Fri bars and
 * are the same underlying:
 *
 *     futures Fri 2026-08-21  1.16930   <->   spot "Sun" 2026-08-23  1.16816
 *     futures Fri 2026-08-28  1.15875   <->   spot "Sun" 2026-08-30  1.15890
 *     futures Mon 2026-08-24  1.16745   <->   spot  Mon  2026-08-24  1.16683
 *
 * Monday through Thursday are correctly dated. Friday alone lands two days
 * late. So the Sunday bar is a REAL SESSION with a wrong date, and the previous
 * round's conclusion — recorded here as "weekend bars are kept on purpose,
 * filtering them cost twelve points of parity" — was reasoning from a false
 * premise. Filtering cost parity because it DELETED FRIDAY, not because A1
 * reads junk bars.
 *
 * WHY THIS DOES NOT MOVE THE LIVE BOARD. A moving average reads bars in order,
 * and re-dating preserves order, so today's trend cell is unchanged. What it
 * fixes is every measurement that CUTS the series by date. `seriesAsOf` at a
 * Friday close previously excluded that Friday's own session and silently
 * scored the week one bar short — which is exactly what `npm run leg-parity`,
 * `npm run backtest` and every rewound parity run do. A backtest that cannot
 * see Friday is not a small error on Fridays; it is a different series.
 *
 * Applied to `=X` DAILY bars only. Futures (`=F`), indices and crypto are
 * correctly dated already, and the intraday series is bucketed by `resampleBars`
 * from real hourly timestamps.
 */
export const SPOT_FX_SUFFIX = '=X';

/**
 * Move Saturday- and Sunday-stamped bars back to the preceding Friday.
 *
 * A bar that collides with a Friday already present is left alone rather than
 * overwriting it: the observed feed has no such collision, and if one ever
 * appears it means the shape changed and the assumption above needs
 * re-measuring, not silently applying.
 */
export function redateSpotFridays<T extends { timestamps: number[] }>(series: T): T {
  const DAY = 86_400;
  const present = new Set(series.timestamps);
  let moved = 0;

  const timestamps = series.timestamps.map((ts) => {
    const day = new Date(ts * 1000).getUTCDay();
    if (day !== 0 && day !== 6) return ts;
    // Sunday is two days past Friday, Saturday one.
    const friday = ts - (day === 0 ? 2 : 1) * DAY;
    if (present.has(friday)) return ts;
    moved++;
    return friday;
  });

  return moved === 0 ? series : { ...series, timestamps };
}

/**
 * WHERE THE FX TRADING DAY ENDS: 17:00 New York, which is 22:00 UTC while New
 * York is on EDT. Every retail FX broker rolls the day there.
 *
 * This is the anchor `resampleBars` needs to turn hourly bars into daily ones —
 * see `spliceFxSessions` for why we rebuild them at all.
 *
 * NOT A FITTED PARAMETER, and the sweep that shows it is the reason to trust
 * it. All 24 possible boundaries were scored against A1's own Trend cells over
 * four full-access captures (116 spot-FX cells). 22:00 lands 91, 23:00 lands 88,
 * and the other twenty-two hours sit between 65 and 77 with no structure. The
 * peak is sharp, isolated, and on the hour market convention already names — so
 * convention predicted it and the measurement confirmed it, which is the
 * opposite of choosing an hour because it scored well.
 *
 * The one-hour-wide plateau at 22:00/23:00 is what a DST boundary looks like:
 * 17:00 New York is 22:00 UTC in summer and 23:00 in winter, and the fitting
 * window straddles neither. Left at 22:00 rather than made timezone-aware,
 * because a fixed anchor keeps `resampleBars` buckets stable and no evidence on
 * disk covers a winter month. Revisit after the November change.
 */
export const FX_DAY_CLOSE_HOUR_UTC = 22;

/** `resampleBars` floors `ts + offset`, so a day ending at 22:00 UTC needs 2h. */
export const FX_DAY_ANCHOR_OFFSET = (24 - FX_DAY_CLOSE_HOUR_UTC) * 3600;

/** Seconds per bucket for the resampled intraday view. */
export const FOUR_HOURS = 4 * 3600;

/** Seconds in a day, for bucketing hourly bars back into sessions. */
export const ONE_DAY = 86_400;

export const ONE_WEEK = 7 * ONE_DAY;

/**
 * The shift that moves epoch-anchored weekly buckets onto a Monday.
 *
 * 1 January 1970 was a THURSDAY, so `floor(ts / 604800) * 604800` — correct and
 * stable for every intraday width — puts weekly candles on a Thursday-to-
 * Wednesday cycle. No market reads a week that way. Adding three days before
 * the floor and taking them back after moves the boundary to Monday 00:00 UTC
 * without giving up the epoch anchoring that keeps buckets from shifting when
 * the series gains or loses a leading bar.
 *
 * Monday UTC rather than the FX week's Sunday 22:00 open: the boundary has to
 * be the same for gold, the DAX and bitcoin as for EURUSD, and Monday is the
 * one both conventions round to.
 */
export const WEEK_ANCHOR_OFFSET = 3 * 86_400;

/**
 * Aggregates bars into fixed-width buckets — 1h into 4h, or daily into weekly.
 *
 * Buckets are anchored to the Unix epoch (`floor(ts / seconds) * seconds`), so a
 * 4h bucket starts at 00:00, 04:00, 08:00 UTC and so on. Anchoring to the first
 * bar instead would shift every level whenever the series gained or lost a
 * leading bar, which would make the structure move for no market reason.
 *
 * Gaps are handled by not existing: a weekend with no hourly bars simply
 * produces no bucket, rather than a flat phantom bar that swing detection would
 * read as a pivot. The trailing bucket is usually incomplete — it is kept,
 * because the current partial candle is the one the trader is looking at, and
 * `bucketComplete` tells the caller which one it is.
 */
export function resampleBars(bars: DailyBars, seconds: number, anchorOffset = 0): DailyBars {
  const out: DailyBars = { timestamps: [], opens: [], highs: [], lows: [], closes: [] };

  /**
   * Volume SUMS over a bucket where price aggregates. Carried only when the
   * input carried it, so resampling never manufactures a volume column for spot
   * FX that the source did not report.
   */
  const volumes = bars.volumes;
  const outVolumes: number[] | undefined = volumes ? [] : undefined;

  let current = -1;

  for (let i = 0; i < bars.timestamps.length; i++) {
    const bucket =
      Math.floor((bars.timestamps[i] + anchorOffset) / seconds) * seconds - anchorOffset;

    if (bucket !== current) {
      current = bucket;
      out.timestamps.push(bucket);
      out.opens.push(bars.opens[i]);
      out.highs.push(bars.highs[i]);
      out.lows.push(bars.lows[i]);
      out.closes.push(bars.closes[i]);
      if (outVolumes && volumes) outVolumes.push(volumes[i] ?? 0);
      continue;
    }

    const last = out.timestamps.length - 1;
    out.highs[last] = Math.max(out.highs[last], bars.highs[i]);
    out.lows[last] = Math.min(out.lows[last], bars.lows[i]);
    out.closes[last] = bars.closes[i];
    if (outVolumes && volumes) outVolumes[last] += volumes[i] ?? 0;
  }

  if (outVolumes) out.volumes = outVolumes;

  return out;
}

/**
 * REBUILD THE RECENT SPOT-FX DAILY SERIES FROM HOURLY BARS.
 *
 * Yahoo's `=X` daily series cannot support a 3-day average, which is what Trend
 * reads. Measured against the raw endpoint on 2026-09-02, three separate faults:
 *
 *   - WHOLE SESSIONS GO MISSING. `EURUSD=X` has no 2026-09-01 bar at all. It
 *     jumps from the Aug 31 session to a null-close bar for the session in
 *     progress.
 *   - THE CURRENT SESSION IS NEVER IN A REWOUND CUT. Yahoo appends today as a
 *     bar stamped NOW (`2026-09-02T15:33:50Z`), so `seriesAsOf` at any earlier
 *     moment drops it. Futures stamp today's bar at 04:00 UTC and are current,
 *     so the defect is invisible unless you look per ticker — which is why it
 *     survived several rounds of treating Trend as a rule problem.
 *   - Plus the Friday-stamped-Sunday fault `redateSpotFridays` already repairs.
 *
 * The hourly series has none of these: real timestamps, no missing sessions, and
 * the session in progress is simply the last few bars. Bucketing it at the FX
 * rollover reconstructs the daily series we should have had.
 *
 * MEASURED, against A1's own Trend cells over four full-access captures:
 * spot-FX went 76/116 to 91/116 (65.5% -> 78.4%) with `scoreTrend` and
 * `TREND_SMA` untouched. The rule was never what was wrong.
 *
 * SPLICED, NOT SUBSTITUTED, because hourly is only ~180 days deep and the
 * 200-day average needs more than that. Bars older than the hourly window keep
 * coming from the daily series; everything the hourly window covers is rebuilt.
 * The two conventions stamp a session an hour apart (Yahoo at 23:00, a bucket
 * at 22:00), which is why the seam is cut on the first rebuilt bucket rather
 * than by matching timestamps — a moving average reads bars in order and does
 * not care where inside the session the label sits.
 *
 * APPLIED TO `=X` ONLY. Rebuilding futures, indices and crypto makes them worse
 * (DXY 4/4 -> 2/4, CADX 4/4 -> 1/4 on the same captures): their daily bars are
 * already correctly dated, and their hourly sessions have gaps a bucket would
 * quietly fill.
 *
 * CUT THE HOURLY SERIES BEFORE CALLING THIS. A bucket built from uncut hourly
 * bars contains prices from after the moment being reproduced, and a rewound
 * board would read the future through the trailing bucket.
 */
export function spliceFxSessions<T extends DailyBars & { price?: number }>(
  daily: T,
  hourly: DailyBars,
): T {
  const rebuilt = resampleBars(hourly, ONE_DAY, FX_DAY_ANCHOR_OFFSET);
  if (rebuilt.timestamps.length === 0) return daily;

  const seam = rebuilt.timestamps[0];
  let keep = 0;
  while (keep < daily.timestamps.length && daily.timestamps[keep] < seam) keep += 1;

  /**
   * A rebuilt window that covers less than the daily one is the point; a
   * rebuilt window that covers MORE means the daily series arrived short, and
   * splicing would silently truncate the history a 200-day average needs.
   */
  if (keep === 0 && daily.timestamps.length > rebuilt.timestamps.length) return daily;

  return {
    ...daily,
    timestamps: [...daily.timestamps.slice(0, keep), ...rebuilt.timestamps],
    opens: [...daily.opens.slice(0, keep), ...rebuilt.opens],
    highs: [...daily.highs.slice(0, keep), ...rebuilt.highs],
    lows: [...daily.lows.slice(0, keep), ...rebuilt.lows],
    closes: [...daily.closes.slice(0, keep), ...rebuilt.closes],
    /**
     * Volume is dropped rather than half-filled: spot FX reports none, so a
     * spliced column would be old zeroes against new nothing.
     */
    ...(daily.volumes ? { volumes: undefined } : {}),
  };
}

// ---------------------------------------------------------------------------
// Chart timeframes
// ---------------------------------------------------------------------------

/**
 * The ladder the chart offers.
 *
 * The page shipped with 1d and 4h only, and that — not the polling — is why it
 * felt dead: a daily candle does not visibly move in fifteen seconds no matter
 * how fresh the quote behind it is. A 1-minute candle does.
 *
 * Every width here was verified against Yahoo rather than assumed. 1m is capped
 * at 7 days of history by the endpoint, 5m and 15m at a month, 1h at two years.
 * 4h and 1W are not Yahoo intervals at all — they are resampled from the 1h and
 * daily series, which costs no extra request and, for the weekly, is strictly
 * more correct than Yahoo's own aggregate: their coarse series have documented
 * holes (see `computeSeasonality`) and a bucket built from dailies cannot
 * inherit them.
 */
export type ChartTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const CHART_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;

export interface TimeframeSpec {
  /** Button text. */
  label: string;
  /** The same width in prose, for panel subtitles and the written brief. */
  prose: string;
  /**
   * Seconds per candle, so the client knows whether a live tick extends the
   * forming bar or opens a new one.
   */
  bucketSeconds: number;
  /** Passed to `resampleBars`; non-zero only for the weekly. */
  anchorOffset: number;
  /** The TradingView widget's own interval code, for the secondary panel. */
  tvInterval: string;
  /**
   * The window WE ASK FOR, in words. Worth stating because Yahoo's caps are
   * what set it — a 1m chart that stops seven days back looks broken until you
   * know it cannot do otherwise.
   *
   * Not a promise about what comes back: measured today, a 180-day hourly
   * request returned 250 days for EURUSD. It is a floor and a reason, not a
   * measurement, so nothing on screen may present it as the series' actual span.
   */
  history: string;
}

export const TIMEFRAME_SPEC: Record<ChartTimeframe, TimeframeSpec> = {
  '1m': { label: '1m', prose: '1-minute', bucketSeconds: 60, anchorOffset: 0, tvInterval: '1', history: '7 days' },
  '5m': { label: '5m', prose: '5-minute', bucketSeconds: 300, anchorOffset: 0, tvInterval: '5', history: '1 month' },
  '15m': { label: '15m', prose: '15-minute', bucketSeconds: 900, anchorOffset: 0, tvInterval: '15', history: '1 month' },
  '1h': { label: '1H', prose: 'hourly', bucketSeconds: 3600, anchorOffset: 0, tvInterval: '60', history: '180 days' },
  '4h': { label: '4H', prose: '4-hourly', bucketSeconds: FOUR_HOURS, anchorOffset: 0, tvInterval: '240', history: '180 days' },
  '1d': { label: 'Daily', prose: 'daily', bucketSeconds: 86_400, anchorOffset: 0, tvInterval: 'D', history: '2 years' },
  '1w': {
    label: 'Weekly',
    prose: 'weekly',
    bucketSeconds: ONE_WEEK,
    anchorOffset: WEEK_ANCHOR_OFFSET,
    tvInterval: 'W',
    history: '5 years',
  },
};

export function isChartTimeframe(value: string | undefined): value is ChartTimeframe {
  return value !== undefined && (CHART_TIMEFRAMES as readonly string[]).includes(value);
}

/**
 * TTL per timeframe, matched to how fast the series can actually change.
 *
 * A 1m series is stale in a minute and caching it for an hour would hand the
 * chart an hour-old last bar; a daily series does not change intraday and
 * re-fetching it every minute would be fifty needless requests at the one
 * undocumented host the whole app depends on. The 1d entry deliberately matches
 * `fetchDailyBars` exactly — same range, same interval, same TTL — so the two
 * share one cache entry rather than each holding their own copy.
 */
const TIMEFRAME_TTL_SECONDS: Record<ChartTimeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 300,
  '1h': 3600,
  '4h': 3600,
  '1d': 3600,
  '1w': 3600,
};

/** Depth of the daily series behind the weekly view: 5 years is ~260 candles. */
const WEEKLY_HISTORY_YEARS = 5;

/**
 * Bars for one instrument at one timeframe — the chart page's single entry
 * point, so the range/interval/resample rules live here rather than being
 * re-derived at the call site.
 */
export async function fetchBars(
  ticker: string,
  timeframe: ChartTimeframe,
): Promise<DailyBars | null> {
  const ttl = TIMEFRAME_TTL_SECONDS[timeframe];

  switch (timeframe) {
    case '1m':
      return fetchSeries(ticker, '7d', '1m', ttl).then((s) => (s ? toBars(s) : null));
    case '5m':
      return fetchSeries(ticker, '1mo', '5m', ttl).then((s) => (s ? toBars(s) : null));
    case '15m':
      return fetchSeries(ticker, '1mo', '15m', ttl).then((s) => (s ? toBars(s) : null));
    case '1h':
      return fetchHourlyBars(ticker);
    case '4h': {
      const hourly = await fetchHourlyBars(ticker);
      return hourly ? resampleBars(hourly, FOUR_HOURS) : null;
    }
    case '1d':
      return fetchDailyBars(ticker);
    case '1w': {
      const daily = await fetchSeriesFromEpoch(ticker, '1d', WEEKLY_HISTORY_YEARS, ttl);
      return daily ? resampleBars(toBars(daily), ONE_WEEK, WEEK_ANCHOR_OFFSET) : null;
    }
  }
}

interface Series {
  timestamps: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  /** Undefined when the ticker reported none — see `DailyBars.volumes`. */
  volumes?: number[];
  price: number;
}

function fetchSeries(
  ticker: string,
  range: string,
  interval: string,
  ttlSeconds: number,
): Promise<Series | null> {
  return fetchChart(ticker, `range=${range}&interval=${interval}`, `${range}:${interval}`, ttlSeconds);
}

/**
 * A price series with every bar after `at` dropped.
 *
 * WHY THIS EXISTS. `runSetupsPipeline` has always taken a `now` and handed it to
 * the calendar connectors, so a rewound board scored its ECONOMIC columns
 * against releases the frame had actually seen. It never handed it here. The
 * moving averages — and therefore the TREND cell — were computed from the tail
 * of the series no matter which date was being reproduced, so `scripts/parity.ts`
 * printed "rewound to end of that day" over a comparison in which one column was
 * not rewound at all. `component-parity.ts` had to label every trend cell
 * LIVE_ONLY to say so, and six cells sat permanently as TIMING_CONFOUNDED
 * because nothing could tell a real disagreement from a week of drift.
 *
 * MEASURED, 2026-08-30, against A1's eight checksummed trend cells: computed
 * live ours matched SIX; cut off at each capture's own timestamp, EIGHT. EURCHF
 * went +2 -> -1 and CHFX -2 -> +2, both landing exactly on A1's printed cell.
 *
 * THE FORMULA IS NOT TOUCHED. `scoreTrend` is unchanged, `TREND_SMA` is
 * unchanged. Only the window they read is, which is the difference between
 * fitting a rule to A1 and reproducing our own rule at the right moment.
 *
 * A NO-OP IN LIVE SCORING. When `at` is now, nothing is after it, and the same
 * object is returned — `price` included, so the live board keeps reading Yahoo's
 * `regularMarketPrice` rather than the last close.
 */
export function seriesAsOf<T extends DailyBars & { price?: number }>(series: T, at: Date): T {
  const cutoff = Math.floor(at.getTime() / 1000);

  let keep = series.timestamps.length;
  while (keep > 0 && series.timestamps[keep - 1] > cutoff) keep -= 1;
  if (keep === series.timestamps.length) return series;

  return {
    ...series,
    timestamps: series.timestamps.slice(0, keep),
    opens: series.opens.slice(0, keep),
    highs: series.highs.slice(0, keep),
    lows: series.lows.slice(0, keep),
    closes: series.closes.slice(0, keep),
    volumes: series.volumes?.slice(0, keep),
    /**
     * The live quote is an anachronism once bars have been dropped, and `price`
     * is compared against the rewound averages to build `aboveCount`. The last
     * close inside the window is the only price that existed at `at`.
     */
    ...(series.price === undefined || keep === 0 ? {} : { price: series.closes[keep - 1] }),
  };
}

/**
 * The same call, windowed by explicit epoch bounds instead of a named range.
 *
 * Both bounds are SNAPPED TO THE DAY. An exact `now` would make the URL — and
 * therefore the cache key — unique per request, so a 7-day TTL would never hit
 * and every page load would re-download a decade of bars.
 */
function fetchSeriesFromEpoch(
  ticker: string,
  interval: string,
  years: number,
  ttlSeconds: number,
): Promise<Series | null> {
  const day = 86_400;
  const end = Math.floor(Date.now() / 1000 / day) * day + day;
  const start = Math.max(0, end - Math.round(years * 365.25) * day);

  return fetchChart(
    ticker,
    `period1=${start}&period2=${end}&interval=${interval}`,
    `epoch:${start}:${end}:${interval}`,
    ttlSeconds,
  );
}

async function fetchChart(
  ticker: string,
  query: string,
  cacheSuffix: string,
  ttlSeconds: number,
): Promise<Series | null> {
  const url = `${YAHOO.chartBase}/${encodeURIComponent(ticker)}?${query}`;

  const res = await fetchJson<YahooChart>(YAHOO.name, url, {
    headers: { ...YAHOO.headers },
    cacheTtlSeconds: ttlSeconds,
    cacheKey: `yahoo:${ticker}:${cacheSuffix}`,
    timeoutMs: 15_000,
    retries: 1,
  });

  if (!res.ok) return null;

  const result = res.data.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const rawCloses = quote?.close ?? [];
  const rawOpens = quote?.open ?? [];
  const rawHighs = quote?.high ?? [];
  const rawLows = quote?.low ?? [];
  const rawStamps = result?.timestamp ?? [];
  const rawVolumes = quote?.volume ?? [];
  const price = result?.meta?.regularMarketPrice;

  if (typeof price !== 'number' || !Number.isFinite(price)) return null;

  /**
   * Yahoo pads gaps with nulls. Drop a bar unless ALL FOUR legs are finite, so
   * the five arrays stay index-aligned — a bar with a null high would otherwise
   * shift every later high by one relative to its own timestamp, which is the
   * kind of corruption that still renders a plausible-looking chart.
   */
  const timestamps: number[] = [];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];

  const finite = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v);

  /**
   * VOLUME DOES NOT GET A VOTE ON WHETHER A BAR SURVIVES. The four price legs
   * are load-bearing and a null in any of them drops the bar; a null volume is
   * routine — Yahoo sends one for every spot FX ticker and for the odd
   * half-formed intraday bar — and dropping real price action over it would put
   * holes in the series to protect a decoration.
   */
  let reported = false;

  for (let i = 0; i < rawCloses.length; i++) {
    const o = rawOpens[i];
    const h = rawHighs[i];
    const l = rawLows[i];
    const c = rawCloses[i];
    if (!finite(o) || !finite(h) || !finite(l) || !finite(c)) continue;

    timestamps.push(rawStamps[i] ?? 0);
    opens.push(o);
    highs.push(h);
    lows.push(l);
    closes.push(c);

    const v = rawVolumes[i];
    const vol = finite(v) && v > 0 ? v : 0;
    if (vol > 0) reported = true;
    volumes.push(vol);
  }

  /**
   * An all-zero column means "this instrument has no volume", not "nothing
   * traded" — so it is dropped rather than passed on as data. See
   * `DailyBars.volumes`.
   */
  return { timestamps, opens, highs, lows, closes, price, ...(reported ? { volumes } : {}) };
}

/**
 * Per-month seasonal statistics from monthly bars.
 *
 * DEDUPES BY YEAR-MONTH FIRST. Yahoo's 10-year monthly series is not clean —
 * measured on EURUSD=X it returned March twice and omitted October entirely.
 * Aggregating naively double-counts one month's return and silently drops
 * another, which is exactly the kind of error that produces a confident-looking
 * seasonal edge that does not exist.
 */
export function computeSeasonality(
  timestamps: number[],
  closes: number[],
  now: Date = new Date(),
): Record<number, { meanPct: number; winRatePct: number; years: number }> {
  /**
   * THE MONTH WE ARE STANDING IN DOES NOT COUNT.
   *
   * Yahoo's monthly series includes the in-progress bar, so without this a
   * seventeen-day-old August was being averaged in as though it were a complete
   * historical August. The scorecard cell is nothing but the SIGN of this mean,
   * so on a symbol whose real August average is near zero — the dollar index
   * runs -0.06% — that one partial observation decides the cell outright.
   */
  const inProgress = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;

  // Keep the last observation for each calendar month.
  const byYearMonth = new Map<string, { month: number; close: number; order: number }>();
  for (let i = 0; i < closes.length; i++) {
    const d = new Date(timestamps[i] * 1000);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    byYearMonth.set(`${year}-${String(month).padStart(2, '0')}`, {
      month,
      close: closes[i],
      order: year * 12 + month,
    });
  }

  const ordered = [...byYearMonth.values()].sort((a, b) => a.order - b.order);

  const buckets = new Map<number, number[]>();
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];

    // Only consecutive months form a valid month-over-month return. A gap
    // (October missing) must not be bridged into a two-month return.
    if (cur.order - prev.order !== 1) continue;
    if (prev.close === 0) continue;
    // The unfinished month contributes no return yet. See `inProgress` above.
    if (cur.order === inProgress) continue;

    const ret = (cur.close / prev.close - 1) * 100;
    const list = buckets.get(cur.month) ?? [];
    list.push(ret);
    buckets.set(cur.month, list);
  }

  const out: Record<number, { meanPct: number; winRatePct: number; years: number }> = {};
  for (const [month, all] of buckets) {
    if (all.length === 0) continue;

    /**
     * EXACTLY the last SEASONALITY_YEARS observations, newest-last.
     *
     * A1's rule names a ten-year average, so the sample has to BE ten — not
     * nine, not eleven. Both were happening: the raw 10y request yields nine
     * completed Augusts once the in-progress one is dropped, and the caller now
     * asks for eleven years so that ten survive the trim.
     *
     * The count is not cosmetic. The cell is the SIGN of this mean, and on the
     * symbols that matter it is decided by a single observation — the dollar
     * index averages -0.03% across nine Augusts, so which nine is the whole
     * answer.
     */
    const rets = all.slice(-SEASONALITY_YEARS);

    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const wins = rets.filter((r) => r > 0).length;
    out[month] = {
      meanPct: Math.round(mean * 100) / 100,
      winRatePct: Math.round((wins / rets.length) * 100),
      years: rets.length,
    };
  }
  return out;
}

/**
 * One symbol's technicals, plus what did not arrive with them.
 *
 * The monthly leg is reported separately because it fails INDEPENDENTLY and
 * silently: the daily series can be perfect while the 10-year monthly request
 * 429s, and the old code wrote `seasonality: {}` and moved on. That costs the
 * seasonality cell a ±1 with no `degraded` note anywhere — a score changing for
 * a reason the health table did not mention.
 */
interface TickerResult {
  technicals: Technicals;
  /** True when the daily series arrived but the monthly one did not. */
  seasonalityMissing: boolean;
}

async function computeForTicker(
  symbol: string,
  ticker: string,
  // Injected so a test can pin which month counts as in progress.
  now: Date = new Date(),
): Promise<TickerResult | null> {
  const isSpotFx = ticker.endsWith(SPOT_FX_SUFFIX);

  const raw = await fetchSeries(ticker, '2y', '1d', 3600);
  // Re-date before cutting, or a rewind to a Friday close drops that Friday.
  const fetched = raw && isSpotFx ? redateSpotFridays(raw) : raw;
  // Cut to `now` BEFORE the length guard, so a rewind far enough back to leave
  // too few bars declines to score rather than scoring a short window.
  const cut = fetched ? seriesAsOf(fetched, now) : null;

  /**
   * SPOT FX GETS ITS RECENT SESSIONS REBUILT FROM HOURLY BARS — see
   * `spliceFxSessions` for the three faults in Yahoo's `=X` daily series and the
   * measurement that pins this.
   *
   * The hourly series is cut to `now` FIRST. Bucketing uncut bars would put
   * prices from after the moment being reproduced inside the trailing session,
   * and a rewound board would read the future through it.
   */
  let daily = cut;
  if (cut && isSpotFx) {
    const hourly = await fetchSeries(ticker, HOURLY_RANGE, '1h', 3600);
    if (hourly) {
      const spliced = spliceFxSessions(cut, seriesAsOf(hourly, now));
      /**
       * `seriesAsOf` re-points `price` at the last close whenever it drops a
       * bar, because a live quote is an anachronism in a rewound series. The
       * splice changes WHICH bar is last, so that has to be redone — and only
       * when the series really was rewound, or the live board would trade
       * Yahoo's current quote for an hour-old bucket close.
       */
      const rewound = cut !== fetched;
      daily = rewound && spliced.closes.length > 0
        ? { ...spliced, price: spliced.closes[spliced.closes.length - 1] }
        : spliced;
    }
  }

  if (!daily || daily.closes.length < 20) return null;

  const { closes, price } = daily;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma100 = sma(closes, 100);
  const sma200 = sma(closes, 200);

  const smas = [sma20, sma50, sma100, sma200].filter((s): s is number => s !== null);
  const aboveCount = smas.length > 0 ? smas.filter((s) => price > s).length : null;

  // The trend pair. `smaSlowPrior` is the same average computed one bar back,
  // which is the only way to read its slope.
  const smaFast = sma(closes, TREND_SMA.fast);
  const smaSlow = sma(closes, TREND_SMA.slow);
  const priorCloses = closes.slice(0, -TREND_SLOPE_LOOKBACK_DAYS);
  const smaSlowPrior = priorCloses.length >= TREND_SMA.slow ? sma(priorCloses, TREND_SMA.slow) : null;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] !== 0) returns.push(closes[i] / closes[i - 1] - 1);
  }

  const meanAbs = (arr: number[]) =>
    arr.length ? (arr.reduce((a, b) => a + Math.abs(b), 0) / arr.length) * 100 : null;

  /**
   * SEASONALITY IS BUILT FROM THE DAILY SERIES, NOT YAHOO'S MONTHLY ONE.
   *
   * This used to fetch `range=11y&interval=1mo` and bucket that. The monthly
   * series is corrupt, which `fetchSeasonalHistory` above has said in prose for
   * as long as it has existed — "it returned March twice and omitted October for
   * EURUSD" — while this line went on consuming it anyway. The scanners built
   * from dailies for that reason; the SCORE did not, so one quantity had two
   * sources and the scored one was the bad one.
   *
   * It is worse than holes. Measured on EURUSD=X on 2026-08-24, the monthly
   * series carries TWO March bars in every one of the eleven years, and its
   * closes do not match the month they are stamped with. August returns, monthly
   * series against the same months derived from dailies:
   *
   *          2022     2023     2024     2025
   *   1mo   -1.95%   -3.15%   +0.98%   +0.39%
   *   1d    -1.66%   -1.40%   +2.37%   +2.35%
   *
   * The daily column is the real market: EURUSD ended July 2022 at 1.0223 and
   * August at 1.0054, which is -1.66%. The monthly column is not off by rounding,
   * it is off by about a month — the close stamped August is roughly September's.
   *
   * The cost of that was a scored cell with the wrong SIGN. Ten completed
   * Augusts average -0.85% off the monthly series and +0.19% off the dailies, so
   * EURUSD's seasonality scored -1 where A1 scores +1 — a two-point error on
   * that row, and the largest single term in its gap.
   *
   * `computeSeasonality` needs no change to accept this: it already dedupes by
   * year-month keeping the last bar, which turns a daily series into exactly the
   * month-end series it wants.
   *
   * AND IT COSTS NOTHING. This is the same call, with the same cache key and the
   * same 7-day TTL, that `fetchSeasonalHistories` already makes for the
   * seasonality scanner pages — so on any warm cache it is served from the one
   * already there, and the two surfaces can no longer disagree about the same
   * ten Augusts.
   */
  const monthlyFetched = await fetchSeasonalHistory(ticker);
  /**
   * Cut for the same reason, though it changes nothing at a week's rewind:
   * `computeSeasonality` already drops the in-progress month via `now`, and both
   * ends of a seven-day rewind sit in the same one. It matters for a rewind of
   * months or years, where the untruncated history would average Augusts that
   * had not happened yet.
   */
  const monthly = monthlyFetched ? seriesAsOf(monthlyFetched, now) : null;

  const technicals: Technicals = {
    symbol,
    price,
    smaFast,
    smaSlow,
    smaSlowPrior,
    sma20,
    sma50,
    sma100,
    sma200,
    aboveCount,
    smaCount: smas.length,
    realizedVolPct:
      returns.length >= 30 ? Math.round(stdev(returns.slice(-30)) * Math.sqrt(252) * 1000) / 10 : null,
    avgDailyMove7Pct: returns.length >= 7 ? Math.round((meanAbs(returns.slice(-7)) ?? 0) * 100) / 100 : null,
    avgDailyMove90Pct:
      returns.length >= 90 ? Math.round((meanAbs(returns.slice(-90)) ?? 0) * 100) / 100 : null,
    seasonality: monthly ? computeSeasonality(monthly.timestamps, monthly.closes, now) : {},
  };

  return { technicals, seasonalityMissing: monthly === null };
}

/**
 * Computes technicals for a set of symbols.
 *
 * Two passes, both batched. The second pass exists because a dropped symbol is
 * not a neutral outcome here: `scoreTrend` can never return 0, so losing one
 * symbol's technicals always moves its total by 1 to 3 points, and it used to do
 * that with nothing in the health table to explain it.
 */
export async function fetchTechnicals(
  symbols: { symbol: string; yahoo: string }[],
  /**
   * The moment being reproduced. Bars after it are dropped — see `seriesAsOf`.
   * Defaults to now, which drops nothing, so the live board is unaffected.
   */
  now: Date = new Date(),
): Promise<Result<Map<string, Technicals>>> {
  if (fixturesEnabled()) {
    /**
     * Fixtures captured before the 3/14 trend rework have no smaFast/smaSlow, so
     * they are filled with null rather than cast over. A null there makes
     * scoreTrend return null — an honest "no trend data" — where a cast would
     * have produced `undefined > undefined` and a silent -2 on every row.
     * Re-run `npm run fixtures` to populate them.
     */
    const fixture = (await import('@/fixtures/sample-technicals.json')).default as Partial<Technicals>[];
    const hydrated = fixture.map((t) => ({
      smaFast: null,
      smaSlow: null,
      smaSlowPrior: null,
      ...t,
    })) as Technicals[];
    return ok('technicals:fixture', new Map(hydrated.map((t) => [t.symbol, t])));
  }

  const out = new Map<string, Technicals>();
  const noSeasonality: string[] = [];

  /**
   * One pass over a list of symbols, returning the ones that produced nothing.
   *
   * Batched rather than fully parallel: 33 symbols x 2 series is 66 requests to
   * an undocumented endpoint, and firing those at once is a good way to get
   * blocked.
   */
  const pass = async (targets: { symbol: string; yahoo: string }[]) => {
    const missed: { symbol: string; yahoo: string }[] = [];
    const BATCH = 6;

    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((s) => computeForTicker(s.symbol, s.yahoo, now)));
      results.forEach((res, idx) => {
        if (!res) {
          missed.push(batch[idx]);
          return;
        }
        out.set(res.technicals.symbol, res.technicals);
        if (res.seasonalityMissing) noSeasonality.push(res.technicals.symbol);
      });
    }

    return missed;
  };

  /**
   * A second attempt at whatever the first pass dropped.
   *
   * This is the direct fix for the flicker. A null member used to be discarded
   * for the whole run — the only retry lived inside a single `fetchJson`, so a
   * batch member that lost a race with the shared Yahoo cooldown took its
   * symbol's trend cell (never 0, always ±1..3) out of the score until the next
   * cron. Retrying once costs at most a handful of requests and recovers the
   * transient case, which is nearly all of them.
   *
   * The retry is deliberately small and unbatched-in-time: the failures are
   * usually a rate limit, so the pause matters as much as the second attempt.
   */
  let failed = (await pass(symbols)).map((s) => s.symbol);

  const dropped = await pass(symbols.filter((s) => failed.includes(s.symbol)));
  const recovered = failed.length - dropped.length;
  failed = dropped.map((s) => s.symbol);

  if (out.size === 0) {
    return {
      ok: false,
      error: 'no technicals could be computed',
      source: YAHOO.name,
      fetchedAtUtc: new Date().toISOString(),
    };
  }

  /**
   * Both failure modes are reported, and they are genuinely different: a missing
   * symbol costs its whole row's technical cells, while a missing monthly series
   * costs only the ±1 seasonality cell. Neither may pass silently.
   */
  const notes = [
    failed.length > 0 ? `${failed.length} symbol(s) unavailable: ${failed.slice(0, 5).join(', ')}` : null,
    recovered > 0 ? `${recovered} recovered on retry` : null,
    noSeasonality.length > 0
      ? `${noSeasonality.length} symbol(s) without monthly history, seasonality unscored: ` +
        noSeasonality.slice(0, 5).join(', ')
      : null,
  ].filter(Boolean);

  return ok(YAHOO.name, out, notes.length > 0 ? notes.join('; ') : undefined);
}

// ---------------------------------------------------------------------------
// 2-year Treasury yield
// ---------------------------------------------------------------------------

export interface Yield2y {
  current: number;
  sma: number;
  /**
   * FRED's own observation date for `current`.
   *
   * Carried so a rewound board can be told apart from a live one at a glance.
   * The previous source had no observation date to carry, which is part of why
   * a 24bp stale quote went unnoticed for four rounds.
   */
  observedOn: string;
}

/** The health-table name for the 2-year yield, kept distinct from the bulk Yahoo row. */
/** The health-table name for the 2-year yield, kept distinct from the bulk Yahoo row. */
export const YIELD_2Y_SOURCE = 'FRED:DGS2';

/**
 * The US 2-year against its own 21-day average, REWOUND ON REQUEST.
 *
 * SOURCE CHANGED 2026-08-31, and the old one was wrong in two ways at once.
 * This read Yahoo's `2YY=F`, the CBOT 2-Year Yield future. A1's Asset Scorecard
 * names the row verbatim "US02Yield (21 day SMA)" — the CONSTANT-MATURITY
 * Treasury yield, which is FRED's DGS2 and not a futures contract on it. This
 * repo was already fetching DGS2 in lib/connectors/yields.ts for the sovereign
 * yield map, so the series their label names was one import away the whole time.
 *
 * AND THE OLD FEED WAS BROKEN, measured rather than suspected. On 2026-08-31
 * Yahoo's live quote read 3.961 while DGS2 read 4.20 for the same instrument on
 * the same day — 24bp apart — and its daily closes had sat at exactly 4.170 for
 * twelve consecutive sessions while DGS2 took ten distinct values over the same
 * window. The cell that comparison produced was a live quote from one regime
 * measured against closes from another.
 *
 * THAT ACCIDENT WAS SCORING TWO CELLS CORRECTLY, and losing them is the point.
 * XAUUSD and XAGUSD rates matched A1's +1 on the 2026-08-24 board because 3.961
 * sits 5% below 4.172. Under DGS2 the same board reads 4.24 against a 4.219
 * average — inside the flat band by 0.003 percentage points — and scores 0. An
 * agreement produced by a 24bp feed error is not a reproduction of their rule,
 * and this repo does not keep those. See the ledger, `rates:yield2y-source`.
 *
 * `asOf` closes the last look-ahead leak in `runBacktest`. It was previously
 * impossible: a stalled series cannot be rewound, only mis-cut. With a series
 * that moves, the cutoff is ordinary — and the DXY cell it produces at the
 * 2026-08-25 board is -1, which is what their own DXY card says ("the 2yr yield
 * is falling (dovish)").
 *
 * RETURNS A RESULT, not a bare null. This one source moves every commodity,
 * index and crypto row by +/-1 when it goes missing, so a failure has to be
 * visible in the health table rather than inferred from a board of zeroes.
 */
/**
 * The reading itself, split out from the fetch so the cutoff is testable
 * without a network stub — which is the whole of what went wrong here before.
 *
 * Null when the cut leaves fewer observations than the average needs, rather
 * than averaging whatever is there: a 6-day "21-day average" is a different
 * statistic wearing the same name.
 */
export function yield2yAsOf(
  observations: readonly DatedObservation[],
  asOf?: Date,
): Yield2y | null {
  const cutoff = asOf ? asOf.toISOString().slice(0, 10) : null;
  const pool = cutoff ? observations.filter((o) => o.date <= cutoff) : observations;
  if (pool.length < YIELD_SMA_DAYS) return null;

  const window = pool.slice(-YIELD_SMA_DAYS);
  const sma = window.reduce((a, b) => a + b.value, 0) / window.length;
  const latest = pool[pool.length - 1];
  return { current: latest.value, sma, observedOn: latest.date };
}

export async function fetchYield2y(asOf?: Date): Promise<Result<Yield2y | null>> {
  if (fixturesEnabled()) return ok(YIELD_2Y_SOURCE, null, 'offline: 2-year yield not captured as a fixture');

  const res = await fetchFredSeries('DGS2');
  if (!res.ok) return fail(YIELD_2Y_SOURCE, 'DGS2 unavailable');

  const reading = yield2yAsOf(res.data, asOf);
  if (!reading) {
    const cutoff = asOf ? asOf.toISOString().slice(0, 10) : null;
    return fail(
      YIELD_2Y_SOURCE,
      `fewer than the ${YIELD_SMA_DAYS} observations needed for the average` +
        (cutoff ? ` on or before ${cutoff}` : ''),
    );
  }
  return ok(YIELD_2Y_SOURCE, reading);
}
