'use client';

/** Momentum & Volatility: where price sits against its moving averages, and how far it moves. */

import Link from 'next/link';
import { heatStyle } from '@/lib/ui/heat';
import { DataTable, type Column } from '@/components/DataTable';
import { formatPrice } from '@/components/ui';

export interface MomentumRow {
  symbol: string;
  label: string;
  assetClass: string;
  price: number;
  /** Percent distance from each average; null where there is not enough history. */
  vs20: number | null;
  vs50: number | null;
  vs100: number | null;
  vs200: number | null;
  aboveCount: number | null;
  smaCount: number;
  realizedVolPct: number | null;
  avgDailyMove7Pct: number | null;
  avgDailyMove90Pct: number | null;
}

const pct = (v: number | null, signed = true) => (v === null ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(2)}%`);


const sma = (key: 'vs20' | 'vs50' | 'vs100' | 'vs200', n: number): Column<MomentumRow> => ({
  key,
  label: `SMA${n}`,
  textLabel: `vs ${n}-day average`,
  explain: `Percent above (+) or below (−) the ${n}-day simple moving average. Context only; the board's Trend cell reads the 3- and 14-day pair.`,
  sortValue: (r) => r[key],
  // Shaded by distance: full strength 10% from the average.
  cellStyle: (r) => heatStyle(r[key], { max: 10, zeroGrey: false }),
  render: (r) => pct(r[key]),
});

const COLUMNS: Column<MomentumRow>[] = [
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
  { key: 'class', label: 'Class', align: 'left', sortValue: (r) => r.assetClass, defaultDir: 'asc', hideOnCards: true, render: (r) => <span className="text-[var(--color-muted)]">{r.assetClass}</span> },
  { key: 'price', label: 'Price', hideOnCards: true, render: (r) => formatPrice(r.price) },
  {
    key: 'above',
    label: 'Above',
    explain: 'How many of the 20, 50, 100 and 200-day averages the price is above.',
    sortValue: (r) => r.aboveCount,
    // 4 of 4 above is solid blue, 0 of 4 solid red, 2 of 4 grey.
    cellStyle: (r) => heatStyle(r.aboveCount === null || r.smaCount === 0 ? null : r.aboveCount - r.smaCount / 2, { max: 2 }),
    render: (r) => (r.aboveCount === null ? '—' : `${r.aboveCount}/${r.smaCount}`),
  },
  sma('vs20', 20),
  sma('vs50', 50),
  sma('vs100', 100),
  sma('vs200', 200),
  {
    key: 'vol',
    label: 'Realised vol',
    explain: 'Annualised standard deviation of daily returns over 30 sessions.',
    sortValue: (r) => r.realizedVolPct,
    render: (r) => pct(r.realizedVolPct, false),
  },
  { key: 'move7', label: 'Move 7d', explain: 'Mean absolute daily move over 7 sessions.', sortValue: (r) => r.avgDailyMove7Pct, render: (r) => pct(r.avgDailyMove7Pct, false) },
  { key: 'move90', label: 'Move 90d', explain: 'Mean absolute daily move over 90 sessions.', sortValue: (r) => r.avgDailyMove90Pct, render: (r) => pct(r.avgDailyMove90Pct, false) },
];

export function MomentumTable({ rows }: { rows: MomentumRow[] }) {
  return (
    <DataTable
      caption="Momentum and volatility"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.symbol}
      defaultSort={{ key: 'above', dir: 'desc' }}
      maxHeight="calc(100dvh - 14rem)"
      cardTitle={(r) => (
        <Link href={`/scorecard/${r.symbol}`} className="flex items-baseline gap-2">
          <span className="font-mono">{r.symbol}</span>
          <span className="text-caption font-normal text-[var(--color-faint)]">{formatPrice(r.price)}</span>
        </Link>
      )}
    />
  );
}
