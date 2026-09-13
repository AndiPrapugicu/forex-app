'use client';

/**
 * The one table.
 *
 * Twelve hand-written tables had three sort mechanisms, three hover alphas and
 * no phone layout — a 13-column COT table scrolled its own symbol off a 375px
 * screen. This renders the same column definitions two ways:
 *
 *  - md and up: a grid with A1's pale sticky header, a sticky first column,
 *    click-to-sort headers and zebra rows;
 *  - below md: one card per row, title first, the remaining columns as
 *    label/value pairs, with a sort picker in place of clickable headers.
 *
 * Column explanations use `Explain`, never `title=`, so they open on a tap.
 */

import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Explain } from '@/components/primitives';
import { nextSort, sortRows, type SortDir, type SortValue } from '@/lib/ui/sort';

export interface Column<T> {
  key: string;
  label: ReactNode;
  /** Plain-text label for the phone sort picker and aria; defaults to `label` when it is a string. */
  textLabel?: string;
  explain?: ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Present means sortable. */
  sortValue?: (row: T) => SortValue;
  /** First click direction. Defaults to desc for sortable columns, which suits numbers. */
  defaultDir?: SortDir;
  render: (row: T) => ReactNode;
  /** Pin to the left edge while the grid scrolls sideways. Use on the first column only. */
  sticky?: boolean;
  /** Leave out of the phone card, e.g. the column already used as the card title. */
  hideOnCards?: boolean;
  /** Extra classes for this column's body cells. */
  className?: string;
  /**
   * Per-row cell paint, A1's heat highlighting (`lib/ui/heat.ts`). Applied to
   * the cell itself so the fill covers its padding and wins over zebra/hover.
   */
  cellStyle?: (row: T) => CSSProperties;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  defaultSort?: { key: string; dir: SortDir } | null;
  /** Card heading on a phone. Defaults to the first column's render. */
  cardTitle?: (row: T) => ReactNode;
  /** Right-aligned card heading slot, e.g. a score. */
  cardAside?: (row: T) => ReactNode;
  /** Detail shown under a row when it is tapped. Returning null makes the row inert. */
  expand?: (row: T) => ReactNode | null;
  /**
   * A full-width separator row before `row` — e.g. "net sellers below". Gets the
   * row above it in the CURRENT order and the active sort, so a divider can
   * appear only where the ordering makes it true.
   */
  divider?: (row: T, prev: T | undefined, sort: { key: string; dir: SortDir } | null) => ReactNode | null;
  /** Caps the grid's height so its header stays in view. CSS length. */
  maxHeight?: string;
  empty?: ReactNode;
  /** Accessible name for the table. */
  caption: string;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function textOf<T>(col: Column<T>): string {
  return col.textLabel ?? (typeof col.label === 'string' ? col.label : col.key);
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  defaultSort = null,
  cardTitle,
  cardAside,
  expand,
  divider,
  maxHeight,
  empty,
  caption,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(defaultSort);
  const [open, setOpen] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    return col?.sortValue ? sortRows(rows, col.sortValue, sort!.dir) : [...rows];
  }, [rows, columns, sort]);

  const sortable = columns.filter((c) => c.sortValue);

  if (rows.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-small text-[var(--color-muted)]">{empty ?? 'No data'}</div>
    );
  }

  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));

  return (
    <>
      {/* ---------------------------------------------------------- phone */}
      <div className="md:hidden">
        {sortable.length > 0 && (
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <label className="text-caption text-[var(--color-faint)]" htmlFor={`${caption}-sort`}>
              Sort
            </label>
            <select
              id={`${caption}-sort`}
              value={sort?.key ?? ''}
              onChange={(e) => {
                const col = columns.find((c) => c.key === e.target.value);
                setSort(col ? { key: col.key, dir: col.defaultDir ?? 'desc' } : null);
              }}
              className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-small outline-none"
            >
              {!defaultSort && <option value="">Default order</option>}
              {sortable.map((c) => (
                <option key={c.key} value={c.key}>
                  {textOf(c)}
                </option>
              ))}
            </select>
            {sort && (
              <button
                type="button"
                onClick={() => setSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
                aria-label={sort.dir === 'asc' ? 'Ascending, tap for descending' : 'Descending, tap for ascending'}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] text-small"
              >
                {sort.dir === 'asc' ? '↑' : '↓'}
              </button>
            )}
          </div>
        )}
        <ul className="flex flex-col divide-y divide-[var(--color-border)]" aria-label={caption}>
          {sorted.map((row, i) => {
            const key = rowKey(row);
            const detail = expand?.(row) ?? null;
            const isOpen = open === key && detail !== null;
            const sep = divider?.(row, sorted[i - 1], sort);
            const head = (
              <>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {cardTitle ? cardTitle(row) : columns[0].render(row)}
                </span>
                {cardAside && <span className="shrink-0">{cardAside(row)}</span>}
              </>
            );
            return (
              <Fragment key={key}>
                {sep && (
                  <li className="bg-[var(--color-surface-2)] px-3 py-1.5 text-micro tracking-wider text-[var(--color-faint)] uppercase">
                    {sep}
                  </li>
                )}
                <li className="px-3 py-3">
                  {detail !== null ? (
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggle(key)}
                      className="flex min-h-11 w-full items-center gap-3 text-left text-body"
                    >
                      {head}
                      <span aria-hidden className={`text-[var(--color-faint)] transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                        ›
                      </span>
                    </button>
                  ) : (
                    <div className="flex min-h-11 items-center gap-3 text-body">{head}</div>
                  )}
                  <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {columns
                      .filter((c) => !c.hideOnCards)
                      .map((c) => (
                        <div key={c.key} className="flex min-w-0 items-baseline justify-between gap-2">
                          <dt className="shrink-0 text-caption text-[var(--color-faint)]">{textOf(c)}</dt>
                          <dd
                            className={`tnum min-w-0 text-right text-small ${c.cellStyle ? 'rounded px-1.5' : ''} ${c.className ?? ''}`}
                            style={c.cellStyle?.(row)}
                          >
                            {c.render(row)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  {isOpen && <div className="mt-3 text-small text-[var(--color-muted)]">{detail}</div>}
                </li>
              </Fragment>
            );
          })}
        </ul>
      </div>

      {/* ------------------------------------------------------ md and up */}
      <div className="hidden overflow-auto md:block" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full border-separate border-spacing-0 text-small">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const align = ALIGN[c.align ?? 'right'];
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={`table-head sticky top-0 border-b border-[var(--color-border)] px-2.5 py-2 text-caption font-semibold whitespace-nowrap ${align} ${
                      c.sticky ? 'left-0' : ''
                    }`}
                    style={{ zIndex: c.sticky ? 'calc(var(--z-sticky) + 1)' : 'var(--z-sticky)' }}
                  >
                    <span className={`inline-flex items-center gap-1 ${c.align === 'right' || !c.align ? 'flex-row-reverse' : ''}`}>
                      {c.sortValue ? (
                        <button
                          type="button"
                          onClick={() => setSort((s) => nextSort(s, c.key, c.defaultDir ?? 'desc'))}
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          {c.label}
                          <span aria-hidden className={active ? '' : 'opacity-30'}>
                            {active && sort!.dir === 'asc' ? '▲' : '▼'}
                          </span>
                        </button>
                      ) : (
                        c.label
                      )}
                      {c.explain && (
                        <Explain label={`About ${textOf(c)}`}>
                          <span className="font-normal normal-case">{c.explain}</span>
                        </Explain>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const key = rowKey(row);
              const detail = expand?.(row) ?? null;
              const isOpen = open === key && detail !== null;
              const sep = divider?.(row, sorted[i - 1], sort);
              return (
                <Fragment key={key}>
                  {sep && (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="border-y border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1 text-micro tracking-wider text-[var(--color-faint)] uppercase"
                      >
                        {sep}
                      </td>
                    </tr>
                  )}
                  <tr
                    className={`group ${detail !== null ? 'cursor-pointer' : ''}`}
                    onClick={detail !== null ? () => toggle(key) : undefined}
                    aria-expanded={detail !== null ? isOpen : undefined}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`tnum border-b border-[var(--color-border)]/60 bg-[var(--color-surface)] px-2.5 py-2 whitespace-nowrap group-even:bg-[var(--color-zebra)] group-hover:bg-[var(--color-surface-2)] ${
                          ALIGN[c.align ?? 'right']
                        } ${c.sticky ? 'sticky left-0' : ''} ${c.className ?? ''}`}
                        style={{
                          ...(c.sticky ? { zIndex: 'var(--z-sticky)' } : {}),
                          ...(c.cellStyle?.(row) ?? {}),
                        }}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="border-b border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 text-small text-[var(--color-muted)]"
                      >
                        {detail}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
