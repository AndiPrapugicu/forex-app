/**
 * ECO STRENGTH INDEX — where each economy stands, not whether it surprised.
 *
 * Every other column in this app scores a SURPRISE: actual against forecast or
 * against the prior print. That deliberately says nothing about level. A country
 * can beat expectations from a terrible starting point and score +1, and a
 * strong economy that merely met a high bar scores 0. Both are correct answers
 * to the question the board asks, and neither answers "who is actually strongest
 * right now".
 *
 * This module answers that second question, and it is a SEPARATE reading. It
 * must never be folded into `totalScore` — a level and a surprise measured on
 * the same currency are not independent evidence, and adding them would double
 * count the same release.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE. The construction is A1's, read off their Eco Strength Index page
 * during EdgeFinder Free Week and captured in
 * `fixtures/a1-eco-strength-index-2026-08-31.csv`. Unlike most of what that
 * report publishes, this one is fully reproducible: all 32 sub-scores in the
 * snapshot fall out of the rule below exactly, with no residual. That is why it
 * is implemented and, say, their rates projection rule is not — see
 * HARDENING.md 3.
 *
 * We are adopting a METHOD that reproduces from published inputs, not copying
 * their output. Every number this produces is computed from our own feed.
 * ---------------------------------------------------------------------------
 */

import type { CurrencySlotScores } from '@/lib/scoring/setups';
import type { Currency } from '@/lib/types';

/** Each component contributes at most this much, so the total tops out at 100. */
export const COMPONENT_MAX = 25;

/**
 * Bias bands.
 *
 * NOT ESTABLISHED FROM A1. Their snapshot only constrains these to a range: it
 * shows Bullish at 66 and 71, Neutral at 41/41/46, and Bearish at 25/29/30, so
 * the true cut sits somewhere in 47..65 and 31..40. A single snapshot cannot
 * distinguish a fixed threshold from a rank rule ("top two are bullish"), and
 * guessing between them would invent precision we do not have.
 *
 * These are therefore OURS, chosen inside the observed gaps and documented as
 * such. They reproduce the snapshot's labels without claiming to be A1's rule.
 */
export const BULLISH_AT = 50;
export const BEARISH_BELOW = 35;

export type EcoStrengthBias = 'Bullish' | 'Neutral' | 'Bearish';

/** One economy's current levels. Null means we have no reading, not zero. */
export interface EcoStrengthInput {
  currency: Currency;
  /** Most recent GDP growth rate, percent. Higher is stronger. */
  gdpGrowth: number | null;
  /** Unemployment rate, percent. LOWER is stronger. */
  unemploymentRate: number | null;
  /** Standing policy rate, percent. Higher is stronger. */
  interestRate: number | null;
  /** Headline CPI year on year, percent. LOWER is stronger. */
  cpiYoY: number | null;
}

export interface EcoStrengthRow extends EcoStrengthInput {
  /**
   * Policy rate minus headline inflation. Reproduces all eight cells of the
   * captured snapshot exactly. Null unless BOTH inputs are present — a real
   * yield computed against a missing rate is not a small error, it is a
   * different quantity.
   */
  realYield: number | null;
  gdpScore: number | null;
  unemploymentScore: number | null;
  cpiScore: number | null;
  interestRateScore: number | null;
  /** Sum of the components that scored. */
  totalScore: number;
  /** How many of the four contributed. Below 4 the total is not comparable. */
  componentsScored: number;
  bias: EcoStrengthBias;
}

/**
 * Min-max normalisation across the cohort, to 0..25.
 *
 * The scale is RELATIVE, which is the whole point and also the main trap: a
 * currency scores 25 for being the best of the eight, not for being good. If
 * every economy weakens together, the table looks unchanged. Read it as a
 * ranking with distances, never as an absolute health measure.
 *
 * When every value in the cohort is identical there is no spread to normalise
 * against, and any answer would be arbitrary — we give them all full marks
 * rather than all zero, because "nobody is behind" is the truer reading of a
 * tie than "everybody is worst".
 */
function normalise(
  value: number | null,
  values: readonly number[],
  lowerIsStronger: boolean,
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (!values.length) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return COMPONENT_MAX;
  const share = lowerIsStronger ? (hi - value) / (hi - lo) : (value - lo) / (hi - lo);
  return Math.round(share * COMPONENT_MAX);
}

