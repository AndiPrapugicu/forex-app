/**
 * Score history and trade-idea levels.
 *
 * The snapshot rules exist to stop the history chart telling comfortable lies:
 * an outage must not render as a flat neutral line, and a double cron run must
 * not render as a spike.
 */

import { describe, expect, it } from 'vitest';
import {
  buildChangeLog,
  buildSnapshots,
  diffSnapshots,
  latestPerSymbol,
  truncateToMinute,
} from '@/lib/scoring/history';
import { buildTradeIdea, MIN_ABS_SCORE, REWARD_RISK } from '@/lib/scoring/trade-ideas';
import type { MatrixCell, SetupsMatrix, SymbolRow } from '@/lib/scoring/setups';
import type { Technicals } from '@/lib/connectors/technicals';
import type { ScoreSnapshot } from '@/lib/types';

function makeRow(overrides: Partial<SymbolRow> = {}): SymbolRow {
  return {
    symbol: 'EURUSD',
    label: 'EUR/USD',
    kind: 'fx',
    base: 'EUR',
    quote: 'USD',
    totalScore: 6,
    bias: 'Bullish',
    categoryScores: { technical: 2, sentiment: 1, growth: 1, inflation: 1, jobs: 1 },
    cells: { trend: { slotKey: 'trend', cell: 2, status: 'scored', explanation: '' } },
    populated: 5,
    partial: 0,
    price: 1.16,
    changePct: 0.1,
    ...overrides,
  };
}

function makeMatrix(rows: SymbolRow[], generatedAtUtc = '2026-08-09T12:34:56.789Z'): SetupsMatrix {
  return { rows, cotReportDate: '2026-08-04', generatedAtUtc };
}

function makeTech(overrides: Partial<Technicals> = {}): Technicals {
  return {
    symbol: 'EURUSD',
    price: 1.16,
    smaFast: 1.16,
    smaSlow: 1.15,
    smaSlowPrior: 1.14,
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
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<ScoreSnapshot> = {}): ScoreSnapshot {
  return {
    symbol: 'EURUSD',
    capturedAtUtc: '2026-08-01T00:00:00.000Z',
    totalScore: 3,
    bias: 'Neutral',
    populated: 13,
    categoryScores: {},
    price: 1.16,
    cells: {},
    ...overrides,
  };
}

describe('truncateToMinute', () => {
  it('drops seconds so a double cron run cannot write two rows', () => {
    // The primary key is (symbol, captured_at). Sub-minute jitter between two
    // overlapping runs would otherwise show as a spike on the chart.
    expect(truncateToMinute('2026-08-09T12:34:56.789Z')).toBe('2026-08-09T12:34:00.000Z');
    expect(truncateToMinute('2026-08-09T12:34:02.000Z')).toBe('2026-08-09T12:34:00.000Z');
  });
});

describe('buildSnapshots', () => {
  it('captures one row per symbol with its subtotals and cells', () => {
    const snapshots = buildSnapshots(makeMatrix([makeRow()]));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      symbol: 'EURUSD',
      totalScore: 6,
      bias: 'Bullish',
      price: 1.16,
      capturedAtUtc: '2026-08-09T12:34:00.000Z',
    });
    // Cells flatten to their values, so a past card can be rebuilt.
    expect(snapshots[0].cells.trend).toBe(2);
  });

  it('SKIPS rows where nothing scored, rather than recording a fake neutral', () => {
    /**
     * The important one. During a total outage every row scores 0 and reads
     * "Neutral". Persisting that draws a flat line through the history chart
     * that is indistinguishable from the market having no view.
     */
    const dead = makeRow({ symbol: 'GBPUSD', totalScore: 0, bias: 'Neutral', populated: 0 });
    const alive = makeRow();

    const snapshots = buildSnapshots(makeMatrix([dead, alive]));

    expect(snapshots.map((s) => s.symbol)).toEqual(['EURUSD']);
  });

  it('stamps every row in a run with the same timestamp', () => {
    const snapshots = buildSnapshots(
      makeMatrix([makeRow(), makeRow({ symbol: 'GBPUSD' }), makeRow({ symbol: 'USDJPY' })]),
    );
    expect(new Set(snapshots.map((s) => s.capturedAtUtc)).size).toBe(1);
  });
});

