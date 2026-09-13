'use client';

/** Trade ideas: entry band, stop and target sized from each symbol's own volatility. */

import Link from 'next/link';
import { DataTable, type Column } from '@/components/DataTable';
import { formatPrice } from '@/components/ui';

export interface IdeaRow {
  symbol: string;
  label: string;
  score: number;
  bias: string;
  direction: 'long' | 'short';
  price: number;
  entryMin: number;
  entryMax: number;
  stop: number;
  target: number;
  rewardRisk: number;
  dailyMovePct: number;
  explanation: string;
  /** High-impact releases for this symbol's currencies within the event window. */
  events: { name: string; currency: string; hoursAway: number }[];
}

const dirTone = (d: IdeaRow['direction']) => (d === 'long' ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]');

const COLUMNS: Column<IdeaRow>[] = [
  {
    key: 'symbol',
    label: 'Symbol',
    align: 'left',
    sticky: true,
    hideOnCards: true,
    sortValue: (r) => r.symbol,
    defaultDir: 'asc',
    render: (r) => (
      <Link href={`/scorecard/${r.symbol}`} className="font-mono font-semibold hover:text-[var(--color-bull)]">
        {r.symbol}
      </Link>
    ),
  },
  {
    key: 'score',
    label: 'Score',
    sortValue: (r) => Math.abs(r.score),
    render: (r) => (
      <span className={`font-semibold ${dirTone(r.direction)}`}>
        {r.score > 0 ? '+' : ''}
        {r.score}
      </span>
    ),
  },
  {
    key: 'direction',
    label: 'Side',
    align: 'left',
    sortValue: (r) => r.direction,
    defaultDir: 'asc',
    render: (r) => <span className={`uppercase ${dirTone(r.direction)}`}>{r.direction}</span>,
  },
  { key: 'price', label: 'Price', render: (r) => formatPrice(r.price) },
  { key: 'entry', label: 'Entry zone', render: (r) => `${formatPrice(r.entryMin)} – ${formatPrice(r.entryMax)}` },
  { key: 'stop', label: 'Stop', render: (r) => <span className="text-[var(--color-bear)]">{formatPrice(r.stop)}</span> },
  { key: 'target', label: 'Target', render: (r) => <span className="text-[var(--color-bull)]">{formatPrice(r.target)}</span> },
  {
    key: 'move',
    label: 'Daily move',
    explain: 'The average daily move the levels were sized from — 90 days, falling back to 7.',
    sortValue: (r) => r.dailyMovePct,
    render: (r) => `${r.dailyMovePct.toFixed(2)}%`,
  },
  {
    key: 'events',
    label: 'Event risk',
    align: 'left',
    explain: 'High-impact releases for this symbol’s currencies in the next 48 hours. The levels are sized from volatility that has not seen them yet.',
    sortValue: (r) => r.events.length,
    render: (r) =>
      r.events.length === 0 ? (
        <span className="text-[var(--color-faint)]">None</span>
      ) : (
        <span className="text-[var(--color-uncertain)]">
          {r.events[0].currency} {r.events[0].name} in {Math.round(r.events[0].hoursAway)}h
          {r.events.length > 1 ? ` +${r.events.length - 1}` : ''}
        </span>
      ),
  },
];

export function IdeasTable({ rows }: { rows: IdeaRow[] }) {
  return (
    <DataTable
      caption="Trade ideas"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.symbol}
      defaultSort={{ key: 'score', dir: 'desc' }}
      cardTitle={(r) => (
        <span className="flex items-center gap-2">
          <span className="font-mono">{r.symbol}</span>
          <span className={`text-caption uppercase ${dirTone(r.direction)}`}>{r.direction}</span>
        </span>
      )}
      cardAside={(r) => (
        <span className={`tnum text-body font-bold ${dirTone(r.direction)}`}>
          {r.score > 0 ? '+' : ''}
          {r.score}
        </span>
      )}
      expand={(r) => (
        <>
          <p className="leading-relaxed">{r.explanation}</p>
          {r.events.length > 0 && (
            <ul className="mt-2 text-caption text-[var(--color-uncertain)]">
              {r.events.map((e) => (
                <li key={`${e.currency}-${e.name}`}>
                  {e.currency} {e.name} in {Math.round(e.hoursAway)}h
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    />
  );
}
