/**
 * Live headline search, for the AI analyst's `search_news` tool.
 *
 * GOOGLE NEWS RSS, AND NOT OPENROUTER'S WEB SEARCH. OpenRouter bills its search
 * plugin per request even on free models, and the analyst must never cost
 * anything. Google News answers an arbitrary query as an RSS feed, with no key,
 * and this app already reads one such query for its Reuters feed
 * (`config/sources.config.ts`). The feed's own terms limit it to personal,
 * non-commercial reading, which is what this single-user dashboard is.
 *
 * What comes back is a headline, a source and a time — no article body. The
 * analyst is told exactly that, so a headline is never treated as the story.
 */

import { XMLParser } from 'fast-xml-parser';
import { fetchText, fixturesEnabled } from '@/lib/connectors/base';
import { parseDate } from '@/lib/connectors/rss';

export interface SearchHit {
  title: string;
  source: string;
  /** Bare domain of the publisher, not of Google's redirect. */
  domain: string;
  url: string;
  publishedUtc: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

/** Same five-minute horizon as the RSS feeds: a 15-minute-old headline must show. */
const SEARCH_CACHE_TTL_SECONDS = 300;
export const SEARCH_QUERY_MAX_CHARS = 80;

/**
 * Letters, digits, spaces and a little punctuation, capped.
 *
 * The query is model-written, so it is treated as untrusted: nothing that could
 * add a Google operator beyond the `when:` we append, and nothing long enough to
 * be a prompt smuggled into a URL.
 */
export function sanitizeQuery(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N}\s/&.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_QUERY_MAX_CHARS)
    .trim();
}

export function searchUrl(query: string, days = 2): string {
  const q = encodeURIComponent(`${query} when:${days}d`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

function text(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && typeof (node as Record<string, unknown>)['#text'] === 'string') {
    return (node as Record<string, string>)['#text'];
  }
  return '';
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Parses a Google News search feed, newest first.
 *
 * Google appends " - Publisher" to every title; it is stripped when it matches
 * the `<source>` element, so the headline reads as the publisher wrote it.
 */
export function parseSearchFeed(xml: string, limit = 8): SearchHit[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  const channel = (doc.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  const raw = channel?.item;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];

  const hits: SearchHit[] = [];
  for (const item of items) {
    const publishedUtc = parseDate(item.pubDate);
    if (!publishedUtc) continue;
    const sourceNode = item.source as Record<string, unknown> | string | undefined;
    const source = text(sourceNode);
    const sourceUrl = typeof sourceNode === 'object' && sourceNode ? String(sourceNode['@_url'] ?? '') : '';
    let title = text(item.title).trim();
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    if (!title) continue;
    hits.push({ title, source, domain: domainOf(sourceUrl), url: text(item.link), publishedUtc });
  }

  return hits.sort((a, b) => b.publishedUtc.localeCompare(a.publishedUtc)).slice(0, limit);
}

/** One query. Empty on any failure — a missing search is a gap, not an error page. */
export async function searchNews(
  rawQuery: string,
  /**
   * `cacheTtlSeconds` is for callers that run many standing queries (the
   * narrative engine runs one per bank and one per economy); a question typed
   * into the analyst keeps the five-minute horizon.
   */
  opts: { limit?: number; days?: number; cacheTtlSeconds?: number } = {},
): Promise<SearchHit[]> {
  const query = sanitizeQuery(rawQuery);
  if (!query || fixturesEnabled()) return [];

  const res = await fetchText(`Google News: ${query}`, searchUrl(query, opts.days ?? 2), {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cacheTtlSeconds: opts.cacheTtlSeconds ?? SEARCH_CACHE_TTL_SECONDS,
    timeoutMs: 8_000,
    retries: 1,
  });
  return res.ok ? parseSearchFeed(res.data, opts.limit ?? 8) : [];
}
