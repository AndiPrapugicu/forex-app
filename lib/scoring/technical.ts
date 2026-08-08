/**
 * Technical scorecard cells: trend and seasonality.
 *
 * Both are computed per SYMBOL rather than per currency, because a trend only
 * exists relative to a specific pair. EURUSD trending up says nothing directly
 * about EURJPY, so unlike the fundamental columns these are not derived by
 * subtracting two legs.
 */

import {
  SEASONALITY_BUCKETS,
  SEASONALITY_CELL_MAX,
  TREND_BUCKETS,
} from '@/config/setups.config';
import type { Technicals } from '@/lib/connectors/technicals';

export interface TrendScore {
  cell: number;
  aboveCount: number;
  smaCount: number;
  explanation: string;
}

export interface SeasonalityScore {
  cell: number;
  month: number;
  meanPct: number;
  winRatePct: number;
  years: number;
  explanation: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Trend, read SHORT-TERM from the 20- and 50-day averages.
 *
 * Counting all four averages scored gold 0 — it sits above the 20 and 50 but
 * below the 100 and 200 — where the reference product reads +2. Their "4H /
 * Daily Chart Trend" is a near-term measure, so this follows suit. The 100- and
 * 200-day averages remain on the scorecard as context; they simply do not vote.
 */
export function scoreTrend(tech: Technicals | undefined): TrendScore | null {
  if (!tech || tech.sma20 === null || tech.sma50 === null) return null;

  const above = [tech.sma20, tech.sma50].filter((sma) => tech.price > sma).length;
  const cell = TREND_BUCKETS[above] ?? 0;

  const description =
    above === 2
      ? 'above both short-term moving averages'
      : above === 0
        ? 'below both short-term moving averages'
        : 'between its short-term moving averages';

  return {
    cell,
    aboveCount: above,
    smaCount: 2,
    explanation: `Price is ${description} (20/50-day).`,
  };
}

/**
 * Seasonal tendency for the current calendar month.
 *
 * Requires BOTH a meaningful average move and a consistent win rate. A +2%
 * average driven by one outlier year is not a seasonal tendency, and scoring it
 * as one is how backtest artefacts end up on a dashboard.
 */
export function scoreSeasonality(
  tech: Technicals | undefined,
  now = new Date(),
): SeasonalityScore | null {
  if (!tech) return null;

  const month = now.getUTCMonth() + 1;
  const stats = tech.seasonality[month];
  if (!stats) return null;

  // Too few observations to distinguish tendency from noise.
  const MIN_YEARS = 5;
  if (stats.years < MIN_YEARS) return null;

  const { meanPct, winRatePct } = stats;

  let cell = 0;
  const bullishStrong = meanPct >= SEASONALITY_BUCKETS.strongPct && winRatePct >= SEASONALITY_BUCKETS.strongWinRate;
  const bearishStrong =
    meanPct <= -SEASONALITY_BUCKETS.strongPct && winRatePct <= 100 - SEASONALITY_BUCKETS.strongWinRate;

  // Capped at +/-1: seasonality is the weaker half of the technical pair, and
  // letting it reach +/-2 would give a 10-year average as much weight as the
  // live trend.
  if (bullishStrong) cell = SEASONALITY_CELL_MAX;
  else if (bearishStrong) cell = -SEASONALITY_CELL_MAX;
  else if (meanPct >= SEASONALITY_BUCKETS.mildPct) cell = SEASONALITY_CELL_MAX;
  else if (meanPct <= -SEASONALITY_BUCKETS.mildPct) cell = -SEASONALITY_CELL_MAX;

  return {
    cell,
    month,
    meanPct,
    winRatePct,
    years: stats.years,
    explanation:
      `${MONTH_NAMES[month - 1]} has averaged ${meanPct > 0 ? '+' : ''}${meanPct}% over ` +
      `${stats.years} years, higher ${winRatePct}% of the time.`,
  };
}

// ---------------------------------------------------------------------------
// 2-year yield
// ---------------------------------------------------------------------------

export interface YieldScore {
  cell: number;
  yield: number;
  sma: number;
  explanation: string;
}

/**
 * 2-year Treasury yield against its own 21-day average.
 *
 * Direction, not level: a rising short yield prices in a tighter Fed, which is
 * bullish for the dollar and therefore bearish for gold and for everything
 * quoted against USD. Scored for the DOLLAR, so consumers invert it the same way
 * they do any other USD reading.
 */
export function scoreYield2y(
  current: number | null,
  sma: number | null,
): YieldScore | null {
  if (current === null || sma === null || sma === 0) return null;

  const rising = current > sma;
  const flat = Math.abs(current - sma) / sma < 0.005; // within 0.5%, call it flat

  return {
    cell: flat ? 0 : rising ? 1 : -1,
    yield: Math.round(current * 1000) / 1000,
    sma: Math.round(sma * 1000) / 1000,
    explanation: flat
      ? `2-year yield ${current.toFixed(2)}% is flat against its 21-day average (${sma.toFixed(2)}%).`
      : `2-year yield ${current.toFixed(2)}% is ${rising ? 'above' : 'below'} its 21-day average ` +
        `(${sma.toFixed(2)}%) — ${rising ? 'hawkish, bullish USD' : 'dovish, bearish USD'}.`,
  };
}
