/**
 * The provenance predicate, and the source-kind coverage it depends on.
 *
 * The second `describe` is the one that pays for itself repeatedly:
 * `computeConfidence` reads `SOURCE_CONFIDENCE[sourceKey] ?? 50`, so a new
 * member of `SourceKind` with no weight gets a silent 50 and nothing fails.
 */

import { describe, expect, it } from 'vitest';

import { SLOTS } from '@/config/setups.config';
import { SOURCE_CONFIDENCE } from '@/config/scoring.config';
import { A1_SOURCED, cellIsA1Sourced, rowA1Contribution } from '@/lib/scoring/provenance';
import type { CellLeg, MatrixCell, SymbolRow } from '@/lib/scoring/setups';
import type { SourceKind } from '@/lib/types';

function leg(actualSource: string | null): CellLeg {
  return {
    currency: 'EUR',
    seriesName: 'HCOB Services PMI',
    actual: 51.7,
    reference: 51.5,
    referenceLabel: 'previous',
    consensus: null,
    previous: 51.5,
    unit: null,
    sigma: null,
    dateUtc: '2026-08-21T00:00:00.000Z',
    cell: 1,
    status: 'scored',
    actualSource,
  };
}

function cell(legs: CellLeg[] | undefined, value: number | null = 1): MatrixCell {
  return { slotKey: 'spmi', cell: value, status: 'scored', explanation: '', legs };
}

describe('cellIsA1Sourced', () => {
  it('is true when any leg carries an A1-sourced actual', () => {
    expect(cellIsA1Sourced(cell([leg('fxstreet'), leg('a1-capture')]))).toBe(true);
  });

  it('is false when every leg came from a calendar of record', () => {
    expect(cellIsA1Sourced(cell([leg('fxstreet'), leg('tradingview')]))).toBe(false);
  });

  it('treats a cell with no legs as clean', () => {
    // Technical, sentiment and rates slots have no calendar release behind
    // them, so there is no input a capture could have supplied.
    expect(cellIsA1Sourced(cell(undefined))).toBe(false);
    expect(cellIsA1Sourced(cell([]))).toBe(false);
  });

  it('treats a null actualSource as clean', () => {
    expect(cellIsA1Sourced(cell([leg(null)]))).toBe(false);
  });
});

describe('rowA1Contribution', () => {
  const row = (cells: Record<string, MatrixCell>): SymbolRow =>
    ({ symbol: 'EURUSD', cells } as unknown as SymbolRow);

  it('names the A1-sourced scoring slots and sums their points', () => {
    const got = rowA1Contribution(
      row({
        spmi: cell([leg('a1-capture')], 2),
        mpmi: { ...cell([leg('a1-capture')], -1), slotKey: 'mpmi' },
        cpi: { ...cell([leg('fxstreet')], 2), slotKey: 'cpi' },
      }),
    );
    expect(got.slots).toEqual(['mpmi', 'spmi']);
    expect(got.points).toBe(1);
  });

  it('ignores slots that do not score, because they never reach a total', () => {
    // A display-only slot counted here would subtract points from a total that
    // never contained them.
    const nonScoring = SLOTS.find((s) => !s.scoring)?.key;
    expect(nonScoring, 'config has no non-scoring slot to test against').toBeTypeOf('string');
    const got = rowA1Contribution(
      row({ [nonScoring!]: { ...cell([leg('a1-capture')], 2), slotKey: nonScoring! } }),
    );
    expect(got.slots).toEqual([]);
    expect(got.points).toBe(0);
  });
});

describe('SourceKind coverage', () => {
  it('gives every source kind a confidence weight', () => {
    // Exhaustive by construction: the object literal below fails to typecheck
    // if a member of the union is missing, and the runtime assertion catches a
    // weight that was added to the type but not to the table.
    const everyKind: Record<SourceKind, true> = {
      manual: true,
      fxstreet: true,
      faireconomy: true,
      dbnomics: true,
      tradingview: true,
      'ai-extracted': true,
      'a1-capture': true,
      fixture: true,
    };
    for (const kind of Object.keys(everyKind) as SourceKind[]) {
      expect(SOURCE_CONFIDENCE[kind], kind).toBeTypeOf('number');
    }
  });

  it('marks a1-capture as A1-sourced and nothing else', () => {
    expect([...A1_SOURCED]).toEqual(['a1-capture']);
  });
});
