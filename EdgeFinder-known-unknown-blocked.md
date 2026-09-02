# EdgeFinder — known / unknown / blocked, per component

> **Evidence tier: DEMO_ERA.** Written before A1's Free Week opened on 2026-08-31, i.e. against their tiered demo. Treat every claim about A1 as PREVIOUS DEMO HYPOTHESIS until re-tested under full access. Kept, not rewritten. See [LEGACY-EVIDENCE.md](LEGACY-EVIDENCE.md).

A per-component snapshot of the reverse-engineering effort, edited in place every round rather
than appended to — `EdgeFinder-scoring-diagnosis.md` is the chronological "what changed and why"
log; this is "what do we currently know, right now" for each of A1's six scoring columns plus
currency indices. When a bullet closes (evidence arrives, a rule is confirmed, a source turns out
to be usable or genuinely dead), move it and say which round closed it — don't leave a stale
UNKNOWN sitting next to the evidence that already answered it.

Each component carries an **asOf reproducibility** line. It is sourced directly from the
`REPRODUCIBILITY` registry in [`lib/scoring/component-parity.ts`](lib/scoring/component-parity.ts)
— do not hand-edit it here without changing that registry to match, or the doc and the code will
silently disagree about which columns a historical `asOf` rewind can actually be trusted on. Run
`npm run component-parity` for the live, per-symbol, per-cell picture this doc summarizes.

---

## Trend

**ROUND FIFTEEN (2026-08-30) — FIXED, and it was our bug.**

`asOf` never reached the price series. `runSetupsPipeline` handed `now` to the calendar
connectors but not to `fetchTechnicals`, so the moving averages were the tail of the series no
matter which date was being reproduced. `scripts/parity.ts` printed "rewound to end of that day"
over a comparison in which this column was not rewound at all.

Cutting the daily series at each capture's own timestamp, with `scoreTrend` UNCHANGED, reproduces
A1's trend cell on **8 of 8** checksummed rows against **6 of 8** computed live. EURCHF +2 -> -1
and CHFX -2 -> +2, both exactly A1's printed cell; the other six were already +2 and stayed +2.

**asOf reproducibility: HISTORICAL.** The `LIVE_ONLY` tag on this column is retired, and
`component-parity` now reports trend as 8 EXACT / 0 TIMING_CONFOUNDED.

**The price cutoff is a SEPARATE parameter from `now`, deliberately.** Passing `now` to the whole
pipeline narrows the calendar fetch: at `now = 2026-08-25` the RBNZ's 2026-09-02 decision is never
downloaded and NZDX's rates cell falls +1 -> 0. See `PipelineOptions.pricesAsOf`.


**asOf reproducibility: LIVE_ONLY.** `scoreTrend` is a pure function of `Technicals`, and
`fetchTechnicals` always fetches Yahoo's *current* two-year daily bars — there is no code path in
the live pipeline or any parity script that rewinds it. A separate `technicalsAsOf()` exists and
can rebuild `Technicals` from raw `DailyBars` at a past bar, but it is wired only inside
`lib/scoring/backtest.ts`'s `runBacktest`, never into `buildSetupsMatrix`'s normal callers.

**KNOWN**
- A1's rule: 3-day vs 14-day SMA crossover is the score (±2); the 14-day slope only docks a point
  when it disagrees. Range {-2,-1,+1,+2} — never 0 (`checkBounds` in `lib/scoring/a1-legs.ts`
  enforces this against captured evidence).
- 6/6 checksummed rows exact (`npm run top-setups-parity`, 2026-08-24 capture) — round four.

**UNKNOWN**
- Nothing currently open against checksummed evidence.

**BLOCKED**
- Nothing.

---

## Seasonality

**asOf reproducibility: PARTIAL.** `scoreSeasonality` takes a date and correctly picks the
matching calendar month, but the ten-year average return BEHIND that month is a live, current-day
computation (`lib/scoring/history.ts`) with no way to ask what it looked like as of a past `asOf`.
In practice this rarely matters — the underlying stat moves slowly, one trading day at a time,
across a ten-year window — but it is not truly rewound.

**KNOWN**
- A1's rule: this calendar month's 10-year average return, sign only, range ±1.
- 6/6 checksummed rows exact — round four.
- The Yahoo monthly-bar series used to build history is corrupt (duplicate March every year,
  closes land a month late) — bucket dailies instead. See memory `yahoo-monthly-series-is-corrupt`.

**UNKNOWN**
- Nothing currently open against checksummed evidence.

**BLOCKED**
- Nothing.

---


**ROUND TWELVE — THE TRANSFORMATION IS NOW CONFIRMED, 8 OF 8 (2026-08-30).** A1's free
**Retail Sent. History** page publishes a long share *per symbol per day*, which is what a
snapshot could not do: a daily series joins to a Top Setups capture from a past date.
`npm run crowd-oracle` feeds A1's own percentage for the exact capture date into the production
`resolveCrowd` and compares the cell it returns with A1's own:

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

Two dates, two majors, one cross, two metals, three currency indices — two of those via the
derived dollar-pair rule and one inverted. Frozen in `fixtures/a1-retail-sentiment-history.json`,
regression-tested in `lib/scoring/crowd-oracle.test.ts`.

**This confirms the RULE, not the DATA.** The gap on a live board is still a population
difference (CFTC small traders vs a retail broker book) and no code change closes it.

**CORRECTION — metals are this feed too.** An earlier round read the two-decimal formatting of the
GOLD and SILVER rows as evidence they came from the put/call page. The formatting split is real,
the inference was not: both appear in the daily retail series and their 2026-08-24 shares produce
A1's own XAUUSD and XAGUSD cells. Corrected in `config/setups.config.ts`.

**CAVEAT — the snapshot page is not dated by the day you read it.** On 2026-08-30 it still showed
EURUSD 47, USDCHF 61 and GOLD 10.84, none of which appear anywhere in those symbols' August
history, while its NZDUSD (48) matches the history's 2026-08-29 point exactly. It shows each
symbol's latest available row and those rows are not all the same day. Join dated work to the
HISTORY fixture; use the snapshot only for cross-sectional facts internal to one screen (the
banding, the index identities).

**COVERAGE — the history page has no currency-index rows.** Searching its Asset control for
"POUND" returns nothing. GB-POUND and its siblings exist only on the snapshot page, which is why
the index rule has to be derived from the dollar pair rather than read directly.

## Crowd

**asOf reproducibility: LIVE_ONLY**, as a conservative simplification. The retail-feed rung
(`lib/scoring/crowd.ts` rung 1) has no history and cannot be rewound. The COT-fallback rung
(rung 2, dollar pairs and standalone assets only) genuinely does rewind via `asOf`'s COT filter,
but labelling the whole column LIVE_ONLY errs in the safe direction — a false TIMING_CONFOUNDED
costs nothing but a diagnostic hedge, where the reverse (a false EXACT) would not.

**KNOWN**
- Resolved PER SYMBOL, never differenced across a pair's two currencies — A1's own board proves
  this: US-DOLLAR scores crowd +1 and EURUSD ALSO scores +1, which a differenced rule
  (`EUR - USD`) cannot produce from any leg in {-1,0,+1}. See `lib/scoring/crowd.ts`'s header.
- Resolution order: a per-symbol retail feed (none shipped today) → **a currency index's own
  dollar pair in that feed** → the symbol's own CME/CFTC contract (dollar pairs and standalone
  assets) → nothing (crosses).
- Threshold rule: `long% >= 60 -> -1`, `<= 40 -> +1`, else `0` (`CROWD_LONG_PCT_BUCKETS`).
  **Verified against A1's own rendering 2026-08-29 — see UNKNOWN below, where this closed.**
- A1's own coverage, read off their free dashboard: **7 major pairs, 22 crosses, 8 currency
  indices**, plus metals, indices, commodities, crypto and bonds. Crosses ARE covered; an earlier
  round's "zero crosses" reading was the page's default Category filter, not its data.
- `lib/connectors/crowd.ts`'s `MyfxbookProvider` is code-complete: fails closed with no
  credentials, batches all symbols in one call, filters to 6-letter FX names, excludes
  metals/indices to avoid overriding the already-correct CFTC-based gold/silver reads.

