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
  /** (fast − slow) / slow, in percent. How far the crossover is from flipping. */
  marginPct: number;
  /**
   * True when |marginPct| is inside TREND_NEAR_FLIP_PCT. DISPLAY ONLY — it never
   * changes the cell. It exists because a 2-pip crossover is the same score as a
   * 200-pip one, and a board read a session apart can flip on it.
   */
  nearFlip: boolean;
  explanation: string;
}

/**
 * A crossover this close can flip on the next close. Presentation threshold,
 * not a scoring one: measured on AUDUSD 2026-09-11, SMA3 sat 0.03% under SMA14
 * and A1's board, read two sessions earlier, printed +2 against our -1.
 */
export const TREND_NEAR_FLIP_PCT = 0.05;

export interface SeasonalityScore {
  cell: number;
  month: number;
  meanPct: number;
  winRatePct: number;
  years: number;
  explanation: string;
  /**
   * The PREVIOUS calendar month's cell, when it differs from this one.
   *
   * CONTEXT ONLY. It is never summed, never in `totalScore`, and exists for a
   * single measured reason: A1 does not roll this column at the month turn.
   * Scoring their 2026-09-01 board against our August signs matches 45 of 51
   * (88.2%) where September matches 25 (49.0%, chance), and on the 26 rows
   * where our two months disagree they sided with August 23 times.
   *
   * That 88% is the evidence our monthly averages agree with theirs, so the
   * divergence is a refresh cadence rather than a defect on either side — and
   * chasing it would mean deliberately scoring a month that has ended. Showing
   * it is the honest middle: the user sees why our cell differs from the one on
   * their screen without us pretending August is still current.
   *
   * Null when the two months agree, or when the previous month has too few
   * observations to score. Null is not "no lag" — it is "nothing to say".
   */
  previousMonthCell: number | null;
  /** The previous month's name, for the tooltip. Null whenever the cell is. */
  previousMonthName: string | null;
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

  /**
   * THE CONFLICTED STATES COST A POINT. The crossover is the baseline; a slow
   * average pointing the other way docks one, and never flips the sign.
   *
   * THIS WAS CHANGED AND CHANGED BACK ON 2026-09-01, and the round trip is the
   * most useful thing in this comment.
   *
   * Cross-tabulating A1's printed cell against this same (crossover, slope)
   * state over 51 symbols and TWO captures made the `cross -, slope +` quadrant
   * look like +2 at 67% (n=18), so it was adopted. A THIRD capture, taken five
   * hours after the second on the same day, pulled that quadrant to a coin flip
   * and put -1 back in front. Pooled over all three:
   *
   *     cross +, slope +   n=71   +2 in 96%
   *     cross -, slope -   n=35   -2 in 89%
   *     cross +, slope -   n=20   +1 in 70%
   *     cross -, slope +   n=27   -1 in 56%,  +2 in 44%   <- UNDECIDED
   *
   * The docked rule matches the majority in three quadrants and the plurality in
   * the fourth, which is every quadrant it can claim. It also wins the candidate
   * race outright once the third frame is in: 129 exact against 126, absolute
   * error 61 against 70, and a churn of 14 against A1's own 14 where the
   * challenger moved 7.
   *
   * THE LESSON IS NOT "USE THREE CAPTURES". The first two were a day apart and
   * both taken in the same market state; a third from the SAME DAY overturned
   * them, so the count was never the problem. A 67% majority over n=18 was not
   * enough evidence to overturn a rule read off their own published description,
   * and it should not have been treated as if it were.
   *
   * Their page describes a crossover with a slope modifier, and this is that,
   * literally. WHERE THE MEASUREMENT IS UNDECIDED, THE PUBLISHED DESCRIPTION
   * WINS. Reproduce with `npm run trend-solver`, which prints the table above.
   */
  const cell = conflicted ? crossover - Math.sign(crossover) : crossover;

