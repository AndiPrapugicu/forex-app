/**
 * "A1 mirror": our board re-rendered the way A1's PAIR board renders theirs.
 *
 * WHY A TOGGLE AND NOT A FIX. `a1-pair-legs.ts` establishes that A1 publishes
 * the same macro legs on two surfaces that disagree, and that on PPI the pair
 * surface is wrong on the merits — a print below forecast is a miss, and a miss
 * is bearish for the currency that missed. So we do not adopt their pair
 * convention; we make it VISIBLE, because the board a user compares us against
 * is the pair board, and "we are right and they are inconsistent" is a claim
 * that has to be checkable cell by cell rather than asserted in a doc.
 *
 * THREE TIERS, AND EVERY MIRRORED CELL CARRIES ITS OWN.
 *
 *   derived      A rule of theirs, applied to OUR live data. Only PPI
 *                qualifies: their pair board reads the release's stocks impact
 *                instead of its currency impact, which negates the leg
 *                difference. Works on any board, any day, with no capture.
 *   captured     Their printed cell for that row and column, read from a
 *                fixture. Not computed, and says so. Available only for rows
 *                and dates we hold a capture for.
 *   ours         Unchanged. Either their surface agrees with ours, or their
 *                board admits no coherent rule (mPMI) and inventing one to
 *                fill the column would be the exact failure this repo exists
 *                to avoid.
 *
 * WHAT IT MUST NOT DO. Mirror mode is presentation. It never reaches
 * `/api/setups`' stored history, the change log, `lib/scoring/history.ts`, or
 * any parity script — those measure the engine, and an engine measured against
 * a rendering of somebody else's inconsistency measures nothing. `mirrorBoard`
 * returns a COPY for exactly that reason.
 */

import { biasFromScore, SLOTS } from '@/config/setups.config';
import type { SlotCategory } from '@/config/setups.config';
import { NAME_MAP } from '@/lib/scoring/a1-symbol-map';
import type { A1Capture } from '@/lib/scoring/a1-pair-legs';
import type { MatrixCell, SymbolRow } from '@/lib/scoring/setups';

export type MirrorTier = 'derived' | 'captured' | 'ours';

/** What mirror mode did to one cell, and why. */
export interface MirrorNote {
  tier: MirrorTier;
  /** Our value, kept so the UI can show both without a second board. */
  ours: number | null;
  /** The mirrored value. Equal to `ours` when the tier is 'ours'. */
  mirrored: number | null;
  /** One sentence for the tooltip. */
  why: string;
}

/** A mirrored cell is a normal cell plus the note explaining the swap. */
export type MirroredCell = MatrixCell & { mirror?: MirrorNote };

export interface MirroredRow extends Omit<SymbolRow, 'cells'> {
  cells: Record<string, MirroredCell>;
  /** Our own total, kept beside the mirrored one. */
  oursTotal: number;
}

/**
 * Columns A1's pair board derives differently, and how.
 *
 * Baked as a constant rather than recomputed from a capture at render time:
 * `comparePairAndIndexLegs` needs a fixture and a solve, neither of which
 * belongs on a request path. `lib/scoring/a1-mirror.test.ts` re-derives it from
 * both captures and fails if this table drifts from what their board does.
 */
export const PAIR_CONVENTIONS: Record<string, { tier: MirrorTier; why: string }> = {
  ppi: {
    tier: 'derived',
    why:
      "A1's pair rows score PPI from the release's STOCKS impact, not its currency " +
      'impact — their own heatmap publishes both, and the two are opposite whenever ' +
      'either is non-neutral. Mirrored by negating the leg difference (8/8 economies, ' +
      'both captures).',
  },
  'consumer-confidence': {
    tier: 'captured',
    why:
      "A1's pair board carries a consumer-confidence leg for all eight economies; " +
      'their index rows and country heatmaps publish one only for the US. We cover ' +
      'AUD and NZD and agree with them on both, so this is coverage we lack rather ' +
      'than arithmetic we disagree with.',
  },
  mpmi: {
    tier: 'ours',
    why:
      "No leg vector explains A1's mPMI pair rows — best fit 21 of 29 on both " +
      'captures, so their own board contradicts itself here. There is no rule to ' +
      'mirror, and fitting one to 28 cells would be a guess wearing a number.',
  },
  pce: {
    tier: 'ours',
    why:
      "A1's PCE pair rows fit a leg vector on 28 of 29 rows but disagree with their " +
      'index legs on JPY, where their heatmap slot holds Household Spending. One ' +
      'unexplained row is not a convention.',
  },
};

/** Negate a leg-differenced cell, keeping the pair clamp. */
const negate = (n: number) => Math.max(-2, Math.min(2, -n));

/**
 * Re-render one board under A1's pair-board conventions.
 *
 * `capture` is optional: without it the mirror still applies every `derived`
 * rule, and `captured` columns simply stay ours with a note saying no capture
 * was available. That matters because captures age and the toggle must not
 * quietly become a viewer for a stale fixture.
 */
