/**
 * Top Setups — the landing page.
 *
 * Server-rendered for the first paint, with a client island polling for updates.
 * The underlying data moves slowly (calendar daily, COT weekly), so the poll
 * interval is deliberately long compared with the news dashboard.
 */

import { loadLatestA1Capture } from '@/lib/a1-capture-file';
import { loadChangeLog, loadDayDeltas } from '@/lib/change-log';
import { buildMirrorOverlay, type MirrorOverlay } from '@/lib/scoring/a1-mirror';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { SetupsView } from '@/components/SetupsView';
import type { ScoreChange } from '@/lib/scoring/history';
import type { SetupsMatrix } from '@/lib/scoring/setups';
import type { SourceHealth } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VIEW_PARAMS = ['full', 'simple', 'macro'] as const;
type ViewParam = (typeof VIEW_PARAMS)[number];

export default async function TopSetupsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  // `/?view=macro` and `/?view=simple` are A1's Macro Only and Compact boards:
  // the same matrix, linkable. Anything unrecognised falls back to the full board.
  const requested = (await searchParams).view;
  const initialView: ViewParam = VIEW_PARAMS.find((v) => v === requested) ?? 'full';

  let matrix: SetupsMatrix | null = null;
  let health: SourceHealth[] = [];
  let changeLog: ScoreChange[] = [];
  let dayDeltas: Record<string, number | null> = {};
  let mirror: MirrorOverlay | null = null;
  let error: string | null = null;

  try {
    const result = await runSetupsPipeline();
    matrix = result.matrix;
    health = result.health;
    [changeLog, dayDeltas] = await Promise.all([loadChangeLog(matrix), loadDayDeltas(matrix)]);
    mirror = buildMirrorOverlay(matrix.rows, loadLatestA1Capture() ?? undefined);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to build the scorecard';
  }

  return (
    <SetupsView
      initial={matrix}
      initialHealth={health}
      initialChangeLog={changeLog}
      initialMirror={mirror}
      initialError={error}
      initialView={initialView}
      initialDayDeltas={dayDeltas}
    />
  );
}
