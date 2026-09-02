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
 * Current" against "- 1st year". No other major central bank publishes numbers.
 *
 * THAT USED TO BE THE END OF THE SENTENCE, and it conflated two different
 * claims: that no BANK publishes a forecast, which is true, and that no forecast
 * EXISTS, which is not. The calendar already fetched here carries a consensus
 * for every scheduled decision, and a consensus that differs from the standing
 * rate is a forecast of a move. `resolveNextRateDecision` reads it, second in
 * precedence behind the dot plot, and the evidence that put it there is A1's own
 * checksummed NZDX row — Interest Rates +1 on a day the RBNZ's next meeting was
 * priced for a quarter-point hike, where this column had been scoring 0.
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
 *
 * SINCE 2026-09-01 THERE IS A RUNG ABOVE ALL OF THAT. A1's own free Interest
 * Rate Projections page publishes "market consensus estimates on future
 * projected interest rates" by calendar quarter, and
 * `sign(current quarter's projection - standing policy rate)` reproduces all
 * EIGHT of their published legs on two captures a day apart. That rule was known
 * for four rounds and unusable, because the reading covered five majors and a
 * differenced column cannot be adopted a currency at a time. The 2026-09-01
 * reading covers all eight, which is the only thing that changed.
 *
 * It arrives through `projection` rather than being fetched here: the lookup is
 * ALL-OR-NOTHING per board (`resolveConsensusProjectionLegs`) and must be
 * resolved once, above the per-currency loop, or the seam it exists to prevent
 * reappears one level up.
 */

import {
  POLICY_RATE_MATCH,
  POLICY_RATE_MAX_AGE_DAYS,
  RATE_PROJECTION_MATCH,
  RATE_PROJECTION_MAX_AGE_DAYS,
} from '@/config/setups.config';
import type { SovereignYield } from '@/lib/connectors/yields';
import { resolveSeries } from '@/lib/scoring/discrete';
import type { ProjectionLookup } from '@/lib/scoring/rate-projections';
import type { Currency, NormalizedEvent } from '@/lib/types';

/** Below this the 2-year and the policy rate are treated as saying the same thing. */
export const RATE_SPREAD_FLAT_BAND = 0.1; // percentage points

