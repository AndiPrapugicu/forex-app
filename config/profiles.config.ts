/**
 * Two boards from one engine: what we know, and what A1 shows.
 *
 *   ours   The product. Every cell is our best reading of the world.
 *   a1     The same engine with A1's own DATA GAPS applied — the places their
 *          pipeline has no series, or silently reads another economy's. It is
 *          what `scripts/parity.ts --profile=a1` measures, so parity answers "do
 *          we reproduce them" while the app keeps answering "what is true".
 *
 * THE TABLE IS NOT A TUNING SURFACE. An entry goes in only when a capture
 * PROVES the gap — a scanner that returns another currency's series byte for
 * byte, or a capture that states in words that no series exists — and it must
 * cite a parity-ledger entry that records the finding. `coverage.test.ts`
 * re-derives every entry from the committed capture and fails if one stops
 * holding.
 *
 * WHAT WAS PROPOSED AND REJECTED is recorded too, because the next round will
 * otherwise re-derive it. CAD and NZD services PMI have no chart on A1, but their
 * board still scores both legs (+1 and -1 on the 2026-09-02 capture) off rows
 * frozen at 2026-05-01. Blanking them would move us AWAY from their board on
 * every CAD and NZD row. See `profile:cad-nzd-spmi-blank-rejected`.
 *
 * `lib/scoring/discrete.ts` never sees a profile. Coverage is applied to the
 * already-scored per-currency results in `buildSetupsMatrix`, so it structurally
 * cannot change how any cell is computed — only which result a currency holds.
 */

import type { Currency } from '@/lib/types';

export type BoardProfile = 'ours' | 'a1';
export const DEFAULT_PROFILE: BoardProfile = 'ours';

export type CoverageRule =
  /** A1 has no series here; the leg is blank on their board. */
  | { kind: 'blank' }
  /** A1 reads another economy's series for this currency. */
  | { kind: 'substituteFrom'; currency: Currency };

export interface CoverageEntry {
  slotKey: string;
  currency: Currency;
  rule: CoverageRule;
  evidence: { capture: string; detail: string };
  /** Parity-ledger key. No coverage rule without a written finding. */
  ledgerKey: string;
}

export const A1_COVERAGE: readonly CoverageEntry[] = [
  {
    slotKey: 'spmi',
    currency: 'CHF',
    rule: { kind: 'substituteFrom', currency: 'EUR' },
    evidence: {
      capture: 'fixtures/a1-full-access/a1-econ-services-pmi-2026-09-03-1033.csv',
      detail:
        "A1's CHF services series is byte-identical to EUR's on all 24 points, and their CH heatmap " +
        'prints the EU row exactly (51.7 vs 51.5, 2026-08-21).',
    },
    ledgerKey: 'spmi:chf-reads-the-euro-area',
  },
  {
    slotKey: 'retail-sales',
    currency: 'AUD',
    rule: { kind: 'blank' },
    evidence: {
      capture: 'fixtures/a1-full-access/a1-econ-retail-sales-2026-09-03-1040.csv',
      detail:
        "A1's retail-sales scanner returns no AUD series at all, their AU heatmap carries no retail " +
        'row, and the AU-DOLLAR row on the 2026-09-02 board prints 0.',
    },
    ledgerKey: 'retail-sales:AUD-a1-has-no-series',
  },
];

/** The rules a profile applies, keyed `${slotKey}|${currency}`. Empty for `ours`. */
export function coverageFor(profile: BoardProfile): Map<string, CoverageRule> {
  if (profile === 'ours') return new Map();
  return new Map(A1_COVERAGE.map((e) => [`${e.slotKey}|${e.currency}`, e.rule]));
}