describe('diffSnapshots', () => {
  it('reports the move across the window', () => {
    const diff = diffSnapshots([
      makeSnapshot({ totalScore: 2, bias: 'Neutral' }),
      makeSnapshot({ capturedAtUtc: '2026-08-05T00:00:00.000Z', totalScore: 8, bias: 'Very Bullish' }),
    ])!;

    expect(diff.delta).toBe(6);
    expect(diff.toBias).toBe('Very Bullish');
  });

  it('flags a genuine sign flip', () => {
    const diff = diffSnapshots([
      makeSnapshot({ totalScore: 5, bias: 'Bullish' }),
      makeSnapshot({ capturedAtUtc: '2026-08-05T00:00:00.000Z', totalScore: -4, bias: 'Bearish' }),
    ])!;
    expect(diff.flipped).toBe(true);
  });

  it('does not call a drift to zero a flip', () => {
    // Zero is not a side. Alerting on 5 -> 0 as a reversal would fire constantly.
    const diff = diffSnapshots([
      makeSnapshot({ totalScore: 5 }),
      makeSnapshot({ capturedAtUtc: '2026-08-05T00:00:00.000Z', totalScore: 0 }),
    ])!;
    expect(diff.flipped).toBe(false);
  });

  it('returns null without at least two points to compare', () => {
    expect(diffSnapshots([])).toBeNull();
    expect(diffSnapshots([makeSnapshot()])).toBeNull();
  });
});

describe('buildTradeIdea', () => {
  it('sizes long levels from the average daily move', () => {
    const idea = buildTradeIdea(makeRow({ totalScore: 8, price: 1.2 }), makeTech({ avgDailyMove90Pct: 0.5 }))!;

    // 0.5% of 1.2 = 0.006 per day. Stop 1.5x = 0.009, target 2:1 = 0.018.
    expect(idea.direction).toBe('long');
    expect(idea.stop).toBeCloseTo(1.191, 4);
    expect(idea.target).toBeCloseTo(1.218, 4);
    expect(idea.entryMin).toBeLessThan(idea.price);
    expect(idea.entryMax).toBeGreaterThan(idea.price);
  });

  it('mirrors the levels for a short', () => {
    const idea = buildTradeIdea(makeRow({ totalScore: -8, bias: 'Very Bearish', price: 1.2 }), makeTech({ avgDailyMove90Pct: 0.5 }))!;

    expect(idea.direction).toBe('short');
    expect(idea.stop).toBeGreaterThan(idea.price);
    expect(idea.target).toBeLessThan(idea.price);
  });

  it('keeps the reward-to-risk it advertises', () => {
    const idea = buildTradeIdea(makeRow({ totalScore: 8, price: 1.2 }), makeTech())!;
    const risk = Math.abs(idea.price - idea.stop);
    const reward = Math.abs(idea.target - idea.price);
    expect(reward / risk).toBeCloseTo(REWARD_RISK, 5);
  });

  it('refuses to invent a setup for a neutral score', () => {
    // The single most misleading thing this module could do.
    for (const score of [0, 1, 3, -3]) {
      expect(buildTradeIdea(makeRow({ totalScore: score }), makeTech())).toBeNull();
    }
    expect(MIN_ABS_SCORE).toBe(4);
  });

  it('refuses to size levels without a volatility estimate', () => {
    const noVol = makeTech({ avgDailyMove90Pct: null, avgDailyMove7Pct: null });
    expect(buildTradeIdea(makeRow({ totalScore: 8 }), noVol)).toBeNull();
  });

  it('falls back to the 7-day move when the 90-day is unavailable', () => {
    const short = makeTech({ avgDailyMove90Pct: null, avgDailyMove7Pct: 0.5 });
    expect(buildTradeIdea(makeRow({ totalScore: 8 }), short)!.dailyMovePct).toBe(0.5);
  });

  it('returns null without a price to anchor to', () => {
    expect(buildTradeIdea(makeRow({ totalScore: 8, price: null }), undefined)).toBeNull();
  });

  it('says out loud that the levels are volatility arithmetic', () => {
    const idea = buildTradeIdea(makeRow({ totalScore: 8 }), makeTech())!;
    expect(idea.explanation).toMatch(/no support, liquidity or calendar awareness/i);
  });
});

/**
 * The change log.
 *
 * The bug it explains: "we had 20 bullish and from time to time it appeared
 * that it's 19, and no news occurred." Two runs producing different totals is
 * not the defect — a run that cannot say WHY is. So these tests are all about
 * whether the reason survives.
 */
