/**
 * CFTC Commitments of Traders — institutional and retail positioning.
 *
 * Free, no key, published weekly by a US federal agency. This single report
 * supplies BOTH sentiment columns on the scorecard:
 *
 *   - `noncomm_positions_*`  large speculators — hedge funds, CTAs. "Smart money".
 *   - `nonrept_positions_*`  traders below the reporting threshold. Small
 *                            traders, i.e. retail. Read contrarian.
 *
 * That second one matters: retail positioning is normally a paid broker feed,
 * and it is sitting in the same free file. Live example from the 2026-08-04
 * report — EUR small traders were 59.8% long while large speculators were net
 * short, which is the divergence the crowd-sentiment panel exists to show.
 *
 * TIMING: the survey is taken Tuesday and published the following Friday, so
 * the freshest possible data is three days old and can be up to ten. Every
 * consumer must display `reportDate` — presenting this as live positioning
 * would misrepresent it.
 */

import { z } from 'zod';
import { COT_LOOKBACK_WEEKS } from '@/config/setups.config';
import { REQUIRED_COT_CONTRACTS } from '@/config/symbols.config';
import { fetchJson, useFixtures } from '@/lib/connectors/base';
import { ok, type Result } from '@/lib/types';

const CFTC = {
  name: 'CFTC',
  /** Socrata dataset: legacy futures-only COT reports. */
  base: 'https://publicreporting.cftc.gov/resource/6dca-aqww.json',
  cacheTtlSeconds: 6 * 3600, // weekly data; no point polling it harder
} as const;

/**
 * Socrata returns every numeric column as a STRING. Coercing here rather than at
 * each use site means a schema change shows up as a validation failure instead
 * of NaN quietly propagating into a percentile.
 */
const numeric = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  });

const CotRow = z.object({
  contract_market_name: z.string(),
  report_date_as_yyyy_mm_dd: z.string(),
  noncomm_positions_long_all: numeric,
  noncomm_positions_short_all: numeric,
  comm_positions_long_all: numeric,
  comm_positions_short_all: numeric,
  nonrept_positions_long_all: numeric,
  nonrept_positions_short_all: numeric,
  open_interest_all: numeric,
  change_in_open_interest_all: numeric,
  change_in_noncomm_long_all: numeric,
  change_in_noncomm_short_all: numeric,
});

export interface CotReport {
  contract: string;
  /** ISO date of the Tuesday the positions were surveyed. */
  reportDate: string;

  /** Large speculators. */
  specLong: number;
  specShort: number;
  specNet: number;
  /** Share of speculator positions that are long, 0..100. */
  specLongPct: number;

  /** Commercials — hedgers. Usually the other side of the speculators. */
  commLong: number;
  commShort: number;
  commNet: number;

  /** Small traders — the retail proxy. */
  retailLong: number;
  retailShort: number;
  retailNet: number;
  retailLongPct: number;

  openInterest: number | null;
  openInterestChange: number | null;
  /** Week-on-week change in speculator net position. */
  specNetChange: number | null;
}

export interface CotSeries {
  contract: string;
  /** Newest first. */
  reports: CotReport[];
}

function toReport(raw: z.infer<typeof CotRow>): CotReport | null {
  const specLong = raw.noncomm_positions_long_all;
  const specShort = raw.noncomm_positions_short_all;
  const retailLong = raw.nonrept_positions_long_all;
  const retailShort = raw.nonrept_positions_short_all;

  // Without both speculator legs there is no net position and no percentage,
  // so the row is unusable rather than partially usable.
  if (specLong === null || specShort === null) return null;

  const specTotal = specLong + specShort;
  const retailTotal = (retailLong ?? 0) + (retailShort ?? 0);

  const commLong = raw.comm_positions_long_all ?? 0;
  const commShort = raw.comm_positions_short_all ?? 0;

  const longChange = raw.change_in_noncomm_long_all;
  const shortChange = raw.change_in_noncomm_short_all;

  return {
    contract: raw.contract_market_name,
    reportDate: raw.report_date_as_yyyy_mm_dd.slice(0, 10),

    specLong,
    specShort,
    specNet: specLong - specShort,
    // Guard against a zero denominator on thin contracts.
    specLongPct: specTotal > 0 ? (specLong / specTotal) * 100 : 50,

    commLong,
    commShort,
    commNet: commLong - commShort,

    retailLong: retailLong ?? 0,
    retailShort: retailShort ?? 0,
    retailNet: (retailLong ?? 0) - (retailShort ?? 0),
    retailLongPct: retailTotal > 0 ? ((retailLong ?? 0) / retailTotal) * 100 : 50,

    openInterest: raw.open_interest_all,
    openInterestChange: raw.change_in_open_interest_all,
    specNetChange:
      longChange !== null && shortChange !== null ? longChange - shortChange : null,
  };
}

