/**
 * FRED CSV parsing.
 *
 * This parser feeds two things with very different failure modes. The sovereign
 * yield map wants the last row and notices immediately if it is wrong. The rate
 * column wants the whole series, and a parser that silently drops or mis-orders
 * observations there produces a 21-day average that is quietly computed over the
 * wrong 21 days — a number that looks entirely reasonable and is not the
 * statistic it claims to be.
 *
 * The "." row is the specific trap: FRED writes it for market holidays, it
 * parses as NaN rather than throwing, and an unguarded `Number()` puts a NaN
 * into the mean and turns the whole average into NaN.
 */

import { describe, expect, it } from 'vitest';
import { parseFredSeries } from '@/lib/connectors/yields';

const csv = [
  'observation_date,DGS2',
  '2026-08-17,4.19',
  '2026-08-18,4.19',
  '2026-08-19,.',
  '2026-08-20,4.19',
  '2026-08-21,4.24',
].join('\n');

describe('parseFredSeries', () => {
  it('returns observations oldest first, with their dates', () => {
    const series = parseFredSeries(csv);
    expect(series.map((o) => o.date)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-20',
      '2026-08-21',
    ]);
    expect(series[0].value).toBe(4.19);
    expect(series[series.length - 1].value).toBe(4.24);
  });

  it('drops holiday rows rather than admitting a NaN', () => {
    const series = parseFredSeries(csv);
    expect(series).toHaveLength(4);
    expect(series.every((o) => Number.isFinite(o.value))).toBe(true);
    // The failure this guards: one NaN makes the whole average NaN.
    const mean = series.reduce((a, b) => a + b.value, 0) / series.length;
    expect(Number.isFinite(mean)).toBe(true);
  });

  it('skips the header row and survives an empty body', () => {
    expect(parseFredSeries('observation_date,DGS2')).toEqual([]);
    expect(parseFredSeries('')).toEqual([]);
  });
});
