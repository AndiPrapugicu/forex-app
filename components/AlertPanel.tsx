'use client';

/**
 * Alert feed, market mood strip, and the source-health bar.
 *
 * Every alert carries its sources and a corroboration state. An uncorroborated
 * story is visually marked as such rather than quietly ranked lower — the user
 * should be able to tell "three outlets confirm this" from "one outlet claims
 * this" without clicking through.
 */

import type { Alert, NewsCluster, SourceHealth } from '@/lib/types';
import { EmptyState, Panel, SEVERITY_STYLE, timeAgo } from '@/components/ui';

export function AlertPanel({ alerts, now }: { alerts: Alert[]; now: number }) {
  return (
    <Panel
      title="Alerts"
      subtitle={alerts.length ? `${alerts.length} recent` : undefined}
      action={
        alerts.some((a) => a.severity === 'critical') ? (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-critical)]">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--color-critical)]" />
            CRITICAL
          </span>
        ) : null
      }
    >
      {alerts.length === 0 ? (
        <EmptyState message="No active alerts" hint="Alerts fire on surprises, escalation and high-impact releases" />
      ) : (
        <ul className="max-h-[28rem] divide-y divide-[var(--color-border)] overflow-y-auto">
          {alerts.map((a) => {
            const style = SEVERITY_STYLE[a.severity];
            return (
              <li key={a.hash} className={`border-l-2 px-4 py-2.5 ${style.border}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm leading-snug font-medium text-[var(--color-text)]">{a.title}</p>
                  <span className="tnum shrink-0 text-[10px] text-[var(--color-faint)]">
                    {timeAgo(a.createdUtc, now)}
                  </span>
                </div>

                <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">{a.body}</p>

                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className={`text-[10px] font-semibold ${style.text}`}>{style.label}</span>

                  {/* The corroboration state is the most important thing on the
                      row after the headline itself. */}
                  {a.highConfidence ? (
                    <span className="text-[10px] text-[var(--color-bull)]">✓ corroborated</span>
                  ) : (
                    <span className="text-[10px] text-[var(--color-uncertain)]">⚠ single source</span>
                  )}

                  {a.affects.length > 0 && (
                    <span className="font-mono text-[10px] text-[var(--color-faint)]">
                      {a.affects.join(' ')}
                    </span>
                  )}

                  {a.sources.slice(0, 3).map((s, i) => (
                    <a
                      key={`${s.url}-${i}`}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-[var(--color-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-text)]"
                    >
                      {s.name}
                    </a>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function MarketMood({
  mood,
  generatedAtUtc,
}: {
  mood: { score: number; label: string; confidence: number };
  generatedAtUtc: string;
}) {
  const color =
    mood.confidence < 40
      ? 'var(--color-uncertain)'
      : mood.score > 0.5
        ? 'var(--color-bull)'
        : mood.score < -0.5
          ? 'var(--color-bear)'
          : 'var(--color-neutral)';

  // -10..+10 mapped onto a full-width bar with centre at zero.
  const pct = ((Math.max(-10, Math.min(10, mood.score)) + 10) / 20) * 100;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-[10px] tracking-wider text-[var(--color-faint)] uppercase">
            Market mood
          </span>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-xl font-bold" style={{ color }}>
              {mood.label}
            </span>
            <span className="tnum text-sm" style={{ color }}>
              {mood.score > 0 ? '+' : ''}
              {mood.score}
            </span>
          </div>
        </div>
        <div className="text-right">
          <span className="tnum block text-[10px] text-[var(--color-faint)]">
            conf {mood.confidence}
          </span>
          <span className="tnum block text-[10px] text-[var(--color-faint)]">
            {generatedAtUtc.slice(11, 16)} UTC
          </span>
        </div>
      </div>

      <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-[var(--color-border-bright)]" />
        <div
          className="absolute top-0 bottom-0 w-1.5 rounded-full transition-all"
          style={{ left: `calc(${pct}% - 3px)`, backgroundColor: color }}
        />
      </div>

      <div className="mt-1 flex justify-between text-[9px] tracking-wide text-[var(--color-faint)] uppercase">
        <span>Risk-off</span>
        <span>Risk-on</span>
      </div>
    </div>
  );
}

/**
 * Source health.
 *
 * Deliberately always visible rather than hidden behind a menu: if FXStreet is
 * down, every score on the page is thinner than it looks, and the user needs to
 * know that without going looking for it.
 */
export function SourceHealthBar({ health }: { health: SourceHealth[] }) {
  const down = health.filter((h) => !h.ok);
  const degraded = health.filter((h) => h.ok && h.detail);

  if (down.length === 0 && degraded.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-faint)]">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--color-bull)]" />
        All {health.length} sources live
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
      {down.map((h) => (
        <span key={h.source} className="flex items-center gap-1 text-[var(--color-bear)]" title={h.detail}>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-bear)]" />
          {h.source} down
        </span>
      ))}
      {degraded.map((h) => (
        <span key={h.source} className="flex items-center gap-1 text-[var(--color-uncertain)]" title={h.detail}>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-uncertain)]" />
          {h.source} degraded
        </span>
      ))}
    </div>
  );
}

/** Corroborated news clusters, ranked by how many outlets carry them. */
export function NewsPanel({ clusters, now }: { clusters: NewsCluster[]; now: number }) {
  const notable = clusters.filter((c) => c.domainCount > 1 || c.items[0].matchedKeywords.length > 0);

  return (
    <Panel title="News flow" subtitle="Grouped by story, ranked by independent sources">
      {notable.length === 0 ? (
        <EmptyState message="No notable stories" />
      ) : (
        <ul className="max-h-96 divide-y divide-[var(--color-border)] overflow-y-auto">
          {notable.slice(0, 15).map((c) => (
            <li key={c.id} className="px-4 py-2">
              <div className="flex items-start justify-between gap-2">
                <a
                  href={c.items[0].url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] leading-snug text-[var(--color-text)] hover:underline"
                >
                  {c.headline}
                </a>
                <span className="tnum shrink-0 text-[10px] text-[var(--color-faint)]">
                  {timeAgo(c.lastSeenUtc, now)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                <span
                  className={
                    c.domainCount >= 3
                      ? 'font-medium text-[var(--color-bull)]'
                      : 'text-[var(--color-faint)]'
                  }
                >
                  {c.domainCount} source{c.domainCount === 1 ? '' : 's'}
                </span>
                <span className="text-[var(--color-faint)]">{c.category}</span>
                {c.items[0].matchedKeywords.slice(0, 3).map((k) => (
                  <span key={k} className="rounded bg-[var(--color-surface-2)] px-1 text-[var(--color-muted)]">
                    {k}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
