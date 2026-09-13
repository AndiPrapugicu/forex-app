# Truth evidence

> **Evidence tier: DEMO_ERA.** Written before A1's Free Week opened on 2026-08-31, i.e. against their tiered demo. Treat every claim about A1 as PREVIOUS DEMO HYPOTHESIS until re-tested under full access. Kept, not rewritten. See [LEGACY-EVIDENCE.md](LEGACY-EVIDENCE.md).

Where a cell of ours disagrees with A1, this file records what a **primary or
authoritative source** says, so the question can be settled on evidence instead
of on which board is prettier.

The rule that produced it: A1 is an observation, not a definition. Three columns
must be filled before a verdict — ours, theirs, and an independent source — and
where the third column is empty the verdict is `UNKNOWN`, not "probably them".

Tiers: **1** primary (central bank, statistics agency, CFTC) · **2** established
provider (FRED, Reuters, the bank's own release) · **3** aggregator · **4** an A1
screenshot, which is evidence of what A1 does and of nothing else.

---

## Verified 2026-08-31, live board

| # | Component | Cur | Our input | Independent source | Tier | Verdict |
|---|---|---|---|---|---|---|
| 1 | Interest Rates | NZD | standing 2.50%, next decision 2026-09-02 forecast 2.75% | RBNZ hiked to 2.50% on 2026-07-08; Reuters poll 27 of 31 economists expect 2.75% on Sept 2 | 1+2 | **OURS CORRECT** |
| 2 | PPI | NZD | PPI Output QoQ +1.6% vs +0.8% forecast, rel. 2026-08-19 | Stats NZ, *Business price indexes: June 2026 quarter* — outputs +1.6% | 1 | **OURS CORRECT** |
| 3 | mPMI | NZD | BusinessNZ PMI 54.3 vs 59.7/60.1 prior | BNZ-BusinessNZ: 54.3 in July from a **revised 60.1** in June | 1 | **OURS CORRECT** |
| 4 | GDP | NZD | GDP QoQ +0.8% vs +0.9% forecast, rel. 2026-06-18 | Stats NZ +0.8%; bank forecasts ranged 0.7-1.0%; RBNZ had projected 1.0% | 1 | **OURS DEFENSIBLE** |
| 5 | Retail Sales | CAD | +0.6% vs +1.0% prior -> scored **-1** | StatCan +0.6%; Reuters "0.6% vs 0.4% estimate" — a **beat** | 1+2 | **OURS WRONG — FIXED** |
| 6 | 13 economic legs | USD | see board | A1's own GOLD/SILVER rows carry the USD leg inverted, and agree with us **13 of 13** | 4 | **BOTH AGREE** |

### 1. NZD interest rates — ours correct, A1's rates page stale

Our calendar: OCR **2.50%**, set 2026-07-08, previous 2.25%. Next decision
2026-09-02, consensus **2.75%** — a hike, so the NZD leg is +1.

The RBNZ raised the OCR to 2.50% on 8 July 2026, its first hike since May 2023.
A Reuters poll has 27 of 31 economists expecting 2.75% on September 2. Both
halves of our leg are confirmed at tier 1/2.

A1's **Interest Rates page** displayed NZD at **2.25%** — one full hike behind.
That is a display-surface finding and nothing more: it does **not** establish
what A1's scoring backend used, and no cell was changed on account of it.

### 2. NZD PPI — ours correct at tier 1

Stats NZ: output prices **+1.6%** in the June 2026 quarter (input prices +2.9%).
Against a +0.8% forecast, and against a +0.8% prior print, this is a beat on
either basis, so the NZD leg is +1 however it is measured.

### 4. NZD GDP — a consensus difference, not a bug

Actual +0.8% is not in dispute. Our forecast of +0.9% sits inside the 0.7-1.0%
range the major banks published, and the release was widely reported as landing
**below** the RBNZ's own 1.0% projection. A miss can only be -1. A vendor
carrying 0.8% as consensus would legitimately print 0. Ledger `gdp:NZD`.

### 5. CAD retail sales — ours was wrong, and it is fixed

The one place independent evidence contradicted us outright. Detail and the
root cause are in ledger `retail-sales:CAD-basis`. Note the direction: fixing it
moved USDCAD from -11 to **-13**, further from A1's -6.

### 6. The dollar legs agree completely

A1's metal rows carry only the USD leg, inverted, so they read the dollar with
no differencing. Their GOLD and SILVER rows are identical, sum to the 8 they
display, and imply USD legs matching ours on all thirteen economic columns:
GDP 0, mPMI +1, sPMI -1, Retail -1, CnsmrConf -1, CPI 0, PPI -1, PCE 0, NFP -1,
UnempRate +1, Claims +1, ADP -1, JOLTS -1.

Two independent implementations, the same thirteen answers. This is the
strongest single piece of evidence that the transformation is right.

---

## Verified 2026-09-13, full-access era

| # | Component | Cur | Our input | A1 | Independent source | Tier | Verdict |
|---|---|---|---|---|---|---|---|
| 7 | Retail Sales | CAD | June **+0.6%** (core +1.2%) | heatmap **−0.8** | StatCan, *The Daily*, 2026-08-21: June +0.6%, core +1.2%, **July advance estimate −0.8%** | 1 | **DIFFERENT RELEASE, BOTH REAL** |
| 8 | Services PMI | CHF | none — no Swiss services PMI series exists | byte-identical to EUR on 24 of 24 points | A1's own two captures | 4 | **A1 SUBSTITUTES EUR** — mirrored in the `a1` profile only |
| 9 | Metals trend | XAG, XPT, XAU | Yahoo front-month futures | SMA100 states differ | roll-free ETFs SLV −4.11%, PPLT −2.73%, GLD +0.28% vs futures −5.11%, −2.89%, −0.25% | 2 | **UNKNOWN** — not a futures-roll artefact; no change |

### 7. CAD retail — A1 reads the flash, we read the final

A1's −0.8 is StatCan's advance estimate for July, published inside the June release. We score the
confirmed June figure. Neither is wrong; they are two different numbers from the same release, and
the confirmed one is the better reading. The scanner's −0.10% on A1's other surface matches neither
and is unexplained. Ledger `retail:cad-a1-heatmap-is-the-statcan-advance-estimate`.

---

## Not established — do not guess

| Item | Why it is open | What would close it |
|---|---|---|
| A1's NZDUSD **PPI** cell | Read as -2 across two captures. With their USD PPI leg pinned at -1 by the metals, -2 needs an NZD leg of **-3**, which a ternary cannot produce. The row sum closes anyway — the classic cancelling-pair blind spot | A full-resolution crop of the NZDUSD row |
| A1's NZDUSD **rates** and **GDP** cells | Same capture, same resolution | Same crop |
| Every A1 cell on **USDCAD** and **USDCHF** | Only the Score column is legible in the 12:05 capture; a trial read summed to +1 against a displayed -6 | Full-resolution crops of those two rows |
| A1's **2-year yield** rule | They score GOLD/SILVER rates -1 where DGS2 sits 0.19% from its 21-day average and we read flat | Ledger `rates:assets-2026-08-24` |
| NZD **consumer confidence** | A1 appears to carry a reading; no feed of ours does | A retail feed carrying ANZ-Roy Morgan or Westpac McDermott Miller |

**Cell transcription from a 1920x1080 board screenshot is not reliable, and a
row-sum checksum does not make it reliable** — it is invariant to any pair of
errors that cancel, which is exactly what happened here. Score columns are large
enough to read; the eighteen cells are not.