/**
 * Fetches the trailing history for one contract.
 *
 * History is needed, not just the latest print: a net long of 200k means nothing
 * on its own. The COT index asks where that sits within the contract's OWN
 * range, which requires the series.
 */
async function fetchContractSeries(contract: string): Promise<CotSeries | null> {
  const params = new URLSearchParams({
    // Socrata's SoQL. The contract name is quoted and escaped below.
    $where: `contract_market_name='${contract.replace(/'/g, "''")}'`,
    $select: [
      'contract_market_name',
      'report_date_as_yyyy_mm_dd',
      'noncomm_positions_long_all',
      'noncomm_positions_short_all',
      'comm_positions_long_all',
      'comm_positions_short_all',
      'nonrept_positions_long_all',
      'nonrept_positions_short_all',
      'open_interest_all',
      'change_in_open_interest_all',
      'change_in_noncomm_long_all',
      'change_in_noncomm_short_all',
    ].join(','),
    $order: 'report_date_as_yyyy_mm_dd DESC',
    $limit: String(COT_LOOKBACK_WEEKS),
  });

  const res = await fetchJson<unknown>(CFTC.name, `${CFTC.base}?${params}`, {
    cacheTtlSeconds: CFTC.cacheTtlSeconds,
    cacheKey: `cftc:${contract}`,
    timeoutMs: 20_000,
    retries: 1,
  });

  if (!res.ok || !Array.isArray(res.data)) return null;

  const reports: CotReport[] = [];
  for (const row of res.data) {
    const parsed = CotRow.safeParse(row);
    if (!parsed.success) continue;
    const report = toReport(parsed.data);
    if (report) reports.push(report);
  }

  if (reports.length === 0) return null;
  return { contract, reports };
}

/**
 * Fetches every contract the scorecard needs.
 *
 * Sequential in small batches rather than all at once: this is a public
 * government endpoint with no key, and firing 13 concurrent queries at it is
 * how a free source stops being available.
 */
export async function fetchCotData(): Promise<Result<Map<string, CotSeries>>> {
  if (useFixtures()) {
    const fixture = (await import('@/fixtures/sample-cot.json')).default as CotSeries[];
    return ok('cftc:fixture', new Map(fixture.map((s) => [s.contract, s])));
  }

  const out = new Map<string, CotSeries>();
  const failed: string[] = [];

  const BATCH = 4;
  for (let i = 0; i < REQUIRED_COT_CONTRACTS.length; i += BATCH) {
    const batch = REQUIRED_COT_CONTRACTS.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((c) => fetchContractSeries(c)));

    results.forEach((series, idx) => {
      if (series) out.set(series.contract, series);
      else failed.push(batch[idx]);
    });
  }

  if (out.size === 0) {
    return {
      ok: false,
      error: `no COT contracts resolved (${failed.length} failed)`,
      source: CFTC.name,
      fetchedAtUtc: new Date().toISOString(),
    };
  }

  return ok(
    CFTC.name,
    out,
    failed.length > 0 ? `${failed.length} contract(s) unavailable: ${failed.join(', ')}` : undefined,
  );
}

/** Most recent report date across all contracts — what the UI must display. */
export function latestReportDate(data: Map<string, CotSeries>): string | null {
  let latest: string | null = null;
  for (const series of data.values()) {
    const date = series.reports[0]?.reportDate;
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest;
}

/**
 * How stale the data is, in days.
 *
 * Expected to be 3-10 even when everything is working, because of the Tuesday
 * survey / Friday release cycle. Beyond ~14 days something is actually wrong.
 */
export function reportAgeDays(reportDate: string, now = new Date()): number {
  const ms = now.getTime() - new Date(`${reportDate}T00:00:00Z`).getTime();
  return Math.floor(ms / 86_400_000);
}
