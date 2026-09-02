/**
 * The invariant that would have caught the Canadian retail bug.
 *
 * That bug was not subtle once seen: a cell of -1 printed beside a sigma of
 * +0.86. It survived because the cell and the sigma were computed from
 * DIFFERENT references and nothing ever compared them. These tests pin the
 * relationship rather than the numbers, so the next override, fallback or
 * revision that splits the two fails here instead of shipping.
 */

import { describe, expect, it } from 'vitest';
import { SLOTS } from '@/config/setups.config';
import { auditBoardConsistency, formatViolations } from '@/lib/scoring/consistency';
import { scoreSlot } from '@/lib/scoring/discrete';
import { computeSurprise } from '@/lib/scoring/surprise';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import type { NormalizedEvent } from '@/lib/types';

const NOW = new Date('2026-08-31T12:00:00Z');
const slot = (key: string) => SLOTS.find((s) => s.key === key)!;

function event(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    seriesId: null,
    name: 'Consumer Price Index (YoY)',
    currency: 'USD',
    countryCode: 'US',
    dateUtc: '2026-08-12T12:30:00Z',
    impact: 'HIGH',
    actual: 3.4,
    consensus: 3.1,
    previous: 3.1,
    revised: null,
    unit: '%',
    ratioDeviation: null,
    isBetterThanExpected: null,
    isSpeech: false,
    isPreliminary: false,
    source: 'fxstreet',
    actualSource: 'fxstreet',
    sourceUrl: null,
    lastUpdated: null,
    ...over,
  };
}

describe('sigma and the cell describe the same comparison', () => {
  it('reads a beat as +1 with a positive sigma', () => {
    const r = scoreSlot(slot('cpi'), 'USD', [event({ actual: 3.4, consensus: 3.1 })], NOW);
    expect(r.cell).toBe(1);
    expect(r.sigma).toBeGreaterThan(0);
  });

  it('reads a miss as -1 with a negative sigma', () => {
    const r = scoreSlot(slot('cpi'), 'USD', [event({ actual: 2.9, consensus: 3.1 })], NOW);
    expect(r.cell).toBe(-1);
    expect(r.sigma).toBeLessThan(0);
  });

  it('reads a print landing on reference as 0, with a sigma of exactly 0', () => {
    const r = scoreSlot(slot('cpi'), 'USD', [event({ actual: 3.1, consensus: 3.1 })], NOW);
    expect(r.cell).toBe(0);
    // Not "about zero". A non-zero sigma beside a 0 cell is the same defect.
    expect(r.sigma).toBe(0);
  });

  /**
   * THE EXACT SHAPE OF THE CANADIAN BUG, on a basis that is still live.
   *
   * `ppi` scores CHF against the prior print. Give it a print that ALSO carries
   * a consensus and the old code took the consensus branch for sigma while the
   * cell used the prior print — opposite signs, printed side by side.
   */
  it('measures sigma against the prior print when that is what scored', () => {
    const r = scoreSlot(
      slot('ppi'),
      'CHF',
      [
        event({
          name: 'Producer and Import Prices (YoY)',
          currency: 'CHF',
          countryCode: 'CH',
          dateUtc: '2026-08-13T06:30:00Z',
          actual: 0.6,
          consensus: 0.4, // a beat on consensus...
          previous: 1.0, // ...but a miss on the prior print, which is the basis
        }),
      ],
      NOW,
    );

    expect(r.referenceLabel).toBe('previous');
    expect(r.cell).toBe(-1);
    expect(r.sigma).toBeLessThan(0); // was +, from the consensus it did not use
    expect(Math.sign(r.sigma!)).toBe(Math.sign(r.cell!));
  });

  it('ignores a feed deviation that disagrees with the comparison we made', () => {
    // FXStreet calibrates ratioDeviation against THEIR consensus. When it
    // points the other way it is measuring something we did not score.
    const surprise = computeSurprise(event({ actual: 2.9, consensus: 3.1, ratioDeviation: 2.5 }), 3.1);
    expect(surprise.method).not.toBe('ratioDeviation');
    expect(surprise.sigma).toBeLessThan(0);
  });

  it('still uses the feed deviation when it agrees', () => {
    const surprise = computeSurprise(event({ actual: 3.4, consensus: 3.1, ratioDeviation: 1.2 }), 3.1);
    expect(surprise.method).toBe('ratioDeviation');
    expect(surprise.sigma).toBe(1.2);
  });

  it('falls back to the prior print when no forecast was published, and says so', () => {
    const r = scoreSlot(
      slot('cpi'),
      'USD',
      [event({ actual: 3.4, consensus: null, previous: 3.1 })],
      NOW,
    );
    expect(r.referenceLabel).toBe('previous');
    expect(r.cell).toBe(1);
    expect(Math.sign(r.sigma!)).toBe(1);
    expect(r.explanation).toContain('prior print');
  });

  it('uses the revised prior print, and keeps the raw one available', () => {
    const e = event({ actual: 3.0, consensus: null, previous: 3.0, revised: 3.2 });
    const matrix = buildSetupsMatrix({
      events: [e],
      cot: new Map(),
      technicals: new Map(),
      now: NOW,
    });
    const leg = matrix.rows
      .find((r) => r.symbol === 'EURUSD')!
      .cells.cpi.legs!.find((l) => l.currency === 'USD')!;

    expect(leg.reference).toBe(3.2); // what scored
    expect(leg.previous).toBe(3.0); // the raw figure, still there
    expect(leg.cell).toBe(-1);
    expect(Math.sign(leg.sigma!)).toBe(-1);
  });
});

