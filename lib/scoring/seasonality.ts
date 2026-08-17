/**
 * Seasonality: what a market has typically done at this point in the calendar.
 *
 * Three granularities over one daily series — month of year, week of year, day
 * of week — which is the set A1's EdgeFinder publishes, over the same 1 / 5 / 10
 * year windows. Everything here is pure; the caller supplies the bars and the
 * clock.
 *
 * ONE RULE RUNS THROUGH ALL OF IT: a bucket's return is measured between two
 * CONSECUTIVE closes of that bucket type, and a gap is skipped rather than
 * bridged. Yahoo's history is not clean — its monthly series for EURUSD=X
 * returned March twice and omitted October entirely — and bridging a hole turns
 * two months into one 60-day "monthly" return, which is exactly how you
 * manufacture a seasonal edge that does not exist. Deriving every bucket from
 * daily bars removes most of that risk, and the consecutiveness check removes
 * the rest.
 *
 * WHAT THIS DOES NOT DO: it does not score. The `seasonality` cell on the
 * scorecard stays where it is, in `lib/scoring/technical.ts`, reading the sign
 * of the 10-year monthly mean. The lookback selector on the page is a display
 * control. Bias thresholds in this app are absolute, so a cell that changed
 * range with a dropdown would silently redefine "Bullish" on every symbol.
 */

import { SEASONALITY_MIN_YEARS } from '@/config/setups.config';
import type { DailyBars } from '@/lib/connectors/technicals';

/** The windows A1 offers. 10 is the one the scorecard cell reads. */
export const SEASONALITY_LOOKBACKS = [1, 5, 10] as const;
export type SeasonalityLookback = (typeof SEASONALITY_LOOKBACKS)[number];

export type SeasonalBucketKind = 'month' | 'week' | 'weekday';

export interface SeasonalBucket {
  /** 1-12 for months, 1-53 for ISO weeks, 1-5 for Mon-Fri. */
  key: number;
  meanPct: number;
  /** The median matters: one 2008 outlier can carry a mean on its own. */
  medianPct: number;
  winRatePct: number;
  bestPct: number;
  worstPct: number;
  /** How many observations the numbers above are made of. */
  samples: number;
  /**
   * False when `samples` is below the floor. The bucket is still returned with
   * its numbers, because hiding it and showing nothing are different claims —
   * the UI greys it rather than dropping it.
   */
  reliable: boolean;
}

