/**
 * Which cells were scored off a number we took from A1.
 *
 * WHY THIS EXISTS. `lib/connectors/pmi-history.ts` seeds PMI history from
 * `fixtures/a1-full-access/`, because FXStreet's calendar carries every non-USD
 * PMI release with `actual: null` once the print stops being current — rewind
 * the board a week and EUR, GBP, JPY and AUD have no services PMI at all. The
 * seed is the only way to score those columns on any past date.
 *
 * But a cell scored off A1's own published number cannot be evidence that we
 * reproduce A1. Left unmarked, seeding would make `TOTAL ABS GAP` fall for a
 * reason that has nothing to do with our engine getting better, which is the
 * exact self-flattery this repository's parity discipline exists to prevent.
 *
 * So `scripts/parity.ts` prints a SECOND headline computed with these cells
 * removed from BOTH sides, and this module is the predicate it uses.
 *
 * THE EXCLUDED SET SHRINKS ON ITS OWN, and that is the intended trajectory:
 * every time the forward accumulator observes a flash live, that day's seed row
 * is permanently superseded by an `fxstreet` row and the cell leaves this set.
 * The clean headline therefore closes on the dirty one over time without anyone
 * editing anything.
 */

import type { MatrixCell, SymbolRow } from '@/lib/scoring/setups';
import type { SourceKind } from '@/lib/types';
import { SLOTS } from '@/config/setups.config';

/**
 * Source kinds that came from A1 rather than from a calendar of record.
 *
 * A set rather than an equality test because the shape generalises: any future
 * fixture-seeded feed read off somebody else's rendering of their own board
 * belongs here the moment it is added.
 */
export const A1_SOURCED: ReadonlySet<SourceKind> = new Set<SourceKind>(['a1-capture']);

/**
 * True when any leg of this cell was scored off an A1-sourced input.
 *
 * ONLY `actualSource` IS CHECKED, and not `consensusSource`. Nothing backfills a
 * consensus from a capture today — `backfillConsensus` lends forecasts only
 * between TradingView and ForexFactory — so checking it would test nothing. The
 * moment somebody seeds a forecast from a fixture that sentence becomes false,
 * which is precisely when this comment earns its keep: extend the predicate
 * rather than assuming it still holds.
 *
 * A cell with NO legs is clean by construction. Technical, sentiment and rates
 * slots carry no calendar release, so there is no input for a capture to have
 * supplied.
 */
export function cellIsA1Sourced(cell: MatrixCell): boolean {
  return (cell.legs ?? []).some(
    (leg) =>
      leg.actualSource !== null &&
      leg.actualSource !== undefined &&
      A1_SOURCED.has(leg.actualSource as SourceKind),
  );
}

/** Which scoring slots on this row are A1-sourced, and what they contribute. */
export function rowA1Contribution(row: SymbolRow): { slots: string[]; points: number } {
  const scoring = new Set(SLOTS.filter((s) => s.scoring).map((s) => s.key));
  const slots: string[] = [];
  let points = 0;

  for (const [key, cell] of Object.entries(row.cells)) {
    // Mirrors `buildSetupsMatrix`'s own rule rather than restating it: a slot
    // that does not score contributes nothing to a total, so removing it from
    // one would silently change the comparison.
    if (!scoring.has(key)) continue;
    if (!cellIsA1Sourced(cell)) continue;
    slots.push(key);
    points += cell.cell ?? 0;
  }

  return { slots: slots.sort(), points };
}
