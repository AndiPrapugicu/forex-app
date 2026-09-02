/**
 * The consensus backfill.
 *
 * The risk this file exists to pin is not "does it fill a gap" — it is "does it
 * ever fill the WRONG gap". Lending a forecast that belonged to another release
 * produces a confident cell built on a number that was never a forecast of that
 * series, which is strictly worse than the blank it replaced. Most of what
 * follows is about refusing to match.
 */

import { describe, expect, it } from 'vitest';
import {
  SERIES_ALIASES,
  backfillConsensus,
  normalizeSeriesName,
  type TvForecast,
} from '@/lib/connectors/tradingview';
import { TRADINGVIEW } from '@/config/sources.config';
import type { NormalizedEvent } from '@/lib/types';

function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: 'e1',
    seriesId: null,
    name: 'Producer and Import Prices (MoM)',
    currency: 'CHF',
    countryCode: 'CH',
    dateUtc: '2026-07-14T06:30:00.000Z',
    impact: 'MEDIUM',
    actual: -0.3,
    consensus: null,
    previous: -0.4,
    revised: null,
    unit: '%',
    ratioDeviation: null,
    isBetterThanExpected: null,
    isSpeech: false,
    isPreliminary: false,
    source: 'fxstreet',
    actualSource: 'fxstreet',
    sourceUrl: null,
    lastUpdated: null,
    ...overrides,
  };
}

function forecast(overrides: Partial<TvForecast> = {}): TvForecast {
  return {
    countryCode: 'CH',
    currency: 'CHF',
    day: '2026-07-14',
    normalizedName: 'producer and import prices mom',
    forecast: -0.5,
    ...overrides,
  };
}

describe('normalizeSeriesName', () => {
  it('reconciles the two calendars’ spelling of one release', () => {
    // The live pair that motivated this: FXStreet parenthesises the period and
    // spells out "and"; TradingView uses an ampersand and no brackets.
    expect(normalizeSeriesName('Producer and Import Prices (MoM)')).toBe(
      normalizeSeriesName('Producer & Import Prices MoM'),
    );
  });

  it('expands the ampersand BEFORE stripping punctuation', () => {
    // Stripping first leaves "producer import prices mom" and the pair never
    // matches. This is the ordering the whole merge depends on.
    expect(normalizeSeriesName('Producer & Import Prices MoM')).toBe('producer and import prices mom');
  });

  it('keeps genuinely different series apart', () => {
    expect(normalizeSeriesName('Core CPI (YoY)')).not.toBe(normalizeSeriesName('CPI (YoY)'));
    expect(normalizeSeriesName('Retail Sales (MoM)')).not.toBe(normalizeSeriesName('Retail Sales (YoY)'));
  });
});

describe('backfillConsensus', () => {
  it('fills a forecast the publishing calendar never carried', () => {
    // Switzerland's producer prices: FXStreet gives an actual and no consensus,
    // so the cell could not be scored at all.
    const { events, filled } = backfillConsensus([event()], [forecast()]);

    expect(filled).toBe(1);
    expect(events[0].consensus).toBe(-0.5);
    expect(events[0].consensusSource).toMatch(/TradingView/);
  });

  it('leaves an existing forecast alone', () => {
    // FXStreet is the source of record. Where both have a view, theirs wins.
    const { events, filled } = backfillConsensus(
      [event({ consensus: -0.2 })],
      [forecast({ forecast: -0.9 })],
    );

    expect(filled).toBe(0);
    expect(events[0].consensus).toBe(-0.2);
    expect(events[0].consensusSource).toBeUndefined();
  });

  it('changes nothing except the forecast', () => {
    const before = event();
    const { events } = backfillConsensus([before], [forecast()]);
    const after = events[0];

    expect({ ...after, consensus: null, consensusSource: undefined }).toEqual({
      ...before,
      consensusSource: undefined,
    });
  });

  it('will not lend a forecast to an unreleased event', () => {
    // Nothing to compare a forecast against, and filling it would make an
    // upcoming release look like a scoreable print.
    const { filled } = backfillConsensus([event({ actual: null })], [forecast()]);
    expect(filled).toBe(0);
  });

  it('accepts a day either side, because the two calendars disagree by one', () => {
    // Switzerland's SECO survey is the live case: FXStreet files it a day after
    // TradingView, and an exact-day match sent the cell back to a print three
    // months old.
    for (const day of ['2026-07-13', '2026-07-14', '2026-07-15']) {
      expect(backfillConsensus([event()], [forecast({ day })]).filled, day).toBe(1);
    }
  });

  it('refuses a gap wider than a day', () => {
    const { filled } = backfillConsensus([event()], [forecast({ day: '2026-07-16' })]);
    expect(filled).toBe(0);
  });

  it('prefers the same-day row over a neighbouring one', () => {
    // Not order-dependent: the nearest candidate wins regardless of which
    // arrived first in the feed.
    const near = forecast({ day: '2026-07-13', forecast: -9 });
    const exact = forecast({ day: '2026-07-14', forecast: -0.5 });

    expect(backfillConsensus([event()], [near, exact]).events[0].consensus).toBe(-0.5);
    expect(backfillConsensus([event()], [exact, near]).events[0].consensus).toBe(-0.5);
  });

  it('refuses a different country even when the name and day agree', () => {
    /**
     * The trap this guards. Germany and the euro area both publish a
     * "Harmonized Index of Consumer Prices (YoY)" under currency EUR, often in
     * the same week — pairing them would score the aggregate's actual against a
     * member state's forecast.
     */
    const german = event({
      name: 'Harmonized Index of Consumer Prices (YoY)',
      currency: 'EUR',
      countryCode: 'DE',
      dateUtc: '2026-07-30T06:00:00.000Z',
    });
    const euroArea = forecast({
      countryCode: 'EMU',
      currency: 'EUR',
      day: '2026-07-30',
      normalizedName: 'harmonized index of consumer prices yoy',
      forecast: 2.9,
    });

    expect(backfillConsensus([german], [euroArea]).filled).toBe(0);
  });

  it('refuses a different series on the same day', () => {
    const { filled } = backfillConsensus(
      [event({ name: 'Retail Sales (MoM)' })],
      [forecast()],
    );
    expect(filled).toBe(0);
  });

  it('bridges a known naming difference through the alias table', () => {
    // SECO runs Switzerland's consumer survey; TradingView files it under the
    // generic name. No amount of normalisation connects those two strings.
    const seco = event({ name: 'SECO Consumer Climate (3m)', actual: -35, dateUtc: '2026-07-10T06:00:00.000Z' });
    const tv = forecast({ day: '2026-07-10', normalizedName: 'consumer confidence', forecast: -35.5 });

    const { events, filled } = backfillConsensus([seco], [tv]);
    expect(filled).toBe(1);
    expect(events[0].consensus).toBe(-35.5);
  });

  it('keeps every alias pointing at a normalized string', () => {
    // An alias whose value is not already normalized can never match, because
    // the lookup happens after normalisation on both sides.
    for (const [from, to] of Object.entries(SERIES_ALIASES)) {
      expect(normalizeSeriesName(from), `alias key ${from}`).toBe(from);
      expect(normalizeSeriesName(to), `alias value ${to}`).toBe(to);
    }
  });

  it('is a no-op when the backfill source returned nothing', () => {
    // The endpoint is undocumented and allowed to fail; losing it must cost a
    // few cells, never the calendar.
    const input = [event()];
    const { events, filled } = backfillConsensus(input, []);

    expect(filled).toBe(0);
    expect(events).toBe(input); // same reference: nothing was rebuilt
  });
});

