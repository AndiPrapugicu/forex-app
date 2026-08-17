/**
 * Does the score predict anything?
 *
 * Until this exists the scorecard is an elaborate opinion. It says a pair is
 * Very Bullish; nobody — not us, not A1, who publish no numbers either — has
 * shown that a +9 does better than a +3. This replays the real engine over past
 * dates and measures what happened next.
 *
 * IT REPLAYS `buildSetupsMatrix` RATHER THAN REIMPLEMENTING IT. A backtest of a
 * parallel scoring path measures the parallel path, and the two drift the first
 * time a rule changes. Every historical score here comes from the same function
 * the live board calls.
 *
 * LOOK-AHEAD IS THE WHOLE DIFFICULTY, and it is not hypothetical here:
 * `resolveSeries` picks the most recent matching release with no regard for
 * whether it has happened yet. That is correct live, where unreleased events
 * carry a null actual, and catastrophic in a replay, where every future print is
 * already populated. So the harness filters all three inputs to <= T before
 * calling the engine, and `asOf` below is the only place that can go wrong.
 */

import type { Bias } from '@/config/setups.config';
import type { CotSeries } from '@/lib/connectors/cftc';
import type { DailyBars } from '@/lib/connectors/technicals';
import type { Technicals } from '@/lib/connectors/technicals';
import { TREND_SMA, TREND_SLOPE_LOOKBACK_DAYS } from '@/config/setups.config';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import type { NormalizedEvent } from '@/lib/types';

/** Forward horizons in trading days. */
export const DEFAULT_HORIZONS = [1, 5, 20] as const;

export interface BacktestInput {
  events: NormalizedEvent[];
  cot: Map<string, CotSeries>;
  /** Raw daily bars per symbol — the backtest needs the series, not a snapshot. */
  bars: Map<string, DailyBars>;
  /** Per-symbol seasonality, which is by calendar month and so date-independent. */
  seasonality: Map<string, Technicals['seasonality']>;
  horizons?: readonly number[];
  /** Skip the first N bars so the 14-day average has history behind it. */
  warmupBars?: number;
}

export interface Observation {
  symbol: string;
  dateUtc: string;
  score: number;
  bias: Bias;
  /** Percent change from this bar's close, per horizon. Null past the series end. */
  forward: Record<number, number | null>;
}

export interface BucketStats {
  bias: Bias;
  n: number;
  /** Mean forward return, percent. */
  meanPct: number;
  medianPct: number;
  /**
   * Share where the move went the way the bias called it, percent.
   *
   * Neutral has no direction to be right about, so it is reported as null rather
   * than as a coin flip.
   */
  hitRatePct: number | null;
}

export interface HorizonResult {
  horizon: number;
  buckets: BucketStats[];
  /**
   * Every observation pooled, ignoring the score.
   *
   * The number that stops a backtest lying: if everything rose, Very Bullish
   * looks predictive without having predicted anything. A bucket is only
   * interesting relative to this.
   */
  baseline: { n: number; meanPct: number; medianPct: number };
}

// ---------------------------------------------------------------------------
// As-of reconstruction
// ---------------------------------------------------------------------------

function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const window = closes.slice(-n);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

/**
 * The technicals a symbol had at bar `i`, computed from bars up to and
 * including it.
 *
 * Only the fields the scoring engine reads are populated. The long averages and
 * volatility are context on the live card and do not feed a cell, so leaving
 * them null cannot change a score — and filling them with today's values would
 * be the exact look-ahead this module exists to avoid.
 */
export function technicalsAsOf(
  symbol: string,
  bars: DailyBars,
  i: number,
  seasonality: Technicals['seasonality'],
): Technicals {
  const upTo = bars.closes.slice(0, i + 1);
  const prior = upTo.slice(0, -TREND_SLOPE_LOOKBACK_DAYS);

  return {
    symbol,
    price: upTo[upTo.length - 1],
    smaFast: sma(upTo, TREND_SMA.fast),
    smaSlow: sma(upTo, TREND_SMA.slow),
    smaSlowPrior: prior.length >= TREND_SMA.slow ? sma(prior, TREND_SMA.slow) : null,
    sma20: null,
    sma50: null,
    sma100: null,
    sma200: null,
    aboveCount: null,
    smaCount: 0,
    realizedVolPct: null,
    avgDailyMove7Pct: null,
    avgDailyMove90Pct: null,
    seasonality,
  };
}

