import { describe, expect, it } from 'vitest';
import { THESIS } from '@/config/narrative.config';
import type { Position } from '@/lib/types';
import { rMultiple, sideCheck, validateNewPosition, validatePatch } from './positions';

const NOW = new Date('2026-10-03T12:00:00Z');

const good = {
  symbol: 'eurusd',
  side: 'long',
  entryDate: '2026-09-29',
  entryPrice: 1.085,
  stopLoss: 1.075,
  takeProfit: 1.11,
  size: '0.5 lots',
  riskPct: 1,
  thesis: 'US labour cooling, Fed cuts repriced; hold while HL/HH.',
};

const open: Position = {
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
  lastStatus: null,
  lastStatusAtUtc: null,
};

describe('validateNewPosition', () => {
  it('accepts a well-formed long and normalises the symbol', () => {
    const r = validateNewPosition(good, NOW, 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ symbol: 'EURUSD', side: 'long', entryPrice: 1.085, size: '0.5 lots' });
  });

  it('accepts numbers typed as strings, and blanks as null', () => {
    const r = validateNewPosition({ ...good, entryPrice: '1.0850', stopLoss: '', takeProfit: null, size: '  ', riskPct: '' }, NOW, 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ entryPrice: 1.085, stopLoss: null, takeProfit: null, size: null, riskPct: null });
  });

  it.each([
    [{ symbol: 'NOPE' }, /unknown symbol/],
    [{ side: 'buy' }, /side/],
    [{ entryDate: '29/09/2026' }, /YYYY-MM-DD/],
    [{ entryDate: '2026-10-04' }, /future/],
    [{ entryPrice: -1 }, /entry price/],
    [{ entryPrice: Number.NaN }, /entry price/],
    [{ stopLoss: 1.09 }, /stop loss 1.09 must be below entry/],
    [{ takeProfit: 1.08 }, /take profit 1.08 must be above entry/],
    [{ riskPct: 0 }, /risk %/],
    [{ riskPct: 101 }, /risk %/],
    [{ size: 'x'.repeat(61) }, /size is 61 characters/],
    [{ thesis: 'x'.repeat(THESIS.thesisChars + 1) }, /thesis is \d+ characters/],
  ])('rejects %j', (patch, reason) => {
    const r = validateNewPosition({ ...good, ...patch }, NOW, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });

  it('mirrors the stop and target rule for a short', () => {
    expect(validateNewPosition({ ...good, side: 'short', stopLoss: 1.095, takeProfit: 1.06 }, NOW, 0).ok).toBe(true);
    const r = validateNewPosition({ ...good, side: 'short', stopLoss: 1.075, takeProfit: null }, NOW, 0);
    expect(!r.ok && r.reason).toMatch(/must be above entry/);
  });

  it('caps open positions', () => {
    const r = validateNewPosition(good, NOW, THESIS.maxOpen);
    expect(!r.ok && r.reason).toMatch(/at most 50 open/);
  });

  it('rejects a non-object body', () => {
    expect(validateNewPosition(null, NOW, 0).ok).toBe(false);
    expect(validateNewPosition('EURUSD', NOW, 0).ok).toBe(false);
  });
});

describe('validatePatch', () => {
  it('closes with a price and stamps the time', () => {
    const r = validatePatch({ close: true, closePrice: '1.1' }, open, NOW);
    expect(r).toEqual({ ok: true, value: { closedAtUtc: NOW.toISOString(), closePrice: 1.1 } });
  });

  it('refuses to close twice', () => {
    const r = validatePatch({ close: true }, { ...open, closedAtUtc: NOW.toISOString() }, NOW);
    expect(!r.ok && r.reason).toMatch(/already closed/);
  });

  it('moves the stop, checked against the stored side and entry', () => {
    expect(validatePatch({ stopLoss: 1.08 }, open, NOW)).toEqual({ ok: true, value: { stopLoss: 1.08 } });
    const r = validatePatch({ stopLoss: 1.09 }, open, NOW);
    expect(!r.ok && r.reason).toMatch(/below entry/);
  });

  it('clears a field with null, and never touches status fields', () => {
    const r = validatePatch({ takeProfit: null, lastStatus: 'green', thesis: 'new' }, open, NOW);
    expect(r).toEqual({ ok: true, value: { takeProfit: null, thesis: 'new' } });
  });

  it('says when there is nothing to change', () => {
    const r = validatePatch({ lastStatus: 'red' }, open, NOW);
    expect(!r.ok && r.reason).toBe('nothing to change');
  });
});

describe('sideCheck and rMultiple', () => {
  it('accepts no stop and no target', () => {
    expect(sideCheck('long', 1, null, null)).toBeNull();
  });

  it('reads R from entry to stop', () => {
    expect(rMultiple(open, 1.095)).toBeCloseTo(1, 6);
    expect(rMultiple(open, 1.08)).toBeCloseTo(-0.5, 6);
    expect(rMultiple({ side: 'short', entryPrice: 100, stopLoss: 102 }, 96)).toBeCloseTo(2, 6);
    expect(rMultiple({ ...open, stopLoss: null }, 1.1)).toBeNull();
  });
});
