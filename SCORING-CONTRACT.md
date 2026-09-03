# Scoring contract

> **Evidence tier: DEMO_ERA.** Written before A1's Free Week opened on 2026-08-31, i.e. against their tiered demo. Treat every claim about A1 as PREVIOUS DEMO HYPOTHESIS until re-tested under full access. Kept, not rewritten. See [LEGACY-EVIDENCE.md](LEGACY-EVIDENCE.md).

What the engine guarantees, per column. This is the production contract — it
says nothing about A1, and it must stay true whether or not any parity script
ever runs again.

**The one rule everything else serves: a score is never fabricated.** Where an
input is unavailable the cell is `null` and its `status` says so. `0` is a
claim — "measured, and neutral" — and is only ever produced by a measurement.

---

## How to read a cell

Every cell carries its own explanation. `MatrixCell` exposes:

| field | meaning |
|---|---|
| `cell` | the score, or `null` for "not measured" |
| `status` | `scored` \| `no-data` \| `not-released` \| `partial` |
| `explanation` | the sentence a user reads on hover |
| `legs[]` | per-currency detail: series name, actual, reference, `referenceLabel`, `dateUtc`, `consensusSource`, `actualSource` |
| `baseCell` / `quoteCell` | the two halves of a differenced pair cell |
| `missingLeg` | which leg was expected and absent, when `status` is `partial` |
| `stale` | the print is past its series' cadence. **Display only** — it never suppresses the cell |
| `basis` | sentiment columns only: which population was measured |

`status` always agrees with `cell`: a `null` cell is never `scored`.

### The cell, its reference and its sigma describe ONE comparison

This is a guarantee, not a convention, and it is enforced:

- `legs[].reference` is **the number the cell was actually scored against** — the
  revised prior print where one exists, not the raw `previous`, which is carried
  separately in `legs[].previous`;
- `legs[].sigma` is measured against **that same reference**. It may be 0 where
  the cell is not, because it is rounded for display. It may never point the
  other way;
- `actual` and `reference`, run back through the slot's polarity, reproduce
  `cell` exactly.

`auditBoardConsistency` in `lib/scoring/consistency.ts` checks all three over a
whole board. It backs both the unit tests and the live diagnostic in
`npm run freshness`, and it exists because a cell of -1 once shipped beside a
sigma of +0.86 — the two were measuring different comparisons and nothing
compared them.

Sigma is genuinely **not applicable** on non-economic columns (no release to be
surprised by) and on composite slots (two sub-series, no single surprise). Those
report `null` and are not checked.

---

## Technical

| | |
|---|---|
| **Trend** | 3-day vs 14-day average, and the 14-day's own direction |
| Source | Yahoo daily bars, cut at `pricesAsOf` |
| Range | −2 … +2 |
| Missing | `null` — no bars, no cell |
| Historical | **HISTORICAL.** `seriesAsOf` drops every bar after the cutoff |

| | |
|---|---|
| **Seasonality** | this calendar month's 10-year average return |
| Source | Yahoo dailies, bucketed by month |
| Range | −1 … +1 |
| Missing | `null` |
| Historical | **PARTIAL.** Bars are cut, but the 10-year average behind the month is a property of the whole series |

---

## Sentiment

| | |
|---|---|
| **COT** | net positioning (60/40 band) + weekly change |
| Source | CFTC, **cut on the publication date**, not the survey Tuesday |
| Range | −2 … +2 for a standalone symbol; the weekly change alone for a differenced leg |
| Missing | `null` |
| Historical | **HISTORICAL.** `publicationDate(reportDate)` is the cutoff |

| | |
|---|---|
| **Crowd** | retail long share, read contrarian on a 40/60 band |
| Source | 1. retail feed → 2. the symbol's own futures contract → 3. nothing |
| Range | −1 … +1 |
| Missing | `null` with `basis: 'none'` — **a cross is never a difference of two dollar pairs** |
| Provenance | `basis` is on the cell: `retail-feed` \| `own-contract` \| `none` |
| Historical | **LIVE_ONLY on rung 1.** Rung 2 rewinds with COT |

> `own-contract` is a **methodology substitution**, not a rounding difference: a
> weekly CME futures population standing in for a daily retail spot book. It is
> defensible and it must never be invisible, which is what `basis` is for.

