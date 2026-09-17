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
 * NOT A SECOND SOURCE OF TRUTH, WITH ONE NAMED EXCEPTION. For every series
 * FXStreet publishes, this contributes a forecast and nothing else — no event,
 * no actual, no date, no impact — so if the merge misfires a cell reads a wrong
 * forecast rather than the calendar disagreeing with itself about what was
 * released.
 *
 * The exception is `fetchTradingViewActuals`, which emits real events for the
 * handful of series in `TRADINGVIEW.actualSeries` that FXStreet does not carry
 * at all. There the alternative is not a different number but a permanently
 * blank column, and every such event is stamped `actualSource: 'tradingview'`.
 */

import { z } from 'zod';
import { TRADINGVIEW } from '@/config/sources.config';
import { fetchJson, fixturesEnabled, stableId } from '@/lib/connectors/base';
import { fail, isMajor, ok, type NormalizedEvent, type Result } from '@/lib/types';

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

  /**
   * TradingView's HOUSE VOCABULARY, which is the reason the backfill was barely
   * working: it fetched 1,526 forecast rows and lent 64, nearly all of them EIA
   * oil stocks the scorecard never reads.
   *
   * The two calendars do not disagree about the data, they disagree about the
   * words. FXStreet names a series after the statistical office's title;
   * TradingView names it after the thing measured, identically for every
   * country. Neither is wrong, and normalisation cannot bridge them because
   * "Consumer Price Index (YoY)" and "Inflation Rate YoY" share no tokens at all.
   *
   * Every pair below was checked against the live feed by confirming the two
   * sides describe the same release on the same day — not by similarity, which
   * the file header rightly warns is how "Core CPI" gets paired with "CPI". The
   * near-misses that were REJECTED are worth recording, because each looks
   * plausible and each would lend a forecast of a different series:
   *
   *   retail trade s.a. (MoM)      vs  retail sales yoy      different transform
   *   producer and import prices yoy vs producer and import prices mom  ditto
   *   Ivey Purchasing Managers Index vs ivey pmi s a         adjusted, not raw
   *   AiG Manufacturing PMI        vs  s&p global manufacturing pmi final
   *                                                          different survey
   */
  'consumer price index yoy': 'inflation rate yoy',
  'consumer price index mom': 'inflation rate mom',
  'gross domestic product qoq': 'gdp growth rate qoq',
  'gross domestic product yoy': 'gdp growth rate yoy',
  'producer price index output qoq': 'ppi output qoq',
  // Switzerland titles its labour series "s.a. (MoM)" though it is a rate, not
  // a change; TradingView calls it what it is. Same release either way.
  'unemployment rate s a mom': 'unemployment rate',
  'unemployment rate s a': 'unemployment rate',
  // The UK's headline labour measure, published by the ONS on the ILO basis.
  'ilo unemployment rate 3m': 'unemployment rate',
  // Singular on one side, plural on the other, and nothing else differs.
  'kof leading indicator': 'kof leading indicators',
  // Japan's and Switzerland's retail series, both named for the national
  // statistical title rather than for the measure.
  'retail trade yoy': 'retail sales yoy',
  'real retail sales yoy': 'retail sales yoy',
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

type TvRow = z.infer<typeof TvEvent>;

/**
 * One country's slice of the window, parsed but not yet interpreted.
 *
 * Shared by the forecast backfill and the allowlisted-actuals reader so the two
 * cannot drift apart on headers, window or cache key — and so the second reader
 * is served from `base.ts`'s in-process cache rather than issuing its own
 * request. See TRADINGVIEW.countries for why this is per country and not one
 * call for all eight.
 */
