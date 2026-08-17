/**
 * Backtest harness.
 *
 * The tests that matter here are the look-ahead ones. A backtest that peeks
 * produces beautiful numbers and is worse than having none, because it argues
 * for trading something that never worked. `resolveSeries` deliberately does not
 * filter future events — correct live, fatal in a replay — so the harness must,
 * and these pin that it does.
 */

import { describe, expect, it } from 'vitest';
import {
  asOf, byScore, independentWindows, runBacktest, spreadByDate, summarise, technicalsAsOf,
} from '@/lib/scoring/backtest';
import type { Observation } from '@/lib/scoring/backtest';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';
import type { NormalizedEvent } from '@/lib/types';

function makeEvent(dateUtc: string, name = 'Consumer Price Index (YoY)'): NormalizedEvent {
  return {
    id: dateUtc + name,
    seriesId: null,
    name,
    currency: 'USD',
    countryCode: 'US',
    dateUtc,
    impact: 'HIGH',
    actual: 3.5,
    consensus: 3.0,
    previous: 3.0,
    revised: null,
    unit: '%',
    ratioDeviation: 1,
    isBetterThanExpected: true,
    isSpeech: false,
    isPreliminary: false,
    source: 'fxstreet',
    actualSource: 'fxstreet',
    sourceUrl: null,
    lastUpdated: null,
  } as NormalizedEvent;
}

function makeCot(dates: string[]): Map<string, CotSeries> {
  const report = (reportDate: string): CotReport => ({
    contract: 'GOLD', reportDate,
    specLong: 60_000, specShort: 40_000, specNet: 20_000, specLongPct: 60,
    commLong: 0, commShort: 0, commNet: 0,
    retailLong: 5_000, retailShort: 5_000, retailNet: 0, retailLongPct: 50,
    openInterest: 100_000, openInterestChange: 0,
    specNetChange: 0, specLongChange: 0, specShortChange: 0, specLongPctChange: 0,
  });
  return new Map([['GOLD', { contract: 'GOLD', reports: dates.map(report) }]]);
}

// These tests only exercise close-derived maths, so the other three legs are
// pinned to the close. That is a fixture convenience, not a real bar shape.
const bars = (n: number, start = 100) => {
  const closes = Array.from({ length: n }, (_, i) => start + i);
  return {
    timestamps: Array.from(
      { length: n },
      (_, i) => Math.floor(Date.UTC(2026, 0, 1) / 1000) + i * 86_400,
    ),
    opens: [...closes],
    highs: [...closes],
    lows: [...closes],
    closes,
  };
};

