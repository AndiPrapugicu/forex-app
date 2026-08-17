/**
 * TradingView's economic calendar, used for ONE job: supplying a consensus
 * where FXStreet published a release without one.
 *
 * The scorecard is ternary — a cell asks whether a print beat or missed its
 * forecast — so a release with an actual and a null consensus cannot be scored
 * at all. `resolveSeries` correctly skips those, and the cell either reaches
 * back to an older print or goes blank. Switzerland is where this hurts:
 * producer prices and the SECO consumer survey both arrive with no forecast, so
 * every franc cross was scoring those columns from one leg.
 *
 * DELIBERATELY NOT A SECOND SOURCE OF TRUTH. It never contributes an event, an
 * actual, a date or an impact — FXStreet remains the record of what happened.
 * All this can do is fill a hole in the forecast column, which keeps the failure
 * mode small: if the merge misfires, a cell reads a wrong forecast rather than
 * the calendar disagreeing with itself about what was released.
 */

import { z } from 'zod';
import { TRADINGVIEW } from '@/config/sources.config';
import { fetchJson, fixturesEnabled } from '@/lib/connectors/base';
import { ok, type NormalizedEvent, type Result } from '@/lib/types';

const TvEvent = z.object({
  title: z.string(),
  country: z.string().nullish(),
  currency: z.string().nullish(),
  date: z.string(),
  actual: z.number().nullish(),
  forecast: z.number().nullish(),
  previous: z.number().nullish(),
});

const TvResponse = z.object({
  status: z.string().nullish(),
  result: z.array(z.unknown()).nullish(),
});

/** A forecast we can lend to a matching FXStreet release. */
export interface TvForecast {
  /** Our country code, already mapped from theirs. */
  countryCode: string;
  currency: string;
  /** Calendar day, YYYY-MM-DD. Two feeds rarely agree on the minute. */
  day: string;
  normalizedName: string;
  forecast: number;
}

/**
 * Collapses the cosmetic differences between two calendars' names for the same
 * release.
 *
 *   FXStreet     "Producer and Import Prices (MoM)"
 *   TradingView  "Producer & Import Prices MoM"
 *
 * Both reduce to "producer and import prices mom". Ampersands become "and"
 * BEFORE punctuation is stripped, which is the step that makes those two agree;
 * doing it the other way round leaves "producer import prices mom" and the pair
 * never matches.
 */
export function normalizeSeriesName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Series whose two feeds name them differently enough that normalisation cannot
 * bridge the gap. Keyed by the NORMALIZED FXStreet name.
 *
 * Kept as data rather than as fuzzy matching on purpose. A similarity threshold
 * loose enough to pair "SECO Consumer Climate" with "Consumer Confidence" is
 * also loose enough to pair "Core CPI" with "CPI", and lending the wrong
 * forecast is worse than lending none — it produces a confident cell built on a
 * number that was never a forecast of that series.
 */
export const SERIES_ALIASES: Record<string, string> = {
  // Switzerland's consumer survey. SECO runs it; TradingView uses the generic name.
  'seco consumer climate 3m': 'consumer confidence',
  // The SVME/procure.ch manufacturing survey, named after the publisher on one
  // side and the thing measured on the other.
  'svme purchasing managers index': 'procure ch manufacturing pmi',
  // TradingView abbreviates the two most common series names everywhere.
  'gross domestic product mom': 'gdp mom',
  'producer price index qoq': 'ppi qoq',
};

function aliasFor(normalized: string): string {
  return SERIES_ALIASES[normalized] ?? normalized;
}

/** Their country code in our vocabulary. */
function toOurCountry(country: string): string {
  return TRADINGVIEW.countryToOurs[country] ?? country;
}

/** Country and series, without the date — the date is matched with tolerance. */
function seriesKey(countryCode: string, normalizedName: string): string {
  return `${countryCode}|${normalizedName}`;
}

/**
 * A day either side counts as the same release.
 *
 * Two calendars routinely disagree about which day a print belongs to: one
 * stamps the local publication time, the other the UTC instant, and either can
 * land on the far side of midnight. Switzerland's SECO survey is the live case —
 * FXStreet files it a day after TradingView, so an exact-day match found nothing
 * and the cell fell back to a print three months old.
 *
 * Kept at one day rather than a week. No series publishes twice in two days, so
 * this cannot pair two different releases of the same indicator, which a wider
 * window very much could.
 */
export const MATCH_TOLERANCE_DAYS = 1;

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Fetches the forecast column for the scorecard's window.
 *
 * Returns an empty map rather than failing the run when the endpoint is down:
 * losing the backfill costs a few cells, and it must never take the calendar
 * with it.
 */
