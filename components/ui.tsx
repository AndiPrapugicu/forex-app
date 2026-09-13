/**
 * Shared primitives: score formatting, direction styling, panels, badges.
 *
 * Centralised because consistency is a correctness property here — if bullish is
 * teal in one panel and green in another, the dashboard stops being scannable.
 */

import type { ReactNode } from 'react';
import type { AlertSeverity, Direction, Impact } from '@/lib/types';

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

export const DIRECTION_STYLE: Record<Direction, { color: string; bg: string; glyph: string; label: string }> = {
  bullish: { color: 'text-[var(--color-bull)]', bg: 'bg-[var(--color-bull)]/10', glyph: '▲', label: 'Bullish' },
  bearish: { color: 'text-[var(--color-bear)]', bg: 'bg-[var(--color-bear)]/10', glyph: '▼', label: 'Bearish' },
  neutral: { color: 'text-[var(--color-neutral)]', bg: 'bg-[var(--color-neutral)]/10', glyph: '■', label: 'Neutral' },
  uncertain: { color: 'text-[var(--color-uncertain)]', bg: 'bg-[var(--color-uncertain)]/10', glyph: '?', label: 'Uncertain' },
};

/**
 * Colour for a raw score.
 * Uncertain scores must be styled by direction, not magnitude — call sites pass
 * the direction explicitly rather than inferring from the number.
 */
export function scoreColor(score: number, direction: Direction): string {
  if (direction === 'uncertain') return 'text-[var(--color-uncertain)]';
  if (score > 0.5) return 'text-[var(--color-bull)]';
  if (score < -0.5) return 'text-[var(--color-bear)]';
  return 'text-[var(--color-neutral)]';
}

// ---------------------------------------------------------------------------
// Cell bias — the EdgeFinder vocabulary
// ---------------------------------------------------------------------------

export type CellBias =
  | 'Very Bullish'
  | 'Bullish'
  | 'Neutral'
  | 'Bearish'
  | 'Very Bearish'
  | 'No data';

/**
 * Turns a cell integer into the words EdgeFinder puts on it.
 *
 * A bare "+2" asks the reader to remember what that column's maximum is before
 * they can tell a strong reading from a weak one — and the maxima are not
 * uniform: trend and COT span +/-2, seasonality and crowd only +/-1. So the
 * label is relative to the slot's own range, which is the only reading that
 * means the same thing in every column.
 *
 * Deliberately NOT derived from BIAS_THRESHOLDS. Those are absolute cuts on a
 * symbol TOTAL (>= +7 Very Bullish, >= +4 Bullish); a cell is a single vote on a
 * two- or four-point scale and shares nothing with them but the words.
 *
 * `stale` is not routed through here. A cell that aged out is not neutral — it
 * is unknown, and call sites render it as such.
 */
export function cellBias(cell: number | null, maxCell: number): { label: CellBias; tone: string } {
  if (cell === null || !Number.isFinite(cell)) {
    return { label: 'No data', tone: 'text-[var(--color-faint)]' };
  }
  if (cell === 0) return { label: 'Neutral', tone: 'text-[var(--color-muted)]' };

  // "Very" only exists where the column has room for it. On a +/-1 column,
  // +1 IS the maximum, and calling it Very Bullish would rank a one-point
  // seasonality read alongside a two-point trend crossover.
  const extreme = maxCell > 1 && Math.abs(cell) >= maxCell;

  return cell > 0
    ? {
        label: extreme ? 'Very Bullish' : 'Bullish',
        tone: 'text-[var(--color-bull)]',
      }
    : {
        label: extreme ? 'Very Bearish' : 'Bearish',
        tone: 'text-[var(--color-bear)]',
      };
}

