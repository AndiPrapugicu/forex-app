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

import { Fragment, useMemo, useState } from 'react';
import { cotTicker } from '@/config/symbols.config';
import type { CotFlow } from '@/lib/scoring/cot-flow';
import type { CotRowView } from '@/lib/scoring/cot-rows';
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
  return n > 0 ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]';
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
  return flow.direction === 'buying' ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]';
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
              <span className="font-mono text-xs font-semibold">{cotTicker(flow.contract)}</span>
              <span className={`text-[11px] font-semibold ${flowClass(flow)}`}>{flow.headline}</span>
              <span className={`tnum ml-auto text-[11px] ${flowClass(flow)}`}>
                {signed(flow.netChange)}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
              {flow.sentence}
            </p>
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
 * EQUAL width rather than label-driven width. With plain flex the label sets the
 * floor, so "NIKKEI STOCK AVERAGE YEN DENOM" grew its own column five times
 * wider than GOLD's and the chart read as though it mattered five times more.
 * Short tickers plus `flex-1 basis-0` make every contract exactly as wide as
 * every other AND spread them across the full panel, so the row no longer stops
 * short of the right edge. `minWidth` keeps them legible on a narrow viewport,
 * where the container scrolls instead of crushing them.
 */
function PositioningBars({ rows }: { rows: CotRowView[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.latest.specLongPct - b.latest.specLongPct),
    [rows],
  );

  const MIN_BAR_WIDTH = 40;

  return (
    <div className="overflow-x-auto px-4 py-4">
      <div className="flex items-end gap-2" style={{ height: 220 }}>
        {sorted.map((row) => {
          const longPct = row.latest.specLongPct;
          const ticker = cotTicker(row.contract);
          return (
            <div
              key={row.contract}
              className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-1"
              style={{ minWidth: MIN_BAR_WIDTH }}
              title={
                `${row.contract}\n${fmt(row.latest.specLong)} long / ${fmt(row.latest.specShort)} short ` +
                `(${longPct.toFixed(1)}% long)\n` +
                `week: long ${signed(row.latest.specLongChange)}, short ${signed(row.latest.specShortChange)}`
              }
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
              <span className="w-full truncate text-center font-mono text-[9px] font-medium text-[var(--color-muted)]">
                {ticker}
              </span>
              <span className="tnum text-[9px] text-[var(--color-faint)]">{longPct.toFixed(0)}%</span>
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
        <span>Large speculators only. Sorted least to most long. Hover for the week&rsquo;s change.</span>
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
  /**
   * Default to the week's flow: bought most at the top, sold most at the bottom.
   *
   * The table's job is to answer "what did the big money do this week", and that
   * reads top-to-bottom only if the ordering IS the answer. Net position sorts
   * by an accumulated stock instead, which barely moves week to week.
   */
  const [sortKey, setSortKey] = useState<'flow' | 'net' | 'change' | 'contract'>('flow');
  /** Which row's full reading is showing. One at a time — this is a dense table. */
  const [open, setOpen] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sortKey === 'contract') return copy.sort((a, b) => cotTicker(a.contract).localeCompare(cotTicker(b.contract)));
    if (sortKey === 'change') {
      // By the LONG-SHARE change, since that is the measure the COT cell scores.
      return copy.sort((a, b) => (b.latest.specLongPctChange ?? 0) - (a.latest.specLongPctChange ?? 0));
    }
    if (sortKey === 'net') return copy.sort((a, b) => b.latest.specNet - a.latest.specNet);
    // Contracts with no prior week to difference sink to the bottom rather than
    // sorting as though nothing happened.
    return copy.sort((a, b) => (netFlow(b) ?? -Infinity) - (netFlow(a) ?? -Infinity));
  }, [rows, sortKey]);

  /**
   * Where buying turns into selling, so the two halves are visible at a glance
   * instead of having to read every sign. Only meaningful in flow order.
   */
  const sellingStartsAt =
    sortKey === 'flow' ? sorted.findIndex((r) => (netFlow(r) ?? 0) < 0) : -1;

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

      <WeeksStory rows={rows} />

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
                <div className="font-mono text-xs font-semibold">{cotTicker(row.contract)}</div>
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
            <option value="flow">Bought most → sold most this week</option>
            <option value="net">Sort by net position</option>
            <option value="change">Sort by weekly long-share change</option>
            <option value="contract">Sort by symbol</option>
          </select>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-right text-[11px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[9px] tracking-wider text-[var(--color-faint)] uppercase">
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-2 py-2">Long</th>
                <th className="px-2 py-2">Short</th>
                {/* The two columns that say WHICH side moved this week. */}
                <th className="px-2 py-2">Δ Long</th>
                <th className="px-2 py-2">Δ Short</th>
                {/* The sort key, shown so the ordering is legible rather than implied. */}
                <th className="px-2 py-2 text-[var(--color-muted)]">Δ Net</th>
                <th className="px-2 py-2 text-left">Flow</th>
                <th className="px-2 py-2">Long %</th>
                <th className="px-2 py-2">Short %</th>
                <th className="px-2 py-2">Net</th>
                <th className="px-2 py-2">Pctile</th>
                <th className="px-2 py-2">Retail %</th>
                <th className="px-2 py-2">Open int.</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <Fragment key={row.contract}>
                  {i === sellingStartsAt && (
                    <tr>
                      <td
                        colSpan={12}
                        className="border-y border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-1 text-left text-[9px] tracking-wider text-[var(--color-faint)] uppercase"
                      >
                        ↓ net sellers this week
                      </td>
                    </tr>
                  )}
                <tr
                  className="cursor-pointer border-b border-[var(--color-border)]/60 hover:bg-[var(--color-surface-2)]/50"
                  onClick={() => setOpen(open === row.contract ? null : row.contract)}
                >
                  <td className="px-3 py-1.5 text-left font-mono text-[11px] font-medium whitespace-nowrap">
                    {cotTicker(row.contract)}
                  </td>
                  <td className="tnum px-2 py-1.5">{fmt(row.latest.specLong)}</td>
                  <td className="tnum px-2 py-1.5">{fmt(row.latest.specShort)}</td>

                  {/*
                    Δ Long and Δ Short, not just the net. Net rising because
                    longs piled in is a different market from net rising because
                    shorts covered, and the single net column hid which it was.
                  */}
                  <td className={`tnum px-2 py-1.5 ${deltaClass(row.latest.specLongChange)}`}>
                    {signed(row.latest.specLongChange)}
                  </td>
                  <td className={`tnum px-2 py-1.5 ${deltaClass(row.latest.specShortChange)}`}>
                    {signed(row.latest.specShortChange)}
                  </td>

                  {/*
                    Longs added minus shorts added. Semibold because it is what
                    the default ordering is built on.
                  */}
                  <td className={`tnum px-2 py-1.5 font-semibold ${deltaClass(netFlow(row))}`}>
                    {signed(netFlow(row))}
                  </td>

                  {/*
                    What the two delta columns MEAN. Same numbers, read out: a
                    contract can be bought hard without a single new long, and
                    the net figure alone cannot tell you which happened.
                  */}
                  <td className="px-2 py-1.5 text-left whitespace-nowrap">
                    {row.flow ? (
                      <span className={`text-[10px] font-medium ${flowClass(row.flow)}`}>
                        {row.flow.headline}
                        {row.flow.againstPosition && (
                          <span
                            className="ml-1 text-[var(--color-uncertain)]"
                            title="Moving against their own book — reducing a position, not adding to one"
                          >
                            ↩
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[10px] text-[var(--color-faint)]">—</span>
                    )}
                  </td>

                  <td className="tnum px-2 py-1.5 text-[var(--color-bull-cell)]">{row.latest.specLongPct.toFixed(1)}%</td>
                  <td className="tnum px-2 py-1.5 text-[var(--color-bear)]">
                    {(100 - row.latest.specLongPct).toFixed(1)}%
                  </td>

                  <td
                    className={`tnum px-2 py-1.5 font-semibold ${row.latest.specNet >= 0 ? 'text-[var(--color-bull-cell)]' : 'text-[var(--color-bear)]'}`}
                  >
                    {signed(row.latest.specNet)}
                  </td>
                  <td className="tnum px-2 py-1.5 text-[var(--color-muted)]">
                    {row.cotPercentile === null ? '—' : `${row.cotPercentile}`}
                  </td>
                  <td className={`tnum px-2 py-1.5 ${row.divergence ? 'text-[var(--color-uncertain)]' : ''}`}>
                    {row.retailLongPct === null ? '—' : `${row.retailLongPct.toFixed(1)}%`}
                  </td>
                  <td className="tnum px-2 py-1.5 text-[var(--color-faint)]">
                    {row.latest.openInterest === null ? '—' : fmt(row.latest.openInterest)}
                  </td>
                </tr>
                {open === row.contract && row.flow && (
                  <tr className="border-b border-[var(--color-border)]/60 bg-[var(--color-surface-2)]/40">
                    <td colSpan={12} className="px-3 py-2 text-left">
                      <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
                        {row.flow.sentence}
                      </p>
                      <p className="mt-1 text-[10px] text-[var(--color-faint)]">
                        {row.flow.percentile.toFixed(0)}th percentile of this contract&rsquo;s last{' '}
                        {row.flow.sampleWeeks} weekly changes
                        {row.flow.oiConfirms && ' · open interest agrees'}
                      </p>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--color-border)] px-3 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
          Click any row for the full reading. Rows run biggest weekly buyer to biggest seller. Δ Net is longs added minus shorts added —
          both are accumulation, so a contract can be bought hard without a single new long. Δ Long and
          Δ Short break that out, because net rising on fresh longs is a different market from net
          rising on short covering. &ldquo;Pctile&rdquo; is where
          the current net position sits within that contract&rsquo;s own 3-year range; absolute size is
          not comparable across contracts. Retail % is highlighted where small traders sit opposite the
          speculators. Source: CFTC Commitments of Traders.
        </p>
      </Panel>
    </div>
  );
}
