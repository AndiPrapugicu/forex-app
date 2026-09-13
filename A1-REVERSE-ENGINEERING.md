# A1 REVERSE-ENGINEERING RESULT

Measured against the authenticated EdgeFinder product during A1's Free Week
(`9dcec9fb-10be-4f20-b7f1-367ba41a192f`, 2026-08-31 → 2026-09-07). Capture moment
for the new material: **2026-09-02 09:04–09:20 UTC**, their own data-refresh stamp
`02.09.2026 12:04:37` local (UTC+3).

Confidence ladder used throughout: **CONFIRMED · STRONGLY SUPPORTED · SUPPORTED ·
HYPOTHESIS · UNKNOWN · BLOCKED**. Nothing is CONFIRMED on one date, one pair, or
one leg-state combination.

Reproduce everything here with `npm run a1-truth-table`.

---

## 1. What we now know with high confidence

1. **The score is a plain unweighted sum of the 18 columns.** 216/216 rows across
   four captures. No weights, no category multipliers, no cap. **CONFIRMED**
2. **The bias bands are ±4 and ±7.** 216/216. **CONFIRMED**
3. **Nine columns are exactly `clamp(baseLeg − quoteLeg, ±2)`**: GDP, sPMI, Retail
   Sales, CPI, NFP, Unemployment Rate, Unemployment Claims, ADP, JOLTS —
   112/112 each, four captures. **CONFIRMED**
4. **PPI is the exact negation on every pair row**, `clamp(quoteLeg − baseLeg)`,
   112/112. **CONFIRMED**
5. **Four columns are computed per instrument and never differenced**: Trend,
   Seasonality, COT, Crowd. **CONFIRMED** (structural, from their own drill-downs)
6. **The economic leg is `sign(actual − forecast)`.** Tested end to end against
   the actual and forecast *A1 themselves publish*: CPI 8/8, PPI 8/8.
   **CONFIRMED for CPI and PPI**, STRONGLY SUPPORTED as the general rule.
7. **Where a series carries no forecast, they still score it**, against a prior
   print. Which prior print is **UNKNOWN** (§16).
8. **Their per-metric pipeline is published in their own field names.** The
   Looker data source for Top Setups exposes, per metric, `Δ X A`, `Δ X B`,
   `score X A`, `score X B`, `X Score`, `# X A Actual`, `# X A Previous`,
   `# X B Actual`, `# X B Previous`. A = base leg, B = quote leg. **CONFIRMED**
9. **Consumer Confidence was never an unsolved column** — their *index rows* are
   blank. §4.
10. **A1 contradicts A1 on three separate surfaces.** §12.

## 2. What was wrong in our previous assumptions

| assumption | status | what full access showed |
|---|---|---|
| "No A1 surface publishes a consumer confidence series" | **REJECTED** | Economic Data publishes actual+forecast for all eight |
| "The Cnsmr Conf column admits no coherent rule" | **REJECTED** | Ordinary rule, 7/8 against their pair-implied legs |
| "Reaching A1's legs means solving for them off the metals" | **REJECTED** | Index rows are legs; read them |
| "A1's ±5 threshold (their marketing page)" | **REJECTED** | Board labels +4 Bullish, on 216/216 |
| "Economic columns might compare against previous, not forecast" | **REJECTED** for CPI/PPI | Forecast series is published and is the reference |
| PPI negation, leg-differencing, ±4/±7, index-rows-are-legs | **CONFIRMED** | Held, on four times the evidence |

Two conclusions from *earlier the same week* were also overturned before this
round and are recorded in `HARDENING.md` §9–§10: the trend slope rule (adopted
and reverted in one day) and "A1 lags the month turn" (they lag by hours).

## 3. Exact A1 scoring architecture

Read directly off their field names, not inferred:

```
release (actual, forecast, previous)
      ↓                                     one row per country per metric
Δ metric A  =  actual_base  − forecast_base
Δ metric B  =  actual_quote − forecast_quote
      ↓                                     ternary, sign only
score metric A  =  sign(Δ A)        ∈ {−1, 0, +1}
score metric B  =  sign(Δ B)
      ↓                                     pair transform
metric Score    =  clamp(score A − score B, ±2)      … 9 of 14 economic columns
                =  clamp(score B − score A, ±2)      … PPI, exactly
      ↓
Trend, Seasonality, COT, Crowd computed on the INSTRUMENT, not differenced
      ↓
final score = plain sum of all 18            bias = ±4 Bullish / ±7 Very Bullish
```