/** The same reading as a filled pill, for tables that need it to carry weight. */
export function BiasPill({
  cell,
  maxCell,
  stale = false,
  ageDays = null,
  partial = null,
}: {
  cell: number | null;
  maxCell: number;
  /**
   * The print behind this cell is past its series' cadence.
   *
   * A MARKER, NOT A VERDICT. This used to replace the whole pill with the word
   * "stale", because a print this old scored `null` and there was no verdict to
   * show. Age no longer suppresses a cell — A1 scores a 125-day-old Canadian
   * services PMI — so the pill now shows the reading it always had and says
   * beside it how old the reading is.
   */
  stale?: boolean;
  /** Age of the print, so the marker can say how stale rather than just that. */
  ageDays?: number | null;
  /**
   * The name of the leg that failed, when this cell was scored from the other
   * one alone. The pill keeps its verdict — the reading is still the best
   * available — and marks it, because a number built on half the usual inputs
   * has no business looking identical to one built on all of them.
   */
  partial?: string | null;
}) {
  const { label, tone } = cellBias(cell, maxCell);
  const value = cell === null ? 'no value' : formatScore(cell);

  // Both markers ride on the same pill, so a cell can be old AND one-legged
  // without one caveat hiding the other.
  const notes = [
    partial ? `the ${partial} leg is missing, so this is scored from the other leg alone` : null,
    stale
      ? `the last print is ${ageDays === null ? 'past this series’ usual cadence' : `${ageDays} days old, past this series’ usual cadence`}`
      : null,
  ].filter(Boolean);

  const title =
    notes.length > 0
      ? `${value} on a ±${maxCell} column — ${notes.join('; ')}`
      : `${value} on a ±${maxCell} column`;

  const bg = partial
    ? 'bg-[var(--color-surface-2)]'
    : cell === null || cell === 0
      ? 'bg-[var(--color-surface-2)]'
      : cell > 0
        ? 'bg-[var(--color-bull)]/12'
        : 'bg-[var(--color-bear)]/12';

  return (
    <span
      className={`inline-flex items-baseline gap-1 rounded px-1.5 py-0.5 text-micro font-semibold whitespace-nowrap ${bg} ${tone}`}
      style={partial ? { boxShadow: 'inset 0 0 0 1px rgb(var(--color-uncertain-rgb) / 85%)' } : undefined}
      title={title}
    >
      {cell !== null && <span className="tnum">{formatScore(cell)}</span>}
      <span className="font-medium">{label}</span>
      {partial && <span className="text-[var(--color-uncertain)]">◐</span>}
      {stale && <span className="text-[var(--color-faint)]" aria-label="stale">··</span>}
    </span>
  );
}

/** Always signed, so a positive score is unambiguous at a glance. */
/**
 * Signed score for display.
 *
 * A whole number prints without a decimal: the scorecard total is a sum of
 * integer cells, and rendering it as "+6.0" implies a precision the model does
 * not have. The continuous news engine still produces genuine fractions, and
 * those keep their tenth.
 */
export function formatScore(score: number): string {
  const sign = score > 0 ? '+' : '';
  return `${sign}${Number.isInteger(score) ? score : score.toFixed(1)}`;
}

export function formatValue(value: number | null, unit?: string | null): string {
  if (value === null || value === undefined) return '—';

  // Large counts read better abbreviated (payrolls, job openings).
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1e9) text = `${(value / 1e9).toFixed(1)}B`;
  else if (abs >= 1e6) text = `${(value / 1e6).toFixed(1)}M`;
  else if (abs >= 1e4) text = `${(value / 1e3).toFixed(0)}K`;
  else text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');

  return unit ? `${text}${unit}` : text;
}

/**
 * Decimal places for a market price, from its magnitude.
 *
 * A price is not a general-purpose number and must not be formatted like one.
 * `toLocaleString()` caps at three fraction digits, which rendered EURUSD's
 * 1.15550 as "1.156" — a pip and a half of invented precision loss on the one
 * number a trader reads first. Five places for FX, three for metals and
 * indices under 1000, one above.
 */
export function priceDecimals(price: number): number {
  return price >= 1000 ? 1 : price >= 10 ? 3 : 5;
}

