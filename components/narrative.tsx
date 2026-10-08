/**
 * Building blocks for the Market Narrative: the verdict badge, a signed effect
 * cell, a theme row that opens onto its evidence, and the flip list.
 *
 * Server components with no client JavaScript: the evidence opens with a
 * native <details>, which is keyboard- and touch-native and costs nothing.
 *
 * Deliberately NOT styled like the board. A narrative verdict is a label with a
 * count, never a number on the board's scale, so it gets an outlined badge
 * rather than the board's filled heat cell.
 */

import type { ReactNode } from 'react';
import { subjectLabel, type Change, type FlipCondition, type PairNarrative, type PairTheme, type Verdict, type VerdictReading } from '@/lib/analysis/state';
import type { Evidence, ThemeReading } from '@/lib/analysis/themes';
import type { Subject } from '@/config/narrative.config';
import { heatStyle } from '@/lib/ui/heat';

const VERDICT_TONE: Record<Verdict, string> = {
  BULLISH: 'border-[var(--color-bull)] text-[var(--color-bull)]',
  BEARISH: 'border-[var(--color-bear)] text-[var(--color-bear)]',
  NEUTRAL: 'border-[var(--color-border-bright)] text-[var(--color-muted)]',
};

export function VerdictBadge({ verdict, horizon }: { verdict: VerdictReading; horizon: string }) {
  return (
    <div className="min-w-0">
      <p className="text-micro font-semibold tracking-wide text-[var(--color-faint)] uppercase">{horizon}</p>
      <span className={`mt-1 inline-block rounded border px-2 py-0.5 text-sm font-bold tracking-wide ${VERDICT_TONE[verdict.label]}`}>{verdict.label}</span>
      <p className="mt-1 text-micro text-[var(--color-muted)]">{verdict.text.replace(/^(BULLISH|BEARISH|NEUTRAL) — /, '')}</p>
    </div>
  );
}

export const signed = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');

/** One signed effect, coloured on a ±max scale. Null is an abstention, not a zero. */
export function EffectCell({ value, max = 2, title }: { value: number | null | undefined; max?: number; title?: string }) {
  if (value === null || value === undefined) {
    return (
      <span title={title ?? 'no reading'} className="tnum inline-block min-w-[2.25rem] rounded px-1.5 py-0.5 text-center text-micro text-[var(--color-faint)]">
        —
      </span>
    );
  }
  return (
    <span title={title} className="tnum inline-block min-w-[2.25rem] rounded px-1.5 py-0.5 text-center text-micro font-semibold" style={heatStyle(value, { max })}>
      {signed(value)}
    </span>
  );
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

export function EvidenceList({ items }: { items: Evidence[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {items.map((e, k) => (
        <li key={k} className="text-micro text-[var(--color-muted)]">
          {e.url ? (
            <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-text)]">
              {e.text}
            </a>
          ) : (
            e.text
          )}{' '}
          <span className="text-[var(--color-faint)]">
            {day(e.date)}
            {e.date ? ' · ' : ''}
            {e.source}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LegDetail({ subject, reading }: { subject: Subject; reading: ThemeReading | null }) {
  if (!reading) return null;
  return (
    <div className="min-w-0">
      <p className="text-micro font-semibold text-[var(--color-text)]">
        {subjectLabel(subject)}: <span className="font-normal">{reading.gap ? `no data — ${reading.gap}` : reading.state}</span>{' '}
        {!reading.gap && (
          <span className="text-[var(--color-faint)]">
            (tactical {signed(reading.tactical)}, structural {signed(reading.structural)})
          </span>
        )}
      </p>
      <div className="mt-0.5 pl-2">
        <EvidenceList items={reading.evidence.slice(0, 5)} />
        {reading.notes.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {reading.notes.map((n, k) => (
              <li key={k} className="text-micro text-[var(--color-faint)] italic">
                {n}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One theme of a pair: the pair's effect, each leg's state, the evidence on open. */
export function ThemeRow({ pair, theme }: { pair: PairNarrative; theme: PairTheme }) {
  const legState = (r: ThemeReading | null) => (r ? (r.gap ? 'no data' : r.state) : '—');
  return (
    <details className="group border-b border-[var(--color-border)] last:border-b-0">
      <summary className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 py-1.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="text-xs font-semibold text-[var(--color-text)]">
            {theme.label}
            {theme.weight > 1 && <span className="ml-1 text-micro font-normal text-[var(--color-faint)]">×{theme.weight}</span>}
          </span>
          <span className="block truncate text-micro text-[var(--color-muted)]">
            {subjectLabel(pair.base)}: {legState(theme.base)}
            {pair.quote && (
              <>
                {' · '}
                {subjectLabel(pair.quote)}: {legState(theme.quote)}
              </>
            )}
          </span>
        </span>
        <EffectCell value={theme.tactical} max={pair.quote ? 4 : 2} title="Tactical: days to two weeks" />
        <EffectCell value={theme.structural} max={pair.quote ? 4 : 2} title="Structural: one to three months" />
      </summary>
      <div className="flex flex-col gap-2 pb-2 pl-1">
        <LegDetail subject={pair.base} reading={theme.base} />
        {pair.quote && <LegDetail subject={pair.quote} reading={theme.quote} />}
        {theme.partial && <p className="text-micro text-[var(--color-uncertain)]">One leg has no reading here and counts as 0.</p>}
      </div>
    </details>
  );
}

const ROLE_TAG: Record<FlipCondition['role'], { label: string; tone: string }> = {
  flip: { label: 'Flip', tone: 'text-[var(--color-uncertain)] border-[var(--color-uncertain)]' },
  tip: { label: 'Tip', tone: 'text-[var(--color-muted)] border-[var(--color-border-bright)]' },
  confirm: { label: 'Confirm', tone: 'text-[var(--color-muted)] border-[var(--color-border)]' },
};

export function FlipList({ flips, empty }: { flips: FlipCondition[]; empty?: string }) {
  if (flips.length === 0) return <p className="text-micro text-[var(--color-faint)]">{empty ?? 'Nothing inside the horizon.'}</p>;
  return (
    <ul className="space-y-1">
      {flips.map((f) => (
        <li key={f.id} className="flex gap-2 text-micro">
          <span className={`h-fit shrink-0 rounded border px-1 py-px text-[10px] font-semibold uppercase ${ROLE_TAG[f.role].tone}`}>{ROLE_TAG[f.role].label}</span>
          <span className="min-w-0 text-[var(--color-text)]">
            {f.text} <span className={f.favours === 'bullish' ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'}>→ {f.favours}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ChangeList({ changes, basis }: { changes: Change[]; basis: string | null }) {
  return (
    <div>
      {changes.length === 0 ? (
        <p className="text-micro text-[var(--color-faint)]">{basis ? 'No theme moved.' : 'No earlier state to compare with yet.'}</p>
      ) : (
        <ul className="space-y-0.5">
          {changes.map((c, k) => (
            <li key={k} className={`text-micro ${c.theme === 'verdict' ? 'font-semibold text-[var(--color-text)]' : 'text-[var(--color-muted)]'}`}>
              {c.text}
            </li>
          ))}
        </ul>
      )}
      {basis && <p className="mt-1 text-[10px] text-[var(--color-faint)]">Compared with {basis}.</p>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-micro font-semibold tracking-wide text-[var(--color-faint)] uppercase">{children}</p>;
}
