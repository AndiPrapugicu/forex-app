'use client';

/**
 * The Top Setups board as cards, for a phone.
 *
 * The grid needs 1,164px and its three sticky columns alone take most of a
 * 375px screen, so on a phone it showed a symbol, a score and two indicators.
 * A card shows what a phone reader actually needs first — score, bias and the
 * five category subtotals — and a tap opens every indicator with the
 * explanation that the grid could only offer as a hover tooltip, which a touch
 * screen can never open.
 *
 * Presentation only. It reads the same rows the grid reads, including the
 * mirrored copy when the A1 mirror toggle is on.
 */

import Link from 'next/link';
import { useState } from 'react';
import { SCORING_SLOTS, SLOT_CATEGORIES, type SlotDefinition } from '@/config/setups.config';
import type { MatrixCell, SymbolRow } from '@/lib/scoring/setups';

const BIAS_TONE: Record<string, string> = {
  'Very Bullish': 'text-[var(--color-bull)] font-semibold',
  Bullish: 'text-[var(--color-bull)]',
  Neutral: 'text-[var(--color-muted)]',
  Bearish: 'text-[var(--color-bear)]',
  'Very Bearish': 'text-[var(--color-bear)] font-semibold',
};

/** The same sign-and-magnitude ramp the grid uses, so a card and a cell read alike. */
function valueStyle(v: number | null): React.CSSProperties | undefined {
  if (v === null || v === 0) return undefined;
  const magnitude = Math.abs(v);
  const rgb = v > 0 ? 'var(--color-bull-cell-rgb)' : 'var(--color-bear-cell-rgb)';
  const intensity = magnitude >= 3 ? 72 : magnitude === 2 ? 55 : 28;
  return { backgroundColor: `rgb(${rgb} / ${intensity}%)`, color: magnitude >= 2 ? '#fff' : `rgb(${rgb})` };
}

function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${v}`;
}

function ValueBadge({ cell, outlined }: { cell: MatrixCell | undefined; outlined?: boolean }) {
  const v = cell?.cell ?? null;
  return (
    <span
      className={`tnum inline-flex h-7 min-w-9 items-center justify-center rounded-md px-1.5 text-small font-semibold ${
        v === null
          ? 'text-[var(--color-faint)]'
          : v === 0
            ? 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'
            : ''
      } ${outlined ? 'outline outline-1 -outline-offset-1 outline-[var(--color-uncertain)]' : ''}`}
      style={valueStyle(v)}
    >
      {v === null ? '—' : v === 0 ? '0' : signed(v)}
    </span>
  );
}

export function SetupsCards({
  rows,
  slots,
  mirrorCells,
}: {
  rows: SymbolRow[];
  /** The columns the current view and category filter show. Empty in Simple view. */
  slots: SlotDefinition[];
  /** Present while the A1 mirror is on: cells it re-derived get an outline. */
  mirrorCells?: Record<string, Record<string, number | null>>;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) return null;

  return (
    <ul className="flex flex-col divide-y divide-[var(--color-border)]">
      {rows.map((row) => {
        const expanded = open === row.symbol;
        const panelId = `setup-card-${row.symbol}`;
        return (
          <li key={row.symbol}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen(expanded ? null : row.symbol)}
              className="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left active:bg-[var(--color-surface-2)]"
            >
              <span
                className={`tnum w-12 shrink-0 text-center text-title font-bold ${BIAS_TONE[row.bias] ?? ''}`}
              >
                {signed(row.totalScore)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-body font-semibold">{row.symbol}</span>
                  <span className={`text-caption ${BIAS_TONE[row.bias] ?? ''}`}>{row.bias}</span>
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {SLOT_CATEGORIES.map((cat) => {
                    const value = row.categoryScores[cat.key];
                    return (
                      <span
                        key={cat.key}
                        className="tnum rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-micro text-[var(--color-muted)]"
                      >
                        {cat.label.split(' ')[0]}{' '}
                        <span
                          className={
                            value > 0
                              ? 'text-[var(--color-bull-cell)]'
                              : value < 0
                                ? 'text-[var(--color-bear)]'
                                : ''
                          }
                        >
                          {signed(value)}
                        </span>
                      </span>
                    );
                  })}
                </span>
              </span>
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 shrink-0 text-[var(--color-faint)] transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>

            {expanded && (
              <div id={panelId} className="bg-[var(--color-bg)]/40 px-3 pb-4">
                <p className="pb-2 text-caption text-[var(--color-faint)]">
                  {row.populated} of {SCORING_SLOTS.length} scored indicators had data
                  {row.partial > 0 ? ` · ${row.partial} built from one leg` : ''}
                </p>
                {slots.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {slots.map((slot) => {
                      const cell = row.cells[slot.key];
                      const outlined = mirrorCells?.[row.symbol]?.[slot.key] !== undefined;
                      return (
                        <li key={slot.key} className="flex items-start gap-3">
                          <ValueBadge cell={cell} outlined={outlined} />
                          <div className="min-w-0 flex-1">
                            <p className="text-small font-medium">
                              {slot.label}
                              {!slot.scoring && (
                                <span className="ml-1 text-micro text-[var(--color-faint)] italic">context only</span>
                              )}
                            </p>
                            {cell?.explanation && (
                              <p className="text-caption text-[var(--color-muted)]">{cell.explanation}</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Link
                  href={`/scorecard/${row.symbol}`}
                  className="mt-3 flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-bright)] text-small text-[var(--color-text)]"
                >
                  Open {row.symbol} scorecard →
                </Link>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
