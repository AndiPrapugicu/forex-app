/**
 * Economic heatmap.
 *
 * Three things here are easy to get subtly wrong and invisible once wrong: the
 * two impact columns must disagree where the market disagrees, the surprise must
 * be measured against whatever the score actually used, and an indicator an
 * economy never publishes must not look like missing data.
 */

import { describe, expect, it } from 'vitest';
import { bullishShare, buildCurrencyHeatmap } from '@/lib/scoring/heatmap';
import type { NormalizedEvent } from '@/lib/types';

function makeEvent(o: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    seriesId: null,
    name: 'Consumer Price Index (YoY)',
    currency: 'USD',
    countryCode: 'US',
    dateUtc: '2026-08-07T12:30:00.000Z',
    impact: 'HIGH',
    actual: 3.5,
    consensus: 3.8,
    previous: 4.2,
    revised: null,
    unit: '%',
    ratioDeviation: -1,
    isBetterThanExpected: false,
    isSpeech: false,
    isPreliminary: false,
    source: 'fxstreet',
    actualSource: 'fxstreet',
    sourceUrl: null,
    lastUpdated: null,
    ...o,
  } as NormalizedEvent;
}

const NOW = new Date('2026-08-09T00:00:00.000Z');

const rowFor = (map: ReturnType<typeof buildCurrencyHeatmap>, key: string) =>
  map.rows.find((r) => r.slotKey === key);

describe('the two impact columns', () => {
  it('reads a cooler CPI as bearish currency and BULLISH stocks', () => {
    /**
     * The headline case. Softer inflation means less room to hike — bad for the
     * currency, good for equities. A single impact column has to pick one and be
     * wrong about half the market, which is why A1 shows both.
     */
    const map = buildCurrencyHeatmap('USD', [makeEvent()], NOW);
    const cpi = rowFor(map, 'cpi')!;

    expect(cpi.currencyImpact).toBe(-1);
    expect(cpi.stocksImpact).toBe(1);
  });

  it('reads a hotter CPI the other way round', () => {
    const map = buildCurrencyHeatmap('USD', [makeEvent({ actual: 4.1, consensus: 3.8 })], NOW);
    const cpi = rowFor(map, 'cpi')!;

    expect(cpi.currencyImpact).toBe(1);
    expect(cpi.stocksImpact).toBe(-1);
  });

  it('AGREES on growth, where currency and stocks want the same thing', () => {
    // The two columns are not simply inverses of one another — only inflation
    // flips. A strong economy is good for both the currency and its equities.
    const gdp = makeEvent({
      name: 'Gross Domestic Product Annualized',
      actual: 2.8,
      consensus: 2.1,
      previous: 2.1,
    });
    const row = rowFor(buildCurrencyHeatmap('USD', [gdp], NOW), 'gdp')!;

    expect(row.currencyImpact).toBe(1);
    expect(row.stocksImpact).toBe(1);
  });

  it('agrees on jobs too', () => {
    const jobs = makeEvent({
      name: 'Nonfarm Payrolls',
      actual: 180,
      consensus: 120,
      previous: 100,
      unit: 'K',
    });
    const row = rowFor(buildCurrencyHeatmap('USD', [jobs], NOW), 'employment')!;

    expect(row.currencyImpact).toBe(1);
    expect(row.stocksImpact).toBe(1);
  });
});

