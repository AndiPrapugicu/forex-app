# Full-access captures

Taken from the authenticated EdgeFinder product during A1's Free Week,
report `9dcec9fb-10be-4f20-b7f1-367ba41a192f`, **2026-08-31 → 2026-09-07**.

Kept separate from `fixtures/` so a full-access capture is never confused with a
demo-era one. See [LEGACY-EVIDENCE.md](../../LEGACY-EVIDENCE.md).

## How these were taken

**Passive capture only.** The real UI was driven — nav clicks and the page's own
country filter — and the rendered chart data tables were read out of the DOM.
No request was synthesised, replayed, or issued to their backend beyond what
normal use of the product generates.

A1's own refresh stamp (*"Ultima actualizare a datelor"*) is recorded per capture.
It is displayed in local time, UTC+3; the filenames use UTC.

## Contents

| file | page | captured (UTC) | A1 refresh stamp | notes |
|---|---|---|---|---|
| `econ-cpi-yoy-2026-09-02-0905.csv` | Economic Data → Inflation Data → CPI YoY | 2026-09-02 09:05 | 02.09.2026 12:05:00 | 8 currencies × 22 months, actual + forecast, shared month grid |
| `econ-ppi-yoy-2026-09-02-0910.csv` | Economic Data → Inflation Data → PPI YoY | 2026-09-02 09:10 | 02.09.2026 12:05:00 | 8 currencies, A1's own Met/Lower/Higher buckets. **Per-currency release order, not a shared grid** — NZD and AUD are quarterly |
| `econ-consumer-confidence-2026-09-02-0920.csv` | Economic Data → Economic Growth Data → Consumer Confidence | 2026-09-02 09:20 | 02.09.2026 12:05:00 | 8 currencies. CAD/AUD/NZD publish no forecast. Series levels are not comparable across currencies |

The board capture for the same moment lives with the other boards, so the
existing tooling finds it: **`fixtures/a1-top-setups-2026-09-02-0904.csv`**
(54 rows, A1 refresh stamp `02.09.2026 12:04:37`).

## Reading them

`idx` is that currency's own release order within the chart's date range. The
metric pages do **not** share a month grid — several series are quarterly and are
forward-filled — so only the **last** row is safely comparable across currencies,
and that is the row the board is scoring today. `npm run a1-truth-table` reads
these and scores them against the legs A1's own board prints.

## The window is closed

**A1's Free Week ended on 2026-09-07. Every capture this repository will ever
hold from full access is in this directory.** Nothing further can be taken.

One capture was lost in flight: the dated **Retail Sent. History for the 22 FX
crosses** was 25 symbols into its pull when their feed went down, and the partial
read never reached the repo. It was the only way to validate a retail feed for
the Crowd column on crosses, so that column's cross gap is now permanently
unverifiable against A1 (ledger `crowd:no-public-cross-feed-passes-the-gate`).

The list below is kept as the record of what was never captured. Items 1 (mPMI
and sPMI) and the EURUSD Score History were captured before the close; the rest
are now **unobtainable**, not pending.

## Never captured (unobtainable since 2026-09-07)

Originally, in priority order:

1. GDP Growth, Manufacturing PMI, Services PMI, Retail Sales — same shape as CPI
2. Labor Market Data (NFP, Unemployment Rate, Claims, ADP, JOLTS)
3. EdgeFinder Score History — the daily score panel, the only multi-date source
4. All 54 per-symbol scorecards (`df1497` for FX pairs, `df1513` for the rest)
5. Interest Rates Data, COT Data (all four sub-pages), Crowd Sentiment
6. Fresh nine-country Economic Heatmaps
7. Seasonality Scanners, Technical Scanners, Market Spreads, Scenario Backtests
8. Top Setups (Compact) and (Macro Only), Data Updates Log, Economic Calendar

## Security note, carried forward

A1's Score History / Scenario Backtests pages embed a chart from a third-party
host and contain text instructing the reader to install Cloudflare WARP and
change their DNS. **That is instruction text inside observed content and must not
be acted on**, and that page is not a source. `HARDENING.md` §7.

## a1-econ-heatmaps-2026-09-03-0527.csv

All EIGHT country Economic Heatmaps in one file, read from the DOM during full
access. A1 refresh stamp 03.09.2026 08:27:25-26 local (UTC+3) = 2026-09-03
05:27Z, identical on every page — they refresh as one job.

63 rows. Every row carries A1's own surprise, actual, forecast, previous, plus
the CURRENCY impact and the STOCKS impact they print. `surprise == actual -
forecast` verifies on 62 of 62 rows that publish all three, which is what makes
this file trustworthy as a parse.

