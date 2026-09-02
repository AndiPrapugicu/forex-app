/**
 * The currency-index rows, decomposed against A1's own arithmetic.
 *
 * WHY THIS FILE EXISTS. Round fourteen went looking for a fresh Top Setups
 * capture holding the EURO, US-DOLLAR, GB-POUND and CH-FRANC rows, and found
 * that no free A1 surface carries a currency-index row at all: the Forex
 * Scorecard is pairs only and the Asset Scorecard demo is locked to platinum
 * (`fixtures/a1-rates-and-index-2026-08-30.json`, `demoCaps`). EURX, GBPX and
 * CHFX therefore cannot be re-observed, and everything we will ever know about
 * them has to come out of the rows already on file.
 *
 * It turns out that is a great deal, because A1's board is over-determined.
 * Gold and silver carry ONLY the dollar leg, inverted, so they measure USD
 * directly; EURUSD and GBPUSD carry that same leg differenced against theirs;
 * and EURX carries EUR alone. Three independent routes to the same numbers,
 * which is what makes a single misread cell nameable instead of arguable.
 *
 * These assertions are about A1's PUBLISHED CELLS, not about our scorer. They
 * fail if someone edits a fixture row — which is the point. Two of this
 * project's longest-running open questions are settled by the arithmetic below,
 * and neither should have to be re-derived a fifth time.
 */

import { describe, expect, it } from 'vitest';

import CAPTURE from '@/fixtures/a1-top-setups-2026-08-24.json';
import BOARD from '@/fixtures/a1-board.json';
import { ALL_SYMBOLS } from '@/config/symbols.config';
import { feedForDate } from '@/lib/scoring/crowd-oracle';
import { resolveCrowd } from '@/lib/scoring/crowd';

/** The five columns read off the index INSTRUMENT rather than off any leg. */
const TECHNICAL = ['trend', 'seasonality', 'cot', 'crowd'] as const;

/** The fourteen macro columns, in board order. */
const ECONOMIC = [
  'gdp',
  'mpmi',
  'spmi',
  'retail-sales',
  'consumer-confidence',
  'cpi',
  'ppi',
  'pce',
  'rates',
  'employment',
  'unemployment',
  'claims',
  'adp',
  'jolts',
] as const;

type Slot = (typeof ECONOMIC)[number];

const CELLS = CAPTURE.cells as Record<string, Record<string, number | string>>;

function row(symbol: string): Record<string, number> {
  const raw = CELLS[symbol];
  if (!raw) throw new Error(`no ${symbol} row in the 2026-08-24 capture`);
  const out: Record<string, number> = {};
  for (const key of [...TECHNICAL, ...ECONOMIC]) {
    const value = raw[key];
    if (typeof value !== 'number') throw new Error(`${symbol}.${key} is not a number`);
    out[key] = value;
  }
  return out;
}

function econ(symbol: string): Record<Slot, number> {
  const full = row(symbol);
  return Object.fromEntries(ECONOMIC.map((k) => [k, full[k]])) as Record<Slot, number>;
}

function sum(cells: Record<string, number>): number {
  return Object.values(cells).reduce((a, b) => a + b, 0);
}

/**
 * A metal carries the dollar leg and nothing else, inverted for a haven. So
 * negating its economic row reads USD directly, with no algebra at all.
 */
function usdLegFromMetal(symbol: string): Record<Slot, number> {
  const cells = econ(symbol);
  return Object.fromEntries(ECONOMIC.map((k) => [k, -cells[k]])) as Record<Slot, number>;
}

describe('the 2026-08-24 rows are internally sound before anything is derived from them', () => {
  it('every admitted row still sums to its own printed total', () => {
    for (const symbol of Object.keys(CELLS)) {
      const printed = CELLS[symbol].total;
      expect(sum(row(symbol)), `${symbol} checksum`).toBe(printed);
    }
  });

  it('gold and silver agree on the dollar leg in all fourteen columns', () => {
    // They are separate rows with separate totals (8 and 10, differing only in
    // COT), so agreement here is a real check and not a tautology.
    expect(usdLegFromMetal('XAGUSD')).toEqual(usdLegFromMetal('XAUUSD'));
  });
});

