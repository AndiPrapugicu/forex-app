import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { biasFromScore } from '@/config/setups.config';
import { mirrorBoard, mirrorDiffCount, PAIR_CONVENTIONS } from '@/lib/scoring/a1-mirror';
import { comparePairAndIndexLegs, parseCapture } from '@/lib/scoring/a1-pair-legs';
import type { MatrixCell, SymbolRow } from '@/lib/scoring/setups';

const CAPTURES = ['a1-top-setups-2026-08-31.csv', 'a1-top-setups-2026-09-01.csv'] as const;

const load = (file: string) =>
  parseCapture(readFileSync(path.join(process.cwd(), 'fixtures', file), 'utf8'), file);

function cell(slotKey: string, value: number | null): MatrixCell {
  return {
    slotKey,
    cell: value,
    status: value === null ? 'no-data' : 'scored',
    explanation: 'test',
  };
}

function row(symbol: string, cells: Record<string, number | null>): SymbolRow {
  const built: Record<string, MatrixCell> = {};
  for (const [key, value] of Object.entries(cells)) built[key] = cell(key, value);
  const total = Object.values(cells).reduce<number>((s, v) => s + (v ?? 0), 0);
  return {
    symbol,
    label: symbol,
    kind: 'fx',
    base: 'EUR',
    quote: 'USD',
    totalScore: total,
    bias: biasFromScore(total),
    categoryScores: { technical: 0, sentiment: 0, growth: 0, inflation: 0, jobs: 0 },
    cells: built,
    populated: Object.keys(cells).length,
    partial: 0,
    price: null,
    changePct: null,
  };
}

describe('mirrorBoard', () => {
  it('negates PPI and says why', () => {
    const [mirrored] = mirrorBoard([row('EURUSD', { ppi: 1 })]);
    expect(mirrored.cells.ppi.cell).toBe(-1);
    expect(mirrored.cells.ppi.mirror).toMatchObject({ tier: 'derived', ours: 1, mirrored: -1 });
    expect(mirrored.cells.ppi.mirror?.why).toContain('STOCKS impact');
  });

  /**
   * The case from the user's own screen: our EURUSD PPI is +1, built from their
   * own EURO leg 0 and US-DOLLAR leg -1, and their EURUSD row prints -1.
   */
  it('turns our +1 EURUSD PPI into the -1 their board prints', () => {
    const capture = load('a1-top-setups-2026-09-01.csv');
    const [mirrored] = mirrorBoard([row('EURUSD', { ppi: 1 })], capture);
    expect(mirrored.cells.ppi.cell).toBe(capture.rows.get('EURUSD')?.ppi);
  });

  it('leaves a null PPI alone rather than inventing a negated zero', () => {
    const [mirrored] = mirrorBoard([row('EURUSD', { ppi: null })]);
    expect(mirrored.cells.ppi.cell).toBeNull();
    expect(mirrored.cells.ppi.mirror?.tier).toBe('ours');
  });

  it('clamps a negated pair cell to the pair range', () => {
    const [mirrored] = mirrorBoard([row('EURUSD', { ppi: -2 })]);
    expect(mirrored.cells.ppi.cell).toBe(2);
  });

  it('takes consumer confidence from a capture and marks it as read, not computed', () => {
    const capture = load('a1-top-setups-2026-09-01.csv');
    const theirs = capture.rows.get('GBPJPY')!['consumer-confidence'];
    const rows = mirrorBoard([row('GBPJPY', { 'consumer-confidence': 0 })], capture);
    expect(rows[0].cells['consumer-confidence'].cell).toBe(theirs);
    expect(rows[0].cells['consumer-confidence'].mirror?.tier).toBe('captured');
  });

  /**
   * The guard that stops the toggle becoming a fixture viewer. Without a
   * capture there is nothing to transcribe, and the honest output is ours.
   */
  it('keeps our consumer confidence when no capture covers the row', () => {
    const rows = mirrorBoard([row('EURUSD', { 'consumer-confidence': 1 })]);
    expect(rows[0].cells['consumer-confidence'].cell).toBe(1);
    expect(rows[0].cells['consumer-confidence'].mirror?.tier).toBe('ours');
    expect(rows[0].cells['consumer-confidence'].mirror?.why).toContain('No capture');
  });

  it('never mirrors mPMI, because their board has no rule there', () => {
    const capture = load('a1-top-setups-2026-09-01.csv');
    const rows = mirrorBoard([row('EURUSD', { mpmi: 2 })], capture);
    expect(rows[0].cells.mpmi.cell).toBe(2);
    expect(rows[0].cells.mpmi.mirror?.tier).toBe('ours');
  });

  it('recomputes the total and the bias from the mirrored cells', () => {
    // ppi +2 mirrors to -2, a four-point swing across the Bullish boundary.
    const rows = mirrorBoard([row('EURUSD', { ppi: 2, cpi: 2, gdp: 1 })]);
    expect(rows[0].oursTotal).toBe(5);
    expect(rows[0].totalScore).toBe(1);
    expect(rows[0].bias).toBe('Neutral');
  });

  it('re-sorts by the mirrored score, since that is the column on screen', () => {
    const rows = mirrorBoard([
      row('LOW', { ppi: 2, cpi: 0 }),
      row('HIGH', { ppi: -2, cpi: 0 }),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'LOW']);
  });

  it('does not mutate the board it was given', () => {
    const original = row('EURUSD', { ppi: 1 });
    mirrorBoard([original]);
    expect(original.cells.ppi.cell).toBe(1);
    expect(original.totalScore).toBe(1);
  });

  it('counts only the cells it actually moved', () => {
    const rows = mirrorBoard([row('EURUSD', { ppi: 1, cpi: 2, mpmi: 1 })]);
    expect(mirrorDiffCount(rows)).toBe(1);
  });

  it('reports no difference when their convention lands on the same number', () => {
    const rows = mirrorBoard([row('EURUSD', { ppi: 0 })]);
    expect(mirrorDiffCount(rows)).toBe(0);
  });
});

/**
 * PAIR_CONVENTIONS is a hand-written table describing a measured fact, and the
 * two can drift. This re-derives the fact from both captures and holds the
 * table to it, so a future capture where A1 fixes PPI — or breaks GDP — cannot
 * leave the mirror silently describing last month's board.
 */
describe('PAIR_CONVENTIONS matches what their captures actually do', () => {
  it.each(CAPTURES)('%s', (file) => {
    const columns = new Map(
      comparePairAndIndexLegs(load(file)).map((c) => [c.slotKey, c]),
    );

    // Every column the table claims is derivable must have an exact leg fit.
    for (const [slotKey, convention] of Object.entries(PAIR_CONVENTIONS)) {
      const column = columns.get(slotKey);
      expect(column, slotKey).toBeDefined();
      if (convention.tier === 'derived') {
        expect(column!.agreement, slotKey).toBe('NEGATED');
        expect(column!.pairsExplained, slotKey).toBe(column!.pairsTotal);
      }
    }

    // And every column the table is SILENT about must be one where their two
    // surfaces agree — otherwise the mirror is missing a convention.
    for (const column of columns.values()) {
      if (PAIR_CONVENTIONS[column.slotKey]) continue;
      expect(column.agreement, column.slotKey).toBe('IDENTICAL');
    }
  });
});
