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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MATRIX_SLOTS, SCORING_SLOTS, SLOTS } from '@/config/setups.config';
import { ALL_SYMBOLS } from '@/config/symbols.config';
import {
  PAIR_CELL_MAX,
  combinePairCells,
  priorPrint,
  resolveSlotEvent,
  scoreSlot,
  ternarySign,
} from '@/lib/scoring/discrete';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import type { CotReport } from '@/lib/connectors/cftc';
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

  it('SCORES a print beyond its window, and says how old it is', () => {
    /*
     * The inverse of what this test asserted for several rounds, and A1 is the
     * reason. It read: "a five-month-old monthly print is not a confident
     * zero", nulled the cell and stamped it 'stale'. True as economics, wrong
     * as a model of their board - which carries a 1 May Canada services PMI and
     * scores it 125 days on. Nothing captured from A1 has ever shown a resolved
     * row suppressed for age, so the window was ours alone.
     *
     * The concern behind the old assertion is met a different way: the cell
     * still distinguishes itself, by `stale` and `ageDays` and by saying so in
     * its explanation, rather than by withholding the reading.
     */
    const old = makeEvent({ dateUtc: '2026-03-01T12:00:00Z', ratioDeviation: 2 });
    const result = scoreSlot(slot('cpi'), 'USD', [old], NOW);

    expect(result.status).toBe('scored');
    expect(result.cell).not.toBeNull();
    expect(result.stale).toBe(true);
    expect(result.ageDays).toBeGreaterThan(60);
    expect(result.explanation).toMatch(/days old/);
  });

  it('leaves `stale` unset for a print inside its window', () => {
    // The flag has to be worth reading, which means it must be false when the
    // series is current - not merely truthy on the one case that motivated it.
    const fresh = makeEvent({ dateUtc: '2026-08-07T12:30:00Z', ratioDeviation: 2 });
    const result = scoreSlot(slot('cpi'), 'USD', [fresh], NOW);

    expect(result.status).toBe('scored');
    expect(result.stale).toBe(false);
  });

  it('judges a print against its OWN cadence, quarterly being longer', () => {
    /*
     * 100 days: inside GDP's 120-day allowance, outside CPI's 60. Both score
     * now - age stopped gating - so what this pins is that the windows still
     * MEAN something and still differ per slot. They are what `resolveSeries`
     * ranks candidates by, and a quarterly series that had inherited CPI's
     * 60-day window would be judged old the moment it was published on time.
     */
    const old = makeEvent({ dateUtc: '2026-04-30T12:00:00Z', ratioDeviation: 2 });

    const gdp = scoreSlot(
      slot('gdp'),
      'USD',
      [{ ...old, name: 'Gross Domestic Product (QoQ)' }],
      NOW,
    );
    const cpi = scoreSlot(slot('cpi'), 'USD', [old], NOW);

    expect(gdp.status).toBe('scored');
    expect(cpi.status).toBe('scored');

    // The same print, the same day, read as current by one slot and overdue by
    // the other.
    expect(gdp.stale).toBe(false);
    expect(cpi.stale).toBe(true);
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
        // NO CARVE-OUT FOR `rates` ANY MORE. It used to be skipped here because
        // it alone returned 0 on an empty dataset, and that exemption was the
        // symptom rather than the rule: with no calendar at all, a rate view is
        // unknown, not neutral.
        expect(cell.cell, `${row.symbol}.${key}`).toBeNull();
      }
      expect(row.totalScore).toBe(0);
      expect(row.bias).toBe('Neutral');
    }
  });

  it('scores the rate cell 0 with neither a projection nor a yield', () => {
    /**
     * The column has three tiers: the bank's own published projection, then the
     * market's view from the 2-year against the policy rate, then nothing. With
     * no events and no yields supplied, every tier is empty and the cell must
     * contribute 0 rather than fall back to an opinion.
     *
     * This replaced a hand-maintained regime table that scored ±1 on our own
     * view of each central bank.
     */
    const withCalendar = makeEvent({ name: 'Some Release', currency: 'USD', countryCode: 'US' });
    const matrix = buildSetupsMatrix({ events: [withCalendar], ...base });
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
     *
     * Asserted over MATRIX_SLOTS rather than SLOTS, because the two are no
     * longer the same set. A1's per-country HEATMAPS carry rows their Top Setups
     * does not — the euro area's Employment Change, Japan's Household Spending —
     * and those live in SLOTS as `heatmapOnly`. The guarantee this test exists
     * to make is about the BOARD, and the board renders MATRIX_SLOTS.
     */
    expect(MATRIX_SLOTS.every((s) => s.scoring)).toBe(true);
    for (const gone of ['wages', 'participation']) {
      expect(SLOTS.some((s) => s.key === gone), gone).toBe(false);
    }
    expect(MATRIX_SLOTS.some((s) => s.key === 'claims' && s.scoring)).toBe(true);
  });

  it('keeps heatmap-only columns off the board entirely', () => {
    /**
     * The other half of the rule above, and the reason `scoring: false` was not
     * enough on its own: a non-scoring slot still RENDERS in the matrix as a
     * context column. A1's Top Setups has no column for these at all, so they
     * must not reach the board — and a heatmap-only slot must never score, or it
     * would move a total from a column nobody can see.
     */
    const heatmapOnly = SLOTS.filter((s) => s.heatmapOnly);
    expect(heatmapOnly.length).toBeGreaterThan(0);

    for (const slot of heatmapOnly) {
      expect(slot.scoring, slot.key).toBe(false);
      expect(MATRIX_SLOTS.some((s) => s.key === slot.key), slot.key).toBe(false);
      expect(SCORING_SLOTS.some((s) => s.key === slot.key), slot.key).toBe(false);
    }
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

/**
 * REGRESSION COVER FOR THE 2026-08-23 PARITY WORK.
 *
 * Each block below pins one defect found by comparing our board against A1's
 * capture of that date. They are grouped here rather than scattered because
 * they share one property: every one of them produced a plausible number rather
 * than an error, which is why none was caught by anything already in this file.
 */
describe('the 2026-08-23 parity fixes', () => {
  function crowdReport(contract: string, retailLongPct: number): CotReport {
    return {
      contract,
      reportDate: '2026-08-19',
      specLong: 60_000,
      specShort: 40_000,
      specNet: 20_000,
      specLongPct: 60,
      commLong: 40_000,
      commShort: 60_000,
      commNet: -20_000,
      retailLong: Math.round(100_000 * (retailLongPct / 100)),
      retailShort: Math.round(100_000 * (1 - retailLongPct / 100)),
      retailNet: Math.round(100_000 * (retailLongPct / 100)) - Math.round(100_000 * (1 - retailLongPct / 100)),
      retailLongPct,
      openInterest: 100_000,
      openInterestChange: 1_000,
      specNetChange: 2_000,
      specLongChange: 1_500,
      specShortChange: -500,
      specLongPctChange: 3,
    };
  }

  const cotWith = (entries: Record<string, number>) =>
    new Map(
      Object.entries(entries).map(([contract, pct]) => [
        contract,
        { contract, reports: [crowdReport(contract, pct)] },
      ]),
    );

  /**
   * THE CROWD COLUMN IS PER SYMBOL, AND THEIR OWN TWO CARDS PROVE IT.
   *
   * A1's 2026-08-23 US-DOLLAR row scores crowd +1, and their EURUSD row also
   * scores crowd +1. Under a differenced rule EURUSD would be `EUR - USD`, which
   * with USD's leg pinned at +1 cannot reach +1 from any leg in {-1, 0, +1}. No
   * differenced model produces both numbers.
   *
   * For a dollar pair we do not need their retail feed to honour that: the CME
   * currency futures ARE these pairs, so one contract's small traders are
   * positioning in this pair directly.
   */
  describe('crowd sentiment on a dollar pair', () => {
    it('reads the pair OWN contract rather than differencing two legs', () => {
      /**
       * Both euro and dollar small traders crowded long. Differencing gives
       * `-1 - -1 = 0` and reports a confident neutral; the euro contract alone —
       * which IS EURUSD — says the crowd is long it, contrarian bearish.
       */
      const matrix = buildSetupsMatrix({
        events: [],
        cot: cotWith({ 'EURO FX': 70, 'USD INDEX': 70 }),
        technicals: new Map(),
        now: NOW,
      });

      const eurusd = matrix.rows.find((r) => r.symbol === 'EURUSD')!;
      expect(eurusd.cells.crowd.cell).toBe(-1);
      expect(eurusd.cells.crowd.explanation).toContain('EURO FX');
    });

    it('inverts when the dollar is the BASE, because the contract is quoted the other way up', () => {
      /**
       * USDJPY is the yen contract upside down: small traders crowded long yen
       * futures are crowded SHORT USDJPY, so the contrarian read is bullish for
       * this row. Getting this backwards is a silent 2-point error on every
       * dollar-base pair.
       */
      const matrix = buildSetupsMatrix({
        events: [],
        cot: cotWith({ 'JAPANESE YEN': 70, 'USD INDEX': 50 }),
        technicals: new Map(),
        now: NOW,
      });

      const usdjpy = matrix.rows.find((r) => r.symbol === 'USDJPY')!;
      expect(usdjpy.cells.crowd.cell).toBe(1);
      expect(usdjpy.cells.crowd.explanation).toContain('inverted');
    });

    it.each(['EURJPY', 'EURGBP', 'GBPJPY', 'AUDJPY', 'EURAUD', 'EURCHF', 'GBPCHF'])(
      'leaves %s UNSCORED rather than differencing two dollar pairs',
      (symbol) => {
        /**
         * THIS TEST PINS A DELIBERATE REVERSAL. It previously asserted the
         * opposite — that a cross differences its two legs — and that
         * expectation was wrong for the same reason the dollar-pair carve-out
         * above exists: `crowd(EURO FX) - crowd(JAPANESE YEN)` measures retail
         * positioning in EURUSD against retail positioning in USDJPY, neither
         * of which is EURJPY.
         *
         * Measured against A1's 2026-08-24 Top Setups row for EURCHF: they
         * score crowd +1 from a per-pair broker feed, the difference scored -1,
         * and an honest blank scores 0. Half the error, and none of the false
         * confidence.
         *
         * This asserts NULL, not a number, so it will fail loudly the moment a
         * retail feed is wired up — at which point the correct change is to
         * supply `retailPositioning` here, not to restore the difference.
         */
        const matrix = buildSetupsMatrix({
          events: [],
          cot: cotWith({ 'EURO FX': 70, 'JAPANESE YEN': 30, 'BRITISH POUND': 70, 'AUSTRALIAN DOLLAR': 30, 'SWISS FRANC': 30 }),
          technicals: new Map(),
          now: NOW,
        });

        const row = matrix.rows.find((r) => r.symbol === symbol)!;
        expect(row.cells.crowd.cell).toBeNull();
        expect(row.cells.crowd.status).toBe('no-data');
        expect(row.cells.crowd.explanation).toContain('No retail positioning source');
      },
    );

    it('scores a cross DIRECTLY when a retail positioning feed supplies it', () => {
      /**
       * The rung that makes crosses work. A1 reads EURCHF's crowd off a
       * broker aggregate at roughly 25% long, which is contrarian bullish — and
       * +1 is exactly what their published row shows. No provider ships in this
       * repo, so this is the interface being exercised rather than live data.
       */
      const matrix = buildSetupsMatrix({
        events: [],
        cot: cotWith({ 'EURO FX': 70, 'SWISS FRANC': 30 }),
        technicals: new Map(),
        retailPositioning: new Map([
          ['EURCHF', { symbol: 'EURCHF', longPct: 25, source: 'test-feed', observedAt: '2026-08-24' }],
        ]),
        now: NOW,
      });

      const eurchf = matrix.rows.find((r) => r.symbol === 'EURCHF')!;
      expect(eurchf.cells.crowd.cell).toBe(1);
      expect(eurchf.cells.crowd.explanation).toContain('test-feed');
    });

    it('lets the retail feed OVERRIDE a contract read on a dollar pair', () => {
      /**
       * The feed is A1's own measure, so it outranks the futures proxy wherever
       * both exist. CFTC small traders 70% long EURO FX reads -1; a broker feed
       * at 25% long EURUSD reads +1, and A1's 2026-08-24 row says +1.
       */
      const matrix = buildSetupsMatrix({
        events: [],
        cot: cotWith({ 'EURO FX': 70 }),
        technicals: new Map(),
        retailPositioning: new Map([
          ['EURUSD', { symbol: 'EURUSD', longPct: 25, source: 'test-feed', observedAt: '2026-08-24' }],
        ]),
        now: NOW,
      });

      expect(matrix.rows.find((r) => r.symbol === 'EURUSD')!.cells.crowd.cell).toBe(1);
    });

    it('leaves COT differenced, because their EURUSD card says that column IS', () => {
      /**
       * The asymmetry is evidenced on both sides, which is the only reason it is
       * allowed to exist. Their EURUSD card reads COT Net Positioning Neutral
       * with a Bullish Weekly Change and a subtotal of +2 — exactly
       * `EUR change (+1) - USD change (-1)`.
       */
      const matrix = buildSetupsMatrix({
        events: [],
        cot: cotWith({ 'EURO FX': 50, 'USD INDEX': 50 }),
        technicals: new Map(),
        now: NOW,
      });

      const eurusd = matrix.rows.find((r) => r.symbol === 'EURUSD')!;
      expect(eurusd.cells.cot.baseCell).not.toBeUndefined();
      expect(eurusd.cells.cot.quoteCell).not.toBeUndefined();
    });
  });

  /**
   * THE 2-YEAR YIELD HAS TO REACH THE MATRIX, AND FOR A YEAR IT DID NOT REACH
   * EVERY CALLER.
   *
   * `SetupsPayload` carried no `yield2y`, so anything rebuilding the matrix from
   * the payload — `scripts/parity.ts` and `scripts/board-diff.ts` — silently
   * scored the rate column BLANK on DXY and all fourteen non-FX rows, while the
   * live page scored them. The diagnostic and the app disagreed about the same
   * board: DXY read -7 in one and -8 in the other.
   */
  describe('the 2-year yield reaching the rate column', () => {
    const falling = { current: 3.96, sma: 4.15 };

    it('scores DXY from the 2-year, INVERTED, and blanks it when absent', () => {
      const withYield = buildSetupsMatrix({ events: [], cot: new Map(), technicals: new Map(), now: NOW, yield2y: falling });
      const without = buildSetupsMatrix({ events: [], cot: new Map(), technicals: new Map(), now: NOW });

      // A falling short yield is dovish and therefore bearish for the dollar —
      // their own card: "The 2yr yield is falling (dovish)" beside a Bearish cell.
      expect(withYield.rows.find((r) => r.symbol === 'DXY')!.cells.rates.cell).toBe(-1);
      expect(without.rows.find((r) => r.symbol === 'DXY')!.cells.rates.cell).toBeNull();
      expect(without.rows.find((r) => r.symbol === 'DXY')!.cells.rates.status).toBe('no-data');
    });

    it('scores every non-FX row from the same reading, un-negated', () => {
      const matrix = buildSetupsMatrix({ events: [], cot: new Map(), technicals: new Map(), now: NOW, yield2y: falling });
      // Easing financial conditions are a tailwind for gold, indices and crypto.
      for (const symbol of ['XAUUSD', 'SPX500', 'BTCUSD']) {
        expect(matrix.rows.find((r) => r.symbol === symbol)!.cells.rates.cell, symbol).toBe(1);
      }
    });

    it('is passed by every script that rebuilds the matrix from the payload', () => {
      /**
       * A SOURCE ASSERTION, DELIBERATELY.
       *
       * The defect was not a wrong value, it was an OMITTED ARGUMENT on an
       * optional field — invisible to the type checker and to every behavioural
       * test, because the matrix builds fine without it and simply scores
       * fifteen rows differently. The only thing that catches a re-omission is
       * checking that the argument is still there.
       */
      const root = join(__dirname, '..', '..');
      for (const script of ['scripts/parity.ts', 'scripts/board-diff.ts']) {
        const source = readFileSync(join(root, script), 'utf8');
        expect(source, script).toContain('yield2y: payload.yield2y');
      }
    });
  });

  /**
   * CONSUMER CONFIDENCE FOR AUD AND NZD IS NOW WIRED. THIS TEST IS INVERTED,
   * AND THE REVERSAL IS DELIBERATE.
   *
   * It used to assert that both currencies resolved NOTHING. That assertion was
   * correct about the code and wrong about the reason: the series were left out
   * because wiring them moved TOTAL ABS GAP against A1 from 96 to 102.
   *
   * Parity is no longer a reason to leave a real series unscored. ANZ–Roy Morgan
   * is the monthly New Zealand consumer confidence index and Westpac is the
   * Australian one; both are in the feed with actuals, neither is forecast, and
   * both therefore read against the prior print — a basis this engine supports
   * and documents.
   *
   * A1's NZDUSD card still implies a New Zealand leg of -1 where every NZ
   * confidence series in our feed reads bullish. That is recorded as a source
   * difference. It is not evidence that our +1 is wrong, and it is no longer
   * allowed to keep the column blank.
   */
  describe('consumer confidence for AUD and NZD', () => {
    it('resolves and scores both, from the series in the pool', () => {
      const slot = SLOTS.find((s) => s.key === 'consumer-confidence')!;
      const events = [
        makeEvent({
          name: 'ANZ – Roy Morgan Consumer Confidence',
          currency: 'NZD', countryCode: 'NZ',
          actual: 99.3, consensus: null, previous: 91.3,
          dateUtc: '2026-08-01T12:00:00Z',
        }),
        makeEvent({
          name: 'Westpac Consumer Confidence',
          currency: 'AUD', countryCode: 'AU',
          actual: 6, consensus: null, previous: 4.1,
          dateUtc: '2026-08-01T12:00:00Z',
        }),
      ];

      expect(resolveSlotEvent(slot, 'NZD', events, NOW)).not.toBeNull();
      expect(resolveSlotEvent(slot, 'AUD', events, NOW)).not.toBeNull();
      expect(scoreSlot(slot, 'NZD', events, NOW).cell).toBe(1);
      expect(scoreSlot(slot, 'AUD', events, NOW).cell).toBe(1);
    });

    it('still resolves for the economies A1 does score', () => {
      // The slot itself is not disabled — only these two currencies lack a
      // matcher, and a blanket removal would be a different and worse bug.
      const slot = SLOTS.find((s) => s.key === 'consumer-confidence')!;
      const events = [
        makeEvent({
          name: 'Consumer Confidence',
          currency: 'EUR', countryCode: 'EMU',
          actual: -15.5, consensus: -16.3, previous: -16.3,
          dateUtc: '2026-08-01T12:00:00Z',
        }),
      ];
      expect(scoreSlot(slot, 'EUR', events, NOW).cell).toBe(1);
    });
  });
});

/**
 * SECO publishes an adjusted and an unadjusted Swiss unemployment rate on the
 * same morning, and they disagree about the SIGN whenever the season turns.
 * Picking the wrong one produces a confident cell rather than a visible error,
 * which is why this is pinned by both series being present at once.
 */
describe('CHF unemployment reads the unadjusted series', () => {
  /** July 2026, released 2026-08-06. The release A1's 08-24 and 08-25 boards used. */
  const unadjusted = () =>
    makeEvent({
      name: 'Unemployment Rate',
      currency: 'CHF',
      countryCode: 'CH',
      actual: 3.0,
      consensus: null,
      previous: 2.9,
      dateUtc: '2026-08-06T05:45:00.000Z',
      source: 'tradingview',
      actualSource: 'tradingview',
    });

  /** The same release on FXStreet's adjusted series, which is flat. */
  const adjusted = () =>
    makeEvent({
      name: 'Unemployment Rate s.a (MoM)',
      currency: 'CHF',
      countryCode: 'CH',
      actual: 3.1,
      consensus: null,
      previous: 3.1,
      dateUtc: '2026-08-06T05:45:00.000Z',
    });

  const NOW_BOARD = new Date('2026-08-24T15:00:00Z');

  it('picks the unadjusted print even with the adjusted one in the pool', () => {
    const resolved = resolveSlotEvent(slot('unemployment'), 'CHF', [adjusted(), unadjusted()], NOW_BOARD);
    expect(resolved?.name).toBe('Unemployment Rate');
    expect(resolved?.actual).toBe(3.0);
  });

  it('scores -1, because 2.9 -> 3.0 is a rise and higher unemployment is bearish', () => {
    expect(scoreSlot(slot('unemployment'), 'CHF', [adjusted(), unadjusted()], NOW_BOARD).cell).toBe(-1);
  });

  /**
   * The reason the series choice is the whole cell rather than a rounding
   * difference: one release, one morning, two answers that are not adjacent.
   * Asserted on the arithmetic rather than through the slot, because the slot
   * can no longer be made to read the adjusted series at all — which is the
   * next test.
   */
  it('would have scored 0 on the adjusted series, which is what it used to do', () => {
    const a = adjusted();
    expect(ternarySign(a.actual!, a.previous!)).toBe(0);
    const u = unadjusted();
    expect(ternarySign(u.actual!, u.previous!)).toBe(1);
  });

  it('blanks rather than falling back to the adjusted series when the feed is down', () => {
    expect(resolveSlotEvent(slot('unemployment'), 'CHF', [adjusted()], NOW_BOARD)).toBeNull();
  });

  /**
   * A1's own CH heatmap card, row dated `Jan 9, 26`: actual 3.1, forecast
   * blank, previous 2.9. No adjusted print has ever gone 2.9 -> 3.1; the
   * unadjusted one did, in December 2025. That row is the evidence for BOTH the
   * series above and the previous-basis comparison below.
   */
  it('reproduces the December 2025 print A1 published on their CH card', () => {
    const december = makeEvent({
      name: 'Unemployment Rate',
      currency: 'CHF',
      countryCode: 'CH',
      actual: 3.1,
      consensus: null,
      previous: 2.9,
      dateUtc: '2026-01-09T06:45:00.000Z',
    });
    const scored = scoreSlot(slot('unemployment'), 'CHF', [december], new Date('2026-01-20T12:00:00Z'));
    expect(scored.cell).toBe(-1);
  });
});

/**
 * A revision restates LAST period's number, and a comparison against the prior
 * print has to read the restated one. Getting this wrong is invisible on any
 * series that is never revised, which is most of them — hence a test.
 */
describe('the prior print is the revised one', () => {
  it('prefers revised over previous, and falls back when nothing was revised', () => {
    expect(priorPrint(makeEvent({ previous: 50.6, revised: 50.9 }))).toBe(50.9);
    expect(priorPrint(makeEvent({ previous: 50.6, revised: null }))).toBe(50.6);
    // A revision to zero is a revision, not an absence.
    expect(priorPrint(makeEvent({ previous: 0.4, revised: 0 }))).toBe(0);
  });

  /**
   * BusinessNZ's PSI, 2026-08-16. Announced flat against 50.6, down against the
   * restated 50.9 — and A1's 2026-08-25 board carries -1.
   */
  it('turns a flat New Zealand services print into the fall A1 scores', () => {
    const psi = (over: Partial<NormalizedEvent>) =>
      makeEvent({
        name: 'Business NZ PSI',
        currency: 'NZD',
        countryCode: 'NZ',
        actual: 50.6,
        consensus: null,
        previous: 50.6,
        dateUtc: '2026-08-16T22:00:00.000Z',
        ...over,
      });
    const at = new Date('2026-08-25T12:00:00Z');

    expect(scoreSlot(slot('spmi'), 'NZD', [psi({ revised: 50.9 })], at).cell).toBe(-1);
    // Without the revision the same release is genuinely flat, and must stay 0.
    expect(scoreSlot(slot('spmi'), 'NZD', [psi({ revised: null })], at).cell).toBe(0);
  });

  it('leaves a forecast-based comparison alone, revision or not', () => {
    // A revision restates the prior print; it cannot restate a consensus that
    // was published before it. CPI compares against forecast by default.
    const event = makeEvent({ actual: 3.4, consensus: 3.1, previous: 3.1, revised: 9.9 });
    expect(scoreSlot(slot('cpi'), 'USD', [event], new Date('2026-08-08T12:00:00Z')).cell).toBe(1);
  });
});

/**
 * Crowd provenance, which is the one column where our number can be measured on
 * a different POPULATION than A1's without the value looking any different.
 *
 * A1's crowd cell is a daily retail spot book. With no retail provider wired,
 * every dollar pair, metal, index and currency index falls back to a WEEKLY CME
 * FUTURES contract. That substitution is defensible and documented - it is a
 * real signal and better than a blank - but it must never be invisible, because
 * a consumer comparing our cell to theirs would otherwise be comparing two
 * different measurements and calling the difference a scoring gap.
 */
describe('the crowd cell says which population it was measured on', () => {
  /** Minimal COT series carrying only the retail share the crowd rule reads. */
  const cot = (contract: string, retailLongPct: number) =>
    new Map([
      [
        contract,
        {
          contract,
          reports: [
            {
              contract,
              reportDate: '2026-08-04',
              specLong: 60_000,
              specShort: 40_000,
              specNet: 20_000,
              specLongPct: 60,
              commLong: 40_000,
              commShort: 60_000,
              commNet: -20_000,
              retailLong: retailLongPct * 1_000,
              retailShort: (100 - retailLongPct) * 1_000,
              retailNet: (retailLongPct * 2 - 100) * 1_000,
              retailLongPct,
              openInterest: 100_000,
              openInterestChange: 1_000,
              specNetChange: 2_000,
              specLongChange: 1_500,
              specShortChange: -500,
              specLongPctChange: 3,
            } satisfies CotReport,
          ],
        },
      ],
    ]);
  it('marks a futures-derived cell as own-contract, not as a retail read', () => {
    const matrix = buildSetupsMatrix({
      events: [],
      cot: cot('EURO FX', 25),
      technicals: new Map(),
      now: NOW,
    });
    const crowd = matrix.rows.find((r) => r.symbol === 'EURUSD')!.cells.crowd;
    expect(crowd.basis).toBe('own-contract');
  });

  it('marks a cross with no source at all as none, with a null cell', () => {
    const matrix = buildSetupsMatrix({
      events: [],
      cot: cot('EURO FX', 25),
      technicals: new Map(),
      now: NOW,
    });
    const crowd = matrix.rows.find((r) => r.symbol === 'EURCHF')!.cells.crowd;
    expect(crowd.basis).toBe('none');
    expect(crowd.cell).toBeNull();
  });

  /**
   * The distinction that makes the field worth carrying: same cell VALUE, two
   * different measurements. Only the basis separates them.
   */
  it('marks a retail-fed cell as retail-feed even when the value is identical', () => {
    const matrix = buildSetupsMatrix({
      events: [],
      cot: cot('EURO FX', 25),
      technicals: new Map(),
      now: NOW,
      retailPositioning: new Map([
        [
          'EURUSD',
          { symbol: 'EURUSD', longPct: 25, source: 'test-broker', observedAt: '2026-08-24' },
        ],
      ]),
    });
    const crowd = matrix.rows.find((r) => r.symbol === 'EURUSD')!.cells.crowd;
    expect(crowd.basis).toBe('retail-feed');
    expect(crowd.explanation).toContain('test-broker');
  });

  it('leaves basis undefined on columns the question does not apply to', () => {
    const matrix = buildSetupsMatrix({
      events: [],
      cot: cot('EURO FX', 25),
      technicals: new Map(),
      now: NOW,
    });
    const row = matrix.rows.find((r) => r.symbol === 'EURUSD')!;
    expect(row.cells.cpi.basis).toBeUndefined();
    expect(row.cells.trend.basis).toBeUndefined();
  });
});

/**
 * Two defects found by triangulating the live board of 2026-08-31 against
 * primary sources rather than against A1.
 *
 * Neither was caught by any existing test, and both produced a confident,
 * plausible-looking number rather than an error — which is why they are pinned
 * here by the arithmetic they got wrong, not by the totals they moved.
 */
describe('a leg is measured against, and reports, the same reference', () => {
  /**
   * Statistics Canada put June 2026 retail sales at +0.6% against a +0.4%
   * consensus — reported as a beat. A per-currency `previous` override scored it
   * against the +1.0% prior print instead, giving -1 where the evidence says +1.
   *
   * The override's justification was a print whose forecast was BLANK, and in
   * that case `scoreSlot` already falls back to the prior print on its own. So
   * it was redundant where its evidence applied and wrong everywhere else.
   */
  it('scores Canadian retail sales against consensus when a consensus exists', () => {
    const result = scoreSlot(
      slot('retail-sales'),
      'CAD',
      [
        makeEvent({
          name: 'Retail Sales (MoM)',
          currency: 'CAD',
          countryCode: 'CA',
          dateUtc: '2026-08-21T12:30:00Z',
          actual: 0.6,
          consensus: 0.4,
          previous: 1,
          unit: '%',
        }),
      ],
      new Date('2026-08-31T12:00:00Z'),
    );

    expect(result.referenceLabel).toBe('forecast');
    expect(result.cell).toBe(1);
    // The tell that something was wrong, needing no external source: the sigma
    // was computed against consensus and disagreed in sign with the cell.
    expect(Math.sign(result.sigma!)).toBe(Math.sign(result.cell!));
  });

  it('still falls back to the prior print when Canada publishes no consensus', () => {
    // The case the deleted override was actually evidenced by. Unchanged.
    const result = scoreSlot(
      slot('retail-sales'),
      'CAD',
      [
        makeEvent({
          name: 'Retail Sales (MoM)',
          currency: 'CAD',
          countryCode: 'CA',
          dateUtc: '2026-08-21T12:30:00Z',
          actual: 1.2,
          consensus: null,
          previous: -0.7,
          unit: '%',
        }),
      ],
      new Date('2026-08-31T12:00:00Z'),
    );

    expect(result.referenceLabel).toBe('previous');
    expect(result.cell).toBe(1);
  });

  /**
   * `scoreSlot` compares against `priorPrint` — the REVISED prior where one
   * exists — while the rendered leg reported the raw `previous`. New Zealand's
   * PSI is the live case: 50.6 against a 50.6 raw previous restated to 50.9, so
   * the hover text read "50.6 vs 50.6" beside a cell of -1.
   */
  it('reports the revised prior print, not the raw one, when that is what scored', () => {
    const psi = makeEvent({
      name: 'Business NZ PSI',
      currency: 'NZD',
      countryCode: 'NZ',
      dateUtc: '2026-08-16T22:30:00Z',
      actual: 50.6,
      consensus: null,
      previous: 50.6,
      revised: 50.9,
    });

    expect(priorPrint(psi)).toBe(50.9);

    const matrix = buildSetupsMatrix({
      events: [psi],
      cot: new Map(),
      technicals: new Map(),
      now: new Date('2026-08-31T12:00:00Z'),
    });
    const leg = matrix.rows
      .find((r) => r.symbol === 'NZDUSD')!
      .cells.spmi.legs!.find((l) => l.currency === 'NZD')!;

    expect(leg.referenceLabel).toBe('previous');
    expect(leg.reference).toBe(50.9);
    expect(leg.previous).toBe(50.6); // the raw figure is still carried, separately
    expect(leg.cell).toBe(-1);
  });
});

/**
 * NEW ZEALAND AND AUSTRALIAN CONSUMER CONFIDENCE.
 *
 * Wired on 2026-08-31 after being removed on 2026-08-24 for a parity reason
 * that no longer counts. The risk being guarded here is not the score — it is
 * the MATCHER. The ANZ series carries an EN DASH in the feed, and a matcher
 * that assumes a hyphen fails silently: the column just goes blank, which is
 * how the GBP leg was lost once before.
 */
describe('Antipodean consumer confidence resolves and scores', () => {
  const anz = (over: Partial<NormalizedEvent> = {}) =>
    makeEvent({
      name: 'ANZ – Roy Morgan Consumer Confidence',
      currency: 'NZD',
      countryCode: 'NZ',
      dateUtc: '2026-07-30T21:00:00Z',
      actual: 99.3,
      consensus: null,
      previous: 91.3,
      unit: null,
      ...over,
    });

  it('matches the ANZ series whichever dash the feed uses', () => {
    for (const dash of ['-', '–', '—']) {
      const e = anz({ name: `ANZ ${dash} Roy Morgan Consumer Confidence` });
      const found = resolveSlotEvent(slot('consumer-confidence'), 'NZD', [e]);
      expect(found, `dash ${dash}`).not.toBeNull();
    }
  });

  it('scores a rise against the prior print as +1, with an agreeing sigma', () => {
    const r = scoreSlot(slot('consumer-confidence'), 'NZD', [anz()], new Date('2026-08-31T12:00:00Z'));
    expect(r.referenceLabel).toBe('previous');
    expect(r.cell).toBe(1);
    expect(Math.sign(r.sigma!)).toBe(1);
  });

  it('picks the monthly ANZ series over the quarterly Westpac one', () => {
    const westpac = makeEvent({
      name: 'Westpac Consumer Survey',
      currency: 'NZD',
      countryCode: 'NZ',
      dateUtc: '2026-06-16T22:00:00Z',
      actual: 80.4,
      consensus: null,
      previous: 94.7,
      unit: null,
    });
    const found = resolveSlotEvent(slot('consumer-confidence'), 'NZD', [westpac, anz()]);
    expect(found?.name).toContain('Roy Morgan');
  });

  it('scores Australia from the Westpac index', () => {
    const r = scoreSlot(
      slot('consumer-confidence'),
      'AUD',
      [
        makeEvent({
          name: 'Westpac Consumer Confidence',
          currency: 'AUD',
          countryCode: 'AU',
          dateUtc: '2026-08-18T00:30:00Z',
          actual: 6,
          consensus: null,
          previous: 4.1,
          unit: null,
        }),
      ],
      new Date('2026-08-31T12:00:00Z'),
    );
    expect(r.cell).toBe(1);
    expect(Math.sign(r.sigma!)).toBe(1);
  });
});
