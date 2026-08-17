/**
 * Price structure.
 *
 * This module's output is a set of prices a trader will place orders against, so
 * the tests below are chosen for the failures that would still LOOK right: a
 * level broken by a wick, a break the market has since reclaimed, a confluence
 * "zone" built by chaining three levels that are nowhere near each other, and a
 * retracement anchored to the wrong swing — which lands the 61.8% hundreds of
 * pips out while remaining entirely plausible on screen.
 *
 * The look-ahead test is the most important one here, for the same reason the
 * `asOf` tests matter in backtest.test.ts: if a swing can be broken before it
 * was confirmed, every historical break looks perfectly timed and nothing
 * visibly fails.
 */

import { describe, expect, it } from 'vitest';
import {
  BREAK_BUFFER_ATR,
  CONFLUENCE_ATR,
  MIN_CONFLUENCE_SOURCES,
  MIN_LEG_ATR,
  SWING_LOOKBACK,
} from '@/config/setups.config';
import {
  analyseStructure,
  atr,
  confluence,
  fibRetracement,
  findSwings,
  readStructure,
  roundNumbers,
  type LevelSource,
} from '@/lib/scoring/structure';
import type { DailyBars } from '@/lib/connectors/technicals';

const DAY = 86_400;
const T0 = Math.floor(Date.UTC(2026, 0, 1) / 1000);

/** Bars from explicit [high, low, close] rows; open is pinned to the prior close. */
function make(rows: [high: number, low: number, close: number][]): DailyBars {
  return {
    timestamps: rows.map((_, i) => T0 + i * DAY),
    opens: rows.map((r, i) => (i === 0 ? r[2] : rows[i - 1][2])),
    highs: rows.map((r) => r[0]),
    lows: rows.map((r) => r[1]),
    closes: rows.map((r) => r[2]),
  };
}

/** A flat-ish base long enough to clear STRUCTURE_MIN_BARS and warm up the ATR. */
function base(n: number, level = 100, wiggle = 1): [number, number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const drift = (i % 2 === 0 ? 1 : -1) * wiggle * 0.2;
    return [level + wiggle + drift, level - wiggle + drift, level + drift] as [
      number,
      number,
      number,
    ];
  });
}

/**
 * Bars that walk linearly between turning points, so real swings form.
 *
 * The obvious fixture — a flat series with one spiked bar — cannot test this
 * module: with no pullback between two spikes the alternation rule correctly
 * collapses them to one swing, so there is never a confirmed low for a leg to
 * start from and never a break. Structure needs structure. Highs and lows are
 * the bar's own travel, which puts each pivot exactly on its turning price.
 */
function legRows(points: number[], barsPerLeg = 25): [number, number, number][] {
  const rows: [number, number, number][] = [];
  for (let p = 1; p < points.length; p++) {
    const from = points[p - 1];
    const to = points[p];
    for (let b = 1; b <= barsPerLeg; b++) {
      const prev = from + ((to - from) * (b - 1)) / barsPerLeg;
      const close = from + ((to - from) * b) / barsPerLeg;
      rows.push([Math.max(prev, close), Math.min(prev, close), close]);
    }
  }
  return rows;
}

const legs = (points: number[], barsPerLeg = 25) => make(legRows(points, barsPerLeg));

describe('atr', () => {
  it('measures the gap, not just the bar', () => {
    // Every bar spans 2 but gaps 10 from the prior close. True range must see it.
    const rows: [number, number, number][] = [[100, 98, 99]];
    for (let i = 1; i < 20; i++) {
      const b = 99 + i * 10;
      rows.push([b + 1, b - 1, b]);
    }
    expect(atr(make(rows))!).toBeGreaterThan(9);
  });

  it('returns null for a flat series rather than zero', () => {
    // Zero would make every tolerance collapse and every distance infinite.
    expect(atr(make(base(40, 100, 0)))).toBeNull();
  });

  it('returns null before there is a full window', () => {
    expect(atr(make(base(5)))).toBeNull();
  });
});