describe('buildChangeLog', () => {
  const NOW = '2026-08-11T12:00:00.000Z';
  const BEFORE = '2026-08-11T11:50:00.000Z';

  function cell(cell: number | null, extra: Partial<MatrixCell> = {}): MatrixCell {
    return { slotKey: 'cot', cell, status: 'scored', explanation: '', ...extra };
  }

  function prior(overrides: Partial<ScoreSnapshot> = {}): Map<string, ScoreSnapshot> {
    const snapshot = makeSnapshot({
      symbol: 'GBPCAD',
      capturedAtUtc: BEFORE,
      totalScore: 5,
      bias: 'Bullish',
      cells: { cot: 1, trend: 2 },
      partialLegs: {},
      ...overrides,
    });
    return new Map([[snapshot.symbol, snapshot]]);
  }

  /** The exact scenario from the plan: a COT contract fails and takes a point. */
  it('names the leg that went missing rather than reporting a silent 5 -> 4', () => {
    const row = makeRow({
      symbol: 'GBPCAD',
      totalScore: 4,
      bias: 'Bullish',
      cells: {
        cot: cell(0, { status: 'partial', missingLeg: 'GBP' }),
        trend: cell(2, { slotKey: 'trend' }),
      },
    });

    const [change] = buildChangeLog([row], prior());

    expect(change.symbol).toBe('GBPCAD');
    expect(change.from).toBe(5);
    expect(change.to).toBe(4);
    expect(change.cause).toBe('cot lost its GBP leg');
    expect(change.cells[0]).toMatchObject({ slotKey: 'cot', from: 1, to: 0, missingLeg: 'GBP' });
  });

  /**
   * A cell that was ALREADY one-legged last run has not just broken. Reporting
   * it every ten minutes would turn a standing condition into permanent alarm,
   * which is how a warning stops being read.
   */
  it('does not re-report a leg that was already missing last run', () => {
    const row = makeRow({
      symbol: 'GBPCAD',
      totalScore: 4,
      cells: { cot: cell(0, { status: 'partial', missingLeg: 'GBP' }) },
    });

    const [change] = buildChangeLog([row], prior({ cells: { cot: 1 }, partialLegs: { cot: 'GBP' } }));
    expect(change.cause).toBeNull();
  });

  it('reports a cell that lost its data entirely', () => {
    const row = makeRow({
      symbol: 'GBPCAD',
      totalScore: 4,
      cells: { cot: cell(null, { status: 'no-data' }), trend: cell(2, { slotKey: 'trend' }) },
    });

    const [change] = buildChangeLog([row], prior());
    expect(change.cause).toBe('cot lost its data');
    expect(change.cells[0].wentDark).toBe(true);
  });

  /**
   * The reassuring case, and the one that makes the log worth reading at all: if
   * every move is genuine the cause is null, and the UI says the cell moved
   * rather than inventing a failure.
   */
  it('leaves the cause null when the data simply changed', () => {
    const row = makeRow({
      symbol: 'GBPCAD',
      totalScore: 6,
      cells: { cot: cell(2), trend: cell(2, { slotKey: 'trend' }) },
    });

    const [change] = buildChangeLog([row], prior());
    expect(change.cause).toBeNull();
    expect(change.cells).toHaveLength(1);
    expect(change.cells[0]).toMatchObject({ slotKey: 'cot', from: 1, to: 2 });
  });

  it('omits rows that did not move', () => {
    const row = makeRow({
      symbol: 'GBPCAD',
      totalScore: 5,
      cells: { cot: cell(1), trend: cell(2, { slotKey: 'trend' }) },
    });

    expect(buildChangeLog([row], prior())).toHaveLength(0);
  });

  it('omits a symbol with no prior snapshot rather than reporting a move from zero', () => {
    const row = makeRow({ symbol: 'NEWSYM', totalScore: 7 });
    expect(buildChangeLog([row], prior())).toHaveLength(0);
  });

  it('puts bias changes above larger moves that stayed inside a band', () => {
    const drifted = makeRow({ symbol: 'GBPCAD', totalScore: 9, bias: 'Very Bullish' });
    const flipped = makeRow({ symbol: 'EURUSD', totalScore: 3, bias: 'Neutral' });

    const previous = new Map([
      [
        'GBPCAD',
        makeSnapshot({ symbol: 'GBPCAD', capturedAtUtc: BEFORE, totalScore: 4, bias: 'Very Bullish' }),
      ],
      [
        'EURUSD',
        makeSnapshot({ symbol: 'EURUSD', capturedAtUtc: BEFORE, totalScore: 4, bias: 'Bullish' }),
      ],
    ]);

    const log = buildChangeLog([drifted, flipped], previous);
    // GBPCAD moved by 5 and EURUSD by 1, but only EURUSD changed what it says.
    expect(log[0].symbol).toBe('EURUSD');
    expect(log[0].biasChanged).toBe(true);
  });

  describe('latestPerSymbol', () => {
    it('takes the newest snapshot strictly before the cut-off', () => {
      const snapshots = [
        makeSnapshot({ symbol: 'EURUSD', capturedAtUtc: '2026-08-11T11:40:00.000Z', totalScore: 1 }),
        makeSnapshot({ symbol: 'EURUSD', capturedAtUtc: BEFORE, totalScore: 2 }),
        // This run's own write, which must never be compared against itself.
        makeSnapshot({ symbol: 'EURUSD', capturedAtUtc: NOW, totalScore: 3 }),
      ];

      const latest = latestPerSymbol(snapshots, NOW);
      expect(latest.get('EURUSD')?.totalScore).toBe(2);
    });

    it('keeps symbols separate', () => {
      const snapshots = [
        makeSnapshot({ symbol: 'EURUSD', capturedAtUtc: BEFORE, totalScore: 2 }),
        makeSnapshot({ symbol: 'GBPUSD', capturedAtUtc: BEFORE, totalScore: 7 }),
      ];

      const latest = latestPerSymbol(snapshots, NOW);
      expect(latest.size).toBe(2);
      expect(latest.get('GBPUSD')?.totalScore).toBe(7);
    });
  });
});
