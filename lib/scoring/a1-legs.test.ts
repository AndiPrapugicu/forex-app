/**
 * The leg solver, tested on SYNTHETIC captures.
 *
 * Deliberately not tested against `fixtures/a1-board.json`: that file is
 * evidence and it changes whenever a frame is transcribed, so pinning assertions
 * to it would make a test fail for the good reason that new evidence arrived.
 * The fixture's own internal consistency is asserted in
 * `edgefinder-parity.test.ts`, where a failure means "go re-read a cell" rather
 * than "the solver broke".
 */

import { describe, expect, it } from 'vitest';
import { SCORING_SLOTS } from '@/config/setups.config';
import {
  checkBounds,
  checkRowSum,
  checkStructuralZeros,
  solveA1Legs,
  solvePerCapture,
  symbolsInMultipleCaptures,
  type CapturedCells,
} from '@/lib/scoring/a1-legs';

/** A full 18-column row, zero everywhere except the named cells. */
function row(cells: Record<string, number>): CapturedCells {
  const out: CapturedCells = {};
  for (const slot of SCORING_SLOTS) out[slot.key] = 0;
  return { ...out, ...cells };
}

function legOf(result: ReturnType<typeof solveA1Legs>, currency: string, slotKey: string) {
  return result.legs.get(currency as never)?.[slotKey];
}

describe('leg solver: what a captured cell constrains', () => {
  it('pins BOTH legs from a single +/-2 pair cell', () => {
    // GBP - JPY = +2 has exactly one solution over {-1,0,+1}.
    const result = solveA1Legs({ GBPJPY: row({ gdp: 2 }) });

    expect(legOf(result, 'GBP', 'gdp')).toBe(1);
    expect(legOf(result, 'JPY', 'gdp')).toBe(-1);
    expect(result.contradicted).toHaveLength(0);
  });

  it('leaves a +/-1 pair cell ambiguous rather than guessing', () => {
    // GBP - JPY = +1 has three solutions. Reporting one would be a coin flip.
    const result = solveA1Legs({ GBPJPY: row({ gdp: 1 }) });

    expect(legOf(result, 'GBP', 'gdp')).toBeUndefined();
    expect(result.columns.find((c) => c.slotKey === 'gdp')?.ambiguous).toEqual(
      expect.arrayContaining(['GBP', 'JPY']),
    );
  });

  it('reads a currency-index row as one leg directly', () => {
    const result = solveA1Legs({ JPYX: row({ cpi: -1 }) });

    expect(legOf(result, 'JPY', 'cpi')).toBe(-1);
  });

  it('combines an index row with a pair row to pin the second leg', () => {
    const result = solveA1Legs({
      JPYX: row({ cpi: -1 }),
      GBPJPY: row({ cpi: 1 }), // GBP - (-1) = 1  =>  GBP = 0
    });

    expect(legOf(result, 'GBP', 'cpi')).toBe(0);
    expect(result.contradicted).toHaveLength(0);
  });

  it('reads gold INVERTED, through the same polarity table the matrix uses', () => {
    // GOLD_POLARITY sends growth to -1: a hotter US print is bearish for gold.
    const result = solveA1Legs({ XAUUSD: row({ gdp: -1 }) });

    expect(legOf(result, 'USD', 'gdp')).toBe(1);
  });

  it('files a polarity-derived contradiction as assumed, not as a misread cell', () => {
    /**
     * Three unconditional rows pin USD at +1; the gold row then needs -1. Gold
     * reaches its leg through GOLD_POLARITY, which is OUR model of their model,
     * so the row is condemned in the `assumed` tier — a contradiction there may
     * be our polarity table rather than their cell, and it must never be
     * grounds for editing a capture.
     */
    const result = solveA1Legs({
      DXY: row({ gdp: 1 }), // USD = +1
      GBPX: row({ gdp: 1 }), // GBP = +1
      GBPUSD: row({ gdp: 0 }), // GBP - USD = 0, agreeing
      XAUUSD: row({ gdp: 1 }), // needs USD = -1 through GOLD_POLARITY
    });

    expect(result.contradicted.map((c) => c.slotKey)).toEqual(['gdp']);
    expect(result.conflicts).toHaveLength(0);
    expect(result.assumedConflicts.map((c) => c.symbol)).toEqual(['XAUUSD']);
  });
});