async function pullCountry(
  country: string,
  from: Date,
  to: Date,
  /**
   * Distinguishes a pull over a different window. The key is otherwise built
   * from `from` alone, so a forward-looking pull starting the same day would be
   * served the forecast pull's shorter response.
   */
  cacheKeySuffix = '',
): Promise<{ rows: TvRow[]; capped: boolean } | null> {
  const url =
    `${TRADINGVIEW.base}?from=${encodeURIComponent(from.toISOString())}` +
    `&to=${encodeURIComponent(to.toISOString())}&countries=${country}`;

  const res = await fetchJson<unknown>(TRADINGVIEW.name, url, {
    headers: { ...TRADINGVIEW.headers },
    cacheTtlSeconds: TRADINGVIEW.cacheTtlSeconds,
    cacheKey: `tradingview:${country}:${from.toISOString().slice(0, 10)}${cacheKeySuffix}`,
    timeoutMs: 20_000,
    retries: 1,
  });
  if (!res.ok) return null;

  const parsed = TvResponse.safeParse(res.data);
  if (!parsed.success) return null;

  const result = parsed.data.result ?? [];
  const rows: TvRow[] = [];
  for (const raw of result) {
    const row = TvEvent.safeParse(raw);
    // One malformed row must not discard the rest, as in the FXStreet connector.
    if (!row.success) continue;
    rows.push(row.data);
  }

  return { rows, capped: result.length >= TRADINGVIEW.rowCap };
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

  const out: TvForecast[] = [];
  const failed: string[] = [];
  const capped: string[] = [];

  const pull = async (country: string) => {
    const raw = await pullCountry(country, from, to);
    if (!raw) return null;

    const rows: TvForecast[] = [];
    for (const { title, country: rowCountry, currency, date, forecast } of raw.rows) {
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

    return { rows, capped: raw.capped };
  };

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
 * The allowlisted series, as ordinary calendar events.
 *
 * Reads the SAME per-country responses `fetchTradingViewForecasts` does — same
 * URL, same `cacheKey` — so within one run this is served from the in-process
 * cache in `base.ts` and costs no additional request.
 *
 * Scoped hard by construction: a row is emitted only if its normalized title is
 * an exact match for an `actualSeries` entry AND the country agrees. Nothing
 * fuzzy, nothing inferred. See `TRADINGVIEW.actualSeries` for why this exception
 * exists and why it is a list rather than a fallback.
 */
export async function fetchTradingViewActuals(
  now = new Date(),
): Promise<Result<NormalizedEvent[]>> {
  const label = `${TRADINGVIEW.name}:actuals`;
  if (fixturesEnabled()) return ok(label, []);

  const wanted: readonly {
    currency: string; countryCode: string; tvName: string; publishAs: string; unit: string;
  }[] = TRADINGVIEW.actualSeries;

  const to = new Date(now.getTime() + 86_400_000);
  const from = new Date(now.getTime() - TRADINGVIEW.lookbackDays * 86_400_000);

  const countries = [...new Set(wanted.map((w) => w.countryCode))];
  const out: NormalizedEvent[] = [];
  const failed: string[] = [];

  for (const country of countries) {
    const raw = await pullCountry(country, from, to);
    if (!raw) {
      failed.push(country);
      continue;
    }

    for (const row of raw.rows) {
      const { title, country: rowCountry, currency, date, actual, previous, forecast } = row;
      if (actual === null || actual === undefined) continue;
      if (!rowCountry || !currency) continue;

      const normalized = normalizeSeriesName(title);
      const spec = wanted.find(
        (w) => w.tvName === normalized && w.countryCode === toOurCountry(rowCountry),
      );
      if (!spec || spec.currency !== currency) continue;
      // Narrows to the Currency union, and refuses anything outside it.
      if (!isMajor(currency)) continue;

      out.push({
        id: stableId('tv', spec.publishAs, currency, date),
        seriesId: null,
        // Published under OUR name, so the slot matcher targets one string and
        // does not have to know this series arrived by a different road.
        name: spec.publishAs,
        currency,
        countryCode: spec.countryCode,
        dateUtc: new Date(date).toISOString(),
        impact: 'MEDIUM',
        actual,
        consensus: forecast ?? null,
        previous: previous ?? null,
        revised: null,
        unit: spec.unit,
        ratioDeviation: null,
        isBetterThanExpected: null,
        isSpeech: false,
        isPreliminary: false,
        source: 'tradingview',
        // The point of the whole exercise: this number is not FXStreet's, and
        // every consumer can see that without reading this file.
        actualSource: 'tradingview',
        sourceUrl: null,
        lastUpdated: null,
      });
    }
  }

  return ok(
    label,
    out,
    failed.length > 0 ? `no rows for ${failed.join(', ')}` : undefined,
  );
}

type RateDecisionCountry = keyof typeof TRADINGVIEW.rateDecisions.titles;

/**
 * One country's central-bank decisions as calendar events, past and scheduled.
 *
 * PURE, so the title match can be tested without the network. Exact title only:
 * "BoJ Interest Rate Decision" and nothing that merely contains it, because the
 * same calendar lists deposit rates, statements and projections beside it.
 */
export function toRateDecisionEvents(
  country: RateDecisionCountry,
  rows: readonly { title: string; date: string; actual?: number | null; forecast?: number | null; previous?: number | null }[],
): NormalizedEvent[] {
  const spec = TRADINGVIEW.rateDecisions.titles[country];
  const out: NormalizedEvent[] = [];
  for (const row of rows) {
    if (row.title.trim() !== spec.title) continue;
    const dateUtc = new Date(row.date).toISOString();
    out.push({
      id: stableId('tv', 'rate-decision', spec.currency, dateUtc),
      seriesId: null,
      name: TRADINGVIEW.rateDecisions.publishAs,
      currency: spec.currency,
      countryCode: toOurCountry(country),
      dateUtc,
      impact: 'HIGH',
      actual: row.actual ?? null,
      consensus: row.forecast ?? null,
      previous: row.previous ?? null,
      revised: null,
      unit: '%',
      ratioDeviation: null,
      isBetterThanExpected: null,
      isSpeech: false,
      isPreliminary: false,
      source: 'tradingview',
      actualSource: 'tradingview',
      sourceUrl: null,
      lastUpdated: null,
    });
  }
  return out;
}

/**
 * Every major central bank's decisions over a window reaching past today.
 *
 * ALL OR NOTHING. The Rates column is a difference between two banks, so a
 * board where one country's pull failed must not score the other seven from
 * this and the eighth from something else. Any failed or capped country fails
 * the whole Result, and the scorer falls back as a unit.
 */
export async function fetchTradingViewRateDecisions(
  now = new Date(),
): Promise<Result<NormalizedEvent[]>> {
  const label = `${TRADINGVIEW.name}:rate decisions`;
  if (fixturesEnabled()) return ok(label, []);

  const cfg = TRADINGVIEW.rateDecisions;
  const from = new Date(now.getTime() - cfg.lookbackDays * 86_400_000);
  const to = new Date(now.getTime() + cfg.lookaheadDays * 86_400_000);
  const countries = Object.keys(cfg.titles) as RateDecisionCountry[];

  const out: NormalizedEvent[] = [];
  const problems: string[] = [];
  for (let i = 0; i < countries.length; i += TRADINGVIEW.batchSize) {
    const batch = countries.slice(i, i + TRADINGVIEW.batchSize);
    const results = await Promise.all(batch.map((c) => pullCountry(c, from, to, ':rate-decisions')));
    results.forEach((raw, j) => {
      const country = batch[j];
      if (!raw) problems.push(`${country} unreachable`);
      else if (raw.capped) problems.push(`${country} capped`);
      else {
        const events = toRateDecisionEvents(country, raw.rows);
        if (events.length === 0) problems.push(`${country} has no decision in the window`);
        out.push(...events);
      }
    });
  }

  if (problems.length > 0) return fail(label, problems.join('; '));
  return ok(label, out);
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
  /**
   * Whose forecast this is, stamped onto every event it fills.
   *
   * Defaulted rather than required so existing callers are untouched, but a
   * SECOND source must pass its own name or `consensusSource` silently lies —
   * and a provenance field that lies is worse than one that is absent, because
   * the card will name a source that never published the number.
   */
  sourceName: string = TRADINGVIEW.name,
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
    return { ...e, consensus: forecast, consensusSource: sourceName } satisfies NormalizedEvent;
  });

  return { events: out, filled };
}
