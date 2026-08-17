'use client';

/**
 * The Scorecard tab: every asset, grouped, with a live price.
 *
 * Deliberately a table and not a grid of cards. Fifty-one cards is a scroll;
 * fifty-one rows sorted by conviction is a board you read in one pass, which is
 * what this page is for.
 *
 * PRICES POLL, SCORES DO NOT. The score, bias and column count are computed
 * server-side from closed bars and a weekly COT file; only the price and its
 * day change are live. That containment is the same one the chart page states,
 * and it is the reason a live tick can never move a cell.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { maxScoreForKind } from '@/config/setups.config';
import type { SymbolKind } from '@/config/symbols.config';
import { freshnessOf, useLiveQuotes } from '@/lib/hooks/useLiveQuotes';
import {
  Panel,
  changeColor,
  formatChangePct,
  formatPrice,
  formatScore,
} from '@/components/ui';

export interface ScorecardEntry {
  symbol: string;
  label: string;
  assetClass: string;
  kind: SymbolKind;
  totalScore: number;
  bias: string;
  populated: number;
  /** Server-rendered fallback, shown until the first live tick lands. */
  price: number | null;
  changePct: number | null;
}

const BIAS_TONE: Record<string, string> = {
  'Very Bullish': 'text-[var(--color-bull)]',
  Bullish: 'text-[var(--color-bull)]',
  Neutral: 'text-[var(--color-muted)]',
  Bearish: 'text-[var(--color-bear)]',
  'Very Bearish': 'text-[var(--color-bear)]',
};

type SortKey = 'conviction' | 'score' | 'symbol' | 'change';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'conviction', label: 'Conviction' },
  { key: 'score', label: 'Score' },
  { key: 'change', label: 'Day change' },
  { key: 'symbol', label: 'A–Z' },
];

export function ScorecardIndex({
  entries,
  classOrder,
  generatedAtUtc,
}: {
  entries: ScorecardEntry[];
  classOrder: string[];
  generatedAtUtc: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('conviction');
  const [live, setLive] = useState(true);

  const symbols = useMemo(() => entries.map((e) => e.symbol), [entries]);
  const quotes = useLiveQuotes(symbols, live);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return entries.filter(
      (e) => !q || e.symbol.includes(q) || e.label.toUpperCase().includes(q),
    );
  }, [entries, query]);

  const groups = useMemo(() => {
    const out = new Map<string, ScorecardEntry[]>();
    for (const e of filtered) {
      const list = out.get(e.assetClass) ?? [];
      list.push(e);
      out.set(e.assetClass, list);
    }

    for (const list of out.values()) {
      list.sort((a, b) => {
        switch (sort) {
          case 'score':
            return b.totalScore - a.totalScore;
          case 'symbol':
            return a.symbol.localeCompare(b.symbol);
          case 'change': {
            const av = quotes.get(a.symbol)?.changePct ?? a.changePct ?? 0;
            const bv = quotes.get(b.symbol)?.changePct ?? b.changePct ?? 0;
            return bv - av;
          }
          default:
            // Conviction is DISTANCE FROM ZERO, so a -11 ranks with a +11.
            // Sorting by the raw score buries every short at the bottom.
            return Math.abs(b.totalScore) - Math.abs(a.totalScore);
        }
      });
    }

    return classOrder.filter((c) => out.has(c)).map((c) => [c, out.get(c)!] as const);
  }, [filtered, sort, classOrder, quotes]);

  /**
   * This board mixes asset classes, so it mixes freshness: the FX rows are
   * seconds old while gold, copper, WTI and DXY are exactly ten minutes behind
   * and the European indices fifteen. One badge cannot honestly speak for all
   * of them, so it reports how many are genuinely current and says the rest are
   * delayed rather than implying the whole board is live.
   */
  const liveCount = useMemo(
    () => [...quotes.values()].filter((q) => freshnessOf(q).kind === 'live').length,
    [quotes],
  );
  const anyLive = quotes.size > 0;
  const allLive = anyLive && liveCount === quotes.size;

  return (
    <div className="px-4 py-4">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <div>
          <h1 className="text-lg font-bold">Asset scorecard</h1>
          <p className="text-xs text-[var(--color-faint)]">
            Every asset, its score and what it is doing right now
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter"
            className="w-28 rounded border border-[var(--color-border)] bg-transparent px-2 py-0.5 text-[11px] outline-none focus:border-[var(--color-border-bright)]"
          />
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                sort === s.key
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setLive((on) => !on)}
            aria-pressed={live}
            className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                live && allLive
                  ? 'animate-pulse bg-[var(--color-bull)]'
                  : live
                    ? 'bg-[var(--color-uncertain)]'
                    : 'bg-[var(--color-faint)]'
              }`}
            />
            {!live
              ? 'Live off'
              : !anyLive
                ? 'Connecting…'
                : allLive
                  ? 'Live'
                  : `${liveCount}/${quotes.size} live`}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        {groups.map(([assetClass, list]) => (
          <Panel key={assetClass} title={assetClass} subtitle={`${list.length} symbols`}>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[9px] tracking-wider text-[var(--color-faint)] uppercase">
                  <th className="px-3 py-1 text-left">Symbol</th>
                  <th className="px-2 py-1 text-right">Price</th>
                  <th className="px-2 py-1 text-right">Day</th>
                  <th className="px-2 py-1 text-right">Score</th>
                  <th className="px-3 py-1 text-right">Bias</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const quote = quotes.get(e.symbol);
                  const price = quote?.price ?? e.price;
                  const change = quote?.changePct ?? e.changePct;
                  const max = maxScoreForKind(e.kind);

                  return (
                    <tr
                      key={e.symbol}
                      className="border-t border-[var(--color-border)]/60 hover:bg-[var(--color-surface-2)]/50"
                    >
                      <td className="px-3 py-1">
                        <Link href={`/scorecard/${e.symbol}`} className="block hover:text-[var(--color-bull)]">
                          <span className="font-mono">{e.symbol}</span>
                          <span className="ml-1.5 text-[9px] text-[var(--color-faint)]">
                            {e.label}
                          </span>
                        </Link>
                      </td>
                      <td className="tnum px-2 py-1 text-right">
                        {price === null ? (
                          <span className="text-[var(--color-faint)]">—</span>
                        ) : (
                          formatPrice(price)
                        )}
                      </td>
                      <td className={`tnum px-2 py-1 text-right ${changeColor(change)}`}>
                        {formatChangePct(change)}
                      </td>
                      <td
                        className={`tnum px-2 py-1 text-right font-bold ${BIAS_TONE[e.bias] ?? ''}`}
                        title={`${formatScore(e.totalScore)} out of a possible ±${max}, from ${e.populated} populated columns`}
                      >
                        {formatScore(e.totalScore)}
                      </td>
                      <td
                        className={`px-3 py-1 text-right text-[10px] whitespace-nowrap ${BIAS_TONE[e.bias] ?? ''}`}
                      >
                        {e.bias}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        ))}
      </div>

      <p className="mt-3 px-1 text-[10px] leading-relaxed text-[var(--color-faint)]">
        Scores are computed server-side from closed bars and the weekly COT file, at{' '}
        {generatedAtUtc.slice(11, 16)} UTC. <strong className="text-[var(--color-muted)]">
          The price polls; the score does not.
        </strong>{' '}
        A live tick never moves a cell, a moving average, a level or a trade idea — those all come
        from bars that have closed. Bias bands are absolute, so a ±34 pair and a ±20 single-economy
        asset both become Bullish at +4; the score column&rsquo;s tooltip gives each symbol&rsquo;s
        own maximum.
      </p>
    </div>
  );
}
