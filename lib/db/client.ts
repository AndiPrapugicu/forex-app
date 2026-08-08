/**
 * Storage with a graceful fallback.
 *
 * If Supabase env vars are present we use Postgres. If not, we fall back to an
 * in-process store so `npm run dev` works on a clean checkout with no accounts
 * and no keys. The fallback is deliberately honest about its limitation:
 * serverless invocations do not share memory, so alert dedupe only truly works
 * once Supabase is configured. `store.durable` exposes that to callers.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Alert, EventScore, NewsItem, NormalizedEvent } from '@/lib/types';

export interface Store {
  /** False for the memory fallback — alert dedupe is best-effort only. */
  readonly durable: boolean;
  readonly kind: 'supabase' | 'memory';

  /**
   * Does the store actually work right now?
   *
   * Being CONFIGURED and being FUNCTIONAL are different things, and conflating
   * them hides the worst failure mode this app has. With credentials set but the
   * schema never run, every query fails, `hasAlert` falls back to "already seen",
   * and alerts are silently suppressed forever — while the health endpoint
   * cheerfully reports that dedupe is reliable. This makes the difference
   * observable instead of invisible.
   */
  verify(): Promise<{ ok: boolean; detail?: string }>;

  upsertEvents(events: NormalizedEvent[]): Promise<void>;
  getEvents(fromUtc: string, toUtc: string): Promise<NormalizedEvent[]>;
  getEvent(id: string): Promise<NormalizedEvent | null>;

  setManualActual(eventId: string, actual: number, note?: string): Promise<void>;
  getManualActuals(): Promise<Map<string, number>>;

  saveScores(scores: EventScore[]): Promise<void>;
  getScores(eventIds: string[]): Promise<Map<string, EventScore>>;

  upsertNews(items: NewsItem[]): Promise<void>;
  getNews(sinceUtc: string): Promise<NewsItem[]>;

  /** True if this alert hash was already recorded — the anti-spam gate. */
  hasAlert(hash: string): Promise<boolean>;
  recordAlert(alert: Alert, delivered: boolean): Promise<void>;
  getRecentAlerts(limit: number): Promise<Alert[]>;

  getAiCache(hash: string): Promise<unknown | null>;
  setAiCache(hash: string, kind: string, model: string, output: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

/**
 * Module-level so it survives hot reloads and repeated route invocations within
 * a single dev process. Explicitly NOT durable across serverless instances.
 */
const mem = {
  events: new Map<string, NormalizedEvent>(),
  manual: new Map<string, number>(),
  scores: new Map<string, EventScore>(),
  news: new Map<string, NewsItem>(),
  alerts: new Map<string, Alert>(),
  ai: new Map<string, unknown>(),
};

class MemoryStore implements Store {
  readonly durable = false;
  readonly kind = 'memory' as const;

  async verify() {
    // Always functional, but never durable across serverless invocations.
    return { ok: true, detail: 'in-memory — not shared between deployments' };
  }

  async upsertEvents(events: NormalizedEvent[]) {
    for (const e of events) mem.events.set(e.id, e);
  }

  async getEvents(fromUtc: string, toUtc: string) {
    return [...mem.events.values()]
      .filter((e) => e.dateUtc >= fromUtc && e.dateUtc <= toUtc)
      .sort((a, b) => a.dateUtc.localeCompare(b.dateUtc));
  }

  async getEvent(id: string) {
    return mem.events.get(id) ?? null;
  }

  async setManualActual(eventId: string, actual: number) {
    mem.manual.set(eventId, actual);
  }

  async getManualActuals() {
    return new Map(mem.manual);
  }

  async saveScores(scores: EventScore[]) {
    for (const s of scores) mem.scores.set(s.eventId, s);
  }

  async getScores(eventIds: string[]) {
    const out = new Map<string, EventScore>();
    for (const id of eventIds) {
      const s = mem.scores.get(id);
      if (s) out.set(id, s);
    }
    return out;
  }

  async upsertNews(items: NewsItem[]) {
    for (const n of items) mem.news.set(n.id, n);
  }

  async getNews(sinceUtc: string) {
    return [...mem.news.values()]
      .filter((n) => n.publishedUtc >= sinceUtc)
      .sort((a, b) => b.publishedUtc.localeCompare(a.publishedUtc));
  }

  async hasAlert(hash: string) {
    return mem.alerts.has(hash);
  }

  async recordAlert(alert: Alert) {
    mem.alerts.set(alert.hash, alert);
  }

  async getRecentAlerts(limit: number) {
    return [...mem.alerts.values()]
      .sort((a, b) => b.createdUtc.localeCompare(a.createdUtc))
      .slice(0, limit);
  }

  async getAiCache(hash: string) {
    return mem.ai.get(hash) ?? null;
  }

  async setAiCache(hash: string, _kind: string, _model: string, output: unknown) {
    mem.ai.set(hash, output);
  }
}

// ---------------------------------------------------------------------------
// Supabase store
// ---------------------------------------------------------------------------

/** DB snake_case <-> app camelCase. Kept explicit; the shapes must not drift. */
function rowToEvent(r: Record<string, unknown>): NormalizedEvent {
  return {
    id: r.id as string,
    seriesId: (r.series_id as string) ?? null,
    name: r.name as string,
    currency: r.currency as NormalizedEvent['currency'],
    dateUtc: new Date(r.date_utc as string).toISOString(),
    impact: r.impact as NormalizedEvent['impact'],
    actual: (r.actual as number) ?? null,
    consensus: (r.consensus as number) ?? null,
    previous: (r.previous as number) ?? null,
    revised: (r.revised as number) ?? null,
    unit: (r.unit as string) ?? null,
    ratioDeviation: (r.ratio_deviation as number) ?? null,
    isBetterThanExpected: (r.is_better_than_expected as boolean) ?? null,
    isSpeech: Boolean(r.is_speech),
    isPreliminary: Boolean(r.is_preliminary),
    source: r.source as NormalizedEvent['source'],
    actualSource: (r.actual_source as NormalizedEvent['actualSource']) ?? null,
    sourceUrl: (r.source_url as string) ?? null,
    lastUpdated: (r.last_updated as number) ?? null,
  };
}

function eventToRow(e: NormalizedEvent) {
  return {
    id: e.id,
    series_id: e.seriesId ?? null,
    name: e.name,
    currency: e.currency,
    date_utc: e.dateUtc,
    impact: e.impact,
    actual: e.actual,
    consensus: e.consensus,
    previous: e.previous,
    revised: e.revised,
    unit: e.unit ?? null,
    ratio_deviation: e.ratioDeviation,
    is_better_than_expected: e.isBetterThanExpected,
    is_speech: e.isSpeech,
    is_preliminary: e.isPreliminary,
    source: e.source,
    actual_source: e.actualSource,
    source_url: e.sourceUrl ?? null,
    last_updated: e.lastUpdated ?? null,
    updated_at: new Date().toISOString(),
  };
}

class SupabaseStore implements Store {
  readonly durable = true;
  readonly kind = 'supabase' as const;

  constructor(private db: SupabaseClient) {}

  /**
   * Cheapest query that proves credentials AND schema are both good.
   *
   * Deliberately a real GET rather than a HEAD: a HEAD returns no body, so
   * supabase-js has nothing to parse an error from and reports success even
   * against a database with no tables at all.
   */
  async verify() {
    const { error } = await this.db.from('alert_log').select('hash').limit(1);
    if (!error) return { ok: true };

    if (/schema cache|does not exist|PGRST205/i.test(error.message)) {
      return { ok: false, detail: 'tables missing — run lib/db/schema.sql' };
    }
    if (/JWT|api key|Invalid/i.test(error.message)) {
      return { ok: false, detail: 'credentials rejected — check SUPABASE_SERVICE_KEY' };
    }
    return { ok: false, detail: error.message };
  }

  async upsertEvents(events: NormalizedEvent[]) {
    if (!events.length) return;
    // Chunked: Supabase rejects very large single payloads.
    for (let i = 0; i < events.length; i += 500) {
      const chunk = events.slice(i, i + 500).map(eventToRow);
      const { error } = await this.db.from('events').upsert(chunk, { onConflict: 'id' });
      if (error) throw new Error(`upsertEvents: ${error.message}`);
    }
  }

  async getEvents(fromUtc: string, toUtc: string) {
    const { data, error } = await this.db
      .from('events')
      .select('*')
      .gte('date_utc', fromUtc)
      .lte('date_utc', toUtc)
      .order('date_utc', { ascending: true });
    if (error) throw new Error(`getEvents: ${error.message}`);
    return (data ?? []).map(rowToEvent);
  }

  async getEvent(id: string) {
    const { data, error } = await this.db.from('events').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getEvent: ${error.message}`);
    return data ? rowToEvent(data) : null;
  }

  async setManualActual(eventId: string, actual: number, note?: string) {
    const { error } = await this.db
      .from('manual_actuals')
      .upsert({ event_id: eventId, actual, note: note ?? null }, { onConflict: 'event_id' });
    if (error) throw new Error(`setManualActual: ${error.message}`);
  }

  async getManualActuals() {
    const { data, error } = await this.db.from('manual_actuals').select('event_id, actual');
    if (error) throw new Error(`getManualActuals: ${error.message}`);
    return new Map((data ?? []).map((r) => [r.event_id as string, r.actual as number]));
  }

  async saveScores(scores: EventScore[]) {
    if (!scores.length) return;
    const rows = scores.map((s) => ({
      event_id: s.eventId,
      currency: s.currency,
      score: s.score,
      confidence: s.confidence,
      direction: s.direction,
      surprise: s.surprise,
      trace: s.trace,
      polarity_conflict: s.polarityConflict,
      scored_at: s.scoredAtUtc,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await this.db
        .from('event_scores')
        .upsert(rows.slice(i, i + 500), { onConflict: 'event_id' });
      if (error) throw new Error(`saveScores: ${error.message}`);
    }
  }

  async getScores(eventIds: string[]) {
    if (!eventIds.length) return new Map();
    const { data, error } = await this.db.from('event_scores').select('*').in('event_id', eventIds);
    if (error) throw new Error(`getScores: ${error.message}`);
    return new Map(
      (data ?? []).map((r) => [
        r.event_id as string,
        {
          eventId: r.event_id as string,
          currency: r.currency,
          score: r.score,
          confidence: r.confidence,
          direction: r.direction,
          surprise: r.surprise,
          trace: r.trace ?? [],
          polarityConflict: r.polarity_conflict,
          scoredAtUtc: new Date(r.scored_at as string).toISOString(),
        } as EventScore,
      ]),
    );
  }

  async upsertNews(items: NewsItem[]) {
    if (!items.length) return;
    const rows = items.map((n) => ({
      id: n.id,
      title: n.title,
      url: n.url,
      domain: n.domain,
      source_name: n.sourceName,
      published_utc: n.publishedUtc,
      summary: n.summary ?? null,
      category: n.category,
      matched_keywords: n.matchedKeywords,
      affects: n.affects,
    }));
    const { error } = await this.db.from('news_items').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`upsertNews: ${error.message}`);
  }

  async getNews(sinceUtc: string) {
    const { data, error } = await this.db
      .from('news_items')
      .select('*')
      .gte('published_utc', sinceUtc)
      .order('published_utc', { ascending: false })
      .limit(200);
    if (error) throw new Error(`getNews: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      domain: r.domain,
      sourceName: r.source_name,
      publishedUtc: new Date(r.published_utc as string).toISOString(),
      summary: r.summary,
      category: r.category,
      matchedKeywords: r.matched_keywords ?? [],
      affects: r.affects ?? [],
    })) as NewsItem[];
  }

  async hasAlert(hash: string) {
    const { data, error } = await this.db.from('alert_log').select('hash').eq('hash', hash).maybeSingle();
    if (error) throw new Error(`hasAlert: ${error.message}`);
    return Boolean(data);
  }

  async recordAlert(alert: Alert, delivered: boolean) {
    const { error } = await this.db.from('alert_log').upsert(
      {
        hash: alert.hash,
        kind: alert.kind,
        severity: alert.severity,
        title: alert.title,
        body: alert.body,
        affects: alert.affects,
        sources: alert.sources,
        high_confidence: alert.highConfidence,
        event_id: alert.eventId ?? null,
        created_at: alert.createdUtc,
        delivered_at: delivered ? new Date().toISOString() : null,
      },
      { onConflict: 'hash' },
    );
    if (error) throw new Error(`recordAlert: ${error.message}`);
  }

  async getRecentAlerts(limit: number) {
    const { data, error } = await this.db
      .from('alert_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`getRecentAlerts: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.hash,
      hash: r.hash,
      kind: r.kind,
      severity: r.severity,
      title: r.title,
      body: r.body,
      affects: r.affects ?? [],
      sources: r.sources ?? [],
      createdUtc: new Date(r.created_at as string).toISOString(),
      highConfidence: r.high_confidence,
      eventId: r.event_id,
    })) as Alert[];
  }

  async getAiCache(hash: string) {
    const { data, error } = await this.db.from('ai_cache').select('output').eq('hash', hash).maybeSingle();
    if (error) return null; // cache miss must never break the request path
    return data?.output ?? null;
  }

  async setAiCache(hash: string, kind: string, model: string, output: unknown) {
    await this.db.from('ai_cache').upsert({ hash, kind, model, output }, { onConflict: 'hash' });
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  // Service role key: server-side only. Never expose via NEXT_PUBLIC_*.
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (url && key) {
    cached = new SupabaseStore(createClient(url, key, { auth: { persistSession: false } }));
  } else {
    cached = new MemoryStore();
  }
  return cached;
}

/** Test seam — lets suites swap in a clean store. */
export function __setStore(s: Store | null) {
  cached = s;
}
