/**
 * Top Setups matrix data.
 *
 * Heavier than the news dashboard (a 150-day calendar pull plus 13 COT contracts
 * plus 66 Yahoo series), but almost all of it is served from the connector cache
 * after the first call — the underlying data changes daily at most, and COT
 * weekly.
 */

import { NextResponse } from 'next/server';
import { loadMirrorCapture } from '@/lib/a1-capture-file';
import { loadChangeLog, loadDayDeltas } from '@/lib/change-log';
import { buildMirrorOverlay } from '@/lib/scoring/a1-mirror';
import { buildA1ProfileRows, runSetupsPipeline } from '@/lib/setups-pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await runSetupsPipeline();
    const { matrix, health } = payload;
    const [changeLog, dayDelta] = await Promise.all([loadChangeLog(matrix), loadDayDeltas(matrix)]);
    /**
     * A compact diff, not a second board: see `buildMirrorOverlay`. Built here
     * rather than in the browser because the capture lives on disk and the
     * sum-and-band rule must not be restated client-side.
     */
    const { capture, staleLabel } = loadMirrorCapture();
    const mirror = buildMirrorOverlay(matrix.rows, capture ?? undefined, buildA1ProfileRows(payload), staleLabel);
    return NextResponse.json(
      {
        ...matrix,
        health,
        changeLog,
        mirror,
        dayDeltas: dayDelta.deltas,
        dayDeltaComparedWithUtc: dayDelta.comparedWithUtc,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'setups pipeline failed' },
      { status: 500 },
    );
  }
}
