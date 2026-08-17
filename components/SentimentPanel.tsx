'use client';

/**
 * The Sentiment tab.
 *
 * Three readings of the same weekly file, in the order they are useful:
 *
 *   1. Where the crowd is, with the scoring bands drawn ON the bar — so a cell
 *      value is visibly a consequence of where the bar sits, not an assertion
 *      beside it.
 *   2. Where the crowd has BEEN, as a 52-week line. "The crowd is at an
 *      extreme" is a claim about history and cannot be made from one number.
 *   3. Where the crowd is relative to the institutions, widest disagreement
 *      first.
 */

import { useMemo, useState } from 'react';
import {
  CROWD_BANDS,
  RETAIL_HISTORY_WEEKS,
  crowdExtremity,
  type CrowdRow,
} from '@/lib/scoring/sentiment';
import { BiasPill, Panel } from '@/components/ui';

type SortKey = 'extremity' | 'long' | 'percentile' | 'spread' | 'ticker';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'extremity', label: 'Most stretched' },
  { key: 'long', label: '% long' },
  { key: 'percentile', label: '3y percentile' },
  { key: 'spread', label: 'vs institutions' },
  { key: 'ticker', label: 'A–Z' },
];

/**
 * The crowd bar.
 *
 * Full width is 0-100% long, with the +/-40 and +/-60 cuts drawn as vertical
 * rules. Reading it, the score is not a separate fact to be trusted — the bar
 * either crosses a line or it does not.
 */
function CrowdBar({ pct, cell }: { pct: number; cell: number }) {
  const tone =
    cell > 0 ? 'rgb(var(--color-bull-rgb) / 85%)' : cell < 0 ? 'rgb(var(--color-bear-rgb) / 85%)' : 'var(--color-neutral)';

  return (
    <div className="relative h-3 w-full overflow-hidden rounded-sm bg-[var(--color-surface-2)]">
      {/* The neutral band, so "no signal" is a visible region not an absence. */}
      <div
        className="absolute inset-y-0 bg-[var(--color-bg)]/40"
        style={{
          left: `${CROWD_BANDS.bullish}%`,
          width: `${CROWD_BANDS.bearish - CROWD_BANDS.bullish}%`,
        }}
      />
      <div className="absolute inset-y-0 rounded-sm" style={{ width: `${pct}%`, backgroundColor: tone }} />
      {[CROWD_BANDS.bullish, 50, CROWD_BANDS.bearish].map((x) => (
        <div
          key={x}
          className="absolute inset-y-0 w-px"
          style={{
            left: `${x}%`,
            backgroundColor: x === 50 ? 'var(--color-border-bright)' : 'var(--color-text)',
            opacity: x === 50 ? 0.9 : 0.45,
          }}
        />
      ))}
    </div>
  );
}

/**
 * 52 weeks of retail long share.
 *
 * Fixed 0-100 y-axis, deliberately. Auto-scaling would make a contract that
 * drifted between 48% and 52% look as dramatic as one that swung 20% to 80%,
 * which is the exact misreading this panel exists to prevent.
 */