**UNKNOWN**
- The exact provider combination and normalization behind A1's specific numbers.
- ~~Whether the 40/60 threshold is universal or cross-specific.~~ **CLOSED 2026-08-29 — the
  thresholds are CONFIRMED and were never the problem.** A1's own free Retail Sentiment dashboard
  labels every row Bearish / Bullish / Neutral in its accessibility tree, and on 2026-08-29 it
  partitioned 29 rows exactly on 40/60, with **EURGBP at exactly 40 classified Bullish** — pinning
  the lower bound as inclusive, which is what `scoreRetailLongPct` already does. The upper bound is
  bracketed rather than pinned (58 Neutral, 60.84 Bearish, so it lies in (58, 60.84], and A1's
  published ">= 60" sits inside that interval).
  **Both apparent contradictions were the INPUT, not the rule.** The EURCHF ~48% and GBPCHF ~50%
  figures on file were FXSSI's, taken as a stand-in because A1's page was believed to carry no
  crosses. It carries 22 — the Category control simply DEFAULTS to excluding them. A1's OWN
  historical feed for 2026-08-24, the day those cells were captured, reads **EURCHF 32%,
  GBPCHF 36%, GBPUSD 31%, EURUSD 25%** — all four ≤ 40, all four score +1, all four match the Top
  Setups cell already on file. Recorded in `fixtures/a1-edgefinder-demo-2026-08-29.json` and pinned
  by 33 cases in `lib/connectors/crowd.test.ts`. **Do not move these thresholds.**
- **FXSSI is NO LONGER a confirmed match for A1's crowd source.** It agreed to the point on the
  seven dollar majors, which is all the earlier 6/7 check measured, and it does NOT agree on
  crosses — 48 against A1's 32 for EURCHF on the same day. Inferring the same population from
  majors alone was too weak a step.
- **CONFIRMED — how a currency-index row reaches a crowd cell**, a question
  `EdgeFinder-scoring-diagnosis.md` had left explicitly open. Each of the seven non-dollar index
  rows IS its own dollar pair: GB-POUND 50 = GBPUSD 50, NZ-DOLLAR 48 = NZDUSD 48, EURO 47 =
  EURUSD 47, AU-DOLLAR 28 = AUDUSD 28, CA-DOLLAR 58 = 100−USDCAD, JP-YEN 56 = 100−USDJPY,
  CH-FRANC 39 = 100−USDCHF. Eight for eight. US-DOLLAR is the exception — 92.51%, two decimals like
  their index/CFD rows, which no dollar pair produces — so the dollar index has its own book.
  Implemented in `resolveCrowd` (`indexFromDollarPair`); inert until a retail feed exists.
- **IG's client-sentiment REST API** (`/clientsentiment/{marketId}`) — real, documented, reachable
  with a free demo account, but not yet pulled against a live instrument to confirm it actually
  covers the specific crosses A1 needs (EURCHF, EURGBP, GBPJPY) and that its values track A1's.
  See Provider research below.
- **Dukascopy's Historical Sentiment Index** — real history exists (30-minute updates, checkpoints
  back to a month), but it is exposed through the JForex desktop platform's Strategy API, not a
  plain REST endpoint, and cross coverage beyond "most popular pairs" is unconfirmed.

**BLOCKED**
- **Myfxbook.** Login succeeds and returns a valid session (`login.json`), but the
  `get-community-outlook` call immediately rejects that session with "Invalid session" —
  confirmed server-side, independent of credentials, connector code, `.env.local`, or 2FA
  settings. See memory `myfxbook-invalid-session`. Do not re-debug this without new,
  independently-documented information; treat the provider as unavailable.
- **OANDA position/order book.** The `v3/instruments/{instrument}/positionBook` and `/orderBook`
  endpoints this repo's earlier research flagged as promising were **discontinued platform-wide
  in September 2024** — confirmed by multiple independent developer reports, described by OANDA
  support as a business decision not expected to reverse. The remaining "OANDA Labs Position
  Ratios" page (`trade.oanda.com/labs/position-ratios`) is a marketing widget, not a documented
  API, majors-only. Do not re-investigate OANDA without new evidence the endpoint returned.
- **FXBlue, for crosses specifically.** FXBlue's own documentation confirms it excludes thin
  pairs — their own example is CAD/JPY having no sentiment data because too few real-money
  accounts hold positions in it — which directly threatens EURCHF/EURGBP/GBPJPY. Remains
  plausible for majors only.
- **Crosses have no crowd source at all today** (structural, not a bug — `resolveCrowd`'s rung 3).
  Unblocks the moment ANY per-symbol retail feed is wired in, since the resolution order already
  prefers a feed over everything else.

---


**ROUND TWELVE — THE FX RATES INPUT IS NOW GRADED UNKNOWN, AND THAT IS AN UPGRADE (2026-08-30).**
Two candidate rules moved from "unsupported" to "falsified", and one genuine confirmation landed
next to them.

**FALSIFIED — quarter-over-quarter projected change.** Round eleven recorded it as A1's rule on a
3-of-5 fit whose misses were blamed on timing. The refutation needs no timing argument at all:
on **2026-08-29** A1's own free Forex Scorecard prints **EURCHF Interest Rates: Bullish (+1)**,
and on the **same day** their own Interest Rate Projections chart reads **EUR 2.7 to 2.7** and
**CHF 0.0 to 0.0** across 2026Q3 to Q4. A difference of `0 - 0` cannot be +1.

**CHF IS NOT MISSING FROM THEIR DATASET — it is 0.00%, flat, every quarter.** Round eleven
reported CHF "renders no bars and no line". With CHF selected alone the bar chart is empty
because every bar has height zero; the line chart draws a flat line whose tooltip reads
`CHF: 0,0%` at 2026Q2, Q3, Q4, 2027Q1 and Q2. Five hovers, five explicit zeros — and correct,
since the SNB has stood at 0.00% since mid-2025. **Consequence:** under any quarter-over-quarter
rule CHF's leg is 0 permanently, so that rule cannot produce the -1 the 2026-08-24 solve implied.

**CONFIRMED, for ASSET rows only — `US02Yield (21 day SMA)`.** A1's free Asset Scorecard prints
that label verbatim on its interest-rate row (read off the PLATINUM card, 2026-08-30). It is
exactly what `scoreYield2y` already does for DXY and every non-FX asset. The **generalisation** to
each currency's own 2-year stays rejected — tested against real historical yields on 2026-08-24 it
misses USD, EUR and GBP (`npm run rates-research`). `lib/scoring/source-confidence.ts` keeps these
as two entries, `rates` (UNKNOWN) and `rates:assets` (CONFIRMED), because collapsing them is how
the rejected theory came back twice.

**Exact projections, re-read from the chart's own tooltips (2026-08-30), percent:**

| | 2026Q3 | 2026Q4 | 2027Q1 | 2027Q2 |
|---|---|---|---|---|
| AUD | 4.4 | 4.4 | 4.4 | 4.4 |
| GBP | 4.0 | 4.0 | 4.3 | 4.3 |
| USD | 3.8 | 4.0 | 4.0 | 4.3 |
| NZD | 2.8 | 3.0 | 3.5 | 3.8 |
| EUR | 2.7 | 2.7 | 2.9 | 2.9 |
| CAD | 2.3 | 2.3 | 2.3 | 2.3 |
| JPY | 1.3 | 1.5 | 1.5 | 1.5 |
| CHF | 0.0 | 0.0 | 0.0 | 0.0 |

The tooltip rounds to one decimal, which is its only weakness against the previous geometric
read: a 0.05 move is invisible here.

**LEADING CANDIDATE, NOT IMPLEMENTED — a level differential.** EUR 2.7 vs CHF 0.0 gives EURCHF
Bullish, and GBP 4.0 above USD 3.8 gives GBPUSD +1 on 2026-08-24. It fails EURUSD on that same
date (EUR 2.7 below USD 3.8 predicts -1; A1 printed +1). Two of three is not a rule.

**AND ONE EARLIER "MEASUREMENT" IS DOWNGRADED.** "CHF rates = -1 on 2026-08-24" was derived by
assuming the rates column is leg-differenced, reading EUR off EURX and subtracting. The
2026-08-29 EURCHF reading is hard to reconcile with any per-currency leg assignment, so
leg-differencing is now graded SUPPORTED rather than assumed, and that CHF -1 inherits the doubt.
Do not quote it as a measurement.

**WHAT WOULD SETTLE IT.** A dated snapshot of the Interest Rate Projections chart taken on a day
this repo also holds Top Setups cells for. The chart has no date control and cannot be rewound,
so this has to be captured going forward rather than recovered.


**ROUND THIRTEEN — THE RULE IS FOUND, AND DELIBERATELY NOT IMPLEMENTED (2026-08-30).**
A1 publishes **both halves** of their comparison on two free pages: the standing policy rate
(Interest Rates) and market-consensus projections by calendar quarter (Interest Rate
Projections). `sign(current quarter's projection - standing policy rate)` gives:

| currency | policy | 2026Q3 projection | leg |
|---|---|---|---|
| USD | 3.75 | 3.75 | 0 |
| EUR | 2.40 | 2.65 | +1 |
| GBP | 3.75 | 4.00 | +1 |
| CHF | 0.00 | 0.00 | 0 |
| NZD | 2.25 | 2.75 | +1 |

Those five legs reproduce **six** A1 cells across three dates: EURUSD +1, GBPUSD +1, EURCHF +1
(2026-08-24 Top Setups, checksummed); CHFX 0, NZDX +1 (2026-08-25); EURCHF Bullish (2026-08-29
free Forex Scorecard). **The one exception is EURX's 2026-08-24 rates cell**, read as 0 where
the rule says +1 — one cell from a crowded crop, against a projections chart with no history.

**The rival assignment is rejected on A1's own data.** Taking EURX at face value gives EUR 0,
USD -1, GBP 0, CHF -1, which satisfies the same three pair equations and matches A1's published
rate inputs for **not one** of those four currencies.

**CHF IS SOLVED.** Their pages put the Swiss policy rate at 0.00% and every projected quarter at
0.00%, so CHF's leg is 0 — exactly what their CHFX row prints. **The "CHF rates = -1 on
2026-08-24" that several rounds quoted as a measurement is now downgraded**: it was solved
through EURCHF while assuming leg-differencing. So was the "USD = -1" solved through EURX. Note
the pattern — both CHF legs that contradict A1's own published data come through the **EURCHF**
row; the CHF leg read directly off **CHFX** agrees.

**IMPLEMENTED AND REVERTED IN ONE SESSION — the measurement is the finding.**
`scoreRateExpectation`'s projection branch was changed from `nextYear - current` (two dot-plot
points a year apart) to `projection.current - policyRate`. The Fed is the only bank whose own
projection this repo holds, so it moves **USD alone** (3.80 vs a standing 3.75 is inside the
0.10 flat band, so 0) while EUR and GBP stay at a placeholder 0. Result: **cell parity
84/98 -> 82/98, rates column 5/6 -> 3/6 exact, no cell gained.** EURUSD previously read +1 as
EUR(0) - USD(-1) and became 0, where A1's +1 is EUR(+1) - USD(0).

