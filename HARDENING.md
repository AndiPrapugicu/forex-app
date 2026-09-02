# Hardening decisions

> **Evidence tier: mixed.** Sections dated before 2026-08-31 were measured through A1's tiered demo and are PREVIOUS DEMO HYPOTHESIS until re-tested. See [LEGACY-EVIDENCE.md](LEGACY-EVIDENCE.md).

Companion to [SCORING-CONTRACT.md](SCORING-CONTRACT.md) (what the engine
guarantees) and [TRUTH-EVIDENCE.md](TRUTH-EVIDENCE.md) (what a primary source
says). This file records decisions that are **not** obvious from the code, and
in several cases records a decision **not** to change something.

The governing rule for everything below: *A1 is a regression surface, not a
definition of truth.* A change is justified by evidence about the world, or by
an internal contradiction in our own output. It is never justified by the gap to
someone else's board.

---

## 1. Basis overrides (`compareByCurrency`)

Run `npm run overrides` to reproduce this table against the live calendar.

A basis override looks like it only decides what a print is measured **against**.
It also decides which print is **reachable**, because `resolveSeries` prefers the
most recent print scoreable under the requested basis — and on a forecast basis
"scoreable" means "carries a consensus". Those are two very different jobs, and
whether an override is a bug depends entirely on which one it is doing.

| Slot | Cur | Verdict | What it is actually holding |
|---|---|---|---|
| `retail-sales` | CAD | **DELETED** | Nothing. It discarded a consensus on a print it had already resolved |
| `mpmi` | CAD | **DELETED** | Nothing — same defect, no board effect |
| `spmi` | CAD | **DELETED** | Nothing — same defect, no board effect |
| `ppi` | CHF | **KEEP** | The *series*. Without it the slot switches YoY → MoM on the same day |
| `ppi` | AUD | **KEEP** | The *series*. Without it the slot switches YoY → QoQ |
| `unemployment` | CHF | **KEEP** | The *date*. Without it the slot reaches back a month to an older forecast print |
| `ppi` | GBP | **KEEP** | Inert today, but the same reachability risk applies on other dates |

**The distinction that matters.** Canada's override fired on a print it had
already chosen, throwing away a `+0.4` consensus that Statistics Canada's `+0.6`
release had beaten. Nothing about reachability was involved, so nothing was lost
by deleting it. The three that survive keep resolution on the right series or the
right date in currencies whose series are *never* forecast. Deleting those would
score Switzerland's unemployment off a month-old print.

Pinned by `lib/scoring/overrides.test.ts`, including the counterfactual for each.

### The architectural tension underneath, and why it was not "fixed"

`resolveSeries` tier 1 demands a consensus. `scoreSlot` does not — it falls back
to the prior print. A print can therefore be unreachable and perfectly scoreable
at the same time, and the three surviving overrides exist to paper over that.

Making the resolver accept prior-print-scoreable prints was **tried and
reverted** on 2026-08-31. Measurement: the live board did not move at all, and
two evidence-backed tests in `edgefinder-parity.test.ts` failed — the pattern
list is a *preference* order, and "prefer a forecast-backed series over an
unforecast one" is a legitimate quality rule that the change would discard.

With no wrong cell to point at, the current behaviour stands. This is recorded
so the next person does not rediscover it: **the overrides are a per-currency
policy, not a workaround.**

---

## 2. Retail sentiment (Crowd) — architecture ready, no provider adopted

Crowd is the one column where a second implementation is demonstrably ahead of
us. The scoring is not in question — the 40/60 band and the index derivation are
confirmed and untouched. What is missing is a **population**.

| Candidate | Verdict |
|---|---|
| **IG** `/clientsentiment/{marketId}` | **Best candidate.** Documented REST endpoint returning `longPositionPercentage` / `shortPositionPercentage`. Needs an IG account and API key. Broad coverage: FX majors, crosses, metals, indices |
| Dukascopy SWFX | Real positioning, 30-minute updates, but **8 pairs plus gold and Brent** — far short of our board, no history, no documented programmatic API |
| FXSSI | Aggregates brokers, but **not proven to be anyone's source**, no public API, and reading it means scraping a widget |
| Myfxbook | **Blocked.** Login succeeds, the outlook call is rejected server-side. Confirmed not our bug |
| OANDA | Discontinued for this purpose |

