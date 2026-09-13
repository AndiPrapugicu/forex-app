# EdgeFinder scoring — diagnosis, and what was fixed

> **Evidence tier: DEMO_ERA.** Written before A1's Free Week opened on 2026-08-31, i.e. against their tiered demo. Treat every claim about A1 as PREVIOUS DEMO HYPOTHESIS until re-tested under full access. Kept, not rewritten. See [LEGACY-EVIDENCE.md](LEGACY-EVIDENCE.md).

> **Round three is at the top; round two and the original diagnosis follow below.** Five fixes
> have landed across two rounds and the board sits at **TOTAL ABS GAP 72**, from 95. Round three
> is measurement only — no scoring changed — and moves the question from "what's the gap" to
> "which columns generalize and which don't," using the live EdgeFinder demo as the reference
> instead of a screenshot.
>
> **Implemented 2026-08-24, after this diagnosis.** Four fixes landed. The board moved
> **TOTAL ABS GAP 95 → 74** and **exact rows 5 → 14** against the same 2026-08-23 capture, stable
> across three runs. Two conclusions in the original diagnosis were **wrong** and are corrected
> in place below, marked **CORRECTION**. Test suite 649 → 660, all passing.

## Round eighteen — the PMI gap was data, and parity learns to not flatter itself (2026-09-13)

A1's access window closed on 2026-09-07; this round works only from captures already in
`fixtures/a1-full-access/`.

**Headline.** `npm run parity` TOTAL ABS GAP **114 → 101** over 51 rows; exact rows 7 → 8. The new
provenance-honest headline, which drops every cell scored off an A1-sourced input from both sides, reads
**110**. `leg-parity` 117/144 → **124/144**. Tests 1045 → 1114.