describe('the surprise column', () => {
  it('measures against the forecast for an ordinary release', () => {
    const row = rowFor(buildCurrencyHeatmap('USD', [makeEvent()], NOW), 'cpi')!;
    expect(row.referenceLabel).toBe('forecast');
    expect(row.reference).toBe(3.8);
    expect(row.surprise).toBeCloseTo(-0.3, 5);
  });

  it('measures PMI against the FORECAST, which is what scores it', () => {
    /**
     * A1's PMI page says "change from previous data to latest data", which reads
     * like a previous-print comparison. Their product does not do that: on one
     * day's live figures, scoring against forecast reproduces all four of their
     * published PMI cells and scoring against previous reproduces two. The
     * sentence describes the change they display, not the one they score.
     *
     * ISM Services is the case that separates them — 54.1 beat the 54.0 previous
     * but MISSED the 54.5 forecast, and A1 scores it as a miss.
     */
    const services = makeEvent({
      name: 'ISM Services PMI',
      actual: 54.1,
      consensus: 54.5,
      previous: 54.0,
      unit: null,
    });
    const row = rowFor(buildCurrencyHeatmap('USD', [services], NOW), 'spmi')!;

    expect(row.referenceLabel).toBe('forecast');
    expect(row.reference).toBe(54.5);
    expect(row.surprise).toBeCloseTo(-0.4, 5);
    expect(row.currencyImpact).toBe(-1); // a miss, despite being up on the month
  });

  it('carries manufacturing and services as separate rows', () => {
    // Two independent columns in A1's table, not one composite. Collapsing them
    // hides which half of the economy is moving — and on their EURUSD the two
    // point opposite ways (-2 and +2) on the same day.
    const events = [
      makeEvent({ name: 'ISM Manufacturing PMI', actual: 55.6, consensus: 54, previous: 53.3, unit: null }),
      makeEvent({ name: 'ISM Services PMI', actual: 54.1, consensus: 54.5, previous: 54, unit: null }),
    ];
    const map = buildCurrencyHeatmap('USD', events, NOW);

    // Both scored against forecast, and they point OPPOSITE ways on this day —
    // which is precisely what a single merged column would have hidden.
    expect(rowFor(map, 'mpmi')?.currencyImpact).toBe(1); // 55.6 beat 54.0
    expect(rowFor(map, 'spmi')?.currencyImpact).toBe(-1); // 54.1 missed 54.5
  });
});

describe('which rows appear at all', () => {
  it('drops indicators the economy never publishes', () => {
    /**
     * The euro area has no payrolls, no JOLTS and no PCE. Listing them as empty
     * rows is what made the EUR heatmap look broken — nine blanks reading as
     * missing data when the series simply does not exist.
     */
    const hicp = makeEvent({
      name: 'Harmonized Index of Consumer Prices (YoY)',
      currency: 'EUR',
      countryCode: 'EMU',
    });
    const map = buildCurrencyHeatmap('EUR', [hicp], NOW);

    expect(rowFor(map, 'cpi')).toBeDefined();
    for (const absent of ['pce', 'jolts', 'adp', 'claims']) {
      expect(rowFor(map, absent), absent).toBeUndefined();
    }
  });

  it('KEEPS a stale row, because ageing out is information', () => {
    // "We had this and it went stale" and "this economy has no such series" are
    // different statements and must not render the same.
    const old = makeEvent({ dateUtc: '2026-01-01T00:00:00.000Z' });
    const map = buildCurrencyHeatmap('USD', [old], NOW);

    const cpi = rowFor(map, 'cpi')!;
    expect(cpi.status).toBe('stale');
    expect(cpi.currencyImpact).toBeNull();
  });
});

describe('impact percentages', () => {
  it('is the bullish share of resolved readings', () => {
    // A1's published EU card reads 57.14% — 4 bullish of 7 rows.
    expect(bullishShare([1, 1, 1, 1, -1, -1, -1])).toBeCloseTo(57.14, 2);
  });

  it('counts neutral rows in the denominator', () => {
    // Dropping them would let one beat alongside three exact prints read 100%.
    expect(bullishShare([1, 0, 0, 0])).toBe(25);
  });

  it('is null rather than 0 when nothing resolved', () => {
    // 0% would read as "everything is bearish", which is a claim we cannot make.
    expect(bullishShare([])).toBeNull();
    expect(bullishShare([null, null])).toBeNull();
  });

  it('reports both columns off the same rows', () => {
    const map = buildCurrencyHeatmap('USD', [makeEvent()], NOW);
    // One cooler CPI: bearish for the currency, bullish for stocks.
    expect(map.currencyImpactPct).toBe(0);
    expect(map.stocksImpactPct).toBe(100);
  });
});
