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

/** Always signed, so a positive score is unambiguous at a glance. */
export function formatScore(score: number): string {
  return `${score > 0 ? '+' : ''}${score.toFixed(1)}`;
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

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}
    >
      {title && (
        <header className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold tracking-wide text-[var(--color-text)] uppercase">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-[var(--color-faint)]">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
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
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${IMPACT_STYLE[impact]}`}
    >
      {impact === 'NONE' ? '—' : impact[0]}
    </span>
  );
}

export function CurrencyChip({ currency }: { currency: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--color-text)]">
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
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${style}`}>
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
