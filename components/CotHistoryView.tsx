'use client';

/**
 * COT Data History: one contract, every weekly report we hold.
 *
 * No new data — the CFTC connector already fetches roughly three years per
 * contract for the percentile. This draws it.
 */

import { useMemo, useState } from 'react';
import { BandedLine } from '@/components/charts';
import { DataTable, type Column } from '@/components/DataTable';
import { Panel } from '@/components/ui';

export interface CotHistoryWeek {
  date: string;
  specLong: number;
  specShort: number;
  specNet: number;
  specLongPct: number;
  specNetChange: number | null;
  retailLongPct: number;
  openInterest: number | null;
}

export interface CotHistorySeries {
  contract: string;
  ticker: string;
  /** Oldest first. */
  weeks: CotHistoryWeek[];
}

const fmt = (n: number) => n.toLocaleString();
const signed = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString()}`);
const tone = (n: number | null) =>
  n === null || n === 0 ? 'text-[var(--color-faint)]' : n > 0 ? 'text-[var(--color-bull-cell)]' : 'text-[var(--color-bear)]';

const COLUMNS: Column<CotHistoryWeek>[] = [
  { key: 'date', label: 'Report', align: 'left', sticky: true, hideOnCards: true, sortValue: (w) => w.date, render: (w) => w.date },
  { key: 'long', label: 'Long', sortValue: (w) => w.specLong, render: (w) => fmt(w.specLong) },
  { key: 'short', label: 'Short', sortValue: (w) => w.specShort, render: (w) => fmt(w.specShort) },
  { key: 'net', label: 'Net', sortValue: (w) => w.specNet, render: (w) => <span className={`font-semibold ${tone(w.specNet)}`}>{signed(w.specNet)}</span> },
  { key: 'dnet', label: 'Δ Net', sortValue: (w) => w.specNetChange, render: (w) => <span className={tone(w.specNetChange)}>{signed(w.specNetChange)}</span> },
  { key: 'longpct', label: 'Long %', sortValue: (w) => w.specLongPct, render: (w) => `${w.specLongPct.toFixed(1)}%` },
  { key: 'retail', label: 'Retail long %', sortValue: (w) => w.retailLongPct, render: (w) => `${w.retailLongPct.toFixed(1)}%` },
  { key: 'oi', label: 'Open int.', sortValue: (w) => w.openInterest, hideOnCards: true, render: (w) => (w.openInterest === null ? '—' : fmt(w.openInterest)) },
];

/** Label every point by month so the axis stays short; BandedLine thins the labels itself. */
const axisLabel = (date: string) => date.slice(2, 7);

export function CotHistoryView({ series, initial }: { series: CotHistorySeries[]; initial?: string }) {
  const [selected, setSelected] = useState(
    series.find((s) => s.ticker === initial || s.contract === initial)?.contract ?? series[0]?.contract ?? '',
  );
  const active = series.find((s) => s.contract === selected) ?? series[0];

  const newestFirst = useMemo(() => (active ? [...active.weeks].reverse() : []), [active]);

  if (!active) return null;

  const choose = (contract: string) => {
    setSelected(contract);
    const ticker = series.find((s) => s.contract === contract)?.ticker;
    if (!ticker) return;
    const url = new URL(window.location.href);
    url.searchParams.set('contract', ticker);
    window.history.replaceState(null, '', url);
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
        <span className="text-caption text-[var(--color-faint)]">Contract</span>
        <select
          value={active.contract}
          onChange={(e) => choose(e.target.value)}
          className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-small outline-none md:min-h-9 md:w-64"
        >
          {series.map((s) => (
            <option key={s.contract} value={s.contract}>
              {s.ticker}
            </option>
          ))}
        </select>
        <span className="text-caption text-[var(--color-muted)]">
          {active.weeks.length} weekly reports · {active.weeks[0]?.date} to {active.weeks[active.weeks.length - 1]?.date}
        </span>
      </label>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={`${active.ticker} · net position`} subtitle="Large speculators, contracts" padded>
          <BandedLine
            label={`${active.ticker} speculator net position over time`}
            points={active.weeks.map((w) => ({ label: axisLabel(w.date), value: w.specNet }))}
            bands={[{ value: 0, label: 'flat', tone: 'muted' }]}
            format={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0))}
          />
        </Panel>
        <Panel title={`${active.ticker} · long share`} subtitle="Speculators' long share against the crowd's" padded>
          <BandedLine
            label={`${active.ticker} speculator long share over time`}
            points={active.weeks.map((w) => ({ label: axisLabel(w.date), value: w.specLongPct }))}
            bands={[{ value: 50, label: 'even', tone: 'muted' }]}
            format={(v) => `${v.toFixed(0)}%`}
          />
        </Panel>
      </div>

      <Panel title="Weekly reports" subtitle="Newest first">
        <DataTable
          caption={`${active.ticker} weekly COT reports`}
          columns={COLUMNS}
          rows={newestFirst}
          rowKey={(w) => w.date}
          maxHeight="calc(100dvh - 14rem)"
          cardTitle={(w) => w.date}
          cardAside={(w) => <span className={`tnum text-small font-semibold ${tone(w.specNet)}`}>{signed(w.specNet)}</span>}
        />
      </Panel>
    </div>
  );
}