**1. sPMI 39 → 16 — a coverage bug, not a rule.** FXStreet nulls `actual` on historical non-USD PMI
releases. Rewound to 2026-09-02, EUR, GBP, JPY and AUD services PMI had zero scoreable prints, so
`resolveSeries` skipped to nothing. Fix: a committed seed built from the full-access PMI captures
(212 rows, five guards — G1 date alignment, G2 duplicate collapse, G3 previous, G4 tail must reproduce
the heatmap's published surprise, G5 declined series), plus a Supabase accumulator for observed actuals.
Precedence is per frame (`dropSupersededSeed`, in the pipeline and inside `asOf`). Every remaining sPMI
disagreement is a CAD row.

**2. Profiles.** `ours | a1`. The `a1` profile applies two PROVEN A1 data gaps after scoring — CHF
services = EUR, AUD retail blank — and closes 101 → 99. The product never builds it.

**3. Mirror residual.** The distance to A1's captured board (257) now splits into coverage (−4),
convention (−22, PPI negation), captured (−40, copied cells) and **191 unexplained** — the only work list:
crowd 40, PPI 39, retail 24, trend 17, sPMI 16, seasonality 15, CPI 11, GDP 10, PCE 9, mPMI 7, unemployment 2,
COT 1.

**4. Investigated, deliberately NOT changed.**
- CAD/NZD services blank in the `a1` profile — rejected; A1's board still scores both from a print frozen at 2026-05-01.
- CAD retail — A1's −0.8 is StatCan's July advance estimate; we score confirmed June. `TRUTH-EVIDENCE.md` #7.
- Metals trend — roll-free ETFs disagree with A1 as much as futures do; UNKNOWN.
- Index-row trend — all seven index rows now agree; USDCHF's +1 vs +2 sits on a 0.00008 slope.
- Ethereum seasonality — no window of our history reproduces A1's February −30.59; UNKNOWN, not fitted.
- Crowd crosses, options, AAII — every candidate source fails the gate. `EdgeFinder-known-unknown-blocked.md`.

## Round seventeen — three fixes, and two of them were ours (2026-08-31)

The build round. Four checksummed cells moved to EXACT and **not one moved away**; the component
matrix went **106 -> 110 EXACT, 13 -> 9 MISMATCH**. Three production changes landed, each with a
complete chain, and every remaining disagreement is now attributed.

### CHF unemployment — the previous round read their page backwards

Filed last round as "switching the series would make it worse". That rested on reading the last
value on A1's unemployment page, **2,90**, as their latest print. It is **June**. July is **3,00**,
and July is the release both boards used.

Their own CH heatmap card settles both open questions in one row. It is dated `Jan 9, 26` and reads
**actual 3.1, Forecast blank, previous 2.9**. No seasonally adjusted Swiss print has ever gone
2.9 -> 3.1 — the adjusted series sat at 3.0 either side of it — and the **unadjusted** series read
2,90 in November 2025 and 3,10 in December. So that row names the SERIES and the REFERENCE at once,
and it had been sitting in the fixtures since round four being read for the reference alone.

FXStreet carries only the adjusted rate. TradingView carries the unadjusted one and agrees with
A1's published series to the decimal on the last five months, so it arrives through
`TRADINGVIEW.actualSeries` — the allowlist AUD household spending already uses. The adjusted series
is deliberately **not** kept as a fallback: a silent swap to a different statistic produces a
confident wrong cell where a blank would be honest.

EURCHF and CHFX unemployment: MISMATCH -> EXACT.

### GBP GDP — deleting a special case, not adding one

The ONS published two growth series on 2026-08-13 and our calendar carries both:

| | actual | forecast | cell |
|---|---|---|---|
| GDP (MoM) | 0.3 | 0.0 | **+1** |
| GDP (QoQ) | 0.4 | 0.4 | **0** |

A1's own GDP page publishes **0,4% against 0,4%**. Their board's GBP GDP leg solves to **0**, twice
over. The `matchByCurrency` entry naming the monthly first came from their UK heatmap card, which
says "GDP Growth MoM" — a correct reading of a surface that is not what their board scores. Removing
the override leaves the UK on the quarterly-first default and leaves **one** GDP special case where
there were two; Canada keeps its override because it has no timely quarterly at all, which is a
data-availability fact rather than a preference.

GBPUSD gdp: MISMATCH -> EXACT.

### The prior print is the revised one

BusinessNZ's PSI, released 2026-08-16: **actual 50.6, previous 50.6, revised 50.9**. Nobody
forecasts the survey, so it is scored against the prior print — A1's own rule, published on their NZ
card as a blank Forecast and a Surprise of actual minus previous. Against the **announced** 50.6 the
print is flat; against the **restated** 50.9 it fell. A1 carries -1, and TradingView's `previous`
column for that release reads 50.9, because a revision means last month's figure IS the new number.

`priorPrint(event)` returns `revised ?? previous` wherever a prior print is the reference. Audited
across all eight majors and every economic slot at the 08-24 cutoff, it moves **exactly one leg** —
the checksummed one. A forecast-based comparison is untouched: a revision cannot restate a consensus
published before it.

NZDX sPMI: MISMATCH -> EXACT.

### Two "regressions" that are both cancelling pairs coming apart

Board TOTAL ABS GAP went **54 -> 58** and the 47-row aggregate **76 -> 84**. Read cell by cell, both
of the index rows that moved were passing for the wrong reason:

| row | before | after |
|---|---|---|
| CHFX @ 08-25 | unemployment wrong by +1, consumer confidence wrong by -1, **total exact** | consumer confidence alone, total off by 1 |
| NZDX @ 08-25 | sPMI wrong by +1, GDP wrong by -1, **total exact** | GDP alone, total off by 1 |

Each row now has exactly one identified, filed disagreement where it had two that happened to
cancel. This is [[checksum-is-blind-to-cancelling-pairs]] arriving a third time, and it is the
reason a board total is not evidence.

### GBP PPI — their month buckets are RELEASE months, and the correction cuts both ways

Round thirteen scored A1's `aug. 2026` PPI bucket against an 2026-08-24 board and announced a
contradiction. Round sixteen fixed that by asserting a month bucket is never published inside its
own month — i.e. that the bucket is a REFERENCE month. It is not. Their pairs are our releases:

| A1 bucket | A1 pair | our release |
|---|---|---|
| `iul. 2026` | 3,50 / no forecast | 2026-07-22, actual 3.5, consensus null |
| `aug. 2026` | 3,10 / 3,20 | 2026-08-19, actual 3.1, forecast 3.2 |

Both match on release month; neither matches on reference month. The fixture's own header says the
same thing outright — "`date` is A1's own release date". So the August bucket **was** public five
days before the board, their page classifies it *Lower*, and their board carries +1.

Neither boolean is available: the bucket names a month and the board names a day. `wasPublishedBy`
is now tri-state and reports `A1_RELEASE_DATE_AMBIGUOUS`, which is the honest verdict and the one
that would have caught both errors. **`A1_CONTRADICTS_ITSELF` remains 0 — and that number now means
something narrower than it did.**

### Rates — the seam, built and left unwired

`lib/scoring/rate-projections.ts` takes DATED snapshots, reads strictly backwards, and returns
`NO_SNAPSHOT_YET` for every date before the first reading — which today is every board on file.
There is no nearest-available fallback and there must never be one; that is `trend:as-of` and
`cot:publication-lag` wearing a third costume. A test asserts the module is imported by no scoring
path, and another asserts that it **would** close the EURCHF rates cell and still refuses the
2026-08-24 board. `fixtures/a1-rate-projections.json` is the append-only store. One snapshot is not
a series.

### Not implemented, and why

- **GBP mPMI** (51.6 vs 51.5) and **GBP retail sales** (-0.40 vs -0.50) — consensus differences of
  exactly 0.1, with FXStreet and TradingView agreeing against A1 in both cases. `self-consistency`
  files the mPMI release A1_SELF_CONSISTENT/REFERENCE_DIFFERS: their cell is what their own pair
  implies.
- **CHF consumer confidence** — TradingView carries the SECO series and agrees with A1 on the four
  releases before this one, on both actual and forecast, then reads -35 where A1 reads -33. No feed
  available to us produces -33, and the leg moves between their own two boards anyway.
- **EURX unemployment, EURCHF mPMI** — A1 contradicting A1. Untouched, as directed.
- **NZD GDP** — ours -1, theirs 0, both calendars agreeing on 0.8 against 0.9. The obvious
  explanation is already disproven: a staleness cut would do it at 69 days, but A1 scores CHF GDP
  non-zero from a print that is 85 days old on the same board. Filed UNKNOWN; `nzd-gdp-page` is now
  ranked 4th, and it is free.

## Round sixteen — a second replay leak, and a tool that asks A1 about A1 (2026-08-30)

Round fifteen found that the price series was never rewound. The obvious next question was whether
anything else leaks the same way, and the answer was yes — twice, with opposite outcomes.

### COT was cut on the wrong date, and it cost a checksummed cell

The CFTC surveys positions on a Tuesday and releases the report the following Friday. That is
stated in `lib/connectors/cftc.ts`'s own header, and it is visible in the data: every `reportDate`
we hold is a Tuesday, and on Sunday 2026-08-30 the newest was 2026-08-25, published Friday
2026-08-28.

`asOf` filtered on `reportDate` — the Tuesday SURVEYED — under a comment asserting "anything later
was not public yet". The survey date is not the knowable date. Replaying Tuesday 2026-08-25
admitted a report that did not exist for three more days, and moved fifteen cells.

One of them is checksummed. **NZDX Crowd: A1 prints +1, we scored 0, and cut on the publication
date it reads +1.** The 2026-08-24 board is untouched — zero cells move — so all six of its
checksummed rows keep the COT cells they already matched.

This is look-ahead bias in `runBacktest` as much as a false rewind in the parity scripts, and it is
the same shape as `trend:as-of`: a harness claiming a rewind it does not perform, with the correct
rule already written in a comment above the code that ignored it.

`publicationDate` and `COT_PUBLICATION_LAG_DAYS` now live in the CFTC connector, where the schedule
belongs. `scoreCot` and `scoreCrowd` are untouched — only which report they are handed changed.

### The 2-year yield leaks too, and fixing it would have been worse

`fetchYield2y` is the last price-derived input with no cutoff, and it drives the rate cell for DXY,
the metals and every non-FX row. Live on 2026-08-30 it reads 3.961 against a 4.172 average (+1);
cut to 2026-08-24 it reads 4.170 against 4.157, which is flat (0). So both metal rate cells agree
with A1 **only on the uncut reading**, six days after the board they are compared against.

The cutoff was implemented, measured, and deliberately reverted. Yahoo's `2YY=F` daily closes sat
at exactly **4.170 for twelve consecutive sessions** while the live quote read 3.961 — a 21bp gap.
The close series is not tracking the instrument, so cutting it does not reproduce the past yield,
it substitutes a stalled close for a live quote. Shipping it would have moved two cells off A1 on
the strength of bad data: trading a known leak for a confident wrong number.

Filed as `rates:yield2y-as-of`, UNKNOWN. The fix is a 2-year series that actually moves — FRED's
DGS2 is already configured for the yield curve — and only then the cutoff.

### `npm run self-consistency` — asking A1 about A1

Every round has produced the same argument in a different costume: their cell says X, ours says Y,
whose input is wrong? There is a third party to ask, and it is A1. Their free economic pages
publish actual AND forecast per release; their scoring text says what they do with the pair. So the
ternary their board SHOULD carry is computable, and their board is right there, solved into legs.

  - their cell matches their data  -> a SOURCE difference, and the fix is a feed, not a rule.
  - their cell contradicts their data -> their defect, and it must not be reproduced.

**The result is a clean negative: `A1_CONTRADICTS_ITSELF` is ZERO.** On every release we can
date-match, A1's board agrees with A1's own published data. Their per-release scoring is not buggy.

That number was 2 in the first draft, and both were artifacts — the tool compared releases the
board could not have read (an August month-bucket against an August board). That is precisely the
trap that produced a false "A1 contradicts itself" finding in round thirteen, reproduced by the
very tool built to prevent it. The selection step, and the six tests that pin it, are the point of
the file.

### What IS inconsistent: CHF's legs move between two consecutive boards

Solving both boards into legs, three of CHF's columns carry different values a day apart with no
release in between:

| column | 2026-08-24 | 2026-08-25 | their own published data |
|---|---|---|---|
| mPMI | +1 | -1 | 53.2 vs 54.5 on 2026-08-03 -> **-1** |
| Consumer Confidence | +1 | 0 | -33 vs -34 on 2026-08-07 -> **+1** |
| Rates | -1 | 0 | no release between the boards |

The consequence is hard: **no single value of ours can match both boards**, so any source change
aimed at one of these cells necessarily breaks the other. Three of the four contested CHF columns
are unreproducible by construction.

CHF unemployment is the control that shows this is not a general CHF problem. Its leg reads **-1 on
both boards**, via two independent routes (EURCHF at 08-24, CHFX at 08-25). It is the one stable
CHF target, and it stays open because their unemployment page publishes the actual only.

### And a label that had gone stale

`component-parity` still called `trend` LIVE_ONLY, a round after the price series learned to
rewind. All eight trend cells agree today so it changed no count — but a stale label would report
the first real trend disagreement as clock noise, which is the unsafe direction for a diagnostic to
be wrong in. Now HISTORICAL, with a test that pins it.

## Round fifteen — the first scoring fix in six rounds, and it was ours (2026-08-30)

Every round since ten ended the same way: a better explanation, no code change. This one found a
real defect in our own engine, and it was hiding in plain sight behind a label we had written
ourselves.

### The bug: `npm run parity` was not rewinding the column it said it was

`runSetupsPipeline` has always taken a `now` and handed it to the calendar connectors, so a
rewound board scored its **economic** columns against releases the frame had actually seen. It
never handed it to `fetchTechnicals`. The moving averages — and the TREND cell over them — were
the tail of the series no matter which date was being reproduced.

So `scripts/parity.ts` printed *"rewound to end of that day"* over a comparison in which one
column was not rewound at all, and `component-parity.ts` had to label every trend cell
`LIVE_ONLY` to say so. Six cells sat permanently as `TIMING_CONFOUNDED` because nothing could
tell a real disagreement from a week of price drift.

**Measured before touching anything.** Cutting the daily series at each capture's own timestamp
and applying the *unchanged* `scoreTrend`:

| | live | cut at the capture |
|---|---|---|
| A1's 8 checksummed trend cells reproduced | **6** | **8** |

EURCHF went **+2 → −1** and CHFX **−2 → +2**, both landing exactly on A1's printed cell. The
other six were already +2 and stayed +2 — the rewind moved only the two that were wrong.

**The formula was not touched.** `scoreTrend` and `TREND_SMA` are byte-identical; only the window
they read changed. That is the whole difference between reproducing our own rule at the right
moment and fitting a new rule to A1.

### The half-fix that broke something else, and why the parameter is separate

The obvious implementation — pass `now` to the whole pipeline — cost a cell. At
`now = 2026-08-25` the RBNZ's 2026-09-02 decision is never downloaded, so **NZDX's rates cell fell
+1 → 0** and component-parity's MISMATCH count went *up*. That event was public knowledge on the
day, which is exactly why `asOf` keeps future-dated rows that still have no actual: filtering is
its job, and it happens after the fetch.

So the price cutoff is a **separate parameter** from `now`:

- `now` — what the calendar connectors fetch *around*. Stays live.
- `pricesAsOf` — where the price series is *cut*. Defaults to `now`, so live scoring is untouched.

`seriesAsOf` returns the same object when nothing is after the cutoff, so the live board keeps
reading Yahoo's quote rather than the last close, and pays nothing to copy five arrays per symbol.

### What it moved

| | before | after |
|---|---|---|
| Cell parity | 84/98 EXACT (85.7%) | **85/98 EXACT (86.7%)** |
| DIFFERENT | 13 | **12** |
| Trend column (top-setups) | 5/6 | **6/6** |
| Trend column (component matrix) | 6 EXACT, 2 TIMING | **8 EXACT, 0 TIMING** |
| Component matrix EXACT | 103 | **105** |
| Component TIMING_CONFOUNDED | 6 | **4** |
| Board rows exact | 7 (19.4%) | **11 (30.6%)** |
| Board TOTAL ABS GAP | 74 | **54** |
| `parity` exact / TOTAL ABS GAP | 7 / 113 | **13 / 76** |
| Cross-day PERSISTENT / TIMING | 17 / 7 | **13 / 11** |

The cross-day shift is the one worth dwelling on. That script exists to separate a persistent
disagreement from a timing one, and until now **both** boards it compared carried today's trend
cell — so a genuine day-to-day move in the technicals could not show up as timing at all. Four
symbols were reclassified out of PERSISTENT once it could.

### GBP PPI — A1 coerces a null forecast to zero

The supposed contradiction between A1's PPI page and A1's board dissolves, and the mechanism is a
bug in their pipeline.

Hovering their own PPI YoY buckets for GBP:

| bucket | their forecast | their actual | their class |
|---|---|---|---|
| mar. 2026 | 2,60% | 1,70% | Lower ✓ |
| iun. 2026 | 4,00% | 4,00% | Met ✓ |
| **iul. 2026** | **0,00%** | **3,50%** | **Higher** |
| aug. 2026 | 3,20% | 3,10% | Lower ✓ |
| **apr. 2026** | **0,00%** | **2,60%** | **Higher** |

Where a forecast exists they classify correctly. Where it is missing it renders as `0,00%`, every
actual clears it, and the release scores **Higher regardless of the number**. Both forecast-less
buckets behave that way. That is precisely the +1 their board carries for the 2026-07-22 print,
whose consensus our feed also lacks.

It also retires an error of ours: last round matched their **aug. 2026** bucket against a board
captured on **2026-08-24**. That release had not happened yet. Their board used iul. 2026, and
their page agrees with their board once the right bucket is read.

**Do not reproduce it.** Imitating a null-coerced-to-zero comparison would put +1 on every
forecast-less release in the book.

### CHF unemployment — a proven series difference that must not be acted on

A1 scores the **unadjusted** Swiss unemployment rate. Their own page:
2,80 3,00 2,90 2,90 2,80 2,80 **2,70 2,70** 2,80 2,80 2,90 2,90 **3,10 3,20 3,20** 3,10 3,00 3,00
**2,90** — winter highs, summer lows. A seasonally adjusted series does not do that. Ours, which
matches `Unemployment Rate s.a (MoM)` by name, is flat at 3.0–3.1.

And it must not be switched. Their unadjusted July print of 2,90 against a 3,00 previous **fell**,
which under our `compareByCurrency: { CHF: 'previous' }` scores **+1** — further from their −1
than our current 0. Their reference cannot be recovered either: their unemployment page publishes
the actual only, its forecast chart rendering `COMING SOON!` over a dataset error. Series proven,
comparison unknown, chain incomplete, nothing changes.

### Implemented

**`trend:as-of`** — the ledger's first `FIXED` entry, and the test that asserted `FIXED` was empty
for three rounds has been replaced with one that holds it to the standard the class implies.

**An evidence ranker.** `lib/scoring/evidence-next.ts` and `npm run evidence-next`. Requests are
declared, but their *rank* is derived from the ledger: each names the keys it would resolve, and
a request pointing at a key that has since been closed or renamed loses its standing
automatically instead of being carried forward by inertia. It also prints the unresolved entries
no capture would touch — proven source differences need a different feed, not a better screenshot.

### Parity, and what it does not mean

TOTAL ABS GAP fell 113 → 76 and the board gap 74 → 54. Neither number justified the change; the
8-of-8 cell reproduction did, and the change would have been correct even if the totals had
worsened, because the comparison it fixes was invalid. The two cells it moved are the two whose
trend genuinely turned during the week between A1's capture and our run.


## Round fourteen — the index rows, solved by algebra rather than by capture (2026-08-30)

The round set out to photograph the EURO, US-DOLLAR, GB-POUND and CH-FRANC rows. That capture
turns out not to exist: **no free A1 surface carries a currency-index row at all.** Their Forex
Scorecard is pairs only, and their Asset Scorecard — which is where the checksummed DXY row came
from — is capped to *platinum* in the demo. Checked directly, not assumed.

So the index rows were solved from the rows already on file instead. It worked better than the
photograph would have, because A1's board is **over-determined**, and no round had used that.

### Leg-differencing is now PROVED, not assumed

The standing instruction was never to assume A1 differences legs merely because we do. Here is
the proof, and it does not presuppose its conclusion:

- **Gold and silver carry the dollar leg and nothing else, inverted.** Negating either row reads
  USD *directly*, with no differencing involved. The two metals agree in **all fourteen**
  economic columns — a real check, since they are separate rows with separate totals (8 and 10).
- Measuring the same leg the other way, as **EURX − EURUSD**, reconciles with it in **13 of 14**.

If A1 did not difference legs, two unrelated routes would not agree column after column. Graded
`structure:leg-differencing` SUPPORTED → **CONFIRMED** — and note the grade covers the *economic*
block only. Trend, seasonality, COT and crowd come from the index instrument and are not
differenced at all. Pinned by `lib/scoring/index-rows.test.ts`.

### EUR unemployment — closed, and our cell was right all along

Carried as UNKNOWN for three rounds because A1's Unemployment Rate page publishes the actual only
(its forecast chart renders `COMING SOON!` over a dataset error). It never needed their series
page. Their own cells settle it:

- USD unemployment = **+1**, read directly off the metals.
- Their EURUSD prints **−2**. So EUR = EURUSD + USD = **−1** — exactly the cell we produce.
- Their EURX row prints **0**, which is unreconcilable with their own EURUSD and their own metals.

The long-proposed "score EUR unemployment against the previous print" would have moved a cell
their own board says is already correct. Filed `A1_INCONSISTENCY`.

### The EURX row cannot be checksum-tested on the two cells that matter

The round's most consequential arithmetic. Two independent lines of evidence each say one EURX
cell is off by one, and they point in **opposite directions**:

| cell | printed | what the evidence says | source |
|---|---|---|---|
| rates | 0 | **+1** | their EUR policy rate 2.40 against their own 2026Q3 projection 2.65 |
| unemployment | 0 | **−1** | forced by their own EURUSD (−2) and their own metals (USD +1) |

`+1` and `−1` cancel. **The row sums to its printed 7 under either reading**, so the checksum that
admitted it never tested either cell. That matters because EURX's rates cell is the *only*
observation anywhere contradicting the rates rule — and it turns out to be an untested cell on a
crowded crop, not an attested counter-example.

This is a finding about the *evidence*, not a licence to edit it. The fixture keeps what was read
and `solveA1Legs` keeps using it.

### The rates rule, tested same-day for the first time

Previous rounds could only test the rule against boards captured on other days. Reading A1's
projections and their EURCHF scorecard on **one day** eliminates a rival outright:

| reading | EUR leg | CHF leg | predicts EURCHF | A1 printed |
|---|---|---|---|---|
| current quarter's projection vs standing policy rate | +1 | 0 | **Bullish** | Bullish ✓ |
| next quarter vs current quarter (Q3 2.65 → Q4 2.65) | 0 | 0 | Neutral | Bullish ✗ |
| 2026Q2 → 2026Q3 within the chart | +1 | 0 | **Bullish** | Bullish ✓ |

The first and third give an **identical leg set for all five currencies**, so the leg assignment
does not depend on choosing between them: USD 0, EUR +1, GBP +1, CHF 0, NZD +1. Still not
implemented — see below.

### The Carry Trade Scanner, found

Round thirteen located a `Carry trade scanner` in A1's Data Updates Log and could not find the
page. It is under **Macro Scanners** in the free demo, alongside Eco Surprise Index, Eco Strength
Index, Risk on/off Ratios and Real Yield History — none of which round thirteen's map listed.

It is **not** the projections source. It is the `Central bank interest rates` dataset rendered
pairwise: Symbol | Base Currency Rate | Quote Currency Rate | Interest Rate Divergence | Carry
Direction. A symbol filter and **no date dimension**. The same underlying series *is*
date-addressable, monthly back to Jan 2024, on their Interest Rates page.

It also exposed an **A1-side contradiction**: their Interest Rates page has EUR at **2.40%** for
jul./aug. 2026 while their Carry Trade Scanner has EUR at **2.15%**. USD, GBP and NZD agree
exactly across both pages; EUR is the only disagreement, and their four-times-daily scanner has
simply not picked up the move their own daily rates page shows. The shape of their series settles
which ECB rate they track: 4.5, 4.25, 3.65, 3.4, 3.15, 2.9, 2.65, 2.4, 2.15 is the **Main
Refinancing Operations** rate step for step, not the deposit facility we read.

### GBPX — the one-point gap is two larger errors cancelling

Round thirteen bounded this to "trend, seasonality, COT or crowd" and could not choose. The board
total plus the derived GBP legs split it cleanly:

- A1's GBP economic legs (GBPUSD + USD, same capture) sum to **exactly 0**.
- Their published GBPX total is also **0**.
- So their four instrument columns sum to **0** as well.
- Ours: economic block **+1**, instrument block **−2**.

Our economic block is one point *high* and our instrument block two points *low*. The headline
"off by one" was hiding both. Within the economic +1: gdp (ours +1, theirs 0), mpmi (0 vs −1),
retail-sales (0 vs −1), ppi (−1 vs +1). Of the instrument −2, **crowd accounts for +1** — their
book had GBPUSD at 31% long on 2026-08-24, which our production scorer turns into a GBPX cell of
+1 against the 0 our CFTC read gives. That leaves **one point** across trend, seasonality and COT,
and trend is LIVE_ONLY, so it is timing-confounded by construction.

### Three of GBP's four economic cells, proven from A1's own pages

Their free surface publishes the inputs, and for GDP it publishes the **classification** directly
— each release bar is coloured white "As expected", blue "Beat Forecast" or red "Missed Forecast".

| cell | A1 actual | A1 forecast | A1 cell | our actual | our forecast | our cell |
|---|---|---|---|---|---|---|
| GDP MoM, rel. 2026-08-13 | 0.4% | 0.4% | 0 (as expected) | 0.3% | 0.0% | +1 |
| Retail Sales MoM, rel. 2026-08-21 | −0.50% | **−0.40%** | −1 | −0.50% | −0.50% | 0 |
| mPMI, flash 2026-08-21 | 51.5 | **51.6** | −1 | 51.5 | 51.5 | 0 |

All three are forecast differences, and each of their cells agrees with the GBP leg derived from
their own board. The fourth, **PPI**, is A1 contradicting itself: their PPI page gives GBP 3.10%
against a 3.20% forecast → −1, while their board's GBPUSD PPI cell of +2 against a USD leg of −1
forces GBP = **+1**. Not one of the four is a rule we have wrong.

A useful timing check fell out of the GDP page: USD's 2026-08-26 release is white (as expected)
while 2026-07-30 is red (missed), and the 2026-08-24 board carries USD gdp = −1 — the July
release. **Their board uses the latest release before the capture, exactly as ours does.**

### The Forex Scorecard prints signed cells after all

Round thirteen recorded that it "publishes six category gauges and a Bullish/Bearish/Neutral label
per row, but never the signed cell". Superseded: the gauges print signed **integers**, and the AI
summary states the decomposition in words — *"Technical score (+1) reflects a positive trend
reading (+2) offset by negative seasonality (−1)"*. Only trend and COT can exceed 1, and both are
recoverable, so **any** Forex Scorecard row can now be reconstructed in full. Their EURCHF row for
2026-08-29 is on file, checksummed (18 cells → +1 = their printed Main Score) and passing
structural zeros.

### Implemented

**Nothing in the scoring path.** Every finding this round is a source difference, an A1-side
inconsistency, or a timing artefact — the chain never completed to a rule of ours being wrong.

What shipped: `fixtures/a1-rates-and-index-2026-08-30.json` (their rate inputs, the free-surface
additions, the demo caps, the same-day rates test, the EURCHF scorecard row, the GBP inputs);
`lib/scoring/index-rows.test.ts`, 13 assertions encoding the algebra above so it is never
re-derived a fifth time; three new ledger entries and four rewritten ones; and two
source-confidence changes (`structure:leg-differencing` SUPPORTED → CONFIRMED, `rates` evidence
rewritten around the same-day test).

### Parity

| | before | after |
|---|---|---|
| Cell parity | 84/98 EXACT (85.7%) | **84/98 EXACT (85.7%)** — unchanged, nothing scored moved |
| Board TOTAL ABS GAP | 113 | 113 |
| Component matrix EXACT | 103 | 103 |
| Ledger UNKNOWN | 3 | **2** |
| Tests | 810 | **826** |


## Round thirteen — A1's INPUTS, not their outputs (2026-08-30)

The round that stopped comparing cells and started comparing the numbers cells are made of.
A1's free "Economic Data" report publishes **actual and forecast per country with real release
dates**, back to 2024, on a filterable page per series. That turns "our cell differs from theirs"
from a puzzle into an arithmetic check.

**One production change was implemented, measured and reverted.** Nothing else changed. Two
long-standing "tempting fixes" are now closed with proof rather than caution.

### The free-data map, completed

Their second report's full page list, read off its own navigation: **Economic Growth Data** (GDP
Growth, GDP Growth Forecast, Services PMI, Manufacturing PMI, Retail Sales, Consumer Confidence,
Balance of Trade), **Inflation Data** (CPI YoY, PPI YoY, PCE YoY), **Labor Market Data** (NFP,
ADP, Unemployment Rate, Unemployment Claims, Job Openings, Wage Growth), **Interest Rates Data**
(Interest Rates, Interest Rate Projections, US Treasury Yield Curve), US Housing Data, Data
Updates Log.

