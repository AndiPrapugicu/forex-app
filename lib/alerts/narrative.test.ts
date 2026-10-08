import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/types';
import type { PositionView } from '@/lib/analysis/positions-load';
import type { FlipCondition } from '@/lib/analysis/state';
import type { FiredFlip, ThesisReport } from '@/lib/analysis/thesis';
import { isCurrentAlert } from './rules';
import { digestAlert, digestDue, flipAlerts, redAlerts, type DigestInput } from './narrative';

const NOW = new Date('2026-10-03T06:10:00Z');

const position = (over: Partial<Position> = {}): Position => ({
  id: 'p1',
  symbol: 'EURUSD',
  side: 'long',
  entryDate: '2026-09-29',
  entryPrice: 1.085,
  stopLoss: 1.075,
  takeProfit: 1.11,
  size: null,
  riskPct: null,
  thesis: null,
  openedAtUtc: '2026-09-29T08:00:00.000Z',
  closedAtUtc: null,
  closePrice: null,
  lastStatus: 'green',
  lastStatusAtUtc: null,
  ...over,
});

const report = (status: ThesisReport['status'], signals: ThesisReport['signals'] = []): ThesisReport => ({
  positionId: 'p1',
  symbol: 'EURUSD',
  status,
  signals,
  price: 1.08,
  structure: null,
  lastClose: null,
  atr: null,
  rNow: -0.5,
  rTarget: 2.5,
  boardScore: 3,
  entryScore: 12,
  daysOnSide: 0,
  evaluatedAtUtc: NOW.toISOString(),
});

const view = (p: Position, r: ThesisReport | null): PositionView => ({ position: p, report: r, gap: null });

const fired = (favours: 'bullish' | 'bearish', symbol = 'EURUSD'): FiredFlip => ({
  id: 'cal:us-cpi:up',
  symbol,
  text: 'USD CPI (2026-10-14 12:30Z) at or above 3.1%',
  favours,
  firedAtUtc: NOW.toISOString(),
  value: 3.2,
});

describe('flipAlerts', () => {
  it('alerts a fired condition against an open position, naming it', () => {
    const [a] = flipAlerts([fired('bearish')], [view(position(), null)], NOW);
    expect(a).toMatchObject({ kind: 'narrative-flip', severity: 'high', title: 'EURUSD: flip condition hit', affects: ['EUR', 'USD'], highConfidence: true });
    expect(a.body).toBe('USD CPI (2026-10-14 12:30Z) at or above 3.1%. Reading 3.2. It favours bearish, against your LONG from 1.085 (2026-09-29).');
  });

  it('stays quiet for a condition in the position’s favour, or on another symbol', () => {
    expect(flipAlerts([fired('bullish')], [view(position(), null)], NOW)).toEqual([]);
    expect(flipAlerts([fired('bearish', 'GBPUSD')], [view(position(), null)], NOW)).toEqual([]);
  });

  it('hashes per condition per day', () => {
    const a = flipAlerts([fired('bearish')], [view(position(), null)], NOW)[0];
    const b = flipAlerts([{ ...fired('bearish'), firedAtUtc: '2026-10-03T21:00:00.000Z' }], [view(position(), null)], NOW)[0];
    const c = flipAlerts([{ ...fired('bearish'), firedAtUtc: '2026-10-04T09:00:00.000Z' }], [view(position(), null)], NOW)[0];
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });
});

describe('redAlerts', () => {
  const red = report('red', [
    { level: 'red', code: 'band', text: 'Board +3 has left the +4 or higher band a long needs' },
    { level: 'yellow', code: 'flip-due', text: 'Due within 3 days: USD CPI' },
  ]);

  it('alerts on the turn to RED, with the red reasons only', () => {
    const [a] = redAlerts([view(position({ lastStatus: 'yellow' }), red)], NOW);
    expect(a).toMatchObject({ kind: 'thesis-red', severity: 'high', title: 'EURUSD LONG: thesis RED' });
    expect(a.body).toBe('Entry 1.085 on 2026-09-29, now 1.08 (−0.50R).\n• Board +3 has left the +4 or higher band a long needs');
  });

  it('does not repeat while it stays RED, and alerts a first-ever RED', () => {
    expect(redAlerts([view(position({ lastStatus: 'red' }), red)], NOW)).toEqual([]);
    expect(redAlerts([view(position({ lastStatus: null }), red)], NOW)).toHaveLength(1);
    expect(redAlerts([view(position(), report('yellow'))], NOW)).toEqual([]);
  });
});