**Decision: adopt none of them this round.** The existing seam is already the
right shape — `provider → RetailPositioning → resolveCrowd` — and it fails
closed: with no credentials configured, `fetchRetailPositioning` resolves to an
error `Result` without touching the network, every symbol falls back to its own
futures contract, and the health table says why.

That fallback is a **methodology substitution**, not a rounding difference: a
weekly CME futures population standing in for a daily retail spot book. It is
already marked as lower confidence by `basis: 'own-contract'` on the cell.

**What would change the decision:** an IG API key. The connector would implement
the existing `RetailPositioningFeed` contract and nothing in the scorer changes.

---

## 3. Rates — implemented 2026-09-01, and the blocker was never the rule

The rule was confirmed four rounds ago from A1's own heatmap arithmetic: their
rates leg compares the **quarterly consensus projection** against the **standing
policy rate**. What kept it out of production was not effort and not doubt about
the rule. A rates cell on a pair is a *difference*, so a leg computed under the
new rule and differenced against a leg computed under the old one is not a
measurement of anything — it is two models subtracted. The first attempt held the
Fed's dot plot alone, moved USD's leg while the other seven sat at a placeholder
0, and cell parity went 84/98 to 82/98 with **no cell gained**.

**What changed is the data, not the reasoning.** A1's Interest Rate Projections
page is free and its chart tooltips print every selected currency for one quarter
at once, so a full eight-currency reading is obtainable in two passes of the
currency filter. `fixtures/a1-rate-projections.json` now holds one, dated
2026-09-01. It is the first reading that covers every major.

### It reproduces all eight legs, on two captures

`sign(current quarter's projection − standing policy rate)`, against the Rates
column of A1's own eight currency rows — identical on 2026-08-31 and 2026-09-01:

| | EUR | GBP | JPY | NZD | USD | AUD | CAD | CHF |
|---|---|---|---|---|---|---|---|---|
| projection 2026Q3 | 2.7 | 4.0 | 1.3 | 2.8 | 4.0 | 4.4 | 2.3 | 0.0 |
| standing | 2.15 | 3.75 | 0.75 | 2.25 | 3.75 | 4.35 | 2.25 | 0.00 |
| rule | **+1** | **+1** | **+1** | **+1** | **+1** | **0** | **0** | **0** |
| A1 prints | +1 | +1 | +1 | +1 | +1 | 0 | 0 | 0 |

8/8. Every forward quarter gives the same eight; only the already-elapsed 2026Q2
gives 6/8, which is what a past quarter should do.

`npm run board-parity` puts the Rates column at **51 of 51 rows exact**, from 28
agreeing and 23 disagreeing before.

### Two guards, and neither is optional

**The reading's own precision.** Those tooltips round to one decimal, so
`quarterValueStep` is recorded per snapshot and anything within half a step of
the standing rate is refused rather than called. AUD's 4.4 against 4.35 and CAD's
2.3 against 2.25 each sit exactly half a step away and cannot be told from
equality — and A1 prints 0 for both. A 25bp move rounds clear of the band, so
this hides no decision a central bank can actually take. The alternative, reading
4.4 as a hike, would have invented two legs and broken the 8/8.

**All-or-nothing per board.** `resolveConsensusProjectionLegs` returns nothing
the moment any major is uncovered, and `buildSetupsMatrix` resolves it once above
the per-currency loop. This is the seam that stopped the rule shipping and it is
now structural: `lib/scoring/rates.ts` imports only the TYPE, so no per-currency
call site can resolve a lookup for itself. A test asserts that.

The consequence is visible and correct: the 2026-08-31 board falls through to the
old ladder, because the newest snapshot on or before that date covers five
majors. `npm run leg-parity` still exempts those three cells and says why.

### What stays

`lib/scoring/rate-projections.ts` still reads strictly backwards with no
nearest-available fallback, so a board wound back before the first reading gets
`NO_SNAPSHOT_YET` rather than an invented history. The fallback ladder below the
new rung is unchanged: bank projection → calendar consensus for the next
scheduled decision → `basis: 'none'` at 0 → `null` when there is no calendar at
all. Ledger `rates:projection-seam`, `rates:usd-leg`.

**The one thing to keep doing:** read the page again on a new day and append.
A snapshot series is the only way this column ever becomes replayable, and the
page still publishes no history of its own.

