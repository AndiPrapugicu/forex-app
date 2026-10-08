import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, Position } from '@/lib/types';
import type { Bar } from './levels';
import type { FlipCondition, PairNarrative } from './state';
import {
  averageTrueRange,
  daysOnSide,
  evaluateThesis,
  firedConditions,
  rememberFired,
  structureLevel,
  type FiredFlip,
  type ThesisInputs,
} from './thesis';

const DAY = 86_400_000;
const T0 = Date.parse('2026-08-31T00:00:00Z');

/** A piecewise-linear close path through the knots, ±0.002 high/low. */
function path(knots: [number, number][]): Bar[] {
  const out: Bar[] = [];
  for (let k = 0; k < knots.length - 1; k++) {
    const [i0, p0] = knots[k];
    const [i1, p1] = knots[k + 1];
    for (let i = i0; i < i1; i++) {
      const c = p0 + ((p1 - p0) * (i - i0)) / (i1 - i0);
      out.push({ t: T0 + i * DAY, h: c + 0.002, l: c - 0.002, c });
    }
  }
  const [iz, pz] = knots[knots.length - 1];
  out.push({ t: T0 + iz * DAY, h: pz + 0.002, l: pz - 0.002, c: pz });
  return out;
}

// Low 1.00 on day 5, high 1.08 on day 10, higher low 1.05 on day 15, then up to 1.12.
const UP = path([[0, 1.03], [5, 1.0], [10, 1.08], [15, 1.05], [25, 1.12]]);
const AFTER_UP = new Date(T0 + 27 * DAY);

const position: Position = {
  id: 'p1',
  symbol: 'EURUSD',
  side: 'long',
  entryDate: '2026-09-20',
  entryPrice: 1.09,
  stopLoss: 1.04,
  takeProfit: 1.2,
  size: null,
  riskPct: 1,
  thesis: null,
  openedAtUtc: '2026-09-20T08:00:00.000Z',
  closedAtUtc: null,
  closePrice: null,
  lastStatus: null,
  lastStatusAtUtc: null,
};

function narrative(tactical: string, structural: string, flips: Partial<FlipCondition>[] = []): PairNarrative {
  return {
    tactical: { label: tactical, text: `${tactical} — test` },
    structural: { label: structural, text: `${structural} — test` },
    flips,
  } as unknown as PairNarrative;
}

function inputs(over: Partial<ThesisInputs> = {}): ThesisInputs {
  return {
    position,
    bars: UP,
    price: 1.12,
    boardScore: 10,
    entryScore: 12,
    boardHistory: [],
    narrative: narrative('BULLISH', 'BULLISH'),
    fired: [],
    now: AFTER_UP,
    ...over,
  };
}

describe('structureLevel', () => {
  it('finds the last higher low for a long', () => {
    expect(structureLevel(UP, 'long')).toEqual({ kind: 'HL', price: 1.048, date: '2026-09-15' });
  });

  it('finds the last lower high for a short, mirrored', () => {
    const down = path([[0, 1.05], [5, 1.08], [10, 1.0], [15, 1.03], [25, 0.96]]);
    expect(structureLevel(down, 'short')).toEqual({ kind: 'LH', price: 1.032, date: '2026-09-15' });
  });

  it('falls back to the last swing, and says so, when there is no HL', () => {
    const one = path([[0, 1.03], [5, 1.0], [15, 1.1]]);
    expect(structureLevel(one, 'long')).toMatchObject({ kind: 'swing low', price: 0.998 });
  });
});