describe('leg solver: columns that carry no leg relationship', () => {
  it('ignores trend and seasonality entirely — they are one symbol’s price history', () => {
    const result = solveA1Legs({ GBPJPY: row({ trend: 2, seasonality: -1 }) });

    expect(result.columns.map((c) => c.slotKey)).not.toContain('trend');
    expect(result.columns.map((c) => c.slotKey)).not.toContain('seasonality');
  });

  it('takes COT from fx pairs only, because an index row scores it by another rule', () => {
    // CADX.cot is scoreCot(series,'asset') — positioning PLUS change, bound 2 —
    // which is not the weekly-change leg a pair differences.
    const indexOnly = solveA1Legs({ CADX: row({ cot: -2 }) });
    expect(indexOnly.columns.map((c) => c.slotKey)).not.toContain('cot');

    const withPair = solveA1Legs({ GBPJPY: row({ cot: 2 }) });
    expect(legOf(withPair, 'GBP', 'cot')).toBe(1);
    expect(legOf(withPair, 'JPY', 'cot')).toBe(-1);
  });

  it('excludes DXY from the rates column, whose cell is the negated 2-year read', () => {
    const result = solveA1Legs({ DXY: row({ rates: 1 }) });

    expect(result.columns.map((c) => c.slotKey)).not.toContain('rates');
  });

  it('keeps the other currency indices in the rates column', () => {
    const result = solveA1Legs({ GBPX: row({ rates: 1 }) });

    expect(legOf(result, 'GBP', 'rates')).toBe(1);
  });

  it('models the crowd clamp, which is the only column that clamps', () => {
    /**
     * Legs of +1 and -1 difference to +2, and crowd is bounded at 1, so the
     * pair cell reads +1. Without the clamp this trio is a contradiction — and
     * a false one, manufactured by the solver rather than found in the capture.
     */
    const result = solveA1Legs({
      GBPX: row({ crowd: 1 }),
      JPYX: row({ crowd: -1 }),
      GBPJPY: row({ crowd: 1 }),
    });

    expect(result.contradicted).toHaveLength(0);
    expect(legOf(result, 'GBP', 'crowd')).toBe(1);
    expect(legOf(result, 'JPY', 'crowd')).toBe(-1);
  });

  it('is LOSSY on crowd: a +1 pair cell alone pins neither leg', () => {
    const result = solveA1Legs({ GBPJPY: row({ crowd: 1 }) });

    expect(result.contradicted).toHaveLength(0);
    expect(legOf(result, 'GBP', 'crowd')).toBeUndefined();
    expect(legOf(result, 'JPY', 'crowd')).toBeUndefined();
  });
});

