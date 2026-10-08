/**
 * What the central banks themselves last said — read from their own feeds.
 *
 * A headline that says "dovish Fed" is a journalist's reading of a statement.
 * The analyst is far better placed with the statement: this pulls each bank's
 * newest policy documents (decision, minutes or account, and policy speeches)
 * from the bank's OWN RSS feed, and the text of the page behind it.
 *
 * Probed 2026-10-03:
 *   Fed, ECB, BoE, BoC, SNB  feed answers, policy documents are HTML — read in full
 *   BoJ                      feed answers, documents are PDFs — title and date only
 *   RBNZ                     feed carries the OCR decisions, pages return 403 — title only
 *   RBA                      feed returns 403 — a gap, not scraped around
 *
 * A gap is reported as a gap. Nothing here substitutes a news site for a bank.
 *
 * Published documents do not change, so an extracted text is kept in `ai_cache`
 * keyed by its URL and never fetched twice.
 */

import { XMLParser } from 'fast-xml-parser';
import { fetchText, fixturesEnabled, stableId } from '@/lib/connectors/base';
import { parseDate } from '@/lib/connectors/rss';
import { getStore } from '@/lib/db/client';
import type { Currency } from '@/lib/types';

export interface BankFeed {
  currency: Currency;
  bank: string;
  /** Null when no official feed could be read; `gap` then says why. */
  url: string | null;
  /** Title patterns that mark a policy document, as opposed to statistics or HR. */
  policy: RegExp[];
  gap?: string;
}

export const BANK_FEEDS: BankFeed[] = [
  {
    currency: 'USD',
    bank: 'Federal Reserve',
    url: 'https://www.federalreserve.gov/feeds/press_monetary.xml',
    // Not the projections release: its numbers live in a PDF, and the page says nothing.
    policy: [/FOMC statement/i, /Minutes of the Federal Open Market Committee/i],
  },
  {
    currency: 'EUR',
    bank: 'European Central Bank',
    url: 'https://www.ecb.europa.eu/rss/press.html',
    /**
     * The feed holds only its 15 newest items, so the decision itself scrolls
     * off within days. Board members' policy speeches ("Isabel Schnabel:
     * Monetary policy in a world of overlapping shocks") are kept for that
     * reason; operational notices that merely mention monetary policy are not.
     */
    policy: [
      /monetary policy decisions/i,
      /account of the monetary policy/i,
      /^[^:]{3,60}: .*(monetary policy|inflation|economic outlook|euro area economy)/i,
    ],
  },
  {
    currency: 'GBP',
    bank: 'Bank of England',
    url: 'https://www.bankofengland.co.uk/rss/news',
    policy: [/Bank Rate (maintained|increased|reduced|cut|raised)/i, /Monetary Policy (Summary|Report)/i],
  },
  {
    currency: 'JPY',
    bank: 'Bank of Japan',
    url: 'https://www.boj.or.jp/en/rss/whatsnew.xml',
    policy: [
      /Statement on Monetary Policy/i,
      /Summary of Opinions at the Monetary Policy Meeting/i,
      /Minutes of the Monetary Policy Meeting/i,
      /Outlook for Economic Activity and Prices/i,
    ],
  },
  {
    currency: 'CHF',
    bank: 'Swiss National Bank',
    url: 'https://www.snb.ch/public/rss/en/news',
    policy: [/Monetary policy assessment/i, /introductory remarks, news conference/i],
  },
  {
    currency: 'CAD',
    bank: 'Bank of Canada',
    url: 'https://www.bankofcanada.ca/content_type/press-releases/feed/',
    policy: [/policy rate/i, /Monetary Policy Report/i],
  },
  {
    currency: 'NZD',
    bank: 'Reserve Bank of New Zealand',
    url: 'https://www.rbnz.govt.nz/feeds/news',
    policy: [/Official Cash Rate/i, /\bOCR\b/, /Monetary Policy (Statement|Review)/i],
  },
  {
    currency: 'AUD',
    bank: 'Reserve Bank of Australia',
    url: null,
    policy: [],
    gap: "the RBA's media-release feed refuses automated reads (HTTP 403)",
  },
];

export interface BankDocument {
  bank: string;
  currency: Currency;
  title: string;
  url: string;
  publishedUtc: string;
  /** Null for a PDF or a page that could not be read; the title still stands. */
  text: string | null;
  note?: string;
}

export interface BankCommunication {
  currency: Currency;
  bank: string;
  documents: BankDocument[];
  /** Why this bank contributes nothing, when it does not. */
  gap: string | null;
}

/** How far back a document still counts as the bank's latest word. */
const MAX_AGE_DAYS = 120;
const DOCS_PER_BANK = 2;
export const DOC_TEXT_MAX_CHARS = 10_000;
const FEED_TTL_SECONDS = 1800;
/**
 * Part of every cached document's key. Bump it when `extractPageText` changes,
 * or a text extracted by the old rules is served from `ai_cache` forever.
 */
const EXTRACTOR_VERSION = 2;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

function text(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && typeof (node as Record<string, unknown>)['#text'] === 'string') {
    return (node as Record<string, string>)['#text'];
  }
  return '';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * The newest policy documents in one bank's feed.
 *
 * Pure, so the title picking can be tested on a captured feed. Newest first,
 * one document per distinct title, so two "FOMC statement" items do not crowd
 * out the minutes.
 */