**A differenced column cannot be adopted one currency at a time.** Do not re-implement piecemeal.
It needs a quarterly market-consensus feed for every major at once; FXStreet carries projections
for the Fed alone. See `lib/scoring/parity-ledger.ts` entry `rates:usd-leg` and
`fixtures/a1-free-economic-2026-08-30.json`.

**One more input difference to carry forward.** A1's Interest Rates page has EUR at **2.40%**;
this repo reads the ECB **deposit facility** and gets 2.25%. Their series steps 2.15 -> 2.40,
the shape of the Main Refinancing Operations Rate. It does not flip the leg against a 2.65
projection, but a future implementation must use A1's rate choice, not ours.

**There is no "interest rate projections" dataset in A1's own Data Updates Log.** The rate-side
entries are `Central bank interest rates` (daily) and a **`Carry trade scanner`** (3am, 8am, 2pm,
10pm) that appears nowhere in the free surface. If the projections page is fed by the carry
scanner, that scanner is the thing to look for next.

## Rates

**ROUND FOURTEEN (2026-08-30) — the rule survives its first same-day test, and its only
counter-example turns out never to have been tested.**

A1 publishes both halves free. Read on ONE day, their projections and their EURCHF scorecard
eliminate a rival outright:

| reading | EUR | CHF | predicts EURCHF | A1 printed |
|---|---|---|---|---|
| current quarter's projection vs standing policy rate | +1 | 0 | Bullish | Bullish OK |
| next quarter vs current quarter (Q3 2.65 -> Q4 2.65) | 0 | 0 | Neutral | Bullish NO |
| 2026Q2 -> 2026Q3 within the chart | +1 | 0 | Bullish | Bullish OK |

Readings 1 and 3 give an IDENTICAL leg set for all five currencies (USD 0, EUR +1, GBP +1,
CHF 0, NZD +1), so the leg assignment does not depend on choosing between them.

**The single contradicting observation is now downgraded.** EURX's 2026-08-24 rates cell reads 0
where the rule says +1. That same row's unemployment cell is contradicted by A1's own EURUSD and
metals by exactly one in the OPPOSITE direction. +1 and -1 cancel: the row sums to its printed 7
under either reading, so the checksum that admitted it never tested either cell. It is an
untested cell on a crowded crop, not an attested counter-example. See
`lib/scoring/index-rows.test.ts` and ledger entry `rates:EURX`.

**BLOCKED, and the blocker is unchanged: the INPUT, not the rule.** The Interest Rate Projections
page has a Currency filter and NOTHING else -- no date control, no as-of, no revision history
(re-confirmed this round). A projection read today cannot be rewound to a past board date, so
adopting the rule would inject today's numbers into a backtest scored at 2026-08-23. And the
column is a DIFFERENCE, so it cannot be adopted one currency at a time: measured on 2026-08-30,
moving USD alone took cell parity 84/98 -> 82/98 with no cell gained.

**A1 CONTRADICTS ITSELF ON THE EUR POLICY RATE.** Their Interest Rates page has EUR at 2.40% for
jul./aug. 2026; their Carry Trade Scanner has 2.15%. USD 3.75, GBP 3.75 and NZD 2.25 agree
exactly across both. Their series shape identifies the rate: 4.5, 4.25, 3.65, 3.4, 3.15, 2.9,
2.65, 2.4, 2.15 is the ECB **Main Refinancing Operations** rate step for step, NOT the deposit
facility this repo reads. Does not flip the leg (either value is below the 2.65 projection), but
a future implementation must use theirs.


**asOf reproducibility: HISTORICAL for FX pairs and every non-USD currency-index row** (built
from `events` via `scoreRateExpectation` — genuinely rewound). **LIVE_ONLY for DXY and every
non-FX asset** (`scoreYield2y`, fed from a live, un-rewound `yield2y` snapshot). This is the one
column where reproducibility is NOT a single tag — it depends on the symbol's shape
(`lib/scoring/setups.ts`'s `isFx` / `DXY` / currency-index / else branches).

**KNOWN**
- USD's leg: the Fed's own dot-plot projection (current vs. next-year), `RATE_PROJECTION_MATCH`
  band. DXY and other non-FX assets: US 2-year yield vs. its own 21-day SMA, negated for DXY.
- **IMPLEMENTED 2026-08-29 — a non-USD currency can now score, from the calendar consensus for
  its central bank's NEXT SCHEDULED DECISION.** The claim that stood here for several rounds —
  "every non-USD currency scores 0 by construction, only the Fed publishes a projection" —
  conflated *no bank publishes a forecast* (true) with *no forecast exists* (false). The calendar
  this app already fetches carries a consensus for every scheduled decision, and a consensus that
  differs from the standing rate is a forecast of a move: the same quantity the dot plot gives for
  the US, from a different forecaster. `resolveNextRateDecision` in `lib/scoring/rates.ts` reads
  it, second in precedence behind the dot plot.
  **The evidence:** A1's 2026-08-25 NZDX row (`fixtures/a1-top-setups-2026-08-25.json`, capture F
  — row-sum, bounds and structural-zero clean, printed total cross-validated against capture D)
  prints Interest Rates **+1**, the only non-zero non-USD rates leg on that board. On that date
  the RBNZ's 2026-09-02 decision carried a consensus of 2.75% against a standing 2.50%. We scored
  0; we now score +1, EXACT. Contrapositive from the same board: the BoC's 2026-09-02 decision was
  forecast to hold at 2.25% and scores 0, and EUR/GBP/JPY had no decision in the window and score
  0 — which is what A1 printed for them too.
  **What it rests on, stated plainly: ONE positive checksummed example.** It reproduces a cell we
  could not reproduce before and contradicts nothing on file, but it is one row.
  `lib/scoring/rates.test.ts` pins that row so any future change has to argue with the evidence.
  **Limit:** the calendar looks about a week ahead, so this only fires when a decision falls inside
  that window. Widening the fetch was deliberately NOT done — no evidence on file says what A1's
  cell reads between meetings, and inventing one is how this column acquired two prior wrong
  answers.
