/**
 * The mirror and the a1 profile never reach anything that is stored.
 *
 * `lib/scoring/a1-mirror.ts` states the rule: mirror mode is presentation, and
 * it never reaches the stored score history, the change log, or ingest. The
 * `a1` profile is the same class of thing — a board with A1's data gaps applied,
 * for measurement. A stored history written from either would record A1's
 * holes, or cells copied off their screen, as if they were our scores, and every
 * later backtest would inherit them silently.
 *
 * Static on purpose. These paths only run against the network and a real store,
 * so a behavioural test would either be skipped or mock the thing it checks.
 * Reading the source is the cheap test that cannot be mocked around.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PROFILE } from '@/config/profiles.config';
import { mirrorBoard } from '@/lib/scoring/a1-mirror';
import type { SymbolRow } from '@/lib/scoring/setups';

/** Everything that persists scores or derives history from them. */
const PERSISTENCE_PATHS = [
  'app/api/ingest/route.ts',
  'lib/scoring/history.ts',
  'lib/change-log.ts',
];

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('stored history never sees the mirror or the a1 profile', () => {
  it.each(PERSISTENCE_PATHS)('%s does not import the mirror', (rel) => {
    expect(read(rel)).not.toMatch(/a1-mirror/);
  });

  it.each(PERSISTENCE_PATHS)('%s never asks for the a1 profile', (rel) => {
    expect(read(rel)).not.toMatch(/profile:\s*['"]a1['"]/);
  });

  it('builds the product board under the ours profile by default', () => {
    expect(DEFAULT_PROFILE).toBe('ours');
  });
});

describe('mirrorBoard returns a copy', () => {
  it('never mutates the rows it is given', () => {
    const cell = { slotKey: 'ppi', cell: 1, status: 'scored' as const, explanation: '' };
    const rows = [
      {
        symbol: 'EURUSD',
        kind: 'fx',
        totalScore: 1,
        bias: 'Neutral',
        categoryScores: { technical: 0, sentiment: 0, growth: 0, inflation: 1, jobs: 0 },
        cells: { ppi: cell },
      },
    ] as unknown as SymbolRow[];

    const snapshot = JSON.stringify(rows);
    const mirrored = mirrorBoard(rows);

    expect(mirrored[0].cells.ppi.cell).toBe(-1);
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(mirrored[0].cells.ppi).not.toBe(cell);
  });
});
