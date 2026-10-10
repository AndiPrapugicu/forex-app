'use client';

/**
 * The user's open positions with their thesis status, plus the form that adds
 * one. Statuses are computed on the server (`lib/analysis/positions-load.ts`);
 * this only shows them and sends edits to `/api/positions`, then refreshes the
 * server render so the new status is the server's, never a client guess.
 *
 * Rendered only for the passphrase holder: the page decides that, and the API
 * checks the cookie again on every call.
 */

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Panel } from '@/components/ui';
import type { PositionView } from '@/lib/analysis/positions-load';
import type { ThesisStatus } from '@/lib/analysis/thesis';

const STATUS_TONE: Record<ThesisStatus, string> = {
  green: 'border-[var(--color-bull)] text-[var(--color-bull)]',
  yellow: 'border-[var(--color-uncertain)] text-[var(--color-uncertain)]',
  red: 'border-[var(--color-bear)] text-[var(--color-bear)]',
};

const INPUT =
  'w-full min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-border-bright)]';

const px = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Number(v.toPrecision(6)).toString());
const rr = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}R`);
const signed = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');
/** Romanian keyboards type a decimal comma. */
const decimal = (s: string) => s.trim().replace(',', '.');

async function send(method: 'POST' | 'PATCH' | 'DELETE', body: unknown): Promise<string | null> {
  try {
    const res = await fetch('/api/positions', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
    return res.ok && json?.ok ? null : (json?.reason ?? `Failed (${res.status})`);
  } catch {
    return 'Request failed';
  }
}

export function StatusChip({ status }: { status: ThesisStatus | null }) {
  if (!status) return <span className="rounded border border-[var(--color-border-bright)] px-1.5 py-0.5 text-micro font-bold text-[var(--color-faint)]">—</span>;
  return <span className={`rounded border px-1.5 py-0.5 text-micro font-bold tracking-wide uppercase ${STATUS_TONE[status]}`}>{status}</span>;
}

function PositionRow({ view }: { view: PositionView }) {
  const router = useRouter();
  const p = view.position;
  const rep = view.report;
  const [closing, setClosing] = useState(false);
  const [closePrice, setClosePrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (method: 'PATCH' | 'DELETE', body: unknown) => {
    setBusy(true);
    setError(null);
    const err = await send(method, body);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  };

  return (
    <li className="border-b border-[var(--color-border)] px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusChip status={rep?.status ?? null} />
        <span className="font-semibold text-[var(--color-text)]">{p.symbol}</span>
        <span className={`text-xs font-semibold uppercase ${p.side === 'long' ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'}`}>{p.side}</span>
        <span className="text-xs text-[var(--color-muted)]">
          from {px(p.entryPrice)} on {p.entryDate} · SL {px(p.stopLoss)} · TP {px(p.takeProfit)}
          {p.size ? ` · ${p.size}` : ''}
          {p.riskPct !== null ? ` · ${p.riskPct}% risk` : ''}
        </span>
      </div>

      {rep && (
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Now {px(rep.price)} ({rr(rep.rNow)}
          {rep.rTarget !== null ? ` of ${rr(rep.rTarget)}` : ''}) · Board {signed(rep.boardScore)}
          {rep.entryScore !== null ? ` (entry ${signed(rep.entryScore)})` : ''}
          {rep.daysOnSide !== null ? ` · ${rep.daysOnSide}d in band` : ''}
          {rep.structure ? ` · last ${rep.structure.kind} ${px(rep.structure.price)} (${rep.structure.date})` : ''}
        </p>
      )}

      {rep && rep.signals.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {rep.signals.map((s, k) => (
            <li key={k} className="flex gap-2 text-xs">
              <span className={`shrink-0 font-bold uppercase ${s.level === 'red' ? 'text-[var(--color-bear)]' : 'text-[var(--color-uncertain)]'}`}>{s.level}</span>
              <span className="min-w-0 text-[var(--color-text)]">{s.text}</span>
            </li>
          ))}
        </ul>
      )}
      {view.gap && <p className="mt-1 text-micro text-[var(--color-uncertain)]">{view.gap}</p>}

      {p.thesis && (
        <details className="mt-2">
          <summary className="cursor-pointer text-micro text-[var(--color-faint)]">Thesis</summary>
          <p className="mt-1 text-xs whitespace-pre-wrap text-[var(--color-muted)]">{p.thesis}</p>
        </details>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {closing ? (
          <>
            <input
              value={closePrice}
              onChange={(e) => setClosePrice(e.target.value)}
              inputMode="decimal"
              placeholder="Close price (optional)"
              aria-label="Close price"
              className={`${INPUT} max-w-[12rem]`}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => act('PATCH', { id: p.id, close: true, closePrice: decimal(closePrice) || null })}
              className="rounded bg-[var(--color-surface-2)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text)] disabled:opacity-40"
            >
              Confirm close
            </button>
            <button type="button" onClick={() => setClosing(false)} className="px-2 py-1 text-xs text-[var(--color-faint)]">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setClosing(true)} className="rounded border border-[var(--color-border-bright)] px-2.5 py-1 text-xs text-[var(--color-text)]">
              Close…
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete the ${p.symbol} ${p.side} for good? Closing keeps the record; deleting does not.`)) act('DELETE', { id: p.id });
              }}
              className="px-2 py-1 text-xs text-[var(--color-faint)] hover:text-[var(--color-bear)] disabled:opacity-40"
            >
              Delete
            </button>
          </>
        )}
        {error && <span className="text-xs text-[var(--color-bear)]">{error}</span>}
      </div>
    </li>
  );
}

function AddPosition({ symbols, defaultSymbol }: { symbols: { symbol: string; label: string }[]; defaultSymbol?: string }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    symbol: defaultSymbol ?? symbols[0]?.symbol ?? '',
    side: 'long',
    entryDate: today,
    entryPrice: '',
    stopLoss: '',
    takeProfit: '',
    size: '',
    riskPct: '',
    thesis: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await send('POST', {
      ...form,
      entryPrice: decimal(form.entryPrice),
      stopLoss: decimal(form.stopLoss),
      takeProfit: decimal(form.takeProfit),
      riskPct: decimal(form.riskPct),
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setForm({ ...form, entryPrice: '', stopLoss: '', takeProfit: '', size: '', riskPct: '', thesis: '' });
    router.refresh();
  };

  const field = (label: string, node: ReactNode) => (
    <label className="flex min-w-0 flex-col gap-1 text-micro text-[var(--color-faint)]">
      {label}
      {node}
    </label>
  );

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
      {field(
        'Symbol',
        <select value={form.symbol} onChange={set('symbol')} className={INPUT}>
          {symbols.map((s) => (
            <option key={s.symbol} value={s.symbol}>
              {s.symbol} · {s.label}
            </option>
          ))}
        </select>,
      )}
      {field(
        'Side',
        <select value={form.side} onChange={set('side')} className={INPUT}>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>,
      )}
      {field('Entry date', <input type="date" value={form.entryDate} max={today} onChange={set('entryDate')} className={INPUT} required />)}
      {field('Entry price', <input value={form.entryPrice} onChange={set('entryPrice')} inputMode="decimal" className={INPUT} required />)}
      {field('Stop loss', <input value={form.stopLoss} onChange={set('stopLoss')} inputMode="decimal" className={INPUT} />)}
      {field('Take profit', <input value={form.takeProfit} onChange={set('takeProfit')} inputMode="decimal" className={INPUT} />)}
      {field('Size', <input value={form.size} onChange={set('size')} maxLength={60} placeholder="0.5 lots" className={INPUT} />)}
      {field('Risk %', <input value={form.riskPct} onChange={set('riskPct')} inputMode="decimal" placeholder="1" className={INPUT} />)}
      <div className="col-span-2 @xl:col-span-4">
        {field(
          'Thesis, in your words (the analyst checks it point by point)',
          <textarea value={form.thesis} onChange={set('thesis')} maxLength={1000} rows={3} className={`${INPUT} resize-y`} />,
        )}
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-3 @xl:col-span-4">
        <button type="submit" disabled={busy || !form.entryPrice} className="rounded bg-[var(--color-bull)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
          {busy ? 'Saving…' : 'Add position'}
        </button>
        {error && <span className="text-xs text-[var(--color-bear)]">{error}</span>}
      </div>
    </form>
  );
}

export function PositionsPanel({
  views,
  error,
  durable,
  symbols,
  defaultSymbol,
  title = 'Your positions',
  emptyText = 'No open positions. Add one and the thesis check runs on every page load and every ingest run.',
  flat = false,
}: {
  views: PositionView[];
  error: string | null;
  durable: boolean;
  symbols: { symbol: string; label: string }[];
  defaultSymbol?: string;
  title?: string;
  emptyText?: string;
  /** Borderless, for a column that is already a surface (the /ai side column). */
  flat?: boolean;
}) {
  return (
    <Panel
      flat={flat}
      title={title}
      subtitle="Private to the passphrase holder · RED on structure, board band, tactical narrative or a fired flip"
    >
      {error ? (
        <p className="px-4 py-3 text-xs text-[var(--color-uncertain)]">{error}</p>
      ) : views.length === 0 ? (
        <p className="px-4 py-3 text-xs text-[var(--color-muted)]">{emptyText}</p>
      ) : (
        <ul>
          {views.map((v) => (
            <PositionRow key={v.position.id} view={v} />
          ))}
        </ul>
      )}
      {!durable && !error && (
        <p className="border-t border-[var(--color-border)] px-4 py-2 text-micro text-[var(--color-uncertain)]">
          No Supabase on this server: positions live in memory and vanish on restart.
        </p>
      )}
      {!error && (
        <details className="border-t border-[var(--color-border)]">
          <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-[var(--color-muted)]">Add a position</summary>
          <div className="@container px-4 pb-4">
            <AddPosition symbols={symbols} defaultSymbol={defaultSymbol} />
          </div>
        </details>
      )}
    </Panel>
  );
}
