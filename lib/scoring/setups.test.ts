/**
 * Discrete bucketing, slot resolution and the setups matrix.
 *
 * The subtle behaviours under test, each of which produces plausible-looking
 * numbers rather than an error when it breaks:
 *
 *  - EUR slot resolution must scope to the EMU aggregate, not a member state.
 *  - A stale print must be distinguishable from a genuine neutral.
 *  - A missing leg counts as 0, which is what lets NZDUSD show an NFP value.
 */

import { describe, expect, it } from 'vitest';
import { SLOTS } from '@/config/setups.config';
import { bucketSigma, combinePairCells, resolveSlotEvent, scoreSlot } from '@/lib/scoring/discrete';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import type { NormalizedEvent } from '@/lib/types';

const NOW = new Date('2026-08-08T12:00:00Z');

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    seriesId: null,
    name: 'Consumer Price Index (YoY)',
    currency: 'USD',
    countryCode: 'US',
    dateUtc: '2026-08-01T12:00:00Z',
    impact: 'HIGH',
    actual: 3.4,
    consensus: 3.1,
    previous: 3.1,
    revised: null,
    unit: null,
    ratioDeviation: null,
    isBetterThanExpected: null,
    isSpeech: false,
    isPreliminary: false,
    source: 'fxstreet',
    actualSource: 'fxstreet',
    sourceUrl: null,
    lastUpdated: null,
    ...overrides,
  };
}

const slot = (key: string) => SLOTS.find((s) => s.key === key)!;

describe('bucketSigma', () => {
  it('maps magnitude to cells symmetrically', () => {
    expect(bucketSigma(2.5)).toBe(2);
    expect(bucketSigma(0.5)).toBe(1);
    expect(bucketSigma(0)).toBe(0);
    expect(bucketSigma(-0.5)).toBe(-1);
    expect(bucketSigma(-2.5)).toBe(-2);
  });

  it('is inclusive at the lower edge of each band', () => {
    expect(bucketSigma(1.0)).toBe(2);
    expect(bucketSigma(0.999)).toBe(1);
    expect(bucketSigma(0.25)).toBe(1);
    expect(bucketSigma(0.249)).toBe(0);
    expect(bucketSigma(-0.25)).toBe(-1);
    expect(bucketSigma(-1.0)).toBe(-2);
  });
});

describe('resolveSlotEvent', () => {
  it('picks the euro-area aggregate over a member state for EUR', () => {
    // The trap: both are tagged EUR, but only EMU is the euro-area figure.
    const german = makeEvent({
      name: 'Consumer Price Index (YoY)',
      currency: 'EUR',
      countryCode: 'DE',
      dateUtc: '2026-08-07T12:00:00Z', // more recent
    });
    const euroArea = makeEvent({
      name: 'Harmonized Index of Consumer Prices (YoY)',
      currency: 'EUR',
      countryCode: 'EMU',
      dateUtc: '2026-08-01T12:00:00Z',
    });

    const resolved = resolveSlotEvent(slot('cpi'), 'EUR', [german, euroArea]);
    expect(resolved?.countryCode).toBe('EMU');
    expect(resolved?.name).toMatch(/Harmonized/);
  });

  it('follows the ordered preference list rather than taking the newest', () => {
    // Retail Sales (MoM) is preferred over (YoY) even when YoY printed later.
    const yoy = makeEvent({ name: 'Retail Sales (YoY)', dateUtc: '2026-08-07T12:00:00Z' });
    const mom = makeEvent({ name: 'Retail Sales (MoM)', dateUtc: '2026-08-01T12:00:00Z' });

    expect(resolveSlotEvent(slot('retail-sales'), 'USD', [yoy, mom])?.name).toBe('Retail Sales (MoM)');
  });

  it('takes the most recent release within the winning series', () => {
    const older = makeEvent({ name: 'Retail Sales (MoM)', dateUtc: '2026-06-01T12:00:00Z', actual: 1 });
    const newer = makeEvent({ name: 'Retail Sales (MoM)', dateUtc: '2026-08-01T12:00:00Z', actual: 2 });

    expect(resolveSlotEvent(slot('retail-sales'), 'USD', [older, newer])?.actual).toBe(2);
  });

  it('ignores releases that have not printed yet', () => {
    const scheduled = makeEvent({ name: 'Retail Sales (MoM)', actual: null });
    expect(resolveSlotEvent(slot('retail-sales'), 'USD', [scheduled])).toBeNull();
  });

  it('returns null when no pattern matches', () => {
    expect(resolveSlotEvent(slot('cpi'), 'USD', [makeEvent({ name: 'Zorblax Index' })])).toBeNull();
  });
});

