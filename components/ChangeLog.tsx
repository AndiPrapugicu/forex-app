'use client';

/**
 * What moved since the last run, and why.
 *
 * This exists because of one report: "we had 20 bullish and from time to time
 * it appeared that it's 19, and no news occurred." The board was not lying, but
 * it had no way to say that a score had moved because an upstream contract
 * failed rather than because the market changed its mind. Both looked identical:
 * a number quietly different from the one you remembered.
 *
 * So the rule here is that a row must always end in a REASON. When a leg went
 * missing it says so and names it. When nothing failed it says the cell moved,
 * which is the honest answer and reads as reassurance rather than noise.
 */

import { useState } from 'react';
import { utcTime } from '@/components/ui';
import { SLOTS } from '@/config/setups.config';
import type { CellChange, ScoreChange } from '@/lib/scoring/history';

const SLOT_LABEL = new Map(SLOTS.map((s) => [s.key, s.label]));

function label(slotKey: string): string {
  return SLOT_LABEL.get(slotKey) ?? slotKey;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** "2 → 0" with an em-dash for a cell that has no value at all. */
function cellMove(change: CellChange): string {
  const from = change.from === null ? '—' : signed(change.from);
  const to = change.to === null ? '—' : signed(change.to);
  return `${from} → ${to}`;
}

/**
 * The one-line reason.
 *
 * A lost leg outranks a cell that merely moved, because it is the only one of
 * the two that means the number is less trustworthy than it was rather than
 * simply different.
 */
function reason(change: ScoreChange): { text: string; suspect: boolean } {
  const lost = change.cells.find((c) => c.becamePartial);
  if (lost) {
    return { text: `${label(lost.slotKey)} lost its ${lost.missingLeg} leg`, suspect: true };
  }

  const dark = change.cells.find((c) => c.wentDark);
  if (dark) return { text: `${label(dark.slotKey)} lost its data`, suspect: true };

  const moved = change.cells[0];
  if (moved) return { text: `${label(moved.slotKey)} ${cellMove(moved)}`, suspect: false };

  return { text: 'block subtotals rebalanced', suspect: false };
}

const COLLAPSED = 5;

export function ChangeLog({ changes }: { changes: ScoreChange[] }) {
  const [expanded, setExpanded] = useState(false);

  if (changes.length === 0) return null;

  const shown = expanded ? changes : changes.slice(0, COLLAPSED);
  /** Rows that moved because something failed, not because the data changed. */
  const suspect = changes.filter((c) => reason(c).suspect).length;

  return (
    <section className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-3 py-2">
        <h2 className="text-xs font-semibold">Changed since the last run</h2>
        <span className="text-[10px] text-[var(--color-faint)]">
          {changes.length} {changes.length === 1 ? 'symbol' : 'symbols'}
          {/* An absolute clock time rather than "11m ago": the age depends on
              when you look, which would make this component impure and desync
              the server's HTML from the client's. */}
          {changes[0] && ` · compared against ${utcTime(changes[0].sinceUtc)}`}
        </span>
        {/* The count that answers "did the board move, or did a feed break?" */}
        {suspect > 0 && (
          <span className="text-[10px] text-[var(--color-uncertain)]">
            {suspect} moved because a source went missing, not because the data changed
          </span>
        )}
        {changes.length > COLLAPSED && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto text-[10px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            {expanded ? 'Show less' : `Show all ${changes.length}`}
          </button>
        )}
      </header>

      <ul className="divide-y divide-[var(--color-border)]">
        {shown.map((change) => {
          const why = reason(change);
          return (
            <li
              key={change.symbol}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5 text-[11px]"
            >
              <span className="w-20 font-semibold">{change.symbol}</span>

              <span className="tnum text-[var(--color-muted)]">
                {signed(change.from)} → {signed(change.to)}
              </span>

              {/* A bias change is the part a reader actually notices, so it is
                  the part that gets the colour. */}
              {change.biasChanged && (
                <span className="text-[var(--color-text)]">
                  {change.fromBias} → <strong>{change.toBias}</strong>
                </span>
              )}

              <span
                className={
                  why.suspect ? 'text-[var(--color-uncertain)]' : 'text-[var(--color-faint)]'
                }
              >
                · {why.text}
              </span>

              {/* Everything else that moved, for the reader who wants the rest. */}
              {change.cells.length > 1 && (
                <span
                  className="ml-auto text-[10px] text-[var(--color-faint)]"
                  title={change.cells
                    .map((c) => `${label(c.slotKey)} ${cellMove(c)}`)
                    .join('\n')}
                >
                  {change.cells.length} cells moved
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
