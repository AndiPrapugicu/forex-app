'use client';

/**
 * Currency strength strip and the pair matrix.
 *
 * The matrix is the fastest way to answer "which pair should I be looking at" —
 * it shows all base/quote combinations at once, so the strongest and weakest
 * legs jump out without reading eight separate numbers.
 */

import Link from 'next/link';
import { MAJORS, type CurrencyStrength, type PairScore } from '@/lib/types';
import { ScoreBar } from '@/components/Gauge';
import { CurrencyChip, EmptyState, Panel, formatScore, scoreColor } from '@/components/ui';

export function CurrencyStrengthPanel({ strengths }: { strengths: CurrencyStrength[] }) {
  // Strongest first — the ranking IS the information.
  const sorted = [...strengths].sort((a, b) => b.score - a.score);
  const anyData = sorted.some((s) => s.contributors > 0);

  return (
    <Panel title="Currency strength" subtitle="Weighted by recency and confidence, 72h window">
      {!anyData ? (
        <EmptyState
          message="No scored releases in the last 72 hours"
          hint="Strength appears once events print with an actual value"
        />
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {sorted.map((s) => (
            <div key={s.currency} className="flex items-center gap-3 px-4 py-2.5">
              <CurrencyChip currency={s.currency} />

              <div className="flex-1">
                <ScoreBar score={s.score} direction={s.direction} confidence={s.confidence} width={160} />
              </div>

              <span className={`tnum w-12 text-right text-sm font-semibold ${scoreColor(s.score, s.direction)}`}>
                {s.contributors === 0 ? '—' : formatScore(s.score)}
              </span>

              {/* Contributor count is the honesty column: a big score off one
                  event should not read the same as one off six. */}
              <span
                className="tnum w-14 text-right text-[11px] text-[var(--color-faint)]"
                title={`${s.contributors} scored release${s.contributors === 1 ? '' : 's'}, confidence ${s.confidence}`}
              >
                {s.contributors === 0 ? 'no data' : `${s.contributors}ev · ${s.confidence}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * Full base/quote matrix.
 *
 * Every cell is base-strength minus quote-strength, so the grid is
 * antisymmetric: EUR/USD and USD/EUR are mirror images. That redundancy is
 * deliberate — it lets the eye scan a row for "how is EUR doing against
 * everything" and a column for the inverse without mental arithmetic.
 */
export function PairMatrix({ strengths }: { strengths: CurrencyStrength[] }) {
  const byCurrency = new Map(strengths.map((s) => [s.currency, s]));
  const anyData = strengths.some((s) => s.contributors > 0);

  function cell(base: string, quote: string) {
    if (base === quote) return null;
    const b = byCurrency.get(base as (typeof MAJORS)[number]);
    const q = byCurrency.get(quote as (typeof MAJORS)[number]);
    if (!b || !q || (b.contributors === 0 && q.contributors === 0)) return null;

    const score = Math.round((b.score - q.score) * 0.5 * 10) / 10;
    const confidence = Math.min(b.confidence, q.confidence);
    return { score, confidence };
  }

  return (
    <Panel title="Pair matrix" subtitle="Row currency vs column currency">
      {!anyData ? (
        <EmptyState message="Not enough data to build the matrix" />
      ) : (
        <div className="overflow-x-auto p-3">
          <table className="w-full border-separate border-spacing-0.5 text-center">
            <thead>
              <tr>
                <th className="w-10" />
                {MAJORS.map((c) => (
                  <th key={c} className="pb-1 font-mono text-[10px] font-semibold text-[var(--color-faint)]">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MAJORS.map((base) => (
                <tr key={base}>
                  <td className="pr-1 text-right font-mono text-[10px] font-semibold text-[var(--color-faint)]">
                    {base}
                  </td>
                  {MAJORS.map((quote) => {
                    const c = cell(base, quote);

                    if (base === quote) {
                      return <td key={quote} className="h-8 rounded bg-[var(--color-bg)]" />;
                    }
                    if (!c) {
                      return (
                        <td key={quote} className="h-8 rounded bg-[var(--color-surface-2)]/40 text-[10px] text-[var(--color-faint)]">
                          —
                        </td>
                      );
                    }

                    // Intensity encodes magnitude; hue encodes direction. Low
                    // confidence goes amber so it cannot be misread as a
                    // confident call.
                    const intensity = Math.min(Math.abs(c.score) / 6, 1);
                    const uncertain = c.confidence < 40;
                    const rgb = uncertain
                      ? 'var(--color-uncertain-rgb)'
                      : c.score > 0
                        ? 'var(--color-bull-rgb)'
                        : 'var(--color-bear-cell-rgb)';

                    return (
                      <td
                        key={quote}
                        className="tnum h-8 rounded text-[11px] font-semibold"
                        style={{
                          backgroundColor: `rgb(${rgb} / ${(0.08 + intensity * 0.42) * 100}%)`,
                          color: intensity > 0.35 ? `rgb(${rgb})` : 'var(--color-muted)',
                        }}
                        title={`${base}/${quote} score ${formatScore(c.score)}, confidence ${c.confidence}${uncertain ? ' (below threshold — treat as uncertain)' : ''}`}
                      >
                        {c.score === 0 ? '0' : formatScore(c.score)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function TrackedPairsPanel({ pairs }: { pairs: PairScore[] }) {
  // Strongest conviction first, but only among pairs we are willing to call.
  const sorted = [...pairs].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const anyData = sorted.some((p) => p.confidence > 0);

  return (
    <Panel title="Tracked pairs" subtitle="Ranked by conviction">
      {!anyData ? (
        <EmptyState message="No pair signals yet" />
      ) : (
        <div className="grid grid-cols-2 gap-px bg-[var(--color-border)] sm:grid-cols-3">
          {sorted.map((p) => (
            <Link
              key={p.pair}
              href={`/?pair=${p.pair}`}
              className="flex flex-col gap-1.5 bg-[var(--color-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--color-surface-2)]"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-[var(--color-text)]">
                  {p.base}/{p.quote}
                </span>
                <span className={`tnum text-sm font-bold ${scoreColor(p.score, p.direction)}`}>
                  {p.confidence === 0 ? '—' : formatScore(p.score)}
                </span>
              </div>
              <ScoreBar score={p.score} direction={p.direction} confidence={p.confidence} width={100} height={6} />
              <span className="text-[10px] text-[var(--color-faint)]">
                {p.confidence === 0 ? 'no data' : p.direction === 'uncertain' ? 'uncertain' : `conf ${p.confidence}`}
              </span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