export function mirrorBoard(rows: SymbolRow[], capture?: A1Capture): MirroredRow[] {
  const scoring = new Map(SLOTS.filter((s) => s.scoring).map((s) => [s.key, s]));

  /** A1 row name for one of our symbols — the inverse of the shared NAME_MAP. */
  const a1Name = new Map<string, string>();
  for (const [name, symbol] of Object.entries(NAME_MAP)) a1Name.set(symbol, name);

  return rows.map((row) => {
    const cells: Record<string, MirroredCell> = {};
    let total = 0;
    const categoryScores = emptyCategories();

    /**
     * Their board names most pairs exactly as we do, and the eight index rows
     * and the assets through NAME_MAP. A row we cannot name on their board has
     * no captured cells, which is different from having captured zeros.
     */
    const theirName = a1Name.get(row.symbol) ?? row.symbol;
    const theirCells = capture?.rows.get(theirName);

    for (const [key, cell] of Object.entries(row.cells)) {
      const convention = PAIR_CONVENTIONS[key];
      let mirrored: MirroredCell = { ...cell };

      if (convention?.tier === 'derived' && key === 'ppi' && cell.cell !== null) {
        const value = negate(cell.cell);
        mirrored = {
          ...cell,
          cell: value,
          mirror: { tier: 'derived', ours: cell.cell, mirrored: value, why: convention.why },
        };
      } else if (convention?.tier === 'captured') {
        const theirs = theirCells?.[key];
        mirrored = theirs === undefined
          ? {
              ...cell,
              mirror: {
                tier: 'ours',
                ours: cell.cell,
                mirrored: cell.cell,
                why: `${convention.why} No capture of their board covers this row, so ours stands.`,
              },
            }
          : {
              ...cell,
              cell: theirs,
              status: 'scored',
              mirror: { tier: 'captured', ours: cell.cell, mirrored: theirs, why: convention.why },
            };
      } else if (convention) {
        mirrored = {
          ...cell,
          mirror: { tier: 'ours', ours: cell.cell, mirrored: cell.cell, why: convention.why },
        };
      }

      cells[key] = mirrored;

      const slot = scoring.get(key);
      if (slot && mirrored.cell !== null) {
        total += mirrored.cell;
        categoryScores[slot.category] += mirrored.cell;
      }
    }

    return {
      ...row,
      cells,
      totalScore: total,
      oursTotal: row.totalScore,
      bias: biasFromScore(total),
      categoryScores,
    };
  }).sort((a, b) => b.totalScore - a.totalScore);
}

function emptyCategories(): Record<SlotCategory, number> {
  return { technical: 0, sentiment: 0, growth: 0, inflation: 0, jobs: 0 };
}

/** Cells mirror mode actually moved — the whole point of the toggle, as a count. */
export function mirrorDiffCount(rows: MirroredRow[]): number {
  let n = 0;
  for (const row of rows) {
    for (const cell of Object.values(row.cells)) {
      if (cell.mirror && cell.mirror.ours !== cell.mirror.mirrored) n++;
    }
  }
  return n;
}

/**
 * The mirror as a COMPACT OVERLAY, which is what actually crosses the wire.
 *
 * Sending a second full board would double a ~500KB payload to render a toggle
 * that moves about a hundred cells. The overlay carries only what changed plus
 * the recomputed header numbers, and the client substitutes. Totals are
 * computed here rather than in the browser so the sum-and-band rule lives in
 * one place — `mirrorBoard` — instead of being restated by the component that
 * displays it.
 */
export interface MirrorOverlay {
  /** Which capture the `captured` tier was read from, for the UI to name. */
  capturedFrom: string | null;
  /** symbol -> slotKey -> the mirrored value. Only cells that MOVED. */
  cells: Record<string, Record<string, number | null>>;
  /** symbol -> the recomputed header, for rows whose total moved. */
  totals: Record<string, { score: number; bias: string }>;
  /** Per-column explanations, sent once rather than per cell. */
  conventions: Record<string, { tier: MirrorTier; why: string }>;
  /** How many cells the toggle moves. Rendered beside the switch. */
  moved: number;
}

export function buildMirrorOverlay(rows: SymbolRow[], capture?: A1Capture): MirrorOverlay {
  const mirrored = mirrorBoard(rows, capture);
  const cells: MirrorOverlay['cells'] = {};
  const totals: MirrorOverlay['totals'] = {};

  for (const row of mirrored) {
    for (const [key, c] of Object.entries(row.cells)) {
      if (!c.mirror || c.mirror.ours === c.mirror.mirrored) continue;
      (cells[row.symbol] ??= {})[key] = c.mirror.mirrored;
    }
    if (row.totalScore !== row.oursTotal) {
      totals[row.symbol] = { score: row.totalScore, bias: row.bias };
    }
  }

  return {
    capturedFrom: capture?.label ?? null,
    cells,
    totals,
    conventions: PAIR_CONVENTIONS,
    moved: mirrorDiffCount(mirrored),
  };
}
