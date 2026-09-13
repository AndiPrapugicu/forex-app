/**
 * Economic Calendar — upcoming medium/high impact releases and recent surprises.
 *
 * Split out of News & Alerts. Same pipeline and the same /api/dashboard poll, so
 * the two pages never disagree about a release.
 */

import { runPipeline } from '@/lib/pipeline';
import type { DashboardData } from '@/lib/types';
import { DashboardView } from '@/components/DashboardView';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  let initial: DashboardData | null = null;
  let error: string | null = null;

  try {
    const result = await runPipeline({ deliverAlerts: false });
    initial = result.dashboard;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load data';
  }

  return <DashboardView initial={initial} initialError={error} mode="calendar" />;
}
