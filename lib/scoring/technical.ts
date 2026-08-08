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
 * Trend from how many moving averages the price sits above.
 *
 * Requires all four to be available. A symbol with under 200 sessions of history
 * would otherwise be scored on a two-average "trend" that is not comparable with
 * everything else in the column.
 */
export function scoreTrend(tech: Technicals | undefined): TrendScore | null {
  if (!tech || tech.aboveCount === null || tech.smaCount < 4) return null;

  const cell = TREND_BUCKETS[tech.aboveCount] ?? 0;

  const description =
    tech.aboveCount === 4
      ? 'above all four moving averages'
      : tech.aboveCount === 0
        ? 'below all four moving averages'
        : `above ${tech.aboveCount} of 4 moving averages`;

  return {
    cell,
    aboveCount: tech.aboveCount,
    smaCount: tech.smaCount,
    explanation: `Price is ${description} (20/50/100/200-day).`,
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

  if (bullishStrong) cell = 2;
  else if (bearishStrong) cell = -2;
  else if (meanPct >= SEASONALITY_BUCKETS.mildPct) cell = 1;
  else if (meanPct <= -SEASONALITY_BUCKETS.mildPct) cell = -1;

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
