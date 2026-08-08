'use client';

/**
 * Twelve-month seasonal profile.
 *
 * Bars are the 10-year mean return for each calendar month; the number beneath
 * is the win rate. Both are shown because either alone is misleading — a +2%
 * average from one outlier year is not a tendency, and an 80% win rate on
 * moves of 0.05% is not tradeable.
 *
 * Months with no data render as an explicit gap rather than a zero bar. Yahoo's
 * monthly series has genuine holes (October is routinely missing), and drawing
 * those as flat months would invent a seasonal pattern.
 */

import { Panel } from '@/components/ui';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function SeasonalityStrip({
  seasonality,
}: {
  seasonality: Record<number, { meanPct: number; winRatePct: number; years: number }>;
}) {
  const currentMonth = new Date().getUTCMonth() + 1;

  const values = Object.values(seasonality).map((s) => Math.abs(s.meanPct));
  const max = Math.max(...values, 0.5); // floor keeps quiet symbols from looking dramatic

  return (
    <Panel
      title="Seasonality"
      subtitle="Average monthly return over 10 years, with win rate"
    >
      <div className="flex items-end gap-1 px-4 pt-4">
        {MONTHS.map((label, i) => {
          const month = i + 1;
          const stats = seasonality[month];
          const isCurrent = month === currentMonth;

          if (!stats) {
            return (
              <div key={month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-20 w-full items-center justify-center">
                  <span className="text-[9px] text-[var(--color-faint)]">—</span>
                </div>
                <span className="text-[9px] text-[var(--color-faint)]">{label}</span>
                <span className="text-[8px] text-[var(--color-faint)]">no data</span>
              </div>
            );
          }

          const height = Math.max((Math.abs(stats.meanPct) / max) * 40, 2);
          const positive = stats.meanPct >= 0;

          return (
            <div
              key={month}
              className="flex flex-1 flex-col items-center gap-1"
              title={`${MONTH_FULL[i]}: ${stats.meanPct > 0 ? '+' : ''}${stats.meanPct}% average, higher ${stats.winRatePct}% of the time (${stats.years} years)`}
            >
              {/* Fixed 80px band with a centre line, so up and down bars share a baseline. */}
              <div className="relative flex h-20 w-full flex-col justify-center">
                <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--color-border)]" />
                <div
                  className="absolute inset-x-0.5 rounded-sm"
                  style={{
                    height: `${height}px`,
                    bottom: positive ? '50%' : undefined,
                    top: positive ? undefined : '50%',
                    backgroundColor: positive ? 'rgba(38,208,164,0.75)' : 'rgba(242,80,110,0.75)',
                    outline: isCurrent ? '1px solid var(--color-text)' : undefined,
                  }}
                />
              </div>
              <span
                className={`text-[9px] ${isCurrent ? 'font-bold text-[var(--color-text)]' : 'text-[var(--color-faint)]'}`}
              >
                {label}
              </span>
              <span className="tnum text-[8px] text-[var(--color-faint)]">{stats.winRatePct}%</span>
            </div>
          );
        })}
      </div>

      <p className="px-4 py-3 text-[10px] leading-relaxed text-[var(--color-faint)]">
        Current month outlined. Percentages beneath each bar are how often that month closed higher.
        Months marked &ldquo;no data&rdquo; are gaps in the upstream price history, not flat months.
      </p>
    </Panel>
  );
}
