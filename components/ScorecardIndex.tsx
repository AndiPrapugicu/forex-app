'use client';

/**
 * The Scorecard tab: every asset, grouped, with a live price.
 *
 * Deliberately a table and not a grid of cards on a monitor. Fifty-one cards is
 * a scroll; fifty-one rows sorted by conviction is a board you read in one pass,
 * which is what this page is for. On a phone `DataTable` turns each row into a
 * card anyway, because five columns do not fit 375px.
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
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/primitives';
import { Panel, changeColor, formatChangePct, formatPrice, formatScore } from '@/components/ui';

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
  'Very Bullish': 'text-[var(--color-bull)] font-semibold',
  Bullish: 'text-[var(--color-bull)]',
  Neutral: 'text-[var(--color-muted)]',
  Bearish: 'text-[var(--color-bear)]',
  'Very Bearish': 'text-[var(--color-bear)] font-semibold',
};

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
  const [live, setLive] = useState(true);

  const symbols = useMemo(() => entries.map((e) => e.symbol), [entries]);
  const quotes = useLiveQuotes(symbols, live);

  const groups = useMemo(() => {
    const q = query.trim().toUpperCase();
    const out = new Map<string, ScorecardEntry[]>();
    for (const e of entries) {
      if (q && !e.symbol.includes(q) && !e.label.toUpperCase().includes(q)) continue;
      const list = out.get(e.assetClass) ?? [];
      list.push(e);
      out.set(e.assetClass, list);
    }
    return classOrder.filter((c) => out.has(c)).map((c) => [c, out.get(c)!] as const);
  }, [entries, query, classOrder]);

  const columns = useMemo<Column<ScorecardEntry>[]>(
    () => [
      {
        key: 'symbol',
        label: 'Symbol',
        align: 'left',
        sticky: true,
        hideOnCards: true,
        sortValue: (e) => e.symbol,
        defaultDir: 'asc',
        render: (e) => (
          <Link href={`/scorecard/${e.symbol}`} className="block hover:text-[var(--color-bull)]">
            <span className="font-mono font-semibold">{e.symbol}</span>
            <span className="ml-1.5 text-caption text-[var(--color-faint)]">{e.label}</span>
          </Link>
        ),
      },
      {
        key: 'price',
        label: 'Price',
        render: (e) => {
          const price = quotes.get(e.symbol)?.price ?? e.price;
          return price === null ? <span className="text-[var(--color-faint)]">—</span> : formatPrice(price);
        },
      },
      {
        key: 'change',
        label: 'Day',
        sortValue: (e) => quotes.get(e.symbol)?.changePct ?? e.changePct,
        render: (e) => {
          const change = quotes.get(e.symbol)?.changePct ?? e.changePct;
          return <span className={changeColor(change)}>{formatChangePct(change)}</span>;
        },
      },
      {
        key: 'conviction',
        label: 'Score',
        explain:
          'Sorted by distance from zero, so a −11 ranks with a +11. Bias bands are absolute: a ±34 pair and a ±20 single-economy asset both turn Bullish at +4.',
        // Conviction is DISTANCE FROM ZERO; sorting by the raw score buries every short at the bottom.
        sortValue: (e) => Math.abs(e.totalScore),
        render: (e) => (
          <span className={`font-bold ${BIAS_TONE[e.bias] ?? ''}`}>
            {formatScore(e.totalScore)}
            <span className="ml-1 text-micro font-normal text-[var(--color-faint)]">/±{maxScoreForKind(e.kind)}</span>
          </span>
        ),
      },
      {
        key: 'bias',
        label: 'Bias',
        hideOnCards: true,
        render: (e) => <span className={`whitespace-nowrap ${BIAS_TONE[e.bias] ?? ''}`}>{e.bias}</span>,
      },
    ],
    [quotes],
  );

  /**
   * This board mixes asset classes, so it mixes freshness: the FX rows are
   * seconds old while gold, copper, WTI and DXY are exactly ten minutes behind
   * and the European indices fifteen. One badge cannot honestly speak for all
   * of them, so it reports how many are genuinely current.
   */
  const liveCount = useMemo(
    () => [...quotes.values()].filter((q) => freshnessOf(q).kind === 'live').length,
    [quotes],
  );
  const anyLive = quotes.size > 0;
  const allLive = anyLive && liveCount === quotes.size;

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Asset Scorecard"
        description="Every asset, its score and what it is doing right now"
        updated={`Scores computed ${generatedAtUtc.slice(11, 16)} UTC`}
        info={
          <>
            Scores come from closed bars and the weekly COT file. <strong>The price polls; the score does not.</strong> A
            live tick never moves a cell, a moving average, a level or a trade idea. Tap a symbol for its full card.
          </>
        }
        actions={
          <>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter symbols"
              className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-small outline-none focus:border-[var(--color-border-bright)] md:min-h-9 md:w-44 md:flex-none"
            />
            <button
              type="button"
              onClick={() => setLive((on) => !on)}
              aria-pressed={live}
              className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 text-small text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] md:min-h-9"
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  live && allLive ? 'live-dot bg-[var(--color-bull)]' : live ? 'bg-[var(--color-uncertain)]' : 'bg-[var(--color-faint)]'
                }`}
              />
              {!live ? 'Live off' : !anyLive ? 'Connecting…' : allLive ? 'Live' : `${liveCount}/${quotes.size} live`}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {groups.map(([assetClass, list]) => (
          <Panel key={assetClass} title={assetClass} subtitle={`${list.length} symbols`}>
            <DataTable
              caption={`${assetClass} scorecard`}
              columns={columns}
              rows={list}
              rowKey={(e) => e.symbol}
              defaultSort={{ key: 'conviction', dir: 'desc' }}
              cardTitle={(e) => (
                <Link href={`/scorecard/${e.symbol}`} className="flex min-h-11 items-center gap-2">
                  <span className="font-mono">{e.symbol}</span>
                  <span className={`text-caption font-normal ${BIAS_TONE[e.bias] ?? ''}`}>{e.bias}</span>
                </Link>
              )}
            />
          </Panel>
        ))}
      </div>
      {groups.length === 0 && (
        <p className="py-10 text-center text-small text-[var(--color-muted)]">No symbol matches “{query}”.</p>
      )}
    </div>
  );
}
