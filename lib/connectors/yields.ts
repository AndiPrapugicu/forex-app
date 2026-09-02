/**
 * 2-year government bond yields, per currency.
 *
 * These exist to answer one question the calendar cannot: is the market pricing
 * the central bank to hike or to cut? A 2-year trading above the standing policy
 * rate is the market saying "higher from here".
 *
 * A1 answers the same question from their own house forecast for next quarter
 * (a1trading.com/edgefinder/interest-rates/). No free feed publishes anyone's
 * rate forecast, so we read the market's instead.
 *
 * COVERAGE IS DELIBERATELY PARTIAL. Only USD and EUR have a keyless daily source
 * that was verified live:
 *
 *   USD  FRED's CSV export. No API key, unlike the JSON API. Verified returning
 *        2026-08-06 on the day this was written.
 *   EUR  The ECB Data Portal's AAA-rated euro-area yield curve, 2-year spot.
 *        Keyless, daily, verified same-day.
 *
 * THE OTHER SIX NOW HAVE ONE TOO. GBP, JPY, CAD, AUD, NZD and CHF were
 * previously dropped — DBnomics has no clean daily 2-year for them, Yahoo has no
 * reliable tickers, and FRED's OECD mirrors are monthly and run about two months
 * behind, which is worse than admitting the gap. TradingView's quote endpoint
 * serves all six keyless and live, verified during planning:
 *
 *   GB 4.3815   JP 1.685   CH 0.0949   CA 2.984   AU 4.626   NZ 3.588
 *
 * That matters because the rate column is otherwise a guaranteed 0 for every
 * non-USD currency, since the Fed is the only bank publishing a numeric
 * projection — so every non-USD CROSS scores 0 there by construction, and the
 * crosses are where the remaining gaps against A1 live.
 *
 * FRED and the ECB stay PRIMARY for USD and EUR. They are the issuers' own
 * series and were verified first; TradingView is the fallback that fills what
 * they never covered, not a replacement for what they do.
 */

import { TRADINGVIEW_QUOTE } from '@/config/sources.config';
import { fetchJson, fetchText, fixturesEnabled } from '@/lib/connectors/base';
import { ok, type Currency, type Result } from '@/lib/types';

const FRED = {
  name: 'FRED',
  /**
   * The graph CSV export, NOT the api.stlouisfed.org JSON API — the latter
   * requires a free key, this does not.
   */
  csv: 'https://fred.stlouisfed.org/graph/fredgraph.csv',
  cacheTtlSeconds: 6 * 3600, // daily series; polling harder buys nothing
} as const;

const ECB = {
  name: 'ECB Data Portal',
  /**
   * Euro-area AAA government yield curve, 2-year spot rate, Svensson model.
   * The AAA curve rather than an all-issuer one, because that is the euro-area
   * risk-free benchmark the market actually prices policy against.
   */
  url:
    'https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_2Y' +
    '?lastNObservations=1&format=csvdata',
  cacheTtlSeconds: 6 * 3600,
} as const;

export interface SovereignYield {
  currency: Currency;
  /** Yield in percent. */
  value: number;
  /** ISO date of the observation, so staleness is visible. */
  observedOn: string;
  source: string;
}

/** One dated observation of a FRED series. */
export interface DatedObservation {
  /** `YYYY-MM-DD`, FRED's own observation date. */
  date: string;
  value: number;
}

/**
 * Every non-empty row of a FRED CSV, oldest first.
 *
 * FRED writes "." for missing observations on holidays, which parses as NaN
 * rather than throwing — the guard below is the whole reason this is a function
 * and not an inline split.
 */
export function parseFredSeries(body: string): DatedObservation[] {
  const out: DatedObservation[] = [];
  const lines = body.trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const [date, raw] = lines[i].split(',');
    const value = Number.parseFloat(raw ?? '');
    if (date && Number.isFinite(value)) out.push({ date: date.trim(), value });
  }
  return out;
}

/** The newest observation of a parsed series, in the shape the level callers want. */
function lastOf(series: readonly DatedObservation[]): { value: number; observedOn: string } | null {
  const last = series[series.length - 1];
  return last ? { value: last.value, observedOn: last.date } : null;
}

