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
 *
 * Chart screenshots can be attached (button, paste or drop). They are shrunk
 * in the browser before sending, read by a free vision model on the server, and
 * never stored: the thread keeps only what the chart reader saw, in words.
 *
 * Laid out as a chat app: a top bar, then either a centred greeting with the
 * composer and the suggestions (an empty thread), or the conversation in a
 * reading column with the composer pinned under it. It fills whatever height
 * `AiWorkspace` gives it and scrolls only the conversation.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useSidePanel } from '@/components/AiWorkspace';
import { Markdown } from '@/components/Markdown';
import { Panel } from '@/components/ui';

/** The server's answer kinds (lib/analysis/intent.ts). */
type Mode = 'brief' | 'decision' | 'reaction' | 'explain' | 'event' | 'compare' | 'full';

const MODE_LABEL: Record<Mode, string> = {
  brief: 'recap',
  decision: 'short answer',
  reaction: 'move explained',
  explain: 'explained',
  event: 'event read',
  compare: 'comparison',
  full: 'full read',
};

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
  /** On a user turn: the attached charts. Kept for this page view only, never stored. */
  images?: string[];
  /** How many charts were attached, so a reloaded thread can still say so. */
  imageCount?: number;
  /** What the vision model read off the attached charts; sent again with follow-ups. */
  vision?: string;
  /** How the server read the question: the kind, the window, the move. */
  understood?: string;
  meta?: Meta;
  error?: string;
}

/**
 * Each carries its answer kind; free text is routed on the server. Answers are
 * short by default; "Full fundamental read" is the long template.
 */
const QUICK_PROMPTS: { label: string; hint: string; text: string; mode: Mode; needsPosition?: boolean }[] = [
  { label: 'What just moved?', hint: 'The last few hours, timed against the headlines', mode: 'reaction', text: 'What just moved in this market over the last few hours, and why? Measure it across stocks, yields, the dollar, havens and oil, and time it against the headlines.' },
  { label: 'Full fundamental read', hint: 'Rates, macro, news, positioning and scenarios', mode: 'full', text: 'Give me the full fundamental analysis: rates and policy, macro momentum, news, cross-asset drivers, positioning, and scenarios with catalysts.' },
  { label: 'What changed in 24h', hint: 'Data, central banks and headlines since yesterday', mode: 'brief', text: 'What has changed in the last 24 hours for this market — data, central-bank communication and headlines — and does it move the state?' },
  { label: 'Where to enter, given the bias', hint: 'Conditions, and what would invalidate the idea', mode: 'decision', text: 'Given the current bias, where would I look to enter, under what fundamental conditions, and what invalidates the idea?' },
  { label: 'What would flip this', hint: 'Catalysts on the calendar and the thresholds', mode: 'decision', text: 'What would flip this view? Name the catalysts on the calendar and the thresholds that matter.' },
  { label: 'Is my thesis intact?', hint: 'Your open position, point by point', mode: 'decision', needsPosition: true, text: 'I hold the open position in the dossier. Check my thesis point by point against the current state: is it intact, what is eroding it, and what would make me close?' },
];

/** One click under an answer: the follow-ups a trader asks most. */
const FOLLOW_UPS: { label: string; text: string; mode: Mode }[] = [
  { label: 'Full read', mode: 'full', text: 'Give me the full read on this market now.' },
  { label: 'What would flip it', mode: 'decision', text: 'What would flip this view? Name the catalysts on the calendar and the thresholds that matter.' },
  { label: 'Levels', mode: 'decision', text: 'Which levels matter here, from the Levels list, and what would a break of each one mean?' },
  { label: 'Explain simpler', mode: 'explain', text: 'Explain your last answer more simply, in plain words, as if to a new trader.' },
];

const MAX_CHARS = 2000;
const MAX_IMAGES = 2;
/** Long side of an attached chart after shrinking; plenty for a vision model to read labels. */
const IMAGE_MAX_SIDE = 1600;
/** Stay under the server's per-image cap (2,000,000 characters of data URL). */
const IMAGE_MAX_CHARS = 1_900_000;

