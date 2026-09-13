/**
 * Instant loading state for every route.
 *
 * Every page here is `force-dynamic` and awaits the setups pipeline — a 150-day
 * calendar, thirteen COT contracts and dozens of price series — so a first load
 * can take several seconds. Before this file existed that was a blank screen
 * with no sign anything was happening. Next streams this skeleton immediately
 * and swaps the page in when it resolves.
 */

import { Skeleton } from '@/components/ui';

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] p-3 md:p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="table-head h-10" />
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-[var(--color-border)] px-4 py-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
