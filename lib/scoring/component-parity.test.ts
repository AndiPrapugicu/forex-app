/**
 * The parity-status precedence, one case per branch.
 *
 * Built on real `SymbolDefinition`s (EURUSD, EURCHF) so `reproducibilityOf`
 * and `blockedReason`'s shape checks (isFx, isCross, currency-index) run
 * against the config they actually read in production, the same reason
 * `a1-legs.test.ts` imports `SCORING_SLOTS` rather than fabricating slots.
 */

import { describe, expect, it } from 'vitest';
import { ALL_SYMBOLS } from '@/config/symbols.config';
import { buildComponentParityMatrix, type ComponentParityContext } from '@/lib/scoring/component-parity';
import type { Leg } from '@/lib/scoring/a1-legs';
import type { SymbolRow } from '@/lib/scoring/setups';
import type { Currency } from '@/lib/types';

const EURUSD = ALL_SYMBOLS.find((d) => d.symbol === 'EURUSD')!;
const EURCHF = ALL_SYMBOLS.find((d) => d.symbol === 'EURCHF')!;

/** A row with exactly one populated cell, everything else null. */
function row(symbol: string, cellKey: string, cell: number | null): SymbolRow {
  return {
    symbol,
    label: symbol,
    kind: 'fx',
    totalScore: 0,
    bias: 'Neutral',
    categoryScores: { technical: 0, sentiment: 0, growth: 0, inflation: 0, jobs: 0 },
    cells: { [cellKey]: { slotKey: cellKey, cell, status: cell === null ? 'no-data' : 'scored', explanation: '' } },
    populated: 0,
    partial: 0,
    price: null,
    changePct: null,
  };
}

function ctx(overrides: Partial<ComponentParityContext>): ComponentParityContext {
  return {
    date: '2026-08-24',
    liveNow: false,
    ourRows: new Map(),
    checksummedCells: {},
    checksummedSource: 'test fixture',
    legs: new Map(),
    symbols: [],
    ...overrides,
  };
}

