/**
 * RESEARCH ONLY. Not imported by `lib/scoring/setups.ts`, not wired into
 * `buildSetupsMatrix`, and `lib/scoring/rates.ts` is untouched by this file.
 *
 * This is the candidate "2-year yield vs its 21-day SMA, per currency" Rates
 * rule, isolated so it can be tested against real historical yield data before
 * anyone decides whether it belongs in production. See `scripts/rates-research.ts`
 * for the experiment that actually runs it against A1 evidence.
 *
 * WHERE THE CANDIDATE RULE COMES FROM. It is not invented here. It is the
 * SAME rule `lib/scoring/technical.ts`'s `scoreYield2y` already implements for
 * DXY and every non-FX asset — "If price is above the moving average, -1. If
 * price is below the moving average, +1", A1's own words, their card labelled
 * verbatim "2 Yr Yield (21 day SMA)". This file asks a narrower question than
 * that one settles: does the SAME comparison, run on EVERY major's own 2-year
 * yield rather than only the US one, predict the per-currency LEG that feeds an
 * FX pair's rates differential — the quantity `lib/scoring/rates.ts` currently
 * returns 0 for on every currency but USD?
 *
 * WHY THIS IS A DIFFERENT QUESTION FROM THE ONE `rates.ts` ALREADY ANSWERED
 * AND REJECTED. `rates.test.ts` has a named test — "would score every major
 * identically, which is why it cannot inform a cross" — for a MARKET-LEVEL
 * proxy: each currency's 2-year yield against ITS OWN POLICY RATE. That failed
 * because every curve carries the same positive term premium, so every major
 * scored +1 and every cross cancelled to 0. This is not that. A yield against
 * its OWN TRAILING AVERAGE is a momentum read, not a level read — it asks
 * whether a currency's rate expectations are moving, not whether short paper
 * yields more than the overnight rate — and there is no a priori reason for
 * every major's yield to be on the same side of its own recent average on the
 * same day, the way there was for the term-premium spread.
 *
 * SIGN CONVENTION, derived from evidence rather than assumed. `scoreYield2y`
 * returns a RISK-ASSET-signed cell (rising yield -> -1, tightening) that the
 * DXY branch in `setups.ts` NEGATES for the dollar. Two independent pieces of
 * A1 evidence pin what that negated value equals for USD specifically:
 *
 *   1. Their own checksummed DXY/US-DOLLAR row scores rates -1
 *      (`fixtures/a1-board.json`, 2026-08-23 capture) — and DXY's own printed
 *      card explains that reading as "the 2yr yield is falling (dovish)".
 *   2. `solveA1Legs` on the checksummed 2026-08-24 rows (EURX, EURUSD, GBPUSD,
 *      EURCHF — see `scripts/rates-research.ts`) independently pins USD's
 *      FX-PAIR-DIFFERENCED leg at exactly -1 too, with no algebraic slack.
 *
 * Both readings agree, and both are "falling yield -> -1". So the candidate
 * per-currency LEG uses the DXY-asset sign, not the raw risk-asset sign:
 * `leg = -riskAssetCell`, i.e. a RISING 2-year (relative to its 21-day average)
 * scores +1 and a FALLING one scores -1 — hikes-priced-in reads bullish for
 * that currency's leg, cuts-priced-in reads bearish, which also happens to
 * match `scoreRateExpectation`'s existing sign convention for the one currency
 * that already scores (hikes = +1, cuts = -1) so a currency swapping from the
 * dot-plot rule to this one would not flip its own sign meaning.
 */

import { YIELD_FLAT_BAND, YIELD_SMA_DAYS } from '@/config/setups.config';
import type { Currency } from '@/lib/types';

export interface YieldObservation {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Yield in percent. */
  value: number;
}

export interface HistoricalYieldSeries {
  currency: Currency;
  source: string;
  seriesId: string;
  url: string;
  /** When this repo fetched it — the series itself may lag behind this. */
  fetchedAtUtc: string;
  /** Ascending by date. Not required to be gap-free — see `windowMode` below. */
  observations: YieldObservation[];
  /** Set when the source is known to have stopped publishing recently. */
  knownIssue?: string;
}