describe('digest', () => {
  const flip = (dueUtc: string, text: string): FlipCondition =>
    ({ id: text, kind: 'calendar', theme: 'inflation', dueUtc, text, favours: 'bearish', role: 'flip', check: { type: 'release', eventId: 'x', op: '>=', threshold: 1 } }) as FlipCondition;

  const base: DigestInput = {
    now: NOW,
    verdicts: {
      EURX: { tactical: 'BULLISH', structural: 'NEUTRAL', text: '' },
      DXY: { tactical: 'BEARISH', structural: 'BEARISH', text: '' },
      EURUSD: { tactical: 'BULLISH', structural: 'BULLISH', text: '' },
    },
    yesterday: {
      EURX: { tactical: 'NEUTRAL', structural: 'NEUTRAL', text: '' },
      DXY: { tactical: 'BEARISH', structural: 'NEUTRAL', text: '' },
      EURUSD: { tactical: 'BULLISH', structural: 'BULLISH', text: '' },
    },
    watch: ['EURX', 'DXY', 'EURUSD'],
    views: [view(position(), report('yellow', [{ level: 'yellow', code: 'flip-due', text: 'Due within 3 days: USD CPI' }]))],
    flips: { EURUSD: [flip('2026-10-03T12:30:00Z', 'USD ISM at or above 52'), flip('2026-10-05T12:30:00Z', 'later'), flip('2026-10-02T12:30:00Z', 'past')] },
    fired: [fired('bullish')],
    digestSentFor: '2026-10-02',
  };

  it('is due at the first run at or after 06:00 UTC, once a day', () => {
    expect(digestDue(new Date('2026-10-03T05:59:00Z'), '2026-10-02')).toBe(false);
    expect(digestDue(NOW, '2026-10-02')).toBe(true);
    expect(digestDue(NOW, '2026-10-03')).toBe(false);
    expect(digestDue(NOW, undefined)).toBe(true);
  });

  it('reports verdict changes, positions, confirmations and the next 24h', () => {
    const a = digestAlert(base)!;
    expect(a).toMatchObject({ kind: 'narrative-digest', severity: 'medium', title: 'Market narrative — 2026-10-03', affects: ['EUR', 'USD'] });
    expect(a.body).toBe(
      [
        'Verdict changes since yesterday:',
        '• EURX tactical NEUTRAL → BULLISH',
        '• DXY structural NEUTRAL → BEARISH',
        '',
        'Your positions:',
        '• EURUSD LONG — YELLOW: Due within 3 days: USD CPI',
        '',
        'Confirmed in your favour:',
        '• EURUSD: USD CPI (2026-10-14 12:30Z) at or above 3.1%',
        '',
        'Due in the next 24h:',
        '• EURUSD flip: USD ISM at or above 52',
      ].join('\n'),
    );
  });

  it('says nothing before 06:00, after it was sent, or with nothing to say', () => {
    expect(digestAlert({ ...base, now: new Date('2026-10-03T05:00:00Z') })).toBeNull();
    expect(digestAlert({ ...base, digestSentFor: '2026-10-03' })).toBeNull();
    expect(digestAlert({ ...base, yesterday: null, views: [], flips: {}, fired: [] })).toBeNull();
  });

  it('hashes per day', () => {
    const a = digestAlert(base)!;
    const b = digestAlert({ ...base, now: new Date('2026-10-04T06:10:00Z'), digestSentFor: '2026-10-03' })!;
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('the public feed', () => {
  it('never shows a narrative alert', () => {
    const [a] = redAlerts([view(position({ lastStatus: 'yellow' }), report('red', [{ level: 'red', code: 'band', text: 'x' }]))], NOW);
    expect(isCurrentAlert(a, NOW, new Set())).toBe(false);
  });
});