export interface SeasonalProfile {
  kind: SeasonalBucketKind;
  lookbackYears: number;
  /** Sparse: a bucket with no observations at all is absent, never zero. */
  buckets: Map<number, SeasonalBucket>;
  /** Calendar years actually covered, which can be under `lookbackYears`. */
  yearsCovered: number;
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

/**
 * ISO-8601 week number. Not `Math.floor(dayOfYear / 7)`.
 *
 * The naive form drifts: it puts the same calendar week in different slots in
 * different years, which is the one thing a week-of-year average must not do.
 * ISO pins week 1 to the week containing the first Thursday, so week 34 is
 * comparable to week 34 a decade ago.
 */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday of this week decides which year — and therefore which week — it is.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

/**
 * The year an ISO week belongs to, which is not always the calendar year: 1
 * January 2027 falls in ISO week 53 of 2026. Ordering weeks by calendar year
 * would put that observation before the December one it follows.
 */
export function isoWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

interface Period {
  /** Which calendar bucket this observation belongs to. */
  key: number;
  /**
   * Identity of this specific occurrence — August 2025, not "August". Used to
   * collapse the many daily bars in a period down to one, and to sort. NOT used
   * to decide adjacency; see `isAdjacent`.
   */
  id: number;
  close: number;
  /** The stamp of the bar that closed this period, for the lookback window. */
  endSeconds: number;
}

const DAY = 86_400;

/**
 * The id `toPeriods` would give the period `now` falls in.
 *
 * Exists so the in-progress period can be dropped. A part-finished August is
 * not an observation of "what August does" — it is seventeen days of August
 * wearing a full month's clothes, and averaging it in is how a month whose
 * completed history is flat ends up with a confident sign on it.
 *
 * The id formulas MUST match `toPeriods` exactly; they are duplicated here
 * rather than shared because inverting that function for a bare Date would cost
 * more clarity than the six lines it saves.
 */
function currentPeriodId(kind: SeasonalBucketKind, now: Date): number {
  if (kind === 'month') return now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
  if (kind === 'week') return isoWeekYear(now) * 53 + isoWeek(now);
  return Math.floor(now.getTime() / 1000 / DAY);
}

/**
 * Whether two consecutive observations really are consecutive periods, or
 * whether the feed lost one in between.
 *
 * MEASURED IN DAYS, not in the period id, for weeks and weekdays. The obvious
 * `isoWeekYear * 53 + week` arithmetic looks like it makes adjacent weeks differ
 * by one, and it does — but only in a 53-week year. In a 52-week year the step
 * from week 52 to week 1 of the next year is 2, so an id-based check would have
 * silently dropped the December-to-January return in five years out of six. A
 * day distance has no such seam.
 *
 * Months are exact: `year * 12 + month` has no boundary case, because there are
 * always twelve.
 */
function isAdjacent(kind: SeasonalBucketKind, prev: Period, cur: Period): boolean {
  if (kind === 'month') return cur.id - prev.id === 1;

  const days = (cur.endSeconds - prev.endSeconds) / DAY;

  // A week apart, with slack for a holiday moving the closing bar by a day or
  // two in either direction.
  if (kind === 'week') return days >= 4 && days <= 10;

  // Consecutive sessions. Friday to Monday is 3; a public holiday makes it 4.
  return days >= 1 && days <= 4;
}

/**
 * Collapses daily bars into one closing observation per period.
 *
 * Last close wins, which is what "the month closed at" means. Deduping happens
 * for free: two bars stamped in the same month leave one entry.
 */
function toPeriods(bars: DailyBars, kind: SeasonalBucketKind): Period[] {
  const byPeriod = new Map<number, Period>();

  for (let i = 0; i < bars.closes.length; i++) {
    const close = bars.closes[i];
    if (!Number.isFinite(close)) continue;

    const d = new Date(bars.timestamps[i] * 1000);
    let key: number;
    let id: number;

    if (kind === 'month') {
      key = d.getUTCMonth() + 1;
      id = d.getUTCFullYear() * 12 + key;
    } else if (kind === 'week') {
      key = isoWeek(d);
      // Unique per occurrence — 53 slots so week 53 never collides with the
      // next year's week 1. Adjacency is decided by day distance, not by this.
      id = isoWeekYear(d) * 53 + key;
    } else {
      /**
       * Weekday returns are DAY-OVER-DAY, so the bucket is the day the return
       * LANDS on. Monday's number is therefore the weekend gap plus Monday's
       * session, which is the honest reading of "what does Monday do" for a
       * market that does not trade Sunday.
       */
      key = d.getUTCDay();
      if (key === 0 || key === 6) continue; // no weekend sessions to average
      id = Math.floor(bars.timestamps[i] / DAY);
    }

    byPeriod.set(id, { key, id, close, endSeconds: bars.timestamps[i] });
  }

  return [...byPeriod.values()].sort((a, b) => a.endSeconds - b.endSeconds);
}

function stats(returns: number[], key: number): SeasonalBucket {
  const sorted = [...returns].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  const round = (v: number) => Math.round(v * 100) / 100;

  return {
    key,
    meanPct: round(returns.reduce((a, b) => a + b, 0) / returns.length),
    medianPct: round(median),
    winRatePct: Math.round((returns.filter((r) => r > 0).length / returns.length) * 100),
    bestPct: round(sorted[sorted.length - 1]),
    worstPct: round(sorted[0]),
    samples: returns.length,
    reliable: returns.length >= SEASONALITY_MIN_YEARS,
  };
}

/**
 * Average return per calendar bucket, over the last N years.
 *
 * `now` is injected rather than read, so a test can pin the window and the
 * backtest can ask what this looked like on a past date.
 */
export function buildProfile(
  bars: DailyBars,
  kind: SeasonalBucketKind,
  lookbackYears: number,
  now: Date = new Date(),
): SeasonalProfile {
  const cutoff = Date.UTC(now.getUTCFullYear() - lookbackYears, now.getUTCMonth(), now.getUTCDate()) / 1000;
  const inProgress = currentPeriodId(kind, now);

  const periods = toPeriods(bars, kind);
  const returns = new Map<number, number[]>();
  const years = new Set<number>();

  for (let i = 1; i < periods.length; i++) {
    const prev = periods[i - 1];
    const cur = periods[i];

    /**
     * The window is applied to the CURRENT period, not the previous one, so a
     * return straddling the cutoff is either wholly in or wholly out. Filtering
     * the bar list first would have dropped the previous close and silently
     * bridged the first observation across the boundary.
     */
    if (!isAdjacent(kind, prev, cur)) continue;
    if (prev.close === 0) continue;

    if (cur.endSeconds < cutoff) continue;
    /**
     * The period we are standing in has not finished, so its return is not yet
     * a return. It stays out of the average and out of the win rate; the strip
     * still draws its bucket from the completed years, which is what the
     * outline on the current bar is pointing at.
     */
    if (cur.id === inProgress) continue;

    const list = returns.get(cur.key) ?? [];
    list.push((cur.close / prev.close - 1) * 100);
    returns.set(cur.key, list);
    years.add(new Date(cur.endSeconds * 1000).getUTCFullYear());
  }

  const buckets = new Map<number, SeasonalBucket>();
  for (const [key, rets] of returns) {
    if (rets.length > 0) buckets.set(key, stats(rets, key));
  }

  return { kind, lookbackYears, buckets, yearsCovered: years.size };
}

// ---------------------------------------------------------------------------
// Cross-symbol scanner
// ---------------------------------------------------------------------------

export interface SeasonalRankRow {
  symbol: string;
  label: string;
  bucket: SeasonalBucket | null;
}

/**
 * Every symbol ranked by one bucket's mean, strongest tendency first.
 *
 * Symbols with no observation for that bucket sort to the bottom rather than
 * being dropped: "we have no history for BTC in this week" is information, and
 * a missing row reads as a symbol that does not exist.
 */
export function rankByBucket(
  profiles: { symbol: string; label: string; profile: SeasonalProfile | null }[],
  bucketKey: number,
): SeasonalRankRow[] {
  return profiles
    .map(({ symbol, label, profile }) => ({
      symbol,
      label,
      bucket: profile?.buckets.get(bucketKey) ?? null,
    }))
    .sort((a, b) => {
      if (!a.bucket) return 1;
      if (!b.bucket) return -1;
      return b.bucket.meanPct - a.bucket.meanPct;
    });
}

/** Which bucket "now" falls in, for whichever granularity is on screen. */
export function currentBucket(kind: SeasonalBucketKind, now: Date = new Date()): number {
  if (kind === 'month') return now.getUTCMonth() + 1;
  if (kind === 'week') return isoWeek(now);
  return now.getUTCDay();
}
