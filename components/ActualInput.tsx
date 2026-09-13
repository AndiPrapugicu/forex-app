'use client';

/**
 * Inline manual actual entry.
 *
 * This is the instant path: no free feed publishes a number the moment it hits
 * the wire, and this is a single-user app, so the user typing what they just saw
 * is the fastest reliable input available. A manual value outranks every feed.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { EventScore, NormalizedEvent } from '@/lib/types';

export function ActualInput({
  event,
  onScored,
}: {
  event: NormalizedEvent;
  onScored?: (event: NormalizedEvent, score: EventScore) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ feed: number; manual: number } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;

    setBusy(true);
    setError(null);
    setConflict(null);

    try {
      const res = await fetch('/api/actual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, actual: value.trim() }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'failed to save');

      if (json.conflictsWithFeed) setConflict(json.conflictsWithFeed);
      onScored?.(json.event, json.score);
      setValue('');

      // Re-render the server component so the trace and gauge reflect the new
      // number without a manual reload.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
      <form onSubmit={submit} className="flex items-center gap-2">
        <label htmlFor="actual-input" className="text-micro whitespace-nowrap text-[var(--color-muted)]">
          {event.actual === null ? 'Enter actual' : 'Override actual'}
        </label>
        <input
          id="actual-input"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          // Accepts what a trader would actually paste, not just bare digits.
          placeholder="e.g. 142K, 3.4%, -23"
          className="tnum min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-bull)]"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="rounded bg-[var(--color-bull)]/15 px-3 py-1 text-xs font-semibold text-[var(--color-bull)] transition-colors hover:bg-[var(--color-bull)]/25 disabled:opacity-40"
        >
          {busy ? 'Scoring…' : 'Score it'}
        </button>
      </form>

      {error && <p className="mt-1.5 text-micro text-[var(--color-bear)]">{error}</p>}

      {/* Overriding a feed value is surfaced, never silent. */}
      {conflict && (
        <p className="mt-1.5 text-micro text-[var(--color-uncertain)]">
          Saved. Note this overrides the feed value of {conflict.feed} with {conflict.manual}.
        </p>
      )}

      <p className="mt-1.5 text-micro leading-relaxed text-[var(--color-faint)]">
        A manual value outranks every feed and rescores immediately. Use it the moment a number
        prints — the feeds lag by seconds to minutes.
      </p>
    </div>
  );
}
