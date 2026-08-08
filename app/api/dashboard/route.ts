/**
 * Dashboard data, polled by the UI while it is open.
 *
 * Read-only with respect to alerts: it never marks an alert as delivered, so
 * having the dashboard open cannot suppress a Telegram notification.
 */

import { NextResponse } from 'next/server';
import { runPipeline } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await runPipeline({ deliverAlerts: false });
    return NextResponse.json(result.dashboard, {
      // Connector-level TTL caching already prevents upstream hammering; this
      // just stops a proxy holding a stale payload.
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'pipeline failed' },
      { status: 500 },
    );
  }
}