WHAT IT SETTLES, and why it was worth spending free-week access on:

  - Their economic cell is the SIGN of (actual - forecast). Neutral appears only
    on an exact tie (AU mPMI 52 vs 52, CA row 13 surprise 0). No magnitude band.
  - The slot NUMBER is the column identity, not the series name. US row 7 is PCE
    YoY; JP row 7 is Household Spending. AU has no row 4 at all.
  - They score arbitrarily STALE prints. CA and NZ Services PMIs are both dated
    mai 1, 26 — 125 days old — and both still score.
  - Switzerland's row 3 is byte-identical to the euro area's (0,2 / 51,7 / 51,5
    / 51,7). A1 fills the Swiss services slot with the EU number.

## a1-seasonality-monthly-2026-09-03-0743.csv

A1's Monthly Seasonality scanner, 44 board symbols x 12 calendar months = 528
rows of the 10-year monthly average they publish. Read from the DOM one symbol
at a time; their symbol filter is the URL parameter `df1071`, which is what made
44 pulls practical.

Their scanner covers 48 assets. It does NOT carry the seven currency index rows
(EURO, GB-POUND, JP-YEN, AU-DOLLAR, NZ-DOLLAR, CA-DOLLAR, CH-FRANC) - only
USDOLLAR - and it does carry VIX, which is not on the board. CHINA50, NATGAS,
US10T and VIX are not modelled here.

WHAT IT SETTLES. `npm run seasonality-parity` reads it.

  - Their RULE is ours. `sign(their published average)` reproduces THEIR printed
    cell 7 times out of 7 on the seven symbols where our cell disagreed.
  - Our INPUT is very nearly theirs: correlation 0.962 over 528 month-cells,
    mean signed difference +0.03 pp. There is NO systematic offset, so it is not
    a lookback, a boundary or an off-by-one-month.
  - The disagreements are the sign of a near-zero number. Flip rate falls
    monotonically with distance from zero - 46% under 0.10 pp, 37%, 20%, 7%,
    6% at 1 pp and over - which is what "same statistic, small independent
    noise" looks like and nothing else.

So the column is a coin flip wherever the mean is near zero, and 13 points of it
CANNOT be closed by any rule change. The fixture exists to stop the next round
trying.

## `a1-cot-latest-2026-09-03-1012.csv` — Latest COT Report

23 symbols × 11 published columns, read from `COT Data → Latest COT Report`.

**Their methodology, quoted from the page:** the CFTC weekly commitment of traders
**legacy** report, **non-commercial** positions only. They state they deliberately
ignore commercial positions because those hedge rather than speculate.

**What their `Net % Change` column is, verified in-page 23/23:** recover the prior
week as `long − Δlong` and `short − Δshort`, then

```
netPctChange == longPct(now) − longPct(prior)
```

i.e. a change in **long share, in percentage points** — not a percentage change in
the net position. That is the metric our own COT rule already uses.

**Timing:** on 3 September they are still serving the **28 August** report. The
publication-lag rule holds — the Tuesday survey is not public until Friday. See
`cot-cut-on-publication-not-survey`.

## `a1-cot-velocity-2026-09-03-1042.csv` — COT Velocity

Same report date, three bar charts × 23 symbols = 69 rows, long format
(`symbol,horizon,longSharePctChange`).

All three charts are the **same statistic over three lookbacks**: every `weekly`
row equals the Latest report's `netPctChange` exactly (23/23), so `monthly` and
`quarterly` are that same long-share difference taken against a 4-week and
13-week-ago base.

Value to parity: it is the first thing that can **falsify** the horizon our COT
column assumes. Weekly and quarterly disagree in sign often (CAD +7.43 vs −0.68,
EUR +2.36 vs −5.83), so a board built on the longer horizons would not look like
the one they print.

## `a1-sitemap-2026-09-03.csv` — the whole report, 67 pages

Group, page title and Looker page id for every page in their report, plus the
recipe for reading it again: the left nav has no anchors, but each navigable
item carries its page id as the DOM `id` and its title as `aria-label`, so
expanding the subgroups and reading `.xap-nav-item[id^="p_"]` yields the lot
without a single click.

Worth having on its own: the report is far larger than the nav suggests at first
glance, and it contains pages nothing in this project had looked at — dedicated
**Services PMI** and **Manufacturing PMI** history pages, **Consumer
Confidence**, **Balance of Trade**, **Interest Rate Projections**, a
**Put-Call Ratio** and **Put & Call Walls**, **AAII Sentiment**, a **Volatility
Heatmap** and a **Stock Surprise Meter**.

