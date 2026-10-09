/**
 * Gathers the REACTION reader's inputs: five days of 5-minute bars for the
 * panel, the RSS feeds, searches dated to the day of the move, the headlines
 * behind any pasted link, and the Treasury auctions. All I/O is here; the
 * reading is `lib/analysis/reaction.ts`, which is pure. Nothing throws: a
 * missing source is a named gap.
 *
 * The window is the one the user means (`Intent.anchor`: "yesterday", the
 * chart's date), and the move is the one they describe (`Intent.described`).
 */

import { INTRADAY_TICKER, REACTION, REACTION_PANEL, type ReactionInstrument } from '@/config/reaction.config';
import type { SymbolDefinition } from '@/config/symbols.config';
import { fetchIntraday, type IntradaySeries } from '@/lib/connectors/intraday';
import { searchNews, type SearchHit } from '@/lib/connectors/news-search';
import { fetchNews } from '@/lib/connectors/rss';
import { auctionVerdict, fetchTreasuryAuctions } from '@/lib/connectors/treasury-auctions';
import { dedupeHeadlines, type Headline } from '@/lib/analysis/headlines';
import type { Intent } from '@/lib/analysis/intent';
import {
  attributeMove,
  buildPanel,
  causeTokens,
  firstSeen,
  changeBetween,
  fingerprint,
  fitNotes,
  linkQueries,
  matchMove,
  measuredDirections,
  onsetOf,
  rankCatalysts,
  scheduledInside,
  splitNote,
  type AssetClass,
  type Onset,
  type ReactionReading,
  type ScheduledEvent,
} from '@/lib/analysis/reaction';
import type { NormalizedEvent } from '@/lib/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** What the symbol is called in a headline. */
const HEADLINE_NAME: Record<string, string> = {
  NAS100: 'Nasdaq',
  SPX500: 'S&P 500',
  US30: 'Dow Jones',
  RUT2000: 'Russell 2000',
  XAUUSD: 'gold',
  XAGUSD: 'silver',
  WTIUSD: 'oil prices',
  XCUUSD: 'copper',
  BTCUSD: 'bitcoin',
  ETHUSD: 'ether',
  DXY: 'dollar',
  GER40: 'DAX',
  UK100: 'FTSE 100',
  JP225: 'Nikkei',
};

function headlineName(def: SymbolDefinition): string {
  if (HEADLINE_NAME[def.symbol]) return HEADLINE_NAME[def.symbol];
  if (def.kind === 'fx' && def.base && def.quote) return `${def.base} ${def.quote}`;
  return def.label;
}

