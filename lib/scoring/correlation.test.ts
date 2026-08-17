/**
 * Setup clustering.
 *
 * The hazard this guards against is structural: correlated symbols score alike
 * because they share a currency leg, so the ranking pushes one dollar trade to
 * the top four times over. The tests below pin the two things that make the
 * clustering trustworthy — timestamp joining, and sign awareness.
 */

import { describe, expect, it } from 'vitest';
import { CLUSTER_THRESHOLD, clusterSetups, correlation, toReturns } from '@/lib/scoring/correlation';
import type { DailyBars } from '@/lib/connectors/technicals';
import type { SymbolRow } from '@/lib/scoring/setups';

const DAY = 86_400;
const T0 = Math.floor(Date.UTC(2026, 0, 1) / 1000);

/**
 * Bars from a list of daily percent moves.
 *
 * Clustering reads closes only, so open/high/low are pinned to the close here.
 * A fixture convenience — real bars have a range.
 */
function barsFrom(moves: number[], startTs = T0, step = DAY): DailyBars {
  const closes = [100];
  for (const m of moves) closes.push(closes[closes.length - 1] * (1 + m / 100));
  return {
    timestamps: closes.map((_, i) => startTs + i * step),
    opens: [...closes],
    highs: [...closes],
    lows: [...closes],
    closes,
  };
}

/** A deterministic pseudo-random walk, so tests do not depend on Math.random. */
function walk(n: number, seed = 1): number[] {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out.push((x / 2147483648 - 0.5) * 2);
  }
  return out;
}

function row(symbol: string, totalScore: number): SymbolRow {
  return {
    symbol,
    label: symbol,
    kind: 'fx',
    totalScore,
    bias: totalScore >= 4 ? 'Bullish' : totalScore <= -4 ? 'Bearish' : 'Neutral',
    categoryScores: { technical: 0, sentiment: 0, growth: 0, inflation: 0, jobs: 0 },
    cells: {},
    populated: 18,
    partial: 0,
    price: 1,
    changePct: 0,
  };
}

describe('correlation', () => {
  it('is 1 for a series against itself', () => {
    const r = toReturns(barsFrom(walk(80)));
    expect(correlation(r, r)).toBeCloseTo(1, 6);
  });

  it('is -1 for an exactly inverted series', () => {
    const moves = walk(80);
    const a = toReturns(barsFrom(moves));
    const b = toReturns(barsFrom(moves.map((m) => -m)));
    expect(correlation(a, b)!).toBeLessThan(-0.99);
  });

  it('JOINS ON TIMESTAMP rather than by index', () => {
    /**
     * FX trades days the metals do not. Lining the arrays up positionally would
     * compare Tuesday's gold with Wednesday's euro and report a correlation that
     * is pure artefact — and it would look plausible, which is worse.
     */
    const moves = walk(80);
    const a = toReturns(barsFrom(moves));

    // Same moves, but every bar shifted a day later: no timestamps in common.
    const shifted = toReturns(barsFrom(moves, T0 + DAY / 2));
    expect(correlation(a, shifted)).toBeNull();
  });

  it('returns null rather than a number when the overlap is too thin', () => {
    const a = toReturns(barsFrom(walk(80)));
    const b = toReturns(barsFrom(walk(10, 7)));
    expect(correlation(a, b)).toBeNull();
  });

  it('returns null for a flat series, which has no variance to correlate', () => {
    const flat = toReturns(barsFrom(new Array(80).fill(0)));
    expect(correlation(flat, flat)).toBeNull();
  });
});

describe('clusterSetups', () => {
  const moves = walk(120);
  const bars = new Map<string, DailyBars>([
    ['EURUSD', barsFrom(moves)],
    ['GBPUSD', barsFrom(moves.map((m) => m * 0.95 + 0.01))], // nearly identical
    ['USDJPY', barsFrom(moves.map((m) => -m))], // the mirror image
    ['XAUUSD', barsFrom(walk(120, 99))], // unrelated
  ]);

  it('groups symbols that move together and are called the same way', () => {
    const clusters = clusterSetups([row('EURUSD', 9), row('GBPUSD', 7)], bars);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.symbol).sort()).toEqual(['EURUSD', 'GBPUSD']);
    expect(clusters[0].combinedScore).toBe(16);
  });

  it('groups an INVERSE pair when the calls are also inverse', () => {
    // Long EURUSD and short USDJPY move together in dollar terms. One trade.
    const clusters = clusterSetups([row('EURUSD', 9), row('USDJPY', -8)], bars);
    expect(clusters).toHaveLength(1);
    // Each member keeps its OWN side — calling the whole group "long" would
    // claim USDJPY is a long, which is false.
    expect(clusters[0].mixedSides).toBe(true);
    expect(clusters[0].members.map((m) => m.direction).sort()).toEqual(['long', 'short']);
    expect(clusters[0].members.map((m) => m.symbol).sort()).toEqual(['EURUSD', 'USDJPY']);
  });

  it('does NOT group an inverse pair called the same way — that is a hedge', () => {
    /**
     * The sign check earning its place. EURUSD and USDJPY correlate strongly
     * negatively, so calling both LONG is two opposing positions, not one
     * doubled. Grouping on raw correlation would report a concentration that is
     * actually a hedge.
     */
    const clusters = clusterSetups([row('EURUSD', 9), row('USDJPY', 8)], bars);
    expect(clusters).toHaveLength(2);
  });

  it('leaves an uncorrelated symbol in its own cluster', () => {
    const clusters = clusterSetups([row('EURUSD', 9), row('XAUUSD', 8)], bars);
    expect(clusters).toHaveLength(2);
  });

  it('ignores neutral rows, which are not positions', () => {
    expect(clusterSetups([row('EURUSD', 1), row('GBPUSD', 0)], bars)).toEqual([]);
  });

  it('names each cluster after its highest-conviction member', () => {
    const clusters = clusterSetups([row('GBPUSD', 5), row('EURUSD', 11)], bars);
    expect(clusters[0].lead).toBe('EURUSD');
    expect(clusters[0].direction).toBe('long');
  });

  it('keeps a symbol with no price history out entirely', () => {
    // No bars means no correlation, and guessing would be worse than omitting.
    const clusters = clusterSetups([row('EURUSD', 9), row('MYSTERY', 9)], bars);
    expect(clusters.flatMap((c) => c.members.map((m) => m.symbol))).not.toContain('MYSTERY');
  });

  it('uses a threshold that separates a dollar bloc from an unrelated market', () => {
    expect(CLUSTER_THRESHOLD).toBeGreaterThan(0.5);
    expect(CLUSTER_THRESHOLD).toBeLessThan(0.9);
  });
});
