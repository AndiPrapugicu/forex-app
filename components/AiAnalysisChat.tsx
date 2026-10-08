'use client';

/**
 * The AI Analysis chat.
 *
 * Three states, in the order a visitor meets them: switched off (no passphrase
 * or no OpenRouter key on the server), locked (passphrase not yet typed in this
 * browser), and open. The thread is kept per symbol in localStorage — a
 * convenience for this browser only; the server keeps nothing.
 *
 * The answer streams as NDJSON (see app/api/ai/analysis/route.ts): status
 * lines while the dossier is built, a thinking tick while the model reasons,
 * then the text.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Markdown } from '@/components/Markdown';
import { Panel } from '@/components/ui';

type Mode = 'brief' | 'decision';

interface Meta {
  model: string;
  cost: number | null;
  requests: number;
  seconds: number;
  mode?: Mode;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** On a user turn: the depth asked for, so Retry asks the same way. */
  mode?: Mode;
  meta?: Meta;
  error?: string;
}

/**
 * Each carries its answer depth: a recap is BRIEF (short, quick thinking); the
 * rest are DECISION (the full template). Free text is routed on the server.
 */
const QUICK_PROMPTS: { label: string; text: string; mode: Mode; needsPosition?: boolean }[] = [
  { label: 'Full fundamental read', mode: 'decision', text: 'Give me the full fundamental analysis: rates and policy, macro momentum, news, cross-asset drivers, positioning, and scenarios with catalysts.' },
  { label: 'What changed in 24h', mode: 'brief', text: 'What has changed in the last 24 hours for this market — data, central-bank communication and headlines — and does it move the state?' },
  { label: 'Where to enter, given the bias', mode: 'decision', text: 'Given the current bias, where would I look to enter, under what fundamental conditions, and what invalidates the idea?' },
  { label: 'What would flip this', mode: 'decision', text: 'What would flip this view? Name the catalysts on the calendar and the thresholds that matter.' },
  { label: 'Is my thesis intact?', mode: 'decision', needsPosition: true, text: 'I hold the open position in the dossier. Check my thesis point by point against the current state: is it intact, what is eroding it, and what would make me close?' },
];

const MAX_CHARS = 2000;
const storageKey = (symbol: string) => `ai-analysis:thread:${symbol}`;

function loadThread(symbol: string): Turn[] {
  try {
    const raw = window.localStorage.getItem(storageKey(symbol));
    const parsed = raw ? (JSON.parse(raw) as Turn[]) : [];
    return Array.isArray(parsed) ? parsed.filter((t) => t && (t.role === 'user' || t.role === 'assistant')) : [];
  } catch {
    return [];
  }
}

function saveThread(symbol: string, turns: Turn[]) {
  try {
    window.localStorage.setItem(storageKey(symbol), JSON.stringify(turns.slice(-30)));
  } catch {
    // private window or full storage: the thread just will not survive a reload
  }
}

