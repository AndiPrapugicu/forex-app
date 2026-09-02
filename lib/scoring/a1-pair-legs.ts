/**
 * A1's board publishes the same eight macro legs TWICE, and the two copies
 * disagree. This module reads both and names the disagreement per column.
 *
 * WHERE THIS CAME FROM. `HARDENING.md` 7 recorded that A1's pair rows are
 * "broken on four columns" and stopped there, and `scripts/leg-parity.ts` was
 * built to avoid them entirely. That was right about the pair rows being
 * unusable as a naive parity target and WRONG about why, in a way that cost a
 * real finding: the pair rows are not noisy, they are leg-differenced exactly
 * like the index rows, out of a DIFFERENT leg vector. Solving that vector turns
 * "their board is broken" into eight specific, checkable statements.
 *
 * THE METHOD. Every fx pair row is one equation over eight unknown legs, so 28
 * rows against 8 currencies is enormously over-determined; `solveA1Legs` already
 * does exactly this solve, with the ambiguity and conflict handling that took
 * several rounds to get right. Feeding it ONLY the pair rows yields the leg
 * vector their pair board is actually built on. The index rows are then read
 * directly, since a single-currency row's cell IS that currency's leg.
 *
 * WHAT IT FOUND, on 2026-08-31 and 2026-09-01 independently and identically:
 *
 *   GDP, sPMI, RetailSales, CPI   the two vectors are IDENTICAL. 28/28.
 *   PPI                           the pair vector is the exact NEGATION of the
 *                                 index vector, all eight currencies.
 *   CnsmrConf                     the pair vector is a full ternary set; the
 *                                 index rows print 0 for seven of eight.
 *   PCE                           one leg differs (JPY), one row unexplained.
 *   mPMI                          NO leg vector explains the pair rows at all
 *                                 (best fit 20/28). Genuinely inconsistent.
 *
 * The PPI result is not a coin flip between two surfaces. Their own country
 * heatmap publishes a `currencyImpact` and a `stocksImpact` for every release,
 * and the negation is exactly that pairing: their INDEX rows follow
 * `currencyImpact` and their PAIR rows follow `stocksImpact`. See
 * `PPI_READS_STOCKS_IMPACT` — a wiring error with a name, not an unknown.
 *
 * WHAT THIS DOES NOT CLAIM. Neither surface is evidence that A1 is right. UK
 * PPI at 3.1 against a 3.2 forecast is a miss and therefore bearish for
 * sterling, which is what their heatmap's `currencyImpact` says and what we
 * score; that is why the index side is the defensible one. The argument is
 * sourced to the release, not to whichever surface is in the majority.
 */

import { ALL_SYMBOLS, findSymbol } from '@/config/symbols.config';
import { solveA1Legs, type CapturedCells, type Leg } from '@/lib/scoring/a1-legs';
import { A1_COLUMN_TO_SLOT, CURRENCY_INDEX_ROW } from '@/lib/scoring/a1-symbol-map';
import { CURRENCIES, type Currency } from '@/lib/types';

/** One parsed board capture: A1's row name -> their printed cells, by our slot key. */
export interface A1Capture {
  /** The fixture's own filename or date, carried for reporting. */
  label: string;
  /** A1 row name -> { slotKey: cell }. */
  rows: Map<string, CapturedCells>;
  /** A1 row name -> the Score column they printed. */
  scores: Map<string, number>;
  /** A1 row name -> the Bias label they printed. */
  bias: Map<string, string>;
}

/**
 * Parse one of the `fixtures/a1-top-setups-*.csv` captures.
 *
 * Takes text rather than a path so this stays importable from a test without a
 * filesystem, and from a script without a second parser.
 */
export function parseCapture(text: string, label: string): A1Capture {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const rows = new Map<string, CapturedCells>();
  const scores = new Map<string, number>();
  const bias = new Map<string, string>();

  for (const line of lines.slice(1)) {
    const values = line.split(',');
    const record: Record<string, string> = {};
    head.forEach((h, i) => { record[h] = values[i]; });
    const name = record.Symbol;
    if (!name) continue;

    const cells: CapturedCells = {};
    for (const [column, slotKey] of Object.entries(A1_COLUMN_TO_SLOT)) {
      const raw = record[column];
      if (raw === undefined || raw === '') continue;
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) cells[slotKey] = n;
    }
    rows.set(name, cells);
    scores.set(name, Number.parseInt(record.Score, 10));
    bias.set(name, record.Bias ?? '');
  }

  return { label, rows, scores, bias };
}

