import { describe, expect, it } from 'vitest';
import { filterByBias } from '@/lib/ui/symbol-filter';

const options = [
  { symbol: 'EURUSD', assetClass: 'Forex', score: -3, bias: 'Neutral' },
  { symbol: 'GBPJPY', assetClass: 'Forex', score: 5, bias: 'Bullish' },
  { symbol: 'AUDNZD', assetClass: 'Forex', score: 9, bias: 'Very Bullish' },
  { symbol: 'USDCAD', assetClass: 'Forex', score: -8, bias: 'Very Bearish' },
  { symbol: 'XAUUSD', assetClass: 'Metals', score: 4, bias: 'Bullish' },
];

describe('filterByBias', () => {
  it('keeps Very Bullish under Bullish, strongest first, asset classes in order', () => {
    expect(filterByBias(options, 'bullish', 'GBPJPY').map((o) => o.symbol)).toEqual(['AUDNZD', 'GBPJPY', 'XAUUSD']);
  });

  it('sorts bearish most bearish first', () => {
    expect(filterByBias(options, 'bearish', 'USDCAD').map((o) => o.symbol)).toEqual(['USDCAD']);
  });

  it('always keeps the symbol on screen, even when it does not match', () => {
    expect(filterByBias(options, 'bearish', 'EURUSD').map((o) => o.symbol)).toEqual(['USDCAD', 'EURUSD']);
  });

  it('All changes nothing', () => {
    expect(filterByBias(options, 'all', 'EURUSD')).toEqual(options);
  });
});
