/**
 * Table sorting, kept out of the component so it can be tested.
 *
 * The one rule that matters: a MISSING value sinks to the bottom whichever way
 * the column is sorted. Sorting nulls as zero put every contract with no prior
 * week in the middle of a flow table, reading as "nothing happened" when the
 * truth was "we cannot say". The COT table already did this by hand; every table
 * now gets it for free.
 */

export type SortDir = 'asc' | 'desc';
export type SortValue = number | string | null | undefined;

function isMissing(v: SortValue): v is null | undefined {
  return v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));
}

export function compareSortValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  const sign = dir === 'asc' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * sign;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * sign;
}

/** A new array; stable, so equal rows keep the order the page supplied. */
export function sortRows<T>(rows: readonly T[], get: (row: T) => SortValue, dir: SortDir): T[] {
  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((x, y) => compareSortValues(x.value, y.value, dir) || x.index - y.index)
    .map((x) => x.row);
}

/**
 * Clicking a header: a new column starts at its default direction (numbers read
 * largest first, text A→Z), the same column flips.
 */
export function nextSort(
  current: { key: string; dir: SortDir } | null,
  clicked: string,
  defaultDir: SortDir,
): { key: string; dir: SortDir } {
  if (!current || current.key !== clicked) return { key: clicked, dir: defaultDir };
  return { key: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}