/**
 * Trims every input to what was knowable at `at`.
 *
 * Three separate cut-offs, because each source leaks differently: calendar
 * events carry future actuals, COT reports are published days after their
 * survey date, and bars extend to today.
 */
export function asOf(input: BacktestInput, at: Date) {
  const iso = at.toISOString();

  const events = input.events.filter((e) => e.dateUtc <= iso);

  const cot = new Map<string, CotSeries>();
  for (const [contract, series] of input.cot) {
    // reportDate is the Tuesday surveyed; anything later was not public yet.
    const reports = series.reports.filter((r) => r.reportDate <= iso.slice(0, 10));
    if (reports.length > 0) cot.set(contract, { contract, reports });
  }

  return { events, cot };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Percent change between two closes. */
function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from === 0) return null;
  return ((to - from) / from) * 100;
}

/**
 * Replays the board across every bar of a reference symbol's history.
 *
 * Dates come from one symbol's bars rather than a calendar walk so that every
 * observation lands on a real trading day with a real close to measure from.
 */
export function runBacktest(input: BacktestInput, referenceSymbol = 'EURUSD'): Observation[] {
  const horizons = input.horizons ?? DEFAULT_HORIZONS;
  const warmup = input.warmupBars ?? TREND_SMA.slow + TREND_SLOPE_LOOKBACK_DAYS;

  const reference = input.bars.get(referenceSymbol);
  if (!reference) return [];

  const out: Observation[] = [];
  const maxHorizon = Math.max(...horizons);

  for (let i = warmup; i < reference.timestamps.length - 1; i++) {
    const at = new Date(reference.timestamps[i] * 1000);
    const { events, cot } = asOf(input, at);

    // Technicals for every symbol as of this bar, matched by timestamp so a
    // symbol that did not trade that day is simply absent rather than shifted.
    const technicals = new Map<string, Technicals>();
    const barIndex = new Map<string, number>();
    for (const [symbol, bars] of input.bars) {
      const j = lastIndexAtOrBefore(bars.timestamps, reference.timestamps[i]);
      if (j < warmup) continue;
      barIndex.set(symbol, j);
      technicals.set(symbol, technicalsAsOf(symbol, bars, j, input.seasonality.get(symbol) ?? {}));
    }

    const matrix = buildSetupsMatrix({ events, cot, technicals, now: at });

    for (const row of matrix.rows) {
      // A row with nothing populated is an outage, not a neutral view.
      if (row.populated === 0) continue;

      const bars = input.bars.get(row.symbol);
      const j = barIndex.get(row.symbol);
      if (!bars || j === undefined) continue;
      if (j + maxHorizon >= bars.closes.length) continue; // no room to measure

      const forward: Record<number, number | null> = {};
      for (const h of horizons) forward[h] = pctChange(bars.closes[j], bars.closes[j + h]);

      out.push({
        symbol: row.symbol,
        dateUtc: at.toISOString(),
        score: row.totalScore,
        bias: row.bias,
        forward,
      });
    }
  }

  return out;
}

/** Index of the last bar at or before `ts`, or -1. */
function lastIndexAtOrBefore(timestamps: number[], ts: number): number {
  let lo = 0;
  let hi = timestamps.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timestamps[mid] <= ts) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const BIAS_ORDER: Bias[] = ['Very Bearish', 'Bearish', 'Neutral', 'Bullish', 'Very Bullish'];

/** Which way a bias expects price to go. Neutral expects nothing. */
function direction(bias: Bias): number {
  if (bias.includes('Bullish')) return 1;
  if (bias.includes('Bearish')) return -1;
  return 0;
}

