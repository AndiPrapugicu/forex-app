'use client';

/**
 * Shared page primitives for the EdgeFinder-style layout.
 *
 * Separate from `components/ui.tsx` on purpose: `Panel` there has 162 call
 * sites that each compensate for its lack of child padding, so changing it in
 * place would double-pad every one of them. New pages build on these instead,
 * and old ones move over as they are restyled.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// PageHeader — A1's header band: title, explanation, freshness, filters.
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  info,
  updated,
  actions,
}: {
  title: string;
  /** One line under the title. */
  description?: string;
  /** Longer explanation, behind a tap-and-hover disclosure. */
  info?: ReactNode;
  /** e.g. "Updated 14:32 UTC · next COT Fri 20:30". */
  updated?: string;
  /** Filters, view switches — wraps onto its own row on a phone. */
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-col gap-3 md:mb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-title font-semibold tracking-tight">{title}</h1>
          {info && <Explain label={`About ${title}`}>{info}</Explain>}
        </div>
        {description && <p className="mt-1 text-body text-[var(--color-muted)]">{description}</p>}
        {updated && (
          <p className="mt-2 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-micro text-[var(--color-muted)]">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--color-bull)]" aria-hidden />
            {updated}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Explain — replaces `title=` tooltips, which a touch screen can never open.
// ---------------------------------------------------------------------------

export function Explain({
  label,
  children,
  side = 'bottom',
}: {
  /** Accessible name for the trigger. */
  label: string;
  children: ReactNode;
  side?: 'bottom' | 'top';
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);

  // Tap outside or Escape closes it — the two exits a phone user reaches for.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={root} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        // 44px hit area around a small glyph.
        className="-m-3 flex h-11 w-11 items-center justify-center text-[var(--color-faint)] hover:text-[var(--color-text)]"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9v5M10 6.2v.1" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute left-1/2 w-[min(20rem,80vw)] -translate-x-1/2 rounded-[var(--radius-control)] border border-[var(--color-border-bright)] bg-[var(--color-surface-2)] p-3 text-left text-caption text-[var(--color-text)] shadow-xl ${
            side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'
          }`}
          style={{ zIndex: 'var(--z-popover)' }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Legend — the key above an A1 chart.
// ---------------------------------------------------------------------------

export function Legend({ items }: { items: { label: string; color: string; shape?: 'bar' | 'dot' | 'line' }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-[var(--color-muted)]">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={
              item.shape === 'dot'
                ? 'h-2.5 w-2.5 rounded-full'
                : item.shape === 'line'
                  ? 'h-0.5 w-4 rounded'
                  : 'h-2.5 w-3 rounded-sm'
            }
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// SignedBar — one centre-anchored bar, replacing four verbatim copies.
// ---------------------------------------------------------------------------

export function SignedBar({
  value,
  max,
  label,
}: {
  value: number | null;
  /** The magnitude that fills half the track. */
  max: number;
  /** Accessible description, e.g. "Net long 62%". */
  label?: string;
}) {
  const v = value ?? 0;
  const pct = max > 0 ? Math.min(50, (Math.abs(v) / max) * 50) : 0;
  const positive = v >= 0;
  return (
    <div
      role="img"
      aria-label={label ?? (value === null ? 'No data' : `${v > 0 ? '+' : ''}${v}`)}
      className="relative h-2 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-surface-2)]"
    >
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-bright)]" />
      {value !== null && (
        <span
          aria-hidden
          className="absolute inset-y-0"
          style={{
            left: positive ? '50%' : `${50 - pct}%`,
            width: `${pct}%`,
            background: positive ? 'var(--color-bull-cell)' : 'var(--color-bear-cell)',
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricDescription — the prose block under an A1 chart.
// ---------------------------------------------------------------------------

export function MetricDescription({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="text-micro font-semibold tracking-wider text-[var(--color-faint)] uppercase">
        {title ?? 'Description'}
      </h2>
      <div className="mt-2 text-body leading-relaxed text-[var(--color-muted)]">{children}</div>
    </section>
  );
}
