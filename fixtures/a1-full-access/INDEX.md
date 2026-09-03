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

## Not yet captured, in priority order

Everything below is impossible once the window closes on 2026-09-07:

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
