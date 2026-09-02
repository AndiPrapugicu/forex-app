/**
 * WHAT EACH SURVIVING BASIS OVERRIDE IS ACTUALLY HOLDING.
 *
 * `compareByCurrency` looks like it only decides what a print is measured
 * AGAINST. It also decides which print is REACHABLE, because `resolveSeries`
 * prefers the most recent print that is scoreable under the requested basis —
 * and on a forecast basis "scoreable" means "carries a consensus".
 *
 * That is why the Canadian override was a bug and these are not, despite being
 * the same line of config. Canada's discarded a consensus that existed on the
 * print it had already chosen. These keep resolution on the right print in
 * currencies whose series are never forecast at all; drop them and the slot
 * reaches past a fresh release to an older forecast one, or switches series.
 *
 * `npm run overrides` prints the same finding against the live calendar. These
 * tests pin it deterministically so nobody deletes one of these the way the
 * Canadian one deserved to be deleted.
 */

import { describe, expect, it } from 'vitest';
import { SLOTS } from '@/config/setups.config';
import { compareFor, resolveSeries, scoreSlot } from '@/lib/scoring/discrete';
import type { NormalizedEvent } from '@/lib/types';

const NOW = new Date('2026-08-31T12:00:00Z');
const slot = (key: string) => SLOTS.find((s) => s.key === key)!;

function event(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    seriesId: null,
    name: 'Unemployment Rate',
    currency: 'CHF',
    countryCode: 'CH',
    dateUtc: '2026-08-06T07:00:00Z',
    impact: 'HIGH',
    actual: 3.0,
    consensus: null,
    previous: 2.9,
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
    ...over,
  };
}

describe('the CHF unemployment override keeps resolution on the fresh print', () => {
  /**
   * Switzerland does not publish a forecast for this series. The newest print is
   * therefore unreachable on a forecast basis, and the slot falls back a month.
   */
  const fresh = event({ dateUtc: '2026-08-06T07:00:00Z', actual: 3.0, consensus: null, previous: 2.9 });
  const stale = event({ dateUtc: '2026-07-06T07:00:00Z', actual: 2.8, consensus: 2.9, previous: 2.9 });
  const events = [stale, fresh];

  it('is configured to compare against the prior print', () => {
    expect(compareFor(slot('unemployment'), 'CHF')).toBe('previous');
  });

  it('scores the August print, not July', () => {
    const r = scoreSlot(slot('unemployment'), 'CHF', events, NOW);
    expect(r.event?.dateUtc).toBe('2026-08-06T07:00:00Z');
    // 3.0 against a 2.9 prior print, inverted: higher unemployment is bearish.
    expect(r.cell).toBe(-1);
  });

  it('would reach back a month without it — which is what it is for', () => {
    // The counterfactual, stated explicitly so the cost of deleting the
    // override is visible here rather than discovered on a live board.
    const withoutOverride = resolveSeries(slot('unemployment'), 'CHF', events, 'forecast', {
      now: NOW,
      maxAgeDays: 60,
    });
    expect(withoutOverride?.dateUtc).toBe('2026-07-06T07:00:00Z');
  });
});

describe('the CHF PPI override keeps the series, not just the basis', () => {
  /**
   * Both patterns match on the same day. Only the MoM print is forecast, so on a
   * forecast basis the slot silently switches from the year-on-year series to
   * the month-on-month one — a different measurement under the same label.
   */
  const yoy = event({
    name: 'Producer and Import Prices (YoY)',
    dateUtc: '2026-08-13T06:30:00Z',
    actual: -2.1,
    consensus: null,
    previous: -2.1,
  });
  const mom = event({
    name: 'Producer and Import Prices (MoM)',
    dateUtc: '2026-08-13T06:30:00Z',
    actual: 0.1,
    consensus: 0.4,
    previous: 0.2,
  });
  const events = [yoy, mom];

  it('resolves the year-on-year series', () => {
    const r = scoreSlot(slot('ppi'), 'CHF', events, NOW);
    expect(r.event?.name).toBe('Producer and Import Prices (YoY)');
    expect(r.cell).toBe(0); // -2.1 against a -2.1 prior print
  });

  it('would switch to month-on-month without it', () => {
    const withoutOverride = resolveSeries(slot('ppi'), 'CHF', events, 'forecast', {
      now: NOW,
      maxAgeDays: 60,
    });
    expect(withoutOverride?.name).toBe('Producer and Import Prices (MoM)');
  });
});

describe('the removed Canadian override was a different mechanism entirely', () => {
  /**
   * The distinction that matters, and the reason this file exists: Canada's
   * override fired on a print it had ALREADY resolved, discarding a consensus
   * that was right there. Nothing about reachability was involved, so nothing
   * was lost by deleting it.
   */
  it('scores Canadian retail sales against the consensus on the print it resolved', () => {
    const r = scoreSlot(
      slot('retail-sales'),
      'CAD',
      [
        event({
          name: 'Retail Sales (MoM)',
          currency: 'CAD',
          countryCode: 'CA',
          dateUtc: '2026-08-21T12:30:00Z',
          actual: 0.6,
          consensus: 0.4,
          previous: 1.0,
        }),
      ],
      NOW,
    );
    expect(compareFor(slot('retail-sales'), 'CAD')).toBe('forecast');
    expect(r.referenceLabel).toBe('forecast');
    expect(r.cell).toBe(1);
  });
});