Most pages expose actual + forecast, dated, per currency, with a date-range control. Three gaps
matter: **Unemployment Rate publishes the actual only** (its forecast chart renders
`COMING SOON!` over a dataset error), **Interest Rate Projections has no history at all**, and
**no page carries currency-index rows**.

**The Data Updates Log is a map of their pipeline.** It names each internal dataset and its
cadence — and two entries pay for the visit. There is **no "interest rate projections" dataset**;
the rate-side entries are `Central bank interest rates` (daily) and a **`Carry trade scanner`**
that appears nowhere in the free surface. And `Retail sentiment` refreshes **every 30 minutes**,
which finally explains why their snapshot page and their daily history page disagree on the same
day: they are the live feed and its roll-up.

**They also publish their own scoring rules in prose**, including the GDP series per country
(US: GDP QoQ; UK/EU/JP/CA: GDP MoM) and the polarity rule. Their PPI chart goes further and
splits every release into **Met / Lower than expected / Higher than expected** as three separate
series — a three-state comparison with no tolerance band, which independently corroborates this
repo's `scoreTernary` and the removal of its old ±0.25σ deadband.

### CHF consumer confidence — CLOSED, and not the way it looked

The single most re-proposed change in this project. Previous rounds observed that scoring the
Swiss SECO print against the PREVIOUS value instead of the forecast would produce A1's cell, and
each round correctly declined on one observation. A1's own page settles it:

| | actual | forecast | cell |
|---|---|---|---|
| **A1**, release 2026-08-07 | **−33** | −34 | beat → **+1** |
| **ours**, same release | **−35** | −34 | miss → **−1** |

**The forecasts are identical.** A1 compares against the forecast exactly as we do, holds the
same forecast we hold, and reaches +1 from a **different actual**. So this is a data difference,
not a basis difference, and the proposed fix would have been right for the wrong reason —
breaking every other currency on that column to patch one. Filed `SOURCE_DIFFERENCE`, `PROVEN`.

A1's leg is +1 by algebra too, which is what makes it usable: their EURX consumer-confidence cell
reads +1 (so EUR = +1) and their checksummed EURCHF row reads 0, forcing CHF = +1. Two
independent routes to the same number.

### The rates rule — DISCOVERED, then measured and NOT adopted

A1 publishes **both halves of their comparison**, free, on two pages: the standing policy rate,
and market-consensus projections by calendar quarter. Applying `sign(current quarter's projection
− standing rate)`:

| | policy | 2026Q3 projection | leg |
|---|---|---|---|
| USD | 3.75 | 3.75 | 0 |
| EUR | 2.40 | 2.65 | **+1** |
| GBP | 3.75 | 4.00 | **+1** |
| CHF | 0.00 | 0.00 | 0 |
| NZD | 2.25 | 2.75 | **+1** |

Those five legs reproduce **six of A1's own cells across three dates** — EURUSD +1, GBPUSD +1,
EURCHF +1 (2026-08-24, checksummed); CHFX 0, NZDX +1 (2026-08-25); EURCHF Bullish (2026-08-29
Forex Scorecard). The one exception is EURX's 2026-08-24 rates cell, read as 0 where the rule
says +1.

**CHF is no longer the mystery it was.** Their own pages put the Swiss policy rate at 0.00% and
every projected quarter at 0.00%, so CHF's leg is 0 — which is exactly what their CHFX row
prints. The −1 that several rounds quoted as a measurement came from solving EURCHF while
assuming leg-differencing; it is now downgraded, and so is the USD −1 derived the same way
through EURX.

**The rival assignment is rejected on their own data.** Taking EURX at face value gives EUR 0,
USD −1, GBP 0, CHF −1, which satisfies the same three pair equations — and matches A1's published
rate inputs for **not one** of those four currencies.

**Implemented, and reverted the same session.** `scoreRateExpectation`'s projection branch was
changed to compare the nearest projected rate to the standing rate instead of comparing two dot
plot points a year apart. The Fed is the only bank whose own projection this repo holds, so the
change moves **USD's leg alone** — 3.80 against a standing 3.75 is inside the flat band, so 0
rather than −1 — while EUR and GBP stay at a placeholder 0 for want of a projections feed.

Measured: **cell parity 84/98 → 82/98, the rates column 5/6 → 3/6 exact, no cell gained.**
EURUSD previously read +1 as EUR(0) − USD(−1) and became 0, where A1's +1 is EUR(+1) − USD(0).
A right answer reached by cancelling errors was replaced by a wrong answer reached honestly.

**The lesson is about order, not about the rule.** A1's rates column is a *difference*, so it
cannot be adopted one currency at a time. It needs the quarterly consensus for every major at
once. Reverted, with the whole experiment recorded in `lib/scoring/rates.ts` so it is not run a
second time.

### The other columns, checked against their own numbers

- **GBP mPMI.** Same actual (51.5, flash of 2026-08-21), forecast 51.6 theirs against 51.5 ours.
  A 0.1 difference in the consensus, landing either side of the line. `SOURCE_DIFFERENCE`.
- **CHF mPMI.** Our actual and forecast are **identical to theirs** (53.2 against 54.5) and both
  give −1 — but their own cells force +1. `A1_INCONSISTENCY`. Note the pattern: both CHF legs
  that contradict A1's published data are derived through the **EURCHF** row, and the CHF leg
  read directly off **CHFX** agrees with it.
- **GBP PPI.** Cells agree, bases do not: they compare 3.10% against a 3.20% forecast, we compare
  it against the 3.5% previous because our calendar carries no GBP PPI consensus. The agreement
  is luck and is recorded as such.
- **EUR unemployment.** Their page publishes the actual only, and their actual matches ours
  (2026-07: 6.30%, unchanged). The comparison basis cannot be settled from their free surface.
  `UNKNOWN` — and the one place more A1 evidence would genuinely decide something.
- **Silver polarity.** Their GDP prose says silver scores *with* the currency and that "Gold is
  the exception"; their own cells give XAUUSD and XAGUSD identical gdp, mpmi and
  consumer-confidence values, which only works if silver inverts too. We follow their data — which
  is why XAGUSD is 18/18 exact. Do not "fix" this to match their text.

### GBPX

Unchanged and now bounded. One point, and it is **not in the GBP legs**: GBPUSD is EXACT and
carries every GBP economic leg GBPX does, and a leg wrong by *k* would move every GBP-base pair
by *+k* together. They do not (GBPUSD 0, GBPAUD −2, GBPJPY −2, GBPNZD −2, GBPCAD **+2**,
EURGBP −1). So the point sits in trend, seasonality, COT or crowd — the four index-instrument
columns — and no checksum-valid GBPX row exists to say which.

### Implemented

**A remaining-parity ledger.** `lib/scoring/parity-ledger.ts` and `npm run ledger`: eleven
entries, each carrying component, symbol, date, ours, A1's, a classification
(`FIXED` / `SOURCE_DIFFERENCE` / `A1_INCONSISTENCY` / `TIMING` / `TRANSCRIPTION_ERROR` /
`UNKNOWN`), the evidence with both sides' numbers in it, a confidence, a root cause and a
production action. Its own tests refuse an entry whose evidence is too thin to be a measurement,
refuse a `SOURCE_DIFFERENCE` that does not quote both sides' numbers, refuse a `WEAK` entry that
licenses a change, and assert that **nothing is filed as FIXED this round**.

**A1's own inputs, frozen.** `fixtures/a1-free-economic-2026-08-30.json` — their actual/forecast
pairs per series and currency, their policy rates, their quarterly projections, their published
scoring prose, their Data Updates Log, and the full free-surface map.

**Ledger upgrades.** `rates` UNKNOWN → **SUPPORTED** (source confirmed, transformation supported,
two rival candidates recorded as falsified). `consumer-confidence` SUPPORTED → **CONFIRMED**.

### A mistake, and what it cost

`git checkout -- lib/scoring/rates.test.ts` was used to undo the reverted change. That file
carried **uncommitted work from round ten** and the checkout destroyed it — eight tests covering
`resolveNextRateDecision`, the NZDX row, the forecast-hold contrapositive, soonest-decision
ordering, the leaked-actual guard and dot-plot precedence. They have been **reconstructed** and
all pass against untouched production code, but the wording is a rewrite, not the original text.
The memory note "never `git checkout <path>` here" existed precisely for this and was not
followed.

### Parity

| | before | after |
|---|---|---|
| Cell parity | 84/98 EXACT (85.7%) | **84/98 EXACT (85.7%)** — unchanged, by revert |
| Component matrix EXACT | 103 | 103 |
| Board TOTAL ABS GAP | 113 | 113 |
| Tests | 799 | **810** |

## Round twelve — the Crowd column reconstructed, and the rates model retired (2026-08-30)

The round that turned a discovery into a measurement. Round eleven found A1's free Retail
Sentiment page; this one drove their **Retail Sent. History** page, which publishes a long share
**per symbol per day**, and that is the difference between a cross-section and evidence: a daily
series can be joined to a Top Setups capture from a past date, and a snapshot cannot.

### CROWD — CONFIRMED, 8 of 8, through the production scorer

`npm run crowd-oracle`. For every (symbol, date) where this repo holds BOTH an A1 crowd cell and
an A1 long share for the **same** date, A1's own input is fed to `resolveCrowd` — the function
`buildSetupsMatrix` calls, not a copy of the rule — and the cell it returns is compared to A1's.

| symbol | date | A1 long% | via | ours | A1 |
|---|---|---|---|---|---|
| EURCHF | 2026-08-24 | 32 | own book (a CROSS) | +1 | +1 |
| EURUSD | 2026-08-24 | 25 | own book | +1 | +1 |
| EURX | 2026-08-24 | 25 | index from EURUSD | +1 | +1 |
| GBPUSD | 2026-08-24 | 31 | own book | +1 | +1 |
| XAGUSD | 2026-08-24 | 91.05 | own book (SILVER) | -1 | -1 |
| XAUUSD | 2026-08-24 | 95.08 | own book (GOLD) | -1 | -1 |
| CHFX | 2026-08-25 | 26 | index from 100 - USDCHF | +1 | +1 |
| NZDX | 2026-08-25 | 31 | index from NZDUSD | +1 | +1 |

Eight for eight, across two capture dates, two majors, one cross, two metals and three currency
indices — two of those reached only through the derived dollar-pair rule and one of them
inverted. The set is not easy: a cross has no futures contract, and a differenced model gets
EURCHF wrong.

**What it shows and what it does not.** It shows the TRANSFORMATION is right: given A1's input,
our rule returns A1's cell. It does not identify their upstream provider, which is named nowhere
on any of their pages, and it does not show that a purchased feed would agree with them.

**A correction it forced.** A previous round recorded that metals use a put/call ratio rather
than retail sentiment, inferring that from the two-decimal formatting of those rows. The
formatting split is real; the inference was not. GOLD and SILVER sit in the same daily retail
series and their 2026-08-24 shares produce A1's own XAUUSD and XAGUSD cells. Corrected in
`config/setups.config.ts`. Nothing changes in production — those two cells already resolve
correctly from their own contracts — but a feed keyed on metals is now expected to agree rather
than to break them.

**A caveat it forced.** The snapshot page and the history page do not agree on the same day.
Re-read on 2026-08-30 the snapshot still showed EURUSD 47, USDCHF 61 and GOLD 10.84 — values that
appear nowhere in those symbols' August history — while its NZDUSD (48) matches the history's
2026-08-29 point exactly. So the snapshot is each symbol's latest row and those rows are not all
the same day. Round eleven's fixture recorded its numbers as "live, 2026-08-29"; that dating is
now marked wrong in the fixture itself. The cross-sectional findings it was captured for — the
Bearish/Bullish/Neutral banding and the eight index identities, both internal to one screen —
are unaffected.

### RATES — the quarter-over-quarter model is FALSIFIED, and CHF is no longer missing

Round eleven recorded "compare current quarter to next quarter" as A1's rates rule on a 3-of-5
fit. It is wrong, and the refutation needs no timing argument:

- On **2026-08-29** A1's own free Forex Scorecard prints **EURCHF Interest Rates: Bullish (+1)**.
- On the **same day** their own Interest Rate Projections chart reads **EUR 2.7 to 2.7** and
  **CHF 0.0 to 0.0** across 2026Q3 to Q4.
- A quarter-over-quarter difference is `0 - 0 = 0`. It cannot be +1. Same day, same source, no
  confound.

**CHF is not a hole in their dataset.** Round eleven reported that CHF "renders no bars and no
line". Half right: with CHF selected alone the bar chart is empty because every bar is zero, but
the line chart draws a flat line whose tooltip reads **`CHF: 0,0%`** at every one of the five
quarters. Five hovers, five explicit zeros — and correct, since the SNB has been at 0.00% since
mid-2025. The consequence is stronger than the correction: under any quarter-over-quarter rule
CHF's leg is **0 forever**, so that rule cannot produce the -1 the 2026-08-24 solve implied.

**A1's asset-side rates input IS confirmed, and it is not the FX one.** Their free Asset
Scorecard prints its interest-rate row label verbatim as **`US02Yield (21 day SMA)`** — read off
the PLATINUM card. That is exactly what `scoreYield2y` does for DXY and every non-FX asset. The
**generalisation** of that rule to each currency's own 2-year stays rejected: tested against real
historical yields on 2026-08-24 it misses USD, EUR and GBP. `lib/scoring/source-confidence.ts`
now holds those as two separate entries, graded CONFIRMED and UNKNOWN, because collapsing them is
how the rejected theory came back twice.

**Nothing was changed.** The FX rates input is graded **UNKNOWN**. A level differential fits
EURCHF (EUR 2.7 vs CHF 0.0) and GBPUSD on 2026-08-24 (GBP 4.0 above USD 3.8) but fails EURUSD on
that date. One rule fitting two rows out of three is what the ledger exists to stop being written
down as a finding.

**And one earlier "measurement" is downgraded.** "CHF rates = -1 on 2026-08-24" was derived by
assuming the rates column is leg-differenced, then reading EUR off EURX and subtracting. The
2026-08-29 EURCHF reading is hard to reconcile with any per-currency leg assignment, so that
structural assumption is now graded SUPPORTED rather than treated as given, and the CHF -1
inherits the doubt. It must not be quoted as a measurement.

### GBPX — decomposed as far as the evidence allows, which is not all the way

On the 2026-08-23 board GBPX is **ours -1, A1 0** — a one-point gap, not the +2 of earlier
rounds. `npm run row -- GBPX GBPUSD` breaks it out.

