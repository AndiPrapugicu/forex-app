import { describe, expect, it } from 'vitest';
import type { ScoreSnapshot } from '@/lib/types';
import { dayDeltas, scoresAt } from './history';

function snap(symbol: string, capturedAtUtc: string, totalScore: number): ScoreSnapshot {
  return {
    symbol,
    capturedAtUtc,
    totalScore,
    bias: 'Neutral',
    populated: 18,
    categoryScores: {},
    price: null,
    cells: {},
  } as ScoreSnapshot;
}

describe('scoresAt', () => {
  const at = '2026-09-12T10:00:00.000Z';

  it('takes the latest snapshot at or before the target', () => {
    const got = scoresAt(
      [snap('EURUSD', '2026-09-12T09:40:00.000Z', 3), snap('EURUSD', '2026-09-12T09:50:00.000Z', 4), snap('EURUSD', '2026-09-12T10:10:00.000Z', 9)],
      at,
    );
    expect(got.get('EURUSD')).toBe(4);
  });

  it('ignores a snapshot older than the tolerance, so a week is never called a day', () => {
    expect(scoresAt([snap('GBPUSD', '2026-09-05T10:00:00.000Z', -2)], at).has('GBPUSD')).toBe(false);
  });
});

describe('dayDeltas', () => {
  it('is now minus then, and null without a then', () => {
    const then = new Map([['EURUSD', 4]]);
    expect(dayDeltas([{ symbol: 'EURUSD', totalScore: 6 }, { symbol: 'USDJPY', totalScore: -3 }], then)).toEqual({
      EURUSD: 2,
      USDJPY: null,
    });
  });
});
