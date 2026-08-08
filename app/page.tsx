/**
 * Dashboard.
 *
 * Server component for the first paint (fast, no loading flash), with a client
 * island polling for updates while the tab is open. Layout order follows how a
 * trader actually reads the screen: mood first, then who is strong, then what is
 * about to happen, then what just happened.
 */

import { runPipeline } from '@/lib/pipeline';
import type { DashboardData } from '@/lib/types';
import { DashboardView } from '@/components/DashboardView';

// Never statically rendered — the whole point is live data.
export const dynamic = 'force-dynamic';

export default async function Home() {
  let initial: DashboardData | null = null;
  let error: string | null = null;

  try {
    const result = await runPipeline({ deliverAlerts: false });
    initial = result.dashboard;
  } catch (err) {
    // A total pipeline failure still renders the shell with an explanation
    // rather than Next's error page — the user should see what broke.
    error = err instanceof Error ? err.message : 'Failed to load data';
  }

  return <DashboardView initial={initial} initialError={error} />;
}