describe('leg solver: catching what the sum check cannot', () => {
  it('reports a contradiction that BOTH rows pass the sum check on', () => {
    /**
     * The real case, live in the fixture: CADX puts CAD's consumer-confidence
     * leg at 0, while CADCHF's -2 needs CAD at -1 and CHF at +1. Both rows sum
     * to their published totals, so `checkRowSum` clears both.
     */
    const cadx = row({ trend: 2, seasonality: -1, cot: -2, crowd: 1, mpmi: 1, spmi: 1, 'retail-sales': -1, cpi: 1, ppi: 1, claims: 1, 'consumer-confidence': 0 });
    const cadchf = row({ trend: 2, seasonality: -1, gdp: -1, mpmi: 2, cpi: 1, ppi: -1, unemployment: 2, 'consumer-confidence': -2 });

    expect(checkRowSum(cadx, 4).ok).toBe(true);
    expect(checkRowSum(cadchf, 2).ok).toBe(true);

    const result = solveA1Legs({ CADX: cadx, CADCHF: cadchf });
    const column = result.contradicted.find((c) => c.slotKey === 'consumer-confidence');

    expect(column).toBeDefined();
    expect(column!.satisfied).toBeLessThan(column!.equations);
    expect(column!.suspects).toEqual(['CADCHF', 'CADX']);
  });

  it('names a contradicted column even when no single row can be blamed', () => {
    /**
     * The usual shape: every best fit keeps one row and drops the other, so
     * neither is condemned unanimously and `conflicts` stays empty. Reporting
     * only `conflicts` would downgrade a definite contradiction to a quiet
     * "ambiguous leg", which is how the finding gets lost.
     */
    const result = solveA1Legs({
      CADX: row({ gdp: 0 }),
      CADCHF: row({ gdp: -2 }),
    });

    expect(result.conflicts).toHaveLength(0);
    expect(result.contradicted.map((c) => c.slotKey)).toEqual(['gdp']);
    expect(result.contradicted[0].suspects).toEqual(['CADCHF', 'CADX']);
  });

  it('condemns one row outright once other rows pin both its legs', () => {
    /**
     * This is the payoff of transcribing the whole grid rather than four rows.
     * With CAD and CHF each pinned by their own index row, CADCHF's -2 is no
     * longer one half of a symmetric standoff — it is the single wrong cell,
     * named, with the value it should have carried.
     */
    const result = solveA1Legs({
      CADX: row({ gdp: 0 }),
      CHFX: row({ gdp: 0 }),
      CADJPY: row({ gdp: 0 }),
      JPYX: row({ gdp: 0 }),
      CADCHF: row({ gdp: -2 }),
    });

    expect(result.conflicts.map((c) => c.symbol)).toEqual(['CADCHF']);
    expect(result.conflicts[0].implied).toBe(0);
    expect(result.contradicted[0].suspects).toEqual(['CADCHF']);
  });

  it('stays silent on a grid that is fully consistent', () => {
    const result = solveA1Legs({
      JPYX: row({ gdp: -1, cpi: 1 }),
      GBPJPY: row({ gdp: 2, cpi: -1 }),
      GBPX: row({ gdp: 1, cpi: 0 }),
    });

    expect(result.contradicted).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
    expect(legOf(result, 'GBP', 'gdp')).toBe(1);
    expect(legOf(result, 'JPY', 'gdp')).toBe(-1);
  });
});

describe('checkRowSum', () => {
  it('accepts a row that adds to its published total', () => {
    expect(checkRowSum(row({ trend: 2, gdp: -2 }), 0).ok).toBe(true);
  });

  it('rejects a row that does not', () => {
    const check = checkRowSum(row({ trend: 2 }), 5);
    expect(check.ok).toBe(false);
    expect(check.sum).toBe(2);
    expect(check.detail).toContain('published total is +5');
  });

  it('rejects a row missing columns rather than treating the gaps as zeros', () => {
    const check = checkRowSum({ trend: 2 }, 2);
    expect(check.ok).toBe(false);
    expect(check.missing).toHaveLength(SCORING_SLOTS.length - 1);
  });
});

describe('checkBounds', () => {
  it('flags a zero trend, which scoreTrend can never produce', () => {
    const breaches = checkBounds({ GBPJPY: row({ trend: 0 }) });

    expect(breaches).toHaveLength(1);
    expect(breaches[0].detail).toContain('never 0');
  });

  it('flags a trend or seasonality outside its range', () => {
    expect(checkBounds({ GBPJPY: row({ trend: 3 }) })).toHaveLength(1);
    expect(checkBounds({ GBPJPY: row({ trend: 2, seasonality: 2 }) })).toHaveLength(1);
  });

  it('passes a row inside both bounds', () => {
    expect(checkBounds({ GBPJPY: row({ trend: -2, seasonality: 1 }) })).toHaveLength(0);
  });
});

