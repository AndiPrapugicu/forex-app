/**
 * INTERNAL CONSISTENCY: does the board agree with itself?
 *
 * Every other check in this codebase asks whether a number is RIGHT. This one
 * asks something weaker and more important: whether the number, the comparison
 * it claims to be, and the evidence printed beside it are the same story.
 *
 * WHY IT EXISTS. On 2026-08-31 a Canadian retail cell scored -1 while printing
 * a sigma of +0.86 next to it. Nothing failed. The cell was scored against the
 * prior print, the sigma against the consensus, and the two were rendered side
 * by side as though they described one comparison. It took a Statistics Canada
 * release to notice — but the contradiction was fully visible in our own output,
 * and no test could see it because no test compared a cell to its own evidence.
 *
 * These are cheap, total, and run over whatever board they are handed, so the
 * same function backs the unit tests and the live diagnostic.
 */

import { MATRIX_SLOTS, TERNARY_EPSILON } from '@/config/setups.config';
import { normalizeZero, ternarySign } from '@/lib/scoring/discrete';
import type { SetupsMatrix } from '@/lib/scoring/setups';

export interface ConsistencyViolation {
  symbol: string;
  slot: string;
  currency: string;
  kind: 'sigma-opposes-cell' | 'reference-does-not-reproduce-cell' | 'status-disagrees-with-cell';
  detail: string;
}

/**
 * WHERE SIGMA IS NOT APPLICABLE, and therefore not checked:
 *
 *  - non-economic columns (trend, seasonality, COT, crowd, rates) carry no legs
 *    and no sigma at all — there is no release to be surprised by;
 *  - composite slots deliberately report `sigma: null`, because two sub-series
 *    have no single meaningful surprise;
 *  - a leg with no `actual` or no `reference` is unscoreable, and reports null.
 *
 * Everything else is checked, and a null sigma is never itself a violation.
 */
export function auditBoardConsistency(matrix: SetupsMatrix): ConsistencyViolation[] {
  const out: ConsistencyViolation[] = [];

  for (const row of matrix.rows) {
    for (const slot of MATRIX_SLOTS) {
      const cell = row.cells[slot.key];
      if (!cell) continue;

      if (cell.cell === null && cell.status === 'scored') {
        out.push({
          symbol: row.symbol,
          slot: slot.key,
          currency: '-',
          kind: 'status-disagrees-with-cell',
          detail: 'status is "scored" but the cell is null',
        });
      }

      if (slot.kind !== 'economic') continue;
      const polarity = slot.polarity ?? 1;

      for (const leg of cell.legs ?? []) {
        if (leg.cell === null || leg.actual === null || leg.reference === null) continue;

        /**
         * THE STRONGEST OF THE THREE. It does not trust the reference label, the
         * basis, the fallback or the override — it takes the two numbers the leg
         * itself publishes and asks whether they produce the score the leg
         * publishes. If a revision, a per-currency basis or a fallback changed
         * what was really compared, the printed pair stops reproducing the cell.
         */
        const reproduced = normalizeZero(ternarySign(leg.actual, leg.reference) * polarity);
        if (reproduced !== leg.cell) {
          out.push({
            symbol: row.symbol,
            slot: slot.key,
            currency: leg.currency,
            kind: 'reference-does-not-reproduce-cell',
            detail:
              `${leg.actual} vs ${leg.reference} ${leg.referenceLabel} gives ${reproduced}, ` +
              `but the leg scored ${leg.cell}`,
          });
        }

        /**
         * Sigma may legitimately be 0 where the cell is not: it is rounded to two
         * places for display, so a real but tiny surprise reads as 0. What it may
         * never do is point the OTHER WAY, which is exactly the Canadian case.
         */
        if (leg.sigma === null || leg.sigma === 0 || leg.cell === 0) continue;
        const expected = Math.sign(leg.cell) * polarity;
        if (Math.sign(leg.sigma) !== expected) {
          out.push({
            symbol: row.symbol,
            slot: slot.key,
            currency: leg.currency,
            kind: 'sigma-opposes-cell',
            detail:
              `sigma ${leg.sigma > 0 ? '+' : ''}${leg.sigma}σ opposes cell ${leg.cell}` +
              (polarity === -1 ? ' (polarity -1)' : '') +
              ` — they are measuring different comparisons`,
          });
        }
      }

      /**
       * A 0 cell must also be reproducible: it claims "measured, and neutral",
       * which is only true if the two numbers really did land together.
       */
      for (const leg of cell.legs ?? []) {
        if (leg.cell !== 0 || leg.actual === null || leg.reference === null) continue;
        if (Math.abs(leg.actual - leg.reference) >= TERNARY_EPSILON) {
          out.push({
            symbol: row.symbol,
            slot: slot.key,
            currency: leg.currency,
            kind: 'reference-does-not-reproduce-cell',
            detail: `cell is 0 but ${leg.actual} and ${leg.reference} differ`,
          });
        }
      }
    }
  }

  return out;
}

/** One line per violation, for a script or a log. */
export function formatViolations(violations: readonly ConsistencyViolation[]): string {
  if (violations.length === 0) return 'no internal inconsistencies';
  return violations
    .map((v) => `  ${v.symbol}.${v.slot} [${v.currency}] ${v.kind}: ${v.detail}`)
    .join('\n');
}