/** How the pair-solved leg vector relates to the published index-row vector. */
export type LegAgreement =
  /** The two vectors are the same. The column is one column. */
  | 'IDENTICAL'
  /** Pair legs are the exact negation of the index legs, every currency. */
  | 'NEGATED'
  /** Index rows print 0 where the pair rows carry a leg — the index side is blank. */
  | 'INDEX_BLANK'
  /** Both carry values and they differ, without a stateable relation. */
  | 'DIFFERS'
  /** No leg vector explains the pair rows. Their pair board contradicts itself. */
  | 'UNSOLVABLE';

export interface ColumnComparison {
  slotKey: string;
  /** A1's own header for this column. */
  column: string;
  /** Solved from the fx pair rows alone. */
  pairLegs: Partial<Record<Currency, Leg>>;
  /** Read straight off the eight single-currency rows. */
  indexLegs: Partial<Record<Currency, number>>;
  /**
   * Pair rows the solved vector reproduces, out of those it had equations for.
   *
   * Taken from the solver's own tally rather than recomputed from `pairLegs`.
   * On an UNSOLVABLE column the solver deliberately leaves contested legs
   * unpinned, so recomputing would report 0/29 for a column that in fact fits
   * 27 of its rows — which reads as a catastrophe rather than as one bad cell.
   */
  pairsExplained: number;
  pairsTotal: number;
  /**
   * Pair rows the INDEX vector reproduces — the number that motivated all this.
   *
   * Counted over `comparablePairs` only: USDZAR is on their board and ZAR has
   * no index row, so a shared denominator is the only way the two figures sit
   * in the same sentence.
   */
  pairsExplainedByIndexLegs: number;
  comparablePairs: number;
  agreement: LegAgreement;
  /** Currencies where the two vectors differ, with both values. */
  differing: { currency: Currency; pair: number; index: number }[];
}

const clampPair = (n: number) => Math.max(-2, Math.min(2, n));

/**
 * Columns whose pair cell is a leg difference at all.
 *
 * Trend and seasonality are properties of ONE symbol's price series — GBPJPY's
 * own moving averages, GBPJPY's own ten Augusts — so there is no leg to solve
 * and no index row to compare against. `UNSOLVABLE_SLOTS` in a1-legs.ts says
 * the same thing for the same reason; this list is the macro subset that has
 * both a pair row and an index row, which is what makes the comparison possible.
 */
export const DIFFERENCED_MACRO_SLOTS = [
  'gdp', 'mpmi', 'spmi', 'retail-sales', 'consumer-confidence',
  'cpi', 'ppi', 'pce',
] as const;

/**
 * A1's PPI pair rows read the release's STOCKS impact, not its currency impact.
 *
 * Their country heatmap publishes both for every row. On the 2026-08-31 capture
 * the PPI row reads, per economy:
 *
 *   US  currency Bearish / stocks Bullish      index leg -1, pair leg +1
 *   UK  currency Bearish / stocks Bullish      index leg -1, pair leg +1
 *   JP  currency Bearish / stocks Bullish      index leg -1, pair leg +1
 *   CA  currency Bullish / stocks Bearish      index leg +1, pair leg -1
 *   AU  currency Bullish / stocks Bearish      index leg +1, pair leg -1
 *   NZ  currency Bullish / stocks Bearish      index leg +1, pair leg -1
 *   EU  Neutral / Neutral                      index leg  0, pair leg  0
 *   CH  Neutral / Neutral                      index leg  0, pair leg  0
 *
 * Eight of eight. The two impacts are opposite whenever either is non-neutral,
 * which is why the whole vector reads as a clean sign flip — the flip is the
 * symptom, the wrong column is the cause.
 *
 * IT IS THEIR PAIR ROWS THAT ARE WRONG, and this is decided by the release
 * rather than by a vote: a PPI print BELOW its forecast is a miss, which is
 * bearish for that currency. `currencyImpact` says so, their index rows say so,
 * their heatmaps say so, and we score it that way. Only the pair board dissents.
 */
export const PPI_READS_STOCKS_IMPACT =
  "A1's pair rows score PPI from the release's stocks impact instead of its " +
  'currency impact. Their heatmap publishes both, and the two are opposite ' +
  'whenever either is non-neutral, so the whole leg vector reads as a sign flip.';

/**
 * Compare the two leg vectors this capture publishes, column by column.
 *
 * `solveA1Legs` is given the fx pair rows ONLY. Including the index rows would
 * defeat the entire point: the solver would fit both surfaces at once and
 * report a contradiction instead of two coherent vectors that differ.
 */
