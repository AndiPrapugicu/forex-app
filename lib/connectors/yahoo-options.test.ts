import { describe, expect, it } from 'vitest';
import fixture from '@/fixtures/yahoo-options-GLD.json';
import { findWalls, parseChainPage, summariseChain, type ChainPage } from './yahoo-options';

describe('parseChainPage', () => {
  it('reads the captured GLD chain', () => {
    const page = parseChainPage(fixture);
    expect(page).not.toBeNull();
    expect(page!.price).toBe(398.77);
    expect(page!.expirationDates.length).toBe(24);
    expect(page!.calls.length).toBe(23);
    expect(page!.puts.length).toBe(18);
  });

  it('returns null for a body that is not a chain', () => {
    expect(parseChainPage({ finance: { error: { code: 'Unauthorized' } } })).toBeNull();
    expect(parseChainPage(null)).toBeNull();
  });
});

describe('summariseChain', () => {
  const pages: ChainPage[] = [
    {
      price: 100,
      expirationDates: [],
      calls: [{ strike: 100, volume: 10, openInterest: 50 }, { strike: 105, volume: 5, openInterest: 400 }],
      puts: [{ strike: 95, volume: 30, openInterest: 300 }, { strike: 100, openInterest: 20 }],
    },
    {
      price: null,
      expirationDates: [],
      calls: [{ strike: 100, volume: 5, openInterest: 10 }],
      puts: [{ strike: 95, volume: 15, openInterest: 100 }],
    },
  ];
  const s = summariseChain({ symbol: 'GOLD', etf: 'GLD' }, pages, '2026-09-13T00:00:00.000Z');

  it('sums volume and open interest per strike across expiries', () => {
    expect(s.strikes.map((r) => r.strike)).toEqual([95, 100, 105]);
    expect(s.strikes[1]).toEqual({ strike: 100, callVolume: 15, putVolume: 0, callOpenInterest: 60, putOpenInterest: 20 });
    expect(s.callVolume).toBe(20);
    expect(s.putVolume).toBe(45);
  });

  it('computes the ratios, and treats a missing volume as none traded', () => {
    expect(s.putCallVolume).toBe(2.25);
    // put OI 300 + 20 + 100 = 420, call OI 50 + 400 + 10 = 460
    expect(s.putCallOpenInterest).toBe(0.913);
    expect(s.price).toBe(100);
    expect(s.expiries).toBe(2);
  });

  it('has no ratio when no calls traded', () => {
    const empty = summariseChain({ symbol: 'X', etf: 'X' }, [{ price: 1, expirationDates: [], calls: [], puts: [{ strike: 1, volume: 3 }] }]);
    expect(empty.putCallVolume).toBeNull();
  });

  it('names the call and put walls by open interest', () => {
    const { callWall, putWall } = findWalls(s);
    expect(callWall?.strike).toBe(105);
    expect(putWall?.strike).toBe(95);
  });
});