**The GBP legs are not the cause, and this is showable without a GBPX row.** GBPUSD is **EXACT
(+10 vs +10)**, and it carries every GBP economic leg that GBPX does. If a GBP leg were wrong by
`k`, every GBP-base pair would shift by `+k` together and EURGBP by `-k`. They do not: GBPUSD 0,
GBPAUD -2, GBPJPY -2, GBPNZD -2, GBPCAD **+2**, EURGBP -1. The signs disagree, so the residual
sits in the counterparties, not in sterling.

**Which leaves the four columns a leg cannot explain** — trend, seasonality, COT and crowd, all
read off the index INSTRUMENT rather than from any leg. Our GBPX prints trend -1, seasonality -1,
COT 0, crowd 0 against an economic block of +1. One of those four is worth one point and nothing
on file says which.

**It cannot be closed without a checksum-valid GBPX row, and there is none.** The only GBPX row
ever captured was withdrawn in round ten for carrying three US-only values on a row with no
dollar leg. Note also that our GBPX COT cell (0) and our GBP COT leg (+1) differ **by design** —
an index row scores both COT components, a pair leg scores only the weekly change — so that is
not the discrepancy it looks like.

### Implemented

**1. A1's retail sentiment as a dated oracle, with a join that runs.**
- *Evidence.* `fixtures/a1-retail-sentiment-history.json` — eight instruments' daily long shares,
  read out of the chart's own accessible data table and paired index-for-index with the same
  chart's axis labels.
- *Code.* `lib/scoring/crowd-oracle.ts` builds a feed for ONE date (no "latest available"
  fallback, which would turn a stale share into a false match) and replays it through
  `resolveCrowd`. `scripts/crowd-oracle.ts` prints the join; `npm run crowd-oracle`.
- *Affected cells.* None. It is a measurement, not a scorer.
- *Tests.* 17 in `lib/scoring/crowd-oracle.test.ts`, including the 8/8 join, the inversion, the
  no-carry-forward rule, and a check that the fixture's written join table agrees with the
  computed one.

**2. `shortPct` on the provider contract.** Carried when a provider states it, never derived and
never read by the scorer, so a value that fails to complement `longPct` is visible at the edge
rather than silently normalised. `lib/scoring/crowd.ts`, `lib/connectors/crowd.ts`.

**3. Cross-date leg solving made structurally impossible.** `solvePerCapture` in
`lib/scoring/a1-legs.ts` takes dated captures and solves each alone; two captures claiming one
date throw. `scripts/component-parity.ts` and `scripts/rates-research.ts` now go through it. The
test that earns it shows the real hazard: merging two captures with a spread is **silent** — the
later one overwrites the earlier, the solve comes out clean, and nothing says a date was dropped.

**4. A source-confidence ledger.** `lib/scoring/source-confidence.ts` and `npm run sources`:
per component, A1's source, A1's transformation, ours, a grade of CONFIRMED / SUPPORTED /
UNKNOWN / BLOCKED, and the dates the grade rests on. Twenty-two entries covering all eighteen
slots plus four cross-cutting mechanisms. Its own tests refuse a grade without a dated
observation, a BLOCKED entry without a named blocker, and an entry whose evidence is too thin to
be a measurement. **A grade never moves because parity improved.**

### Parity

Unchanged by this round's changes, which are all measurement or documentation. The board numbers
below moved against round eleven's because they are scored on live technicals and a live crowd
read, which do not rewind — see the reproducibility tags in `npm run component-parity`.

| | round eleven | round twelve |
|---|---|---|
| Cell parity (`npm run top-setups-parity`) | 84/98 EXACT (85.7%) | **84/98 EXACT (85.7%)** |
| Component matrix EXACT | 104 | 103 (1 cell to TIMING_CONFOUNDED, live data) |
| Board TOTAL ABS GAP | 107 | 113 (live drift; no scoring changed) |
| Board exact rows | 8 | 7 |
| Tests | 767 | **799** |

## Round eleven — EdgeFinder used as the oracle, not the subject (2026-08-29)

The first round that stopped inferring A1's inputs from screenshots and read them off A1's own
free, public dashboards. Two of them turned out to publish, in the clear, things this project had
spent several rounds trying to deduce.

### The correction that unlocked it

A prior round examined the free Retail Sentiment page, scrolled it to its boundary, counted 19
symbols, found no FX crosses, and closed the avenue as a dead end. **That reading was wrong.** The
page's *Category* control defaults to Indices + Major Currency Pairs + Metals + Commodities.
Switching on "Minor Currency Pairs" reveals 22 crosses; switching on "Currencies" reveals the eight
currency-index rows. Nothing was locked — a filter was set.

### CONFIRMED — the 40/60 crowd bands, and both "contradictions" dissolved

A1's chart labels every row **Bearish / Bullish / Neutral** in its accessibility tree. On
2026-08-29 it partitioned 29 rows exactly on 40/60, and **EURGBP at exactly 40 is Bullish** —
pinning the lower bound as inclusive, which is what `scoreRetailLongPct` already did. The upper
bound is bracketed (58 Neutral, 60.84 Bearish).

The EURCHF ≈48% and GBPCHF ≈50% figures that had sat as contradictions for several rounds were
**FXSSI's numbers standing in for A1's**, adopted precisely because A1's page was believed to lack
crosses. A1's own historical feed for 2026-08-24, the day those cells were captured:

| symbol | A1's long% | rule | A1's Top Setups cell |
|---|---:|---:|---:|
| EURUSD | 25 | +1 | +1 ✓ |
| GBPUSD | 31 | +1 | +1 ✓ |
| EURCHF | 32 | +1 | +1 ✓ |
| GBPCHF | 36 | +1 | +1 ✓ |

The bands were never wrong. **A side effect: FXSSI is no longer a confirmed match for A1's
source** — it agreed to the point on the seven dollar majors, which is all the old 6/7 check
measured, and it does not agree on crosses.

### CONFIRMED — how a currency-index row gets a crowd cell

Open since round two. Each of the seven non-dollar index rows *is* its own dollar pair:
GB-POUND 50 = GBPUSD 50, NZ-DOLLAR 48 = NZDUSD 48, EURO 47 = EURUSD 47, AU-DOLLAR 28 = AUDUSD 28,
CA-DOLLAR 58 = 100−USDCAD, JP-YEN 56 = 100−USDJPY, CH-FRANC 39 = 100−USDCHF. Eight for eight.
US-DOLLAR is the exception at 92.51% — two decimals, like their index and CFD rows, which no
dollar pair produces — so the dollar index reads its own book.

### CONFIRMED — the Interest Rates input, in A1's own words

Their free Interest Rate Projections page says: *"The graph above shows market consensus estimates
on future projected interest rates for the selected currencies/economies."* Plotted **by calendar
quarter**, over AUD, CAD, CHF, CHY, EUR, GBP, INR, JPY, NZD, USD, ZAR. Their Forex Scorecard
corroborates the shape: every economic row is labelled *"X vs. forecast"* and this one is labelled
simply **"Interest rates"** — the only row with no comparison suffix.

That retires two hypotheses at once. It is *not* the bank's own projection (only the Fed publishes
one) and *not* a market-price proxy (the 2Y-vs-21-day-SMA idea, rejected twice). Tested
quarter-over-quarter against the legs solved from A1's checksummed rows: **NZD +1 ✓, EUR 0 ✓,
GBP 0 ✓**, USD ✗, JPY ✗ — and the two misses are timing-confounded, the projections being today's
consensus against legs 4–8 days older with Jackson Hole in between.

Round ten's `resolveNextRateDecision` therefore survives, and is better supported than when it
shipped: for NZD the next-meeting consensus (2.50→2.75) and the next-quarter projection
(2.75→3.00) are the same quantity at different granularity, and both give +1.

### Measured and reverted: widening the calendar's forward window

A1's horizon is a quarter, so the 7-day forward fetch looked plainly too short. Widening it to 100
days worked mechanically — the event pool went 4,297 → 6,481 and every G10 meeting appeared — and
bought **nothing**: not one meeting beyond 12 days carried a consensus. FXStreet publishes a rate
forecast only in the days before the meeting. No cell moved; the payload grew a third. Reverted,
with the measurement recorded in `FXSTREET.historyLookaheadDays` so it is not retried.

### What was NOT taken

A1's dashboards are the oracle and **not** a production dependency. They are embedded Looker
Studio reports over proprietary "EdgeFinder Pro" data with no documented API, and the standing rule
here is no scraping and no undocumented endpoint in the pipeline. Everything read this round is
frozen as evidence in `fixtures/a1-edgefinder-demo-2026-08-29.json`.

---

## Round ten — a scoring change lands, and round nine is retracted (2026-08-29)

**Round nine's headline was wrong.** It admitted a GB-POUND row on two checks — its eighteen
cells summed to the printed total of 0, and that total matched an independently captured one —
and concluded that GBPX's gap decomposed into nine economic mismatches, that GBP's rates leg was
now checksummed, and that A1's board might not be leg-differenced after all (the solver's
self-contradicting column count had jumped from 2 to 8).

All three conclusions came from misread cells, and the reason both checks missed it is worth
stating once, plainly: **a sum is invariant under permutation.** These crops have to be
partitioned into six header groups by eye — 2|2|5|3|1|5 = 18 — and a partition that shifts values
between neighbouring columns adds to exactly the same total. Row-sum and total cross-validation
are both blind to it by construction.

### The check that catches it

`checkStructuralZeros` (`lib/scoring/a1-legs.ts`). PCE, NFP, initial claims, ADP and JOLTS are US
series and nothing else, so a row with no dollar leg cannot carry a value in them and A1 prints 0
— the convention `component-parity.ts` already relied on for its NOT_VISIBLE status. A non-zero
there is not a difference of opinion about the economy; it is arithmetic that cannot happen.

It found five rows across two independently captured fixtures, every one of which had passed the
row-sum checksum:

| row | fixture | breach |
|---|---|---|
| GB-POUND | 2026-08-25 capture F | pce -1, NFP +1, claims -1 |
| EURJPY | 2026-08-25 capture F | pce -1 |
| JPYX | a1-board 2026-08-21 | pce -1 |
| GBPJPY | a1-board 2026-08-21 | pce -1 |
| CADX | a1-board 2026-08-21 | claims +1 |

The three `a1-board` rows sit in captures no solve currently selects (`boardCellsForSolve` takes
the newest dated capture, 2026-08-23, which carries DXY alone), so nothing downstream rested on
them — but five breached rows across two independently captured fixtures says this is the norm for
dense crops, not a one-off.

Rows are discarded entirely, never repaired: a breach says the partition is wrong somewhere, not
where. With GB-POUND and EURJPY screened out the leg solve's contradicted-column count returns to
**2** (crowd, unemployment). The "structural finding" was these five cells.

### A second methodological correction: the solver was date-blind

Admitting 2026-08-25's CHFX row made the rates column report `satisfiable=false` — CHF = -1 on
2026-08-24 (via EURCHF against EURX) and CHF = 0 on 2026-08-25 (via CHFX). The solver was right;
merging dates was wrong. **A leg is not a constant.** `scripts/component-parity.ts` and
`scripts/rates-research.ts` now run one solve per date.

### What survived, and what it bought

Two rows from capture F pass all three checks and cross-validate against capture D's totals:
**NZDX** (11 EXACT / 2 MISMATCH / 1 TIMING_CONFOUNDED / 6 NOT_VISIBLE) and **CHFX** (11 EXACT /
2 MISMATCH / 5 NOT_VISIBLE). Eleven independently computed cells agreeing is itself corroboration
the transcriptions are genuine.

### IMPLEMENTED — the Interest Rates column now scores non-USD currencies

This file has said for several rounds that "only the Fed publishes a numeric projection, so every
other currency scores an honest 0." That conflated two different claims: *no bank publishes a
forecast* (true) and *no forecast exists* (false). The calendar this app already fetches carries
a **consensus for every scheduled decision**, and a consensus that differs from the standing rate
is a forecast of a move — the same quantity the dot plot gives for the US, from a different
forecaster.

- **Evidence.** A1's NZDX row, 2026-08-25, prints Interest Rates **+1** — the only non-zero
  non-USD rates leg on that board. On that date the RBNZ's 2026-09-02 decision carried a consensus
  of **2.75%** against a standing **2.50%**.
- **Root cause.** `scoreRateExpectation` looked only for `RATE_PROJECTION_MATCH` and returned 0 on
  failure, never at the scheduled-decision rows sitting in the same event pool.
- **Code.** `resolveNextRateDecision` in `lib/scoring/rates.ts`, second in precedence behind the
  dot plot. `asOf` in `lib/scoring/backtest.ts` now keeps future-dated events that have no actual
  yet, so a rewound board can see a meeting that had not happened but was on the calendar.
- **Affected cells.** NZD's leg, and only NZD's, on today's data. Every other currency has either
  a dot plot (USD, unchanged) or no scheduled decision in the calendar's window.
- **Parity.** NZDX's rates cell goes 0 → **+1, EXACT**. The rates column across every checksummed
  cell is now **7 EXACT / 1 MISMATCH**, the one mismatch being EURCHF on 2026-08-24. `WHICH LEG`
  in `npm run parity` reads NZD delta **0**.
- **Regression.** Eight cases in `lib/scoring/rates.test.ts`, including the NZDX row itself, the
  BoC hold as a contrapositive, and the dot-plot precedence check.
- **What it rests on: one positive checksummed example.** Stated in the code, not buried here.

### Measured and NOT changed

- **The 2Y-vs-21-day-SMA rates candidate stays rejected**, and more firmly: on the one date where
  four independent equations pin the legs, it misses USD (-1 vs 0), EUR (0 vs +1) and GBP (0 vs
  +1), matching only CHF on 24-day-stale data. Chasing AUD/NZD historical series to rescue it
  would not change that; the rule is already falsified on three currencies with clean same-day
  data.
- **The 40/60 crowd thresholds stay put.** There are now **two** contradictions (EURCHF 48%,
  GBPCHF 50%, both scored +1) rather than one, and a ≤55 bullish threshold would fit all seven
  observations — but the five CONFIRMING rows use A1's own published long% and the two
  contradicting ones use FXSSI's as a stand-in, because A1's public page carries no crosses. See
  `EdgeFinder-known-unknown-blocked.md` for the table.
- **CHF consumer confidence.** A1's 2026-08-24 rows imply +1, A1's 2026-08-25 CHFX row prints 0,
  ours is -1 — and scoring SECO Consumer Climate against the previous print instead of the
  forecast would yield exactly +1. One reading each way is not evidence, and the config's own bar
  for that override ("our feed carries no consensus either") is not met.

---

## Round nine — GBPX closed with real evidence (2026-08-26) — RETRACTED, see round ten

**No production scoring change, but a major evidence upgrade.** A clean, isolated 18-cell
GB-POUND (GBPX) row checksummed exactly (cells sum to 0, matches the printed total, and
cross-validates against the already-recorded 2026-08-25 total for the same row) — the first real
cell-level GBPX evidence this project has ever had. Two more rows from the same screenshot batch
also checksummed clean and cross-validated: NZD-DOLLAR (NZDX) and EURJPY. Two others in the same
batch (EURGBP, UK100) did not clear the bar and were explicitly excluded, not guessed — see
`fixtures/a1-top-setups-2026-08-25.json`'s `_cellsReadme`.

