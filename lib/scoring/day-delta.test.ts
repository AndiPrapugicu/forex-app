import { describe, expect, it } from 'vitest';
import type { ScoreSnapshot } from '@/lib/types';
import { dayDeltas, nearestCaptureMoment, scoresAt } from './history';

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

describe('nearestCaptureMoment', () => {
  const at = '2026-09-12T10:00:00.000Z';

  /**
   * The live cadence: GitHub throttled the 10-minute schedule down to captures
   * at 16:08, 18:54, 21:56, 00:00 and 04:36. Under the old two-hour tolerance
   * the target fell in a gap and the whole column read "—".
   */
  it('takes the closest capture on either side of the target', () => {
    const snapshots = [
      snap('EURUSD', '2026-09-12T07:40:00.000Z', 1),
      snap('EURUSD', '2026-09-12T11:10:00.000Z', 9),
    ];
    expect(nearestCaptureMoment(snapshots, at)).toBe('2026-09-12T11:10:00.000Z');
  });

  it('refuses a capture beyond the window, so a week is never called a day', () => {
    expect(nearestCaptureMoment([snap('GBPUSD', '2026-09-05T10:00:00.000Z', -2)], at)).toBeNull();
  });
});

describe('scoresAt', () => {
  const at = '2026-09-12T10:00:00.000Z';

  it('reads every symbol off ONE capture, so no two rows use different vantages', () => {
    const got = scoresAt(
      [
        snap('EURUSD', '2026-09-12T09:50:00.000Z', 4),
        snap('USDJPY', '2026-09-12T09:50:00.000Z', -2),
        // Closer to now than to the target: must not be mixed in.
        snap('USDJPY', '2026-09-12T13:00:00.000Z', -7),
      ],
      at,
    );
    expect(got.get('EURUSD')).toBe(4);
    expect(got.get('USDJPY')).toBe(-2);
  });

  it('is empty when nothing is close enough', () => {
    expect(scoresAt([snap('GBPUSD', '2026-09-05T10:00:00.000Z', -2)], at).size).toBe(0);
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
