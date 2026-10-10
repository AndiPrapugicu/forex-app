'use client';

/**
 * The /ai symbol picker: every symbol with its board score, and a filter to
 * show only the bullish or bearish ones.
 * The filtering rules are in lib/ui/symbol-filter.ts.
 */

import { useEffect, useState } from 'react';
import { SymbolSelect, type SwitcherOption } from '@/components/SymbolSelect';
import { filterByBias, matchesBias, type BiasFilter } from '@/lib/ui/symbol-filter';

type Filter = BiasFilter;

const STORAGE_KEY = 'ai-analysis:filter';

export function AiSymbolPicker({ symbol, options }: { symbol: string; options: SwitcherOption[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as Filter | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
      if (saved === 'bullish' || saved === 'bearish' || saved === 'neutral') setFilter(saved);
    } catch {
      // storage blocked: the filter just starts at All
    }
  }, []);

  const choose = (next: Filter) => {
    setFilter(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not remembered, still applied
    }
  };

  const count = (f: Filter) => options.filter((o) => matchesBias(o, f)).length;
  const scored = options.some((o) => o.score !== undefined);

  return (
    <div className="flex min-w-0 items-center gap-2">
      {scored && (
        <select
          value={filter}
          onChange={(e) => choose(e.target.value as Filter)}
          aria-label="Filter symbols by bias"
          className="hidden rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-xs outline-none hover:border-[var(--color-border-bright)] sm:block"
        >
          <option value="all">All ({options.length})</option>
          <option value="bullish">Bullish only ({count('bullish')})</option>
          <option value="bearish">Bearish only ({count('bearish')})</option>
          <option value="neutral">Neutral ({count('neutral')})</option>
        </select>
      )}
      <SymbolSelect
        symbol={symbol}
        options={filterByBias(options, filter, symbol)}
        hrefTemplate="/ai?symbol={symbol}"
        className="min-w-0 max-w-full py-1 text-xs"
      />
    </div>
  );
}