Feeding these into `npm run component-parity` (extended this round to run two date contexts,
2026-08-24 and 2026-08-25, since capture F gave 2026-08-25 real cells for the first time)
decomposes GBPX's long-standing +2-ish gap precisely: 6 EXACT (including rates — GBP's honest-0
default is now CHECKSUMMED-confirmed, not just algebra), 9 MISMATCH (entirely Economic:
gdp/mpmi/retail-sales/consumer-confidence/ppi/pce/employment/unemployment/claims), 1
TIMING_CONFOUNDED (crowd), 2 NOT_VISIBLE. The gap was never a Rates or index-mechanism problem —
it's Economic, and four of the nine mismatching slots are the same ones already flagged on
GBPUSD, which is convergent evidence pointing at GBP-series-selection issues rather than
anything GBPX-specific.

A second real finding: NZDX's own row shows a checksummed **rates MISMATCH** (ours 0, A1 +1) —
the "only CHF is wrong" framing from round seven is now outdated. Two non-USD currencies are
confirmed wrong, in opposite directions, which any single non-USD rule would need to explain.

A third, structural finding: adding GBPX and EURJPY as real constraints raised `solveA1Legs`'s
self-contradicting-column count from 2 to 8 (crowd, mpmi, consumer-confidence, ppi, pce,
employment, unemployment, claims) — the simple linear currency-differencing model most
`NOT_CHECKSUMMED` economic predictions rest on is now shown to be unreliable for most economic
slots, not just the one EURO/EURUSD unemployment case flagged in round four.

Separately, confirmed by direct browsing (no scraping, no account creation) that the free public
a1trading.com Retail Sentiment widget carries zero FX crosses, and no free page anywhere on the
site carries the actual "2Yr Yield (21-day SMA)"-style Rates evidence card — both dead ends for
further public-web research, not yet explored via any other route.

`lib/scoring/rates.ts`, `lib/scoring/crowd.ts`, `lib/scoring/technical.ts`, `config/setups.config.ts`
were not touched. `scripts/component-parity.ts` was extended (two date contexts instead of one) —
tooling, not scoring.

## Round eight — new screenshots checked against fixtures, found to be a duplicate (2026-08-26)

**No production or fixture change.** Three new "A1 Trading Show" livestream frames arrived,
apparently new EdgeFinder evidence at first glance. Checking them against
`fixtures/a1-top-setups-2026-08-25.json` before transcribing (per memory
`a1-evidence-already-ingested`) found they are the SAME capture already recorded there as
captures D/E: same source ("A1 Trading Show" livestream), same date (2026-08-25), same host
framing, and every row total legible in the new frames (EURUSD 13 through USDJPY 0, and the
bearish tail USOIL -4 through USDCAD -11) matches the fixture exactly. That fixture's own README
already documents that cell-level transcription of this exact capture type was attempted and
discarded (EURUSD's 18 cells summed to 14 against a printed 13) — so no fresh cell-level
transcription was attempted here either; repeating discarded work adds nothing.

Two things in the new frames are not already in the fixture:

1. Several "Neutral" middle-band rows are visible that captures D and E don't cover (EURNZD,
   EURCAD, NIKKEI, NATGAS, EURCHF, CADCHF, NZDCHF, DAX, CHINA50, AUDJPY, NASDAQ, JP-YEN, COPPER,
   BITCOIN, AUDNZD, AU-DOLLAR).
2. Two rows where this round's read of the new frames appears to disagree with capture E:
   NZDCAD reads -5 here vs. -6 in the fixture; RUSSELL reads -7 here vs. -6 in the fixture.

Neither was written into the fixture. The frames are paused-video captures (play-button overlay,
captions, webcam picture-in-picture crowding the grid, compression artifacts) — the same shape
the existing README already flags as the one that fails checksum roughly a third of the time —
and this round has no way to zoom into the source video to raise confidence. Writing a shaky read
into a fixture that downstream tooling (`solveA1Legs`, `component-parity`) treats as evidence
would be exactly the kind of unverified-assumption contamination this project's rules forbid.
The two disagreeing values are flagged here as an open question (possible transcription error in
one of the three sources, or genuine intraday board movement on 2026-08-25) rather than resolved
in either direction.

**Net effect this round: confirms the existing fixture is trustworthy (three independent
sources now agree on all overlapping legible rows) and adds no new usable evidence.** No files
in `fixtures/` were modified. No production scoring file was touched. The still-open evidence
asks are unchanged from the list at the bottom of `EdgeFinder-known-unknown-blocked.md`
(GBPX full row, EURCHF + one more cross Retail Sentiment, a CHF/GBP rates evidence card, a second
checksum-valid currency-index row) — none of those four evidence types are present in this
screenshot set.

## Round seven — the Rates experiment, hypothesis tested and rejected (2026-08-26)

**TOTAL ABS GAP unchanged at 72.** `lib/scoring/rates.ts` was not touched. This round built a
controlled experiment rather than more documentation: does "2-year yield vs. its own 21-day SMA",
the rule `scoreYield2y` already uses for DXY, reproduce A1's per-currency Rates leg when run on
every major's OWN yield, using real historical government data?

Two things had to happen before the experiment could run. First, re-solving `solveA1Legs` on the
UNION of every checksum-valid row (not just EURCHF) found that EURX, EURUSD and GBPUSD ALSO
constrain the rates column, and all four agree with zero conflicts: USD=-1, EUR=0, GBP=0, CHF=-1
— four independent equations, not the one algebraic row prior rounds worked from. Second, real
daily 2-year yield series were fetched for USD (FRED), EUR (ECB), GBP (Bank of England's nominal
spot curve, archive + current-month files combined), CAD (Bank of Canada) and CHF (SNB), all
aligned to 2026-08-24, the date the four evidence rows were captured.

**The hypothesis failed for EUR and GBP.** The candidate predicted +1 for both; A1 reads 0 for
both. It matched CHF (-1), but only on data 24 days stale — SNB's source has published nothing
since 2026-07-31. USD's -1 could not be reached by the candidate at all (its raw signal was a
marginal +0.39%, the wrong sign); USD's -1 turns out to already be fully explained by the EXISTING
dot-plot rule, which was not in question. Net: 1 of 4 currencies with real evidence matched, on
weak (stale) grounds, and the currency that mattered least (USD, already correct) is the one the
candidate could not touch.

A documented threshold ambiguity — this codebase already has TWO different flat-band conventions
(`YIELD_FLAT_BAND`, relative; `RATE_SPREAD_FLAT_BAND`, absolute) — makes this worse, not better:
the absolute band flips EUR/GBP to matching but CHF to failing. Neither was selected; picking
whichever fits more cells is the score-fitting this project's rules forbid. Full breakdown in
`npm run rates-research` and [`EdgeFinder-known-unknown-blocked.md`](EdgeFinder-known-unknown-blocked.md).

No production file changed. The new research-only pair — [`lib/scoring/rates-research.ts`](lib/scoring/rates-research.ts)
(the candidate rule, isolated) and [`scripts/rates-research.ts`](scripts/rates-research.ts) (the
experiment runner) — stays that way until a hypothesis actually survives contact with evidence.

## Round six — GBPX/Crowd/Rates evidence push, no scoring changed (2026-08-25)

Also diagnostics/research only. **TOTAL ABS GAP unchanged at 72** — no file under `lib/scoring/`
that feeds a live cell was touched this round; nothing was added to `lib/scoring/a1-legs.ts` or
`component-parity.ts` either, since no new evidence arrived to wire in.

Followed round five's own priority order (GBPX → Crowd → Rates → currency indices → historical
replay) and, per the round's rule, did not implement anything without a complete evidence chain.
GBPX and Crowd both stayed genuinely blocked: re-checked every fixture in the repo and confirmed
(again) that no cell-level GBPX row exists anywhere, and no new retail-sentiment screenshot arrived
to extend the single EURCHF crowd data point into a measured function — both are documented as
open asks, not worked around.

Rates is where this round actually moved something, by testing sources live instead of only
reading their documentation:
- **CHF's previously-cited source is dead.** The `rendoblid` SNB cube stopped updating in
  July 2025 (SNB migrated methodology); the live replacement, cube `rendeiduebd`, was found and
  confirmed to return real daily 2-year CHF yields.
- **GBP is no longer blocked.** The prior round's HTTP 403 was against the wrong URL — Bank of
  England's actual data file (a zip linked from the yield-curves page) fetches cleanly and
  contains a real, current 2-year nominal spot yield column.
- CAD and JPY were reconfirmed live (not just documented). AUD's block was confirmed to be
  WAF-level bot-protection, not the simple header issue previously assumed — a stronger negative
  result than before, not a fix.

None of this was wired into `lib/scoring/rates.ts` — a live-fetched source is not the same as a
reproduced A1 cell with a regression test, and only one checksummed observation (EURCHF) exists to
validate against. Full detail in
[`EdgeFinder-known-unknown-blocked.md`](EdgeFinder-known-unknown-blocked.md), updated in place.

## Round five — component-level parity tooling, no scoring changed (2026-08-25)

Diagnostics and research only. **TOTAL ABS GAP unchanged at 72** — nothing in `lib/scoring/`
that feeds a live cell was touched; the only additive export is `lib/scoring/a1-legs.ts`'s
`predictCell`, a read-only helper over an already-solved leg assignment.

This round's finding was that a total-level gap cannot say WHICH column is wrong, or whether a
column's disagreement is even measurable — `lib/scoring/backtest.ts`'s `asOf()` only rewinds
`events` and `cot`; `technicals`, the retail-crowd feed, and `yield2y` stay live no matter what
date a script rewinds to, so a mismatch on one of those columns at a historical date may be
today's live reading being compared against yesterday's capture, not a rule difference. Built
`lib/scoring/component-parity.ts` (`npm run component-parity`) to make that distinction
mechanical: every cell gets an evidence tier (a checksummed A1 cell, an algebraically solved
leg, or nothing) and a reproducibility tag, before it is called EXACT or MISMATCH.

Full per-component KNOWN / UNKNOWN / BLOCKED state now lives in
[`EdgeFinder-known-unknown-blocked.md`](EdgeFinder-known-unknown-blocked.md), edited in place each
round rather than appended to — this doc stays the chronological log of what changed and why.

One correction to the evidence backlog: `fixtures/a1-top-setups-2026-08-24.json`'s EURCHF row
(checksummed, cross-validated against the Forex Scorecard card) is simultaneously "one complete
checksum-valid row" *and* "one checksum-valid cross" — two separate asks from a prior evidence
request are already satisfied by evidence already on file. See the known-unknown-blocked doc for
the current evidence-request priority list.

## Round four — real Top Setups cells, and the crowd column rebuilt (2026-08-24)

Six screenshots from the A1 Trading Show livestream caught hosts with a paid seat scrolling the
**real Top Setups matrix** — the page the free demo locks entirely. This is the first genuine
per-cell evidence this investigation has had. Recorded in `fixtures/a1-top-setups-2026-08-24.json`,
compared by `npm run top-setups-parity`.

### Transcription discipline

Every row was transcribed cell by cell and then **checksummed against its own printed Score**
before being admitted. Four rows failed and were discarded rather than corrected by guesswork:
NZDUSD (read 5, printed 7), GBPJPY (read 6, printed 7), RUSSELL (read −6, printed −4),
US-DOLLAR (read −4, printed −6). Six passed: **EURUSD 13, SILVER 10, GBPUSD 10, GOLD 8, EURO 7,
EURCHF −1.**

Two independent checks confirm the admitted set is not merely self-consistent arithmetic:
GOLD and SILVER differ in exactly one cell (COT 0 vs 2), matching their 8 vs 10 totals; and
solving EURUSD against GBPUSD on their shared USD leg yields EUR mPMI = +1, which is exactly the
mPMI cell printed on the standalone EURO row — over-determined, and it could not pass by accident.

**A checksum validates the row sum, not each cell.** One contradiction proves the limit: A1's EURO
row reads unemployment 0, but their EURUSD row reads −2, which requires an EUR leg of −1. Either
their index rows use different leg values than their pair rows, or one of those cells is misread.
Unresolved, and therefore acted on in neither direction.

### Cell-level parity: 85 of 108 exact (78.7%)

| asset type | exact | of | % |
|---|---:|---:|---:|
| Metal / commodity (GOLD, SILVER) | 36 | 36 | **100%** |
| FX pair, dollar | 30 | 36 | 83% |
| Currency index | 11 | 18 | 61% |
| FX pair, cross | 8 | 18 | 44% |

**GOLD and SILVER are 18/18 exact.** Trend, seasonality, COT, sPMI and CPI are 6/6 across every
row. The single-economy engine reproduces A1 exactly.

**EURUSD is 17/18 exact and its entire +11 vs +13 gap is one cell — crowd.** This closes the
question that started the investigation: it is not an aggregation bug, a normalization bug, or a
missing rule. It is one column reading a different population.

### What changed in the code

**The Crowd column is now resolved per symbol** (`lib/scoring/crowd.ts`), replacing three inline
branches in `setups.ts` that disagreed about crosses. The resolution order is: a per-symbol retail
positioning feed → the symbol's own futures contract → nothing. Crosses land on *nothing* rather
than on `crowd(base) − crowd(quote)`, which measured retail positioning in two dollar pairs and
called it sentiment in a third instrument.

**Measured on the one cross whose real cell is visible:** A1 scores EURCHF crowd **+1**; the
difference scored **−1**; a blank scores 0. Half the error, and none of the false confidence.

**This change did not improve accuracy — it improved honesty.** Cell parity is *unchanged* at
85/108: it converted one wrong number into one declared blank. Board totals split by fixture:

| | before | after |
|---|---:|---:|
| 2026-08-24 capture, TOTAL ABS GAP | 57 | **56** |
| 2026-08-24 capture, exact rows | 9 | **11** |
| 2026-08-24 signed gap sum | −3 | **0** |
| 2026-08-23 capture, TOTAL ABS GAP | 77 | **85** |
| 2026-08-23 capture, exact rows | 12 | **8** |

**It is worse on the older fixture and better on the newer one.** Four crosses (CHFJPY, EURCHF,
AUDNZD, AUDCHF) were exact on 2026-08-23 under the differenced rule and are now off by one. That
is the expected price of declaring a gap instead of filling it with a proxy: A1 always has a crowd
value for a cross, so our blank is guaranteed to cost up to a point on every one of ~12 crosses
until a feed exists. EURCHF is the proof that those exact totals were luck rather than accuracy —
its total matched while the cell under it was inverted.

`RetailPositioningFeed` is the interface that closes this. Supplying it scores every cross
directly and needs no further scoring change; `buildSetupsMatrix` already accepts it, and tests
pin both the blank and the fed behaviour.

### What was NOT implemented, and why

| finding | why not |
|---|---|
| Crowd source on dollar pairs and indices (EURUSD, EURX, GBPUSD all differ) | **External data.** We read CFTC small traders; A1 reads a retail broker aggregate. No production-safe free provider. No code change fixes a population difference. |
| Non-USD `rates` legs (CHF proven −1 where we score 0) | **External data.** A1's rule is published verbatim on their card — *2 Yr Yield (21 day SMA)* — and we already hold current 2-year yields for all eight majors. We hold no **history** for the seven non-USD ones: the ECB URL requests one observation and TradingView's quote endpoint returns a single close. The rule is known; the input is not. |
| GBP `gdp`, `mpmi`, `ppi`, `retail-sales`; CHF `mpmi`, `consumer-confidence`; EUR `unemployment` | **Insufficient evidence.** Each is a series-or-basis question (MoM vs QoQ GDP, PPI Input vs Output, forecast vs previous) answerable only from A1's per-country Economic Heatmaps, which are paywalled on every tier we can reach. |
| Null vs zero on missing jobs cells | **Not a defect.** Proven arithmetically: EURX's −3 gap is exactly crowd (2) + unemployment (1), so the five null cells contribute 0 on both sides. `combinePairCells` already treats one missing leg as 0 and only returns null when both are absent. |