- **CONFIRMED 2026-08-29 — the input is quarterly MARKET CONSENSUS rate projections, in A1's own
  words.** Their free "Interest Rate Projections" page
  (a1trading.com/interest-rates-data/, report `3653e7d4-e20d-4fd2-9853-c0a425b25973`) states:
  *"The graph above shows market consensus estimates on future projected interest rates for the
  selected currencies/economies."* It is plotted by CALENDAR QUARTER, and its currency dimension
  offers AUD, CAD, CHF, CHY, EUR, GBP, INR, JPY, NZD, USD, ZAR. Corroborating this, their free
  Forex Scorecard labels every economic row *"X vs. forecast"* and labels this one simply
  **"Interest rates"** — the only row with no comparison suffix, i.e. not a surprise read.
  **This settles a question open since round one:** the column is neither the bank's own projection
  (only the Fed publishes one) nor a market-price proxy (the 2Y/SMA hypothesis, twice rejected). It
  is a published consensus forecast of the policy rate itself, a quarter out.
- **The rule reproduces three of the five legs we can test, and the two misses are timing.**
  Quarter-over-quarter, 2026Q3 → 2026Q4, against the legs solved from A1's own checksummed rows:
  NZD 2.75→3.00 = **+1** vs A1's NZDX **+1** ✓; EUR 2.65→2.65 = **0** vs A1's EURX **0** ✓;
  GBP 4.00→4.00 = **0** vs A1's GBP leg **0** ✓; USD 3.75→4.00 = +1 vs A1's **−1** ✗;
  JPY 1.25→1.50 = +1 vs A1's **0** ✗. The projections are TODAY's consensus and the legs are 4–8
  days older, with Jackson Hole in between — a1trading.com's own 2026-08-28 article describes
  exactly such a repricing. Not separable without a dated snapshot of that chart. Values and the
  full test are in `fixtures/a1-edgefinder-demo-2026-08-29.json`.
- **CHF renders no projection at all** on that chart — selectable as a dimension value, but no bars
  and no line. So A1's own CHF rates leg does not come from this dataset, or comes from a null in
  it. That is the remaining hole under the one checksummed rates mismatch we still carry (EURCHF,
  2026-08-24).
- **Our implementation survives, and is now the closest legitimate approximation rather than a
  guess.** `resolveNextRateDecision` reads the calendar consensus for the next scheduled decision.
  A1 reads a quarterly consensus projection. For NZD on 2026-08-25 the two agree exactly (RBNZ
  2.50→2.75 next meeting; 2.75→3.00 next quarter; both a hike, both +1). They are the same
  quantity at different granularity.
- **BLOCKED, and now precisely: we have no quarterly consensus rate-projection feed.** FXStreet
  carries "Interest Rate Projections - Current / - 1st year" for the Fed alone. **Widening the
  calendar's forward window to a quarter was tried and measured and does NOT help** — every G10
  meeting became visible but not one beyond 12 days carried a consensus, so no cell moved and the
  payload grew a third. See `FXSTREET.historyLookaheadDays` for the full measurement; the
  constraint is the forecaster's publication schedule, not our fetch window.
- **Everything else still scores 0** — EUR, GBP, JPY, CAD, AUD, CHF, and NZD outside the RBNZ
  window — because neither a dot plot nor a scheduled forecast exists for them. That remains the
  honest reading, not a placeholder.
- **The A1 evidence for the rates column is now four independent equations, not one.** Re-running
  `solveA1Legs` on the UNION of every checksum-valid row this repo holds (`npm run rates-research`
  or `npm run component-parity`) — not just the single EURCHF row prior rounds cited — finds EURX,
  EURUSD, GBPUSD and EURCHF ALL constrain the `rates` column, and all four are satisfied by ONE
  ternary assignment with zero conflicts: **USD=-1, EUR=0, GBP=0, CHF=-1**. GBP's leg is new this
  round; it was sitting unused because GBPUSD was never previously combined with EURX/EURUSD/EURCHF
  in the same solve. USD=-1 is independently corroborated a second, different way: the checksummed
  DXY row (`fixtures/a1-board.json`, 2026-08-23) scores rates -1 on a card A1 themselves label
  "2 Yr Yield (21 day SMA)… falling (dovish)" — a different date, so not the same measurement, but
  the same direction two days running.
