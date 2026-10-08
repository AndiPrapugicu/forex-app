/**
 * The Market Narrative for one symbol, above the AI chat: the deterministic
 * state the analyst is told to restate. Reading it costs no AI request.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { FLIPS } from '@/config/narrative.config';
import { Panel } from '@/components/ui';
import { ChangeList, FlipList, SectionLabel, ThemeRow, VerdictBadge } from '@/components/narrative';
import type { PairNarrative } from '@/lib/analysis/state';

export function NarrativePanel({ pair, computedAtUtc, children }: { pair: PairNarrative; computedAtUtc: string; children?: ReactNode }) {
  const against = pair.flips.filter((f) => f.role !== 'confirm');
  const confirms = pair.flips.filter((f) => f.role === 'confirm');

  return (
    <Panel
      title="Market narrative"
      subtitle={`Deterministic read of the week · ${computedAtUtc.slice(11, 16)} UTC · not the board score`}
      action={
        <Link href="/narrative" className="text-micro text-[var(--color-muted)] hover:text-[var(--color-text)]">
          Every economy →
        </Link>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <VerdictBadge verdict={pair.tactical} horizon="Tactical · days to 2 weeks" />
          <VerdictBadge verdict={pair.structural} horizon="Structural · 1 to 3 months" />
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

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <SectionLabel>What would {pair.tactical.label === 'NEUTRAL' ? 'tip' : 'flip'} it</SectionLabel>
            <div className="mt-1">
              <FlipList flips={against.slice(0, FLIPS.shown)} />
            </div>
          </div>
          <div>
            <SectionLabel>What would confirm it</SectionLabel>
            <div className="mt-1">
              <FlipList flips={confirms.slice(0, 4)} empty={pair.tactical.label === 'NEUTRAL' ? 'A neutral verdict has nothing to confirm.' : undefined} />
            </div>
          </div>
        </div>

        <div>
          <SectionLabel>What changed this week</SectionLabel>
          <div className="mt-1">
            <ChangeList changes={pair.changes} basis={pair.changeBasis} />
          </div>
        </div>
      </div>
    </Panel>
  );
}