## Round three — the live demo as oracle, and a real cell-by-cell matrix (2026-08-24)

**No scoring changes in this round.** This is a measurement pass only, per instruction: stop
fixing, find out whether the engine is systematically incomplete before touching it again.

### What the live demo actually exposes

The free EdgeFinder demo (`lookerstudio.google.com/embed/reporting/cfd37bd1-45ce-459a-8d11-b6b7eac72b0d`)
is a 20-page Looker Studio report, not the single Retail Sentiment widget used in round two. Mapped
in full, its pages fall into three tiers:

| Tier | Pages | What it gives |
|---|---|---|
| **Full 18-cell card, locked to one demo symbol** | Asset Scorecard (PLATINUM only), Forex Scorecard (EURCHF only) | Every column, exact category subtotals, per-slot Bullish/Bearish/Neutral |
| **Single column, unlocked across many symbols** | Retail Sentiment (crowd, ~40 symbols), Latest COT Report (net positioning, 23 contracts), Monthly Seasonality (per-symbol dropdown, all symbols) | One column at a time, exact percentages |
| **PREMIUM ONLY — fully locked** | **Top Setups**, Top Setups (History), all nine Economic Heatmaps, Economic Data | Header/column names visible; **zero row data** |

**Top Setups is the exact matrix this investigation wants, and it is paywalled entirely** — "Premium
only feature" over a lock icon, on both the live and historical views. Its header is still worth
having: it lists the same 18 columns in the same 5 categories (Technical: Trend, Seasonality —
Sentiment: COT, Crowd Sentiment — Economic Growth & Consumer Strength: GDP, mPMI, sPMI, Retail
Sales, Consumer Conf — Inflation: CPI YoY, PPI YoY, PCE YoY, Interest Rates — Jobs Market: NFP,
Unemployment Rate, Unemploy Claims, ADP, JOLTS) that `MATRIX_SLOTS` already scores, in the same
order. That is a structural confirmation, not a data source.

So "a complete cell-by-cell matrix for as many symbols as the live demo exposes" has an honest
ceiling: **two symbols at full resolution, plus two columns at wide resolution.** Historical
screenshot captures (`fixtures/a1-board.json`) remain the only source for anything wider, used here
as supplementary evidence only, per instruction.

### The two full-card anchors

**PLATINUM (Asset Scorecard) — 17 of 18 cells exact, 1 ambiguous, 0 wrong.**

```
XPTUSD -- ours -2  A1 -2  gap 0
  trend                 +2   Bullish   sign matches; A1's badge carries no magnitude, so
                                       whether their trend is also +2 or capped at +1 is UNKNOWN
  seasonality  -1  -1  EXACT      cot  0  0  EXACT      crowd  -1  -1  EXACT
  gdp -1 -1  mpmi +1 +1  spmi -1 -1  retail-sales -1 -1  consumer-confidence -1 -1   (all EXACT)
  cpi 0 0  ppi +1 +1  pce 0 0  rates +1 +1                                            (all EXACT)
  employment -1 -1  unemployment +1 +1  claims +1 +1  adp -1 -1  jolts -1 -1          (all EXACT)
```

This is the cleanest evidence this investigation has produced: give the engine a single-economy
instrument with no leg-differencing to do, and every rule — technical, sentiment, all fourteen
economic columns — reproduces their card. The one open question (`trend`) is a resolution limit of
the reference, not a measured gap: their badge is Bullish/Bearish/Neutral with no magnitude, and our
`scoreTrend` can legitimately return ±2 (crossover) or ±1 (crossover contested by slope) — both read
as "Bullish". Concept C applies: **unknown, not wrong.**

**EURCHF (Forex Scorecard) — 8 of 18 slot-level cells exact, 5 different, 5 unscored on our side.**
Category subtotals are exact integers, not badges, and only one of six matches:

```
EURCHF -- ours -1  A1 -1  gap 0        (the total agrees; the cells that sum to it mostly do not)
  technical  -2  -2  EXACT
  cot         0   0  EXACT             (crowd and cot are SEPARATE boxes on this card, not combined)
  crowd       -   +1 DIFFERENT         ours: -    A1: +1
  growth     +3  -1  DIFFERENT
  jobs       -1   0  DIFFERENT
  inflation   0  +1  DIFFERENT
```

A cross pair's total can land on the right number while every category under it is wrong, because
the errors cancel: growth +4 too high, inflation −1 too low, jobs −1 too low, crowd unscored ≈ −1,
net ≈ 0. **The total is not evidence the columns are right — Platinum already proved the columns
work; EURCHF proves the differencing across two legs is where the error actually lives.**

Per-slot detail, with cause per Concept A/B/C:

| slot | ours | A1 | verdict | cause |
|---|---:|---:|---|---|
| crowd | *(unscored)* | +1 | **DIFFERENT** | **B — data source.** See below: crosses differenced from CFTC-currency crowd; A1 reads a broker feed per-pair directly. |
| mpmi | +2 | 0 | DIFFERENT | **C — unknown.** Not re-investigated this round; candidate for a targeted trace like the GBP one. |
| consumer-confidence | +2 | 0 | DIFFERENT | **C — unknown.** Same. |
| rates | 0 | +1 | DIFFERENT | **C — unknown, but pointed.** Non-USD rate legs are pinned to 0 in this repo; A1's card says otherwise for at least one CHF-side leg. This repo already fetches sovereign yields for all eight majors and deliberately does not score them (`dd30468`) — this is independent live evidence that gap is real, not just theoretical. |
| unemployment | −1 | 0 | DIFFERENT | **C — unknown.** |
| pce, employment, claims, adp, jolts | *(null)* | 0 (displayed) | MISSING_OURS | **C.** See "Jobs/growth on a non-USD cross" below — genuinely ambiguous whether A1's 0 is a scored zero or a display default. |
| trend, seasonality, cot, gdp, spmi, retail-sales, cpi, ppi | match | match | EXACT | — |

### Broad single-column results

**Crowd — 18 symbols, 4 exact, 14 different, all differences already sorted into a cause.**

```
symbol   A1 long%  A1 cell  ours  kind      status
USDCHF      79.00       -1    -1  fx        EXACT
USDJPY      55.00        0     0  fx        EXACT
NZDUSD      29.00       +1    +1  fx        EXACT
USDCAD      62.00       -1     0  fx        DIFFERENT   -- same population, drifted since round two
GBPUSD      31.00       +1     0  fx        DIFFERENT   -- same population, drifted since round two
AUDUSD      25.00       +1    -1  fx        DIFFERENT   -- same population, drifted since round two
EURUSD      25.00       +1    -1  fx        DIFFERENT   -- the known round-two gap, unchanged
GER40/XAUUSD/WTIUSD/XAGUSD/US30/XCUUSD/JP225/RUT2000/NAS100/SPX500
                                            -            DIFFERENT   -- put/call ratio, not retail %; different measure by construction
UK100, GER40 (crowd)                        -        -  MISSING_OURS -- no CME/Eurex contract at all (see structural gap below)
```

The three dollar pairs that were "fixed" in round two (USDCAD, GBPUSD, AUDUSD landing exact against
the 2026-08-23 capture) are **not exact today.** This is not a regression: CFTC reports weekly,
A1's feed refreshes every 5–30 minutes, and a rule that matched on one Tuesday is not guaranteed to
match the next. **Crowd parity for dollar pairs is a moving target measured against a stationary
report — treat any single day's exact/different count as a sample, not a verdict.**

**COT net positioning — 8 currencies + 12 assets, read against the same CFTC data we already
ingest.** For the 8 currencies this is a same-source sanity check only (A1 does not score net
positioning on an FX leg — "shown but not scored," already correct and tested in this repo, see
`cot.ts`). For assets it is half of the scored cell; the other half (weekly change) was not
captured live this round, so every asset row is **partial, not comparable to EXACT/DIFFERENT.**
Six of eight currencies bucket the same way we do (EUR and JPY sit near the 41–43% band, close
enough to flip on a fractional read); no systematic offset.

### Structural gaps found, not measured

**GER40 and UK100 cannot score COT or Crowd at all.** `symbols.config.ts` deliberately gives them
no `cotContract` — DAX trades on Eurex, FTSE has no CME-listed future — so there is no CFTC series
to read. A1's demo scores both anyway (GER40 crowd 96.45%, UK100 crowd 29.89%), meaning **their
sentiment columns for equity indices do not come from a futures-market feed at all** — consistent
with the put/call-ratio finding from round two. This is a real ceiling on this repo's current data
sourcing, not a bug: there is no futures-derived proxy for "retail sentiment on the FTSE."

**Jobs/growth columns on a non-USD cross.** EURCHF's Forex Scorecard shows all five Jobs Market
sub-rows (Employment Change, Unemployment Rate, Weekly Claims, JOLTS, ADP) as **Neutral**, and our
engine returns **null** for the same five slots (CHF and EUR have no JOLTS/ADP/PCE-equivalent
series to difference). Both conventions produce the same category total, 0 — but they get there
differently: theirs by scoring five neutrals, ours by contributing nothing at all. Whether A1's
"Neutral" is a genuine scored zero or a display default for a currency with no matching series is
**not determinable from the demo alone** (Concept C). It matters because our convention (null →
contributes 0 via `combinePairCells`) already produces the same arithmetic result either way, so
this is likely a non-issue — but it is asserted here as unresolved, not confirmed, because forcing
that conclusion is exactly what this round was told not to do.

### Cell-level parity summary

Counting only cells with a genuine live reference (the ambiguous Platinum `trend` cell held out
per Concept C, not forced into either bucket):

```
Total comparable cells:  54
Exact:                   28   (52%)
Different:               18
Missing on our side:      7
Held out (Concept C):     1
```

**This number is not the headline.** It is dominated by two structurally different regimes — a
single-economy card (Platinum, 94% exact) and a two-leg cross (EURCHF, 47% exact) — and a crowd
column deliberately compared against a different-by-construction measure for 11 of its 18 rows.
Averaging them into one percentage hides the actual finding, which is the breakdown below.

**By column** (cells with a live reference only):

| column | exact | of | % |
|---|---:|---:|---:|
| seasonality, cot, gdp, spmi, retail-sales, cpi, ppi, pce, employment, claims, adp, jolts | 1–2 | 1–2 | **100%** |
| trend, mpmi, consumer-confidence, rates, unemployment | 1 | 2 | 50% |
| crowd | 4 | 18 | **22%** |

Twelve of eighteen columns are at 100% on the data available. **Crowd is the one column that is
structurally, not incidentally, low** — both from the put/call-vs-retail-% source mismatch and from
the weekly-report-vs-live-feed timing mismatch.

**By asset type:**

| type | exact | of | % |
|---|---:|---:|---:|
| Metal (Platinum's own card) | 17 | 20 | 85% |
| FX pair (cross) | 8 | 13 | 62% |
| FX pair (dollar) | 3 | 7 | 43% |
| Commodity | 0 | 2 | 0% |
| Equity index | 0 | 5 | 0% |

Commodity and equity-index rows read 0% exact **only because every comparable cell for them this
round was a crowd cell compared against a put/call ratio** — a different-measure mismatch by
construction, not fourteen economic columns failing. Read alongside Platinum's 17/18 (which
includes all fourteen economic columns, exact), the honest statement is: **the economic engine is
not "missing something on every symbol." The crowd column is a different data source on every
non-dollar-pair symbol, and that alone accounts for most of the low asset-type numbers above.**

### Top systematic causes, ranked by cells affected

| # | Cause | Cells | Class |
|---|---|---:|---|
| 1 | Crowd: put/call ratio (metals/indices/commodities) vs retail futures % (FX) | 11 of 18 sampled | **B — confirmed data source** |
| 2 | Crowd: CFTC weekly report vs A1's 5–30 min retail feed, sampled on different days | 3–4 of 7 dollar pairs | **B — confirmed data source**, timing not population |
| 3 | Crowd, crosses: differenced CFTC-currency proxy vs A1's direct per-pair broker read | EURCHF confirmed; ~12 cross pairs structurally exposed | **B — confirmed data source / possible architecture gap**, see below |
| 4 | EURCHF growth/jobs/rates sub-cells (mpmi, consumer-confidence, unemployment, rates) | 4 confirmed this round | **C — unknown**, not traced |
| 5 | GER40/UK100 sentiment columns | 2 symbols × 2 columns | **Missing data — structural**, no futures contract exists |
| 6 | Non-USD rate legs pinned to 0 | 1 confirmed (CHF, via EURCHF), 6 more currencies exposed | **C — unknown, but independently corroborated** by the already-fetched, deliberately-unscored sovereign yield data |

### Architecture finding: the crowd column cannot be one rule

Round two proved crowd is FXSSI-style retail long %, read **per instrument, not differenced**, for
seven dollar pairs and seven crosses alike (EURGBP 38%, EURJPY 26%, etc. were direct reads on their
demo). This repo's crowd code took that finding exactly as far as the dollar pairs — `pairContract`
gives it a real CME contract to read directly — and left crosses on the **old differenced-CFTC-
currency rule**, with a comment recorded at the time: *"CROSSES KEEP THE DIFFERENCE. There is no
EURJPY contract, so the two legs remain the only available proxy."* That reasoning assumed the only
available data was CME futures. It no longer holds: A1's own source is a broker feed with no
CME-contract dependency, so a cross's absence of a futures contract is not evidence a cross's crowd
must be differenced — it is evidence this repo has not tried to reach the retail feed for crosses
either. EURCHF's crowd (ours: unscored via the currency-difference path; A1: +1, direct) is now a
measured instance of exactly this gap, not a hypothesis. **No provider was added or changed — this
is reported as found, per instruction.**

More broadly, on the question of whether one rule fits every column: **trend, seasonality, and the
fourteen economic columns generalize cleanly across every asset class this round could reach**
(Platinum's card proves it for a single-economy instrument; the exact economic cells on EURCHF
prove the leg-differencing machinery works when both legs have the series). **COT and Crowd are the
two columns that do not** — COT already has a documented, tested split (FX legs score weekly change
only; assets score both); Crowd has no split at all yet, and should, on the evidence above: retail
futures % for dollar pairs (already implemented), a direct per-pair feed for crosses (not
implemented, would need a new data source and is explicitly out of scope this round), and a
put/call proxy for metals/indices/commodities (not implemented, same caveat, and this repo has no
options-market connector today).

### Recommended investigation order — nothing implemented

1. **Trace EURCHF's four unresolved cells (mpmi, consumer-confidence, unemployment, rates)** the
   same way the GBP PPI cell was traced in round two — against a published card, not a total. Rates
   is the most promising: this repo already fetches the data it would need.
2. **Decide the crowd architecture for crosses before touching any code** — the current rule is
   provably inconsistent with A1's own demonstrated behavior, but fixing it requires either a new
   data source (explicitly deferred) or accepting the differenced-CFTC proxy as a known, permanent
   gap. This is a decision, not a bug fix.
3. **Re-run the crowd comparison on a COT report day** (Tuesday data, published Friday) instead of a
   random Monday, to separate "wrong rule" from "stale week" for the three dollar pairs that flipped
   since round two.