describe('checkStructuralZeros', () => {
  it('flags a US-only column carrying a value on a row with no dollar leg', () => {
    const breaches = checkStructuralZeros({ GBPX: row({ pce: -1 }) });

    expect(breaches).toHaveLength(1);
    expect(breaches[0].slotKey).toBe('pce');
    expect(breaches[0].detail).toContain('no dollar leg');
  });

  it('catches the shift the row-sum checksum is blind to', () => {
    /**
     * The real GB-POUND misread. Its eighteen cells add to 0, which is the
     * printed total, so `checkRowSum` clears it — and three of them are US
     * series sterling does not have.
     */
    const gbPound = row({
      trend: 2, seasonality: -1, crowd: 1, mpmi: -1, spmi: 1, 'retail-sales': -1,
      pce: -1, employment: 1, claims: -1,
    });

    expect(checkRowSum(gbPound, 0).ok).toBe(true);
    expect(checkStructuralZeros({ GBPX: gbPound }).map((b) => b.slotKey))
      .toEqual(['pce', 'employment', 'claims']);
  });

  it('leaves a dollar row alone — its US columns are real', () => {
    expect(checkStructuralZeros({
      EURUSD: row({ pce: 1, employment: 1, claims: -1, adp: 1, jolts: 1 }),
    })).toHaveLength(0);
  });

  it('leaves gold alone, which reads the US economy through its polarity table', () => {
    expect(checkStructuralZeros({ XAUUSD: row({ employment: -1 }) })).toHaveLength(0);
  });

  it('says nothing about columns every economy publishes', () => {
    // CPI, PPI and the unemployment RATE are not US-only; only the five are.
    expect(checkStructuralZeros({
      GBPX: row({ cpi: 1, ppi: -1, unemployment: -1, gdp: 1 }),
    })).toHaveLength(0);
  });

  it('ignores a symbol it does not know rather than guessing its legs', () => {
    expect(checkStructuralZeros({ NOTASYMBOL: row({ pce: 1 }) })).toHaveLength(0);
  });
});

describe('captures are solved one date at a time', () => {
  /**
   * The hazard, made concrete. GBP's mPMI leg is +1 on Monday and -1 on
   * Tuesday, which is ordinary: A1's board moves. Each day's rows are
   * satisfiable on their own; merged, they assert both legs at once.
   */
  const monday = { GBPUSD: row({ mpmi: 2 }), DXY: row({ mpmi: -1 }) };
  const tuesday = { GBPUSD: row({ mpmi: -2 }), DXY: row({ mpmi: 1 }) };

  it('solves each capture on its own and keeps the answers apart', () => {
    const [first, second] = solvePerCapture([
      { date: '2026-08-24', rows: monday },
      { date: '2026-08-25', rows: tuesday },
    ]);

    expect(first.date).toBe('2026-08-24');
    expect(second.date).toBe('2026-08-25');
    expect(legOf(first.result, 'GBP', 'mpmi')).toBe(1);
    expect(legOf(second.result, 'GBP', 'mpmi')).toBe(-1);
    for (const solved of [first.result, second.result]) {
      expect(solved.contradicted).toEqual([]);
      expect(solved.conflicts).toEqual([]);
    }
  });

  it('shows why the merge is dangerous: it is SILENT', () => {
    // The obvious merge is a spread, and both captures name the same symbols,
    // so the second one simply overwrites the first. Monday's evidence is gone,
    // the solve is clean, and nothing anywhere says a date was dropped. That is
    // worse than a contradiction, which at least announces itself.
    const merged = solveA1Legs({ ...monday, ...tuesday });
    expect(legOf(merged, 'GBP', 'mpmi')).toBe(-1);
    expect(merged.contradicted).toEqual([]);
    expect(merged.conflicts).toEqual([]);
  });

  it('refuses two captures claiming the same date', () => {
    expect(() =>
      solvePerCapture([
        { date: '2026-08-24', rows: monday },
        { date: '2026-08-24', rows: tuesday },
      ]),
    ).toThrow(/both dated 2026-08-24/);
  });

  it('reports symbols seen on more than one date without objecting to them', () => {
    const captures = [
      { date: '2026-08-24', rows: monday },
      { date: '2026-08-25', rows: tuesday },
    ];
    expect(symbolsInMultipleCaptures(captures)).toEqual(['DXY', 'GBPUSD']);
    expect(() => solvePerCapture(captures)).not.toThrow();
  });

  it('has nothing to report for a single capture', () => {
    expect(symbolsInMultipleCaptures([{ date: '2026-08-24', rows: monday }])).toEqual([]);
  });
});
