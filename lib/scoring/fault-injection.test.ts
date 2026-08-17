/**
 * The regression test the flicker never had.
 *
 * The reported symptom was "we had 20 bullish and from time to time it appeared
 * that it's 19, and no news occurred". The mechanism was not randomness and not
 * ageing: it was a transient upstream failure being scored as a NEUTRAL READING.
 * One missing COT leg was coerced to 0, the cell was still stamped `'scored'`,
 * `populated` stayed identical, and the matrix rendered a confident number built
 * from half the usual inputs.
 *
 * So these tests do not check that the board is right. They break one thing on
 * purpose and check that the board SAYS SO — in the cell status, in the coverage
 * count, and in the change log.
 */

import { describe, expect, it } from 'vitest';
import { CURRENCY_COT_CONTRACT } from '@/config/symbols.config';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';
import type { Technicals } from '@/lib/connectors/technicals';
import { buildChangeLog, buildSnapshots, latestPerSymbol } from '@/lib/scoring/history';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import { MAJORS, type Currency } from '@/lib/types';

const NOW = new Date('2026-08-11T12:00:00Z');

function report(contract: string, specLongPct: number, pctChange: number): CotReport {
  return {
    contract,
    reportDate: '2026-08-04',
    specLong: 60_000,
    specShort: 40_000,
    specNet: 20_000,
    specLongPct,
    commLong: 40_000,
    commShort: 60_000,
    commNet: -20_000,
    retailLong: 10_000,
    retailShort: 10_000,
    retailNet: 0,
    retailLongPct: 50,
    openInterest: 100_000,
    openInterestChange: 1_000,
    specNetChange: 2_000,
    specLongChange: 1_500,
    specShortChange: -500,
    specLongPctChange: pctChange,
  };
}

/**
 * A COT series for every major, each with a clearly non-zero weekly change so a
 * dropped contract shows up as a real difference rather than a coincidence.
 */
function cotForAll(overrides: { drop?: Currency } = {}): Map<string, CotSeries> {
  const out = new Map<string, CotSeries>();

  for (const currency of MAJORS) {
    if (overrides.drop === currency) continue;
    const contract = CURRENCY_COT_CONTRACT[currency];
    // Alternating direction, so base and quote legs do not cancel out.
    const direction = MAJORS.indexOf(currency) % 2 === 0 ? 3 : -3;
    out.set(contract, { contract, reports: [report(contract, 60, direction)] });
  }

  return out;
}

function technicals(symbols: string[], drop?: string): Map<string, Technicals> {
  const out = new Map<string, Technicals>();

  for (const symbol of symbols) {
    if (symbol === drop) continue;
    out.set(symbol, {
      symbol,
      price: 1.2,
      // A rising fast average over a rising slow one: trend +2, never 0.
      smaFast: 1.2,
      smaSlow: 1.15,
      smaSlowPrior: 1.1,
      sma20: null,
      sma50: null,
      sma100: null,
      sma200: null,
      aboveCount: null,
      smaCount: 0,
      realizedVolPct: 6,
      avgDailyMove7Pct: 0.5,
      avgDailyMove90Pct: 0.4,
      seasonality: {},
    });
  }

  return out;
}

const SYMBOL = 'EURUSD';

function build(input: { cot: Map<string, CotSeries>; technicals: Map<string, Technicals> }) {
  const matrix = buildSetupsMatrix({ events: [], now: NOW, ...input });
  return { matrix, row: matrix.rows.find((r) => r.symbol === SYMBOL)! };
}

