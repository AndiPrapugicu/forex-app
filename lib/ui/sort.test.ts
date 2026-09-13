import { describe, expect, it } from 'vitest';
import { compareSortValues, nextSort, sortRows } from './sort';

describe('compareSortValues', () => {
  it('orders numbers both ways', () => {
    expect(compareSortValues(1, 2, 'asc')).toBeLessThan(0);
    expect(compareSortValues(1, 2, 'desc')).toBeGreaterThan(0);
  });

  it('sinks missing values in BOTH directions', () => {
    for (const dir of ['asc', 'desc'] as const) {
      expect(compareSortValues(null, 5, dir)).toBeGreaterThan(0);
      expect(compareSortValues(5, undefined, dir)).toBeLessThan(0);
      expect(compareSortValues(Number.NaN, -1e9, dir)).toBeGreaterThan(0);
      expect(compareSortValues(null, undefined, dir)).toBe(0);
    }
  });

  it('compares text naturally and case-insensitively', () => {
    expect(compareSortValues('eurusd', 'EURUSD', 'asc')).toBe(0);
    expect(compareSortValues('US30', 'US100', 'asc')).toBeLessThan(0);
  });
});

describe('sortRows', () => {
  const rows = [
    { s: 'A', v: 2 },
    { s: 'B', v: null },
    { s: 'C', v: 2 },
    { s: 'D', v: -1 },
  ];

  it('is stable and keeps nulls last', () => {
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.s)).toEqual(['A', 'C', 'D', 'B']);
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.s)).toEqual(['D', 'A', 'C', 'B']);
  });

  it('does not mutate its input', () => {
    const copy = [...rows];
    sortRows(rows, (r) => r.v, 'asc');
    expect(rows).toEqual(copy);
  });
});

describe('nextSort', () => {
  it('starts a new column at its default and flips the same one', () => {
    expect(nextSort(null, 'net', 'desc')).toEqual({ key: 'net', dir: 'desc' });
    expect(nextSort({ key: 'net', dir: 'desc' }, 'net', 'desc')).toEqual({ key: 'net', dir: 'asc' });
    expect(nextSort({ key: 'net', dir: 'asc' }, 'symbol', 'asc')).toEqual({ key: 'symbol', dir: 'asc' });
  });
});