The currency-index rows (`EURO`, `US-DOLLAR`, …) are the leg vector published
undifferenced — each cell **is** `score metric A` for that currency. That is what
makes the pair transform readable rather than solvable.

## 4. Economic scoring formulas

Per column, pooled over four captures (n = 112 pair-cells each) and, where their
inputs were captured, tested end to end against those inputs.

| column | pair transform | fit | leg rule vs their inputs | confidence |
|---|---|---|---|---|
| GDP | base − quote | 112/112 | not yet captured | **CONFIRMED** (transform) |
| sPMI | base − quote | 112/112 | not yet captured | **CONFIRMED** (transform) |
| Retail Sales | base − quote | 112/112 | not yet captured | **CONFIRMED** (transform) |
| CPI | base − quote | 112/112 | **8/8** | **CONFIRMED** end to end |
| PPI | **quote − base** | 112/112 | **8/8** | **CONFIRMED** end to end |
| NFP | base − quote | 112/112 | not yet captured | **CONFIRMED** (transform) |
| Unemp. Rate | base − quote | 112/112 | not yet captured | **CONFIRMED** (transform) |
| Unemp. Claims | base − quote | 112/112 | not yet captured | **CONFIRMED** (transform) |
| ADP | base − quote | 112/112 | not yet captured | **CONFIRMED** (transform) |
| JOLTS | base − quote | 112/112 | not yet captured | **CONFIRMED** (transform) |
| Interest Rates | base − quote | 105/112 | — | **STRONGLY SUPPORTED** |
| PCE | quote − base | 108/112 | — | **UNKNOWN** — degenerate, §16 |
| Cnsmr Conf | base − quote | 28/112 vs index; **29/29 vs pair-solved legs** | **7/8** | **STRONGLY SUPPORTED**, §12 |
| mPMI | best 56/112 | — | — | **UNKNOWN**, §16 |

### CPI — worked example, their numbers throughout

Their Economic Data → Inflation Data → CPI YoY page, 2026-09-02:

| | USD | EUR | GBP | JPY | CHF | CAD | AUD | NZD |
|---|---|---|---|---|---|---|---|---|
| actual | 3.4 | 3.3 | 2.9 | 1.9 | 0.4 | 3.0 | 3.5 | 4.1 |
| forecast | 3.4 | 3.3 | 2.9 | 1.7 | 0.4 | 2.9 | 3.3 | 4.0 |
| `sign(a−f)` | 0 | 0 | 0 | **+1** | 0 | **+1** | **+1** | **+1** |
| A1 index row | 0 | 0 | 0 | +1 | 0 | +1 | +1 | +1 |

8/8. A higher-than-forecast CPI is bullish for that currency.

### PPI — the same rule, plus a fallback

Their PPI chart classifies each release into `Met` / `Lower than expected` /
`Higher than expected`. Latest release per currency scored `sign(actual −
forecast)`, falling back to the previous print where the series has no forecast
at all (CHF and AUD publish none): **8/8** against their index rows.

Their chart's own bucket is **7/8** — it calls CHF's flat −2.1 against −2.1
"Lower than expected" where their board scores it 0. Their chart and their board
disagree; the board is the scorer.

## 5. Pair transformation

**`pair = clamp(baseLeg − quoteLeg, ±2)` is CONFIRMED** for nine of fourteen
economic columns, on 112 observations each across four captures.

It is **not** universal:
- **PPI inverts it exactly** — `clamp(quoteLeg − baseLeg)`, 112/112.
- **Cnsmr Conf** obeys it against the legs their pair rows imply (29/29) but not
  against the legs their index rows print (28/112), because those index rows are
  blank.
- **mPMI** obeys no leg vector at all.

Values outside `[−2, +2]` were never observed; the clamp binds and is real.

Truth table for the columns that do not fit — this is the falsification the brief
asked for, and it is why "fit a rule to 28 cells" is refused:

```
mPMI   legA,legB    n   expected   A1 prints
       +1 , -1     20        +2     +0:12  +2:8
       -1 , -1     19         +0    +0:13  +2:6
       +1 , +1     10         +0    -2:6   +0:4
```

Two of those states are near coin-flips. There is no rule there to mirror.

## 6. Aggregation / weighting