export function AiAnalysisChat({
  symbol,
  label,
  model,
  accessConfigured,
  openRouterConfigured,
  unlocked: initiallyUnlocked,
  hasPosition = false,
}: {
  symbol: string;
  label: string;
  model: string;
  accessConfigured: boolean;
  openRouterConfigured: boolean;
  unlocked: boolean;
  /** An open position on this symbol: offers "Is my thesis intact?". */
  hasPosition?: boolean;
}) {
  const [unlocked, setUnlocked] = useState(initiallyUnlocked);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // A new symbol is a new thread. Loaded after mount so the server render and
  // the first client render agree.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setTurns(loadThread(symbol));
    return () => abortRef.current?.abort();
  }, [symbol]);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length]);

  const ask = useCallback(
    async (question: string, base?: Turn[], mode?: Mode) => {
      const text = question.trim();
      if (!text || busy) return;

      const history: Turn[] = [...(base ?? turns), { role: 'user', content: text, ...(mode ? { mode } : {}) }];
      const pending: Turn = { role: 'assistant', content: '' };
      setTurns([...history, pending]);
      setInput('');
      setBusy(true);
      setElapsed(0);
      setThinking(false);
      setStatus('Sending…');

      const controller = new AbortController();
      abortRef.current = controller;
      let answer = '';
      let meta: Meta | undefined;
      let error: string | undefined;

      const update = () => setTurns([...history, { role: 'assistant', content: answer, meta, error }]);

      try {
        const res = await fetch('/api/ai/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            ...(mode ? { mode } : {}),
            // Only the words go back: answers that failed carry no content worth re-sending.
            messages: history.filter((t) => t.content.trim() !== '').map(({ role, content }) => ({ role, content })),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          if (res.status === 401) setUnlocked(false);
          throw new Error(body?.message ?? `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as { type: string; text?: string; message?: string } & Partial<Meta>;
            if (event.type === 'status') setStatus(event.text ?? null);
            else if (event.type === 'reasoning') setThinking(true);
            else if (event.type === 'delta') {
              setThinking(false);
              setStatus(null);
              answer += event.text ?? '';
              update();
            } else if (event.type === 'done') {
              meta = { model: event.model ?? model, cost: event.cost ?? null, requests: event.requests ?? 0, seconds: event.seconds ?? 0, mode: event.mode };
            } else if (event.type === 'error') {
              error = event.message ?? 'Unknown error';
            }
          }
        }
      } catch (err) {
        error = controller.signal.aborted ? 'Stopped.' : err instanceof Error ? err.message : String(err);
      } finally {
        const final: Turn[] = [...history, { role: 'assistant', content: answer, meta, error }];
        setTurns(final);
        saveThread(symbol, final);
        setBusy(false);
        setStatus(null);
        setThinking(false);
        abortRef.current = null;
      }
    },
    [busy, model, symbol, turns],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void ask(input);
    }
  };

  /** Asks the failed question again, in place of the failed attempt. */
  const retry = () => {
    const lastUser = turns.length - 2;
    if (lastUser < 0 || turns[lastUser].role !== 'user') return;
    void ask(turns[lastUser].content, turns.slice(0, lastUser), turns[lastUser].mode);
  };

  const clear = () => {
    setTurns([]);
    saveThread(symbol, []);
  };

  const lock = async () => {
    await fetch('/api/ai/access', { method: 'DELETE' }).catch(() => {});
    setUnlocked(false);
  };

  if (!accessConfigured || !openRouterConfigured) {
    return (
      <Panel title="Analyst" padded>
        <p className="text-sm text-[var(--color-muted)]">AI Analysis is switched off on this server.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--color-faint)]">
          {!accessConfigured && <li>Set <code>AI_ACCESS_KEY</code> (the passphrase that unlocks this page).</li>}
          {!openRouterConfigured && <li>Set <code>OPENROUTER_API_KEY</code> (the free Nemotron model is used by default).</li>}
          <li>Both go in <code>.env.local</code> locally and in the Vercel project&apos;s environment variables for production.</li>
        </ul>
      </Panel>
    );
  }

  if (!unlocked) return <Unlock onUnlocked={() => setUnlocked(true)} />;

  return (
    <Panel
      title={`Ask about ${label}`}
      subtitle="Fundamentals first. Every number comes from the dossier, rebuilt for each question."
      action={
        <div className="flex gap-2">
          {turns.length > 0 && !busy && (
            <button type="button" onClick={clear} className="rounded border border-[var(--color-border)] px-2 py-1 text-micro text-[var(--color-muted)] hover:text-[var(--color-text)]">
              Clear
            </button>
          )}
          <button type="button" onClick={lock} className="rounded border border-[var(--color-border)] px-2 py-1 text-micro text-[var(--color-muted)] hover:text-[var(--color-text)]">
            Lock
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        {turns.length === 0 && (
          <p className="text-xs text-[var(--color-faint)]">
            Start with a quick prompt or ask your own question, in English or Romanian. One question costs one or two requests of the free model&apos;s daily allowance.
          </p>
        )}

        {turns.map((t, k) =>
          t.role === 'user' ? (
            <div key={k} className="self-end rounded-[var(--radius-card)] bg-[var(--color-surface-2)] px-3 py-2 text-sm whitespace-pre-wrap text-[var(--color-text)] md:max-w-[80%]">
              {t.content}
            </div>
          ) : (
            <div key={k} className="min-w-0">
              {t.content && <Markdown source={t.content} />}
              {busy && k === turns.length - 1 && (
                <p className="mt-2 flex items-center gap-2 text-micro text-[var(--color-muted)]" aria-live="polite">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-bull)]" aria-hidden />
                  {thinking ? 'Thinking' : (status ?? 'Writing')}… {elapsed}s
                </p>
              )}
              {t.error && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-[var(--color-bear)]">{t.error}</p>
                  {!busy && k === turns.length - 1 && (
                    <button
                      type="button"
                      onClick={retry}
                      className="rounded border border-[var(--color-border)] px-2 py-0.5 text-micro text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
              {t.meta && (
                <p className="mt-2 text-micro text-[var(--color-faint)]">
                  {t.meta.model} · {t.meta.mode === 'brief' ? 'brief answer · ' : t.meta.mode === 'decision' ? 'full answer · ' : ''}
                  {t.meta.requests} request{t.meta.requests === 1 ? '' : 's'} · {t.meta.seconds}s ·{' '}
                  {t.meta.cost === null ? 'cost not reported' : t.meta.cost === 0 ? 'free' : `cost ${t.meta.cost}`}
                </p>
              )}
            </div>
          ),
        )}
        <div ref={endRef} />

        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.filter((p) => !p.needsPosition || hasPosition).map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={busy}
              onClick={() => void ask(p.text, undefined, p.mode)}
              className="rounded-[var(--radius-pill)] border border-[var(--color-border)] px-3 py-1 text-micro text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-bright)] hover:text-[var(--color-text)] disabled:opacity-40"
            >
              {p.label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={onKeyDown}
            rows={3}
            placeholder={`e.g. "${label} is bullish on the board — given the rate gap and today's news, where is the best area to get in?"`}
            className="w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-border-bright)]"
            aria-label="Your question"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro text-[var(--color-faint)]">
              {model} · free via OpenRouter · analysis, not financial advice
            </span>
            {busy ? (
              <button type="button" onClick={() => abortRef.current?.abort()} className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)]">
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded bg-[var(--color-bull)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                Ask
              </button>
            )}
          </div>
        </form>
      </div>
    </Panel>
  );
}

/**
 * The passphrase form. Shared with the positions panel, which sits behind the
 * same cookie. A successful unlock refreshes the server render, so anything the
 * page withheld while locked (the user's positions) appears without a reload.
 */
export function Unlock({
  onUnlocked,
  title = 'Analyst',
  subtitle = "Locked — the free model's daily allowance belongs to the site owner",
}: {
  onUnlocked?: () => void;
  title?: string;
  subtitle?: string;
}) {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
      if (res.ok && body?.ok) {
        onUnlocked?.();
        router.refresh();
      }
      else setError(body?.reason ?? `Failed (${res.status})`);
    } catch {
      setError('Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={title} subtitle={subtitle} padded>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Passphrase"
          autoComplete="current-password"
          aria-label="Passphrase"
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-border-bright)] sm:max-w-xs"
        />
        <button type="submit" disabled={busy || !key} className="rounded bg-[var(--color-bull)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-[var(--color-bear)]">{error}</p>}
      <p className="mt-2 text-micro text-[var(--color-faint)]">The passphrase is the AI_ACCESS_KEY set on the server. This browser remembers it for 30 days.</p>
    </Panel>
  );
}
