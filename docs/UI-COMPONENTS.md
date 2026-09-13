# UI components

The design system added 2026-09-13. Presentation only — nothing here changes a number.

## Tokens — `app/globals.css`

- **Surfaces:** `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-zebra`, `--color-border`, `--color-border-bright`.
- **Text:** `--color-text`, `--color-muted`, `--color-faint`. Table headers use `.table-head` (pale fill, dark text).
- **Direction:** `--color-bull` / `--color-bear` for status labels; `--color-bull-cell` / `--color-bear-cell` for
  cell fills and chart bars. Amber `--color-uncertain` means *uncertain*, never *slightly bad*.
- **`-rgb` tokens are space-separated** — use `rgb(var(--x) / 55%)`, never `rgba(var(--x), .55)`.
- **Type scale:** `text-micro`, `text-caption`, `text-small`, `text-body`, `text-title`. The floor rises below
  768px. Do not add `text-[Npx]`.
- **Radius:** `--radius-card`, `--radius-control`, `--radius-pill`. **z-index:** `--z-sticky` … `--z-popover`.
- Lightweight Charts (canvas) cannot read CSS variables; `PriceChart.tsx` keeps literal hex copies.

## Page shell

Every page: `mx-auto w-full max-w-[1800px] px-3 py-4 md:px-6 md:py-6`, then `PageHeader`, then panels.
Server page fetches (`runSetupsPipeline()` is cached — extra pages cost no upstream request), flattens Maps to
arrays, and hands plain props to a client component.

## Primitives

| Component | File | Use |
|---|---|---|
| `PageHeader` | `components/primitives.tsx` | title, one-line description, `info` disclosure, `updated` chip, `actions` slot |
| `Explain` | `components/primitives.tsx` | tap-and-hover disclosure with a 44px target. **Use instead of `title=`**, which a touch screen cannot open |
| `Legend`, `SignedBar`, `MetricDescription` | `components/primitives.tsx` | chart key; centre-anchored bar; prose block under a chart |
| `Panel` | `components/ui.tsx` | card with header. Body is unpadded unless `padded` |
| `DataTable` | `components/DataTable.tsx` | see below |
| `Sparkline`, `MetricBars`, `StackedBar`, `DivergingRow`, `BandedLine` | `components/charts.tsx` | inline SVG, no hooks, usable from a server page |

## DataTable

One column definition, two renderings: a sortable grid with a sticky pale header and sticky first column from
`md` up, and a card per row below it with a sort picker.

```tsx
const COLUMNS: Column<Row>[] = [
  { key: 'symbol', label: 'Symbol', align: 'left', sticky: true, hideOnCards: true,
    sortValue: (r) => r.symbol, defaultDir: 'asc', render: (r) => r.symbol },
  { key: 'net', label: 'Net', explain: 'Longs minus shorts.', sortValue: (r) => r.net, render: (r) => r.net },
];

<DataTable caption="COT" columns={COLUMNS} rows={rows} rowKey={(r) => r.symbol}
  defaultSort={{ key: 'net', dir: 'desc' }} cardTitle={(r) => r.symbol}
  expand={(r) => r.sentence} divider={(row, prev, sort) => null} />
```

- Columns hold functions, so **a `DataTable` must be rendered from a `'use client'` component**, never directly
  from a server page.
- Missing values (`null`, `undefined`, `NaN`) sort last in both directions — `lib/ui/sort.ts`, tested.
- `divider` gets the previous row in the *current* order, so a separator can appear only where the ordering
  makes it true.

## Mobile rules

- Tap targets ≥ 44px (`min-h-11`) below `md`; controls may shrink to `md:min-h-9`.
- Use `dvh`, not `vh`, for any height tied to the viewport.
- Filters that would push content below the fold fold behind a toggle (`SetupsMatrix`).
- Navigation: grouped sidebar from `lg`; below it a drawer plus a bottom tab bar (`components/Sidebar.tsx`).
  The most specific link is the active one.
