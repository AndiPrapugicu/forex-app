/**
 * DBnomics — free, no key, 93 statistical providers.
 *
 * SCOPE WARNING, measured rather than assumed:
 * The plan intended to use DBnomics to cross-check `actual` values. Probing the
 * live API showed its mirrors of the statistics agencies lag badly —
 *
 *   BLS/cu/CUUR0000SA0        (US CPI)        last obs 2025-01  (~18 months old)
 *   BLS/ce/CES0000000001      (US payrolls)   last obs 2025-01
 *   Eurostat/prc_hicp_manr    (euro HICP)     last obs 2025-12  (~8 months old)
 *   FED/H15/RIFSPFF_N.D       (fed funds)     last obs yesterday  <-- current
 *
 * So it cannot verify a print that happened this morning; by the time DBnomics
 * has the number, the trade is long gone. Using it for actuals would produce
 * confident-looking cross-checks against data over a year old.
 *
 * What IS current is the daily policy-rate series. That is genuinely useful: the
 * hiking/cutting regime in scoring.config.ts is a hand-maintained assumption,
 * and these rates let the UI flag when that assumption looks out of date.
 */

import { DBNOMICS } from '@/config/sources.config';
import { fetchJson, fixturesEnabled } from '@/lib/connectors/base';
import { ok, type Currency, type Result } from '@/lib/types';

/**
 * Policy-rate series verified as current during planning.
 * Only add series here after confirming the last observation is recent — a
 * stale series is worse than a missing one because it looks authoritative.
 */
const POLICY_RATE_SERIES: Partial<Record<Currency, { code: string; label: string }>> = {
  USD: { code: 'FED/H15/RIFSPFF_N.D', label: 'Fed funds (effective, daily)' },
};

export interface PolicyRate {
  currency: Currency;
  label: string;
  rate: number;
  period: string;
  /** Change vs the previous observation — the direction of travel. */
  change: number | null;
}

interface DbnomicsSeriesResponse {
  series?: {
    docs?: {
      series_name?: string;
      period?: string[];
      value?: (number | null)[];
    }[];
  };
}

async function fetchSeries(
  currency: Currency,
  code: string,
  label: string,
): Promise<PolicyRate | null> {
  const res = await fetchJson<DbnomicsSeriesResponse>(
    DBNOMICS.name,
    `${DBNOMICS.base}/${code}?observations=1`,
    { cacheTtlSeconds: DBNOMICS.cacheTtlSeconds, timeoutMs: 12_000, retries: 1 },
  );

  if (!res.ok) return null;

  const doc = res.data.series?.docs?.[0];
  if (!doc?.period?.length || !doc.value?.length) return null;

  // Trailing nulls are common — walk back to the last real observation.
  let idx = doc.value.length - 1;
  while (idx >= 0 && (doc.value[idx] === null || doc.value[idx] === undefined)) idx--;
  if (idx < 0) return null;

  const rate = doc.value[idx] as number;
  if (!Number.isFinite(rate)) return null;

  // Previous non-null observation, for direction of travel.
  let prevIdx = idx - 1;
  while (prevIdx >= 0 && (doc.value[prevIdx] === null || doc.value[prevIdx] === undefined)) prevIdx--;
  const prev = prevIdx >= 0 ? (doc.value[prevIdx] as number) : null;

  return {
    currency,
    label,
    rate,
    period: doc.period[idx] ?? '',
    change: prev !== null && Number.isFinite(prev) ? rate - prev : null,
  };
}

/** Current policy rates. Never blocks ingest — an empty list is fine. */
export async function fetchPolicyRates(): Promise<Result<PolicyRate[]>> {
  if (fixturesEnabled()) {
    return ok('dbnomics:fixture', [] as PolicyRate[], 'policy rates not included in fixtures');
  }

  const entries = Object.entries(POLICY_RATE_SERIES) as [Currency, { code: string; label: string }][];

  const rates = (
    await Promise.all(entries.map(([currency, s]) => fetchSeries(currency, s.code, s.label)))
  ).filter((r): r is PolicyRate => r !== null);

  if (rates.length === 0) {
    return {
      ok: false,
      error: 'no policy rate series resolved',
      source: DBNOMICS.name,
      fetchedAtUtc: new Date().toISOString(),
    };
  }

  const missing = entries.length - rates.length;
  return ok(DBNOMICS.name, rates, missing > 0 ? `${missing} series unavailable` : undefined);
}
