/**
 * Cron target: ingest, score, and deliver alerts.
 *
 * Called every 10 minutes by the GitHub Actions workflow. This is the only path
 * that delivers to Telegram — dashboard renders deliberately do not, so opening
 * the page cannot swallow a notification before it reaches the phone.
 */

import { NextResponse } from 'next/server';
import { runPipeline } from '@/lib/pipeline';
import { runSetupsPipeline } from '@/lib/setups-pipeline';
import { buildSnapshots } from '@/lib/scoring/history';
import { getStore, type Store } from '@/lib/db/client';

// Always dynamic: this route has side effects and must never be cached.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Constant-time comparison, so the secret cannot be probed byte-by-byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorize(request: Request): string | null {
  const expected = process.env.CRON_SECRET;

  // With no secret configured the route is open. That is fine locally, but it
  // would let anyone trigger ingest in production, so it is called out loudly
  // in the README and flagged in the response body below.
  if (!expected) return null;

  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const query = new URL(request.url).searchParams.get('key') ?? '';

  if (safeEqual(bearer, expected) || safeEqual(query, expected)) return null;
  return 'unauthorized';
}

/**
 * Captures a score snapshot per symbol.
 *
 * Deliberately swallows its own failures. This runs alongside alert delivery,
 * and the free feeds have no history endpoint — so a broken snapshot write
 * should cost one data point, never the alerts that matter more. The outcome is
 * reported in the response rather than thrown, so a persistent failure is still
 * visible in the workflow log.
 */
async function captureHistory(store: Store): Promise<{ saved: number; error?: string }> {
  try {
    const { matrix } = await runSetupsPipeline();
    const snapshots = buildSnapshots(matrix);
    await store.saveSnapshots(snapshots);
    return { saved: snapshots.length };
  } catch (err) {
    return { saved: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handle(request: Request) {
  const denied = authorize(request);
  if (denied) {
    return NextResponse.json({ error: denied }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const result = await runPipeline({ deliverAlerts: true });
    const store = getStore();
    const history = await captureHistory(store);

    // Configured is not the same as working. With credentials set but no schema,
    // every query fails and alerts are silently suppressed — so dedupe is only
    // reported reliable when the store is BOTH durable and actually functional.
    const storage = await store.verify();

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - startedAt,
      storage: store.kind,
      storageOk: storage.ok,
      storageDetail: storage.detail,
      alertDedupeReliable: store.durable && storage.ok,
      snapshotsSaved: history.saved,
      snapshotError: history.error,
      // Snapshots in memory vanish between serverless invocations, so history
      // only accumulates for real once Supabase is configured.
      historyDurable: store.durable && storage.ok,
      unsecured: !process.env.CRON_SECRET,
      events: result.dashboard.upcoming.length + result.dashboard.recent.length,
      newAlerts: result.newAlerts.length,
      conflicts: result.conflicts.length,
      health: result.dashboard.health,
    });
  } catch (err) {
    // A crash here means the cron silently stops working, so return the reason.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

// POST supported so the workflow can use either verb.
export async function POST(request: Request) {
  return handle(request);
}
