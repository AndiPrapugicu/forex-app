/**
 * Technical scorecard cells: trend and seasonality.
 *
 * Both are computed per SYMBOL rather than per currency, because a trend only
 * exists relative to a specific pair. EURUSD trending up says nothing directly
 * about EURJPY, so unlike the fundamental columns these are not derived by
 * subtracting two legs.
 */

import {
  SEASONALITY_CELL_MAX_BY_KIND,
  SEASONALITY_MIN_YEARS,
  TREND_SMA,
  YIELD_FLAT_BAND,
  YIELD_SMA_DAYS,
} from '@/config/setups.config';
import type { SymbolKind } from '@/config/symbols.config';
import type { Technicals } from '@/lib/connectors/technicals';

export interface TrendScore {
  cell: number;
  /** +2 or -2: where the fast average sits relative to the slow one. */
  crossover: number;
  /** +1 or -1: which way the slow average is pointing. */
  slope: number;
  /** True when crossover and slope disagree, which costs a point. */
  conflicted: boolean;
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
 * Trend, exactly as A1 publishes it at a1trading.com/edgefinder/trend/.
 *
 * THE CROSSOVER IS THE SCORE. The slope is only a modifier:
 *
 *   crossover   3-day above 14-day -> +2, below -> -2
 *   slope       14-day rising -> +1, falling or flat -> -1  (a CLASSIFICATION,
 *               not an addend)
 *
 * and their combination rule, verbatim: "If the crossover score is positive
 * (bullish), it subtracts 1 if the 14-day slope is negative. If the crossover
 * score is negative (bearish), it adds 1 if the 14-day slope is positive."
 *
 * Nothing is added when the two agree, so the range is +/-2 and the values are
 * {-2, -1, +1, +2}.
 *
 * THIS WAS WRONG BEFORE. Reading the "+1 / -1" slope line as an addend gave
 * `crossover + slope` and a range of +/-3, which put Gold on Trend +3 — a value
 * their model cannot produce. The published adjustment rule only makes sense if
 * the crossover alone is the baseline; otherwise stating it separately would be
 * redundant with the addition.
 *
 * We earlier counted how many of the 20/50/100/200-day averages price sat above.
 * That was inferred from a screenshot and is a different indicator; the long
 * averages remain on the scorecard as context.
 */
export function scoreTrend(tech: Technicals | undefined): TrendScore | null {
  if (!tech || tech.smaFast === null || tech.smaSlow === null || tech.smaSlowPrior === null) {
    return null;
  }

  const crossover = tech.smaFast > tech.smaSlow ? 2 : -2;
  // Flat counts as down: A1's rule is "Slope Downward or Flat: -1".
  const slope = tech.smaSlow > tech.smaSlowPrior ? 1 : -1;

  const conflicted = Math.sign(crossover) !== Math.sign(slope);
  // Agreement leaves the crossover untouched; disagreement costs exactly one.
  const cell = conflicted ? crossover - Math.sign(crossover) : crossover;

  const { fast, slow } = TREND_SMA;
  return {
    cell,
    crossover,
    slope,
    conflicted,
    explanation:
      `${fast}-day average is ${crossover > 0 ? 'above' : 'below'} the ${slow}-day, ` +
      `and the ${slow}-day is ${slope > 0 ? 'rising' : 'flat or falling'}` +
      (conflicted ? ' — they disagree, so the crossover is docked a point.' : '.'),
  };
}

/**
 * Seasonal tendency for the current calendar month.
 *
 * A1's rule is the SIGN of the 10-year average and nothing else: "If the current
 * month's 10 year historical average performance is positive, the EdgeFinder
 * assigns a +2 [or +1]". Indices, commodities and crypto get the doubled weight
 * "because seasonal tendencies are very pronounced" there; FX gets +/-1.
 *
 * We used to gate this behind a mean-return and win-rate threshold, on the
 * reasoning that a +2% average driven by one outlier year is not a tendency.
 * That reasoning still holds — which is why both figures are still returned and
 * rendered — but it is our opinion, not their rule, so only the sign votes.
 */
export function scoreSeasonality(
  tech: Technicals | undefined,
  now = new Date(),
  kind: SymbolKind = 'fx',
): SeasonalityScore | null {
  if (!tech) return null;

  const month = now.getUTCMonth() + 1;
  const stats = tech.seasonality[month];
  if (!stats) return null;

  // Too few observations to distinguish tendency from noise.
  if (stats.years < SEASONALITY_MIN_YEARS) return null;

  const { meanPct, winRatePct } = stats;
  const magnitude = SEASONALITY_CELL_MAX_BY_KIND[kind];
  const cell = meanPct > 0 ? magnitude : meanPct < 0 ? -magnitude : 0;

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
 * The interest-rate reading for NON-FX assets: the US 2-year against its 7-day
 * average.
 *
 * A1's rule, verbatim: "If price is above the moving average, -1. If price is
 * below the moving average, +1". The sign is already expressed FROM THE ASSET'S
 * POINT OF VIEW — a rising short yield tightens financial conditions, which is
 * bearish for indices, gold and crypto alike. So unlike our old version there is
 * no inversion left for the caller to apply.
 *
 * The window was 21 days here; their rule says 7.
 */
export function scoreYield2y(
  current: number | null,
  sma: number | null,
): YieldScore | null {
  if (current === null || sma === null || sma === 0) return null;

  const flat = Math.abs(current - sma) / sma < YIELD_FLAT_BAND;
  const rising = current > sma;

  return {
    // Above the average is a headwind for risk assets, hence the negative.
    cell: flat ? 0 : rising ? -1 : 1,
    yield: Math.round(current * 1000) / 1000,
    sma: Math.round(sma * 1000) / 1000,
    explanation: flat
      ? `2-year yield ${current.toFixed(2)}% is flat against its ${YIELD_SMA_DAYS}-day average (${sma.toFixed(2)}%).`
      : `2-year yield ${current.toFixed(2)}% is ${rising ? 'above' : 'below'} its ${YIELD_SMA_DAYS}-day average ` +
        `(${sma.toFixed(2)}%) — ${rising ? 'tightening, a headwind' : 'easing, a tailwind'}.`,
  };
}
