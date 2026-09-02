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
import { normalizeSeriesName, type TvForecast } from '@/lib/connectors/tradingview';
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

/**
 * The forecast column, reshaped so `backfillConsensus` can lend it out.
 *
 * This feed has published a usable forecast all along — `parsePayload` above
 * puts it straight into `consensus` — and none of it ever reached the
 * scorecard. It is wired only into the news pipeline, where `resolveCalendar`
 * de-duplicates WHOLE ROWS and FXStreet is inserted first, so on exactly the
 * releases where FXStreet has an actual and no consensus the ForexFactory row
 * is dropped and takes its forecast with it. Two feeds, one of them holding the
 * missing number, and the merge threw it away.
 *
 * A THIRD VOCABULARY, so it needs its own aliases. FXStreet names a series
 * after the statistical title, TradingView after the measure, and ForexFactory
 * after neither — "National Core CPI y/y", "Retail Sales m/m", "Flash
 * Manufacturing PMI". The pairs below were read off the live payload.
 *
 * EXPECT THIS TO LEND VERY LITTLE, AND KNOW WHY BEFORE DELETING IT.
 *
 * Measured on the day it was wired in: 69 forecasts offered, 0 lent. That is
 * not a matching bug, it is the shape of the feed. Only
 * `ff_calendar_thisweek` exists — today, tomorrow, nextweek and lastweek all
 * 404 — so it carries forecasts for releases that have NOT HAPPENED YET, while
 * `backfillConsensus` deliberately only fills events that already have an
 * actual. The two windows barely overlap: by the time a print has an actual to
 * score, the forecast that preceded it has rolled out of the week.
 *
 * The overlap it does catch is real but narrow — a release earlier in the same
 * week that FXStreet published without a consensus. That is worth one cached
 * fetch, and the health note reports the yield every run so "reachable but
 * useless" can be told from "working" without anyone having to guess.
 *
 * WHAT WOULD ACTUALLY FIX THIS is capturing forecasts prospectively: snapshot
 * this feed weekly and keep the numbers, so a release meets the forecast that
 * was published before it. Consensus is only ever available in advance, and
 * nothing here stores it. That is a storage change, not a connector change.
 */
export const FF_SERIES_ALIASES: Record<string, string> = {
  'national cpi ex fresh food yoy': 'national core cpi y y',
  'consumer price index yoy': 'cpi y y',
  'consumer price index mom': 'cpi m m',
  'retail sales mom': 'retail sales m m',
  'industrial product price mom': 'ippi m m',
  'producer price index output qoq': 'ppi output q q',
  'unemployment rate': 'unemployment rate',
};

/** Their currency code in the country vocabulary `backfillConsensus` matches on. */
const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: 'US', EUR: 'EMU', GBP: 'UK', JPY: 'JP',
  AUD: 'AU', NZD: 'NZ', CAD: 'CA', CHF: 'CH',
};

export function toForecastRows(events: NormalizedEvent[]): TvForecast[] {
  const rows: TvForecast[] = [];

  for (const e of events) {
    if (e.consensus === null) continue;

    /**
     * The feed keys by CURRENCY and leaves `countryCode` null, but the backfill
     * matches on country — deliberately, because German and euro-area HICP
     * share a currency, a name and often a week, and pairing those would put a
     * member state's forecast against the aggregate's actual.
     */
    const countryCode = CURRENCY_TO_COUNTRY[e.currency];
    if (!countryCode) continue;

    const normalized = normalizeSeriesName(e.name);
    rows.push({
      countryCode,
      currency: e.currency,
      day: e.dateUtc.slice(0, 10),
      /**
       * Aliased in REVERSE of the TradingView table. There the key is the
       * FXStreet name and the value is theirs, because their rows are the ones
       * being looked up. Here the ForexFactory row is the one carrying the
       * forecast, so it must be rewritten into the name the FXStreet event will
       * normalize to — otherwise the two never meet.
       */
      normalizedName: FF_TO_FXSTREET[normalized] ?? normalized,
      forecast: e.consensus,
    });
  }

  return rows;
}

/** `FF_SERIES_ALIASES` inverted, built once. See `toForecastRows`. */
const FF_TO_FXSTREET: Record<string, string> = Object.fromEntries(
  Object.entries(FF_SERIES_ALIASES).map(([fxstreet, ff]) => [ff, fxstreet]),
);