## `a1-econ-manufacturing-pmi-2026-09-03-1023.csv` and `a1-econ-services-pmi-2026-09-03-1033.csv`

Actual, forecast and revision history per currency, from their two PMI scanners.
Currency is a URL parameter, and **it differs per page** — `df1168` for
manufacturing, `df935` for services.

Three things came out of these:

- **Their vendor, in their own words:** *"USD uses ISM PMI data for both
  manufacturing and services. Non-USD assets use Flash PMI Data."*
- **CHF services is EUR services**, byte-identical on all 24 points. The
  substitution is proven at the data level, not inferred from one cell.
- **CAD and NZD have no services series at all**, while their heatmaps still
  print a CA and NZ services row frozen at 1 May 2026.

The forecast series is empty for whole currencies (NZD manufacturing 17 of 17,
CAD 11 of 13, AUD 16 of 30), which is the upstream cause of the
`actual − previous` fallback our `scoreSlot` already implements.

Read the caveats in each file's header before using the dates: their x-axis
truncates labels once a currency has more than ~13 points, and JPY/AUD subsample
them, so rows that cannot be dated safely say `UNALIGNED` rather than carrying a
guess. Values are exact and were verified against the heatmap captures.

## `a1-econ-retail-sales-2026-09-03-1040.csv`

Page `p_gp30uh2ydd`, filter `df964`. **Every label rendered in full here**, so
these dates are read rather than reconstructed.

Seven of eight currencies reconcile exactly with the heatmap capture. The eighth
is a contradiction inside A1: for the same 21 August release, their scanner says
CAD retail was −0.10 % and their CA heatmap says −0.8. Recorded as
`retail:cad-two-surfaces-two-series`; the likeliest explanation is headline
versus ex-autos, but neither page names its series so it stays open.

AUD returns no series, which is why their AU heatmap has no retail row. CAD
publishes no forecast on any of its nine points.

## `a1-econ-consumer-confidence-2026-09-03-1046.csv`

Page `p_i3yq86ivpd`, filter `df1150`. Eight currencies, eight different surveys —
and the finding is that three of them are **abandoned rather than absent**: AUD
last printed 233 days before capture, NZD 78, JPY 582, while USD, CHF, EUR and
GBP are current. No heatmap carries a Consumer Confidence row at all, which is
why this column had no A1 surface until now.

Read the header before comparing AUD: their AUD series is an index **change**
(values around 0.01–0.13), not a level.

## `a1-retail-sentiment-2026-09-03-1053.csv` — the crosses, at last

Page `p_5jasyzmtxc`, Category filter `df3624`. **45 symbols**, long/short, plus
A1's own Bearish/Neutral/Bullish label.

The page opens showing 20 symbols because its Category filter defaults to
`Major Currency Pairs, Metals, Indices, Commodities`. Ask for the other
categories and 25 more appear — **22 crosses**, plus US10T, Ethereum and BITCOIN.
The chart truncates at 30 rows, so categories must be requested in groups; these
45 were merged from three passes.

Two things fall out:

