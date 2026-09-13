/**
 * How far we are from A1's captured board, split by WHY.
 *
 * TOTAL ABS GAP says how far. This says which part of that distance is already
 * explained and which part is a work list:
 *
 *   coverage     closed by the a1 profile — A1's proven data gaps
 *   convention   closed by a DERIVED mirror rule — today the PPI negation
 *   captured     closed by COPYING their printed cell
 *   unexplained  everything left
 *
 * `captured` is reported separately and never folded into anything, because
 * copying their answer explains nothing. A readout that hid that difference
 * would be worse than no readout.
 *
 * Four distances over the SAME captured cells, so the buckets sum to the
 * starting distance by construction:
 *
 *   d0  ours            vs theirs
 *   d1  a1 profile      vs theirs   -> coverage   = d0 - d1
 *   d2  d1 + derived    vs theirs   -> convention = d1 - d2
 *   d3  d2 + captured   vs theirs   -> captured   = d2 - d3,  unexplained = d3
 *
 * A bucket can be negative — a coverage rule that moves one cell further away
 * while closing another — and that is reported rather than clamped, because a
 * negative bucket is exactly the thing somebody needs to see.
 */

import { SCORING_SLOTS } from '@/config/setups.config';
import { mirrorBoard } from '@/lib/scoring/a1-mirror';
import type { A1Capture } from '@/lib/scoring/a1-pair-legs';
import { NAME_MAP } from '@/lib/scoring/a1-symbol-map';
import type { SymbolRow } from '@/lib/scoring/setups';

export interface ResidualBuckets {
  coverage: number;
  convention: number;
  captured: number;
  unexplained: number;
}

export interface MirrorResidual {
  capture: string;
  /** Captured cells the distances were measured over. */
  cellsCompared: number;
  start: number;
  total: ResidualBuckets;
  bySlot: Record<string, ResidualBuckets & { start: number }>;
  unexplainedCells: { symbol: string; slotKey: string; ours: number | null; a1: number }[];
}

type Board = Map<string, Record<string, number | null>>;

function toBoard(rows: { symbol: string; cells: Record<string, { cell: number | null }> }[]): Board {
  const out: Board = new Map();
  for (const row of rows) {
    const cells: Record<string, number | null> = {};
    for (const [k, c] of Object.entries(row.cells)) cells[k] = c.cell;
    out.set(row.symbol, cells);
  }
  return out;
}

export function mirrorResidual(
  oursRows: SymbolRow[],
  a1ProfileRows: SymbolRow[],
  capture: A1Capture,
): MirrorResidual {
  const scoring = SCORING_SLOTS.map((s) => s.key);
  const boards = [
    toBoard(oursRows),
    toBoard(a1ProfileRows),
    toBoard(mirrorBoard(a1ProfileRows)),
    toBoard(mirrorBoard(a1ProfileRows, capture)),
  ];

  const d = [0, 0, 0, 0];
  const bySlotD = new Map<string, number[]>();
  const unexplainedCells: MirrorResidual['unexplainedCells'] = [];
  let cellsCompared = 0;

  for (const [a1Name, theirs] of capture.rows) {
    const symbol = NAME_MAP[a1Name] ?? a1Name;
    if (!boards[0].has(symbol)) continue;

    for (const slotKey of scoring) {
      const expected = theirs[slotKey];
      if (expected === undefined) continue;
      cellsCompared++;

      const slotD = bySlotD.get(slotKey) ?? [0, 0, 0, 0];
      boards.forEach((board, i) => {
        const gap = Math.abs((board.get(symbol)?.[slotKey] ?? 0) - expected);
        d[i] += gap;
        slotD[i] += gap;
      });
      bySlotD.set(slotKey, slotD);

      const final = boards[3].get(symbol)?.[slotKey] ?? null;
      if ((final ?? 0) !== expected) unexplainedCells.push({ symbol, slotKey, ours: final, a1: expected });
    }
  }

  const buckets = (v: number[]): ResidualBuckets => ({
    coverage: v[0] - v[1],
    convention: v[1] - v[2],
    captured: v[2] - v[3],
    unexplained: v[3],
  });

  const bySlot: MirrorResidual['bySlot'] = {};
  for (const [slotKey, v] of bySlotD) bySlot[slotKey] = { start: v[0], ...buckets(v) };

  return {
    capture: capture.label,
    cellsCompared,
    start: d[0],
    total: buckets(d),
    bySlot,
    unexplainedCells,
  };
}