/**
 * A FRED series as dated daily observations, oldest first.
 *
 * THE ONLY PATH TO FRED IN THIS FILE, and it is one on purpose. Three callers
 * want DGS2 in a single pipeline run — the rate column, the sovereign yield map
 * and the curve panel — and before this they issued two distinct cache keys for
 * the identical CSV, so a cold run fetched the same 12,557-row export twice.
 * One key, one fetch, and each caller takes the slice it needs: the rate column
 * needs the HISTORY (an average cannot be rewound from a single number), the
 * other two need only the last row.
 */
export async function fetchFredSeries(id: string): Promise<Result<DatedObservation[]>> {
  const res = await fetchText(FRED.name, `${FRED.csv}?id=${id}`, {
    cacheTtlSeconds: FRED.cacheTtlSeconds,
    cacheKey: `fred:${id}`,
    timeoutMs: 15_000,
  });
  if (!res.ok) return res;
  return ok(FRED.name, parseFredSeries(res.data));
}

/**
 * The ECB's csvdata format puts observations in named columns, and the column
 * order is not guaranteed, so TIME_PERIOD and OBS_VALUE are located by header
 * rather than by index.
 */
function parseEcbCsv(body: string): { value: number; observedOn: string } | null {
  const lines = body.trim().split('\n');
  if (lines.length < 2) return null;

  const header = lines[0].split(',');
  const timeIdx = header.indexOf('TIME_PERIOD');
  const valueIdx = header.indexOf('OBS_VALUE');
  if (timeIdx === -1 || valueIdx === -1) return null;

  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = lines[i].split(',');
    const value = Number.parseFloat(cols[valueIdx] ?? '');
    const observedOn = cols[timeIdx]?.trim();
    if (observedOn && Number.isFinite(value)) return { value, observedOn };
  }
  return null;
}

/**
 * One currency's 2-year from TradingView.
 *
 * Null on anything unexpected rather than a guess: a missing currency falls back
 * to a published projection or to 0, which is honest, whereas a wrong yield
 * would flip the sign of a rate cell on every pair that currency appears in.
 *
 * `observedOn` is today's date, not an observation date — the endpoint returns a
 * streaming quote with no timestamp. That is the one thing this source is weaker
 * at than FRED and the ECB, and the reason those two stay primary.
 */
async function fetchTradingViewYield(currency: Currency): Promise<SovereignYield | null> {
  const symbol = TRADINGVIEW_QUOTE.yield2y[currency];
  if (!symbol) return null;

  const res = await fetchJson<{ close?: unknown }>(
    TRADINGVIEW_QUOTE.name,
    `${TRADINGVIEW_QUOTE.base}?symbol=${encodeURIComponent(symbol)}&fields=close`,
    {
      headers: { ...TRADINGVIEW_QUOTE.headers },
      cacheTtlSeconds: TRADINGVIEW_QUOTE.cacheTtlSeconds,
      cacheKey: `tv:yield:${symbol}`,
      timeoutMs: 15_000,
      retries: 1,
    },
  );
  if (!res.ok) return null;

  const value = res.data?.close;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  return {
    currency,
    value,
    observedOn: new Date().toISOString().slice(0, 10),
    source: TRADINGVIEW_QUOTE.name,
  };
}

/**
 * Every 2-year yield we can get for free, keyed by currency.
 *
 * Never throws and never fails as a whole: a currency we cannot reach is simply
 * absent from the map, and the scoring layer falls back for it. One dead source
 * must not cost the entire column.
 */