/**
 * Two different, both defensible readings of "21-day SMA", tested separately
 * rather than picked by whichever fits — see `scripts/rates-research.ts` Step 5.
 *
 *   `excl-current`  the average of the 21 observations BEFORE the current one.
 *                   Mirrors `fetchYield2y`'s actual shape: a live intraday quote
 *                   compared against a trailing average of already-closed days,
 *                   which by construction never includes today.
 *   `incl-current`  the average of the 21 most recent observations AT OR BEFORE
 *                   the as-of date, current included — the more common informal
 *                   reading of "21-day moving average" when a series has no
 *                   separate live/closed distinction, which is the actual shape
 *                   of every source in this experiment (a daily close, not an
 *                   intraday quote).
 */
export type SmaWindowMode = 'excl-current' | 'incl-current';

export interface CandidateRateReading {
  currency: Currency;
  /** The date the caller asked for. */
  asOfDate: string;
  /** The observation actually used as "current" — the latest one <= asOfDate. */
  currentDate: string;
  currentYield: number;
  windowMode: SmaWindowMode;
  /** How many observations fed the average. Always `YIELD_SMA_DAYS` when non-null. */
  windowObservationCount: number;
  sma: number;
  /** currentYield - sma. */
  delta: number;
  /** delta / sma. What `flat` is actually thresholded against. */
  deltaPct: number;
  flat: boolean;
  /** -1, 0 or +1. See the file header for why this sign, not the raw risk-asset one. */
  candidateLeg: -1 | 0 | 1;
  /** Calendar days between asOfDate and the observation actually used. 0 means an exact hit. */
  staleDays: number;
  explanation: string;
}

/**
 * The candidate per-currency Rates leg, computed from a real historical series.
 *
 * Returns null in exactly the two ways `fetchYield2y` already does: no
 * observation at or before `asOfDate` at all, or fewer than `YIELD_SMA_DAYS`
 * observations available to build the window from. Neither is silently padded
 * or approximated — a currency that cannot support the window is a currency
 * this candidate has nothing to say about, which is a result to report, not
 * paper over.
 */
export function scoreHistorical2YRate(
  series: HistoricalYieldSeries,
  asOfDate: string,
  windowMode: SmaWindowMode = 'excl-current',
  flatBand: number = YIELD_FLAT_BAND,
): CandidateRateReading | null {
  const upToAsOf = series.observations.filter((o) => o.date <= asOfDate);
  if (upToAsOf.length === 0) return null;

  const current = upToAsOf[upToAsOf.length - 1];

  const priorPool = windowMode === 'excl-current' ? upToAsOf.slice(0, -1) : upToAsOf;
  if (priorPool.length < YIELD_SMA_DAYS) return null;

  const window = priorPool.slice(-YIELD_SMA_DAYS);
  const sma = window.reduce((a, o) => a + o.value, 0) / window.length;
  if (sma === 0) return null;

  const delta = current.value - sma;
  const deltaPct = delta / sma;
  const flat = Math.abs(deltaPct) < flatBand;
  const rising = current.value > sma;
  // See file header: the DXY-asset sign, not the raw risk-asset sign.
  const candidateLeg: -1 | 0 | 1 = flat ? 0 : rising ? 1 : -1;

  const staleDays = Math.round(
    (Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${current.date}T00:00:00Z`)) / 86_400_000,
  );

  return {
    currency: series.currency,
    asOfDate,
    currentDate: current.date,
    currentYield: current.value,
    windowMode,
    windowObservationCount: window.length,
    sma: Math.round(sma * 1000) / 1000,
    delta: Math.round(delta * 1000) / 1000,
    deltaPct: Math.round(deltaPct * 10000) / 10000,
    flat,
    candidateLeg,
    staleDays,
    explanation:
      `${series.currency} 2-year (${current.date}${staleDays > 0 ? `, ${staleDays}d stale vs ${asOfDate}` : ''}) ` +
      `${current.value.toFixed(3)}% vs ${YIELD_SMA_DAYS}-obs avg ${sma.toFixed(3)}% ` +
      `(${windowMode}) -> ${flat ? 'flat' : rising ? 'rising' : 'falling'} -> ${candidateLeg}`,
  };
}
