/**
 * FXStreet economic calendar — the primary source for both schedule AND actuals.
 *
 * Undocumented endpoint discovered while planning. Two things matter:
 *
 *  1. The `Referer: https://www.fxstreet.com/` header is REQUIRED. Without it the
 *     API returns 401. That header is the entire auth mechanism.
 *  2. It returns `actual` alongside `consensus`/`previous`, plus `ratioDeviation`
 *     (a surprise already normalized against that series' own history) and
 *     `isBetterThanExpected`. This is why the app does not need per-country
 *     statistics-agency connectors.
 *
 * Because it is undocumented it may break without warning, so every failure path
 * here degrades to the FairEconomy schedule rather than throwing.
 */

import { z } from 'zod';
import { FXSTREET } from '@/config/sources.config';
import { fetchJson, stableId, useFixtures } from '@/lib/connectors/base';
import { isMajor, ok, type Impact, type NormalizedEvent, type Result } from '@/lib/types';

/**
 * Lenient on purpose: unknown extra fields are allowed, and every field we do
 * not strictly need is nullable. An upstream adding a column must not break
 * ingest, and one malformed row must not discard the other 277.
 */
const FxsEvent = z.object({
  id: z.string(),
  eventId: z.string().nullish(),
  dateUtc: z.string(),
  name: z.string(),
  currencyCode: z.string().nullish(),
  countryCode: z.string().nullish(),
  volatility: z.string().nullish(),
  actual: z.number().nullish(),
  consensus: z.number().nullish(),
  previous: z.number().nullish(),
  revised: z.number().nullish(),
  ratioDeviation: z.number().nullish(),
  isBetterThanExpected: z.boolean().nullish(),
  unit: z.string().nullish(),
  isSpeech: z.boolean().nullish(),
  isPreliminary: z.boolean().nullish(),
  lastUpdated: z.number().nullish(),
});

type FxsEvent = z.infer<typeof FxsEvent>;

/** FXStreet `volatility` maps directly onto our impact tiers. */
function toImpact(volatility: string | null | undefined): Impact {
  switch ((volatility ?? '').toUpperCase()) {
    case 'HIGH':
      return 'HIGH';
    case 'MEDIUM':
      return 'MEDIUM';
    case 'LOW':
      return 'LOW';
    default:
      return 'NONE';
  }
}

function normalize(raw: FxsEvent): NormalizedEvent | null {
  // Only the 8 majors are scored. The feed carries ~40 currencies; the rest are
  // dropped here rather than filling the store with rows nothing will ever read.
  if (!isMajor(raw.currencyCode)) return null;

  const date = new Date(raw.dateUtc);
  if (Number.isNaN(date.getTime())) return null;

  return {
    id: stableId('fxs', raw.id),
    seriesId: raw.eventId ?? null,
    name: raw.name,
    currency: raw.currencyCode,
    dateUtc: date.toISOString(),
    impact: toImpact(raw.volatility),

    actual: raw.actual ?? null,
    consensus: raw.consensus ?? null,
    previous: raw.previous ?? null,
    revised: raw.revised ?? null,
    unit: raw.unit ?? null,

    ratioDeviation: raw.ratioDeviation ?? null,
    isBetterThanExpected: raw.isBetterThanExpected ?? null,

    isSpeech: raw.isSpeech ?? false,
    isPreliminary: raw.isPreliminary ?? false,

    source: 'fxstreet',
    // Only claim an actual source when a value is actually present.
    actualSource: raw.actual !== null && raw.actual !== undefined ? 'fxstreet' : null,
    sourceUrl: 'https://www.fxstreet.com/economic-calendar',
    lastUpdated: raw.lastUpdated ?? null,
  };
}

/** Parses a raw payload into events, tolerating individual malformed rows. */
function parsePayload(payload: unknown, source: string): Result<NormalizedEvent[]> {
  if (!Array.isArray(payload)) {
    return { ok: false, error: 'expected an array', source, fetchedAtUtc: new Date().toISOString() };
  }

  const events: NormalizedEvent[] = [];
  let skipped = 0;

  for (const row of payload) {
    const parsed = FxsEvent.safeParse(row);
    if (!parsed.success) {
      skipped++;
      continue;
    }
    const normalized = normalize(parsed.data);
    if (normalized) events.push(normalized);
  }

  return ok(
    source,
    events,
    skipped > 0 ? `${skipped} row(s) failed validation and were skipped` : undefined,
  );
}

/**
 * Pulls the calendar window around now.
 *
 * The lookback matters as much as the lookahead: it is how "what just came out"
 * gets its actuals, since an event's `actual` is filled in after publication.
 */
export async function fetchFxStreetCalendar(now = new Date()): Promise<Result<NormalizedEvent[]>> {
  if (useFixtures()) {
    const fixture = (await import('@/fixtures/sample-fxstreet.json')).default;
    return parsePayload(fixture, 'fxstreet:fixture');
  }

  const from = new Date(now.getTime() - FXSTREET.lookbackHours * 3600_000);
  const to = new Date(now.getTime() + FXSTREET.lookaheadHours * 3600_000);

  // Path segments, not query params — the API is shaped `/eventDates/{from}/{to}`.
  const url = `${FXSTREET.base}/${from.toISOString()}/${to.toISOString()}`;

  const res = await fetchJson<unknown>(FXSTREET.name, url, {
    headers: { ...FXSTREET.headers },
    cacheTtlSeconds: FXSTREET.cacheTtlSeconds,
    // Cache key excludes the exact timestamps, which change every millisecond
    // and would otherwise make the cache useless. Hourly buckets are close enough.
    cacheKey: `fxstreet:${from.toISOString().slice(0, 13)}:${to.toISOString().slice(0, 13)}`,
  });

  if (!res.ok) {
    // 401 almost certainly means the Referer gate changed — worth calling out
    // explicitly, since the generic message would send someone hunting for a key.
    const hint = res.error.includes('401')
      ? ' (the Referer header gate may have changed — see config/sources.config.ts)'
      : '';
    return { ...res, error: `${res.error}${hint}` };
  }

  return parsePayload(res.data, FXSTREET.name);
}