  const { fast, slow } = TREND_SMA;
  const marginPct = ((tech.smaFast - tech.smaSlow) / tech.smaSlow) * 100;
  const nearFlip = Math.abs(marginPct) < TREND_NEAR_FLIP_PCT;
  return {
    cell,
    crossover,
    slope,
    conflicted,
    marginPct,
    nearFlip,
    explanation:
      `${fast}-day average is ${crossover > 0 ? 'above' : 'below'} the ${slow}-day ` +
      `by ${Math.abs(marginPct).toFixed(2)}%, ` +
      `and the ${slow}-day is ${slope > 0 ? 'rising' : 'flat or falling'}` +
      (conflicted
        ? slope > 0
          ? ' — the dip is against a rising average, so it scores mildly.'
          : ' — the rally is against a falling average, so it scores mildly.'
        : '.') +
      (nearFlip ? ' The crossover is close enough to flip on the next close.' : ''),
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
  const score = (mean: number) => (mean > 0 ? magnitude : mean < 0 ? -magnitude : 0);
  const cell = score(meanPct);

  /**
   * The month before this one, scored by the same rule and reported only when
   * it disagrees. See `SeasonalityScore.previousMonthCell` for why it is here
   * and why it must never be summed.
   */
  const previousMonth = month === 1 ? 12 : month - 1;
  const previous = tech.seasonality[previousMonth];
  const previousCell =
    previous && previous.years >= SEASONALITY_MIN_YEARS ? score(previous.meanPct) : null;
  const lagged = previousCell !== null && previousCell !== cell;

  return {
    cell,
    month,
    meanPct,
    winRatePct,
    years: stats.years,
    previousMonthCell: lagged ? previousCell : null,
    previousMonthName: lagged ? MONTH_NAMES[previousMonth - 1] : null,
    explanation:
      `${MONTH_NAMES[month - 1]} has averaged ${meanPct > 0 ? '+' : ''}${meanPct}% over ` +
      `${stats.years} years, higher ${winRatePct}% of the time.` +
      (lagged
        ? ` ${MONTH_NAMES[previousMonth - 1]} scored ${previousCell > 0 ? '+' : ''}${previousCell}` +
          ' — A1 has not always rolled this column by now.'
        : ''),
  };
}

// ---------------------------------------------------------------------------
// 2-year yield
// ---------------------------------------------------------------------------

export interface YieldScore {
  /** Signed for a RISK asset. The dollar takes the negation — see below. */
  cell: number;
  yield: number;
  sma: number;
  explanation: string;
  /**
   * The same reading told from the DOLLAR's side.
   *
   * Kept here rather than composed at the call site so the sentence and the sign
   * can never drift apart: whoever negates `cell` reaches for this in the same
   * expression. A falling short yield is a tailwind for gold and a headwind for
   * the dollar, and one string cannot honestly say both.
   */
  dollarExplanation: string;
}

/**
 * The interest-rate reading off the US 2-year against its 21-day average.
 *
 * A1's rule, verbatim: "If price is above the moving average, -1. If price is
 * below the moving average, +1". That sign is expressed FROM A RISK ASSET'S
 * POINT OF VIEW — a rising short yield tightens financial conditions, which is
 * bearish for indices, gold and crypto alike.
 *
 * THE DOLLAR IS THE OTHER SIDE OF THAT TRADE and must negate `cell`. Their own
 * US-DOLLAR card reads a falling 2-year as Bearish ("the 2yr yield is falling
 * (dovish)") on the same day a falling 2-year is bullish for gold. One number,
 * two signs, depending on who is holding it — so `dollarExplanation` ships
 * alongside and the caller takes both together.
 *
 * 21 days, not the 7 their interest-rates page implies: their scorecard row is
 * labelled "2 Yr Yield (21 day SMA)", and a product label naming its own window
 * beats a prose page describing it.
 */
export function scoreYield2y(
  current: number | null,
  sma: number | null,
): YieldScore | null {
  if (current === null || sma === null || sma === 0) return null;

  const flat = Math.abs(current - sma) / sma < YIELD_FLAT_BAND;
  const rising = current > sma;

  const where =
    `2-year yield ${current.toFixed(2)}% is ${rising ? 'above' : 'below'} its ${YIELD_SMA_DAYS}-day ` +
    `average (${sma.toFixed(2)}%)`;
  const flatNote =
    `2-year yield ${current.toFixed(2)}% is flat against its ${YIELD_SMA_DAYS}-day average (${sma.toFixed(2)}%).`;

  return {
    // Above the average is a headwind for risk assets, hence the negative.
    cell: flat ? 0 : rising ? -1 : 1,
    yield: Math.round(current * 1000) / 1000,
    sma: Math.round(sma * 1000) / 1000,
    explanation: flat
      ? flatNote
      : `${where} — ${rising ? 'tightening, a headwind' : 'easing, a tailwind'}.`,
    dollarExplanation: flat
      ? flatNote
      : `${where} — ${rising ? 'hawkish, bullish USD' : 'dovish, bearish USD'}.`,
  };
}