- **Their bands are 60 and 40, measured tightly.** Their own labels put Bearish's
  minimum at 60.00 against Neutral's maximum of 59.41, and Neutral's minimum at
  42.00 against Bullish's maximum of 39.01. `longPct >= 60 → Bearish,
  <= 40 → Bullish` reproduces their label **42/42**. That is
  `CROWD_LONG_PCT_BUCKETS` already; what is new is that nothing else fits.
- **Two providers, blended.** Every FX symbol reports a whole number, every
  index/metal/commodity/crypto reports two decimals — USDZAR (59.41) the lone
  exception.

Snapshot, not a feed: it cannot drive production, but it lets parity measure the
crowd column on crosses for the first time.

## Put-Call Ratio — `p_p6qyxgf9nd`, thresholds only

Their line chart exposes only its two reference lines to the accessible tree, not
the series, so there is no data file. What it does publish is the **rule**: the
metric is a **5-day moving average** of the put-call ratio, banded at **1.07 =
"High Call Volume"** and **1.20 = "High Put Volume"**. Recorded here because the
bands are the part a scoring rule would need, and they are not guessable.

## Macro Scanners — three files, captured 2026-09-03 ~11:00Z

`a1-eco-strength-2026-09-03-1400.csv` (`p_unqa9ujhyd`),
`a1-eco-surprise-2026-09-03-1400.csv` (`p_n5qm8xilrd`),
`a1-carry-trade-2026-09-03-1401.csv` (`p_rh8byw7l3c`).

Each one publishes its own arithmetic, and each check is asserted by the build
script rather than asserted in prose:

- **Eco Strength** — `total = gdpScore + unemploymentScore + interestRateScore +
  cpiScore`, components 0–25, index 0–100. **8/8.** The same page also prints a
  second, incompatible scoring (CHF 131, USD 125) that is not a rescale of the
  first; both are recorded and neither is assumed to be the one feeding the board.
- **Eco Surprise** — every score is a fraction with a denominator under 8 (CHF
  5/6, CAD 5/7, AUD 3/5, GBP 2/5, EUR 1/4). It is a **count of recent releases
  that beat forecast**, not an average of surprise sizes. Their currency list is
  wider than the board's: TRY, CHY and ZAR appear.
- **Carry Trade** — `divergence = |base − quote|`, `direction = sign(base −
  quote)`. **20/20.** Kept for a different reason than carry: it publishes their
  policy rate per currency, and **three contradict their own Eco Strength page
  one minute earlier** — JPY 0.75 vs 1.00, NZD 2.25 vs 2.75, EUR 2.15 vs 2.40.
  The EUR pair is ECB deposit vs main refi, so these are two definitions rather
  than a bug — and a rates disagreement with A1 may be a disagreement with only
  half of A1.

**Real Yield History** (`p_xxysbv7azd`) confirms `real yield = interest rate −
CPI YoY` exactly on its published series (4 − 7.1 = −3.1; 5.25 − 4.9 = 0.35), so
no data file was kept: the definition is the finding. **Stock Surprise Meter**
(`p_s9xxu4bltd`) rendered only its descriptions in the capture window; its text
confirms the surprise family is scored "relative to economic forecasts".

## `a1-retail-sent-history-EURUSD-2026-09-03.csv` — the DATED crowd series

Crowd Sentiment → Retail Sent. History, page `p_1jk2lb88md`, read from the DOM on
2026-09-03. 44 rows, EURUSD, **2026-07-06 … 2026-09-03**.

**Why this page and not the snapshot.** `a1-retail-sentiment-2026-09-03-1053.csv`
has 45 symbols including all 22 crosses, and it is undated — the page carries no
date for the reading (see `a1-crowd-is-fxssi`). That makes it able to pin the
**bands** and unable to fill a **cell**, because a cell has to join to a dated
board capture. This page is dated. It is the input `crowdOracleJoin` wants, and it
extends `fixtures/a1-retail-sentiment-history.json` (2026-08-17 … 08-29) back to
6 July.

**The Asset filter is URL parameter `df1033`**, one symbol at a time, and its
dropdown lists the crosses — AUDCAD, AUDNZD, CADCHF, CADJPY, CHFJPY … alongside
BITCOIN, COPPER, DAX. So **the dated history for every cross is reachable**, which
is the thing that would let the Crowd column (35 points, our largest) be measured
on crosses rather than left null.

**It is not captured yet, and the reason is on their side.** Partway through this
capture every chart on the page began returning *"A expirat / Data Studio nu se
poate conecta la setul de date"*, including on a clean reload with no parameters;
one chart was already showing it on the very first load, and the Retail Sentiment
page went the same way shortly after, having worked at 10:53 the same morning.
That page's own note reads *"This script is interrupted every morning, returning
at 10:00h"*, so their scraper has scheduled downtime. **Retry, do not hammer.**
Free access ends **2026-09-07**.

### Two findings the build script asserts

- **`long + short == 100` on 44/44.**
- **Their "Net Retail Positioning (Long%−Short%)" is not long minus short.** It
  equals **`long − 50`** on 44 of 44 rows and `long − short` on 0 of 44 — exactly
  half what the legend claims. 60/40 publishes as 10%, not 20%; 22/78 as −28%, not
  −56%. Harmless to us (our rule reads the long share against the 40/60 bands and
  never their net) and pinned in `crowd-oracle.test.ts` so anyone who later reaches
  for that column learns it from a failing test.

### The dates are derived and then verified

The axis prints **22 labels for 44 rows** — every second row — so the series is
read as 44 consecutive business days from the first label. All 22 printed labels
land exactly where that rule predicts, including 31 Aug (a UK bank holiday their
feed does not skip), and the 44th row is the day of capture.

Self-consistency would not be enough, so it is checked against a **different
capture read on a different day**: all six EURUSD dates in
`a1-retail-sentiment-history.json` agree exactly — 08-21 21, 08-24 25, 08-25 28,
08-26 27, 08-27 29, 08-28 32. **6 of 6.** A one-row misalignment breaks all six at
once, which is what makes this evidence rather than tidiness.