describe('findSwings', () => {
  it('marks a clear peak and refuses the unconfirmed bars at the end', () => {
    const rows = base(80);
    rows[40] = [130, 120, 128]; // an unmistakable high
    // The series also ENDS on its highest bar, which cannot yet be a swing.
    rows[79] = [200, 190, 199];

    const swings = findSwings(make(rows));

    expect(swings.some((s) => s.index === 40 && s.kind === 'high')).toBe(true);
    // A pivot needs bars to its right; the last few can never qualify.
    expect(swings.every((s) => s.index <= rows.length - 1 - SWING_LOOKBACK)).toBe(true);
  });

  it('yields ONE swing for a plateau of equal highs, at the first bar', () => {
    /**
     * Non-strict on both sides turns a three-bar plateau into three swings at
     * the same price — three votes for one level, which is the fake-confluence
     * failure. Strict on both sides yields zero and throws away a real double
     * top. The asymmetry gives exactly one, at the bar that established it.
     */
    const rows = base(80);
    rows[40] = [130, 120, 128];
    rows[41] = [130, 120, 128];
    rows[42] = [130, 120, 128];

    const highs = findSwings(make(rows)).filter((s) => s.kind === 'high' && s.price === 130);

    expect(highs).toHaveLength(1);
    expect(highs[0].index).toBe(40);
  });

  it('filters swings smaller than the significance threshold', () => {
    // Pure low-amplitude chop: every wiggle is a fractal, none is a level.
    const swings = findSwings(make(base(120, 100, 1)));
    expect(swings.length).toBeLessThanOrEqual(2);
  });

  it('alternates, keeping the more extreme of two consecutive highs', () => {
    const rows = base(120);
    rows[40] = [130, 120, 128];
    rows[50] = [145, 135, 143]; // higher high, no confirmed low between
    rows[80] = [70, 60, 62]; // a low, to force alternation afterwards

    const swings = findSwings(make(rows));
    for (let i = 1; i < swings.length; i++) {
      expect(swings[i].kind).not.toBe(swings[i - 1].kind);
    }
    expect(swings.some((s) => s.price === 145)).toBe(true);
    expect(swings.some((s) => s.price === 130)).toBe(false);
  });

  it('returns nothing below the minimum bar count', () => {
    expect(findSwings(make(base(30)))).toEqual([]);
  });
});

describe('readStructure', () => {
  it('reports a bullish break at the swing that gave way', () => {
    // Up to 130, pull back to 115, then drive through 130 to 150.
    const bars = legs([100, 130, 115, 150]);
    const state = readStructure(bars, findSwings(bars));

    expect(state.direction).toBe('bullish');
    expect(state.latest!.level).toBeCloseTo(130, 6);
  });

  it('does NOT treat a wick through the level as a break', () => {
    /**
     * A wick through a swing high is a stop run. A level pierced intrabar and
     * closed back below is still resistance, and reporting otherwise is how a
     * trader ends up long above a level that never actually broke.
     */
    const rows = legRows([100, 130, 115, 128]);
    rows[70] = [145, rows[70][1], rows[70][2]]; // high clears 130, close does not

    const bars = make(rows);
    const state = readStructure(bars, findSwings(bars));

    expect(state.latest?.direction).not.toBe('bullish');
  });

  it('requires the close to clear the level by the buffer', () => {
    const rows = legRows([100, 130, 115, 128]);
    const range = atr(make(rows))!;
    // A close a hair above 130 is rounding, not a break.
    for (let i = 60; i < rows.length; i++) rows[i] = [130.0001, 129.9, 130.0001];

    expect(range * BREAK_BUFFER_ATR).toBeGreaterThan(0.0001);
    const bars = make(rows);
    expect(readStructure(bars, findSwings(bars)).latest?.direction).not.toBe('bullish');
  });

  it('cannot break a swing before that swing was confirmed', () => {
    /**
     * The look-ahead guard, and the reason it matters: a pivot is not knowable
     * until SWING_LOOKBACK bars have printed to its right, so no break may be
     * dated earlier than that. Get this wrong and every historical break looks
     * perfectly timed while nothing visibly fails — the same class of bug the
     * `asOf` tests in backtest.test.ts exist to catch.
     */
    const bars = legs([100, 130, 115, 150, 120, 160]);
    const state = readStructure(bars, findSwings(bars));

    expect(state.breaks.length).toBeGreaterThan(0);
    for (const b of state.breaks) {
      expect(b.breakIndex).toBeGreaterThanOrEqual(b.brokenSwing.index + SWING_LOOKBACK);
    }
  });

  it('does not report a RECLAIMED break as current structure', () => {
    /**
     * Price broke up through 130, then closed back under it. That level is not
     * support any more, and calling it support is the worst single output this
     * module could produce.
     */
    const bars = legs([100, 130, 115, 150, 90]);
    const state = readStructure(bars, findSwings(bars));

    const bullish = state.breaks.find((b) => b.direction === 'bullish');
    expect(bullish?.reclaimed).toBe(true);
    expect(state.latest?.direction).not.toBe('bullish');
  });

  it('reports a RANGE rather than a level when nothing has broken', () => {
    // Oscillating between the same two prices never closes beyond either.
    const bars = legs([100, 110, 100, 110, 100, 110, 100]);
    const state = readStructure(bars, findSwings(bars));

    expect(state.latest).toBeNull();
    expect(state.direction).toBeNull();
    expect(state.range).not.toBeNull();
    expect(state.range!.high).toBeCloseTo(110, 6);
    expect(state.range!.low).toBeCloseTo(100, 6);
  });

  it('flags a change of character when the last two live breaks disagree', () => {
    // Breaks 130 upward, then breaks the 138 pullback low — all while holding
    // above 130, so the bullish break is never reclaimed and stays `previous`.
    const bars = legs([100, 130, 115, 150, 138, 155, 136]);
    const state = readStructure(bars, findSwings(bars));

    expect(state.direction).toBe('bearish');
    expect(state.previous?.direction).toBe('bullish');
    expect(state.changeOfCharacter).toBe(true);
  });
});

