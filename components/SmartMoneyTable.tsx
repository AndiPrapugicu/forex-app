'use client';

/**
 * Institutions against the crowd, per contract — `buildSmartMoney`, which the
 * pipeline computed on every run and no page rendered.
 */

import { cotTicker } from '@/config/symbols.config';
import type { SmartMoneyRow } from '@/lib/scoring/market';
import { heatStyle } from '@/lib/ui/heat';
import { DataTable, type Column } from '@/components/DataTable';

function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function tone(v: number): string {
  return v > 0 ? 'text-[var(--color-bull-cell)]' : v < 0 ? 'text-[var(--color-bear)]' : 'text-[var(--color-muted)]';
}

/** A centre-anchored pair of bars on one −100..+100 track: institutions above, crowd below. */
function DualBar({ spec, retail }: { spec: number; retail: number }) {
  const bar = (v: number, colour: string) => (
    <span
      className="absolute h-1.5 rounded-full"
      style={{
        left: v >= 0 ? '50%' : `${50 + v / 2}%`,
        width: `${Math.abs(v) / 2}%`,
        background: colour,
      }}
    />
  );
  return (
    <div
      role="img"
      aria-label={`Institutions ${signed(spec)} net, crowd ${signed(retail)} net`}
      className="relative flex h-5 w-full min-w-32 flex-col justify-center gap-1"
    >
      <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-bright)]" />
      <div className="relative h-1.5">{bar(spec, 'var(--color-bull-cell)')}</div>
      <div className="relative h-1.5">{bar(retail, 'var(--color-uncertain)')}</div>
    </div>
  );
}

const COLUMNS: Column<SmartMoneyRow>[] = [
  {
    key: 'contract',
    label: 'Contract',
    align: 'left',
    sticky: true,
    hideOnCards: true,
    sortValue: (r) => cotTicker(r.contract),
    defaultDir: 'asc',
    render: (r) => <span className="font-mono font-semibold">{cotTicker(r.contract)}</span>,
  },
  {
    key: 'spec',
    label: 'Institutions',
    explain: 'Large speculators’ net position as a share of their own book, −100 to +100.',
    sortValue: (r) => r.specNetPct,
    cellStyle: (r) => heatStyle(r.specNetPct, { max: 60, zeroGrey: false }),
    render: (r) => signed(r.specNetPct),
  },
  {
    key: 'retail',
    label: 'Crowd',
    explain: 'Small traders’ net position as a share of theirs.',
    sortValue: (r) => r.retailNetPct,
    cellStyle: (r) => heatStyle(r.retailNetPct, { max: 60, zeroGrey: false }),
    render: (r) => signed(r.retailNetPct),
  },
  {
    key: 'bars',
    label: 'Positioning',
    align: 'left',
    hideOnCards: true,
    render: (r) => <DualBar spec={r.specNetPct} retail={r.retailNetPct} />,
  },
  {
    key: 'spread',
    label: 'Spread',
    explain: 'Institutions minus crowd. Positive means institutions are the more bullish side.',
    sortValue: (r) => Math.abs(r.spread),
    cellStyle: (r) => heatStyle(r.spread, { max: 80, zeroGrey: false }),
    render: (r) => <span className="font-semibold">{r.spread > 0 ? '+' : ''}{r.spread.toFixed(1)}</span>,
  },
  {
    key: 'divergent',
    label: 'Opposite sides',
    align: 'left',
    sortValue: (r) => (r.divergent ? 1 : 0),
    render: (r) =>
      r.divergent ? <span className="text-[var(--color-uncertain)]">Yes</span> : <span className="text-[var(--color-faint)]">No</span>,
  },
];

export function SmartMoneyTable({ rows }: { rows: SmartMoneyRow[] }) {
  return (
    <DataTable
      caption="Smart money"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.contract}
      defaultSort={{ key: 'spread', dir: 'desc' }}
      maxHeight="calc(100dvh - 14rem)"
      cardTitle={(r) => <span className="font-mono">{cotTicker(r.contract)}</span>}
      cardAside={(r) => (
        <span className={`tnum text-small font-semibold ${tone(r.spread)}`}>
          {r.spread > 0 ? '+' : ''}
          {r.spread.toFixed(1)}
        </span>
      )}
      expand={(r) => <DualBar spec={r.specNetPct} retail={r.retailNetPct} />}
    />
  );
}
