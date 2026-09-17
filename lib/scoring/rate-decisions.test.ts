/**
 * The Rates column off the central-bank decision calendar.
 *
 * The fixture rows below are the TradingView calendar as read on 2026-09-17:
 * Fed 4.00 (from 3.75) on 09-16, ECB 2.65 on 09-10, BoE hold 3.75 on 09-17,
 * BoJ 09-18 forecast 1.25 against 1.00, RBNZ 2.75 on 09-02, BoC hold 2.25 on
 * 09-02, RBA 09-29 and SNB 09-24 with no forecast yet.
 */

import { describe, expect, it } from 'vitest';
import { toRateDecisionEvents } from '@/lib/connectors/tradingview';
import { asOf } from '@/lib/scoring/backtest';
import { decidedSince, resolveCalendarRateLegs } from '@/lib/scoring/rate-decisions';
import { buildSetupsMatrix } from '@/lib/scoring/setups';
import type { Currency, NormalizedEvent } from '@/lib/types';

const MAJORS: Currency[] = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'];

type Raw = { title: string; date: string; actual?: number | null; forecast?: number | null; previous?: number | null };
const d = (title: string, date: string, actual: number | null, forecast: number | null, previous: number | null): Raw =>
  ({ title, date, actual, forecast, previous });

function calendar(): NormalizedEvent[] {
  return [
    ...toRateDecisionEvents('US', [
      d('Fed Interest Rate Decision', '2026-07-29T18:00:00Z', 3.75, 3.75, 3.75),
      d('Fed Interest Rate Decision', '2026-09-16T18:00:00Z', 4, 4, 3.75),
      d('Fed Interest Rate Projections - Current', '2026-09-16T18:00:00Z', 4, null, 3.75),
    ]),
    ...toRateDecisionEvents('EU', [
      d('ECB Interest Rate Decision', '2026-09-10T12:15:00Z', 2.65, 2.65, 2.4),
      d('Deposit Facility Rate', '2026-09-10T12:15:00Z', 2.5, 2.5, 2.25),
    ]),
    ...toRateDecisionEvents('GB', [
      d('BoE Interest Rate Decision', '2026-08-06T11:00:00Z', 3.75, 3.75, 3.75),
      d('BoE Interest Rate Decision', '2026-09-17T11:00:00Z', 3.75, 3.75, 3.75),
    ]),
    ...toRateDecisionEvents('JP', [d('BoJ Interest Rate Decision', '2026-09-18T03:00:00Z', null, 1.25, 1)]),
    ...toRateDecisionEvents('AU', [
      d('RBA Interest Rate Decision', '2026-08-11T04:30:00Z', 4.35, 4.35, 4.35),
      d('RBA Interest Rate Decision', '2026-09-29T04:30:00Z', null, null, 4.35),
    ]),
    ...toRateDecisionEvents('NZ', [d('RBNZ Interest Rate Decision', '2026-09-02T02:00:00Z', 2.75, 2.75, 2.5)]),
    ...toRateDecisionEvents('CA', [d('BoC Interest Rate Decision', '2026-09-02T13:45:00Z', 2.25, 2.25, 2.25)]),
    ...toRateDecisionEvents('CH', [d('SNB Interest Rate Decision', '2026-09-24T07:30:00Z', null, null, 0)]),
  ];
}

function legsAt(events: NormalizedEvent[], at: string): Record<string, number | null> {
  const result = resolveCalendarRateLegs(events, MAJORS, new Date(at));
  if (!result.legs) throw new Error(result.why);
  return Object.fromEntries(MAJORS.map((c) => [c, result.legs.get(c)?.cell ?? null]));
}

describe('toRateDecisionEvents', () => {
  it('keeps only the exact decision title, not deposit rates or projections', () => {
    const events = calendar();
    expect(events.filter((e) => e.currency === 'USD')).toHaveLength(2);
    expect(events.filter((e) => e.currency === 'EUR').map((e) => e.actual)).toEqual([2.65]);
    expect(events.every((e) => e.name === 'Policy Rate Decision (TradingView)')).toBe(true);
  });
});

