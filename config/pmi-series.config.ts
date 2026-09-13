/**
 * Which PMI series each currency's mPMI and sPMI slot actually reads.
 *
 * WHY THIS FILE EXISTS. `lib/connectors/pmi-history.ts` seeds PMI history from
 * A1's captured charts, and a seeded event is only worth anything if the slot's
 * OWN matcher already prefers the name it is published under. Publish an event
 * as "Services PMI" when `config/setups.config.ts` prefers "HCOB Services PMI"
 * for the euro area and the seed is invisible: no error, no warning, no benefit.
 * So the names live here, beside a test that runs them through `resolveSeries`.
 *
 * `countryCode` is load-bearing for the same reason. `resolveSeries` scopes its
 * pool to `PRIMARY_COUNTRY[currency]` before anything else, because the euro
 * area publishes an HCOB PMI under EMU *and* under DE, FR, IT and ES. A seeded
 * EUR row tagged anything but EMU is filtered out before a matcher ever sees it.
 *
 * VENDORS ARE A1'S OWN, NOT OURS. Their services-PMI page states it verbatim:
 * "USD uses ISM PMI data for both manufacturing and services. Non-USD assets use
 * Flash PMI Data." Every mapping below was then checked against a live read of
 * our calendar on the same date — CHF manufacturing 57.1 on 2026-09-01 is the
 * SVME survey to the decimal, CAD 53.0 is S&P Global's, NZD 54.3 is BusinessNZ.
 */

import type { Currency } from '@/lib/types';

export interface PmiSeriesDefinition {
  currency: Currency;
  /** MUST equal `PRIMARY_COUNTRY[currency]`, or the country filter drops it. */
  countryCode: string;
  slotKey: 'mpmi' | 'spmi';
  /** The name we publish under. The slot's own matcher must already prefer it. */
  publishAs: string;
  /** A1's stated vendor for this leg. */
  vendor: 'ism' | 'sp-global' | 'hcob' | 'jibun' | 'svme' | 'businessnz' | 'ivey';
  /** The country code A1's own heatmap publishes this economy under. */
  a1Country: string;
}

export const PMI_SERIES: readonly PmiSeriesDefinition[] = [
  // A1 reads ISM for the dollar, explicitly and by their own note.
  { currency: 'USD', countryCode: 'US', slotKey: 'mpmi', publishAs: 'ISM Manufacturing PMI', vendor: 'ism', a1Country: 'US' },
  { currency: 'USD', countryCode: 'US', slotKey: 'spmi', publishAs: 'ISM Services PMI', vendor: 'ism', a1Country: 'US' },

  { currency: 'EUR', countryCode: 'EMU', slotKey: 'mpmi', publishAs: 'HCOB Manufacturing PMI', vendor: 'hcob', a1Country: 'EU' },
  { currency: 'EUR', countryCode: 'EMU', slotKey: 'spmi', publishAs: 'HCOB Services PMI', vendor: 'hcob', a1Country: 'EU' },

  { currency: 'GBP', countryCode: 'UK', slotKey: 'mpmi', publishAs: 'S&P Global Manufacturing PMI', vendor: 'sp-global', a1Country: 'UK' },
  { currency: 'GBP', countryCode: 'UK', slotKey: 'spmi', publishAs: 'S&P Global Services PMI', vendor: 'sp-global', a1Country: 'UK' },

  { currency: 'JPY', countryCode: 'JP', slotKey: 'mpmi', publishAs: 'Jibun Bank Manufacturing PMI', vendor: 'jibun', a1Country: 'JP' },
  { currency: 'JPY', countryCode: 'JP', slotKey: 'spmi', publishAs: 'Jibun Bank Services PMI', vendor: 'jibun', a1Country: 'JP' },

  { currency: 'AUD', countryCode: 'AU', slotKey: 'mpmi', publishAs: 'S&P Global Manufacturing PMI', vendor: 'sp-global', a1Country: 'AU' },
  { currency: 'AUD', countryCode: 'AU', slotKey: 'spmi', publishAs: 'S&P Global Services PMI', vendor: 'sp-global', a1Country: 'AU' },

  { currency: 'CAD', countryCode: 'CA', slotKey: 'mpmi', publishAs: 'S&P Global Manufacturing PMI', vendor: 'sp-global', a1Country: 'CA' },

  { currency: 'NZD', countryCode: 'NZ', slotKey: 'mpmi', publishAs: 'Business NZ PMI', vendor: 'businessnz', a1Country: 'NZ' },

  { currency: 'CHF', countryCode: 'CH', slotKey: 'mpmi', publishAs: "SVME - Purchasing Managers' Index", vendor: 'svme', a1Country: 'CH' },
];

/**
 * Series deliberately absent from the table, and why.
 *
 * Committed rather than left implicit, because "we did not seed this" and "we
 * forgot to seed this" are indistinguishable from the outside, and the first one
 * is a finding.
 */
export const PMI_SERIES_NOT_SEEDED: readonly { currency: Currency; slotKey: 'mpmi' | 'spmi'; why: string }[] = [
  {
    currency: 'CHF',
    slotKey: 'spmi',
    why:
      "A1's Swiss services series is byte-identical to the euro area's on all 24 captured points, and " +
      "their heatmap prints CH services as 51.7/51.5 — the EU row exactly. That is a SUBSTITUTION A1 " +
      'performs, not a Swiss observation, so it belongs in the a1 profile rather than in our history. ' +
      'Our own slot reads the KOF leading indicator and says in config that it is a proxy.',
  },
  {
    currency: 'CAD',
    slotKey: 'spmi',
    why:
      "A1 publishes NO Canadian services chart at all — the page returns empty under a filter code that " +
      'works on the manufacturing page. Their heatmap nevertheless still scores a CA services row frozen ' +
      'at 2026-05-01, 125 days stale on the day of capture. Seeding that would import their staleness ' +
      'into our board, where the live Ivey survey is a better reading.',
  },
  {
    currency: 'NZD',
    slotKey: 'spmi',
    why:
      'Same as CAD: no chart, and a heatmap row frozen at 2026-05-01. Our own slot reads the BusinessNZ ' +
      'PSI, which is live.',
  },
];

/** The definition governing an event, or null when it is not a seeded PMI series. */
export function pmiSeriesFor(
  e: { currency: Currency; countryCode?: string | null; name: string },
): PmiSeriesDefinition | null {
  return (
    PMI_SERIES.find(
      (d) =>
        d.currency === e.currency &&
        (e.countryCode ?? d.countryCode) === d.countryCode &&
        d.publishAs.toLowerCase() === e.name.toLowerCase(),
    ) ?? null
  );
}
