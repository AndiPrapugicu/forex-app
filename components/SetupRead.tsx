'use client';

/**
 * The written read of a setup: rule-based always, AI on request.
 *
 * The deterministic brief is not a placeholder for the AI — it is the default,
 * rendered immediately, composed from the same computed values the panels above
 * show. The AI is an extra opinion layered on top, and the page is complete
 * without it. That ordering matters: if the model were the primary and the rules
 * the fallback, an outage would quietly downgrade the page and nobody would know
 * which one they were reading.
 *
 * The button, rather than generating on load, is deliberate too. It keeps the
 * bill to setups someone actually opened, and it makes the AI something the user
 * asked for rather than something that appeared beside the numbers.
 */

import { useState } from 'react';
import { Panel } from '@/components/ui';

interface PlanResponse {
  available: boolean;
  reason?: string;
  text?: string;
  model?: string;
}

export function SetupRead({ symbol, brief }: { symbol: string; brief: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PlanResponse | null>(null);

  async function ask() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, brief }),
      });
      setResult(await res.json());
    } catch {
      setResult({ available: false, reason: 'Request failed' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      title="The read"
      subtitle="Composed from the numbers above"
      action={
        <button
          type="button"
          onClick={ask}
          disabled={loading}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-50"
        >
          {loading ? 'Thinking…' : result?.available ? 'Ask again' : 'Ask the model'}
        </button>
      }
    >
      <p className="px-4 py-3 text-[11px] leading-relaxed text-[var(--color-muted)]">{brief}</p>

      {result && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          {result.available ? (
            <>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-muted)]">
                  AI · {result.model}
                </span>
                <span className="text-[9px] text-[var(--color-faint)]">
                  Second opinion — every number above it is computed, not generated
                </span>
              </div>
              <p className="text-[11px] leading-relaxed whitespace-pre-line">{result.text}</p>
            </>
          ) : (
            <p className="text-[10px] text-[var(--color-faint)]">
              {result.reason}
              {result.reason === 'No AI provider configured' &&
                ' — set OPENAI_API_KEY in .env.local. The read above does not need one.'}
            </p>
          )}
        </div>
      )}

      <p className="border-t border-[var(--color-border)] px-4 py-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
        The paragraph above is generated from the computed values by fixed templates —
        no model touches a number anywhere on this page. Asking the model adds a
        judgement about which conflict matters most; it cannot change the direction
        or invent a level. Not financial advice.
      </p>
    </Panel>
  );
}
