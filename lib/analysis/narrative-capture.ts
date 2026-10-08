/**
 * The ingest run's narrative step: evaluate the open positions, decide the
 * alerts, store the day's snapshot, and remember each position's status.
 *
 * Runs only from /api/ingest — the one path allowed to deliver to Telegram.
 * Same failure policy as the score history: report, never throw, so a broken
 * narrative costs a snapshot and never the release alerts.
 */

import { DIGEST_WATCH_ASSETS, NARRATIVE_CACHE_KIND } from '@/config/narrative.config';
import { ALL_SYMBOLS } from '@/config/symbols.config';
import { digestAlert, digestDue, flipAlerts, redAlerts } from '@/lib/alerts/narrative';
import { sendAlerts, type TelegramResult } from '@/lib/alerts/telegram';
import type { Store } from '@/lib/db/client';
import type { SetupsPayload } from '@/lib/setups-pipeline';
import type { Alert } from '@/lib/types';
import { loadNarrative, pairFromBundle } from '@/lib/analysis/narrative-load';
import { evaluatePositions, readOpenPositions } from '@/lib/analysis/positions-load';
import { buildSnapshot, dayKey, isSnapshot, LATEST_KEY, SNAPSHOT_MODEL, type NarrativeSnapshot } from '@/lib/analysis/snapshot';
import { effectsOf, type FlipCondition, type PairNarrative } from '@/lib/analysis/state';

const DAY_MS = 86_400_000;

export interface NarrativeCapture {
  saved: boolean;
  positions: number;
  alerts: number;
  delivered: number;
  digest: boolean;
  positionsError?: string;
  error?: string;
}

async function readSnapshot(store: Store, key: string): Promise<NarrativeSnapshot | null> {
  const v = await store.getAiCache(key).catch(() => null);
  return isSnapshot(v) ? v : null;
}

export async function captureNarrative(
  store: Store,
  board: Promise<SetupsPayload>,
  now = new Date(),
  deliver: (alerts: Alert[]) => Promise<TelegramResult> = sendAlerts,
): Promise<NarrativeCapture> {
  try {
    const payload = await board;
    const [bundle, read, yesterday] = await Promise.all([
      loadNarrative(now, board),
      readOpenPositions(),
      readSnapshot(store, dayKey(new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10))),
    ]);
    const previous = bundle.latest;

    const { views, pairs: positionPairs, fired } = read.positions.length
      ? await evaluatePositions(read.positions, { now, payload, bundle })
      : { views: [], pairs: new Map<string, PairNarrative>(), fired: [] };

    // Every symbol's verdict, the position symbols with their price levels.
    const pairs: PairNarrative[] = [];
    for (const def of ALL_SYMBOLS) {
      const p = positionPairs.get(def.symbol) ?? pairFromBundle(bundle, def);
      if (p) pairs.push(p);
    }
    const allFlips: Record<string, FlipCondition[]> = Object.fromEntries(pairs.map((p) => [p.symbol, p.flips]));

    const positionSymbols = new Set(read.positions.map((p) => p.symbol));
    const remembered = new Set((previous?.fired ?? []).map((f) => `${f.symbol}|${f.id}`));
    const fresh = fired.filter((f) => !remembered.has(`${f.symbol}|${f.id}`));

    const snapshot = buildSnapshot({
      state: bundle.state,
      effects: effectsOf(bundle.state),
      pairs,
      keepFlipsFor: positionSymbols,
      previous,
      twoYear: payload.sovereignYields,
      fired,
      at: now,
    });

    // --- Alerts -----------------------------------------------------------
    const watch = [...ALL_SYMBOLS.filter((s) => s.kind === 'currency').map((s) => s.symbol), ...DIGEST_WATCH_ASSETS, ...positionSymbols];
    const digest = digestAlert({
      now,
      verdicts: snapshot.verdicts,
      yesterday: yesterday?.verdicts ?? null,
      watch: [...new Set(watch)],
      views,
      flips: allFlips,
      fired,
      digestSentFor: previous?.digestSentFor,
    });
    const candidates = [...flipAlerts(fresh, views, now), ...redAlerts(views, now), ...(digest ? [digest] : [])];

    const newAlerts: Alert[] = [];
    for (const a of candidates) {
      // A store blip reads as "already sent": silence, never a storm.
      const seen = await store.hasAlert(a.hash).catch(() => true);
      if (!seen) newAlerts.push(a);
    }
    let delivered = 0;
    if (newAlerts.length) {
      const result = await deliver(newAlerts);
      delivered = result.sent;
      for (const a of newAlerts) await store.recordAlert(a, result.sent > 0).catch(() => {});
    }
    // Marked whether or not there was anything to say, so a quiet day is not re-checked every run.
    if (digestDue(now, previous?.digestSentFor)) snapshot.digestSentFor = now.toISOString().slice(0, 10);

    // --- Store ------------------------------------------------------------
    await store.setAiCache(LATEST_KEY, NARRATIVE_CACHE_KIND, SNAPSHOT_MODEL, snapshot);
    await store.setAiCache(dayKey(snapshot.date), NARRATIVE_CACHE_KIND, SNAPSHOT_MODEL, snapshot);

    // After the alerts, which compare against the previous run's status.
    const stamp = now.toISOString();
    for (const v of views) {
      if (!v.report || v.report.status === v.position.lastStatus) continue;
      await store.updatePosition(v.position.id, { lastStatus: v.report.status, lastStatusAtUtc: stamp }).catch(() => null);
    }

    return {
      saved: true,
      positions: views.length,
      alerts: newAlerts.length,
      delivered,
      digest: digest !== null && newAlerts.includes(digest),
      positionsError: read.error ?? undefined,
    };
  } catch (err) {
    return { saved: false, positions: 0, alerts: 0, delivered: 0, digest: false, error: err instanceof Error ? err.message : String(err) };
  }
}
