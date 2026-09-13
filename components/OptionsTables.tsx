'use client';

/** Tables for the options pages. Data arrives flattened from the server pages. */

import Link from 'next/link';
import { PUT_CALL_BANDS } from '@/config/options.config';
import { heatStyle } from '@/lib/ui/heat';
import { Sparkline } from '@/components/charts';
import { DataTable, type Column } from '@/components/DataTable';

export interface PutCallRow {
  symbol: string;
  label: string;
  etf: string;
  group: string;
  ratio: number | null;
  movingAverage: number | null;
  reading: string | null;
  sessions: number;
  history: (number | null)[];
}

const fixed = (v: number | null, dp = 2) => (v === null ? '—' : v.toFixed(dp));

/** Blue below the call line, red above the put line, unpainted in between. */
function bandStyle(v: number | null) {
  if (v === null) return {};
  if (v <= PUT_CALL_BANDS.highCallVolume) return heatStyle(PUT_CALL_BANDS.highCallVolume - v + 0.05, { max: 0.5 });
  if (v >= PUT_CALL_BANDS.highPutVolume) return heatStyle(-(v - PUT_CALL_BANDS.highPutVolume + 0.05), { max: 0.5 });
  return {};
}

const PUT_CALL_COLUMNS: Column<PutCallRow>[] = [
  {
    key: 'symbol',
    label: 'Symbol',
    align: 'left',
    sticky: true,
    hideOnCards: true,
    sortValue: (r) => r.symbol,
    defaultDir: 'asc',
    render: (r) => (
      <Link href={`/options/put-call?symbol=${r.symbol}`} className="font-mono font-semibold underline decoration-1 underline-offset-2">
        {r.symbol}
      </Link>
    ),
  },
  { key: 'etf', label: 'Chain', align: 'left', sortValue: (r) => r.etf, defaultDir: 'asc', render: (r) => <span className="text-[var(--color-muted)]">{r.etf}</span> },
  {
    key: 'ratio',
    label: 'Today',
    explain: 'Put volume divided by call volume across the nearest expiries, today.',
    sortValue: (r) => r.ratio,
    cellStyle: (r) => bandStyle(r.ratio),
    render: (r) => fixed(r.ratio),
  },
  {
    key: 'ma',
    label: '5-day avg',
    explain: `A1's measure. Shown once five stored sessions exist — until then the table says how many it has.`,
    sortValue: (r) => r.movingAverage,
    cellStyle: (r) => bandStyle(r.movingAverage),
    render: (r) => (r.movingAverage === null ? <span className="text-[var(--color-faint)]">{r.sessions}/5 sessions</span> : fixed(r.movingAverage)),
  },
  {
    key: 'reading',
    label: 'Reading',
    align: 'left',
    sortValue: (r) => r.reading,
    defaultDir: 'asc',
    render: (r) => r.reading ?? <span className="text-[var(--color-faint)]">—</span>,
  },
  {
    key: 'history',
    label: 'History',
    align: 'left',
    render: (r) => <Sparkline values={r.history} label={`${r.symbol} put-call ratio history`} tone="muted" baseline={1} />,
  },
];

export function PutCallTable({ rows }: { rows: PutCallRow[] }) {
  return (
    <DataTable
      caption="Put-call ratios"
      columns={PUT_CALL_COLUMNS}
      rows={rows}
      rowKey={(r) => r.symbol}
      defaultSort={{ key: 'ratio', dir: 'desc' }}
      cardTitle={(r) => <span className="font-mono">{r.symbol}</span>}
      cardAside={(r) => (
        <span className="tnum rounded px-2 py-0.5 text-small font-semibold" style={bandStyle(r.movingAverage ?? r.ratio)}>
          {fixed(r.movingAverage ?? r.ratio)}
        </span>
      )}
    />
  );
}

export interface VolumeRow {
  symbol: string;
  etf: string;
  callVolume: number;
  putVolume: number;
  /** Call volume minus put volume. */
  net: number;
  /** Net as a share of all volume, −100..+100. */
  netPct: number | null;
  history: (number | null)[];
}

const count = (v: number) => v.toLocaleString();

const VOLUME_COLUMNS: Column<VolumeRow>[] = [
  {
    key: 'symbol',
    label: 'Symbol',
    align: 'left',
    sticky: true,
    hideOnCards: true,
    sortValue: (r) => r.symbol,
    defaultDir: 'asc',
    render: (r) => <span className="font-mono font-semibold">{r.symbol}</span>,
  },
  { key: 'etf', label: 'Chain', align: 'left', hideOnCards: true, render: (r) => <span className="text-[var(--color-muted)]">{r.etf}</span> },
  { key: 'calls', label: 'Call volume', sortValue: (r) => r.callVolume, render: (r) => count(r.callVolume) },
  { key: 'puts', label: 'Put volume', sortValue: (r) => r.putVolume, render: (r) => count(r.putVolume) },
  {
    key: 'net',
    label: 'Net (calls − puts)',
    sortValue: (r) => r.net,
    cellStyle: (r) => heatStyle(r.netPct, { max: 60, zeroGrey: false }),
    render: (r) => `${r.net > 0 ? '+' : ''}${count(r.net)}`,
  },
  {
    key: 'netpct',
    label: 'Net %',
    explain: 'Net volume as a share of all option volume, so a small ETF and SPY compare.',
    sortValue: (r) => r.netPct,
    cellStyle: (r) => heatStyle(r.netPct, { max: 60, zeroGrey: false }),
    render: (r) => (r.netPct === null ? '—' : `${r.netPct > 0 ? '+' : ''}${r.netPct.toFixed(1)}%`),
  },
  {
    key: 'history',
    label: 'Stored sessions',
    align: 'left',
    render: (r) => <Sparkline values={r.history} label={`${r.symbol} net option volume history`} baseline={0} />,
  },
];

export function VolumeTable({ rows }: { rows: VolumeRow[] }) {
  return (
    <DataTable
      caption="Net options volume"
      columns={VOLUME_COLUMNS}
      rows={rows}
      rowKey={(r) => r.symbol}
      defaultSort={{ key: 'netpct', dir: 'desc' }}
      cardTitle={(r) => <span className="font-mono">{r.symbol}</span>}
      cardAside={(r) => (
        <span className="tnum rounded px-2 py-0.5 text-small font-semibold" style={heatStyle(r.netPct, { max: 60, zeroGrey: false })}>
          {r.netPct === null ? '—' : `${r.netPct > 0 ? '+' : ''}${r.netPct.toFixed(1)}%`}
        </span>
      )}
    />
  );
}