export interface RateExpectation {
  currency: Currency;
  /**
   * -1, 0 or +1 for this leg — or null when there was no CALENDAR to read.
   *
   * 0 and null are different claims and the distinction is the point. 0 says
   * "this bank has published nothing forward-looking and has no meeting in the
   * window", which is the honest and correct reading for seven of the eight
   * majors on any ordinary day. Null says "we could not look".
   */
  cell: number | null;
  /** Standing policy rate, percent. Null when the calendar has no recent decision. */
  policyRate: number | null;
  /** 2-year government yield, percent. Null where no free daily source exists. */
  yield2y: number | null;
  /** yield2y - policyRate, percent. Null when either leg is missing. */
  spread: number | null;
  /**
   * `projection` — the central bank's own published forecast (the Fed's dot
   * plot). `consensus` — no dot plot, but the calendar carries a forecast for
   * the bank's NEXT SCHEDULED decision, which is the same comparison against a
   * different forecaster. `none` — neither, so the cell is 0. The 2-year spread
   * is carried alongside for display and deliberately does not score; see
   * scoreRateExpectation for the measurement that settled it.
   */
  basis: 'projection' | 'consensus' | 'none';
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
 * The forecast for a central bank's NEXT SCHEDULED decision — where the rate is
 * expected to be after the meeting that has not happened yet.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE PROXY THAT WAS ALREADY REJECTED. The
 * column asks "current rate versus the forecast" and this file has said, for
 * several rounds, that only the Fed publishes a forecast so everyone else scores
 * 0. That was wrong in one specific and checkable way: it treated "the BANK
 * publishes no number" as "no number exists". The calendar this repo already
 * fetches carries a consensus for every scheduled decision, and a consensus that
 * differs from the standing rate IS a forecast of a move — the same quantity the
 * dot plot gives for the US, from a different forecaster.
 *
 * It is not the 2-year-yield proxy that was measured and rejected twice. That
 * one inferred a path from market PRICES and disagreed with the Fed's own dots
 * outright. This is an explicit published forecast of the policy rate itself.
 *
 * THE EVIDENCE. A1's 2026-08-25 Top Setups NZDX row — checksummed, bounds-clean
 * and structural-zero-clean — prints Interest Rates +1 for the New Zealand
 * dollar, the only non-zero non-USD rates leg on that board. On that date the
 * RBNZ's 2026-09-02 decision carried a consensus of 2.75% against a standing
 * 2.50%: a quarter-point hike forecast, +1. Every other major had no scheduled
 * decision inside the calendar's window and scored 0, which is what A1 printed
 * for EUR, GBP and JPY too.
 *
 * TWO LIMITS, STATED RATHER THAN HIDDEN.
 *   - ONE positive example. The rule reproduces a cell we could not reproduce
 *     before and contradicts nothing on file, but a single checksummed row is
 *     what it rests on. `lib/scoring/rates.test.ts` pins that row so a future
 *     change has to argue with the evidence rather than with a number.
 *   - The calendar looks only about a week ahead (`fetchFxStreetHistory`), so
 *     this can only see a decision inside that window. A1's column presumably
 *     carries a forecast the whole time. Widening the fetch is the obvious next
 *     step and is deliberately NOT taken here: no evidence on file says what
 *     A1's cell reads between meetings, and inventing one is how this column
 *     acquired its two previous wrong answers.
 */
export function resolveNextRateDecision(
  currency: Currency,
  events: NormalizedEvent[],
  now = new Date(),
): { consensus: number; standing: number | null; dateUtc: string; name: string } | null {
  const iso = now.toISOString();
  const patterns = POLICY_RATE_MATCH.matchByCurrency?.[currency] ?? POLICY_RATE_MATCH.match ?? [];
  if (patterns.length === 0) return null;

  const scheduled = events
    .filter(
      (e) =>
        e.currency === currency &&
        e.dateUtc > iso &&
        // Not yet released. An `actual` on a future-dated row is a feed artefact,
        // not a decision, and scoring against it would be reading the answer.
        e.actual === null &&
        e.consensus !== null &&
        patterns.some((p) => p.test(e.name)),
    )
    .sort((a, b) => a.dateUtc.localeCompare(b.dateUtc));

  const next = scheduled[0];
  if (!next || next.consensus === null) return null;

  return {
    consensus: next.consensus,
    standing: next.previous,
    dateUtc: next.dateUtc,
    name: next.name,
  };
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
  /**
   * This currency's leg from the board-wide consensus lookup, when the board
   * had one for EVERY major. Undefined otherwise, and the ladder below runs
   * unchanged — which is the whole safety property: either every leg of a
   * differenced cell comes from this rule, or none does.
   */
  consensusProjection?: ProjectionLookup,
): RateExpectation {
  const yieldObs = yields.get(currency) ?? null;
  const policy = resolvePolicyRate(currency, events, now);
  const spread =
    yieldObs && policy ? Math.round((yieldObs.value - policy.rate) * 1000) / 1000 : null;

  /**
   * RUNG ONE: the quarterly consensus A1 themselves publish. See the module
   * header for why this outranks the bank's own multi-year path — it is the
   * comparison their column is actually built from, and it reproduces all eight
   * of their legs rather than one of them.
   */
  if (consensusProjection?.status === 'FOUND' && consensusProjection.cell !== null) {
    return {
      currency,
      cell: consensusProjection.cell,
      policyRate: consensusProjection.policyRate ?? policy?.rate ?? null,
      yield2y: yieldObs?.value ?? null,
      spread,
      basis: 'projection',
      explanation:
        consensusProjection.explanation +
        (spread !== null
          ? `  Market view for contrast: the 2-year is ${spread > 0 ? 'above' : 'below'} the policy rate.`
          : ''),
    };
  }

  const projection = resolveRateProjection(currency, events, now);

  /**
   * THE BANK'S OWN PROJECTED PATH, one year apart.
   *
   * MEASURED AND DELIBERATELY NOT CHANGED, 2026-08-30. A1's own free pages
   * publish both halves of a different comparison — the standing policy rate
   * (Interest Rates) and "market consensus estimates on future projected
   * interest rates" by calendar quarter (Interest Rate Projections) — and
   * `sign(current quarter's projection - standing rate)` reproduces six of A1's
   * own cells across three dates:
   *
   *   USD 3.75 -> 3.75 (0)   EUR 2.40 -> 2.65 (+1)   GBP 3.75 -> 4.00 (+1)
   *   CHF 0.00 -> 0.00 (0)   NZD 2.25 -> 2.75 (+1)
   *
   *   => EURUSD +1, GBPUSD +1, EURCHF +1 (2026-08-24), CHFX 0, NZDX +1
   *      (2026-08-25), EURCHF Bullish (2026-08-29 free Forex Scorecard).
   *
   * SO WHY IS THE COMPARISON BELOW STILL `nextYear - current`? Because the rule
   * was IMPLEMENTED, MEASURED AND REVERTED in the same session, and the
   * measurement is the reason. The Fed is the only bank whose own projection we
   * hold, so switching this branch moves USD's leg alone (3.80 against a
   * standing 3.75 is inside the flat band, so 0 rather than -1) while EUR's and
   * GBP's stay at 0 for want of a projections feed. Cell parity went 84/98 ->
   * 82/98 and the rates column 5/6 -> 3/6 exact, with no cell gained: EURUSD
   * previously read +1 as EUR(0) - USD(-1) and now reads 0, where A1's own
   * +1 is EUR(+1) - USD(0).
   *
   * THE LESSON IS ABOUT ORDER, NOT ABOUT THE RULE. A1's rates column is a
   * DIFFERENCE, so adopting their rule for one currency while the others sit at
   * a placeholder 0 replaces a right answer reached by cancelling errors with a
   * wrong answer reached honestly. It cannot be adopted a currency at a time; it
   * needs the quarterly consensus for every major at once, and no feed this repo
   * has carries one (FXStreet publishes projections for the Fed alone).
   *
   * Do not re-implement it piecemeal. See `lib/scoring/parity-ledger.ts`, entry
   * `rates:usd-leg`, and `fixtures/a1-rate-inputs-2026-08-30.json` for the
   * inputs a future round would need.
   */
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
   * NO DOT PLOT, BUT A SCHEDULED DECISION WITH A FORECAST — the same comparison
   * the branch above makes, against the forecaster the calendar carries rather
   * than the bank's own. Second in precedence, never first: where a bank
   * publishes its own path that is the number A1's page names, and the Fed's
   * dots and the next meeting's consensus answer different questions (a year
   * out versus a fortnight out).
   *
   * The standing rate comes off the scheduled row's own `previous` where the
   * feed carries it, so the two halves of the comparison come from one row and
   * cannot disagree about which rate is current. `resolvePolicyRate` is the
   * fallback, and if neither exists there is nothing to compare and the cell
   * falls through to 0.
   *
   * See `resolveNextRateDecision` for the evidence, and for the two limits this
   * rests on.
   */
  const upcoming = resolveNextRateDecision(currency, events, now);
  const standing = upcoming?.standing ?? policy?.rate ?? null;
  if (upcoming && standing !== null) {
    const move = upcoming.consensus - standing;
    const cell = Math.abs(move) < RATE_SPREAD_FLAT_BAND ? 0 : move > 0 ? 1 : -1;

    return {
      currency,
      cell,
      policyRate: policy?.rate ?? standing,
      yield2y: yieldObs?.value ?? null,
      spread,
      basis: 'consensus',
      explanation:
        `${currency}: ${upcoming.name} on ${upcoming.dateUtc.slice(0, 10)} is forecast at ` +
        `${upcoming.consensus.toFixed(2)}% against a standing ${standing.toFixed(2)}% — ` +
        (cell === 0
          ? 'a hold is expected.'
          : `${cell > 0 ? 'a hike' : 'a cut'} is expected.`) +
        '  No central-bank projection is published for this currency, so the calendar consensus ' +
        'for the next scheduled decision is the forecast.',
    };
  }