export async function fetchTradingViewForecasts(
  now = new Date(),
): Promise<Result<TvForecast[]>> {
  if (fixturesEnabled()) return ok(TRADINGVIEW.name, []);

  const to = new Date(now.getTime() + 86_400_000);
  const from = new Date(now.getTime() - TRADINGVIEW.lookbackDays * 86_400_000);

  /** One country's slice of the window. See TRADINGVIEW.countries for why. */
  async function pull(country: string): Promise<{ rows: TvForecast[]; capped: boolean } | null> {
    const url =
      `${TRADINGVIEW.base}?from=${encodeURIComponent(from.toISOString())}` +
      `&to=${encodeURIComponent(to.toISOString())}&countries=${country}`;

    const res = await fetchJson<unknown>(TRADINGVIEW.name, url, {
      headers: { ...TRADINGVIEW.headers },
      cacheTtlSeconds: TRADINGVIEW.cacheTtlSeconds,
      cacheKey: `tradingview:${country}:${from.toISOString().slice(0, 10)}`,
      timeoutMs: 20_000,
      retries: 1,
    });
    if (!res.ok) return null;

    const parsed = TvResponse.safeParse(res.data);
    if (!parsed.success) return null;

    const result = parsed.data.result ?? [];
    const rows: TvForecast[] = [];
    for (const raw of result) {
      const row = TvEvent.safeParse(raw);
      // One malformed row must not discard the rest, as in the FXStreet connector.
      if (!row.success) continue;

      const { title, country: rowCountry, currency, date, forecast } = row.data;
      if (forecast === null || forecast === undefined) continue;
      if (!rowCountry || !currency) continue;

      rows.push({
        countryCode: toOurCountry(rowCountry),
        currency,
        day: date.slice(0, 10),
        normalizedName: aliasFor(normalizeSeriesName(title)),
        forecast,
      });
    }

    return { rows, capped: result.length >= TRADINGVIEW.rowCap };
  }

  const out: TvForecast[] = [];
  const failed: string[] = [];
  const capped: string[] = [];

  const countries = [...TRADINGVIEW.countries];
  for (let i = 0; i < countries.length; i += TRADINGVIEW.batchSize) {
    const batch = countries.slice(i, i + TRADINGVIEW.batchSize);
    const results = await Promise.all(batch.map(pull));
    results.forEach((r, j) => {
      if (!r) failed.push(batch[j]);
      else {
        out.push(...r.rows);
        if (r.capped) capped.push(batch[j]);
      }
    });
  }

  /**
   * Losing this entirely costs a few cells, never the calendar — so a total
   * failure still returns ok with an empty list and says so in the health table.
   */
  const notes = [
    failed.length > 0 ? `no forecasts for ${failed.join(', ')}` : null,
    // Silent truncation is the failure that cost a fortnight of data once
    // already; if it ever recurs it has to be visible rather than inferred.
    capped.length > 0 ? `response capped for ${capped.join(', ')} — newest rows may be missing` : null,
  ].filter(Boolean);

  return ok(TRADINGVIEW.name, out, notes.length > 0 ? notes.join('; ') : undefined);
}

/**
 * Lends a forecast to every released event that has none.
 *
 * PURE, and narrow by construction — it returns a new list in which the only
 * field that can ever differ is `consensus`, and only on events where it was
 * null. An event that already carries a forecast is passed through untouched,
 * so FXStreet always wins where the two disagree.
 *
 * Matched on country, calendar DAY and normalized name. The day rather than the
 * timestamp because two calendars rarely agree on the minute a release landed;
 * the country because German and euro-area HICP share a currency, a name and
 * often a week, and pairing those would put a member state's forecast against
 * the aggregate's actual.
 */
export function backfillConsensus(
  events: NormalizedEvent[],
  forecasts: TvForecast[],
): { events: NormalizedEvent[]; filled: number } {
  if (forecasts.length === 0) return { events, filled: 0 };

  const bySeries = new Map<string, { day: string; forecast: number }[]>();
  for (const f of forecasts) {
    const key = seriesKey(f.countryCode, f.normalizedName);
    const list = bySeries.get(key) ?? [];
    list.push({ day: f.day, forecast: f.forecast });
    bySeries.set(key, list);
  }

  let filled = 0;
  const out = events.map((e) => {
    if (e.consensus !== null || e.actual === null) return e;

    const key = seriesKey(e.countryCode ?? '', aliasFor(normalizeSeriesName(e.name)));
    const day = e.dateUtc.slice(0, 10);

    // Nearest candidate within tolerance, so a same-day row always beats a
    // neighbouring one rather than depending on the order they arrived in.
    let best: { day: string; forecast: number } | null = null;
    for (const candidate of bySeries.get(key) ?? []) {
      const distance = daysBetween(candidate.day, day);
      if (distance > MATCH_TOLERANCE_DAYS) continue;
      if (!best || distance < daysBetween(best.day, day)) best = candidate;
    }

    const forecast = best?.forecast;
    if (forecast === undefined) return e;

    filled++;
    // Provenance travels with the number: this forecast is not FXStreet's.
    return { ...e, consensus: forecast, consensusSource: TRADINGVIEW.name } satisfies NormalizedEvent;
  });

  return { events: out, filled };
}
