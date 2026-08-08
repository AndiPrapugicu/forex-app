'use client';

/**
 * Currency economic heatmap.
 *
 * One row per indicator, most recent first, with the surprise colour-coded and
 * the currency impact stated explicitly. This is the "what has the data actually
 * been doing" view — the matrix tells you the conclusion, this tells you the
 * evidence in the order it arrived.
 */

import Link from 'next/link';
import type { CurrencyHeatmap } from '@/lib/scoring/heatmap';
import { Panel } from '@/components/ui';
import { MAJORS, type Currency } from '@/lib/types';

function fmt(v: number | null, unit: string | null): string {
  if (v === null) return '—';
  const abs = Math.abs(v);
  const text =
    abs >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : abs >= 1e4 ? `${(v / 1e3).toFixed(0)}K` : String(v);
  return unit ? `${text}${unit}` : text;
}

/** Surprise cell: blue for a beat, red for a miss, intensity by relative size. */
function surpriseStyle(surprise: number | null, consensus: number | null): React.CSSProperties {
  if (surprise === null || surprise === 0) return {};
  const scale = consensus && consensus !== 0 ? Math.abs(surprise / consensus) : Math.abs(surprise);
  const intensity = Math.min(0.2 + scale * 2, 0.6);
  return {
    backgroundColor: surprise > 0 ? `rgba(58,122,224,${intensity})` : `rgba(242,80,110,${intensity})`,
  };
}

const IMPACT_LABEL: Record<string, { text: string; className: string }> = {
  '1': { text: 'Bullish', className: 'bg-[rgba(58,122,224,0.55)] text-white' },
  '-1': { text: 'Bearish', className: 'bg-[rgba(242,80,110,0.55)] text-white' },
  '0': { text: 'Neutral', className: 'bg-[var(--color-surface-2)] text-[var(--color-muted)]' },
};

export function EconomicHeatmap({ data }: { data: CurrencyHeatmap }) {
  const label =
    data.macroScore >= 4
      ? 'Very Bullish'
      : data.macroScore >= 2
        ? 'Bullish'
        : data.macroScore <= -4
          ? 'Very Bearish'
          : data.macroScore <= -2
            ? 'Bearish'
            : 'Neutral';

  const color =
    data.macroScore >= 2
      ? 'text-[#5b95e8]'
      : data.macroScore <= -2
        ? 'text-[var(--color-bear)]'
        : 'text-[var(--color-muted)]';

  return (
    <div className="px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">{data.currency} Economic Heatmap</h1>

        <div className="flex items-baseline gap-2">
          <span className={`tnum text-2xl font-bold ${color}`}>
            {data.macroScore > 0 ? '+' : ''}
            {data.macroScore}
          </span>
          <span className={`text-sm font-medium ${color}`}>{label}</span>
          <span className="text-[11px] text-[var(--color-faint)]">
            from {data.scored} of {data.total} indicators
          </span>
        </div>

        <nav className="ml-auto flex flex-wrap gap-1" aria-label="Currency">
          {MAJORS.map((c: Currency) => (
            <Link
              key={c}
              href={`/heatmap?currency=${c}`}
              aria-current={c === data.currency ? 'page' : undefined}
              className={`rounded px-2.5 py-1 font-mono text-[11px] transition-colors ${
                c === data.currency
                  ? 'bg-[var(--color-bull)]/15 font-semibold text-[var(--color-bull)]'
                  : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'
              }`}
            >
              {c}
            </Link>
          ))}
        </nav>
      </header>

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-[12px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[9px] tracking-wider text-[var(--color-faint)] uppercase">
                <th className="px-3 py-2 text-left">Indicator</th>
                <th className="px-2 py-2 text-left">Released</th>
                <th className="px-2 py-2">Surprise</th>
                <th className="px-2 py-2">Actual</th>
                <th className="px-2 py-2">Forecast</th>
                <th className="px-2 py-2">Previous</th>
                <th className="px-2 py-2 text-center">{data.currency} Impact</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const impact =
                  row.status === 'scored' && row.impact !== null
                    ? IMPACT_LABEL[String(row.impact)]
                    : null;

                return (
                  <tr
                    key={row.slotKey}
                    className="border-b border-[var(--color-border)]/60 hover:bg-[var(--color-surface-2)]/40"
                    title={row.explanation}
                  >
                    <td className="px-3 py-1.5 text-left">
                      <span className="font-medium">{row.label}</span>
                      {row.eventName && (
                        // Naming the exact series matters: "CPI YoY" for EUR is
                        // the euro-area HICP, not any member state's CPI.
                        <span className="ml-2 text-[10px] text-[var(--color-faint)]">
                          {row.eventName}
                        </span>
                      )}
                    </td>

                    <td className="px-2 py-1.5 text-left text-[11px] whitespace-nowrap text-[var(--color-muted)]">
                      {row.dateUtc ? row.dateUtc.slice(0, 10) : '—'}
                      {row.status === 'stale' && (
                        <span className="ml-1.5 text-[9px] text-[var(--color-uncertain)] italic">stale</span>
                      )}
                    </td>

                    <td
                      className="tnum px-2 py-1.5 font-semibold"
                      style={surpriseStyle(row.surprise, row.consensus)}
                    >
                      {row.surprise === null
                        ? '—'
                        : `${row.surprise > 0 ? '+' : ''}${fmt(row.surprise, row.unit)}`}
                    </td>

                    <td className="tnum px-2 py-1.5 font-semibold">{fmt(row.actual, row.unit)}</td>
                    <td className="tnum px-2 py-1.5 text-[var(--color-muted)]">{fmt(row.consensus, row.unit)}</td>
                    <td className="tnum px-2 py-1.5 text-[var(--color-faint)]">{fmt(row.previous, row.unit)}</td>

                    <td className="px-2 py-1.5 text-center">
                      {impact ? (
                        <span className={`inline-block w-16 rounded px-2 py-0.5 text-[10px] font-semibold ${impact.className}`}>
                          {impact.text}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--color-faint)]">
                          {row.status === 'stale' ? 'stale' : 'no data'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="border-t border-[var(--color-border)] px-3 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
          Impact is stated for {data.currency} itself — on a pair it applies inverted when{' '}
          {data.currency} is the quote leg. Surprise is actual minus forecast in the release&rsquo;s own
          units; the score reads only its SIGN, so a small miss and a large one both count once. Rows
          resolve through the same rules as the Top Setups matrix, so the two always agree.
        </p>
      </Panel>
    </div>
  );
}
