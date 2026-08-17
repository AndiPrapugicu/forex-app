'use client';

/**
 * The Top Setups matrix.
 *
 * Dense by design — the whole point is seeing 33 symbols against 18 indicators
 * at once. Choices that make that legible:
 *
 *  - Symbol and score columns are sticky, so a row stays identifiable while
 *    scrolling horizontally through the indicator columns.
 *  - Cell colour encodes sign, opacity encodes magnitude. A +2 and a +1 must be
 *    distinguishable at a glance without reading the digit.
 *  - Stale cells are visually distinct from zero cells. "We do not have current
 *    data" and "the data says neutral" are different statements and must not
 *    look the same.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SCORING_SLOTS, SLOTS, SLOT_CATEGORIES, type SlotCategory } from '@/config/setups.config';
import type { MatrixCell, SymbolRow } from '@/lib/scoring/setups';

const BIAS_STYLE: Record<string, string> = {
  'Very Bullish': 'text-[var(--color-bull)] font-semibold',
  Bullish: 'text-[var(--color-bull)]',
  Neutral: 'text-[var(--color-muted)]',
  Bearish: 'text-[var(--color-bear)]',
  'Very Bearish': 'text-[var(--color-bear)] font-semibold',
};

/**
 * Cell background.
 *
 * Blue for positive rather than green: the bull/bear green means "this is the
 * verdict" on the score and bias columns, and a grid of 13 green cells competes
 * with the one number the row is actually about. The hue difference is a
 * hierarchy cue, not a claim that the scales differ — since the scorecard was
 * unified there is only one scale in the app.
 */
/**
 * A cell reads as its number or it reads as blank. There is no third state.
 *
 * `partial` — one leg expected and missing — used to draw an amber ring here.
 * It is real information, but a grid this dense can only carry so many states
 * before none of them are read, and a cell that VOTES like a normal cell should
 * LOOK like one. The distinction survives where it costs nothing: in the
 * per-cell tooltip, and in the `+N◐` marker beside each row's coverage count.
 */
function cellStyle(cell: MatrixCell): { className: string; style?: React.CSSProperties; text: string } {
  if (cell.status === 'stale') {
    return {
      className: 'bg-[var(--color-surface-2)]/40 text-[var(--color-faint)] italic',
      text: '·',
    };
  }
  if (cell.cell === null) {
    return { className: 'bg-transparent text-[var(--color-faint)]', text: '' };
  }

  const v = cell.cell;
  if (v === 0) {
    return { className: 'bg-[var(--color-surface-2)]/70 text-[var(--color-muted)]', text: '0' };
  }

  const positive = v > 0;
  const magnitude = Math.abs(v);
  // Trend reaches 3, so this is a three-step ramp rather than the old binary.
  const intensity = magnitude >= 3 ? 0.72 : magnitude === 2 ? 0.55 : 0.28;
  const rgb = positive
    ? 'var(--color-bull-cell-rgb)'
    : 'var(--color-bear-cell-rgb)';

  return {
    className: 'font-semibold',
    style: {
      backgroundColor: `rgb(${rgb} / ${intensity * 100}%)`,
      color: magnitude >= 2 ? '#fff' : `rgb(${rgb})`,
    },
    text: `${positive ? '' : '-'}${magnitude}`,
  };
}

type SortKey = 'score' | 'symbol';

/**
 * Column presets, mirroring the variants A1 offers.
 *
 *   full    every column, scoring and context
 *   simple  no indicator columns at all — just the total and the block subtotals
 *   macro   economic columns only, which is how you read "what does the data say"
 *           without the technical and positioning noise
 */
type ViewKey = 'full' | 'simple' | 'macro';

const VIEWS: { key: ViewKey; label: string; hint: string }[] = [
  { key: 'full', label: 'Full', hint: 'Every column' },
  { key: 'simple', label: 'Simple', hint: 'Totals and block subtotals only' },
  { key: 'macro', label: 'Macro', hint: 'Economic columns only' },
];

/** Every indicator column is this wide, so the grid reads as a grid. */
const INDICATOR_COL_WIDTH = 52;

/**
 * Explicit widths for the three sticky columns, and the left offsets derived
 * from them.
 *
 * These MUST be declared rather than left to the content. The offsets were
 * previously hardcoded against widths the browser chose, so changing the row
 * padding shifted the columns and the sticky Bias cell began covering the first
 * indicator column — Trend was clipped to "end" at scroll position zero.
 * Deriving the offsets from the widths makes that impossible.
 */
const STICKY = {
  symbol: 74,
  score: 42,
  bias: 112,
} as const;
const STICKY_LEFT = {
  symbol: 0,
  score: STICKY.symbol,
  bias: STICKY.symbol + STICKY.score,
} as const;