describe('fibRetracement', () => {
  /**
   * Up to 120, back to 60, impulse through 120 to 180, retrace to 130.
   *
   * The retracement stops ABOVE the broken 120 on purpose — dipping back under
   * it would reclaim the break, and the module would rightly report no live
   * structure and no fib.
   */
  const impulse = legs([100, 120, 60, 180, 130]);

  function fibOf(bars: DailyBars) {
    const swings = findSwings(bars);
    const brk = readStructure(bars, swings).latest;
    return brk ? fibRetracement(bars, brk, swings) : null;
  }

  it('prices 0.618 off the impulse and locates price within the leg', () => {
    const fib = fibOf(impulse)!;
    expect(fib).not.toBeNull();

    const height = fib.high - fib.low;
    const golden = fib.levels.find((l) => l.ratio === 0.618)!;

    expect(golden.price).toBeCloseTo(fib.high - 0.618 * height, 8);
    expect(fib.positionRatio).toBeCloseTo((fib.high - 130) / height, 6);
  });

  it('anchors to the LAST swing low before the break, not the first', () => {
    /**
     * The anchoring bug that stays entirely plausible on screen. In
     * L1 -> H1 -> L2 -> break above H1, the impulse that did the breaking
     * started at L2. Taking L1 stretches the leg across the whole prior swing
     * and puts the 61.8% far below anything the market will respect.
     */
    const fib = fibOf(legs([100, 5, 130, 80, 180]))!;

    expect(fib).not.toBeNull();
    expect(fib.low).toBeGreaterThan(50); // near L2 at 80, nowhere near L1 at 5
  });

  it('tracks the running extreme so the leg follows an extending impulse', () => {
    const shorter = fibOf(legs([100, 120, 60, 180]))!;
    const extended = fibOf(legs([100, 120, 60, 180, 170, 240]))!;

    expect(extended.high).toBeGreaterThan(shorter.high);
  });

  it('never returns a leg shorter than the minimum, whatever the fixture', () => {
    const fib = fibOf(impulse)!;
    const range = atr(impulse)!;
    expect((fib.high - fib.low) / range).toBeGreaterThanOrEqual(MIN_LEG_ATR);
  });

  it('marks a fully reversed impulse invalidated instead of hiding it', () => {
    /**
     * Retraced past its own origin. The levels are history, but the trader
     * needs to see the move FAILED — returning null would read as "no impulse
     * found", which is a different and wrong statement.
     */
    const bars = legs([100, 120, 60, 150, 55]);
    const swings = findSwings(bars);
    const bullish = readStructure(bars, swings).breaks.find((b) => b.direction === 'bullish')!;

    const fib = fibRetracement(bars, bullish, swings)!;

    expect(fib.positionRatio).toBeGreaterThan(1);
    expect(fib.invalidated).toBe(true);
    expect(fib.inGoldenZone).toBe(false);
  });

  it('flags an unconfirmed extreme, whose levels are still moving', () => {
    // The series ends at its high, so the anchor is not yet a confirmed swing.
    const fib = fibOf(legs([100, 120, 60, 180]))!;
    expect(fib.legComplete).toBe(false);
  });
});