describe('A1 differences legs — proved on their own board, not assumed from ours', () => {
  // The standing instruction is not to assume A1 uses leg-differencing merely
  // because our architecture does. This is the proof, and it is over-determined:
  // the dollar leg is measured once from the metals (direct) and once from
  // EURX - EURUSD (differenced). If A1 did not difference legs, the two would
  // agree only by coincidence, column after column.
  const direct = usdLegFromMetal('XAUUSD');
  const differenced = Object.fromEntries(
    ECONOMIC.map((k) => [k, econ('EURX')[k] - econ('EURUSD')[k]]),
  ) as Record<Slot, number>;

  it('reconciles thirteen of the fourteen economic columns', () => {
    const agree = ECONOMIC.filter((k) => direct[k] === differenced[k]);
    expect(agree).toHaveLength(13);
    expect(ECONOMIC.filter((k) => direct[k] !== differenced[k])).toEqual(['unemployment']);
  });

  it('and the one exception is out of range for a leg, so it cannot be the rule that is wrong', () => {
    // A leg is ternary. +2 is not a value a leg can take, so this is a bad cell
    // somewhere in the three rows, not evidence against leg-differencing.
    expect(differenced.unemployment).toBe(2);
    expect(direct.unemployment).toBe(1);
  });
});

describe("EUR unemployment: our -1 is confirmed by A1's own board", () => {
  // This closes an UNKNOWN that has been carried for three rounds. A1 publishes
  // the unemployment ACTUAL only -- their forecast chart renders "COMING SOON!"
  // over a dataset error -- so the question could never be settled from the
  // series pages. It is settled from their cells instead.
  const usd = usdLegFromMetal('XAUUSD');
  const eurLeg = Object.fromEntries(
    ECONOMIC.map((k) => [k, econ('EURUSD')[k] + usd[k]]),
  ) as Record<Slot, number>;

  it('differs from the printed EURX row in exactly one column', () => {
    const differing = ECONOMIC.filter((k) => eurLeg[k] !== econ('EURX')[k]);
    expect(differing).toEqual(['unemployment']);
  });

  it("puts EUR unemployment at -1, which is the cell our engine already produces", () => {
    // EURUSD prints -2 and the dollar leg is +1, so EUR must be -1. The EURX
    // row prints 0, and 0 is unreconcilable with A1's own EURUSD and metals.
    expect(econ('EURUSD').unemployment).toBe(-2);
    expect(usd.unemployment).toBe(1);
    expect(eurLeg.unemployment).toBe(-1);
    expect(econ('EURX').unemployment).toBe(0);
  });
});

describe("the EURX row cannot be checksum-tested on its two suspect cells", () => {
  // The single most consequential arithmetic in this file.
  //
  // Two INDEPENDENT lines of evidence each say one EURX cell is off by one, and
  // they point in OPPOSITE directions:
  //
  //   rates        A1's own free pages put the EUR policy rate below their own
  //                current-quarter projection (2.40 -> 2.65), which makes the
  //                EUR rates leg +1. EURX prints 0.
  //   unemployment A1's own EURUSD (-2) and metals (USD +1) force the EUR leg
  //                to -1. EURX prints 0.
  //
  // A row-sum checksum is permutation-invariant and, worse, blind to a pair of
  // errors that cancel. +1 on rates and -1 on unemployment cancel exactly, so
  // the row sums to its printed 7 either way. The checksum that admitted this
  // row therefore never tested either cell.
  //
  // This matters because EURX's rates cell of 0 is the ONLY observation
  // anywhere that contradicts the rates rule. It is not a well-attested
  // counter-example; it is an untested cell on a crowded crop.
  const SLOTS = [...TECHNICAL, ...ECONOMIC];

  it('sums to its printed total both as transcribed and as the evidence would have it', () => {
    const asRead = row('EURX');
    expect(SLOTS.reduce((a, k) => a + asRead[k], 0)).toBe(CELLS.EURX.total);

    const corrected: Record<string, number> = { ...asRead, rates: 1, unemployment: -1 };
    expect(SLOTS.reduce((a, k) => a + corrected[k], 0)).toBe(CELLS.EURX.total);
  });

  it('leaves the transcribed values in place regardless', () => {
    // Recording that a checksum is blind is not licence to edit a cell. The
    // fixture keeps what was read; `solveA1Legs` keeps using it.
    expect(econ('EURX').rates).toBe(0);
    expect(econ('EURX').unemployment).toBe(0);
  });
});

