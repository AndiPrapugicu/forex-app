/**
 * ForexFactory / FairEconomy weekly calendar — SCHEDULE FALLBACK ONLY.
 *
 * Confirmed during planning: this feed carries no `actual` field in any of its
 * json, xml or csv forms, and only `ff_calendar_thisweek` exists (today,
 * tomorrow, nextweek and lastweek all 404). So it can answer "what is coming up"
 * but never "what did it print".
 *
 * Its job is to keep the upcoming-events panel alive if FXStreet disappears.
 */

import { z } from 'zod';
import { FAIRECONOMY } from '@/config/sources.config';
import { fetchJson, parseNumeric, stableId, fixturesEnabled } from '@/lib/connectors/base';
import { isMajor, ok, type Impact, type NormalizedEvent, type Result } from '@/lib/types';

const FfEvent = z.object({
  title: z.string(),
  country: z.string(),
  date: z.string(),
  impact: z.string().nullish(),
  forecast: z.string().nullish(),
  previous: z.string().nullish(),
  url: z.string().nullish(),
});

type FfEvent = z.infer<typeof FfEvent>;

function toImpact(impact: string | null | undefined): Impact {
  switch ((impact ?? '').toLowerCase()) {
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    case 'low':
      return 'LOW';
    default:
      // "Holiday" and anything unrecognised. Holidays matter for liquidity but
      // carry no surprise, so they score at the floor weight.
      return 'NONE';
  }
}

function normalize(raw: FfEvent): NormalizedEvent | null {
  // `country` holds a currency code here ("USD", "EUR"), plus "All" for global
  // items like OPEC meetings, which we drop.
  if (!isMajor(raw.country)) return null;

  const date = new Date(raw.date);
  if (Number.isNaN(date.getTime())) return null;

  return {
    id: stableId('ff', raw.country, raw.title, date.toISOString()),
    seriesId: null,
    name: raw.title,
    currency: raw.country,
    // This feed keys by currency, not country. Leaving it null lets the
    // scorecard's country filter fall back to the primary country rather than
    // excluding these rows outright.
    countryCode: null,
    dateUtc: date.toISOString(),
    impact: toImpact(raw.impact),

    // Always null — this feed has no actuals. Not a bug; see the file header.
    actual: null,
    // Feed values are strings like "3.4%" or "142K"; parseNumeric handles both.
    consensus: parseNumeric(raw.forecast),
    previous: parseNumeric(raw.previous),
    revised: null,
    unit: null,

    ratioDeviation: null,
    isBetterThanExpected: null,

    isSpeech: /speaks|speech|testimony/i.test(raw.title),
    isPreliminary: /flash|prelim/i.test(raw.title),

    source: 'faireconomy',
    actualSource: null,
    sourceUrl: raw.url ?? 'https://www.forexfactory.com/calendar',
    lastUpdated: null,
  };
}

function parsePayload(payload: unknown, source: string): Result<NormalizedEvent[]> {
  if (!Array.isArray(payload)) {
    return { ok: false, error: 'expected an array', source, fetchedAtUtc: new Date().toISOString() };
  }

  const events: NormalizedEvent[] = [];
  let skipped = 0;

  for (const row of payload) {
    const parsed = FfEvent.safeParse(row);
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

export async function fetchFairEconomyCalendar(): Promise<Result<NormalizedEvent[]>> {
  if (fixturesEnabled()) {
    const fixture = (await import('@/fixtures/sample-faireconomy.json')).default;
    return parsePayload(fixture, 'faireconomy:fixture');
  }

  const res = await fetchJson<unknown>(FAIRECONOMY.name, FAIRECONOMY.url, {
    headers: { ...FAIRECONOMY.headers },
    cacheTtlSeconds: FAIRECONOMY.cacheTtlSeconds,
  });

  if (!res.ok) return res as Result<NormalizedEvent[]>;
  return parsePayload(res.data, FAIRECONOMY.name);
}
