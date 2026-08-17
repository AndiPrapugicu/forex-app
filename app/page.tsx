/**
 * Top Setups — the landing page.
 *
 * Server-rendered for the first paint, with a client island polling for updates.
 * The underlying data moves slowly (calendar daily, COT weekly), so the poll
 * interval is deliberately long compared with the news dashboard.
 */

import { loadChangeLog } from '@/lib/change-log';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { SetupsView } from '@/components/SetupsView';
import type { ScoreChange } from '@/lib/scoring/history';
import type { SetupsMatrix } from '@/lib/scoring/setups';
import type { SourceHealth } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function TopSetupsPage() {
  let matrix: SetupsMatrix | null = null;
  let health: SourceHealth[] = [];
  let changeLog: ScoreChange[] = [];
  let error: string | null = null;

  try {
    const result = await runSetupsPipeline();
    matrix = result.matrix;
    health = result.health;
    changeLog = await loadChangeLog(matrix);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to build the scorecard';
  }

  return (
    <SetupsView
      initial={matrix}
      initialHealth={health}
      initialChangeLog={changeLog}
      initialError={error}
    />
  );
}
