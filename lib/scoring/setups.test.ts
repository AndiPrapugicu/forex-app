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
import { ALL_SYMBOLS } from '@/config/symbols.config';
import {
  PAIR_CELL_MAX,
  combinePairCells,
  resolveSlotEvent,
  scoreSlot,
  ternarySign,
} from '@/lib/scoring/discrete';
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

describe('ternarySign', () => {
  it('reads any beat as +1 and any miss as -1, regardless of size', () => {
    expect(ternarySign(3.4, 3.1)).toBe(1);
    expect(ternarySign(3.10001, 3.1)).toBe(1); // a hair above forecast is still a beat
    expect(ternarySign(2.9, 3.1)).toBe(-1);
    expect(ternarySign(7.359, 7.4)).toBe(-1); // the JOLTS case the old deadband ate
  });

  it('reads an exact match as 0', () => {
    expect(ternarySign(3.3, 3.3)).toBe(0);
  });

  it('has no deadband — only a float-noise epsilon', () => {
    // Deliberate: a 0.15 sigma miss and a 3 sigma miss score identically.
    expect(ternarySign(3.1000000000001, 3.1)).toBe(0); // below epsilon
    expect(ternarySign(3.101, 3.1)).toBe(1); // above it
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
  it('scores a beat as +1 under positive polarity', () => {
    const result = scoreSlot(slot('cpi'), 'USD', [makeEvent({ ratioDeviation: 1.5 })], NOW);
    expect(result.status).toBe('scored');
    expect(result.cell).toBe(1);
  });

  it('keeps sigma available even though it no longer drives the cell', () => {
    const result = scoreSlot(slot('cpi'), 'USD', [makeEvent({ ratioDeviation: 1.5 })], NOW);
    expect(result.sigma).toBe(1.5);
    expect(result.explanation).toMatch(/σ/);
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
    expect(result.cell).toBe(-1);
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

  /**
   * The regression the flicker never had. A leg that fails and a leg that was
   * never going to score produce the same arithmetic; only the status can tell
   * them apart, and it used to say 'scored' for both.
   */
  describe('partial cells', () => {
    it('reports partial and names the leg when an expected leg is missing', () => {
      const result = combinePairCells(null, 1, PAIR_CELL_MAX, {
        base: { label: 'EUR', expected: true },
        quote: { label: 'USD', expected: true },
      });
      expect(result.status).toBe('partial');
      expect(result.missingLeg).toBe('EUR');
      // It still votes — dropping it would swing the score further than the
      // failure did.
      expect(result.cell).toBe(-1);
    });

    it('stays scored when the missing leg was never expected to publish', () => {
      const result = combinePairCells(null, -2, PAIR_CELL_MAX, {
        base: { label: 'NZD', expected: false },
        quote: { label: 'USD', expected: true },
      });
      expect(result.status).toBe('scored');
      expect(result.missingLeg).toBeNull();
      expect(result.cell).toBe(2);
    });

    it('stays scored when both legs resolved', () => {
      const result = combinePairCells(2, 1, PAIR_CELL_MAX, {
        base: { label: 'GBP', expected: true },
        quote: { label: 'CAD', expected: true },
      });
      expect(result.status).toBe('scored');
      expect(result.missingLeg).toBeNull();
    });

    it('says nothing about legs a caller cannot describe', () => {
      // No leg state means the caller cannot distinguish the two kinds of
      // absence, and it does not get to claim it can.
      expect(combinePairCells(null, 1).missingLeg).toBeNull();
    });
  });
});

describe('buildSetupsMatrix', () => {
  const base = { cot: new Map(), technicals: new Map(), now: NOW };

  it('produces a row for every configured symbol', () => {
    // Asserted against the config rather than a literal, so adding a symbol does
    // not require editing a number here.
    const matrix = buildSetupsMatrix({ events: [], ...base });
    expect(matrix.rows).toHaveLength(ALL_SYMBOLS.length);
    expect(new Set(matrix.rows.map((r) => r.symbol))).toEqual(
      new Set(ALL_SYMBOLS.map((s) => s.symbol)),
    );
  });

  it('gives DAX and FTSE no COT contract, because none exists', () => {
    // Eurex and ICE Europe are outside the CFTC's remit. This is a real gap in
    // the data, and a blank cell is the honest rendering of it — but it must be
    // a deliberate blank, not a typo in a contract name.
    const matrix = buildSetupsMatrix({ events: [], ...base });
    for (const symbol of ['GER40', 'UK100']) {
      const row = matrix.rows.find((r) => r.symbol === symbol)!;
      expect(row.cells.cot.cell, `${symbol} COT`).toBeNull();
      expect(row.cells.crowd.cell, `${symbol} crowd`).toBeNull();
    }
  });

  it('ranks strongest conviction first', () => {
    const matrix = buildSetupsMatrix({ events: [], ...base });
    for (let i = 1; i < matrix.rows.length; i++) {
      expect(matrix.rows[i - 1].totalScore).toBeGreaterThanOrEqual(matrix.rows[i].totalScore);
    }
  });

  /**
   * With no data at all, the ONLY thing that may still score is the rate column,
   * and only via its regime fallback — the central bank stance is standing
   * knowledge that does not come from the feed. Everything else must stay blank.
   *
   * Verified per cell rather than by totalScore, because a total of 0 would also
   * be produced by two wrong cells cancelling.
   */
  it('leaves every feed-derived cell blank on an empty dataset', () => {
    const matrix = buildSetupsMatrix({ events: [], ...base });

    for (const row of matrix.rows) {
      for (const [key, cell] of Object.entries(row.cells)) {
        if (key === 'rates') continue;
        expect(cell.cell, `${row.symbol}.${key}`).toBeNull();
      }
      // No bias can exceed what one rate cell is worth.
      expect(Math.abs(row.totalScore)).toBeLessThanOrEqual(2);
      expect(row.bias).toBe('Neutral');
    }
  });

  it('scores the rate cell 0 when no central bank publishes a projection', () => {
    /**
     * Only the Fed publishes numeric rate projections. Everyone else guides in
     * prose, so their leg has no view and must contribute nothing.
     *
     * This replaced a hand-maintained regime table that scored ±1 on our own
     * opinion, and a 2-year-yield proxy that scored the MARKET's forecast rather
     * than the bank's — the two disagreed outright on the dollar.
     */
    const matrix = buildSetupsMatrix({ events: [], ...base });
    const eurusd = matrix.rows.find((r) => r.symbol === 'EURUSD')!;

    expect(eurusd.cells.rates.cell).toBe(0);
    expect(eurusd.cells.rates.explanation).toMatch(/no numeric rate projection/i);
  });

  it('propagates a currency beat into every pair that currency leads', () => {
    const usdBeat = makeEvent({ currency: 'USD', countryCode: 'US', ratioDeviation: 2 });
    const matrix = buildSetupsMatrix({ events: [usdBeat], ...base });

    // USD is the quote leg in EURUSD, so a bullish USD print pushes it down.
    const eurusd = matrix.rows.find((r) => r.symbol === 'EURUSD')!;
    expect(eurusd.cells.cpi.cell).toBe(-1);

    // USD is the base leg in USDJPY, so the same print pushes it up.
    const usdjpy = matrix.rows.find((r) => r.symbol === 'USDJPY')!;
    expect(usdjpy.cells.cpi.cell).toBe(1);
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

    // The single CPI event, plus the rate cell that the regime table always
    // fills. No price history and no COT in `base`, so nothing else can score.
    expect(eurusd.populated).toBe(2);
    expect(eurusd.cells.cpi.cell).not.toBeNull();
    expect(eurusd.cells.rates.cell).not.toBeNull();
  });

  it('carries only the columns A1 scores — no extras', () => {
    /**
     * Wages and participation used to live here as context columns. They are
     * gone: A1 has no such columns, and two more rows on an already-dense grid
     * earned nothing.
     *
     * Jobless claims was also once demoted to context and is now SCORED — it
     * does appear in their table, and demoting it was one of the errors that put
     * our totals several points below theirs.
     */
    expect(SLOTS.every((s) => s.scoring)).toBe(true);
    for (const gone of ['wages', 'participation']) {
      expect(SLOTS.some((s) => s.key === gone), gone).toBe(false);
    }
    expect(SLOTS.some((s) => s.key === 'claims' && s.scoring)).toBe(true);
  });

  it('resolves a release that only one leg publishes, inverting the other side', () => {
    // Jobless claims is US-only, so EURUSD inherits the inverted US reading.
    const claims = makeEvent({
      currency: 'USD',
      countryCode: 'US',
      name: 'Initial Jobless Claims',
      actual: 199,
      consensus: 202,
    });
    const matrix = buildSetupsMatrix({ events: [claims], ...base });
    const eurusd = matrix.rows.find((r) => r.symbol === 'EURUSD')!;

    // Fewer claims is bullish USD, so bearish for EURUSD.
    expect(eurusd.cells.claims.cell).toBe(-1);
    expect(eurusd.categoryScores.jobs).toBe(-1);
  });
});
