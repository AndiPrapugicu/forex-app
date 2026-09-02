/**
 * The Eco Strength Index is implemented because it REPRODUCES.
 *
 * A1's page publishes both its inputs and its sub-scores, so the construction
 * can be checked rather than assumed — and it lands on all 32 cells with no
 * residual. That is the bar this module was adopted against, and this file is
 * the record of it. If a future change breaks the reproduction, the rule has
 * been altered and the provenance claim in eco-strength.ts is no longer true.
 *
 * Fixture: fixtures/a1-eco-strength-index-2026-08-31.csv
 */

import { describe, expect, it } from 'vitest';
import type { SlotResult } from '@/lib/scoring/discrete';
import type { CurrencySlotScores } from '@/lib/scoring/setups';
import {
  BEARISH_BELOW,
  BULLISH_AT,
  COMPONENT_MAX,
  buildEcoStrengthInputs,
  computeEcoStrength,
  type EcoStrengthInput,
} from '@/lib/scoring/eco-strength';
import type { Currency, NormalizedEvent } from '@/lib/types';

/** A1's published inputs, 2026-08-31. */
const SNAPSHOT: EcoStrengthInput[] = [
  { currency: 'CHF', gdpGrowth: 1.5, unemploymentRate: 3.0, interestRate: 0.0, cpiYoY: 0.4 },
  { currency: 'USD', gdpGrowth: 1.5, unemploymentRate: 4.1, interestRate: 3.75, cpiYoY: 3.4 },
  { currency: 'JPY', gdpGrowth: 0.3, unemploymentRate: 2.4, interestRate: 1.0, cpiYoY: 1.9 },
  { currency: 'GBP', gdpGrowth: 0.4, unemploymentRate: 4.9, interestRate: 3.75, cpiYoY: 2.9 },
  { currency: 'AUD', gdpGrowth: 0.3, unemploymentRate: 4.5, interestRate: 4.35, cpiYoY: 3.5 },
  { currency: 'CAD', gdpGrowth: 0.8, unemploymentRate: 6.4, interestRate: 2.25, cpiYoY: 3.0 },
  { currency: 'NZD', gdpGrowth: 0.8, unemploymentRate: 5.6, interestRate: 2.5, cpiYoY: 4.1 },
  { currency: 'EUR', gdpGrowth: 0.4, unemploymentRate: 6.3, interestRate: 2.4, cpiYoY: 2.9 },
];

/** A1's published sub-scores, totals and real yields for that same snapshot. */
const PUBLISHED = {
  CHF: { gdp: 25, unemployment: 21, cpi: 25, rate: 0, total: 71, realYield: -0.4 },
  USD: { gdp: 25, unemployment: 14, cpi: 5, rate: 22, total: 66, realYield: 0.35 },
  JPY: { gdp: 0, unemployment: 25, cpi: 15, rate: 6, total: 46, realYield: -0.9 },
  GBP: { gdp: 2, unemployment: 9, cpi: 8, rate: 22, total: 41, realYield: 0.85 },
  AUD: { gdp: 0, unemployment: 12, cpi: 4, rate: 25, total: 41, realYield: 0.85 },
  CAD: { gdp: 10, unemployment: 0, cpi: 7, rate: 13, total: 30, realYield: -0.75 },
  NZD: { gdp: 10, unemployment: 5, cpi: 0, rate: 14, total: 29, realYield: -1.6 },
  EUR: { gdp: 2, unemployment: 1, cpi: 8, rate: 14, total: 25, realYield: -0.5 },
} as const;