function biasFor(total: number): EcoStrengthBias {
  if (total >= BULLISH_AT) return 'Bullish';
  if (total < BEARISH_BELOW) return 'Bearish';
  return 'Neutral';
}

/**
 * Score a cohort of economies against each other.
 *
 * The cohort defines the scale, so passing a different set of currencies gives
 * different scores for the same inputs. That is inherent to a relative index,
 * not a bug — but it does mean a row's score is only meaningful alongside the
 * rows it was computed with. Rows are returned strongest first.
 *
 * A currency missing a component is normalised against the currencies that do
 * have one, and its total is the sum of what scored. `componentsScored` is
 * reported so a partial row is visibly partial rather than quietly weak: three
 * components out of four cannot reach 100 and must not be ranked as if it could.
 */
export function computeEcoStrength(inputs: readonly EcoStrengthInput[]): EcoStrengthRow[] {
  const present = (pick: (i: EcoStrengthInput) => number | null): number[] =>
    inputs.map(pick).filter((v): v is number => v !== null && Number.isFinite(v));

  const gdps = present((i) => i.gdpGrowth);
  const unemployment = present((i) => i.unemploymentRate);
  const rates = present((i) => i.interestRate);
  const cpis = present((i) => i.cpiYoY);

  const rows = inputs.map((input): EcoStrengthRow => {
    const gdpScore = normalise(input.gdpGrowth, gdps, false);
    const unemploymentScore = normalise(input.unemploymentRate, unemployment, true);
    const cpiScore = normalise(input.cpiYoY, cpis, true);
    const interestRateScore = normalise(input.interestRate, rates, false);

    const parts = [gdpScore, unemploymentScore, cpiScore, interestRateScore];
    const scored = parts.filter((p): p is number => p !== null);
    const totalScore = scored.reduce((sum, p) => sum + p, 0);

    return {
      ...input,
      realYield:
        input.interestRate === null || input.cpiYoY === null
          ? null
          : Math.round((input.interestRate - input.cpiYoY) * 100) / 100,
      gdpScore,
      unemploymentScore,
      cpiScore,
      interestRateScore,
      totalScore,
      componentsScored: scored.length,
      bias: biasFor(totalScore),
    };
  });

  return rows.sort((a, b) => b.totalScore - a.totalScore || a.currency.localeCompare(b.currency));
}

/**
 * Build the cohort from OUR OWN pipeline, never from the capture.
 *
 * The fixture in `fixtures/a1-eco-strength-index-2026-08-31.csv` is evidence
 * that the METHOD reproduces; it is not a data source. Every number this feeds
 * in comes from the same resolved releases the board scores, which is what
 * makes the index move on its own rather than restating a snapshot of theirs.
 *
 * LEVELS, NOT CELLS. `SlotResult.cell` is a surprise and is exactly the wrong
 * input here — the whole point of this index is the level a release printed,
 * not how it compared to a forecast. So this reads `event.actual` and ignores
 * the score sitting beside it.
 *
 * A currency whose slot did not resolve arrives as null and stays null. It is
 * then normalised against the currencies that did resolve, and reports a
 * `componentsScored` below four so a thin row is visibly thin instead of
 * quietly ranking low.
 */
export function buildEcoStrengthInputs(
  currencies: readonly Currency[],
  currencyScores: CurrencySlotScores,
  policyRates: Map<Currency, number>,
): EcoStrengthInput[] {
  const actual = (currency: Currency, slotKey: string): number | null => {
    const value = currencyScores.get(currency)?.get(slotKey)?.event?.actual;
    return value === null || value === undefined || !Number.isFinite(value) ? null : value;
  };

  return currencies.map((currency) => ({
    currency,
    gdpGrowth: actual(currency, 'gdp'),
    unemploymentRate: actual(currency, 'unemployment'),
    /**
     * The standing policy rate, not a calendar release. It is the one input
     * here that is a STATE rather than a print, which is why it comes from the
     * rates map the carry table already uses rather than from an event.
     */
    interestRate: policyRates.get(currency) ?? null,
    cpiYoY: actual(currency, 'cpi'),
  }));
}
