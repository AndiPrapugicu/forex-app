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

import { useMemo } from 'react';
import {
  CROWD_BANDS,
  RETAIL_HISTORY_WEEKS,
  crowdExtremity,
  type CrowdRow,
} from '@/lib/scoring/sentiment';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/primitives';
import { BiasPill, Panel } from '@/components/ui';

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
    <div
      role="img"
      aria-label={`${pct.toFixed(1)}% long`}
      className="relative h-3 w-full min-w-28 overflow-hidden rounded-sm bg-[var(--color-surface-2)]"
    >
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
  if (history.length < 2) return <div className="h-6 w-24" />;

  const W = 100;
  const H = 24;
  const step = W / (history.length - 1);
  const y = (pct: number) => H - (pct / 100) * H;

  const points = history.map((pct, i) => `${(i * step).toFixed(2)},${y(pct).toFixed(2)}`).join(' ');
  const last = history[history.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-6 w-24" aria-hidden>
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

const COLUMNS: Column<CrowdRow>[] = [
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
  {
    key: 'extremity',
    label: 'Stretch',
    explain: 'How far past its nearest scoring band the long share sits. The default order: most stretched first.',
    sortValue: crowdExtremity,
    hideOnCards: true,
    render: (r) => <span className="text-[var(--color-muted)]">{crowdExtremity(r).toFixed(0)}</span>,
  },
  {
    key: 'long',
    label: 'Long',
    sortValue: (r) => r.retailLongPct,
    render: (r) => <span className="font-semibold">{r.retailLongPct.toFixed(1)}%</span>,
  },
  {
    key: 'bar',
    label: 'Crowd',
    align: 'left',
    explain: `The two bright rules are the ${CROWD_BANDS.bullish}% and ${CROWD_BANDS.bearish}% cuts; the darker region between them scores nothing.`,
    hideOnCards: true,
    render: (r) => <CrowdBar pct={r.retailLongPct} cell={r.cell} />,
  },
  {
    key: 'history',
    label: `${RETAIL_HISTORY_WEEKS}w`,
    textLabel: `${RETAIL_HISTORY_WEEKS}-week history`,
    align: 'left',
    render: (r) => <RetailSparkline history={r.history} />,
  },
  {
    key: 'percentile',
    label: '3y pct',
    explain: "Where this week's long share sits in its own 3-year range. Shown, but it does not vote.",
    sortValue: (r) => Math.abs(r.percentile - 50),
    render: (r) => <span className="text-[var(--color-muted)]">{r.percentile}</span>,
  },
  {
    key: 'spread',
    label: 'vs inst.',
    textLabel: 'Gap to institutions',
    explain: 'Net share of the crowd minus net share of large speculators, in points.',
    sortValue: (r) => Math.abs(r.spread),
    render: (r) => (
      <span className={r.divergent ? 'text-[var(--color-uncertain)]' : 'text-[var(--color-muted)]'}>
        {r.spread > 0 ? '+' : ''}
        {r.spread.toFixed(0)}
      </span>
    ),
  },
  {
    key: 'cell',
    label: 'Cell',
    align: 'left',
    sortValue: (r) => r.cell,
    hideOnCards: true,
    render: (r) => <BiasPill cell={r.cell} maxCell={1} />,
  },
];

export function SentimentPanel({ rows, reportDate }: { rows: CrowdRow[]; reportDate: string | null }) {
  const divergent = useMemo(
    () => [...rows].filter((r) => r.divergent).sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread)),
    [rows],
  );

  const stretched = rows.filter((r) => r.cell !== 0).length;

  return (
    <div className="mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6">
      <PageHeader
        title="Retail Sentiment"
        description={`Small-trader positioning, read against them · ${stretched} of ${rows.length} contracts past the ${CROWD_BANDS.bullish}/${CROWD_BANDS.bearish} line`}
        updated={reportDate ? `CFTC report of ${reportDate}` : undefined}
        info={
          <>
            Read contrarian. A crowd leaning long is a bearish cell and vice versa: at or beyond {CROWD_BANDS.bearish}%
            long it scores −1, at or below {CROWD_BANDS.bullish}% it scores +1, and the band between scores nothing.
            The 3-year percentile is often more revealing, but the cell reads the raw share because that is the rule
            being reproduced.
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Retail positioning" subtitle="Long share, with the scoring bands drawn on">
          <DataTable
            caption="Retail positioning"
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.contract}
            defaultSort={{ key: 'extremity', dir: 'desc' }}
            maxHeight="calc(100dvh - 12rem)"
            cardTitle={(r) => <span className="font-mono">{r.ticker}</span>}
            cardAside={(r) => <BiasPill cell={r.cell} maxCell={1} />}
            expand={(r) => (
              <>
                <CrowdBar pct={r.retailLongPct} cell={r.cell} />
                <p className="mt-2">
                  {r.contract} — {r.explanation}
                </p>
              </>
            )}
          />
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Crowd vs smart money" subtitle={`${divergent.length} contracts positioned on opposite sides`}>
            {divergent.length === 0 ? (
              <p className="px-4 py-6 text-center text-small text-[var(--color-faint)]">
                Retail and large speculators are on the same side of every contract this week.
              </p>
            ) : (
              <div className="divide-y divide-[var(--color-border)]/60">
                {divergent.map((r) => (
                  <div key={r.contract} className="px-4 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-small font-semibold">{r.ticker}</span>
                      <span className="tnum ml-auto text-caption text-[var(--color-uncertain)]">
                        {Math.abs(r.spread).toFixed(0)}pt gap
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-caption">
                      <div>
                        <span className="text-[var(--color-faint)]">Institutions </span>
                        <span className={r.specNetPct >= 0 ? 'text-[var(--color-bull-cell)]' : 'text-[var(--color-bear)]'}>
                          {r.specNetPct > 0 ? '+' : ''}
                          {r.specNetPct}%
                        </span>
                      </div>
                      <div>
                        <span className="text-[var(--color-faint)]">Crowd </span>
                        <span className={r.retailNetPct >= 0 ? 'text-[var(--color-bull-cell)]' : 'text-[var(--color-bear)]'}>
                          {r.retailNetPct > 0 ? '+' : ''}
                          {r.retailNetPct}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-caption leading-relaxed text-[var(--color-faint)]">
              Net as a share of each side&rsquo;s own book, so a 30,000-lot contract and a 300,000-lot one compare.
              Listed only when the two are on genuinely opposite sides.
            </p>
          </Panel>

          <Panel title="What this measures" padded>
            <div className="space-y-2 text-caption leading-relaxed text-[var(--color-muted)]">
              <p>
                EdgeFinder&rsquo;s Crowd Sentiment is retail broker positioning from a vendor they do not name. No free,
                documented equivalent covers the crosses: IG client sentiment needs a logged-in account, Dukascopy&rsquo;s
                SWFX index is only served through its widget or an account API, and Myfxbook rejects its own session.
              </p>
              <p>
                <strong className="text-[var(--color-text)]">So this is the CFTC&rsquo;s non-reportable positions</strong>{' '}
                — traders too small to be required to file, published free in the same weekly report as the institutional
                data. Genuinely small-trader money, but <em>futures rather than spot</em> and <em>weekly</em>, surveyed on
                a Tuesday for release on a Friday.
              </p>
              <p>
                Contracts where small traders hold fewer than 500 positions in total are omitted. A percentage off a
                handful of contracts is arithmetic, not a crowd.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