---

## 4. Economic series classification

| Series | Cur | Class | Note |
|---|---|---|---|
| Unemployment Rate (unadjusted) | CHF | CONFIRMED OUR SOURCE | The adjusted series never went 2.9 → 3.1; the unadjusted one did |
| ANZ–Roy Morgan Consumer Confidence | NZD | CONFIRMED OUR SOURCE | Monthly, primary, in feed. Wired 2026-08-31 |
| Westpac Consumer Confidence | AUD | CONFIRMED OUR SOURCE | Monthly, primary, in feed. Wired 2026-08-31 |
| PPI Output QoQ | NZD | CONFIRMED OUR SOURCE | Stats NZ +1.6%, June 2026 quarter |
| Retail Sales QoQ | NZD | CONFIRMED OUR SOURCE | The Stats NZ quarterly, not Electronic Card |
| Household Spending MoM | AUD | CONFIRMED OUR SOURCE | The ABS retired monthly Retail Trade; this replaces it |
| Retail Sales MoM | CAD | CONFIRMED OUR SOURCE | StatCan, scored against consensus since 2026-08-31 |
| GDP QoQ | NZD | PROVIDER-DEPENDENT | Actual +0.8% agreed; our 0.9% consensus sits inside the published 0.7–1.0% bank range |
| KOF Leading Indicator | CHF | **PROXY** | Not a services PMI. Switzerland publishes none on either feed |
| Ivey PMI s.a. | CAD | **PROXY** | Canada publishes no services PMI on either feed |
| Consumer confidence | CAD | **BLOCKED** | No series exists on either feed; the only candidate is already this currency's sPMI |
| Consumer confidence | — | SOURCE DIFFERENCE | A1's NZ leg reads −1 where every NZ series we carry reads bullish |

Proxies are labelled in the config at the point of use, because the column header
will not say so. A proxy is acceptable when the alternative is a blank column and
the substitution is named; it is not acceptable when it lets one survey vote
twice, which is why Canada's consumer confidence stays blank rather than
borrowing Ivey.

---

## 5. Open anomaly: asset rates

A1 scores GOLD and SILVER rates **−1** where FRED `DGS2` sits 0.19% from its
21-day average and we read flat. Their Asset Scorecard names the row
"US02Yield (21 day SMA)", so the series and the window are theirs.

Not investigated further this round, deliberately — it is one cell class, it has
no bearing on any FX pair, and it is behind the invariant and data-quality work
in value. Do not generalise from it. Ledger `rates:assets-2026-08-24`.

---

## 6. What parity is for now

Keep `component-parity`, `top-setups-parity`, `cross-day`, `crowd-oracle`,
`sources`, `ledger` and `evidence-next`. Change what a movement in them **means**.

`ParityClassification` already encodes this, and `npm run ledger` groups by it:

| Class | Does a gap here create pressure to change production? |
|---|---|
| `FIXED` | Already actioned |
| `SOURCE_DIFFERENCE` | **No.** Fix the feed or accept it. Never the formula |
| `A1_INCONSISTENCY` | **No.** Matching one side of their own contradiction is a coin flip |
| `TIMING` | **No.** Both models right, different moments |
| `TRANSCRIPTION_ERROR` | **No.** Discard the observation |
| `UNKNOWN` | The only class that licenses more research |

Only a defect demonstrated **against a primary source or against our own
output** justifies a scoring change — the `FIXED` entries all have one.

Two consequences worth stating plainly, because both feel wrong at first:

- **A parity DECREASE caused by fixing a proven bug is a success.** Correcting
  Canadian retail sales moved USDCAD from −11 to −13, away from A1's −6.
  Wiring NZ and AU consumer confidence moved seven more pairs away.
- **A parity INCREASE from adopting an unverifiable source is not automatically
  good**, and is forbidden where the source cannot be checked.

`TOTAL ABS GAP` is not a target and is not comparable across captures.

---

## 7. A1 publishes three surfaces, and one of them is broken

Added 2026-08-31, from A1's "EdgeFinder Free Week" (08-31 to 09-07), which for
the first time exposed Top Setups and the per-country Economic Heatmaps at once.

