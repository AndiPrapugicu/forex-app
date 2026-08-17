/**
 * Cross-market reads.
 *
 * The recurring hazard in this module is SIGN. Three of the six risk inputs
 * invert, carry reads differently depending on which way you take the pair, and
 * a currency's macro cells already have polarity applied. Each of those is
 * pinned below, because getting one backwards produces a plausible-looking
 * number that is exactly wrong.
 */

import { describe, expect, it } from 'vitest';
import {
  RISK_INPUTS,
  buildCarryTable,
  buildRiskGauge,
  buildSmartMoney,
  buildStrengthIndex,
  buildSurpriseIndex,
  labelRisk,
} from '@/lib/scoring/market';
import type { CotReport, CotSeries } from '@/lib/connectors/cftc';
import type { Technicals } from '@/lib/connectors/technicals';
import type { CurrencySlotScores } from '@/lib/scoring/setups';
import type { Currency, NormalizedEvent } from '@/lib/types';

function tech(symbol: string, price: number, smaSlow: number): Technicals {
  return {
    symbol,
    price,
    smaFast: price,
    smaSlow,
    smaSlowPrior: smaSlow,
    sma20: null, sma50: null, sma100: null, sma200: null,
    aboveCount: null, smaCount: 0,
    realizedVolPct: null, avgDailyMove7Pct: null, avgDailyMove90Pct: null,
    seasonality: {},
  };
}

/** All six inputs pointing the same way, `riskOn` deciding which way. */
function allInputs(riskOn: boolean): Map<string, Technicals> {
  const map = new Map<string, Technicals>();
  for (const input of RISK_INPUTS) {
    // Rising when the input is risk-on-positive and we want risk-on, or when it
    // is inverted and we want risk-off.
    const rising = input.riskOnWhenRising === riskOn;
    map.set(input.symbol, tech(input.symbol, rising ? 110 : 90, 100));
  }
  return map;
}

function cotSeries(contract: string, o: Partial<CotReport> = {}): CotSeries {
  const report: CotReport = {
    contract, reportDate: '2026-08-04',
    specLong: 60_000, specShort: 40_000, specNet: 20_000, specLongPct: 60,
    commLong: 0, commShort: 0, commNet: 0,
    retailLong: 5_000, retailShort: 5_000, retailNet: 0, retailLongPct: 50,
    openInterest: 100_000, openInterestChange: 0, specNetChange: 0, specLongPctChange: 0, specLongChange: 0, specShortChange: 0,
    ...o,
  };
  return { contract, reports: [report] };
}

function makeEvent(o: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    seriesId: null,
    name: 'Consumer Price Index (YoY)',
    currency: 'USD',
    countryCode: 'US',
    dateUtc: new Date().toISOString(),
    impact: 'HIGH',
    actual: 3.5, consensus: 3.0, previous: 3.0, revised: null, unit: '%',
    ratioDeviation: 1, isBetterThanExpected: true,
    isSpeech: false, isPreliminary: false,
    source: 'fxstreet', actualSource: 'fxstreet', sourceUrl: null, lastUpdated: null,
    ...o,
  } as NormalizedEvent;
}

