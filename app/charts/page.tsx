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

import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { buildAllSeries } from '@/lib/scoring/indicator-history';
import { ChartsView } from '@/components/ChartsView';
import { EmptyState, Panel } from '@/components/ui';
import { isMajor } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ChartsPage({
  searchParams,
}: {
  searchParams: Promise<{ currency?: string }>;
}) {
  const params = await searchParams;
  const requested = (params.currency ?? 'USD').toUpperCase();
  // These two pages read ONE economy's calendar, so the 8 majors are the whole
  // universe here — a minor like ZAR has no series to chart.
  const currency = isMajor(requested) ? requested : 'USD';

/**
 * Reads the SCORECARD's event pool, not a raw calendar fetch.
 *
 * This used to call `fetchFxStreetHistory` directly, which meant it never saw
 * the consensus backfill or the allowlisted actuals the scorecard runs on. The
 * same release could therefore be scored here and blank there, or scored
 * differently — and once the Impact percentages started feeding the Economic
 * Surprise Meter, that stopped being a cosmetic difference and became two
 * headline numbers disagreeing about the same economy.
 *
 * `runSetupsPipeline` costs no extra upstream requests: every connector inside
 * it is cached, and /macro and the board are already calling it.
 */
  const { events, health } = await runSetupsPipeline();

  if (events.length === 0) {
    const calendar = health.find((h) => !h.ok);
    return (
      <div className="px-4 py-4">
        <h1 className="mb-4 text-lg font-bold">Indicator History</h1>
        <Panel title="Unavailable">
          <EmptyState message="Could not load calendar history" hint={calendar?.detail} />
        </Panel>
      </div>
    );
  }

  const series = buildAllSeries(currency, events);

  return <ChartsView currency={currency} series={series} />;
}