describe('scoreSlot', () => {
  it('scores a beat as positive under positive polarity', () => {
    const result = scoreSlot(slot('cpi'), 'USD', [makeEvent({ ratioDeviation: 1.5 })], NOW);
    expect(result.status).toBe('scored');
    expect(result.cell).toBe(2);
  });

  it('inverts polarity for unemployment', () => {
    const rising = makeEvent({
      name: 'Unemployment Rate',
      actual: 4.5,
      consensus: 4.2,
      ratioDeviation: 1.5,
    });
    const result = scoreSlot(slot('unemployment'), 'USD', [rising], NOW);
    // Higher unemployment than forecast is bearish for the currency.
    expect(result.cell).toBe(-2);
    expect(result.explanation).toMatch(/inverted/);
  });

  it('marks a print beyond its window as STALE rather than neutral', () => {
    // A five-month-old monthly print is not a confident zero.
    const old = makeEvent({ dateUtc: '2026-03-01T12:00:00Z', ratioDeviation: 2 });
    const result = scoreSlot(slot('cpi'), 'USD', [old], NOW);

    expect(result.status).toBe('stale');
    expect(result.cell).toBeNull();
    expect(result.explanation).toMatch(/days ago/);
  });

  it('allows quarterly series a longer window than monthly ones', () => {
    // 100 days: inside GDP's 120-day allowance, outside CPI's 60.
    const old = makeEvent({ dateUtc: '2026-04-30T12:00:00Z', ratioDeviation: 2 });

    const gdp = scoreSlot(
      slot('gdp'),
      'USD',
      [{ ...old, name: 'Gross Domestic Product (QoQ)' }],
      NOW,
    );
    const cpi = scoreSlot(slot('cpi'), 'USD', [old], NOW);

    expect(gdp.status).toBe('scored');
    expect(cpi.status).toBe('stale');
  });

  it('reports no-data when the currency does not publish the series', () => {
    const result = scoreSlot(slot('jolts'), 'CHF', [], NOW);
    expect(result.status).toBe('no-data');
    expect(result.cell).toBeNull();
  });
});

describe('combinePairCells', () => {
  it('subtracts quote from base', () => {
    expect(combinePairCells(2, 1).cell).toBe(1);
    expect(combinePairCells(-1, 1).cell).toBe(-2);
  });

  it('clamps opposing legs back into the cell range', () => {
    expect(combinePairCells(2, -2).cell).toBe(2);
    expect(combinePairCells(-2, 2).cell).toBe(-2);
  });

  it('treats a missing base leg as 0, inheriting the inverted quote', () => {
    // This is what puts a value in NZDUSD's NFP column: New Zealand publishes no
    // payrolls, so the cell is simply the inverted US reading.
    expect(combinePairCells(null, -2).cell).toBe(2);
    expect(combinePairCells(null, 2).cell).toBe(-2);
  });

  it('reports no-data only when both legs are missing', () => {
    expect(combinePairCells(null, null).status).toBe('no-data');
    expect(combinePairCells(null, 1).status).toBe('scored');
  });
});

describe('buildSetupsMatrix', () => {
  const base = { cot: new Map(), technicals: new Map(), now: NOW };

  it('produces a row for every configured symbol', () => {
    const matrix = buildSetupsMatrix({ events: [], ...base });
    expect(matrix.rows).toHaveLength(33);
  });

  it('ranks strongest conviction first', () => {
    const matrix = buildSetupsMatrix({ events: [], ...base });
    for (let i = 1; i < matrix.rows.length; i++) {
      expect(matrix.rows[i - 1].totalScore).toBeGreaterThanOrEqual(matrix.rows[i].totalScore);
    }
  });

  it('scores an empty dataset as flat rather than inventing a bias', () => {
    const matrix = buildSetupsMatrix({ events: [], ...base });
    for (const row of matrix.rows) {
      expect(row.totalScore).toBe(0);
      expect(row.bias).toBe('Neutral');
      expect(row.populated).toBe(0);
    }
  });

  it('propagates a currency beat into every pair that currency leads', () => {
    const usdBeat = makeEvent({ currency: 'USD', countryCode: 'US', ratioDeviation: 2 });
    const matrix = buildSetupsMatrix({ events: [usdBeat], ...base });

    // USD is the quote leg in EURUSD, so a bullish USD print pushes it down.
    const eurusd = matrix.rows.find((r) => r.symbol === 'EURUSD')!;
    expect(eurusd.cells.cpi.cell).toBe(-2);

    // USD is the base leg in USDJPY, so the same print pushes it up.
    const usdjpy = matrix.rows.find((r) => r.symbol === 'USDJPY')!;
    expect(usdjpy.cells.cpi.cell).toBe(2);
  });

  it('keeps category subtotals consistent with the total', () => {
    const events = [
      makeEvent({ currency: 'USD', countryCode: 'US', ratioDeviation: 2 }),
      makeEvent({
        currency: 'USD',
        countryCode: 'US',
        name: 'Nonfarm Payrolls',
        actual: 200,
        consensus: 100,
        ratioDeviation: 2,
      }),
    ];
    const matrix = buildSetupsMatrix({ events, ...base });

    for (const row of matrix.rows) {
      const sum = Object.values(row.categoryScores).reduce((a, b) => a + b, 0);
      expect(sum).toBe(row.totalScore);
    }
  });

  it('counts only populated cells, so thin rows are identifiable', () => {
    const matrix = buildSetupsMatrix({
      events: [makeEvent({ currency: 'USD', countryCode: 'US', ratioDeviation: 2 })],
      ...base,
    });
    const eurusd = matrix.rows.find((r) => r.symbol === 'EURUSD')!;
    expect(eurusd.populated).toBe(1);
  });
});