---

## Economic (fourteen columns)

| | |
|---|---|
| **gdp, mpmi, spmi, retail-sales, consumer-confidence, cpi, ppi, pce, employment, unemployment, claims, adp, jolts** | actual vs reference, ternary, then differenced base − quote |
| Source | FXStreet calendar; TradingView backfills a missing **consensus**, and supplies the **actual** only for the named allowlist |
| Coverage | Consumer confidence is scored for NZD (ANZ–Roy Morgan) and AUD (Westpac) as of 2026-08-31. It stays blank for CAD, where no feed carries a series |
| Transformation | raw sign, **no dead band**; `polarity` inverts unemployment |
| Reference | `forecast` by default; `previous` where the series is genuinely unforecast. The prior print means the **revised** one |
| Range | −1 … +1 per leg, −2 … +2 differenced |
| Missing | `null` only when nothing resolved, or when the print has no forecast AND no prior print to read it against |
| Age | **Reported, never enforced.** A print past `maxAgeDays` scores exactly as a fresh one does and is flagged `stale` |
| One-sided | a release only one economy publishes scores from the single leg, inverting for the quote |
| Provenance | `legs[].referenceLabel`, `consensusSource`, `actualSource` |
| Historical | **HISTORICAL.** `asOf` drops releases dated after the cutoff |

---

## Rates

Three rules under one column, by asset class.

| | |
|---|---|
| **FX pairs and currency indices** | base − quote of each leg's rate expectation |
| Source | 1. the bank's own published projection → 2. consensus for the next scheduled decision → 3. nothing |
| Range | −1 … +1 per leg |
| Missing | `0` with `basis: 'none'` when the calendar is present and the bank has published nothing — a genuine neutral, and the correct reading for seven of eight majors. **`null` when there is no calendar at all**, because an outage is not a view |
| Historical | **HISTORICAL**, with one named anachronism: the consensus for a future decision is today's estimate however far back the board is wound |

| | |
|---|---|
| **DXY, metals, indices, crypto** | the US 2-year against its own 21-day average |
| Source | **FRED `DGS2`** — the constant-maturity Treasury yield |
| Transformation | above the average → −1 for a risk asset, **inverted for DXY** |
| Range | −1 … +1 |
| Missing | `null` — the yield is never assumed |
| Historical | **HISTORICAL** since the source moved off a futures quote that could not be rewound |

---

## Composition

- A row's total is a **plain unweighted sum** of its populated scoring cells. No weighting, no normalisation, no cap.
- `null` cells are **absent from the sum**, not counted as zero.
- Bias bands are **absolute**: ±4 Bullish/Bearish, ±7 Very. Adding a scoring column therefore redefines "Bullish" — the column set is pinned by test.
- Context columns (`scoring: false`) are rendered and never summed.

---

## Live vs historical

Two separate concepts, and collapsing them has caused three separate defects.

- **`now`** — what the calendar connectors fetch around. Rewinding it narrows the forward window and hides scheduled decisions that were public on the day.
- **`pricesAsOf`** — the cutoff for every price-derived series.

A historical board must not see future prices, future releases, or a report that
had not yet been published. Enforced by `asOf`, `seriesAsOf`, `publicationDate`
and `yield2yAsOf`; asserted board-wide in `lib/scoring/invariants.test.ts`.

Components that genuinely cannot be rewound are labelled `LIVE_ONLY` and their
disagreements are reported as timing, never as scoring.

---

## Failure behaviour

| Situation | Result |
|---|---|
| Provider times out or errors | `Result.ok === false`, recorded in the pipeline health table. **Never throws** |
| Provider returns stale cache | Served, with age; the UI can say so |
| Provider returns nothing | Cell `null`, `status: 'no-data'` |
| Release older than its window | Scored and summed as normal, flagged `stale`, age shown |
| Release with no forecast and no prior print | Cell `null`, `status: 'not-released'` |
| One leg of a pair missing | `status: 'partial'`, `missingLeg` names it |
| Host sends `429` | Per-host cooldown honours `retry-after`; no retry through it |
| `USE_FIXTURES` set in production | **Ignored**, warned once, live sources used |
