/**
 * The interest-rate column: where the CENTRAL BANK says policy is going.
 *
 * A1 compares each currency's current policy rate against the forecast on their
 * "Central Bank Forecast Page" — "If the forecast happened to be higher than
 * current rates, [the currency] would get a -1" for the quote leg, +1 for the
 * base (a1trading.com/edgefinder/interest-rates/).
 *
 * The Fed publishes exactly that forecast itself, in the dot plot's Summary of
 * Economic Projections, and FXStreet carries it: "Interest Rate Projections -
 * Current" against "- 1st year". No other major central bank publishes numbers,
 * so no other currency scores on this column.
 *
 * TWO EARLIER ATTEMPTS, BOTH WORSE. The first scored the last rate DECISION
 * against its consensus — backward-looking, and a hold that matched forecast
 * scored 0 while the market priced three cuts. The second used the 2-year yield
 * against the policy rate as a market-implied forecast; that is a real signal
 * but it is the MARKET's view, not the bank's, and the two disagreed outright —
 * the US 2-year sat above the policy rate implying hikes while the Fed's own
 * dots projected cuts, flipping the sign on every USD pair.
 *
 * The 2-year spread is still computed and carried for display, because the
 * contrast between what the bank projects and what the market prices is worth
 * seeing. It just does not vote.
 */

import {
  POLICY_RATE_MATCH,
  POLICY_RATE_MAX_AGE_DAYS,
  RATE_PROJECTION_MATCH,
  RATE_PROJECTION_MAX_AGE_DAYS,
} from '@/config/setups.config';
import type { SovereignYield } from '@/lib/connectors/yields';
import { resolveSeries } from '@/lib/scoring/discrete';
import type { Currency, NormalizedEvent } from '@/lib/types';

/** Below this the 2-year and the policy rate are treated as saying the same thing. */
export const RATE_SPREAD_FLAT_BAND = 0.1; // percentage points

export interface RateExpectation {
  currency: Currency;
  /** -1, 0 or +1 for this leg. */
  cell: number;
  /** Standing policy rate, percent. Null when the calendar has no recent decision. */
  policyRate: number | null;
  /** 2-year government yield, percent. Null where no free daily source exists. */
  yield2y: number | null;
  /** yield2y - policyRate, percent. Null when either leg is missing. */
  spread: number | null;
  /**
   * `projection` — the central bank's own published forecast, the only thing
   * that scores. `none` — no forecast published, so the cell is 0. The 2-year
   * spread is carried alongside for display and deliberately does not score;
   * see scoreRateExpectation for the measurement that settled it.
   */
  basis: 'projection' | 'none';
  explanation: string;
}

/**
 * The standing policy rate for a currency, read off the most recent decision.
 *
 * The rate persists between meetings, so the staleness window is generous — a
 * decision from ten weeks ago still describes today's rate. Beyond the window we
 * return null rather than a guess, because a rate that has since moved is worse
 * than no rate at all.
 */
export function resolvePolicyRate(
  currency: Currency,
  events: NormalizedEvent[],
  now = new Date(),
): { rate: number; observedOn: string } | null {
  const event = resolveSeries(POLICY_RATE_MATCH, currency, events);
  if (!event || event.actual === null) return null;

  const ageDays = (now.getTime() - new Date(event.dateUtc).getTime()) / 86_400_000;
  if (ageDays > POLICY_RATE_MAX_AGE_DAYS) return null;

  return { rate: event.actual, observedOn: event.dateUtc };
}

/** Policy rates for every major, for the carry scanner and real-yield ranking. */
export function resolvePolicyRates(
  currencies: readonly Currency[],
  events: NormalizedEvent[],
  now = new Date(),
): Map<Currency, number> {
  const out = new Map<Currency, number>();
  for (const currency of currencies) {
    const resolved = resolvePolicyRate(currency, events, now);
    if (resolved) out.set(currency, resolved.rate);
  }
  return out;
}

/**
 * The central bank's own projected path: where it says the rate is going.
 *
 * Only the Fed publishes numbers (the dot plot's Summary of Economic
 * Projections). Everyone else guides in prose.
 */
export function resolveRateProjection(
  currency: Currency,
  events: NormalizedEvent[],
  now = new Date(),
): { current: number; nextYear: number; observedOn: string } | null {
  const current = resolveSeries(RATE_PROJECTION_MATCH.current, currency, events);
  const nextYear = resolveSeries(RATE_PROJECTION_MATCH.nextYear, currency, events);

  /**
   * Explicitly against null, not falsy.
   *
   * A projected rate of exactly 0.00% is a real and historically common
   * projection — the BoJ and the SNB have both published one — and a falsy check
   * read it as "no projection", silently dropping the column to 0 for a bank
   * that had in fact told us precisely where it was going.
   */
  if (
    current?.actual === null ||
    current?.actual === undefined ||
    nextYear?.actual === null ||
    nextYear?.actual === undefined
  ) {
    return null;
  }

  const ageDays = (now.getTime() - new Date(current.dateUtc).getTime()) / 86_400_000;
  if (ageDays > RATE_PROJECTION_MAX_AGE_DAYS) return null;

  return { current: current.actual, nextYear: nextYear.actual, observedOn: current.dateUtc };
}

