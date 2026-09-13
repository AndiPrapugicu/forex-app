'use client';

/**
 * Currency economic heatmap.
 *
 * One row per release, most recent first, read TWO ways: what it means for the
 * currency, and what it means for equities. That split is the point of the page.
 * A cooler CPI is bearish EUR and bullish stocks, and a single "impact" column
 * would have to pick one and be wrong about the other half of the market.
 *
 * The Surprise cell is coloured by the STOCKS reading, i.e. risk-on blue and
 * risk-off red, which is A1's convention — "Blue = Positive surprise → Risk-on
 * sentiment". It is deliberately not the raw arithmetic sign: a US unemployment
 * beat is a negative number and unambiguously good news, and colouring that red
 * next to a Bullish badge is what the previous version did.
 */

import Link from 'next/link';
import type { CurrencyHeatmap } from '@/lib/scoring/heatmap';
import { Panel } from '@/components/ui';
import { heatStyle } from '@/lib/ui/heat';
import { MAJORS, type Currency } from '@/lib/types';

function fmt(v: number | null, unit: string | null): string {
  if (v === null) return '—';
  const abs = Math.abs(v);
  const text =
    abs >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : abs >= 1e4 ? `${(v / 1e3).toFixed(0)}K` : String(v);
  return unit ? `${text}${unit}` : text;
}

/**
 * Surprise cell background.
 *
 * Hue comes from the risk reading, magnitude from the size of the miss relative
 * to what was expected. Splitting those two channels is what lets a big
 * risk-negative surprise look different from a marginal one without the colour
 * ever contradicting the badge beside it.
 */
function surpriseStyle(
  surprise: number | null,
  reference: number | null,
  stocksImpact: number | null,
): React.CSSProperties {
  if (surprise === null || surprise === 0 || stocksImpact === null || stocksImpact === 0) return {};

  const scale = reference && reference !== 0 ? Math.abs(surprise / reference) : Math.abs(surprise);
  // Full strength at a 20% miss relative to the reference.
  return heatStyle(stocksImpact > 0 ? scale : -scale, { max: 0.2, zeroGrey: false });
}

const IMPACT_LABEL: Record<string, string> = { '1': 'Bullish', '-1': 'Bearish', '0': 'Neutral' };

function ImpactBadge({ value, status }: { value: number | null; status: string }) {
  const impact = status === 'scored' && value !== null ? IMPACT_LABEL[String(value)] : null;

  // No 'stale' case: an old print carries a real verdict now, so it reaches
  // IMPACT_LABEL like any other. Its age is marked in the date column instead.
  if (!impact) {
    return (
      <span className="text-micro text-[var(--color-faint)]">
        {status === 'not-released' ? 'awaiting' : 'no data'}
      </span>
    );
  }

  return (
    <span className="inline-block w-16 rounded px-2 py-0.5 text-micro font-semibold" style={heatStyle(value)}>
      {impact}
    </span>
  );
}

/**
 * Bullish-share dial, 0–100%.
 *
 * A half-circle rather than a bar because the reading is "which side is this
 * leaning", and a needle crossing a midpoint says that faster than a fill length.
 * 50% is the meaningful centre, not zero.
 */
