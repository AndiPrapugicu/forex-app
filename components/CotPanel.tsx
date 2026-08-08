'use client';

/**
 * COT positioning: the long/short split across contracts, the weekly filing
 * detail, and the retail-vs-smart-money divergences.
 *
 * The divergence section is the part worth having. Both sides come from the same
 * free CFTC file — large speculators in `noncomm_*`, small traders in
 * `nonrept_*` — so a contract where they sit on opposite sides is visible
 * without a paid sentiment feed.
 */

import { useMemo, useState } from 'react';
import type { CotRowView } from '@/lib/scoring/cot-rows';
import { EmptyState, Panel } from '@/components/ui';

function fmt(n: number): string {
  return n.toLocaleString();
}

/**
 * Stacked long/short bars, sorted by long share.
 *
 * Percentages rather than absolute contracts, because contract sizes are not
 * comparable — gold trades hundreds of thousands while the franc trades tens of
 * thousands, and an absolute-scale chart would show only the biggest markets.
 */
function PositioningBars({ rows }: { rows: CotRowView[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.latest.specLongPct - b.latest.specLongPct),
    [rows],
  );

  return (
    <div className="overflow-x-auto px-4 py-4">
      <div className="flex min-w-[640px] items-end gap-1.5" style={{ height: 220 }}>
        {sorted.map((row) => {
          const longPct = row.latest.specLongPct;
          return (
            <div
              key={row.contract}
              className="flex flex-1 flex-col items-center gap-1"
              title={`${row.contract}: ${fmt(row.latest.specLong)} long / ${fmt(row.latest.specShort)} short (${longPct.toFixed(1)}% long)`}
            >
              <div className="flex h-[180px] w-full flex-col overflow-hidden rounded-sm">
                <div
                  className="w-full"
                  style={{ height: `${100 - longPct}%`, backgroundColor: 'rgba(242,80,110,0.85)' }}
                />
                <div
                  className="w-full"
                  style={{ height: `${longPct}%`, backgroundColor: 'rgba(58,122,224,0.9)' }}
                />
              </div>
              <span className="w-full truncate text-center text-[8px] text-[var(--color-faint)]">
                {row.contract.replace(/ (FX|DOLLAR|INDEX|-PHYSICAL)$/i, '')}
              </span>
              <span className="tnum text-[8px] text-[var(--color-muted)]">{longPct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4 text-[10px] text-[var(--color-faint)]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: 'rgba(58,122,224,0.9)' }} />
          long
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: 'rgba(242,80,110,0.85)' }} />
          short
        </span>
        <span>Large speculators only. Sorted least to most long.</span>
      </div>
    </div>
  );
}

export function CotPanel({
  rows,
  reportDate,
  ageDays,
}: {
  rows: CotRowView[];
  reportDate: string | null;
  ageDays: number | null;
}) {
  const [sortKey, setSortKey] = useState<'net' | 'change' | 'contract'>('net');

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sortKey === 'contract') return copy.sort((a, b) => a.contract.localeCompare(b.contract));
    if (sortKey === 'change') {
      return copy.sort((a, b) => Math.abs(b.latest.specNetChange ?? 0) - Math.abs(a.latest.specNetChange ?? 0));
    }
    return copy.sort((a, b) => b.latest.specNet - a.latest.specNet);
  }, [rows, sortKey]);

  const divergences = rows.filter((r) => r.divergence);

  if (rows.length === 0) {
    return (
      <Panel title="COT positioning">
        <EmptyState message="No COT data available" hint="The CFTC publishes weekly, on Fridays" />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        The staleness note is mandatory, not decorative. The survey is taken on a
        Tuesday and published the following Friday, so this data is ALWAYS at
        least three days old. Presenting it as live positioning would misrepresent
        what it is.
      */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-[11px]">
        <span className="text-[var(--color-muted)]">
          Report date <span className="font-semibold text-[var(--color-text)]">{reportDate ?? '—'}</span>
        </span>
        {ageDays !== null && (
          <span className={ageDays > 14 ? 'text-[var(--color-uncertain)]' : 'text-[var(--color-faint)]'}>
            {ageDays} days old
            {ageDays > 14 && ' — unusually stale, the CFTC may have delayed publication'}
          </span>
        )}
        <span className="ml-auto text-[var(--color-faint)]">
          Positions surveyed Tuesday, published Friday — this always lags by at least 3 days.
        </span>
      </div>

      <Panel title="Net positioning" subtitle="Long vs short share of large speculator positions">
        <PositioningBars rows={rows} />
      </Panel>

      {divergences.length > 0 && (
        <Panel
          title="Retail vs smart money"
          subtitle="Contracts where small traders are positioned opposite large speculators"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {divergences.map((row) => (
              <div
                key={row.contract}
                className="border-r border-b border-[var(--color-border)] px-4 py-3 last:border-r-0"
              >
                <div className="font-mono text-xs font-semibold">{row.contract}</div>
                <div className="mt-1.5 flex items-baseline gap-3 text-[11px]">
                  <span>
                    <span className="text-[var(--color-faint)]">retail </span>
                    <span className="tnum font-semibold">{row.retailLongPct}% long</span>
                  </span>
                  <span>
                    <span className="text-[var(--color-faint)]">specs </span>
                    <span
                      className={`tnum font-semibold ${row.latest.specNet > 0 ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'}`}
                    >
                      {row.latest.specNet > 0 ? 'net long' : 'net short'}
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[var(--color-faint)]">
                  Crowd read contrarian: {row.crowdCell !== null && row.crowdCell > 0 ? 'bullish' : row.crowdCell !== null && row.crowdCell < 0 ? 'bearish' : 'neutral'}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Latest weekly filing"
        action={
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[10px] outline-none"
          >
            <option value="net">Sort by net position</option>
            <option value="change">Sort by weekly change</option>
            <option value="contract">Sort by contract</option>
          </select>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-right text-[11px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[9px] tracking-wider text-[var(--color-faint)] uppercase">
                <th className="px-3 py-2 text-left">Contract</th>
                <th className="px-2 py-2">Spec long</th>
                <th className="px-2 py-2">Spec short</th>
                <th className="px-2 py-2">Net</th>
                <th className="px-2 py-2">Δ week</th>
                <th className="px-2 py-2">Long %</th>
                <th className="px-2 py-2">Pctile</th>
                <th className="px-2 py-2">Retail %</th>
                <th className="px-2 py-2">Open int.</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.contract} className="border-b border-[var(--color-border)]/60 hover:bg-[var(--color-surface-2)]/50">
                  <td className="px-3 py-1.5 text-left font-mono text-[10px]">{row.contract}</td>
                  <td className="tnum px-2 py-1.5">{fmt(row.latest.specLong)}</td>
                  <td className="tnum px-2 py-1.5">{fmt(row.latest.specShort)}</td>
                  <td
                    className={`tnum px-2 py-1.5 font-semibold ${row.latest.specNet >= 0 ? 'text-[#5b95e8]' : 'text-[var(--color-bear)]'}`}
                  >
                    {row.latest.specNet > 0 ? '+' : ''}
                    {fmt(row.latest.specNet)}
                  </td>
                  <td
                    className={`tnum px-2 py-1.5 ${
                      (row.latest.specNetChange ?? 0) > 0
                        ? 'text-[var(--color-bull)]'
                        : (row.latest.specNetChange ?? 0) < 0
                          ? 'text-[var(--color-bear)]'
                          : 'text-[var(--color-faint)]'
                    }`}
                  >
                    {row.latest.specNetChange === null
                      ? '—'
                      : `${row.latest.specNetChange > 0 ? '+' : ''}${fmt(row.latest.specNetChange)}`}
                  </td>
                  <td className="tnum px-2 py-1.5">{row.latest.specLongPct.toFixed(1)}</td>
                  <td className="tnum px-2 py-1.5 text-[var(--color-muted)]">
                    {row.cotPercentile === null ? '—' : `${row.cotPercentile}`}
                  </td>
                  <td className={`tnum px-2 py-1.5 ${row.divergence ? 'text-[var(--color-uncertain)]' : ''}`}>
                    {row.retailLongPct === null ? '—' : row.retailLongPct.toFixed(1)}
                  </td>
                  <td className="tnum px-2 py-1.5 text-[var(--color-faint)]">
                    {row.latest.openInterest === null ? '—' : fmt(row.latest.openInterest)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--color-border)] px-3 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
          &ldquo;Pctile&rdquo; is where the current net position sits within that contract&rsquo;s own
          3-year range — absolute size is not comparable across contracts. Retail % is highlighted where
          small traders are positioned opposite the speculators. Source: CFTC Commitments of Traders.
        </p>
      </Panel>
    </div>
  );
}
