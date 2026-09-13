/**
 * Score history: turning the live matrix into a durable time series.
 *
 * This is the only thing the app stores that it cannot later recompute. Events
 * can be re-scored from the calendar at any time, but the free feeds publish
 * only the CURRENT technicals and the LATEST COT report — there is no endpoint
 * for "what did the 14-day average look like three weeks ago". A snapshot not
 * taken is gone.
 *
 * Which is also why capture must never be allowed to break the cron: a failed
 * write costs one data point, while a thrown error costs the alerts that run
 * after it.
 */

import type { SetupsMatrix, SymbolRow } from '@/lib/scoring/setups';
import type { ScoreSnapshot } from '@/lib/types';

/**
 * Rounds a timestamp down to the minute.
 *
 * The primary key is (symbol, captured_at), and the cron fires every 10 minutes
 * with millisecond-varying timestamps. Without truncation an accidental double
 * run writes two near-identical rows a few hundred milliseconds apart, which
 * shows up as a visual spike on the history chart rather than as the duplicate
 * it is.
 */
export function truncateToMinute(iso: string): string {
  return `${iso.slice(0, 16)}:00.000Z`;
}

function toSnapshot(row: SymbolRow, capturedAtUtc: string): ScoreSnapshot {
  const cells: Record<string, number | null> = {};
  /**
   * Which cells were one-legged, and which leg was missing.
   *
   * Stored rather than derived, because it cannot be recovered later. Two runs
   * can produce the same cell VALUE from completely different inputs — `eur −
   * usd` and `0 − usd` both land on -1 often enough — and without this the
   * change log can only say a number moved, never that it moved because a
   * contract failed. That sentence is the entire point of the log.
   */
  const partialLegs: Record<string, string> = {};

  for (const [key, cell] of Object.entries(row.cells)) {
    cells[key] = cell.cell;
    if (cell.status === 'partial' && cell.missingLeg) partialLegs[key] = cell.missingLeg;
  }

  return {
    symbol: row.symbol,
    capturedAtUtc,
    totalScore: row.totalScore,
    bias: row.bias,
    populated: row.populated,
    partialLegs,
    categoryScores: { ...row.categoryScores },
    price: row.price,
    cells,
  };
}

/**
 * One snapshot per symbol from a matrix.
 *
 * Rows with nothing populated are skipped. A row where every source failed
 * scores 0 and reads "Neutral", and persisting that would put a fake flat line
 * through the history chart during an outage — indistinguishable from the market
 * genuinely having no view.
 */
export function buildSnapshots(matrix: SetupsMatrix): ScoreSnapshot[] {
  const capturedAtUtc = truncateToMinute(matrix.generatedAtUtc);
  return matrix.rows.filter((row) => row.populated > 0).map((row) => toSnapshot(row, capturedAtUtc));
}

export interface SnapshotChange {
  symbol: string;
  from: number;
  to: number;
  delta: number;
  fromBias: string;
  toBias: string;
  /** True when the sign flipped, which is the alert-worthy case. */
  flipped: boolean;
}

/**
 * Compares the newest snapshot against the oldest in the window.
 *
 * A bias FLIP is the interesting event — A1 sells exactly this as a paid
 * add-on. A score drifting 6 -> 7 is noise; 3 -> -2 is a different opinion.
 */
export function diffSnapshots(history: ScoreSnapshot[]): SnapshotChange | null {
  if (history.length < 2) return null;

  const first = history[0];
  const last = history[history.length - 1];

  return {
    symbol: last.symbol,
    from: first.totalScore,
    to: last.totalScore,
    delta: Math.round((last.totalScore - first.totalScore) * 100) / 100,
    fromBias: first.bias,
    toBias: last.bias,
    // Zero is not a side, so crossing it only counts when the destination has one.
    flipped: Math.sign(first.totalScore) !== Math.sign(last.totalScore) && last.totalScore !== 0,
  };
}

// ---------------------------------------------------------------------------
// The change log
// ---------------------------------------------------------------------------

/**
 * What one cell did between two runs.
 *
 * `becamePartial` is the field the whole feature turns on. A cell going 1 -> 0
 * is ambiguous — the market may genuinely have changed its mind. A cell going
 * 1 -> 0 *while losing a leg* is not ambiguous at all: an upstream failed, and
 * the number on screen is now built from half the usual inputs.
 */
export interface CellChange {
  slotKey: string;
  from: number | null;
  to: number | null;
  /** The leg missing NOW, when the current cell is partial. */
  missingLeg: string | null;
  /** True when the cell was complete last run and is one-legged this run. */
  becamePartial: boolean;
  /** True when the cell had a value last run and has none at all this run. */
  wentDark: boolean;
}

export interface ScoreChange {
  symbol: string;
  from: number;
  to: number;
  delta: number;
  fromBias: string;
  toBias: string;
  /** True when the bias LABEL changed — the thing a reader actually notices. */
  biasChanged: boolean;
  /** When the snapshot being compared against was taken. */
  sinceUtc: string;
  /** Every cell that moved, most-moved first. */
  cells: CellChange[];
  /**
   * The reason, when there is a defensible one. Null when the cells simply
   * moved and nothing failed — an honest "the data changed".
   */
  cause: string | null;
}

