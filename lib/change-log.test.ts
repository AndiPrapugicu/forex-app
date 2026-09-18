/**
 * The 1D column against a history that does not reach a day.
 *
 * The live case this was written for: the ingest job's first successful run was
 * 2026-09-17 16:08, and GitHub throttled the 10-minute schedule to captures
 * roughly three hours apart. On the morning of 09-18 the 24h target sat before
 * every capture on file and the column read "—" for all 51 rows.
 */

import { describe, expect, it } from 'vitest';
import { loadDayDeltas } from '@/lib/change-log';
import type { ScoreSnapshot } from '@/lib/types';
import type { SetupsMatrix } from '@/lib/scoring/setups';

const CAPTURES = [
  '2026-09-17T16:08:00.000Z',
  '2026-09-17T18:54:00.000Z',
  '2026-09-17T21:56:00.000Z',
  '2026-09-18T00:00:00.000Z',
  '2026-09-18T04:36:00.000Z',
];

function store(captures: string[], score: (capturedAtUtc: string) => number) {
  const rows: ScoreSnapshot[] = captures.map(
    (capturedAtUtc) =>
      ({ symbol: 'EURUSD', capturedAtUtc, totalScore: score(capturedAtUtc) } as ScoreSnapshot),
  );
  return {
    getAllSnapshots: async (since: string) => rows.filter((r) => r.capturedAtUtc >= since),
  };
}

const matrix = (generatedAtUtc: string, totalScore: number) =>
  ({ generatedAtUtc, rows: [{ symbol: 'EURUSD', totalScore }] } as unknown as SetupsMatrix);

describe('loadDayDeltas', () => {
  it('falls back to the oldest board on file when history is younger than a day', async () => {
    const got = await loadDayDeltas(
      matrix('2026-09-18T04:53:00.000Z', -9),
      store(CAPTURES, (c) => (c === '2026-09-17T16:08:00.000Z' ? -6 : -8)),
    );
    expect(got.comparedWithUtc).toBe('2026-09-17T16:08:00.000Z');
    expect(got.deltas.EURUSD).toBe(-3);
  });

  it('prefers the capture nearest a day ago once history reaches back that far', async () => {
    const got = await loadDayDeltas(
      matrix('2026-09-18T17:00:00.000Z', -9),
      store([...CAPTURES, '2026-09-18T15:00:00.000Z'], (c) =>
        c === '2026-09-17T16:08:00.000Z' ? -6 : -8,
      ),
    );
    expect(got.comparedWithUtc).toBe('2026-09-17T16:08:00.000Z');
    expect(got.deltas.EURUSD).toBe(-3);
  });

  it('ignores a capture from the last two hours, which would read 0 everywhere', async () => {
    const got = await loadDayDeltas(
      matrix('2026-09-18T05:00:00.000Z', -9),
      store(['2026-09-18T04:36:00.000Z'], () => -9),
    );
    expect(got.comparedWithUtc).toBeNull();
    expect(got.deltas.EURUSD).toBeNull();
  });

  it('never throws when the store is unreachable', async () => {
    const got = await loadDayDeltas(matrix('2026-09-18T05:00:00.000Z', 4), {
      getAllSnapshots: async () => {
        throw new Error('no database');
      },
    });
    expect(got).toEqual({ deltas: { EURUSD: null }, comparedWithUtc: null });
  });
});