describe('a dropped COT contract', () => {
  const healthy = build({ cot: cotForAll(), technicals: technicals([SYMBOL]) });
  const broken = build({ cot: cotForAll({ drop: 'EUR' }), technicals: technicals([SYMBOL]) });

  it('still scores the cell from the surviving leg', () => {
    // Dropping it entirely would swing the score FURTHER than the failure did.
    expect(broken.row.cells.cot.cell).not.toBeNull();
  });

  /**
   * The core defect. This assertion is the whole fix: the cell used to read
   * `'scored'` here, which made a failed contract indistinguishable from a
   * genuine neutral reading.
   */
  it('marks the cell partial and names the missing leg', () => {
    expect(healthy.row.cells.cot.status).toBe('scored');
    expect(broken.row.cells.cot.status).toBe('partial');
    expect(broken.row.cells.cot.missingLeg).toBe('EUR');
  });

  it('says so in the explanation the tooltip renders', () => {
    expect(broken.row.cells.cot.explanation).toMatch(/EUR leg is missing/);
  });

  it('drops the coverage count instead of leaving it identical', () => {
    // `populated` used to be byte-for-byte the same across the failure, which is
    // what let the board look equally trustworthy before and after.
    expect(broken.row.populated).toBeLessThan(healthy.row.populated);
    expect(broken.row.partial).toBeGreaterThan(0);
  });

  it('moves the score, which is why the coverage count had to move too', () => {
    expect(broken.row.totalScore).not.toBe(healthy.row.totalScore);
  });

  /**
   * `USD INDEX` is the expensive one: every major quoted against the dollar
   * loses a leg at once, which is how a single transient failure moved seven
   * rows with nothing on screen to explain it.
   */
  it('marks every affected row when the USD contract is the one that fails', () => {
    const symbols = ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDJPY', 'USDCAD', 'USDCHF'];
    const { matrix } = build({
      cot: cotForAll({ drop: 'USD' }),
      technicals: technicals(symbols),
    });

    for (const symbol of symbols) {
      const row = matrix.rows.find((r) => r.symbol === symbol)!;
      expect(row.cells.cot.status, symbol).toBe('partial');
      expect(row.cells.cot.missingLeg, symbol).toBe('USD');
    }
  });
});

describe('a dropped technicals symbol', () => {
  /**
   * There is nothing to mark partial here — trend is a per-symbol score with no
   * legs to lose — but there is something to notice: `scoreTrend` can never
   * return 0, so losing one symbol's technicals ALWAYS moves its total by 1 to
   * 3 points. That is why the connector retries rather than dropping it.
   */
  it('leaves a blank cell rather than a zero, and lowers the coverage count', () => {
    const healthy = build({ cot: cotForAll(), technicals: technicals([SYMBOL]) });
    const broken = build({ cot: cotForAll(), technicals: technicals([SYMBOL], SYMBOL) });

    expect(healthy.row.cells.trend.cell).toBe(2);
    expect(broken.row.cells.trend.cell).toBeNull();
    expect(broken.row.cells.trend.status).toBe('no-data');
    expect(broken.row.populated).toBe(healthy.row.populated - 1);
  });
});

describe('the change log over an injected failure', () => {
  it('names the leg that went missing rather than reporting a silent move', () => {
    const healthy = build({ cot: cotForAll(), technicals: technicals([SYMBOL]) });
    const broken = build({ cot: cotForAll({ drop: 'EUR' }), technicals: technicals([SYMBOL]) });

    // The healthy run is what the cron would have stored ten minutes ago.
    const stored = buildSnapshots(healthy.matrix).map((s) => ({
      ...s,
      capturedAtUtc: '2026-08-11T11:50:00.000Z',
    }));

    const previous = latestPerSymbol(stored, '2026-08-11T12:00:00.000Z');
    const log = buildChangeLog(broken.matrix.rows, previous);
    const entry = log.find((c) => c.symbol === SYMBOL)!;

    expect(entry).toBeDefined();
    /**
     * BOTH columns, because one contract feeds both: `cot` reads its weekly
     * change and `crowd` reads its retail positioning. That is the real cost of
     * a dropped contract and the log names all of it rather than the first one
     * it happened to find.
     */
    expect(entry.cause).toBe('cot lost its EUR leg · crowd lost its EUR leg');
    expect(entry.from).toBe(healthy.row.totalScore);
    expect(entry.to).toBe(broken.row.totalScore);
  });

  /**
   * And the other half of honest: when the SAME leg is missing on both runs,
   * nothing new has broken and the log must not say it has. A warning that
   * fires every ten minutes for a standing condition stops being read.
   */
  it('stays quiet when the leg was already missing last run', () => {
    const broken = build({ cot: cotForAll({ drop: 'EUR' }), technicals: technicals([SYMBOL]) });

    const stored = buildSnapshots(broken.matrix).map((s) => ({
      ...s,
      capturedAtUtc: '2026-08-11T11:50:00.000Z',
    }));

    const previous = latestPerSymbol(stored, '2026-08-11T12:00:00.000Z');
    const log = buildChangeLog(broken.matrix.rows, previous);

    expect(log.find((c) => c.symbol === SYMBOL)).toBeUndefined();
  });
});
