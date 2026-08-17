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
 * GBP, JPY, CAD, AUD, NZD and CHF were investigated and dropped: DBnomics has no
 * clean daily 2-year for them, Yahoo has no reliable tickers, and FRED's OECD
 * mirrors are MONTHLY and run about two months behind — presenting those as a
 * daily market signal would be worse than admitting the gap. Those currencies
 * fall back to the hand-maintained CURRENCY_REGIME, and the cell says so.
 */

import { fetchText, fixturesEnabled } from '@/lib/connectors/base';
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

/**
 * Last non-empty row of a FRED CSV.
 *
 * FRED writes "." for missing observations on holidays, which parses as NaN
 * rather than throwing — the guard below is the whole reason this is a function
 * and not an inline split.
 */
function parseFredCsv(body: string): { value: number; observedOn: string } | null {
  const lines = body.trim().split('\n');
  for (let i = lines.length - 1; i >= 1; i--) {
    const [date, raw] = lines[i].split(',');
    const value = Number.parseFloat(raw ?? '');
    if (date && Number.isFinite(value)) return { value, observedOn: date.trim() };
  }
  return null;
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
    fetchText(FRED.name, `${FRED.csv}?id=DGS2`, {
      cacheTtlSeconds: FRED.cacheTtlSeconds,
      cacheKey: 'fred:DGS2',
      timeoutMs: 15_000,
    }),
    fetchText(ECB.name, ECB.url, {
      cacheTtlSeconds: ECB.cacheTtlSeconds,
      cacheKey: 'ecb:yc:2y',
      timeoutMs: 15_000,
    }),
  ]);

  if (usd.ok) {
    const parsed = parseFredCsv(usd.data);
    if (parsed) out.set('USD', { currency: 'USD', ...parsed, source: FRED.name });
  }

  if (eur.ok) {
    const parsed = parseEcbCsv(eur.data);
    if (parsed) out.set('EUR', { currency: 'EUR', ...parsed, source: ECB.name });
  }

  const degraded =
    out.size === 2
      ? undefined
      : out.size === 0
        ? 'no sovereign yields available — every rate cell falls back to the regime table'
        : `${2 - out.size} of 2 yield sources unavailable`;

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
    (['DGS2', 'DGS10', 'T10Y2Y'] as const).map((id) =>
      fetchText(FRED.name, `${FRED.csv}?id=${id}`, {
        cacheTtlSeconds: FRED.cacheTtlSeconds,
        cacheKey: `fred:${id}`,
        timeoutMs: 15_000,
      }),
    ),
  );

  const [two, ten, spread] = series.map((r) => (r.ok ? parseFredCsv(r.data) : null));

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
