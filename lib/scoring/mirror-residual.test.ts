/**
 * The residual's buckets must account for the whole distance, per slot and in
 * total — the same discipline `attribute()` in scripts/parity.ts enforces. A
 * readout whose parts do not sum to its whole is explaining a number that was
 * never measured.
 */

import { describe, expect, it } from 'vitest';

import type { A1Capture } from '@/lib/scoring/a1-pair-legs';
import { mirrorResidual } from '@/lib/scoring/mirror-residual';
import type { MatrixCell, SymbolRow } from '@/lib/scoring/setups';

function row(symbol: string, cells: Record<string, number | null>): SymbolRow {
  const out: Record<string, MatrixCell> = {};
  let total = 0;
  for (const [k, v] of Object.entries(cells)) {
    out[k] = { slotKey: k, cell: v, status: v === null ? 'no-data' : 'scored', explanation: '' };
    total += v ?? 0;
  }
  return {
    symbol,
    totalScore: total,
    bias: 'Neutral',
    categoryScores: { technical: 0, sentiment: 0, growth: 0, inflation: 0, jobs: 0 },
    cells: out,
  } as unknown as SymbolRow;
}

function capture(rows: Record<string, Record<string, number>>): A1Capture {
  return {
    label: 'test-capture',
    rows: new Map(Object.entries(rows)),
    scores: new Map(),
    bias: new Map(),
  } as unknown as A1Capture;
}

describe('mirrorResidual', () => {
  // EURUSD is named identically on their board, so no symbol mapping is needed.
  const theirs = capture({ EURUSD: { ppi: -1, 'retail-sales': 0, cpi: 2, 'consumer-confidence': 1 } });

  const ours = [row('EURUSD', { ppi: 1, 'retail-sales': 1, cpi: 0, 'consumer-confidence': 0 })];
  // The a1 profile blanks retail sales, as a coverage entry would.
  const a1 = [row('EURUSD', { ppi: 1, 'retail-sales': null, cpi: 0, 'consumer-confidence': 0 })];

  const got = mirrorResidual(ours, a1, theirs);

  it('attributes each kind of closure to its own bucket', () => {
    expect(got.start).toBe(2 + 1 + 2 + 1);
    expect(got.total.coverage).toBe(1); // retail 1 -> blank
    expect(got.total.convention).toBe(2); // PPI negated, +1 -> -1
    expect(got.total.captured).toBe(1); // consumer confidence copied off their screen
    expect(got.total.unexplained).toBe(2); // CPI, still 0 vs 2
  });

  it('sums its buckets to the starting distance, in total and per slot', () => {
    const sum = (b: typeof got.total) => b.coverage + b.convention + b.captured + b.unexplained;
    expect(sum(got.total)).toBe(got.start);
    for (const [slotKey, b] of Object.entries(got.bySlot)) {
      expect(sum(b), slotKey).toBe(b.start);
    }
  });

  it('lists the cells nothing explains, and only those', () => {
    expect(got.unexplainedCells).toEqual([{ symbol: 'EURUSD', slotKey: 'cpi', ours: 0, a1: 2 }]);
  });

  it('skips a captured row we do not model rather than scoring it as a gap', () => {
    const extra = capture({ EURUSD: { cpi: 2 }, 'NOT-A-SYMBOL': { cpi: 2 } });
    expect(mirrorResidual(ours, a1, extra).cellsCompared).toBe(1);
  });
});