describe('evaluateThesis', () => {
  it('is GREEN with nothing against, and reports R and the structure', () => {
    const r = evaluateThesis(inputs());
    expect(r.status).toBe('green');
    expect(r.signals).toEqual([]);
    expect(r.structure?.kind).toBe('HL');
    expect(r.rNow).toBeCloseTo(0.6, 6);
    expect(r.rTarget).toBeCloseTo(2.2, 6);
  });

  it('is RED on a daily close below the last HL', () => {
    const broken = path([[0, 1.03], [5, 1.0], [10, 1.08], [15, 1.05], [25, 1.12], [30, 1.04]]);
    const r = evaluateThesis(inputs({ bars: broken, price: 1.04, now: new Date(T0 + 32 * DAY) }));
    expect(r.status).toBe('red');
    expect(r.signals[0]).toMatchObject({ code: 'structure' });
    expect(r.signals[0].text).toMatch(/Daily close 1\.04 \(2026-09-30\) is below the last HL 1\.048 \(2026-09-15\)/);
  });

  it('ignores the session still trading', () => {
    // The live bar sits below the HL but has not closed.
    const live = [...UP, { t: AFTER_UP.getTime() - 3_600_000, h: 1.05, l: 1.03, c: 1.04 }];
    const r = evaluateThesis(inputs({ bars: live, price: 1.04 }));
    expect(r.signals.find((s) => s.code === 'structure')).toBeUndefined();
  });

  it('is YELLOW when price is within half an ATR of the HL', () => {
    const atr = averageTrueRange(UP)!;
    const r = evaluateThesis(inputs({ price: 1.048 + atr * 0.4 }));
    expect(r.status).toBe('yellow');
    expect(r.signals.map((s) => s.code)).toEqual(['near-structure']);
  });

  it('is RED once the board leaves the band', () => {
    const r = evaluateThesis(inputs({ boardScore: 3 }));
    expect(r.status).toBe('red');
    expect(r.signals[0].text).toBe('Board +3 has left the +4 or higher band a long needs');
  });

  it('is YELLOW on 40% erosion still inside the band', () => {
    const r = evaluateThesis(inputs({ boardScore: 6, entryScore: 12 }));
    expect(r.status).toBe('yellow');
    expect(r.signals[0].text).toBe('Board +6, down 50% from +12 at entry');
    expect(evaluateThesis(inputs({ boardScore: 8, entryScore: 12 })).status).toBe('green');
  });

  it('is RED on a tactical narrative against, YELLOW on a structural one', () => {
    expect(evaluateThesis(inputs({ narrative: narrative('BEARISH', 'BULLISH') })).status).toBe('red');
    const s = evaluateThesis(inputs({ narrative: narrative('NEUTRAL', 'BEARISH') }));
    expect(s.status).toBe('yellow');
    expect(s.signals[0].code).toBe('structural');
  });

  it('is YELLOW on a flip against the position due within three days only', () => {
    const due = (days: number, favours: 'bullish' | 'bearish') => ({
      text: `US CPI in ${days}d`,
      favours,
      dueUtc: new Date(AFTER_UP.getTime() + days * DAY).toISOString(),
    });
    const r = evaluateThesis(inputs({ narrative: narrative('BULLISH', 'BULLISH', [due(2, 'bearish'), due(5, 'bearish'), due(1, 'bullish')]) }));
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]).toMatchObject({ level: 'yellow', code: 'flip-due', text: 'Due within 3 days: US CPI in 2d' });
  });

  it('is RED on a fired flip against the position, inside the memory and after entry', () => {
    const fired = (daysAgo: number, favours: 'bullish' | 'bearish', symbol = 'EURUSD'): FiredFlip => ({
      id: `f${daysAgo}${favours}${symbol}`,
      symbol,
      text: 'US CPI at or above 3.1%',
      favours,
      firedAtUtc: new Date(AFTER_UP.getTime() - daysAgo * DAY).toISOString(),
      value: 3.2,
    });
    expect(evaluateThesis(inputs({ fired: [fired(1, 'bearish')] })).status).toBe('red');
    expect(evaluateThesis(inputs({ fired: [fired(4, 'bearish')] })).status).toBe('green');
    expect(evaluateThesis(inputs({ fired: [fired(1, 'bullish')] })).status).toBe('green');
    expect(evaluateThesis(inputs({ fired: [fired(1, 'bearish', 'GBPUSD')] })).status).toBe('green');
    const late = { ...position, entryDate: AFTER_UP.toISOString().slice(0, 10) };
    expect(evaluateThesis(inputs({ position: late, fired: [fired(1, 'bearish')] })).status).toBe('green');
  });

  it('orders RED signals before YELLOW', () => {
    const r = evaluateThesis(inputs({ boardScore: 2, narrative: narrative('NEUTRAL', 'BEARISH') }));
    expect(r.signals.map((s) => s.level)).toEqual(['red', 'yellow']);
  });

  it('reads a short against the negative band', () => {
    const short = { ...position, side: 'short' as const, entryPrice: 1.12, stopLoss: 1.15, takeProfit: 1.05 };
    const r = evaluateThesis(inputs({ position: short, boardScore: -3, narrative: narrative('BEARISH', 'BEARISH') }));
    expect(r.signals.find((s) => s.code === 'band')?.text).toBe('Board −3 has left the −4 or lower band a short needs');
  });
});