function ImpactGauge({ label, pct }: { label: string; pct: number | null }) {
  const size = 92;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;

  const value = pct ?? 50;
  const angle = (value / 100) * 180;
  const rad = ((angle - 180) * Math.PI) / 180;
  const nx = cx + (r - 3) * Math.cos(rad);
  const ny = cy + (r - 3) * Math.sin(rad);

  const arc = (from: number, to: number) => {
    const p = (deg: number) => {
      const a = ((deg - 180) * Math.PI) / 180;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    };
    const s = p(from);
    const e = p(to);
    return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`;
  };

  const color =
    pct === null
      ? 'var(--color-muted)'
      : pct > 50
        ? 'var(--color-bull)'
        : pct < 50
          ? 'var(--color-bear)'
          : 'var(--color-muted)';

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 18} viewBox={`0 0 ${size} ${size / 2 + 18}`} role="img"
        aria-label={`${label} ${pct === null ? 'unavailable' : `${pct} percent bullish`}`}>
        {/* Bearish half, then bullish half — the dial reads as a spectrum. */}
        <path d={arc(0, 90)} fill="none" stroke="var(--color-bear)" strokeWidth={7} opacity={0.35} />
        <path d={arc(90, 180)} fill="none" stroke="var(--color-bull)" strokeWidth={7} opacity={0.35} />
        {pct !== null && (
          <>
            <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={2} strokeLinecap="round" />
            <circle cx={cx} cy={cy} r={3} fill={color} />
          </>
        )}
      </svg>
      <div className={`tnum text-sm font-bold`} style={{ color }}>
        {pct === null ? '—' : `${pct}%`}
      </div>
      <div className="text-micro tracking-wide text-[var(--color-faint)] uppercase">{label}</div>
    </div>
  );
}

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
      ? 'text-[var(--color-bull-cell)]'
      : data.macroScore <= -2
        ? 'text-[var(--color-bear)]'
        : 'text-[var(--color-muted)]';

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-title font-semibold tracking-tight">{data.currency} Economic Heatmap</h1>

        <div className="flex items-baseline gap-2">
          <span className={`tnum text-2xl font-bold ${color}`}>
            {data.macroScore > 0 ? '+' : ''}
            {data.macroScore}
          </span>
          <span className={`text-sm font-medium ${color}`}>{label}</span>
          <span className="text-micro text-[var(--color-faint)]">
            from {data.scored} of {data.total} indicators
          </span>
        </div>

        <nav className="ml-auto flex flex-wrap gap-1" aria-label="Currency">
          {MAJORS.map((c: Currency) => (
            <Link
              key={c}
              href={`/heatmap?currency=${c}`}
              aria-current={c === data.currency ? 'page' : undefined}
              className={`rounded px-2.5 py-1 font-mono text-micro transition-colors ${
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

      <div className="flex flex-col gap-3 xl:flex-row">
        <Panel className="min-w-0 flex-1">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-caption">
              <thead>
                <tr className="table-head border-b border-[var(--color-border)] text-caption font-semibold">
                  <th className="px-3 py-2 text-left">Indicator</th>
                  <th className="px-2 py-2 text-left">Released</th>
                  <th className="px-2 py-2">Surprise</th>
                  <th className="px-2 py-2">Actual</th>
                  <th className="px-2 py-2">Forecast</th>
                  <th className="px-2 py-2">Previous</th>
                  <th className="px-2 py-2 text-center">{data.currency} Impact</th>
                  <th className="px-2 py-2 text-center">Stocks Impact</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={`${row.slotKey}:${row.label}`}
                    className="border-b border-[var(--color-border)]/60 hover:bg-[var(--color-surface-2)]/40"
                    title={row.explanation}
                  >
                    <td className="px-3 py-1.5 text-left">
                      <span className="font-medium">{row.label}</span>
                      {row.eventName && (
                        // Naming the exact series matters: "CPI YoY" for EUR is
                        // the euro-area HICP, not any member state's CPI.
                        <span className="ml-2 text-micro text-[var(--color-faint)]">
                          {row.eventName}
                        </span>
                      )}
                    </td>

                    <td className="px-2 py-1.5 text-left text-micro whitespace-nowrap text-[var(--color-muted)]">
                      {row.dateUtc ? row.dateUtc.slice(0, 10) : '—'}
                      {row.stale && (
                        <span
                          className="ml-1.5 text-micro text-[var(--color-uncertain)] italic"
                          title={`${row.ageDays ?? '?'} days old — past this series' usual cadence, and scored anyway, as A1 does`}
                        >
                          {row.ageDays === null ? 'stale' : `${row.ageDays}d`}
                        </span>
                      )}
                    </td>

                    <td
                      className="tnum px-2 py-1.5 font-semibold"
                      style={surpriseStyle(row.surprise, row.reference, row.stocksImpact)}
                      title={`Actual minus ${row.referenceLabel}`}
                    >
                      {row.surprise === null
                        ? '—'
                        : `${row.surprise > 0 ? '+' : ''}${fmt(row.surprise, row.unit)}`}
                    </td>

                    <td className="tnum px-2 py-1.5 font-semibold">{fmt(row.actual, row.unit)}</td>
                    {/*
                      PMI scores against the PREVIOUS print, so on those rows the
                      forecast is dimmed and the previous is promoted — the
                      emphasis has to follow which number the score actually used,
                      or the table implies the wrong comparison.
                    */}
                    <td
                      className={`tnum px-2 py-1.5 ${
                        row.referenceLabel === 'previous'
                          ? 'text-[var(--color-faint)] line-through decoration-1'
                          : 'text-[var(--color-muted)]'
                      }`}
                      title={
                        row.referenceLabel === 'previous'
                          ? 'Not used — this indicator scores against the previous print'
                          : undefined
                      }
                    >
                      {fmt(row.consensus, row.unit)}
                    </td>
                    <td
                      className={`tnum px-2 py-1.5 ${
                        row.referenceLabel === 'previous'
                          ? 'font-semibold text-[var(--color-muted)]'
                          : 'text-[var(--color-faint)]'
                      }`}
                      title={row.referenceLabel === 'previous' ? 'Scored against this' : undefined}
                    >
                      {fmt(row.previous, row.unit)}
                    </td>

                    <td className="px-2 py-1.5 text-center">
                      <ImpactBadge value={row.currencyImpact} status={row.status} />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <ImpactBadge value={row.stocksImpact} status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="border-t border-[var(--color-border)] px-3 py-2 text-micro leading-relaxed text-[var(--color-faint)]">
            The same release, read two ways. {data.currency} Impact is stated for the currency itself
            — on a pair it applies inverted when {data.currency} is the quote leg. Stocks Impact is
            the risk-asset reading, which is why cooler inflation can be bearish for the currency and
            bullish for equities at once. The Surprise cell is coloured by the stocks reading and
            measured against whatever the score used, which is the previous print for PMI. Only the
            SIGN is scored, so a small miss and a large one count the same.
          </p>
        </Panel>

        <Panel title="Impact" className="xl:w-56 xl:shrink-0">
          <div className="flex flex-row justify-around gap-2 px-3 py-4 xl:flex-col xl:items-center xl:gap-5">
            <ImpactGauge label={`${data.currency} impact`} pct={data.currencyImpactPct} />
            <ImpactGauge label="Stocks impact" pct={data.stocksImpactPct} />
          </div>
          <p className="border-t border-[var(--color-border)] px-3 py-2 text-micro leading-relaxed text-[var(--color-faint)]">
            Share of resolved releases reading bullish. 50% is balanced. Neutral prints count in the
            denominator — landing exactly on forecast is an outcome, not a missing data point.
          </p>
        </Panel>
      </div>
    </div>
  );
}