describe('auditBoardConsistency', () => {
  const board = () =>
    buildSetupsMatrix({
      events: [
        event({ currency: 'USD', countryCode: 'US' }),
        event({
          currency: 'EUR',
          countryCode: 'EMU',
          name: 'Harmonized Index of Consumer Prices (YoY)',
        }),
        event({
          currency: 'CHF',
          countryCode: 'CH',
          name: 'Producer and Import Prices (YoY)',
          dateUtc: '2026-08-13T06:30:00Z',
          actual: 0.6,
          consensus: 0.4,
          previous: 1.0,
        }),
        event({
          currency: 'JPY',
          countryCode: 'JP',
          name: 'Unemployment Rate',
          dateUtc: '2026-08-07T12:30:00Z',
          actual: 2.8,
          consensus: 2.5,
          previous: 2.5,
        }),
        event({
          currency: 'NZD',
          countryCode: 'NZ',
          name: 'Business NZ PSI',
          dateUtc: '2026-08-16T22:30:00Z',
          actual: 50.6,
          consensus: null,
          previous: 50.6,
          revised: 50.9,
          unit: null,
        }),
      ],
      cot: new Map(),
      technicals: new Map(),
      now: NOW,
    });

  it('passes a board built by the real pipeline, across every symbol and column', () => {
    expect(formatViolations(auditBoardConsistency(board()))).toBe('no internal inconsistencies');
  });

  /**
   * THE POSITIVE CONTROL. A test that only ever passes proves nothing, so this
   * injects the Canadian defect verbatim — sigma +0.86 beside a cell of -1 —
   * and requires the audit to name it.
   */
  it('catches a sigma that opposes its own cell', () => {
    const matrix = board();
    const leg = matrix.rows
      .find((r) => r.symbol === 'EURUSD')!
      .cells.cpi.legs!.find((l) => l.currency === 'USD')!;
    (leg as { sigma: number }).sigma = 0.86;
    (leg as { cell: number }).cell = -1;
    (leg as { actual: number }).actual = 0.6;
    (leg as { reference: number }).reference = 1.0;

    const violations = auditBoardConsistency(matrix);
    expect(violations.some((v) => v.kind === 'sigma-opposes-cell')).toBe(true);
    expect(formatViolations(violations)).toContain('measuring different comparisons');
  });

  it('catches a printed reference that does not reproduce its own cell', () => {
    const matrix = board();
    const leg = matrix.rows
      .find((r) => r.symbol === 'EURUSD')!
      .cells.cpi.legs!.find((l) => l.currency === 'USD')!;
    // The pre-fix revision bug: the cell scored against one number, the leg
    // published another, and the pair no longer produces the printed score.
    (leg as { reference: number }).reference = 3.4;
    (leg as { actual: number }).actual = 3.4;
    (leg as { cell: number }).cell = 1;

    expect(
      auditBoardConsistency(matrix).some((v) => v.kind === 'reference-does-not-reproduce-cell'),
    ).toBe(true);
  });

  it('catches a null cell still claiming it was scored', () => {
    const matrix = board();
    const cell = matrix.rows.find((r) => r.symbol === 'EURUSD')!.cells.gdp;
    (cell as { cell: number | null }).cell = null;
    (cell as { status: string }).status = 'scored';

    expect(
      auditBoardConsistency(matrix).some((v) => v.kind === 'status-disagrees-with-cell'),
    ).toBe(true);
  });

  it('does not flag columns that legitimately have no sigma', () => {
    // trend, seasonality, COT, crowd and rates carry no release to be
    // surprised by. They must not be reported as inconsistent for lacking one.
    const violations = auditBoardConsistency(board());
    const noSigma = ['trend', 'seasonality', 'cot', 'crowd', 'rates'];
    expect(violations.filter((v) => noSigma.includes(v.slot))).toHaveLength(0);
  });
});