describe('reproduces A1s published Eco Strength Index', () => {
  const rows = computeEcoStrength(SNAPSHOT);
  const row = (c: keyof typeof PUBLISHED) => rows.find((r) => r.currency === c)!;

  it.each(Object.keys(PUBLISHED) as (keyof typeof PUBLISHED)[])(
    'reproduces every sub-score for %s',
    (currency) => {
      const got = row(currency);
      const want = PUBLISHED[currency];
      expect(got.gdpScore).toBe(want.gdp);
      expect(got.unemploymentScore).toBe(want.unemployment);
      expect(got.cpiScore).toBe(want.cpi);
      expect(got.interestRateScore).toBe(want.rate);
    },
  );

  it('reproduces all 32 sub-scores with no residual', () => {
    const wrong = rows.filter((r) => {
      const want = PUBLISHED[r.currency as keyof typeof PUBLISHED];
      return (
        r.gdpScore !== want.gdp ||
        r.unemploymentScore !== want.unemployment ||
        r.cpiScore !== want.cpi ||
        r.interestRateScore !== want.rate
      );
    });
    expect(wrong.map((r) => r.currency)).toEqual([]);
  });

  it('reproduces every total', () => {
    for (const r of rows) {
      expect(r.totalScore, r.currency).toBe(PUBLISHED[r.currency as keyof typeof PUBLISHED].total);
    }
  });

  it('reproduces real yield as policy rate minus headline CPI', () => {
    for (const r of rows) {
      expect(r.realYield, r.currency).toBe(
        PUBLISHED[r.currency as keyof typeof PUBLISHED].realYield,
      );
    }
  });

  it('reproduces the published bias labels', () => {
    // The thresholds are OURS, chosen inside the gaps the snapshot leaves. This
    // asserts they are at least consistent with what A1 printed.
    expect(row('CHF').bias).toBe('Bullish');
    expect(row('USD').bias).toBe('Bullish');
    expect(row('JPY').bias).toBe('Neutral');
    expect(row('GBP').bias).toBe('Neutral');
    expect(row('AUD').bias).toBe('Neutral');
    expect(row('CAD').bias).toBe('Bearish');
    expect(row('NZD').bias).toBe('Bearish');
    expect(row('EUR').bias).toBe('Bearish');
  });

  it('ranks strongest first', () => {
    expect(rows.map((r) => r.currency)).toEqual(['CHF', 'USD', 'JPY', 'AUD', 'GBP', 'CAD', 'NZD', 'EUR']);
  });

  it('leaves the bias thresholds inside the band the snapshot allows', () => {
    // 46 was Neutral and 66 Bullish; 30 was Bearish and 41 Neutral. Anything
    // outside those gaps would contradict the capture rather than interpret it.
    expect(BULLISH_AT).toBeGreaterThan(46);
    expect(BULLISH_AT).toBeLessThanOrEqual(66);
    expect(BEARISH_BELOW).toBeGreaterThan(30);
    expect(BEARISH_BELOW).toBeLessThanOrEqual(41);
  });
});

describe('the directions are not interchangeable', () => {
  it('rewards low unemployment and low inflation, high growth and high rates', () => {
    const rows = computeEcoStrength(SNAPSHOT);
    const jpy = rows.find((r) => r.currency === 'JPY')!;
    const cad = rows.find((r) => r.currency === 'CAD')!;

    // Japan has the lowest unemployment of the eight and takes full marks;
    // Canada has the highest and takes none. Flipping the direction here is the
    // single most likely way to silently corrupt this table.
    expect(jpy.unemploymentRate).toBeLessThan(cad.unemploymentRate!);
    expect(jpy.unemploymentScore).toBe(COMPONENT_MAX);
    expect(cad.unemploymentScore).toBe(0);

    // Australia holds the highest policy rate and takes full marks.
    expect(rows.find((r) => r.currency === 'AUD')!.interestRateScore).toBe(COMPONENT_MAX);
    expect(rows.find((r) => r.currency === 'CHF')!.interestRateScore).toBe(0);
  });
});

describe('missing readings stay missing', () => {
  const partial: EcoStrengthInput[] = [
    { currency: 'USD', gdpGrowth: 1.5, unemploymentRate: 4.1, interestRate: 3.75, cpiYoY: 3.4 },
    { currency: 'EUR', gdpGrowth: 0.4, unemploymentRate: 6.3, interestRate: 2.4, cpiYoY: 2.9 },
    { currency: 'NZD', gdpGrowth: null, unemploymentRate: 5.6, interestRate: null, cpiYoY: 4.1 },
  ];

  it('scores null rather than zero, and says how many components landed', () => {
    const nzd = computeEcoStrength(partial).find((r) => r.currency === 'NZD')!;
    expect(nzd.gdpScore).toBeNull();
    expect(nzd.interestRateScore).toBeNull();
    expect(nzd.componentsScored).toBe(2);
    // A null component must not be read as a zero contribution dressed up as a
    // score — the total is the sum of what actually scored.
    expect(nzd.totalScore).toBe((nzd.unemploymentScore ?? 0) + (nzd.cpiScore ?? 0));
  });

  it('refuses a real yield when either half is missing', () => {
    const nzd = computeEcoStrength(partial).find((r) => r.currency === 'NZD')!;
    expect(nzd.realYield).toBeNull();
  });

  it('normalises against the currencies that do have the reading', () => {
    const rows = computeEcoStrength(partial);
    // Only USD and EUR carry a rate, so they define that scale between them.
    expect(rows.find((r) => r.currency === 'USD')!.interestRateScore).toBe(COMPONENT_MAX);
    expect(rows.find((r) => r.currency === 'EUR')!.interestRateScore).toBe(0);
  });
});