That combination overturned an assumption several rounds were built on. Top
Setups carries **index rows** — `EURO`, `GB-POUND`, `JP-YEN`, `CH-FRANC`,
`CA-DOLLAR`, `AU-DOLLAR`, `NZ-DOLLAR`, `US-DOLLAR`. A single-currency row is
undifferenced, so each cell **is** that currency's leg. The metals-only
workaround existed solely because we believed no such surface was public.

| Surface | What it is | Verdict |
|---|---|---|
| Country heatmaps | series, date, actual, forecast, previous, surprise, currency impact | shows its work |
| Index rows | one row per major, cells are raw legs | **104/104 against the heatmaps** |
| Pair rows | the 28 FX pairs | consistent on 9 columns, **a second leg vector on 4** — see below |

`npm run a1-surfaces` reproduces every number below from two fixtures.

**Consistent** (pair cell == leg(base) − leg(quote), exactly): GDP, sPMI, Retail
Sales, CPI, NFP, Unemployment Rate, Claims, ADP, JOLTS. These are the only
trustworthy parity targets.

**"Broken" was measured right and read wrong**, and section 7a corrects it:
PPI's exact global negation is not noise, and Cnsmr Conf does not diverge
irregularly. Both are a *second, coherent leg vector*.

Trend, Seasonality, COT and Crowd are per-instrument on their board and ours, so
they are not leg-differenceable and are excluded rather than counted as faults.

### Why this matters more than any parity number

**Every parity measurement this project has ever recorded was taken against the
pair rows** — the only surface that was public before the free week. Four of its
columns contradict A1's own published arithmetic. A gap there was never a target
in either direction, and `TOTAL ABS GAP` was summing those columns in.

Their **Data Updates Log** explains most of the irregular divergence: feeds
refresh anywhere from 15 minutes (price quotes) to weekly (COT), and the log
openly reports one of their own scripts failing — put-call ratio, 57 hours stale,
"please contact our staff". It does **not** explain PPI: a stale feed produces
noise, not a systematic sign flip.

### What their pages confirmed about us

- **The no-forecast fallback.** NZ mPMI surprise is `54.3 − 59.7 = −5.4` and
  sPMI `47.5 − 48.7 = −1.2`. With no forecast A1 measures against the previous
  print — exactly `scoreSlot`'s fallback, now confirmed from their arithmetic
  rather than inferred from blank Forecast columns. This is also the evidence the
  deleted Canadian overrides never had.
- **The 40/60 crowd band**, published directly: `USDCHF 61% → Bearish`,
  `SILVER 54.67% / EURUSD 43% → Neutral`, `AUDUSD 29% → Bullish`. Their retail
  feed covers 7 major pairs plus metals, indices and commodities — **no crosses**,
  matching our decision to score crosses null.
- **CAD consumer confidence is genuinely BLOCKED** — no country heatmap has a
  consumer confidence row, so A1 has none either.
- **NZ GDP**: actual 0.8%, forecast **0.8%**. Our 0.9% consensus is a real source
  difference, now proven rather than assumed.

### What is still not reachable

**EdgeFinder Score History and Scenario Backtests do not serve data.** Both
embed a chart from a third-party host, `a1.solvethis.qzz.io`, which does not
resolve; Looker's own banner flags the embed as not associated with Data Studio.
The page then instructs the reader to install a VPN and repoint their DNS to
`1.1.1.2`. That is instruction text inside observed content asking for a system
settings change — **do not act on it**, and do not treat the page as a source.

Score History and Scenario Backtests remain unreachable. **The rates rule is
not**: section 3 named a replayable projection dataset as its blocker, and the
free week's *Interest Rate Projections* page turned out to serve every major
through its chart tooltips. That rule shipped 2026-09-01. The two pages above are
still not a source, and the DNS instruction is still not to be acted on.

## 7a. Their pair rows are not broken. They are a SECOND leg vector.

Added 2026-09-01, and it overturns the word "broken" in section 7 without
changing a single number there.

Section 7 established that four columns of A1's pair rows disagree with their own
index rows and stopped at "broken", which made those columns unusable in both
directions. That was one measurement short. `lib/scoring/a1-pair-legs.ts` feeds
the 28 pair rows — **and only the pair rows** — to the leg solver that already
existed for row-sum checking, and solves for the eight-currency vector their pair
board is actually built on.

