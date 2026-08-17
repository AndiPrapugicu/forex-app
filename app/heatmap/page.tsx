/**
 * Currency economic heatmap.
 *
 * Shares the 150-day FXStreet window with the scorecard, so the same release
 * fills a slot in both places.
 */

import { fetchFxStreetHistory } from '@/lib/connectors/fxstreet';
import { buildCurrencyHeatmap } from '@/lib/scoring/heatmap';
import { EconomicHeatmap } from '@/components/EconomicHeatmap';
import { EmptyState, Panel } from '@/components/ui';
import { isMajor } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HeatmapPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string }>;
}) {
  const params = await searchParams;
  const requested = (params.currency ?? 'USD').toUpperCase();
  // These two pages read ONE economy's calendar, so the 8 majors are the whole
  // universe here — a minor like ZAR has no series to chart.
  const currency = isMajor(requested) ? requested : 'USD';

  const history = await fetchFxStreetHistory();

  if (!history.ok) {
    return (
      <div className="px-4 py-4">
        <h1 className="mb-4 text-lg font-bold">Economic Heatmap</h1>
        <Panel title="Unavailable">
          <EmptyState message="Could not load calendar history" hint={history.error} />
        </Panel>
      </div>
    );
  }

  return <EconomicHeatmap data={buildCurrencyHeatmap(currency, history.data)} />;
}
