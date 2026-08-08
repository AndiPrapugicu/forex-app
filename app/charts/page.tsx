/**
 * Indicator history.
 *
 * Built from the same 150-day FXStreet window the scorecard uses, so the charts
 * and the matrix can never disagree about which series "CPI" refers to for a
 * given currency.
 *
 * The window is a deliberate limitation: 150 days shows roughly five monthly
 * prints. Extending it means backfilling into Postgres, which is only worth
 * doing once the schema is applied — see the note at the foot of the page.
 */

import { fetchFxStreetHistory } from '@/lib/connectors/fxstreet';
import { buildAllSeries } from '@/lib/scoring/indicator-history';
import { ChartsView } from '@/components/ChartsView';
import { EmptyState, Panel } from '@/components/ui';
import { MAJORS, type Currency } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ChartsPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string }>;
}) {
  const params = await searchParams;
  const requested = (params.currency ?? 'USD').toUpperCase() as Currency;
  const currency = MAJORS.includes(requested) ? requested : 'USD';

  const history = await fetchFxStreetHistory();

  if (!history.ok) {
    return (
      <div className="px-4 py-4">
        <h1 className="mb-4 text-lg font-bold">Indicator History</h1>
        <Panel title="Unavailable">
          <EmptyState message="Could not load calendar history" hint={history.error} />
        </Panel>
      </div>
    );
  }

  const series = buildAllSeries(currency, history.data);

  return <ChartsView currency={currency} series={series} />;
}