export function SetupsMatrix({
  rows,
  cotReportDate,
}: {
  rows: SymbolRow[];
  cotReportDate: string | null;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SlotCategory | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('score');
  const [hideNeutral, setHideNeutral] = useState(false);
  const [view, setView] = useState<ViewKey>('full');

  /**
   * View and category compose: Macro-Only narrowed to Inflation shows the
   * inflation economics and nothing else. `full` is the only view that shows
   * context columns — the whole point of Simple and Macro is fewer columns, and
   * a non-scoring column is the first thing to drop.
   */
  const visibleSlots = useMemo(() => {
    const byView =
      view === 'macro'
        ? SLOTS.filter((s) => s.scoring && s.kind !== 'technical' && s.kind !== 'sentiment')
        : view === 'simple'
          ? []
          : SLOTS;

    return category === 'all' ? byView : byView.filter((s) => s.category === category);
  }, [view, category]);

  const visibleCategories = useMemo(
    () =>
      SLOT_CATEGORIES.filter(
        (c) =>
          (category === 'all' || c.key === category) &&
          visibleSlots.some((s) => s.category === c.key),
      ),
    [category, visibleSlots],
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (query.trim()) {
      const q = query.trim().toUpperCase();
      out = out.filter((r) => r.symbol.includes(q) || r.label.toUpperCase().includes(q));
    }
    if (hideNeutral) out = out.filter((r) => r.bias !== 'Neutral');
    if (sort === 'symbol') out = [...out].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return out;
  }, [rows, query, hideNeutral, sort]);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* --- Controls -------------------------------------------------- */}
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
        <h2 className="text-[13px] font-semibold tracking-wide uppercase">Top Setups</h2>

        <div className="mr-auto flex rounded border border-[var(--color-border)] p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              title={v.hint}
              onClick={() => setView(v.key)}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                view === v.key
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search symbol"
          className="w-32 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-bull)]"
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as SlotCategory | 'all')}
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none"
        >
          <option value="all">All categories</option>
          {SLOT_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none"
        >
          <option value="score">Sort by score</option>
          <option value="symbol">Sort by symbol</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={hideNeutral}
            onChange={(e) => setHideNeutral(e.target.checked)}
            className="accent-[var(--color-bull)]"
          />
          Exclude neutral
        </label>
      </header>

      {/* --- Matrix ------------------------------------------------------ */}
      <div className="max-h-[calc(100vh-13rem)] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-center text-[11px]">
          <thead className="sticky top-0 z-30 bg-[var(--color-surface)]">
            {/* Category band */}
            <tr>
              <th
                style={{ left: 0, minWidth: STICKY.symbol + STICKY.score + STICKY.bias }}
                className="sticky z-20 bg-[var(--color-surface)]"
                colSpan={3}
              />
              {visibleCategories.map((cat) => {
                const span = visibleSlots.filter((s) => s.category === cat.key).length;
                if (span === 0) return null;
                return (
                  <th
                    key={cat.key}
                    colSpan={span}
                    className="border-b border-l border-[var(--color-border)] px-2 py-1 text-[9px] font-semibold tracking-wider text-[var(--color-faint)] uppercase"
                  >
                    {cat.label}
                  </th>
                );
              })}
            </tr>
            {/* Column headers */}
            <tr>
              <th
                style={{ left: STICKY_LEFT.symbol, width: STICKY.symbol, minWidth: STICKY.symbol }}
                className="sticky z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-left text-[10px] font-semibold text-[var(--color-faint)]"
              >
                Symbol
              </th>
              <th
                style={{ left: STICKY_LEFT.score, width: STICKY.score, minWidth: STICKY.score }}
                className="sticky z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1.5 text-[10px] font-semibold text-[var(--color-faint)]"
              >
                Score
              </th>
              <th
                style={{ left: STICKY_LEFT.bias, width: STICKY.bias, minWidth: STICKY.bias }}
                className="sticky z-20 border-r border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-left text-[10px] font-semibold text-[var(--color-faint)]"
              >
                Bias
              </th>
              {visibleSlots.map((slot) => (
                <th
                  key={slot.key}
                  title={
                    slot.scoring
                      ? slot.title
                      : `${slot.title} — context only, not counted in the score`
                  }
                  /* Fixed width on every indicator column. Without this the
                     header text sizes each one and the grid comes out ragged —
                     "Crowd Sentiment" was three times the width of "COT". */
                  style={{ width: INDICATOR_COL_WIDTH, minWidth: INDICATOR_COL_WIDTH }}
                  className={`border-b border-[var(--color-border)] px-0.5 py-1.5 text-center text-[9px] leading-tight font-medium text-[var(--color-faint)] ${
                    // A context column has to be tellable from a scoring one at a
                    // glance, or the row's total looks like it does not add up.
                    slot.scoring ? '' : 'italic opacity-60'
                  }`}
                >
                  {slot.label}
                  {!slot.scoring && <span className="align-super text-[7px]">°</span>}
                </th>
              ))}

              {/* Simple view swaps 19 indicator columns for 5 block subtotals. */}
              {view === 'simple' &&
                SLOT_CATEGORIES.map((cat) => (
                  <th
                    key={cat.key}
                    title={cat.label}
                    style={{ minWidth: 78 }}
                    className="border-b border-[var(--color-border)] px-2 py-1.5 text-center text-[9px] leading-tight font-medium text-[var(--color-faint)]"
                  >
                    {cat.label.split(' ')[0]}
                  </th>
                ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((row) => (
              <tr key={row.symbol} className="group">
                <td
                  style={{ left: STICKY_LEFT.symbol, width: STICKY.symbol, minWidth: STICKY.symbol }}
                  className="sticky z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-left group-hover:bg-[var(--color-surface-2)]"
                >
                  <Link
                    href={`/scorecard/${row.symbol}`}
                    className="font-mono text-[11px] font-medium text-[var(--color-text)] hover:text-[var(--color-bull)] hover:underline"
                  >
                    {row.symbol}
                  </Link>
                </td>

                <td
                  style={{ left: STICKY_LEFT.score, width: STICKY.score, minWidth: STICKY.score }}
                  className="tnum sticky z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5 font-bold group-hover:bg-[var(--color-surface-2)]"
                >
                  <span className={BIAS_STYLE[row.bias]}>
                    {row.totalScore > 0 ? '+' : ''}
                    {row.totalScore}
                  </span>
                </td>

                <td
                  style={{ left: STICKY_LEFT.bias, width: STICKY.bias, minWidth: STICKY.bias }}
                  className="sticky z-10 border-r border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-left whitespace-nowrap group-hover:bg-[var(--color-surface-2)]"
                >
                  <span className={`text-[10px] ${BIAS_STYLE[row.bias]}`}>{row.bias}</span>
                  {/* Populated count keeps a thin row from reading as confident. */}
                  <span
                    className="ml-1.5 text-[9px] text-[var(--color-faint)]"
                    title={`${row.populated} of ${SCORING_SLOTS.length} scored indicators resolved completely`}
                  >
                    {row.populated}
                  </span>
                  {/*
                    Partial cells are called out beside the coverage count rather
                    than folded into it: a row reading "16 +2◐" is saying two of
                    its numbers came from one leg, which is a different kind of
                    thinness from simply having fewer columns.
                  */}
                  {row.partial > 0 && (
                    <span
                      className="ml-1 text-[9px] text-[var(--color-uncertain)]"
                      title={`${row.partial} cell(s) built from one leg because the other was expected and did not arrive`}
                    >
                      +{row.partial}◐
                    </span>
                  )}
                </td>

                {visibleSlots.map((slot) => {
                  const cell = row.cells[slot.key];
                  const s = cellStyle(cell);
                  return (
                    <td
                      key={slot.key}
                      title={`${slot.label}: ${cell.explanation}`}
                      className={`tnum border-b border-[var(--color-border)] px-0.5 py-0.5 text-center ${s.className}`}
                      style={{ ...s.style, width: INDICATOR_COL_WIDTH, minWidth: INDICATOR_COL_WIDTH }}
                    >
                      {s.text}
                    </td>
                  );
                })}

                {view === 'simple' &&
                  SLOT_CATEGORIES.map((cat) => {
                    const value = row.categoryScores[cat.key];
                    return (
                      <td
                        key={cat.key}
                        style={{ minWidth: 78 }}
                        className={`tnum border-b border-[var(--color-border)] px-2 py-0.5 text-center font-semibold ${
                          value > 0
                            ? 'text-[var(--color-bull-cell)]'
                            : value < 0
                              ? 'text-[var(--color-bear)]'
                              : 'text-[var(--color-muted)]'
                        }`}
                      >
                        {value > 0 ? '+' : ''}
                        {value}
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="px-4 py-8 text-center text-xs text-[var(--color-muted)]">
          No symbols match the current filters.
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-faint)]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded-sm" style={{ backgroundColor: 'rgba(58,122,224,0.55)' }} />
          bullish
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded-sm" style={{ backgroundColor: 'rgba(242,80,110,0.55)' }} />
          bearish
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded-sm bg-[var(--color-surface-2)]/40" />
          stale — outside its freshness window, not scored
        </span>
        <span>blank = not published for that currency</span>
        {/* Only meaningful while some column is carried but not scored. */}
        {SLOTS.length > SCORING_SLOTS.length && (
          <span className="italic opacity-60">
            ° {SLOTS.length - SCORING_SLOTS.length} context columns — shown, never counted
          </span>
        )}
        <span className="ml-auto">
          The number after the bias is how many of {SCORING_SLOTS.length} scored indicators had data.
          {cotReportDate && ` COT as of ${cotReportDate}.`}
        </span>
      </footer>
    </div>
  );
}
