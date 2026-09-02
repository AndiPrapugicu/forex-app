# Legacy evidence — what was measured through the demo, and what survives

A1's "EdgeFinder Free Week" opened on **2026-08-31**. Everything this project
concluded before that date was measured through their tiered demo, where Top
Setups read *"Premium only feature"*, the Asset Scorecard showed PLATINUM alone,
and the Forex Scorecard was capped to EUR/CHF.

**Nothing here is deleted and nothing is rewritten into agreement.** A demo-era
document records a real measurement taken under a real constraint, and keeping it
is what lets a later round tell an assumption from an observation. What changes is
that each claim now carries a tier, and:

> Where a full-access observation contradicts a demo-era one, **the observation
> wins and the demo-era document is annotated**, not edited.

The ledger tier is derived from the entry date, not hand-set, so it cannot drift —
see `evidenceTierOf` in [parity-ledger.ts](lib/scoring/parity-ledger.ts). Today:
**44 entries, 23 DEMO_ERA, 21 FULL_ACCESS.** Print them with `npm run ledger`.

---

## The five buckets

| bucket | meaning |
|---|---|
| **PREVIOUS DEMO HYPOTHESIS** | Believed on demo-era evidence. Not yet re-tested under full access. Treat as unverified. |
| **NEW FULL-ACCESS OBSERVATION** | Measured against the authenticated product on or after 2026-08-31. |
| **CONFIRMED RULE** | Re-tested under full access and held, on multiple dates and multiple pairs. |
| **REJECTED RULE** | Full access contradicted it. The document stays; the claim is annotated as overturned. |
| **STILL UNKNOWN** | Open, and honestly labelled so. The only bucket that licenses more research. |

---

## Documents

| file | tier | standing |
|---|---|---|
| `HARDENING.md` | mixed | §3 (rates), §7a and §9–§10 are full-access. Everything else predates 2026-08-31 and is **PREVIOUS DEMO HYPOTHESIS** until individually re-tested. §7 (the Cloudflare WARP / DNS text embedded in their Score History page) is a **standing security note and is not a scoring claim** — it does not expire. |
| `SCORING-CONTRACT.md` | demo-era | **PREVIOUS DEMO HYPOTHESIS.** Describes our engine, so most of it is a statement about us rather than about A1 — but every clause justified by "A1 does X" needs re-testing. |
| `TRUTH-EVIDENCE.md` | demo-era | **PREVIOUS DEMO HYPOTHESIS.** |
| `EdgeFinder-scoring-diagnosis.md` | demo-era | **PREVIOUS DEMO HYPOTHESIS.** Written when the only way to reach a leg was to solve for it off the metals. Superseded in method by `npm run a1-truth-table`, which reads legs off their index rows. |
| `EdgeFinder-known-unknown-blocked.md` | demo-era | **PREVIOUS DEMO HYPOTHESIS.** Its "blocked" list is the one most likely to be wrong now — several items were blocked only by the demo cap. |
| `A1-REVERSE-ENGINEERING.md` | full access | **NEW FULL-ACCESS OBSERVATION.** The report for this round. |

---

## Claims whose standing changed under full access

### REJECTED

**"No A1 surface that shows its arithmetic publishes a consumer confidence
series."** — ledger `a1:no-consumer-confidence-series`, 2026-08-31.

True of the nine country **heatmaps**, and that half is kept. False of A1 as a
whole: Economic Data → Economic Growth Data → Consumer Confidence publishes an
actual and a forecast for all eight majors. Scoring it with the ordinary rule
reproduces the leg vector their pair rows imply **7 of 8**. The entry is annotated
in place. The practical consequence: *"there is nothing to source a fix TO"* is no
longer a reason to leave six currencies uncovered.

**"A1's seasonality had not rolled to September."** — already corrected on
2026-09-01, before this round, and recorded in `HARDENING.md` §10. They roll
within the first day, not a month late.

**"A dip below a rising slow average scores +2."** — adopted and reverted on
2026-09-01. `HARDENING.md` §9.

### CONFIRMED, and now on stronger evidence than when written

| claim | evidence now |
|---|---|
| Score is a plain unweighted sum of the 18 columns | 216/216 rows over four captures |
| Bias bands are ±4 / ±7 | 216/216 — and their own score-history chart draws ±5/±12, which the board contradicts |
| `pair = clamp(baseLeg − quoteLeg)` | 112/112 on nine columns, four captures |
| A1's PPI pair rows are the exact negation | 112/112, four captures |
| Economic leg is `sign(actual − forecast)` | CPI 8/8 and PPI 8/8 against **their own published inputs** |
| Index rows are legs, undifferenced | unchanged; now the primary instrument rather than a solve |

### STILL UNKNOWN

- **mPMI.** Their pair rows fit no leg vector — best 56/112. Their own board is
  internally inconsistent here. Nothing to mirror.
- **The no-forecast fallback basis.** Previous-row and previous-distinct each fit
  exactly one observation, pointing opposite ways. Ledger
  `econ:no-forecast-fallback-basis`, deliberately WEAK.
- **PCE.** Only two leg states observed today (`0,0` and `0,−1`); the column is
  almost all zeros and cannot discriminate.

---

## The 23 demo-era ledger entries

These have **not** been individually re-tested against the authenticated product.
Several are almost certainly still right — `cot:publication-lag` and
`trend:as-of` were both fixed and regression-tested — but until each is re-run
against a full-access capture, none of them is a full-access observation:

```
cot:publication-lag          rates:yield2y-source        rates:assets-2026-08-24
chf:legs-move-between-boards trend:as-of                 consumer-confidence:CHF
mpmi:GBP                     mpmi:CHF                    rates:usd-leg
rates:EURX                   unemployment:EUR            ppi:GBP
gdp:GBP                      retail-sales:GBP            rates:eur-policy-rate
unemployment:CHF             spmi:NZD                    gdp:NZD
rates:projection-seam        crowd:board-wide            crowd:DXY
gbpx:residual                polarity:silver
```

Re-testing them is the highest-value remaining use of the access window after the
captures listed in `fixtures/a1-full-access/INDEX.md`.
