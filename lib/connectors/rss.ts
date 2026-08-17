/**
 * News ingestion across a deliberately diverse set of RSS feeds.
 *
 * This layer does the keyword scanning and currency tagging, but it does NOT
 * decide anything is true. Corroboration — counting how many DISTINCT domains
 * carry the same story — happens in lib/scoring/news.ts. One outlet syndicating
 * itself must never be able to manufacture confidence.
 */

import { XMLParser } from 'fast-xml-parser';
import { KEYWORD_RULES, NEWS_FEEDS, REGION_CURRENCY, RSS_CACHE_TTL_SECONDS, type NewsFeed } from '@/config/sources.config';
import { extractDomain, fetchText, stableId, fixturesEnabled } from '@/lib/connectors/base';
import { isMajor, ok, type Category, type Currency, type NewsItem, type Result } from '@/lib/types';

/** RSS in the wild is inconsistent; be permissive and normalise afterwards. */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

/** Feed items can be a single object or an array — RSS libraries all hit this. */
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Some feeds wrap text in CDATA objects rather than plain strings. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj['#text'] === 'string') return obj['#text'];
  }
  return '';
}

function linkOf(node: unknown): string {
  // RSS uses <link>text</link>; Atom uses <link href="..."/>.
  if (typeof node === 'string') return node;
  const arr = asArray(node as unknown[]);
  for (const entry of arr) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      const href = obj['@_href'];
      if (typeof href === 'string') return href;
      const text = textOf(entry);
      if (text) return text;
    }
  }
  return '';
}

function parseDate(raw: unknown): string {
  const text = textOf(raw);
  if (text) {
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // Undated items are treated as "just now" rather than dropped — a breaking
  // headline with a malformed date is exactly the one worth seeing.
  return new Date().toISOString();
}

/** Strips markup and entities out of RSS description blobs. */
function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ScanResult {
  category: Category;
  keywords: string[];
  /** 0..1 — how alarming the language is. Feeds the risk-off asset factor. */
  severity: number;
  supplyRisk: boolean;
}

/**
 * Runs the keyword rules over a headline.
 * Exported because the alert engine and the tests both need the same verdict.
 */
export function scanKeywords(text: string, fallback: Category): ScanResult {
  const keywords: string[] = [];
  let category: Category | null = null;
  let severity = 0;
  let supplyRisk = false;

  for (const rule of KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (!match) continue;

      keywords.push(match[0].toLowerCase());
      // Highest-severity rule wins the category — an article mentioning both
      // "sanctions" and "inflation" is filed under the more market-moving one.
      if (rule.severity > severity) {
        severity = rule.severity;
        category = rule.category;
      }
      if (rule.supplyRisk) supplyRisk = true;
    }
  }

  return {
    category: category ?? fallback,
    keywords: [...new Set(keywords)],
    severity,
    supplyRisk,
  };
}

/** Tags the currencies a headline plausibly touches, via region mentions. */
export function detectCurrencies(text: string): Currency[] {
  const found = new Set<Currency>();
  for (const { pattern, currency } of REGION_CURRENCY) {
    if (pattern.test(text) && isMajor(currency)) found.add(currency);
  }
  return [...found];
}

function parseFeed(xml: string, feed: NewsFeed): NewsItem[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }

  // RSS 2.0: rss.channel.item — Atom: feed.entry. Support both.
  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const atom = doc.feed as Record<string, unknown> | undefined;

  const entries = channel ? asArray(channel.item) : asArray(atom?.entry);

  const items: NewsItem[] = [];

  for (const entry of entries) {
    const e = entry as Record<string, unknown>;

    const title = clean(textOf(e.title));
    if (!title) continue;

    const url = linkOf(e.link) || textOf(e.guid);
    const published = parseDate(e.pubDate ?? e.published ?? e.updated ?? e['dc:date']);
    const summary = clean(textOf(e.description ?? e.summary ?? e.content));

    // Scan title AND summary — the alarming word is often only in the body.
    const scanned = scanKeywords(`${title} ${summary}`, feed.defaultCategory);
    const currencies = detectCurrencies(`${title} ${summary}`);

    items.push({
      // Title-based id so the same story keeps identity across refetches even
      // when a feed rewrites its URLs with tracking parameters.
      id: stableId('news', feed.domain, title),
      title,
      url: url || `https://${feed.domain}`,
      // Prefer the configured domain: Google News proxies real URLs behind its
      // own host, which would otherwise let one feed pose as many sources.
      domain: feed.domain || extractDomain(url),
      sourceName: feed.name,
      publishedUtc: published,
      summary: summary ? summary.slice(0, 500) : null,
      category: scanned.category,
      matchedKeywords: scanned.keywords,
      affects: currencies,
    });
  }

  return items;
}

/**
 * Fetches every configured feed in parallel.
 *
 * Always returns ok:true unless EVERY feed failed — partial news is still
 * useful, and the degraded message names exactly which sources are missing.
 */
export async function fetchNews(): Promise<Result<NewsItem[]>> {
  if (fixturesEnabled()) {
    const fixture = (await import('@/fixtures/sample-news.json')).default;
    return ok('rss:fixture', fixture as NewsItem[]);
  }

  const results = await Promise.all(
    NEWS_FEEDS.map(async (feed) => {
      const res = await fetchText(feed.name, feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        cacheTtlSeconds: RSS_CACHE_TTL_SECONDS,
        timeoutMs: 10_000,
        retries: 1, // ten feeds x heavy retries would blow the cron budget
      });
      if (!res.ok) return { feed, items: [] as NewsItem[], error: res.error };
      return { feed, items: parseFeed(res.data, feed), error: null };
    }),
  );

  const items = results.flatMap((r) => r.items);
  const failed = results.filter((r) => r.error);

  if (items.length === 0 && failed.length === NEWS_FEEDS.length) {
    return {
      ok: false,
      error: `all ${failed.length} news feeds failed`,
      source: 'RSS',
      fetchedAtUtc: new Date().toISOString(),
    };
  }

  // Same story from one domain twice (feed dupes) collapses by stable id.
  const deduped = [...new Map(items.map((i) => [i.id, i])).values()].sort((a, b) =>
    b.publishedUtc.localeCompare(a.publishedUtc),
  );

  return ok(
    'RSS',
    deduped,
    failed.length > 0 ? `${failed.map((f) => f.feed.name).join(', ')} unavailable` : undefined,
  );
}
