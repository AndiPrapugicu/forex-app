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

import { useMemo } from 'react';
import { cotTicker } from '@/config/symbols.config';
import type { CotFlow } from '@/lib/scoring/cot-flow';
import type { CotRowView } from '@/lib/scoring/cot-rows';
import { DataTable, type Column } from '@/components/DataTable';
import { Legend } from '@/components/primitives';
import { EmptyState, Panel } from '@/components/ui';

function fmt(n: number): string {
  return n.toLocaleString();
}

/**
 * Signed, thousands-separated, with an em dash for missing.
 *
 * `undefined` as well as `null`, and that is not defensive padding. This data
 * arrives from JSON — the live feed, a Supabase row, or a captured fixture —
 * and a field added to `CotReport` after a fixture was captured is absent
 * rather than null. `specLongChange` and `specShortChange` are exactly that
 * case: they postdate `fixtures/sample-cot.json`, so every offline load of the
 * COT page hit `undefined.toLocaleString()` and 500'd the route.
 */
function signed(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${fmt(n)}`;
}

/** Blue for a rise, red for a fall, grey for flat or unknown. */
function deltaClass(n: number | null | undefined): string {
  // `undefined` too, for the same JSON reason as `signed`. Left out, a missing
  // value fell through to the `n > 0` test and painted itself red — a field we
  // do not have, coloured as selling.
  if (n === null || n === undefined || n === 0 || !Number.isFinite(n)) {
    return 'text-[var(--color-faint)]';
  }
  return n > 0 ? 'text-[var(--color-bull-cell)]' : 'text-[var(--color-bear)]';
}

/**
 * The week's net buying, in contracts: longs added minus shorts added.
 *
 * This is the number that orders the filing table, because it is the one
 * question the weekly release answers — did large speculators BUY this contract
 * or sell it. Buying shows up either way round: adding longs and covering shorts
 * are both accumulation, and subtracting the short change captures both.
 *
 * Reads the connector's own `specNetChange` rather than re-deriving it, so the
 * table and the flow reading can never disagree about the same subtraction.
 */
function netFlow(row: CotRowView): number | null {
  return row.latest.specNetChange;
}

/** Buying blue, selling red — matching the delta columns beside it. */
function flowClass(flow: CotFlow): string {
  if (flow.direction === 'flat') return 'text-[var(--color-faint)]';
  return flow.direction === 'buying' ? 'text-[var(--color-bull-cell)]' : 'text-[var(--color-bear)]';
}

/**
 * The three biggest movers, as sentences.
 *
 * A weekly filing has a headline, and it is never "here are twenty rows". These
 * are the contracts that moved most relative to their OWN history, which is the
 * only ranking under which the kiwi can outrank gold.
 */
function WeeksStory({ rows }: { rows: CotRowView[] }) {
  const top = rows
    .map((r) => r.flow)
    .filter((f): f is CotFlow => f !== null && f.kind !== 'flat')
    .sort((a, b) => b.percentile - a.percentile || Math.abs(b.netChange) - Math.abs(a.netChange))
    .slice(0, 3);

  if (top.length === 0) return null;

  return (
    <Panel title="This week's story" subtitle="Biggest moves relative to each contract's own history">
      <div className="grid grid-cols-1 lg:grid-cols-3">
        {top.map((flow) => (
          <div
            key={flow.contract}
            className="border-b border-[var(--color-border)] px-4 py-3 last:border-b-0 lg:border-r lg:border-b-0 lg:last:border-r-0"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-small font-semibold">{cotTicker(flow.contract)}</span>
              <span className={`text-caption font-semibold ${flowClass(flow)}`}>{flow.headline}</span>
              <span className={`tnum ml-auto text-caption ${flowClass(flow)}`}>{signed(flow.netChange)}</span>
            </div>
            <p className="mt-1.5 text-caption leading-relaxed text-[var(--color-muted)]">{flow.sentence}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/**
 * Stacked long/short bars, sorted by long share.
 *
 * Percentages rather than absolute contracts, because contract sizes are not
 * comparable — gold trades hundreds of thousands while the franc trades tens of
 * thousands, and an absolute-scale chart would show only the biggest markets.
 *
 * EQUAL width rather than label-driven width, so "NIKKEI STOCK AVERAGE YEN
 * DENOM" does not grow its own column five times wider than GOLD's. `minWidth`
 * keeps them legible on a narrow viewport, where the container scrolls instead
 * of crushing them.
 */
function PositioningBars({ rows }: { rows: CotRowView[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.latest.specLongPct - b.latest.specLongPct),
    [rows],
  );

  const MIN_BAR_WIDTH = 40;

  return (
    <div className="px-4 py-4">
      <Legend
        items={[
          { label: 'Long', color: 'var(--color-bull-cell)' },
          { label: 'Short', color: 'var(--color-bear-cell)' },
        ]}
      />
      <div className="mt-3 overflow-x-auto">
        <div className="flex items-end gap-2" style={{ height: 220 }}>
          {sorted.map((row) => {
            const longPct = row.latest.specLongPct;
            const ticker = cotTicker(row.contract);
            return (
              <div
                key={row.contract}
                role="img"
                aria-label={`${ticker}: ${longPct.toFixed(1)}% long, ${(100 - longPct).toFixed(1)}% short`}
                className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-1"
                style={{ minWidth: MIN_BAR_WIDTH }}
              >
                <div className="flex h-[180px] w-full flex-col overflow-hidden rounded-sm">
                  <div className="w-full" style={{ height: `${100 - longPct}%`, backgroundColor: 'var(--color-bear-cell)' }} />
                  <div className="w-full" style={{ height: `${longPct}%`, backgroundColor: 'var(--color-bull-cell)' }} />
                </div>
                <span className="w-full truncate text-center font-mono text-micro font-medium text-[var(--color-muted)]">
                  {ticker}
                </span>
                <span className="tnum text-micro text-[var(--color-faint)]">{longPct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-caption text-[var(--color-faint)]">
        Large speculators only, sorted least to most long. The table below has each week&rsquo;s change.
      </p>
    </div>
  );
}

const COLUMNS: Column<CotRowView>[] = [
  {
    key: 'contract',
    label: 'Symbol',
    align: 'left',
    sticky: true,
    hideOnCards: true,
    sortValue: (r) => cotTicker(r.contract),
    defaultDir: 'asc',
    render: (r) => <span className="font-mono font-semibold">{cotTicker(r.contract)}</span>,
  },
  { key: 'long', label: 'Long', sortValue: (r) => r.latest.specLong, render: (r) => fmt(r.latest.specLong), hideOnCards: true },
  { key: 'short', label: 'Short', sortValue: (r) => r.latest.specShort, render: (r) => fmt(r.latest.specShort), hideOnCards: true },
  {
    key: 'dlong',
    label: 'Δ Long',
    explain:
      'Contracts of longs added this week. Net rising on fresh longs is a different market from net rising on short covering.',
    sortValue: (r) => r.latest.specLongChange,
    render: (r) => <span className={deltaClass(r.latest.specLongChange)}>{signed(r.latest.specLongChange)}</span>,
  },
  {
    key: 'dshort',
    label: 'Δ Short',
    sortValue: (r) => r.latest.specShortChange,
    render: (r) => <span className={deltaClass(r.latest.specShortChange)}>{signed(r.latest.specShortChange)}</span>,
  },
  {
    key: 'flow',
    label: 'Δ Net',
    explain:
      'Longs added minus shorts added. Both are accumulation, so a contract can be bought hard without a single new long. The default order.',
    sortValue: netFlow,
    render: (r) => <span className={`font-semibold ${deltaClass(netFlow(r))}`}>{signed(netFlow(r))}</span>,
    hideOnCards: true,
  },
  {
    key: 'reading',
    label: 'Flow',
    align: 'left',
    render: (r) =>
      r.flow ? (
        <span className={`font-medium ${flowClass(r.flow)}`}>
          {r.flow.headline}
          {r.flow.againstPosition && (
            <span className="ml-1 text-[var(--color-uncertain)]" aria-label="against their own position">
              ↩
            </span>
          )}
        </span>
      ) : (
        <span className="text-[var(--color-faint)]">—</span>
      ),
  },
  {
    key: 'longpct',
    label: 'Long %',
    sortValue: (r) => r.latest.specLongPct,
    render: (r) => <span className="text-[var(--color-bull-cell)]">{r.latest.specLongPct.toFixed(1)}%</span>,
  },
  {
    key: 'wkchange',
    label: 'Δ Long %',
    explain: 'Weekly change in the long share — the measure the COT column on the board scores.',
    sortValue: (r) => r.latest.specLongPctChange,
    render: (r) => {
      const v = r.latest.specLongPctChange;
      return <span className={deltaClass(v)}>{v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`}</span>;
    },
  },
  {
    key: 'net',
    label: 'Net',
    sortValue: (r) => r.latest.specNet,
    render: (r) => (
      <span className={`font-semibold ${r.latest.specNet >= 0 ? 'text-[var(--color-bull-cell)]' : 'text-[var(--color-bear)]'}`}>
        {signed(r.latest.specNet)}
      </span>
    ),
  },
  {
    key: 'pctile',
    label: 'Pctile',
    explain: "Where the net position sits in this contract's own 3-year range. Absolute size is not comparable across contracts.",
    sortValue: (r) => r.cotPercentile,
    render: (r) => <span className="text-[var(--color-muted)]">{r.cotPercentile === null ? '—' : r.cotPercentile}</span>,
  },
  {
    key: 'retail',
    label: 'Retail %',
    explain: 'Small traders’ long share. Amber where they sit opposite the speculators.',
    sortValue: (r) => r.retailLongPct,
    render: (r) => (
      <span className={r.divergence ? 'text-[var(--color-uncertain)]' : ''}>
        {r.retailLongPct === null ? '—' : `${r.retailLongPct.toFixed(1)}%`}
      </span>
    ),
  },
  {
    key: 'oi',
    label: 'Open int.',
    sortValue: (r) => r.latest.openInterest,
    hideOnCards: true,
    render: (r) => (
      <span className="text-[var(--color-faint)]">{r.latest.openInterest === null ? '—' : fmt(r.latest.openInterest)}</span>
    ),
  },
];