/**
 * Provenance, which only matters once there is more than one lender.
 *
 * The source name was hardcoded for as long as TradingView was the only
 * backfill. A second one chained after it would have stamped every event it
 * filled as TradingView's — and a provenance field that lies is worse than one
 * that is absent, because the card names a source that never published the
 * number.
 */
describe('backfillConsensus provenance', () => {
  const forecast: TvForecast[] = [
    {
      countryCode: 'CH',
      currency: 'CHF',
      day: '2026-07-14',
      normalizedName: 'producer and import prices mom',
      forecast: 0.2,
    },
  ];

  it('stamps TradingView by default', () => {
    const { events, filled } = backfillConsensus([event()], forecast);
    expect(filled).toBe(1);
    expect(events[0].consensusSource).toBe('TradingView calendar');
  });

  it('stamps whichever source actually lent the number', () => {
    const { events } = backfillConsensus([event()], forecast, 'ForexFactory (FairEconomy)');
    expect(events[0].consensusSource).toBe('ForexFactory (FairEconomy)');
  });

  it('chains idempotently, and the FIRST source keeps the event', () => {
    // Order is precedence: the second pass only sees what the first left null.
    const second: TvForecast[] = [{ ...forecast[0], forecast: 9.9 }];

    const first = backfillConsensus([event()], forecast, 'first');
    const chained = backfillConsensus(first.events, second, 'second');

    expect(chained.filled).toBe(0);
    expect(chained.events[0].consensus).toBe(0.2);
    expect(chained.events[0].consensusSource).toBe('first');
  });
});

/**
 * The allowlist is the one place this connector is allowed to be a source of
 * truth rather than a forecast backfill, so its invariants are worth holding
 * explicitly rather than by review.
 */
describe('TRADINGVIEW.actualSeries', () => {
  it('names every entry under a title FXStreet does not already use', () => {
    // Publishing under FXStreet's own name would put two series behind one
    // string and let arrival order decide which fills the slot. The Swiss
    // unemployment pair is the live case: FXStreet's is `Unemployment Rate
    // s.a (MoM)`, this one is deliberately not.
    const published = TRADINGVIEW.actualSeries.map((s) => s.publishAs);
    expect(new Set(published).size).toBe(published.length);
    expect(published).not.toContain('Unemployment Rate s.a (MoM)');
  });

  it('carries the Swiss unadjusted rate, which FXStreet does not publish', () => {
    const ch = TRADINGVIEW.actualSeries.find((s) => s.currency === 'CHF');
    expect(ch).toBeDefined();
    expect(ch!.countryCode).toBe('CH');
    // Their title normalizes to this; the alias table must not rewrite it, or
    // the lookup in fetchTradingViewActuals stops matching.
    expect(normalizeSeriesName('Unemployment Rate')).toBe(ch!.tvName);
    expect(ch!.publishAs).toBe('Unemployment Rate');
  });

  it('stores tvName already normalized, since the lookup compares exactly', () => {
    for (const s of TRADINGVIEW.actualSeries) {
      expect(normalizeSeriesName(s.tvName)).toBe(s.tvName);
    }
  });
});