describe('risk gauge', () => {
  it('reaches +6 when every input says risk-on', () => {
    const gauge = buildRiskGauge(allInputs(true));
    expect(gauge.score).toBe(6);
    expect(gauge.label).toBe('Heavy risk-on');
    expect(gauge.populated).toBe(6);
  });

  it('reaches -6 when every input says risk-off', () => {
    expect(buildRiskGauge(allInputs(false)).score).toBe(-6);
  });

  it('INVERTS VIX, gold and the dollar', () => {
    /**
     * The core sign test. A rising VIX is risk-OFF, so it must score -1 even
     * though the raw price went up. Getting this backwards would still produce a
     * gauge that moves — just one that means the opposite of what it says.
     */
    const inverted = RISK_INPUTS.filter((i) => !i.riskOnWhenRising).map((i) => i.key);
    expect(inverted).toEqual(['VIX', 'GOLD', 'DXY']);

    const rising = new Map([['VIX', tech('VIX', 110, 100)]]);
    const vix = buildRiskGauge(rising).components.find((c) => c.key === 'VIX')!;
    expect(vix.cell).toBe(-1);
    expect(vix.inverted).toBe(true);
  });

  it('scores a rising S&P as risk-on', () => {
    const rising = new Map([['SPX500', tech('SPX500', 110, 100)]]);
    expect(buildRiskGauge(rising).components.find((c) => c.key === 'SPX')!.cell).toBe(1);
  });

  it('counts a missing input as 0 and reports the thin sample', () => {
    // A 1-of-6 reading must not masquerade as a confident neutral.
    const gauge = buildRiskGauge(new Map([['SPX500', tech('SPX500', 110, 100)]]));
    expect(gauge.score).toBe(1);
    expect(gauge.populated).toBe(1);
  });

  it('bands the score at 3 and 5', () => {
    expect(labelRisk(6)).toBe('Heavy risk-on');
    expect(labelRisk(5)).toBe('Heavy risk-on');
    expect(labelRisk(4)).toBe('Risk-on');
    expect(labelRisk(3)).toBe('Risk-on');
    expect(labelRisk(2)).toBe('Neutral');
    expect(labelRisk(-2)).toBe('Neutral');
    expect(labelRisk(-3)).toBe('Risk-off');
    expect(labelRisk(-5)).toBe('Heavy risk-off');
  });
});

describe('smart money', () => {
  it('spreads institutional net against retail net', () => {
    const cot = new Map([
      // Specs +20%, retail -20% -> spread 40.
      ['GOLD', cotSeries('GOLD', {
        specLong: 60_000, specShort: 40_000,
        retailLong: 4_000, retailShort: 6_000, retailLongPct: 40,
      })],
    ]);

    const [row] = buildSmartMoney(cot);
    expect(row.specNetPct).toBe(20);
    expect(row.retailNetPct).toBe(-20);
    expect(row.spread).toBe(40);
    expect(row.divergent).toBe(true);
  });

  it('does not call agreement a divergence', () => {
    const cot = new Map([
      ['GOLD', cotSeries('GOLD', {
        specLong: 60_000, specShort: 40_000,
        retailLong: 6_000, retailShort: 4_000,
      })],
    ]);
    expect(buildSmartMoney(cot)[0].divergent).toBe(false);
  });

  it('skips contracts with negligible retail participation', () => {
    const cot = new Map([['GOLD', cotSeries('GOLD', { retailLong: 100, retailShort: 100 })]]);
    expect(buildSmartMoney(cot)).toEqual([]);
  });

  it('ranks the widest disagreement first', () => {
    const cot = new Map([
      ['NARROW', cotSeries('NARROW', { specLong: 51_000, specShort: 49_000, retailLong: 5_000, retailShort: 5_000 })],
      ['WIDE', cotSeries('WIDE', { specLong: 90_000, specShort: 10_000, retailLong: 1_000, retailShort: 9_000 })],
    ]);
    expect(buildSmartMoney(cot)[0].contract).toBe('WIDE');
  });
});