- **Our CURRENT production rule already matches A1 on three of these four currencies.** USD's
  dot-plot gives -1 (real evidence: the Fed genuinely projects a cut), and EUR/GBP's honest-0
  default happens to equal A1's own EUR=0, GBP=0. GBP's match is now CHECKSUMMED_CELL evidence,
  not just algebra (see Currency Indices below — the new GBPX row's rates cell is EXACT).
- **The remaining gap is CHF, on 2026-08-24, and it is now the ONLY checksummed rates mismatch
  left.** `npm run component-parity` reports the rates column as 7 EXACT / 1 MISMATCH: the one
  mismatch is EURCHF (ours 0, A1 +1, implying CHF = -1 against EURX's EUR = 0). NZD's mismatch is
  closed by the change above. A1's own CHFX row the NEXT day prints rates **0**, which agrees with
  us exactly — so CHF's leg either moved -1 → 0 overnight or one of the two readings is wrong, and
  nothing on file decides which.
- **Legs are not constants, and the solver must be date-scoped.** Merging 2026-08-25's CHFX row
  into the 2026-08-24 set makes the rates column report `satisfiable=false` — the solver correctly
  refusing to believe CHF = -1 and CHF = 0 at once. `scripts/component-parity.ts` and
  `scripts/rates-research.ts` now run ONE SOLVE PER DATE for this reason. Any cross-date leg claim
  made in an earlier round should be re-read with that in mind.

**TESTED AND REJECTED (this round) — the "2-year yield vs. its own 21-day SMA, every currency"
hypothesis, run against real historical data.** `npm run rates-research` (`lib/scoring/
rates-research.ts`, research-only, not wired into production) built the SAME comparison
`scoreYield2y` already uses for DXY — current 2-year yield vs. the trailing 21-observation
average, sign derived from the USD evidence above (rising = hawkish = +1, falling = dovish = -1)
— fed with REAL historical daily 2-year yields for USD (FRED DGS2), EUR (ECB), GBP (BoE nominal
spot curve), CAD (BoC Valet) and CHF (SNB), all aligned to 2026-08-24, the date the four
evidence-bearing rows above were captured. Result: it reproduces CHF (-1) but **not** EUR (predicts
+1, A1 says 0) or GBP (predicts +1, A1 says 0), and it cannot reach USD's -1 at all under either
window-length interpretation tested (its raw signal is a flat/marginal +0.39%, nowhere near -1) —
USD's -1 is fully explained by the EXISTING dot-plot rule and does not need this candidate. Only
1 of 4 currencies with real evidence matches, and that one match rests on CHF data that is 24 days
stale (SNB's source has published nothing since 2026-07-31 — see below), which is weak grounds on
its own. **Per this round's rule against forcing a fit, this is reported as a rejected hypothesis
in its literal form, not adjusted or re-thresholded to improve the match.** See `RATES EXPERIMENT
RESULT` in this round's report for the full breakdown, including a documented THRESHOLD AMBIGUITY:
a relative flat-band (0.5%, `YIELD_FLAT_BAND`'s shape) and an absolute one (0.1pp,
`RATE_SPREAD_FLAT_BAND`'s shape) disagree on which currencies match, and neither was selected —
picking whichever fits more cells is exactly the score-fitting this file's rules forbid.

**STRONG HYPOTHESIS, still open**
- **A1 may reserve the yield+SMA read for currencies with no published dot-plot, rather than
  applying one universal rule including USD** — which would explain why USD needs the EXISTING
  rule and not this candidate. This is consistent with everything measured so far but is not
  itself tested; it would need CHF's match to hold up on fresh (non-stale) data, plus JPY/CAD/AUD/
  NZD evidence, before it says anything beyond "consistent with one data point."
- Whether a DIFFERENT yield series for USD (e.g. `2YY=F`, the CME futures quote this app's OWN
  `fetchYield2y` already uses for DXY, rather than FRED's DGS2 cash yield used in this experiment)
  would change USD's marginal +0.39% reading is untested — `2YY=F` has no historical rewind
  capability today (LIVE_ONLY, confirmed round five), so this could not be checked for a past date.

**BLOCKED, for production wiring — narrowing.** No historical 2-year yield series is wired into
  production yet for any non-USD/EUR currency (every one is still a live TradingView point quote,
  `TVC:CH02Y` etc., which cannot build a 21-day SMA). That has not changed this round — see
  `RATES — DO NOT IMPLEMENT YET` below for why.
  What changed is which sources are confirmed to actually work: this round live-fetched every
  candidate (not just read its documentation), and two results overturned what the prior round's
  documentation-only research had concluded.

  **CHF — live-fetched, and the specific endpoint the prior round cited turned out to be dead.**
  The `rendoblid` cube (`data.snb.ch/api/cube/rendoblid/...`) returns HTTP 200 but its data stops
  at **2025-07-31** — confirmed both by fetching it directly and by SNB's own "Changes and
  revisions" page (`data.snb.ch/en/topics/ziredev`, dated 2025-12-11): SNB revised its CHF bond
  yield methodology in September 2025 and moved daily publication to a new "Supplementary data"
  cube, **`rendeiduebd`** ("Spot interest rates on Swiss Confederation bonds..."). Live-fetched
  `data.snb.ch/api/cube/rendeiduebd/data/csv/en?dimSel=D0(CHF),D1(2J)` and got real daily 2-year
  spot rates (e.g. `0.089` on 2026-07-31) — dimension `D1(2J)` confirmed against the cube's own
  `/dimensions/en` listing. One caveat worth flagging before implementation: the series returned
  stops at 2026-07-31 against this round's "today" of 2026-08-25, a ~3.5 week lag — fine for a
  21-day SMA (which just needs 21 trailing points, not today's), but worth understanding before
  trusting freshness claims.

  **GBP — no longer BLOCKED. Confirmed live, current-day data exists.** The prior round's
  automated fetch against `bankofengland.co.uk/statistics/yield-curves` returned HTTP 403 and was
  read as bot-protection; this round found the actual data is not on that page but behind its
  "Latest yield curve data" link, `bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/
  latest-yield-curve-data.zip`, which fetched clean (HTTP 200, ~385KB) with an ordinary browser
  User-Agent — no bot-protection encountered once the correct URL was used. The zip contains `GLC
  Nominal daily data current month.xlsx`, file-dated **2026-08-25** (today), whose "UK nominal
  spot curve" sheet has maturity as an explicit column header (`2` = the 2-year point, confirmed
  by inspecting the sheet XML directly) with real daily spot yields under it (~4.33% on a recent
  row). The UK DMO's CSV genuinely still lacks a 2yr point, as previously found — this doesn't
  change that — but it's now moot: BoE's spreadsheet is the real, working, free, keyless source.

  **CAD and JPY — reconfirmed with live data**, not just documentation. BoC Valet
  (`bankofcanada.ca/valet/observations/group/bond_yields_benchmark/csv`) returned real daily
  `BD.CDN.2YR.DQ.YLD` values current through 2026-08-21. MOF's `jgbcme.csv` returned a real daily
  2Y column current through at least 2026-08-13.

  **AUD — still blocked, but the actual reason is now known and it is NOT what the prior round
  guessed.** `rba.gov.au/statistics/tables/csv/f2.1-data.csv` returns HTTP 403 with an "Access
  Denied" WAF page (Akamai-shaped) regardless of User-Agent, Accept-Language, or Referer headers —
  this is not the simple bot-UA block the prior round's note assumed ("needs a header/UA caveat");
  it held even against a request shaped like a real browser. The RBA's main statistics pages
  (`rba.gov.au/statistics/tables/`) load fine in an actual browser, but direct navigation to the
  CSV file itself was also denied by the preview browser. This needs a real interactive-browser
  session with the file actually downloaded through the page's own link (not attempted this round)
  before it can be called anything but BLOCKED for automated/scripted access — or one of the
  mirrors (econdb.com, db.nomics.world) tried instead.

  **NZD — unchanged.** The RBNZ wholesale-rates page (`rbnz.govt.nz/statistics/series/
  exchange-and-interest-rates/wholesale-interest-rates`) is reachable (HTTP 200), but this round
  did not go further into the actual data file or the 2025-08-25 source-switch caveat the prior
  round flagged. Still KNOWN-with-caveat, not newly verified.

  **Still no code change here.** A source being live-fetched and producing real numbers is not the
  same as being wired into `scoreYield2y`-style scoring with the 21-day SMA actually computed and
  checked against an A1 cell, which needs its own regression test per currency — see the
  validation standard below. This round upgrades three sources from "documented" to "verified
  live"; it implements none of them.

---


**ROUND THIRTEEN — A1 PUBLISHES ACTUAL *AND* FORECAST, DATED, PER COUNTRY (2026-08-30).** Their
free "EdgeFinder - Free Economic Data" report carries a page per series with a currency filter
and a date range back to 2024. That moves every economic discrepancy from "which cell is right"
to arithmetic. Frozen in `fixtures/a1-free-economic-2026-08-30.json`; the whole per-cell verdict
list is `npm run ledger`.

**CHF CONSUMER CONFIDENCE — CLOSED, AND NOT THE WAY IT LOOKED.**

| | actual | forecast | cell |
|---|---|---|---|
| A1, release 2026-08-07 | **-33** | -34 | beat -> **+1** |
| ours, same release | **-35** | -34 | miss -> **-1** |

**The forecasts are identical.** A1 compares against the FORECAST exactly as we do and reaches
+1 from a different ACTUAL. The long-proposed switch to comparing against the PREVIOUS print is
therefore **refuted, not merely unsupported** — it would have been right for the wrong reason and
would have broken every other currency on that column. `SOURCE_DIFFERENCE`, `PROVEN`. Their leg
is +1 by algebra too: their EURX consumer-confidence cell reads +1 (EUR = +1) and their
checksummed EURCHF row reads 0, forcing CHF = +1.

**GBP mPMI — a 0.1 forecast difference.** Flash of 2026-08-21: same actual 51.5, their forecast
51.6 against our 51.5. Either side of the line. `SOURCE_DIFFERENCE`. A deadband would not help;
it would make the cell 0 under THEIR numbers too.

**CHF mPMI — their data contradicts their own cell.** 2026-08-03: actual 53.2 against forecast
54.5, and **our numbers are identical to theirs**. Any rule gives -1. Their cells force +1 (EURX
mPMI +1 => EUR +1; EURCHF mPMI 0 => CHF +1). `A1_INCONSISTENCY`.

**GBP PPI — cells agree, bases do not.** They compare 3.10% against a 3.20% forecast; we compare
it against the 3.5% previous because our calendar carries no GBP PPI consensus. Both reach -1.
The agreement is luck and will break the first time a print lands between the two references.

**EUR UNEMPLOYMENT — their page publishes the ACTUAL ONLY.** The forecast chart renders
`COMING SOON!` over a dataset error. Their actual matches ours (2026-07: 6.30%, unchanged from
6.30%). The comparison basis **cannot be settled from their free surface**. This is now the one
column where a single new capture would decide something.

**A1'S OWN PUBLISHED RULES, verbatim from their pages:**
- GDP: "If there is a beat in the forecasted GDP, it will be bullish for that currency and their
  respective indices... It is also a positive score for metals and commodities such as Silver,
  Copper, Platinum and USOil. **Gold is the exception.**"
- PMI: "if PMI in either category come in higher, it is considered optimistic for its currency
  (+1). However, this would impact other assets such as gold, in a negative way."
- GDP series per country: **US: GDP QoQ; UK, EU, JP, CA: GDP MoM.**

**SILVER POLARITY — follow their DATA, not their prose.** Their text says only gold inverts;
their own 2026-08-24 cells give XAUUSD and XAGUSD identical gdp (+1), mpmi (-1) and
consumer-confidence (+1), which only works if silver inverts too. We invert both, which is why
XAGUSD is 18/18 exact. Do not "fix" this.

**THREE-STATE COMPARISON, CONFIRMED.** Their PPI chart splits every release into
**Met / Lower than expected / Higher than expected** as separate series — an exact match is its
own category, with no tolerance band. That independently corroborates `scoreTernary` and the
removal of its old +/-0.25 sigma deadband. Do not reintroduce one.

## Economic / Heatmap

**ROUND FOURTEEN (2026-08-30) — GBP's ECONOMIC BLOCK IS FULLY ACCOUNTED FOR, AND EUR
UNEMPLOYMENT IS CLOSED.**

**Their GDP page publishes the CLASSIFICATION, not just the numbers.** Each release bar is
coloured by A1's own verdict -- white "As expected", blue "Beat Forecast", red "Missed Forecast".
For that series no inference is needed at all.

The four GBP cells that disagree, with A1's own published inputs beside ours:

| cell | A1 actual | A1 forecast | A1 cell | ours actual | ours forecast | ours cell | verdict |
|---|---|---|---|---|---|---|---|
| GDP MoM, rel. 2026-08-13 | 0.4% | 0.4% | 0 | 0.3% | 0.0% | +1 | SOURCE (both differ) |
| Retail Sales MoM, rel. 2026-08-21 | -0.50% | **-0.40%** | -1 | -0.50% | -0.50% | 0 | SOURCE (forecast) |
| mPMI flash, 2026-08-21 | 51.5 | **51.6** | -1 | 51.5 | 51.5 | 0 | SOURCE (forecast) |
| PPI YoY, 2026-08 | 3.10% | 3.20% | -1 on their PAGE, **+1 on their BOARD** | 3.1% | 3.5% prev | -1 | A1_INCONSISTENCY |

Each of the first three A1 cells agrees with the GBP leg derived from their own board. **Not one
of the four is a rule we have wrong.** The PPI row is A1 against A1: their board's GBPUSD PPI cell
of +2, against a USD PPI leg of -1 corroborated three ways, forces GBP = +1, while their own PPI
page classifies the same release "Lower than expected".

**EUR UNEMPLOYMENT IS CLOSED, and never needed their series page.** Carried as UNKNOWN for three
rounds because their Unemployment Rate page publishes the actual only (forecast chart renders
`COMING SOON!` over a dataset error). Settled from their CELLS: USD unemployment = +1 read
directly off the metals, their EURUSD prints -2, so EUR = -1 -- exactly our cell. Their EURX row
prints 0, which their own board contradicts. The standing proposal to score EUR unemployment
against the PREVIOUS print would have moved a cell they already agree with. Do not reopen without
a checksum-valid EURX row from a different date.

**TIMING RULE CONFIRMED.** Their GDP page shows USD's 2026-08-26 release white (as expected) and
2026-07-30 red (missed); the 2026-08-24 board carries USD gdp = -1, the July release. Their board
uses the latest release BEFORE the capture, exactly as ours does.


14 scoring slots: gdp, mpmi, spmi, retail-sales, consumer-confidence, cpi, ppi, pce, employment,
unemployment, claims, adp, jolts.

**asOf reproducibility: HISTORICAL.** Fully data-driven from `events: NormalizedEvent[]`, which
is exactly what `asOf()` filters (`e.dateUtc <= iso`). This is the column set the backtest
harness actually exercises, and the only one every parity script has always rewound correctly.

**KNOWN**
- Matches nine historical Economic Heatmap fixtures (`scripts/cards.ts`).
- On the six checksummed Top Setups rows: trend/seasonality/cot/spmi/cpi are 6/6 exact; gdp 5/6,
  mpmi 4/6, retail-sales 5/6, consumer-confidence 5/6, ppi 5/6, unemployment 4/6.
- The "no such series" convention is confirmed correct, not a scoring gap: A1 prints 0 in every
  US-only column (PCE, NFP/employment, claims, ADP, JOLTS) on a row with no dollar leg; this repo
  renders those cells blank, which is arithmetically identical and now surfaces as `NOT_VISIBLE`
  rather than a false mismatch (`npm run component-parity`).

**UNKNOWN**
- The specific residual mismatches on GBPUSD (gdp, mpmi, retail-sales, ppi) and EURCHF (mpmi,
  consumer-confidence, unemployment) are not yet root-caused to a series/basis choice — each
  needs the same evidence -> series -> input -> reproducible-difference chain as every prior fix
  in this file, not a guess.
- A1's own EURO index row (unemployment 0) contradicts their EURUSD row (unemployment -2, which
  implies an EUR leg of -1) — flagged in round four, unresolved in either direction. Either their
  index rows and pair rows use different leg values, or one cell is misread; no way yet to tell
  which.

**BLOCKED**
- Nothing.

---

## COT

**asOf reproducibility: HISTORICAL.** `CotSeries.reports` is a genuine, ordered time series;
`asOf()` filters it by `reportDate <= iso.slice(0,10)`, and every parity script threads a full
`CotSeries` map through that filter.

**KNOWN**
- Scored via `scoreCot`, weekly CFTC large-speculator positioning; FX pairs read only the weekly
  change (differenced), standalone assets/currency-indices read net positioning plus the weekly
  change.
- 6/6 checksummed rows exact.

**UNKNOWN**
- Nothing currently open against checksummed evidence.

**BLOCKED**
- Nothing.

---


**ROUND TWELVE — GBPX DECOMPOSED AS FAR AS THE EVIDENCE ALLOWS (2026-08-30).** On the 2026-08-23
board GBPX is **ours -1, A1 0**. The GBP legs are not the cause and that is showable without a
GBPX row: GBPUSD is EXACT (+10 vs +10) and carries every GBP economic leg GBPX does, and a leg
wrong by `k` would shift every GBP-base pair by `+k` together. They do not move together —
GBPUSD 0, GBPAUD -2, GBPJPY -2, GBPNZD -2, GBPCAD **+2**, EURGBP -1 — so the residual sits in the
counterparties. That leaves the one point inside trend / seasonality / COT / crowd, the four
columns read off the index INSTRUMENT rather than any leg, and **no checksum-valid GBPX row
exists to say which**: the only one ever captured was withdrawn in round ten for carrying three
US-only values. Note our GBPX COT cell (0) and our GBP COT leg (+1) differ **by design** — an
index row scores both COT components, a pair leg scores only the weekly change.

## Currency Indices (DXY, EURX, GBPX, JPYX, AUDX, NZDX, CADX, CHFX)

**ROUND FOURTEEN (2026-08-30) — THE INDEX ROWS CANNOT BE RE-CAPTURED, AND DID NOT NEED TO BE.**

Checked directly, not assumed: **no free A1 surface carries a currency-index row at all.** Their
Forex Scorecard is pairs only; their Asset Scorecard -- the source of the checksummed DXY row --
is capped to *platinum* in the demo ("To unlock all symbols, please upgrade to premium"). EURX,
GBPX and CHFX are unobservable. Stop asking for that screenshot.

**LEG-DIFFERENCING IS PROVED, over-determined, and it does not presuppose itself.** Gold and
silver carry the dollar leg and nothing else, inverted, so negating either row reads USD DIRECTLY
with no differencing involved -- and the two metals agree in all 14 economic columns. Measuring
the same leg as EURX - EURUSD reconciles with it in **13 of 14**. The one exception, unemployment,
yields +2, which is out of range for a ternary leg and therefore dates a bad CELL rather than the
rule. `structure:leg-differencing` graded SUPPORTED -> CONFIRMED. The grade covers the ECONOMIC
block only: trend, seasonality, COT and crowd come from the index INSTRUMENT and are not
differenced.

**EURX is fully accounted for.** 12 of 18 columns EXACT, 5 structural zeros that agree by
construction, and exactly two disagreements: crowd (source difference, oracle-confirmed) and
unemployment -- where A1's own EURUSD and metals force EUR = -1, which is OUR cell, against the 0
their EURX row prints. Not one of EURX's 18 columns indicates a defect in our model.

**GBPX: the one-point gap is two larger errors cancelling.** A1's GBP economic legs sum to
exactly 0 and their published GBPX total is 0, so their four instrument columns sum to 0 too.
Ours: economic +1, instrument -2. Within the economic +1: gdp (+1 vs 0), mpmi (0 vs -1),
retail-sales (0 vs -1), ppi (-1 vs +1) -- three proven forecast differences and one A1
self-contradiction. Of the instrument -2, crowd accounts for +1 (their book had GBPUSD at 31%
long; our production scorer turns that into a GBPX +1 against our CFTC 0). **One point remains,
across trend, seasonality and COT, and trend is LIVE_ONLY so it is timing-confounded by
construction.** Do not infer it from the total.


**asOf reproducibility: varies by underlying component** — see each component's own tag above.
Structurally, every index row reads its ONE currency's own data straight through
(`single(macroEconomy, ...)` in `lib/scoring/a1-legs.ts`), never differenced from two pairs —
confirmed both by this repo's own design and by A1's CADCHF-vs-CA-DOLLAR arithmetic not matching
a differenced model.

**KNOWN**
- EURX: persistent -3 gap, partially decomposed — crowd -2 (structural, see Crowd above),
  unemployment -1 (cross-day confirmed persistent, see `EdgeFinder-scoring-diagnosis.md` round
  three/four).
- CHFX: exact.
- EURCHF (a cross, not an index, but the only fully checksummed cross row) — full 18-cell parity
  measured this round via `npm run component-parity`: 8 EXACT, 1 BLOCKED_SOURCE (crowd), 3
  MISMATCH with an unresolved cause (mpmi, consumer-confidence, unemployment — open economic-series
  questions above), 1 MISMATCH with a known structural cause (rates, see Rates above), 5
  NOT_VISIBLE (US-only columns), 0 UNKNOWN.

**RETRACTED — "GBPX is CLOSED as an evidence gap" was wrong, and so was the breakdown under it.**
The previous round admitted a GB-POUND row on two checks: its eighteen cells summed to the
printed total of 0, and that total matched capture D's independently recorded GB-POUND=0. Both
checks passed and the row was still misread, because **a sum is invariant under permutation** —
these crops have to be partitioned into six header groups by eye (2|2|5|3|1|5 = 18), and a
partition that shifts values between neighbouring columns adds to exactly the same total.

`checkStructuralZeros` (`lib/scoring/a1-legs.ts`, added 2026-08-29) is the check that catches it.
PCE, NFP, initial claims, ADP and JOLTS are US series and nothing else, so a row with no dollar
leg cannot carry a value in them and A1 prints 0 — the convention `component-parity.ts` already
relies on for NOT_VISIBLE. The admitted GB-POUND row carried **pce -1, NFP +1 and claims -1**.
Three of the "9 economic mismatches" were therefore not mismatches at all; they were misread
cells, and there is no honest way to know which columns those values actually belong to. The row
is discarded entirely, not repaired.

**What this retracts, specifically:**
- GBPX's gap does NOT decompose into nine economic mismatches. It is undecomposed again.
- GBP's rates leg is NOT checksummed evidence. It reverts to `SOLVED_LEG` (0, from EURX+GBPUSD on
  2026-08-24), which is still real evidence and still agrees with our production 0.
- NZD's rates leg is NOT "evidenced-wrong in the opposite direction to CHF". NZDX survived the
  structural screen and its +1 is genuine — and it is now REPRODUCED, not merely observed (see
  Rates above).
- The "leg solve's self-contradicting column count went 2 → 8, so A1's board may not be
  leg-differenced" finding is withdrawn. It goes back to 2 (crowd, unemployment) once GB-POUND and
  EURJPY are screened out. The structural finding was five misread cells.

The same breach appears in three more rows in `fixtures/a1-board.json` — CADX (claims +1), GBPJPY
(pce -1) and JPYX (pce -1), all in its 2026-08-21 captures. Those captures are not currently
selected by any solve (`boardCellsForSolve` takes the newest DATED capture, 2026-08-23, which
carries DXY alone), so nothing downstream was resting on them — but they are breached, they would
be screened out the moment anything selected them, and five breached rows across two
independently captured fixtures says this failure mode is the norm for dense crops, not a one-off.

**KNOWN — two rows from capture F survive all three checks.**
- **NZDX** (2026-08-25): 11 EXACT, 2 MISMATCH (gdp, spmi), 1 TIMING_CONFOUNDED (crowd), 6
  NOT_VISIBLE. Its rates cell is now EXACT — see Rates above.
- **CHFX** (2026-08-25): 11 EXACT, 2 MISMATCH (consumer-confidence, unemployment), 5 NOT_VISIBLE.
  Its total of +3 matches ours exactly on both days (`npm run cross-day` classes CH-FRANC as
  NOISE, gap 0/0). Eleven independently computed cells agreeing is itself corroboration that the
  transcription is genuine — a misaligned row does not produce that.

**UNKNOWN**
- GBPX's +2 gap: location unknown again. The row that appeared to localise it did not.
- DXY: same-sign gap, magnitude confounded by DXY's LIVE_ONLY rates leg (see Rates above) —
  cannot currently be separated from ordinary technicals/yield drift without a same-day capture.
- CADX, JPYX, AUDX: no checksummed evidence that survives the structural screen.
- **CHF consumer confidence — two A1 readings that disagree with each other and with us.** Ours
  is -1 (SECO Consumer Climate scored against a forecast we carry). A1's 2026-08-24 rows imply
  **+1** (EURX cc = +1, EURCHF cc = 0, so CHF = +1); A1's 2026-08-25 CHFX row prints **0**. Note
  that scoring SECO against the PREVIOUS print rather than the forecast yields exactly +1 — the
  same shape as the `compareByCurrency: { CHF: 'previous' }` overrides already set for two other
  Swiss series. **Not implemented**, on two grounds the config itself states: their CH card has no
  Consumer Confidence row at all, so the "blank Forecast column on their card" test cannot be run;
  and our own feed DOES carry a consensus for the series, which is the config's stated bar for
  never setting the override. One reading each way is not evidence.
- **CHF unemployment:** ours 0 (3.1% vs a 3.1% previous), A1's CHFX row -1. Single observation,
  no root cause.

**A structural finding from this round, not a new blocker:** adding GBPX and EURJPY as real
constraints to `solveA1Legs` raised the self-contradicting-column count from 2 (crowd,
unemployment) to **8** (crowd, mpmi, consumer-confidence, ppi, pce, employment, unemployment,
claims) — `npm run component-parity`'s own leg-solve now flags this every run. This means the
simple linear currency-differencing model most `SOLVED_LEG`/`NOT_CHECKSUMMED` predictions rest on
is demonstrably unreliable for MOST economic slots once more than one currency-index row is in
evidence — not a tooling bug, a real finding about A1's model (echoing the already-flagged EURO-
vs-EURUSD unemployment inconsistency from round four, now shown to generalize). Treat any
`NOT_CHECKSUMMED` economic prediction with correspondingly less confidence than before this round.

**BLOCKED**
- Nothing structural — this is entirely an evidence gap, not a data-source or rule gap.

---

## Provider research (this round)

Per-provider verdict key: **KNOWN** (documented, usable, integrate) / **UNKNOWN** (plausible,
needs a live test fetch to confirm before trusting it) / **BLOCKED** (no free/legitimate/daily
source found, or a specific access reason).

### Crowd / retail positioning

**OANDA position/order book — BLOCKED.** The v20 REST `positionBook`/`orderBook` endpoints
(personal-access-token auth, free demo account, no live funding required) were the strongest
untried candidate going into this round. They were **discontinued platform-wide in September
2024** — confirmed by multiple independent developer reports, and OANDA support described it as
a business decision not expected to reverse. The remaining public-facing page,
`trade.oanda.com/labs/position-ratios`, is a marketing widget (majors only, ~20-minute refresh,
no documented API behind it), not a usable data source. The paid replacement, OANDA Data
Services, runs roughly $1,850/month on a 12-month contract — out of scope without asking first
per this round's rules on paid/account-gated sources.

**Dukascopy Historical Sentiment Index — UNKNOWN.** Genuine history exists (30-minute updates,
checkpoints at latest/6h/1day/1month), which is more than any other candidate offers. The blocker
is access shape, not data: it's exposed through the JForex desktop platform's Strategy API
(`IDataService.getFXSentimentIndex`), not a REST endpoint, so integrating it would mean scripting
against a desktop trading platform rather than calling an HTTP API. Cross coverage beyond "most
popular currencies and currency pairs" is unconfirmed — would need a live pull to check EURCHF/
EURGBP/GBPJPY specifically before this could move to KNOWN or BLOCKED.

**IG client sentiment — UNKNOWN, leaning usable.** `/clientsentiment/{marketId}` and
`/clientsentiment/related/{marketId}` are real, documented REST endpoints
(labs.ig.com; wrapper docs at trading-ig.readthedocs.io) returning `longPositionPercentage`/
`shortPositionPercentage` directly — exactly A1's shape. A free demo account is enough to get API
credentials; rate limits exist but aren't a blocker at this scale. Two open questions before this
can be called KNOWN: (1) does IG's instrument list include the specific crosses A1 needs, and (2)
the live endpoint is a current snapshot only — historical backfill is a separate paid product
(Excel Price Feed's historical client-sentiment download), so this would still be LIVE_ONLY the
same way the current Myfxbook-shaped connector would have been. Worth a real test pull.

**FXBlue — BLOCKED for crosses, UNKNOWN for majors.** FXBlue's own documentation states it
excludes thin pairs (their published example: CAD/JPY has no sentiment data because too few
real-money accounts hold positions in it), which is a direct, confirmed structural threat to
EURCHF/EURGBP/GBPJPY — the exact crosses this repo needs crowd data for. No clean single REST
spec was found either (a "Sentiment Trader" widget and a market-data API exist, undocumented as a
formal spec). Not worth pursuing further for crosses; possibly fine for majors, but Myfxbook was
already going to cover majors via the CFTC-contract fallback rung, so this adds little there.

**Verdict for this round: no crowd provider moved to KNOWN — unchanged.** IG is still the most
promising next test (real REST API, right data shape), but the next actionable step requires
creating a free IG demo account, which this round's rules require asking about explicitly before
doing (`AGENTS.md`-adjacent session rule: never create an account silently). Not done this round —
flagged for the user instead of assumed. No new EURCHF/cross retail-sentiment screenshots arrived
either, so the single-point 48%-vs-+1 contradiction (see Crowd above) is still unresolved.

### Historical 2-year sovereign yields (GBP, JPY, CAD, AUD, NZD, CHF)

This subsection was research-only (documentation review, no live fetch) as of the prior round.
This round live-fetched every candidate. Two verdicts changed as a result -- CHF's specific
endpoint was found dead and replaced, and GBP moved off BLOCKED entirely.

**CHF -- KNOWN, but the cube ID changed.** The previously-cited cube, `rendoblid` ("Yields on bond
issues - Day", the "2002 methodology"), returns HTTP 200 but its last data point is 2025-07-31 --
SNB retired it in a September 2025 methodology revision (their own "Changes and revisions" page,
`data.snb.ch/en/topics/ziredev#notes`, documents the cutover explicitly). The live replacement is
cube **`rendeiduebd`** ("Spot interest rates on Swiss Confederation bonds, euro area government
bonds and CHF bond issues for various borrower categories - Day"), found via the portal's own
search (`data.snb.ch/en/search?q=bond+yield`). Confirmed live: `data.snb.ch/api/cube/rendeiduebd/
data/csv/en?dimSel=D0(CHF),D1(2J)` returns real daily 2-year CHF spot yields (dimension `2J`
confirmed against `.../rendeiduebd/dimensions/en`), most recent point 2026-07-31 against this
round's "today" of 2026-08-25 -- usable for a 21-day SMA regardless of that lag, but worth noting.
Free, keyless, CSV, same query-param shape as before (`dimSel`, `fromDate`, `toDate`).

**GBP -- KNOWN. No longer blocked.** The UK DMO's CSV still lacks a 2yr point (only 5/10/30/50yr --
unchanged finding, still ruled out for this purpose). But Bank of England's daily "Latest yield
curve data" zip -- `bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/
latest-yield-curve-data.zip`, linked from the yield-curves page's "Latest yield curve data" button
-- fetched clean with a plain browser User-Agent (HTTP 200, ~385KB, no bot-protection encountered).
Contains `GLC Nominal daily data current month.xlsx`, file-dated 2026-08-25 (today). Its "UK
nominal spot curve" sheet has maturity-in-years as an explicit numeric column header, including
`2`, with real yield values under it. The prior round's HTTP 403 was against the wrong URL
(the page itself, not the file link) -- the actual data endpoint has no bot-protection at all.

**CAD -- KNOWN, reconfirmed live.** Bank of Canada Valet API, series `BD.CDN.2YR.DQ.YLD`
(`bankofcanada.ca/valet/observations/group/bond_yields_benchmark/csv`). Live-fetched: real daily
values through 2026-08-21. Free, no key, no registration, published once daily 09:30-10:00 ET.

**JPY -- KNOWN, reconfirmed live.** Japan MOF's `jgbcme.csv`. Live-fetched: real daily 2Y column
through at least 2026-08-13. Free, keyless, plain CSV, daily, JST.

**AUD -- still BLOCKED, and the blocker is stronger than previously thought.** RBA Table F2.1
(`rba.gov.au/statistics/tables/csv/f2.1-data.csv`) was re-tried this round with a full
browser-shaped request (Chrome UA, `Accept: text/csv`, `Accept-Language`, and a `Referer` of the
RBA's own statistics-tables page) and still returned HTTP 403 with an Akamai-shaped "Access
Denied" body -- this is WAF-level bot-protection, not the simple missing-UA-header issue the prior
round guessed. The RBA's own statistics pages load fine in an interactive browser, but direct
navigation to the CSV file itself was also denied there. Genuinely needs either a real
interactive-browser download flow (not attempted this round) or one of the documented mirrors
(econdb.com, db.nomics.world) tried as the actual source instead.

**NZD -- unchanged, not re-verified this round.** RBNZ's wholesale-rates page loads (HTTP 200 on a
quick reachability check), but the actual B2 data file and the 2025-08-25 NZFMA source-switch
caveat from the prior round were not re-checked. Still KNOWN-with-caveat.

**OECD, investing.com, worldgovernmentbonds.com -- ruled out** (unchanged from prior round). OECD's
published series are long-term (10yr) and short-term (3-month) only. The two commercial sites
expose no documented API or clean CSV endpoint.

**Verdict for this round: CHF, GBP, CAD, and JPY are now live-verified and ready to wire in** -- a
fetch + history + test would turn each into the same shape as the existing FRED/ECB connectors,
using the corrected CHF cube ID and the BoE zip's nominal-spot sheet for GBP. AUD remains genuinely
blocked pending a different access path. NZD needs the column-layout check the prior round
flagged, still outstanding. **No code changed this round** -- this is still the research half of
the evidence chain in `AGENTS.md` section 9; wiring any of these in, each with its own regression
test, is next round's work -- see `RATES -- DO NOT IMPLEMENT YET` above for why even CHF/GBP/CAD/JPY
don't clear the bar yet (one checksummed A1 observation, EURCHF, is not "multiple independent
validation points").

---

## New EdgeFinder evidence required (priority order)

**REWRITTEN ROUND FOURTEEN (2026-08-30).** Two of the previous four asks are now answered or
retired, and the surviving ones changed shape. Do not re-request a checksum-valid cross in
general -- EURCHF, GBPX, NZDX and EURJPY are all already both simultaneously (see Currency
Indices above). Do not request a currency-index screenshot from the free demo: no free surface
carries one, checked this round.

1. **A second checksum-valid EURX row, from any date other than 2026-08-24.** The single most
   valuable capture remaining. That one row carries the ONLY observation contradicting the rates
   rule, and its checksum is now known to be blind to that cell -- the rates and unemployment
   cells are wrong by +1 and -1 under the evidence and cancel exactly. A second row retests both
   at once, and would either confirm the rates rule outright or destroy it. Needs the paid Top
   Setups page with the Symbol filter set to EURO alone, so no adjacent-row pixel crowding, and
   the board timestamp visible.
2. **A checksum-valid GBPX row from any date**, for the same reason in a different column: one
   point remains across trend, seasonality and COT after crowd is accounted for, and nothing
   short of the row itself can place it. Same capture conditions: Symbol filtered to GB-POUND
   alone, timestamp visible.
3. **Retail Sentiment for one more FX cross** (GBPCHF or EURJPY, symbol + longPct + timestamp),
   to turn the crowd oracle's 8/8 into a measurement that covers crosses. Confirmed in an earlier
   round: the free Retail Sentiment dashboard carries zero FX crosses, so this must come from the
   paid product.
4. **RETIRED: the CHF/NZD rates evidence card.** The rule is no longer inferred from cards -- A1
   publishes both halves of the comparison on two free pages, and CHF is solved (policy 0.00% and
   every projected quarter 0.00%, so the leg is 0, which is what CHFX prints).
5. **RETIRED: root-causing "the 9 GBPX economic mismatches".** There were never nine. There are
   four, three are proven forecast differences against A1's own published inputs, and the fourth
   is A1 contradicting itself.

Each ask, once captured, should be checksummed the same way -- **and note what round fourteen
learned about that check**: a row-sum checksum is blind to a pair of errors that cancel. It is a
necessary test, not a sufficient one. A row that passes it can still carry two bad cells.