describe('component parity status precedence', () => {
  it('EXACT — checksummed cell agrees with ours', () => {
    const matrix = buildComponentParityMatrix(
      ctx({
        symbols: [EURUSD],
        ourRows: new Map([['EURUSD', row('EURUSD', 'cot', 2)]]),
        checksummedCells: { EURUSD: { cot: 2 } },
      }),
    );
    const cell = matrix.cells.find((c) => c.component === 'cot')!;
    expect(cell.status).toBe('EXACT');
    expect(cell.evidenceTier).toBe('CHECKSUMMED_CELL');
  });

  it('MISMATCH — checksummed cell disagrees on a HISTORICAL column', () => {
    const matrix = buildComponentParityMatrix(
      ctx({
        date: '2026-08-24',
        liveNow: false, // rewound date, but `cot` is HISTORICAL so this must not read TIMING_CONFOUNDED
        symbols: [EURUSD],
        ourRows: new Map([['EURUSD', row('EURUSD', 'cot', 1)]]),
        checksummedCells: { EURUSD: { cot: 2 } },
      }),
    );
    const cell = matrix.cells.find((c) => c.component === 'cot')!;
    expect(cell.status).toBe('MISMATCH');
  });

  it('TIMING_CONFOUNDED — checksummed mismatch on a LIVE_ONLY column at a rewound date', () => {
    // `crowd`, not `trend`. This case used trend until 2026-08-30, when the
    // price series learned to rewind and trend became HISTORICAL — see the
    // next test. Crowd is the column that is still genuinely un-rewindable: its
    // top rung is a live retail feed with no dated history anywhere.
    const matrix = buildComponentParityMatrix(
      ctx({
        date: '2026-08-24',
        liveNow: false,
        symbols: [EURUSD],
        ourRows: new Map([['EURUSD', row('EURUSD', 'crowd', 1)]]),
        checksummedCells: { EURUSD: { crowd: -1 } },
      }),
    );
    const cell = matrix.cells.find((c) => c.component === 'crowd')!;
    expect(cell.status).toBe('TIMING_CONFOUNDED');
    expect(cell.reproducibility).toBe('LIVE_ONLY');
  });

  it('trend is HISTORICAL now that the price series rewinds, so its gaps are not excused', () => {
    /**
     * THE POINT OF THIS TEST IS THE DIRECTION OF THE ERROR.
     *
     * While the pipeline scored a rewound board off today's moving averages,
     * LIVE_ONLY was the correct label and a trend gap really was clock noise.
     * Once `pricesAsOf` reached the price series that stopped being true, and a
     * stale label would hide a real disagreement as timing — which is the
     * unsafe direction for a diagnostic to be wrong in. All eight checksummed
     * trend cells agree today, so this changes no count; it decides what
     * happens the first time one does not.
     */
    const matrix = buildComponentParityMatrix(
      ctx({
        date: '2026-08-24',
        liveNow: false,
        symbols: [EURUSD],
        ourRows: new Map([['EURUSD', row('EURUSD', 'trend', 2)]]),
        checksummedCells: { EURUSD: { trend: -1 } },
      }),
    );
    const cell = matrix.cells.find((c) => c.component === 'trend')!;
    expect(cell.reproducibility).toBe('HISTORICAL');
    expect(cell.status).toBe('MISMATCH');
  });

  it('the same LIVE_ONLY mismatch reads as an ordinary MISMATCH when the date IS live', () => {
    const matrix = buildComponentParityMatrix(
      ctx({
        date: '2026-08-25',
        liveNow: true,
        symbols: [EURUSD],
        ourRows: new Map([['EURUSD', row('EURUSD', 'crowd', 1)]]),
        checksummedCells: { EURUSD: { crowd: -1 } },
      }),
    );
    const cell = matrix.cells.find((c) => c.component === 'crowd')!;
    expect(cell.status).toBe('MISMATCH');
  });

  it('NOT_VISIBLE — a US-only column on a row with no dollar leg, A1 prints 0', () => {
    const matrix = buildComponentParityMatrix(
      ctx({
        symbols: [EURCHF],
        ourRows: new Map([['EURCHF', row('EURCHF', 'pce', null)]]),
        checksummedCells: { EURCHF: { pce: 0 } },
      }),
    );
    const cell = matrix.cells.find((c) => c.component === 'pce')!;
    expect(cell.status).toBe('NOT_VISIBLE');
  });

  it('BLOCKED_SOURCE — crowd on a cross, ours null for a known reason, even against a real checksummed value', () => {
    // The actual EURCHF evidence: A1 prints crowd +1, our crowd is null (no cross feed).
    const matrix = buildComponentParityMatrix(
      ctx({
        symbols: [EURCHF],
        ourRows: new Map([['EURCHF', row('EURCHF', 'crowd', null)]]),
        checksummedCells: { EURCHF: { crowd: 1 } },
      }),
    );
    const cell = matrix.cells.find((c) => c.component === 'crowd')!;
    expect(cell.status).toBe('BLOCKED_SOURCE');
    expect(cell.theirValue).toBe(1);
  });

  it('NOT_CHECKSUMMED — no checksummed cell, but the leg solve pins every currency the equation needs', () => {
    const legs = new Map<Currency, Partial<Record<string, Leg>>>([
      ['EUR', { gdp: 1 }],
      ['CHF', { gdp: 0 }],
    ]);
    const matrix = buildComponentParityMatrix(
      ctx({
        symbols: [EURCHF],
        ourRows: new Map([['EURCHF', row('EURCHF', 'gdp', 1)]]),
        legs,
      }),
    );
    const cell = matrix.cells.find((c) => c.component === 'gdp')!;
    expect(cell.status).toBe('NOT_CHECKSUMMED');
    expect(cell.theirValue).toBe(1); // EUR(1) - CHF(0)
    expect(cell.evidenceSource).toContain('EUR');
  });

  it('UNKNOWN — no checksummed cell and the solve leaves the needed legs unpinned', () => {
    const matrix = buildComponentParityMatrix(
      ctx({
        symbols: [EURUSD],
        ourRows: new Map([['EURUSD', row('EURUSD', 'gdp', 1)]]),
        legs: new Map(), // nothing solved
      }),
    );
    const cell = matrix.cells.find((c) => c.component === 'gdp')!;
    expect(cell.status).toBe('UNKNOWN');
    expect(cell.theirValue).toBeNull();
  });
});
