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
import { SLOTS, SLOT_CATEGORIES, type SlotCategory } from '@/config/setups.config';
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
 * Blue for positive rather than green: the bull/bear green already means
 * "direction" elsewhere in the app, and reusing it here would imply these cells
 * are directly comparable with the -10..+10 scores. They are a different scale.
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
  const intensity = Math.abs(v) === 2 ? 0.55 : 0.28;
  const rgb = positive ? '58, 122, 224' : '242, 80, 110';

  return {
    className: 'font-semibold',
    style: {
      backgroundColor: `rgba(${rgb}, ${intensity})`,
      color: Math.abs(v) === 2 ? '#fff' : `rgb(${rgb})`,
    },
    text: `${positive ? '' : '-'}${Math.abs(v)}`,
  };
}

type SortKey = 'score' | 'symbol';

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

  const visibleSlots = useMemo(
    () => (category === 'all' ? SLOTS : SLOTS.filter((s) => s.category === category)),
    [category],
  );

  const visibleCategories = useMemo(
    () => SLOT_CATEGORIES.filter((c) => category === 'all' || c.key === category),
    [category],
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
        <h2 className="mr-auto text-[13px] font-semibold tracking-wide uppercase">Top Setups</h2>

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
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-center text-[11px]">
          <thead>
            {/* Category band */}
            <tr>
              <th className="sticky left-0 z-20 bg-[var(--color-surface)]" colSpan={3} />
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
              <th className="sticky left-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-left text-[10px] font-semibold text-[var(--color-faint)]">
                Symbol
              </th>
              <th className="sticky left-[76px] z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1.5 text-[10px] font-semibold text-[var(--color-faint)]">
                Score
              </th>
              <th className="sticky left-[118px] z-20 border-r border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-left text-[10px] font-semibold text-[var(--color-faint)]">
                Bias
              </th>
              {visibleSlots.map((slot) => (
                <th
                  key={slot.key}
                  title={slot.title}
                  className="border-b border-[var(--color-border)] px-1 py-1.5 text-[9px] font-medium whitespace-nowrap text-[var(--color-faint)]"
                >
                  {slot.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((row) => (
              <tr key={row.symbol} className="group">
                <td className="sticky left-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-left group-hover:bg-[var(--color-surface-2)]">
                  <Link
                    href={`/scorecard/${row.symbol}`}
                    className="font-mono text-[11px] font-medium text-[var(--color-text)] hover:text-[var(--color-bull)] hover:underline"
                  >
                    {row.symbol}
                  </Link>
                </td>

                <td className="tnum sticky left-[76px] z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 font-bold group-hover:bg-[var(--color-surface-2)]">
                  <span className={BIAS_STYLE[row.bias]}>
                    {row.totalScore > 0 ? '+' : ''}
                    {row.totalScore}
                  </span>
                </td>

                <td className="sticky left-[118px] z-10 border-r border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-left whitespace-nowrap group-hover:bg-[var(--color-surface-2)]">
                  <span className={`text-[10px] ${BIAS_STYLE[row.bias]}`}>{row.bias}</span>
                  {/* Populated count keeps a thin row from reading as confident. */}
                  <span className="ml-1.5 text-[9px] text-[var(--color-faint)]">{row.populated}</span>
                </td>

                {visibleSlots.map((slot) => {
                  const cell = row.cells[slot.key];
                  const s = cellStyle(cell);
                  return (
                    <td
                      key={slot.key}
                      title={`${slot.label}: ${cell.explanation}`}
                      className={`tnum border-b border-[var(--color-border)] px-1 py-1 ${s.className}`}
                      style={s.style}
                    >
                      {s.text}
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
        <span className="ml-auto">
          The number after the bias is how many of {SLOTS.length} indicators had data.
          {cotReportDate && ` COT as of ${cotReportDate}.`}
        </span>
      </footer>
    </div>
  );
}
