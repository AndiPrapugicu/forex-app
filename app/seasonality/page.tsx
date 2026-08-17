/**
 * Seasonality Scanners.
 *
 * Three granularities over one daily series — month of year, week of year, day
 * of week — for every symbol, plus a cross-symbol ranking for whichever bucket
 * the calendar is currently in. That set is A1's, and so are the 1 / 5 / 10 year
 * windows.
 *
 * ALL PROFILES ARE COMPUTED SERVER-SIDE AND SHIPPED AS NUMBERS. The alternative
 * — sending fifty symbols' worth of daily bars to the browser so it can switch
 * lookbacks locally — is several megabytes to save three integers per bucket.
 * All three lookbacks for all three granularities is a few hundred numbers per
 * symbol, which is smaller than one symbol's bars.
 *
 * The upstream fetch is windowed to eleven years and cached for seven days, so
 * this page is expensive once a week and free after that.
 */

import {
  SEASONAL_HISTORY_YEARS,
  fetchSeasonalHistories,
} from '@/lib/connectors/technicals';
import { ALL_SYMBOLS } from '@/config/symbols.config';
// Aliased: `fixturesEnabled` reads as a React hook to the lint rule, which then
// refuses it inside an async server component. It is a plain env check.
import { fixturesEnabled as isOfflineMode } from '@/lib/connectors/base';
import {
  SEASONALITY_LOOKBACKS,
  buildProfile,
  type SeasonalBucketKind,
} from '@/lib/scoring/seasonality';
import { SeasonalityScanner, type SymbolSeasonality } from '@/components/SeasonalityScanner';
import { EmptyState, Panel } from '@/components/ui';

export const dynamic = 'force-dynamic';

const KINDS: SeasonalBucketKind[] = ['month', 'week', 'weekday'];

export default async function SeasonalityPage() {
  const now = new Date();
  const bars = await fetchSeasonalHistories(
    ALL_SYMBOLS.map((s) => ({ symbol: s.symbol, yahoo: s.yahoo })),
  );

  const symbols: SymbolSeasonality[] = ALL_SYMBOLS.flatMap((def) => {
    const series = bars.get(def.symbol);
    if (!series) return [];

    /**
     * Every kind x every lookback, flattened into plain arrays. A Map does not
     * survive the server/client boundary, so the profiles are serialised as
     * bucket arrays and rebuilt into lookups in the component.
     */
    const profiles: SymbolSeasonality['profiles'] = {};
    for (const kind of KINDS) {
      for (const years of SEASONALITY_LOOKBACKS) {
        const profile = buildProfile(series, kind, years, now);
        profiles[`${kind}:${years}`] = {
          buckets: [...profile.buckets.values()],
          yearsCovered: profile.yearsCovered,
        };
      }
    }

    return [{ symbol: def.symbol, label: def.label, kind: def.kind, profiles }];
  });

  if (symbols.length === 0) {
    return (
      <div className="px-4 py-4">
        <Panel title="Seasonality">
          <EmptyState
            message="No price history available"
            hint={
              isOfflineMode()
                ? 'Offline mode. A decade of daily bars for 51 symbols is tens of megabytes, so this is the one source with no captured fixture — the tab needs the network. Everything else still works offline.'
                : 'Yahoo is the only source of long-run bars here, and it did not answer. npm run ingest:dry shows which upstreams are up.'
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <SeasonalityScanner
      symbols={symbols}
      nowIso={now.toISOString()}
      historyYears={SEASONAL_HISTORY_YEARS}
      /*
        A cold run can lose symbols to Yahoo throttling, and a scanner that is
        quietly seven rows short reads as a complete ranking. Measured: the first
        uncached load of all 51 dropped the stock indices; the next load, off the
        7-day cache, had everything. So it is worth saying rather than hiding.
      */
      missing={ALL_SYMBOLS.length - symbols.length}
      total={ALL_SYMBOLS.length}
    />
  );
}