4. **Confirm the jobs/growth-on-non-USD-cross question is genuinely a non-issue** by checking whether
   any OTHER cross (not just EURCHF) ever produces a non-zero total for a slot our engine nulls —
   if none ever do, the current null-contributes-0 convention is provably equivalent and needs no
   change.
5. **Do not chase Crowd's 22% column score as if it were fourteen bugs.** It is one architecture
   decision (population source per asset class) appearing eleven times and one timing artifact
   appearing three times — fixing the decision fixes the column; fixing rows one at a time will not.

### New tooling

`npm run live-matrix` — the script behind every table above. Hand-transcribed live reference data
(dated, sourced per line) diffed against a freshly-scored board, no `asOf` rewind. It is not a
replacement for `npm run parity` (which validates against a large historical capture); it is the
only tool in this repo that can check a cell against a source OTHER than a screenshot.



**TOTAL ABS GAP 74 → 72**, exact 14, within 2 37 → 38, stable across three runs. One fix
shipped; the larger result is that the Crowd column's data source is now identified rather than
inferred, and the remaining gap is grouped by cause.

### GBP — the leg was nearly right; one cell was badly wrong

The parity `WHICH LEG` table read GBP as **+4 too high**, and that reading is an artefact. It
measures a currency off its own index row, which is 4/18 non-macro cells. A least-squares fit of
leg errors over all 47 captured totals — with EUR and USD pinned at 0 by their EURUSD card and
their DXY row — put GBP's macro legs at **+1**, not +4. Every GBP pair sat within 2 of theirs
while GBPX sat at 4, which no leg error can produce: a bad leg moves the index row and all seven
pairs together.

The +1 was one cell, and their own published UK card names it three times over:

| | series | basis | age | cell |
|---|---|---|---|---|
| ours (before) | `PPI Core Output (MoM) n.s.a` | forecast | **68 days** | +1 |
| their card | `PPI YoY`, Actual 3.4, Forecast **blank**, Previous 3.4 | previous | — | 0 |
| ours (after) | `Producer Price Index - Output (YoY) n.s.a` | previous | 5 days | −1 |

Core output MoM carries no consensus on any recent UK print, so a forecast basis disqualified
every fresh release and `resolveSeries` walked back two publication cycles to 2026-06-17 — the
last print that had one. The release it stepped over, 2026-08-19, reads 3.1 against a 3.5
previous and a 3.2 consensus: **−1 on either basis**. The slot's 90-day window existed only to
let that reach-back happen.

The override it replaces was fitted to a single cell, and the fit compared a *fresh* headline
print against a *stale* core one — 2026-07-22 against 2026-06-17. It never considered the YoY
series, because a forecast basis had already ruled it out.

**Result:** GBPUSD +2 → **0 (exact)**, GBPCAD +1 → **0 (exact)**, GBPX +4 → +2, EURGBP −5 → −3;
GBPJPY and GBPNZD moved from exact to −2, which is the leg fit's remaining ±1 showing up.

### Was the GBP problem systematic across pairs?

Yes, and that is why it was worth finding: one cell moved seven rows. It was **not** systematic
across currencies — the same audit against A1's eight published cards shows the row set matching
7/7 to 13/13 everywhere, and only three basis mismatches left, two of which already resolve to
`previous` anyway.

### The remaining gap, ranked by cause

| Rank | Group | Gap | Rows | Cause | Class |
|---|---|---:|---:|---|---|
| 1 | Crowd column, board-wide | — | ~30 | FXSSI broker aggregate vs CFTC small traders | **Confirmed data-source difference** |
| 2 | Equity indices | 19 | 7 | crowd is a put/call ratio there, not positioning at all; UK100 now provably has different legs | Confirmed source difference + Unknown |
| 3 | Currency index rows | 13 | 7 | EURX decomposes exactly: crowd −1 vs +1, COT +1 vs +2 | Confirmed + reference ambiguity |
| 4 | JPY leg | ~3 | 6 | their card publishes CPI YoY with the Forecast column blank; we read forecast | **Confirmed basis mismatch**, measured net ≈ −1 |
| 5 | EUR CPI / PPI | 0 net | 2 | their consensus differs from ours; ours ties the actual on both | Confirmed data-source difference |
| 6 | GBP residual | 2 | 7 | ±1 of leg error left, cell unidentified | Unknown |

Crowd is rank 1 without a number beside it on purpose: it cannot be totalled from the captured
board, because only DXY is captured cell by cell. On the two rows where the decomposition IS
known it is **100% of the residual** — DXY (17 of 18 cells exact) and EURUSD (all five category
blocks match).

The **equity indices are the worst group per row**: 19 points from 7 rows, 2.7 each, against 1.4
for the 27 FX pairs. UK100 is now the only row on the board whose implied non-macro sum falls
outside the ±6 those four cells can reach (−8), which is proof its macro legs differ from ours
rather than a hypothesis about them.

### The Crowd source is FXSSI, and this is now measured rather than inferred

A1 publishes a free Looker demo of the EdgeFinder that serves the live Retail Sentiment page.
Read against `fxssi.com/tools/current-ratio` in the same minute:

| pair | EdgeFinder long% | FXSSI buyers% |
|---|---:|---:|
| EURUSD | 24 | 24 |
| GBPUSD | 31 | 31 |
| AUDUSD | 25 | 25 |
| NZDUSD | 29 | 29 |
| USDCHF | 80 | 80 |
| USDJPY | 55 | 55 |
| USDCAD | 63 | 62 |

Six of seven to the point; the seventh is their 30-minute refresh against FXSSI's five. FXSSI
aggregates Oanda, Dukascopy, IG, FIBO, InstaForex, Myfxbook, FXBlue and ForexFactory.

What that settles:

- **Type.** Long/short percentage of open positions, per symbol. Not net contracts, not a ratio
  of volume.
- **Transformation.** `long% >= 60 -> -1`, `long% <= 40 -> +1`, else 0. Our
  `CROWD_LONG_PCT_BUCKETS` already encodes exactly this, and always did. **The rule was never the
  problem.**
- **Inversion.** There is none to get wrong. The percentage is quoted on the pair as named, so
  USDJPY 55% long means 55% long USDJPY. Our `pairContract` sign flip exists only because a CME
  future is always quoted CUR/USD.
- **Crosses.** Covered by FXSSI — EURGBP 38%, EURJPY 26%, GBPJPY 35%, AUDJPY 31%, EURAUD 73%,
  EURCHF 48%, GBPCHF 50%. So their cross crowd is a direct read, not a difference of two legs.
- **Metals, indices, commodities.** A *different rule again*: A1's own page says these use a
  put/call ratio, and their demo agrees — GOLD reads 95.08% where FXSSI reads 63%, and every FX
  row is a whole integer while every index row carries two decimals.
- **Currency index rows.** Not in the feed at all. How their DXY row reaches a crowd cell is
  still unexplained, and their +1 there is not consistent with retail being 55–80% long the
  dollar in every pair that day.

### What integrating it would take

Nothing structural. `scoreCrowd` already reads a single long-percentage and nothing else;
`buildSetupsMatrix` already routes crowd per symbol for dollar pairs. The work is a connector
returning `Map<symbol, {longPct, asOf}>`, an input on `SetupsMatrixInput`, and a preference order
in the crowd branch: retail feed by symbol, falling back to today's CFTC path where the feed has
no row. The `expected` / `partial` machinery already distinguishes missing-by-design from
missing-by-failure, and the pipeline's `health` array is where the connector must be registered —
that is the `yield2y` lesson.

Two real constraints, neither of them architectural:

- **No history, so no rewind.** A live ratio cannot be replayed, so `asOf` cannot trim it and
  `npm run parity` would score yesterday's board against today's crowd. That is the same
  compromise the technicals already make, and it must be stated in the parity header rather than
  discovered later.
- **Access.** FXSSI publishes no API. Myfxbook's `get-community-outlook` is documented and free
  at 100 requests/day but needs a session login; OANDA's position book needs an account token and
  covers ~16 instruments. Any of the three is a licensing question before it is a code question.

### New tooling

`npm run row -- GBPX GBPUSD` prints a symbol's eighteen cells beside A1's where they are
captured; `npm run row -- --ALL` prints the four non-macro columns for every captured row with
the value their side must reach. That second view is what showed GBP's index-row gap was not a
leg gap, and it is the only place the ±6 impossibility check lives.

---

## Results

| Row | Before | After | A1 | Note |
|---|---:|---:|---:|---|
| EURUSD | +11 | **+11** | +13 | every block now matches except one cell — see below |
| USDJPY | −6 | **−5** | −3 | |
| DXY | −7 parity / −8 app | **−8** | −6 | 17 of 18 cells exact; only crowd differs |
| EURX | +5 | +4 | +7 | |
| GBPJPY | +9 | **+7** | +7 | exact |
| USDCHF | −9 | **−11** | −11 | exact |
| USDCAD | −13 | **−12** | −12 | exact |
| AUDUSD | +5 | **+4** | +4 | exact |
| CHFX | +1 | **+3** | +3 | exact |
| XAUUSD | +7 | **+8** | +8 | exact |
| XAGUSD | +9 | **+10** | +10 | exact |
| XPTUSD | −1 | **−2** | −2 | exact |
| AUDCHF | −4 | **−6** | −6 | exact |
| RUT2000 | −5 | **−4** | −4 | exact |
| **TOTAL ABS GAP** | **95** | **74** | | 47 of 47 symbols |
| **exact / within 1 / within 2** | 5 / 17 / 30 | **14 / 22 / 37** | | |

## What was fixed

**1. `yield2y` never reached anything that rebuilt the matrix.**
`SetupsPayload` now carries it (`lib/setups-pipeline.ts`), hoisted into a single `yield2yData` so
the matrix built in the pipeline and one rebuilt by a caller are fed the same reading;
`scripts/parity.ts` and `scripts/board-diff.ts` pass it. Fifteen rows had been scoring the rate
column blank in every parity run while the live page scored them. DXY's rate cell now matches
their published −1, and XAUUSD, XAGUSD and RUT2000 became exact.

**2. Seasonality was computed from a corrupt series. — the largest single fix.**
**CORRECTION to section D/F below,** which concluded our seasonality was careful and A1's two
cells contradicted each other. They do not. `computeTechnicals` fed `computeSeasonality` Yahoo's
`interval=1mo` series, which returns **two March bars in every one of eleven years** and stamps
closes with the wrong month. August returns for EURUSD, monthly series against the same months
derived from dailies:

| | 2022 | 2023 | 2024 | 2025 |
|---|---:|---:|---:|---:|
| `1mo` | −1.95% | −3.15% | +0.98% | +0.39% |
| `1d` | −1.66% | −1.40% | +2.37% | +2.35% |

The daily column is the market — EURUSD ran 1.0223 → 1.0054 in August 2022, which is −1.66%. Over
ten completed Augusts the two disagree on the **sign**: −0.85% against +0.19%.

The connector's own `fetchSeasonalHistory` comment had said the monthly series was unreliable for
as long as it existed, and the scanner pages already built from dailies for that reason — but the
*score* did not, so one quantity had two sources and the scored one was the bad one. It now uses
the same long-run daily call, with the same cache key and 7-day TTL, so on a warm cache it costs
nothing. `computeSeasonality` needed no change: it already dedupes by year-month keeping the last
bar, which turns a daily series into the month-end series it wants. October, which the monthly
series omitted entirely, now exists.

All three seasonality cells we have evidence for now agree with A1: **EURUSD +1, NZDUSD −1,
DXY +1.**

**3. The crowd column is per symbol, not leg-differenced — proven from their own two cards.**
A1's US-DOLLAR row scores crowd +1 and their EURUSD row also scores crowd +1. Under a differenced
rule EURUSD would be `EUR − USD = EUR − 1`, which cannot reach +1 from any leg in {−1, 0, +1}. No
differenced model produces both numbers. For a dollar pair we do not need their retail feed to
honour that: the CME currency futures **are** these pairs, so one contract's small traders are
positioning in this pair directly — where `EUR leg − USD-index leg` was a construct with no
instrument behind it. Crosses keep the difference, because no EURJPY contract exists. COT is
deliberately unchanged: their EURUSD card reads it Neutral + Bullish Weekly Change with a subtotal
of +2, which is exactly `EUR change (+1) − USD change (−1)`, so that column really is differenced.
Measured over the eight dollar pairs this reaches: 92 → 87, with AUDUSD and USDCAD landing exact.

**4. The euro-area revision reach-back was removed.**
`resolveSeries` preferred the most recent *informative* print, reaching back up to three weeks past
a confirming revision to the flash that carried the surprise. A1 scores the revision: their EURUSD
Economic Growth subtotal of 5 only reconciles at a euro GDP leg of 0. Removing it moved 96 → 92 and
touched no currency but EUR. EURUSD's growth block now matches their published subtotal exactly.

## What was investigated and deliberately NOT changed

**NZ consumer confidence.** Their card does prove A1 has a bearish NZ reading — and the series we
could wire in reads the other way. `ANZ – Roy Morgan Consumer Confidence` at 99.3 against a 91.3
previous is +1 where their leg is −1, and every other NZ confidence series in the feed is bullish
on that date too. Wiring it was measured, not assumed: **96 → 102**, with seven AUD/NZD pairs moving
away. The gap is a series we do not carry, not a rule we score wrongly. Recorded in
`config/setups.config.ts` with the measurement so it is not retried blind.

## The remaining EURUSD −2 is one cell

**CORRECTION to section C below**, which called this "a macro-leg gap". After fix 4 the macro
block matches their card exactly in all three categories:

| Block | Ours | A1 |
|---|---:|---:|
| technical (trend +2, seasonality +1) | 3 | 3 |
| sentiment (COT +2, crowd −1) | **1** | **3** |
| growth | 5 | 5 |
| inflation | 2 | 2 |
| jobs | 0 | 0 |
| **total** | **11** | **13** |

COT agrees at +2. **The entire residual is the crowd cell: ours −1, theirs +1.**

The root cause is a different population, and it is not fixable in code. We read CFTC small
traders on the EURO FX contract, who are **62.7% long** the euro — contrarian bearish, −1. A1 reads
retail broker positioning, which on that frame has the crowd **short** EURUSD — contrarian bullish,
+1. Same rule, opposite input. Closing it needs a retail sentiment feed, not a scoring change;
the same cell is the whole of DXY's remaining gap, where 17 of 18 cells now match.

Two EUR inflation cells also remain individually wrong and happen to cancel: CPI ours 0 / theirs +1
and PPI ours +1 / theirs 0, both because our euro-area calendar carries a consensus equal to the
actual. That is data coverage, not arithmetic — and it nets to zero, so it does not appear in the
total.

---

## The original diagnosis, unchanged below

Measured 2026-08-24 against A1's board captured **2026-08-23T15:11:37Z**, now recorded as the
newest capture in `fixtures/a1-board.json`. No scoring logic was changed. The only file written
is that fixture, which is transcribed evidence — nothing in the app reads it.

## Headline

Three things were reported. They turn out to be three unrelated problems, and one of them is not
a problem at all.

| Reported | Verdict |
|---|---|
| EUR +7 vs our +1 | **No gap exists.** Two different quantities were compared. Our EUR macro score is +1 and so is theirs. |
| Gauge sits far from its extremes | **Real, and presentation-only.** The FX dial is drawn against ±34. Nothing about the score is scaled. |
| EURUSD +13 vs +11, USDJPY −3 vs −6 | **Real, and not the same defect.** EURUSD is a macro-leg gap; USDJPY is almost entirely per-symbol cells. |

