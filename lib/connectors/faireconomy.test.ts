/**
 * ForexFactory as a FORECAST source, which is a different job from the schedule
 * fallback the rest of this connector does.
 *
 * The feed has carried a usable forecast all along and none of it reached the
 * scorecard: it is wired only into the news pipeline, where whole rows are
 * de-duplicated and FXStreet is inserted first — so on exactly the releases
 * where FXStreet has an actual and no consensus, the ForexFactory row is
 * dropped and takes its forecast with it.
 *
 * What follows pins the two things that have to be right for the reshaped rows
 * to meet an FXStreet event at all: the country, which the feed does not
 * publish, and the name, which it publishes in a third vocabulary.
 */

import { describe, expect, it } from 'vitest';
import { FF_SERIES_ALIASES, toForecastRows } from '@/lib/connectors/faireconomy';
import { normalizeSeriesName } from '@/lib/connectors/tradingview';
import type { NormalizedEvent } from '@/lib/types';

function ffEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: 'ff1',
    seriesId: null,
    name: 'National Core CPI y/y',
    currency: 'JPY',
    // The feed keys by currency and leaves this null. That is the whole problem.
    countryCode: null,
    dateUtc: '2026-08-20T23:30:00.000Z',
    impact: 'MEDIUM',
    actual: null,
    consensus: 1.8,
    previous: 1.6,
    revised: null,
    unit: null,
    ratioDeviation: null,
    isBetterThanExpected: null,
    isSpeech: false,
    isPreliminary: false,
    source: 'faireconomy',
    actualSource: null,
    sourceUrl: null,
    lastUpdated: null,
    ...overrides,
  };
}

describe('toForecastRows', () => {
  it('supplies the country the feed omits', () => {
    /**
     * `backfillConsensus` matches on country deliberately — German and
     * euro-area HICP share a currency, a name and often a week, and pairing
     * those would put a member state's forecast against the aggregate's actual.
     * A null country never matches anything.
     */
    const [row] = toForecastRows([ffEvent()]);
    expect(row.countryCode).toBe('JP');
    expect(row.day).toBe('2026-08-20');
  });

  it('rewrites their name into the one the FXStreet event will normalize to', () => {
    // Aliased in REVERSE of the TradingView table: there their name is looked
    // up, here their row is the one carrying the forecast and must be renamed.
    const [row] = toForecastRows([ffEvent()]);
    expect(row.normalizedName).toBe('national cpi ex fresh food yoy');
  });

  it('passes through a name it has no alias for', () => {
    const [row] = toForecastRows([ffEvent({ name: 'Some Unmapped Series' })]);
    expect(row.normalizedName).toBe('some unmapped series');
  });

  it('drops rows with no forecast — they are the entire point', () => {
    expect(toForecastRows([ffEvent({ consensus: null })])).toHaveLength(0);
  });

  it('drops a currency with no country mapping rather than guessing one', () => {
    expect(toForecastRows([ffEvent({ currency: 'ZAR' })])).toHaveLength(0);
  });

  it('keeps every alias pre-normalized on both sides', () => {
    /**
     * The same invariant the TradingView table carries. A key or value that is
     * not already normalized can never match, and fails silently — which is
     * exactly how a lookup table rots without anything going red.
     */
    for (const [fxstreet, ff] of Object.entries(FF_SERIES_ALIASES)) {
      expect(normalizeSeriesName(fxstreet)).toBe(fxstreet);
      expect(normalizeSeriesName(ff)).toBe(ff);
    }
  });
});