describe('confluence', () => {
  const price = 100;
  const range = 10; // tolerance = 3.5

  const at = (kind: LevelSource['kind'], p: number): LevelSource => ({
    kind,
    label: kind,
    price: p,
  });

  it('does NOT chain three levels spanning two tolerances', () => {
    /**
     * The failure a running-mean merge produces: A near B, B near C, so A and C
     * merge despite sitting 2x tolerance apart. The result is a "zone" too wide
     * to place an order in, carrying a source count the user can see is wrong.
     */
    const tolerance = range * CONFLUENCE_ATR;
    const zones = confluence(
      [at('sma', 100), at('swing', 100 + tolerance * 0.95), at('round', 100 + tolerance * 1.9)],
      price,
      range,
    );

    expect(zones.length).toBeGreaterThan(1);
    for (const z of zones) expect(z.high - z.low).toBeLessThanOrEqual(tolerance + 1e-9);
  });

  it('counts two fib levels from one leg as a single source', () => {
    // Both ratios come from one pair of anchors — arithmetic, not agreement.
    const zones = confluence([at('fib', 100), at('fib', 101), at('sma', 100.5)], price, range);
    const zone = zones[0];

    expect(zone.sources.filter((s) => s.kind === 'fib')).toHaveLength(1);
    expect(zone.sources).toHaveLength(2);
  });

  it('is independent of the order candidates arrive in', () => {
    const input = [at('sma', 97), at('bos', 100), at('fib', 100.5), at('round', 110)];
    const forward = confluence(input, price, range);
    const reversed = confluence([...input].reverse(), price, range);

    expect(reversed.map((z) => z.price)).toEqual(forward.map((z) => z.price));
  });

  it('labels sides and sorts nearest first', () => {
    const zones = confluence([at('sma', 80), at('swing', 98), at('round', 130)], price, range);

    expect(zones[0].distanceAtr).toBeLessThanOrEqual(zones[1].distanceAtr);
    expect(zones.find((z) => z.price === 98)!.side).toBe('support');
    expect(zones.find((z) => z.price === 130)!.side).toBe('resistance');
  });

  it('returns nothing when there is no volatility to measure against', () => {
    expect(confluence([at('sma', 100)], price, 0)).toEqual([]);
  });
});

describe('roundNumbers', () => {
  it('spaces the grid so a round number can never be free confluence', () => {
    /**
     * The invariant: half a step must exceed the merge tolerance, or a round
     * number sits within tolerance of any price at all and every zone silently
     * gains a source.
     */
    for (const [price, range] of [
      [1.15, 0.006],
      [150, 0.8],
      [4400, 45],
      [0.65, 0.004],
    ] as const) {
      const levels = roundNumbers(price, range);
      const step = Math.abs(levels[1] - levels[0]);
      expect(step / 2).toBeGreaterThan(range * CONFLUENCE_ATR);
    }
  });

  it('returns nothing without a volatility estimate', () => {
    expect(roundNumbers(100, 0)).toEqual([]);
  });
});

describe('analyseStructure', () => {
  const impulse = legs([100, 120, 60, 180, 130]);

  it('returns null rather than a report of NaNs on a flat series', () => {
    expect(analyseStructure(make(base(120, 100, 0)))).toBeNull();
  });

  it('returns null below the minimum bar count', () => {
    expect(analyseStructure(make(base(30)))).toBeNull();
  });

  it('uses the SMAs it is given verbatim, never recomputing them', () => {
    /**
     * On a 4H report the SMAs passed in are the DAILY ones, which is what the
     * trader has on screen. Recomputing them from the bars would relabel a
     * 33-day average as "the 200" — the same name over a different price.
     */
    // Parked beside the broken level, which always survives both filters. A
    // lone distant SMA is correctly dropped, and that would hide what this
    // test is actually checking.
    const view = analyseStructure(impulse, { 50: 120.2 })!;
    const sma = view.zones.flatMap((z) => z.sources).find((s) => s.kind === 'sma');

    expect(sma?.price).toBe(120.2);
  });

  it('keeps the broken level even when nothing else agrees with it', () => {
    const view = analyseStructure(impulse)!;
    const bos = view.zones.find((z) => z.sources.some((s) => s.kind === 'bos'));

    expect(bos).toBeDefined();
    expect(MIN_CONFLUENCE_SOURCES).toBeGreaterThan(1);
  });

  it('drops lone levels that are not the broken one', () => {
    const view = analyseStructure(impulse)!;
    for (const z of view.zones) {
      if (z.sources.some((s) => s.kind === 'bos')) continue;
      expect(z.sources.length).toBeGreaterThanOrEqual(MIN_CONFLUENCE_SOURCES);
    }
  });

  it('reports the unconfirmed tail so the UI can say the last turn is provisional', () => {
    expect(analyseStructure(impulse)!.unconfirmedBars).toBe(SWING_LOOKBACK);
  });
});