  /**
   * NO PROJECTION AND NO SCHEDULED DECISION MEANS NO VIEW. The 2-year spread is
   * shown, never scored.
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
  /**
   * AN EMPTY CALENDAR IS NOT A NEUTRAL VIEW, and telling those apart is why
   * `cell` is nullable.
   *
   * Every tier above reads `events`. With no events at all there is no evidence
   * that this bank has published nothing — there is no evidence of anything, and
   * a confident 0 would be this column's version of the failure the whole repo
   * has been chasing: a provider outage arriving as a score. The health table
   * reports the outage; this makes the cell agree with it.
   *
   * Deliberately narrow. A PARTIAL calendar still returns the honest 0 below,
   * because a currency genuinely without a projection or a scheduled decision is
   * indistinguishable from one whose country slice failed, and guessing which
   * would be worse than the 0.
   */
  if (events.length === 0) {
    return {
      currency,
      cell: null,
      policyRate: policy?.rate ?? null,
      yield2y: yieldObs?.value ?? null,
      spread,
      basis: 'none',
      explanation: `No economic calendar available, so ${currency}'s rate view is unknown rather than neutral.`,
    };
  }

  return {
    currency,
    cell: 0,
    policyRate: policy?.rate ?? null,
    yield2y: yieldObs?.value ?? null,
    spread,
    basis: 'none',
    explanation:
      `${currency}'s central bank publishes no numeric rate projection and has no scheduled ` +
      `decision inside the calendar window, so this column has no view — scored 0 rather than guessed.` +
      (spread !== null && policy
        ? `  For context the market prices ${spread > 0 ? 'hikes' : 'cuts'}: the 2-year is ` +
          `${spread > 0 ? 'above' : 'below'} the ${policy.rate.toFixed(2)}% policy rate ` +
          `(${spread > 0 ? '+' : ''}${spread.toFixed(2)}).`
        : ''),
  };
}