On six of the eight differenced macro columns, **one leg vector reproduces every
pair row exactly**. A broken surface cannot do that.

| column | pair-solved legs fit | index legs fit | verdict |
|---|---|---|---|
| GDP, sPMI, Retail Sales, CPI | 29/29 | 28/28 | IDENTICAL — one column, published twice |
| **PPI** | **29/29** | **7/28** | **NEGATED** — the whole vector flips |
| **Cnsmr Conf** | **29/29** | **7/28** | **INDEX_BLANK** — the index rows are the empty surface |
| mPMI | 21/29 | 11/28 | UNSOLVABLE — genuinely inconsistent |
| PCE | 28/29 | 22/28 | UNSOLVABLE — one row, one leg (JPY) |

Identical on 2026-08-31 and 2026-09-01, which is the point: a board that moved 13
of 972 cells in between produced the same eight statements.

### PPI: they read the release's STOCKS impact

Their country heatmap publishes `currencyImpact` **and** `stocksImpact` for every
release, and the two are opposite whenever either is non-neutral. Matching both
surfaces against both columns, eight economies out of eight:

- index legs follow **`currencyImpact`** — US, UK, JP Bearish; CA, AU, NZ
  Bullish; EU, CH Neutral
- pair legs follow **`stocksImpact`** — the exact inverse

So the "global sign flip" is the symptom and the wrong column is the cause. This
is a wiring error with a name, not an unknown, and it is pinned by test.

**It is their pair rows that are wrong, and this is decided by the release rather
than by a vote.** UK PPI printed 3.1 against a 3.2 forecast. A miss is bearish for
the currency that missed; their heatmap says Bearish, their index row says −1, we
score −1. Only the pair board dissents. **We do not adopt it.**

### Consumer confidence is the mirror image, and it is a gap on OUR side

Here the pair board is the surface carrying information. Its solved vector is a
full ternary set — GBP +1, CHF +1, AUD +1, EUR 0, JPY −1, NZD −1, CAD −1, USD −1
— where the index rows print 0 for seven of eight and the country heatmaps have
no consumer-confidence row for anyone but the US.

The one leg both surfaces carry is USD, and they agree on it. We score the column
for AUD and NZD only, and we agree with their pair legs on both. So this is
**coverage we lack**, not arithmetic we dispute, and it is the strongest lead
left on the board.

### What this changed in production

Nothing in the scorer. `npm run leg-parity` still measures against the index
rows, and section 8's reasoning is untouched. What it added:

- `npm run board-parity` — the whole 51-row board scored three ways, so every
  cell is attributed to *ours* or to *A1 against A1*. PPI's 61 points of absolute
  gap resolve to 21 A1-vs-A1 cells and **one** of ours.
- **A1 mirror**, a toggle on Top Setups. Default stays our arithmetic; the mirror
  re-derives PPI under their convention (a real rule, applied to live data) and
  reads consumer confidence from the newest capture (transcribed, and labelled as
  transcribed). mPMI and PCE are never mirrored, because there is no rule to
  mirror and fitting one to 28 cells would be a guess wearing a number. Mirror
  mode is presentation only — it reaches no parity script, no stored history and
  no change log.

## 8. Parity is measured on LEGS now, and the macro engine was never the problem

`npm run leg-parity` replaced board-total comparison as the headline measurement
on 2026-09-01. It compares our eight currency-index rows against A1's eight index
rows, rewound to the capture date. Two confounds had been inflating every number
before it:

**Differencing hides cancelling errors.** A pair cell is `base - quote`, so two
compensating leg errors produce a correct-looking pair. On the first run CADX and
AUDX both matched A1's total exactly while carrying two and three wrong cells
each. No total can see that; a leg can. This is the same failure recorded in
`checksum-is-blind-to-cancelling-pairs`, and it had been silently in force for
every round measured against pair rows.

**Comparing across a date boundary charges the model for the calendar.** Measured
live against a capture from the previous day, the gap read **-20 with TECHNICAL
at -18**. Rewound to the capture date it reads **-10 with TECHNICAL at -9**, and
all three seasonality mismatches vanish — A1 captured on 31 August and read the
AUGUST bucket while we had turned the month. Half the apparent error was the
clock.