export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return '—';
  return price.toFixed(priceDecimals(Math.abs(price)));
}

/**
 * A signed percentage, always with its sign, for day changes.
 * Zero prints as "0.00%" with no sign — a flat market is not a rise.
 */
export function formatChangePct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** Bull / bear / muted for a signed number, in the token colours. */
export function changeColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct) || pct === 0) {
    return 'text-[var(--color-muted)]';
  }
  return pct > 0 ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]';
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
  padded = false,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Pad the body. Opt-in, because every existing call site pads its own
   * children and a default would double-pad all of them.
   */
  padded?: boolean;
}) {
  return (
    <section
      className={`overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}
    >
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-small font-semibold tracking-wide text-[var(--color-text)] uppercase">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-caption text-[var(--color-faint)]">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {padded ? <div className="p-4">{children}</div> : children}
    </section>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <p className="text-sm text-[var(--color-muted)]">{message}</p>
      {hint && <p className="mt-1 text-xs text-[var(--color-faint)]">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const IMPACT_STYLE: Record<Impact, string> = {
  HIGH: 'bg-[var(--color-bear)]/15 text-[var(--color-bear)] border-[var(--color-bear)]/30',
  MEDIUM: 'bg-[var(--color-high)]/15 text-[var(--color-high)] border-[var(--color-high)]/30',
  LOW: 'bg-[var(--color-neutral)]/15 text-[var(--color-muted)] border-[var(--color-border-bright)]',
  NONE: 'bg-transparent text-[var(--color-faint)] border-[var(--color-border)]',
};

export function ImpactBadge({ impact }: { impact: Impact }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-micro font-semibold tracking-wider ${IMPACT_STYLE[impact]}`}
    >
      {impact === 'NONE' ? '—' : impact[0]}
    </span>
  );
}

export function CurrencyChip({ currency }: { currency: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-micro font-semibold text-[var(--color-text)]">
      {currency}
    </span>
  );
}

export const SEVERITY_STYLE: Record<AlertSeverity, { border: string; text: string; dot: string; label: string }> = {
  critical: { border: 'border-l-[var(--color-critical)]', text: 'text-[var(--color-critical)]', dot: 'bg-[var(--color-critical)]', label: 'Critical' },
  high: { border: 'border-l-[var(--color-high)]', text: 'text-[var(--color-high)]', dot: 'bg-[var(--color-high)]', label: 'High' },
  medium: { border: 'border-l-[var(--color-medium)]', text: 'text-[var(--color-medium)]', dot: 'bg-[var(--color-medium)]', label: 'Medium' },
  info: { border: 'border-l-[var(--color-info)]', text: 'text-[var(--color-info)]', dot: 'bg-[var(--color-info)]', label: 'Info' },
};

/**
 * Marks where a number came from. Always rendered next to any figure whose
 * provenance is weaker than a feed value — the user should never have to guess
 * whether a number is official, typed in, or inferred by a model.
 */
export function SourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return null;

  const style =
    source === 'manual'
      ? 'bg-[var(--color-bull)]/15 text-[var(--color-bull)]'
      : source === 'ai-extracted'
        ? 'bg-[var(--color-uncertain)]/15 text-[var(--color-uncertain)]'
        : 'bg-[var(--color-surface-2)] text-[var(--color-faint)]';

  const label =
    source === 'manual' ? 'manual' : source === 'ai-extracted' ? 'AI-extracted' : source;

  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-micro font-medium ${style}`}>
      {label}
    </span>
  );
}

/** Relative time, so "when did this print" is readable without arithmetic. */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const future = diff < 0;
  const mins = Math.round(Math.abs(diff) / 60_000);

  if (mins < 1) return 'now';
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;

  const days = Math.round(hours / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

/** UTC clock time — the only unambiguous format for a trader across sessions. */
export function utcTime(iso: string): string {
  return `${iso.slice(11, 16)} UTC`;
}