Plain sum. **No weights.** 216/216 rows over four captures, tested as
`score == Σ(18 printed columns)`. Every component contributes its face value;
a `+1` contributes exactly `+1`. Bias thresholds ±4 / ±7, 216/216.

Their Forex Scorecard groups columns into *Eco Growth Comparison*, *Jobs Market
Comparison*, *Inflation Data Comparison*, *Technical Signal*, *Institutional
Activity*, *Sentiment Bias*. Whether those rollups are derived from the columns or
carry their own arithmetic is **UNKNOWN** — not yet captured across enough symbols.

## 7. Technical scoring

Trend is per instrument. 3-day vs 14-day SMA crossover; a slow average pointing
the other way docks one point and never flips the sign; range `{−2,−1,+1,+2}`.
**SUPPORTED** — this is their published description and it wins the candidate race
across three captures (129 exact vs 126, absolute error 61 vs 70, churn 14 against
their own 14). The `cross−/slope+` quadrant is **UNDECIDED** in their own output:
15 print −1, 12 print +2, n = 27. `HARDENING.md` §9.

## 8. Seasonality

Per instrument. Current month's 10-year mean, sign only. They roll to the new
month *during* the first day, not at midnight — 20 cells moved between 09:44 and
14:33 on 2026-09-01. Our September signs match theirs 43/51 post-roll.
**CONFIRMED as a rule, TIMING as a difference.**

## 9. COT

Per instrument. Their Forex Scorecard splits it into **COT Net Positioning** and
**COT Weekly Change** — two readings where our board carries one column. Whether
the board's single `COT` cell is one of these, their sum, or a third thing is
**UNKNOWN**. This is the highest-value structural question still open, because if
they are summed our COT column is half a component short.

## 10. Crowd

Per instrument. Their scorecard prints a `Crowd Bias` verdict. The 40/60
transformation is CONFIRMED from an earlier round (8/8 against their own dated
long-share history). What differs live is the population: they read a retail
broker book, we read CFTC small traders. **SOURCE_DIFFERENCE**, unchanged.

## 11. Rates

`sign(current quarter's consensus projection − standing policy rate)`, with a
dead band of half the snapshot's quarter step. Shipped 2026-09-01 and now
**51/51 exact** on the live board. The pair transform fits 105/112; the seven
misses are stale-cell timing, not rule.

## 12. Special cases — A1 against A1

Three surfaces of theirs disagree with each other. Each is filed as
`A1_INCONSISTENCY`, because matching one side of someone's internal contradiction
is picking a coin flip.

1. **PPI**: pair rows are the exact negation of their own index rows. 112/112.
2. **Consumer Confidence**: index rows print `0` for six of eight currencies
   while the pair rows carry a full, coherent leg vector (fits 29/29) — and that
   vector is what the ordinary rule predicts, 7/8. Their index rows are simply
   empty. GBP −14 vs forecast −18, JPY 35.2 vs 36.6, CHF −33 vs −34, CAD 48.19 vs
   previous 49.42, AUD −0.02 vs previous −0.09 — all real releases, all scored 0.
3. **Bias bands**: board labels say ±4/±7 (216/216), their score-history chart
   draws ±5/±12, their marketing page says ±5. The board is the scorer.

Plus a fourth, smaller: their PPI chart's own `Met/Lower/Higher` bucket
disagrees with their board on CHF.

## 13. A1 Mirror architecture

**Not built this round, deliberately** — §26 of the brief. The mirror stays as it
is (`lib/scoring/a1-mirror.ts`) until the formulas are CONFIRMED, and two of the
four columns it covers still are not.

What this round changes about the eventual mirror:

| column | before | now |
|---|---|---|
| PPI | derived, from one round's evidence | derived, **112/112 across four captures** |
| Cnsmr Conf | transcribed from a capture | **derivable** — ordinary rule, 7/8 |
| mPMI | left as ours | still no rule to mirror |
| PCE | left as ours | still degenerate |

## 14. Our model vs the mirror

Unchanged this round by design. No scoring code was touched.

## 15. Our model vs A1 actual

`npm run board-parity` against the 2026-09-02 09:04 capture, rewound to the
capture minute — 918 cells over 51 rows:

```
AGREE          744  (81.0%)
A1 vs A1        45   their pair rows contradict their own currency rows
OURS           108   the work list
NOT SCORED      21   Crowd, blocked on a retail feed
```

