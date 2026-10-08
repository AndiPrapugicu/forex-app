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
| `ScoreGauge`, `PercentGauge`, `ConfidenceRing`, `ScoreBar` | `components/Gauge.tsx` | the dials; `ScoreGauge` takes `bands` (see below) |
| `BiasPill` | `components/ui.tsx` | a cell's verdict, PAINTED. `variant="pill"` is the inline chip (number + word); `variant="block"` is A1's filled rectangle carrying the word alone |
| `OptionsSymbolNav` | `components/OptionsSymbolNav.tsx` | the symbol strip all three options pages share |
| `SymbolSelect` | `components/SymbolSelect.tsx` | every symbol in one grouped `<select>`, navigating to `hrefTemplate` with `{symbol}` filled in. The scorecard header and `/ai` share it |
| `Markdown` | `components/Markdown.tsx` | renders `lib/ui/mini-markdown.ts`'s tree with React. **The only way model output reaches the page**: no `dangerouslySetInnerHTML`, because the analyst quotes headlines from the open web |
| `AiAnalysisChat` | `components/AiAnalysisChat.tsx` | the `/ai` chat: off / locked / open states, NDJSON stream reader, thread per symbol in `localStorage`. Also exports `Unlock`, the passphrase form, which refreshes the server render on success |
| `VerdictBadge`, `EffectCell`, `ThemeRow`, `FlipList`, `ChangeList` | `components/narrative.tsx` | the Market Narrative's pieces. Server-only; evidence opens with a native `<details>`. A verdict is an OUTLINED badge with a count, never a filled heat cell, so it cannot be mistaken for a board score |
| `NarrativePanel` | `components/NarrativePanel.tsx` | one symbol's narrative: both verdicts, themes, flips and confirms, what changed. Heads `/ai` |
| `PositionsPanel`, `StatusChip` | `components/PositionsPanel.tsx` | the user's positions with GREEN/YELLOW/RED and the reasons, plus the add / close / delete controls. Client; render it ONLY for the passphrase holder — the page decides, the API re-checks |

### AI Analysis (`/ai`)

- Two columns from `xl` up: the chat, and "What the analyst sees" — context cards plus the FULL dossier text in a `<details>`, so the reader can check every number the model was allowed to cite. The cards stream in under `Suspense`; the chat does not wait for them.
- The chat is three states, and the first two are honest about why: switched off (`AI_ACCESS_KEY` or `OPENROUTER_API_KEY` missing on the server, named), locked (passphrase form), open. Every answer ends with the model, the request count, the seconds and the reported cost — "free" only when OpenRouter reported 0.
- Status lines come from the server while the dossier builds; a pulsing "Thinking… 12s" while the model reasons. The reasoning text itself is never shown — it is the model's scratchpad, not its answer.

### Market Narrative (`/narrative`)

- Order: positions (or the unlock form; nothing at all when `AI_ACCESS_KEY` is unset), the economies × themes matrix, Fed path beside the next seven days' flip events, assets, evidence by economy, every symbol's verdict beside its board score.
- Wide tables scroll inside their own `overflow-x-auto`; the page never scrolls sideways at 375px.
- While locked the positions slot shows the form only — never a count or a symbol.

### Gauges

- `ScoreGauge` is linear over `±range` by default (the continuous news score on `/event/[id]`), and **banded** when given `bands` from `lib/ui/gauge-scale.ts` (`biasBandEdges`). Banded, each bias band owns an equal slice of the sweep and the face is labelled with the CUTS (±4, ±7) instead of the ends.
- That exists because the scorecard's two facts fight: the maximum is a real ±34 for a pair and ±20 for a single-economy asset, while the bias cuts are absolute. Linear, a Very Bearish −9 sat a tenth off centre under a banner reading Very Bearish, and the only numbers on the face were ±34 — a score nothing reaches. The maximum is not hidden, it moves to the aria description and the caption under the dial.
- The needle never rescales the number: the printed score is the raw one, banding only moves the needle.
- `showDirection={false}` drops the gauge's own word where the caller prints a more precise one — the scorecard banner says "Very Bearish", the gauge only knows "Bearish".

### Charts

