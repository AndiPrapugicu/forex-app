# UI components

The design system added 2026-09-13. Presentation only — nothing here changes a number.

## Tokens — `app/globals.css`

- **Surfaces:** `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-zebra`, `--color-border`, `--color-border-bright`.
- **Text:** `--color-text`, `--color-muted`, `--color-faint`. Table headers use `.table-head` (grey
  `--color-head` fill, `--color-head-text` text — never a white bar).
- **Heat scale:** `lib/ui/heat.ts` `heatStyle(value, { max?, zeroGrey?, deadband? })` is A1's cell colouring:
  solid blue (`--color-heat-bull-rgb`) or red (`--color-heat-bear-rgb`) for discrete scores, grey
  (`--color-heat-zero`) for a measured 0, transparent for null; with `max`, alpha runs 0.3→1 by |v|/max and text
  turns white from 0.55. `DataTable` columns take `cellStyle: (row) => heatStyle(...)` to colour a cell.
- **Direction:** `--color-bull` / `--color-bear` for status labels; `--color-bull-cell` / `--color-bear-cell` for
  cell fills and chart bars. Amber `--color-uncertain` means *uncertain*, never *slightly bad*.
- **`-rgb` tokens are space-separated** — use `rgb(var(--x) / 55%)`, never `rgba(var(--x), .55)`.
- **Type scale:** `text-micro`, `text-caption`, `text-small`, `text-body`, `text-title`. The floor rises below
  768px. Do not add `text-[Npx]`.
- **Radius:** `--radius-card`, `--radius-control`, `--radius-pill`. **z-index:** `--z-sticky` … `--z-popover`.

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
| `Sparkline`, `MetricBars`, `StackedBar`, `DivergingRow`, `BandedLine`, `DivergingBars`, `StackedTimeBars` | `components/charts.tsx` | inline SVG, no hooks, usable from a server page |
| `OptionsSymbolNav` | `components/OptionsSymbolNav.tsx` | the symbol strip all three options pages share |

### Charts

- `BandedLine` takes `domain` for a FIXED y-axis and `zones` to wash the area beyond each band. A series read against thresholds needs both: the put-call chart auto-scaled to its own two sessions and pushed the 1.07 / 1.20 bands out of the plot. The axis for that page is `PUT_CALL_CHART_DOMAIN` in `config/options.config.ts`.
- `DivergingBars` — a signed series as bars either side of zero, blue up and red down, symmetric around zero so a rise compares with a fall. Net options volume per session, COT net position per week.
- `StackedTimeBars` — two magnitudes stacked per period (`up` on the baseline, `down` above it) with an optional right-axis percentage line. A1's COT chart: long over short, long share on top.
- Axis maths lives in `lib/ui/chart-scale.ts` (`scaleDomain`, `axisTicks`) and is tested there rather than eyeballed in the SVG.
- COT history's table paints with `heatStyle`, scaled by the week's own open interest so contracts of different sizes compare — the same treatment `components/CotPanel.tsx` gives those columns. Retail long % is painted INVERTED, because the crowd is read contrarian.

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