The single most useful measurement: A1's US-DOLLAR card publishes all eighteen cells, and
**fourteen of our fourteen USD macro cells match theirs exactly**. The dollar's entire gap is two
non-macro columns. The macro engine is in better shape than the totals suggest.

---

## A. Current scoring architecture

```
FXStreet / TradingView / ForexFactory
        ↓  NormalizedEvent { actual, consensus, previous, dateUtc, countryCode }
resolveSeries          pick the series, scoped to PRIMARY_COUNTRY, ordered preference,
                       freshness outranking scoreability          lib/scoring/discrete.ts:126
        ↓
scoreSlot              ternarySign(actual − reference) × polarity, clamped to slot.maxCell
                       reference = consensus, falling back to previous when none exists
                       stale / no-data / not-released are statuses, never zeros
        ↓  per-CURRENCY leg ∈ {−1, 0, +1}
combinePairCells       base − quote, clamped ±2                   lib/scoring/discrete.ts:594
        ↓  per-SYMBOL cell
buildSetupsMatrix      18 SCORING_SLOTS summed                    lib/scoring/setups.ts
        ↓  totalScore
biasFromScore          absolute cuts at ±4 and ±7                 config/setups.config.ts:1257
        ↓
ScoreGauge             needle = score / range, range = maxScoreForKind(kind)
```

Answering the brief's checklist directly, from the code:

- **Aggregation** is a plain arithmetic sum. Not an average, not a weighted sum.
- **No weights.** Every slot contributes its cell, unmodified.
- **No normalization and no multiplier** anywhere between the leg and the printed number.
- **Caps**: each economic leg is ±1; a differenced pair cell is ±2; `trend` ±2, `cot` ±2,
  `crowd` ±1, `seasonality` ±1. Nothing else is capped.
- **Missing legs count as 0**, but the cell is stamped `partial` and names the missing leg, so a
  fetch failure is distinguishable from a genuine neutral.
- **Polarity is per slot** (`unemployment` and `claims` are −1; everything else +1), so "higher
  than expected" is *not* always bullish, and the direction is data, not code.
- **Basis** is actual-vs-forecast, with a documented fallback to the prior print where no
  consensus is published — which is A1's own rule, evidenced from their Surprise column.
- **Theoretical range**: ±34 for an FX pair, ±20 for every single-economy asset. Both are far
  wider than the ±7 "Very Bullish" cut, which is A1's design, not ours: their cuts are absolute
  and never moved as columns were added.

The brief's suspicion of a hidden multiplier, an aggressive normalization or a stray cap is not
borne out. There is nothing between the leg and the number.

## B. Reference behaviour, as their own frames show it

Their **US-DOLLAR Asset Scorecard** publishes every cell and four subtotals, and reconciles
seven ways:

| block | cells | sum | their published subtotal |
|---|---|---:|---:|
| technicals | trend −2, seasonality +1 | −1 | Technical score −1 |
| sentiment + COT | COT net +1, COT change −1, crowd +1 | +1 | Sentiment + COT +1 |
| growth | −1 +1 −1 −1 −1 | −3 | "Very Bearish" |
| inflation | 0 −1 0 −1 | −2 | "Bearish" |
| jobs | −1 +1 +1 −1 −1 | −1 | "Bearish" |
| fundamentals | | −6 | Fundamentals −6 |
| **total** | | **−6** | **EdgeFinder −6** |

Two further structural facts read straight off the board:

- `EURUSD 13 = EURO 7 − US-DOLLAR (−6)`, exactly. Their pair rows really are leg differences.
- `USDJPY −3` against `US-DOLLAR (−6) − JP-YEN (0) = −6`. The +3 is the pair's own trend,
  seasonality, COT and crowd, which are per-symbol and are *not* differenced.

Their **EURUSD and NZDUSD Forex Scorecards** publish category subtotals and a
Bullish/Bearish/Neutral label per row. Differenced against the known USD legs and solved
exhaustively over every ternary assignment, fifteen leg vectors fit each card — so most
individual legs are not pinned, but **the macro sum is identical across all fifteen**:

- **EUR macro legs = +1**, uniquely.
- **NZD macro legs = −3**, uniquely.

## C. Discrepancies

Three parity runs, identical: **TOTAL ABS GAP 95** over 47 of 47 published symbols, 5 exact,
17 within 1, 30 within 2.

| Asset | Reference | Ours | Diff | First divergence |
|---|---:|---:|---:|---|
| EUR (macro) | +1 | +1 | 0 | **none — the reported −6 was a category error** |
| EURX (full row) | +7 | +5 | −2 | crowd −2, COT −1, macro +1 |
| EURUSD | +13 | +11 | −2 | EUR CPI and EUR PPI cells, then −1 residual |
| USDJPY | −3 | −6 | −3 | per-symbol cells; legs predict only +2 of it |
| DXY | −6 | −8 in the app, −7 in parity | −2 | **crowd −2**; macro is exact, 14 of 14 |
| NZDUSD | +7 | +10 | +3 | NZD gdp, sPMI, consumer-confidence, PPI |
| GBPX | 0 | +4 | +4 | GBP is the worst leg on the board |

The "around −6 versus around −8" in the brief is **DXY**, and both numbers are ours: the app
renders −8, the parity script reports −7, because they build the matrix from different inputs.
See root cause 3.

Cell-by-cell against every leg assignment A1's cards admit:

**EUR — 2 of 14 cells provably wrong**

| slot | ours | A1 | note |
|---|---:|---|---|
| cpi | 0 | **+1** | HICP YoY 2.9 vs a 2.9 consensus → structurally 0 |
| ppi | 0 | **−1** | PPI YoY 4.6 vs a 4.6 consensus → structurally 0 |
| mpmi, retail, pce, rates | +1, −1, 0, 0 | same | agree |
| gdp, spmi, cnsmr conf, unemp, nfp, claims, adp, jolts | | within their admissible range | not contradicted |

**NZD — 4 of 14 cells provably wrong**

| slot | ours | A1 | note |
|---|---:|---|---|
| gdp | −1 | 0 or +1 | our print is 67 days old (0.8 vs 0.9, 2026-06-17) |
| spmi | 0 | **−1** | BusinessNZ PSI 50.6 against a 50.6 previous |
| consumer-confidence | no data | **−1** | slot deliberately has no NZD matcher |
| ppi | +1 | **−1** | we take Output QoQ 1.6 vs 0.8; theirs is bearish |

Row-set coverage is not the problem. `npm run cards` reports EUR 7 rows theirs / 8 ours with one
extra, and NZD **identical**. We are not missing indicators.

## D. Root cause

### Confirmed

**1. "EUR +7 vs +1" compares two different quantities.**
A1's `EURO 7` is the whole eighteen-column score of the EURO index row. Our `/heatmap` headline
is `CurrencyHeatmap.macroScore` (`lib/scoring/heatmap.ts:192`) — economic legs only. It excludes
trend, seasonality, COT, crowd and rates, excludes Consumer Confidence (`matrixOnly`), and
includes three non-scoring rows. Measured: our EUR macroScore is **+1** and their solved EUR
macro legs are **+1**. The comparable row to their 7 is our `EURX` total, which is +5.

**2. The FX dial is drawn against ±34.**
`app/scorecard/[symbol]/page.tsx:126` sets `range = maxScoreForKind(def.kind)`. For a pair that
is 34, so their "Very Bullish" cut of +7 lands at 60% of our dial and a +13 draws at 69%. Nothing
about the score itself is scaled — `ScoreGauge` prints `formatScore(score)` raw and only the
needle divides by `range`. This is one line of UI, and it is the whole of the reported symptom.

**3. `yield2y` is fetched, used, and never exposed — so the diagnostic measures a board the app
does not render.**
`SetupsPayload` (`lib/setups-pipeline.ts:54`) has no `yield2y` field. The pipeline passes it into
its own `buildSetupsMatrix` call, so the pages are correct; but `scripts/parity.ts:289` rebuilds
the matrix from the payload and therefore cannot pass it. Fifteen rows score their rates column
blank in every parity run. Measured effect of restoring it: DXY −7 → **−8**, matching their
published `−1` cell exactly; XAUUSD 7 → **8** and XAGUSD 9 → **10**, both then exact against A1.
TOTAL ABS GAP stays at 95, because the equity-index rows move the wrong way — which is itself a
finding, not a wash.

**4. The USD macro block is already exact.**
All fourteen USD macro cells match their published card. DXY's gap is `crowd −2` and `rates +1`,
and those two were cancelling — which is precisely the failure mode this repo's own fixture warns
about, appearing here in our output rather than in their transcription.

**5. Two EUR cells and four NZD cells are provably wrong**, as tabulated in section C. The EUR
pair are both the `consensus === actual` degeneracy that `lib/scoring/discrete.ts:178` already
documents for the euro area; the resolver reaches past a confirming revision, and both candidate
prints still carry a consensus equal to their actual, so the cell cannot be anything but 0.

**6. A1 scores a New Zealand consumer-confidence reading and we deliberately do not.**
Their NZDUSD card reads that row Neutral while the dollar leg is −1, so their NZD leg is −1. The
slot (`config/setups.config.ts:504`) drops AUD and NZD arguing their per-country heatmap cards
carry no such row — true, and exactly what `matrixOnly: true` on that same slot already records.
A card that omits the column is not evidence the *board* column is empty. Both series are in our
feed: `ANZ – Roy Morgan Consumer Confidence` and `Westpac Consumer Confidence`.

### Highly likely

**7. The crowd column reads a different population than theirs.**
We score CFTC small traders on each currency's futures contract; A1 reads retail broker
positioning per instrument. On the two rows we can check they are opposite: CFTC small traders
are 63.0% long the dollar index (contrarian −1) while A1's US-DOLLAR card reads the crowd bearish
and scores +1. Same for EURX (62.7% long → our −1, their +1). That is 2 points on each, and the
largest single identified contributor after the leg errors. It is a data-source divergence, not
a logic error.

**8. GBP is the worst leg on the board.** `board:diff` puts GBP at a +5.2 base-minus-quote spread
with its own row +4 — we score sterling too bullish, and it carries into six pairs.

### Possible

**9. A1's rates column for an FX leg may be the 2-year against its own 21-day average, not the
Fed dot plot.** Their US-DOLLAR card labels the row `2 Yr Yield (21 day SMA)`. Today the two
agree, so this is latent. Worth noting that the 2-year proxy `lib/scoring/rates.ts` records
rejecting was `yield2y − policyRate`, a *level* spread that slopes up on every curve and cancels
on every cross. The rule their card names is momentum, and does not degenerate that way. Blocker:
`SovereignYield` fetches `lastNObservations=1`, so there is no per-currency history to build the
average from.

**10. NZD PPI series choice.** We take `Producer Price Index - Output (QoQ)`. Their published NZ
card row is `PPI QoQ` with numbers matching neither of our output prints; New Zealand publishes
an input series too.

### Unlikely

Wrong aggregation, missing normalization, asymmetric scoring, sign handling, or different score
caps. Each was checked against the code and none exists.

## E. Secondary issues

- **Their board is the loudest source of noise.** It moved **134 points across 47 shared symbols**
  between the 2026-08-21 and 2026-08-23 captures, against a TOTAL ABS GAP of 95. Any single-row
  gap smaller than a few points is unmeasurable. Chase patterns across a currency.
- **TOTAL ABS GAP is not comparable across captures.** 95 here is over 47 symbols; the 80 recorded
  for 2026-08-21 was over 29. Compare shares (`exact`, `within 1`) or the same capture only.
- **Two errors were cancelling on DXY** (crowd −2 against rates +1), so the row looked 1 off when
  it was 3 off across two columns. The row-sum check cannot see this; only the per-slot
  attribution can, which is why the 18-cell capture mattered more than the 47 totals.
- **Stale legs that still score.** NZD GDP fills its slot from a print 67 days old and GBP PPI
  from one 68 days old, both inside their windows, both producing confident cells off data A1 has
  replaced.
- **NZD PMI basis is intent-fragile.** `npm run cards` reports two basis-intent mismatches: their
  card scores mPMI and sPMI against the previous print, our config asks for forecast. This run
  resolved to previous anyway because no consensus exists, so it is currently right by accident.
- **Euro-area consensus quality.** Both wrong EUR cells share one cause: the calendar carries a
  consensus equal to the actual. This is a data-coverage problem, and no scoring rule can fix it.

## F. Proposed fixes — none applied

Ranked by evidence, not by size.

1. **Expose `yield2y` on `SetupsPayload` and pass it in `scripts/parity.ts`.** Pure plumbing, no
   scoring rule involved, and until it is done every parity run measures the wrong board for
   fifteen rows. Do this first, because everything below is judged by that instrument.
2. **Relabel the `/heatmap` headline.** It is `macroScore`, not an EdgeFinder score, and the page
   does not say so. Show our `EURX`-style full row total beside it, or name the number
   "economic legs only". This is the whole of the reported −6.
3. **Restore the consumer-confidence matcher for NZD and AUD.** Evidenced by their Aug-23 NZDUSD
   card, and both series are already in the feed. Worth −1 on the NZD leg immediately. Revert the
   comment's reasoning at `config/setups.config.ts:504` along with it, since it conflates their
   cards with their board.
4. **Investigate the crowd source.** Not a code change yet: establish whether A1's retail
   sentiment is obtainable, because CFTC small traders demonstrably disagree with it. Worth
   2 points on DXY and 2 on EURX today.
5. **Chase the GBP leg**, which `board:diff` names at +5.2 and which no single frame explains.
6. **The gauge.** You asked to match their dial exactly, and the honest measurement is partial:
   - Their **Asset Scorecard** semicircular dial, at −6, puts the needle roughly a quarter of the
     way from centre to the left end, implying a half-range near **±20**. That is exactly
     `maxScoreForKind` for a single-economy asset, so **our dial for DXY, gold and the indices
     already matches theirs**. *Confirmed to within the precision of a video frame.*
   - Their **Forex Scorecard** draws donuts, not a dial, and they are not linear in the score:
     Technical 1 fills about as much ring as Technical 3, and a total of 7 about as much as a
     total of 13. No linear mapping reproduces that, so a pair dial cannot be matched "exactly"
     — they do not draw one. *Hypothesis: the donut arc is largely decorative.*
   - The defensible change is therefore to the **FX dial only**: bring it from ±34 onto a scale
     where their absolute ±4 / ±7 cuts are visible, and shade those bands. I recommend not
     inventing a number for their pair dial from evidence that does not contain one.
7. **EUR CPI and PPI** need a consensus source that does not echo the actual, not a rule change.
   File under data coverage.

## G. Validation strategy

- `npm run parity` against the **same** capture, two or three runs before and after any change.
  Today's three runs were 95/95/95, so the technical noise floor happened to be zero — do not
  assume that; the script documents ±1 and their board moves far more.
- Judge a change by `exact` and `within 1` as well as by TOTAL ABS GAP. Fix 3 (rates plumbing)
  leaves the total unchanged while making three rows exact, and a total-only reading would have
  discarded it.
- `npm run legs` for the currency you touched, and the solver's `macroTotals` beside it.
- `npm run cards` for the row set and the basis — those two sections are date-independent and are
  the only parts of that output that are evidence.
- `npm test` — 649 tests, currently green, and it already pins the column set and `maxPairScore`,
  so adding a scoring column has to be deliberate.
- Never drive a change off a column the leg solver marks disputed.