describe('daysOnSide', () => {
  const at = (d: number) => new Date(T0 + d * DAY).toISOString();
  it('counts back to the first capture of the current run', () => {
    const h = [{ atUtc: at(0), score: 2 }, { atUtc: at(3), score: 5 }, { atUtc: at(6), score: 9 }, { atUtc: at(9), score: 7 }];
    expect(daysOnSide(h, 'long', new Date(T0 + 10 * DAY))).toBe(7);
    expect(daysOnSide(h, 'short', new Date(T0 + 10 * DAY))).toBe(0);
    expect(daysOnSide([], 'long', new Date())).toBeNull();
  });
});

describe('firedConditions', () => {
  const event = { id: 'us-cpi', actual: 3.2 } as NormalizedEvent;
  const data = {
    events: [event],
    close: (k: string) => ({ 'BZ=F': 88, 'ZQF27.CBT': 95.9 })[k] ?? null,
    yield2y: (c: string) => (c === 'EUR' ? 2.1 : null),
  };
  const cond = (id: string, check: FlipCondition['check']) => ({ id, check }) as FlipCondition;

  it('checks releases, closes and 2-year yields, each in its direction', () => {
    const hits = firedConditions(
      [
        cond('cpi-up', { type: 'release', eventId: 'us-cpi', op: '>=', threshold: 3.1 }),
        cond('cpi-down', { type: 'release', eventId: 'us-cpi', op: '<=', threshold: 2.9 }),
        cond('pending', { type: 'release', eventId: 'unknown', op: '>=', threshold: 0 }),
        cond('brent', { type: 'close', key: 'BZ=F', op: '<=', threshold: 90 }),
        cond('fed', { type: 'close', key: 'ZQF27.CBT', op: '<=', threshold: 95.71 }),
        cond('eur2y', { type: 'yield2y', currency: 'EUR', op: '<=', threshold: 2.15 }),
        cond('usd2y', { type: 'yield2y', currency: 'USD', op: '<=', threshold: 9 }),
      ],
      data,
    );
    expect(hits.map((h) => [h.condition.id, h.value])).toEqual([
      ['cpi-up', 3.2],
      ['brent', 88],
      ['eur2y', 2.1],
    ]);
  });
});

describe('rememberFired', () => {
  const f = (id: string, daysAgo: number): FiredFlip => ({
    id,
    symbol: 'EURUSD',
    text: id,
    favours: 'bearish',
    firedAtUtc: new Date(AFTER_UP.getTime() - daysAgo * DAY).toISOString(),
    value: 1,
  });
  it('keeps the first firing of each condition and forgets old ones', () => {
    const kept = rememberFired([f('a', 4), f('b', 2)], [f('b', 0), f('c', 0)], AFTER_UP);
    expect(kept.map((k) => [k.id, k.firedAtUtc.slice(0, 10)])).toEqual([
      ['b', '2026-09-25'],
      ['c', '2026-09-27'],
    ]);
  });
});