function RetailSparkline({ history }: { history: number[] }) {
  if (history.length < 2) return <div className="h-6 w-full" />;

  const W = 100;
  const H = 24;
  const step = W / (history.length - 1);
  const y = (pct: number) => H - (pct / 100) * H;

  const points = history.map((pct, i) => `${(i * step).toFixed(2)},${y(pct).toFixed(2)}`).join(' ');
  const last = history[history.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      {[CROWD_BANDS.bullish, CROWD_BANDS.bearish].map((band) => (
        <line
          key={band}
          x1={0}
          x2={W}
          y1={y(band)}
          y2={y(band)}
          stroke="var(--color-border-bright)"
          strokeWidth={0.5}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <polyline
        points={points}
        fill="none"
        stroke={
          last >= CROWD_BANDS.bearish
            ? 'var(--color-bear)'
            : last <= CROWD_BANDS.bullish
              ? 'var(--color-bull)'
              : 'var(--color-muted)'
        }
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function SentimentPanel({
  rows,
  reportDate,
}: {
  rows: CrowdRow[];
  reportDate: string | null;
}) {
  const [sort, setSort] = useState<SortKey>('extremity');

  const sorted = useMemo(() => {
    const out = [...rows];
    switch (sort) {
      case 'long':
        return out.sort((a, b) => b.retailLongPct - a.retailLongPct);
      case 'percentile':
        return out.sort((a, b) => Math.abs(b.percentile - 50) - Math.abs(a.percentile - 50));
      case 'spread':
        return out.sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread));
      case 'ticker':
        return out.sort((a, b) => a.ticker.localeCompare(b.ticker));
      default:
        return out.sort((a, b) => crowdExtremity(b) - crowdExtremity(a));
    }
  }, [rows, sort]);

  const divergent = useMemo(
    () => [...rows].filter((r) => r.divergent).sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread)),
    [rows],
  );

  const stretched = rows.filter((r) => r.cell !== 0).length;

  return (
    <div className="px-4 py-4">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <h1 className="text-lg font-bold">Crowd sentiment</h1>
          <p className="text-xs text-[var(--color-faint)]">
            Small-trader positioning, read against them
            {reportDate && ` · CFTC report of ${reportDate}`}
          </p>
        </div>
        <span className="ml-auto text-[11px] text-[var(--color-muted)]">
          <span className="font-semibold text-[var(--color-text)]">{stretched}</span> of {rows.length}{' '}
          contracts past the {CROWD_BANDS.bullish}/{CROWD_BANDS.bearish} line
        </span>
      </header>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* --- Where the crowd is ----------------------------------------- */}
        <Panel
          title="Retail positioning"
          subtitle="Long share, with the scoring bands drawn on"
          action={
            <div className="flex flex-wrap items-center gap-1">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSort(s.key)}
                  className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                    sort === s.key
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[11px]">
              <thead>
                <tr className="text-[9px] tracking-wider text-[var(--color-faint)] uppercase">
                  <th className="px-3 py-1.5 text-left">Contract</th>
                  <th className="px-2 py-1.5 text-right">Long</th>
                  <th className="w-[34%] px-2 py-1.5 text-left">Crowd</th>
                  <th className="w-24 px-2 py-1.5 text-left">
                    {RETAIL_HISTORY_WEEKS}w
                  </th>
                  <th className="px-2 py-1.5 text-right">3y pct</th>
                  <th className="px-3 py-1.5 text-left">Cell</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.contract}
                    className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface-2)]/40"
                    title={`${r.contract} — ${r.explanation}`}
                  >
                    <td className="px-3 py-1.5 font-mono whitespace-nowrap">{r.ticker}</td>
                    <td className="tnum px-2 py-1.5 text-right font-semibold">
                      {r.retailLongPct.toFixed(1)}%
                    </td>
                    <td className="px-2 py-1.5">
                      <CrowdBar pct={r.retailLongPct} cell={r.cell} />
                    </td>
                    <td className="px-2 py-1.5">
                      <RetailSparkline history={r.history} />
                    </td>
                    <td
                      className="tnum px-2 py-1.5 text-right text-[var(--color-muted)]"
                      title="Where this week's long share sits in its own 3-year range"
                    >
                      {r.percentile}
                    </td>
                    <td className="px-3 py-1.5">
                      <BiasPill cell={r.cell} maxCell={1} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 border-t border-[var(--color-border)] px-3 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
            <p>
              <strong className="text-[var(--color-muted)]">Read contrarian.</strong> A crowd
              leaning long is a bearish cell and vice versa — at or beyond{' '}
              {CROWD_BANDS.bearish}% long it scores −1, at or below {CROWD_BANDS.bullish}% it scores
              +1, and the wide band between them scores nothing. The two bright rules on each bar
              are those cuts; the darker region between is the neutral zone.
            </p>
            <p>
              <strong className="text-[var(--color-muted)]">The percentile does not vote.</strong>{' '}
              It is often the more revealing number — a book that looks crowded can still be below
              its own 3-year median — but the cell reads the raw share, because that is the rule
              being reproduced. Both are shown; only one scores.
            </p>
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          {/* --- Crowd against the institutions --------------------------- */}
          <Panel
            title="Crowd vs smart money"
            subtitle={`${divergent.length} contracts positioned on opposite sides`}
          >
            {divergent.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-[var(--color-faint)]">
                Retail and large speculators are on the same side of every contract this week.
              </p>
            ) : (
              <div className="divide-y divide-[var(--color-border)]/60">
                {divergent.map((r) => (
                  <div key={r.contract} className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px]">{r.ticker}</span>
                      <span className="ml-auto tnum text-[10px] text-[var(--color-uncertain)]">
                        {Math.abs(r.spread).toFixed(0)}pt gap
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <span className="text-[var(--color-faint)]">Institutions </span>
                        <span
                          className={
                            r.specNetPct >= 0 ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'
                          }
                        >
                          {r.specNetPct > 0 ? '+' : ''}
                          {r.specNetPct}%
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--color-faint)]">Crowd </span>
                        <span
                          className={
                            r.retailNetPct >= 0
                              ? 'text-[var(--color-bull)]'
                              : 'text-[var(--color-bear)]'
                          }
                        >
                          {r.retailNetPct > 0 ? '+' : ''}
                          {r.retailNetPct}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="border-t border-[var(--color-border)] px-3 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
              Net as a share of each side&rsquo;s own book, so a 30,000-lot contract and a
              300,000-lot one compare. Listed only when the two are on genuinely opposite sides,
              not merely long by different amounts.
            </p>
          </Panel>

          {/* --- What this actually is ------------------------------------ */}
          <Panel title="What this measures">
            <div className="space-y-2 px-3 py-3 text-[10px] leading-relaxed text-[var(--color-faint)]">
              <p>
                EdgeFinder&rsquo;s Crowd Sentiment is retail broker positioning, refreshed every 30
                minutes, from a vendor they do not name. There is no free, documented, unblocked
                equivalent: Myfxbook&rsquo;s API needs an account and asks that anything built on it
                be free, IG and DailyFX return 403, FX Blue publishes no JSON, and
                Dukascopy&rsquo;s SWFX endpoint is undocumented.
              </p>
              <p>
                <strong className="text-[var(--color-muted)]">
                  So this is the CFTC&rsquo;s non-reportable positions
                </strong>{' '}
                — traders too small to be required to file, published free in the same weekly report
                as the institutional data. Genuinely small-trader money and genuinely contrarian,
                but <em>futures rather than spot</em>, <em>weekly rather than half-hourly</em>, and
                surveyed on a Tuesday for release on a Friday, so it is never less than three days
                old.
              </p>
              <p>
                Contracts where small traders hold fewer than 500 positions in total are omitted
                entirely. A percentage off a handful of contracts is arithmetic, not a crowd.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