/** A screenshot shrunk to a JPEG data URL the server accepts. */
async function shrinkImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot read images.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= IMAGE_MAX_CHARS) return url;
  }
  throw new Error('That image is too large even after shrinking.');
}

/** What goes back to the server for a turn: the words, plus what the chart reader saw. */
function wireContent(t: Turn): string {
  return t.vision ? `${t.content}\n\n[CHART READING — from the user's chart, read earlier by the vision model; approximate]\n${t.vision}` : t.content;
}

/** For localStorage: images are too large to keep, the reading is not. */
function storable(turns: Turn[]): Turn[] {
  return turns.map(({ images, ...rest }) => (images?.length ? { ...rest, imageCount: images.length } : rest));
}
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
    window.localStorage.setItem(storageKey(symbol), JSON.stringify(storable(turns.slice(-30))));
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
  picker,
}: {
  symbol: string;
  label: string;
  model: string;
  accessConfigured: boolean;
  openRouterConfigured: boolean;
  unlocked: boolean;
  /** An open position on this symbol: offers "Is my thesis intact?". */
  hasPosition?: boolean;
  /** The symbol picker, drawn in the top bar. */
  picker?: ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(initiallyUnlocked);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [attached, setAttached] = useState<string[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const side = useSidePanel();

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

  // Follow a streaming answer, unless the reader has scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !busy) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  // The composer grows with what is typed, up to about eight lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`;
  }, [input]);

  const addFiles = useCallback(
    async (files: File[]) => {
      setAttachError(null);
      const pictures = files.filter((f) => f.type.startsWith('image/'));
      if (pictures.length === 0) return;
      const room = MAX_IMAGES - attached.length;
      if (room <= 0) {
        setAttachError(`At most ${MAX_IMAGES} charts per question.`);
        return;
      }
      try {
        const urls = await Promise.all(pictures.slice(0, room).map(shrinkImage));
        setAttached((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
        if (pictures.length > room) setAttachError(`Only ${MAX_IMAGES} charts per question; the rest were left out.`);
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : 'Could not read that image.');
      }
    },
    [attached.length],
  );

  const ask = useCallback(
    async (question: string, base?: Turn[], mode?: Mode, images?: string[]) => {
      const text = question.trim() || (images?.length ? 'What does this chart show, and what does it mean for this market given the dossier?' : '');
      if (!text || busy) return;

      const userTurn: Turn = { role: 'user', content: text, ...(mode ? { mode } : {}), ...(images?.length ? { images } : {}) };
      const history: Turn[] = [...(base ?? turns), userTurn];
      const pending: Turn = { role: 'assistant', content: '' };
      setTurns([...history, pending]);
      setInput('');
      setAttached([]);
      setAttachError(null);
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
      const setVision = (reading: string) => {
        history[history.length - 1] = { ...history[history.length - 1], vision: reading };
        update();
      };
      const setUnderstood = (text: string) => {
        history[history.length - 1] = { ...history[history.length - 1], understood: text };
        update();
      };

      try {
        const res = await fetch('/api/ai/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            ...(mode ? { mode } : {}),
            ...(images?.length ? { images } : {}),
            // Only the words go back (with any earlier chart reading): answers that failed carry nothing worth re-sending.
            messages: history.filter((t) => t.content.trim() !== '').map((t) => ({ role: t.role, content: wireContent(t) })),
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
            else if (event.type === 'vision') setVision(event.text ?? '');
            else if (event.type === 'understood') setUnderstood(event.text ?? '');
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

  const send = () => void ask(input, undefined, undefined, attached);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void addFiles([...e.dataTransfer.files]);
  };

  /** Asks the failed question again, in place of the failed attempt. */
  const retry = () => {
    const lastUser = turns.length - 2;
    if (lastUser < 0 || turns[lastUser].role !== 'user') return;
    void ask(turns[lastUser].content, turns.slice(0, lastUser), turns[lastUser].mode, turns[lastUser].images);
  };

  const clear = () => {
    setTurns([]);
    saveThread(symbol, []);
  };

  const lock = async () => {
    await fetch('/api/ai/access', { method: 'DELETE' }).catch(() => {});
    setUnlocked(false);
  };

  const topBar = (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-2 md:px-4">
      <Link
        href="/"
        title="Back to the board"
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      >
        <BarIcon path="M15 6l-6 6 6 6" />
        <span className="hidden text-body font-bold tracking-wide text-[var(--color-text)] sm:inline">
          FX<span className="text-[var(--color-bull)]">INTEL</span>
        </span>
        <span className="sr-only sm:hidden">Back to the board</span>
      </Link>
      <span className="h-5 w-px shrink-0 bg-[var(--color-border)]" aria-hidden />
      <div className="min-w-0 flex-1">{picker}</div>
      <div className="flex shrink-0 items-center gap-0.5">
        {unlocked && turns.length > 0 && !busy && <BarButton onClick={clear} label="New chat" path="M12 5v14M5 12h14" />}
        {unlocked && accessConfigured && openRouterConfigured && (
          <BarButton onClick={() => void lock()} label="Lock" path="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z" />
        )}
        {side && (
          <BarButton
            onClick={side.toggle}
            label="Context"
            pressed={side.open}
            path="M4 4h16v16H4zM15 4v16"
          />
        )}
      </div>
    </header>
  );

  if (!accessConfigured || !openRouterConfigured) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {topBar}
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
          <div className="w-full max-w-md">
            <Panel title="Analyst" padded>
              <p className="text-sm text-[var(--color-muted)]">AI Analysis is switched off on this server.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--color-faint)]">
                {!accessConfigured && <li>Set <code>AI_ACCESS_KEY</code> (the passphrase that unlocks this page).</li>}
                {!openRouterConfigured && <li>Set <code>OPENROUTER_API_KEY</code> (the free Nemotron model is used by default).</li>}
                <li>Both go in <code>.env.local</code> locally and in the Vercel project&apos;s environment variables for production.</li>
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {topBar}
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
          <div className="w-full max-w-md">
            <Unlock onUnlocked={() => setUnlocked(true)} />
          </div>
        </div>
      </div>
    );
  }

  const composer = (
    <form onSubmit={onSubmit}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-[20px] border bg-[var(--color-surface)] shadow-[0_10px_32px_rgba(0,0,0,0.35)] transition-colors focus-within:border-[var(--color-border-bright)] ${
          dragging ? 'border-[var(--color-bull)]' : 'border-[var(--color-border)]'
        }`}
      >
        {attached.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3.5">
            {attached.map((src, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL preview */}
                <img src={src} alt={`Chart ${i + 1} to send`} className="h-16 w-24 rounded-lg border border-[var(--color-border)] object-cover" />
                <button
                  type="button"
                  onClick={() => setAttached((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Remove chart ${i + 1}`}
                  className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] text-micro text-[var(--color-text)]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          placeholder={`Ask about ${label}, paste a news link, or drop a chart`}
          className="block max-h-52 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm leading-relaxed text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)]"
          aria-label="Your question"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pt-1 pb-2.5">
          <div className="flex min-w-0 items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy || attached.length >= MAX_IMAGES}
              className="flex h-8 items-center gap-1.5 rounded-full px-2.5 text-micro text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-40"
              aria-label="Attach a chart screenshot"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M21 12.5 12.7 20.8a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Chart
            </button>
            <span className="hidden truncate text-micro text-[var(--color-faint)] md:inline">
              Enter to send · Shift+Enter for a new line · up to {MAX_IMAGES} charts
            </span>
          </div>
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop the answer"
              title="Stop"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-text)] text-[var(--color-bg)]"
            >
              <span className="h-2.5 w-2.5 rounded-[2px] bg-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              title="Send"
              disabled={!input.trim() && attached.length === 0}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-bull)] text-[var(--color-bg)] transition-colors disabled:bg-[var(--color-surface-2)] disabled:text-[var(--color-faint)]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {attachError && <p className="mt-1.5 px-2 text-micro text-[var(--color-bear)]">{attachError}</p>}
      <p className="mt-2 text-center text-micro text-[var(--color-faint)]">
        {model} · charts read by a free vision model · analysis, not financial advice
      </p>
    </form>
  );

  if (turns.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {topBar}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-10">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] md:text-[1.75rem]">
              What do you want to know about {label}?
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-muted)]">
              Rates, data, news and positioning, read from a dossier rebuilt for every question. Ask in English or Romanian. Each
              question uses one or two requests of the free model&apos;s daily allowance.
            </p>
            <div className="mt-6">{composer}</div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {QUICK_PROMPTS.filter((p) => !p.needsPosition || hasPosition).map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={busy}
                  onClick={() => void ask(p.text, undefined, p.mode)}
                  className="rounded-xl border border-[var(--color-border)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface)] disabled:opacity-40"
                >
                  <span className="block text-sm font-medium text-[var(--color-text)]">{p.label}</span>
                  <span className="mt-0.5 block text-micro text-[var(--color-faint)]">{p.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {topBar}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-6">
          {turns.map((t, k) =>
            t.role === 'user' ? (
              <div key={k} className="flex flex-col items-end gap-1.5">
                {t.images && t.images.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {t.images.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element -- a local data URL, nothing for next/image to optimise
                      <img key={i} src={src} alt={`Attached chart ${i + 1}`} className="max-h-48 rounded-xl border border-[var(--color-border)] object-contain" />
                    ))}
                  </div>
                )}
                {!t.images?.length && t.imageCount ? (
                  <span className="text-micro text-[var(--color-faint)]">
                    {t.imageCount} chart{t.imageCount > 1 ? 's' : ''} attached (not kept after reload)
                  </span>
                ) : null}
                <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-[var(--color-surface-2)] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-text)]">
                  {t.content}
                </div>
                {t.understood && <span className="max-w-[85%] text-right text-micro text-[var(--color-faint)]">Read as: {t.understood}</span>}
                {t.vision && (
                  <details className="w-full max-w-[85%] rounded-xl border border-[var(--color-border)] px-3 py-1.5 text-left">
                    <summary className="cursor-pointer text-micro text-[var(--color-muted)]">What the chart reader saw</summary>
                    <div className="mt-1 text-xs">
                      <Markdown source={t.vision} />
                    </div>
                  </details>
                )}
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
                        className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-micro text-[var(--color-muted)] hover:text-[var(--color-text)]"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
                {t.meta && (
                  <p className="mt-2 text-micro text-[var(--color-faint)]">
                    {t.meta.model} · {t.meta.mode && MODE_LABEL[t.meta.mode] ? `${MODE_LABEL[t.meta.mode]} · ` : ''}
                    {t.meta.requests} request{t.meta.requests === 1 ? '' : 's'} · {t.meta.seconds}s ·{' '}
                    {t.meta.cost === null ? 'cost not reported' : t.meta.cost === 0 ? 'free' : `cost ${t.meta.cost}`}
                  </p>
                )}
                {t.meta && !busy && k === turns.length - 1 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {FOLLOW_UPS.filter((f) => f.mode !== t.meta?.mode).map((f) => (
                      <button
                        key={f.label}
                        type="button"
                        onClick={() => void ask(f.text, undefined, f.mode)}
                        className="rounded-full border border-[var(--color-border)] px-3 py-1 text-micro text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-bright)] hover:text-[var(--color-text)]"
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
      </div>
      {/* Same column as the conversation above it, so the two edges line up. */}
      <div className="shrink-0 pt-1 pb-3">
        <div className="mx-auto w-full max-w-3xl px-4">{composer}</div>
      </div>
    </div>
  );
}

function BarIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A top-bar action: an icon, with its label from md up. */
function BarButton({ onClick, label, path, pressed }: { onClick: () => void; label: string; path: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] ${
        pressed ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
      }`}
    >
      <BarIcon path={path} />
      <span className="hidden md:inline">{label}</span>
    </button>
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