export function comparePairAndIndexLegs(capture: A1Capture): ColumnComparison[] {
  const pairRows: Record<string, CapturedCells> = {};
  for (const [name, cells] of capture.rows) {
    const def = findSymbol(name) ?? ALL_SYMBOLS.find((s) => s.symbol === name);
    // A1 names pairs exactly as we do (EURUSD), so a direct lookup is enough.
    if (def?.base && def.quote) pairRows[def.symbol] = cells;
  }

  const solved = solveA1Legs(pairRows);
  const byKey = new Map(solved.columns.map((c) => [c.slotKey, c]));

  const out: ColumnComparison[] = [];
  for (const slotKey of DIFFERENCED_MACRO_SLOTS) {
    const column = solvedColumnName(slotKey);
    const solvedColumn = byKey.get(slotKey);

    const indexLegs: Partial<Record<Currency, number>> = {};
    for (const currency of CURRENCIES) {
      const rowName = CURRENCY_INDEX_ROW[currency];
      const cell = rowName ? capture.rows.get(rowName)?.[slotKey] : undefined;
      if (cell !== undefined) indexLegs[currency] = cell;
    }

    const pairLegs = solvedColumn?.legs ?? {};
    const satisfiable = solvedColumn?.satisfiable ?? false;

    /** Pairs both vectors can speak to, so the two counts share a denominator. */
    const comparable = Object.keys(pairRows).filter((symbol) => {
      if (pairRows[symbol][slotKey] === undefined) return false;
      const def = findSymbol(symbol);
      return def?.base !== undefined && def.quote !== undefined
        && indexLegs[def.base] !== undefined && indexLegs[def.quote] !== undefined;
    });

    const explainedByIndex = comparable.filter((symbol) => {
      const def = findSymbol(symbol)!;
      const base = indexLegs[def.base as Currency] as number;
      const quote = indexLegs[def.quote as Currency] as number;
      return clampPair(base - quote) === pairRows[symbol][slotKey];
    }).length;

    /**
     * An UNSOLVABLE column has no coherent leg vector, so a per-currency
     * comparison against one is not a finding — it is a reading of whichever
     * legs happened to survive the tie-break. Report nothing rather than
     * something that looks like a diagnosis.
     */
    const differing: ColumnComparison['differing'] = [];
    if (satisfiable) {
      for (const currency of CURRENCIES) {
        const pair = pairLegs[currency];
        const index = indexLegs[currency];
        if (pair === undefined || index === undefined) continue;
        if (pair !== index) differing.push({ currency, pair, index });
      }
    }

    out.push({
      slotKey,
      column,
      pairLegs,
      indexLegs,
      pairsExplained: solvedColumn?.satisfied ?? 0,
      pairsTotal: solvedColumn?.equations ?? 0,
      pairsExplainedByIndexLegs: explainedByIndex,
      comparablePairs: comparable.length,
      agreement: classify(satisfiable, pairLegs, indexLegs, differing),
      differing,
    });
  }
  return out;
}

function classify(
  satisfiable: boolean,
  pairLegs: Partial<Record<Currency, Leg>>,
  indexLegs: Partial<Record<Currency, number>>,
  differing: ColumnComparison['differing'],
): LegAgreement {
  if (!satisfiable) return 'UNSOLVABLE';
  if (differing.length === 0) return 'IDENTICAL';

  const shared = CURRENCIES.filter(
    (c) => pairLegs[c] !== undefined && indexLegs[c] !== undefined,
  );

  /**
   * NEGATED is asserted over EVERY shared currency, not merely over the ones
   * that differ. A vector where three legs flip and the rest happen to be zero
   * is a sign flip; one where a fourth leg moved from +1 to 0 is not, and
   * calling it one would hide a second, unrelated fault inside a tidy label.
   */
  if (shared.length > 0 && shared.every((c) => pairLegs[c] === -(indexLegs[c] as number))) {
    return 'NEGATED';
  }

  /** Every disagreement is the index row printing 0 against a real pair leg. */
  if (differing.every((d) => d.index === 0 && d.pair !== 0)) return 'INDEX_BLANK';

  return 'DIFFERS';
}

function solvedColumnName(slotKey: string): string {
  const found = Object.entries(A1_COLUMN_TO_SLOT).find(([, key]) => key === slotKey);
  return found ? found[0] : slotKey;
}