describe('the scale is relative, and behaves like it', () => {
  it('gives a tie full marks rather than none', () => {
    const flat: EcoStrengthInput[] = ['USD', 'EUR'].map((c) => ({
      currency: c as EcoStrengthInput['currency'],
      gdpGrowth: 1.0,
      unemploymentRate: 4.0,
      interestRate: 2.0,
      cpiYoY: 2.0,
    }));
    const rows = computeEcoStrength(flat);
    expect(rows.every((r) => r.totalScore === 4 * COMPONENT_MAX)).toBe(true);
  });

  it('rescores the same economy differently in a different cohort', () => {
    // Not a defect — it is what "relative" means, and the reason a row is only
    // meaningful beside the rows it was computed with.
    const full = computeEcoStrength(SNAPSHOT).find((r) => r.currency === 'GBP')!;
    const pair = computeEcoStrength(
      SNAPSHOT.filter((i) => i.currency === 'GBP' || i.currency === 'EUR'),
    ).find((r) => r.currency === 'GBP')!;
    expect(pair.totalScore).not.toBe(full.totalScore);
  });
});

/**
 * The adapter is where this index meets the rest of the app, and it has exactly
 * one way to go badly wrong: reading the SCORE off a slot instead of the LEVEL.
 * Both are numbers on the same object and either would produce a table, but a
 * table built from surprises answers a question this index does not ask.
 */
describe('buildEcoStrengthInputs', () => {
  const slot = (actual: number | null, cell: number): SlotResult => ({
    slotKey: 'x',
    currency: 'USD',
    cell,
    status: 'scored',
    event: actual === null ? null : ({ actual } as NormalizedEvent),
    sigma: null,
    ageDays: 0,
    explanation: '',
  });

  const scores = (
    entries: Record<string, Record<string, SlotResult>>,
  ): CurrencySlotScores =>
    new Map(
      Object.entries(entries).map(([currency, slots]) => [
        currency as Currency,
        new Map(Object.entries(slots)),
      ]),
    );

  it('reads the LEVEL a release printed, never the cell beside it', () => {
    // A -2 cell on a 4.1% unemployment print: the index wants 4.1, and taking
    // the -2 would rank the economy on how badly it missed instead.
    const built = buildEcoStrengthInputs(
      ['USD'],
      scores({
        USD: {
          gdp: slot(1.5, 0),
          unemployment: slot(4.1, -2),
          cpi: slot(3.4, 1),
        },
      }),
      new Map([['USD' as Currency, 3.75]]),
    );
    expect(built).toEqual([
      { currency: 'USD', gdpGrowth: 1.5, unemploymentRate: 4.1, interestRate: 3.75, cpiYoY: 3.4 },
    ]);
  });

  it('takes the policy rate from the rates map, not from the calendar', () => {
    // The rate is a STANDING STATE, not a print, so there is no event to read.
    const built = buildEcoStrengthInputs(['EUR'], scores({ EUR: {} }), new Map([['EUR' as Currency, 2.25]]));
    expect(built[0].interestRate).toBe(2.25);
  });

  it('leaves an unresolved slot null rather than zero', () => {
    const built = buildEcoStrengthInputs(
      ['NZD'],
      scores({ NZD: { gdp: slot(null, 0), cpi: slot(4.1, 1) } }),
      new Map(),
    );
    expect(built[0].gdpGrowth).toBeNull();
    expect(built[0].unemploymentRate).toBeNull();
    expect(built[0].interestRate).toBeNull();
    expect(built[0].cpiYoY).toBe(4.1);
  });

  it('survives a currency the pipeline produced no scores for at all', () => {
    const built = buildEcoStrengthInputs(['CHF'], new Map(), new Map());
    expect(built[0]).toEqual({
      currency: 'CHF',
      gdpGrowth: null,
      unemploymentRate: null,
      interestRate: null,
      cpiYoY: null,
    });
  });

  it('feeds computeEcoStrength something it can rank', () => {
    // End to end, so a change to either side that breaks the seam is caught.
    const rows = computeEcoStrength(
      buildEcoStrengthInputs(
        ['USD', 'EUR'],
        scores({
          USD: { gdp: slot(1.5, 0), unemployment: slot(4.1, 0), cpi: slot(3.4, 0) },
          EUR: { gdp: slot(0.4, 0), unemployment: slot(6.3, 0), cpi: slot(2.9, 0) },
        }),
        new Map([
          ['USD' as Currency, 3.75],
          ['EUR' as Currency, 2.25],
        ]),
      ),
    );
    // USD leads on growth, jobs and rate; EUR only on inflation.
    expect(rows[0].currency).toBe('USD');
    expect(rows[0].componentsScored).toBe(4);
    expect(rows.find((r) => r.currency === 'EUR')!.cpiScore).toBe(COMPONENT_MAX);
  });
});