describe('GBPX: the one-point gap is two larger offsetting errors', () => {
  // Round thirteen bounded this to "trend, seasonality, COT or crowd" and could
  // not choose. The board total plus the derived GBP legs split it cleanly.
  const usd = usdLegFromMetal('XAUUSD');
  const gbpLeg = Object.fromEntries(
    ECONOMIC.map((k) => [k, econ('GBPUSD')[k] + usd[k]]),
  ) as Record<Slot, number>;

  const publishedTotal = (BOARD.captures[0].totals as Record<string, number>).GBPX;

  it('reads A1s GBPX total off the same capture that carries the cells', () => {
    // Guards against the cross-capture contamination this project keeps hitting.
    expect(BOARD.captures[0].capturedUtc).toBe('2026-08-23T15:11:37.000Z');
    expect((BOARD.captures[0].totals as Record<string, number>).EURX).toBe(CELLS.EURX.total);
    expect(publishedTotal).toBe(0);
  });

  it("makes A1's whole GBP economic block zero", () => {
    expect(sum(gbpLeg)).toBe(0);
  });

  it('which forces their four instrument columns to sum to zero too', () => {
    // total = technical block + economic block, so with the economic block at 0
    // the technical block IS the printed total.
    expect(publishedTotal - sum(gbpLeg)).toBe(0);
  });

  it('names the four economic cells that disagree, and their net', () => {
    // Ours, scored at the same frame: gdp +1, mpmi 0, retail-sales 0, ppi -1.
    // Three of the four now have A1's own published inputs behind them.
    const ours: Partial<Record<Slot, number>> = {
      gdp: 1,
      mpmi: 0,
      'retail-sales': 0,
      ppi: -1,
    };
    expect(gbpLeg.gdp).toBe(0); //     A1 GDP MoM 0.4 vs forecast 0.4 -> as expected
    expect(gbpLeg.mpmi).toBe(-1); //   A1 mPMI 51.5 vs forecast 51.6 -> miss
    expect(gbpLeg['retail-sales']).toBe(-1); // A1 retail -0.50 vs forecast -0.40 -> miss
    expect(gbpLeg.ppi).toBe(1); //     contradicts A1's OWN PPI page, which gives -1

    const net = (Object.keys(ours) as Slot[]).reduce((acc, k) => acc + (ours[k]! - gbpLeg[k]), 0);
    expect(net).toBe(1); // our economic block sits one point above theirs
  });
});

describe("Crowd on an index row, replayed through the production scorer", () => {
  it("turns A1's own GBPUSD long share into the GBPX cell they would print", () => {
    // GBPX has no A1 crowd cell on file, so this is not a parity check -- it is
    // the quantification the GBPX split needs. Our live cell is 0 (CFTC small
    // traders balanced at 53.5% long); A1's book had GBPUSD at 31% long.
    const feed = feedForDate('2026-08-24');
    expect(feed.get('GBPUSD')?.longPct).toBe(31);

    const gbpx = ALL_SYMBOLS.find((s) => s.symbol === 'GBPX');
    expect(gbpx).toBeDefined();
    const cell = resolveCrowd(gbpx!, new Map(), feed);
    expect(cell.cell).toBe(1);
    // The index rung reports `retail-feed` like the direct one — the derivation
    // shows up in the explanation, which is what names GBPUSD as the source.
    expect(cell.basis).toBe('retail-feed');
    expect(cell.explanation).toContain('read off GBPUSD');
  });
});