describe('asOf — the look-ahead guard', () => {
  const input = {
    events: [makeEvent('2026-01-10T00:00:00.000Z'), makeEvent('2026-06-10T00:00:00.000Z')],
    cot: makeCot(['2026-01-06', '2026-06-02']),
    bars: new Map(),
    seasonality: new Map(),
  };

  it('drops calendar events dated after the replay date', () => {
    /**
     * The specific hazard: every past event in our feed carries a populated
     * actual, so without this filter a replay of January would score against
     * June's CPI print.
     */
    const { events } = asOf(input, new Date('2026-03-01T00:00:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events[0].dateUtc).toBe('2026-01-10T00:00:00.000Z');
  });

  it('drops COT reports surveyed after the replay date', () => {
    const { cot } = asOf(input, new Date('2026-03-01T00:00:00.000Z'));
    expect(cot.get('GOLD')!.reports.map((r) => r.reportDate)).toEqual(['2026-01-06']);
  });

  it('drops a contract entirely when nothing had been published yet', () => {
    const { cot } = asOf(input, new Date('2026-01-01T00:00:00.000Z'));
    expect(cot.has('GOLD')).toBe(false);
  });

  it('keeps everything when the replay date is now', () => {
    const { events, cot } = asOf(input, new Date('2026-08-01T00:00:00.000Z'));
    expect(events).toHaveLength(2);
    expect(cot.get('GOLD')!.reports).toHaveLength(2);
  });
});

describe('technicalsAsOf', () => {
  it('computes the averages from bars up to that index only', () => {
    // Closes 100..129. At index 20 the 3-day average covers 118,119,120.
    const t = technicalsAsOf('TEST', bars(30), 20, {});
    expect(t.price).toBe(120);
    expect(t.smaFast).toBeCloseTo((118 + 119 + 120) / 3, 6);
  });

  it('does NOT leak later bars into the average', () => {
    // The same index over a longer series must give an identical answer.
    const short = technicalsAsOf('TEST', bars(30), 20, {});
    const long = technicalsAsOf('TEST', bars(400), 20, {});
    expect(long.smaFast).toBe(short.smaFast);
    expect(long.smaSlow).toBe(short.smaSlow);
    expect(long.price).toBe(short.price);
  });

  it('leaves the long averages null rather than borrowing today values', () => {
    // They are context on the live card and feed no cell. Populating them from
    // the present would be look-ahead for no gain.
    const t = technicalsAsOf('TEST', bars(400), 300, {});
    expect(t.sma200).toBeNull();
    expect(t.realizedVolPct).toBeNull();
  });

  it('returns a null slow average before there is enough history', () => {
    expect(technicalsAsOf('TEST', bars(30), 2, {}).smaSlow).toBeNull();
  });
});

describe('runBacktest', () => {
  it('produces no observations without a reference symbol', () => {
    expect(runBacktest({ events: [], cot: new Map(), bars: new Map(), seasonality: new Map() })).toEqual([]);
  });

  it('measures forward returns from the observation bar', () => {
    // Closes rise by exactly 1 a day from 100, so a 5-day return at close 120
    // is 5/120.
    const input = {
      events: [],
      cot: new Map(),
      bars: new Map([['EURUSD', bars(80)]]),
      seasonality: new Map(),
      horizons: [5],
    };
    const obs = runBacktest(input, 'EURUSD');
    expect(obs.length).toBeGreaterThan(0);

    const first = obs[0];
    const close = 100 + Number(first.dateUtc.slice(8, 10)) - 1; // day-of-month -> index
    expect(first.forward[5]).toBeCloseTo((5 / close) * 100, 4);
  });

  it('stops before the end so every observation can be measured', () => {
    const input = {
      events: [], cot: new Map(),
      bars: new Map([['EURUSD', bars(60)]]),
      seasonality: new Map(),
      horizons: [20],
    };
    for (const o of runBacktest(input, 'EURUSD')) expect(o.forward[20]).not.toBeNull();
  });
});

describe('summarise', () => {
  const obs = (bias: Observation['bias'], score: number, ret: number): Observation => ({
    symbol: 'X', dateUtc: '2026-01-01T00:00:00.000Z', score, bias, forward: { 5: ret },
  });

  it('reports a baseline alongside the buckets', () => {
    /**
     * The number that stops the whole exercise lying. If every symbol rose,
     * Very Bullish shows a positive mean without having predicted anything —
     * only the gap to the baseline is evidence.
     */
    const [r] = summarise(
      [obs('Very Bullish', 9, 2), obs('Bearish', -5, 1), obs('Neutral', 0, 1)],
      [5],
    );
    expect(r.baseline.n).toBe(3);
    expect(r.baseline.meanPct).toBeCloseTo(4 / 3, 6);
  });

  it('scores a hit by whether the move matched the bias direction', () => {
    const [r] = summarise([obs('Bearish', -5, -1), obs('Bearish', -5, 2)], [5]);
    const bearish = r.buckets.find((b) => b.bias === 'Bearish')!;
    expect(bearish.n).toBe(2);
    expect(bearish.hitRatePct).toBe(50); // one down, one up
  });

  it('gives Neutral no hit rate, because it called no direction', () => {
    const [r] = summarise([obs('Neutral', 1, 3)], [5]);
    expect(r.buckets.find((b) => b.bias === 'Neutral')!.hitRatePct).toBeNull();
  });

  it('reports every band even when empty, so gaps are visible', () => {
    const [r] = summarise([obs('Bullish', 5, 1)], [5]);
    expect(r.buckets).toHaveLength(5);
    expect(r.buckets.find((b) => b.bias === 'Very Bearish')!.n).toBe(0);
  });
});

describe('byScore', () => {
  it('groups by exact score so mislabelled bands are detectable', () => {
    // A real edge can hide behind wrong thresholds: if +4 and +9 behave the
    // same, the cuts are wrong rather than the score.
    const rows = byScore(
      [
        { symbol: 'X', dateUtc: '', score: 9, bias: 'Very Bullish', forward: { 5: 2 } },
        { symbol: 'Y', dateUtc: '', score: 9, bias: 'Very Bullish', forward: { 5: 4 } },
        { symbol: 'Z', dateUtc: '', score: 4, bias: 'Bullish', forward: { 5: 1 } },
      ],
      5,
    );
    expect(rows).toEqual([
      { score: 4, n: 1, meanPct: 1 },
      { score: 9, n: 2, meanPct: 3 },
    ]);
  });
});

describe('spreadByDate and independentWindows — the honesty correction', () => {
  const at = (date: string, bias: Observation['bias'], ret: number): Observation => ({
    symbol: 'X', dateUtc: `${date}T00:00:00.000Z`, score: 0, bias, forward: { 5: ret },
  });

  it('collapses a date to one bullish-minus-bearish spread', () => {
    /**
     * Without this, one dollar move on one day writes itself into dozens of
     * correlated rows and inflates the apparent sample by an order of magnitude.
     */
    const rows = spreadByDate(
      [
        at('2026-01-01', 'Bullish', 2), at('2026-01-01', 'Very Bullish', 4),
        at('2026-01-01', 'Bearish', -1), at('2026-01-01', 'Very Bearish', -3),
      ],
      5,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].bullish).toBe(3);
    expect(rows[0].bearish).toBe(-2);
    expect(rows[0].spread).toBe(5);
  });

  it('leaves the spread null when a date has only one side', () => {
    const [row] = spreadByDate([at('2026-01-01', 'Bullish', 2)], 5);
    expect(row.bearish).toBeNull();
    expect(row.spread).toBeNull();
  });

  it('samples a full horizon apart so forward windows never overlap', () => {
    // 20 consecutive dates at a 5-day horizon leaves 4 usable windows, not 20 —
    // consecutive dates share almost all of their forward return.
    const obs = Array.from({ length: 20 }, (_, i) => {
      const d = `2026-01-${String(i + 1).padStart(2, '0')}`;
      return [at(d, 'Bullish', 1), at(d, 'Bearish', -1)];
    }).flat();

    const all = spreadByDate(obs, 5);
    expect(all).toHaveLength(20);
    expect(independentWindows(all, 5)).toHaveLength(4);
  });

  it('drops dates with no measurable spread from the independent set', () => {
    const obs = [at('2026-01-01', 'Bullish', 1), at('2026-01-02', 'Bullish', 1)];
    expect(independentWindows(spreadByDate(obs, 5), 1)).toHaveLength(0);
  });
});
