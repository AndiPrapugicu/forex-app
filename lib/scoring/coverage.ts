/**
 * Apply a profile's coverage table to already-scored currency results.
 *
 * Runs AFTER `scoreAllCurrencies` and before any cell is built, which is the
 * whole safety argument: the scorer has returned, so nothing here can change how
 * a cell is computed. A `blank` replaces a result with an explicit no-data
 * result; a `substituteFrom` hands a currency another currency's finished result,
 * re-stamped with its own name and an explanation saying exactly what happened.
 *
 * Returns a NEW map. The input is shared with the strength and eco-strength
 * tables, which are our reading of the world and must not inherit A1's holes.
 */

import { A1_COVERAGE, type CoverageRule } from '@/config/profiles.config';
import type { SlotResult } from '@/lib/scoring/discrete';
import type { CurrencySlotScores } from '@/lib/scoring/setups';

export function applyCoverage(
  scores: CurrencySlotScores,
  coverage: Map<string, CoverageRule>,
): CurrencySlotScores {
  if (coverage.size === 0) return scores;

  const out: CurrencySlotScores = new Map();
  for (const [currency, slots] of scores) out.set(currency, new Map(slots));

  for (const [key, rule] of coverage) {
    const [slotKey, currency] = key.split('|') as [string, SlotResult['currency']];
    const target = out.get(currency);
    const base = target?.get(slotKey);
    if (!target || !base) continue;

    const entry = A1_COVERAGE.find((e) => e.slotKey === slotKey && e.currency === currency);
    const cite = entry ? ` (${entry.ledgerKey})` : '';

    if (rule.kind === 'blank') {
      target.set(slotKey, {
        ...base,
        cell: null,
        status: 'no-data',
        event: null,
        sigma: null,
        ageDays: null,
        components: [],
        explanation: `a1 profile: A1 publishes no ${slotKey} series for ${currency}, so their leg is blank${cite}`,
      });
      continue;
    }

    // Read the donor from the ORIGINAL scores, so two substitutions can never chain.
    const donor = scores.get(rule.currency)?.get(slotKey);
    if (!donor) continue;
    target.set(slotKey, {
      ...donor,
      currency,
      explanation:
        `a1 profile: A1 reads ${rule.currency}'s ${slotKey} series for ${currency}${cite}. ` +
        donor.explanation,
    });
  }

  return out;
}
