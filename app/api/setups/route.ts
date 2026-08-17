/**
 * Top Setups matrix data.
 *
 * Heavier than the news dashboard (a 150-day calendar pull plus 13 COT contracts
 * plus 66 Yahoo series), but almost all of it is served from the connector cache
 * after the first call — the underlying data changes daily at most, and COT
 * weekly.
 */

import { NextResponse } from 'next/server';
import { loadChangeLog } from '@/lib/change-log';
import { runSetupsPipeline } from '@/lib/setups-pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const { matrix, health } = await runSetupsPipeline();
    const changeLog = await loadChangeLog(matrix);
    return NextResponse.json(
      { ...matrix, health, changeLog },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'setups pipeline failed' },
      { status: 500 },
    );
  }
}