describe('surprise index', () => {
  it('reads 100 when every tracked release beat', () => {
    const events = [
      makeEvent({ name: 'Consumer Price Index (YoY)', actual: 3.5, consensus: 3.0 }),
      makeEvent({ name: 'Producer Price Index (YoY)', actual: 5.5, consensus: 5.0 }),
    ];
    const index = buildSurpriseIndex('USD', events);
    expect(index.beats).toBe(2);
    expect(index.misses).toBe(0);
    expect(index.index).toBe(100);
  });

  it('reads 0 when every tracked release missed', () => {
    const events = [
      makeEvent({ name: 'Consumer Price Index (YoY)', actual: 2.5, consensus: 3.0 }),
      makeEvent({ name: 'Producer Price Index (YoY)', actual: 4.5, consensus: 5.0 }),
    ];
    expect(buildSurpriseIndex('USD', events).index).toBe(0);
  });

  it('counts an on-forecast print as half a beat, not as nothing', () => {
    // Dropping it would let one lucky beat alongside four exact prints read 100%.
    const events = [
      makeEvent({ name: 'Consumer Price Index (YoY)', actual: 3.0, consensus: 3.0 }),
      makeEvent({ name: 'Producer Price Index (YoY)', actual: 5.5, consensus: 5.0 }),
    ];
    const index = buildSurpriseIndex('USD', events);
    expect(index.inline).toBe(1);
    expect(index.index).toBe(75); // (1 beat + 0.5) / 2
  });

  it('respects polarity — a LOWER unemployment print is a beat', () => {
    const events = [makeEvent({ name: 'Unemployment Rate', actual: 4.0, consensus: 4.3, unit: '%' })];
    const index = buildSurpriseIndex('USD', events);
    expect(index.beats).toBe(1);
    expect(index.index).toBe(100);
  });

  it('returns a neutral 50 with nothing to measure, and says the sample is empty', () => {
    const index = buildSurpriseIndex('USD', []);
    expect(index.index).toBe(50);
    expect(index.sampled).toBe(0);
  });
});

describe('strength index', () => {
  const scores: CurrencySlotScores = new Map();

  it('computes real yield as policy rate minus CPI', () => {
    // The number that explains why a high nominal rate is not automatically
    // strong: 5% against 6% inflation is a negative real return.
    const rows = buildStrengthIndex(
      ['USD', 'EUR'] as Currency[],
      scores,
      new Map([['USD', 5], ['EUR', 2]] as [Currency, number][]),
      new Map([['USD', 6], ['EUR', 1]] as [Currency, number][]),
      [],
    );

    expect(rows.find((r) => r.currency === 'USD')!.realYield).toBe(-1);
    expect(rows.find((r) => r.currency === 'EUR')!.realYield).toBe(1);
  });

  it('leaves real yield null rather than guessing at a missing rate', () => {
    const rows = buildStrengthIndex(['USD'] as Currency[], scores, new Map(), new Map(), []);
    expect(rows[0].realYield).toBeNull();
  });

  it('ranks every currency exactly once', () => {
    const all = ['USD', 'EUR', 'GBP', 'JPY'] as Currency[];
    const rows = buildStrengthIndex(all, scores, new Map(), new Map(), []);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe('carry table', () => {
  const pairs = [
    { symbol: 'EURJPY', label: 'EUR/JPY', base: 'EUR' as Currency, quote: 'JPY' as Currency },
    { symbol: 'EURUSD', label: 'EUR/USD', base: 'EUR' as Currency, quote: 'USD' as Currency },
  ];
  const rates = new Map([['EUR', 2.25], ['JPY', 0.5], ['USD', 4.0]] as [Currency, number][]);

  it('keeps the sign of base minus quote', () => {
    const eurjpy = buildCarryTable(pairs, rates).find((r) => r.symbol === 'EURJPY')!;
    expect(eurjpy.carry).toBe(1.75);
    expect(eurjpy.direction).toBe('long');
  });

  it('states that a negative carry is collected on the SHORT side', () => {
    // EUR 2.25 vs USD 4.0 is -1.75 long, which means +1.75 short. Showing only
    // the signed number invites reading it backwards.
    const eurusd = buildCarryTable(pairs, rates).find((r) => r.symbol === 'EURUSD')!;
    expect(eurusd.carry).toBe(-1.75);
    expect(eurusd.direction).toBe('short');
  });

  it('omits a pair with a missing rate rather than assuming zero', () => {
    // Treating an unknown rate as 0% would manufacture the biggest carry in the
    // table out of missing data.
    const partial = new Map([['EUR', 2.25]] as [Currency, number][]);
    expect(buildCarryTable(pairs, partial)).toEqual([]);
  });

  it('ranks the widest differential first', () => {
    const wide = [
      ...pairs,
      { symbol: 'USDJPY', label: 'USD/JPY', base: 'USD' as Currency, quote: 'JPY' as Currency },
    ];
    expect(buildCarryTable(wide, rates)[0].symbol).toBe('USDJPY'); // 4.0 - 0.5 = 3.5
  });
});