export function pickPolicyItems(
  xml: string,
  feed: BankFeed,
  now: Date,
  limit = DOCS_PER_BANK,
): { title: string; url: string; publishedUtc: string }[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  const channel = (doc.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined;
  const raw = channel?.item ?? rdf?.item ?? (doc.feed as Record<string, unknown> | undefined)?.entry;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  const oldest = now.getTime() - MAX_AGE_DAYS * 86_400_000;

  const picked: { title: string; url: string; publishedUtc: string }[] = [];
  const seenTitles = new Set<string>();
  const candidates = items
    .map((item) => {
      // SNB prefixes "2026-09-24 - Press release - "; the date is already a field.
      const title = decodeEntities(text(item.title))
        .replace(/\s+/g, ' ')
        .replace(/^\d{4}-\d{2}-\d{2} - (Press release - )?/, '')
        .trim();
      const link = item.link;
      const url = (typeof link === 'object' && link && '@_href' in (link as object)
        ? String((link as Record<string, unknown>)['@_href'])
        : text(link)
      ).trim().replace(/([^:])\/\/+/g, '$1/');
      const publishedUtc = parseDate(item.pubDate ?? item['dc:date'] ?? item.updated ?? item.published);
      return { title, url, publishedUtc };
    })
    .filter((c): c is { title: string; url: string; publishedUtc: string } =>
      Boolean(c.title && c.url && c.publishedUtc) && Date.parse(c.publishedUtc!) >= oldest && Date.parse(c.publishedUtc!) <= now.getTime(),
    )
    .sort((a, b) => b.publishedUtc.localeCompare(a.publishedUtc));

  for (const c of candidates) {
    if (!feed.policy.some((p) => p.test(c.title))) continue;
    const key = c.title.replace(/[\d,–-]+/g, '').toLowerCase().trim();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    picked.push(c);
    if (picked.length >= limit) break;
  }
  return picked;
}

/**
 * Where a bank page's own content starts, most specific first. The Fed has no
 * `<main>`: its statement sits in `<div id="article">`, which a regex cannot
 * close, so the content runs from the marker to the footer instead.
 */
const CONTENT_START = [/<main[\s>]/i, /<article[\s>]/i, /id="article"/i, /role="main"/i, /id="content"/i, /<body[\s>]/i];
const CONTENT_END = /<\/main>|<\/article>|<footer[\s>]/i;

/**
 * The readable text of a bank's HTML page.
 *
 * Drops scripts, styles and page furniture, and keeps paragraph breaks so a
 * statement still reads as one.
 */
export function extractPageText(html: string, maxChars = DOC_TEXT_MAX_CHARS): string {
  let start = 0;
  for (const marker of CONTENT_START) {
    const at = html.search(marker);
    if (at >= 0) {
      start = at;
      break;
    }
  }
  let body = html.slice(start);
  const end = body.search(CONTENT_END);
  if (end > 0) body = body.slice(0, end);
  body = body
    .replace(/^[^<]*>/, '')
    .replace(/<(script|style|noscript|nav|header|footer|aside|form|svg|button)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const cleaned = decodeEntities(body)
    .replace(/-->/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    // A line with no letters is page furniture: separators, share-button stubs.
    .filter((line) => /\p{L}/u.test(line))
    .join('\n');
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}…` : cleaned;
}

async function readDocument(item: { title: string; url: string; publishedUtc: string }, feed: BankFeed): Promise<BankDocument> {
  const base = { bank: feed.bank, currency: feed.currency, ...item };
  if (/\.pdf($|\?)/i.test(item.url)) return { ...base, text: null, note: 'PDF — title and date only, the text is not read' };

  const store = getStore();
  const hash = stableId('kb:cb-doc', EXTRACTOR_VERSION, item.url);
  const hit = (await store.getAiCache(hash).catch(() => null)) as { text?: string } | null;
  if (hit && typeof hit.text === 'string') return { ...base, text: hit.text };

  const res = await fetchText(`${feed.bank} document`, item.url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cacheTtlSeconds: 6 * 3600,
    timeoutMs: 10_000,
    retries: 1,
  });
  if (!res.ok) return { ...base, text: null, note: `could not be read: ${res.error}` };
  const body = extractPageText(res.data);
  if (body.length < 200) return { ...base, text: null, note: 'page carried no readable text' };

  await store.setAiCache(hash, 'kb:cb-doc', 'none', { text: body }).catch(() => {});
  return { ...base, text: body };
}

/** The latest word from each bank behind `currencies`. Never throws. */
export async function fetchBankCommunication(currencies: readonly Currency[], now = new Date()): Promise<BankCommunication[]> {
  const feeds = BANK_FEEDS.filter((f) => currencies.includes(f.currency));
  return Promise.all(
    feeds.map(async (feed): Promise<BankCommunication> => {
      const empty = { currency: feed.currency, bank: feed.bank, documents: [] as BankDocument[] };
      if (!feed.url) return { ...empty, gap: feed.gap ?? 'no official feed' };
      if (fixturesEnabled()) return { ...empty, gap: 'offline mode' };

      const res = await fetchText(`${feed.bank} feed`, feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        cacheTtlSeconds: FEED_TTL_SECONDS,
        timeoutMs: 10_000,
        retries: 1,
      });
      if (!res.ok) return { ...empty, gap: `official feed unreachable: ${res.error}` };

      const items = pickPolicyItems(res.data, feed, now);
      if (items.length === 0) {
        return { ...empty, gap: `no policy document in its official feed over the last ${MAX_AGE_DAYS} days` };
      }
      const documents = await Promise.all(items.map((item) => readDocument(item, feed)));
      return { ...empty, documents, gap: null };
    }),
  );
}