- `BandedLine` takes `domain` for a FIXED y-axis and `zones` to wash the area beyond each band. A series read against thresholds needs both: the put-call chart auto-scaled to its own two sessions and pushed the 1.07 / 1.20 bands out of the plot. The axis for that page is `PUT_CALL_CHART_DOMAIN` in `config/options.config.ts`.
- `BandedLine variant="sentiment"` is the shape A1 gives a ratio read between two thresholds: a bear-to-bull gradient over the whole plot instead of two flat washes, band captions on filled tags at the LEFT edge, the axis repeated on the right, corner tags from `cornerLabels`, and a plain white line with no markers. It is one preset rather than six props because it is one design copied whole — the gradient without moving the captions puts white text on the darkest part of the wash.
- A full-width chart needs a WIDER viewBox, not a taller one: an SVG keeps its aspect ratio and scales its text with it, so 640×200 blown up to 1500px is a letterbox with giant labels, and 1200×520 shrunk to a phone is unreadable. The put-call page renders the same chart props at two sizes and lets the breakpoint pick (`md:hidden` / `hidden md:block`); only the one in the layout is in the accessibility tree.
- `BandedLine` bands take `zone: 'above' | 'below'` to say which side the wash covers, because the direction is not a property of the colour: on the put-call chart a HIGH ratio is the bearish one, while on the scorecard's score history the bullish zone is above +4. `width` is really a text-size control — the SVG scales to its container either way, so the sidebar panel passes 340 to keep its axis labels readable.
- `DivergingBars` — a signed series as bars either side of zero, blue up and red down, symmetric around zero so a rise compares with a fall. Net options volume per session, COT net position per week.
- `StackedTimeBars` — two magnitudes stacked per period (`up` on the baseline, `down` above it) with an optional right-axis percentage line. A1's COT chart: long over short, long share on top.
- Axis maths lives in `lib/ui/chart-scale.ts` (`scaleDomain`, `axisTicks`) and is tested there rather than eyeballed in the SVG.
- An indicator with several legs is **one table row per leg**, with the name and the verdict block spanning them (`rowSpan`) — so the coloured block is as tall as the cell it stands for, the grid does the leg-to-number alignment that stacked lines made the reader do by eye, and each economy carries its own reading beside its own numbers. A leg is read on `CELL_MAX` (±1); the block beside it is the slot's own ±2 for a pair. Give the spanning `td` an `h-px` or `h-full` inside it has nothing to resolve against.
- A single-economy asset reads its home economy UPSIDE DOWN (strong US growth weighs on gold; every non-FX asset inverts inflation through the rates channel), so a leg can read Bearish beside a Bullish block. The cell has carried that sentence since it was scored and nothing rendered it; the name now carries an `inverted` tag with the reason.
- `/sentiment` shows TWO lists, not one merged one: the broker feed's FX pairs (Myfxbook, daily spot — the Crowd column's own input, so a pair's chip links to the scorecard cell it produces) and below it the CFTC contracts (weekly futures, which structurally cannot have a pair row). Merging them would sort a Tuesday survey against this morning's book. Both draw with the same `ContrarianRow`: the name chip carries the CONTRARIAN read while the bar carries the raw shares, so the two colours disagree exactly when the crowd is crowded, and a share too narrow for its own segment prints outside the bar in its own colour.
- The scorecard's Indicator detail is laid out the way A1's widget is: **no global header row** — each section states its own columns, because they are not the same columns (the sentiment block has no calendar release to put under "Forecast"), and a section whose rows carry a sentence gets no column names at all. The section row holds the block's verdict WORD in the cell column; the number is on its tooltip. Actual and Forecast are plain, and only Surprise is coloured, because the reading is the difference, not the level. A surprise prints unsigned when positive, as theirs does. Dates read "Sep 01", built from a fixed month list rather than `toLocaleDateString`, which would format differently on the server and in the browser.
- The scorecard's left column is verdict, breakdown, then **Score history** — a `BandedLine` of every stored board with the ±4 cuts as its zones, where A1 puts the same chart. Its Indicator detail table prints Actual / Forecast / **Surprise** / **Date**, which is A1's own column set: the surprise is what the cell is made of, coloured by the leg's own reading rather than by the sign of the difference, so a rise in unemployment reads red. A date past its series' cadence is marked `*` and still scores, as A1's does.
- The scorecard paints the same way the board does: `BiasPill` fills the cell (strength = the cell's share of its own column), each category header carries its block subtotal, and the Score breakdown pairs a painted number with a `SignedBar` on the block's own maximum. The per-leg SERIES NAMES live in an `Explain`, not in the row — "EUR · Gross Domestic Product s.a. (QoQ)" over "USD · Gross Domestic Product Annualized" wrapped onto five lines and pushed the three numbers that matter off screen. What stays visible is the currency, one line per leg, aligned with the Actual / Forecast / Previous rows beside it.
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