/**
 * Scores rate expectations for one currency.
 *
 * Compares the central bank's CURRENT rate against ITS OWN forecast, which is
 * what A1 does — "current and next quarter's forecasted interest rate ... Data
 * from the Central Bank Forecast Page".
 *
 * WHERE NO FORECAST IS PUBLISHED, THIS SCORES 0. That is deliberate, and it
 * replaced two worse answers:
 *
 *   - a 2-year yield proxy, which is a market forecast rather than the bank's
 *     and disagreed outright — the US 2-year sat above the policy rate implying
 *     hikes while the Fed's own dots projected cuts, flipping the sign on every
 *     USD pair;
 *   - a hand-maintained regime table, which is just our opinion wearing a
 *     number.
 *
 * Both moved scores on evidence we do not actually have. A 0 says "no published
 * forecast", which is true, and it is the only honest reading for six of the
 * eight majors. The 2-year spread is still computed and returned so the UI can
 * show the market's view alongside — it simply does not vote.
 */
export function scoreRateExpectation(
  currency: Currency,
  yields: Map<Currency, SovereignYield>,
  events: NormalizedEvent[],
  now = new Date(),
): RateExpectation {
  const yieldObs = yields.get(currency) ?? null;
  const policy = resolvePolicyRate(currency, events, now);
  const spread =
    yieldObs && policy ? Math.round((yieldObs.value - policy.rate) * 1000) / 1000 : null;

  const projection = resolveRateProjection(currency, events, now);

  if (projection) {
    const move = projection.nextYear - projection.current;
    const cell = Math.abs(move) < RATE_SPREAD_FLAT_BAND ? 0 : move > 0 ? 1 : -1;

    return {
      currency,
      cell,
      policyRate: policy?.rate ?? null,
      yield2y: yieldObs?.value ?? null,
      spread,
      basis: 'projection',
      explanation:
        `${currency} central bank projects ${projection.current.toFixed(2)}% -> ` +
        `${projection.nextYear.toFixed(2)}% (${projection.observedOn.slice(0, 10)}) — ` +
        (cell === 0 ? 'no change projected.' : `${cell > 0 ? 'hikes' : 'cuts'} projected.`) +
        (spread !== null
          ? `  Market view for contrast: the 2-year is ${spread > 0 ? 'above' : 'below'} the policy rate.`
          : ''),
    };
  }

  /**
   * NO PROJECTION MEANS NO VIEW. The 2-year spread is shown, never scored.
   *
   * Scoring it was tried and MEASURED, and the result is worth recording so it
   * is not tried a third time. Sovereign 2-years are now available for all eight
   * majors, so the mechanism was there; the signal is not:
   *
   *   USD +0.42   EUR +0.48   GBP +0.63   JPY +0.69
   *   AUD +0.27   NZD +1.09   CAD +0.73   CHF +0.10
   *
   * Every curve slopes up, so every leg scores +1 and every non-USD CROSS
   * cancels to 0 — the exact cell it was meant to fix, unchanged, while the USD
   * pairs moved. The term premium is common to all of them and swamps the policy
   * expectation the cell is asking about. Measured on the parity harness: exact
   * 6 -> 7 but total gap 49 -> 50 and within-1 19 -> 18.
   *
   * A cross-sectional version (each spread against the median) is the obvious
   * next idea and reproduces A1's GBPCHF but not their GBPJPY, which is fitting
   * a band to two observations rather than finding a rule.
   *
   * So the honest reading stays 0, and it is the only honest one for seven of
   * the eight majors. The spread rides along as context because the contrast
   * between what a bank projects and what the market prices is worth seeing.
   */
  return {
    currency,
    cell: 0,
    policyRate: policy?.rate ?? null,
    yield2y: yieldObs?.value ?? null,
    spread,
    basis: 'none',
    explanation:
      `${currency}'s central bank publishes no numeric rate projection, so this column has ` +
      `no view — scored 0 rather than guessed.` +
      (spread !== null && policy
        ? `  For context the market prices ${spread > 0 ? 'hikes' : 'cuts'}: the 2-year is ` +
          `${spread > 0 ? 'above' : 'below'} the ${policy.rate.toFixed(2)}% policy rate ` +
          `(${spread > 0 ? '+' : ''}${spread.toFixed(2)}).`
        : ''),
  };
}
