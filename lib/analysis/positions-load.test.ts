import { describe, expect, it } from 'vitest';
import type { Position, ScoreSnapshot } from '@/lib/types';
import { entrySnapshot, positionLines } from './positions-load';
import type { ThesisReport } from './thesis';

const position: Position = {
  id: 'p1',
  symbol: 'EURUSD',
  side: 'long',
  entryDate: '2026-09-29',
  entryPrice: 1.085,
  stopLoss: 1.075,
  takeProfit: 1.11,
  size: '0.5 lots',
  riskPct: 1,
  thesis: 'US labour cooling,\nFed cuts repriced.',
  openedAtUtc: '2026-09-29T08:00:00.000Z',
  closedAtUtc: null,
  closePrice: null,
  lastStatus: null,
  lastStatusAtUtc: null,
};

const report: ThesisReport = {
  positionId: 'p1',
  symbol: 'EURUSD',
  status: 'yellow',
  signals: [{ level: 'yellow', code: 'flip-due', text: 'Due within 3 days: USD CPI' }],
  price: 1.09,
  structure: { kind: 'HL', price: 1.0812, date: '2026-09-25' },
  lastClose: { price: 1.089, date: '2026-10-02' },
  atr: 0.0062,
  rNow: 0.5,
  rTarget: 2.5,
  boardScore: 10,
  entryScore: 12,
  daysOnSide: 9,
  evaluatedAtUtc: '2026-10-03T12:00:00.000Z',
};

const snap = (atUtc: string, totalScore: number) => ({ symbol: 'EURUSD', capturedAtUtc: atUtc, totalScore }) as ScoreSnapshot;

describe('entrySnapshot', () => {
  it('takes the capture nearest midday of the entry date', () => {
    const h = [snap('2026-09-28T16:00:00Z', 8), snap('2026-09-29T10:00:00Z', 12), snap('2026-09-30T10:00:00Z', 13)];
    expect(entrySnapshot(h, '2026-09-29')?.totalScore).toBe(12);
  });

  it('refuses a capture too far from the entry to mean "at entry"', () => {
    expect(entrySnapshot([snap('2026-09-20T12:00:00Z', 9)], '2026-09-29')).toBeNull();
    expect(entrySnapshot([], '2026-09-29')).toBeNull();
  });
});

describe('positionLines', () => {
  it('states the trade, the check and the thesis for the analyst', () => {
    expect(positionLines({ position, report, gap: null })).toEqual([
      "### Open position on EURUSD (the user's own — check the thesis point by point)",
      '- LONG from 1.085 on 2026-09-29; stop 1.075, target 1.11 (+2.50R); size 0.5 lots; risk 1%.',
      '- Now 1.09 (+0.50R). Board +10 (at entry +12); 9 days in band.',
      '- Structure: last HL 1.0812 (2026-09-25); last daily close 1.089 (2026-10-02); ATR(14) 0.0062.',
      '- THESIS STATUS: YELLOW',
      '  - YELLOW: Due within 3 days: USD CPI',
      '- The user\'s thesis, in their words: "US labour cooling, Fed cuts repriced."',
    ]);
  });

  it('names the gap when there is no report', () => {
    const lines = positionLines({ position: { ...position, thesis: null }, report: null, gap: 'thesis check failed on this run' });
    expect(lines).toContain('- Gap: thesis check failed on this run.');
    expect(lines.at(-1)).toBe('- The user wrote no thesis for this trade.');
  });
});
