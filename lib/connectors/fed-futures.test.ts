import { describe, expect, it } from 'vitest';
import { buildFedPath, contractChain, pricedBp, type FedContractSeries } from '@/lib/connectors/fed-futures';

const now = new Date('2026-10-03T12:00:00Z');

describe('contractChain', () => {
  it('starts at this month and rolls the year', () => {
    expect(contractChain(now, 6)).toEqual([
      { ticker: 'ZQV26.CBT', month: '2026-10' },
      { ticker: 'ZQX26.CBT', month: '2026-11' },
      { ticker: 'ZQZ26.CBT', month: '2026-12' },
      { ticker: 'ZQF27.CBT', month: '2027-01' },
      { ticker: 'ZQG27.CBT', month: '2027-02' },
      { ticker: 'ZQH27.CBT', month: '2027-03' },
    ]);
  });
});

describe('buildFedPath / pricedBp', () => {
  const contracts: FedContractSeries[] = contractChain(now, 8).map((c, k) => ({
    ...c,
    closes: [
      { date: '2026-09-03', value: 96.0 - k * 0.05 },
      { date: '2026-09-26', value: 95.9 - k * 0.05 },
      { date: '2026-10-02', value: 96.0 - k * 0.05 },
    ],
  }));
  const effr = [{ date: '2026-10-01', value: 3.88 }];

  it('reads bp priced against the effective rate, now and a week ago', () => {
    const path = buildFedPath(effr, contracts, now);
    expect(path.reference?.label).toContain('EFFR');
    const q = pricedBp(path, now, 3)!;
    expect(q.point.month).toBe('2027-01');
    // 100 − 95.85 = 4.15 → 27bp over 3.88; a week ago 100 − 95.75 = 4.25 → 37bp.
    expect(q.now).toBe(27);
    expect(q.weekAgo).toBe(37);
    expect(q.monthAgo).toBe(27);
  });

  it('falls back to this month\'s contract when FRED is down, and says so', () => {
    const path = buildFedPath([], contracts, now);
    expect(path.reference?.value).toBe(4);
    expect(path.reference?.label).toContain('EFFR unavailable');
  });

  it('never reads a close from after the moment it is built for', () => {
    const path = buildFedPath(effr, contracts, new Date('2026-09-27T00:00:00Z'));
    expect(path.points.find((p) => p.month === '2026-10')?.implied).toBe(4.1);
  });
});