/** Cells whose slot keys are worth naming first in a cause. */
/**
 * BOTH KINDS OF LOSS, NOT WHICHEVER COMES FIRST.
 *
 * This used to return the partial cells OR, failing that, the dark ones. One
 * upstream failure routinely causes both at once, and the else branch then threw
 * half the explanation away: dropping the EURO FX contract leaves EURUSD's `cot`
 * partial — it still has the dollar leg — while `crowd`, which reads that one
 * contract directly, has nothing left at all. The log said "cot lost its EUR
 * leg" and never mentioned the column that went blank, so the reported cause did
 * not account for the whole move.
 *
 * Partial cells lead because a named leg is the more specific fact.
 */
function describeCause(cells: CellChange[]): string | null {
  const parts = [
    ...cells.filter((c) => c.becamePartial).map((c) => `${c.slotKey} lost its ${c.missingLeg} leg`),
    ...cells.filter((c) => c.wentDark).map((c) => `${c.slotKey} lost its data`),
  ];

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Compares this run's rows against the previous run's snapshots.
 *
 * This is the answer to "we had 20 bullish and from time to time it appeared
 * that it's 19, and no news occurred". Every input it needs is already stored
 * and already computed; all that was missing was somewhere to say it.
 *
 * Rows with no previous snapshot are omitted rather than reported as a change
 * from zero — a symbol appearing for the first time has not moved.
 */
export function buildChangeLog(
  rows: SymbolRow[],
  previous: Map<string, ScoreSnapshot>,
): ScoreChange[] {
  const out: ScoreChange[] = [];

  for (const row of rows) {
    const before = previous.get(row.symbol);
    if (!before) continue;

    const cells: CellChange[] = [];
    const wasPartial = before.partialLegs ?? {};

    for (const [slotKey, cell] of Object.entries(row.cells)) {
      const from = before.cells[slotKey] ?? null;
      const to = cell.cell;
      const missingLeg = cell.status === 'partial' ? (cell.missingLeg ?? null) : null;
      const becamePartial = missingLeg !== null && !wasPartial[slotKey];
      const wentDark = from !== null && to === null;

      // A cell that neither moved nor changed character is not news.
      if (from === to && !becamePartial && !wentDark) continue;

      cells.push({ slotKey, from, to, missingLeg, becamePartial, wentDark });
    }

    const delta = Math.round((row.totalScore - before.totalScore) * 100) / 100;
    if (delta === 0 && cells.length === 0) continue;

    // Biggest mover first: that is the cell a reader will want named.
    cells.sort((a, b) => Math.abs((b.to ?? 0) - (b.from ?? 0)) - Math.abs((a.to ?? 0) - (a.from ?? 0)));

    out.push({
      symbol: row.symbol,
      from: before.totalScore,
      to: row.totalScore,
      delta,
      fromBias: before.bias,
      toBias: row.bias,
      biasChanged: before.bias !== row.bias,
      sinceUtc: before.capturedAtUtc,
      cells,
      cause: describeCause(cells),
    });
  }

  /**
   * Bias changes first, then by size of move. A row crossing the Bullish floor
   * is the event; a row drifting 6 -> 7 inside the same band is not.
   */
  return out.sort((a, b) => {
    if (a.biasChanged !== b.biasChanged) return a.biasChanged ? -1 : 1;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
}

/**
 * The most recent snapshot per symbol taken STRICTLY BEFORE a cut-off.
 *
 * The cut-off matters: `/api/ingest` writes the current run's snapshots before
 * the page renders them, so without it every row would be compared against
 * itself and the log would always be empty.
 */
export function latestPerSymbol(
  snapshots: ScoreSnapshot[],
  beforeUtc: string,
): Map<string, ScoreSnapshot> {
  const out = new Map<string, ScoreSnapshot>();

  for (const snapshot of snapshots) {
    if (snapshot.capturedAtUtc >= beforeUtc) continue;
    const held = out.get(snapshot.symbol);
    if (!held || snapshot.capturedAtUtc > held.capturedAtUtc) out.set(snapshot.symbol, snapshot);
  }

  return out;
}

/** How far before the target a snapshot may sit and still count as "then". */
export const DAY_DELTA_TOLERANCE_MS = 2 * 3600_000;

/**
 * Each symbol's score as it stood at `atUtc`: its latest snapshot at or before
 * that moment, provided it is no older than `toleranceMs`.
 *
 * The tolerance is what makes "1D Δ" honest. Without it a symbol whose only
 * snapshot is a week old would report a week's change under a one-day label.
 */
export function scoresAt(
  snapshots: ScoreSnapshot[],
  atUtc: string,
  toleranceMs = DAY_DELTA_TOLERANCE_MS,
): Map<string, number> {
  const floor = new Date(new Date(atUtc).getTime() - toleranceMs).toISOString();
  const held = new Map<string, ScoreSnapshot>();
  for (const s of snapshots) {
    if (s.capturedAtUtc > atUtc || s.capturedAtUtc < floor) continue;
    const prior = held.get(s.symbol);
    if (!prior || s.capturedAtUtc > prior.capturedAtUtc) held.set(s.symbol, s);
  }
  return new Map([...held].map(([symbol, s]) => [symbol, s.totalScore]));
}

/** Score now minus score then, per row; null where there is no "then". */
export function dayDeltas(
  rows: { symbol: string; totalScore: number }[],
  then: Map<string, number>,
): Record<string, number | null> {
  return Object.fromEntries(
    rows.map((r) => [r.symbol, then.has(r.symbol) ? r.totalScore - (then.get(r.symbol) as number) : null]),
  );
}