function assetClassOf(def: SymbolDefinition): AssetClass | null {
  if (def.kind === 'index') return 'equities';
  if (def.symbol === 'XAUUSD') return 'gold';
  if (def.symbol === 'WTIUSD') return 'oil';
  if (def.kind === 'crypto') return 'crypto';
  if (def.symbol === 'DXY') return 'dollar';
  return null;
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The dated searches for this move: its asset, the bond market, the link, and anything else the user named. */
export function reactionQueries(def: SymbolDefinition, direction: 1 | -1 | null, intent: Intent, links: string[]): string[] {
  const name = headlineName(def);
  const verbs = direction === 1 ? ['rises', 'rally'] : direction === -1 ? ['falls', 'selloff'] : ['moves', 'stocks'];
  const q = [`${name} ${verbs[0]}`, `${name} ${verbs[1]}`, 'Treasury yields', ...links];
  for (const i of intent.instruments) {
    if (i.symbol === def.symbol) continue;
    if (i.ticker && ['ZT=F', '^FVX', '^TNX', '^TYX'].includes(i.ticker)) q.push('Treasuries bonds');
    else q.push(i.label);
  }
  if (def.kind === 'index') q.push('stock market');
  return [...new Set(q)].slice(0, REACTION.maxSearches);
}

export async function loadReaction(
  def: SymbolDefinition,
  question: string,
  now = new Date(),
  intent?: Intent,
  events: NormalizedEvent[] = [],
): Promise<ReactionReading> {
  const nowMs = now.getTime();
  const primaryTicker = INTRADAY_TICKER[def.symbol] ?? def.yahoo;
  const links = linkQueries(question);
  const window = intent?.anchor ?? { fromMs: nowMs - REACTION.searchHours * HOUR, toMs: nowMs, label: `the last ${REACTION.searchHours} hours`, source: 'question' as const };

  const [series, auctions] = await Promise.all([
    fetchIntraday([primaryTicker, ...REACTION_PANEL.map((i) => i.ticker)]).catch(() => new Map<string, IntradaySeries>()),
    fetchTreasuryAuctions().catch(() => ({ past: [], upcoming: [] })),
  ]);

  const primary = series.get(primaryTicker);
  const match = matchMove(primary, window.fromMs, window.toMs, intent?.described ?? null);
  const move = match.move;
  // The panel's fixed 1h/2h/4h columns are read back from the end of the window, not from now.
  const rows = buildPanel(series, move, Math.min(window.toMs, nowMs));
  const fp = move ? fingerprint(rows) : null;

  // Headlines: searches dated from the day before the move to two days after it.
  const around = move ?? { startMs: window.fromMs, endMs: window.toMs };
  const range = { after: isoDate(around.startMs - DAY), before: isoDate(Math.min(around.endMs + 2 * DAY, nowMs + DAY)) };
  const queries = reactionQueries(def, move ? (move.changePct < 0 ? -1 : 1) : (intent?.described?.direction ?? null), intent ?? emptyIntent(), links.map((l) => l.query));
  const [rss, searched] = await Promise.all([
    fetchNews(),
    Promise.all(queries.map((q) => searchNews(q, { range, limit: REACTION.hitsPerSearch }).catch((): SearchHit[] => []))),
  ]);
  const linkHits = links.map((l) => searched[queries.indexOf(l.query)] ?? []);
  const toHeadline = (h: SearchHit): Headline => ({ title: h.title, url: h.url, domain: h.source || h.domain, publishedUtc: h.publishedUtc });
  const headlines = dedupeHeadlines([
    ...(rss.ok ? rss.data.map((i) => ({ title: i.title, url: i.url, domain: i.domain, publishedUtc: i.publishedUtc })) : []),
    ...searched.flat().map(toHeadline),
  ]);
  const catalysts = move ? rankCatalysts(headlines, move) : [];

  // When each asset broke: the symbol, then the panel.
  const own: ReactionInstrument = { ticker: primaryTicker, label: def.symbol, group: 'equities', unit: 'pct' };
  const onsets: Onset[] = [];
  if (move) {
    const first = onsetOf(primary, own, move);
    if (first) onsets.push(first);
    for (const inst of REACTION_PANEL) {
      if (inst.ticker === primaryTicker || inst.group === 'crypto') continue;
      const o = onsetOf(series.get(inst.ticker), inst, move);
      if (o && (inst.group === 'rates' || inst.group === 'equities' || inst.ticker === 'GC=F' || inst.ticker === 'CL=F' || inst.ticker === 'DX-Y.NYB')) onsets.push(o);
    }
    onsets.sort((a, b) => a.brokeMs - b.brokeMs);
  }

  const cls = assetClassOf(def);
  const attribution = move
    ? attributeMove(headlines, move, measuredDirections(rows, cls ? { cls, change: changeBetween(primary, own, move.startMs, move.endMs) } : undefined))
    : [];

  // Scheduled: high-impact releases from the calendar, and Treasury auctions.
  const scheduledAll: ScheduledEvent[] = [
    ...events
      .filter((e) => e.impact === 'HIGH' || (e.impact === 'MEDIUM' && e.currency === 'USD'))
      .map((e) => ({
        ms: Date.parse(e.dateUtc),
        label: `${e.currency} ${e.name}`,
        detail:
          e.actual !== null
            ? `actual ${e.actual}${e.consensus !== null ? ` vs forecast ${e.consensus}` : ''}${e.previous !== null ? ` (previous ${e.previous})` : ''}`
            : undefined,
      })),
    ...auctions.past.map((a) => ({ ms: a.closeMs, label: `US ${a.label} auction ($${a.offeringBn ?? '?'}bn)`, detail: auctionVerdict(a, auctions.past) ?? undefined })),
  ];
  const scheduled = move ? scheduledInside(scheduledAll, move) : [];

  // When did each leading story first appear? One search per asset class, for
  // the top cause only; a scheduled event (an auction) already has its time.
  const scheduledWords = new Set(scheduled.flatMap((e) => causeTokens(e.label)));
  const lead = new Map<AssetClass, (typeof attribution)[number]>();
  for (const a of attribution) if (!lead.has(a.cls)) lead.set(a.cls, a);
  await Promise.all(
    [...lead.values()]
      .filter((a) => a.key.length > 0 && !a.key.some((w) => scheduledWords.has(w)))
      .slice(0, 2)
      .map(async (a) => {
        const hits = await searchNews(a.key.join(' '), { range, limit: 100 }).catch((): SearchHit[] => []);
        a.firstSeen = firstSeen(hits.map(toHeadline), a.key);
      }),
  );

  const gaps: string[] = [];
  if (!primary) gaps.push(`no 5-minute bars for ${primaryTicker}`);
  const missing = REACTION_PANEL.filter((i) => !series.has(i.ticker)).map((i) => i.label);
  if (missing.length) gaps.push(`no bars for ${missing.join(', ')}`);
  if (!rss.ok) gaps.push('RSS feeds unreachable');
  if (auctions.past.length === 0) gaps.push('Treasury auction results unavailable');

  return {
    symbol: def.symbol,
    primaryTicker,
    window: { fromMs: window.fromMs, toMs: window.toMs, label: window.label },
    match: { status: match.status, described: intent?.described ?? null, largest: match.largest },
    onsets,
    split: move ? splitNote(onsets, primaryTicker, nowMs) : null,
    attribution,
    scheduled,
    named: (intent?.instruments ?? []).filter((i) => i.symbol !== def.symbol).map((i) => i.label),
    move,
    rows,
    fingerprint: fp,
    catalysts,
    links: links.map((link, k) => ({
      link,
      hits: (linkHits[k] ?? []).slice(0, 5).map((h) => ({ title: h.title, source: h.source || h.domain, publishedUtc: h.publishedUtc })),
    })),
    fit: fp ? fitNotes(fp, catalysts, move, linkHits.flat()) : [],
    gaps,
    computedAtMs: nowMs,
  };
}

function emptyIntent(): Intent {
  return { kind: 'reaction', anchor: null, described: null, instruments: [], otherSymbols: [], event: null };
}
