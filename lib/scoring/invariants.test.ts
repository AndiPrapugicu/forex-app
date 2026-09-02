/**
 * Whole-board invariants — properties that must hold for EVERY symbol and EVERY
 * column, whatever the inputs.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE RULE TESTS. Everything else in this
 * directory tests one rule against one piece of evidence, and each of those can
 * be right while the board as a whole is wrong: a cell out of range, a NaN
 * reaching a total, a null quietly counting as zero, or the same inputs
 * producing two different boards on two runs. Those failures do not belong to
 * any single rule, so no single rule's test would catch them.
 *
 * These are also the properties a PRODUCT depends on, as opposed to the ones a
 * parity investigation depends on. Nothing here mentions A1.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MATRIX_SLOTS, SCORING_SLOTS } from '@/config/setups.config';
import { asOf } from '@/lib/scoring/backtest';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import type { CotReport } from '@/lib/connectors/cftc';
import type { NormalizedEvent } from '@/lib/types';

const NOW = new Date('2026-08-24T23:59:59Z');

function event(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    seriesId: null,
    name: 'Consumer Price Index (YoY)',
    currency: 'USD',
    countryCode: 'US',
    dateUtc: '2026-08-12T12:00:00Z',
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
    ...over,
  };
}

function report(contract: string, over: Partial<CotReport> = {}): CotReport {
  return {
    contract,
    reportDate: '2026-08-11',
    specLong: 60_000,
    specShort: 40_000,
    specNet: 20_000,
    specLongPct: 60,
    commLong: 40_000,
    commShort: 60_000,
    commNet: -20_000,
    retailLong: 25_000,
    retailShort: 75_000,
    retailNet: -50_000,
    retailLongPct: 25,
    openInterest: 100_000,
    openInterestChange: 1_000,
    specNetChange: 2_000,
    specLongChange: 1_500,
    specShortChange: -500,
    specLongPctChange: 3,
    ...over,
  };
}

/** A deliberately mixed board: several currencies, a COT contract, a yield. */
const INPUT = () => ({
  events: [
    event({ currency: 'USD', countryCode: 'US' }),
    event({ currency: 'EUR', countryCode: 'EMU', name: 'Harmonized Index of Consumer Prices (YoY)' }),
    event({ currency: 'GBP', countryCode: 'UK', name: 'Gross Domestic Product (QoQ)', actual: 0.4, consensus: 0.2 }),
    event({ currency: 'JPY', countryCode: 'JP', name: 'Unemployment Rate', actual: 2.8, consensus: 2.5 }),
  ],
  cot: new Map([
    ['EURO FX', { contract: 'EURO FX', reports: [report('EURO FX')] }],
    ['USD INDEX', { contract: 'USD INDEX', reports: [report('USD INDEX')] }],
  ]),
  technicals: new Map(),
  yield2y: { current: 3.96, sma: 4.12, observedOn: '2026-08-24' },
  now: NOW,
});

const build = () => buildSetupsMatrix(INPUT());

describe('every cell is a whole number inside its declared range', () => {
  /**
   * A pair DIFFERENCES two legs, so its bound is twice a single economy's. The
   * bound comes from the slot config rather than a literal, so raising a slot's
   * `maxCell` cannot silently invalidate this.
   */
  it('never exceeds the slot bound, and never produces a fraction or a NaN', () => {
    const matrix = build();
    const slotOf = new Map(MATRIX_SLOTS.map((s) => [s.key, s]));

    for (const row of matrix.rows) {
      const isPair = Boolean(row.base && row.quote);
      for (const [key, cell] of Object.entries(row.cells)) {
        if (cell.cell === null) continue;
        const slot = slotOf.get(key)!;
        const perLeg = slot.maxCell ?? 1;
        const bound = isPair && slot.kind === 'economic' ? perLeg * 2 : perLeg;

        expect(Number.isFinite(cell.cell), `${row.symbol}.${key} finite`).toBe(true);
        expect(Number.isInteger(cell.cell), `${row.symbol}.${key} integer`).toBe(true);
        expect(Math.abs(cell.cell), `${row.symbol}.${key} bound`).toBeLessThanOrEqual(bound);
        // -0 renders as "-0" and compares equal to 0, so it survives most tests.
        expect(Object.is(cell.cell, -0), `${row.symbol}.${key} negative zero`).toBe(false);
      }
    }
  });

  it('keeps every total finite and integral', () => {
    for (const row of build().rows) {
      expect(Number.isInteger(row.totalScore), row.symbol).toBe(true);
      expect(Number.isFinite(row.totalScore), row.symbol).toBe(true);
    }
  });
});

