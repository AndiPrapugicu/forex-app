/**
 * Top Setups — the landing page.
 *
 * Server-rendered for the first paint, with a client island polling for updates.
 * The underlying data moves slowly (calendar daily, COT weekly), so the poll
 * interval is deliberately long compared with the news dashboard.
 */

import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { SetupsView } from '@/components/SetupsView';
import type { SetupsMatrix } from '@/lib/scoring/setups';
import type { SourceHealth } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function TopSetupsPage() {
  let matrix: SetupsMatrix | null = null;
  let health: SourceHealth[] = [];
  let error: string | null = null;

  try {
    const result = await runSetupsPipeline();
    matrix = result.matrix;
    health = result.health;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to build the scorecard';
  }

  return <SetupsView initial={matrix} initialHealth={health} initialError={error} />;
}
