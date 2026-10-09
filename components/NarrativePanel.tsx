/**
 * The Market Narrative for one symbol: the deterministic state the analyst is
 * told to restate. Reading it costs no AI request.
 *
 * `compact` is the /ai side column: one column throughout, the nearest flip
 * conditions shown and the rest folded away, and "what changed" folded under
 * its headline, so the state reads at a glance beside the chat.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { FLIPS } from '@/config/narrative.config';
import { Panel } from '@/components/ui';
import { ChangeList, FlipList, SectionLabel, ThemeRow, VerdictBadge } from '@/components/narrative';
import type { PairNarrative } from '@/lib/analysis/state';

/** Flip conditions shown before "show more" in the compact column. */
const COMPACT_FLIPS = 3;

function More({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group mt-1">
      <summary className="cursor-pointer list-none text-micro text-[var(--color-muted)] hover:text-[var(--color-text)]">
        <span className="group-open:hidden">▸ {label}</span>
        <span className="hidden group-open:inline">▾ Show less</span>
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}

export function NarrativePanel({
  pair,
  computedAtUtc,
  children,
  compact = false,
}: {
  pair: PairNarrative;
  computedAtUtc: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  const against = pair.flips.filter((f) => f.role !== 'confirm').slice(0, FLIPS.shown);
  const confirms = pair.flips.filter((f) => f.role === 'confirm').slice(0, 4);
  const neutral = pair.tactical.label === 'NEUTRAL';
  const shownAgainst = compact ? against.slice(0, COMPACT_FLIPS) : against;

  return (
    <Panel
      title="Market narrative"
      subtitle={`A rule-based read of the week as of ${computedAtUtc.slice(11, 16)} UTC. Separate from the board score.`}
      action={
        <Link href="/narrative" className="text-micro text-[var(--color-muted)] hover:text-[var(--color-text)]">
          All economies
        </Link>
      }
    >
      <div className={`flex flex-col ${compact ? 'gap-3 px-3 py-3' : 'gap-4 px-4 py-4'}`}>
        <div className="grid grid-cols-2 gap-3">
          <VerdictBadge verdict={pair.tactical} horizon={compact ? 'Tactical · ≤2 weeks' : 'Tactical · days to 2 weeks'} />
          <VerdictBadge verdict={pair.structural} horizon={compact ? 'Structural · 1–3 months' : 'Structural · 1 to 3 months'} />
        </div>

        {children}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <SectionLabel>Themes{pair.quote ? ` · ${pair.base} − ${pair.quote}` : ''}</SectionLabel>
            <span className="text-[10px] text-[var(--color-faint)]">tactical · structural</span>
          </div>
          <div>
            {pair.themes.map((t) => (
              <ThemeRow key={t.id} pair={pair} theme={t} />
            ))}
          </div>
        </div>

        <div className={compact ? 'flex flex-col gap-3' : 'grid gap-4 md:grid-cols-2'}>
          <div>
            <SectionLabel>What would {neutral ? 'tip' : 'flip'} it</SectionLabel>
            <div className="mt-1">
              <FlipList flips={shownAgainst} />
              {compact && against.length > COMPACT_FLIPS && (
                <More label={`${against.length - COMPACT_FLIPS} more`}>
                  <FlipList flips={against.slice(COMPACT_FLIPS)} />
                </More>
              )}
            </div>
          </div>
          {(!compact || confirms.length > 0) && (
            <div>
              <SectionLabel>What would confirm it</SectionLabel>
              <div className="mt-1">
                <FlipList flips={confirms} empty={neutral ? 'A neutral verdict has nothing to confirm.' : undefined} />
              </div>
            </div>
          )}
        </div>

        {compact ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between">
              <SectionLabel>What changed this week</SectionLabel>
              <span className="text-micro text-[var(--color-muted)] group-open:hidden">
                {pair.changes.length ? `${pair.changes.length} change${pair.changes.length === 1 ? '' : 's'} ▸` : 'none ▸'}
              </span>
            </summary>
            <div className="mt-1">
              <ChangeList changes={pair.changes} basis={pair.changeBasis} />
            </div>
          </details>
        ) : (
          <div>
            <SectionLabel>What changed this week</SectionLabel>
            <div className="mt-1">
              <ChangeList changes={pair.changes} basis={pair.changeBasis} />
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
