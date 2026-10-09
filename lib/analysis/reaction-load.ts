/**
 * Gathers the REACTION reader's inputs: the panel's 5-minute bars, the RSS
 * feeds, a few standing searches, and the headlines behind any pasted link.
 * All I/O is here; the reading is `lib/analysis/reaction.ts`, which is pure.
 * Nothing throws: a missing source is a named gap.
 */

import { INTRADAY_TICKER, REACTION_PANEL } from '@/config/reaction.config';
import type { SymbolDefinition } from '@/config/symbols.config';
import { fetchIntraday } from '@/lib/connectors/intraday';
import { searchNews, type SearchHit } from '@/lib/connectors/news-search';
import { fetchNews } from '@/lib/connectors/rss';
import { dedupeHeadlines, type Headline } from '@/lib/analysis/headlines';
import {
  buildPanel,
  findMove,
  fingerprint,
  fitNotes,
  linkQueries,
  rankCatalysts,
  type ReactionReading,
} from '@/lib/analysis/reaction';

/** Broad searches that catch a market-moving headline whatever the asset. */
function standingQueries(def: SymbolDefinition): string[] {
  const own = def.kind === 'fx' && def.base && def.quote ? `${def.base} ${def.quote}` : def.label;
  return [...new Set(['stock market', 'Treasury yields', own])];
}

const toHeadline = (h: SearchHit): Headline => ({ title: h.title, url: h.url, domain: h.source || h.domain, publishedUtc: h.publishedUtc });

export async function loadReaction(def: SymbolDefinition, question: string, now = new Date()): Promise<ReactionReading> {
  const primaryTicker = INTRADAY_TICKER[def.symbol] ?? def.yahoo;
  const links = linkQueries(question);

  const [series, rss, linkHits, standing] = await Promise.all([
    fetchIntraday([primaryTicker, ...REACTION_PANEL.map((i) => i.ticker)]).catch(() => new Map()),
    fetchNews(),
    Promise.all(links.map((l) => searchNews(l.query, { days: 3, limit: 5 }).catch((): SearchHit[] => []))),
    Promise.all(standingQueries(def).map((q) => searchNews(q, { days: 1, limit: 12 }).catch((): SearchHit[] => []))),
  ]);

  const nowMs = now.getTime();
  const move = findMove(series.get(primaryTicker), nowMs);
  const rows = buildPanel(series, move, nowMs);
  const fp = move ? fingerprint(rows) : null;

  const headlines = dedupeHeadlines([
    ...(rss.ok ? rss.data.map((i) => ({ title: i.title, url: i.url, domain: i.domain, publishedUtc: i.publishedUtc })) : []),
    ...standing.flat().map(toHeadline),
    ...linkHits.flat().map(toHeadline),
  ]);
  const catalysts = move ? rankCatalysts(headlines, move) : [];

  const gaps: string[] = [];
  if (!series.has(primaryTicker)) gaps.push(`no 5-minute bars for ${primaryTicker}`);
  const missing = REACTION_PANEL.filter((i) => !series.has(i.ticker)).map((i) => i.label);
  if (missing.length) gaps.push(`no bars for ${missing.join(', ')}`);
  if (!rss.ok) gaps.push('RSS feeds unreachable');

  return {
    symbol: def.symbol,
    primaryTicker,
    move,
    rows,
    fingerprint: fp,
    catalysts,
    links: links.map((link, k) => ({
      link,
      hits: linkHits[k].map((h) => ({ title: h.title, source: h.source || h.domain, publishedUtc: h.publishedUtc })),
    })),
    fit: fp ? fitNotes(fp, catalysts, move, linkHits.flat()) : [],
    gaps,
    computedAtMs: nowMs,
  };
}
