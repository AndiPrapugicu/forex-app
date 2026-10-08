import { describe, expect, it } from 'vitest';
import { buildLevels, findSwings } from '@/lib/analysis/levels';
import type { DailyBars } from '@/lib/connectors/technicals';

const DAY = 86_400;

/** Weekday bars from a Monday, with a gentle zig-zag so swings exist. */
function series(count: number, startMonday = Date.UTC(2026, 6, 6) / 1000): DailyBars {
  const bars: DailyBars = { timestamps: [], opens: [], highs: [], lows: [], closes: [] };
  let day = 0;
  for (let i = 0; i < count; i++) {
    while (((day % 7) + 7) % 7 >= 5) day++; // skip Sat/Sun
    const mid = 1.1 + 0.01 * Math.sin(i / 3);
    bars.timestamps.push(startMonday + day * DAY);
    bars.opens.push(mid);
    bars.highs.push(mid + 0.002);
    bars.lows.push(mid - 0.002);
    bars.closes.push(mid + 0.001);
    day++;
  }
  return bars;
}

describe('buildLevels', () => {
  it('reads every level off closed bars and sorts them top to bottom', () => {
    const bars = series(80);
    const lastTs = bars.timestamps.at(-1)!;
    // Saturday after the last bar: every bar is closed.
    const now = new Date((lastTs + 2 * DAY) * 1000);
    const set = buildLevels(bars, 1.1, now)!;

    expect(set.sessionInProgress).toBe(false);
    const labels = set.levels.map((l) => l.label);
    for (const l of ['Prior day high', 'Prior day low', 'Prior week high', 'Weekly pivot P', '20-session high', '20-session low']) {
      expect(labels).toContain(l);
    }
    const prices = set.levels.map((l) => l.price);
    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
    for (const l of set.levels) {
      expect(Number.isFinite(l.price)).toBe(true);
      expect(l.side).toBe(l.price >= 1.1 ? 'above' : 'below');
    }
  });

  it('leaves a session still trading out of the levels', () => {
    const bars = series(40);
    bars.highs[bars.highs.length - 1] = 9; // an absurd intraday spike
    const now = new Date((bars.timestamps.at(-1)! + 3600) * 1000);
    const set = buildLevels(bars, 1.1, now)!;
    expect(set.sessionInProgress).toBe(true);
    expect(set.levels.every((l) => l.price < 9)).toBe(true);
  });

  it('declines on too little history rather than drawing levels from it', () => {
    expect(buildLevels(series(10), 1.1, new Date())).toBeNull();
    expect(buildLevels(null, 1.1, new Date())).toBeNull();
  });
});

describe('findSwings', () => {
  it('finds a peak that out-reaches three bars either side', () => {
    const highs = [1, 2, 3, 9, 3, 2, 1];
    const bars = highs.map((h, i) => ({ t: i, h, l: h - 0.5, c: h }));
    expect(findSwings(bars)).toContainEqual({ price: 9, t: 3, kind: 'high' });
  });
});