export async function fetchSovereignYields(): Promise<Result<Map<Currency, SovereignYield>>> {
  const out = new Map<Currency, SovereignYield>();

  if (fixturesEnabled()) {
    // Captured yields, so offline mode exercises the real market-implied rate
    // path rather than silently falling back to the regime table for everything
    // — which would leave that branch untested outside production.
    const fixture = (await import('@/fixtures/sample-yields.json')).default as SovereignYield[];
    return ok('yields:fixture', new Map(fixture.map((y) => [y.currency, y])));
  }

  const [usd, eur] = await Promise.all([
    fetchFredSeries('DGS2'),
    fetchText(ECB.name, ECB.url, {
      cacheTtlSeconds: ECB.cacheTtlSeconds,
      cacheKey: 'ecb:yc:2y',
      timeoutMs: 15_000,
    }),
  ]);

  if (usd.ok) {
    const parsed = lastOf(usd.data);
    if (parsed) out.set('USD', { currency: 'USD', ...parsed, source: FRED.name });
  }

  if (eur.ok) {
    const parsed = parseEcbCsv(eur.data);
    if (parsed) out.set('EUR', { currency: 'EUR', ...parsed, source: ECB.name });
  }

  /**
   * Everything the issuers' own feeds do not cover, from TradingView.
   *
   * Filled AFTER the two above and skipped where they succeeded, so FRED and the
   * ECB stay authoritative for USD and EUR and this can only ever add currencies
   * rather than override a verified one.
   */
  const missing = (Object.keys(TRADINGVIEW_QUOTE.yield2y) as Currency[]).filter((c) => !out.has(c));
  for (let i = 0; i < missing.length; i += TRADINGVIEW_QUOTE.batchSize) {
    const batch = missing.slice(i, i + TRADINGVIEW_QUOTE.batchSize);
    const quotes = await Promise.all(batch.map((c) => fetchTradingViewYield(c)));
    quotes.forEach((q, j) => {
      if (q) out.set(batch[j], q);
    });
  }

  const wanted = Object.keys(TRADINGVIEW_QUOTE.yield2y).length;
  const degraded =
    out.size === wanted
      ? undefined
      : out.size === 0
        ? 'no sovereign yields available — every rate cell falls back to a published projection or 0'
        : `${wanted - out.size} of ${wanted} currencies have no 2-year yield`;

  return ok('Sovereign yields', out, degraded);
}

/**
 * The US curve, for the inversion read on the Macro page.
 *
 * Three FRED series rather than two: the 10-year and 2-year give the levels,
 * and `T10Y2Y` gives the spread directly. Subtracting the two levels would look
 * equivalent and is not — FRED publishes them on their own schedules, and
 * measured today DGS2/DGS10 were last observed on 2026-08-07 while T10Y2Y had
 * 2026-08-10. Deriving the spread from stale legs would quietly report a
 * three-day-old curve as current.
 *
 * Keyless, via the same graph CSV export the 2-year already uses. The
 * `api.stlouisfed.org` JSON API needs a free key; this does not.
 */
export interface YieldCurve {
  twoYear: number | null;
  tenYear: number | null;
  /** 10y minus 2y, in percentage points. Negative is an inverted curve. */
  spread: number | null;
  /** Of the SPREAD, which is the number the panel leads with. */
  observedOn: string | null;
  /** True when the level legs are older than the spread. */
  levelsLag: boolean;
}

export async function fetchYieldCurve(): Promise<Result<YieldCurve>> {
  if (fixturesEnabled()) {
    return ok('yields:fixture', {
      twoYear: null,
      tenYear: null,
      spread: null,
      observedOn: null,
      levelsLag: false,
    });
  }

  const series = await Promise.all(
    (['DGS2', 'DGS10', 'T10Y2Y'] as const).map((id) => fetchFredSeries(id)),
  );

  const [two, ten, spread] = series.map((r) => (r.ok ? lastOf(r.data) : null));

  const degraded =
    spread === null
      ? 'US curve unavailable'
      : two === null || ten === null
        ? 'curve spread available but one level leg is missing'
        : undefined;

  return ok(
    FRED.name,
    {
      twoYear: two?.value ?? null,
      tenYear: ten?.value ?? null,
      spread: spread?.value ?? null,
      observedOn: spread?.observedOn ?? null,
      levelsLag:
        spread !== null && two !== null && (two.observedOn < spread.observedOn || (ten?.observedOn ?? '') < spread.observedOn),
    },
    degraded,
  );
}