What is left: **123 of 144 cells agree, 11 unexplained, and DXY reproduces 18 of
18 exactly.** MACRO contributes +5 of a -10 gap. The economic engine that twenty
rounds went into is at parity; the residue is Trend.

### AUDX had never been measured

`NAME_MAP` was missing `AU-DOLLAR`, and an unmapped A1 row is reported as "could
not map" and skipped. Every parity run this repo has ever produced measured seven
currencies and called it eight. Also added: `DAX`, `NASDAQ`, `BITCOIN`.

### The no-series exemption is derived, not listed

A1 prints `0` in every column an economy does not publish, which is "no such row"
rather than a scored neutral, and is arithmetically identical to the blank we
render. `leg-parity` reads which series exist per country off the heatmap fixture
instead of hardcoding a column list, so a new capture updates the exemption and a
genuine new defect in a column A1 *does* publish can never be absorbed by it. It
must stay restricted to MACRO columns — Trend, Seasonality, COT and Crowd have no
heatmap row by construction, and without that guard the rule swallowed a real
EURX Crowd disagreement the first time it ran.

## 9. Trend: fitted twice, reverted once, and the rule never changed

The column is a 3-day against a 14-day simple moving average. The crossover is
the score; a slow average pointing the other way **docks one point and never
flips the sign**, giving the range {-2, -1, +1, +2}. That is what A1's own page
describes, and after a day of trying to improve on it, it is what ships.

### What happened, because the round trip is the useful part

`npm run trend-solver` scores 28 candidates against every capture on disk.