export function summarise(
  observations: Observation[],
  horizons: readonly number[] = DEFAULT_HORIZONS,
): HorizonResult[] {
  return horizons.map((horizon) => {
    const usable = observations.filter((o) => o.forward[horizon] !== null);
    const all = usable.map((o) => o.forward[horizon] as number);

    const buckets = BIAS_ORDER.map((bias) => {
      const rows = usable.filter((o) => o.bias === bias);
      const rets = rows.map((o) => o.forward[horizon] as number);
      const dir = direction(bias);
      const hits = dir === 0 ? null : rets.filter((r) => Math.sign(r) === dir).length;

      return {
        bias,
        n: rows.length,
        meanPct: rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0,
        medianPct: median(rets),
        hitRatePct: hits === null || rets.length === 0 ? null : (hits / rets.length) * 100,
      };
    });

    return {
      horizon,
      buckets,
      baseline: {
        n: all.length,
        meanPct: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0,
        medianPct: median(all),
      },
    };
  });
}

export interface SpreadWindow {
  date: string;
  bullish: number | null;
  bearish: number | null;
  /** bullish − bearish. The long-short spread the score would have earned. */
  spread: number | null;
  n: number;
}

/**
 * The bullish-minus-bearish spread, one row per date.
 *
 * THE RAW OBSERVATION COUNT IS MISLEADING and this is the correction. Four
 * thousand observations sounds decisive; they are 49 symbols across ~100 dates,
 * and neither axis is independent. On any given day EURUSD, GBPUSD, AUDUSD and
 * gold are largely one dollar trade, so a single dollar move writes itself into
 * dozens of rows. Overlapping forward windows compound it — consecutive dates
 * share almost all of their 20-day return.
 *
 * Collapsing to one spread per date removes the cross-sectional duplication, and
 * sampling those dates `horizon` apart removes the overlap. What survives is a
 * handful of genuinely independent windows, which is the honest sample size.
 */
export function spreadByDate(observations: Observation[], horizon: number): SpreadWindow[] {
  const byDate = new Map<string, Observation[]>();
  for (const o of observations) {
    if (o.forward[horizon] === null) continue;
    const key = o.dateUtc.slice(0, 10);
    byDate.set(key, [...(byDate.get(key) ?? []), o]);
  }

  const mean = (rows: Observation[]) =>
    rows.length === 0 ? null : rows.reduce((a, o) => a + (o.forward[horizon] as number), 0) / rows.length;

  return [...byDate.entries()]
    .map(([date, rows]) => {
      const bullish = mean(rows.filter((o) => o.bias.includes('Bullish')));
      const bearish = mean(rows.filter((o) => o.bias.includes('Bearish')));
      return {
        date,
        bullish,
        bearish,
        spread: bullish !== null && bearish !== null ? bullish - bearish : null,
        n: rows.length,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Independent windows only: every `horizon`-th date, so no two forward returns
 * overlap.
 */
export function independentWindows(windows: SpreadWindow[], horizon: number): SpreadWindow[] {
  return windows.filter((w, i) => i % horizon === 0 && w.spread !== null);
}

/**
 * Mean forward return per score value, for spotting whether the relationship is
 * monotonic or whether the bands are simply mislabelled.
 *
 * A model can have a real edge that the bias cuts throw away — if +4 and +9
 * behave identically, the threshold is wrong rather than the score.
 */
export function byScore(
  observations: Observation[],
  horizon: number,
): { score: number; n: number; meanPct: number }[] {
  const groups = new Map<number, number[]>();
  for (const o of observations) {
    const r = o.forward[horizon];
    if (r === null) continue;
    const list = groups.get(o.score) ?? [];
    list.push(r);
    groups.set(o.score, list);
  }

  return [...groups.entries()]
    .map(([score, rets]) => ({
      score,
      n: rets.length,
      meanPct: rets.reduce((a, b) => a + b, 0) / rets.length,
    }))
    .sort((a, b) => a.score - b.score);
}