export function CotPanel({ rows }: { rows: CotRowView[] }) {
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
      <WeeksStory rows={rows} />

      <Panel title="Net positioning" subtitle="Long vs short share of large speculator positions">
        <PositioningBars rows={rows} />
      </Panel>

      {divergences.length > 0 && (
        <Panel title="Retail vs smart money" subtitle="Contracts where small traders are positioned opposite large speculators">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {divergences.map((row) => (
              <div key={row.contract} className="border-b border-[var(--color-border)] px-4 py-3 sm:border-r">
                <div className="font-mono text-small font-semibold">{cotTicker(row.contract)}</div>
                <div className="mt-1.5 flex items-baseline gap-3 text-caption">
                  <span>
                    <span className="text-[var(--color-faint)]">retail </span>
                    <span className="tnum font-semibold">{row.retailLongPct}% long</span>
                  </span>
                  <span>
                    <span className="text-[var(--color-faint)]">specs </span>
                    <span
                      className={`tnum font-semibold ${row.latest.specNet > 0 ? 'text-[var(--color-bull-cell)]' : 'text-[var(--color-bear)]'}`}
                    >
                      {row.latest.specNet > 0 ? 'net long' : 'net short'}
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-caption text-[var(--color-faint)]">
                  Crowd read contrarian:{' '}
                  {row.crowdCell !== null && row.crowdCell > 0
                    ? 'bullish'
                    : row.crowdCell !== null && row.crowdCell < 0
                      ? 'bearish'
                      : 'neutral'}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Latest weekly filing" subtitle="Biggest weekly buyer first. Tap a row for the full reading.">
        <DataTable
          caption="Latest COT filing"
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.contract}
          defaultSort={{ key: 'flow', dir: 'desc' }}
          maxHeight="calc(100dvh - 12rem)"
          cardTitle={(r) => <span className="font-mono">{cotTicker(r.contract)}</span>}
          cardAside={(r) => (
            <span className={`tnum text-small font-semibold ${deltaClass(netFlow(r))}`}>{signed(netFlow(r))}</span>
          )}
          /*
            Where buying turns into selling, so the two halves are visible at a
            glance. Only in flow order, largest first — in any other order the
            line would mark nothing.
          */
          divider={(row, prev, sort) =>
            sort?.key === 'flow' && sort.dir === 'desc' && prev && (netFlow(prev) ?? 0) >= 0 && (netFlow(row) ?? 0) < 0
              ? '↓ net sellers this week'
              : null
          }
          expand={(r) =>
            r.flow ? (
              <>
                <p className="leading-relaxed">{r.flow.sentence}</p>
                <p className="mt-1 text-caption text-[var(--color-faint)]">
                  {r.flow.percentile.toFixed(0)}th percentile of this contract&rsquo;s last {r.flow.sampleWeeks} weekly
                  changes{r.flow.oiConfirms && ' · open interest agrees'}
                </p>
              </>
            ) : null
          }
        />
        <p className="border-t border-[var(--color-border)] px-4 py-3 text-caption leading-relaxed text-[var(--color-faint)]">
          Source: CFTC Commitments of Traders, large speculators (non-commercial) and small traders (non-reportable).
        </p>
      </Panel>
    </div>
  );
}