| capture | docked (shipped) | "rising slow avg is always +2" |
|---|---|---|
| 2026-08-31 23:59 | 43/51 | 44/51 |
| 2026-09-01 09:44 | 39/51 | 42/51 |
| **2026-09-01 14:33** | **47/51** | **40/51** |
| **all three** | **129** | 126 |
| absolute error | **61** | 70 |
| churn (A1's own: 14) | **14** | 7 |

Fitted on the first capture alone the docked rule won. On the first two it lost,
and was replaced. On all three it wins on every axis at once — total exact,
absolute error, and matching A1's own movement.

### The quadrant table, which is the actual evidence

Every candidate is some resolution of the two states where crossover and slope
disagree, so the honest instrument is not a horse race but A1's printed cell
cross-tabulated against the state they were in, pooled over every capture:

| state | n | A1 prints | verdict |
|---|---|---|---|
| cross +, slope + | 71 | +2:68, +1:3 | **+2 in 96%** |
| cross −, slope − | 35 | −2:31, −1:2, +2:1, +1:1 | **−2 in 89%** |
| cross +, slope − | 20 | +1:14, −2:4, +2:2 | **+1 in 70%** |
| cross −, slope + | 27 | **−1:15, +2:12** | **UNDECIDED** |

Three quadrants are decided by measurement. **The fourth is not**, and it is the
one that was changed. On two captures it read "+2 in 67%, n=18" and that looked
like a finding; the third pulled it to 56% with −1 back in front.

The solver now prints this table and marks a quadrant UNDECIDED unless one value
takes 60% of at least 20 observations.

### The rule that came out of it

**Where the measurement is undecided, the published description wins.** A 67%
majority over 18 observations is not enough to overturn a rule read off their own
wording, and it should not have been treated as if it were.

And a sharper one: **counting captures is not the safeguard.** Two captures a day
apart were both taken in the same market state; a third from the *same day*
overturned them. A1 moved zero trend cells overnight and fourteen within one
afternoon, so the interval that mattered was never the one being sampled. Capture
the board more than once a day — the intraday frame is what separates a rule that
tracks the price series from one that tracks the clock.

Every 4H+Daily reading of their own `4H/Daily Chart Trend` label remains far
behind (best 72 of 153), so their label is still a description rather than an
arithmetic. `TREND_SMA` 3/14 is untouched and was re-confirmed by all three fits.

Ledger `trend:conflicted-quadrant`, `trend:fitted-on-one-day-picks-the-wrong-rule`.

---

## 10. Tracking is a different measurement from parity, and it is the one that degrades

`npm run delta-parity` (2026-09-01) measures whether our board MOVES the way A1's
moves, from two captures and two rewound runs of our own pipeline. It exists
because a level measurement cannot see the failure that actually compounds: two
boards can agree today and diverge tomorrow, and a board that is honestly two
points off and stays there is better than one that agrees on Monday and drifts by
Friday.

**A1's board is extremely sticky.** Between 31 August and 1 September it changed
**13 cells out of 972 — 1.3%** — and every one was Seasonality, Rates or Crowd.
No macro cell moved. No trend cell moved. So tracking them is mostly a question
of not moving when they do not move, and a cell of ours that flickers on a column
they hold still is a tracking failure even when its level is right.

Four outcomes per cell: AGREED (both moved the same, or both held), MISSED (they
moved, we did not), SPURIOUS (we moved, they did not), DIFFERED. Holding still
counts as AGREED deliberately — it is the majority behaviour and the thing most
easily got wrong.

After the §9 fix: **865 of 918 cells agree (94.2%), 44 spurious, 9 missed, 0
differed.** Of the 53 that do not track, **48 are explained and are not defects
on our side**:

| n | column | what it is |
|---|---|---|
| 23 | Seasonality | **A1 lags the month turn** — see below |
| 17 | mPMI, Retail Sales | two fresh 1 Sep releases we ingested and they had not |
| 8 | Rates | their pair rows moved while their own index legs did not |
| 4 | Trend | the 33% minority of the cross−/slope+ quadrant |
| 1 | Crowd | one NZDJPY cell |

### A1's seasonality lags by HOURS, and the first reading of it was taken too early

**Corrected 2026-09-01, same day it was written.** Scored against the 09:44
capture, their board matched our AUGUST signs 45 of 51 (88.2%) and our September
signs 25 (49.0%, chance), which read as A1 not having turned the month at all.

A second capture at **14:33 the same day reverses it**: our September signs now
match **43 of 51 (84.3%)**. Their seasonality column moved 20 cells between the
two frames, and not one macro cell moved.

So they recompute seasonality *during* the first day of the month rather than at
midnight. Our monthly averages agree with theirs either way — the 88% on August
signs before the roll and the 84% on September signs after it are the same
measurement taken on both sides of their refresh. The divergence closes itself
within a day and must not be chased.

**What it actually changed is the instrument.** `board-parity` now defaults to the
newest capture and rewinds to the capture MINUTE rather than the end of its day,
because the columns that move intraday — trend, seasonality, crowd — are exactly
the ones a whole-day rewind gets wrong. Against the 14:33 frame, seasonality fell
from 26 disagreements to 8.

One thing this does NOT license. Half the board carries a September 10-year mean
under 0.5% and 72% sit at a 40–60% win rate — AUDCAD scores +1 on a +0.02%
average that rose in three of ten Septembers. Those votes really are noise. But
they are the SAME noise A1 scores, and re-introducing a magnitude threshold to
damp them would break an 88% agreement to fix a statistical objection. See
`seasonality:a1-lags-the-month-turn`.

### The two releases

All 17 spurious macro moves trace to exactly two legs — JPY mPMI (Jibun Bank
Manufacturing PMI) and CHF Retail Sales (Real Retail Sales YoY), both released
2026-09-01 — propagating across every yen and franc pair. A1 scored neither at
09:44 UTC. Being first to a genuine print is the behaviour we want, and the
delta-parity report now prints the series name and release date beside every
spurious macro move so a future round cannot mistake latency for a defect.

### A delta is confounded by OUR code too, not just by the feed

Added 2026-09-01, the day the rates rule shipped. Rates went from 8 cells not
tracking to 20, and not one of those was data.

`resolveConsensusProjectionLegs` is all-or-nothing per board, so a board whose
date the projection snapshots cover scores rates from A1's quarterly consensus
while an earlier board falls through to the calendar ladder. Each board is
internally coherent — which is the property that matters for the board — but
across two boards every rates cell looks like it moved.

**A column that changed RULE between the two boards is not a column that moved.**
`delta-parity` now checks for exactly this and prints a warning naming which
board used which rule. It is printed rather than corrected for: silently
excluding the column would hide a genuine rates divergence the day one appears.
It resolves itself as soon as a snapshot exists on or before both captures, which
is one more reason to read their projections page on a new day and append.

### The method rule this leaves behind

**Never fit a scoring rule against one capture.** Score every candidate on at
least two, and on CHURN against A1's own movement, not on one-day exactness. With
28 candidates something always comes top by chance, and §9 is the worked example
of that happening and being caught.

