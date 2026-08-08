/**
 * Builds per-indicator time series from the calendar history.
 *
 * The chart shows actual as bars with the forecast as a line over it — the same
 * comparison the scorecard makes, but over time, so a run of misses is visible
 * as a pattern rather than one cell.
 *
 * Series selection reuses the SAME slot patterns as the scorecard, deliberately.
 * If the chart resolved CPI differently from the matrix, the two would disagree
 * about what "CPI" means for a currency, which is worse than having no chart.
 */

import { PRIMARY_COUNTRY, SLOTS, type SlotDefinition } from '@/config/setups.config';
import type { Currency, NormalizedEvent } from '@/lib/types';

export interface IndicatorPoint {
  dateUtc: string;
  actual: number;
  consensus: number | null;
  /** Signed surprise in the release's own units. */
  surprise: number | null;
}

export interface IndicatorSeries {
  slotKey: string;
  label: string;
  currency: Currency;
  /** The exact release name that filled this slot, so the chart is unambiguous. */
  eventName: string;
  unit: string | null;
  points: IndicatorPoint[];
  /** How often the actual came in above forecast, as a percentage. */
  beatRatePct: number | null;
}

/**
 * Extracts one indicator's history for one currency.
 *
 * Mirrors `resolveSlotEvent`: scope to the primary country, then take the first
 * name pattern that has data. Once a series is chosen, ALL of its releases are
 * returned rather than mixing patterns, so the chart plots a single consistent
 * series instead of splicing Retail Sales MoM and YoY into one line.
 */
export function buildIndicatorSeries(
  slot: SlotDefinition,
  currency: Currency,
  events: NormalizedEvent[],
): IndicatorSeries | null {
  if (slot.kind !== 'economic') return null;

  const patterns = slot.matchByCurrency?.[currency] ?? slot.match ?? [];
  if (patterns.length === 0) return null;

  const country = PRIMARY_COUNTRY[currency];
  const pool = events.filter(
    (e) => e.currency === currency && e.actual !== null && (e.countryCode ?? country) === country,
  );

  for (const pattern of patterns) {
    const matches = pool.filter((e) => pattern.test(e.name));
    if (matches.length === 0) continue;

    // Lock to one exact name — several distinct series can share a pattern.
    const eventName = matches.reduce((newest, e) => (e.dateUtc > newest.dateUtc ? e : newest)).name;
    const series = matches.filter((e) => e.name === eventName);

    const points: IndicatorPoint[] = series
      .map((e) => ({
        dateUtc: e.dateUtc,
        actual: e.actual as number,
        consensus: e.consensus,
        surprise: e.consensus !== null ? (e.actual as number) - e.consensus : null,
      }))
      .sort((a, b) => a.dateUtc.localeCompare(b.dateUtc));

    if (points.length === 0) continue;

    const comparable = points.filter((p) => p.surprise !== null);
    const beats = comparable.filter((p) => (p.surprise as number) > 0).length;

    return {
      slotKey: slot.key,
      label: slot.label,
      currency,
      eventName,
      unit: series[0].unit ?? null,
      points,
      beatRatePct: comparable.length > 0 ? Math.round((beats / comparable.length) * 100) : null,
    };
  }

  return null;
}

/** Every available series for a currency, in scorecard slot order. */
export function buildAllSeries(currency: Currency, events: NormalizedEvent[]): IndicatorSeries[] {
  return SLOTS.filter((s) => s.kind === 'economic')
    .map((slot) => buildIndicatorSeries(slot, currency, events))
    .filter((s): s is IndicatorSeries => s !== null && s.points.length >= 2);
}
