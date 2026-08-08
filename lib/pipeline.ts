/**
 * The ingest → score → alert pipeline.
 *
 * One entry point used by both the cron route and the dashboard route, so what
 * the user sees and what the alerts fire on can never drift apart.
 *
 * Failure policy: every stage is independently recoverable. If news dies we
 * still score the calendar; if the calendar dies we still show news. The only
 * total failure is every source dying at once, and even then the UI renders with
 * a banner rather than an error page.
 */

import { resolveCalendar } from '@/lib/actuals/resolver';
import { fetchNews } from '@/lib/connectors/rss';
import { fetchPrices } from '@/lib/connectors/prices';
import { evaluateAlerts } from '@/lib/alerts/rules';
import { sendAlerts } from '@/lib/alerts/telegram';
import { getStore } from '@/lib/db/client';
import { computeAssetScores } from '@/lib/scoring/assets';
import { computeCurrencyStrength, computeMarketMood, computePairScores } from '@/lib/scoring/currency';
import { clusterNews, computeRiskFactors } from '@/lib/scoring/news';
import { scoreEvent } from '@/lib/scoring/surprise';
import type { Alert, DashboardData, NewsItem, SourceHealth } from '@/lib/types';

export interface PipelineResult {
  dashboard: DashboardData;
  /** Alerts that were newly raised this run (already deduped against history). */
  newAlerts: Alert[];
  conflicts: { eventId: string; manual: number; feed: number; feedSource: string }[];
}

/** How much history the dashboard shows for "what just came out". */
const RECENT_WINDOW_HOURS = 48;
/** How far ahead the upcoming panel looks. */
const UPCOMING_WINDOW_HOURS = 72;

export async function runPipeline(
  options: { deliverAlerts?: boolean; now?: Date } = {},
): Promise<PipelineResult> {
  const now = options.now ?? new Date();
  const store = getStore();

  // --- 1. Ingest ----------------------------------------------------------
  // Manual actuals are loaded first: they take precedence over every feed, so
  // the resolver needs them before it merges anything.
  const manualActuals = await store.getManualActuals().catch(() => new Map<string, number>());

  const [calendar, newsRes, pricesRes] = await Promise.all([
    resolveCalendar(manualActuals, now),
    fetchNews(),
    fetchPrices(),
  ]);

  const health: SourceHealth[] = [...calendar.health];

  // Storage health belongs on the dashboard alongside the feeds. A broken store
  // does not blank the page — it suppresses alerts — which is exactly the kind
  // of silent failure worth putting in front of the user.
  const storage = await store.verify().catch(() => ({ ok: false, detail: 'unreachable' }));
  if (!storage.ok) {
    health.push({
      source: `Storage (${store.kind})`,
      ok: false,
      detail: `${storage.detail ?? 'unavailable'} — alerts will not be delivered`,
      fetchedAtUtc: now.toISOString(),
    });
  }

  const news: NewsItem[] = newsRes.ok ? newsRes.data : [];
  health.push({
    source: newsRes.source,
    ok: newsRes.ok,
    detail: newsRes.ok ? newsRes.degraded : newsRes.error,
    fetchedAtUtc: newsRes.fetchedAtUtc,
  });

  const prices = pricesRes.ok ? pricesRes.data : [];
  health.push({
    source: pricesRes.source,
    ok: pricesRes.ok,
    detail: pricesRes.ok ? pricesRes.degraded : pricesRes.error,
    fetchedAtUtc: pricesRes.fetchedAtUtc,
  });

  // Persistence is best-effort. On the memory store this is a no-op; if
  // Supabase is down we would rather render the dashboard than fail the request.
  await store.upsertEvents(calendar.events).catch(() => {});
  await store.upsertNews(news).catch(() => {});

  // --- 2. Score -----------------------------------------------------------
  const scored = calendar.events.map((event) => ({ event, score: scoreEvent(event, now) }));
  await store.saveScores(scored.map((s) => s.score)).catch(() => {});

  const clusters = clusterNews(news);
  const strengths = computeCurrencyStrength(scored, now);
  const pairs = computePairScores(strengths);
  const factors = computeRiskFactors(clusters, strengths, now);
  const assets = computeAssetScores(factors, strengths, clusters);
  const marketMood = computeMarketMood(strengths);

  // --- 3. Alerts ----------------------------------------------------------
  const candidates = evaluateAlerts({ events: calendar.events, scored, clusters, now });

  // Dedupe against history. This is what stops the 10-minute cron re-sending
  // the same alert forever; hasAlert failures are treated as "already seen" so
  // a DB blip causes silence rather than a notification storm.
  const newAlerts: Alert[] = [];
  for (const alert of candidates) {
    const seen = await store.hasAlert(alert.hash).catch(() => true);
    if (!seen) newAlerts.push(alert);
  }

  if (options.deliverAlerts && newAlerts.length > 0) {
    const delivery = await sendAlerts(newAlerts);
    for (const alert of newAlerts) {
      await store.recordAlert(alert, delivery.sent > 0).catch(() => {});
    }
  } else if (newAlerts.length > 0) {
    // Dashboard renders do not deliver, and must not consume the alert either —
    // otherwise opening the page would silently suppress the phone notification.
  }

  const recentAlerts = await store.getRecentAlerts(25).catch(() => [] as Alert[]);
  // Merge history with anything new this run so the feed is current even before
  // the next cron writes it.
  const alerts = [...new Map([...newAlerts, ...recentAlerts].map((a) => [a.hash, a])).values()]
    .sort((a, b) => b.createdUtc.localeCompare(a.createdUtc))
    .slice(0, 25);

  // --- 4. Shape for the UI ------------------------------------------------
  const nowMs = now.getTime();

  const upcoming = calendar.events
    .filter((e) => {
      const t = new Date(e.dateUtc).getTime();
      return t > nowMs && t <= nowMs + UPCOMING_WINDOW_HOURS * 3_600_000;
    })
    // High impact first within the window — that is what the trader plans around.
    .sort((a, b) => {
      const rank = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };
      const t = new Date(a.dateUtc).getTime() - new Date(b.dateUtc).getTime();
      return rank[a.impact] - rank[b.impact] || t;
    })
    .slice(0, 20);

  const recent = scored
    .filter(({ event, score }) => {
      if (event.actual === null || score.surprise === null) return false;
      const age = (nowMs - new Date(event.dateUtc).getTime()) / 3_600_000;
      return age >= 0 && age <= RECENT_WINDOW_HOURS;
    })
    // Biggest surprises first.
    .sort((a, b) => Math.abs(b.score.score) - Math.abs(a.score.score))
    .slice(0, 20);

  return {
    dashboard: {
      strengths,
      pairs,
      assets,
      upcoming,
      recent,
      alerts,
      news: clusters.slice(0, 20),
      prices,
      health,
      marketMood,
      generatedAtUtc: now.toISOString(),
    },
    newAlerts,
    conflicts: calendar.conflicts,
  };
}