Exact columns: Rates, NFP, Unemployment Claims, ADP, JOLTS — **51/51 each**.
Largest remaining: PPI 61 (of which 21 are theirs), Trend 49, Crowd 40,
Cnsmr Conf 40 (13 theirs), Retail Sales 28.

### A measurement caveat, because it looks like a regression and is not

Re-running board-parity against **yesterday's** 14:33 capture now gives AGREE 713
where the same fixture gave 736 yesterday. No scoring file changed this round —
the only files touched under `lib/` are `parity-ledger.ts` and its test, and
nothing in the scoring path reads either.

The whole difference is two columns:

| column | measured 2026-09-01 | measured 2026-09-02 |
|---|---|---|
| mPMI absGap | 44 (1 ours) | **82 (31 ours)** |
| Trend absGap | 13 (5 ours) | **28 (11 ours)** |
| everything else | — | within 1 |

Manufacturing PMI prints on the first business days of the month, so our legs
carry September releases their 2026-09-01 14:33 board could not have had; and
2026-09-01's daily bars were incomplete when that board was captured and are
final now, which moves a 3-day SMA. **A rewind can remove an event by date. It
cannot un-revise data or un-finalise a bar.** Compare a capture against the board
built closest to it, and treat a re-measured old fixture as a different
experiment, not a regression.

## 16. Remaining unknowns

| # | question | status |
|---|---|---|
| 1 | **mPMI** — what produces their pair rows | **UNKNOWN**. Best fit 56/112; two leg-states near coin-flip. Their board contradicts itself. |
| 2 | **The no-forecast fallback basis** | **UNKNOWN**. Previous-row fits CHF PPI; previous-distinct fits NZD consumer confidence. One observation each, opposite ways. |
| 3 | **PCE** | **UNKNOWN**. Only two leg-states present today; almost all zeros. |
| 4 | **COT — one component or two** | **UNKNOWN**, and structurally important. |
| 5 | **Category rollups** — derived or independent | **UNKNOWN** |
| 6 | Whether the wire carries columns the table does not print | **UNKNOWN**. Their schema names `Δ`, `score A`, `score B` per metric; those fields exist in the data source but are not on any chart we can query. |
| 7 | `US10T`, `NATGAS`, `CHINA50` | unmodelled by choice |

## 17. What can now be implemented with confidence

- **Consumer confidence coverage** for GBP, JPY, CHF, CAD, AUD — the rule is the
  ordinary one and there is now a surface to check against. **Source from the
  primary publishers, not from A1's leg vector.**
- Nothing else. Every other CONFIRMED finding is a description of what we already
  do.

## 18. What must NOT be implemented yet

- **Any mPMI rule.** Fitting one to 112 cells whose own distribution is a coin
  flip in two states is the exact failure the trend column cost a round to learn.
- **Previous-distinct as the no-forecast fallback.** One cell.
- **PPI negation in our own scoring.** It is their bug — a print below forecast is
  a miss, and a miss is bearish for the currency that missed. Mirror it, never
  adopt it.
- **±5/±12 bias bands.**
- **Copying any A1 leg vector into a fixture** to close a coverage gap.

## 19. Highest-value remaining experiments

Ordered by "impossible once the window closes on 2026-09-07":

1. **Capture the remaining metric pages** — GDP, mPMI, sPMI, Retail Sales, and
   the whole Labor Market group — each with actual and forecast per currency.
   This converts six more columns from "transform CONFIRMED" to "CONFIRMED end
   to end", and is the only way mPMI gets settled.
2. **EdgeFinder Score History** — a daily score panel per symbol. We have never
   had multi-date data at all; it is what makes anything CONFIRMED across dates.
3. **All 54 scorecards.** Every row's drill-down is addressable by URL
   (`df1497` for pairs, `df1513` for indices/assets). Settles the COT split and
   the category rollups.
4. **Two more Top Setups captures a day.** Three captures on 2026-09-01 overturned
   two same-day conclusions; the intraday frame separates a rule that tracks the
   price series from one that tracks the clock.
5. **A metric page with dated x-axis labels**, to settle the no-forecast fallback.
6. **Re-test the 23 demo-era ledger entries.** `LEGACY-EVIDENCE.md`.

> **Superseded 2026-09-13:** the window closed on 2026-09-07. Items 1 (mPMI, sPMI) and the EURUSD Score History
> were captured; everything else on this list is now unobtainable. See §20.

## 20. Re-measured 2026-09-13, after the window closed

