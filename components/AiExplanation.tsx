'use client';

/**
 * AI commentary, loaded on demand.
 *
 * Three deliberate choices:
 *  - It renders BELOW the rule trace, so the arithmetic is read first.
 *  - It is opt-in per event rather than generated during ingest, so a cron pass
 *    over 200 events never bills for prose nobody opens.
 *  - The model name is always displayed. If the output looks off, the user can
 *    see which model said it.
 */

import { useState } from 'react';
import { Panel } from '@/components/ui';

interface Explanation {
  available: boolean;
  text?: string;
  model?: string;
  uncertain?: boolean;
  reason?: string;
}

export function AiExplanation({ eventId, released }: { eventId: string; released: boolean }) {
  const [state, setState] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      setState(await res.json());
    } catch {
      setState({ available: false, reason: 'Request failed' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      title="Plain English"
      subtitle="Generated commentary — the score above does not depend on it"
      action={
        !state && (
          <button
            type="button"
            onClick={load}
            disabled={loading || !released}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-micro text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-bright)] hover:text-[var(--color-text)] disabled:opacity-40"
          >
            {loading ? 'Generating…' : 'Explain'}
          </button>
        )
      }
    >
      <div className="px-4 py-3">
        {!released ? (
          <p className="text-xs text-[var(--color-faint)]">
            Nothing to explain until the release prints.
          </p>
        ) : !state ? (
          <p className="text-xs text-[var(--color-faint)]">
            The scoring above is complete and rule-based. Generate commentary only if you want it
            described in words.
          </p>
        ) : !state.available ? (
          <p className="text-xs text-[var(--color-muted)]">
            {state.reason ?? 'Unavailable'}
            {state.reason === 'No AI provider configured' && (
              <span className="mt-1 block text-micro text-[var(--color-faint)]">
                Set OPENAI_API_KEY in .env.local, or run Ollama locally with AI_PROVIDER=ollama.
              </span>
            )}
          </p>
        ) : (
          <>
            <p className="text-sm leading-relaxed whitespace-pre-line text-[var(--color-text)]">
              {state.text}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-micro font-medium text-[var(--color-faint)]">
                AI · {state.model}
              </span>
              {state.uncertain && (
                <span className="text-micro text-[var(--color-uncertain)]">
                  flagged uncertain
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
