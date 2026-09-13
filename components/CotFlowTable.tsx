'use client';

/**
 * COT Velocity (this week's flow against the contract's own history) and COT
 * Trends (net change over several horizons). Both read the same CFTC series.
 */

import { cotTicker } from '@/config/symbols.config';
import type { CotFlow } from '@/lib/scoring/cot-flow';
import { Sparkline } from '@/components/charts';
import { heatStyle } from '@/lib/ui/heat';
import { DataTable, type Column } from '@/components/DataTable';

const signed = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString()}`);
const tone = (n: number | null) =>
  n === null || n === 0 ? 'text-[var(--color-faint)]' : n > 0 ? 'text-[var(--color-bull-cell)]' : 'text-[var(--color-bear)]';

const STRENGTH_TONE: Record<CotFlow['strength'], string> = {
  extreme: 'text-[var(--color-text)] font-semibold',
  heavy: 'text-[var(--color-text)]',
  notable: 'text-[var(--color-muted)]',
  routine: 'text-[var(--color-faint)]',
};

const VELOCITY_COLUMNS: Column<CotFlow>[] = [
  {
    key: 'contract',
    label: 'Contract',
    align: 'left',
    sticky: true,
    hideOnCards: true,
    sortValue: (f) => cotTicker(f.contract),
    defaultDir: 'asc',
    render: (f) => <span className="font-mono font-semibold">{cotTicker(f.contract)}</span>,
  },
  {
    key: 'headline',
    label: 'Reading',
    align: 'left',
    render: (f) => (
      <span className={f.direction === 'buying' ? 'text-[var(--color-bull-cell)]' : f.direction === 'selling' ? 'text-[var(--color-bear)]' : 'text-[var(--color-faint)]'}>
        {f.headline}
        {f.againstPosition && <span className="ml-1 text-[var(--color-uncertain)]" aria-label="against their own position">↩</span>}
        {f.flipped && <span className="ml-1 text-[var(--color-uncertain)]">flipped</span>}
      </span>
    ),
  },
  {
    key: 'percentile',
    label: 'Pctile',
    explain: "Where this week's absolute net change sits among this contract's own weekly changes. The velocity, and the default order.",
    sortValue: (f) => f.percentile,
    // How unusual, in the direction of the flow: a 95th-percentile week of selling is deep red.
    cellStyle: (f) => heatStyle(f.direction === 'flat' ? null : (f.direction === 'buying' ? 1 : -1) * f.percentile, { max: 100, zeroGrey: false }),
    render: (f) => <span className={STRENGTH_TONE[f.strength]}>{f.percentile.toFixed(0)}</span>,
  },
  {
    key: 'net',
    label: 'Δ Net',
    sortValue: (f) => f.netChange,
    cellStyle: (f) => heatStyle(f.direction === 'flat' ? null : (f.direction === 'buying' ? 1 : -1) * f.percentile, { max: 100, zeroGrey: false }),
    render: (f) => <span className="font-semibold">{signed(f.netChange)}</span>,
  },
  { key: 'long', label: 'Δ Long', sortValue: (f) => f.longChange, render: (f) => <span className={tone(f.longChange)}>{signed(f.longChange)}</span> },
  { key: 'short', label: 'Δ Short', sortValue: (f) => f.shortChange, render: (f) => <span className={tone(f.shortChange)}>{signed(f.shortChange)}</span> },
  {
    key: 'oi',
    label: 'OI agrees',
    explain: 'Open interest moved the way the reading implies — new money in for a build, money out for a liquidation.',
    sortValue: (f) => (f.oiConfirms ? 1 : 0),
    render: (f) => (f.oiConfirms ? 'Yes' : <span className="text-[var(--color-faint)]">No</span>),
  },
  { key: 'after', label: 'Net after', sortValue: (f) => f.netAfter, hideOnCards: true, render: (f) => signed(f.netAfter) },
];

export function CotVelocityTable({ flows }: { flows: CotFlow[] }) {
  return (
    <DataTable
      caption="COT velocity"
      columns={VELOCITY_COLUMNS}
      rows={flows}
      rowKey={(f) => f.contract}
      defaultSort={{ key: 'percentile', dir: 'desc' }}
      maxHeight="calc(100dvh - 14rem)"
      cardTitle={(f) => <span className="font-mono">{cotTicker(f.contract)}</span>}
      cardAside={(f) => <span className={`tnum text-small font-semibold ${tone(f.netChange)}`}>{signed(f.netChange)}</span>}
      expand={(f) => (
        <>
          <p className="leading-relaxed">{f.sentence}</p>
          <p className="mt-1 text-caption text-[var(--color-faint)]">Measured against {f.sampleWeeks} weekly changes.</p>
        </>
      )}
    />
  );
}

export interface CotTrendRow {
  contract: string;
  ticker: string;
  net: number;
  /** Net change over 1, 4, 13 and 26 weeks; null where the history is shorter. */
  change: Record<1 | 4 | 13 | 26, number | null>;
  /** Net position, oldest first, last 26 reports. */
  path: number[];
}

const horizon = (h: 1 | 4 | 13 | 26): Column<CotTrendRow> => ({
  key: `w${h}`,
  label: `${h}w`,
  textLabel: `${h}-week change`,
  sortValue: (r) => r.change[h],
  // Sized against the position itself, so a small contract's big move reads as big.
  cellStyle: (r) =>
    heatStyle(r.change[h] === null ? null : (r.change[h]! / Math.max(1, Math.abs(r.net))) * 100, { max: 50, zeroGrey: false }),
  render: (r) => signed(r.change[h]),
});

const TREND_COLUMNS: Column<CotTrendRow>[] = [
  {
    key: 'ticker',
    label: 'Contract',
    align: 'left',
    sticky: true,
    hideOnCards: true,
    sortValue: (r) => r.ticker,
    defaultDir: 'asc',
    render: (r) => <span className="font-mono font-semibold">{r.ticker}</span>,
  },
  { key: 'net', label: 'Net now', sortValue: (r) => r.net, render: (r) => <span className={`font-semibold ${tone(r.net)}`}>{signed(r.net)}</span> },
  horizon(1),
  horizon(4),
  horizon(13),
  horizon(26),
  {
    key: 'path',
    label: '26 weeks',
    align: 'left',
    render: (r) => <Sparkline values={r.path} label={`${r.ticker} net position, 26 weeks`} baseline={0} />,
  },
];

export function CotTrendsTable({ rows }: { rows: CotTrendRow[] }) {
  return (
    <DataTable
      caption="COT trends"
      columns={TREND_COLUMNS}
      rows={rows}
      rowKey={(r) => r.contract}
      defaultSort={{ key: 'w4', dir: 'desc' }}
      maxHeight="calc(100dvh - 14rem)"
      cardTitle={(r) => <span className="font-mono">{r.ticker}</span>}
      cardAside={(r) => <span className={`tnum text-small font-semibold ${tone(r.net)}`}>{signed(r.net)}</span>}
    />
  );
}