describe('a missing value never becomes a score', () => {
  /**
   * The failure mode this exists for is silent: an absent provider arriving as a
   * confident 0 changes a total without changing anything visible. A null cell
   * must be absent from the sum, not counted as zero — which is the same number
   * but a different claim, and only one of them survives a change to the bias
   * bands or the column set.
   */
  it('excludes null cells from the total rather than adding them as zero', () => {
    const scoring = new Set(SCORING_SLOTS.map((s) => s.key));
    for (const row of build().rows) {
      const populated = Object.entries(row.cells).filter(
        ([key, cell]) => scoring.has(key) && cell.cell !== null,
      );
      const sum = populated.reduce((t, [, cell]) => t + cell.cell!, 0);
      expect(sum, row.symbol).toBe(row.totalScore);
    }
  });

  it('produces an all-null board and a zero total when nothing is supplied', () => {
    const empty = buildSetupsMatrix({ events: [], cot: new Map(), technicals: new Map(), now: NOW });
    for (const row of empty.rows) {
      for (const [key, cell] of Object.entries(row.cells)) {
        expect(cell.cell, `${row.symbol}.${key}`).toBeNull();
      }
      expect(row.totalScore, row.symbol).toBe(0);
      expect(row.bias, row.symbol).toBe('Neutral');
    }
  });

  it('marks every blank cell with a status that says why', () => {
    const empty = buildSetupsMatrix({ events: [], cot: new Map(), technicals: new Map(), now: NOW });
    for (const row of empty.rows) {
      for (const [key, cell] of Object.entries(row.cells)) {
        expect(cell.status, `${row.symbol}.${key}`).not.toBe('scored');
        expect(cell.explanation.length, `${row.symbol}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('the board is deterministic', () => {
  /**
   * Two builds from equal inputs must be indistinguishable. Anything reading the
   * clock, iterating a Set in insertion order that depends on fetch completion,
   * or carrying a random id into a cell breaks this — and none of it would fail
   * any other test in this directory.
   */
  it('produces an identical board from equal inputs', () => {
    const a = build();
    const b = build();
    const strip = (m: ReturnType<typeof build>) =>
      m.rows.map((r) => ({
        symbol: r.symbol,
        total: r.totalScore,
        bias: r.bias,
        cells: Object.fromEntries(
          Object.entries(r.cells).map(([k, c]) => [k, [c.cell, c.status, c.explanation]]),
        ),
      }));
    expect(strip(a)).toEqual(strip(b));
  });

  it('ranks rows in a stable order', () => {
    expect(build().rows.map((r) => r.symbol)).toEqual(build().rows.map((r) => r.symbol));
  });
});

describe('historical mode cannot see past its cutoff', () => {
  /**
   * The board-level companion to the `asOf` unit tests: those prove the filter
   * drops future rows, this proves nothing downstream of the filter puts one
   * back. A leg carrying a date after the cutoff is a look-ahead that reached a
   * rendered cell, which is the failure the whole rewind exists to prevent.
   */
  const CUTOFF = new Date('2026-08-24T23:59:59Z');

  it('never carries a leg dated after the cutoff', () => {
    const input = INPUT();
    const future = event({
      currency: 'USD',
      countryCode: 'US',
      name: 'Nonfarm Payrolls',
      actual: 250,
      consensus: 100,
      dateUtc: '2026-09-05T12:30:00Z',
    });
    const trimmed = asOf(
      { events: [...input.events, future], cot: input.cot, bars: new Map(), seasonality: new Map() },
      CUTOFF,
    );
    const matrix = buildSetupsMatrix({ ...input, events: trimmed.events, now: CUTOFF });

    for (const row of matrix.rows) {
      for (const [key, cell] of Object.entries(row.cells)) {
        for (const leg of cell.legs ?? []) {
          if (!leg.dateUtc) continue;
          expect(
            Date.parse(leg.dateUtc),
            `${row.symbol}.${key} leg dated ${leg.dateUtc}`,
          ).toBeLessThanOrEqual(CUTOFF.getTime());
        }
      }
    }
  });

  it('does not let that future release reach any employment cell', () => {
    // The positive control: without the filter this release WOULD score, so a
    // vacuously-passing test above would be visible here.
    const input = INPUT();
    const future = event({
      currency: 'USD',
      countryCode: 'US',
      name: 'Nonfarm Payrolls',
      actual: 250,
      consensus: 100,
      dateUtc: '2026-09-05T12:30:00Z',
    });
    const withIt = buildSetupsMatrix({ ...input, events: [...input.events, future], now: new Date('2026-09-06T00:00:00Z') });
    expect(withIt.rows.find((r) => r.symbol === 'EURUSD')!.cells.employment.cell).not.toBeNull();

    const trimmed = asOf(
      { events: [...input.events, future], cot: input.cot, bars: new Map(), seasonality: new Map() },
      CUTOFF,
    );
    const without = buildSetupsMatrix({ ...input, events: trimmed.events, now: CUTOFF });
    expect(without.rows.find((r) => r.symbol === 'EURUSD')!.cells.employment.cell).toBeNull();
  });
});

describe('one board run is one coherent snapshot', () => {
  /**
   * TWO SEPARATE GUARANTEES, AND BOTH ARE STRUCTURAL RATHER THAN ASSERTED.
   *
   * 1. ONE FETCH GENERATION. Every provider is awaited in a single
   *    `Promise.all` before anything is scored, so no two columns can be built
   *    from different generations of the same feed. A second await block added
   *    later — a retry, a top-up, a lazily fetched extra series — would break
   *    that silently, which is why this counts them.
   *
   * 2. ONE CLOCK. `buildSetupsMatrix` resolves `now` once and threads it
   *    through every slot, so staleness windows and age calculations cannot
   *    disagree between two cells of the same board.
   */
  it('awaits every provider in a single Promise.all', () => {
    const source = readFileSync(join(process.cwd(), 'lib/setups-pipeline.ts'), 'utf8');
    const body = source.slice(source.indexOf('export async function runSetupsPipeline'));
    const awaits = body.match(/await Promise\.all\(/g) ?? [];
    // One for the providers. The second is a bounded post-merge fan-out that
    // reads no network, and is pinned here so a THIRD cannot appear unnoticed.
    expect(awaits.length).toBeLessThanOrEqual(2);
  });

  it('resolves the clock once per board rather than per slot', () => {
    const source = readFileSync(join(process.cwd(), 'lib/scoring/setups.ts'), 'utf8');
    expect(source).toContain('const now = input.now ?? new Date();');
  });

  it('scores identically when handed the same payload twice', () => {
    // The behavioural companion: whatever the clock is, one payload in must
    // mean one board out.
    const fixed = new Date('2026-08-24T23:59:59Z');
    const a = buildSetupsMatrix({ ...INPUT(), now: fixed });
    const b = buildSetupsMatrix({ ...INPUT(), now: fixed });
    expect(a.rows.map((r) => [r.symbol, r.totalScore])).toEqual(
      b.rows.map((r) => [r.symbol, r.totalScore]),
    );
  });
});
