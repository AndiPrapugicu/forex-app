import { describe, expect, it } from 'vitest';
import type { ChainSummary } from '@/lib/connectors/yahoo-options';
import type { OptionsSnapshot } from '@/lib/types';
import { putCallSeries, readPutCall, shouldCaptureOptions } from './options';

const snap = (date: string, put: number, call: number): OptionsSnapshot => ({
  symbol: 'GOLD',
  date,
  callVolume: call,
  putVolume: put,
  callOpenInterest: 0,
  putOpenInterest: 0,
});

describe('putCallSeries', () => {
  const history = [
    snap('2026-09-07', 100, 100),
    snap('2026-09-08', 120, 100),
    snap('2026-09-09', 110, 100),
    snap('2026-09-10', 90, 100),
    snap('2026-09-11', 130, 100),
  ];

  it('reports the 5-day average only once five sessions exist', () => {
    const series = putCallSeries(history, 'GOLD');
    expect(series.map((p) => p.movingAverage)).toEqual([null, null, null, null, 1.1]);
    expect(series[1].ratio).toBe(1.2);
  });

  it('appends a live read for a date not yet stored, and never duplicates a stored one', () => {
    const summary = { callVolume: 100, putVolume: 150 } as ChainSummary;
    const withLive = putCallSeries(history, 'GOLD', { date: '2026-09-14', summary });
    expect(withLive.at(-1)).toEqual({ date: '2026-09-14', ratio: 1.5, movingAverage: 1.2, live: true });
    expect(putCallSeries(history, 'GOLD', { date: '2026-09-11', summary }).length).toBe(5);
  });

  it('breaks the average across a session with no calls traded', () => {
    const gap = [...history.slice(0, 4), snap('2026-09-11', 10, 0)];
    expect(putCallSeries(gap, 'GOLD').at(-1)?.movingAverage).toBeNull();
  });
});

describe('readPutCall', () => {
  it("applies A1's bands", () => {
    expect(readPutCall(1.0)).toBe('High call volume');
    expect(readPutCall(1.07)).toBe('High call volume');
    expect(readPutCall(1.15)).toBe('Normal');
    expect(readPutCall(1.2)).toBe('High put volume');
    expect(readPutCall(null)).toBeNull();
  });
});

describe('shouldCaptureOptions', () => {
  it('captures after 21:00 UTC on weekdays only', () => {
    expect(shouldCaptureOptions(new Date('2026-09-14T21:05:00Z'))).toBe(true); // Monday
    expect(shouldCaptureOptions(new Date('2026-09-14T20:59:00Z'))).toBe(false);
    expect(shouldCaptureOptions(new Date('2026-09-13T22:00:00Z'))).toBe(false); // Sunday
  });
});
