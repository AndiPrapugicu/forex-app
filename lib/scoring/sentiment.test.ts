import { describe, expect, it } from 'vitest';
import { buildRetailPairRows } from '@/lib/scoring/sentiment';
import type { RetailPositioningFeed } from '@/lib/scoring/crowd';

const feed = (entries: { symbol: string; longPct: number; shortPct?: number }[]): RetailPositioningFeed =>
  new Map(
    entries.map((e) => [
      e.symbol,
      { symbol: e.symbol, longPct: e.longPct, shortPct: e.shortPct, source: 'Myfxbook', observedAt: '2026-09-20' },
    ]),
  );

describe('buildRetailPairRows', () => {
  it('reads the contrarian cell the way the board does', () => {
    const rows = buildRetailPairRows(feed([{ symbol: 'EURUSD', longPct: 63 }, { symbol: 'GBPUSD', longPct: 31 }]));
    expect(rows.find((r) => r.symbol === 'EURUSD')!.cell).toBe(-1);
    expect(rows.find((r) => r.symbol === 'GBPUSD')!.cell).toBe(1);
  });

  it('sorts most-long first, as A1 lists them', () => {
    const rows = buildRetailPairRows(
      feed([
        { symbol: 'EURUSD', longPct: 40 },
        { symbol: 'AUDUSD', longPct: 90 },
        { symbol: 'USDJPY', longPct: 60 },
      ]),
    );
    expect(rows.map((r) => r.symbol)).toEqual(['AUDUSD', 'USDJPY', 'EURUSD']);
  });

  it("carries the provider's own short share, and completes it where it is absent", () => {
    const rows = buildRetailPairRows(feed([{ symbol: 'EURUSD', longPct: 63, shortPct: 37 }, { symbol: 'GBPJPY', longPct: 25 }]));
    expect(rows.find((r) => r.symbol === 'EURUSD')!.shortPct).toBe(37);
    expect(rows.find((r) => r.symbol === 'GBPJPY')!.shortPct).toBe(75);
  });

  it('marks which pairs the board actually scores', () => {
    const rows = buildRetailPairRows(feed([{ symbol: 'EURUSD', longPct: 50 }, { symbol: 'EURSEK', longPct: 50 }]));
    expect(rows.find((r) => r.symbol === 'EURUSD')!.onBoard).toBe(true);
    expect(rows.find((r) => r.symbol === 'EURSEK')!.onBoard).toBe(false);
  });

  it('is empty without a feed, so the panel can be absent rather than zeroed', () => {
    expect(buildRetailPairRows(undefined)).toEqual([]);
    expect(buildRetailPairRows(new Map())).toEqual([]);
  });
});