describe('resolveCalendarRateLegs', () => {
  /** A1 on 2026-09-17: USDJPY -1, EURUSD 0, EURX/GBPX/NZDX 0. */
  it('gives the legs A1 printed on 2026-09-17', () => {
    expect(legsAt(calendar(), '2026-09-17T12:03:00Z')).toEqual({
      USD: 0, EUR: 0, GBP: 0, JPY: 1, AUD: 0, NZD: 0, CAD: 0, CHF: 0,
    });
  });

  /**
   * A1 on 2026-09-15: EURUSD -1, GBPJPY -1, NZDUSD -1, AUDNZD 0. The Fed's
   * 09-16 decision is rewound to a scheduled one, which is what it was then.
   */
  it('gives the legs A1 printed on 2026-09-15, rewound through asOf', () => {
    const at = new Date('2026-09-15T12:00:00Z');
    const { events } = asOf({ events: calendar(), cot: new Map(), bars: new Map(), seasonality: new Map() }, at);
    expect(legsAt(events, at.toISOString())).toEqual({
      USD: 1, EUR: 0, GBP: 0, JPY: 1, AUD: 0, NZD: 0, CAD: 0, CHF: 0,
    });
  });

  it('reads a cut as -1 and says which decision it is reading', () => {
    const events = toRateDecisionEvents('US', [d('Fed Interest Rate Decision', '2026-10-28T18:00:00Z', null, 3.75, 4)]);
    const result = resolveCalendarRateLegs(events, ['USD'], new Date('2026-09-20T00:00:00Z'));
    expect(result.legs?.get('USD')?.cell).toBe(-1);
    expect(result.legs?.get('USD')?.explanation).toContain('Fed decision on 2026-10-28');
  });

  it('refuses the whole board when one bank has no standing rate', () => {
    const events = calendar().filter((e) => e.currency !== 'CAD');
    const result = resolveCalendarRateLegs(events, MAJORS, new Date('2026-09-17T12:00:00Z'));
    expect(result.legs).toBeNull();
  });
});

describe('decidedSince', () => {
  it('sees the RBNZ decision after the 2026-09-01 snapshot, and nothing after 09-17', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    expect(decidedSince(calendar(), MAJORS, '2026-09-01', now)).toBe(true);
    expect(decidedSince(calendar(), MAJORS, '2026-09-17', now)).toBe(false);
  });
});

describe('buildSetupsMatrix rates precedence', () => {
  const board = (events: NormalizedEvent[], at: string) =>
    buildSetupsMatrix({ events, cot: new Map(), technicals: new Map(), now: new Date(at) });
  const rates = (m: ReturnType<typeof board>, symbol: string) =>
    m.rows.find((r) => r.symbol === symbol)?.cells.rates?.cell;

  it('switches to the decision calendar once a bank has moved since the snapshot', () => {
    const m = board(calendar(), '2026-09-17T12:03:00Z');
    expect(rates(m, 'USDJPY')).toBe(-1);
    expect(rates(m, 'EURUSD')).toBe(0);
    expect(m.rows.find((r) => r.symbol === 'USDJPY')?.cells.rates?.explanation).toContain('decision calendar');
  });

  it('keeps the snapshot while no bank has decided since it was read', () => {
    const m = board(calendar(), '2026-09-01T12:00:00Z');
    // Snapshot 2026-09-01: EUR +1, USD +1 -> EURUSD 0; GBP +1, JPY +1 -> GBPJPY 0; NZD +1 -> NZDUSD 0.
    expect(rates(m, 'EURUSD')).toBe(0);
    expect(m.rows.find((r) => r.symbol === 'EURUSD')?.cells.rates?.explanation).toContain('snapshot read 2026-09-01');
  });
});