Same capture (2026-09-02 09:04), same rewind. Only sPMI's code path changed; every other column moved by at most
feed drift. Full per-column spec: [`docs/COMPONENT-SPEC.md`](docs/COMPONENT-SPEC.md).

| measure | before | after |
|---|---:|---:|
| `npm run parity` TOTAL ABS GAP (`ours`) | 114 | **101** |
| same, excluding A1-sourced cells | — | **110** |
| `npm run parity:a1` | — | **99** |
| `board-parity` AGREE / OURS | 744 / 108 | **752 / 100** |
| `leg-parity` | 117/144 | **124/144** |

| column | absGap before | absGap after | status | what would settle the rest | obtainable? |
|---|---:|---:|---|---|---|
| PPI | 61 | 61 | 21 cells are A1 against A1 (NEGATED); mirrored in the `a1` view only | nothing — it is their convention | — |
| Crowd | 40 | 40 | 19 crosses unscored by us | a permitted retail feed covering crosses, validated against A1's dated cross history | **No** — the history was lost in flight; no public feed passes the gate |
| Cnsmr Conf | 40 | 40 | 13 A1 against A1 (index rows blank) | primary-source series for GBP, JPY, CHF, CAD | Yes, from publishers |
| Retail Sales | 28 | 28 | CAD proven a release difference (advance vs final) | ONS / ABS checks of the remaining legs | Yes |
| Trend | 17 | 17 | metals SMA100 and a flat USDCHF slope | A1's metals price source | **No** |
| **sPMI** | **39** | **16** | FIXED for EUR/GBP/JPY/AUD by the PMI seed; all 16 remaining are CAD | A1's CAD services source (they have no series yet score it) | **No** |
| Seasonality | 15 | 15 | 13 points are the sign of a near-zero mean; ETH is a different history | A1's ETH price history | **No** |
| CPI | 11 | 11 | undisputed | per-leg primary checks | Yes |
| GDP | 10 | 10 | undisputed | per-leg primary checks | Yes |
| PCE | 9 | 9 | A1 scores a US-only series on JPY crosses | nothing | — |
| mPMI | 7 | 7 | UNSOLVABLE on their own rows | nothing | — |
| Unemployment | 2 | 2 | — | — | Yes |
| COT | 1 | 1 | — | — | Yes |

---

## The answer to §27 — can we recreate A1's scoring engine?

### PARTIALLY — and the boundary is now precise rather than vague.

**Sufficiently understood to implement a mirror (14 of 18 columns):** the
aggregation, the bias bands, the leg→pair transform, the ternary surprise rule,
the PPI inversion, rates, and the four per-instrument columns as their published
descriptions define them. For CPI and PPI the chain is verified end to end from
their own published input to their own published leg.

**Not understood (2 of 18):** mPMI and PCE — and the reason is not that their
mechanism is hidden. It is that **their own board is internally inconsistent
there**, so there is no single function to recover. A mirror can reproduce what
they print only by transcribing it.

**Understood but blocked on data (2 of 18):** Crowd needs a retail-broker feed
that A1 does not name; Consumer Confidence needs five more primary sources on our
side.

The mechanism is not proprietary. **Their engine is a spreadsheet**: their data
sources are Google Sheets, their field names describe the pipeline in plain
language, and the artefacts we found — a chart bucket that miscounts a flat
print, index rows blank where pair rows are full, a global sign flip on one
column — are spreadsheet artefacts, not sophistication we failed to model.

---

## §28 — ten observations now possible that were impossible in demo mode

1. Read A1's **per-metric field model** (`Δ A`, `Δ B`, `score A`, `score B`,
   `X Score`, `# A Actual/Previous`) off their data source schema.
2. Read **all 54 board rows** including every currency-index row, rather than the
   handful the demo exposed.
3. Read their **published actual and forecast** per currency per metric, with
   history — so a leg rule is tested against their input, not inferred from output.
4. Read their **own classification buckets** (`Met` / `Lower than expected` /
   `Higher than expected`) per release.
5. Reach **every symbol's scorecard by URL**, all 54, instead of the two the demo
   allowed.
6. See the **COT split** into Net Positioning and Weekly Change.
7. See the **per-symbol daily score history** and its band constants.
8. See the **category rollups** and the AI verdict labels per metric.
9. Capture the board **more than once a day**, with A1's own refresh timestamp.
10. Catch A1 **contradicting A1** on four separate surfaces — which is only
    visible when you can see more than one of them at once.
